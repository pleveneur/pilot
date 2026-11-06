// Verrous — cocher une case NOMMÉE, et clôturer DÉLIBÉRÉMENT une tâche.
//
// Demande du propriétaire (2026-11-16) : depuis SA conversation, l'Assistant doit
// pouvoir, avec ses outils habituels (aucun canal parallèle) :
//   1. cocher / décocher un point de checklist DÉSIGNÉ PAR SON LIBELLÉ — un
//      libellé inconnu est REFUSÉ avec un message qui dit ce qui existe, jamais
//      ignoré en silence ;
//   2. terminer une tâche MÊME SI des points restent à cocher — mais jamais en
//      silence : le motif est obligatoire et laisse une trace lisible.
//
// Ces verrous ÉCHOUENT sur le code d'avant (aucun de ces outils/arguments
// n'existait). Les décisions elles-mêmes sont pures et testées côté Rust
// (`super_agent::tests`) ; ici on verrouille le BRANCHEMENT : déclaration des
// outils, cas du dispatcher, arguments transmis, et motif accompagnant toute
// clôture forcée venue de l'écran.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { KANBAN_FORCED_CLOSURE_REASON } from "./super-agent-kanban.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");

/** Lecture de source normalisée (worktree CRLF des runners Windows). */
function read(rel) {
  return readFileSync(resolve(root, rel), "utf8").replace(/\r\n/g, "\n");
}

/** Nombre d'occurrences d'une chaîne (pas de regex : les sources sont du code). */
function count(src, needle) {
  let n = 0;
  let i = src.indexOf(needle);
  while (i !== -1) {
    n += 1;
    i = src.indexOf(needle, i + needle.length);
  }
  return n;
}

/** Tranche de source entre deux ancres (échec explicite si une ancre disparaît). */
function slice(src, from, to) {
  const a = src.indexOf(from);
  const b = from === to ? -1 : src.indexOf(to);
  expect(a, `ancre absente : ${from}`).toBeGreaterThan(-1);
  if (to !== from) {
    expect(b, `ancre absente : ${to}`).toBeGreaterThan(a);
    return src.slice(a, b);
  }
  return src.slice(a, a + 4000);
}

const toolsSrc = read("src-tauri/extensions/pilot-assistant-tools.ts");
const agentSrc = read("src/js/super-agent.js");
const viewSrc = read("src/js/super-agent-kanban-view.js");
const kanbanSrc = read("src/js/super-agent-kanban.js");
const rustSrc = read("src-tauri/src/super_agent.rs");
const libSrc = read("src-tauri/src/lib.rs");

describe("outils de l'Assistant — cocher une case NOMMÉE", () => {
  it("déclare l'outil `set_task_check` (libellé, pas identifiant de case)", () => {
    expect(toolsSrc).toContain('name: "set_task_check"');
    const tool = slice(toolsSrc, 'name: "set_task_check"', 'name: "add_decision"');
    // Le libellé est l'argument central ; `done` optionnel (défaut = cocher).
    expect(tool).toContain("label: Type.String(");
    expect(tool).toContain("done: Type.Optional(");
    expect(tool).toContain("taskId: Type.Number(");
    // L'outil passe par l'UNIQUE canal des outils de l'assistant.
    expect(tool).toContain('TOOLS_SENTINEL + "set_task_check::"');
    // Il ne porte AUCUNE décision : elle vit côté Rust, en un seul endroit.
    expect(tool).not.toContain("toLowerCase()");
    expect(tool).not.toContain("normalize(");
  });

  it("annonce le refus d'un libellé inconnu, sans laisser croire que la case est cochée", () => {
    const tool = slice(toolsSrc, 'name: "set_task_check"', 'name: "add_decision"');
    expect(tool).toContain("refusé");
    expect(tool).toContain("jamais");
    // La consigne de lecture préalable existe (sinon la coche serait aveugle).
    expect(tool).toContain("get_task_checklist");
    // Et l'outil de LECTURE est bien déclaré.
    expect(toolsSrc).toContain('name: "get_task_checklist"');
  });

  it("le dispatcher appelle la commande Rust de résolution par libellé", () => {
    const cases = slice(agentSrc, 'case "update_task_status":', 'case "add_decision":');
    expect(cases).toContain('case "set_task_check":');
    expect(cases).toContain('invoke("super_agent_task_check_set_done_by_label"');
    expect(cases).toContain('label: String(params.label || "")');
    // `done` omis = cocher (jamais « décocher par accident »).
    expect(cases).toContain("done: params.done === false ? false : true");
    expect(cases).toContain('case "get_task_checklist":');
    expect(cases).toContain('invoke("super_agent_task_check_list"');
  });

  it("la commande est enregistrée côté Rust (sinon l'appel échouerait à l'exécution)", () => {
    expect(libSrc).toContain("super_agent::super_agent_task_check_set_done_by_label");
    expect(rustSrc).toContain("pub fn super_agent_task_check_set_done_by_label(");
  });
});

