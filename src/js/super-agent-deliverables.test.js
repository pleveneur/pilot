// Tests unitaires — bloc « Livrable » de la fiche de tâche (Lot A, idée 4,
// tranche 4.4). Deux volets, comme les tranches 3.x de la checklist :
//   1. les fonctions PURES de `super-agent-kanban.js` qui normalisent la réponse
//      des commandes de lecture de la traçabilité (`super_agent_task_deliverable_list`) ;
//   2. le BRANCHEMENT de la fiche (`super-agent-kanban-view.js`), module à DOM et
//      environnement de test `node` (sans jsdom) : vérifié par LECTURE DE SOURCE,
//      méthode déjà employée par `super-agent-checklist.test.js`.
// Aucune règle métier n'est réimplémentée ici : on verrouille le contrat d'appel
// (noms exacts des commandes), le rechargement depuis la base, le texte d'absence
// de livraison, la tolérance à l'erreur et l'ABSENCE de tout chemin d'écriture.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  TASK_DELIVERABLE_LIST_COMMAND,
  PROJECT_DELIVERABLE_LIST_COMMAND,
  DELIVERABLE_ORIGIN_UNKNOWN,
  DELIVERABLE_EMPTY_TEXT,
  DELIVERABLE_ERROR_PREFIX,
  formatDeliverableDate,
  deliverableOriginLabel,
  buildDeliverableLines,
  deliverableCounterLabel,
  buildDeliverableBlock,
  deliverableErrorMessage,
} from "./super-agent-kanban.js";

// Lecture de source INSENSIBLE AUX FINS DE LIGNE : plusieurs ancres ci-dessous
// contiennent un saut de ligne (« if (isEdit) {\n      const »). Avec
// core.autocrlf=true (défaut du git des runners windows-latest), le worktree est
// en CRLF et ces ancres devenaient introuvables — release v0.4.30 bloquée par ce
// seul écart alors que la suite était verte en local. Normaliser ici rend le test
// identique sur les trois plateformes (.gitattributes force aussi LF au worktree).
const readSource = (abs) => readFileSync(abs, "utf8").replace(/\r\n/g, "\n");

// ── 1. Fonctions pures de préparation de l'affichage ────────────────────────

describe("noms EXACTS des commandes de lecture de la traçabilité", () => {
  it("expose les deux commandes du cœur (contrat avec super_agent.rs)", () => {
    expect(TASK_DELIVERABLE_LIST_COMMAND).toBe("super_agent_task_deliverable_list");
    expect(PROJECT_DELIVERABLE_LIST_COMMAND).toBe("super_agent_project_deliverable_list");
  });

  it("les noms sont bien ceux enregistrés côté cœur (#[tauri::command] + handler)", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const root = resolve(here, "../..");
    const coreSrc = readSource(resolve(root, "src-tauri/src/super_agent.rs"));
    expect(coreSrc).toContain(`pub fn ${TASK_DELIVERABLE_LIST_COMMAND}(`);
    expect(coreSrc).toContain(`pub fn ${PROJECT_DELIVERABLE_LIST_COMMAND}(`);
    const libSrc = readSource(resolve(root, "src-tauri/src/lib.rs"));
    expect(libSrc).toContain(`super_agent_task_deliverable_list,`);
    expect(libSrc).toContain(`super_agent_project_deliverable_list,`);
  });
});

describe("formatDeliverableDate", () => {
  it("formate un horodatage SQLite ou ISO en « JJ/MM/AAAA »", () => {
    expect(formatDeliverableDate("2026-10-17 08:05:00")).toBe("17/10/2026");
    expect(formatDeliverableDate("2026-10-17T08:05:00Z")).toBe("17/10/2026");
    expect(formatDeliverableDate("  2026-01-02  ")).toBe("02/01/2026");
  });

  it("n'invente JAMAIS de date : chaîne vide si absent ou illisible", () => {
    for (const raw of [null, undefined, "", "  ", "17/10/2026", "hier", 20261017, {}]) {
      expect(formatDeliverableDate(raw)).toBe("");
    }
  });
});

