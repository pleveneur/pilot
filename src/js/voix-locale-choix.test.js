// voix-locale-choix.test.js — CHOISIR la voix française locale (dont une voix
// d'homme) et télécharger son modèle sur un geste explicite.
//
// Ces contrôles tiennent la demande telle qu'elle a été formulée :
//   1. la liste des voix locales est celle du dépôt Piper (aucune voix
//      inventée), avec le GENRE dit en clair (« voix de femme » / « voix
//      d'homme ») et la taille réelle du modèle ;
//   2. un SEUL réglage gouverne la voix (`read_aloud_voice`) : la valeur choisie
//      est enregistrée telle quelle, sans second champ ;
//   3. compatibilité : la valeur historique continue de désigner la voix par
//      défaut, et un nom de modèle inconnu ne casse jamais la lecture ;
//   4. l'état d'UN modèle ne vaut jamais pour un autre (un modèle présent ne
//      fait pas croire qu'un autre l'est) ;
//   5. téléchargement UNIQUEMENT sur geste (aucun appel réseau à la lecture) ;
//   6. état du téléchargement visible, ARRÊT possible, arrêt qui n'efface rien ;
//   7. repli visible et journalisé : jamais de blocage, jamais d'exception.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_LOCAL_VOICE_MODEL,
  LOCAL_VOICE_LABEL,
  LOCAL_VOICE_MODELS,
  LOCAL_VOICE_NOT_INSTALLED_LABEL,
  LOCAL_VOICE_VALUE,
  cancelLocalVoiceDownload,
  downloadLocalVoiceModel,
  downloadProgressText,
  formatMegabytes,
  isLocalVoiceChoice,
  isLocalVoiceInstalledFor,
  localVoiceChoiceLabel,
  localVoiceChoices,
  localVoiceModelFor,
  localVoiceModelLabel,
  localVoiceStatusFor,
  localVoiceValueFor,
  normalizeDownloadState,
  refreshLocalVoiceDownloadState,
  refreshLocalVoiceStatus,
  normalizeLocalVoiceStatus,
  downloadDoneMessage,
  setLocalVoiceInvoker,
  setLocalVoiceStatus,
} from "./local-voice.js";
import { AUTO_VOICE_VALUE, createSpeaker, voiceChoiceOptions, voiceChoiceStatus } from "./read-aloud.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

/** Lit un fichier du dépôt (fins de ligne normalisées : piège CI Windows). */
function read(relative) {
  return readFileSync(join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");
}

/** Compte les occurrences d'un motif (les assertions doivent être chiffrées). */
function countOf(text, needle) {
  return text.split(needle).length - 1;
}

/**
 * Invocateur factice : répond aux commandes de la voix locale et refuse tout
 * téléchargement (une lecture ne doit JAMAIS en déclencher).
 * @param {{status?: object, audio?: string, synthesizeError?: string}} [scenario]
 */
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
    if (command === "tts_local_cancel_download") {
      return {
        model: "fr_FR-tom-medium",
        running: false,
        outcome: "cancelled",
        message: "Téléchargement arrêté : le modèle n'est pas installé.",
      };
    }
    if (command === "tts_local_download_state") {
      return { model: "", running: false, outcome: null, message: "" };
    }
    if (command === "tts_local_download") {
      throw new Error("téléchargement déclenché sans geste de l'utilisateur");
    }
    throw new Error(`commande inattendue: ${command}`);
  };
  return { invoke, calls };
}

