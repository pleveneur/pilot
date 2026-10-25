// onboarding-niveau2.test.js — Prise en main, NIVEAU 2 : l'équipe d'agents
// (spec_onboarding.md § Niveau 2).
//
// Ce fichier échoue si :
//   (a) le niveau 2 s'ouvre SANS geste de l'utilisateur (garde retirée, appel
//       détaché au démarrage, ouverture par minuterie / par état) ;
//   (b) le niveau 2 crée un écran de NAVIGATION (un onglet, un mode d'onglet, un
//       écran de gestion dédié) au lieu de réutiliser l'écran « Équipe d'agents »
//       existant ;
//   (c) il écrit une configuration ou modifie un agent de l'utilisateur (ce
//       niveau explique, il ne reconfigure pas) ;
//   (d) il coûte quelque chose : appel de modèle ou session d'agent ;
//   (e) un cas devient muet (registre illisible ou équipe vide sans cause ni
//       marche à suivre, « Réessayer » mort) ;
//   (f) on ne finit pas là où il faut agir : l'écran d'équipe existant ;
//   (g) une couleur est écrite en dur ou un token est inventé.
//
// Aucun navigateur n'est requis : fonctions pures, sources lues sur disque, et
// un DOM minimal simulé pour la navigation entre les deux écrans.

import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { neutraliserSource, sliceFrom, sliceSource } from "./source-slice.js";
import {
  ONBOARDING_TEAM_AGENTS_TAB_LABEL,
  ONBOARDING_TEAM_AGENTS_TAB_MODE,
  ONBOARDING_TEAM_MODAL_ID,
  ONBOARDING_TEAM_SCREENS,
  onboardingTeamAgents,
  onboardingTeamComposition,
  onboardingTeamFirstGesture,
  onboardingTeamStepLabel,
  openOnboardingTeamModal,
} from "./onboarding-niveau2.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
// Fins de ligne normalisées (worktree CRLF sous Windows) — quality-gate § 3.4.
const read = (p) => readFileSync(resolve(root, p), "utf8").replace(/\r\n/g, "\n");

const TEAM = () => read("src/js/onboarding-niveau2.js");
const NIVEAU1 = () => read("src/js/onboarding.js");
const AGENTS_UI = () => read("src/js/agents-ui.js");
const MAIN = () => read("src/js/main.js");
const TABS = () => read("src/js/tabs.js");
const HTML = () => read("index.html");
const CSS = () => read("src/css/style.css");

/** Registre réel de référence (trois agents, comme une équipe déjà en place). */
const registre = () => ({
  version: 1,
  agents: [
    { id: "coordinator", name: "Coordinateur", role: "répartit" },
    { id: "coder", name: "Codeur", role: "écrit" },
    { id: "reviewer", name: "Relecteur", role: "relit" },
  ],
});

