// local-voice.js — Voix française LOCALE (hors ligne) pour la lecture à voix haute.
//
// Moteur : **Piper** — un exécutable local et UN modèle ONNX à la fois, choisi
// dans la table [`LOCAL_VOICE_MODELS`] (28 à 64 Mo selon la voix). Contraintes
// tenues, et tenues ICI seulement :
//   - **hors ligne à la lecture** : aucun appel réseau pendant qu'on lit. Le
//     texte part vers le moteur local par une commande Tauri (processus local)
//     et revient sous forme de son joué par la fenêtre ;
//   - **le seul moment où Pilot télécharge** est le geste unique « Installer la
//     voix locale » des Paramètres (`downloadLocalVoiceModel`) : il installe le
//     moteur de lecture ET les deux voix françaises (une femme, un homme), une
//     seule fois, et uniquement ce qui manque. Jamais au démarrage, jamais à
//     l'ouverture des Paramètres, jamais à la lecture ; un seul téléchargement
//     à la fois, arrêtable, reprenable là où il s'est arrêté, sans rien
//     supprimer ;
//   - **aucune clé, aucun compte, aucun abonnement** ;
//   - **aucune carte graphique** : le moteur calcule sur le processeur ;
//   - **repli obligatoire et visible** : moteur absent, modèle absent, synthèse
//     en échec, audio refusé par la fenêtre → une ligne datée dans le journal
//     `voix-locale.log` (côté Rust ET côté fenêtre) et un état clair ; la lecture
//     retombe alors sur la voix du système, sans jamais bloquer ni planter.
//
// Répartition des rôles (aucun doublon) :
//   - `local-voice.js` (ce fichier) : SAIT quelles voix existent, si le moteur et
//     le modèle choisi sont là, installe le moteur et les deux voix sur geste
//     explicite, synthétise un morceau, le joue, journalise un repli ;
//   - `read-aloud.js` : décide QUOI lire (réponse finale seule), nettoie et
//     découpe le texte, choisit le moteur d'après LE réglage unique, et publie
//     l'état de lecture ;
//   - `settings.js` : affiche le réglage et l'état (un seul endroit).
//
// Aucune dépendance obligatoire : `invoke` est injectable (tests, autres
// appelants) et chargé à la demande sinon.

/**
 * Valeur RÉSERVÉE du réglage unique de la voix (`read_aloud_voice`) qui active
 * la voix française locale. Définie ici, et nulle part ailleurs : le front la
 * relit par import, la documentation la cite comme une valeur de configuration.
 *
 * Elle désigne **la voix locale par défaut** (voir [`DEFAULT_LOCAL_VOICE_MODEL`]).
 * Une configuration déjà enregistrée avec cette seule valeur continue donc de
 * fonctionner telle quelle : rien à migrer, aucune lecture cassée.
 */
export const LOCAL_VOICE_VALUE = "local:piper";

/**
 * Voix françaises locales proposées au choix (source unique côté fenêtre).
 *
 * Une entrée par modèle **mono-locuteur** du dépôt officiel Piper
 * (`rhasspy/piper-voices`, `fr/fr_FR/`) : nom technique exact, genre de la voix
 * et taille exacte du fichier `.onnx`. Aucune voix inventée : un modèle absent
 * de cette table n'est jamais proposé.
 */
export const LOCAL_VOICE_MODELS = [
  { model: "fr_FR-siwis-medium", gender: "femme", quality: "medium", bytes: 63201294 },
  { model: "fr_FR-tom-medium", gender: "homme", quality: "medium", bytes: 63511038 },
  { model: "fr_FR-gilles-low", gender: "homme", quality: "low", bytes: 63104526 },
  { model: "fr_FR-siwis-low", gender: "femme", quality: "low", bytes: 28130791 },
];

/** Modèle désigné par la valeur historique de la voix locale (voix de femme). */
export const DEFAULT_LOCAL_VOICE_MODEL = "fr_FR-siwis-medium";

/**
 * Voix installées par le geste UNIQUE « Installer la voix locale » : une voix de
 * femme ET une voix d'homme, en qualité moyenne (décision du propriétaire : ni
 * voix de qualité légère, ni autre langue). Cette liste est la MÊME que
 * `BUNDLE_MODELS` côté Rust (`tts_local_download.rs`) :
 * `catalogue-voix-locales.test.js` échoue si les deux divergent.
 */
export const LOCAL_VOICE_BUNDLE_MODELS = ["fr_FR-siwis-medium", "fr_FR-tom-medium"];

/**
 * Taille exacte de l'archive du moteur de lecture (Windows, octets) : identique
 * à `ENGINE_ARCHIVE_BYTES` côté Rust (une seule valeur, vérifiée par le test).
 */
export const LOCAL_VOICE_ENGINE_ARCHIVE_BYTES = 22_477_236;

/** Libellé du bouton du geste unique (une seule formulation dans tout l'écran). */
export const LOCAL_VOICE_INSTALL_LABEL = "Installer la voix locale";

/**
 * Ce que le geste unique installe, en une phrase (jamais un détail technique).
 * @returns {string}
 */
export function localVoiceBundleSummary() {
  return (
    "le moteur de lecture et les deux voix françaises (une voix de femme et une voix " +
    "d'homme, en qualité moyenne)"
  );
}

