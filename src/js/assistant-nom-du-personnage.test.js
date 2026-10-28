// Tests — LE NOM DU PERSONNAGE ACTIF, DE BOUT EN BOUT (Présences → onglet 🧭)
//
// La mission est réduite au NOM : ce fichier ne parle pas de l'image.
//
// Ce qui manquait et que ce fichier verrouille (comportement RÉEL, pas une
// copie de la règle) : le module `assistant-persona.js` et les branchements
// étaient déjà testés séparément, mais le CHEMIN COMPLET ne l'était pas —
// lecture de `nom.txt` (côté Rust, simulée ici par la réponse de la commande)
// → état → nom POUSSÉ au bouton d'onglet → nom HABITUEL quand le fichier manque.
//
// Les quatre cas du contrat :
//   1. `nom.txt` PRÉSENT            → le nom du personnage est affiché ;
//   2. `nom.txt` ABSENT            → l'Assistant garde son nom habituel ;
//   3. `nom.txt` VIDE              → nom habituel, jamais un onglet sans nom ;
//   4. `nom.txt` ILLISIBLE / panne → nom habituel, JAMAIS d'exception ni de
//      bruit dans la console (l'absence n'est pas une panne).
// Plus : changer de personnage à chaud ne demande aucun redémarrage (une
// seconde relecture suffit) et le nom du personnage prime sur le nom réglé.
//
// Aucun navigateur : `super-agent.js` est un module d'interface, un `window` /
// `document` minimal est installé AVANT son évaluation (même procédé que
// `compteur-taches-travail.test.js`). La commande Rust est simulée : aucun test
// ne touche le vrai dossier `.pilot/portrait`.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { invokeState } = vi.hoisted(() => {
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
    src: "",
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
  return { invokeState: { impl: async () => ({}) } };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd) => invokeState.impl(cmd) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => "granted"),
  sendNotification: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn(), exit: vi.fn() }));

import {
  applyAssistantPersonaUi,
  refreshAssistantPersonaAndApply,
  superAgentDisplayLabel,
} from "./super-agent.js";
import {
  DEFAULT_ASSISTANT_NAME,
  getAssistantPersonaName,
  resetAssistantPersona,
} from "./assistant-persona.js";

/** Bouton d'onglet factice : enregistre les libellés reçus. */
function fauxTabs() {
  const libelles = [];
  return {
    libelles,
    tabs: {
      updateSuperAgentLabel(label) {
        libelles.push(label);
      },
    },
  };
}

beforeEach(() => {
  resetAssistantPersona();
  invokeState.impl = async () => ({});
  delete globalThis.window._pilotTabs;
  globalThis.document.querySelector = () => null;
});

afterEach(() => {
  delete globalThis.window._pilotTabs;
  resetAssistantPersona();
});

