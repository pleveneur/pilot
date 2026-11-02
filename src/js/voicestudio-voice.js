// voicestudio-voice.js — Voix IMITÉE de l'utilisateur (service local VoiceStudio).
//
// DEUXIÈME voix de la lecture à voix haute, à côté de la voix française locale
// (Piper, `local-voice.js`). Contraintes tenues, et tenues ICI seulement :
//   - **rien à installer du côté de Pilot** : le service de voix imitée
//     (`http://127.0.0.1:3900`) est un AUTRE programme, installé et lancé par
//     l'utilisateur. Pilot ne le télécharge pas, ne l'embarque pas, ne le lance
//     pas et ne le configure pas ;
//   - **aucune voix clonée ici** : la voix imitée est déjà enregistrée côté
//     service ; Pilot ne fait que la DEMANDER, par son identifiant de profil ;
//   - **le son est fabriqué sur la machine** : la fenêtre ne parle jamais au
//     service elle-même (`fetch` interdit vers `127.0.0.1`, verrouillé par test) ;
//     elle passe par la commande Tauri `tts_voicestudio_synthesize`, exécutée
//     hors du thread de l'interface ;
//   - **aucun fichier audio écrit** : le WAV revient en mémoire (base64) et vit
//     le temps de la lecture ;
//   - **aucun flux** : une demande = un morceau de texte = un WAV complet, et les
//     morceaux sont préparés d'avance pendant que le précédent est joué ;
//   - **repli obligatoire et visible** : service éteint, voix disparue, synthèse
//     en échec → la lecture reprend avec la voix locale (Piper), puis avec la voix
//     du système, et l'écran le dit. Jamais un silence, jamais un gel.
//
// Répartition des rôles (aucun doublon) :
//   - `voicestudio-voice.js` (ce fichier) : SAIT quelles voix imitées existent,
//     si le service répond, découpe le texte en morceaux, demande le son, et
//     journalise un repli ;
//   - `read-aloud.js` : décide QUOI lire, choisit le moteur d'après LE réglage
//     unique, joue le son et publie l'état de lecture ;
//   - `settings.js` : affiche le réglage et l'état (un seul endroit).

import { LOCAL_AUDIO_PREFIX } from "./local-voice.js";

/**
 * Préfixe de la valeur du réglage unique (`read_aloud_voice`) qui désigne une
 * voix imitée. La valeur complète est `local:voicestudio:<identifiant du profil>`
 * — l'identifiant, jamais le nom : deux profils peuvent porter le même nom.
 *
 * Le préfixe reste `local:` : comme Piper, la voix est fabriquée **sur cet
 * ordinateur** et jouée par la fenêtre, pas par le moteur du système.
 */
export const VOICESTUDIO_VOICE_PREFIX = "local:voicestudio";

/** Adresse du service (affichée telle quelle : elle reste sur la machine). */
export const VOICESTUDIO_BASE_URL = "http://127.0.0.1:3900";

/** Commandes Tauri utilisées (une seule porte vers le service : côté machine). */
export const VOICESTUDIO_COMMAND_STATUS = "tts_voicestudio_status";
export const VOICESTUDIO_COMMAND_SYNTHESIZE = "tts_voicestudio_synthesize";
export const VOICESTUDIO_COMMAND_WARMUP = "tts_voicestudio_warmup";
export const VOICESTUDIO_COMMAND_LOG = "tts_voicestudio_log";

/** Nom du service, écrit une seule fois (libellés de la liste des voix). */
export const VOICESTUDIO_ENGINE = "VoiceStudio";

/**
 * Plafond de caractères d'un morceau envoyé au service.
 *
 * Le service accepte 4096 caractères ; on garde une marge pour que la coupure ne
 * soit jamais la cause d'un échec. Un morceau plus long est découpé par
 * [`groupSentencesForVoiceStudio`].
 */
export const VOICESTUDIO_MAX_CHARS = 3000;

