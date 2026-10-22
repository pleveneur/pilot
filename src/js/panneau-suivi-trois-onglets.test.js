// Garde-fous du PANNEAU UNIQUE du suivi du travail (haut droite).
//
// Decision du proprietaire : le travail se suit a UN SEUL endroit de l'ecran.
// Le cercle respirant en haut a droite ouvre un panneau a TROIS onglets, dans
// cet ordre DEFINITIF (de gauche a droite) : « Agents », « Taches »,
// « Evenements ». L'ancien panneau de la cloche (bouton cloche dans la barre de
// saisie de l'onglet Assistant + panneau en bas a droite) a ete DEPLACE dans ce
// panneau : rien n'a ete perdu (memes evenements, memes missions, meme mention
// « en attente », memes reglages).
//
// Ce fichier echoue si :
//   (a) le panneau de la cloche revient (bouton cloche, panneau bas-droite) ;
//   (b) un des trois onglets disparait, change de nom ou d'ordre (l'ordre
//       attendu est « agents, tasks, events », cote boutons ET cote volets) ;
//   (b-ter) le panneau s'ouvre sur un autre onglet que « Agents » quand aucun
//       choix n'a ete memorise (un choix memorise reste prioritaire) ;
//   (c) un des trois volets se vide (liste agents, evenements, missions) ou
//       perd la mention « en attente » des missions en file ;
//   (d) le signal d'attention (pastille + allumage du cercle) disparait ;
//   (e) le reglage global « onglet Taches » cesse d'agir sur le panneau.
//
// Aucun navigateur : lecture des sources (fins de ligne normalisees, cf.
// quality-gate 3.4) + fonctions reelles du module avec un DOM minimal.
import { describe, expect, it, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { invoke } from "@tauri-apps/api/core";
import {
  AGENT_PANEL_TABS,
  AGENT_PANEL_TAB_LABELS,
  AGENT_PANEL_TAB_KEY,
  AGENT_PANEL_DEFAULT_TAB,
  AGENT_PANEL_UNREAD_MAX,
  agentPanelBadgeText,
  agentPanelClearUnread,
  agentPanelTabVisibility,
  closeAgentPanel,
  getActiveAgentPanelTab,
  getAgentPanelUnread,
  agentPanelNoteEvent,
  isAgentPanelOpen,
  isAgentPanelPaneVisible,
  normalizeAgentPanelTab,
  openAgentPanel,
  selectAgentPanelTab,
  setAgentPanelTabsVisibility,
  renderDropdown,
  renderMissionsPanelHtml,
  buildRunningMissions,
  initAgentActivity,
} from "./agent-activity.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lire = (rel) => readFileSync(resolve(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const html = lire("index.html");
const css = lire("src/css/style.css");
const jsPanel = lire("src/js/agent-activity.js");
const jsSuper = lire("src/js/super-agent.js");

/** Ordre DEFINITIF des onglets, de gauche a droite (verrouille par test). */
const ORDRE_DEFINITIF = ["agents", "tasks", "events"];

// ── DOM minimal (aucun navigateur requis) ──
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
    this.innerHTML = "";
    // Ecouteurs REELS : permet de declencher les vrais gestionnaires du module
    // (navigation clavier) au lieu de relire le source (controle (b)).
    this.ecouteurs = new Map();
    this.tablist = null;
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; }
  addEventListener(type, fn) {
    if (!this.ecouteurs.has(type)) this.ecouteurs.set(type, []);
    this.ecouteurs.get(type).push(fn);
  }
  /** Declenche un evenement sur cet element (test seulement). */
  declenche(type, evt) {
    for (const fn of this.ecouteurs.get(type) || []) fn(evt);
  }
  querySelector(sel) {
    return sel === '[role="tablist"]' ? this.tablist : null;
  }
  focus() {}
}