/** Taille du modèle d'une voix (octets), 0 si le modèle est inconnu. */
export function localVoiceBytes(model) {
  const name = String(model == null ? "" : model).trim();
  const found = LOCAL_VOICE_MODELS.find((entry) => entry.model === name);
  return found ? found.bytes : 0;
}

/**
 * Octets attendus pour l'installation complète (moteur + les deux voix) :
 * l'écran annonce ce total AVANT le geste, jamais une estimation inventée.
 * @param {{engineInstalled?: boolean}} [options] `engineInstalled` = moteur déjà
 *        présent (il n'est alors pas téléchargé : le total baisse d'autant)
 * @returns {number}
 */
export function localVoiceBundleBytes(options = {}) {
  const voices = LOCAL_VOICE_BUNDLE_MODELS.reduce((sum, model) => sum + localVoiceBytes(model), 0);
  const engine = options.engineInstalled === true ? 0 : LOCAL_VOICE_ENGINE_ARCHIVE_BYTES;
  return voices + engine;
}

/** Nom du modèle français par défaut (affiché, et valeur de compatibilité). */
export const LOCAL_VOICE_MODEL = DEFAULT_LOCAL_VOICE_MODEL;

/** Nom du moteur (affiché). */
export const LOCAL_VOICE_ENGINE = "Piper";

/** Libellé français d'une qualité de modèle. */
export const LOCAL_VOICE_QUALITY_LABELS = { medium: "qualité moyenne", low: "qualité légère" };

/**
 * Libellé lisible d'un modèle local, genre annoncé en clair (« voix d'homme » /
 * « voix de femme ») pour que le choix soit explicite dans la liste.
 * @param {string} model
 * @returns {string}
 */
export function localVoiceModelLabel(model) {
  const name = String(model == null ? "" : model).trim();
  const found = LOCAL_VOICE_MODELS.find((m) => m.model === name);
  if (!found) return `Voix française locale (${name || "modèle inconnu"})`;
  const short = found.model.replace(/^fr_FR-/, "").replace(/-(low|medium)$/, "");
  const genre = found.gender === "homme" ? "voix d'homme" : "voix de femme";
  const quality = LOCAL_VOICE_QUALITY_LABELS[found.quality] || found.quality;
  return `Voix française locale — ${genre} (${short}, ${quality})`;
}

/** Libellé du choix par défaut quand le modèle par défaut est installé. */
export const LOCAL_VOICE_LABEL = localVoiceModelLabel(DEFAULT_LOCAL_VOICE_MODEL);

/** Libellé du choix par défaut quand son modèle n'est pas encore installé. */
export const LOCAL_VOICE_NOT_INSTALLED_LABEL = `${LOCAL_VOICE_LABEL} — modèle à télécharger`;

/** Commandes Tauri de la voix locale (noms uniques, définis une seule fois). */
export const LOCAL_VOICE_COMMAND_STATUS = "tts_local_status";
export const LOCAL_VOICE_COMMAND_SYNTHESIZE = "tts_local_synthesize";
export const LOCAL_VOICE_COMMAND_LOG = "tts_local_log";

/** Commandes Tauri du téléchargement d'un modèle (jamais appelées sans geste). */
export const LOCAL_VOICE_COMMAND_DOWNLOAD = "tts_local_download";
export const LOCAL_VOICE_COMMAND_CANCEL_DOWNLOAD = "tts_local_cancel_download";
export const LOCAL_VOICE_COMMAND_DOWNLOAD_STATE = "tts_local_download_state";

/** Événement de progression du téléchargement (émis par le moteur local). */
export const LOCAL_VOICE_DOWNLOAD_EVENT = "tts-local-download-progress";

/** Préfixe des données audio renvoyées par le moteur local (WAV). */
export const LOCAL_AUDIO_PREFIX = "data:audio/wav;base64,";

/** Phrase affichée quand le moteur local est prêt. */
export const LOCAL_VOICE_READY_HINT =
  "Voix française locale prête : elle fonctionne hors ligne, sans clé et sans carte graphique.";

/**
 * Phrase affichée tant que la vérification de l'état du moteur n'a pas répondu
 * (la section se remplit toute seule : ce texte n'est jamais un vide).
 */
export const LOCAL_VOICE_PENDING_HINT =
  "Voix française locale : vérification de l'état du moteur en cours\u2026";

/**
 * Phrase affichée quand la vérification a échoué : l'état du moteur est
 * réellement INCONNU — on le dit, et le bouton reste le moyen de relancer.
 */
export const LOCAL_VOICE_UNKNOWN_HINT =
  "État du moteur de voix locale inconnu : cliquez sur «\u00a0Vérifier à nouveau\u00a0» pour relancer la vérification.";

/** Phrase affichée quand aucune voix du système n'existe mais que le local est prêt. */
export const LOCAL_VOICE_ONLY_HINT =
  "Aucune voix n'est installée sur cet ordinateur : utilisez la voix française locale " +
  "(hors ligne) proposée dans la liste ci-dessus.";

