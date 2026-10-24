// read-aloud.js — Lecture a voix haute des reponses de l'assistant.
//
// Technologie : la synthese vocale DEJA presente dans la fenetre
// (`window.speechSynthesis`, Web Speech API). Aucune dependance externe, aucun
// service en ligne, aucun telechargement, aucun cout.
//
// Regles tenues ici (elles ne vivent qu'a cet endroit) :
//   1. Un clic LIT le message, un second clic ARRETE la lecture.
//   2. AUCUNE lecture automatique : rien ne part sans un clic.
//   3. UNE SEULE lecture a la fois : lancer un autre message arrete proprement
//      le precedent (aucun chevauchement, jamais deux voix ensemble).
//   4. Le texte lu est nettoye a UN SEUL endroit (`speech-text.js`,
//      `textForSpeech`) : plus d'emojis ni de pictogrammes, plus de balisage
//      (titres, listes, gras, liens, tableaux), les blocs de code ne sont PAS
//      debites (la voix signale seulement qu'il y a du code a l'ecran), les
//      liens sont lus par leur libelle. Ce nettoyage ne sert QU'A la voix :
//      rien de ce qui s'affiche a l'ecran ne passe par la.
//   5. Le texte est decoupe phrase par phrase (avec une limite de longueur) et
//      enchaine dans l'ordre ; une coupure de longueur tombe sur une fin de
//      phrase ou de mot, jamais au milieu d'un mot ; l'arret fonctionne a tout
//      moment.
//   6. Synthese vocale absente ou AUCUNE VOIX installee : le bouton reste
//      present mais INACTIF, avec une explication courte et claire (infobulle
//      et texte du panneau de reglage), jamais un bouton muet.
//   7. Langue : celle de l'interface, et on prend la premiere voix disponible
//      dans cette langue. Le chargement des voix est attendu (sinon la premiere
//      lecture partirait en silence). Le choix de la voix vit a UN SEUL
//      endroit : Parametres → onglet « Assistant » → « Lecture des reponses ».
//      Valeur par defaut : automatique (voix de la langue de l'interface). Une
//      voix memorisee qui a disparu de l'ordinateur retombe proprement sur la
//      voix de la langue de l'interface (aucune erreur, aucune lecture muette).
//   7bis. Deux moteurs possibles, choisis par LE MEME reglage unique :
//      - `""` ou une voix du systeme : synthese vocale de la fenetre ;
//      - `LOCAL_VOICE_VALUE` : voix FRANCAISE LOCALE (Piper, hors ligne, sans
//        cle, sans carte graphique — voir `local-voice.js`). Le nettoyage et le
//        decoupage du texte sont IDENTIQUES pour les deux moteurs : seul leur
//        moteur de synthese change. Si le moteur local manque ou echoue, la
//        lecture NE S'ARRETE PAS : elle retombe sur la voix du systeme, ecrit
//        une ligne dans le journal et le dit dans l'etat affiche.
//   8. SEULE LA REPONSE FINALE est lue. Un message de l'assistant contient deux
//      sortes de choses : (a) le TRAVAIL INTERNE — raisonnement affiche, appels
//      d'outils, resultats d'outils, sorties de commandes, notes techniques ;
//      (b) la REPONSE FINALE — le texte rendu dans `.agent-text-section`. La
//      frontiere n'est PAS devinee dans le texte : elle est lue dans la
//      STRUCTURE du message (voir `finalAnswerSections`). Concretement, la
//      reponse finale est la suite FINALE de sections de texte du flux
//      chronologique : tout ce qui precede le dernier raisonnement ou le
//      dernier outil est du travail interne et n'est JAMAIS lu. Un message sans
//      texte apres son dernier outil n'a donc aucune reponse finale : le bouton
//      ne lit rien et le dit (etat « Rien a lire »), plutot que de debiter du
//      vide.
//   9. Les notes techniques (erreur, arret, redemarrage) ne sont jamais lues :
//      les fabriques de message les marquent avec `data-agent-internal="true"`
//      (voir `appendNoticeSection` dans agent-pi.js). Elles ne masquent pas une
//      reponse finale deja emise : elles sont ignorees, pas un frontiere.
//
// Le module est sans dependance : il recoit `win` (fenetre porteuse de
// `speechSynthesis`) et `doc` — ce qui le rend testable sans navigateur.
//
// Le NETTOYAGE du texte parle vit a UN SEUL endroit : `speech-text.js`
// (`textForSpeech`). Ce fichier-ci ne fait que l'appeler, sur le seul chemin
// qui alimente la synthese vocale. Rien de ce qui s'affiche a l'ecran ne passe
// par la.

import { CODE_BLOCK_NOTICE, cutTextAtBoundary, textForSpeech } from "./speech-text.js";
// Voix française LOCALE (hors ligne, sans clé, sans GPU) : le module sait si le
// moteur est là, synthétise et joue un morceau, journalise un repli. Le réglage
// unique (`read_aloud_voice`) et l'état de lecture restent ICI.
import {
  LOCAL_VOICE_ONLY_HINT,
  LOCAL_VOICE_READY_HINT,
  LOCAL_VOICE_VALUE,
  getLocalVoiceStatus,
  isLocalVoiceChoice,
  isLocalVoiceInstalledFor,
  localVoiceChoiceLabel,
  localVoiceChoices,
  localVoiceMissingHint,
  localVoiceModelFor,
  localVoiceStatusFor,
  logLocalVoice,
  playLocalChunks,
  refreshLocalVoiceStatus,
} from "./local-voice.js";