/** Fenêtre minimale (voix système factice + lecteur audio factice). */
function fakeWindow() {
  const spoken = [];
  const synth = {
    spoken,
    getVoices: () => [{ name: "Microsoft Hortense", lang: "fr-FR", voiceURI: "h", default: false }],
    speak(utterance) {
      spoken.push(utterance);
      setTimeout(() => utterance.onend && utterance.onend(), 0);
    },
    cancel() {},
    addEventListener() {},
    removeEventListener() {},
  };
  class Utterance {
    constructor(text) {
      this.text = text;
      this.onend = null;
      this.onerror = null;
    }
  }
  class FakeAudio {
    constructor(src) {
      this.src = src;
      FakeAudio.played.push(this);
    }
    play() {
      setTimeout(() => this.onended && this.onended(), 0);
      return Promise.resolve();
    }
    pause() {}
  }
  FakeAudio.played = [];
  return { win: { speechSynthesis: synth, SpeechSynthesisUtterance: Utterance, Audio: FakeAudio }, synth };
}

beforeEach(() => {
  setLocalVoiceStatus(null);
  setLocalVoiceInvoker(null);
});

afterEach(() => {
  setLocalVoiceStatus(null);
  setLocalVoiceInvoker(null);
});

// ── 1. Catalogue et libellés ────────────────────────────────────────────────

describe("catalogue des voix locales", () => {
  it("propose plusieurs voix réelles, dont une voix d'homme ET une voix de femme", () => {
    expect(LOCAL_VOICE_MODELS.length).toBe(4);
    const genres = LOCAL_VOICE_MODELS.map((v) => v.gender);
    expect(genres).toContain("homme");
    expect(genres).toContain("femme");
    // Chaque entrée porte un modèle français réel, un genre et une taille
    // positive : aucun champ vide, aucun doublon de modèle.
    for (const voice of LOCAL_VOICE_MODELS) {
      expect(voice.model).toMatch(/^fr_FR-[a-z0-9_]+-(low|medium)$/);
      expect(["homme", "femme"]).toContain(voice.gender);
      expect(voice.bytes).toBeGreaterThan(1_000_000);
    }
    const models = LOCAL_VOICE_MODELS.map((v) => v.model);
    expect(new Set(models).size).toBe(models.length);
    // La voix par défaut (compatibilité) est la PREMIÈRE de la liste.
    expect(models[0]).toBe(DEFAULT_LOCAL_VOICE_MODEL);
  });

  it("le libellé d'une voix dit le genre et la qualité, en français", () => {
    expect(localVoiceModelLabel("fr_FR-tom-medium")).toMatch(/homme/);
    expect(localVoiceModelLabel("fr_FR-tom-medium")).toMatch(/qualité moyenne/);
    expect(localVoiceModelLabel("fr_FR-siwis-medium")).toMatch(/femme/);
    expect(localVoiceModelLabel("fr_FR-siwis-low")).toMatch(/qualité légère/);
    // Un modèle qui ne fait pas partie du catalogue est nommé tel quel : rien
    // n'est inventé sur son genre ou sa qualité.
    expect(localVoiceModelLabel("fr_FR-inconnu-low")).toContain("fr_FR-inconnu-low");
    expect(localVoiceModelLabel("fr_FR-inconnu-low")).not.toMatch(/homme|femme/);
    // Taille réelle du modèle, en mégaoctets (1 Mo = 1 048 576 octets).
    expect(formatMegabytes(63_511_038)).toBe("60,6 Mo");
  });

  it("chaque voix locale a SA valeur de réglage, la première restant historique", () => {
    const choices = localVoiceChoices();
    expect(choices.length).toBe(LOCAL_VOICE_MODELS.length);
    expect(choices[0].value).toBe(LOCAL_VOICE_VALUE);
    expect(choices[0].model).toBe(DEFAULT_LOCAL_VOICE_MODEL);
    // Les autres voix ont une valeur distincte, qui porte le nom du modèle.
    expect(choices[1].value).toBe(`${LOCAL_VOICE_VALUE}:${choices[1].model}`);
    expect(choices[1].label).toMatch(/homme|femme/);
    expect(new Set(choices.map((c) => c.value)).size).toBe(choices.length);
    // Le choix reste un choix LOCAL reconnu par la lecture.
    for (const choice of choices) expect(isLocalVoiceChoice(choice.value)).toBe(true);
    expect(localVoiceValueFor(DEFAULT_LOCAL_VOICE_MODEL)).toBe(LOCAL_VOICE_VALUE);
    expect(localVoiceValueFor("fr_FR-gilles-low")).toBe(`${LOCAL_VOICE_VALUE}:fr_FR-gilles-low`);
  });

  it("la liste des voix de la lecture les propose toutes, après « automatique »", () => {
    const voices = [{ name: "Microsoft Hortense", lang: "fr-FR", voiceURI: "h", default: false }];
    const options = voiceChoiceOptions(voices, { installed: true, voice: DEFAULT_LOCAL_VOICE_MODEL });
    expect(options[0].value).toBe(AUTO_VOICE_VALUE);
    const locaux = options.filter((o) => isLocalVoiceChoice(o.value));
    expect(locaux.length).toBe(LOCAL_VOICE_MODELS.length);
    // La voix par défaut garde son libellé d'état (installée / à télécharger).
    expect(options[1].label).toBe(LOCAL_VOICE_LABEL);
    // Les autres sont nommées avec leur genre : l'utilisateur voit « homme ».
    expect(locaux.some((o) => /homme/.test(o.label))).toBe(true);
    expect(locaux.some((o) => /femme/.test(o.label))).toBe(true);
  });
});