/**
 * Phrase affichée quand le moteur local n'est pas installé (dit aussi OÙ
 * déposer les fichiers : le chemin réel vient du moteur, jamais recopié ici).
 *
 * Phrase courte et **sans jargon** : on dit d'abord que la voix locale n'est pas
 * encore installée sur CET ordinateur (le dossier de données réellement utilisé
 * n'est pas celui d'une autre version de Pilot), puis ce qu'il reste à faire.
 * @param {string} [dir] dossier de données réellement utilisé
 * @param {{engine_present?: boolean, model_present?: boolean}|null} [status]
 * @returns {string}
 */
export function localVoiceMissingHint(dir, status) {
  const where = dir ? ` (dossier utilisé : « ${dir} »)` : "";
  // Un SEUL geste installe le moteur ET les deux voix, et il reste un geste :
  // rien ne se télécharge tout seul. Sur un système pour lequel Pilot ne
  // fournit pas de moteur, l'état détaillé le dit (repli sur la voix du système).
  if (status && status.engine_present === false) {
    return (
      `La voix locale n'est pas encore installée sur cet ordinateur${where} : il manque le moteur ` +
      `de lecture. Cliquez sur «\u00a0${LOCAL_VOICE_INSTALL_LABEL}\u00a0» : ${localVoiceBundleSummary()} ` +
      "sont alors installés d'un seul geste, une seule fois et sur votre demande. Si Pilot ne " +
      "fournit pas le moteur pour ce système, la ligne d'état le dit ; sinon, " +
      "«\u00a0Vérifier à nouveau\u00a0» relance la vérification. En attendant, la lecture " +
      "utilise la voix du système."
    );
  }
  return (
    `La voix locale n'est pas encore installée sur cet ordinateur${where} : ` +
    `cliquez sur «\u00a0${LOCAL_VOICE_INSTALL_LABEL}\u00a0» pour récupérer depuis Internet, une seule ` +
    "fois et sur votre demande, ce qui manque (le moteur et les voix françaises). En attendant, " +
    "la lecture utilise la voix du système."
  );
}

/** Vrai si la valeur du réglage désigne la voix locale (et non une voix du système). */
export function isLocalVoiceChoice(value) {
  return localVoiceModelFor(value) !== null;
}

/**
 * Valeur du réglage unique désignant un modèle local donné.
 *
 * Le modèle **par défaut** garde la valeur historique (une configuration
 * existante reste donc valide telle quelle) ; les autres voix reçoivent cette
 * même valeur suivie du nom du modèle.
 * @param {string} model
 * @returns {string}
 */
export function localVoiceValueFor(model) {
  const name = String(model == null ? "" : model).trim();
  if (!name || name === DEFAULT_LOCAL_VOICE_MODEL) return LOCAL_VOICE_VALUE;
  return `${LOCAL_VOICE_VALUE}:${name}`;
}

/**
 * Modèle local désigné par une valeur du réglage (`null` si la valeur désigne
 * une voix du système ou le mode automatique).
 *
 * Toute valeur locale reste locale : un nom de modèle inconnu retombe sur le
 * modèle par défaut — jamais d'échec, jamais de lecture muette.
 * @param {string} value
 * @returns {string|null}
 */
export function localVoiceModelFor(value) {
  const wanted = String(value == null ? "" : value).trim();
  if (!wanted) return null;
  if (wanted === LOCAL_VOICE_VALUE) return DEFAULT_LOCAL_VOICE_MODEL;
  const prefix = `${LOCAL_VOICE_VALUE}:`;
  if (!wanted.startsWith(prefix)) return null;
  const name = wanted.slice(prefix.length).trim();
  return LOCAL_VOICE_MODELS.some((m) => m.model === name) ? name : DEFAULT_LOCAL_VOICE_MODEL;
}

/**
 * Choix locaux proposés dans la liste des voix (un par modèle, libellé clair
 * avec le genre). Le premier est celui que désigne la valeur historique.
 * @returns {{value: string, label: string, model: string}[]}
 */
export function localVoiceChoices() {
  return LOCAL_VOICE_MODELS.map((entry) => ({
    value: localVoiceValueFor(entry.model),
    label: localVoiceModelLabel(entry.model),
    model: entry.model,
  }));
}

/** Appelle `fn` sans laisser remonter d'exception (API de la fenêtre). */
function safeCall(fn, fallback = null) {
  try {
    return fn();
  } catch (_) {
    return fallback;
  }
}

/** Message lisible d'une erreur quelconque (jamais « [object Object] »). */
function messageOf(error) {
  if (!error) return "raison inconnue";
  if (typeof error === "string") return error;
  if (typeof error.message === "string" && error.message) return error.message;
  return String(error);
}

// ── Invocation Tauri (injectable) ───────────────────────────────────────────

/** Invocateur mémorisé (injecté par l'appelant ou chargé à la demande). */
let invokeRef = null;

/**
 * Injecte l'invocateur Tauri (utile aux tests, ou pour réutiliser celui déjà
 * importé par l'appelant). `null` rétablit le chargement à la demande.
 * @param {Function|null} fn
 */
export function setLocalVoiceInvoker(fn) {
  invokeRef = typeof fn === "function" ? fn : null;
}

/**
 * Renvoie l'invocateur à utiliser : celui fourni par l'appelant, sinon celui
 * déjà mémorisé, sinon `invoke` de l'API Tauri (chargé à la demande pour que ce
 * module reste importable hors de la fenêtre, par exemple sous Node).
 * @param {{invoke?: Function}} [options]
 * @returns {Promise<Function>}
 */
