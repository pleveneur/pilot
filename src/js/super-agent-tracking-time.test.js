// Tests unitaires — temps estimé / passé au niveau PROJET dans la vue
// d'ensemble du suivi (Lot A, idée 2, tranche 4c).
//
// `src/js/super-agent.js` est un module à DOM (importe Tauri, markdown-it…)
// impossible à charger dans l'environnement vitest `node` sans jsdom. Les tests
// procèdent donc par LECTURE DE SOURCE, comme les autres tests de câblage du
// dépôt :
//   1. les trois helpers PURS de formatage ajoutés au module sont extraits de
//      la source (accolades appairées) puis évalués pour être exercés
//      RÉELLEMENT (valeurs → chaînes), et non seulement cherchés au texte ;
//   2. le branchement dans `loadSuperTracking` est verrouillé sur la source :
//      lecture des quatre champs, mention conditionnée à la présence, compteurs
//      existants intacts.
//
// Contrat de la tranche 2/4b : la PRÉSENCE d'un temps se lit sur `*_set`, jamais
// sur la valeur (`0` est faux en JavaScript) ; les totaux viennent du serveur et
// l'interface n'additionne jamais rien.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SUPER_AGENT_SRC = readFileSync(new URL("./super-agent.js", import.meta.url), "utf8");

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
  extractFunction(SUPER_AGENT_SRC, "normalizeTrackingMinutes"),
  extractFunction(SUPER_AGENT_SRC, "formatTrackingMinutes"),
  extractFunction(SUPER_AGENT_SRC, "projectTrackingTimeFragment"),
].join("\n");

const { normalizeTrackingMinutes, formatTrackingMinutes, projectTrackingTimeFragment } =
  new Function(
    `${HELPERS_SRC}\nreturn { normalizeTrackingMinutes, formatTrackingMinutes, projectTrackingTimeFragment };`
  )();

// Fenêtre de source de `loadSuperTracking` (de sa déclaration au commentaire qui
// suit la fonction), normalisée pour s'affranchir des retours à la ligne.
function loadSuperTrackingSource() {
  const start = SUPER_AGENT_SRC.indexOf("async function loadSuperTracking(");
  expect(start).toBeGreaterThan(-1);
  const end = SUPER_AGENT_SRC.indexOf("// Recharger le suivi quand l'onglet Assistant devient actif", start);
  expect(end).toBeGreaterThan(start);
  return SUPER_AGENT_SRC.slice(start, end).replace(/\s+/g, " ");
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

describe("loadSuperTracking — branchement de l'affichage", () => {
  it("lit les quatre champs de temps par le helper pur", () => {
    const win = loadSuperTrackingSource();
    expect(win).toContain("projectTrackingTimeFragment(p)");
    // Le helper lit bien les quatre champs (source des helpers).
    for (const field of ["estimated_minutes", "spent_minutes", "estimated_set", "spent_set"]) {
      expect(SUPER_AGENT_SRC).toContain(`p.${field}`);
    }
  });

  it("n'ajoute la mention que si le fragment est non vide", () => {
    const win = loadSuperTrackingSource();
    expect(win).toContain("${time ? `<span class=\"dash-muted super-tracking-project-time\">${escapeHtmlForSuper(time)}</span>` : \"\"}");
  });

  it("ne touche pas aux compteurs existants de la ligne projet", () => {
    const win = loadSuperTrackingSource();
    expect(win).toContain("${p.tasks_en_cours ?? 0} en cours · ${p.tasks_terminees ?? 0} terminées");
    expect(win).toContain('<span class="super-tracking-project-name">');
    expect(win).toContain('<div class="super-tracking-project">');
  });

  it("n'additionne jamais les temps dans la vue d'ensemble", () => {
    const win = loadSuperTrackingSource();
    expect(win).not.toContain("spent_minutes +");
    expect(win).not.toContain("estimated_minutes +");
  });
});