describe("deliverableOriginLabel — origine ou décision liée", () => {
  it("affiche la décision liée quand elle existe, avec son origine si connue", () => {
    expect(deliverableOriginLabel({ decision_id: 12, origin: "demande #12" })).toBe(
      "Décision #12 : demande #12"
    );
    expect(deliverableOriginLabel({ decision_id: 7, origin: "  arbitrage  " })).toBe(
      "Décision #7 : arbitrage"
    );
    expect(deliverableOriginLabel({ decision_id: 3, origin: "" })).toBe("Décision #3");
    expect(deliverableOriginLabel({ decision_id: 3, origin: null })).toBe("Décision #3");
  });

  it("affiche l'origine textuelle seule quand aucune décision n'est liée", () => {
    expect(deliverableOriginLabel({ decision_id: null, origin: "livraison manuelle" })).toBe(
      "livraison manuelle"
    );
  });

  it("ne répète JAMAIS la mention de repli du cœur (origine inconnue → rien)", () => {
    expect(deliverableOriginLabel({ decision_id: null, origin: DELIVERABLE_ORIGIN_UNKNOWN })).toBe("");
    expect(
      deliverableOriginLabel({ decision_id: 4, origin: DELIVERABLE_ORIGIN_UNKNOWN })
    ).toBe("Décision #4");
    expect(deliverableOriginLabel(null)).toBe("");
    expect(deliverableOriginLabel({})).toBe("");
  });
});

// Lot A idée 4, tranche 4.6 : la mention de repli écrite par le CŒUR
// (« origine non précisée ») est le contrat entre les deux côtés : la constante
// JS doit rester son miroir exact, et une origine inconnue ne doit ni masquer la
// ligne ni faire apparaître un texte inventé à l'écran.
describe("origine non précisée — mention de repli du cœur, jamais inventée à l'écran", () => {
  it("la constante JS est le miroir EXACT du littéral écrit par le cœur", () => {
    expect(DELIVERABLE_ORIGIN_UNKNOWN).toBe("origine non précisée");
    const here = dirname(fileURLToPath(import.meta.url));
    const root = resolve(here, "../..");
    const coreSrc = readSource(resolve(root, "src-tauri/src/super_agent.rs"));
    expect(coreSrc).toContain(
      `const DELIVERABLE_ORIGIN_UNKNOWN: &str = "${DELIVERABLE_ORIGIN_UNKNOWN}";`
    );
  });

  it("la ligne reste AFFICHÉE sans origine (libellé + date), sans texte inventé", () => {
    const block = buildDeliverableBlock({
      deliverables: [
        {
          id: 1,
          label: "Livré sans demande",
          origin: "",
          decision_id: null,
          created_at: "2026-10-17 09:00:00",
        },
        {
          id: 2,
          label: "Origine inconnue du cœur",
          origin: DELIVERABLE_ORIGIN_UNKNOWN,
          decision_id: null,
          created_at: "2026-10-18 09:00:00",
        },
      ],
    });
    // L'origine inconnue ne masque jamais une livraison : les deux lignes
    // restent affichables, avec leur libellé et leur date.
    expect(block.count).toBe(2);
    expect(block.counter).toBe("2 livraisons");
    expect(block.lines.map((l) => l.label)).toEqual([
      "Livré sans demande",
      "Origine inconnue du cœur",
    ]);
    expect(block.lines.map((l) => l.date)).toEqual(["17/10/2026", "18/10/2026"]);
    for (const line of block.lines) {
      // Aucun texte inventé : ni la valeur brute du cœur, ni « null »/« undefined ».
      expect(line.origin).toBe("");
    }
  });
});