// Re-exporte pour les appelants historiques (le nom vient de speech-text.js).
export { CODE_BLOCK_NOTICE };
// La valeur RÉSERVÉE qui active la voix locale vient de `local-voice.js` : elle
// est ré-exportée ici pour que le réglage (Paramètres) et la lecture la lisent
// au même endroit — jamais une seconde définition.
export { LOCAL_VOICE_VALUE, LOCAL_VOICE_LABEL } from "./local-voice.js";

/** Longueur maximale d'un morceau lu (en caracteres). */
export const SPEECH_MAX_CHUNK = 180;

/** Attente maximale du chargement des voix (ms) avant de parler quand meme. */
export const VOICES_WAIT_MS = 1500;

/**
 * Valeur du choix « automatique » dans le reglage de voix : voix de la langue
 * de l'interface. C'est la valeur par defaut (champ vide en configuration).
 */
export const AUTO_VOICE_VALUE = "";

/** Explication du bouton inactif quand aucune voix n'est installee. */
export const NO_VOICE_HINT =
  "Aucune voix n'est disponible sur cet ordinateur : la lecture a voix haute reste inactive.";

/** Phrase du panneau de reglage quand la liste des voix est vide. */
export const NO_VOICE_INSTALLED_HINT =
  "Aucune voix n'est installee sur cet ordinateur : la lecture a voix haute reste inactive. " +
  "Installez une voix dans les reglages de votre systeme, puis rouvrez les Parametres.";

/** Explication affichee sous le reglage quand tout est normal. */
export const READ_ALOUD_HELP_HINT =
  "Le bouton \u00ab\u00a0\u00c9couter\u00a0\u00bb lit la seule reponse finale de la conversation, jamais le travail interne. " +
  "Rien n'est lu automatiquement, et une seule lecture tourne a la fois.";

/** Evenement emis a chaque changement d'etat de lecture (panneau des Parametres). */
export const READ_ALOUD_STATE_EVENT = "pilot-read-aloud-state";

/** Message court affiche quand la bulle ne contient rien a lire. */
const EMPTY_MESSAGE_HINT =
  "Rien a lire : ce message ne contient aucune reponse finale (seulement du travail interne).";

/** Libelle visible (temporaire) quand il n'y a aucune reponse finale a lire. */
const EMPTY_LABEL = "Rien a lire";

/** Duree d'affichage du libelle « Rien a lire » (ms) avant retour a l'etat repos. */
export const EMPTY_HINT_MS = 3000;

/**
 * Classes des blocs de TRAVAIL INTERNE qui marquent une FRONTIERE dans un
 * message : raisonnement affiche, appels d'outils, resultats d'outils, sorties
 * de commandes, resume de compaction. Tout ce qui les precede n'est pas la
 * reponse finale.
 *
 * Ces classes sont celles REELLEMENT posees par les fabriques de message
 * (`agent-pi.js` et `super-agent.js`) : la decision s'appuie sur la structure
 * du DOM, jamais sur des mots devines dans le texte.
 */
export const INTERNAL_BOUNDARY_CLASSES = [
  "agent-thinking", // raisonnement affiche (bloc « pensee »)
  "agent-thinking-content",
  "agent-tool-inline", // appel d'outil (badge)
  "agent-tool-block", // appel d'outil (ancien rendu)
  "agent-tool-cmds", // commandes d'un ancien bloc d'outil
  "agent-tool-live", // sortie de commande en direct
  "agent-tool-result", // resultat d'outil (bloc depliable)
  "agent-compaction-summary", // resume de compaction
];

/** Attribut de dataset qui marque une section de note technique (jamais lue). */
export const INTERNAL_MARKER = "agentInternal";

/** Lecture en cours, UNE SEULE a la fois pour toute l'application. */
let currentPlayback = null;

/** Compteur d'identifiants de lecture (jeton d'annulation). */
let playbackSeq = 0;

/**
 * Voix preferee en cours d'application (vide = automatique). Memorisee pour la
 * session a partir du reglage unique des Parametres (onglet « Assistant »).
 */
let preferredVoiceName = "";

/** Appelle `fn` sans jamais laisser remonter d'exception (API navigateur). */
function safeCall(fn, fallback = null) {
  try {
    return fn();
  } catch (_) {
    return fallback;
  }
}

/**
 * Vrai si la synthese vocale est utilisable dans cette fenetre.
 * @param {Window} [win]
 * @returns {boolean}
 */
export function speechAvailable(win) {
  const w = win || globalThis.window;
  return !!(w && w.speechSynthesis && typeof w.SpeechSynthesisUtterance === "function");
}

/**
 * Langue a demander a la synthese vocale : celle de l'interface
 * (`<html lang>`), sinon celle du systeme, sinon le francais.
 * @param {Document} [doc]
 * @param {Navigator} [nav]
 * @returns {string} ex. "fr-FR"
 */
export function speechLang(doc, nav) {
  const d = doc || globalThis.document;
  const declared = (d && d.documentElement && d.documentElement.lang) || "";
  if (String(declared).trim()) return normalizeLang(declared);
  const n = nav || globalThis.navigator;
  const system = (n && n.language) || "";
  if (String(system).trim()) return normalizeLang(system);
  return "fr-FR";
}

/** Normalise une langue ("fr", "fr-fr", "fr_FR" -> "fr-FR"). */
function normalizeLang(raw) {
  const cleaned = String(raw || "").trim().replace(/_/g, "-");
  if (!cleaned) return "fr-FR";
  const parts = cleaned.split("-");
  const base = parts[0].toLowerCase();
  if (parts.length === 1) return base === "fr" ? "fr-FR" : base;
  return base + "-" + parts[1].toUpperCase();
}

