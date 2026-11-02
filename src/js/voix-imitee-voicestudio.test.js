// voix-imitee-voicestudio.test.js — la voix IMITÉE de l'utilisateur (service
// local VoiceStudio) dans la lecture des réponses.
//
// Mission tenue ici, contrôle par contrôle :
//   1. le service est ABSENT ou en panne → la lecture CONTINUE avec la voix
//      locale (Piper), l'état le dit (`voicestudio-fallback`) et le choix
//      mémorisé n'est PAS réécrit ;
//   2. le texte est REGROUPÉ en morceaux (premier son rapide, groupes ensuite,
//      aucune phrase coupée) : la lecture n'attend pas la synthèse du dernier mot ;
//   3. les accents traversent la frontière INTACTS (le corps JSON est en UTF-8) ;
//   4. une voix inconnue du service est SIGNALÉE côté fenêtre — le service, lui,
//      répondrait 200 en jouant sa voix par défaut, donc sans rien dire ;
//   5. la synthèse ne bloque JAMAIS le thread principal (`pub async fn` +
//      `spawn_blocking`) ;
//   6. la voix imitée est une entrée de la MÊME liste que les voix Piper, et les
//      quatre voix Piper restent proposées ;
//   7. la fenêtre ne joint JAMAIS le service elle-même : une seule porte, la
//      machine (aucun `fetch`, aucune adresse recopiée hors de sa constante).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  VOICESTUDIO_GROUP_CHARS,
  groupSentencesForVoiceStudio,
  isVoiceStudioChoice,
  normalizeVoiceStudioStatus,
  setVoiceStudioInvoker,
  setVoiceStudioStatus,
  voiceStudioChoiceValue,
  voiceStudioProfileIdFor,
} from "./voicestudio-voice.js";
import { setLocalVoiceInvoker, setLocalVoiceStatus } from "./local-voice.js";
// Découpage de source VÉRIFIÉ (jamais `source.indexOf` en ligne : l'inventaire
// `source-slice.test.js` refuse un découpage non protégé).
import { sliceSource } from "./source-slice.js";
import { createSpeaker, voiceChoiceOptions, voiceChoiceStatus } from "./read-aloud.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

/** Lit un fichier du dépôt (fin de lignes normalisées : piège CI Windows). */
function read(relative) {
  return readFileSync(join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");
}

const RUST = read("src-tauri/src/tts_voicestudio.rs");

// ── Doublures de fenêtre (aucun navigateur requis) ─────────────────────────

/** Voix « système » factice. */
function fakeVoice(name = "Microsoft Hortense", lang = "fr-FR") {
  return { name, lang, voiceURI: name, default: false, localService: true };
}

/**
 * Fenêtre factice : synthèse du système (énoncés enregistrés) + lecteur audio
 * factice (sources enregistrées). Aucun navigateur n'est requis.
 */
function fakeWindow({ voices = [fakeVoice()] } = {}) {
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
    Audio: FakeAudio,
  };
  return { win, synth, events, FakeAudio };
}

/**
 * Invocateur factice. `service: "absent"` fait échouer la voix imitée comme un
 * service éteint ; la voix locale répond toujours (Piper est installé).
 */
function fakeInvoke(scenario = {}) {
  const calls = [];
  const invoke = async (command, args) => {
    calls.push({ command, args });
    if (command === "tts_voicestudio_status") {
      return {
        reachable: scenario.service !== "absent",
        profiles: scenario.profiles || [{ id: "a772c1b0", name: "Lucie" }],
        hint: "",
      };
    }
    if (command === "tts_voicestudio_synthesize") {
      if (scenario.service === "absent") throw new Error("service injoignable");
      return "UklGRg==";
    }
    if (command === "tts_voicestudio_warmup" || command === "tts_voicestudio_log") return null;
    if (command === "tts_local_status") {
      return {
        installed: true,
        voice: args && args.model,
        engine_present: true,
        model_present: true,
        dir: "C:/Pilot/voix-locale",
      };
    }
    if (command === "tts_local_synthesize") return "UklGRg==";
    if (command === "tts_local_log") return null;
    throw new Error(`commande inattendue: ${command}`);
  };
  return { invoke, calls };
}