async function resolveInvoke(options = {}) {
  if (options && typeof options.invoke === "function") return options.invoke;
  if (invokeRef) return invokeRef;
  const mod = await import("@tauri-apps/api/core");
  invokeRef = mod.invoke;
  return invokeRef;
}

// ── État du moteur local (une seule copie en mémoire) ───────────────────────

/** Dernier état connu du moteur local (null tant qu'il n'a pas été demandé). */
let localStatus = null;
/** États par modèle (`Map` modèle → état), pour ne jamais mélanger deux voix. */
const localStatusByModel = new Map();

/**
 * Normalise un état brut renvoyé par le moteur (jamais de champ manquant, jamais
 * de valeur inventée : un état absent est traité comme « non installé »).
 * @param {object|null} raw
 * @returns {{installed: boolean, unknown: boolean, engine: string, voice: string,
 *            gender: string, quality: string, model_present: boolean,
 *            engine_present: boolean, engine_dir: string, engine_shared: boolean,
 *            model_bytes: number, dir: string, missing: string[], hint: string,
 *            log: string}}
 */
export function normalizeLocalVoiceStatus(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const installed = src.installed === true;
  const dir = String(src.dir || "");
  const voice = String(src.voice || LOCAL_VOICE_MODEL);
  const known = LOCAL_VOICE_MODELS.find((m) => m.model === voice);
  return {
    installed,
    // Vérification en ÉCHEC (moteur injoignable) : l'état n'est pas « absent »,
    // il est INCONNU — la nuance est dite à l'écran, jamais masquée.
    unknown: src.unknown === true,
    engine: String(src.engine || LOCAL_VOICE_ENGINE),
    voice,
    gender: String(src.gender || (known ? known.gender : "")),
    quality: String(src.quality || (known ? known.quality : "")),
    model_present: src.model_present === true,
    engine_present: src.engine_present === true,
    // Moteur trouvé dans une AUTRE version de Pilot du même ordinateur :
    // l'information est affichée (jamais un partage silencieux).
    engine_dir: String(src.engine_dir || ""),
    engine_shared: src.engine_shared === true,
    model_bytes: Number.isFinite(Number(src.model_bytes))
      ? Number(src.model_bytes)
      : known
        ? known.bytes
        : 0,
    dir,
    missing: Array.isArray(src.missing) ? src.missing.map((m) => String(m)) : [],
    hint: String(src.hint || (installed ? LOCAL_VOICE_READY_HINT : localVoiceMissingHint(dir))),
    log: String(src.log || ""),
  };
}

/**
 * Dernier état connu du moteur local (`null` = pas encore demandé).
 * @returns {object|null}
 */
export function getLocalVoiceStatus() {
  return localStatus;
}

/**
 * État connu pour UN modèle donné (`null` si ce modèle n'a jamais été vérifié).
 * @param {string} model
 * @returns {object|null}
 */
export function localVoiceStatusFor(model) {
  return localStatusByModel.get(String(model == null ? "" : model).trim()) || null;
}

/**
 * Mémorise un état du moteur local (ou l'oublie avec `null`).
 * @param {object|null} raw
 * @returns {object|null} état normalisé
 */
export function setLocalVoiceStatus(raw) {
  if (raw == null) {
    // Oublier l'état, c'est oublier TOUS les modèles vérifiés (aucun reste
    // d'une vérification precedente ne peut être attribué à une autre voix).
    localStatus = null;
    localStatusByModel.clear();
    return null;
  }
  localStatus = normalizeLocalVoiceStatus(raw);
  if (localStatus && localStatus.voice) localStatusByModel.set(localStatus.voice, localStatus);
  return localStatus;
}

/**
 * Demande l'état réel du moteur local pour UN modèle (par défaut : la voix
 * désignée par la valeur historique) et le mémorise. Ne lève jamais : un échec
 * devient un état **inconnu** avec une explication lisible (`unknown: true`).
 * @param {{invoke?: Function, model?: string}} [options]
 * @returns {Promise<object>} état normalisé
 */
export async function refreshLocalVoiceStatus(options = {}) {
  const model = String(options.model == null ? "" : options.model).trim() || LOCAL_VOICE_MODEL;
  try {
    const invoke = await resolveInvoke(options);
    return setLocalVoiceStatus(await invoke(LOCAL_VOICE_COMMAND_STATUS, { model }));
  } catch (error) {
    // La vérification elle-même a échoué : l'état est INCONNU (jamais « non
    // installé », qui serait une affirmation inventée). La cause technique ne
    // sert qu'au journal de la console : le texte vu reste une phrase claire.
    safeCall(() => console.warn("tts_local_status :", messageOf(error)));
    return setLocalVoiceStatus({
      installed: false,
      voice: model,
      unknown: true,
      hint: LOCAL_VOICE_UNKNOWN_HINT,
    });
  }
}

/**
 * Phrase de la ligne « voix locale » de la section « Lecture des réponses ».
 *
 * **Jamais vide** : vérification en cours, état inconnu (avec le bouton), ou
 * état réel du moteur et dossier où sont ses fichiers. Une seule source de ce
 * texte (aucune seconde formulation ailleurs).
 * @param {object|null} local état du moteur de voix locale
 * @returns {string}
 */
