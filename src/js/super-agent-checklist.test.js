// Tests unitaires — checklist de livraison VUE DE L'ÉCRAN (Lot A, idée 3, 3.4).
// Ces fonctions pures ne portent AUCUNE règle de mode : elles comptent les
// points relus en base (compteur de carte) et LISENT le verdict rendu par le
// cœur Rust (`guard_task_checklist`) pour savoir s'il faut confirmer (mode
// « rappel », clôture forçable) ou afficher un refus tel quel (mode bloquant).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  CHECKLIST_GATE_PREFIX,
  CHECKLIST_FORCE_HINT,
  checklistProgress,
  checklistCounterLabel,
  parseChecklistGate,
  DEFAULT_CHECKLIST_TEMPLATE,
  DEFAULT_CHECKLIST_TEMPLATE_LINES,
  CHECKLIST_MODES,
  normalizeChecklistMode,
  normalizeChecklistTemplate,
  parseChecklistTemplate,
  shouldOfferTemplatePoints,
} from "./super-agent-kanban.js";

describe("checklistProgress", () => {
  it("compte les points cochés / restants", () => {
    const checks = [
      { id: 1, label: "a", done: true },
      { id: 2, label: "b", done: false },
      { id: 3, label: "c", done: true },
    ];
    expect(checklistProgress(checks)).toEqual({ total: 3, done: 2, remaining: 1 });
  });

  it("renvoie 0/0/0 pour une tâche sans point (aucune régression d'apparence)", () => {
    expect(checklistProgress([])).toEqual({ total: 0, done: 0, remaining: 0 });
    expect(checklistProgress(null)).toEqual({ total: 0, done: 0, remaining: 0 });
    expect(checklistProgress(undefined)).toEqual({ total: 0, done: 0, remaining: 0 });
    expect(checklistProgress("pas une liste")).toEqual({ total: 0, done: 0, remaining: 0 });
  });

  it("ignore les entrées nulles et tolère un champ `done` numérique", () => {
    const checks = [null, { done: 1 }, { done: 0 }, undefined];
    expect(checklistProgress(checks)).toEqual({ total: 2, done: 1, remaining: 1 });
    expect(checklistCounterLabel(checks)).toBe("1/2");
    expect(checklistProgress([null, undefined])).toEqual({ total: 0, done: 0, remaining: 0 });
  });
});

describe("checklistCounterLabel", () => {
  it("formate le compteur « coché/total » d'une carte", () => {
    expect(checklistCounterLabel([{ done: true }, { done: false }, { done: false }])).toBe("1/3");
    expect(checklistCounterLabel([{ done: true }, { done: true }])).toBe("2/2");
    // Cas de référence de la tranche 3.6 : deux points sur trois cochés.
    expect(checklistCounterLabel([{ done: true }, { done: true }, { done: false }])).toBe("2/3");
    expect(checklistCounterLabel([{ done: false }, { done: true }, { done: true }])).toBe("2/3");
  });

  it("n'affiche RIEN (chaîne vide) quand la tâche n'a aucun point", () => {
    expect(checklistCounterLabel([])).toBe("");
    expect(checklistCounterLabel(null)).toBe("");
    expect(checklistCounterLabel(undefined)).toBe("");
    // Les tâches existantes (aucun point) gardent donc exactement leur apparence.
  });
});