/**
 * Découpage en morceaux : le PREMIER ne contient qu'une phrase (le son arrive
 * donc au plus vite), les suivants en regroupent plusieurs (la synthèse du
 * suivant tient alors pendant toute la lecture du précédent — aucun trou).
 */
export const VOICESTUDIO_FIRST_GROUP_SENTENCES = 1;
export const VOICESTUDIO_GROUP_SENTENCES = 4;
export const VOICESTUDIO_GROUP_CHARS = 700;

/** Phrase d'état quand le service n'a pas encore été interrogé. */
export const VOICESTUDIO_UNKNOWN_HINT =
  "L'état du service de voix imitée n'a pas encore été vérifié : la lecture utilise la voix " +
  "locale (Piper) en attendant.";

/** Valeur du réglage désignant une voix imitée donnée (identifiant de profil). */
export function voiceStudioChoiceValue(profileId) {
  const id = String(profileId == null ? "" : profileId).trim();
  if (!id) return "";
  return `${VOICESTUDIO_VOICE_PREFIX}:${id}`;
}

/**
 * Identifiant du profil désigné par une valeur du réglage (`""` si la valeur ne
 * désigne pas une voix imitée : voix du système, automatique, ou Piper).
 * @param {string} value
 * @returns {string}
 */
export function voiceStudioProfileIdFor(value) {
  const wanted = String(value == null ? "" : value).trim();
  const prefix = `${VOICESTUDIO_VOICE_PREFIX}:`;
  if (!wanted.startsWith(prefix)) return "";
  return wanted.slice(prefix.length).trim();
}

/** Vrai si la valeur du réglage désigne une voix imitée (et non Piper ni le système). */
export function isVoiceStudioChoice(value) {
  return voiceStudioProfileIdFor(value) !== "";
}

/**
 * Faut-il PRÉCHAUFFER le service au démarrage de Pilot ? (fonction PURE)
 *
 * Une seule réponse possible, et une seule raison de la donner : la voix de
 * lecture mémorisée (`read_aloud_voice`) désigne une voix imitée **avec son
 * identifiant de profil**. Tout le reste dit non, sans exception :
 *   - `""` / valeur absente / valeur d'un autre type → voix automatique du
 *     système : aucun préchauffage, donc aucun appel réseau pour rien ;
 *   - `local:piper` ou `local:piper:<modèle>` → voix locale : le moteur local
 *     n'a rien à voir avec le service, il n'est pas réveillé par lui ;
 *   - une valeur inconnue (`autre:chose`, du texte quelconque) → non, on
 *     n'invente jamais une voix imitée à partir d'un texte qui n'en est pas une ;
 *   - `local:voicestudio:` vide → non : sans identifiant de profil, il n'y a
 *     aucune voix que le service pourrait préchauffer.
 *
 * La reconnaissance du type de voix n'est PAS recopiée ici : elle vient de
 * [`voiceStudioProfileIdFor`], le seul endroit qui sait lire ce préfixe.
 * @param {string} value valeur mémorisée du réglage `read_aloud_voice`
 * @returns {boolean}
 */
export function shouldPrewarmVoiceStudio(value) {
  return voiceStudioProfileIdFor(value) !== "";
}

/**
 * Vrai si un profil imité est RÉELLEMENT proposé par le service (par identifiant
 * ou par nom, sans tenir compte de la casse).
 *
 * Sert à constater qu'une voix mémorisée a disparu du service : le service, lui,
 * répondrait 200 en jouant sa voix par défaut — donc sans rien dire.
 * @param {string} value valeur du réglage (`local:voicestudio:<id>`)
 * @param {{id: string, name: string}[]} [profiles] profils annoncés par le service
 * @returns {boolean}
 */
export function voiceStudioKnowsProfile(value, profiles) {
  const name = voiceStudioProfileIdFor(value);
  if (!name) return false;
  const lower = name.toLowerCase();
  return (Array.isArray(profiles) ? profiles : []).some((profile) => {
    if (!profile) return false;
    if (String(profile.id || "").trim() === name) return true;
    return String(profile.name || "").trim().toLowerCase() === lower;
  });
}