/** Base de langue ("fr-FR" -> "fr") pour comparer des voix. */
function langBase(raw) {
  return String(raw || "").trim().toLowerCase().split(/[-_]/)[0];
}

/**
 * Premiere voix disponible dans la langue demandee (comparaison sur la langue
 * de base : une voix "fr-CA" convient a une interface "fr-FR").
 * @param {SpeechSynthesisVoice[]} voices
 * @param {string} lang
 * @returns {SpeechSynthesisVoice|null}
 */
export function pickVoiceForLang(voices, lang) {
  const list = (Array.isArray(voices) ? voices : []).filter(Boolean);
  if (!list.length) return null;
  const wanted = normalizeLang(lang).toLowerCase();
  const exact = list.find(
    (v) => String(v.lang || "").replace(/_/g, "-").toLowerCase() === wanted,
  );
  if (exact) return exact;
  const base = langBase(lang);
  return list.find((v) => langBase(v.lang) === base) || null;
}

// ── Choix de la voix (reglage unique : Parametres → Assistant) ─────────────

/**
 * Identite stable d'une voix, telle qu'enregistree en configuration : son
 * `voiceURI` quand il existe (stable d'un demarrage a l'autre), sinon son nom.
 * @param {SpeechSynthesisVoice} voice
 * @returns {string}
 */
export function voiceKey(voice) {
  if (!voice) return "";
  return String(voice.voiceURI || voice.name || "").trim();
}

/**
 * Voix installees dans cette fenetre. Jamais d'exception : liste vide si la
 * synthese vocale est absente ou si la liste n'est pas encore chargee.
 * @param {Window} [win]
 * @returns {SpeechSynthesisVoice[]}
 */
export function availableVoices(win) {
  const w = win || globalThis.window;
  const synth = w && w.speechSynthesis;
  if (!synth) return [];
  const list = safeCall(() => synth.getVoices(), []);
  const arr = Array.isArray(list) ? list : Array.from(list || []);
  return arr.filter(Boolean);
}

/**
 * Voix preferee memorisee (Parametres → Assistant). Valeur vide = automatique
 * (voix de la langue de l'interface).
 * @returns {string}
 */
export function getPreferredVoiceName() {
  return preferredVoiceName;
}

/**
 * Memorise la voix preferee, en memoire. La persistance est faite par la
 * configuration (`read_aloud_voice`), ecrite par la modale des Parametres.
 * @param {string} name
 */
export function setPreferredVoiceName(name) {
  preferredVoiceName = String(name == null ? "" : name).trim();
}

/**
 * Applique la voix memorisee dans la configuration (`read_aloud_voice`).
 * Appelee au demarrage et apres chaque enregistrement des Parametres : une
 * configuration sans le champ (ou un objet absent) ne change rien.
 * @param {object} [config]
 */
export function applyVoicePreferenceFromConfig(config) {
  if (!config || typeof config !== "object") return;
  if (!Object.prototype.hasOwnProperty.call(config, "read_aloud_voice")) return;
  setPreferredVoiceName(config.read_aloud_voice ? String(config.read_aloud_voice) : "");
}

/**
 * Cherche une voix par son identite (identifiant stable, puis nom : une voix
 * reinstallee peut changer d'identifiant sans changer de nom).
 * @param {SpeechSynthesisVoice[]} voices
 * @param {string} choice
 * @returns {SpeechSynthesisVoice|null}
 */
export function findVoiceForChoice(voices, choice) {
  const wanted = String(choice == null ? "" : choice).trim();
  if (!wanted) return null;
  const list = (Array.isArray(voices) ? voices : []).filter(Boolean);
  const byKey = list.find((v) => voiceKey(v) === wanted);
  if (byKey) return byKey;
  return list.find((v) => String(v.name || "").trim() === wanted) || null;
}

/**
 * Voix REELLEMENT utilisee pour lire : la voix choisie si elle existe encore,
 * sinon repli propre sur la voix de la langue de l'interface (regle 7).
 * @param {SpeechSynthesisVoice[]} voices
 * @param {string} lang
 * @param {string} [choice]
 * @returns {SpeechSynthesisVoice|null}
 */
export function resolveVoiceForChoice(voices, lang, choice) {
  const list = (Array.isArray(voices) ? voices : []).filter(Boolean);
  if (!list.length) return null;
  return findVoiceForChoice(list, choice) || pickVoiceForLang(list, lang);
}

/**
 * Options du choix de voix : « automatique » d'abord, puis chaque voix
 * installee, triee par langue puis par nom.
 * @param {SpeechSynthesisVoice[]} voices
 * @returns {{value: string, label: string}[]}
 */
