// repli-voix-muet.test.js — La voix locale qui ne peut pas servir ne doit pas
// être un silence trompeur.
//
// Défaut corrigé : pendant la lecture d'une réponse, quand la voix française
// LOCALE n'a pas pu être utilisée et que Pilot se rabat sur la voix du système,
// l'utilisateur n'en était informé QUE dans les Paramètres — fenêtre fermée à ce
// moment-là. Il entendait donc une autre voix que celle qu'il avait choisie,
// sans savoir pourquoi.
//
// Règle verrouillée ici :
//   1. en REPLI, une phrase courte et lisible apparaît À CÔTÉ du bouton
//      « 🔊 Écouter » de la réponse (une seule ligne, aucun bandeau) ;
//   2. quand la voix locale FONCTIONNE, aucune mention n'apparaît ;
//   3. quand aucune voix locale n'a été choisie, rien ne change : aucune mention.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LOCAL_AUDIO_PREFIX,
  LOCAL_VOICE_VALUE,
  setLocalVoiceInvoker,
  setLocalVoiceStatus,
} from "./local-voice.js";
import {
  createReadAloudButton,
  createSpeaker,
  localFailureShortCause,
  localVoiceMissingCause,
  readAloudFallbackNotice,
  setPreferredVoiceName,
} from "./read-aloud.js";

// ── Doublures (aucun navigateur requis) ────────────────────────────────────

/** Voix « système » factice. */
function fakeVoice(name = "Microsoft Hortense", lang = "fr-FR") {
  return { name, lang, voiceURI: name, default: false, localService: true };
}

/** Fenêtre factice : synthèse du système + lecteur audio (voix locale). */
function fakeWindow({ voices = [fakeVoice()] } = {}) {
  const spoken = [];
  const synth = {
    spoken,
    cancelCalls: 0,
    getVoices: () => voices.slice(),
    speak(utterance) {
      spoken.push(utterance);
      setTimeout(() => utterance.onend && utterance.onend(), 0);
    },
    cancel() {
      synth.cancelCalls += 1;
    },
    addEventListener() {},
    removeEventListener() {},
  };
  class Utterance {
    constructor(text) {
      this.text = text;
      this.lang = "";
      this.voice = null;
      this.onend = null;
      this.onerror = null;
    }
  }
  class FakeAudio {
    constructor(src) {
      this.src = src;
      this.paused = false;
      FakeAudio.played.push(this);
    }
    play() {
      setTimeout(() => this.onended && this.onended(), 0);
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
    }
  }
  FakeAudio.played = [];
  class FakeCustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = (init && init.detail) || null;
    }
  }
  const win = {
    speechSynthesis: synth,
    SpeechSynthesisUtterance: Utterance,
    CustomEvent: FakeCustomEvent,
    Audio: FakeAudio,
    dispatchEvent() {
      return true;
    },
  };
  return { win, synth, FakeAudio };
}

/** Invocateur factice du moteur de voix locale. */
function fakeInvoke(scenario = {}) {
  const calls = [];
  const invoke = async (command, args) => {
    calls.push({ command, args });
    if (command === "tts_local_status") {
      return scenario.status || { installed: false, dir: "C:/Pilot/voix-locale" };
    }
    if (command === "tts_local_synthesize") {
      if (scenario.synthesizeError) throw new Error(scenario.synthesizeError);
      return scenario.audio || "UklGRg==";
    }
    if (command === "tts_local_log") return null;
    throw new Error(`commande inattendue: ${command}`);
  };
  return { invoke, calls };
}