export function localVoiceSectionNote(local) {
  if (!local) return LOCAL_VOICE_PENDING_HINT;
  if (local.unknown === true) return LOCAL_VOICE_UNKNOWN_HINT;
  if (local.installed && local.dir) {
    // Moteur réutilisé depuis une AUTRE version de Pilot du même ordinateur :
    // l'utilisateur le voit (jamais un partage silencieux).
    if (local.engine_shared && local.engine_dir) {
      return `${local.hint} Modèles dans « ${local.dir} », moteur déjà installé pour Pilot dans « ${local.engine_dir} ».`;
    }
    return `${local.hint} Moteur et modèle se trouvent dans « ${local.dir} ».`;
  }
  return local.hint || LOCAL_VOICE_UNKNOWN_HINT;
}

/** Vrai si le moteur local est connu comme installé. */
export function isLocalVoiceInstalled() {
  return !!(localStatus && localStatus.installed);
}

/**
 * Vrai si le moteur ET le modèle d'UNE voix donnée sont connus comme installés.
 * @param {string} model
 * @returns {boolean}
 */
export function isLocalVoiceInstalledFor(model) {
  const status = localVoiceStatusFor(model);
  return !!(status && status.installed);
}

/**
 * Libellé du choix par défaut (« non installée » tant que le modèle par défaut
 * n'est pas en place : l'utilisateur voit tout de suite ce qui est possible).
 * @param {object|null} [status]
 * @returns {string}
 */
export function localVoiceChoiceLabel(status) {
  const known = status === undefined ? localStatus : status;
  return known && known.installed ? LOCAL_VOICE_LABEL : LOCAL_VOICE_NOT_INSTALLED_LABEL;
}

// ── Journal du repli ────────────────────────────────────────────────────────

/**
 * Écrit une ligne dans le journal de la voix locale (même fichier que les
 * erreurs du moteur, côté Rust) et prévient la console. Ne lève jamais.
 * @param {string} message
 * @param {{invoke?: Function}} [options]
 * @returns {Promise<boolean>} vrai si le journal disque a bien reçu la ligne
 */
export async function logLocalVoice(message, options = {}) {
  const line = String(message == null ? "" : message).trim();
  if (!line) return false;
  safeCall(() => console.warn(`[voix locale] ${line}`));
  try {
    const invoke = await resolveInvoke(options);
    await invoke(LOCAL_VOICE_COMMAND_LOG, { message: line });
    return true;
  } catch (_) {
    return false;
  }
}

// ── Synthèse et lecture d'un morceau ────────────────────────────────────────

/**
 * Synthétise un morceau de texte avec le moteur local.
 *
 * @param {string} text morceau DÉJÀ nettoyé et découpé par `read-aloud.js`
 * @param {{invoke?: Function, model?: string}} [options] `model` = voix locale
 *   choisie (absente = voix par défaut, compatible avec l'existant)
 * @returns {Promise<string|null>} URL de données WAV, ou `null` si le moteur
 *   n'est pas disponible (le repli est alors décidé par l'appelant)
 */
export async function synthesizeSpeechAudio(text, options = {}) {
  const payload = String(text == null ? "" : text).trim();
  if (!payload) return null;
  const model = String(options.model == null ? "" : options.model).trim() || LOCAL_VOICE_MODEL;
  try {
    const invoke = await resolveInvoke(options);
    const encoded = await invoke(LOCAL_VOICE_COMMAND_SYNTHESIZE, { text: payload, model });
    if (!encoded || typeof encoded !== "string") {
      await logLocalVoice("Le moteur local n'a renvoyé aucun son : repli sur la voix du système.", options);
      return null;
    }
    return `${LOCAL_AUDIO_PREFIX}${encoded}`;
  } catch (error) {
    await logLocalVoice(
      `Synthèse locale impossible (${messageOf(error)}) : repli sur la voix du système.`,
      options,
    );
    return null;
  }
}

// ── Téléchargement d'un modèle (geste explicite uniquement) ────────────────

/**
 * Normalise un état de téléchargement renvoyé par le moteur local.
 * @param {object|null} raw
 * @returns {{model: string, running: boolean, bytes: number, bytes_total: number,
 *            percent: number|null, outcome: string|null, message: string}}
 */
export function normalizeDownloadState(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const total = Number(src.bytes_total);
  const bytes = Number(src.bytes);
  const percent = Number(src.percent);
  const outcome = src.outcome == null ? null : String(src.outcome);
  const stepPercent = Number(src.step_percent);
  const stepIndex = Number(src.step_index);
  const stepCount = Number(src.step_count);
  const stepBytes = Number(src.step_bytes);
  const stepBytesTotal = Number(src.step_bytes_total);
  const bounded = (value) =>
    Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : null;
  const count = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
  return {
    model: String(src.model || ""),
    running: src.running === true,
    bytes: Number.isFinite(bytes) && bytes > 0 ? bytes : 0,
    bytes_total: Number.isFinite(total) && total > 0 ? total : 0,
    percent: bounded(percent),
    // Étape en cours : le geste unique installe plusieurs choses (le moteur puis
    // les deux voix) ; l'écran dit laquelle, et où elle en est.
    step: String(src.step || ""),
    step_label: String(src.step_label || ""),
    step_index: count(stepIndex),
    step_count: count(stepCount),
    step_bytes: Number.isFinite(stepBytes) && stepBytes > 0 ? stepBytes : 0,
    step_bytes_total: Number.isFinite(stepBytesTotal) && stepBytesTotal > 0 ? stepBytesTotal : 0,
    step_percent: bounded(stepPercent),
    outcome: outcome && ["done", "cancelled", "failed"].includes(outcome) ? outcome : null,
    message: String(src.message || ""),
  };
}