describe("nom du personnage : lecture → onglet", () => {
  it("nom.txt présent : le nom du personnage est affiché (et prime sur le nom habituel)", async () => {
    const tabs = fauxTabs();
    globalThis.window._pilotTabs = tabs.tabs;
    invokeState.impl = async (cmd) => {
      expect(cmd).toBe("read_assistant_persona");
      return { name: "Aurelia", portrait: null };
    };

    const affiche = await refreshAssistantPersonaAndApply();

    expect(getAssistantPersonaName()).toBe("Aurelia");
    expect(affiche).toBe("Aurelia");
    expect(superAgentDisplayLabel()).toBe("Aurelia");
    // Le nom est RÉELLEMENT poussé au bouton d'onglet, une fois.
    expect(tabs.libelles).toEqual(["Aurelia"]);
  });

  it("nom.txt absent : l'Assistant garde son nom habituel, sans exception", async () => {
    const tabs = fauxTabs();
    globalThis.window._pilotTabs = tabs.tabs;
    invokeState.impl = async () => ({});

    const affiche = await refreshAssistantPersonaAndApply();

    expect(getAssistantPersonaName()).toBe("");
    expect(affiche).toBe(DEFAULT_ASSISTANT_NAME);
    expect(tabs.libelles).toEqual([DEFAULT_ASSISTANT_NAME]);
  });

  it("nom.txt vide ou blanc : nom habituel, jamais un onglet sans nom", async () => {
    const tabs = fauxTabs();
    globalThis.window._pilotTabs = tabs.tabs;
    invokeState.impl = async () => ({ name: "   \r\n\t\r\n", portrait: null });

    const affiche = await refreshAssistantPersonaAndApply();

    expect(getAssistantPersonaName()).toBe("");
    expect(affiche).toBe(DEFAULT_ASSISTANT_NAME);
    expect(tabs.libelles).toEqual([DEFAULT_ASSISTANT_NAME]);
  });

  it("nom.txt illisible, commande absente ou IPC en panne : nom habituel, aucune exception, aucun bruit console", async () => {
    const tabs = fauxTabs();
    globalThis.window._pilotTabs = tabs.tabs;
    const bruit = [
      vi.spyOn(console, "error"),
      vi.spyOn(console, "warn"),
      vi.spyOn(console, "log"),
    ];

    // (a) contenu d'une autre forme que celle du socle ;
    invokeState.impl = async () => ({ name: { pas: "un nom" } });
    await expect(refreshAssistantPersonaAndApply()).resolves.toBe(DEFAULT_ASSISTANT_NAME);
    // (b) octets non décodables (le Rust rend alors `null`) ;
    invokeState.impl = async () => ({ name: null });
    await expect(refreshAssistantPersonaAndApply()).resolves.toBe(DEFAULT_ASSISTANT_NAME);
    // (c) commande absente / IPC en échec.
    invokeState.impl = async () => {
      throw new Error("commande absente");
    };
    await expect(refreshAssistantPersonaAndApply()).resolves.toBe(DEFAULT_ASSISTANT_NAME);

    // L'absence de personnage n'est PAS une panne : rien dans la console.
    for (const spy of bruit) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
    expect(getAssistantPersonaName()).toBe("");
    expect(tabs.libelles).toEqual([
      DEFAULT_ASSISTANT_NAME,
      DEFAULT_ASSISTANT_NAME,
      DEFAULT_ASSISTANT_NAME,
    ]);
  });

  it("changer de personnage ne demande aucun redémarrage : une relecture suffit", async () => {
    const tabs = fauxTabs();
    globalThis.window._pilotTabs = tabs.tabs;

    invokeState.impl = async () => ({ name: "Aurelia", portrait: null });
    await refreshAssistantPersonaAndApply();

    // Présences change de personnage : la lecture suivante (ouverture d'onglet
    // ou retour de focus) rend le nouveau nom, sans redémarrer Pilot.
    invokeState.impl = async () => ({ name: "Bertrand", portrait: null });
    await refreshAssistantPersonaAndApply();

    expect(tabs.libelles).toEqual(["Aurelia", "Bertrand"]);
    expect(superAgentDisplayLabel()).toBe("Bertrand");

    // Le personnage disparaît (fichier supprimé) : retour au nom habituel.
    invokeState.impl = async () => ({});
    await refreshAssistantPersonaAndApply();
    expect(tabs.libelles).toEqual(["Aurelia", "Bertrand", DEFAULT_ASSISTANT_NAME]);
  });

  it("le plein écran de l'Assistant porte le même nom", async () => {
    const titre = { textContent: "" };
    const image = { src: "/logo_pilot_vector.svg" };
    const overlay = { querySelector: (sel) => (sel === ".sa-immersive-hero-title" ? titre : image) };
    globalThis.document.querySelector = (sel) => (sel === ".superagent-immersive" ? overlay : null);

    invokeState.impl = async () => ({ name: "Aurelia", portrait: null });
    applyAssistantPersonaUi();
    await refreshAssistantPersonaAndApply();

    expect(titre.textContent).toBe("Bonjour, je suis Aurelia");
    expect(superAgentDisplayLabel()).toBe("Aurelia");
  });
});