describe("parseChecklistGate — lecture du verdict du cœur", () => {
  // Messages produits par `checklist_gate_message` (super_agent.rs).
  const WARN_MESSAGE =
    "Checklist de livraison : 2 point(s) restent à cocher avant de terminer la tâche : " +
    "tests passés, doc mise à jour. Relance avec force = true pour conclure malgré tout.";
  const BLOCK_MESSAGE =
    "Checklist de livraison : 1 point(s) restent à cocher avant de terminer la tâche : tests passés.";

  it("mode « rappel » → confirmation requise (relance forçable une fois)", () => {
    const verdict = parseChecklistGate(WARN_MESSAGE);
    expect(verdict.gate).toBe(true);
    expect(verdict.needsConfirmation).toBe(true);
    expect(verdict.refused).toBe(false);
    expect(verdict.remaining).toBe(2);
    expect(verdict.message).toBe(WARN_MESSAGE);
  });

  it("mode « bloquant » → refus sec, sans phrase de forçage (aucune relance)", () => {
    const verdict = parseChecklistGate(BLOCK_MESSAGE);
    expect(verdict.gate).toBe(true);
    expect(verdict.needsConfirmation).toBe(false);
    expect(verdict.refused).toBe(true);
    expect(verdict.remaining).toBe(1);
  });

  it("lit le nombre de points restants même avec « … et N autre(s) »", () => {
    const verdict = parseChecklistGate(
      "Checklist de livraison : 8 point(s) restent à cocher avant de terminer la tâche : " +
        "a, b, c, d, e. Relance avec force = true pour conclure malgré tout."
    );
    expect(verdict.remaining).toBe(8);
    expect(verdict.needsConfirmation).toBe(true);
  });

  it("reconnaît une erreur du cœur transmise comme objet Error", () => {
    const verdict = parseChecklistGate(new Error(WARN_MESSAGE));
    expect(verdict.gate).toBe(true);
    expect(verdict.needsConfirmation).toBe(true);
  });

  it("garde `gate: false` pour une erreur étrangère (message journalisé tel quel)", () => {
    for (const err of ["Tâche 12 introuvable", null, undefined, "", new Error("Erreur de base")]) {
      const verdict = parseChecklistGate(err);
      expect(verdict.gate).toBe(false);
      expect(verdict.needsConfirmation).toBe(false);
      expect(verdict.refused).toBe(false);
      expect(verdict.remaining).toBe(0);
    }
  });

  it("expose des marqueurs alignés sur le message du cœur (miroir Rust)", () => {
    expect(WARN_MESSAGE.includes(CHECKLIST_GATE_PREFIX)).toBe(true);
    expect(WARN_MESSAGE.includes(CHECKLIST_FORCE_HINT)).toBe(true);
    expect(BLOCK_MESSAGE.includes(CHECKLIST_GATE_PREFIX)).toBe(true);
    expect(BLOCK_MESSAGE.includes(CHECKLIST_FORCE_HINT)).toBe(false);
  });
});

// ── Tranche 3.5 : réglages (mode + modèle de points) ────────────────────────

describe("normalizeChecklistMode — lecture du mode de contrôle", () => {
  it("reconnaît les trois modes, quel que soit la casse ou les espaces", () => {
    expect(normalizeChecklistMode("off")).toBe("off");
    expect(normalizeChecklistMode("  OFF ")).toBe("off");
    expect(normalizeChecklistMode("warn")).toBe("warn");
    expect(normalizeChecklistMode("Block")).toBe("block");
  });

  it("retombe sur « rappel simple » (défaut) pour un mode absent ou inconnu", () => {
    // Même repli que `checklist_mode_from_config` (super_agent.rs) : jamais
    // bloquant par surprise, jamais silencieusement désactivé.
    for (const raw of [undefined, null, "", "   ", "strict", "true", 0, {}]) {
      expect(normalizeChecklistMode(raw)).toBe("warn");
    }
    expect(CHECKLIST_MODES).toEqual(["off", "warn", "block"]);
  });
});

describe("normalizeChecklistTemplate / parseChecklistTemplate — modèle de points", () => {
  it("fournit le modèle par défaut quand le champ est absent ou vide", () => {
    expect(DEFAULT_CHECKLIST_TEMPLATE_LINES).toEqual([
      "Tests passés",
      "Documentation à jour",
      "Rien de non commité",
    ]);
    for (const raw of [undefined, null, "", "   ", "\n\n"]) {
      expect(normalizeChecklistTemplate(raw)).toBe(DEFAULT_CHECKLIST_TEMPLATE);
      expect(parseChecklistTemplate(raw)).toEqual(DEFAULT_CHECKLIST_TEMPLATE_LINES);
    }
  });

  it("garde le modèle saisi (espaces de bord retirés) sans le remplacer", () => {
    expect(normalizeChecklistTemplate("  Un point\nDeux  ")).toBe("Un point\nDeux");
  });

  it("découpe une ligne non vide par point, tolère les blancs et \\r\\n", () => {
    expect(parseChecklistTemplate("Tests passés\n\n  Documentation à jour  \r\nRien de non commité\n")).toEqual([
      "Tests passés",
      "Documentation à jour",
      "Rien de non commité",
    ]);
    expect(parseChecklistTemplate("seul")).toEqual(["seul"]);
  });

  it("retombe sur le défaut quand le modèle ne contient QUE des lignes vides", () => {
    for (const raw of ["\n", "  \n\t\n ", "\r\n\r\n", "  \r\n   "]) {
      expect(parseChecklistTemplate(raw)).toEqual(DEFAULT_CHECKLIST_TEMPLATE_LINES);
    }
  });

  it("ne touche pas aux espaces INTERNES ni à l'ordre des points", () => {
    expect(parseChecklistTemplate("  Tests unitaires passés  \r\n  Doc   à jour  ")).toEqual([
      "Tests unitaires passés",
      "Doc   à jour",
    ]);
  });
});

