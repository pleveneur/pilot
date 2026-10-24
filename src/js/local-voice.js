// local-voice.js — Voix française LOCALE (hors ligne) pour la lecture à voix haute.
//
// Moteur : **Piper** — un exécutable local et UN modèle ONNX à la fois, choisi
// dans la table [`LOCAL_VOICE_MODELS`] (28 à 64 Mo selon la voix). Contraintes
// tenues, et tenues ICI seulement :
//   - **hors ligne à la lecture** : aucun appel réseau pendant qu'on lit. Le
//     texte part vers le moteur local par une commande Tauri (processus local)
//     et revient sous forme de son joué par la fenêtre ;
//   - **le seul geste réseau** est le téléchargement d'un modèle, déclenché par
//     le bouton « Télécharger » des Paramètres (`downloadLocalVoiceModel`) :
//     jamais au démarrage, jamais à l'ouverture des Paramètres, jamais à la
//     lecture ; un seul téléchargement à la fois, arrêtable ;
//   - **aucune clé, aucun compte, aucun abonnement** ;
//   - **aucune carte graphique** : le moteur calcule sur le processeur ;
//   - **repli obligatoire et visible** : moteur absent, modèle absent, synthèse
//     en échec, audio refusé par la fenêtre → une ligne datée dans le journal
//     `voix-locale.log` (côté Rust ET côté fenêtre) et un état clair ; la lecture
//     retombe alors sur la voix du système, sans jamais bloquer ni planter.
//
// Répartition des rôles (aucun doublon) :
//   - `local-voice.js` (ce fichier) : SAIT quelles voix existent, si le moteur et
//     le modèle choisi sont là, télécharge un modèle sur geste explicite,
//     synthétise un morceau, le joue, journalise un repli ;
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

/** Phrase affichée quand aucune voix du système n'existe mais que le local est prêt. */
export const LOCAL_VOICE_ONLY_HINT =
  "Aucune voix n'est installée sur cet ordinateur : utilisez la voix française locale " +
  "(hors ligne) proposée dans la liste ci-dessus.";

/**
 * Phrase affichée quand le moteur local n'est pas installé (dit aussi OÙ
 * déposer les fichiers : le chemin réel vient du moteur, jamais recopié ici).
 * @param {string} [dir]
 * @returns {string}
 */
export function localVoiceMissingHint(dir) {
  const where = dir ? ` dans « ${dir} »` : "";
  return (
    `Voix française locale non installée${where} : la lecture utilise la voix du système. ` +
    "Le journal indique ce qui manque."
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
 * @returns {{installed: boolean, engine: string, voice: string, gender: string,
 *            quality: string, model_present: boolean, engine_present: boolean,
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
    engine: String(src.engine || LOCAL_VOICE_ENGINE),
    voice,
    gender: String(src.gender || (known ? known.gender : "")),
    quality: String(src.quality || (known ? known.quality : "")),
    model_present: src.model_present === true,
    engine_present: src.engine_present === true,
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
 * devient un état « non installé » avec une explication lisible.
 * @param {{invoke?: Function, model?: string}} [options]
 * @returns {Promise<object>} état normalisé
 */
export async function refreshLocalVoiceStatus(options = {}) {
  const model = String(options.model == null ? "" : options.model).trim() || LOCAL_VOICE_MODEL;
  try {
    const invoke = await resolveInvoke(options);
    return setLocalVoiceStatus(await invoke(LOCAL_VOICE_COMMAND_STATUS, { model }));
  } catch (error) {
    return setLocalVoiceStatus({
      installed: false,
      voice: model,
      hint: `Voix française locale indisponible (${messageOf(error)}) : la lecture utilise la voix du système.`,
    });
  }
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
  return {
    model: String(src.model || ""),
    running: src.running === true,
    bytes: Number.isFinite(bytes) && bytes > 0 ? bytes : 0,
    bytes_total: Number.isFinite(total) && total > 0 ? total : 0,
    percent: Number.isFinite(percent) ? Math.min(100, Math.max(0, Math.round(percent))) : null,
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
 * Phrase d'état d'un téléchargement (toujours lisible, jamais un pourcentage
 * seul). Vide tant qu'aucun téléchargement n'a été demandé.
 * @param {object|null} state
 * @returns {string}
 */
export function downloadProgressText(state) {
  const s = state && typeof state === "object" ? state : null;
  if (!s || (!s.running && !s.outcome && !s.message)) return "";
  if (s.running) {
    const label = s.model ? ` de ${localVoiceModelLabel(s.model)}` : "";
    const percent = s.percent == null ? "" : ` (${s.percent} %)`;
    const sizes = s.bytes_total
      ? ` — ${formatMegabytes(s.bytes)} / ${formatMegabytes(s.bytes_total)}`
      : "";
    return `Téléchargement${label} en cours${percent}${sizes}…`;
  }
  if (s.message) return s.message;
  if (s.outcome === "done") return "Modèle installé : la lecture se fait désormais hors ligne.";
  if (s.outcome === "cancelled") {
    return "Téléchargement arrêté : le modèle n'est pas installé, la lecture utilise la voix du système.";
  }
  if (s.outcome === "failed") {
    return "Téléchargement impossible : la lecture utilise la voix du système (voir le journal de la voix locale).";
  }
  return "";
}

/**
 * Télécharge le modèle d'une voix locale — **uniquement sur geste explicite**
 * (bouton « Télécharger » des Paramètres). Ne lève jamais : une panne devient un
 * état visible, et la lecture retombe sur la voix du système.
 * @param {string} model
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
      `Téléchargement du modèle ${name} impossible (${messageOf(error)}) : la lecture utilise la voix du système.`,
      options,
    );
    return normalizeDownloadState({
      model: name,
      outcome: "failed",
      message: `Téléchargement impossible : ${messageOf(error)}. La lecture utilise la voix du système.`,
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
 * Joue une URL audio et attend la fin. Résout toujours quelque chose :
 * `"ended"` (morceau terminé), `"stopped"` (arrêt demandé), `"error"` (la
 * fenêtre refuse ou ne peut pas jouer le son).
 * @param {Function} AudioCtor constructeur audio de la fenêtre
 * @param {string} url
 * @param {(finish: Function) => void} [registerFinish] reçoit la fonction qui
 *   termine l'attente (utilisée par l'arrêt)
 * @returns {Promise<"ended"|"stopped"|"error">}
 */
function playUrl(AudioCtor, url, registerFinish) {
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
    audio.onended = () => finish("ended");
    audio.onerror = () => finish("error");
    const played = safeCall(() => audio.play(), null);
    // Certaines fenêtres renvoient une promesse : un refus (audio bloqué) est un
    // échec net, jamais une attente sans fin.
    if (played && typeof played.catch === "function") {
      played.catch(() => finish("error"));
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
 *          synthesize?: (text: string) => Promise<string|null>,
 *          model?: string, invoke?: Function}} [options] `model` = voix locale
 *   choisie, transmise à la synthèse (absente = voix par défaut)
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
    const outcome = await playUrl(AudioCtor, url, (finish) => {
      finishCurrent = finish;
    });
    finishCurrent = null;
    if (outcome === "stopped" || stopped || isCancelled()) {
      return { played: false, reason: "stopped" };
    }
    if (outcome !== "ended") return { played: false, reason: "error" };
  }
  return { played: true, reason: "ended" };
}
