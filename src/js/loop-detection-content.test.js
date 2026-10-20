// loop-detection-content.test.js — Faux positif de boucle sur les ÉCRITURES.
//
// Cause tranchée (session `codeur` du projet pilot, 2026-10-20 03:28Z) :
// `buildToolLoopFingerprint` ne cléait un `edit` que sur son CHEMIN. Trois
// modifications DIFFÉRENTES du même fichier produisaient trois empreintes
// identiques → `detectRepeatedToolCalls` (minRepeat=3) → arrêt automatique de
// la session en ~12 ms.
//
// Ces tests verrouillent le correctif :
//  (a) 3 écritures différentes du même fichier → pas une boucle ;
//  (b) 3 écritures identiques → toujours détectée (vraie boucle) ;
//  (c) suite réaliste longue (séquence réelle de la session, chemins anonymisés)
//      → aucune boucle ;
//  (d) motif d'arrêt journalisé (ligne + append + rotation) ;
//  (e) commande d'arrêt automatique (garde de propriété uid).
import { describe, it, expect } from "vitest";
import {
  buildToolLoopFingerprint,
  detectRepeatedToolCalls,
  detectRepeatedActions,
  collectWriteContent,
  hashLoopContent,
  buildAgentStopTraceLine,
  appendAgentStopTrace,
  buildAgentStopRequest,
  AGENT_STOP_TRACE_MAX_CHARS,
} from "./loop-detection.js";

// Chemin ANONYMISÉ (la fixture réelle contient un chemin absolu du poste).
const FILE = "src-tauri/src/agent_service.rs";

/** Empreinte d'un `edit` pi : chemin + tableau d'éditions. */
function editFp(edits, path = FILE) {
  return buildToolLoopFingerprint("edit", { path, edits });
}

/** Les 3 `edit` RÉELS de la session (index 30, 31, 32 de la fixture). */
const REAL_EDITS = [
  [{ oldText: "fn write_assistant_extensions(dir: &Path)", newText: "fn write_assistant_extensions(dir: &Path, force: bool)" }],
  [{ oldText: "    std::fs::write(&path, content)?;", newText: "    write_embedded_file(&path, content)?;" }],
  [{ oldText: "let choices_path = dir.join(\"pilot-choices.ts\");", newText: "let choices_path = ext_dir.join(\"pilot-choices.ts\");" }],
];

describe("(a) écritures DIFFÉRENTES du même fichier : pas une boucle", () => {
  it("3 edit différents → 3 empreintes distinctes, aucune boucle", () => {
    const fps = REAL_EDITS.map((edits) => editFp(edits));
    expect(new Set(fps).size).toBe(3);
    expect(detectRepeatedToolCalls(fps)).toBe(false);
    expect(detectRepeatedActions(fps)).toBe(false);
  });

  it("l'empreinte porte le contenu (longueur + hash) et pas seulement le chemin", () => {
    const fp = editFp(REAL_EDITS[0]);
    expect(fp.startsWith(`tool::edit::${FILE}::content=`)).toBe(true);
    expect(fp).toMatch(/::content=\d+:[0-9a-f]{16}$/);
    // Le chemin seul ne suffit plus à identifier l'appel.
    expect(fp).not.toBe(`tool::edit::${FILE}`);
  });

  it("3 write de contenus différents sur le même fichier → pas une boucle", () => {
    const fps = [
      buildToolLoopFingerprint("write", { path: "src/a.rs", content: "pub fn a() {}\n" }),
      buildToolLoopFingerprint("write", { path: "src/a.rs", content: "pub fn a() { 1 }\n" }),
      buildToolLoopFingerprint("write", { path: "src/a.rs", content: "pub fn a() { 2 }\n" }),
    ];
    expect(new Set(fps).size).toBe(3);
    expect(detectRepeatedToolCalls(fps)).toBe(false);
  });

  it("un patch/diff différent n'est pas une boucle non plus", () => {
    const fp1 = buildToolLoopFingerprint("apply_patch", { path: FILE, patch: "@@ -1 +1 @@\n-a\n+b\n" });
    const fp2 = buildToolLoopFingerprint("apply_patch", { path: FILE, patch: "@@ -2 +2 @@\n-c\n+d\n" });
    const fp3 = buildToolLoopFingerprint("apply_patch", { path: FILE, patch: "@@ -3 +3 @@\n-e\n+f\n" });
    expect(new Set([fp1, fp2, fp3]).size).toBe(3);
    expect(detectRepeatedToolCalls([fp1, fp2, fp3])).toBe(false);
  });
});

