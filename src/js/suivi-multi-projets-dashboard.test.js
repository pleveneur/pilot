// suivi-multi-projets-dashboard.test.js — lot « suivi multi-projets ».
//
// Le suivi PAR CLIENT a quitté l'onglet Assistant 🧭 pour la carte « Suivi
// multi-projets » du Tableau de bord 📊. Ce que ce fichier verrouille :
//   1. la table est alimentée par TOUS les projets suivis (y compris ceux qui ne
//      sont PAS ouverts) et rangée par client, avec un en-tête de groupe ;
//   2. la couleur de cet en-tête est le jeton de thème `--accent-text` (aucune
//      teinte en dur) et le contraste mesuré reste ≥ 4.5:1 en clair ET en sombre ;
//   3. un projet non ouvert garde sa ligne et porte la pastille « non ouvert »
//      (`dash-chip`, le composant des autres statuts) ;
//   4. l'onglet Assistant a bien perdu le bouton, le panneau, le chargeur et le
//      crochet de rechargement — mais le chemin du contexte des tâches
//      DÉLÉGUÉES (qui interroge la même commande) est intact.
//
// Méthode du dépôt : `dashboard.js` est un module à DOM (Tauri, markdown-it),
// donc lecture de source + extraction/évaluation des fonctions PURES pour les
// exercer réellement (comme super-agent-tracking-time.test.js).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

const DASHBOARD = read("src/js/dashboard.js");
const CSS = read("src/css/style.css");
const SUPER = read("src/js/super-agent.js");
const TABS = read("src/js/tabs.js");
const RUST_SUPER = read("src-tauri/src/super_agent.rs");

const flat = (s) => s.replace(/\s+/g, " ");

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

// Les deux fonctions pures du regroupement, extraites puis ÉVALUÉES.
const GROUPING_SRC = [
  extractFunction(DASHBOARD, "trackingPathKey"),
  extractFunction(DASHBOARD, "buildTrackingGroups"),
].join("\n");

const { trackingPathKey, buildTrackingGroups } = new Function(
  `${GROUPING_SRC}\nreturn { trackingPathKey, buildTrackingGroups };`
)();

// Fenêtre de source du bloc « Suivi multi-projets » de la carte.
function trackingCardSource() {
  const start = DASHBOARD.indexOf(
    "// ── Suivi multi-projets (get_super_agent_tracking + get_project_tracking) ──"
  );
  expect(start).toBeGreaterThan(-1);
  const end = DASHBOARD.indexOf("grid.insertBefore(tr.el, grid.firstChild);", start);
  expect(end).toBeGreaterThan(start);
  return flat(DASHBOARD.slice(start, end));
}

// ── 1. En-tête de groupe par client ─────────────────────────────────────────