describe("shouldOfferTemplatePoints — proposition JAMAIS imposée", () => {
  it("propose les points du modèle sur une tâche sans point, sauf si désactivé", () => {
    expect(shouldOfferTemplatePoints([], "warn")).toBe(true);
    expect(shouldOfferTemplatePoints([], "block")).toBe(true);
    expect(shouldOfferTemplatePoints([], undefined)).toBe(true); // mode absent → défaut « rappel »
    expect(shouldOfferTemplatePoints([], "off")).toBe(false);
    expect(shouldOfferTemplatePoints(null, "warn")).toBe(true);
  });

  it("ne propose RIEN quand la tâche a déjà des points (aucun changement)", () => {
    for (const mode of CHECKLIST_MODES) {
      expect(shouldOfferTemplatePoints([{ done: false }], mode)).toBe(false);
      expect(shouldOfferTemplatePoints([{ done: true }], mode)).toBe(false);
    }
  });
});

// ── Tranche 3.6 : les trois modes, jugés de bout en bout ────────────────
// Ce qui précède décide et LIT le verdict ; ce qui suit verrouille le
// COMPORTEMENT attendu de chaque mode :
//   - « rappel »    : une confirmation, puis UNE SEULE relance avec `force: true` ;
//   - « bloquant »  : le refus du cœur est montré tel quel, JAMAIS relancé ;
//   - « désactivé » : le cœur n'émet aucun message, donc rien ne freine ;
//   - tâche sans point : aucun message non plus (aucune régression).

describe("les trois modes — l'action attendue pour chaque verdict du cœur", () => {
  // Messages produits par `checklist_gate_message` (super_agent.rs), tels que
  // les trois modes les émettent réellement.
  const warnMsg = (n) =>
    `Checklist de livraison : ${n} point(s) restent à cocher avant de terminer la tâche : ` +
    "tests passés. Relance avec force = true pour conclure malgré tout.";
  const blockMsg = (n) =>
    `Checklist de livraison : ${n} point(s) restent à cocher avant de terminer la tâche : ` +
    "tests passés.";

  it("mode « rappel » → UNE confirmation, puis une relance possible avec force", () => {
    const v = parseChecklistGate(new Error(warnMsg(2)));
    expect({ gate: v.gate, needsConfirmation: v.needsConfirmation, refused: v.refused }).toEqual({
      gate: true,
      needsConfirmation: true,
      refused: false,
    });
    expect(v.remaining).toBe(2);
  });

  it("mode « bloquant » → refus sec : rien à relancer, forcer n'y changerait rien", () => {
    const v = parseChecklistGate(new Error(blockMsg(1)));
    expect({ needsConfirmation: v.needsConfirmation, refused: v.refused }).toEqual({
      needsConfirmation: false,
      refused: true,
    });
    // Le message du mode bloquant ne contient AUCUNE invitation à forcer :
    // c'est le signal même que la relance serait inutile (miroir du cœur).
    expect(v.message).not.toContain(CHECKLIST_FORCE_HINT);
  });

  it("mode « désactivé » et tâche sans point → AUCUN message, donc aucune relance", () => {
    // Le cœur autorise la clôture sans un mot (`evaluate_checklist_gate` →
    // Allowed) : aucune erreur n'est levée, donc le verdict reste vide.
    for (const nothing of [null, undefined, ""]) {
      const v = parseChecklistGate(nothing);
      expect(v.gate).toBe(false);
      expect(v.needsConfirmation).toBe(false);
      expect(v.refused).toBe(false);
    }
    // Une tâche sans point ne peut même pas produire le préfixe du contrôle :
    // une erreur étrangère n'est jamais prise pour un verdict.
    expect(parseChecklistGate(new Error("Tâche 7 introuvable")).gate).toBe(false);
  });

  it("un verdict n'est JAMAIS à la fois « confirmer » et « refusé »", () => {
    for (const err of [new Error(warnMsg(1)), new Error(warnMsg(9)), new Error(blockMsg(3))]) {
      const v = parseChecklistGate(err);
      expect(v.gate).toBe(true);
      expect(v.needsConfirmation !== v.refused).toBe(true);
    }
  });
});

// ── Tranche 3.6 : branchement de la vue Kanban sur le verdict ──────────────
// `super-agent-kanban-view.js` est un module à DOM (fermeture
// `createSuperKanban`) et l'environnement de test du projet est `node`
// (vitest.config.js, sans jsdom) : le BRANCHEMENT est donc vérifié par lecture
// de source — méthode déjà employée par les tests de vue du projet
// (settings-checklist-reglages.test.js). Ce qui est vérifié ici est le contrat
// du flux (une confirmation, une seule relance), pas une règle de mode : la vue
// ne réimplémente aucun mode.
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const viewSrc = readFileSync(resolve(root, "src/js/super-agent-kanban-view.js"), "utf8");

/** Tranche de source entre deux ancres (échec explicite si une ancre disparaît). */
function slice(src, from, to) {
  const a = src.indexOf(from);
  const b = src.indexOf(to);
  expect(a, `ancre absente : ${from}`).toBeGreaterThan(-1);
  expect(b, `ancre absente : ${to}`).toBeGreaterThan(a);
  return src.slice(a, b);
}