export function voiceChoiceOptions(voices, local) {
  const list = (Array.isArray(voices) ? voices : []).filter(Boolean).slice();
  const autoLabel = "Automatique (voix de la langue de l'interface)";
  const options = [{ value: AUTO_VOICE_VALUE, label: autoLabel }];
  // Voix francaises LOCALES : proposees juste apres « automatique » des que
  // l'appelant fournit l'etat du moteur local (Parametres). Une entree par
  // modele, libelle en clair (« voix d'homme » / « voix de femme ») : aucun
  // choix fantome, aucun modele invente. Le premier est celui que designe la
  // valeur historique du reglage (compatibilite d'une configuration deja
  // enregistree).
  if (local) {
    const statusModel = String((local && local.voice) || "");
    for (const entry of localVoiceChoices()) {
      const known = !statusModel || statusModel === entry.model;
      const label =
        entry.value === LOCAL_VOICE_VALUE && known ? localVoiceChoiceLabel(local) : entry.label;
      options.push({ value: entry.value, label });
    }
  }
  list.sort((a, b) => {
    const la = String(a.lang || "");
    const lb = String(b.lang || "");
    if (la !== lb) return la < lb ? -1 : 1;
    const na = String(a.name || "");
    const nb = String(b.name || "");
    return na < nb ? -1 : na > nb ? 1 : 0;
  });
  for (const voice of list) {
    const name = String(voice.name || "").trim() || voiceKey(voice);
    const lang = String(voice.lang || "").trim();
    options.push({ value: voiceKey(voice), label: lang ? `${name} (${lang})` : name });
  }
  return options;
}

/**
 * Etat du reglage de voix, tel que l'affiche le panneau des Parametres.
 *  - `empty`   : aucune voix installee (reglage inactif + phrase explicative) ;
 *  - `missing` : la voix memorisee n'existe plus (repli automatique annonce) ;
 *  - `ok`      : le reglage est utilisable.
 * @param {SpeechSynthesisVoice[]} voices
 * @param {string} [choice]
 * @param {{installed?: boolean, dir?: string}|null} [local] etat du moteur local
 * @returns {{kind: "empty"|"missing"|"ok"|"local-missing", hint: string, missing: string, value: string}}
 */
export function voiceChoiceStatus(voices, choice, local) {
  const list = (Array.isArray(voices) ? voices : []).filter(Boolean);
  const wanted = String(choice == null ? "" : choice).trim();
  const localModel = localVoiceModelFor(wanted);
  // Un etat de moteur ne concerne qu'UN modele : un etat portant un autre nom de
  // modele n'est jamais utilise pour juger la voix demandee.
  const statusModel = String((local && local.voice) || "");
  const localInstalled =
    !!(local && local.installed) && (!statusModel || statusModel === localModel);
  // Choix de la voix locale : le choix est CONSERVE (il ne se perd pas si le
  // modele est telecharge plus tard), et la note dit clairement ce qui se passe
  // pendant ce temps (lecture avec la voix du systeme).
  if (localModel) {
    if (localInstalled) {
      return { kind: "ok", hint: LOCAL_VOICE_READY_HINT, missing: "", value: wanted };
    }
    return {
      kind: "local-missing",
      hint: localVoiceMissingHint(local && local.dir),
      missing: "",
      value: wanted,
    };
  }
  if (!list.length) {
    // Aucune voix du systeme mais moteur local pret : le reglage reste
    // utilisable (le local prend le relais), et la note le dit.
    if (localInstalled) {
      return { kind: "ok", hint: LOCAL_VOICE_ONLY_HINT, missing: "", value: wanted };
    }
    return { kind: "empty", hint: NO_VOICE_INSTALLED_HINT, missing: "", value: AUTO_VOICE_VALUE };
  }
  if (wanted && !findVoiceForChoice(list, wanted)) {
    return {
      kind: "missing",
      hint:
        `La voix memorisee \u00ab\u00a0${wanted}\u00a0\u00bb n'est plus disponible sur cet ordinateur : ` +
        "la lecture utilise la voix de la langue de l'interface.",
      missing: wanted,
      value: AUTO_VOICE_VALUE,
    };
  }
  return { kind: "ok", hint: READ_ALOUD_HELP_HINT, missing: "", value: wanted };
}

/**
 * Libelle d'etat affiche dans le panneau « Lecture des reponses ».
 * @param {string} [state]
 * @returns {string}
 */
export function readAloudStateLabel(state) {
  switch (state) {
    case "speaking":
      return "Lecture en cours\u2026";
    case "ended":
      return "Lecture terminee.";
    case "stopped":
      return "Lecture arretee.";
    case "local-fallback":
      return (
        "Voix française locale indisponible : lecture avec la voix du système " +
        "(détail dans le journal)."
      );
    case "empty":
      return "Rien a lire dans ce message.";
    case "no-voice":
      return "Aucune voix disponible : lecture impossible sur cet ordinateur.";
    case "unavailable":
      return "La synthese vocale n'est pas disponible dans cette fenetre.";
    default:
      return "Aucune lecture en cours.";
  }
}

/**
 * Nettoie un texte (Markdown rendu en HTML et/ou Markdown brut) pour qu'il soit
 * LISIBLE par la voix : aucun emoji, aucun symbole de balisage, blocs de code
 * non debites, liens remplaces par leur libelle, ponctuation conservee (elle
 * donne le rythme de la phrase).
 *
 * Nom HISTORIQUE conserve (les appelants et les tests l'utilisent) :
 * l'implementation UNIQUE vit dans `textForSpeech` (`speech-text.js`).
 * @param {string} raw
 * @returns {string}
 */
export function markupToSpeech(raw) {
  return textForSpeech(raw);
}

/**
 * Decoupe un texte en morceaux courts, phrase par phrase, en preservant l'ordre.
 * Une phrase trop longue est recoupee sur une FIN DE PHRASE ou une FIN DE MOT
 * (`cutTextAtBoundary`) : jamais au milieu d'un mot, jamais au-dela de `maxLen`
 * (sauf mot insecable plus long que la limite).
 * @param {string} text
 * @param {number} [maxLen]
 * @returns {string[]}
 */