// ── 2. Un seul réglage, une valeur conservée telle quelle ───────────────────

describe("un seul réglage de la voix", () => {
  it("les Paramètres n'ajoutent aucun second champ de voix", () => {
    const html = read("index.html");
    // Un SEUL sélecteur de voix dans toute l'interface.
    expect(countOf(html, 'id="setting-read-aloud-voice"')).toBe(1);
    expect(countOf(html, 'id="read-aloud-local-note"')).toBe(1);
    // Les commandes du téléchargement vivent dans la MÊME section (un seul endroit).
    for (const id of [
      "read-aloud-download-state",
      "btn-read-aloud-download",
      "btn-read-aloud-download-cancel",
      "btn-read-aloud-recheck",
    ]) {
      expect(countOf(html, `id="${id}"`), `${id} manquant`).toBe(1);
    }
    // Aucune nouvelle clé de configuration (ni modèle, ni moteur séparé).
    const rust = read("src-tauri/src/lib.rs");
    expect(rust).not.toMatch(/read_aloud_(local|model|voice_model|tts|piper)/);
  });

  it("la valeur choisie est enregistrée TELLE QUELLE dans le champ unique", () => {
    const settings = read("src/js/settings.js");
    // Une seule écriture du réglage : la valeur du sélecteur, sans traduction.
    expect(settings).toMatch(/read_aloud_voice: selectReadAloudVoice \? selectReadAloudVoice\.value : ""/);
    // Le choix d'une voix locale passe par la valeur du catalogue, jamais par un
    // nom de modèle écrit à la main dans l'interface.
    expect(settings).not.toMatch(/fr_FR-[a-z0-9_]+-(low|medium)/);
  });
});

// ── 3. Compatibilité de la valeur historique ───────────────────────────────

describe("compatibilité de la valeur historique", () => {
  it("la valeur historique désigne la voix par défaut, un nom inconnu aussi", () => {
    expect(localVoiceModelFor(LOCAL_VOICE_VALUE)).toBe(DEFAULT_LOCAL_VOICE_MODEL);
    expect(localVoiceModelFor(`${LOCAL_VOICE_VALUE}:fr_FR-tom-medium`)).toBe("fr_FR-tom-medium");
    // Modèle inconnu (voix retirée d'une version à l'autre) : repli sur le
    // défaut, jamais une lecture cassée.
    expect(localVoiceModelFor(`${LOCAL_VOICE_VALUE}:fr_FR-ancienne-low`)).toBe(
      DEFAULT_LOCAL_VOICE_MODEL,
    );
    // Valeur non locale : aucun modèle local en jeu (null, jamais un nom).
    expect(localVoiceModelFor("Microsoft Hortense")).toBeNull();
    expect(localVoiceModelFor("")).toBeNull();
    // Une voix locale non installée reste un choix CONSERVÉ, avec sa valeur.
    const missing = voiceChoiceStatus([], `${LOCAL_VOICE_VALUE}:fr_FR-tom-medium`, {
      installed: false,
      dir: "C:/Pilot/voix-locale",
    });
    expect(missing.kind).toBe("local-missing");
    expect(missing.value).toBe(`${LOCAL_VOICE_VALUE}:fr_FR-tom-medium`);
    expect(missing.hint).toMatch(/voix du système/);
    expect(localVoiceChoiceLabel({ installed: false })).toBe(LOCAL_VOICE_NOT_INSTALLED_LABEL);
  });
});

