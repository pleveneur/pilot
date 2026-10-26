// voix-locales-chargement-automatique.test.js — L'ÉTAT DU MOTEUR DE VOIX LOCALE
// SE CHARGE TOUT SEUL dans les Paramètres (« là faut juste charger en
// automatique », décision du propriétaire).
//
// Ce que ces contrôles tiennent, dans l'ordre de la demande :
//   1. la section « Lecture des réponses » (onglet Assistant) demande l'état du
//      moteur SANS AUCUN CLIC, même quand le réglage vaut « Automatique » : la
//      liste des voix locales et la ligne d'état se remplissent seules ;
//   2. c'est EXACTEMENT la vérification du bouton « Vérifier à nouveau » : une
//      seule fonction (`checkLocalVoiceStatus`), donc une seule commande et un
//      seul traitement — aucun second mécanisme parallèle ;
//   3. une seule fois par ouverture des Paramètres : jamais à chaque rendu,
//      jamais en boucle, jamais périodique ;
//   4. la section n'affiche JAMAIS une ligne vide : « vérification en cours… »,
//      « état inconnu — cliquez sur Vérifier à nouveau », ou l'état réel ;
//   5. aucun téléchargement n'est déclenché par ce chargement automatique ;
//   6. la CHAÎNE RÉELLE, exécutée de bout en bout (invocateur factice →
//      `refreshLocalVoiceStatus` → état mémorisé → `voiceChoiceOptions`),
//      remplit la liste avec les QUATRE voix locales, avec leur genre, pour le
//      réglage par défaut (« Automatique ») comme pour une voix du système —
//      et le dit franchement quand le moteur est absent ou la vérification en
//      échec (aucune ligne d'état figée sur « vérification en cours… »).
//
// Preuve que ces tests mordent : retirer l'appel `ensureLocalVoiceChecked(...)`
// de `refreshReadAloudVoice` fait ÉCHOUER les contrôles de branchement (voir
// RAPPORT-voix-locales-chargement-automatique.md).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_LOCAL_VOICE_MODEL,
  LOCAL_VOICE_MODELS,
  LOCAL_VOICE_PENDING_HINT,
  LOCAL_VOICE_READY_HINT,
  LOCAL_VOICE_UNKNOWN_HINT,
  LOCAL_VOICE_VALUE,
  localVoiceSectionNote,
  localVoiceChoices,
  localVoiceStatusFor,
  localVoiceValueFor,
  normalizeLocalVoiceStatus,
  refreshLocalVoiceStatus,
  setLocalVoiceStatus,
} from "./local-voice.js";
import { AUTO_VOICE_VALUE, voiceChoiceOptions, voiceChoiceStatus } from "./read-aloud.js";
import { sliceSource } from "./source-slice.js";

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
 * Corps d'une fonction d'un fichier source (accolades équilibrées) : les
 * contrôles portent sur CE QUE FAIT la fonction, pas sur le fichier entier.
 * @param {string} js source
 * @param {string} name nom de la fonction
 * @returns {string}
 */
