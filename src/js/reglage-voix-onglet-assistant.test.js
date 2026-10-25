// reglage-voix-onglet-assistant.test.js — Le CHOIX DE LA VOIX de lecture doit
// vivre a UN SEUL endroit : Parametres → onglet « Assistant » → section
// « Lecture des reponses ». Ces controles echouent si :
//   1. le reglage sort de l'onglet Assistant (autre onglet, autre ecran) ;
//   2. un doublon reapparait ailleurs (autre selecteur, autre panneau) ;
//   3. un comportement exige se perd : « automatique » par defaut,
//      memorisation, repli propre si la voix memorisee a disparu, phrase claire
//      si la liste des voix est vide, bouton de lecture inactif avec
//      explication, aucune lecture automatique, une seule lecture a la fois.
//
// Aucun DOM reel : lectures de sources (comme settings-show-time.test.js) et
// fonctions pures de read-aloud.js executees pour de vrai.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  AUTO_VOICE_VALUE,
  NO_VOICE_HINT,
  NO_VOICE_INSTALLED_HINT,
  READ_ALOUD_HELP_HINT,
  READ_ALOUD_STATE_EVENT,
  availableVoices,
  voiceChoiceOptions,
  voiceChoiceStatus,
  resolveVoiceForChoice,
  findVoiceForChoice,
  readAloudStateLabel,
  applyVoicePreferenceFromConfig,
  setPreferredVoiceName,
  getPreferredVoiceName,
  createReadAloudButton,
  createSpeaker,
} from "./read-aloud.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
/** Source sans dependance aux fins de ligne (piege CI Windows, quality-gate 3.4). */
const read = (p) => readFileSync(resolve(root, p), "utf8").replace(/\r\n/g, "\n");

const VOICE_ID = "setting-read-aloud-voice";
const STATE_ID = "read-aloud-state";
const NOTE_ID = "read-aloud-voice-note";
const PANEL = 'data-settings-panel="superagent"';

/** Tranche de index.html qui contient l'onglet « Assistant » (panneau superagent). */
function superagentPanelHtml(html) {
  const start = html.indexOf(PANEL);
  expect(start, `panneau ${PANEL} introuvable`).toBeGreaterThan(-1);
  const next = html.indexOf('<div class="settings-panel"', start + 1);
  return html.slice(start, next === -1 ? undefined : next);
}

// ── 1. Emplacement : le reglage est dans l'onglet Assistant, et la ──────────