export function splitSentences(text, maxLen = SPEECH_MAX_CHUNK) {
  const clean = String(text == null ? "" : text).trim();
  if (!clean) return [];
  const limit = Math.max(20, Number(maxLen) || SPEECH_MAX_CHUNK);
  const out = [];
  for (const line of clean.split(/\n+/)) {
    for (const sentence of sentencesOfLine(line)) {
      if (sentence.length <= limit) {
        out.push(sentence);
        continue;
      }
      // Phrase trop longue : coupure sur une fin de phrase ou de mot, JAMAIS
      // au milieu d'un mot (`cutTextAtBoundary`, speech-text.js).
      let rest = sentence;
      while (rest.length > limit) {
        const [head, tail] = cutTextAtBoundary(rest, limit);
        if (head) out.push(head);
        rest = tail;
      }
      if (rest) out.push(rest);
    }
  }
  return out;
}

/** Decoupe une ligne en phrases (ponctuation forte suivie d'une espace). */
function sentencesOfLine(line) {
  const out = [];
  let buf = "";
  const chars = Array.from(String(line || ""));
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    buf += c;
    if (c === "." || c === "!" || c === "?" || c === "\u2026") {
      const next = chars[i + 1];
      if (next === undefined || next === " " || next === "\t") {
        const sentence = buf.trim();
        if (sentence) out.push(sentence);
        buf = "";
      }
    }
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

/**
 * Attend que les voix soient chargees (le premier appel les renvoie souvent
 * vides) puis renvoie la voix de la langue demandee.
 * @param {SpeechSynthesis} synth
 * @param {string} lang
 * @param {number} [waitMs]
 * @returns {Promise<SpeechSynthesisVoice|null>}
 */
export function ensureVoices(synth, waitMs = VOICES_WAIT_MS) {
  if (!synth) return Promise.resolve([]);
  const read = () => {
    const voices = safeCall(() => synth.getVoices(), []);
    return (Array.isArray(voices) ? voices : Array.from(voices || [])).filter(Boolean);
  };
  const initial = read();
  if (initial.length) return Promise.resolve(initial);
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    const finish = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      safeCall(() => synth.removeEventListener("voiceschanged", finish));
      resolve(read());
    };
    safeCall(() => synth.addEventListener("voiceschanged", finish));
    timer = setTimeout(finish, Math.max(0, Number(waitMs) || 0));
    // Node (tests) : ne pas retenir la boucle d'evenements.
    if (timer && typeof timer.unref === "function") timer.unref();
  });
}

/**
 * Attend le chargement des voix puis renvoie la PREMIERE voix de la langue
 * demandee (ou null si aucune voix ne correspond).
 * @param {SpeechSynthesis} synth
 * @param {string} lang
 * @param {number} [waitMs]
 * @returns {Promise<SpeechSynthesisVoice|null>}
 */
export function ensureVoice(synth, lang, waitMs = VOICES_WAIT_MS) {
  if (!synth) return Promise.resolve(null);
  return ensureVoices(synth, waitMs).then((voices) => pickVoiceForLang(voices, lang));
}

/** Arrete TOUTE lecture en cours (quel que soit le bouton qui l'a lancee). */
export function stopReading() {
  if (currentPlayback) currentPlayback.stop();
}

/**
 * Traduction lisible d'un echec du moteur local (message du journal).
 * @param {string} reason
 * @returns {string}
 */
export function localFailureReason(reason) {
  switch (reason) {
    case "unavailable":
      return "la synthese locale n'a rien renvoye";
    case "error":
      return "le son local n'a pas pu etre joue";
    case "no-audio":
      return "cette fenetre ne sait pas jouer de son";
    case "empty":
      return "aucun texte a lire";
    case "stopped":
      return "lecture interrompue";
    default:
      return String(reason || "raison inconnue");
  }
}

/**
 * Cree un lecteur pour une fenetre. Une seule lecture a la fois pour toute
 * l'application : un nouveau `speak` arrete la lecture precedente.
 * @param {Window} win
 * @param {{lang?: string, waitMs?: number, invoke?: Function, voiceName?: string}} [options]
 */
