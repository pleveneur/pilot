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
//      pour que l'envoi automatique porte sur ce que l'utilisateur voit ;
//   4. si l'UTILISATEUR a repris la main pendant la dictée (il a tapé, collé ou
//      vidé la zone), sa saisie n'est JAMAIS réécrite et rien ne part : il garde
//      la main. Le texte qu'il a écrit est celui qui est envoyé, et seulement
//      s'il valide lui-même.
//
// Aucun réglage : décision du propriétaire, ce comportement est le défaut.
// Aucune lecture de configuration, aucune dépendance.

/** La session de dictée n'est plus ouverte (erreur, arrêt, fin déjà traitée). */
export const VOICE_END_NO_SESSION = "session-fermee";
/** L'utilisateur a repris la main pendant la dictée : on n'écrit rien, on n'envoie pas. */
export const VOICE_END_USER_TAKEOVER = "utilisateur-a-repris-la-main";
/** Fin normale, mais rien n'a été dicté : on n'envoie pas. */
export const VOICE_END_EMPTY = "texte-vide";
/** Fin normale avec du texte dicté : on envoie, une seule fois. */
export const VOICE_END_SEND = "fin-normale-avec-texte";

/**
 * DUREE MINIMALE D'UNE VRAIE ECOUTE (ms) — au-dela, une fin d'ecoute VIDE n'est
 * pas une boucle : c'est un silence.
 *
 * Le defaut que ce seuil corrige (proprietaire : « en mode vocal, a un moment
 * donne, le micro est coupe ») : le plafond des sessions vides (`isSilentEmptyVoiceEnd`
 * + `noteEmptyVocalSession`) comptait TOUTE fin vide, donc aussi le silence
 * ordinaire — que le moteur de reconnaissance termine lui-meme toutes les
 * quelques secondes. Trois silences dans la fenetre de 30 s suspendaient alors
 * l'ecoute pour de bon, en affichant « La dictee n'a pas fonctionne » alors que
 * le son etait parfaitement capte.
 *
 * La distinction est MESUREE, pas supposee : une session qui a tenu le micro au
 * moins une seconde a REELLEMENT ecoute (les fins de silence des moteurs
 * arrivent apres plusieurs secondes) ; une session qui rend la main en moins
 * d'une seconde n'a pas pu ecouter — c'est un retour instantane, la boucle que
 * le plafond doit arreter. Aucun reglage : c'est une mesure interne.
 */
export const VOICE_EMPTY_SESSION_INSTANT_MS = 1000;

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
 * @param {boolean} [input.userEdited] l'utilisateur a modifié la zone PENDANT la dictée.
 * @param {() => void} [input.closeSession] referme la session de dictée.
 * @param {(value: string) => void} [input.write] écrit la valeur dans la zone.
 * @param {() => void} [input.send] chemin d'envoi EXISTANT (Entrée / ▶️).
 * @returns {{autoSend: boolean, reason: string, dictatedText: string, sent: boolean}}
 */
export function applyVoiceEnd(input) {
  const { sessionActive, preText, dictatedText, userEdited, closeSession, write, send } =
    input || {};
  const decision = decideVoiceAutoSend({ sessionActive, dictatedText, userEdited });
  if (sessionActive !== true) {
    return { ...decision, sent: false };
  }
  if (typeof closeSession === "function") closeSession();
  // Reprise en main : la zone garde EXACTEMENT ce que l'utilisateur y a écrit. Le
  // texte dicté ne la réécrit pas, et rien ne part sans une validation de
  // l'utilisateur lui-même.
  if (decision.reason === VOICE_END_USER_TAKEOVER) {
    return { ...decision, sent: false };
  }
  if (typeof write === "function") write(composeVoiceInputValue(preText, dictatedText));
  if (decision.autoSend && typeof send === "function") {
    send();
    return { ...decision, sent: true };
  }
  return { ...decision, sent: false };
}