// ─────────────────────────────────────────────────────────────────────────────
describe("niveau 2 — il ne s'ouvre JAMAIS sans un geste de l'utilisateur", () => {
  it("refuse de s'ouvrir quand aucun geste n'est fourni", async () => {
    await expect(openOnboardingTeamModal()).resolves.toEqual({
      shown: false,
      reason: "no-gesture",
    });
  });

  it("un état d'équipe, même complet, n'est pas un geste", async () => {
    // Connaître l'équipe ne suffit pas : seul l'utilisateur ouvre cette fenêtre.
    await expect(openOnboardingTeamModal({ registry: registre() })).resolves.toEqual({
      shown: false,
      reason: "no-gesture",
    });
    await expect(
      openOnboardingTeamModal({ registry: registre(), loadRegistry: () => registre() }),
    ).resolves.toEqual({ shown: false, reason: "no-gesture" });
  });

  it("le geste doit valoir VRAI au sens strict (aucune valeur approchante)", async () => {
    for (const gesture of ["true", 1, {}, [], null, undefined, false]) {
      const res = await openOnboardingTeamModal({ gesture, registry: registre() });
      expect(res, `geste ${JSON.stringify(gesture)} accepté à tort`).toEqual({
        shown: false,
        reason: "no-gesture",
      });
    }
  });

  it("la garde du geste est la PREMIÈRE instruction, avant tout accès au document", () => {
    const src = TEAM();
    const code = neutraliserSource(src);
    const garde = code.indexOf("deps.gesture !== true");
    const doc = code.indexOf("document.getElementById");
    expect(garde).toBeGreaterThan(-1);
    expect(doc).toBeGreaterThan(garde);
    // Et la fenêtre est bien celle du niveau 2, pas celle du niveau 1.
    expect(src).toContain("onboarding-team-modal");
  });

  it("le démarrage de Pilot ne connaît pas ce module (aucune ouverture automatique)", () => {
    const main = MAIN();
    expect(main).not.toContain("onboarding-niveau2");
    expect(main).not.toContain("onboarding-team-modal");
    expect(main).not.toContain("openOnboardingTeamModal");
  });

  it("les deux points d'entrée existent et sont des CLICS (aucun autre appel)", () => {
    // 1) le lien discret de la fenêtre de première ouverture
    const niveau1 = NIVEAU1();
    expect(
      (niveau1.match(/openOnboardingTeamModal\(/g) || []).length,
      "un seul appel dans la prise en main",
    ).toBe(1);
    const lien = sliceSource(
      niveau1,
      'teamLearnBtn?.addEventListener("click"',
      "modelRetry?.addEventListener",
      100,
    );
    expect(lien).toContain("openOnboardingTeamModal({ gesture: true");

    // 2) le bouton discret de l'écran « Équipe d'agents » existant
    const ui = AGENTS_UI();
    expect(
      (ui.match(/openOnboardingTeamModal\(/g) || []).length,
      "un seul appel dans l'écran d'équipe",
    ).toBe(1);
    const bouton = sliceSource(
      ui,
      'learnBtn?.addEventListener("click"',
      "resetBtn.addEventListener",
      100,
    );
    expect(bouton).toContain("openOnboardingTeamModal({ gesture: true");

    // Les deux entrées sont dans le document.
    expect(HTML()).toContain('id="btn-onboarding-team-learn"');
    expect(ui).toContain('id="btn-agents-learn"');
  });

  it("Échap dans le niveau 2 ne fait pas écrire « déjà vu » par le niveau 1", () => {
    const src = NIVEAU1();
    const onKeydown = sliceSource(src, "const onKeydown = (event) => {", "skipBtn?.addEventListener", 100);
    // La garde du niveau 2 est AVANT le traitement de la touche.
    const garde = onKeydown.indexOf("isModalVisible(ONBOARDING_TEAM_MODAL_ID)");
    expect(garde).toBeGreaterThan(-1);
    expect(garde).toBeLessThan(onKeydown.indexOf("void skip()"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("niveau 2 — aucun écran de navigation, aucun onglet nouveau", () => {
  it("il réutilise l'écran « Équipe d'agents » EXISTANT", () => {
    expect(ONBOARDING_TEAM_AGENTS_TAB_MODE).toBe("agents");
    expect(ONBOARDING_TEAM_AGENTS_TAB_LABEL).toBe("Agents");
    // Le mode existe bien déjà dans l'application (rien n'est créé).
    expect(TABS()).toContain("_openAgents(");
    // Aucun mode d'onglet dédié au niveau 2 n'a été inventé.
    expect(TABS()).not.toContain("onboarding-team");
  });

  it("le module n'ouvre qu'UN écran, celui de l'équipe, par le chemin existant", () => {
    const src = TEAM();
    expect((src.match(/\.openFile\(/g) || []).length).toBe(1);
    expect(src).toContain("ONBOARDING_TEAM_AGENTS_TAB_MODE");
    // Aucune création d'onglet ni de conteneur d'écran.
    for (const interdit of ["createTab", "new Tab(", "registerTab", "appendChild(wrapper)"]) {
      expect(src, `création d'écran interdite : ${interdit}`).not.toContain(interdit);
    }
  });

  it("la fenêtre est la modale existante, avec DEUX écrans et aucune navigation propre", () => {
    const html = HTML();
    const bloc = sliceSource(
      html,
      `id="${ONBOARDING_TEAM_MODAL_ID}"`,
      '<!-- Modale : journal d\'audit distant (mode remote) -->',
      200,
    );
    expect(bloc).toContain('class="modal hidden"');
    expect(bloc).toContain("modal-content onboarding-content");
    expect(bloc).toContain("modal-actions");
    expect(bloc).not.toContain("<nav");
    expect(bloc).not.toContain("role=\"tab\"");
    const ecrans = bloc.match(/data-onboarding-team-screen="/g) || [];
    expect(ecrans).toHaveLength(ONBOARDING_TEAM_SCREENS);
    expect(ONBOARDING_TEAM_SCREENS).toBe(2);
    // Sorties : fermer et naviguer, jamais un bouton mort ni désactivé.
    for (const id of [
      "onboarding-team-close",
      "btn-onboarding-team-skip",
      "btn-onboarding-team-prev",
      "btn-onboarding-team-next",
      "btn-onboarding-team-retry",
    ]) {
      expect(bloc).toContain(`id="${id}"`);
    }
    expect(bloc).not.toMatch(/id="btn-onboarding-team-skip"[^>]*disabled/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("niveau 2 — il explique, il ne reconfigure ni ne facture rien", () => {
  it("aucune écriture de configuration et aucune modification d'agent", () => {
    const src = TEAM();
    for (const interdit of [
      "save_config",
      "get_config",
      "upsert_agent",
      "delete_agent",
      "replace_agents",
      "reset_agent_registry",
      "list_agent_sessions",
      "run_agents",
      "send_prompt",
      "start_agent",
      "@tauri-apps/api/core",
    ]) {
      expect(src, `le niveau 2 ne doit pas employer « ${interdit} »`).not.toContain(interdit);
    }
  });

  it("l'état de l'équipe est seulement LU (registre d'agents)", () => {
    const src = TEAM();
    expect(src).toContain('import("./agents.js")');
    expect(src).toContain("loadAgentRegistry");
    // Le registre reçu en mémoire est rendu tel quel, sans copie modifiable.
    expect(src).toContain("deps.registry");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("niveau 2 — l'écran 1 : à quoi sert une équipe, et comment elle se compose", () => {
  it("une équipe déjà en place est constatée, sans rien imposer", () => {
    const c = onboardingTeamComposition(registre());
    expect(c.ok).toBe(true);
    expect(c.inPlace).toBe(true);
    expect(c.count).toBe(3);
    expect(c.names).toEqual(["Coordinateur", "Codeur", "Relecteur"]);
    const texte = c.lines.join(" ");
    expect(texte).toContain("déjà");
    expect(texte).toContain("rien ne vous oblige");
    // Aucune marche à suivre : rien ne s'impose à une équipe déjà prête.
    expect(texte).not.toContain("Marche à suivre");
  });

  it("une équipe vide dit la cause ET la marche à suivre (aucun cas muet)", () => {
    const c = onboardingTeamComposition({ version: 1, agents: [] });
    expect(c.ok).toBe(false);
    expect(c.inPlace).toBe(false);
    expect(c.lines.length).toBeGreaterThan(0);
    const texte = c.lines.join(" ");
    expect(texte).toContain("Aucun agent");
    expect(texte).toContain("Marche à suivre");
    expect(texte).toContain("Réessayer");
  });

  it("un registre illisible dit la cause réelle et reste actionnable", () => {
    const c = onboardingTeamComposition(null, "base verrouillée");
    expect(c.ok).toBe(false);
    const texte = c.lines.join(" ");
    expect(texte).toContain("base verrouillée");
    expect(texte).toContain("Réessayer");
    expect(texte).toContain("Équipe d'agents");
  });

  it("accepte les trois formes réelles du registre (objet, liste, fonction)", () => {
    expect(onboardingTeamAgents(registre()).agents).toHaveLength(3);
    expect(onboardingTeamAgents(registre().agents).agents).toHaveLength(3);
    expect(onboardingTeamAgents(() => registre()).agents).toHaveLength(3);
    // Une fonction qui échoue n'est jamais une exception.
    expect(onboardingTeamAgents(() => {
      throw new Error("boom");
    })).toEqual({ readable: false, agents: [] });
    expect(onboardingTeamAgents(undefined)).toEqual({ readable: false, agents: [] });
  });

  it("résume une équipe nombreuse au lieu d'afficher une liste sans fin", () => {
    const many = { agents: Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, name: `Agent ${i}` })) };
    const c = onboardingTeamComposition(many);
    expect(c.count).toBe(10);
    expect(c.names).toHaveLength(10);
    const ligne = c.lines.find((l) => l.includes("compte déjà")) || "";
    expect(ligne).toContain("…");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("niveau 2 — l'écran 2 : le premier geste, celui qui marche du premier coup", () => {
  it("avec une équipe en place, le premier geste est de LIRE une fiche, sans rien lancer", () => {
    const g = onboardingTeamFirstGesture(onboardingTeamComposition(registre()));
    expect(g.ok).toBe(true);
    expect(g.needsFirstAgents).toBe(false);
    const texte = g.lines.join(" ");
    expect(texte).toContain("crayon");
    expect(texte).toContain("rien n'est lancé");
    expect(texte).toContain("Assistant");
    // Aucune invitation à modifier l'équipe avant d'avoir lu.
    expect(g.lines[0]).not.toContain("↻");
  });

  it("sans aucun agent, le premier geste est de remettre une équipe en place", () => {
    const g = onboardingTeamFirstGesture(onboardingTeamComposition({ agents: [] }));
    expect(g.ok).toBe(false);
    expect(g.needsFirstAgents).toBe(true);
    expect(g.lines[0]).toContain("↻");
    expect(g.lines.length).toBeGreaterThan(1);
  });

  it("pendant la lecture de l'équipe, il ne raconte pas de chose fausse", () => {
    const g = onboardingTeamFirstGesture(null);
    expect(g.lines.length).toBeGreaterThan(0);
    expect(g.needsFirstAgents).toBe(false);
    // On ne prétend pas que l'équipe est vide avant de le savoir.
    expect(g.lines.join(" ")).not.toContain("↻");
    expect(g.lines.join(" ")).not.toContain("Aucun agent");
  });

  it("l'étape est annoncée et bornée aux deux écrans", () => {
    expect(onboardingTeamStepLabel(1)).toBe("Étape 1 sur 2");
    expect(onboardingTeamStepLabel(2)).toBe("Étape 2 sur 2");
    expect(onboardingTeamStepLabel(0)).toBe("Étape 1 sur 2");
    expect(onboardingTeamStepLabel(9)).toBe("Étape 2 sur 2");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DOM minimal : deux écrans, une navigation, et une sortie vers l'écran
// d'équipe EXISTANT (jamais une impasse).
function fakeEl(id, attrs = {}) {
  const classes = new Set();
  const listeners = new Map();
  const el = {
    id,
    attrs: { ...attrs },
    children: [],
    textContent: "",
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, on) => {
        const v = on === undefined ? !classes.has(c) : !!on;
        if (v) classes.add(c);
        else classes.delete(c);
        return v;
      },
    },
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    click: () => {
      for (const fn of listeners.get("click") || []) {
        fn({ preventDefault() {}, stopPropagation() {} });
      }
    },
    setAttribute: (k, v) => {
      el.attrs[k] = v;
    },
    removeAttribute: (k) => {
      delete el.attrs[k];
    },
    getAttribute: (k) => (k in el.attrs ? el.attrs[k] : null),
    replaceChildren: () => {
      el.children = [];
    },
    appendChild: (child) => {
      el.children.push(child);
      return child;
    },
  };
  return el;
}

function installerDom() {
  const sections = [
    fakeEl("ecran1", { "data-onboarding-team-screen": "1" }),
    fakeEl("ecran2", { "data-onboarding-team-screen": "2" }),
  ];
  const modal = fakeEl(ONBOARDING_TEAM_MODAL_ID);
  modal.querySelectorAll = (sel) =>
    sel === "[data-onboarding-team-screen]" ? sections : [];
  modal.querySelector = () => null; // pas de `.modal-content` à animer

  const nodes = new Map([[ONBOARDING_TEAM_MODAL_ID, modal]]);
  for (const id of [
    "onboarding-team-step",
    "onboarding-team-role-body",
    "onboarding-team-gesture-body",
    "btn-onboarding-team-retry",
    "btn-onboarding-team-skip",
    "btn-onboarding-team-prev",
    "btn-onboarding-team-next",
    "onboarding-team-close",
  ]) {
    nodes.set(id, fakeEl(id));
  }

  globalThis.document = {
    body: fakeEl("body"),
    getElementById: (id) => nodes.get(id) || null,
    createElement: () => fakeEl("p"),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  lastDom = { modal, sections, node: (id) => nodes.get(id) };
  return lastDom;
}

/** Dernier DOM simulé : sert à refermer proprement entre deux tests. */
let lastDom = null;

const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  // Aucune fenêtre ne reste ouverte d'un test à l'autre : la garde
  // « déjà ouverte » du module ne fausse donc jamais le test suivant.
  try {
    lastDom?.node("btn-onboarding-team-skip")?.click();
  } catch (_) {
    /* rien à refermer */
  }
  lastDom = null;
  delete globalThis.document;
});

describe("niveau 2 — les deux écrans se suivent, puis on arrive sur l'écran d'équipe", () => {
  it("ouvre l'écran 1, puis l'écran 2, puis ouvre l'onglet « Agents » existant", async () => {
    const dom = installerDom();
    const ouvertures = [];
    const tabs = { openFile: (label, mode) => ouvertures.push([label, mode]) };

    const res = await openOnboardingTeamModal({ gesture: true, registry: registre(), tabs });
    await tick();
    expect(res).toEqual({ shown: true, reason: "shown" });
    // Fenêtre visible, écran 1 seul.
    expect(dom.modal.classList.contains("hidden")).toBe(false);
    expect(dom.sections[0].classList.contains("hidden")).toBe(false);
    expect(dom.sections[1].classList.contains("hidden")).toBe(true);
    expect(dom.node("onboarding-team-step").textContent).toBe("Étape 1 sur 2");
    // Le constat de l'équipe est réellement affiché (et non une liste vide).
    expect(dom.node("onboarding-team-role-body").children.length).toBeGreaterThan(0);
    expect(dom.node("onboarding-team-gesture-body").children.length).toBeGreaterThan(0);
    // « Réessayer » est masqué quand l'équipe a été lue.
    expect(dom.node("btn-onboarding-team-retry").classList.contains("hidden")).toBe(true);

    // Suivant → écran 2.
    dom.node("btn-onboarding-team-next").click();
    expect(dom.sections[0].classList.contains("hidden")).toBe(true);
    expect(dom.sections[1].classList.contains("hidden")).toBe(false);
    expect(dom.node("onboarding-team-step").textContent).toBe("Étape 2 sur 2");
    expect(dom.node("btn-onboarding-team-next").textContent).toBe("Voir mon équipe d'agents");

    // Dernier « suivant » → l'écran d'équipe EXISTANT, puis fermeture.
    dom.node("btn-onboarding-team-next").click();
    await tick();
    expect(ouvertures).toEqual([[ONBOARDING_TEAM_AGENTS_TAB_LABEL, ONBOARDING_TEAM_AGENTS_TAB_MODE]]);
    expect(dom.modal.classList.contains("hidden")).toBe(true);
  });

  it("quand l'appelant fournit l'ouverture de l'écran d'équipe, c'est LUI qui est employé", async () => {
    const dom = installerDom();
    let appels = 0;
    await openOnboardingTeamModal({
      gesture: true,
      registry: registre(),
      openAgentsScreen: () => {
        appels += 1;
      },
      tabs: { openFile: () => { throw new Error("ne doit pas être employé"); } },
    });
    await tick();
    dom.node("btn-onboarding-team-next").click();
    dom.node("btn-onboarding-team-next").click();
    await tick();
    expect(appels).toBe(1);
    expect(dom.modal.classList.contains("hidden")).toBe(true);
  });

  it("ouvert depuis l'écran d'équipe (aucun onglet à ouvrir) : il se ferme, sans impasse", async () => {
    const dom = installerDom();
    await openOnboardingTeamModal({ gesture: true, registry: registre() });
    await tick();
    dom.node("btn-onboarding-team-next").click();
    dom.node("btn-onboarding-team-next").click();
    await tick();
    // L'utilisateur est déjà sur l'écran « Équipe d'agents » : rien d'autre à ouvrir.
    expect(dom.modal.classList.contains("hidden")).toBe(true);
  });

  it("« Fermer » ne décide rien : la fenêtre se ferme, rien n'est écrit", async () => {
    const dom = installerDom();
    await openOnboardingTeamModal({ gesture: true, registry: registre() });
    await tick();
    dom.node("btn-onboarding-team-skip").click();
    expect(dom.modal.classList.contains("hidden")).toBe(true);
    // Aucun écran d'équipe ouvert de force, aucune écriture : le module ne
    // connaît ni `save_config` ni un outil d'agent (vérifié plus haut).
  });

  it("un registre illisible affiche la cause et laisse « Réessayer » vivant", async () => {
    const dom = installerDom();
    let lectures = 0;
    await openOnboardingTeamModal({
      gesture: true,
      loadRegistry: () => {
        lectures += 1;
        if (lectures === 1) throw new Error("lecture refusée");
        return registre();
      },
    });
    await tick();
    expect(dom.node("btn-onboarding-team-retry").classList.contains("hidden")).toBe(false);
    const texte = dom.node("onboarding-team-role-body").children
      .map((c) => c.textContent)
      .join(" ");
    expect(texte).toContain("lecture refusée");
    expect(texte).toContain("Réessayer");

    // « Réessayer » relance réellement la lecture : le constat devient bon.
    dom.node("btn-onboarding-team-retry").click();
    await tick();
    await tick();
    expect(lectures).toBe(2);
    expect(dom.node("btn-onboarding-team-retry").classList.contains("hidden")).toBe(true);
    dom.node("btn-onboarding-team-skip").click();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("niveau 2 — apparence (tokens existants seulement)", () => {
  it("les entrées discrètes n'écrivent aucune couleur en dur ni aucun token", () => {
    const css = CSS();
    const bloc = sliceFrom(
      css,
      "PRISE EN MAIN — NIVEAU 2 : l'équipe d'agents (spec_onboarding.md)",
      400,
    );
    expect(bloc).toContain(".agents-learn-link");
    expect(bloc).toContain(".onboarding-link-btn");
    expect(bloc).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(bloc).not.toMatch(/\brgba?\(/);
    expect(bloc).not.toMatch(/^\s*--[a-z-]+\s*:/m);
    expect(bloc).toContain("var(--text-secondary)");
    expect(bloc).toContain("var(--bg-hover)");
  });
});