/** Document factice : juste ce qu'il faut pour créer et inspecter le bouton. */
function fakeDoc() {
  const classesOf = (el) => String(el.className || "").split(/\s+/).filter(Boolean);
  function descendants(el, out = []) {
    for (const child of el.children || []) {
      out.push(child);
      descendants(child, out);
    }
    return out;
  }
  function makeEl(tag) {
    const el = {
      tagName: tag,
      className: "",
      textContent: "",
      innerHTML: "",
      title: "",
      hidden: false,
      disabled: false,
      dataset: {},
      children: [],
      handlers: {},
      attrs: {},
      appendChild(c) {
        el.children.push(c);
        c.parentNode = el;
        return c;
      },
      removeChild(c) {
        el.children = el.children.filter((x) => x !== c);
        c.parentNode = null;
        return c;
      },
      querySelectorAll(selector) {
        const sel = String(selector || "").replace(/^\./, "");
        return descendants(el).filter((d) => classesOf(d).includes(sel));
      },
      querySelector(selector) {
        return el.querySelectorAll(selector)[0] || null;
      },
      addEventListener(type, fn) {
        (el.handlers[type] = el.handlers[type] || []).push(fn);
      },
      setAttribute(name, value) {
        el.attrs[name] = String(value);
      },
      getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(el.attrs, name) ? el.attrs[name] : null;
      },
      classList: {
        add(...names) {
          el.className = Array.from(new Set([...classesOf(el), ...names])).join(" ");
        },
        remove(...names) {
          el.className = classesOf(el)
            .filter((c) => !names.includes(c))
            .join(" ");
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
  const doc = {
    createElement: makeEl,
    getElementById: () => null,
    querySelector: () => null,
    documentElement: { lang: "fr-FR" },
  };
  return { doc, makeEl };
}

/** Laisse tourner les minuteries (lecture audio / synthèse factices). */
function tick() {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

beforeEach(() => {
  setLocalVoiceStatus(null);
  setLocalVoiceInvoker(null);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  setLocalVoiceStatus(null);
  setLocalVoiceInvoker(null);
  setPreferredVoiceName("");
});

// ── 1. La phrase elle-même ─────────────────────────────────────────────────

describe("phrase du repli", () => {
  it("dit que la voix locale n'a pas servi et que le système a pris le relais", () => {
    const phrase = readAloudFallbackNotice("moteur absent");
    expect(phrase).toMatch(/voix locale/i);
    expect(phrase).toMatch(/indisponible/i);
    expect(phrase).toMatch(/voix du syst\u00e8me/i);
    expect(phrase).toContain("moteur absent");
    // COURTE : une seule ligne, pas un paragraphe.
    expect(phrase.length).toBeLessThan(120);
    expect(phrase).not.toContain("\n");
  });

  it("reste compréhensible sans raison connue", () => {
    const phrase = readAloudFallbackNotice("");
    expect(phrase).toMatch(/voix du syst\u00e8me/i);
    expect(phrase).not.toContain("(");
  });

  it("nomme les causes réelles sans jargon (moteur, modèle, état, synthèse)", () => {
    expect(localVoiceMissingCause({ installed: false, engine_present: false })).toBe(
      "moteur absent",
    );
    expect(
      localVoiceMissingCause({ installed: false, engine_present: true, model_present: false }),
    ).toBe("mod\u00e8le incomplet");
    expect(localVoiceMissingCause({ installed: false, unknown: true })).toBe(
      "\u00e9tat du moteur inconnu",
    );
    expect(localVoiceMissingCause(null)).toBe("");
    expect(localFailureShortCause("unavailable")).toMatch(/synth\u00e8se locale/i);
    expect(localFailureShortCause("error")).toMatch(/son local/i);
    expect(localFailureShortCause("stopped")).toBe(""); // arrêt voulu : rien à dire
  });

  it("le lecteur transmet la cause courte avec l'état de repli", async () => {
    setLocalVoiceStatus({
      installed: false,
      engine_present: false,
      model_present: false,
      voice: "fr_FR-siwis-medium",
      dir: "C:/Pilot/voix-locale",
    });
    const { win } = fakeWindow();
    const { invoke } = fakeInvoke();
    const events = [];
    const speaker = createSpeaker(win, {
      lang: "fr-FR",
      invoke,
      voiceName: LOCAL_VOICE_VALUE,
      waitMs: 0,
    });
    await speaker.speak("Bonjour.", {
      onstate: (state, cause) => events.push({ state, cause }),
    });
    await tick();
    const fallback = events.find((e) => e.state === "local-fallback");
    expect(fallback).toBeTruthy();
    expect(fallback.cause).toBe("moteur absent");
  });
});

// ── 2. La mention est visible LÀ OÙ L'ON ÉCOUTE ────────────────────────────

describe("mention près du bouton d'écoute", () => {
  /** Crée un bouton posé dans une rangée (comme sous une réponse). */
  function makeButton({ win, invoke, getText = () => "Bonjour." }) {
    const { doc, makeEl } = fakeDoc();
    const holder = makeEl("div");
    holder.className = "agent-message-actions";
    const button = createReadAloudButton({
      doc,
      win,
      invoke,
      getText,
      lang: "fr-FR",
    });
    holder.appendChild(button);
    return { holder, button, doc };
  }

  it("CAS 1 — repli : la mention apparaît à côté du bouton, en texte lisible", async () => {
    setLocalVoiceStatus({
      installed: false,
      engine_present: false,
      model_present: false,
      voice: "fr_FR-siwis-medium",
      dir: "C:/Pilot/voix-locale",
    });
    setPreferredVoiceName(LOCAL_VOICE_VALUE);
    const { win, synth } = fakeWindow();
    const { invoke } = fakeInvoke();
    const { holder, button } = makeButton({ win, invoke });

    await button.handlers.click[0]();
    await tick();

    // La lecture a bien continué avec la voix du système…
    expect(synth.spoken.length).toBeGreaterThan(0);
    // …et la raison est dite LÀ OÙ L'UTILISATEUR REGARDE.
    const notice = holder.querySelector(".agent-read-notice");
    expect(notice).toBeTruthy();
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toMatch(/voix du syst\u00e8me/i);
    expect(notice.textContent).toContain("moteur absent");
    // Une ligne dans la rangée du bouton (pas une fenêtre, pas un bandeau).
    expect(notice.parentNode).toBe(holder);
    // La mention est CONSERVÉE une fois la lecture finie : l'utilisateur qui
    // n'aurait pas vu la ligne pendant qu'il écoutait la retrouve après coup,
    // et elle ne réapparaît pas sur une réponse dont la lecture est normale.
    expect(button.querySelector(".agent-read-label").textContent).toBe("\u00c9couter");
  });

  it("CAS 2 — voix locale qui fonctionne : AUCUNE mention", async () => {
    setLocalVoiceStatus({ installed: true, voice: "fr_FR-siwis-medium", dir: "C:/x" });
    setPreferredVoiceName(LOCAL_VOICE_VALUE);
    const { win, synth, FakeAudio } = fakeWindow();
    const { invoke } = fakeInvoke();
    const { holder, button } = makeButton({ win, invoke });

    await button.handlers.click[0]();
    await tick();

    expect(FakeAudio.played.length).toBeGreaterThan(0);
    expect(FakeAudio.played[0].src.startsWith(LOCAL_AUDIO_PREFIX)).toBe(true);
    expect(synth.spoken.length).toBe(0); // la voix du système n'a pas servi
    expect(holder.querySelector(".agent-read-notice")).toBeFalsy();
  });

  it("CAS 3 — aucune voix locale choisie : comportement inchangé, aucune mention", async () => {
    setPreferredVoiceName(""); // « Automatique » : voix du système
    const { win, synth } = fakeWindow();
    const { invoke, calls } = fakeInvoke();
    const { holder, button } = makeButton({ win, invoke });

    await button.handlers.click[0]();
    await tick();

    expect(synth.spoken.length).toBeGreaterThan(0);
    // Le moteur local n'est même pas interrogé : rien n'a changé par défaut.
    expect(calls.some((c) => c.command === "tts_local_status")).toBe(false);
    expect(calls.some((c) => c.command === "tts_local_synthesize")).toBe(false);
    expect(holder.querySelector(".agent-read-notice")).toBeFalsy();
  });

  it("la mention d'un repli disparaît quand une nouvelle lecture démarre", async () => {
    setLocalVoiceStatus({
      installed: false,
      engine_present: false,
      model_present: false,
      voice: "fr_FR-siwis-medium",
      dir: "C:/Pilot/voix-locale",
    });
    setPreferredVoiceName(LOCAL_VOICE_VALUE);
    const { win } = fakeWindow();
    const { invoke } = fakeInvoke();
    const { holder, button } = makeButton({ win, invoke });

    await button.handlers.click[0]();
    await tick();
    expect(holder.querySelector(".agent-read-notice")).toBeTruthy();

    // La voix locale est maintenant disponible : le repli ne s'applique plus.
    setLocalVoiceStatus({ installed: true, voice: "fr_FR-siwis-medium", dir: "C:/x" });
    await button.handlers.click[0]();
    await tick();
    expect(holder.querySelector(".agent-read-notice")).toBeFalsy();
  });
});