// ── 4. L'état d'un modèle ne vaut jamais pour un autre ────────────────────
//
// C'est le contrôle qui prouve la correction : sans la comparaison du nom de
// modèle, une voix installée ferait croire que TOUTES le sont (lecture muette au
// lieu du repli annoncé).

describe("un état de moteur ne concerne qu'UN modèle", () => {
  it("un modèle installé ne rend pas les autres installés", () => {
    const siwis = setLocalVoiceStatus({ installed: true, voice: DEFAULT_LOCAL_VOICE_MODEL });
    // La voix d'homme n'est pas installée : le choix est conservé et expliqué.
    const tom = voiceChoiceStatus([], `${LOCAL_VOICE_VALUE}:fr_FR-tom-medium`, siwis);
    expect(tom.kind).toBe("local-missing");
    expect(tom.value).toBe(`${LOCAL_VOICE_VALUE}:fr_FR-tom-medium`);
    // La voix réellement installée est, elle, prête.
    const ready = voiceChoiceStatus([], LOCAL_VOICE_VALUE, siwis);
    expect(ready.kind).toBe("ok");
    expect(isLocalVoiceInstalledFor(DEFAULT_LOCAL_VOICE_MODEL)).toBe(true);
    expect(isLocalVoiceInstalledFor("fr_FR-tom-medium")).toBe(false);
  });

  it("l'état est mémorisé PAR modèle (aucune confusion entre deux voix)", async () => {
    const { invoke } = fakeInvoke({
      status: { installed: true, voice: "fr_FR-tom-medium", dir: "C:/Pilot/voix-locale" },
    });
    await refreshLocalVoiceStatus({ invoke, model: "fr_FR-tom-medium" });
    expect(localVoiceStatusFor("fr_FR-tom-medium").installed).toBe(true);
    expect(localVoiceStatusFor(DEFAULT_LOCAL_VOICE_MODEL)).toBeNull();
  });
});

// ── 5. Téléchargement : geste explicite seulement ─────────────────────────