describe("(b) écritures IDENTIQUES : la vraie boucle reste détectée", () => {
  it("3 edit identiques → même empreinte, boucle détectée", () => {
    const fps = [editFp(REAL_EDITS[0]), editFp(REAL_EDITS[0]), editFp(REAL_EDITS[0])];
    expect(new Set(fps).size).toBe(1);
    expect(detectRepeatedToolCalls(fps)).toBe(true);
  });

  it("3 write identiques → boucle détectée", () => {
    const fp = buildToolLoopFingerprint("write", { path: "src/a.rs", content: "identique\n" });
    expect(detectRepeatedToolCalls([fp, fp, fp])).toBe(true);
  });

  it("2 edit différents intercalés ne déclenchent pas (minRepeat=3 consécutifs)", () => {
    const a = editFp(REAL_EDITS[0]);
    const b = editFp(REAL_EDITS[1]);
    expect(detectRepeatedToolCalls([a, b, a, b])).toBe(false);
    // 5 occurrences de la MÊME écriture dans la fenêtre → detectRepeatedActions.
    expect(detectRepeatedActions([a, b, a, b, a, b, a, a])).toBe(true);
  });

  it("deux appels du même contenu via des formes d'arguments différentes sont distincts si le contenu diffère", () => {
    const legacy = buildToolLoopFingerprint("edit", { path: FILE, oldText: "a", newText: "b" });
    const modern = buildToolLoopFingerprint("edit", { path: FILE, edits: [{ oldText: "a", newText: "c" }] });
    expect(legacy).not.toBe(modern);
  });

  it("le contenu identique reste identique quel que soit le format (oldText/newText vs old_string/new_string)", () => {
    const a = buildToolLoopFingerprint("edit", { path: FILE, oldText: "a", newText: "b" });
    const b = buildToolLoopFingerprint("edit", { path: FILE, old_string: "a", new_string: "b" });
    expect(a).toBe(b);
  });
});

