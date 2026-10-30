// Tests — DÉSACTIVATION (et ACTIVATION) COMPLÈTE DU PERSONNAGE, SANS REDÉMARRAGE
//
// Symptômes réels constatés le 2026-11-14 :
//   1. le personnage est désactivé dans Présences, mais sa photo reste affichée
//      et son nom reste sur l'onglet de l'assistant ;
//   2. une ancienne image subsiste dans l'ANCIEN dossier de données de Pilot
//      (`%APPDATA%\com.pilot.editor\.pilot\portrait\portrait.png`, 1,5 Mo) alors
//      que le dossier personnel dit « Aucun personnage » ;
//   3. l'état du personnage n'était lu qu'au démarrage / à l'ouverture de
//      l'onglet / au retour de focus : rien ne bougeait tant que Pilot n'était
//      pas redémarré.
//
// CE QUE CE FICHIER VERROUILLE (chaque test ÉCHOUE si le défaut revient) :
//   A. le nom de l'onglet est RECALCULÉ après désactivation — il ne peut pas
//      rester celui du personnage dans le DOM ;
//   B. l'image du personnage désactivé quitte l'écran (le portrait en mémoire
//      est vide ET son élément est masqué, sans `src` résiduel) ;
//   C. « Aucun personnage » n'est JAMAIS un nom affiché (c'est la phrase par
//      laquelle Présences dit qu'il n'y a pas de personnage) ;
//   D. une activation se voit sans redémarrer : l'empreinte du personnage change
//      → relecture → nom sur l'onglet et portrait en mémoire ;
//   E. le détecteur ne déclenche RIEN quand rien n'a changé, ne relit jamais le
//      personnage lui-même, ne lève jamais, et ne s'empile pas (un intervalle).
//
// Aucun navigateur, aucun fichier du propriétaire touché : `super-agent.js` est
// un module d'interface (un `window` / `document` minimal est installé AVANT son
// évaluation, même procédé que `assistant-nom-du-personnage.test.js`) et la
// commande Rust est simulée.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";

const { invokeState } = vi.hoisted(() => {
  const noop = () => {};
  const el = () => ({
    addEventListener: noop,
    removeEventListener: noop,
    appendChild: noop,
    remove: noop,
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    style: { setProperty: noop },
    dataset: {},
    querySelector: () => null,
    querySelectorAll: () => [],
    setAttribute: noop,
    getAttribute: () => null,
    hasAttribute: () => false,
    removeAttribute: noop,
    focus: noop,
    scrollIntoView: noop,
    insertAdjacentHTML: noop,
    innerHTML: "",
    textContent: "",
    value: "",
    src: "",
    hidden: false,
  });
  globalThis.window = globalThis;
  globalThis.innerWidth = 1280;
  globalThis.innerHeight = 720;
  globalThis.addEventListener = noop;
  globalThis.removeEventListener = noop;
  globalThis.dispatchEvent = noop;
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "276px" });
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
  globalThis.cancelAnimationFrame = noop;
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
  refreshSuperAgentConfig,
} from "./super-agent.js";
import {
  DEFAULT_ASSISTANT_NAME,
  PERSONA_STAMP_COMMAND,
  createPersonaWatcher,
  getAssistantPersona,
  getAssistantPortrait,
  isNoCharacterDeclaration,
  normalizePersona,
  normalizePersonaName,
  personaDisplayName,
  resetAssistantPersona,
  setAssistantPersona,
} from "./assistant-persona.js";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/wD/6Bb2AAAAAElFTkSuQmCC";
const DATA_URL = `data:image/png;base64,${PNG_BASE64}`;

/** Bouton d'onglet factice : enregistre les libellés reçus (aucun DOM). */
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

/**
 * Overlay vocal factice : seule la zone d'image du personnage nous intéresse.
 * `document.querySelector(".pilot-vocal")` le rend, les autres sélecteurs nul.
 */