const count = (s, needle) => s.split(needle).length - 1;

describe("vue Kanban — une confirmation puis UNE SEULE relance (mode rappel)", () => {
  const handleGate = slice(
    viewSrc,
    "async function handleChecklistGate(",
    "function updateTaskStatusWithGate("
  );
  const warnBranch = slice(handleGate, "if (verdict.needsConfirmation) {", "if (verdict.refused) {");
  const refuseBranch = slice(
    handleGate,
    "if (verdict.refused) {",
    'console.error("Erreur changement de statut de tâche'
  );

  it("décide sur le verdict PUR, sans relire ni réécrire le mode", () => {
    expect(handleGate).toContain("parseChecklistGate(err)");
    // Aucune règle de mode réécrite dans la vue : ni les chaînes de mode, ni un
    // accès au réglage `super_agent_checklist_mode`.
    expect(handleGate).not.toMatch(/["'`](off|warn|block)["'`]/);
    expect(handleGate).not.toContain("super_agent_checklist_mode");
  });

  it("mode rappel : exactement UNE confirmation et UNE relance, forcée", () => {
    expect(count(warnBranch, "openKanbanConfirm(")).toBe(1);
    expect(count(warnBranch, "retryWithForce(")).toBe(1);
    // Un refus de confirmer n'écrit rien et ne relance pas.
    expect(warnBranch).toContain("if (!ok) return false;");
  });

  it("mode bloquant : le refus est montré tel quel et JAMAIS relancé", () => {
    expect(refuseBranch).toContain('showKanbanNotice("Clôture refusée"');
    expect(refuseBranch).not.toContain("retryWithForce");
    expect(refuseBranch).not.toContain("openKanbanConfirm");
    expect(refuseBranch).toContain("return false;");
    // Aucune mention de `force` dans la branche de refus.
    expect(refuseBranch).not.toContain("force");
  });

  it("l'erreur étrangère (hors contrôle) n'ouvre aucune boîte de dialogue", () => {
    expect(handleGate).toContain('console.error("Erreur changement de statut de tâche :", err);');
  });
});

describe("vue Kanban — les deux écritures unitaires passent par le même flux", () => {
  it("statut seul : la relance forcée est la SEULE écriture supplémentaire", () => {
    const w = slice(viewSrc, "function updateTaskStatusWithGate(", "function updateTaskWithGate(");
    expect(count(w, 'invoke("super_agent_update_task_status"')).toBe(2);
    expect(count(w, "force: true")).toBe(1);
    // Le chemin nominal (succès) ne déclenche jamais le flux de contrôle :
    // seul le REJET de `invoke` y entre.
    expect(w).toMatch(/\.then\(\s*\(\) => true,\s*\(err\) =>/);
  });

  it("fiche complète : la relance forcée réutilise les MÊMES paramètres", () => {
    const w = slice(viewSrc, "function updateTaskWithGate(", "Compteurs de checklist des cartes");
    expect(count(w, 'invoke("super_agent_update_task"')).toBe(2);
    expect(w).toContain('invoke("super_agent_update_task", { ...params, force: true })');
  });
});

describe("vue Kanban — clôture en LOT : une confirmation, puis une relance par tâche", () => {
  const bulk = slice(viewSrc, "async function confirmAndCloseSelection(", "/** Rétablit le statut précédent");

  it("ne relance QUE les tâches que le cœur a marquées « confirmation requise »", () => {
    // Le lot sépare les deux verdicts : relance des unes, affichage des autres.
    expect(bulk).toContain("needsForce.push({ change: c, message: verdict.message })");
    expect(bulk).toContain("else if (verdict.refused) refused.push(verdict.message);");
    // Le forçage n'existe qu'à UN SEUL endroit : la boucle de relance du lot,
    // et seulement APRÈS la confirmation (donc jamais sans clic de l'utilisateur).
    expect(count(bulk, "force: true")).toBe(1);
    const forced = bulk.indexOf("force: true");
    const gate = bulk.indexOf("const ok = await openKanbanConfirm({");
    expect(gate).toBeGreaterThan(-1);
    expect(forced).toBeGreaterThan(gate);
  });

  it("mode bloquant : les refus sont affichés ensemble, sans aucune relance", () => {
    expect(bulk).toContain('await showKanbanNotice("Clôture refusée", refused.join(" "));');
    // La boucle de relance ne concerne QUE `needsForce`.
    expect(bulk).toContain("for (const { change } of needsForce) {");
  });

  it("une confirmation refusée n'écrit RIEN (aucune relance silencieuse)", () => {
    expect(bulk).toContain("if (ok) {");
    expect(bulk).toContain("if (!decision.applied) return;");
  });
});