const PANEL_IDS = [
  "agent-activity",
  "agent-activity-dropdown",
  "agent-activity-dot",
  "agent-activity-badge",
  "agent-activity-card",
  "agent-activity-list",
  "agent-activity-panel-clear",
  "agent-activity-panel-close",
  ...AGENT_PANEL_TABS.flatMap((t) => [`agent-activity-tab-${t}`, `agent-activity-pane-${t}`]),
];

let registry = new Map();
const el = (id) => registry.get(id);
const parId = (id) => registry.get(id) || null;

function installeDom() {
  registry = new Map(PANEL_IDS.map((id) => [id, new FakeEl(id)]));
  // Barre d'onglets : le module la cherche par role="tablist" DANS le panneau.
  el("agent-activity-dropdown").tablist = new FakeEl("agent-activity-tablist");
  el("agent-activity-dropdown").classList.add("hidden");
  for (const t of AGENT_PANEL_TABS) {
    if (t !== "agents") el(`agent-activity-pane-${t}`).classList.add("hidden");
  }
  el("agent-activity-panel-clear").hidden = true;
  el("agent-activity-badge").hidden = true;
  el("agent-activity-badge").textContent = "0";
  globalThis.document = { getElementById: parId, querySelector: () => null };
}

beforeEach(() => {
  installeDom();
  // Remise a zero de l'etat de module (le panneau est un singleton).
  setAgentPanelTabsVisibility({});
  selectAgentPanelTab("agents", { persist: false });
  agentPanelClearUnread();
  closeAgentPanel();
  globalThis.localStorage = {
    valeurs: new Map(),
    getItem(k) { return this.valeurs.has(k) ? this.valeurs.get(k) : null; },
    setItem(k, v) { this.valeurs.set(k, String(v)); },
    removeItem(k) { this.valeurs.delete(k); },
  };
});