export function createSpeaker(win, options = {}) {
  const w = win || globalThis.window;
  const synth = (w && w.speechSynthesis) || null;
  const Utterance = (w && w.SpeechSynthesisUtterance) || null;
  const lang = options.lang || speechLang(w && w.document);
  const waitMs = options.waitMs == null ? VOICES_WAIT_MS : options.waitMs;
  const self = { token: null, speaking: () => false, speak, stop: stopReading };

  /** Previens le panneau des Parametres de l'etat de lecture (regle 6/7). */
  const broadcastState = (state) => {
    safeCall(() => {
      if (!w || typeof w.dispatchEvent !== "function") return;
      const Ev = w.CustomEvent || globalThis.CustomEvent;
      if (typeof Ev !== "function") return;
      w.dispatchEvent(new Ev(READ_ALOUD_STATE_EVENT, { detail: { state } }));
    });
  };

  /**
   * Lit un texte (nettoye puis decoupe). Renvoie une promesse resolue a la fin
   * ou a l'arret.
   * @param {string} text
   * @param {{onstate?: (state: "speaking"|"stopped"|"ended"|"unavailable"|"empty"|"no-voice"|"local-fallback") => void}} [handlers]
   */
  async function speak(text, handlers = {}) {
    const notify = (state) => {
      safeCall(() => handlers.onstate && handlers.onstate(state));
      broadcastState(state);
    };
    if (!synth || !Utterance) {
      notify("unavailable");
      return false;
    }
    // SEUL endroit ou le texte part vers la synthese vocale : nettoyage unique
    // (`textForSpeech`, speech-text.js) puis decoupage en morceaux courts.
    const chunks = splitSentences(textForSpeech(text));
    if (!chunks.length) {
      notify("empty");
      return false;
    }
    stopReading(); // une seule lecture a la fois
    const token = { id: ++playbackSeq, stopped: false };
    // Arrets complementaires : la lecture locale doit pouvoir couper son audio
    // en cours (le `synth.cancel()` ne la concerne pas).
    const extraStops = [];
    const playback = {
      token,
      stop() {
        if (token.stopped) return;
        token.stopped = true;
        safeCall(() => synth.cancel());
        for (const fn of extraStops.slice()) safeCall(fn);
        if (currentPlayback === playback) currentPlayback = null;
        notify("stopped");
      },
    };
    currentPlayback = playback;
    self.token = token;

    // Etat affiche tout de suite (le chargement des voix peut prendre un
    // instant) : le bouton passe a « Arreter » sans attendre.
    notify("speaking");

    // Voix choisie dans LE reglage unique (Parametres → Assistant → Lecture des
    // reponses). Soit une voix du systeme, soit la voix francaise LOCALE.
    const choice = options.voiceName == null ? getPreferredVoiceName() : options.voiceName;

    // ── Voix FRANCAISE LOCALE (Piper) : hors ligne, sans cle, sans GPU ──────
    // Meme texte nettoye, meme decoupage que la voix du systeme : seul le moteur
    // de synthese change. Le repli est OBLIGATOIRE et VISIBLE : moteur ou modele
    // absent, synthese en echec, audio refuse -> une ligne dans le journal, un
    // etat clair, puis lecture avec la voix du systeme (jamais de blocage).
    if (isLocalVoiceChoice(choice)) {
      // Voix locale CHOISIE : chaque modele a son propre etat (un modele present
      // ne vaut pas pour un autre).
      const localModel = localVoiceModelFor(choice);
      const cached = localVoiceStatusFor(localModel);
      const local = cached || (await refreshLocalVoiceStatus({ ...options, model: localModel }));
      if (token.stopped || currentPlayback !== playback) return false;
      if (local && local.installed) {
        const outcome = await playLocalChunks({
          win: w,
          chunks,
          model: localModel,
          invoke: options.invoke,
          isCancelled: () => token.stopped || currentPlayback !== playback,
          onStopRegister: (fn) => extraStops.push(fn),
        });
        if (outcome.reason === "ended") {
          currentPlayback = null;
          token.stopped = true;
          notify("ended");
          return true;
        }
        if (outcome.reason === "stopped" || token.stopped) return false;
        await logLocalVoice(
          `Voix francaise locale indisponible (${localFailureReason(outcome.reason)}) : ` +
            "repli sur la voix du systeme.",
          options,
        );
      } else {
        await logLocalVoice(
          `Voix francaise locale non installee (${(local && local.hint) || "moteur absent"}) : ` +
            "repli sur la voix du systeme.",
          options,
        );
      }
      if (token.stopped || currentPlayback !== playback) return false;
      // Dit clairement a l'utilisateur que la lecture ne se fait pas avec la
      // voix demandee (etat visible dans le panneau des Parametres).
      notify("local-fallback");
    }

    // Voix du systeme : on attend leur chargement (sinon la premiere lecture
    // partirait en silence), puis on applique la voix choisie dans les
    // Parametres — repli propre sur la voix de la langue de l'interface si elle
    // a disparu (regle 7).
    const voices = await ensureVoices(synth, waitMs);
    // Arret (ou autre lecture) pendant l'attente : on ne parle pas.
    if (token.stopped || currentPlayback !== playback) return false;
    // Aucune voix installee : on ne lance pas une lecture muette, on le dit.
    if (!voices.length) {
      currentPlayback = null;
      token.stopped = true;
      notify("no-voice");
      return false;
    }
    const voice = resolveVoiceForChoice(voices, lang, choice);

    const speakIndex = (index) => {
      if (token.stopped || currentPlayback !== playback) return;
      if (index >= chunks.length) {
        currentPlayback = null;
        token.stopped = true;
        notify("ended");
        return;
      }
      const utterance = new Utterance(chunks[index]);
      utterance.lang = lang;
      if (voice) utterance.voice = voice;
      utterance.onend = () => speakIndex(index + 1);
      utterance.onerror = () => {
        if (!token.stopped) playback.stop();
      };
      safeCall(() => synth.speak(utterance));
    };

    speakIndex(0);
    return true;
  }

  self.speaking = () => !!currentPlayback && currentPlayback.token === self.token;
  return self;
}

/** Conteneur du flux chronologique d'un message de l'assistant. */
function flowOf(messageEl) {
  const flow = safeCall(() =>
    messageEl.querySelector ? messageEl.querySelector(".agent-stream-flow") : null,
  );
  if (flow) return flow;
  // Compatibilite avec de tres anciennes bulles (pas de flux) : on se limite a
  // la bulle de l'assistant, jamais au message entier.
  return safeCall(
    () => (messageEl.querySelector ? messageEl.querySelector(".agent-bubble-assistant") : null),
    null,
  );
}

/** Vrai si l'element est une NOTE TECHNIQUE (jamais lue, mais neutre). */
export function isInternalNotice(el) {
  const data = el && el.dataset;
  return !!(data && String(data[INTERNAL_MARKER]) === "true");
}

