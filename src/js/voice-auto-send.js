// voice-auto-send.js — SOURCE UNIQUE de la décision « la dictée vocale vient de
// se terminer : la demande part-elle toute seule ? » (décision du propriétaire
// du 2026-10-26, validée explicitement).
//
// Objectif borné : à la FIN NORMALE d'une dictée, si le texte DICTÉ est non vide,
// le message est envoyé exactement comme un appui sur Entrée — l'appelant
// réutilise son chemin d'envoi existant (`sendPrompt`). Ce module ne sait pas
// envoyer : il décide seulement, et il est PUR (testé sans DOM ni Tauri).
//
// Règles de sûreté tenues ICI :
//   1. jamais d'envoi pour un texte vide ou composé uniquement d'espaces ;
//   2. jamais d'envoi si la session de dictée n'est plus ouverte — donc en cas
//      d'erreur de reconnaissance, de refus de permission, d'arrêt par panne
//      réseau, d'arrêt manuel, ou d'un évènement de fin reçu DEUX fois (l'appelant
//      referme la session à la première fin ⇒ un seul envoi par dictée) ;
//   3. la valeur écrite dans la zone de saisie reste exactement celle d'avant la
//      décision (texte déjà présent + texte dicté, une seule espace de séparation),
//      pour que l'envoi automatique porte sur ce que l'utilisateur voit.
//
// Aucun réglage : décision du propriétaire, ce comportement est le défaut.
// Aucune lecture de configuration, aucune dépendance.

/** La session de dictée n'est plus ouverte (erreur, arrêt, fin déjà traitée). */
export const VOICE_END_NO_SESSION = "session-fermee";
/** Fin normale, mais rien n'a été dicté : on n'envoie pas. */
export const VOICE_END_EMPTY = "texte-vide";
/** Fin normale avec du texte dicté : on envoie, une seule fois. */
export const VOICE_END_SEND = "fin-normale-avec-texte";

/** Texte dicté ramené à sa forme utile (jamais `null`/`undefined`). */
export function normalizedVoiceText(dictatedText) {
  return String(dictatedText == null ? "" : dictatedText).trim();
}

/**
 * Compose la valeur de la zone de saisie à la fin de la dictée — même règle de
 * séparation que le code historique (`preText + " " + dicté` sauf si `preText`
 * finit déjà par une espace).
 */
export function composeVoiceInputValue(preText, dictatedText) {
  const pre = String(preText == null ? "" : preText);
  const dictated = String(dictatedText == null ? "" : dictatedText);
  const sep = pre && !pre.endsWith(" ") ? " " : "";
  return pre + sep + dictated;
}

/**
 * Traite une fin d'écoute de bout en bout, avec effets INJECTÉS (donc testable
 * sans DOM ni Tauri) : la session est refermée AVANT l'écriture et l'envoi, si
 * bien qu'un second évènement de fin (ou un second `onend` du moteur) ne peut
 * jamais produire un second message.
 *
 * Ordre garanti : `closeSession()` → `write(valeur)` → `send()` (et `send`
 * seulement si la décision l'autorise). Aucune de ces trois fonctions n'est
 * appelée si la session n'était pas ouverte avant ce traitement (erreur,
 * refus de permission, panne réseau, arrêt manuel, fin déjà traitée).
 *
 * @param {object} input
 * @param {boolean} input.sessionActive session ouverte AVANT ce traitement.
 * @param {string} input.preText texte déjà présent dans la zone de saisie.
 * @param {string} input.dictatedText texte réellement dicté.
 * @param {() => void} [input.closeSession] referme la session de dictée.
 * @param {(value: string) => void} [input.write] écrit la valeur dans la zone.
 * @param {() => void} [input.send] chemin d'envoi EXISTANT (Entrée / ▶️).
 * @returns {{autoSend: boolean, reason: string, dictatedText: string, sent: boolean}}
 */
export function applyVoiceEnd(input) {
  const { sessionActive, preText, dictatedText, closeSession, write, send } = input || {};
  const decision = decideVoiceAutoSend({ sessionActive, dictatedText });
  if (sessionActive !== true) {
    return { ...decision, sent: false };
  }
  if (typeof closeSession === "function") closeSession();
  if (typeof write === "function") write(composeVoiceInputValue(preText, dictatedText));
  if (decision.autoSend && typeof send === "function") {
    send();
    return { ...decision, sent: true };
  }
  return { ...decision, sent: false };
}

/**
 * Décide la fin d'une session de dictée.
 *
 * @param {object} input
 * @param {boolean} input.sessionActive `true` seulement si la session de dictée
 *   était encore ouverte AVANT ce traitement (fin normale). Un évènement de fin
 *   arrivé après une erreur, un arrêt manuel ou une première fin ⇒ `false`.
 * @param {string} input.dictatedText texte réellement dicté (résultats finaux).
 * @returns {{autoSend: boolean, reason: string, dictatedText: string}}
 */
export function decideVoiceAutoSend(input) {
  const { sessionActive, dictatedText } = input || {};
  const text = normalizedVoiceText(dictatedText);
  if (sessionActive !== true) {
    return { autoSend: false, reason: VOICE_END_NO_SESSION, dictatedText: text };
  }
  if (!text) {
    return { autoSend: false, reason: VOICE_END_EMPTY, dictatedText: text };
  }
  return { autoSend: true, reason: VOICE_END_SEND, dictatedText: text };
}
