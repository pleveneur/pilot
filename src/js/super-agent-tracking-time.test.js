// Tests unitaires — temps estimé / passé au niveau PROJET dans la carte
// « Suivi multi-projets » du Tableau de bord (Lot A, idée 2, tranche 4c).
//
// La vue d'ensemble du suivi a quitté l'onglet Assistant 🧭 : elle vit désormais
// dans la carte « Suivi multi-projets » du Tableau de bord 📊. Les trois helpers
// PURS de formatage ont suivi le déménagement — ils ne sont donc plus lus dans
// `src/js/super-agent.js` mais dans `src/js/dashboard.js`, où ils restent la
// SEULE source de ce formatage (aucune copie, aucun second réglage).
//
// `src/js/dashboard.js` est un module à DOM (importe Tauri, markdown-it…)
// impossible à charger dans l'environnement vitest `node` sans jsdom. Les tests
// procèdent donc par LECTURE DE SOURCE, comme les autres tests de câblage du
// dépôt :
//   1. les trois helpers PURS de formatage sont extraits de la source (accolades
//      appairées) puis évalués pour être exercés RÉELLEMENT (valeurs → chaînes),
//      et non seulement cherchés au texte ;
//   2. le branchement dans la carte du Tableau de bord est verrouillé sur la
//      source : lecture des quatre champs, mention conditionnée à la présence,
//      compteurs existants intacts.
//
// Contrat de la tranche 2/4b : la PRÉSENCE d'un temps se lit sur `*_set`, jamais
// sur la valeur (`0` est faux en JavaScript) ; les totaux viennent du serveur et
// l'interface n'additionne jamais rien.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const DASHBOARD_SRC = readFileSync(new URL("./dashboard.js", import.meta.url), "utf8");

// ── Extraction des helpers purs (lecture de source) ─────────────────────────

/** Extrait le texte complet d'une déclaration `function <name>(…) { … }`. */
function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  expect(start, `déclaration de ${name} introuvable`).toBeGreaterThan(-1);
  let i = src.indexOf("{", start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        break;
      }
    }
  }
  return src.slice(start, i);
}

const HELPERS_SRC = [
  extractFunction(DASHBOARD_SRC, "normalizeTrackingMinutes"),
  extractFunction(DASHBOARD_SRC, "formatTrackingMinutes"),
  extractFunction(DASHBOARD_SRC, "projectTrackingTimeFragment"),
].join("\n");

const { normalizeTrackingMinutes, formatTrackingMinutes, projectTrackingTimeFragment } =
  new Function(
    `${HELPERS_SRC}\nreturn { normalizeTrackingMinutes, formatTrackingMinutes, projectTrackingTimeFragment };`
  )();

// Fenêtre de source du bloc « Suivi multi-projets » de la carte du Tableau de
// bord, normalisée pour s'affranchir des retours à la ligne.
function trackingCardSource() {
  const start = DASHBOARD_SRC.indexOf(
    "// ── Suivi multi-projets (get_super_agent_tracking + get_project_tracking) ──"
  );
  expect(start).toBeGreaterThan(-1);
  const end = DASHBOARD_SRC.indexOf("grid.insertBefore(tr.el, grid.firstChild);", start);
  expect(end).toBeGreaterThan(start);
  return DASHBOARD_SRC.slice(start, end).replace(/\s+/g, " ");
}

// ── Règle 1 : aucune mention quand rien n'est renseigné ─────────────────────

describe("projectTrackingTimeFragment — aucune mention si rien n'est renseigné", () => {
  it("renvoie une chaîne vide quand les deux booléens de présence sont faux", () => {
    expect(
      projectTrackingTimeFragment({
        name: "pilot",
        estimated_minutes: null,
        spent_minutes: null,
        estimated_set: false,
        spent_set: false,
      })
    ).toBe("");
  });

  it("reste muet quand les champs de temps sont absents (anciennes données)", () => {
    expect(projectTrackingTimeFragment({ name: "pilot", tasks_en_cours: 3 })).toBe("");
    expect(projectTrackingTimeFragment({})).toBe("");
    expect(projectTrackingTimeFragment(null)).toBe("");
    expect(projectTrackingTimeFragment(undefined)).toBe("");
  });
});

// ── Règle 2 : présence lue sur les booléens, jamais sur la valeur ───────────