describe("buildDeliverableLines — normalisation de la réponse de la base", () => {
  it("CONSERVE l'ordre de la base (du plus ancien au plus récent)", () => {
    const lines = buildDeliverableLines({
      deliverables: [
        { id: 1, label: "Première", origin: "d1", decision_id: 1, created_at: "2026-01-01 10:00:00" },
        { id: 2, label: "Deuxième", origin: DELIVERABLE_ORIGIN_UNKNOWN, decision_id: null, created_at: "2026-02-02 10:00:00" },
      ],
    });
    expect(lines.map((l) => l.id)).toEqual([1, 2]);
    expect(lines.map((l) => l.label)).toEqual(["Première", "Deuxième"]);
    expect(lines[0]).toEqual({
      id: 1,
      label: "Première",
      date: "01/01/2026",
      origin: "Décision #1 : d1",
    });
    expect(lines[1].origin).toBe(""); // mention de repli jamais répétée
  });

  it("tolère les champs manquants et ignore les entrées nulles (aucune ligne inventée)", () => {
    const lines = buildDeliverableLines({
      deliverables: [null, undefined, {}, { label: "  Titre seul  " }],
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ id: null, label: "", date: "", origin: "" });
    expect(lines[1]).toEqual({ id: null, label: "Titre seul", date: "", origin: "" });
  });

  it("renvoie une liste VIDE pour une réponse absente ou sans ligne", () => {
    for (const raw of [null, undefined, {}, { deliverables: null }, { deliverables: [] }, "n/a"]) {
      expect(buildDeliverableLines(raw)).toEqual([]);
    }
  });
});

describe("deliverableCounterLabel / buildDeliverableBlock", () => {
  it("compte les livraisons, au singulier comme au pluriel", () => {
    expect(deliverableCounterLabel(0)).toBe("");
    expect(deliverableCounterLabel(1)).toBe("1 livraison");
    expect(deliverableCounterLabel(2)).toBe("2 livraisons");
    expect(deliverableCounterLabel(3)).toBe("3 livraisons");
    expect(deliverableCounterLabel(null)).toBe("");
    expect(deliverableCounterLabel(undefined)).toBe("");
  });

  it("prépare le bloc : compteur vide et `empty` quand la tâche n'a rien", () => {
    const empty = buildDeliverableBlock({ deliverables: [], count: 0 });
    expect(empty).toEqual({ lines: [], count: 0, counter: "", empty: true });
    expect(buildDeliverableBlock(null).empty).toBe(true);
    expect(DELIVERABLE_EMPTY_TEXT).toBe("Aucune livraison enregistrée");
  });

  it("prépare le bloc d'une tâche livrée (deux passages)", () => {
    const block = buildDeliverableBlock({
      deliverables: [
        { id: 1, label: "T1", origin: DELIVERABLE_ORIGIN_UNKNOWN, decision_id: null, created_at: "2026-10-17 09:00:00" },
        { id: 2, label: "T2", origin: "demande #12", decision_id: 12, created_at: "2026-10-18 09:00:00" },
      ],
      count: 2,
    });
    expect(block.count).toBe(2);
    expect(block.counter).toBe("2 livraisons");
    expect(block.empty).toBe(false);
    expect(block.lines[1].date).toBe("18/10/2026");
  });

  it("le compteur suit les LIGNES relues, jamais le champ `count` de la réponse", () => {
    // Une réponse incohérente (compteur faux) ne peut pas mentir à l'écran :
    // seul le contenu réellement affichable est compté.
    const block = buildDeliverableBlock({ deliverables: [{ id: 1, label: "seule" }], count: 9 });
    expect(block.count).toBe(1);
    expect(block.counter).toBe("1 livraison");
  });
});

describe("deliverableErrorMessage — ligne d'information, jamais d'exception", () => {
  it("rend un message clair, préfixé, à partir de l'erreur du cœur", () => {
    expect(deliverableErrorMessage(new Error("base verrouillée"))).toBe(
      `${DELIVERABLE_ERROR_PREFIX} : base verrouillée`
    );
    expect(deliverableErrorMessage("Tâche 12 introuvable")).toBe(
      `${DELIVERABLE_ERROR_PREFIX} : Tâche 12 introuvable`
    );
  });

  it("retombe sur le seul préfixe sans lever d'exception, quel que soit l'entrant", () => {
    expect(DELIVERABLE_ERROR_PREFIX).toBe("Livraisons indisponibles");
    for (const err of [null, undefined, "", "   ", 0, {}, new Error("")]) {
      const msg = deliverableErrorMessage(err);
      expect(msg.startsWith(DELIVERABLE_ERROR_PREFIX)).toBe(true);
      expect(msg.length).toBeGreaterThan(0);
    }
  });
});