/** Taille lisible d'un nombre d'octets en mégaoctets (« 63,5 Mo »). */
export function formatMegabytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "0 Mo";
  const mo = value / (1024 * 1024);
  return `${mo.toFixed(1).replace(".", ",")} Mo`;
}

/**
 * Texte d'état du téléchargement d'un modèle (toujours lisible, jamais un
 * pourcentage seul). Vide tant qu'aucun téléchargement n'a été demandé.
 *
 * La fin d'un téléchargement ne s'annonce comme un succès **que si la voix locale
 * est réellement utilisable** : un modèle téléchargé sans moteur ne fait pas
 * marcher la lecture, et la section doit le dire (jamais un succès mensonger).
 * @param {object|null} state état du téléchargement
 * @param {{installed?: boolean, engine_present?: boolean}|null} [status] état du
 *        moteur après vérification (`null` : pas encore vérifié)
 * @returns {string}
 */
export function downloadProgressText(state, status) {
  const s = state && typeof state === "object" ? state : null;
  if (!s || (!s.running && !s.outcome && !s.message)) return "";
  if (s.running) {
    const sizes = s.bytes_total
      ? ` — ${formatMegabytes(s.bytes)} / ${formatMegabytes(s.bytes_total)}`
      : "";
    // Installation en plusieurs étapes (moteur puis voix) : on dit laquelle et
    // où elle en est, avec la taille ET le pourcentage de CETTE étape.
    const stepCount = Number(s.step_count);
    if (s.step && Number.isFinite(stepCount) && stepCount > 0) {
      const global = s.percent == null ? "" : ` (${s.percent} %)`;
      const where = s.step_label ? ` : ${s.step_label}` : "";
      const stepPercent = s.step_percent == null ? "" : ` (${s.step_percent} %)`;
      const stepSizes =
        s.step_bytes_total > 0
          ? ` ${formatMegabytes(s.step_bytes)} / ${formatMegabytes(s.step_bytes_total)}`
          : "";
      return (
        `Installation de la voix locale en cours${sizes}${global} · ` +
        `étape ${s.step_index || 1} sur ${stepCount}${where}${stepSizes}${stepPercent}…`
      );
    }
    const label = s.model ? ` de ${localVoiceModelLabel(s.model)}` : "";
    const percent = s.percent == null ? "" : ` (${s.percent} %)`;
    return `Téléchargement${label} en cours${percent}${sizes}…`;
  }
  if (s.message) return s.message;
  if (s.outcome === "done") {
    // Succès seulement si la voix locale marche VRAIMENT (moteur + modèle).
    if (status && status.installed === true) {
      return "Téléchargement terminé : la lecture se fait désormais hors ligne.";
    }
    return (
      "Modèle téléchargé, mais la voix locale n'est pas encore utilisable" +
      (status && status.engine_present === false ? " : il manque le moteur de lecture (dossier « piper »)." : ".") +
      " La lecture utilise la voix du système."
    );
  }
  if (s.outcome === "cancelled") {
    return "Téléchargement arrêté : le modèle n'est pas installé, la lecture utilise la voix du système.";
  }
  if (s.outcome === "failed") {
    return "Téléchargement impossible : la lecture utilise la voix du système (voir le journal de la voix locale).";
  }
  return "";
}

/**
 * Message de fin de téléchargement d'un modèle — **jamais un succès mensonger**.
 *
 * Un modèle téléchargé ne suffit pas : si le MOTEUR manque encore, la voix locale
 * reste inutilisable et la lecture retombe sur la voix du système. Ce message le
 * dit, avec le niveau qui convient (`success` seulement si la voix marche
 * réellement). Il est journalisé par l'appelant quand il n'est pas un succès.
 * @param {object|null} state état du téléchargement (`outcome`, `message`)
 * @param {object|null} status état du moteur APRÈS le téléchargement
 * @param {string} [model] modèle concerné
 * @returns {{level: "success"|"warning"|"error"|"info", text: string}}
 */