function fauxOverlayVocal(portrait, legende) {
  const elements = {
    ".vocal-portrait": portrait,
    ".vocal-portrait-name": legende,
  };
  const ov = {
    style: { setProperty: () => {} },
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    querySelector: (sel) => elements[sel] || null,
    querySelectorAll: () => [],
    appendChild: () => {},
    setAttribute: () => {},
    getAttribute: () => null,
    remove: () => {},
    hidden: false,
  };
  globalThis.document.querySelector = (sel) => (sel === ".pilot-vocal" ? ov : null);
  return { ov, portrait, legende };
}

/** Image factice : suit `src`, `hidden` et l'attribut `src`. */
function fauxPortraitImg() {
  const attributs = new Map();
  return {
    hidden: false,
    // `img.src` (propriété) EST l'attribut `src` : c'est ce que le code écrit.
    get src() {
      return attributs.get("src") || "";
    },
    set src(valeur) {
      attributs.set("src", String(valeur));
    },
    getAttribute(nom) {
      return attributs.has(nom) ? attributs.get(nom) : null;
    },
    setAttribute(nom, valeur) {
      attributs.set(nom, valeur);
    },
    hasAttribute(nom) {
      return attributs.has(nom);
    },
    removeAttribute(nom) {
      attributs.delete(nom);
    },
  };
}

beforeEach(() => {
  resetAssistantPersona();
  delete globalThis.window._pilotTabs;
  globalThis.document.querySelector = () => null;
  invokeState.impl = async (cmd) => (cmd === "get_super_agent_config" ? { name: "Nova" } : {});
});

/** Charge le nom RÉGLÉ dans le cache de config du module (« Nova » par défaut). */
async function nomRegle(nom = "Nova") {
  invokeState.impl = async (cmd) => (cmd === "get_super_agent_config" ? { name: nom } : {});
  await refreshSuperAgentConfig();
}

afterEach(() => {
  delete globalThis.window._pilotTabs;
  resetAssistantPersona();
});

// ── A. Le nom de l'onglet est RECALCULÉ après désactivation ─────────────────
describe("A. désactivation : le nom de l'onglet est recalculé", () => {
  it("l'onglet repasse au nom réglé, il ne peut pas rester celui du personnage", async () => {
    const tabs = fauxTabs();
    globalThis.window._pilotTabs = tabs.tabs;
    await nomRegle();

    // Personnage actif (Présences dépose son nom).
    invokeState.impl = async (cmd) => {
      if (cmd === "get_super_agent_config") return { name: "Nova" };
      if (cmd === "read_assistant_persona") return { name: "Sylvie", portrait: null };
      return {};
    };
    expect(await refreshAssistantPersonaAndApply()).toBe("Sylvie");
    expect(tabs.libelles[tabs.libelles.length - 1]).toBe("Sylvie");

    // Désactivation : plus aucun personnage (le Rust rend un nom vide).
    invokeState.impl = async (cmd) => {
      if (cmd === "get_super_agent_config") return { name: "Nova" };
      if (cmd === "read_assistant_persona") return { name: null, portrait: null };
      return {};
    };
    expect(await refreshAssistantPersonaAndApply()).toBe("Nova");
    expect(tabs.libelles[tabs.libelles.length - 1]).toBe("Nova");
    // Le nom du personnage n'est PAS laissé figé dans le bouton d'onglet.
    expect(tabs.libelles[tabs.libelles.length - 1]).not.toBe("Sylvie");
  });

  it("sans nom réglé, l'onglet revient au nom habituel, jamais au personnage", async () => {
    const tabs = fauxTabs();
    globalThis.window._pilotTabs = tabs.tabs;
    await nomRegle(""); // aucun nom réglé dans ⚙️ → Assistant
    setAssistantPersona({ name: "Sylvie", portrait: DATA_URL });

    setAssistantPersona({ name: null, portrait: null });
    const label = applyAssistantPersonaUi();
    expect(label).toBe(DEFAULT_ASSISTANT_NAME);
    expect(tabs.libelles[tabs.libelles.length - 1]).toBe(DEFAULT_ASSISTANT_NAME);
  });

  it("« Aucun personnage » n'atteint jamais l'onglet : c'est une déclaration d'absence", async () => {
    const tabs = fauxTabs();
    globalThis.window._pilotTabs = tabs.tabs;
    await nomRegle();
    // Le socle aurait laissé passer la phrase telle quelle : le front la refuse.
    invokeState.impl = async (cmd) => {
      if (cmd === "get_super_agent_config") return { name: "Nova" };
      if (cmd === "read_assistant_persona") return { name: "Aucun personnage", portrait: null };
      return {};
    };
    expect(await refreshAssistantPersonaAndApply()).toBe("Nova");
    expect(tabs.libelles[tabs.libelles.length - 1]).toBe("Nova");
    expect(isNoCharacterDeclaration("Aucun personnage")).toBe(true);
    expect(normalizePersonaName("Aucun personnage")).toBe("");
    expect(normalizePersona({ name: "AUCUN PERSONNAGE.\n" }).name).toBe("");
    expect(personaDisplayName("", "")).toBe(DEFAULT_ASSISTANT_NAME);
  });
});