/**
 * Libellé de la ligne qui PORTE le choix mémorisé quand le service ne peut pas
 * l'annoncer (éteint, non vérifié, ou voix retirée du service).
 *
 * Sans cette ligne, le choix disparaîtrait de la liste et le sélecteur
 * afficherait « Automatique » : l'utilisateur croirait avoir perdu sa voix, et un
 * enregistrement écraserait le réglage dans son dos. La raison est dite en
 * clair, jamais un code technique.
 * @param {string} value valeur mémorisée (`local:voicestudio:<id>`)
 * @param {{reachable?: boolean, unknown?: boolean}|null} [status] état du service
 * @returns {string}
 */
export function voiceStudioUnavailableLabel(value, status) {
  const id = voiceStudioProfileIdFor(value);
  const why =
    !status || status.unknown === true
      ? "service non vérifié"
      : status.reachable === true
        ? "voix introuvable"
        : "service injoignable";
  return `Ma voix imitée — ${id || "voix imitée"} (${VOICESTUDIO_ENGINE} — ${why})`;
}

/**
 * Libellé lisible d'une voix imitée, tel qu'il apparaît dans la liste.
 * Le nom vient du service (c'est celui que l'utilisateur a donné) ; il est
 * toujours accompagné du nom du service, pour qu'on ne confonde jamais cette
 * voix avec la voix locale.
 * @param {{id: string, name: string}} profile
 * @returns {string}
 */
export function voiceStudioProfileLabel(profile) {
  const name = String((profile && profile.name) || "").trim();
  const label = name || "voix imitée";
  return `Ma voix imitée — ${label} (${VOICESTUDIO_ENGINE})`;
}

/**
 * Choix de voix imitées proposés dans la liste des voix (un par profil du
 * service). Aucune voix inventée : un service qui n'annonce aucun profil ne
 * produit aucune entrée.
 * @param {{id: string, name: string}[]} [profiles]
 * @returns {{value: string, label: string, profileId: string}[]}
 */
export function voiceStudioChoices(profiles) {
  const list = Array.isArray(profiles) ? profiles : [];
  return list
    .filter((profile) => profile && String(profile.id || "").trim())
    .map((profile) => ({
      value: voiceStudioChoiceValue(profile.id),
      label: voiceStudioProfileLabel(profile),
      profileId: String(profile.id).trim(),
    }));
}

/**
 * Découpe des phrases (déjà découpées et bornées par `read-aloud.js`) en
 * MORCEAUX envoyés un par un au service.
 *
 * Règle, dans cet ordre — c'est la promesse « le son arrive vite, et il n'y a pas
 * de trou ensuite » :
 *  1. le premier morceau ne prend que les premières phrases (`firstSentences`,
 *     une par défaut) : le premier WAV est donc le plus court possible ;
 *  2. les morceaux suivants accumulent des phrases tant qu'ils restent sous
 *     `groupSentences` phrases ET `groupChars` caractères ; le dépassement ouvre
 *     le morceau suivant ;
 *  3. une phrase plus longue que `groupChars` reste SEULE dans son morceau
 *     (jamais coupée : une phrase tronquée s'entendrait) ;
 *  4. une phrase vide est ignorée ; un texte entièrement vide ne donne aucun
 *     morceau (rien n'est demandé au service pour rien).
 *
 * @param {string[]} chunks phrases déjà nettoyées et bornées
 * @param {{firstSentences?: number, groupSentences?: number, groupChars?: number}} [options]
 * @returns {string[]}
 */