describe("(c) suite réaliste longue : aucune boucle", () => {
  it("34 appels variés de la session réelle (chemins anonymisés) → aucun détecteur ne déclenche", () => {
    // Séquence reconstituée depuis la fixture `loopdata-codeur-2026-10-20.json`
    // (34 empreintes), avec les chemins absolus remplacés par des chemins
    // relatifs — la FORME des empreintes est identique.
    const fps = [
      buildToolLoopFingerprint("read", { path: ".pi/skills/quality-gate/SKILL.md" }),
      buildToolLoopFingerprint("bash", { command: "cd . && git status --short | head -30 && echo \"---\" && git log --oneline -3" }),
      buildToolLoopFingerprint("bash", { command: "grep -n \"write_assistant_extensions\" -r src-tauri/src/ | head -20" }),
      buildToolLoopFingerprint("bash", { command: "grep -n \"pilot-choices.ts\\|std::fs::write\" src-tauri/src/agent_service.rs | head -40" }),
      buildToolLoopFingerprint("read", { path: "src-tauri/src/agent_service.rs", offset: 2400, limit: 280 }),
      buildToolLoopFingerprint("read", { path: "src-tauri/src/agent_service.rs", offset: 2680, limit: 220 }),
      buildToolLoopFingerprint("bash", { command: "grep -n \"tempfile\\|temp_dir\" -r src-tauri/Cargo.toml src-tauri/src/*.rs | head -20" }),
      buildToolLoopFingerprint("bash", { command: "grep -n \"std::fs::write\" src-tauri/src/agent_service.rs | wc -l" }),
      buildToolLoopFingerprint("bash", { command: "grep -n \"pilot-choices\" src-tauri/src/agent_service.rs" }),
      buildToolLoopFingerprint("bash", { command: "grep -n \"fn write_laya_extension\" -A 45 src-tauri/src/agent_service.rs" }),
      buildToolLoopFingerprint("bash", { command: "grep -rn \"mod test_util\" src-tauri/src/ && sed -n '1,60p' src-tauri/src/test_util.rs" }),
      buildToolLoopFingerprint("read", { path: "src-tauri/src/agent_service.rs", offset: 3040, limit: 120 }),
      buildToolLoopFingerprint("read", { path: "src-tauri/src/agent_service.rs", offset: 2895, limit: 100 }),
      buildToolLoopFingerprint("bash", { command: "grep -rn \"SuperAgentExtStatus\" src-tauri/src/*.rs src/js/*.js | head -20" }),
      buildToolLoopFingerprint("read", { path: "src-tauri/src/agent_service.rs", offset: 75, limit: 40 }),
      buildToolLoopFingerprint("bash", { command: "grep -rn \"superagent_ext_status\\|superagentExt\" src/js/*.js | head -20" }),
      buildToolLoopFingerprint("bash", { command: "grep -rn \"write_assistant_extensions\" src-tauri/src/*.rs | head -20" }),
      buildToolLoopFingerprint("bash", { command: "grep -rn \"361\\|extensions\" spec_pilot.md | head -30" }),
      buildToolLoopFingerprint("bash", { command: "wc -l spec_pilot.md && grep -n \"^#\\|^##\" spec_pilot.md | head -40" }),
      buildToolLoopFingerprint("read", { path: "spec_pilot.md", offset: 38, limit: 40 }),
      buildToolLoopFingerprint("read", { path: "src-tauri/src/lib.rs", offset: 100, limit: 40 }),
      buildToolLoopFingerprint("bash", { command: "sed -n '3024,3050p' src-tauri/src/agent_service.rs && grep -n \"^#\" help/overview.md | head -40" }),
      buildToolLoopFingerprint("read", { path: "help/overview.md", offset: 203, limit: 50 }),
      buildToolLoopFingerprint("bash", { command: "grep -rn \"HELP:\" --include=\"*.md\" spec_*.md | grep -i \"outil\" | head -20" }),
      buildToolLoopFingerprint("bash", { command: "sed -n '465,555p' spec_rpc.md" }),
      buildToolLoopFingerprint("write", { path: "src-tauri/src/extension_write.rs", content: "// nouveau module\"" }),
      buildToolLoopFingerprint("bash", { command: "sed -n '60,105p' src-tauri/src/lib.rs && sed -n '60,120p' src-tauri/src/test_util.rs" }),
      editFp([{ oldText: "mod extensions;", newText: "mod extensions;\nmod extension_write;" }], "src-tauri/src/lib.rs"),
      editFp([{ oldText: "use crate::extensions;", newText: "use crate::extension_write;" }], FILE),
      buildToolLoopFingerprint("read", { path: "src-tauri/src/agent_service.rs", offset: 2496, limit: 90 }),
      editFp(REAL_EDITS[0]), // index 30
      editFp(REAL_EDITS[1]), // index 31
      editFp(REAL_EDITS[2]), // index 32
      buildToolLoopFingerprint("read", { path: "src-tauri/src/agent_service.rs", offset: 2685, limit: 115 }),
    ];
    expect(fps).toHaveLength(34);
    expect(detectRepeatedToolCalls(fps)).toBe(false);
    expect(detectRepeatedActions(fps)).toBe(false);
    // Contrôle de non-régression du faux positif : AVANT correctif, les 3 `edit`
    // du même fichier étaient identiques (c'était la cause de l'arrêt).
    expect(new Set(fps.slice(30, 33)).size).toBe(3);
  });

  it("une exploration longue (50 appels) ne déclenche jamais", () => {
    const fps = [];
    for (let i = 0; i < 50; i++) {
      if (i % 5 === 0) fps.push(buildToolLoopFingerprint("read", { path: "src/agent_service.rs" }));
      else if (i % 5 === 1) fps.push(buildToolLoopFingerprint("read", { path: "src/agent_service.rs", offset: i * 100, limit: 100 }));
      else if (i % 5 === 2) fps.push(buildToolLoopFingerprint("bash", { command: `grep -n "pattern${i}" src/agent_service.rs` }));
      else if (i % 5 === 3) fps.push(editFp([{ oldText: `old${i}`, newText: `new${i}` }]));
      else fps.push(buildToolLoopFingerprint("write", { path: `src/file${i}.rs`, content: `// ${i}` }));
    }
    expect(detectRepeatedToolCalls(fps)).toBe(false);
    expect(detectRepeatedActions(fps)).toBe(false);
  });

  it("lecture pure : l'empreinte ne porte pas de contenu (chemin seul conservé)", () => {
    expect(collectWriteContent({ path: "src/a.rs" })).toBeNull();
    expect(buildToolLoopFingerprint("read", { path: "src/a.rs" })).toBe("tool::read::src/a.rs");
    expect(buildToolLoopFingerprint("read", { path: "src/a.rs", offset: 10, limit: 5 })).toBe(
      "tool::read::src/a.rs::offset=10::limit=5"
    );
    expect(buildToolLoopFingerprint("db_query", { sql: "SELECT 1" })).toBe('tool::db_query::{"sql":"SELECT 1"}');
  });

  it("hashLoopContent est déterministe et discriminant", () => {
    expect(hashLoopContent("abc")).toBe(hashLoopContent("abc"));
    expect(hashLoopContent("abc")).not.toBe(hashLoopContent("abd"));
    expect(hashLoopContent("")).toMatch(/^[0-9a-f]{16}$/);
    // Deux contenus de même longueur mais inversés → empreintes différentes.
    expect(hashLoopContent("ab")).not.toBe(hashLoopContent("ba"));
  });
});