/** Vrai si l'element est un bloc de travail interne qui FRONTIERE la reponse. */
export function isInternalWorkBlock(el) {
  const classes = el && el.classList;
  if (!classes || typeof classes.contains !== "function") return false;
  return INTERNAL_BOUNDARY_CLASSES.some((name) => classes.contains(name));
}

/**
 * Sections de texte qui forment la REPONSE FINALE d'un message de l'assistant.
 *
 * Regle structurelle (regle 8) : on parcourt les enfants du flux dans l'ordre et
 * on ne garde que la suite FINALE de sections de texte. Un bloc de travail
 * interne (raisonnement, appel d'outil, resultat d'outil, sortie de commande)
 * remet la suite a zero : le texte de narration emis avant un outil n'est donc
 * jamais lu. Une note technique marquee (`data-agent-internal`) est ignoree
 * sans couper la suite ; les autres elements (badges projet, boutons de choix)
 * sont neutres.
 * @param {HTMLElement} messageEl - element `.agent-message-assistant`
 * @returns {HTMLElement[]} sections de la reponse finale (vide s'il n'y en a pas)
 */
export function finalAnswerSections(messageEl) {
  if (!messageEl) return [];
  const container = flowOf(messageEl);
  if (!container) return [];
  const children = safeCall(() => Array.from(container.children || []), []);
  const answer = [];
  for (const child of children) {
    if (!child) continue;
    if (isInternalNotice(child)) continue; // note technique : ignoree, jamais lue
    if (isInternalWorkBlock(child)) {
      answer.length = 0; // travail interne : ce qui precede n'est pas la reponse
      continue;
    }
    if (child.classList && child.classList.contains("agent-text-section")) answer.push(child);
    // Tout autre element (badges, boutons de choix...) ne coupe pas la suite.
  }
  return answer;
}

/** Texte a lire : la SEULE reponse finale du message, nettoyee (regle 8). */
export function messageTextOf(messageEl) {
  if (!messageEl) return "";
  const parts = [];
  for (const section of finalAnswerSections(messageEl)) {
    const html = typeof section.innerHTML === "string" ? section.innerHTML : "";
    const clean = markupToSpeech(html || section.textContent || "");
    if (clean) parts.push(clean);
  }
  return parts.join("\n");
}

/** Etats d'affichage du bouton (texte + visuel, comprehensible sans couleur). */
export const LABELS = {
  idle: { text: "\u00c9couter", icon: "volume-2", title: "Lire cette r\u00e9ponse \u00e0 voix haute", aria: "Lire la r\u00e9ponse \u00e0 voix haute" },
  speaking: { text: "Arr\u00eater", icon: "square", title: "Arr\u00eater la lecture \u00e0 voix haute", aria: "Arr\u00eater la lecture \u00e0 voix haute" },
  unavailable: {
    text: "\u00c9couter",
    icon: "volume-x",
    title: "La synth\u00e8se vocale n'est pas disponible dans cette fen\u00eatre.",
    aria: "La synth\u00e8se vocale n'est pas disponible dans cette fen\u00eatre",
  },
  // Synthese vocale presente mais AUCUNE voix installee : bouton inactif et
  // explication claire (regle 6). Il se reactive seul si une voix arrive.
  novoice: {
    text: "\u00c9couter",
    icon: "volume-x",
    title: NO_VOICE_HINT,
    aria: NO_VOICE_HINT,
  },
};

/**
 * Applique un etat au bouton (libelle en TEXTE + `aria-pressed` + classe).
 * @param {HTMLElement} button
 * @param {"idle"|"speaking"|"unavailable"|"novoice"} state
 */
export function applyButtonState(button, state) {
  if (!button) return;
  const spec = LABELS[state] || LABELS.idle;
  const label = button.querySelector ? button.querySelector(".agent-read-label") : null;
  if (label) label.textContent = spec.text;
  button.setAttribute("aria-pressed", state === "speaking" ? "true" : "false");
  button.setAttribute("aria-label", spec.aria);
  button.title = spec.title;
  button.dataset.readState = state;
  if (button.classList) {
    button.classList.toggle("agent-read-btn-speaking", state === "speaking");
    button.classList.toggle(
      "agent-read-btn-unavailable",
      state === "unavailable" || state === "novoice",
    );
  }
  return button;
}

/**
 * Cree le bouton « Ecouter / Arreter ». Fonctionne sans synthese vocale : dans
 * ce cas le bouton est present mais inactif, avec une explication en infobulle.
 * @param {{doc?: Document, win?: Window, getText: () => string, lang?: string,
 *          invoke?: Function, refreshIcons?: (root: HTMLElement) => void}} options
 */