describe("carte « Suivi multi-projets » — en-tête de groupe par client", () => {
  it("pose un en-tête de groupe AVANT les lignes du client", () => {
    const win = trackingCardSource();
    const head = win.indexOf('groupHead.className = "dash-tracking-client";');
    const firstRow = win.indexOf('row.className = "dash-tracking-row"');
    expect(head).toBeGreaterThan(-1);
    expect(firstRow).toBeGreaterThan(head);
    // Le nom du client est le texte de l'en-tête (jamais un identifiant brut).
    expect(win).toContain("groupHead.textContent = group.client;");
  });

  it("la règle CSS est la recette des autres titres de rubrique du produit", () => {
    const m = CSS.match(/\.dash-tracking-client\s*\{([^}]*)\}/);
    expect(m, "règle .dash-tracking-client introuvable").toBeTruthy();
    const body = m[1];
    // Recette : petites majuscules, graisse 600, espacement léger, padding court.
    expect(body).toContain("text-transform: uppercase");
    expect(body).toContain("font-weight: var(--fw-semibold)");
    expect(body).toContain("letter-spacing: 0.04em");
    expect(body).toContain("font-size: var(--font-xs)");
    expect(body).toContain("padding: 8px 8px 2px");
    // Une seule couleur : le jeton de thème prévu pour l'accent en TEXTE.
    expect(body).toContain("color: var(--accent-text)");
  });

  it("aucune teinte en dur dans la règle de l'en-tête", () => {
    const m = CSS.match(/\.dash-tracking-client\s*\{([^}]*)\}/);
    const body = m[1];
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(body).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/);
    // Aucun repli entre parenthèses sur une couleur littérale : le jeton suffit.
    expect(body).not.toContain("var(--accent,");
  });

  it("le contraste du jeton reste ≥ 4.5:1 en thème clair ET en thème sombre", () => {
    // Valeurs lues dans les DEUX thèmes du fichier de styles : le jeton est
    // défini une seule fois par thème, exactement comme les autres rubriques.
    const accent = [...CSS.matchAll(/--accent-text:\s*(#[0-9a-fA-F]{6});/g)].map((x) => x[1]);
    const surface = [...CSS.matchAll(/--surface-1:\s*(#[0-9a-fA-F]{6});/g)].map((x) => x[1]);
    expect(accent.length).toBeGreaterThanOrEqual(2);
    expect(surface.length).toBeGreaterThanOrEqual(2);
    const lum = (hex) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const f = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const ratio = (a, b) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    // Ordre du fichier : thème sombre puis thème clair.
    expect(ratio(accent[0], surface[0])).toBeGreaterThanOrEqual(4.5); // sombre
    expect(ratio(accent[1], surface[1])).toBeGreaterThanOrEqual(4.5); // clair
  });
});

// ── 2. Tous les projets suivis, groupés par client ──────────────────────────

describe("buildTrackingGroups — tous les projets suivis, par client", () => {
  const clients = [
    {
      name: "Kalico",
      decisions_recentes: ["d1"],
      sessions_recentes: ["s1"],
      projects: [
        { name: "pilot", path: "G:\\IA_PL\\pilot", tasks_en_cours: 3, tasks_terminees: 7 },
        { name: "archive", path: "G:\\IA_PL\\archive", tasks_en_cours: 0, tasks_terminees: 2 },
      ],
    },
    { name: "Autre", decisions_recentes: [], sessions_recentes: [], projects: [] },
  ];
  const open = [
    {
      name: "pilot",
      path: "G:/IA_PL/pilot/",
      client: "Kalico",
      active: true,
      agent_busy: true,
      open_tasks: 3,
      task_count: 10,
      status: "actif",
      last_session: "2026-01-02T10:00:00",
      decisions_recentes: ["dp"],
      sessions_recentes: [],
    },
  ];

  it("garde TOUS les projets suivis, ouverts ou non", () => {
    const groups = buildTrackingGroups(clients, open);
    const all = groups.reduce((acc, g) => acc.concat(g.projects), []);
    expect(all.length).toBe(2);
    expect(all.map((e) => e.name).sort()).toEqual(["archive", "pilot"]);
  });

  it("rapproche le projet ouvert du projet suivi malgré les séparateurs", () => {
    const groups = buildTrackingGroups(clients, open);
    const pilot = groups[0].projects.find((e) => e.name === "pilot");
    expect(pilot.open).toBeTruthy();
    expect(pilot.open.active).toBe(true);
    // Le projet non ouvert est présent, sans ligne riche : `open` reste null.
    const archive = groups[0].projects.find((e) => e.name === "archive");
    expect(archive.open).toBeNull();
    expect(archive.tracked.tasks_en_cours).toBe(0);
  });

  it("conserve l'ordre des clients reçus et leurs décisions/sessions", () => {
    const groups = buildTrackingGroups(clients, open);
    expect(groups.map((g) => g.client)).toEqual(["Kalico"]);
    expect(groups[0].decisions).toEqual(["d1"]);
    expect(groups[0].sessions).toEqual(["s1"]);
    // L'ordre est celui de `get_super_agent_tracking` : le premier client reçu
    // reste le premier groupe affiché.
    expect(groups[0].client).toBe(clients[0].name);
  });

  it("n'oublie pas un projet ouvert inconnu du suivi (groupe « Sans client »)", () => {
    const groups = buildTrackingGroups(clients, [
      { name: "neuf", path: "G:/IA_PL/neuf", client: "", active: false },
    ]);
    const all = groups.reduce((acc, g) => acc.concat(g.projects), []);
    expect(all.map((e) => e.name)).toContain("neuf");
    expect(groups[groups.length - 1].client).toBe("Sans client");
  });

  it("ne rend aucun groupe vide (un client sans projet n'affiche pas d'en-tête)", () => {
    const groups = buildTrackingGroups(clients, open);
    expect(groups.every((g) => g.projects.length > 0)).toBe(true);
    expect(groups.map((g) => g.client)).not.toContain("Autre");
  });

  it("supporte l'absence totale de données (aucun suivi, aucun projet ouvert)", () => {
    expect(buildTrackingGroups([], [])).toEqual([]);
    expect(buildTrackingGroups(undefined, undefined)).toEqual([]);
  });

  it("normalise les chemins (casse, séparateurs, séparateur final)", () => {
    expect(trackingPathKey("G:\\IA_PL\\Pilot\\")).toBe(trackingPathKey("g:/ia_pl/pilot"));
  });
});

// ── 3. Pastille « non ouvert » ──────────────────────────────────────────────

describe("carte « Suivi multi-projets » — pastille « non ouvert »", () => {
  it("réutilise le composant `dash-chip` et écrit « non ouvert »", () => {
    const win = trackingCardSource();
    expect(win).toContain('statusCell.className = "dash-chip";');
    expect(win).toContain(': "non ouvert";');
    // Aucune classe de couleur nouvelle : le statut garde `dash-chip` seul.
    expect(win).not.toMatch(/dash-chip-non-ouvert/);
  });

  it("n'invente aucune activité d'agent pour un projet non ouvert", () => {
    const win = trackingCardSource();
    expect(win).toContain('agentCell.textContent = "—";');
  });

  it("les compteurs d'un projet non ouvert viennent du suivi de l'assistant", () => {
    const win = trackingCardSource();
    expect(win).toContain("const enCours = Number(tracked.tasks_en_cours) || 0;");
    expect(win).toContain("const terminees = Number(tracked.tasks_terminees) || 0;");
    expect(win).toContain("`${enCours}/${enCours + terminees}`");
  });

  it("l'insight annonce le nombre de projets non ouverts", () => {
    const win = trackingCardSource();
    expect(win).toContain("const nonOpenCount = allEntries.filter((e) => !e.open).length;");
    expect(win).toContain("non ouvert(s)");
  });
});

// ── 4. Les deux commandes, sans rien changer côté Rust ─────────────────────

describe("sources de données — deux commandes croisées, Rust inchangé", () => {
  it("le Tableau de bord interroge le suivi complet ET les projets ouverts", () => {
    expect(DASHBOARD).toContain('invoke("get_super_agent_tracking")');
    expect(DASHBOARD).toContain('invoke("get_project_tracking")');
    // La carte est rendue dès qu'il y a un projet suivi, même aucun projet ouvert.
    expect(flat(DASHBOARD)).toContain("if (trackingGroups.length > 0) {");
  });

  it("les deux commandes existent toujours côté cœur (aucune retouche Rust)", () => {
    // Signatures réelles (aucune retouche Rust dans ce lot) : les deux commandes
    // sont asynchrones pour l'une, synchrones pour l'autre.
    expect(RUST_SUPER).toContain("pub async fn get_super_agent_tracking(app: AppHandle)");
    const rustDashboard = read("src-tauri/src/dashboard.rs");
    expect(rustDashboard).toContain(
      "pub fn get_project_tracking(state: State<AppState>, app: AppHandle)"
    );
  });
});

// ── 5. Onglet Assistant : ce qui a disparu… et ce qui reste ────────────────

describe("onglet Assistant — bouton, panneau, chargeur et crochet retirés", () => {
  it("la barre d'outils perd le bouton de suivi et le bouton du mode assistant seul", () => {
    const start = SUPER.indexOf("const toolbar = document.createElement");
    const end = SUPER.indexOf("wrapper.appendChild(toolbar)", start);
    const bar = SUPER.slice(start, end);
    expect(bar).not.toContain('data-action="tracking"');
    // DECISION DU PROPRIETAIRE : le bouton ⛶ (data-action="immersive") faisait
    // double emploi avec le bouton UNIQUE des trois modes, seule entree du mode
    // desormais. Le raccourci Ctrl+Shift+A reste l'acces rapide (il appelle
    // directement enterImmersive, sans passer par un bouton).
    expect(bar).not.toContain('data-action="immersive"');
    for (const action of [
      "abort",
      "new-session",
      "initialize",
      "projects",
      "config",
      "period-report",
      "analyze-data",
    ]) {
      expect(bar).toContain(`data-action="${action}"`);
    }
  });

  it("plus de panneau #super-tracking, de chargeur ni de crochet", () => {
    expect(SUPER).not.toContain('"super-tracking hidden"');
    expect(SUPER).not.toContain("loadSuperTracking");
    expect(TABS).not.toContain("superTrackingRefresh");
    // Le bilan de période garde son panneau (seul rescapé du conteneur).
    expect(SUPER).toContain('"super-tracking super-period-report hidden"');
  });

  it("les règles CSS propres à l'ancien panneau ont disparu", () => {
    for (const cls of [
      "super-tracking-client",
      "super-tracking-projects",
      "super-tracking-project",
      "super-tracking-section",
    ]) {
      expect(CSS).not.toContain(`.${cls}`);
    }
    // La base `.super-tracking` reste : le bilan de période s'en sert.
    expect(CSS).toMatch(/\.super-tracking\s*\{/);
  });

  it("le contexte des tâches DÉLÉGUÉES interroge toujours la même commande", () => {
    const loader = extractFunction(SUPER, "loadDelegationContext");
    expect(loader).toContain('invoke("get_super_agent_tracking")');
    expect(loader).toContain("catch");
  });
});
