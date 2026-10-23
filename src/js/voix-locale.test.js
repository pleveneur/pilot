// voix-locale.test.js — Voix française LOCALE (Piper) de la lecture à voix haute.
//
// Ces contrôles tiennent la mission telle qu'elle a été demandée :
//   1. un réglage UNIQUE pour choisir la voix (`read_aloud_voice`) et une seule
//      définition de la valeur qui active la voix locale ;
//   2. aucune valeur recopiée ailleurs (ni dans les Paramètres, ni dans l'index) ;
//   3. repli OBLIGATOIRE et VISIBLE : moteur absent ou synthèse en échec → la
//      lecture continue avec la voix du système, le dit dans l'état affiché et
//      écrit une ligne dans le journal ;
//   4. hors ligne : aucun appel réseau dans le module de voix locale ;
//   5. le texte envoyé au moteur local est le texte NETTOYÉ (mêmes règles qu'avant).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LOCAL_AUDIO_PREFIX,
  LOCAL_VOICE_LABEL,
  LOCAL_VOICE_NOT_INSTALLED_LABEL,
  LOCAL_VOICE_VALUE,
  getLocalVoiceStatus,
  isLocalVoiceChoice,
  localVoiceChoiceLabel,
  normalizeLocalVoiceStatus,
  playLocalChunks,
  setLocalVoiceInvoker,
  setLocalVoiceStatus,
  synthesizeSpeechAudio,
} from "./local-voice.js";
import {
  AUTO_VOICE_VALUE,
  createSpeaker,
  readAloudStateLabel,
  voiceChoiceOptions,
  voiceChoiceStatus,
} from "./read-aloud.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

/** Lit un fichier du dépôt (fin de lignes normalisées : piège CI Windows). */
function read(relative) {
  return readFileSync(join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");
}

/** Compte les occurrences d'un motif dans un texte. */
function countOf(text, needle) {
  return text.split(needle).length - 1;
}

// ── Doublures de fenêtre (aucun navigateur requis) ─────────────────────────

/** Voix « système » factice. */
function fakeVoice(name = "Microsoft Hortense", lang = "fr-FR") {
  return { name, lang, voiceURI: name, default: false, localService: true };
}

/**
 * Fenêtre factice : synthèse vocale du système (dont on enregistre les
 * énoncés) et un lecteur audio factice (dont on enregistre les sources).
 */
function fakeWindow({ voices = [fakeVoice()], withAudio = true } = {}) {
  const spoken = [];
  const events = [];
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
    dispatchEvent(event) {
      events.push(event);
      return true;
    },
  };
  if (withAudio) win.Audio = FakeAudio;
  return { win, synth, events, FakeAudio };
}

/** Invocateur factice : enregistre les appels et répond selon le scénario. */
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