export function groupSentencesForVoiceStudio(chunks, options = {}) {
  const list = (Array.isArray(chunks) ? chunks : [])
    .map((chunk) => String(chunk == null ? "" : chunk).trim())
    .filter(Boolean);
  if (!list.length) return [];
  const count = (value, fallback) => {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) && number > 0 ? number : fallback;
  };
  const firstSentences = count(options.firstSentences, VOICESTUDIO_FIRST_GROUP_SENTENCES);
  const groupSentences = count(options.groupSentences, VOICESTUDIO_GROUP_SENTENCES);
  const groupChars = count(options.groupChars, VOICESTUDIO_GROUP_CHARS);
  const groups = [];
  let index = 0;
  let limit = firstSentences;
  while (index < list.length) {
    const taken = [];
    let length = 0;
    while (index < list.length && taken.length < limit) {
      const sentence = list[index];
      const grown = taken.length ? length + 1 + sentence.length : sentence.length;
      // Une phrase trop longue pour le morceau reste seule : on ne coupe jamais.
      if (taken.length && grown > groupChars) break;
      taken.push(sentence);
      length = grown;
      index += 1;
      // Une phrase plus longue que le plafond occupe son morceau à elle seule.
      if (length > groupChars) break;
    }
    groups.push(taken.join(" "));
    // Après le premier morceau, les suivants regroupent plusieurs phrases.
    limit = groupSentences;
  }
  return groups;
}

/** Message lisible d'une erreur quelconque (jamais « [object Object] »). */
function messageOf(error) {
  if (!error) return "raison inconnue";
  if (typeof error === "string") return error;
  if (typeof error.message === "string" && error.message) return error.message;
  return String(error);
}