// ── 2. Branchement de la fiche de tâche (lecture de source) ─────────────────
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const viewSrc = readSource(resolve(root, "src/js/super-agent-kanban-view.js"));

/** Tranche de source entre deux ancres (échec explicite si une ancre disparaît). */
function slice(src, from, to) {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  expect(a, `ancre absente : ${from}`).toBeGreaterThan(-1);
  expect(b, `ancre absente : ${to}`).toBeGreaterThan(a);
  return src.slice(a, b);
}

const count = (s, needle) => s.split(needle).length - 1;

describe("fiche de tâche — le bloc « Livrable » lit la base par la commande exacte", () => {
  const render = slice(viewSrc, "async function renderDeliverables(", "const clearDragOver = () =>");

  it("appelle la commande par tâche, avec l'identifiant de la tâche, UNE fois par rendu", () => {
    expect(render).toContain("invoke(TASK_DELIVERABLE_LIST_COMMAND, { taskId })");
    expect(count(render, "invoke(")).toBe(1);
    // Le nom de commande vient de la constante exportée : jamais de littéral
    // recopié (une faute de frappe casserait la lecture en silence).
    expect(viewSrc).not.toContain('"super_agent_task_deliverable_list"');
    expect(count(viewSrc, "TASK_DELIVERABLE_LIST_COMMAND")).toBe(2); // import + appel
  });

  it("remplace TOUJOURS le contenu affiché (aucun état deviné côté écran)", () => {
    expect(count(render, "list.innerHTML =")).toBe(2); // lignes relues, ou ligne d'information
    expect(render).toContain("buildDeliverableBlock(res)");
    expect(render).toContain("count.textContent = counter");
  });

  it("affiche « Aucune livraison enregistrée » plutôt qu'un bloc vide", () => {
    expect(render).toContain("DELIVERABLE_EMPTY_TEXT");
    expect(render).toContain("kanban-deliverables-empty");
  });

  it("affiche libellé, date et origine (ou décision liée) de chaque ligne", () => {
    expect(render).toContain("escapeHtml(l.label)");
    expect(render).toContain("escapeHtml(l.date)");
    expect(render).toContain("l.origin ?");
  });

  it("n'affiche l'origine QUE si elle existe (la mention de repli n'est jamais répétée)", () => {
    // Origine inconnue ⇒ `origin` vaut "" ⇒ aucun segment « · … » n'est ajouté :
    // jamais « origine non précisée », jamais « null »/« undefined » à l'écran.
    expect(render).toContain('${l.origin ? ` · ${escapeHtml(l.origin)}` : ""}');
  });

  it("tolère l'échec de lecture : ligne d'information, aucune exception remontée", () => {
    const catchBranch = slice(render, "} catch (err) {", "\n  }");
    expect(catchBranch).toContain("deliverableErrorMessage(err)");
    expect(catchBranch).toContain("kanban-deliverables-error");
    // Aucun `throw`, aucune relance : la fiche reste utilisable.
    expect(catchBranch).not.toContain("throw");
    expect(catchBranch).not.toContain("invoke(");
    // Le `try` englobe bien la lecture ET le rendu.
    expect(render.indexOf("try {")).toBeLessThan(render.indexOf("} catch (err) {"));
    expect(render.indexOf("invoke(TASK_DELIVERABLE_LIST_COMMAND")).toBeGreaterThan(
      render.indexOf("try {")
    );
  });
});

