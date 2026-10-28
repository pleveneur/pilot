// taches-visibles-sans-onglet.test.js — PREUVES que le volet « Tâches » du
// panneau du suivi du travail dit toujours la VÉRITÉ sur « qui travaille en ce
// moment ? », même quand l'onglet 🧭 Assistant n'a jamais été ouvert (ou a été
// fermé).
//
// Contexte (docs/rapports/RAPPORT-taches-invisibles.md, défaut n°1) : la liste
// n'était vivante QUE tant que l'onglet 🧭 existait — abonnement posé dans la
// fabrique de cet onglet, coupé à sa fermeture. Or `.sa-tasks-list` est VIDE
// dans le HTML (aucun message par défaut) : onglet jamais ouvert → volet BLANC ;
// onglet fermé → photo périmée (mission démarrée après jamais affichée, mission
// finie restée « en cours »). Pendant ce temps le compteur du bouton « Travail »
// restait vrai (abonnement permanent) : il pouvait afficher « 1/1 » devant un
// volet vide, ce que le code s'interdit.
//
// Ce fichier échoue si :
//   (i) le démarrage de Pilot (main.js) n'arme plus la surveillance des missions
//       hors de la fabrique de l'onglet 🧭 ;
//   (ii) la fermeture de l'onglet 🧭 recoupe la surveillance (retour de la photo
//        périmée) ;
//   (iii) le rendu cesse d'être conditionné à la visibilité du volet (peinture
//         inutile) — le garde doit rester ;
//   (iv) une mission d'un agent occupé SANS onglet cesse d'être listée ;
//   (v) les deux chemins créent un SECOND abonnement (la surveillance doit être
//       idempotente : un seul abonnement, un seul calcul, un seul rendu).
//
// Aucun navigateur : lecture des sources (fins de ligne normalisées — piège CI
// Windows, cf. quality-gate § 3.4) + fonctions réelles du module.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => ({})) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => "granted"),
  sendNotification: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn(), exit: vi.fn() }));

// `super-agent.js` touche `window`/`document` dès son évaluation : un DOM
// minimal est installé AVANT les imports (`vi.hoisted`), comme dans
// `compteur-taches-travail.test.js`.
vi.hoisted(() => {
  const noop = () => {};
  const el = () => ({
    addEventListener: noop,
    removeEventListener: noop,
    appendChild: noop,
    remove: noop,
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    style: {},
    dataset: {},
    querySelector: () => null,
    querySelectorAll: () => [],
    setAttribute: noop,
    getAttribute: () => null,
    focus: noop,
    scrollIntoView: noop,
    insertAdjacentHTML: noop,
    innerHTML: "",
    textContent: "",
    value: "",
  });
  globalThis.window = globalThis;
  globalThis.addEventListener = noop;
  globalThis.removeEventListener = noop;
  globalThis.dispatchEvent = noop;
  globalThis.document = {
    createElement: el,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    removeEventListener: noop,
    body: el(),
    documentElement: el(),
  };
  globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 0);
  globalThis.cancelAnimationFrame = () => {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop });
});