describe("projectTrackingTimeFragment — présence sur `*_set`, jamais sur la valeur", () => {
  it("un zéro RENSEIGNÉ est un temps renseigné : « 0 min »", () => {
    expect(
      projectTrackingTimeFragment({ estimated_minutes: 0, estimated_set: true, spent_set: false })
    ).toBe("0 min prévues");
    expect(
      projectTrackingTimeFragment({ spent_minutes: 0, spent_set: true, estimated_set: false })
    ).toBe("0 min passées");
  });

  it("une valeur NON nulle mais non renseignée n'est jamais affichée", () => {
    expect(
      projectTrackingTimeFragment({ estimated_minutes: 240, spent_minutes: 75, estimated_set: false, spent_set: false })
    ).toBe("");
  });

  it("seul le temps réellement renseigné apparaît", () => {
    expect(
      projectTrackingTimeFragment({ spent_minutes: 135, spent_set: true, estimated_set: false })
    ).toBe("2 h 15 passées");
    expect(
      projectTrackingTimeFragment({ estimated_minutes: 240, estimated_set: true, spent_set: false })
    ).toBe("4 h prévues");
  });

  it("tolère une structure inattendue (fail-open)", () => {
    expect(projectTrackingTimeFragment({ spent_set: "true", spent_minutes: 60 })).toBe("");
  });
});

// ── Règle 3 : formatage des heures et des minutes ───────────────────────────

describe("formatTrackingMinutes — heures et minutes", () => {
  it("en dessous de 60 minutes, affiche « N min »", () => {
    expect(formatTrackingMinutes(45)).toBe("45 min");
    expect(formatTrackingMinutes(0)).toBe("0 min");
    expect(formatTrackingMinutes(59)).toBe("59 min");
  });

  it("à partir de 60 minutes, affiche des heures", () => {
    expect(formatTrackingMinutes(60)).toBe("1 h");
    expect(formatTrackingMinutes(120)).toBe("2 h");
    expect(formatTrackingMinutes(240)).toBe("4 h");
    expect(formatTrackingMinutes(135)).toBe("2 h 15");
    expect(formatTrackingMinutes(125)).toBe("2 h 05");
    expect(formatTrackingMinutes(61)).toBe("1 h 01");
  });

  it("normalise les valeurs douteuses à 0 minute", () => {
    expect(formatTrackingMinutes(null)).toBe("0 min");
    expect(formatTrackingMinutes(undefined)).toBe("0 min");
    expect(formatTrackingMinutes(-5)).toBe("0 min");
    expect(formatTrackingMinutes("abc")).toBe("0 min");
  });

  it("les deux temps renseignés sont séparés, jamais additionnés", () => {
    expect(
      projectTrackingTimeFragment({
        estimated_minutes: 60,
        estimated_set: true,
        spent_minutes: 75,
        spent_set: true,
      })
    ).toBe("1 h 15 passées · 1 h prévues");
    // Le total (135) ne doit apparaître nulle part : aucun calcul côté interface.
    expect(
      projectTrackingTimeFragment({
        estimated_minutes: 60,
        estimated_set: true,
        spent_minutes: 75,
        spent_set: true,
      })
    ).not.toContain("2 h 15");
  });

  it("accorde le participe au singulier (1 minute)", () => {
    expect(projectTrackingTimeFragment({ spent_minutes: 1, spent_set: true, estimated_set: false })).toBe(
      "1 min passée"
    );
    expect(projectTrackingTimeFragment({ estimated_minutes: 1, estimated_set: true, spent_set: false })).toBe(
      "1 min prévue"
    );
  });

  it("normalizeTrackingMinutes ne garde que les entiers positifs", () => {
    expect(normalizeTrackingMinutes(45.4)).toBe(45);
    expect(normalizeTrackingMinutes("90")).toBe(90);
    expect(normalizeTrackingMinutes(Number.NaN)).toBe(0);
  });
});

// ── Règle 4 : branchement dans la vue d'ensemble ────────────────────────────

describe("carte « Suivi multi-projets » du Tableau de bord — branchement", () => {
  it("lit les quatre champs de temps par le helper pur", () => {
    const win = trackingCardSource();
    expect(win).toContain("projectTrackingTimeFragment(tracked)");
    // Le helper lit bien les quatre champs (source des helpers).
    for (const field of ["estimated_minutes", "spent_minutes", "estimated_set", "spent_set"]) {
      expect(DASHBOARD_SRC).toContain(`p.${field}`);
    }
  });

  it("n'ajoute la mention que si le fragment est non vide", () => {
    const win = trackingCardSource();
    expect(win).toContain('(time ? `<span class="dash-tracking-time">⏱ ${time}</span>` : "")');
  });

  it("ne touche pas aux compteurs existants de la ligne projet", () => {
    const win = trackingCardSource();
    // Projet ouvert : mêmes compteurs qu'avant, dans les mêmes cellules.
    expect(win).toContain("`${open.open_tasks || 0}/${open.task_count || 0}`");
    // Projet suivi mais non ouvert : compteurs du suivi de l'assistant.
    expect(win).toContain("`${enCours}/${enCours + terminees}`");
    expect(win).toContain("dash-tracking-name");
    expect(win).toContain("dash-tracking-path");
  });

  it("n'additionne jamais les temps dans la carte de suivi", () => {
    const win = trackingCardSource();
    expect(win).not.toContain("spent_minutes +");
    expect(win).not.toContain("estimated_minutes +");
  });
});