describe("clôture DÉLIBÉRÉMENT forcée — jamais en silence", () => {
  it("l'outil `update_task_status` transmet `force` ET `reason`", () => {
    const tool = slice(toolsSrc, 'name: "update_task_status"', 'name: "get_task_checklist"');
    expect(tool).toContain("force: Type.Optional(");
    expect(tool).toContain("reason: Type.Optional(");
    // La transmission réelle vit dans le dispatcher (point unique du canal).
    expect(agentSrc).toContain("force: params.force === true");
    expect(agentSrc).toContain("reason: params.reason != null ? String(params.reason) : null");
    // Le motif n'est JAMAIS inventé par le dispatcher.
    expect(agentSrc).not.toContain('|| "motif');
  });

  it("le cœur exige un motif AVANT toute écriture (les deux voies de clôture)", () => {
    expect(rustSrc).toContain("fn check_forced_closure_reason(");
    expect(rustSrc).toContain("fn forced_closure_reason_required_message()");
    // Le motif n'est requis que pour une VRAIE clôture forcée : `force` sur un
    // statut qui ne termine rien ne doit pas demander de motif.
    const needs = slice(rustSrc, "fn forced_closure_needs_trace(", "fn forced_closure_reason_required_message(");
    expect(needs).toContain('classify_task_status(new_status) == "done"');

    const statusCmd = slice(
      rustSrc,
      "pub fn super_agent_update_task_status(",
      'Ok(serde_json::json!({ "ok": true, "task_id": task_id, "status": status }))'
    );
    const reasonAt = statusCmd.indexOf("check_forced_closure_reason(");
    const updateAt = statusCmd.indexOf('"UPDATE tasks SET status = ?1');
    expect(reasonAt, "la vérification du motif a disparu").toBeGreaterThan(-1);
    expect(updateAt, "l'écriture a disparu").toBeGreaterThan(-1);
    expect(reasonAt, "le motif doit être vérifié AVANT l'écriture").toBeLessThan(updateAt);
    // La trace passe APRÈS l'écriture réussie (aucune trace d'un échec).
    const traceAt = statusCmd.indexOf("db_record_forced_closure(");
    expect(traceAt).toBeGreaterThan(updateAt);

    const taskCmd = slice(
      rustSrc,
      "pub fn super_agent_update_task(\n",
      "pub fn super_agent_update_task_status("
    );
    expect(taskCmd).toContain("check_forced_closure_reason(pending.len(), force, target");
    expect(taskCmd).toContain("db_record_forced_closure(");
  });

  it("la trace est une phrase LISIBLE : forcée, combien, lesquels, pourquoi", () => {
    const summary = slice(rustSrc, "fn forced_closure_summary(", "fn db_record_forced_closure(");
    expect(summary).toContain("Clôture forcée de la tâche #");
    expect(summary).toContain("point(s) de checklist non cochés");
    expect(summary).toContain("motif :");
    // Écrite dans la table `decisions`, rattachée à la tâche : elle apparaît donc
    // dans l'historique du projet, pas dans un journal obscur.
    const record = slice(rustSrc, "fn db_record_forced_closure(", "pub fn super_agent_update_task_status(");
    expect(record).toContain("INSERT INTO decisions (project_id, task_id, summary)");
    expect(record).toContain("pending.is_empty()");
  });

  it("l'écran fournit TOUJOURS un motif vrai quand il force une clôture", () => {
    expect(KANBAN_FORCED_CLOSURE_REASON.trim()).not.toBe("");
    expect(KANBAN_FORCED_CLOSURE_REASON).toContain("utilisateur");
    expect(kanbanSrc).toContain("export const KANBAN_FORCED_CLOSURE_REASON");
    // Une seule règle : l'écran réutilise cette constante partout où il force
    // (1 import + 3 usages : lot, statut seul, fiche complète).
    expect(count(viewSrc, "KANBAN_FORCED_CLOSURE_REASON")).toBe(4);
    // Aucun `force: true` nu : chaque forçage porte son motif. Les trois sites
    // sont recomptés finement pour ne pas confondre le code avec le commentaire
    // qui cite `force: true` en prose.
    expect(count(viewSrc, "force: true,")).toBe(2);
    expect(count(viewSrc, "force: true })")).toBe(1);
    expect(count(viewSrc, "reason: KANBAN_FORCED_CLOSURE_REASON")).toBe(2);
    expect(viewSrc).toContain("params.reason = KANBAN_FORCED_CLOSURE_REASON;");
  });
});