/** Cause COURTE affichée sous la bulle (« pas de son imité : … »). */
function shortCause(reason) {
  const text = String(reason == null ? "" : reason).trim();
  if (!text) return "raison inconnue";
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

// ── Invocation Tauri (injectable) ───────────────────────────────────────────

/** Invocateur mémorisé (injecté par l'appelant ou chargé à la demande). */
let invokeRef = null;

/**
 * Injecte l'invocateur Tauri (utile aux tests, ou pour réutiliser celui déjà
 * importé par l'appelant). `null` rétablit le chargement à la demande.
 * @param {Function|null} fn
 */
export function setVoiceStudioInvoker(fn) {
  invokeRef = typeof fn === "function" ? fn : null;
}

/**
 * Rend l'invocateur à utiliser : celui fourni, celui déjà mémorisé, ou celui de
 * la fenêtre chargé à la demande.
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

// ── État du service (une seule copie en mémoire) ────────────────────────────

/** Dernier état connu du service (null tant qu'il n'a pas été demandé). */
let studioStatus = null;

/**
 * Normalise un état brut renvoyé par la machine (jamais de champ manquant,
 * jamais de valeur inventée : un état absent est « inconnu », jamais « en
 * panne »).
 * @param {object|null} raw
 * @returns {{unknown: boolean, reachable: boolean, version: string, device: string,
 *            profiles: {id: string, name: string}[], voice: string,
 *            voice_known: boolean, hint: string, base_url: string}}
 */
export function normalizeVoiceStudioStatus(raw) {
  const src = raw && typeof raw === "object" ? raw : null;
  if (!src) {
    return {
      unknown: true,
      reachable: false,
      version: "",
      device: "",
      profiles: [],
      voice: "",
      voice_known: false,
      hint: VOICESTUDIO_UNKNOWN_HINT,
      base_url: VOICESTUDIO_BASE_URL,
    };
  }
  const profiles = (Array.isArray(src.profiles) ? src.profiles : [])
    .filter((profile) => profile && String(profile.id || "").trim())
    .map((profile) => ({
      id: String(profile.id).trim(),
      name: String(profile.name || profile.id).trim() || String(profile.id).trim(),
    }));
  return {
    unknown: false,
    reachable: src.reachable === true,
    version: String(src.version || ""),
    device: String(src.device || ""),
    profiles,
    voice: String(src.voice || ""),
    voice_known: src.voice_known === true,
    hint: String(src.hint || "") || VOICESTUDIO_UNKNOWN_HINT,
    base_url: String(src.base_url || VOICESTUDIO_BASE_URL),
  };
}

/** Dernier état connu (`null` = jamais demandé), pour l'affichage synchrone. */
export function getVoiceStudioStatus() {
  return studioStatus;
}

/** Mémorise un état déjà normalisé (utilisé par l'écran et par les tests). */
export function setVoiceStudioStatus(raw) {
  studioStatus = raw == null ? null : normalizeVoiceStudioStatus(raw);
  return studioStatus;
}

/**
 * Garde la dernière liste de voix CONNUE quand le service devient injoignable.
 *
 * Sans elle, le choix mémorisé disparaîtrait de la liste à la première panne
 * (la voix serait perdue à l'écran alors qu'elle est toujours dans la
 * configuration). La liste gardée est la DERNIÈRE RÉELLE : la phrase d'état dit
 * que le service ne répond pas, elle ne prétend jamais le contraire.
 * @param {object} next état fraîchement obtenu
 * @returns {object}
 */
function keepKnownProfiles(next) {
  const previous = studioStatus;
  const known = previous && Array.isArray(previous.profiles) ? previous.profiles : [];
  if (next && !next.reachable && !next.profiles.length && known.length) {
    return { ...next, profiles: known.slice() };
  }
  return next;
}

/**
 * Interroge le service (santé + voix enregistrées) et mémorise le résultat.
 *
 * Jamais d'exception : une panne devient un état lisible (`reachable: false`).
 * @param {{invoke?: Function, voice?: string}} [options]
 * @returns {Promise<object>} l'état normalisé
 */
export async function refreshVoiceStudioStatus(options = {}) {
  const voice = String(options.voice == null ? "" : options.voice).trim();
  try {
    const invoke = await resolveInvoke(options);
    const raw = await invoke(VOICESTUDIO_COMMAND_STATUS, { voice: voice || null });
    studioStatus = keepKnownProfiles(normalizeVoiceStudioStatus(raw));
  } catch (error) {
    studioStatus = keepKnownProfiles(
      normalizeVoiceStudioStatus({
        reachable: false,
        hint:
          `Le service de voix imitée n'a pas pu être interrogé (${shortCause(messageOf(error))}) : ` +
          "la lecture se rabat sur la voix locale (Piper).",
      }),
    );
  }
  return studioStatus;
}

/**
 * Demande le son d'un morceau au service, par la machine.
 *
 * Le repli n'est pas décidé ici : on renvoie une cause claire et c'est
 * `read-aloud.js` qui reprend avec la voix locale.
 * @param {string} text morceau DÉJÀ nettoyé et découpé
 * @param {{invoke?: Function, voice?: string}} [options] `voice` = identifiant du
 *   profil imité (`""` = voix par défaut du service)
 * @returns {Promise<{audio: string|null, reason: string}>}
 */
export async function synthesizeVoiceStudioAudio(text, options = {}) {
  const payload = String(text == null ? "" : text).trim();
  if (!payload) return { audio: null, reason: "aucun texte à lire" };
  const voice = String(options.voice == null ? "" : options.voice).trim();
  try {
    const invoke = await resolveInvoke(options);
    const encoded = await invoke(VOICESTUDIO_COMMAND_SYNTHESIZE, { text: payload, voice: voice || null });
    if (!encoded || typeof encoded !== "string") {
      const reason = "le service n'a renvoyé aucun son";
      await logVoiceStudio(`Aucun son imité (${reason}) : repli sur la voix locale.`, options);
      return { audio: null, reason };
    }
    return { audio: `${LOCAL_AUDIO_PREFIX}${encoded}`, reason: "" };
  } catch (error) {
    const reason = shortCause(messageOf(error));
    await logVoiceStudio(`Synthèse imitée impossible (${reason}) : repli sur la voix locale.`, options);
    return { audio: null, reason };
  }
}

/**
 * Préchauffe le service : une synthèse courte dont le son n'est pas joué.
 *
 * Sert au PREMIER appel (chargement du modèle à froid, ≈ 6 s mesurées). Deux
 * déclencheurs, et deux seulement : le GESTE de sélection de la voix dans les
 * Paramètres, et le DÉMARRAGE de Pilot quand c'est cette voix qui est mémorisée
 * (`prewarmVoiceStudioAtStartup`). Jamais bloquant : la commande est asynchrone
 * et l'échec est silencieux (le repli existe déjà).
 * @param {{invoke?: Function, voice?: string, onFailure?: (reason: string) => void}} [options]
 *   `onFailure` reçoit la raison COURTE de l'échec (le préchauffage de démarrage
 *   en a besoin pour distinguer une panne passagère d'un refus définitif).
 * @returns {Promise<boolean>} vrai si le service a répondu
 */
export async function warmupVoiceStudio(options = {}) {
  const voice = String(options.voice == null ? "" : options.voice).trim();
  const onFailure = typeof options.onFailure === "function" ? options.onFailure : null;
  try {
    const invoke = await resolveInvoke(options);
    await invoke(VOICESTUDIO_COMMAND_WARMUP, { voice: voice || null });
    return true;
  } catch (error) {
    if (onFailure) {
      try {
        onFailure(shortCause(messageOf(error)));
      } catch (_) {
        // Un rapporteur fautif ne change rien : l'échec reste silencieux.
      }
    }
    return false;
  }
}

/**
 * Ajoute une ligne au journal de la voix (`voix-locale.log`, préfixée côté
 * machine). Jamais d'exception : un journal indisponible ne doit pas empêcher la
 * lecture.
 * @param {string} message
 * @param {{invoke?: Function}} [options]
 * @returns {Promise<boolean>}
 */
export async function logVoiceStudio(message, options = {}) {
  const text = String(message == null ? "" : message).trim();
  if (!text) return false;
  try {
    const invoke = await resolveInvoke(options);
    await invoke(VOICESTUDIO_COMMAND_LOG, { message: text });
    return true;
  } catch (_) {
    return false;
  }
}

// ── Préchauffage AU DÉMARRAGE ───────────────────────────────────────────────

/**
 * Délai de la SECONDE tentative (la seule) du préchauffage de démarrage.
 *
 * Quelques secondes : le temps que le logiciel de voix imitée finisse de
 * démarrer s'il était en train de s'ouvrir au moment où Pilot s'est lancé.
 */
export const VOICESTUDIO_PREWARM_RETRY_MS = 5000;

/**
 * Vrai si l'échec du préchauffage peut être PASSAGER (donc mérite l'unique
 * seconde tentative).
 *
 * Un seul cas est passager : le service n'a pas pu être joint du tout (« service
 * injoignable », connexion refusée, délai dépassé) — exactement ce que produit un
 * logiciel en train de démarrer. Un refus du service (voix inconnue, `HTTP 4xx`),
 * un texte refusé ou une erreur interne sont DÉFINITIFS : réessayer n'apporterait
 * rien et ferait du préchauffage une sonde permanente.
 * @param {string} reason raison de l'échec
 * @returns {boolean}
 */
export function isTransientWarmupFailure(reason) {
  const text = String(reason == null ? "" : reason).trim().toLowerCase();
  if (!text) return false;
  return ["injoignable", "connection refused", "timed out", "timeout", "délai dépassé"].some(
    (marker) => text.includes(marker),
  );
}

/**
 * Garde de tentative : UN préchauffage au démarrage par vie de la fenêtre.
 *
 * Mémoire seulement (aucune configuration, aucun fichier) : elle empêche le
 * double préchauffage quand l'appelant repasse par ici (seconde lecture de
 * configuration, réouverture d'un écran…). Aucun réessai n'est armé par cette
 * garde : la seule seconde tentative est celle prévue par
 * [`prewarmVoiceStudioAtStartup`].
 */
let prewarmStartupStarted = false;

/**
 * Réarme la garde de démarrage (tests, et uniquement eux).
 * @returns {void}
 */
export function resetPrewarmStartupGuard() {
  prewarmStartupStarted = false;
}

/**
 * PRÉCHAUFFE la voix imitée AU DÉMARRAGE, si — et seulement si — c'est elle qui
 * a été choisie (`read_aloud_voice`).
 *
 * Pourquoi ici : le premier appel à froid du service prend ≈ 6 s ; sans ce
 * préchauffage, la PREMIÈRE phrase lue après le lancement de Pilot attendait tout
 * ce temps (lenteur entendue par l'utilisateur). Rien d'autre ne change : le
 * repli (voix locale, puis voix du système) reste identique, et aucun réglage
 * n'est ajouté — le seul signal est la voix déjà choisie.
 *
 * Ce que cette fonction ne fait JAMAIS :
 *   - **bloquer** : elle rend la main immédiatement (promesse non attendue par
 *     l'appelant) et la commande de la machine s'exécute hors du thread de la
 *     fenêtre ;
 *   - **parler** : le préchauffage ne joue aucun son (aucun lecteur ici) ;
 *   - **faire du bruit** : aucun échec n'est affiché ni journalisé ; la valeur
 *     rendue dit seulement ce qui s'est passé ;
 *   - **sonder en boucle** : une tentative, plus UNE seconde tentative et
 *     seulement si le premier échec peut être passager ;
 *   - **préchauffer pour rien** : voix du système, voix locale, valeur vide ou
 *     inconnue → aucun appel, aucun démarrage de logiciel ;
 *   - **préchauffer deux fois** : la garde `prewarmStartupStarted` (mémoire
 *     seulement, réarmable par [`resetPrewarmStartupGuard`]) refuse un second
 *     préchauffage.
 * @param {{invoke?: Function, loadConfig?: () => any, warmup?: Function,
 *          wait?: (ms: number) => Promise<any>}} [options] points d'injection
 *   (tests) — par défaut `warmup(voice, onFailure)` et `wait(ms)` sont ceux de
 *   ce module, et `loadConfig()` lit `read_aloud_voice` par `get_config`.
 * @returns {Promise<boolean>} vrai si le service a répondu (jamais d'exception)
 */
export async function prewarmVoiceStudioAtStartup(options = {}) {
  if (prewarmStartupStarted) return false;
  prewarmStartupStarted = true;

  const loadChoice =
    typeof options.loadConfig === "function"
      ? options.loadConfig
      : async () => {
          const invoke = await resolveInvoke(options);
          const config = await invoke("get_config");
          return config && typeof config === "object" ? config.read_aloud_voice : "";
        };
  const runWarmup =
    typeof options.warmup === "function"
      ? options.warmup
      : (voice, onFailure) => warmupVoiceStudio({ invoke: options.invoke, voice, onFailure });
  const wait =
    typeof options.wait === "function"
      ? options.wait
      : (ms) =>
          new Promise((resolve) => {
            const timer = setTimeout(resolve, ms);
            if (timer && typeof timer.unref === "function") timer.unref();
          });

  let choice = "";
  try {
    choice = await loadChoice();
  } catch (_) {
    // Configuration illisible : rien ne se passe, aucune exception ne remonte.
    return false;
  }
  if (!shouldPrewarmVoiceStudio(choice)) return false;

  const voice = voiceStudioProfileIdFor(choice);
  const attempt = async () => {
    let reason = "";
    try {
      const ok = await runWarmup(voice, (cause) => {
        reason = String(cause == null ? "" : cause);
      });
      return { ok: ok === true, reason };
    } catch (error) {
      return { ok: false, reason: messageOf(error) };
    }
  };

  const first = await attempt();
  if (first.ok) return true;
  if (!isTransientWarmupFailure(first.reason)) return false;
  try {
    await wait(VOICESTUDIO_PREWARM_RETRY_MS);
  } catch (_) {
    return false;
  }
  return (await attempt()).ok;
}