export function createReadAloudButton({ doc, win, getText, lang, invoke, refreshIcons } = {}) {
  const w = win || globalThis.window;
  const d = doc || (w && w.document) || globalThis.document;
  if (!d) return null;
  const button = d.createElement("button");
  button.type = "button";
  button.className = "agent-btn agent-read-btn";
  button.dataset.readState = "idle";
  const iconHolder = d.createElement("span");
  iconHolder.className = "agent-read-icon";
  const label = d.createElement("span");
  label.className = "agent-read-label";
  button.appendChild(iconHolder);
  button.appendChild(label);

  // Visuel d'etat : l'icone change en meme temps que le libelle (etat
  // comprehensible sans couleur). L'icone est une balise Lucide standard ;
  // `refreshIcons` (icons.js) la rend — aucun import supplementaire ici.
  const paintIcon = (name) => {
    iconHolder.innerHTML = `<i data-lucide="${name}" class="icon-sm" aria-hidden="true"></i>`;
    if (typeof refreshIcons === "function") safeCall(() => refreshIcons(iconHolder));
  };
  const setState = (state) => {
    const spec = LABELS[state] || LABELS.idle;
    applyButtonState(button, state);
    paintIcon(spec.icon);
  };

  if (!speechAvailable(w)) {
    button.disabled = true;
    setState("unavailable");
    return button;
  }
  setState("idle");

  // Aucune voix installee : le bouton reste visible mais INACTIF, avec une
  // explication. Il se reactive tout seul des qu'une voix est disponible
  // (regle 6) — sans jamais lancer de lecture de lui-meme.
  let awaitingVoices = false;
  const onVoicesChanged = () => {
    if (!availableVoices(w).length) return;
    safeCall(() => w.speechSynthesis.removeEventListener("voiceschanged", onVoicesChanged));
    awaitingVoices = false;
    if (button.dataset.readState === "novoice") {
      button.disabled = false;
      setState("idle");
    }
  };
  const showNoVoice = () => {
    button.disabled = true;
    setState("novoice");
    if (awaitingVoices) return;
    awaitingVoices = true;
    safeCall(() => w.speechSynthesis.addEventListener("voiceschanged", onVoicesChanged));
  };
  const disableIfNoVoice = (list) => {
    if (list && list.length) return;
    // La voix francaise LOCALE installee rend la lecture possible meme sans
    // aucune voix du systeme : dans ce cas on ne desactive pas le bouton.
    if (isLocalVoiceChoice(getPreferredVoiceName()) && isLocalVoiceInstalledFor(localVoiceModelFor(getPreferredVoiceName()))) return;
    // Jamais pendant une lecture : on ne desactive pas un bouton qui parle.
    const state = button.dataset.readState;
    if (state === "speaking" || state === "unavailable") return;
    showNoVoice();
  };
  // Au depart la liste est souvent vide (chargement asynchrone) : on laisse le
  // temps d'attente habituel, puis on tranche une fois pour toutes.
  if (!availableVoices(w).length) {
    ensureVoices(w.speechSynthesis, VOICES_WAIT_MS).then(disableIfNoVoice);
  }

  // Aucune reponse finale dans ce message : on ne lit RIEN et on le dit
  // clairement (libelle visible temporaire + infobulle explicative), au lieu de
  // debiter du vide en silence.
  let emptyTimer = null;
  const showEmptyState = () => {
    applyButtonState(button, "idle");
    const labelEl = button.querySelector ? button.querySelector(".agent-read-label") : null;
    if (labelEl) labelEl.textContent = EMPTY_LABEL;
    button.title = EMPTY_MESSAGE_HINT;
    button.setAttribute("aria-label", EMPTY_MESSAGE_HINT);
    if (emptyTimer) clearTimeout(emptyTimer);
    emptyTimer = setTimeout(() => {
      emptyTimer = null;
      setState("idle");
    }, EMPTY_HINT_MS);
    if (emptyTimer && typeof emptyTimer.unref === "function") emptyTimer.unref();
  };

  const speaker = createSpeaker(w, {
    lang: lang || speechLang(d),
    invoke,
  });
  // Statut du moteur de voix locale : demande UNE fois, sans bloquer. Il sert a
  // ne pas desactiver le bouton quand la voix locale est choisie et prete.
  if (isLocalVoiceChoice(getPreferredVoiceName()) && !getLocalVoiceStatus()) {
    refreshLocalVoiceStatus({ invoke, model: localVoiceModelFor(getPreferredVoiceName()) }).then((status) => {
      if (!status || !status.installed) return;
      if (button.dataset.readState !== "novoice") return;
      button.disabled = false;
      setState("idle");
    });
  }
  button.addEventListener("click", async () => {
    if (button.dataset.readState === "speaking") {
      speaker.stop();
      return;
    }
    const text = safeCall(() => (typeof getText === "function" ? getText() : ""), "") || "";
    const ok = await speaker.speak(text, {
      onstate: (state) => {
        if (state === "speaking") setState("speaking");
        else if (state === "empty") showEmptyState();
        else if (state === "no-voice") showNoVoice();
        // Repli sur la voix du systeme : la lecture CONTINUE, le bouton reste
        // donc sur « Arreter » (et le panneau des Parametres dit le repli).
        else if (state === "local-fallback") setState("speaking");
        else setState("idle");
      },
    });
    return ok;
  });
  return button;
}

/**
 * Pose la rangee d'actions (bouton de lecture) sous une bulle de l'assistant.
 * A n'appeler QUE pour un message de l'assistant : ni les messages de
 * l'utilisateur ni les evenements systeme ne portent ce bouton.
 * @param {HTMLElement} messageEl - element `.agent-message-assistant`
 * @param {{doc?: Document, win?: Window, getText?: () => string, lang?: string,
 *          invoke?: Function, refreshIcons?: (root: HTMLElement) => void}} [options]
 * @returns {HTMLElement|null} le bouton pose
 */
export function attachReadAloud(messageEl, options = {}) {
  const d = options.doc || (options.win && options.win.document) || globalThis.document;
  if (!messageEl || !d) return null;
  const row = d.createElement("div");
  row.className = "agent-message-actions";
  const button = createReadAloudButton({
    doc: d,
    win: options.win,
    lang: options.lang,
    invoke: options.invoke,
    refreshIcons: options.refreshIcons,
    getText: options.getText || (() => messageTextOf(messageEl)),
  });
  if (!button) return null;
  row.appendChild(button);
  messageEl.appendChild(row);
  return button;
}