import { startSuperMissionsWatch } from "./super-agent.js";
import { flattenAgents, buildRunningMissions, splitMissions, renderMissionsPanelHtml } from "./agent-activity.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
/** Lit un fichier du dépôt, fins de ligne normalisées (piège CRLF en CI). */
const lire = (rel) => readFileSync(resolve(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const jsMain = lire("src/js/main.js");
const jsSuper = lire("src/js/super-agent.js");
const html = lire("index.html");

/** Bloc compris entre deux ancres (bornes incluses) ; ancre absente = échec. */
function bloc(text, debut, fin) {
  const i = text.indexOf(debut);
  expect(i, `ancre de début introuvable : ${debut}`).toBeGreaterThan(-1);
  const j = text.indexOf(fin, i + debut.length);
  expect(j, `ancre de fin introuvable : ${fin}`).toBeGreaterThan(i);
  return text.slice(i, j + fin.length);
}

// ════════════════════════════════════════════════════════════════════════════
// (i) Le démarrage de Pilot arme la surveillance, hors de l'onglet 🧭
// ════════════════════════════════════════════════════════════════════════════
describe("(i) main.js arme la surveillance des missions avec l'application", () => {
  it("importe startSuperMissionsWatch du module Assistant", () => {
    expect(jsMain).toMatch(
      /import \{[^}]*startSuperMissionsWatch[^}]*\} from "\.\/super-agent\.js"/
    );
  });

  it("l'appelle APRÈS startTaskCounter, au démarrage (aucun onglet requis)", () => {
    const compteur = jsMain.indexOf("startTaskCounter()");
    const surveillance = jsMain.indexOf("startSuperMissionsWatch()");
    expect(compteur, "startTaskCounter() introuvable dans main.js").toBeGreaterThan(-1);
    expect(surveillance, "startSuperMissionsWatch() absent de main.js").toBeGreaterThan(-1);
    expect(surveillance).toBeGreaterThan(compteur);
    // Le bloc d'appel est le même que celui du compteur : au démarrage, protégé
    // par un try/catch (une surveillance indisponible ne bloque pas le boot).
    expect(jsMain.slice(compteur, surveillance + 40)).toMatch(/startSuperMissionsWatch\(\)/);
  });

  it("l'appel n'est PAS dans la fabrique de l'onglet 🧭 (main.js ignore l'onglet)", () => {
    // main.js ne crée jamais l'onglet Assistant au démarrage (il le fait depuis
    // son bouton) : la surveillance ne doit donc pas dépendre de ce chemin.
    expect(jsMain).not.toMatch(/createSuperAgent\(/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (ii) La fermeture de l'onglet 🧭 ne coupe plus la surveillance
// ════════════════════════════════════════════════════════════════════════════
describe("(ii) fermeture de l'onglet 🧭 : plus aucune coupure de la surveillance", () => {
  it("la fonction d'arrêt a disparu (elle n'était appelée qu'à la fermeture)", () => {
    expect(jsSuper).not.toMatch(/function stopSuperMissionsWatch/);
    expect(jsSuper).not.toMatch(/stopSuperMissionsWatch\(\)/);
  });

  it("le nettoyage de fermeture de l'onglet ne touche pas aux abonnements des missions", () => {
    const fermeture = bloc(jsSuper, "window._pilotSuperAgentOpen = false;", 'window.dispatchEvent(new CustomEvent("pilot-superagent-open-changed"));');
    expect(fermeture).not.toMatch(/superMissionsUnsub/);
    expect(fermeture).not.toMatch(/stopSuperMissionsWatch/);
    expect(fermeture).not.toMatch(/superMissionsPanelUnsub/);
    // Le compteur, lui, est rappelé (idempotent) : le compte ne se fige jamais.
    expect(fermeture).toMatch(/startTaskCounter\(\)/);
  });

  it("la fabrique de l'onglet 🧭 ne pose pas un SECOND écouteur d'onglets", () => {
    // L'abonnement au panneau est posé au démarrage, par startSuperMissionsWatch
    // (idempotent) : la fabrique se contente de l'appeler.
    expect(jsSuper).not.toMatch(/stopPanelTabWatch/);
    expect(jsSuper).not.toMatch(/stopPanelTabWatch = onAgentPanelTabChange/);
  });

  it("le compteur permanent du bouton « Travail » est inchangé", () => {
    const compteur = bloc(jsSuper, "export function startTaskCounter() {", "\n}");
    expect(compteur).toMatch(/if \(taskCounterUnsub\) return false;/);
    expect(compteur).toMatch(/subscribeAgentActivity\(publishSuperMissionsCount\)/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (iii) Le RENDU reste conditionné à la visibilité du volet
// ════════════════════════════════════════════════════════════════════════════
describe("(iii) le rendu ne peint que si le volet « Tâches » est à l'écran", () => {
  it("renderSuperMissions garde le garde de visibilité", () => {
    const rendu = bloc(jsSuper, "function renderSuperMissions() {", "\n}");
    expect(rendu).toMatch(/isAgentPanelPaneVisible\("tasks"\)/);
    expect(rendu).toMatch(/renderMissionsPanelHtml\(missions\)/);
    // Un seul calcul : le rendu consomme le résultat du calcul unique.
    expect(rendu).toMatch(/const missions = publishSuperMissionsCount\(\)/);
    expect(rendu).not.toMatch(/buildRunningMissions\(/);
  });

  it("la surveillance fait un PREMIER rendu (le volet n'est jamais blanc)", () => {
    const veille = bloc(jsSuper, "export function startSuperMissionsWatch() {", "\n}");
    expect(veille).toMatch(/renderSuperMissions\(\)/);
    // L'écouteur d'onglets repeint le volet au moment où il devient visible.
    expect(veille).toMatch(/onAgentPanelTabChange\(onPanelTabChanged\)/);
  });

  it("le conteneur des missions est VIDE dans le HTML : le premier rendu est nécessaire", () => {
    const zone = bloc(html, 'id="agent-activity-pane-tasks"', "</div>");
    expect(zone).toMatch(/class="sa-tasks-list"/);
    expect(zone).not.toMatch(/Aucune mission/);
  });

  it("sans aucune mission, le volet dit « Aucune mission en cours. » (jamais un blanc)", () => {
    // Message produit par le rendu pur, appelé par le premier rendu de la
    // surveillance : c'est ce que l'utilisateur voit à l'ouverture du panneau,
    // que l'onglet 🧭 ait existé ou non.
    expect(renderMissionsPanelHtml([])).toContain("Aucune mission en cours.");
    expect(renderMissionsPanelHtml(buildRunningMissions([], []))).toContain("Aucune mission en cours.");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (iv) Une mission d'un agent occupé SANS onglet reste listée
// ════════════════════════════════════════════════════════════════════════════
describe("(iv) travail en arrière-plan : la mission reste visible", () => {
  const supervision = {
    projects: [
      {
        path: "C:/projets/pilot",
        name: "pilot",
        agents: [
          // Occupé, AUCUN onglet ouvert : doit rester listé (règle 1).
          { agent: "codeur", state: "running", visible: false, prompt: "corrige la liste des taches" },
          // Au repos, sans onglet et processus mort : écarté.
          { agent: "relecteur", state: "idle", visible: false, alive: false, prompt: "relis le diff" },
        ],
      },
    ],
  };

  it("flattenAgents garde l'agent occupé malgré visible:false", () => {
    const list = flattenAgents(supervision, new Map(), new Map());
    expect(list.map((a) => a.label)).toContain("codeur");
    expect(list.map((a) => a.label)).not.toContain("relecteur");
  });

  it("buildRunningMissions liste cette mission en cours (pas en attente)", () => {
    const list = flattenAgents(supervision, new Map(), new Map());
    const missions = buildRunningMissions(list, []);
    expect(missions.length).toBe(1);
    expect(missions[0].waiting).toBe(false);
    expect(missions[0].project).toBeTruthy(); // le projet réel est porté par la ligne
    expect(missions[0].mission.length).toBeGreaterThan(0);
    expect(splitMissions(missions).running.length).toBe(1);
    // Et le volet la peint vraiment.
    expect(renderMissionsPanelHtml(missions)).toContain("En cours (1)");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (v) Un SEUL abonnement : la surveillance est idempotente
// ════════════════════════════════════════════════════════════════════════════
describe("(v) un seul abonnement, même si les deux chemins appellent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Neutralise le DOM du panneau (aucun volet visible) : le rendu doit sortir
    // sans peindre, et le calcul du compte doit rester sans effet.
    globalThis.document.getElementById = () => null;
    globalThis.document.querySelector = () => null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("le premier appel pose l'abonnement, les suivants n'en créent aucun", () => {
    // Démarrage de Pilot (main.js)…
    const premier = startSuperMissionsWatch();
    // …puis ouverture de l'onglet 🧭, et fermeture/réouverture : aucun second.
    const deuxieme = startSuperMissionsWatch();
    const troisieme = startSuperMissionsWatch();
    expect(premier).toBe(true);
    expect(deuxieme).toBe(false);
    expect(troisieme).toBe(false);
  });

  it("les deux abonnements (store + onglets du panneau) sont gardés chacun une fois", () => {
    const veille = bloc(jsSuper, "export function startSuperMissionsWatch() {", "\n}");
    expect(veille).toMatch(/if \(!superMissionsPanelUnsub\) \{\s*\n\s*superMissionsPanelUnsub = onAgentPanelTabChange\(onPanelTabChanged\);/);
    expect(veille).toMatch(/if \(!superMissionsUnsub\) \{\s*\n\s*superMissionsUnsub = subscribeAgentActivity\(renderSuperMissions\);/);
  });
});