/** Laisse tourner les minuteries (lecture audio factice). */
function tick() {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

beforeEach(() => {
  setLocalVoiceStatus(null);
  setLocalVoiceInvoker(null);
});

afterEach(() => {
  setLocalVoiceStatus(null);
  setLocalVoiceInvoker(null);
});

// ── 1. Réglage unique, aucune valeur recopiée ──────────────────────────────

describe("réglage unique de la voix", () => {
  it("la valeur de la voix locale est définie UNE seule fois, dans local-voice.js", () => {
    const needle = "local:" + "piper";
    expect(LOCAL_VOICE_VALUE).toBe(needle);
    expect(countOf(read("src/js/local-voice.js"), needle)).toBe(1);
    for (const file of [
      "src/js/read-aloud.js",
      "src/js/settings.js",
      "src/js/speech-text.js",
      "index.html",
      "src-tauri/src/tts_local.rs",
      "src-tauri/src/lib.rs",
    ]) {
      expect(countOf(read(file), needle), `${file} recopie la valeur`).toBe(0);
    }
  });

  it("le réglage de la voix reste un champ unique de la configuration", () => {
    const rust = read("src-tauri/src/lib.rs");
    // Un seul champ gouverne la voix (déclaration + valeur par défaut) : aucune
    // clé « moteur », « modèle » ou « voix locale » ajoutée ailleurs.
    expect(countOf(rust, "read_aloud_voice")).toBe(2);
    expect(countOf(rust, "read_aloud")).toBe(2);
    expect(rust).not.toMatch(/read_aloud_(engine|local|model|tts|piper)/);
    // L'interface n'écrit la valeur que par ce champ.
    expect(read("src/js/settings.js")).toMatch(/read_aloud_voice/);
  });

  it("le choix de la voix locale apparaît juste après « automatique »", () => {
    const voices = [fakeVoice("Microsoft Hortense", "fr-FR"), fakeVoice("Zira", "en-US")];
    const options = voiceChoiceOptions(voices, { installed: true, dir: "C:/x" });
    expect(options[0].value).toBe(AUTO_VOICE_VALUE);
    expect(options[1].value).toBe(LOCAL_VOICE_VALUE);
    expect(options[1].label).toBe(LOCAL_VOICE_LABEL);
    // Sans l'état du moteur, la liste historique est inchangée (aucun doublon).
    expect(voiceChoiceOptions(voices).some((o) => o.value === LOCAL_VOICE_VALUE)).toBe(false);
  });

  it("le libellé dit franchement « non installée » quand le moteur manque", () => {
    expect(localVoiceChoiceLabel({ installed: false })).toBe(LOCAL_VOICE_NOT_INSTALLED_LABEL);
    expect(localVoiceChoiceLabel({ installed: true })).toBe(LOCAL_VOICE_LABEL);
    expect(localVoiceChoiceLabel(null)).toBe(LOCAL_VOICE_NOT_INSTALLED_LABEL);
    expect(isLocalVoiceChoice(LOCAL_VOICE_VALUE)).toBe(true);
    expect(isLocalVoiceChoice("")).toBe(false);
    expect(isLocalVoiceChoice("Microsoft Hortense")).toBe(false);
  });

  it("un choix local non installé est CONSERVÉ et expliqué (pas de choix perdu)", () => {
    const voices = [fakeVoice()];
    const status = voiceChoiceStatus(voices, LOCAL_VOICE_VALUE, {
      installed: false,
      dir: "C:/Pilot/voix-locale",
    });
    expect(status.kind).toBe("local-missing");
    expect(status.value).toBe(LOCAL_VOICE_VALUE);
    expect(status.hint).toContain("voix du système");
    expect(status.hint).toContain("C:/Pilot/voix-locale");
    const ready = voiceChoiceStatus(voices, LOCAL_VOICE_VALUE, { installed: true, dir: "C:/x" });
    expect(ready.kind).toBe("ok");
    expect(ready.hint).toContain("hors ligne");
  });

  it("l'état de repli est dit en clair dans le panneau", () => {
    expect(readAloudStateLabel("local-fallback")).toMatch(/voix du système/i);
    expect(readAloudStateLabel("local-fallback")).toMatch(/journal/i);
  });

  it("l'état du moteur est normalisé (jamais de champ inventé)", () => {
    const status = normalizeLocalVoiceStatus(null);
    expect(status.installed).toBe(false);
    expect(status.engine).toBe("Piper");
    expect(status.voice).toBe("fr_FR-siwis-medium");
    expect(status.hint).toContain("voix du système");
    expect(normalizeLocalVoiceStatus({ installed: true }).installed).toBe(true);
    expect(getLocalVoiceStatus()).toBeNull();
    expect(setLocalVoiceStatus({ installed: true }).installed).toBe(true);
  });
});

// ── 2. Hors ligne ───────────────────────────────────────────────────────────

describe("hors ligne", () => {
  it("le module de voix locale ne fait AUCUN appel réseau", () => {
    const source = read("src/js/local-voice.js");
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/XMLHttpRequest/);
    expect(source).not.toMatch(/WebSocket/);
    expect(source).not.toMatch(/https?:\/\//);
    // Aucune bibliothèque exigeant une clé, un compte ou un GPU.
    expect(source).not.toMatch(/api[_-]?key/i);
    expect(source).not.toMatch(/cuda|gpu-accelerat/i);
  });

  it("le moteur Rust est un processus LOCAL, sans réseau", () => {
    const rust = read("src-tauri/src/tts_local.rs");
    expect(rust).not.toMatch(/reqwest|hyper|ureq/);
    expect(rust).not.toMatch(/https?:\/\//);
    // Il lance bien le moteur local, sans fenêtre noire sous Windows.
    expect(rust).toMatch(/Command::new/);
    expect(rust).toMatch(/CREATE_NO_WINDOW/);
  });
});

// ── 3. Synthèse, lecture et repli ───────────────────────────────────────────

describe("lecture locale et repli", () => {
  it("le texte envoyé au moteur local est NETTOYÉ (aucun emoji, aucun balisage)", async () => {
    setLocalVoiceStatus({ installed: true, dir: "C:/x" });
    const { win } = fakeWindow();
    const { invoke, calls } = fakeInvoke({ audio: "UklGRg==" });
    const speaker = createSpeaker(win, {
      lang: "fr-FR",
      invoke,
      voiceName: LOCAL_VOICE_VALUE,
      waitMs: 0,
    });
    await speaker.speak("## Titre\n**gras** et [lien](https://exemple.test) \u{1F600}", {});
    await tick();
    const synthesized = calls
      .filter((c) => c.command === "tts_local_synthesize")
      .map((c) => c.args.text)
      .join(" ");
    expect(synthesized).toContain("Titre");
    expect(synthesized).toContain("gras");
    expect(synthesized).toContain("lien"); // le lien est lu par son libellé
    expect(synthesized).not.toContain("##");
    expect(synthesized).not.toContain("**");
    expect(synthesized).not.toContain("https://");
    expect(synthesized).not.toContain("\u{1F600}");
  });

  it("une synthèse impossible renvoie null SANS lever et journalise", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { invoke, calls } = fakeInvoke({ synthesizeError: "moteur absent" });
    const url = await synthesizeSpeechAudio("Bonjour.", { invoke });
    expect(url).toBeNull();
    const logged = calls.filter((c) => c.command === "tts_local_log");
    expect(logged.length).toBe(1);
    expect(logged[0].args.message).toMatch(/repli sur la voix du systeme|repli sur la voix du système/i);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("la voix locale lit par le moteur local, sans passer par la voix du système", async () => {
    setLocalVoiceStatus({ installed: true, dir: "C:/x" });
    const { win, synth, FakeAudio } = fakeWindow();
    const { invoke, calls } = fakeInvoke({ audio: "UklGRg==" });
    const states = [];
    const speaker = createSpeaker(win, {
      lang: "fr-FR",
      invoke,
      voiceName: LOCAL_VOICE_VALUE,
      waitMs: 0,
    });
    const ok = await speaker.speak("Bonjour tout le monde. Deuxième phrase.", {
      onstate: (state) => states.push(state),
    });
    await tick();
    expect(ok).toBe(true);
    expect(synth.spoken.length).toBe(0); // la voix du système n'est pas utilisée
    expect(FakeAudio.played.length).toBeGreaterThan(0);
    expect(FakeAudio.played[0].src.startsWith(LOCAL_AUDIO_PREFIX)).toBe(true);
    expect(calls.filter((c) => c.command === "tts_local_synthesize").length).toBeGreaterThan(0);
    expect(states).toContain("speaking");
    expect(states).toContain("ended");
    expect(states).not.toContain("local-fallback");
  });

  it("moteur local en échec : la lecture CONTINUE avec la voix du système et le dit", async () => {
    setLocalVoiceStatus({ installed: true, dir: "C:/x" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { win, synth, events } = fakeWindow();
    const { invoke, calls } = fakeInvoke({ synthesizeError: "piper introuvable" });
    const states = [];
    const speaker = createSpeaker(win, {
      lang: "fr-FR",
      invoke,
      voiceName: LOCAL_VOICE_VALUE,
      waitMs: 0,
    });
    const ok = await speaker.speak("Bonjour.", { onstate: (state) => states.push(state) });
    await tick();
    expect(ok).toBe(true); // la promesse se termine : rien ne bloque
    expect(synth.spoken.length).toBeGreaterThan(0); // repli effectif sur le système
    expect(states).toContain("local-fallback");
    // Journal : au moins une ligne claire, dans le SEUL journal de la voix locale.
    const logged = calls.filter((c) => c.command === "tts_local_log");
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.map((c) => c.args.message).join(" ")).toMatch(/repli sur la voix du systeme/i);
    // L'interface reçoit aussi l'état (panneau des Paramètres).
    expect(events.some((e) => e.detail && e.detail.state === "local-fallback")).toBe(true);
    warn.mockRestore();
  });

  it("moteur local NON installé : repli immédiat, visible, sur la voix du système", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setLocalVoiceStatus({ installed: false, dir: "C:/Pilot/voix-locale", hint: "moteur absent" });
    const { win, synth } = fakeWindow();
    const { invoke, calls } = fakeInvoke();
    const states = [];
    const speaker = createSpeaker(win, {
      lang: "fr-FR",
      invoke,
      voiceName: LOCAL_VOICE_VALUE,
      waitMs: 0,
    });
    await speaker.speak("Bonjour.", { onstate: (state) => states.push(state) });
    await tick();
    expect(synth.spoken.length).toBeGreaterThan(0);
    expect(states).toContain("local-fallback");
    // Aucune synthèse tentée : on ne lance pas un moteur qui n'est pas là.
    expect(calls.some((c) => c.command === "tts_local_synthesize")).toBe(false);
    const logged = calls.filter((c) => c.command === "tts_local_log");
    expect(logged[0].args.message).toMatch(/non installee|non installée/i);
    warn.mockRestore();
  });

  it("sans lecteur audio dans la fenêtre, le repli reste propre (état + journal)", async () => {
    setLocalVoiceStatus({ installed: true, dir: "C:/x" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { invoke } = fakeInvoke({ audio: "UklGRg==" });
    const outcome = await playLocalChunks({
      win: { speechSynthesis: null },
      chunks: ["Bonjour."],
      invoke,
    });
    expect(outcome).toEqual({ played: false, reason: "no-audio" });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("une réponse vide n'appelle jamais le moteur local", async () => {
    setLocalVoiceStatus({ installed: true, dir: "C:/x" });
    const { win } = fakeWindow();
    const { invoke, calls } = fakeInvoke();
    const states = [];
    const speaker = createSpeaker(win, {
      lang: "fr-FR",
      invoke,
      voiceName: LOCAL_VOICE_VALUE,
      waitMs: 0,
    });
    const ok = await speaker.speak("   \n  ", { onstate: (state) => states.push(state) });
    expect(ok).toBe(false);
    expect(states).toContain("empty");
    expect(calls.length).toBe(0);
  });

  it("l'arrêt coupe le son local (une seule lecture à la fois)", async () => {
    setLocalVoiceStatus({ installed: true, dir: "C:/x" });
    const { win, FakeAudio } = fakeWindow();
    const { invoke } = fakeInvoke({ audio: "UklGRg==" });
    const speaker = createSpeaker(win, {
      lang: "fr-FR",
      invoke,
      voiceName: LOCAL_VOICE_VALUE,
      waitMs: 0,
    });
    const pending = speaker.speak("Phrase une. Phrase deux. Phrase trois.", {});
    await tick();
    speaker.stop();
    await pending;
    // Au moins un son a été lancé puis mis en pause : plus rien ne joue.
    expect(FakeAudio.played.length).toBeGreaterThan(0);
    expect(FakeAudio.played.some((audio) => audio.paused)).toBe(true);
  });
});
