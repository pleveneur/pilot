// local-voice.js — Voix française LOCALE (hors ligne) pour la lecture à voix haute.
//
// Moteur : **Piper** — un exécutable local et un modèle ONNX
// (`fr_FR-siwis-medium`, ≈ 63 Mo). Contraintes tenues, et tenues ICI seulement :
//   - **hors ligne** : aucun appel réseau, ni à l'installation ni à la lecture.
//     Le texte part vers le moteur local par une commande Tauri (processus
//     local) et revient sous forme de son joué par la fenêtre ;
//   - **aucune clé, aucun compte, aucun abonnement** ;
//   - **aucune carte graphique** : le moteur calcule sur le processeur ;
//   - **repli obligatoire et visible** : moteur absent, modèle absent, synthèse
//     en échec, audio refusé par la fenêtre → une ligne datée dans le journal
//     `voix-locale.log` (côté Rust ET côté fenêtre) et un état clair ; la lecture
//     retombe alors sur la voix du système, sans jamais bloquer ni planter.
//
// Répartition des rôles (aucun doublon) :
//   - `local-voice.js` (ce fichier) : SAIT si le moteur est là, synthétise un
//     morceau, le joue, journalise un repli ;
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
 */
export const LOCAL_VOICE_VALUE = "local:piper";

/** Libellé du choix quand le moteur local est installé. */
export const LOCAL_VOICE_LABEL = "Voix française locale (hors ligne, plus naturelle)";

/** Libellé du choix quand le moteur local n'est pas installé. */
export const LOCAL_VOICE_NOT_INSTALLED_LABEL = "Voix française locale (non installée)";

/** Nom du moteur (affiché). */
export const LOCAL_VOICE_ENGINE = "Piper";

/** Nom du modèle français attendu (affiché). */
export const LOCAL_VOICE_MODEL = "fr_FR-siwis-medium";

/** Commandes Tauri de la voix locale (noms uniques, définis une seule fois). */
export const LOCAL_VOICE_COMMAND_STATUS = "tts_local_status";
export const LOCAL_VOICE_COMMAND_SYNTHESIZE = "tts_local_synthesize";
export const LOCAL_VOICE_COMMAND_LOG = "tts_local_log";

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
  return String(value == null ? "" : value).trim() === LOCAL_VOICE_VALUE;
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

/**
 * Normalise un état brut renvoyé par le moteur (jamais de champ manquant, jamais
 * de valeur inventée : un état absent est traité comme « non installé »).
 * @param {object|null} raw
 * @returns {{installed: boolean, engine: string, voice: string, dir: string,
 *            missing: string[], hint: string, log: string}}
 */
export function normalizeLocalVoiceStatus(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const installed = src.installed === true;
  const dir = String(src.dir || "");
  return {
    installed,
    engine: String(src.engine || LOCAL_VOICE_ENGINE),
    voice: String(src.voice || LOCAL_VOICE_MODEL),
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
 * Mémorise un état du moteur local (ou l'oublie avec `null`).
 * @param {object|null} raw
 * @returns {object|null} état normalisé
 */
export function setLocalVoiceStatus(raw) {
  localStatus = raw == null ? null : normalizeLocalVoiceStatus(raw);
  return localStatus;
}

/**
 * Demande l'état réel du moteur local et le mémorise. Ne lève jamais : un échec
 * devient un état « non installé » avec une explication lisible.
 * @param {{invoke?: Function}} [options]
 * @returns {Promise<object>} état normalisé
 */
export async function refreshLocalVoiceStatus(options = {}) {
  try {
    const invoke = await resolveInvoke(options);
    return setLocalVoiceStatus(await invoke(LOCAL_VOICE_COMMAND_STATUS));
  } catch (error) {
    return setLocalVoiceStatus({
      installed: false,
      hint: `Voix française locale indisponible (${messageOf(error)}) : la lecture utilise la voix du système.`,
    });
  }
}

/** Vrai si le moteur local est connu comme installé. */
export function isLocalVoiceInstalled() {
  return !!(localStatus && localStatus.installed);
}

/**
 * Libellé du choix dans la liste des voix (« non installée » tant que le moteur
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
 * @param {{invoke?: Function}} [options]
 * @returns {Promise<string|null>} URL de données WAV, ou `null` si le moteur
 *   n'est pas disponible (le repli est alors décidé par l'appelant)
 */
export async function synthesizeSpeechAudio(text, options = {}) {
  const payload = String(text == null ? "" : text).trim();
  if (!payload) return null;
  try {
    const invoke = await resolveInvoke(options);
    const encoded = await invoke(LOCAL_VOICE_COMMAND_SYNTHESIZE, { text: payload });
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
 *          invoke?: Function}} [options]
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