describe("téléchargement du modèle", () => {
  it("une LECTURE ne déclenche jamais de téléchargement (aucun réseau à la lecture)", async () => {
    setLocalVoiceStatus({ installed: true, voice: "fr_FR-tom-medium", dir: "C:/Pilot/voix-locale" });
    const { win } = fakeWindow();
    const { invoke, calls } = fakeInvoke({ audio: "UklGRg==" });
    const speaker = createSpeaker(win, {
      lang: "fr-FR",
      invoke,
      voiceName: `${LOCAL_VOICE_VALUE}:fr_FR-tom-medium`,
      waitMs: 0,
    });
    await speaker.speak("Bonjour.", {});
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(calls.some((c) => c.command === "tts_local_download")).toBe(false);
    // La synthèse reçoit bien LE modèle choisi.
    const synth = calls.filter((c) => c.command === "tts_local_synthesize");
    expect(synth.length).toBeGreaterThan(0);
    expect(synth[0].args.model).toBe("fr_FR-tom-medium");
  });

  it("l'interface ne lance un téléchargement que depuis un geste", () => {
    const settings = read("src/js/settings.js");
    // Le téléchargement n'est demandé que dans `startReadAloudDownload`, et ce
    // dernier n'est appelé qu'avec `true` (geste) depuis un clic ou un change.
    expect(countOf(settings, "downloadLocalVoiceModel(")).toBe(1);
    expect(countOf(settings, "startReadAloudDownload(true)")).toBe(2);
    expect(countOf(settings, "startReadAloudDownload(")).toBe(3); // 2 gestes + définition
    // Le re-rendu de la section ne télécharge jamais.
    const render = settings.slice(
      settings.indexOf("function refreshReadAloudVoice("),
      settings.indexOf("function showDownloadState("),
    );
    expect(render).not.toContain("downloadLocalVoiceModel");
  });

  it("l'état du téléchargement est toujours lisible (taille, %, arrêt, échec)", () => {
    expect(downloadProgressText(null)).toBe("");
    expect(
      downloadProgressText({
        model: "fr_FR-tom-medium",
        running: true,
        percent: 42,
        bytes: 26_000_000,
        bytes_total: 63_511_038,
      }),
    ).toMatch(/Téléchargement de .*en cours \(42 %\)/);
    expect(
      downloadProgressText({
        model: "fr_FR-tom-medium",
        running: true,
        percent: 42,
        bytes: 26_000_000,
        bytes_total: 63_511_038,
      }),
    ).toMatch(/60,6 Mo/);
    expect(downloadProgressText({ model: "", running: true, percent: 3 })).toMatch(/en cours/);
    // Fin de téléchargement : succès SEULEMENT si la voix locale marche vraiment.
    expect(downloadProgressText({ outcome: "done" }, { installed: true })).toMatch(/hors ligne/);
    expect(downloadProgressText({ outcome: "done" }, { installed: false, engine_present: false })).toMatch(
      /pas encore utilisable/,
    );
    expect(
      downloadProgressText({ outcome: "done" }, { installed: false, engine_present: false }),
    ).not.toMatch(/hors ligne/);
    expect(downloadProgressText({ outcome: "done" }, null)).toMatch(/voix du système/);
    expect(downloadProgressText({ outcome: "cancelled" })).toMatch(/arrêté/i);
    expect(downloadProgressText({ outcome: "cancelled" })).toMatch(/voix du système/);
    expect(downloadProgressText({ outcome: "failed" })).toMatch(/impossible/i);
    expect(downloadProgressText({ outcome: "failed" })).toMatch(/voix du système/);
  });

  it("une panne de téléchargement ne lève pas : elle devient un état visible", async () => {
    const { invoke, calls } = fakeInvoke();
    const state = await downloadLocalVoiceModel("fr_FR-tom-medium", { invoke });
    expect(state.outcome).toBe("failed");
    expect(state.running).toBe(false);
    expect(state.message).toMatch(/impossible/i);
    // Journalisé dans le SEUL journal de la voix locale (repli annoncé).
    const logged = calls.filter((c) => c.command === "tts_local_log");
    expect(logged.length).toBe(1);
    expect(logged[0].args.message).toMatch(/voix du système/);
  });

  it("l'arrêt est possible, et il n'efface rien", async () => {
    const { invoke, calls } = fakeInvoke();
    const state = await cancelLocalVoiceDownload({ invoke });
    expect(calls.some((c) => c.command === "tts_local_cancel_download")).toBe(true);
    expect(state.outcome).toBe("cancelled");
    expect(state.running).toBe(false);
    // Aucune commande de suppression n'existe (le modèle déjà présent reste).
    expect(read("src-tauri/src/tts_local_download.rs")).not.toMatch(/remove_file\(/);
  });

  it("relire l'état d'un téléchargement ne lève jamais, même sans commande", async () => {
    const state = await refreshLocalVoiceDownloadState({
      invoke: async () => {
        throw new Error("hors ligne");
      },
    });
    expect(state.running).toBe(false);
    expect(state.outcome).toBeNull();
    expect(normalizeDownloadState({ running: 1 }).running).toBe(false);
  });
});

// ── Le moteur installé UNE fois sur l'ordinateur sert à toutes les versions ──
//
// Cas réel : le moteur Piper avait été installé à la main dans le dossier de
// données de la version installée (`com.pilot.editor`), et le mode test utilise
// un AUTRE dossier (`com.pilot.editor.dev`). Le moteur était donc jugé absent et
// la lecture retombait toujours sur la voix du système (Hortense), quelle que
// soit la voix choisie.

/** Voix système française unique du poste de test (Hortense). */
function FR_VOICE() {
  return { name: "Microsoft Hortense", lang: "fr-FR", voiceURI: "h", default: false };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

/** État « moteur trouvé dans l'autre version de Pilot », pour la voix d'homme. */
function sharedEngineStatus(model = "fr_FR-tom-medium") {
  return normalizeLocalVoiceStatus({
    installed: true,
    voice: model,
    engine_present: true,
    engine_shared: true,
    engine_dir: "C:/Users/x/AppData/Roaming/com.pilot.editor/voix-locale",
    dir: "C:/Users/x/AppData/Roaming/com.pilot.editor.dev/voix-locale",
    model_present: true,
    hint: "Voix française locale prête : lecture hors ligne.",
  });
}

describe("moteur déjà installé pour l'autre version de Pilot", () => {
  it("la voix CHOISIE est réellement parlée (aucun repli sur la voix du système)", async () => {
    const status = sharedEngineStatus();
    setLocalVoiceStatus(status);
    const choice = localVoiceValueFor("fr_FR-tom-medium");
    const voices = [FR_VOICE()];
    // Le réglage est CONSERVÉ et la voix est annoncée utilisable…
    expect(voiceChoiceStatus(voices, choice, status).kind).toBe("ok");

    const { win, synth } = fakeWindow();
    const { invoke, calls } = fakeInvoke({ status, audio: "UklGRg==" });
    const speaker = createSpeaker(win, { lang: "fr-FR", invoke, voiceName: choice, waitMs: 0 });
    const states = [];
    await speaker.speak("Bonjour.", { onstate: (state) => states.push(state) });
    await tick();

    // …le MOTEUR LOCAL est appelé, avec LE modèle choisi…
    const synthesized = calls.filter((c) => c.command === "tts_local_synthesize");
    expect(synthesized.length).toBeGreaterThan(0);
    expect(synthesized[0].args.model).toBe("fr_FR-tom-medium");
    // …et AUCUNE voix du système n'est prononcée (Hortense reste muette).
    expect(synth.spoken.length).toBe(0);
    expect(states).not.toContain("local-fallback");
  });

  it("le partage du moteur est VISIBLE (jamais un partage silencieux)", () => {
    const status = sharedEngineStatus();
    expect(status.engine_shared).toBe(true);
    expect(status.engine_dir).toContain("com.pilot.editor/voix-locale");
    // Le dossier des modèles reste celui de CETTE version de Pilot.
    expect(status.dir).toContain("com.pilot.editor.dev/voix-locale");
    // L'état normalisé d'un moteur absent ne prétend jamais le contraire.
    const absent = normalizeLocalVoiceStatus({ installed: false, engine_present: false });
    expect(absent.engine_shared).toBe(false);
    expect(absent.engine_dir).toBe("");
  });

  it("le code Rust cherche le moteur du même produit, et lui seul", () => {
    const rust = read("src-tauri/src/tts_local.rs");
    expect(rust).toMatch(/fn resolve_engine_root\(/);
    expect(rust).toMatch(/fn engine_candidate_roots\(/);
    expect(rust).toMatch(/fn status_for_dir_with_engine\(/);
    // Un identifiant voisin du même produit est accepté, un autre produit non.
    expect(rust).toMatch(/name == product \|\| name\.starts_with/);
    // Aucun fichier copié ni supprimé (le moteur est seulement lu).
    expect(rust).not.toMatch(/fn resolve_engine_root[\s\S]{0,600}copy\(/);
  });
});

// ── Un modèle téléchargé sans moteur ne s'annonce JAMAIS comme un succès ─────

describe("fin de téléchargement : jamais de succès mensonger", () => {
  it("modèle téléchargé mais moteur absent : avertissement, pas de succès", () => {
    const status = normalizeLocalVoiceStatus({
      installed: false,
      voice: "fr_FR-tom-medium",
      engine_present: false,
      dir: "C:/Users/x/AppData/Roaming/com.pilot.editor.dev/voix-locale",
    });
    const done = downloadDoneMessage({ outcome: "done" }, status, "fr_FR-tom-medium");
    expect(done.level).toBe("warning");
    expect(done.text).not.toMatch(/est installé\s*:/);
    expect(done.text).not.toMatch(/hors ligne/);
    expect(done.text).toMatch(/pas encore utilisable/);
    expect(done.text).toMatch(/voix du système/);
  });

  it("voix réellement utilisable : succès, et d'où vient le moteur", () => {
    const shared = downloadDoneMessage({ outcome: "done" }, sharedEngineStatus(), "fr_FR-tom-medium");
    expect(shared.level).toBe("success");
    expect(shared.text).toMatch(/hors ligne/);
    expect(shared.text).toContain("com.pilot.editor/voix-locale");
    const owned = downloadDoneMessage(
      { outcome: "done" },
      normalizeLocalVoiceStatus({ installed: true, voice: "fr_FR-tom-medium", engine_present: true }),
      "fr_FR-tom-medium",
    );
    expect(owned.level).toBe("success");
    // Arrêt et panne restent des avertissements/erreurs, jamais un succès.
    expect(downloadDoneMessage({ outcome: "cancelled" }, sharedEngineStatus()).level).toBe("warning");
    expect(downloadDoneMessage({ outcome: "failed", message: "réseau" }, sharedEngineStatus()).level).toBe(
      "error",
    );
    expect(downloadDoneMessage(null, null).level).toBe("info");
  });

  it("l'interface n'affiche plus l'ancien succès inconditionnel", () => {
    const settings = read("src/js/settings.js");
    expect(settings).not.toMatch(/installé : lecture hors ligne disponible/);
    expect(settings).toMatch(/downloadDoneMessage\(/);
    // Un message non-succès est JOURNALISÉ (le repli n'est jamais muet).
    expect(settings).toMatch(/logLocalVoice\(done\.text\)/);
  });
});

// ── La note affichée est claire, et non technique ────────────────────────────

describe("note du moteur local : claire et non technique", () => {
  it("moteur absent : « pas encore installée » + quoi faire, sans jargon", () => {
    const hint = voiceChoiceStatus([FR_VOICE()], LOCAL_VOICE_VALUE, {
      installed: false,
      engine_present: false,
      dir: "C:/Users/x/AppData/Roaming/com.pilot.editor.dev/voix-locale",
    }).hint;
    expect(hint).toContain("pas encore installée");
    expect(hint).toContain("Vérifier à nouveau");
    expect(hint).toContain("voix du système");
    expect(hint).toContain("com.pilot.editor.dev");
    // Aucun détail technique dans la phrase montrée à l'utilisateur.
    expect(hint).not.toMatch(/onnx|\.exe|espeak|DLL|RuntimeError/i);
  });

  it("moteur présent mais modèle absent : c'est le bouton « Télécharger » qui agit", () => {
    const hint = voiceChoiceStatus([FR_VOICE()], LOCAL_VOICE_VALUE, {
      installed: false,
      engine_present: true,
      dir: "C:/x",
    }).hint;
    expect(hint).toContain("pas encore installée");
    expect(hint).toContain("Télécharger");
    expect(hint).toContain("voix du système");
  });
});