// ════════════════════════════════════════════════════════════════════════════
// (a) L'ancien panneau de la cloche ne revient pas (un seul endroit a l'ecran)
// ════════════════════════════════════════════════════════════════════════════
describe("(a) plus de panneau cloche en bas a droite : un seul panneau", () => {
  it("index.html ne contient ni bouton cloche, ni panneau d'evenements separe", () => {
    expect(html).not.toContain('data-lucide="bell"');
    expect(html).not.toContain("sa-events-btn");
    expect(html).not.toContain("superagent-events-panel");
    expect(html).not.toContain("sa-events-badge");
  });

  it("super-agent.js ne construit plus de bouton cloche ni de panneau propre", () => {
    expect(jsSuper).not.toContain("superagent-events-panel");
    expect(jsSuper).not.toContain("sa-events-btn");
    expect(jsSuper).not.toContain("sa-events-badge");
    expect(jsSuper).not.toContain("SUPER_EVENTS_KEY");
    // Il ALIMENTE le panneau unique (jamais il n'en cree un).
    expect(jsSuper).toMatch(/agentPanelEventsListElement\(\)/);
    expect(jsSuper).toMatch(/agentPanelTasksListElement\(\)/);
    expect(jsSuper).toMatch(/onAgentPanelTabChange\(/);
  });

  it("style.css n'a plus aucune regle du panneau cloche", () => {
    expect(css).not.toContain("#superagent-events-panel");
    expect(css).not.toContain(".sa-events-btn");
    expect(css).not.toContain(".sa-events-badge");
  });

  it("le panneau est celui du cercle d'activite, fixe en HAUT a DROITE", () => {
    // Les trois volets sont DANS le panneau du cercle (un seul conteneur).
    const debut = html.indexOf('<div id="agent-activity">');
    const fin = html.indexOf('<div id="agent-activity-card"');
    expect(debut).toBeGreaterThan(-1);
    expect(fin).toBeGreaterThan(debut);
    const bloc = html.slice(debut, fin);
    expect(bloc).toContain('id="agent-activity-dropdown"');
    expect(bloc).toContain('id="agent-activity-pane-agents"');
    expect(bloc).toContain('id="agent-activity-pane-events"');
    expect(bloc).toContain('id="agent-activity-pane-tasks"');
    // Position historique du cercle : coin superieur droit (jamais en bas).
    const regleCercle = css.slice(css.indexOf("#agent-activity {"), css.indexOf("#agent-activity-dot {"));
    expect(regleCercle).toMatch(/position:\s*fixed/);
    expect(regleCercle).toMatch(/top:\s*8px/);
    expect(regleCercle).toMatch(/right:\s*12px/);
    expect(regleCercle).not.toMatch(/bottom:\s*\d+px/);
  });

  it("le panneau se ferme par le cercle, par la croix et par Echap", () => {
    expect(jsPanel).toMatch(/id="agent-activity-panel-close"|agent-activity-panel-close/);
    expect(jsPanel).toMatch(/Escape/);
    expect(jsPanel).toMatch(/toggleAgentPanel\(\)/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (b) Les trois onglets existent, dans l'ordre, avec leurs libelles
// ════════════════════════════════════════════════════════════════════════════
describe("(b) trois onglets, ordre definitif : Agents, Taches, Evenements", () => {
  it("l'ordre et les libelles sont ceux demandes", () => {
    expect(AGENT_PANEL_TABS).toEqual(ORDRE_DEFINITIF);
    expect(AGENT_PANEL_TAB_LABELS).toEqual({
      agents: "Agents",
      events: "Événements",
      tasks: "Tâches",
    });
  });

  it("index.html porte les trois boutons d'onglet (role=tab, aria-selected)", () => {
    const ordre = ORDRE_DEFINITIF.map((t) =>
      html.indexOf(`id="agent-activity-tab-${t}"`)
    );
    expect(ordre.every((i) => i > -1)).toBe(true);
    expect([...ordre].sort((a, b) => a - b)).toEqual(ordre); // ordre a l'ecran
    for (const t of AGENT_PANEL_TABS) {
      const debut = html.indexOf(`id="agent-activity-tab-${t}"`);
      const bouton = html.slice(html.lastIndexOf("<button", debut), html.indexOf("</button>", debut));
      expect(bouton).toContain('role="tab"');
      expect(bouton).toContain(`aria-controls="agent-activity-pane-${t}"`);
      expect(bouton).toContain("aria-selected=");
      expect(bouton).toContain(AGENT_PANEL_TAB_LABELS[t]);
    }
  });

  it("index.html range les Volets dans le meme ordre que les boutons", () => {
    const ordre = ORDRE_DEFINITIF.map((t) =>
      html.indexOf(`id="agent-activity-pane-${t}"`)
    );
    expect(ordre.every((i) => i > -1)).toBe(true);
    expect([...ordre].sort((a, b) => a - b)).toEqual(ordre);
  });

  it("l'onglet ouvert au demarrage suit l'ordre (le premier bouton est « Agents »)", () => {
    const barre = html.slice(
      html.indexOf('<div class="sa-events-tabs" role="tablist"'),
      html.indexOf('<div class="sa-events-header-actions">')
    );
    const premier = barre.indexOf('class="sa-events-tab');
    expect(barre.slice(premier)).toContain(`id="agent-activity-tab-${ORDRE_DEFINITIF[0]}"`);
  });

  it("la navigation au clavier suit l'ordre d'affichage (gauche -> droite)", () => {
    // Les fleches parcourent AGENT_PANEL_TABS tel quel : l'ordre du tableau EST
    // l'ordre de tabulation visuel.
    expect(AGENT_PANEL_TABS).toEqual(ORDRE_DEFINITIF);
    expect(jsPanel).toMatch(/const visible = AGENT_PANEL_TABS\.filter\(\(t\) => panelTabEnabled\[t\]\)/);
    expect(jsPanel).toMatch(/ArrowRight"\) next = visible\[\(i \+ 1\) % visible\.length\]/);
    expect(jsPanel).toMatch(/ArrowLeft"\) next = visible\[\(i - 1 \+ visible\.length\) % visible\.length\]/);
  });

  it("l'ordre de TABULATION au clavier est celui de l'ECRAN (gestionnaire reel)", () => {
    // Ordre REELLEMENT affiche, lu dans index.html (independamment du module).
    const ordreEcran = ["agents", "tasks", "events"].sort(
      (a, b) =>
        html.indexOf(`id="agent-activity-tab-${a}"`) -
        html.indexOf(`id="agent-activity-tab-${b}"`)
    );
    // Le module, source des clics ET des fleches, suit le meme ordre.
    expect(AGENT_PANEL_TABS).toEqual(ordreEcran);

    // DOM minimal (`window` + barre d'onglets), puis branchement du VRAI
    // gestionnaire de touches de initAgentActivity : on mesure le comportement,
    // pas la presence d'une ligne de code.
    const fenetreAvant = globalThis.window;
    globalThis.window = { addEventListener() {} };
    vi.useFakeTimers();
    try {
      invoke.mockResolvedValue({});
      initAgentActivity({ openFile() {}, _openAgent() {} });
      const barre = el("agent-activity-dropdown").tablist;
      expect(barre).not.toBe(null);
      expect(getActiveAgentPanelTab()).toBe(ordreEcran[0]);

      const suite = [];
      const fleche = (key) => {
        let empeche = false;
        barre.declenche("keydown", { key, preventDefault() { empeche = true; } });
        expect(empeche).toBe(true);
        suite.push(getActiveAgentPanelTab());
      };
      fleche("ArrowRight");
      fleche("ArrowRight");
      fleche("ArrowRight"); // bouclage sur le premier
      fleche("ArrowLeft");
      const n = ordreEcran.length;
      // Droite = onglet SUIVANT a l'ecran, gauche = precedent (avec bouclage) :
      // la sequence doit etre exactement celle de l'ordre visible.
      expect(suite).toEqual([
        ordreEcran[1 % n],
        ordreEcran[2 % n],
        ordreEcran[0],
        ordreEcran[(n - 1) % n],
      ]);
      // Le volet affiche est celui de l'onglet atteint au clavier, jamais un autre.
      for (const t of ordreEcran) {
        expect(el(`agent-activity-pane-${t}`).classList.contains("hidden")).toBe(
          t !== getActiveAgentPanelTab()
        );
      }
    } finally {
      vi.useRealTimers();
      globalThis.window = fenetreAvant;
    }
  });

  it("un onglet inconnu retombe sur « Agents » (jamais un panneau vide)", () => {
    expect(normalizeAgentPanelTab("nimporte-quoi")).toBe("agents");
    expect(normalizeAgentPanelTab(null)).toBe("agents");
    expect(normalizeAgentPanelTab("tasks")).toBe("tasks");
  });

  it("changer d'onglet affiche un seul volet a la fois", () => {
    openAgentPanel("agents");
    expect(isAgentPanelOpen()).toBe(true);
    expect(el("agent-activity-pane-agents").classList.contains("hidden")).toBe(false);

    selectAgentPanelTab("events");
    expect(getActiveAgentPanelTab()).toBe("events");
    expect(el("agent-activity-pane-agents").classList.contains("hidden")).toBe(true);
    expect(el("agent-activity-pane-events").classList.contains("hidden")).toBe(false);
    expect(el("agent-activity-pane-tasks").classList.contains("hidden")).toBe(true);
    expect(el("agent-activity-tab-events").getAttribute("aria-selected")).toBe("true");
    expect(el("agent-activity-tab-agents").getAttribute("aria-selected")).toBe("false");
    // Navigation au clavier : un seul onglet est dans l'ordre de tabulation.
    expect(el("agent-activity-tab-events").tabIndex).toBe(0);
    expect(el("agent-activity-tab-agents").tabIndex).toBe(-1);

    selectAgentPanelTab("tasks");
    expect(el("agent-activity-pane-tasks").classList.contains("hidden")).toBe(false);
    expect(el("agent-activity-pane-events").classList.contains("hidden")).toBe(true);
  });

  it("memorise le dernier onglet utilise (« Agents » au premier lancement)", () => {
    expect(AGENT_PANEL_TAB_KEY).toBe("agent-activity-panel-tab");
    expect(normalizeAgentPanelTab(localStorage.getItem(AGENT_PANEL_TAB_KEY))).toBe("agents");
    selectAgentPanelTab("tasks");
    expect(localStorage.getItem(AGENT_PANEL_TAB_KEY)).toBe("tasks");
    // A la reouverture, on revient sur le dernier onglet utilise.
    closeAgentPanel();
    openAgentPanel();
    expect(getActiveAgentPanelTab()).toBe("tasks");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (b-ter) Onglet par defaut : « Agents » tant qu'aucun choix n'est memorise
// ════════════════════════════════════════════════════════════════════════════
describe("(b-ter) ouverture par defaut sur « Agents » (la memoire reste prioritaire)", () => {
  it("le defaut declare est « Agents »", () => {
    expect(AGENT_PANEL_DEFAULT_TAB).toBe("agents");
    expect(AGENT_PANEL_TABS[0]).toBe(AGENT_PANEL_DEFAULT_TAB);
    // Aucune memoire, valeur inconnue, valeur vide : toujours « Agents ».
    expect(normalizeAgentPanelTab(null)).toBe("agents");
    expect(normalizeAgentPanelTab("")).toBe("agents");
    expect(normalizeAgentPanelTab("nimporte-quoi")).toBe("agents");
  });

  it("sans memoire, la sequence d'initialisation du module ouvre sur « Agents »", () => {
    // On part volontairement d'un AUTRE onglet, puis on rejoue exactement la
    // sequence de restauration utilisee par initAgentActivity().
    selectAgentPanelTab("events");
    expect(getActiveAgentPanelTab()).toBe("events");
    localStorage.removeItem(AGENT_PANEL_TAB_KEY);
    const restaure = normalizeAgentPanelTab(localStorage.getItem(AGENT_PANEL_TAB_KEY));
    selectAgentPanelTab(restaure, { persist: false });
    openAgentPanel();
    expect(isAgentPanelOpen()).toBe(true);
    expect(getActiveAgentPanelTab()).toBe("agents");
    expect(el("agent-activity-pane-agents").classList.contains("hidden")).toBe(false);
    expect(el("agent-activity-pane-tasks").classList.contains("hidden")).toBe(true);
    expect(el("agent-activity-pane-events").classList.contains("hidden")).toBe(true);
    // Aucune memoire n'a ete fabriquee par une simple ouverture.
    expect(localStorage.getItem(AGENT_PANEL_TAB_KEY)).toBe(null);
  });

  it("le module restaure bien son onglet depuis localStorage (memoire branchee)", () => {
    expect(jsPanel).toMatch(
      /selectAgentPanelTab\(\s*normalizeAgentPanelTab\(localStorage\.getItem\(AGENT_PANEL_TAB_KEY\)\),\s*\{ persist: false \}\s*\)/
    );
    // L'ouverture sans argument ne force aucun onglet (elle garde le restaure).
    expect(jsPanel).toMatch(/openAgentPanel\(tab\)[\s\S]{0,200}if \(tab\) selectAgentPanelTab\(tab\)/);
  });

  it("un choix memorise l'emporte sur le defaut", () => {
    selectAgentPanelTab("tasks");
    closeAgentPanel();
    // Reouverture = sequence reelle (lecture de la memoire, puis ouverture).
    selectAgentPanelTab(
      normalizeAgentPanelTab(localStorage.getItem(AGENT_PANEL_TAB_KEY)),
      { persist: false }
    );
    openAgentPanel();
    expect(getActiveAgentPanelTab()).toBe("tasks");
  });

  it("index.html marque « Agents » comme onglet actif au chargement", () => {
    const bouton = (t) => {
      const debut = html.indexOf(`id="agent-activity-tab-${t}"`);
      return html.slice(html.lastIndexOf("<button", debut), html.indexOf("</button>", debut));
    };
    expect(bouton("agents")).toContain('class="sa-events-tab active"');
    expect(bouton("agents")).toContain('aria-selected="true"');
    expect(bouton("tasks")).not.toContain("active\"");
    expect(bouton("events")).not.toContain("active\"");
    // Seul le volet « Agents » est visible d'emblee.
    const voletAgents = html.slice(
      html.indexOf('id="agent-activity-pane-agents"') - 120,
      html.indexOf('id="agent-activity-pane-tasks"')
    );
    expect(voletAgents).toContain('id="agent-activity-pane-agents"');
    expect(voletAgents).not.toContain("agent-activity-pane-agents hidden");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (b-bis) Les libelles d'onglet restent lisibles (AA) en sombre ET en clair
// ════════════════════════════════════════════════════════════════════════════

/** Bloc de variables d'un theme (jusqu'a l'accolade fermante de premier niveau). */
function blocTheme(selecteur) {
  const debut = css.indexOf(`${selecteur} {`);
  if (debut < 0) return "";
  return css.slice(debut, css.indexOf("\n}", debut));
}

/** Valeur d'un jeton dans un bloc de theme ('' s'il est absent). */
function jeton(bloc, nom) {
  const m = bloc.match(new RegExp(`--${nom}:\\s*([^;]+);`));
  return m ? m[1].trim() : "";
}

/** Luminance relative WCAG d'une couleur "#rrggbb". */
function luminance(hex) {
  const v = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(v.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Rapport de contraste entre deux couleurs "#rrggbb". */
function contraste(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

describe("(b-bis) onglets lisibles en sombre et en clair", () => {
  it("le libelle au repos utilise un jeton de texte, jamais une couleur en dur", () => {
    const regle = css.slice(css.indexOf(".sa-events-tab {"), css.indexOf("}", css.indexOf(".sa-events-tab {")));
    expect(regle).toMatch(/color:\s*var\(--text-secondary\)/);
    expect(regle).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });

  it.each([".theme-dark", ".theme-light"])(
    "%s : texte secondaire sur la surface de l'en-tete >= 4.5:1",
    (nom) => {
      const bloc = blocTheme(nom);
      const texte = jeton(bloc, "text-secondary");
      const fond = jeton(bloc, "surface-2");
      expect(texte).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(fond).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(contraste(texte, fond)).toBeGreaterThanOrEqual(4.5);
    }
  );
});

// ════════════════════════════════════════════════════════════════════════════
// (c) Aucun des trois volets ne se vide (ni la mention « en attente »)
// ════════════════════════════════════════════════════════════════════════════
describe("(c) les trois volets sont reellement alimentes", () => {
  it("volet Agents : la liste est branchee sur le store d'activite", () => {
    const debut = html.indexOf('id="agent-activity-pane-agents"');
    const fin = html.indexOf('id="agent-activity-pane-tasks"');
    expect(fin).toBeGreaterThan(debut);
    expect(html.slice(debut, fin)).toContain('id="agent-activity-list"');
    expect(jsPanel).toMatch(/function renderAgentsPane\(\)[\s\S]{0,400}renderDropdown\(getAgentActivitySnapshot\(\)\.list\)/);
    // Liste vide : message explicite, jamais un cadre muet.
    expect(renderDropdown([])).toContain("Aucun agent actif");
  });

  it("volet Evenements : la liste est branchee sur le tampon des evenements", () => {
    const debut = html.indexOf('id="agent-activity-pane-events"');
    const fin = html.indexOf('id="agent-activity-card"');
    expect(fin).toBeGreaterThan(debut);
    expect(html.slice(debut, fin)).toContain('class="sa-events-list"');
    expect(jsSuper).toContain("agentPanelEventsListElement()");
    expect(jsSuper).toMatch(/list\.prepend\(item\)/);
    // Tampon borne conserve (aucune liste infinie).
    expect(jsSuper).toMatch(/SUPER_EVENTS_MAX\s*=\s*150/);
    expect(jsSuper).toMatch(/children\.length > SUPER_EVENTS_MAX/);
  });

  it("volet Taches : missions reelles + mention « en attente » des missions en file", () => {
    const debut = html.indexOf('id="agent-activity-pane-tasks"');
    const fin = html.indexOf('id="agent-activity-pane-events"');
    expect(fin).toBeGreaterThan(debut);
    expect(html.slice(debut, fin)).toContain('class="sa-tasks-list"');
    expect(jsSuper).toMatch(/buildRunningMissions\(snapshot\.list, collectQueuedMissions\(\)\)/);
    expect(jsSuper).toMatch(/superTasksList\.innerHTML = renderMissionsPanelHtml\(missions\)/);
    // Sans mission : message explicite (jamais une liste vide trompeuse).
    expect(renderMissionsPanelHtml([])).toContain("Aucune mission en cours");

    // Une mission qui travaille + une mission en file : les DEUX groupes sont
    // la, la file porte « en attente » et l'ordre de la file est numerote.
    const missions = buildRunningMissions(
      [
        { agentId: "codeur|C:/proj", kind: "agent", rawId: "codeur", label: "codeur", project: "Pilot", projectPath: "C:/proj", state: "running", working: true },
      ],
      [
        { project: "Pilot", mission: "Deuxieme demande" },
        { project: "Pilot", mission: "Troisieme demande" },
      ]
    );
    const rendu = renderMissionsPanelHtml(missions);
    expect(rendu).toContain("En cours (1)");
    expect(rendu).toContain("En attente (2)");
    expect(rendu).toContain("en attente");
    // Le rang de la file est numerote dans l'ordre d'arrivee.
    expect(rendu).toContain('<span class="sa-missions-rank">1.</span>');
    expect(rendu).toContain('<span class="sa-missions-rank">2.</span>');
    expect(rendu.indexOf("Deuxieme demande")).toBeGreaterThan(-1);
    expect(rendu.indexOf("Deuxieme demande")).toBeLessThan(rendu.indexOf("Troisieme demande"));
  });

  it("les trois volets partagent UN seul panneau (aucune seconde liste a l'ecran)", () => {
    expect((html.match(/id="agent-activity-dropdown"/g) || []).length).toBe(1);
    expect((html.match(/class="sa-events-list"/g) || []).length).toBe(1);
    expect((html.match(/class="sa-tasks-list"/g) || []).length).toBe(1);
    expect((html.match(/id="agent-activity-list"/g) || []).length).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (d) Le signal d'attention reste visible sur le cercle
// ════════════════════════════════════════════════════════════════════════════
describe("(d) signal d'attention (pastille + cercle allume)", () => {
  it("la pastille est posee SUR le cercle du suivi du travail", () => {
    const debut = html.indexOf('id="agent-activity-dot"');
    const bouton = html.slice(html.lastIndexOf("<button", debut), html.indexOf("</button>", debut));
    expect(bouton).toContain('id="agent-activity-badge"');
    expect(bouton).toContain("aria-haspopup");
    expect(bouton).toContain("aria-expanded");
  });

  it("un evenement non lu allume la pastille et le cercle", () => {
    openAgentPanel("agents");
    expect(getAgentPanelUnread()).toBe(0);
    expect(el("agent-activity-badge").hidden).toBe(true);
    agentPanelNoteEvent();
    expect(getAgentPanelUnread()).toBe(1);
    expect(el("agent-activity-badge").hidden).toBe(false);
    expect(el("agent-activity-badge").textContent).toBe("1");
    expect(el("agent-activity-dot").classList.contains("agent-unread")).toBe(true);
    // Compteur plafonne (jamais une pastille illisible).
    expect(agentPanelBadgeText(150)).toBe(`${AGENT_PANEL_UNREAD_MAX}+`);
    expect(agentPanelBadgeText(0)).toBe("");
  });

  it("regarder les evenements eteint le signal", () => {
    openAgentPanel("agents");
    agentPanelNoteEvent();
    agentPanelNoteEvent();
    expect(getAgentPanelUnread()).toBe(2);
    selectAgentPanelTab("events");
    expect(getAgentPanelUnread()).toBe(0);
    expect(el("agent-activity-badge").hidden).toBe(true);
    expect(el("agent-activity-dot").classList.contains("agent-unread")).toBe(false);
  });

  it("la liste des evenements sous les yeux ne compte pas comme non lue", () => {
    openAgentPanel("events");
    expect(isAgentPanelPaneVisible("events")).toBe(true);
    agentPanelNoteEvent();
    expect(getAgentPanelUnread()).toBe(0);
    // Panneau ferme : l'evenement redevient une notification a voir.
    closeAgentPanel();
    agentPanelNoteEvent();
    expect(getAgentPanelUnread()).toBe(1);
    // Onglet Taches affiche : les evenements ne sont pas sous les yeux.
    openAgentPanel("tasks");
    agentPanelNoteEvent();
    expect(getAgentPanelUnread()).toBe(2);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (e) Le reglage global « onglet Taches » agit toujours (et une seule fois)
// ════════════════════════════════════════════════════════════════════════════
describe("(e) reglage « onglet Taches » : un seul reglage, effet reel", () => {
  it("actif par defaut (et fail-open si la config est illisible)", () => {
    expect(agentPanelTabVisibility({})).toEqual({ agents: true, events: true, tasks: true });
    expect(agentPanelTabVisibility(null)).toEqual({ agents: true, events: true, tasks: true });
    expect(agentPanelTabVisibility({ super_agent_tasks_tab_enabled: true })).toEqual({
      agents: true,
      events: true,
      tasks: true,
    });
  });

  it("desactive : l'onglet Taches disparait du panneau", () => {
    setAgentPanelTabsVisibility({ super_agent_tasks_tab_enabled: false });
    expect(el("agent-activity-tab-tasks").hidden).toBe(true);
    // Les deux autres onglets restent (aucune perte).
    expect(el("agent-activity-tab-agents").hidden).toBe(false);
    expect(el("agent-activity-tab-events").hidden).toBe(false);
    // Reactivation immediate, sans redemarrer.
    setAgentPanelTabsVisibility({ super_agent_tasks_tab_enabled: true });
    expect(el("agent-activity-tab-tasks").hidden).toBe(false);
  });

  it("desactive pendant que l'onglet Taches est affiche : repli sur Agents", () => {
    openAgentPanel("tasks");
    expect(getActiveAgentPanelTab()).toBe("tasks");
    setAgentPanelTabsVisibility({ super_agent_tasks_tab_enabled: false });
    expect(getActiveAgentPanelTab()).toBe("agents");
    expect(el("agent-activity-pane-agents").classList.contains("hidden")).toBe(false);
    // Un onglet masque ne peut pas etre selectionne (jamais un volet invisible).
    selectAgentPanelTab("tasks");
    expect(getActiveAgentPanelTab()).toBe("agents");
  });

  it("le reglage est applique par super-agent.js ET au demarrage, jamais duplique", () => {
    // Le panneau est global : la visibilite vient d'un seul endroit (le module).
    expect(jsSuper).toMatch(
      /function applySuperEventsTabsVisibility\(\)\s*\{\s*setAgentPanelTabsVisibility\(configCache \|\| \{\}\);/
    );
    // Applique des le demarrage (sans attendre l'ouverture de l'onglet Assistant).
    expect(jsPanel).toMatch(/setAgentPanelTabsVisibility\(cfg\)|setAgentPanelTabsVisibility\(config\)/);
    // Une seule case a cocher pour ce comportement dans les Parametres.
    expect((html.match(/id="setting-superagent-tasks-tab"/g) || []).length).toBe(1);
  });

  it("les libelles des Parametres renvoient au panneau du suivi du travail", () => {
    const debut = html.indexOf('id="setting-superagent-tasks-tab"');
    const ligne = html.slice(html.lastIndexOf("<label", debut), html.indexOf("</label>", debut));
    expect(ligne).toContain("Tâches");
    expect(ligne).toContain("suivi du travail");
    expect(ligne).not.toContain("cloche");
  });
});