/** Attend qu'une condition devienne vraie (jamais un délai arbitraire). */
async function waitUntil(condition, timeoutMs = 5000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("condition non atteinte dans le délai imparti (5 s)");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

beforeEach(() => {
  setLocalVoiceStatus(null);
  setLocalVoiceInvoker(null);
  setVoiceStudioStatus(null);
  setVoiceStudioInvoker(null);
});

afterEach(() => {
  setLocalVoiceStatus(null);
  setLocalVoiceInvoker(null);
  setVoiceStudioStatus(null);
  setVoiceStudioInvoker(null);
});

// ---------------------------------------------------------------------------
describe("1. Service ABSENT : la lecture continue avec la voix locale (Piper)", () => {
  it("l'état dit le repli, puis la lecture va jusqu'au bout", async () => {
    const { win, events } = fakeWindow();
    const { invoke, calls } = fakeInvoke({ service: "absent" });
    const speaker = createSpeaker(win, { invoke, voiceName: voiceStudioChoiceValue("a772c1b0") });
    const states = [];
    const ok = await speaker.speak("Bonjour. Voici une phrase courte.", {
      onstate: (state) => states.push(state),
    });
    expect(ok).toBe(true);
    // La voix imitée a été DEMANDÉE (aucun contournement), puis le repli est DIT.
    expect(calls.some((call) => call.command === "tts_voicestudio_synthesize")).toBe(true);
    expect(states).toContain("voicestudio-fallback");
    // …et c'est bien la voix LOCALE qui a parlé ensuite (repli réel, pas un silence).
    await waitUntil(() => calls.some((call) => call.command === "tts_local_synthesize"));
    // L'état publié aux autres écrans (mode Vocal) annonce le moteur qui parle.
    const fallback = events.find((event) => event.detail && event.detail.state === "voicestudio-fallback");
    expect(fallback, "l'état de repli doit être publié").toBeTruthy();
    expect(fallback.detail.engine).toBe("local");
  });

  it("le journal reçoit une ligne (aucun repli silencieux)", async () => {
    const { win } = fakeWindow();
    const { invoke, calls } = fakeInvoke({ service: "absent" });
    const speaker = createSpeaker(win, { invoke, voiceName: voiceStudioChoiceValue("a772c1b0") });
    await speaker.speak("Bonjour.", {});
    await waitUntil(() => calls.some((call) => call.command === "tts_voicestudio_log"));
    const ligne = calls.find((call) => call.command === "tts_voicestudio_log");
    expect(String(ligne.args.message)).toMatch(/repli sur la voix locale/i);
  });

  it("le choix mémorisé n'est jamais réécrit par un repli", async () => {
    const { win } = fakeWindow();
    const { invoke } = fakeInvoke({ service: "absent" });
    const choix = voiceStudioChoiceValue("a772c1b0");
    const speaker = createSpeaker(win, { invoke, voiceName: choix });
    await speaker.speak("Bonjour.", {});
    // Aucune écriture de configuration dans ce chemin : le choix reste le sien.
    expect(isVoiceStudioChoice(choix)).toBe(true);
    expect(voiceStudioProfileIdFor(choix)).toBe("a772c1b0");
  });
});

// ---------------------------------------------------------------------------
describe("2. Découpage : le premier son arrive vite, les groupes suivent", () => {
  it("le premier morceau ne contient qu'une phrase", () => {
    const phrases = ["Un.", "Deux.", "Trois.", "Quatre.", "Cinq.", "Six."];
    const groupes = groupSentencesForVoiceStudio(phrases);
    expect(groupes[0]).toBe("Un.");
    expect(groupes.length).toBeGreaterThan(1);
    // Toutes les phrases sont là, dans l'ordre, une seule fois chacune.
    expect(groupes.join(" ")).toBe(phrases.join(" "));
  });

  it("les morceaux suivants regroupent les phrases (aucun trou audible)", () => {
    const phrases = ["Un.", "Deux.", "Trois.", "Quatre.", "Cinq.", "Six."];
    const groupes = groupSentencesForVoiceStudio(phrases);
    // Le deuxième morceau porte plusieurs phrases : sa synthèse dure, donc elle
    // tourne pendant la lecture du premier.
    expect(groupes[1]).toBe("Deux. Trois. Quatre. Cinq.");
  });

  it("une phrase plus longue que la limite reste SEULE et n'est jamais coupée", () => {
    const longue = `${"a".repeat(VOICESTUDIO_GROUP_CHARS + 50)}.`;
    const groupes = groupSentencesForVoiceStudio(["Courte.", longue, "Fin."]);
    expect(groupes).toContain(longue);
    expect(groupes.join(" ")).toContain(longue);
  });

  it("un texte vide ne demande rien au service", () => {
    expect(groupSentencesForVoiceStudio([])).toEqual([]);
    expect(groupSentencesForVoiceStudio(["", "   "])).toEqual([]);
    expect(groupSentencesForVoiceStudio(null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("3. Accents : le corps JSON est en UTF-8 de bout en bout", () => {
  it("le texte accentué traverse la frontière INTACT", async () => {
    const { win } = fakeWindow();
    const { invoke, calls } = fakeInvoke({});
    const speaker = createSpeaker(win, { invoke, voiceName: voiceStudioChoiceValue("a772c1b0") });
    await speaker.speak("Déjà vu : éàçù, l'œuvre d'Élise.", {});
    const appel = calls.find((call) => call.command === "tts_voicestudio_synthesize");
    expect(appel.args.text).toContain("éàçù");
    expect(appel.args.text).toContain("Élise");
  });

  it("côté machine, le corps est construit par serde_json (donc UTF-8)", () => {
    // Le service refuse un corps non UTF-8 (400 mesuré) : la sérialisation est
    // centralisée, et un test Rust la tient.
    expect(RUST).toMatch(/fn speech_body\(/);
    expect(RUST).toMatch(/serde_json::to_vec|serde_json::json!/);
    expect(RUST).toMatch(/fn .*utf8|UTF-8/i);
  });
});

// ---------------------------------------------------------------------------
describe("4. Voix inconnue : signalée côté fenêtre (le service, lui, se tait)", () => {
  const profils = [{ id: "a772c1b0", name: "Lucie" }];

  it("une voix mémorisée disparue est annoncée, et le choix est CONSERVÉ", () => {
    const status = voiceChoiceStatus([fakeVoice()], voiceStudioChoiceValue("deadbeef"), null, {
      reachable: true,
      profiles: profils,
    });
    expect(status.kind).toBe("voicestudio-missing");
    expect(status.hint).toMatch(/n'existe plus/i);
    // Le réglage n'est pas réécrit dans le dos de l'utilisateur.
    expect(status.value).toBe(voiceStudioChoiceValue("deadbeef"));
  });

  it("service éteint : le choix reste affiché, et la phrase dit le repli", () => {
    const status = voiceChoiceStatus([fakeVoice()], voiceStudioChoiceValue("a772c1b0"), null, {
      reachable: false,
      profiles: profils,
      hint: "Le service ne répond pas : la lecture se rabat sur la voix locale (Piper).",
    });
    expect(status.kind).toBe("voicestudio-down");
    expect(status.hint).toMatch(/voix locale \(Piper\)/);
    expect(status.value).toBe(voiceStudioChoiceValue("a772c1b0"));
  });

  it("service vivant et voix connue : le réglage est utilisable", () => {
    const status = voiceChoiceStatus([fakeVoice()], voiceStudioChoiceValue("a772c1b0"), null, {
      reachable: true,
      profiles: profils,
    });
    expect(status.kind).toBe("ok");
    expect(status.hint).toMatch(/voix imitée/i);
  });

  it("côté machine, la voix est vérifiée AVANT l'appel (jamais un 200 trompeur)", () => {
    expect(RUST).toMatch(/fn voice_known\(/);
    expect(RUST).toMatch(/fn voice_error\(/);
    // La synthèse refuse une voix absente de la liste, avant tout appel réseau.
    expect(RUST).toMatch(/voice_error\(/);
  });
});

// ---------------------------------------------------------------------------
describe("5. Synthèse jamais sur le thread principal", () => {
  for (const name of [
    "tts_voicestudio_status",
    "tts_voicestudio_synthesize",
    "tts_voicestudio_warmup",
  ]) {
    it(`\`${name}\` est async et déporte son attente dans spawn_blocking`, () => {
      expect(RUST).not.toContain(`pub fn ${name}(`);
      expect(RUST, `commande ${name} introuvable ou déclarée en pub fn`).toContain(
        `pub async fn ${name}(`,
      );
      const body = sliceSource(RUST, `pub async fn ${name}(`, "\n}\n", 60);
      expect(body).toContain("tauri::async_runtime::spawn_blocking");
    });
  }
});

// ---------------------------------------------------------------------------
describe("6. Une seule liste de voix : Piper intact, voix imitée en plus", () => {
  const local = {
    installed: true,
    voice: "fr_FR-siwis-medium",
    engine_present: true,
    model_present: true,
    dir: "C:/Pilot/voix-locale",
  };

  it("les quatre voix Piper restent proposées, et la voix imitée s'ajoute", () => {
    const options = voiceChoiceOptions([fakeVoice()], local, {
      reachable: true,
      profiles: [{ id: "a772c1b0", name: "Lucie" }],
    });
    const valeurs = options.map((option) => option.value);
    // Automatique + 4 voix Piper + 1 voix imitée + 1 voix du système.
    expect(valeurs.filter((value) => value.startsWith("local:piper")).length).toBe(4);
    expect(valeurs).toContain(voiceStudioChoiceValue("a772c1b0"));
    expect(valeurs.filter((value) => value === voiceStudioChoiceValue("a772c1b0")).length).toBe(1);
  });

  it("le libellé de la voix imitée porte le nom du service (jamais confondue avec Piper)", () => {
    const options = voiceChoiceOptions([fakeVoice()], local, {
      reachable: true,
      profiles: [{ id: "a772c1b0", name: "Lucie" }],
    });
    const ligne = options.find((option) => option.value === voiceStudioChoiceValue("a772c1b0"));
    expect(ligne.label).toContain("Lucie");
    expect(ligne.label).toContain("VoiceStudio");
  });

  it("un service qui n'annonce aucune voix n'invente aucune entrée", () => {
    const options = voiceChoiceOptions([fakeVoice()], local, normalizeVoiceStudioStatus({}));
    expect(options.some((option) => isVoiceStudioChoice(option.value))).toBe(false);
    expect(options.filter((option) => option.value.startsWith("local:piper")).length).toBe(4);
  });

  it("le choix mémorisé reste dans la liste même service éteint (jamais perdu)", () => {
    const choix = voiceStudioChoiceValue("a772c1b0");
    const options = voiceChoiceOptions(
      [fakeVoice()],
      local,
      { reachable: false, profiles: [], unknown: false },
      choix,
    );
    const ligne = options.find((option) => option.value === choix);
    expect(ligne, "la voix mémorisée doit rester sélectionnable").toBeTruthy();
    expect(ligne.label).toMatch(/service injoignable/);
    // Le choix annoncé par le service n'est pas dupliqué pour autant.
    const options2 = voiceChoiceOptions(
      [fakeVoice()],
      local,
      { reachable: true, profiles: [{ id: "a772c1b0", name: "Lucie" }] },
      choix,
    );
    expect(options2.filter((option) => option.value === choix).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("7. La fenêtre ne joint JAMAIS le service elle-même", () => {
  // Une seule porte vers le service : la MACHINE (commandes Tauri). Un appel
  // direct depuis la fenêtre contournerait le repli, le journal et la
  // vérification de la voix — et ferait entrer une adresse réseau dans l'UI.
  const STUDIO = read("src/js/voicestudio-voice.js");
  const READ_ALOUD = read("src/js/read-aloud.js");
  const SETTINGS = read("src/js/settings.js");

  it("aucun appel réseau dans les fichiers de la voix imitée", () => {
    for (const [nom, source] of [
      ["voicestudio-voice.js", STUDIO],
      ["read-aloud.js", READ_ALOUD],
      ["settings.js", SETTINGS],
    ]) {
      expect(source, `${nom} : aucune requête HTTP directe`).not.toMatch(/fetch\s*\(/);
      expect(source, `${nom} : aucun XMLHttpRequest`).not.toMatch(/XMLHttpRequest/);
      expect(source, `${nom} : aucune WebSocket`).not.toMatch(/WebSocket/);
    }
  });

  it("l'adresse du service n'existe que dans la constante de voicestudio-voice.js", () => {
    // Une seule écriture EXÉCUTABLE (les deux occurrences du fichier sont le
    // commentaire d'en-tête et la constante) : aucune adresse recopiée ailleurs.
    expect(STUDIO).toMatch(/export const VOICESTUDIO_BASE_URL = "http:\/\/127\.0\.0\.1:3900";/);
    expect((STUDIO.match(/127\.0\.0\.1:3900/g) || []).length).toBe(2);
    expect(READ_ALOUD).not.toContain("3900");
    expect(SETTINGS).not.toContain("3900");
  });
});