describe("(d) motif d'arrêt journalisé sur disque", () => {
  it("la ligne porte le motif et le détecteur", () => {
    const line = buildAgentStopTraceLine({
      reason: "loop-detection",
      detected: "tool-calls",
      agentId: "codeur",
      projectPath: "G:\\IA_PL\\pilot",
      uid: 42,
      timestamp: "2026-10-20T03:30:00.000Z",
    });
    expect(line).toContain("op=auto-stop");
    expect(line).toContain("reason=loop-detection");
    expect(line).toContain("detected=tool-calls");
    expect(line).toContain("agent=codeur");
    expect(line).toContain("project=G:\\IA_PL\\pilot");
    expect(line).toContain("uid=42");
    expect(line.startsWith("2026-10-20T03:30:00.000Z  op=auto-stop")).toBe(true);
    // Une seule ligne (pas de saut de ligne injecté).
    expect(line).not.toContain("\n");
  });

  it("uid inconnu → uid=none, valeurs manquantes tolérées", () => {
    const line = buildAgentStopTraceLine({ reason: "loop-detection" });
    expect(line).toContain("uid=none");
    expect(line).toContain("detected=unknown");
    expect(line).toContain("agent=none");
    expect(buildAgentStopTraceLine()).toContain("reason=unknown");
  });

  it("assainit les valeurs (nouvelle ligne aplatie, longueur bornée)", () => {
    const line = buildAgentStopTraceLine({ reason: "loop\n-detection", agentId: "a".repeat(500) });
    expect(line.includes("\n")).toBe(false);
    expect(line).toContain("agent=" + "a".repeat(77) + "...");
  });

  it("append : ajoute une ligne, gère l'absence de fichier et le saut de ligne final", () => {
    expect(appendAgentStopTrace("", "L1")).toBe("L1\n");
    expect(appendAgentStopTrace("L1\n", "L2")).toBe("L1\nL2\n");
    expect(appendAgentStopTrace("L1", "L2")).toBe("L1\nL2\n");
  });

  it("append : rotation par la fin (les arrêts récents sont conservés)", () => {
    const first = appendAgentStopTrace("", "ancienne", { maxChars: 12 });
    const next = appendAgentStopTrace(first, "recente", { maxChars: 12 });
    expect(next.length).toBeLessThanOrEqual(12);
    expect(next).toContain("recente");
    expect(next).not.toContain("ancienne");
  });

  it("append : la double espace des champs est préservée (format du journal)", () => {
    const line = buildAgentStopTraceLine({ reason: "loop-detection", agentId: "codeur", timestamp: "2026-10-20T03:30:00.000Z" });
    const next = appendAgentStopTrace("", line);
    expect(next).toBe(line + "\n");
    expect(next).toContain("Z  op=auto-stop  reason=loop-detection");
  });

  it("append : une ligne vide ne modifie rien", () => {
    expect(appendAgentStopTrace("L1\n", "")).toBe("L1\n");
  });

  it("le plafond par défaut est celui du journal des arrêts", () => {
    expect(AGENT_STOP_TRACE_MAX_CHARS).toBe(256 * 1024);
  });
});

describe("(e) commande d'arrêt automatique (garde de propriété)", () => {
  it("uid connu → stop_agent_process avec expectedUid (garde active)", () => {
    const req = buildAgentStopRequest({ agentId: "codeur", projectPath: "/p/A", uid: 7 });
    expect(req.guarded).toBe(true);
    expect(req.cmd).toBe("stop_agent_process");
    expect(req.args).toEqual({ agentId: "codeur", project: "/p/A", expectedUid: 7 });
  });

  it("uid inconnu / invalide → stop_agent_session (chemin historique)", () => {
    for (const uid of [null, undefined, 0, -1, NaN, "12"]) {
      const req = buildAgentStopRequest({ agentId: "codeur", projectPath: "/p/A", uid });
      expect(req.guarded).toBe(false);
      expect(req.cmd).toBe("stop_agent_session");
      expect(req.args).toEqual({ agentId: "codeur", projectPath: "/p/A" });
    }
  });

  it("uid connu mais agent non identifié → chemin historique", () => {
    const req = buildAgentStopRequest({ projectPath: "/p/A", uid: 7 });
    expect(req.guarded).toBe(false);
    expect(req.cmd).toBe("stop_agent_session");
  });

  it("tolère un agent/projet absents", () => {
    const req = buildAgentStopRequest({});
    expect(req.cmd).toBe("stop_agent_session");
    expect(req.args).toEqual({ agentId: null, projectPath: undefined });
  });
});