export function downloadDoneMessage(state, status, model) {
  const s = state && typeof state === "object" ? state : {};
  const name = String(model || s.model || "").trim();
  const label = name ? localVoiceModelLabel(name) : "La voix locale";
  if (s.outcome === "cancelled") {
    return {
      level: "warning",
      text:
        s.message ||
        `Installation arrêtée : ${label} n'est pas installé, la lecture utilise la voix du système.`,
    };
  }
  if (s.outcome === "failed") {
    return {
      level: "error",
      text:
        s.message ||
        "Installation impossible : la lecture utilise la voix du système (voir le journal de la voix locale).",
    };
  }
  if (s.outcome !== "done") return { level: "info", text: "" };
  // Le seul succès vrai : la voix locale est réellement utilisable.
  const installed = !!(status && status.installed === true);
  // Le moteur rend un compte rendu EXACT (moteur + deux voix, ou ce qui manque) :
  // il est repris tel quel, avec le niveau qui convient à l'état constaté.
  if (s.message) return { level: installed ? "success" : "warning", text: s.message };
  if (installed) {
    const where = status.engine_shared && status.engine_dir ? ` (moteur déjà installé : « ${status.engine_dir} »)` : "";
    return {
      level: "success",
      text: `${LOCAL_VOICE_INSTALL_LABEL} : terminé${where}. La lecture se fait désormais hors ligne, sans réseau.`,
    };
  }
  if (status && status.engine_present === false) {
    return {
      level: "warning",
      text:
        `${label} est téléchargé, mais la voix locale n'est pas encore utilisable : il manque le moteur ` +
        "de lecture (dossier « piper »). La lecture utilise la voix du système.",
    };
  }
  return {
    level: "warning",
    text: `${label} est téléchargé, mais la voix locale n'est pas encore utilisable. La lecture utilise la voix du système.`,
  };
}

/**
 * Installe la voix locale — **uniquement sur geste explicite** (bouton
 * « Installer la voix locale » des Paramètres). Le geste est UNIQUE : le moteur
 * de lecture et les deux voix françaises (une femme, un homme) sont installés
 * en une fois, et seulement ce qui manque (un fichier déjà présent et complet
 * n'est jamais retéléchargé). Ne lève jamais : une panne devient un état
 * visible, et la lecture retombe sur la voix du système.
 * @param {string} model voix choisie (la voix retenue si une seule est possible)
 * @param {{invoke?: Function}} [options]
 * @returns {Promise<object>} état normalisé du téléchargement
 */
export async function downloadLocalVoiceModel(model, options = {}) {
  const name = String(model == null ? "" : model).trim() || LOCAL_VOICE_MODEL;
  try {
    const invoke = await resolveInvoke(options);
    return normalizeDownloadState(await invoke(LOCAL_VOICE_COMMAND_DOWNLOAD, { model: name }));
  } catch (error) {
    await logLocalVoice(
      `Installation de la voix locale impossible (${messageOf(error)}) : la lecture utilise la voix du système.`,
      options,
    );
    return normalizeDownloadState({
      model: name,
      outcome: "failed",
      message: `Installation impossible : ${messageOf(error)}. La lecture utilise la voix du système.`,
    });
  }
}

/**
 * Demande l'arrêt du téléchargement en cours (sans effet s'il n'y en a pas).
 * @param {{invoke?: Function}} [options]
 * @returns {Promise<object>} état normalisé
 */
export async function cancelLocalVoiceDownload(options = {}) {
  try {
    const invoke = await resolveInvoke(options);
    return normalizeDownloadState(await invoke(LOCAL_VOICE_COMMAND_CANCEL_DOWNLOAD));
  } catch (error) {
    return normalizeDownloadState({
      message: `Arrêt impossible : ${messageOf(error)}`,
    });
  }
}

/**
 * Relit l'état du dernier téléchargement (à l'ouverture des Paramètres).
 * @param {{invoke?: Function}} [options]
 * @returns {Promise<object>}
 */
export async function refreshLocalVoiceDownloadState(options = {}) {
  try {
    const invoke = await resolveInvoke(options);
    return normalizeDownloadState(await invoke(LOCAL_VOICE_COMMAND_DOWNLOAD_STATE));
  } catch (_) {
    return normalizeDownloadState(null);
  }
}

/**
 * L'UNIQUE espion du son que Pilot joue lui-même (mode Vocal).
 *
 * `local-voice.js` ne sait pas ce qu'on en fait : il tend l'élément audio qu'il
 * vient de créer, au moment même où il le crée, et rien d'autre. Le mode Vocal
 * s'en sert pour mesurer l'enveloppe de parole sur le son réel (voir
 * `vocal-enveloppe-aigu.js`) ; hors du mode Vocal, personne n'écoute et cette
 * fonction ne coûte rien.
 */
let audioTap = null;

/**
 * Branche (ou débranche) l'espion du son local. `null` rétablit le silence.
 * @param {((element: object) => void)|null} fn
 */
export function setLocalVoiceAudioTap(fn) {
  audioTap = typeof fn === "function" ? fn : null;
}

/**
 * Joue une URL audio et attend la fin. Résout toujours quelque chose :
 * `"ended"` (morceau terminé), `"stopped"` (arrêt demandé), `"error"` (la
 * fenêtre refuse ou ne peut pas jouer le son).
 * @param {Function} AudioCtor constructeur audio de la fenêtre
 * @param {string} url
 * @param {(finish: Function) => void} [registerFinish] reçoit la fonction qui
 *   termine l'attente (utilisée par l'arrêt)
 * @param {() => void} [onSoundStart] appelé UNE fois, quand le son a réellement
 *   commencé (`playing`, ou résolution de `play()`)
 * @returns {Promise<"ended"|"stopped"|"error">}
 */
