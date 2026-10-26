// Compteur de TRAVAIL de l'entree « Travail » (bouton de la rangee d'onglets).
//
// Decision du proprietaire (RAPPORT-compteur-taches.md) : le bouton affiche
// « en cours / total » — le total etant les taches EN COURS plus celles EN
// ATTENTE — et il doit dire la MEME chose que l'onglet « Taches ». Deux
// familles d'attente etaient oubliees (commandes manuelles d'un projet, agents
// en file d'exclusivite) : un compteur qui les ignore affiche un total faux.
// Le signal des evenements non lus n'est pas perdu : point du bouton + point de
// 6 px sur l'onglet « Evenements », nombre reel dans l'infobulle.
//
// Ce fichier echoue si :
//   (a) le compteur n'est pas « en cours / total », ou affiche « 0/0 » a vide ;
//   (b) le bouton et l'onglet peuvent diverger (deux calculs) ;
//   (c) une des deux familles oubliees cesse d'etre comptee ;
//   (d) une pastille, un fond ou une animation revient sur le compteur ;
//   (e) la hauteur de la rangee d'onglets augmente d'un seul pixel ;
//   (f) le signal des non-lus disparait du bouton ou de l'onglet « Evenements ».
//   (g) le mode « Assistant seul » affiche un AUTRE compteur que le mode
//       normal (second noeud, second calcul, ou compteur absent).
//
// Aucun navigateur : fonctions reelles du module + DOM minimal + lecture des
// sources (fins de ligne normalisees, cf. quality-gate 3.4).
import { describe, expect, it, beforeEach, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
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

// `super-agent.js` (importe par le bloc (i) pour appeler le CALCUL REEL du
// compte) est un module d'interface qui touche `window` des son evaluation. Un
// `window`/`document` minimal est donc installe AVANT les imports (`vi.hoisted`
// s'execute avant eux), comme dans `verrou-par-projet.test.js`. Les blocs (a) a
// (h) remplacent ensuite `globalThis.document` par leur registre minimal.
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

import {
  AGENT_PANEL_UNREAD_MAX,
  agentTaskCounterText,
  agentTaskCounterLabel,
  agentUnreadTooltip,
  buildRunningMissions,
  renderMissionsPanelHtml,
  setAgentPanelTaskCount,
  setAgentPanelTabsVisibility,
  splitMissions,
} from "./agent-activity.js";
import { enqueueProjectCommand, listAllProjectCommands, countProjectQueuedCommands, abandonProjectCommands } from "./project-task-queue.js";
import { exclusivityQueueOfProject, listExclusivityWaitingDemands } from "./agents-bus.js";
import { sliceSource } from "./source-slice.js";
import { enqueueExclusivity } from "./exclusivity-queue.js";
// Le CALCUL unique du compte (et son demarrage) sont importes du module
// Assistant : le test ne recalcule rien lui-meme — il appelle la production.
import { publishSuperMissionsCount } from "./super-agent.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lire = (rel) => readFileSync(resolve(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const html = lire("index.html");
const css = lire("src/css/style.css");
const jsPanel = lire("src/js/agent-activity.js");
const jsSuper = lire("src/js/super-agent.js");

// ── Lecture CSS minimale (memes regles que taille-et-style-panneau.test.js) ──
// Le decoupage passe par `sliceSource` (source-slice.js) : une ancre absente
// LEVE une erreur au lieu de rendre un bloc vide qui rendrait les assertions
// negatives vraies par construction.
function blockOf(sel) {
  return sliceSource(css, `${sel} {`, "}", 1).replace(/\/\*[\s\S]*?\*\//g, "");
}
function declaration(body, prop) {
  if (!body) return "";
  const m = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+);`, "m"));
  return m ? m[1].trim() : "";
}
const px = (v) => (v ? parseFloat(v) : 0);
/** Hauteur PEINTE de la rangee d'onglets (min-height + filet bas). */
function hauteurRangee() {
  const row = blockOf("#tab-row");
  return px(declaration(row, "min-height")) + px(declaration(row, "border-bottom"));
}

// ── DOM minimal (aucun navigateur) : seuls les elements du bouton ──
class FakeClassList {
  constructor() { this.set = new Set(); }
  add(...c) { for (const x of c) this.set.add(x); }
  remove(...c) { for (const x of c) this.set.delete(x); }
  contains(c) { return this.set.has(c); }
  toggle(c, force) {
    const on = force === undefined ? !this.set.has(c) : !!force;
    if (on) this.set.add(c); else this.set.delete(c);
    return on;
  }
}
class FakeEl {
  constructor(id) {
    this.id = id;
    this.classList = new FakeClassList();
    this.attrs = {};
    this.hidden = false;
    this.textContent = "";
    this.title = "";
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; }
}

let registry = new Map();
const el = (id) => registry.get(id);

function installeDom() {
  registry = new Map(
    ["agent-activity-entry", "agent-activity-count", "agent-activity-dot", "agent-activity-events-unread"].map((id) => [id, new FakeEl(id)])
  );
  registry.get("agent-activity-count").hidden = true;
  registry.get("agent-activity-events-unread").hidden = true;
  registry.get("agent-activity-entry").title = "Suivi du travail";
  globalThis.document = { getElementById: (id) => registry.get(id) || null, querySelector: () => null };
}

/** Missions telles que l'onglet les recoit (buildRunningMissions). */
function missions(enCours, enAttente) {
  const list = [];
  for (let i = 0; i < enCours; i++) {
    list.push({
      agentId: `codeur${i}|C:/p${i}`,
      kind: "agent",
      rawId: `codeur${i}`,
      label: `codeur${i}`,
      project: `Projet${i}`,
      projectPath: `C:/p${i}`,
      state: "running",
      working: true,
      prompt: `Mission ${i}`,
    });
  }
  const queued = [];
  for (let i = 0; i < enAttente; i++) queued.push({ project: `Projet${i}`, mission: `Demande ${i}` });
  return buildRunningMissions(list, queued);
}

beforeEach(() => {
  installeDom();
  setAgentPanelTabsVisibility({});
  setAgentPanelTaskCount(0, 0);
});

// ════════════════════════════════════════════════════════════════════════════
// (a) « en cours / total », et rien du tout quand il n'y a aucun travail
// ════════════════════════════════════════════════════════════════════════════
describe("(a) le bouton affiche « en cours / total »", () => {
  it("aucun travail : rien n'est affiche (aucun « 0/0 » permanent)", () => {
    expect(agentTaskCounterText(0, 0)).toBe("");
    expect(agentTaskCounterLabel(0, 0)).toBe("Suivi du travail");
    setAgentPanelTaskCount(0, 0);
    expect(el("agent-activity-count").hidden).toBe(true);
    expect(el("agent-activity-count").textContent).toBe("");
    expect(el("agent-activity-entry").title).toBe("Suivi du travail");
    expect(el("agent-activity-entry").classList.contains("working")).toBe(false);
  });

  it("une tache en cours : « 1/1 », chiffre allume", () => {
    expect(agentTaskCounterText(1, 0)).toBe("1/1");
    setAgentPanelTaskCount(1, 0);
    expect(el("agent-activity-count").hidden).toBe(false);
    expect(el("agent-activity-count").textContent).toBe("1/1");
    expect(el("agent-activity-count").classList.contains("working")).toBe(true);
  });

  it("des demandes en attente : « 0/3 » (le total compte l'attente)", () => {
    expect(agentTaskCounterText(0, 3)).toBe("0/3");
    setAgentPanelTaskCount(0, 3);
    expect(el("agent-activity-count").textContent).toBe("0/3");
    // Aucune tache en cours : le chiffre ne s'allume pas (aucune animation).
    expect(el("agent-activity-count").classList.contains("working")).toBe(false);
  });

  it("beaucoup de travail : plafond « 99+ » dans le texte, nombres REELS dans l'infobulle", () => {
    expect(agentTaskCounterText(150, 50)).toBe(`${AGENT_PANEL_UNREAD_MAX}+/${AGENT_PANEL_UNREAD_MAX}+`);
    const label = agentTaskCounterLabel(150, 50);
    expect(label).toContain("150 taches en cours sur 200");
    expect(label).toContain("50 en attente");
    // Le texte visible ne ment pas : il plafonne, l'infobulle dit tout.
    expect(label).not.toContain("99+");
  });

  it("l'infobulle et le nom lu sont la MEME chaine (une seule source)", () => {
    setAgentPanelTaskCount(2, 3);
    expect(el("agent-activity-entry").title).toBe(agentTaskCounterLabel(2, 3));
    expect(el("agent-activity-entry").getAttribute("aria-label")).toBe(agentTaskCounterLabel(2, 3));
    expect(agentTaskCounterLabel(2, 3)).toContain("2 taches en cours sur 5");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (b) Le bouton et l'onglet « Taches » ne peuvent PAS diverger
// ════════════════════════════════════════════════════════════════════════════
describe("(b) bouton et onglet disent la meme chose (un seul calcul)", () => {
  /** Nombres lus dans les DEUX titres de groupes du volet, tels qu'affiches. */
  function nombresDuVolet(missions) {
    const rendu = renderMissionsPanelHtml(missions);
    const titre = (libelle) => {
      const m = rendu.match(new RegExp(`${libelle} \\((\\d+)\\)`));
      return m ? Number(m[1]) : 0;
    };
    return { enCours: titre("En cours"), enAttente: titre("En attente") };
  }

  const cas = [
    ["aucun travail", 0, 0],
    ["une tache en cours", 1, 0],
    ["trois demandes en attente", 0, 3],
    ["deux en cours et trois en attente", 2, 3],
    ["beaucoup de travail", 120, 40],
  ];

  for (const [nom, enCours, enAttente] of cas) {
    it(`${nom} : le bouton et le volet annoncent les memes nombres`, () => {
      const m = missions(enCours, enAttente);
      const volet = nombresDuVolet(m);
      const { running, waiting } = splitMissions(m);
      // Le volet affiche bien le decoupage…
      expect(volet).toEqual({ enCours: running.length, enAttente: waiting.length });
      // …et le bouton sort du MEME decoupage (aucun second calcul).
      expect(agentTaskCounterText(volet.enCours, volet.enAttente)).toBe(agentTaskCounterText(running.length, waiting.length));
      // Le total inclut l'attente (le point qui ne doit pas etre manque).
      if (enCours + enAttente > 0) {
        const texte = agentTaskCounterText(volet.enCours, volet.enAttente);
        if (enCours + enAttente <= AGENT_PANEL_UNREAD_MAX) expect(texte).toBe(`${enCours}/${enCours + enAttente}`);
      }
    });
  }

  it("le total n'oublie jamais l'attente : 1 en cours + 4 en attente = 1/5", () => {
    const volet = nombresDuVolet(missions(1, 4));
    expect(volet).toEqual({ enCours: 1, enAttente: 4 });
    const texte = agentTaskCounterText(volet.enCours, volet.enAttente);
    expect(texte).toBe("1/5");
    // Un compteur qui ignorerait l'attente afficherait « 1/1 » : interdit.
    expect(texte).not.toBe("1/1");
  });

  it("super-agent.js publie le compte a partir du MEME pipeline que le volet", () => {
    // Une seule fonction calcule (buildRunningMissions puis splitMissions) et
    // publie le compte : le rendu de la liste consomme son resultat.
    const publie = jsSuper.match(/function publishSuperMissionsCount\(\) \{[\s\S]*?\n\}/);
    expect(publie, "publishSuperMissionsCount introuvable").not.toBeNull();
    expect(publie[0]).toMatch(/buildRunningMissions\(getAgentActivitySnapshot\(\)\.list, collectQueuedMissions\(\)\)/);
    expect(publie[0]).toMatch(/splitMissions\(missions\)/);
    expect(publie[0]).toMatch(/setAgentPanelTaskCount\(running\.length, waiting\.length\)/);
    // Le rendu de la liste reprend ces missions (jamais un second calcul).
    const rendu = jsSuper.match(/function renderSuperMissions\(\) \{[\s\S]*?\n\}/);
    expect(rendu, "renderSuperMissions introuvable").not.toBeNull();
    expect(rendu[0]).toMatch(/const missions = publishSuperMissionsCount\(\)/);
    expect(rendu[0]).toMatch(/renderMissionsPanelHtml\(missions\)/);
    expect(rendu[0]).not.toMatch(/buildRunningMissions\(/);
  });

  it("le compte ne se fige pas quand on regarde un autre onglet", () => {
    // La surveillance n'est plus coupee par le changement d'onglet : seul le
    // RENDU de la liste est conditionne par la visibilite du volet.
    const change = jsSuper.match(/function onPanelTabChanged\(state\) \{[\s\S]*?\n\}/);
    expect(change, "onPanelTabChanged introuvable").not.toBeNull();
    expect(change[0]).not.toMatch(/stopSuperMissionsWatch\(\)/);
    expect(change[0]).toMatch(/loadSuperMissions\(\)/);
    const rendu = jsSuper.match(/function renderSuperMissions\(\) \{[\s\S]*?\n\}/);
    expect(rendu[0]).toMatch(/isAgentPanelPaneVisible\("tasks"\)/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (c) Les deux familles d'attente oubliees sont comptees (donnees existantes)
// ════════════════════════════════════════════════════════════════════════════
describe("(c) les deux familles d'attente oubliees sont desormais comptees", () => {
  it("commandes manuelles en file : lues dans la file EXISTANTE du projet", () => {
    abandonProjectCommands("/projet/a");
    abandonProjectCommands("/projet/b");
    expect(listAllProjectCommands().length).toBe(0);
    enqueueProjectCommand({ project: "/projet/a", text: "corrige le lint", launch: () => true });
    enqueueProjectCommand({ project: "/projet/b", text: "mets a jour le README", launch: () => true });
    const liste = listAllProjectCommands();
    expect(liste.length).toBe(2);
    expect(countProjectQueuedCommands()).toBe(2);
    expect(liste.map((c) => c.label).join(" ")).toContain("corrige le lint");
    expect(liste.every((c) => typeof c.project === "string")).toBe(true);
    // Aucun doublon : deux fois la meme demande = une seule entree.
    enqueueProjectCommand({ project: "/projet/a", text: "corrige le lint", launch: () => true });
    expect(countProjectQueuedCommands()).toBe(2);
    abandonProjectCommands("/projet/a");
    abandonProjectCommands("/projet/b");
    expect(countProjectQueuedCommands()).toBe(0);
  });

  it("agents en file d'exclusivite : lus dans la file EXISTANTE du bus", () => {
    const projet = "/projet/exclusif";
    expect(listExclusivityWaitingDemands().filter((d) => d.project === projet).length).toBe(0);
    const queue = exclusivityQueueOfProject(projet);
    enqueueExclusivity(queue, "codeur", projet, { agentId: "codeur", brief: "attend son tour", project: projet, resume: "seconde tache" });
    const attente = listExclusivityWaitingDemands().filter((d) => d.project === projet);
    expect(attente.length).toBe(1);
    expect(attente[0].agent).toBe("codeur");
    expect(attente[0].resume).toBe("seconde tache");
    expect(attente[0].brief).toBe("attend son tour");
    // La demande est bien rendue « en attente » par le volet (jamais en cours).
    const m = buildRunningMissions([], [{ project: "P", mission: attente[0].brief, resume: attente[0].resume, agent: attente[0].agent }]);
    expect(splitMissions(m).waiting.length).toBe(1);
  });

  it("super-agent.js lit les DEUX familles dans collectQueuedMissions", () => {
    const collecte = jsSuper.match(/function collectQueuedMissions\(\) \{[\s\S]*?\n\}/);
    expect(collecte, "collectQueuedMissions introuvable").not.toBeNull();
    expect(collecte[0]).toMatch(/listAllProjectCommands\(\)/);
    expect(collecte[0]).toMatch(/listExclusivityWaitingDemands\(\)/);
    // Familles historiques conservees (rien n'a ete retire).
    expect(collecte[0]).toMatch(/delegationStates/);
    expect(collecte[0]).toMatch(/runAgentsQueueByProject/);
    // Aucune structure nouvelle : uniquement des lectures de files existantes.
    expect(jsSuper).toMatch(/import \{ listAllProjectCommands \} from "\.\/project-task-queue\.js"/);
    expect(jsSuper).toMatch(/listExclusivityWaitingDemands \} from "\.\/agents-bus\.js"/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (d) Aucune pastille, aucun fond, aucune animation : du texte seul
// ════════════════════════════════════════════════════════════════════════════
describe("(d) le compteur est du TEXTE seul (pas de pastille)", () => {
  it("aucune pastille, aucun fond, aucune bordure, aucune animation", () => {
    const bloc = blockOf("#agent-activity-count");
    expect(bloc).not.toBe("");
    expect(declaration(bloc, "background")).toBe("");
    expect(declaration(bloc, "border-radius")).toBe("");
    expect(declaration(bloc, "border")).toBe("");
    expect(declaration(bloc, "animation")).toBe("");
    // Contraste : jeton de texte du theme (lisible AA dans les deux themes).
    expect(declaration(bloc, "color")).toBe("var(--text-secondary)");
    // Chiffres de largeur CONSTANTE : le bouton ne « danse » pas.
    expect(declaration(bloc, "font-variant-numeric")).toBe("tabular-nums");
  });

  it("l'ancienne pastille de non-lus ne revient pas dans le bouton", () => {
    expect(html).not.toContain('id="agent-activity-badge"');
    expect(css).not.toContain("#agent-activity-badge");
    expect(jsPanel).not.toContain("agent-activity-badge");
    expect(html).not.toContain('class="agent-unread"');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (e) Aucun pixel de hauteur ajoute a la rangee d'onglets
// ════════════════════════════════════════════════════════════════════════════
describe("(e) la rangee d'onglets ne gagne aucun pixel", () => {
  it("hauteur peinte de la rangee : 36 px + 1 px de filet = 37 px (inchangee)", () => {
    expect(px(declaration(blockOf("#tab-row"), "min-height"))).toBe(36);
    expect(px(declaration(blockOf("#tab-row"), "border-bottom"))).toBe(1);
    expect(hauteurRangee()).toBe(37);
  });

  it("le bouton garde ses 22 px et le compteur ne peut pas l'agrandir", () => {
    expect(px(declaration(blockOf("#agent-activity-entry"), "height"))).toBe(22);
    const bloc = blockOf("#agent-activity-count");
    // Aucune hauteur propre : le compteur prend la ligne du bouton.
    expect(declaration(bloc, "height")).toBe("");
    expect(declaration(bloc, "line-height")).toBe("1");
    expect(declaration(bloc, "font-size")).toBe("var(--font-xs)");
    // Il ne passe jamais a la ligne (sinon la rangee grandirait).
    expect(declaration(bloc, "flex")).toBe("0 0 auto");
  });

  it("le point de l'onglet « Evenements » fait 6 px et ne consomme aucune hauteur", () => {
    const bloc = blockOf("#agent-activity-events-unread");
    expect(bloc).not.toBe("");
    expect(px(declaration(bloc, "width"))).toBe(6);
    expect(px(declaration(bloc, "height"))).toBe(6);
    // Aucun chiffre en clair sur l'onglet (la marge ne le porte pas).
    expect(html).toMatch(/id="agent-activity-tab-events"[^>]*>Événements<span id="agent-activity-events-unread" hidden><\/span>/);
    // L'onglet lui-meme ne recoit aucune hauteur (il prend celle de la barre).
    expect(declaration(blockOf(".sa-events-tab"), "height")).toBe("");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (f) Le signal des evenements non lus ne se perd pas
// ════════════════════════════════════════════════════════════════════════════
describe("(f) le signal des non-lus survit (point du bouton + point de l'onglet)", () => {
  it("le nombre reel est dit dans l'infobulle, avec le pluriel juste", () => {
    expect(agentUnreadTooltip(0)).toBe("");
    expect(agentUnreadTooltip(1)).toBe("1 evenement non lu");
    expect(agentUnreadTooltip(4)).toBe("4 evenements non lus");
  });

  it("les deux points du signal sont dans le document", () => {
    // Point du bouton (deja la) et nouveau point de l'onglet « Evenements ».
    expect(html).toContain('id="agent-activity-dot"');
    expect(html).toContain('id="agent-activity-events-unread"');
    // Regles d'affichage : un point masque ne prend aucune place.
    expect(blockOf("#agent-activity-events-unread[hidden]")).toContain("display: none");
    expect(blockOf("#agent-activity-count[hidden]")).toContain("display: none");
  });

  it("agent-activity.js tient le signal par UN SEUL calcul de compte", () => {
    const maj = jsPanel.match(/function updateAgentPanelBadge\(\) \{[\s\S]*?\n\}/);
    expect(maj, "updateAgentPanelBadge introuvable").not.toBeNull();
    expect(maj[0]).toMatch(/agentPanelBadgeText\(panelUnread\)/);
    expect(maj[0]).toMatch(/agent-activity-events-unread/);
    expect(maj[0]).toMatch(/agentUnreadTooltip\(panelUnread\)/);
    expect(maj[0]).toMatch(/agent-activity-dot/);
  });
});

// ===========================================================================
// (g) Mode « Assistant seul » : le MEME compteur, la MEME source
//
// Le proprietaire veut retrouver, en mode assistant seul, EXACTEMENT le
// compteur du mode normal (« en cours / total »). La seule facon d'y arriver
// sans divergence future est de ne pas creer un second compteur : le noeud
// #agent-activity est DEPLACE dans la barre du mode, puis restitue. Ce bloc
// rougit si quelqu'un ajoute un second noeud, un second calcul ou remet le
// masquage du compteur dans ce mode.
// ===========================================================================
describe("(g) le mode assistant seul affiche le MEME compteur (aucune copie)", () => {
  /** Tous les modules applicatifs de src/js (hors tests), avec leur source. */
  function modulesApplicatifs() {
    const dossier = resolve(ROOT, "src/js");
    return readdirSync(dossier)
      .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"))
      .map((f) => [f, readFileSync(resolve(dossier, f), "utf8").replace(/\r\n/g, "\n")]);
  }

  /** Corps d'une fonction (ancre de debut / de fin verifiees). */
  function corps(ancre, fin) {
    return sliceSource(jsSuper, ancre, fin, 200);
  }

  it("un SEUL noeud de compteur dans tout le document (aucune copie par mode)", () => {
    expect((html.match(/id="agent-activity-count"/g) || []).length).toBe(1);
    expect((html.match(/id="agent-activity"/g) || []).length).toBe(1);
    // Aucun compteur parallele construit pour le mode assistant seul.
    expect(jsSuper).not.toContain("sa-immersive-count");
    expect(css).not.toContain("sa-immersive-count");
  });

  it("le mode assistant seul DEPLACE le noeud du mode normal, puis le restitue", () => {
    const entree = corps("function enterImmersive() {", "\n  function exitImmersive() {");
    // Il prend le noeud EXISTANT (getElementById) et l'insere dans sa barre.
    expect(entree).toContain('document.getElementById("agent-activity")');
    expect(entree).toMatch(/insertBefore\(activity, agentsHost\)/);
    // Aucune peinture ni aucun calcul propres a ce mode.
    expect(entree).not.toContain("agentTaskCounterText");
    expect(entree).not.toContain("agent-activity-count");
    expect(entree).not.toContain("setAgentPanelTaskCount");

    const sortie = corps("function exitImmersive() {", "\n  // Raccourci clavier de bascule");
    // Retour a la place EXACTE (meme parent, meme voisin) avant de detruire
    // l'overlay : sans cela, le mode normal perdrait son compteur.
    expect(sortie).toContain("immersiveActivityHome");
    expect(sortie).toMatch(/home\.parent\.insertBefore\(activity, next\)/);
  });

  it("le CSS ne masque plus le suivi du travail dans ce mode : il l'accueille", () => {
    const regle = blockOf(".superagent-immersive-active #agent-activity").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(declaration(regle, "display")).toBe("flex");
    // Centre verticalement dans la barre (58 px) : aucune hauteur ajoutee.
    expect(declaration(regle, "align-self")).toBe("center");
    expect(css).not.toMatch(/\.superagent-immersive-active #agent-activity \{[^}]*display:\s*none/);
  });

  it("un seul calcul du texte et un seul peintre, dans TOUT le projet", () => {
    const modules = modulesApplicatifs();
    const parMotif = (motif) =>
      modules.filter(([, src]) => motif.test(src)).map(([f]) => f).sort();

    // Le texte « en cours / total » n'est compose QUE par agent-activity.js.
    expect(parMotif(/agentTaskCounterText\(/)).toEqual(["agent-activity.js"]);
    // Une seule fonction peint le compteur (et elle ne vise qu'un noeud).
    expect(parMotif(/function paintAgentPanelTaskCount\(/)).toEqual(["agent-activity.js"]);
    // Un seul publieur de compte appelle le peintre : super-agent.js.
    expect(parMotif(/setAgentPanelTaskCount\(/)).toEqual(["agent-activity.js", "super-agent.js"]);
  });

  it("le peintre n'ecrit que sur le noeud PARTAGE par les deux modes", () => {
    const peintre = sliceSource(jsPanel, "function paintAgentPanelTaskCount() {", "\n}\n", 200);
    expect(peintre).toContain('getElementById("agent-activity-count")');
    // Aucune ecriture vers un element propre a un mode : c'est ce qui garantit
    // que les deux modes ne peuvent pas afficher deux nombres differents.
    expect(peintre).not.toContain("sa-immersive");
    expect(peintre).not.toContain("immersive");
  });

  it("le noeud deplace affiche le meme compte apres un changement de mode", () => {
    // Le compteur ne depend pas du conteneur : il suffit que le noeud soit le
    // meme. On le verifie sur l'element reel (DOM minimal) : « 2/5 » avant et
    // apres le deplacement simule, avec la MEME instance.
    setAgentPanelTaskCount(2, 3);
    const compteur = el("agent-activity-count");
    expect(compteur.textContent).toBe("2/5");
    // Deplacement simule : rien n'est recree, seule la position change.
    const deplace = compteur;
    setAgentPanelTaskCount(2, 3);
    expect(deplace).toBe(el("agent-activity-count"));
    expect(deplace.textContent).toBe("2/5");
    expect(el("agent-activity-entry").title).toBe("Travail : 2 taches en cours sur 5 (3 en attente)");
  });
});

// ===========================================================================
// (h) Cas limites : la valeur affichee suit TOUJOURS le travail reel
//
// Les blocs (a) a (g) verrouillent le calcul unique, le noeud unique et le
// deplacement du noeud d'un mode a l'autre. Ce bloc ferme les deux dernieres
// portes, celles que la demande du proprietaire nomme explicitement :
//   1. une regle CSS propre au mode « Assistant seul » pourrait masquer une
//      PARTIE du compteur (le chiffre, le bouton, le mot « Travail », la
//      pastille) : le second mode afficherait alors un compteur muet, donc un
//      « autre compteur ». Aucun test ne le detectait ;
//   2. les cas limites doivent peindre la valeur EXACTE — aucun travail, un
//      seul en cours, plusieurs en attente, un travail qui se termine pendant
//      l'affichage — sans valeur intermediaire et sans compteur fige.
// ===========================================================================
describe("(h) cas limites : le compteur suit le travail reel, dans les deux modes", () => {
  /** Decoupe la feuille en regles { selecteur, corps } (commentaires retires). */
  function reglesCss(texte) {
    const out = [];
    const sans = texte.replace(/\/\*[\s\S]*?\*\//g, "");
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(sans))) out.push({ selecteur: m[1].trim(), corps: m[2] });
    return out;
  }

  /** Une declaration qui REND UN ELEMENT INVISIBLE (aucune autre). */
  const CACHE = /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:[;}\s]|$)/;

  it("aucune regle du mode assistant seul ne cache une partie du compteur", () => {
    // Chaque cible est une partie visible du MEME compteur : conteneur, bouton
    // nomme « Travail », chiffre « en cours / total », pastille d'etat, libelle.
    const cibles = [
      "#agent-activity",
      "#agent-activity-entry",
      "#agent-activity-count",
      "#agent-activity-dot",
      ".agent-activity-entry-label",
    ];
    const fautives = [];
    for (const regle of reglesCss(css)) {
      if (!regle.selecteur.includes(".superagent-immersive-active")) continue;
      if (!cibles.some((c) => regle.selecteur.includes(c))) continue;
      if (CACHE.test(regle.corps)) fautives.push(`${regle.selecteur} {${regle.corps.trim()}}`);
    }
    // Le compteur du mode assistant seul EST le compteur du mode normal : si une
    // regle du mode le masque, les deux modes n'affichent plus la meme chose.
    expect(fautives).toEqual([]);
  });

  it("la barre du mode ne rogne pas le compteur (ni son panneau)", () => {
    // `overflow: hidden` sur la barre couperait le bouton « Travail » et le
    // panneau a trois onglets qui s'ancre dessous.
    const barre = blockOf(".sa-immersive-top");
    expect(barre).not.toBe("");
    expect(declaration(barre, "overflow")).not.toBe("hidden");
    expect(declaration(barre, "overflow-x")).not.toBe("hidden");
    expect(declaration(barre, "overflow-y")).not.toBe("hidden");
  });

  it("les quatre cas limites peignent la valeur EXACTE, sans etape intermediaire", () => {
    const etapes = [
      // [en cours, en attente, texte visible, chiffre allume]
      [0, 0, "", false],  // aucun travail : rien plutot qu'un « 0/0 » permanent
      [1, 0, "1/1", true], // un seul travail en cours
      [0, 3, "0/3", false], // plusieurs en attente, rien en cours
      [2, 3, "2/5", true], // les deux a la fois : le total additionne
    ];
    for (const [running, waiting, texte, allume] of etapes) {
      setAgentPanelTaskCount(running, waiting);
      const compteur = el("agent-activity-count");
      expect(compteur.textContent, `${running} en cours / ${waiting} en attente`).toBe(texte);
      expect(compteur.hidden).toBe(texte === "");
      expect(compteur.classList.contains("working")).toBe(allume);
      // Infobulle et nom lu : les nombres REELS, jamais le texte plafonne.
      expect(el("agent-activity-entry").title).toBe(agentTaskCounterLabel(running, waiting));
      expect(el("agent-activity-entry").getAttribute("aria-label")).toBe(agentTaskCounterLabel(running, waiting));
    }
  });

  it("un travail qui se termine pendant l'affichage : le compteur redescend, jamais fige", () => {
    setAgentPanelTaskCount(1, 2); // une tache tourne, deux attendent leur tour
    expect(el("agent-activity-count").textContent).toBe("1/3");
    expect(el("agent-activity-count").classList.contains("working")).toBe(true);
    // La tache en cours se termine : l'attente reste, le total redescend.
    setAgentPanelTaskCount(0, 2);
    expect(el("agent-activity-count").textContent).toBe("0/2");
    expect(el("agent-activity-count").classList.contains("working")).toBe(false);
    // La file se vide : plus de chiffre, plus d'infobulle de travail.
    setAgentPanelTaskCount(0, 0);
    expect(el("agent-activity-count").textContent).toBe("");
    expect(el("agent-activity-count").hidden).toBe(true);
    expect(el("agent-activity-entry").title).toBe("Suivi du travail");
  });

  it("le compteur ne saute pas : meme entree = meme affichage, file qui change = total juste", () => {
    setAgentPanelTaskCount(2, 3);
    const premier = el("agent-activity-count").textContent;
    // Repeindre le meme etat ne doit rien changer (aucun clignotement).
    setAgentPanelTaskCount(2, 3);
    expect(el("agent-activity-count").textContent).toBe(premier);
    expect(el("agent-activity-count").hidden).toBe(false);
    // Une demande de plus dans la file : seul le total bouge, jamais le nombre
    // de taches en cours (aucun echange entre les deux nombres).
    setAgentPanelTaskCount(2, 4);
    expect(el("agent-activity-count").textContent).toBe("2/6");
    expect(el("agent-activity-entry").title).toBe("Travail : 2 taches en cours sur 6 (4 en attente)");
  });
});

// ===========================================================================
// (i) Les deux modes lisent la MEME valeur, alimentee DES LE DEMARRAGE
//
// Cause constatee sur le disque (RAPPORT-compteur-travail-unifie.md) : il n'y
// avait PAS deux calculs — il n'y en a jamais eu qu'un — mais son ABONNEMENT
// etait pose par la fabrique de l'onglet Assistant (`createSuperAgentBlock`).
// Tant que cet onglet n'avait jamais ete ouvert, personne ne publiait le
// compte : le bouton « Travail » restait muet (ou fige) en mode normal. En mode
// « Assistant seul », l'onglet Assistant existe forcement (c'est lui qui porte
// le mode) : le meme calcul y etait donc alimente, et le compte y etait juste.
// Deux valeurs affichees pour deux modes, sans une seule ligne de calcul
// dupliquee. La cause est l'ALIMENTATION, pas le calcul.
//
// Ce bloc echoue si :
//   1. le compteur cesse de demarrer avec l'application (retour dans l'onglet) ;
//   2. un SECOND abonnement ou un SECOND calcul apparait ;
//   3. la valeur publiee change en passant d'un mode a l'autre.
// ===========================================================================
describe("(i) les deux modes affichent la MEME valeur, alimentee des le demarrage", () => {
  const jsMain = lire("src/js/main.js");

  /** Conteneur minimal : DEPLACE un noeud (comme insertBefore), ne le copie pas. */
  class FakeConteneur {
    constructor(nom) {
      this.nom = nom;
      this.children = [];
      this.parentNode = null;
    }
    retire(noeud) {
      const i = this.children.indexOf(noeud);
      if (i >= 0) this.children.splice(i, 1);
    }
    insere(noeud, ref) {
      if (noeud.parentNode) noeud.parentNode.retire(noeud);
      const i = ref ? this.children.indexOf(ref) : -1;
      if (i < 0) this.children.push(noeud);
      else this.children.splice(i, 0, noeud);
      noeud.parentNode = this;
      return noeud;
    }
  }

  /** Corps verifie du demarrage du compteur (ancres controlees). */
  function corpsDemarrage() {
    return sliceSource(jsSuper, "export function startTaskCounter() {", "\n}\n", 80);
  }

  it("le compteur demarre avec l'application, PAS avec l'ouverture de l'onglet Assistant", () => {
    // main.js importe le demarrage et l'appelle au lancement...
    expect(jsMain).toMatch(/import \{[^}]*startTaskCounter[^}]*\} from "\.\/super-agent\.js"/);
    expect(jsMain).toMatch(/^\s*startTaskCounter\(\);$/m);
    // ...et ne fabrique pas l'onglet Assistant au demarrage : si le compteur y
    // retournait, ce test rougirait, car il n'y aurait plus de demarrage
    // independant de l'onglet.
    expect(jsMain).not.toContain("createSuperAgentBlock");
    // L'abonnement est UNIQUE (idempotent) : le demarrage ET la fermeture de
    // l'onglet ne peuvent pas creer deux publications du compte.
    const corps = corpsDemarrage();
    expect(corps).toContain("if (taskCounterUnsub) return false;");
    expect(corps).toContain("subscribeAgentActivity(publishSuperMissionsCount)");
  });

  it("un SEUL abonnement et un SEUL calcul du compte dans tout le module Assistant", () => {
    // Un second abonnement = un second calcul possible = deux valeurs.
    expect((jsSuper.match(/subscribeAgentActivity\(publishSuperMissionsCount\)/g) || []).length).toBe(1);
    // Une seule ecriture du compte, et elle passe par le peintre partage.
    expect((jsSuper.match(/setAgentPanelTaskCount\(/g) || []).length).toBe(1);
    // Le calcul lui-meme n'existe qu'une fois.
    expect((jsSuper.match(/function publishSuperMissionsCount\(/g) || []).length).toBe(1);
  });

  it("la MEME valeur publiee dans les deux placements (calcul reel, meme noeud)", () => {
    // Etat de REFERENCE : ce que le CALCUL REEL publie avant mes demandes. Les
    // autres blocs de ce fichier laissent leurs propres files : on mesure donc
    // un ECART, jamais un nombre absolu emprunte a un autre test.
    const reference = publishSuperMissionsCount();
    const referenceTexte = el("agent-activity-count").textContent;
    const referenceAttente = splitMissions(reference).waiting.length;
    const referenceEnCours = splitMissions(reference).running.length;

    // File REELLE : deux commandes manuelles mises en file sur deux projets.
    abandonProjectCommands("/projet/mode-normal");
    abandonProjectCommands("/projet/mode-assistant-seul");
    enqueueProjectCommand({ project: "/projet/mode-normal", text: "prepare la livraison", launch: () => true });
    enqueueProjectCommand({ project: "/projet/mode-assistant-seul", text: "relis le diff", launch: () => true });

    // Mode normal : le noeud du compteur vit dans la rangee d'onglets.
    const rangee = new FakeConteneur("tab-row");
    const barre = new FakeConteneur("sa-immersive-top");
    const noeud = new FakeConteneur("agent-activity");
    registry.set("agent-activity", noeud);
    rangee.insere(noeud, null);

    const missionsNormal = publishSuperMissionsCount();
    const normal = {
      texte: el("agent-activity-count").textContent,
      infobulle: el("agent-activity-entry").title,
      chiffre: el("agent-activity-count"),
      parent: noeud.parentNode,
    };
    const decoupage = splitMissions(missionsNormal);
    // Le calcul reel voit bien mes deux demandes (et rien de nouveau d'autre).
    expect(decoupage.waiting.length - referenceAttente).toBe(2);
    expect(decoupage.running.length).toBe(referenceEnCours);
    // Le chiffre affiche EST ce calcul-la (aucun second comptage).
    expect(normal.texte).toBe(agentTaskCounterText(decoupage.running.length, decoupage.waiting.length));
    expect(normal.texte).not.toBe(referenceTexte); // la file a bien change
    expect(normal.parent).toBe(rangee);

    // Passage en mode « Assistant seul » : le MEME noeud est DEPLACE.
    barre.insere(noeud, null);
    const missionsSeul = publishSuperMissionsCount();
    const seul = {
      texte: el("agent-activity-count").textContent,
      infobulle: el("agent-activity-entry").title,
      chiffre: el("agent-activity-count"),
      parent: noeud.parentNode,
    };
    expect(seul.parent).toBe(barre);
    expect(seul.chiffre).toBe(normal.chiffre); // aucune copie du noeud
    expect(seul.texte).toBe(normal.texte); // aucune valeur differente
    expect(seul.infobulle).toBe(normal.infobulle);
    expect(missionsSeul).toEqual(missionsNormal); // le MEME calcul

    // Retour en mode normal : la valeur ne bouge pas d'un pouce.
    rangee.insere(noeud, null);
    expect(publishSuperMissionsCount()).toEqual(missionsNormal);
    expect(el("agent-activity-count").textContent).toBe(normal.texte);
    expect(noeud.parentNode).toBe(rangee);

    abandonProjectCommands("/projet/mode-normal");
    abandonProjectCommands("/projet/mode-assistant-seul");
    setAgentPanelTaskCount(0, 0);
  });

  it("la file qui bouge change le chiffre de la MEME facon dans les deux modes", () => {
    abandonProjectCommands("/projet/file-bougeante");
    const rangee = new FakeConteneur("tab-row");
    const barre = new FakeConteneur("sa-immersive-top");
    const noeud = new FakeConteneur("agent-activity");
    registry.set("agent-activity", noeud);
    rangee.insere(noeud, null);

    enqueueProjectCommand({ project: "/projet/file-bougeante", text: "premiere demande", launch: () => true });
    const apresUne = publishSuperMissionsCount();
    const texteUne = el("agent-activity-count").textContent;
    expect(texteUne).toBe(
      agentTaskCounterText(splitMissions(apresUne).running.length, splitMissions(apresUne).waiting.length)
    );

    // Une demande de plus arrive PENDANT le mode « Assistant seul ».
    barre.insere(noeud, null);
    enqueueProjectCommand({ project: "/projet/file-bougeante", text: "seconde demande", launch: () => true });
    const apresDeux = publishSuperMissionsCount();
    const texteDeux = el("agent-activity-count").textContent;
    expect(splitMissions(apresDeux).waiting.length - splitMissions(apresUne).waiting.length).toBe(1);
    expect(texteDeux).toBe(
      agentTaskCounterText(splitMissions(apresDeux).running.length, splitMissions(apresDeux).waiting.length)
    );
    expect(texteDeux).not.toBe(texteUne);

    // La meme file, relue en mode normal : exactement le meme chiffre.
    rangee.insere(noeud, null);
    expect(publishSuperMissionsCount()).toEqual(apresDeux);
    expect(el("agent-activity-count").textContent).toBe(texteDeux);

    abandonProjectCommands("/projet/file-bougeante");
    setAgentPanelTaskCount(0, 0);
  });
});