describe("fiche de tâche — rechargement EN BASE à l'ouverture et après chaque opération", () => {
  const sheet = slice(viewSrc, "    if (isEdit) {\n      const block", "const first = overlay.querySelector");
  const addPoint = slice(sheet, "const addPoint = async () => {", "const addTemplatePoints");
  const addTemplate = slice(sheet, "const addTemplatePoints = async () => {", 'block.addEventListener("click"');
  const clickHandler = slice(sheet, 'block.addEventListener("click", async (e) => {', 'block.addEventListener("keydown"');
  const changeHandler = slice(
    sheet,
    'block.addEventListener("change", async (e) => {',
    "      renderChecklist(block, task.id);\n      reloadDeliverables();\n    }"
  );

  it("relit les livraisons à l'ouverture de la fiche", () => {
    expect(sheet).toContain("const reloadDeliverables = () => renderDeliverables(deliverableBlock, task.id);");
    expect(sheet).toContain("reloadDeliverables();");
  });

  it("relit après CHAQUE opération de la fiche (4 opérations), toujours APRÈS l'écriture", () => {
    for (const [name, op] of [
      ["ajout d'un point", addPoint],
      ["ajout des points du modèle", addTemplate],
      ["suppression d'un point", clickHandler],
      ["coche / décoche d'un point", changeHandler],
    ]) {
      expect(count(op, "await reloadDeliverables();"), `rechargement absent : ${name}`).toBe(1);
      // Le rechargement suit l'opération : jamais avant, donc jamais un état
      // optimiste affiché à la place de la base.
      const written = Math.max(
        op.lastIndexOf("super_agent_task_check_add"),
        op.lastIndexOf("super_agent_task_check_delete"),
        op.lastIndexOf("super_agent_task_check_set_done")
      );
      expect(written, `aucune écriture dans : ${name}`).toBeGreaterThan(-1);
      expect(op.indexOf("await reloadDeliverables();")).toBeGreaterThan(written);
    }
    expect(count(sheet, "await reloadDeliverables();")).toBe(4);
    expect(count(sheet, "reloadDeliverables();")).toBe(5); // 4 opérations + ouverture
  });

  it("la lecture de la checklist n'est pas court-circuitée par le rechargement des livraisons", () => {
    expect(count(sheet, "await renderChecklist(block, task.id);")).toBe(4);
    expect(count(sheet, "renderChecklist(block, task.id);")).toBe(5);
  });
});

describe("fiche de tâche — bloc en LECTURE SEULE (aucun chemin d'écriture)", () => {
  const markup = slice(
    viewSrc,
    '${isEdit ? `<div class="kanban-field kanban-checklist kanban-deliverables">',
    "<div class=\"modal-actions\">"
  );

  it("n'offre AUCUN bouton : seule la lecture est possible", () => {
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("invoke(");
    expect(markup).not.toContain("kanban-deliverables-add");
  });

  it("n'offre aucun champ de saisie non plus : le bloc reste en lecture seule", () => {
    expect(markup).not.toContain("<input");
    expect(markup).not.toContain("<select");
    expect(markup).not.toContain("<textarea");
    expect(markup).not.toContain("contenteditable");
  });

  it("n'existe aucun appel d'écriture des livraisons dans toute la vue", () => {
    expect(viewSrc).not.toMatch(/super_agent_(task|project)_deliverable_(add|delete)/);
    expect(viewSrc).not.toContain("db_execute");
  });

  it("le bloc n'apparaît que sur la fiche d'une tâche EXISTANTE (pas en création)", () => {
    // Le bloc est placé dans la même expression conditionnelle que la checklist.
    expect(markup.startsWith('${isEdit ? `')).toBe(true);
    expect(markup).toContain('</div>` : ""}');
    expect(count(viewSrc, 'class="kanban-field kanban-checklist kanban-deliverables"')).toBe(1);
  });
});

describe("fiche de tâche — la checklist de l'idée 3 n'est pas cassée", () => {
  it("la checklist, son compteur « coché/total » et son verrou restent branchés", () => {
    expect(viewSrc).toContain('class="kanban-checklist-count dash-muted"');
    expect(viewSrc).toContain("checklistCounterLabel(");
    expect(viewSrc).toContain("parseChecklistGate(");
    // Les deux blocs cohabitent : livraisons et checklist gardent chacun leur liste.
    expect(viewSrc).toContain('class="kanban-checklist-list kanban-deliverables-list"');
    expect(viewSrc).toContain('<div class="kanban-checklist-list">');
    // Aucun bouton de checklist n'a été retiré par le bloc livrable.
    expect(viewSrc).toContain("kanban-checklist-add-btn");
    expect(viewSrc).toContain("kanban-check-del");
    expect(viewSrc).toContain("kanban-check-toggle");
  });

  it("le compteur des cartes continue d'être rafraîchi après la fiche", () => {
    const close = slice(viewSrc, "const close = () => {", "overlay.addEventListener(\"click\"");
    expect(close).toContain("applyCheckCounters();");
  });
});