describe("emplacement — le choix de la voix vit dans Parametres → Assistant", () => {
  it("l'onglet Assistant (panneau superagent) porte le selecteur de voix", () => {
    const panel = superagentPanelHtml(read("index.html"));
    expect(panel).toContain(`id="${VOICE_ID}"`);
    expect(panel).toContain("<select");
    // Section clairement titree « Lecture des reponses a voix haute ».
    expect(panel).toMatch(/Lecture des r&eacute;ponses &agrave; voix haute/);
    // La section est UNE seule section de l'onglet (pas un ecran a part).
    const sections = panel.split('class="settings-section"').length - 1;
    expect(sections).toBeGreaterThanOrEqual(3);
  });

  it("voix, etat de lecture et explication sont groupes au meme endroit", () => {
    const panel = superagentPanelHtml(read("index.html"));
    const start = panel.indexOf('id="settings-section-read-aloud"');
    expect(start, "section « Lecture des reponses » absente").toBeGreaterThan(-1);
    const end = panel.indexOf('<div class="settings-panel"', start);
    const section = panel.slice(start, end === -1 ? undefined : end);
    // Les trois elements de la section, dans le meme bloc.
    expect(section).toContain(`id="${VOICE_ID}"`);
    expect(section).toContain(`id="${STATE_ID}"`);
    expect(section).toContain(`id="${NOTE_ID}"`);
    // Accessibilite : libelle relie au champ, etat annonce, note decrite.
    expect(section).toMatch(new RegExp(`<label for="${VOICE_ID}"`));
    expect(section).toMatch(new RegExp(`id="${STATE_ID}" role="status" aria-live="polite"`));
    expect(section).toMatch(new RegExp(`id="${VOICE_ID}" aria-describedby="${NOTE_ID} ${STATE_ID}"`));
  });

  it("aucun doublon ailleurs : la voix n'est nommee que dans cet onglet", () => {
    const html = read("index.html");
    // Un seul identifiant de selecteur de voix dans toute l'interface.
    expect(html.split(`id="${VOICE_ID}"`).length - 1).toBe(1);
    expect(html.split(`id="${STATE_ID}"`).length - 1).toBe(1);
    // Toute mention de « voix » de l'interface est dans le panneau Assistant
    // (aucun autre onglet, aucun autre ecran de reglage, aucune popup).
    const occurrences = html.toLowerCase().split("voix").length - 1;
    const inPanel = superagentPanelHtml(html).toLowerCase().split("voix").length - 1;
    expect(occurrences).toBe(inPanel);
    // Et aucun autre identifiant de reglage de lecture ailleurs.
    expect(html).not.toMatch(/id="setting-(?:superagent|agent|general|remote|mcp)-[^"]*voice/i);
  });

  it("une seule source de code : le selecteur n'est lu que par l'onglet Assistant", () => {
    const js = read("src/js/settings.js");
    // Un seul getElementById pour ce reglage (jamais un second branchement).
    expect(js.split(`getElementById("${VOICE_ID}")`).length - 1).toBe(1);
    // Il est rempli dans le rafraichissement de la section, appele au chargement
    // de la modale et a l'ouverture de l'onglet Assistant.
    expect(js).toMatch(/function refreshReadAloudVoice\(/);
    expect(js).toMatch(/refreshReadAloudVoice\(currentConfig && currentConfig\.read_aloud_voice\);/);
    expect(js).toMatch(/if \(key === "superagent"\) \{\s*\n\s*\/\/ On relit la liste des voix, mais on CONSERVE le choix en cours[\s\S]*?refreshReadAloudVoice\(selectReadAloudVoice \? selectReadAloudVoice\.value : undefined\);/);
    // Aucun autre module ne construit de selecteur de voix.
    for (const rel of ["src/js/agent-pi.js", "src/js/super-agent.js", "src/js/main.js"]) {
      expect(read(rel)).not.toMatch(/read-aloud-voice|readAloudVoice/);
    }
  });
});

// ── 2. « Automatique » par defaut, et memorisation ─────────────────────────

describe("comportement — automatique par defaut, puis memorisation", () => {
  afterEach(() => setPreferredVoiceName(""));

  it("sans configuration, le choix vaut « automatique » (champ vide)", () => {
    expect(AUTO_VOICE_VALUE).toBe("");
    // Le premier choix du selecteur est bien « automatique ».
    const html = read("index.html");
    const select = html.slice(html.indexOf(`id="${VOICE_ID}"`));
    expect(select).toMatch(/<option value="">Automatique/);
    // La configuration ecrite par les Parametres utilise '' quand le controle
    // est absent : jamais une voix imposee.
    const js = read("src/js/settings.js");
    expect(js).toMatch(/read_aloud_voice: selectReadAloudVoice \? selectReadAloudVoice\.value : "",/);
    // Cote Rust : champ a valeur par defaut vide (aucune migration requise).
    const rust = read("src-tauri/src/lib.rs");
    expect(rust).toMatch(/#\[serde\(default\)\]\s*\n\s*read_aloud_voice: String,/);
    expect(rust).toMatch(/read_aloud_voice: String::new\(\)/);
  });

  it("« automatique » prend la voix de la langue de l'interface", () => {
    const voices = [
      { lang: "en-US", name: "Alex", voiceURI: "Alex" },
      { lang: "fr-FR", name: "Amelie", voiceURI: "Amelie" },
    ];
    expect(resolveVoiceForChoice(voices, "fr-FR", AUTO_VOICE_VALUE).name).toBe("Amelie");
    expect(resolveVoiceForChoice(voices, "en-US", "").name).toBe("Alex");
  });

  it("le choix est memorise : applique au demarrage et a chaque enregistrement", () => {
    const main = read("src/js/main.js");
    // Au demarrage (lecture de la configuration)…
    expect(main).toMatch(/invoke\("get_config"\)\s*\n?\s*\.then\(\(cfg\) => applyVoicePreferenceFromConfig\(cfg\)\)/);
    // … et a chaque enregistrement des Parametres (evenement deja diffuse).
    expect(main).toMatch(/addEventListener\("pilot-config-changed", \(event\) => \{\s*\n\s*applyVoicePreferenceFromConfig\(event && event\.detail\);/);
    // La valeur est ecrite dans la configuration par la modale.
    expect(read("src/js/settings.js")).toMatch(/^\s*read_aloud_voice:/m);
    // La fonction applique la valeur memorisee, sans jamais inventer de voix.
    setPreferredVoiceName("");
    expect(getPreferredVoiceName()).toBe("");
    applyVoicePreferenceFromConfig({ read_aloud_voice: "Amelie" });
    expect(getPreferredVoiceName()).toBe("Amelie");
    applyVoicePreferenceFromConfig({ read_aloud_voice: "" });
    expect(getPreferredVoiceName()).toBe("");
    // Une configuration sans le champ ne touche pas au reglage en cours.
    setPreferredVoiceName("Amelie");
    applyVoicePreferenceFromConfig({ theme: "dark" });
    applyVoicePreferenceFromConfig(null);
    expect(getPreferredVoiceName()).toBe("Amelie");
  });
});

// ── 3. Repli propre si la voix memorisee a disparu ─────────────────────────

describe("comportement — voix memorisee disparue : repli propre", () => {
  it("retombe sur la voix de la langue de l'interface, sans erreur", () => {
    const voices = [
      { lang: "en-US", name: "Alex", voiceURI: "Alex" },
      { lang: "fr-FR", name: "Amelie", voiceURI: "Amelie" },
    ];
    expect(findVoiceForChoice(voices, "VoixDesinstallee")).toBe(null);
    const voice = resolveVoiceForChoice(voices, "fr-FR", "VoixDesinstallee");
    expect(voice && voice.name).toBe("Amelie");
    // Aucun plantage si la liste est vide.
    expect(resolveVoiceForChoice([], "fr-FR", "VoixDesinstallee")).toBe(null);
  });

  it("le panneau annonce le repli et remet le choix sur « automatique »", () => {
    const voices = [{ lang: "fr-FR", name: "Amelie", voiceURI: "Amelie" }];
    const status = voiceChoiceStatus(voices, "VoixDesinstallee");
    expect(status.kind).toBe("missing");
    expect(status.value).toBe(AUTO_VOICE_VALUE);
    expect(status.hint).toContain("VoixDesinstallee");
    expect(status.hint).toMatch(/plus disponible/);
    expect(status.hint).toMatch(/langue de l'interface/);
    // Le panneau applique bien la valeur de repli renvoyee par l'etat.
    expect(read("src/js/settings.js")).toMatch(/selectReadAloudVoice\.value = status\.value;/);
  });

  it("une voix encore presente reste selectionnee", () => {
    const voices = [
      { lang: "fr-FR", name: "Amelie", voiceURI: "Amelie" },
      { lang: "fr-FR", name: "Thomas", voiceURI: "Thomas" },
    ];
    const status = voiceChoiceStatus(voices, "Thomas");
    expect(status.kind).toBe("ok");
    expect(status.value).toBe("Thomas");
    expect(status.hint).toBe(READ_ALOUD_HELP_HINT);
    // Le choix n'est jamais duplique : une option par voix, plus « automatique ».
    const options = voiceChoiceOptions(voices);
    expect(options[0].value).toBe(AUTO_VOICE_VALUE);
    expect(options.map((o) => o.value)).toEqual(["", "Amelie", "Thomas"]);
  });
});

// ── 4. Liste vide : phrase claire, bouton inactif avec explication ─────────

describe("comportement — aucune voix installee : dit clairement quoi faire", () => {
  it("le panneau affiche une phrase explicite et desactive le reglage", () => {
    const status = voiceChoiceStatus([], "");
    expect(status.kind).toBe("empty");
    expect(status.hint).toBe(NO_VOICE_INSTALLED_HINT);
    expect(status.hint).toMatch(/Aucune voix n'est installee/);
    expect(status.hint).toMatch(/reste inactive/);
    expect(status.hint).toMatch(/Installez une voix/);
    const js = read("src/js/settings.js");
    expect(js).toMatch(/selectReadAloudVoice\.disabled = status\.kind === "empty";/);
    expect(js).toMatch(/readAloudVoiceNote\.textContent = status\.hint;/);
  });

  it("le bouton de lecture reste visible, inactif, avec l'explication", async () => {
    const win = fakeWindow({ voices: [] });
    const doc = fakeDoc();
    const button = createReadAloudButton({ doc, win, getText: () => "Un texte." });
    // Aucune lecture declenchee par la creation.
    expect(win.speechSynthesis.spoken.length).toBe(0);
    await button.handlers.click[0]();
    expect(win.speechSynthesis.spoken.length).toBe(0);
    expect(button.disabled).toBe(true);
    expect(button.dataset.readState).toBe("novoice");
    expect(button.title).toBe(NO_VOICE_HINT);
    expect(button.getAttribute("aria-label")).toBe(NO_VOICE_HINT);
    expect(button.classList.contains("agent-read-btn-unavailable")).toBe(true);
  });
});

// ── 5. Lecture : aucune lecture automatique, une seule a la fois ───────────

describe("comportement — lecture inchangee (pas d'auto, une seule voix)", () => {
  afterEach(() => setPreferredVoiceName(""));

  it("la voix choisie est celle utilisee pour lire", async () => {
    const win = fakeWindow({
      voices: [
        { lang: "fr-FR", name: "Amelie", voiceURI: "Amelie" },
        { lang: "fr-FR", name: "Thomas", voiceURI: "Thomas" },
      ],
    });
    const speaker = createSpeaker(win, { lang: "fr-FR" });
    setPreferredVoiceName("Thomas");
    await speaker.speak("Bonjour.");
    expect(win.speechSynthesis.spoken.length).toBe(1);
    expect(win.speechSynthesis.spoken[0].voice.name).toBe("Thomas");
  });

  it("aucune lecture tant que personne n'a clique", async () => {
    const win = fakeWindow({ voices: [{ lang: "fr-FR", name: "Amelie", voiceURI: "Amelie" }] });
    const doc = fakeDoc();
    const button = createReadAloudButton({ doc, win, getText: () => "Un texte." });
    expect(button.dataset.readState).toBe("idle");
    expect(button.disabled).toBe(false);
    // Plusieurs tours de boucle plus tard : toujours rien (pas d'auto-lecture).
    await Promise.resolve();
    await Promise.resolve();
    expect(win.speechSynthesis.spoken.length).toBe(0);
    expect(win.speechSynthesis.cancelCalls).toBe(0);
  });

  it("une seconde lecture arrete proprement la premiere", async () => {
    const win = fakeWindow({ voices: [{ lang: "fr-FR", name: "Amelie", voiceURI: "Amelie" }] });
    const premier = createSpeaker(win, { lang: "fr-FR" });
    await premier.speak("Premier message. Suite du premier.");
    const second = createSpeaker(win, { lang: "fr-FR" });
    await second.speak("Second message.");
    expect(win.speechSynthesis.cancelCalls).toBeGreaterThan(0);
    expect(premier.speaking()).toBe(false);
    expect(second.speaking()).toBe(true);
  });

  it("l'etat de lecture remonte au panneau des Parametres", async () => {
    const win = fakeWindow({ voices: [{ lang: "fr-FR", name: "Amelie", voiceURI: "Amelie" }] });
    const speaker = createSpeaker(win, { lang: "fr-FR" });
    await speaker.speak("Bonjour. ");
    const states = win.events.filter((e) => e.type === READ_ALOUD_STATE_EVENT).map((e) => e.detail.state);
    expect(states).toContain("speaking");
    expect(readAloudStateLabel("speaking")).toMatch(/Lecture en cours/);
    expect(readAloudStateLabel("")).toMatch(/Aucune lecture en cours/);
    // Le panneau ecoute cet evenement et l'affiche dans la ligne d'etat.
    const js = read("src/js/settings.js");
    expect(js).toMatch(/addEventListener\(READ_ALOUD_STATE_EVENT/);
    expect(js).toMatch(/readAloudStateEl\.textContent = readAloudStateLabel\(lastReadAloudState\)/);
  });

  it("availableVoices lit la liste reelle, jamais une liste inventee", () => {
    expect(availableVoices({})).toEqual([]);
    expect(availableVoices(fakeWindow({ voices: [] }))).toEqual([]);
    expect(availableVoices(fakeWindow({ voices: [{ lang: "fr-FR", name: "A" }] })).length).toBe(1);
  });
});

// ── 6. Documentation : le chemin exact est ecrit noir sur blanc ───────────

describe("documentation — le chemin exact est indique", () => {
  it("l'aide integree donne Options → onglet Assistant → Lecture des reponses", () => {
    const overview = read("help/overview.md");
    const bloc = overview.slice(
      overview.indexOf("<!-- HELP:lire-reponses -->"),
      overview.indexOf("<!-- /HELP:lire-reponses -->"),
    );
    expect(bloc.length).toBeGreaterThan(100);
    // Chemin exact, dans cet ordre.
    expect(bloc).toMatch(/Options → onglet\s*\n?\s*« Assistant »/);
    expect(bloc).toMatch(/« Lecture des réponses »/);
    // Et les comportements exiges y sont decrits pour l'utilisateur.
    expect(bloc).toMatch(/automatique/i);
    expect(bloc).toMatch(/mémorisé/);
    expect(bloc).toMatch(/reste visible mais \*\*inactif\*\*/);
  });

  it("le handbook genere reprend ce chemin (aide embarquee a jour)", () => {
    const handbook = read("help/handbook.md");
    expect(handbook).toContain("Options → onglet");
    expect(handbook).toMatch(/« Lecture des réponses »/);
  });

  it("le README indique le meme chemin unique", () => {
    const readme = read("README.md");
    expect(readme).toMatch(/Options → onglet « Assistant »/);
    expect(readme).toMatch(/« Lecture des réponses »/);
  });

  it("le spec de la fonctionnalite existe et nomme les deux tests", () => {
    const spec = read("spec_read_aloud.md");
    expect(spec).toContain("read_aloud_voice");
    expect(spec).toContain("reglage-voix-onglet-assistant.test.js");
    expect(spec).toMatch(/Options → onglet « Assistant »/);
  });
});

// ── Outils : DOM minimal et fausse synthese vocale ─────────────────────────

function fakeEl(tag) {
  const classesOf = (el) => String(el.className || "").split(/\s+/).filter(Boolean);
  const el = {
    tagName: tag,
    className: "",
    textContent: "",
    innerHTML: "",
    dataset: {},
    style: {},
    attrs: {},
    children: [],
    handlers: {},
    disabled: false,
    title: "",
    appendChild(c) {
      el.children.push(c);
      c.parentNode = el;
      return c;
    },
    addEventListener(type, fn) {
      (el.handlers[type] = el.handlers[type] || []).push(fn);
    },
    removeEventListener() {},
    setAttribute(name, value) {
      el.attrs[name] = String(value);
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(el.attrs, name) ? el.attrs[name] : null;
    },
    querySelector(selector) {
      const name = String(selector).replace(/^\./, "");
      const stack = [...el.children];
      while (stack.length) {
        const child = stack.shift();
        if (classesOf(child).includes(name)) return child;
        stack.push(...(child.children || []));
      }
      return null;
    },
    classList: {
      add(...names) {
        el.className = Array.from(new Set([...classesOf(el), ...names])).join(" ");
      },
      remove(...names) {
        el.className = classesOf(el).filter((c) => !names.includes(c)).join(" ");
      },
      toggle(name, force) {
        const on = force === undefined ? !classesOf(el).includes(name) : !!force;
        if (on) el.classList.add(name);
        else el.classList.remove(name);
        return on;
      },
      contains(name) {
        return classesOf(el).includes(name);
      },
    },
  };
  return el;
}

function fakeDoc() {
  return { createElement: fakeEl, documentElement: { lang: "fr" } };
}

class FakeUtterance {
  constructor(text) {
    this.text = text;
    this.lang = "";
    this.voice = null;
    this.onend = null;
    this.onerror = null;
  }
}

/** Fausse fenetre : synthese vocale silencieuse + journal des etats emis. */
function fakeWindow({ voices = [] } = {}) {
  const spoken = [];
  const events = [];
  const synth = {
    spoken,
    cancelCalls: 0,
    voices,
    speak(u) {
      spoken.push(u);
    },
    cancel() {
      synth.cancelCalls += 1;
    },
    getVoices() {
      return synth.voices;
    },
    addEventListener() {},
    removeEventListener() {},
  };
  return {
    speechSynthesis: synth,
    SpeechSynthesisUtterance: FakeUtterance,
    document: { documentElement: { lang: "fr" } },
    events,
    dispatchEvent(event) {
      events.push(event);
      return true;
    },
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = (init && init.detail) || {};
      }
    },
  };
}

beforeEach(() => setPreferredVoiceName(""));