// ── B. L'image du personnage désactivé quitte l'écran ───────────────────────
describe("B. désactivation : la photo disparaît (silhouette)", () => {
  it("l'image de la zone du personnage est masquée, sans source résiduelle", () => {
    const img = fauxPortraitImg();
    const legende = { textContent: "", hidden: false };
    fauxOverlayVocal(img, legende);

    // Personnage actif : l'image est écrite et visible.
    setAssistantPersona({ name: "Sylvie", portrait: DATA_URL });
    applyAssistantPersonaUi();
    expect(img.getAttribute("src")).toBe(DATA_URL);
    expect(img.hidden).toBe(false);
    expect(legende.hidden).toBe(false);

    // Désactivation : plus rien du personnage à l'écran.
    setAssistantPersona({ name: null, portrait: null });
    applyAssistantPersonaUi();
    expect(getAssistantPortrait()).toBe("");
    expect(img.hidden).toBe(true);
    expect(img.hasAttribute("src")).toBe(false);
    expect(legende.hidden).toBe(true);
    expect(getAssistantPersona()).toEqual({ name: "", portrait: "" });
  });
});

// ── C/D/E. Mise à jour sans redémarrer : le détecteur de changement ────────
describe("D/E. activation et désactivation sans redémarrer Pilot", () => {
  it("l'empreinte est lue par la commande Rust, jamais le personnage lui-même", async () => {
    const commandes = [];
    const detecteur = createPersonaWatcher({
      invoke: async (cmd) => {
        commandes.push(cmd);
        return "empreinte-1";
      },
    });
    await detecteur.tick();
    expect(commandes).toEqual([PERSONA_STAMP_COMMAND]);
    expect(commandes).not.toContain("read_assistant_persona");
  });

  it("un changement d'empreinte déclenche UNE relecture, pas à chaque tick", async () => {
    let empreinte = "A";
    let lectures = 0;
    const detecteur = createPersonaWatcher({
      invoke: async () => empreinte,
      onChange: () => {
        lectures += 1;
      },
    });
    // Premier tick : référence, aucune relecture (l'état vient d'être lu).
    expect(await detecteur.tick()).toBe(false);
    expect(lectures).toBe(0);
    // Rien ne change : aucun appel supplémentaire.
    expect(await detecteur.tick()).toBe(false);
    expect(lectures).toBe(0);
    // Activation dans Présences : l'empreinte change → relecture.
    empreinte = "B";
    expect(await detecteur.tick()).toBe(true);
    expect(lectures).toBe(1);
    // Stable à nouveau : plus rien.
    expect(await detecteur.tick()).toBe(false);
    expect(lectures).toBe(1);
    // Désactivation : une seconde relecture, une seule.
    empreinte = "C";
    expect(await detecteur.tick()).toBe(true);
    expect(lectures).toBe(2);
    expect(detecteur.getChanges()).toBe(2);
  });

  it("empreinte changée → l'onglet suit, sans redémarrer Pilot (chaîne réelle)", async () => {
    // Chaîne RÉELLE : le détecteur appelle `refreshAssistantPersonaAndApply`,
    // exactement comme le fait `startPersonaWatch()` au démarrage.
    const tabs = fauxTabs();
    globalThis.window._pilotTabs = tabs.tabs;
    await nomRegle();

    let empreinte = "depot|sylvie";
    let personne = { name: "Sylvie", portrait: DATA_URL };
    const detecteur = createPersonaWatcher({
      invoke: async (cmd) => (cmd === PERSONA_STAMP_COMMAND ? empreinte : {}),
      onChange: () => {
        refreshAssistantPersonaAndApply().catch(() => {});
      },
    });
    invokeState.impl = async (cmd) => {
      if (cmd === "read_assistant_persona") return personne;
      if (cmd === "get_super_agent_config") return { name: "Nova" };
      return {};
    };
    await detecteur.tick(); // référence posée au démarrage
    await refreshAssistantPersonaAndApply();
    expect(tabs.libelles[tabs.libelles.length - 1]).toBe("Sylvie");

    // Le propriétaire désactive le personnage dans Présences, sans changer de
    // fenêtre : seule l'empreinte sur le disque bouge.
    empreinte = "depot|aucun-personnage";
    personne = { name: null, portrait: null };
    await detecteur.tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(tabs.libelles[tabs.libelles.length - 1]).toBe("Nova");
    expect(getAssistantPortrait()).toBe("");
  });

  it("le démarrage de Pilot démarre le détecteur (câblage verrouillé)", () => {
    const lire = (f) =>
      readFileSync(new URL(`./${f}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const main = lire("main.js");
    // Sans cet appel, une activation ou une désactivation ne se verrait qu'après
    // redémarrage : c'est exactement le défaut corrigé.
    expect(main).toContain("startPersonaWatch()");
    const superAgent = lire("super-agent.js");
    expect(superAgent).toContain("export function startPersonaWatch()");
    // Le détecteur ne lit JAMAIS le personnage : il relit par le chemin existant.
    const debut = superAgent.indexOf("export function startPersonaWatch()");
    const corps = superAgent.slice(debut, debut + 700);
    expect(corps).toContain("refreshAssistantPersonaAndApply");
    expect(corps).not.toContain("read_assistant_persona");
  });

  it("une panne du socle ne lève jamais et ne conclut rien", async () => {
    const detecteur = createPersonaWatcher({
      invoke: async () => {
        throw new Error("commande absente");
      },
      onChange: () => {
        throw new Error("ne doit pas être appelé");
      },
    });
    await expect(detecteur.tick()).resolves.toBe(false);
    expect(detecteur.getReference()).toBeNull();
    // Réponse d'une autre forme : même repli silencieux (empreinte vide).
    const bizarre = createPersonaWatcher({ invoke: async () => ({ pas: "une empreinte" }) });
    await expect(bizarre.tick()).resolves.toBe(false);
    expect(bizarre.getReference()).toBe("");
  });

  it("un seul intervalle, jamais deux comparaisons à la fois", async () => {
    let appels = 0;
    let armer;
    const detecteur = createPersonaWatcher({
      invoke: async () => {
        appels += 1;
        await new Promise((r) => setTimeout(r, 5));
        return String(appels);
      },
      intervalMs: 10,
      setInterval: (fn) => {
        armer = fn;
        return { unref: () => {} };
      },
      clearInterval: () => {},
    });
    detecteur.start();
    detecteur.start();
    detecteur.start();
    expect(typeof armer).toBe("function");
    expect(detecteur.isRunning()).toBe(true);
    // Deux comparaisons lancées en même temps : la seconde est ignorée.
    armer();
    await armer();
    expect(appels).toBe(1);
    detecteur.stop();
    expect(detecteur.isRunning()).toBe(false);
  });
});