function playUrl(AudioCtor, url, registerFinish, onSoundStart) {
  return new Promise((resolve) => {
    let settled = false;
    let audio = null;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
    if (typeof registerFinish === "function") {
      registerFinish((outcome = "stopped") => {
        if (audio) safeCall(() => audio.pause());
        finish(outcome);
      });
    }
    audio = safeCall(() => new AudioCtor(url), null);
    if (!audio) {
      finish("error");
      return;
    }
    // ── LE SON RÉEL, TENDU À QUI VOUDRA LE MESURER ───────────────────────────
    // Un seul espion, au moment de la CRÉATION de l'élément (donc de son seul
    // flux audio) : le mode Vocal y monte son analyseur. Aucun autre chemin ne
    // donne accès au son de Pilot.
    if (audioTap) {
      const tap = audioTap;
      safeCall(() => {
        const suite = tap(audio);
        // Un espion asynchrone ne doit jamais faire échouer une lecture.
        if (suite && typeof suite.catch === "function") suite.catch(() => {});
      });
    }
    audio.onended = () => finish("ended");
    audio.onerror = () => finish("error");
    // ── LE SON COMMENCE ICI ──────────────────────────────────────────────────
    // Le son local sort de l'enceinte à cet instant, pas à l'appel de `speak`
    // (le morceau a été synthétisé par un processus juste avant). Deux signaux,
    // un seul annoncement : l'évènement `playing` quand la fenêtre le propose,
    // et la résolution de `play()` (qui résout quand la lecture a démarré).
    let debutAnnonce = false;
    const annoncerDebut = () => {
      if (debutAnnonce) return;
      debutAnnonce = true;
      if (typeof onSoundStart === "function") safeCall(onSoundStart);
    };
    if (typeof onSoundStart === "function") {
      if (typeof audio.addEventListener === "function") {
        safeCall(() => audio.addEventListener("playing", annoncerDebut));
      } else {
        safeCall(() => {
          audio.onplaying = annoncerDebut;
        });
      }
    }
    const played = safeCall(() => audio.play(), null);
    // Certaines fenêtres renvoient une promesse : sa RÉSOLUTION est le signal
    // « le son a démarré » ; un refus (audio bloqué) est un échec net, jamais une
    // attente sans fin. Un seul appel, pour rester sûr avec un objet seulement
    // « thenable ».
    if (played && typeof played.then === "function") {
      played.then(
        () => annoncerDebut(),
        () => finish("error")
      );
    }
  });
}

/**
 * Joue une suite de morceaux avec le moteur local, dans l'ordre, un par un.
 *
 * Une synthèse d'avance est lancée pendant la lecture du morceau courant : pas
 * de trou audible entre deux phrases. L'arrêt (`onStopRegister`) coupe le son
 * immédiatement et empêche la suite.
 *
 * @param {{win?: Window, chunks?: string[], isCancelled?: () => boolean,
 *          onStopRegister?: (fn: Function) => void,
 *          onSoundStart?: () => void,
 *          synthesize?: (text: string) => Promise<string|null>,
 *          model?: string, invoke?: Function}} [options] `model` = voix locale
 *   choisie, transmise à la synthèse (absente = voix par défaut) ;
 *   `onSoundStart` est appelé quand le son d'un morceau a RÉELLEMENT commencé
 *   (jamais à l'appel : le morceau a été synthétisé avant)
 * @returns {Promise<{played: boolean, reason: "ended"|"stopped"|"unavailable"|"error"|"empty"|"no-audio"}>}
 */
export async function playLocalChunks(options = {}) {
  const win = options.win || globalThis.window;
  const chunks = (Array.isArray(options.chunks) ? options.chunks : [])
    .map((chunk) => String(chunk == null ? "" : chunk))
    .filter(Boolean);
  const isCancelled = typeof options.isCancelled === "function" ? options.isCancelled : () => false;
  if (!chunks.length) return { played: false, reason: "empty" };

  const AudioCtor = safeCall(() => (win && (win.Audio || win.HTMLAudioElement)) || null, null);
  if (typeof AudioCtor !== "function") return { played: false, reason: "no-audio" };

  const synthesize =
    typeof options.synthesize === "function"
      ? options.synthesize
      : (text) => synthesizeSpeechAudio(text, options);

  let stopped = false;
  let finishCurrent = null;
  const stop = () => {
    stopped = true;
    if (finishCurrent) finishCurrent("stopped");
  };
  if (typeof options.onStopRegister === "function") options.onStopRegister(stop);

  // Première synthèse lancée tout de suite ; la suivante pendant la lecture.
  let pending = synthesize(chunks[0]);
  for (let index = 0; index < chunks.length; index++) {
    const url = await pending;
    if (stopped || isCancelled()) return { played: false, reason: "stopped" };
    if (!url) return { played: false, reason: "unavailable" };
    pending = index + 1 < chunks.length ? synthesize(chunks[index + 1]) : Promise.resolve(null);
    const outcome = await playUrl(
      AudioCtor,
      url,
      (finish) => {
        finishCurrent = finish;
      },
      options.onSoundStart
    );
    finishCurrent = null;
    if (outcome === "stopped" || stopped || isCancelled()) {
      return { played: false, reason: "stopped" };
    }
    if (outcome !== "ended") return { played: false, reason: "error" };
  }
  return { played: true, reason: "ended" };
}