function functionBody(js, name) {
  const start = js.indexOf(`function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const open = js.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < js.length; i += 1) {
    if (js[i] === "{") depth += 1;
    else if (js[i] === "}") {
      depth -= 1;
      if (depth === 0) return js.slice(open, i + 1);
    }
  }
  throw new Error(`corps de ${name} introuvable`);
}

const VOICES = [
  { lang: "fr-FR", name: "Amelie", voiceURI: "Amelie" },
  { lang: "en-US", name: "Alex", voiceURI: "Alex" },
];

/** Invocateur factice : l'état du moteur est fourni (ou échoue). */
function fakeInvoke(scenario = {}) {
  const calls = [];
  const invoke = async (command, args) => {
    calls.push({ command, args });
    if (command === "tts_local_status") {
      if (scenario.fail) throw new Error(scenario.fail);
      return scenario.status || { installed: false, dir: "C:/Pilot/voix-locale" };
    }
    if (command === "tts_local_download_state") return { running: false, outcome: "" };
    if (command === "tts_local_log") return null;
    return null;
  };
  return { invoke, calls };
}

afterEach(() => setLocalVoiceStatus(null));

// ── 1. La section n'est jamais vide ────────────────────────────────────────

describe("la ligne d'état du moteur local n'est jamais vide", () => {
  it("vérification pas encore répondue → phrase d'attente explicite", () => {
    expect(localVoiceSectionNote(null)).toBe(LOCAL_VOICE_PENDING_HINT);
    expect(LOCAL_VOICE_PENDING_HINT).toContain("vérification");
    expect(localVoiceSectionNote(undefined).length).toBeGreaterThan(10);
  });

  it("vérification en échec → « état inconnu » + le bouton, jamais un vide", () => {
    const note = localVoiceSectionNote(normalizeLocalVoiceStatus({ unknown: true }));
    expect(note).toBe(LOCAL_VOICE_UNKNOWN_HINT);
    expect(note).toContain("inconnu");
    expect(note).toContain("Vérifier à nouveau");
  });

  it("moteur absent → la phrase existante (jamais un vide)", () => {
    const note = localVoiceSectionNote(
      normalizeLocalVoiceStatus({ installed: false, dir: "C:/Pilot/voix-locale" }),
    );
    expect(note.length).toBeGreaterThan(10);
    expect(note).toContain("C:/Pilot/voix-locale");
  });

  it("moteur présent → l'état réel et le dossier, y compris un moteur partagé", () => {
    const own = normalizeLocalVoiceStatus({ installed: true, dir: "C:/Pilot/voix-locale" });
    expect(own.hint).toBe(LOCAL_VOICE_READY_HINT);
    expect(localVoiceSectionNote(own)).toContain("C:/Pilot/voix-locale");
    const shared = normalizeLocalVoiceStatus({
      installed: true,
      dir: "C:/Pilot-dev/voix-locale",
      engine_shared: true,
      engine_dir: "C:/Pilot/voix-locale/piper",
    });
    const note = localVoiceSectionNote(shared);
    expect(note).toContain("C:/Pilot/voix-locale/piper");
    expect(note).toContain("déjà installé");
  });
});

// ── 2. Un échec est « inconnu », pas « non installé » ──────────────────────

describe("échec de la vérification : état inconnu, jamais une affirmation inventée", () => {
  it("un état normalisé vaut « inconnu » seulement s'il est dit inconnu", () => {
    expect(normalizeLocalVoiceStatus({ installed: false }).unknown).toBe(false);
    expect(normalizeLocalVoiceStatus({ installed: true }).unknown).toBe(false);
    expect(normalizeLocalVoiceStatus({ unknown: true, installed: false }).unknown).toBe(true);
    expect(normalizeLocalVoiceStatus(null).unknown).toBe(false);
  });

  it("un invocateur en panne donne un état INCONNU, lisible et mémorisé", async () => {
    const { invoke } = fakeInvoke({ fail: "IPC indisponible" });
    const status = await refreshLocalVoiceStatus({ invoke, model: DEFAULT_LOCAL_VOICE_MODEL });
    expect(status.unknown).toBe(true);
    expect(status.installed).toBe(false);
    expect(status.hint).toBe(LOCAL_VOICE_UNKNOWN_HINT);
    // Mémorisé POUR CE MODÈLE : la section ne redemande pas en boucle…
    expect(localVoiceStatusFor(DEFAULT_LOCAL_VOICE_MODEL)).toBeTruthy();
    expect(localVoiceStatusFor(DEFAULT_LOCAL_VOICE_MODEL).unknown).toBe(true);
    // … et jamais attribué à un autre modèle.
    expect(localVoiceStatusFor("fr_FR-tom-medium")).toBe(null);
  });

  it("l'état inconnu garde le choix en cours et le dit (aucun choix décidé à la place)", () => {
    const unknown = normalizeLocalVoiceStatus({ unknown: true, voice: DEFAULT_LOCAL_VOICE_MODEL });
    const status = voiceChoiceStatus(VOICES, LOCAL_VOICE_VALUE, unknown);
    expect(status.kind).toBe("local-unknown");
    expect(status.hint).toBe(LOCAL_VOICE_UNKNOWN_HINT);
    expect(status.value).toBe(LOCAL_VOICE_VALUE);
    // Voix du système : le choix n'est pas déplacé non plus.
    expect(voiceChoiceStatus(VOICES, AUTO_VOICE_VALUE, unknown).value).toBe(AUTO_VOICE_VALUE);
    expect(voiceChoiceStatus(VOICES, AUTO_VOICE_VALUE, unknown).hint.length).toBeGreaterThan(10);
  });

  it("l'ordre des cas reste honnête : voix du système disparue d'abord, aucune voix ensuite", () => {
    const unknown = normalizeLocalVoiceStatus({ unknown: true, voice: DEFAULT_LOCAL_VOICE_MODEL });
    // Une voix du système vraiment disparue garde SON repli (l'inconnu du moteur
    // local ne masque pas une absence constatée).
    expect(voiceChoiceStatus(VOICES, "VoixDesinstallee", unknown).kind).toBe("missing");
    // Sans aucune voix du système et sans état du moteur : « aucune voix » (cas
    // existant, inchangé).
    expect(voiceChoiceStatus([], AUTO_VOICE_VALUE, null).kind).toBe("empty");
    // Sans voix du système mais moteur NON vérifié : on n'affirme pas « aucune
    // voix installée » — l'état est inconnu, le réglage reste utilisable.
    expect(voiceChoiceStatus([], AUTO_VOICE_VALUE, unknown).kind).toBe("local-unknown");
  });

  it("la liste des voix locales reste proposée quand l'état est fourni", () => {
    const unknown = normalizeLocalVoiceStatus({ unknown: true, voice: DEFAULT_LOCAL_VOICE_MODEL });
    const values = voiceChoiceOptions(VOICES, unknown).map((o) => o.value);
    for (const entry of localVoiceChoices()) {
      expect(values).toContain(entry.value);
    }
    expect(values).toContain(LOCAL_VOICE_VALUE);
  });
});

// ── 3. Le branchement : demandé SANS clic, par le chemin du bouton ─────────

describe("chargement automatique dans les Paramètres (branchement)", () => {
  it("le rendu de la section demande l'état du moteur SANS clic, même avec « Automatique »", () => {
    const js = read("src/js/settings.js");
    const body = functionBody(js, "refreshReadAloudVoice");
    // La voix dont on demande l'état : celle choisie, sinon la voix locale PAR
    // DÉFAUT (le seul état qui permet d'afficher le catalogue).
    expect(body).toContain("DEFAULT_LOCAL_VOICE_MODEL");
    // >>> LE contrôle qui mord : sans cet appel, la section reste vide.
    expect(body).toContain("ensureLocalVoiceChecked(");
    // La garde fautive d'avant (état demandé SEULEMENT si le réglage était déjà
    // une voix locale) ne doit pas revenir.
    expect(body).not.toContain("localVoiceStatusFor(model) : null");
    expect(body).not.toMatch(/if \(model && !localVoiceStatusFor\(model\)\)/);
    // L'état connu est TOUJOURS fourni au rendu (sinon aucune voix locale).
    expect(body).toContain("renderReadAloudVoice(wanted, known)");
    // Un état mémorisé ne dispense pas de vérifier à la première ouverture
    // (modèle déposé à la main, supprimé, autre version…) : seule l'ouverture
    // déjà servie empêche une seconde demande.
    expect(body).toContain("else if (!localVoiceAutoChecked) ensureLocalVoiceChecked(wanted, false);");
  });

  it("les deux points d'entrée de l'affichage passent par ce rendu", () => {
    const js = read("src/js/settings.js");
    // Ouverture des Paramètres…
    expect(js).toContain("refreshReadAloudVoice(currentConfig && currentConfig.read_aloud_voice)");
    // … et affichage de l'onglet Assistant.
    expect(js).toMatch(
      /if \(key === "superagent"\) \{[\s\S]*?refreshReadAloudVoice\(selectReadAloudVoice \? selectReadAloudVoice\.value : undefined\);/,
    );
  });

  it("un SEUL chemin de vérification : le bouton « Vérifier à nouveau » l'utilise aussi", () => {
    const js = read("src/js/settings.js");
    expect(countOf(js, "async function checkLocalVoiceStatus(")).toBe(1);
    const button = sliceSource(
      js,
      "btnReadAloudRecheck.addEventListener",
      "// Progression poussée par le moteur local",
    );
    expect(button).toContain("checkLocalVoiceStatus(");
    // Aucun second mécanisme : le bouton ne redemande pas l'état à la main.
    expect(button).not.toContain("refreshLocalVoiceStatus(");
    // Une seule source pour la ligne d'état (aucune seconde formulation).
    expect(countOf(js, "localVoiceNoteText")).toBe(0);
    expect(js).toContain("localVoiceSectionNote(local)");
  });

  it("une seule fois par ouverture des Paramètres (jamais à chaque rendu, jamais en boucle)", () => {
    const js = read("src/js/settings.js");
    const ensure = functionBody(js, "ensureLocalVoiceChecked");
    // Le drapeau d'ouverture et la demande en vol sont bien ceux de la section.
    expect(ensure).toContain("localVoiceAutoChecked");
    expect(ensure).toContain("localVoiceCheckInFlight");
    expect(ensure).toContain("return null;");
    // Le drapeau retombe à la fermeture des Paramètres (nouvelle ouverture).
    expect(functionBody(js, "resetSettingsContent")).toContain("localVoiceAutoChecked = false;");
    // Déclaré une seule fois, dans la section concernée.
    expect(countOf(js, "let localVoiceAutoChecked = false;")).toBe(1);
    // Aucune minuterie : le chargement n'est ni périodique ni différé.
    const body = functionBody(js, "ensureLocalVoiceChecked");
    expect(body).not.toContain("setInterval");
    expect(body).not.toContain("setTimeout");
  });

  it("le chargement automatique ne télécharge RIEN", () => {
    const js = read("src/js/settings.js");
    for (const name of ["refreshReadAloudVoice", "ensureLocalVoiceChecked", "checkLocalVoiceStatus"]) {
      const body = functionBody(js, name);
      expect(body).not.toContain("downloadLocalVoiceModel");
      expect(body).not.toContain("startReadAloudDownload");
    }
  });
});

// ── 4. La chaîne RÉELLE : du réglage par défaut à la liste remplie ─────────

const SYSTEM_VOICES = [
  { lang: "fr-FR", name: "Hortense", voiceURI: "Hortense" },
  { lang: "en-US", name: "Alex", voiceURI: "Alex" },
];

/**
 * Invocateur factice qui répond à `tts_local_status` en ÉCHO du modèle demandé
 * (comme le fait la commande Rust : l'état porte le nom du modèle vérifié).
 * @param {object|null} status état renvoyé (null si l'appel doit échouer)
 * @returns {{invoke: Function, calls: {command: string, args: object}[]}}
 */
function statusInvoke(status) {
  const calls = [];
  const invoke = async (command, args) => {
    calls.push({ command, args });
    if (command !== "tts_local_status") return null;
    if (!status) throw new Error("IPC indisponible");
    return { ...status, voice: args && args.model };
  };
  return { invoke, calls };
}

/**
 * Rejoue ce que fait la section à l'ouverture, SANS DOM : la demande d'état
 * pour le modèle PAR DÉFAUT (celui que `refreshReadAloudVoice` transmet au rendu
 * quand aucune voix locale n'est choisie), puis la liste telle que le sélecteur
 * la compose à partir de l'état MÉMORISÉ (`localVoiceStatusFor`).
 * @param {object|null} status état renvoyé par le moteur (null = échec)
 * @returns {Promise<{calls: object[], known: object|null, options: object[]}>}
 */
async function openSection(status) {
  setLocalVoiceStatus(null);
  const { invoke, calls } = statusInvoke(status);
  await refreshLocalVoiceStatus({ invoke });
  const known = localVoiceStatusFor(DEFAULT_LOCAL_VOICE_MODEL);
  return { calls, known, options: voiceChoiceOptions(SYSTEM_VOICES, known) };
}

/** Valeurs proposées par la liste (ordre compris). */
function values(options) {
  return options.map((opt) => opt.value);
}

/** Libellé affiché pour une valeur de réglage ("" si absente). */
function labelOf(options, value) {
  const found = options.find((opt) => opt.value === value);
  return found ? found.label : "";
}

const INSTALLED = {
  installed: true,
  dir: "C:/Pilot/voix-locale",
  engine_present: true,
  model_present: true,
};

describe("réglage par défaut : la liste des voix se remplit vraiment", () => {
  it("« Automatique » → les QUATRE voix locales sont proposées, genre compris", async () => {
    const { calls, known, options } = await openSection(INSTALLED);
    // Une seule demande, pour la voix locale PAR DÉFAUT : c'est elle qui donne
    // le catalogue (aucune voix locale choisie au départ).
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      command: "tts_local_status",
      args: { model: DEFAULT_LOCAL_VOICE_MODEL },
    });
    // L'état reçu est bien MÉMORISÉ par modèle (sans quoi la liste resterait vide).
    expect(known).toBeTruthy();
    expect(known.voice).toBe(DEFAULT_LOCAL_VOICE_MODEL);
    expect(known.installed).toBe(true);
    // La liste commence par « Automatique », puis les quatre voix locales.
    expect(values(options)).toEqual([
      AUTO_VOICE_VALUE,
      ...localVoiceChoices().map((entry) => entry.value),
      "Alex",
      "Hortense",
    ]);
    // Chaque voix locale est nommée ET son genre est dit en clair.
    for (const entry of LOCAL_VOICE_MODELS) {
      const label = labelOf(options, localVoiceValueFor(entry.model));
      expect(label, entry.model).toContain("Voix française locale");
      expect(label, entry.model).toContain(entry.gender === "homme" ? "voix d'homme" : "voix de femme");
      // Moteur et modèle présents : aucun « à télécharger » mensonger.
      expect(label, entry.model).not.toContain("à télécharger");
    }
    // La valeur historique de la voix locale reste la première des voix locales.
    expect(localVoiceValueFor(DEFAULT_LOCAL_VOICE_MODEL)).toBe(LOCAL_VOICE_VALUE);
  });

  it("la ligne d'état dit la vérité (plus jamais « vérification en cours » figée)", async () => {
    const { known } = await openSection(INSTALLED);
    const note = localVoiceSectionNote(known);
    expect(note).not.toBe(LOCAL_VOICE_PENDING_HINT);
    expect(note).not.toBe(LOCAL_VOICE_UNKNOWN_HINT);
    expect(note).toContain("C:/Pilot/voix-locale");
    expect(note).toContain(LOCAL_VOICE_READY_HINT);
  });

  it("une voix du SYSTÈME enregistrée → même liste, et le choix reste le sien", async () => {
    const { known, options } = await openSection(INSTALLED);
    for (const entry of localVoiceChoices()) {
      expect(values(options), entry.value).toContain(entry.value);
    }
    const status = voiceChoiceStatus(SYSTEM_VOICES, "Hortense", known);
    expect(status.kind).toBe("ok");
    expect(status.value).toBe("Hortense");
  });

  it("moteur réellement absent → la liste ne fait pas semblant, elle le dit", async () => {
    const { known, options } = await openSection({
      installed: false,
      dir: "C:/Pilot/voix-locale",
      engine_present: false,
      model_present: true,
    });
    // Les quatre voix restent proposées (on ne cache rien) : c'est la lecture
    // des libellés qui doit dire la vérité.
    for (const entry of localVoiceChoices()) {
      expect(values(options), entry.value).toContain(entry.value);
    }
    // La voix dont l'état est connu dit franchement qu'il reste à télécharger.
    expect(labelOf(options, LOCAL_VOICE_VALUE)).toContain("modèle à télécharger");
    // Une voix locale choisie est CONSERVÉE, et l'explication nomme le moteur.
    const status = voiceChoiceStatus(SYSTEM_VOICES, LOCAL_VOICE_VALUE, known);
    expect(status.kind).toBe("local-missing");
    expect(status.value).toBe(LOCAL_VOICE_VALUE);
    expect(status.hint.toLowerCase()).toContain("moteur");
    // La ligne d'état n'est jamais l'attente figée : elle donne le dossier utilisé.
    const note = localVoiceSectionNote(known);
    expect(note).not.toBe(LOCAL_VOICE_PENDING_HINT);
    expect(note).toContain("C:/Pilot/voix-locale");
  });

  it("vérification impossible → état inconnu, liste complète, aucun blocage", async () => {
    const { known, options } = await openSection(null);
    expect(known).toBeTruthy();
    expect(known.unknown).toBe(true);
    for (const entry of localVoiceChoices()) {
      expect(values(options), entry.value).toContain(entry.value);
    }
    expect(localVoiceSectionNote(known)).toBe(LOCAL_VOICE_UNKNOWN_HINT);
  });
});