/**
 * Une fin d'écoute ALIMENTE-T-ELLE le plafond des sessions vides de l'écran
 * Vocal ?
 *
 * PURE, aucune horloge, aucun état : l'appelant pose le chiffre. Elle vit ICI,
 * à côté de `normalizedVoiceText` : le vide d'une dictée se constate à UN SEUL
 * endroit, et aucune seconde détection de « pas de texte » n'existe ailleurs.
 *
 * Le défaut que cette fonction corrige : le plafond ne comptait que la fin
 * NORMALE et vide (`VOICE_END_EMPTY`). Un moteur de reconnaissance qui rend la
 * main **sans rien dire** (`no-speech`, `aborted` sans geste) referme la session
 * avant `onend` : la fin arrivait en `VOICE_END_NO_SESSION` et n'était jamais
 * comptée. Le micro pouvait donc se rouvrir sans limite, sans qu'aucune erreur
 * ne s'affiche — le profil exact du défaut d'origine (un écran muet).
 *
 * Comptent donc : la fin normale et vide, ET la fin silencieuse du moteur (rien
 * transcrit, aucune erreur affichée, aucun arrêt demandé) — mais **seulement
 * quand elle est INSTANTANÉE** (`dureeMs` < `VOICE_EMPTY_SESSION_INSTANT_MS`).
 * Ne comptent pas non plus : une erreur affichée (elle a déjà sa phrase), un
 * arrêt demandé (bouton 🎙️, envoi, sortie du mode), une reprise en main de
 * l'utilisateur, et surtout **une fin de SILENCE d'une durée réelle** : c'est
 * une pause, pas une panne — elle se réarme toute seule (règle du propriétaire).
 *
 * @param {{reason?: string, dictatedText?: string}} [fin] résultat d'`applyVoiceEnd`
 * @param {{erreurAffichee?: boolean, arretDemande?: boolean, dureeMs?: number}} [contexte]
 *   `dureeMs` : durée MESURÉE de la session qui vient de finir. Fournie et
 *   supérieure au seuil ⇒ vraie écoute, la fin est normale (jamais comptée).
 *   Absente ⇒ comportement historique (une fin vide instantanée compte).
 * @returns {boolean} vrai si la fin alimente le plafond
 */
export function isSilentEmptyVoiceEnd(fin, contexte = {}) {
  if (!fin) return false;
  const c = contexte || {};
  // Rien n'a été transcrit — constat fait une seule fois, ici.
  if (normalizedVoiceText(fin.dictatedText) !== "") return false;
  // L'utilisateur a repris la main : sa saisie prime, ce n'est pas une boucle.
  if (fin.reason === VOICE_END_USER_TAKEOVER) return false;
  // Une erreur AFFICHÉE a déjà sa phrase : ce n'est pas une fin silencieuse.
  if (c.erreurAffichee === true) return false;
  // Un arrêt DEMANDÉ (🎙️, envoi, sortie du mode) n'est jamais une boucle.
  if (c.arretDemande === true) return false;
  // Une VRAIE écoute qui se termine en silence n'est pas une boucle : c'est le
  // silence ordinaire d'une conversation, et l'écran doit se réarmer (le défaut
  // corrigé : il restait mort et annonçait un échec).
  const duree = Number(c.dureeMs);
  if (Number.isFinite(duree) && duree >= VOICE_EMPTY_SESSION_INSTANT_MS) return false;
  // Fin normale et vide, ou fin du moteur sans rien dire : les DEUX comptent.
  return fin.reason === VOICE_END_EMPTY || fin.reason === VOICE_END_NO_SESSION;
}

/**
 * Décide la fin d'une session de dictée.
 *
 * @param {object} input
 * @param {boolean} input.sessionActive `true` seulement si la session de dictée
 *   était encore ouverte AVANT ce traitement (fin normale). Un évènement de fin
 *   arrivé après une erreur, un arrêt manuel ou une première fin ⇒ `false`.
 * @param {string} input.dictatedText texte réellement dicté (résultats finaux).
 * @param {boolean} [input.userEdited] `true` seulement si l'UTILISATEUR a modifié
 *   la zone de saisie pendant l'écoute : sa saisie prime, rien ne part.
 * @returns {{autoSend: boolean, reason: string, dictatedText: string}}
 */
export function decideVoiceAutoSend(input) {
  const { sessionActive, dictatedText, userEdited } = input || {};
  const text = normalizedVoiceText(dictatedText);
  if (sessionActive !== true) {
    return { autoSend: false, reason: VOICE_END_NO_SESSION, dictatedText: text };
  }
  if (userEdited === true) {
    return { autoSend: false, reason: VOICE_END_USER_TAKEOVER, dictatedText: text };
  }
  if (!text) {
    return { autoSend: false, reason: VOICE_END_EMPTY, dictatedText: text };
  }
  return { autoSend: true, reason: VOICE_END_SEND, dictatedText: text };
}
