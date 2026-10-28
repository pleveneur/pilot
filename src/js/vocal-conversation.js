// vocal-conversation.js — SOURCE UNIQUE de la CONVERSATION PARLÉE de l'écran
// Vocal : QUAND la dictée s'arme toute seule, quand elle se désarme, et ce que
// la ligne d'état dit quand elle ne peut pas s'armer.
//
// Le défaut que ce module corrige : dans l'écran Vocal, le micro ne servait
// qu'à MESURER le niveau (la longueur du trait, la détection de prise de
// parole) ; parler n'écrivait rien et n'envoyait rien. La dictée existait, mais
// seulement derrière un clic sur 🎙️ — et ses erreurs s'affichaient dans la
// conversation, qui n'est PAS affichée dans cet écran. Résultat : on parlait
// dans le vide, sans le savoir.
//
// Ce que ce module ne fait PAS (et ne fera jamais) :
//   - aucun second moteur de transcription : la dictée reste celle du
//     navigateur, dans la barre de saisie (`startVoiceInput` de super-agent.js) ;
//   - aucun second envoi : la fin de dictée passe par `applyVoiceEnd`
//     (voice-auto-send.js) puis par le chemin d'envoi EXISTANT (`send`) ;
//   - aucun réglage, aucun bouton, aucun nouvel affichage : une seule ligne
//     d'état existante (`vocalStatusText` / `vocalMicFerme`), rien de plus ;
//   - aucune API audio, aucun DOM : ce module est PUR et ne décide que des
//     états qu'on lui donne (il est importé par super-agent.js, jamais l'inverse).
//
// Vocabulaire des entrées (`etats`) :
//   modeOuvert        l'écran Vocal est affiché
//   projetSensible    projet marqué « sensible » (dictée cloud interdite)
//   pilotParle        Pilot LIT sa réponse (lecture à voix haute en cours)
//   reflechit         Pilot travaille (l'agent réfléchit)
//   occupe            le moteur est occupé (backendBusy / isStreaming)
//   dicteeOuverte     une session de dictée est déjà ouverte
//   arretManuel       l'utilisateur a ARRÊTÉ la dictée lui-même (le geste prime)
//   erreur            message de la dernière erreur de dictée ("" = aucune)
//   transcription     la dictée est disponible sur ce poste (false = non)
//   apresLecture      la lecture vient de FINIR (on réarme avec un peu de marge)
//
// Vocabulaire de la décision (`decideVocalDictation`) :
//   action = VOCAL_DICTATION_ARM     la dictée doit être ouverte
//   action = VOCAL_DICTATION_DISARM  elle doit être fermée (si elle est ouverte)
//   action = VOCAL_DICTATION_HOLD    ne rien faire : elle est déjà ouverte
//
// L'ORDRE DES RÈGLES EST LA SPÉCIFICATION (il est testé tel quel) :
//   1. projet sensible   → jamais de dictée (règle du local-first, inchangée)
//   2. hors du mode      → aucune dictée n'est armée par cet écran
//   3. Pilot parle       → désarmée : on ne se transcrit pas soi-même
//   4. Pilot travaille   → désarmée : le tour en cours prime
//   5. déjà ouverte      → on ne l'ouvre pas deux fois (idempotence)
//   5b. arrêt manuel     → on ne la rouvre pas : un geste explicite prime sur
//                          l'automatisme (le geste 🎙️ la rouvre pour de bon)
//   6. erreur en cours   → désarmée : on ne relaie pas un échec en boucle
//   7. sans transcription→ désarmée, et la ligne d'état le dit (jamais muet)
//   8. au repos          → ARMÉE, après un court délai (voir ci-dessous)

/** Délai avant d'armer au repos : on laisse l'écran se poser (fondu de 0,3 s). */
export const VOCAL_ARM_DELAY_MS = 350;

/**
 * Délai avant de réarmer après la LECTURE d'une réponse : plus long que le
 * délai au repos, parce que la voix de Pilot sort encore des haut-parleurs
 * quand le dernier mot est prononcé. Ce n'est pas une garde anti-écho (elle
 * vit dans vocal-mic.js et n'est pas touchée) : c'est une marge de silence.
 */
export const VOCAL_ARM_AFTER_READ_MS = 600;

export const VOCAL_DICTATION_ARM = "armer";
export const VOCAL_DICTATION_DISARM = "desarmer";
export const VOCAL_DICTATION_HOLD = "rien";

// ── Messages de la ligne d'état (une phrase, jamais deux) ──────────────────
// Ils remplacent les messages de la conversation, qui n'est pas affichée dans
// cet écran : sans eux, un échec de dictée serait INVISIBLE.

/** La dictée n'existe pas sur ce poste (ni desktop, ni navigateur compatible). */
export const VOCAL_MESSAGE_SANS_DICTEE =
  "La dictée n'est pas disponible sur ce poste : écrivez votre demande.";
/** Micro refusé / service de reconnaissance interdit. */
export const VOCAL_MESSAGE_MIC_REFUSE =
  "Micro refusé : autorisez le micro pour dicter, ou écrivez votre demande.";
/** Micro pris par une autre application. */
export const VOCAL_MESSAGE_MIC_OCCUPE =
  "Le micro est occupé par une autre application : écrivez votre demande.";
/** La reconnaissance a besoin du réseau. */
export const VOCAL_MESSAGE_RESEAU = "La dictée a besoin du réseau : écrivez votre demande.";
/** Projet marqué sensible : la dictée cloud est bloquée. */
export const VOCAL_MESSAGE_SENSIBLE = "Projet sensible : la dictée est bloquée, écrivez votre demande.";
/** Tout le reste : la dictée a échoué. */
export const VOCAL_MESSAGE_DICTEE_ECHEC = "La dictée n'a pas fonctionné : écrivez votre demande.";

/**
 * Traduit un code d'erreur de dictée (celui de la reconnaissance du navigateur — `not-allowed`,
 * `audio-capture`, `network`… — ou un code interne : `non-supporte`,
 * `demarrage`, `projet-sensible`) en UNE phrase affichable dans la ligne d'état.
 *
 * Rend `""` quand il n'y a rien à dire : `aborted` (arrêt demandé, y compris
 * l'arrêt manuel du bouton 🎙️) et `no-speech` (silence) ne sont pas des pannes
 * et ne doivent pas écrire un message d'erreur à la place de « Je vous écoute. ».
 *
 * @param {string} code code d'erreur
 * @returns {string} phrase affichable, ou "" si le code ne mérite aucun message
 */
export function vocalDictationMessage(code) {
  switch (String(code == null ? "" : code)) {
    case "":
    case "aborted":
    case "no-speech":
      return "";
    case "non-supporte":
      return VOCAL_MESSAGE_SANS_DICTEE;
    case "not-allowed":
    case "service-not-allowed":
      return VOCAL_MESSAGE_MIC_REFUSE;
    case "audio-capture":
      return VOCAL_MESSAGE_MIC_OCCUPE;
    case "network":
      return VOCAL_MESSAGE_RESEAU;
    case "projet-sensible":
      return VOCAL_MESSAGE_SENSIBLE;
    default:
      return VOCAL_MESSAGE_DICTEE_ECHEC;
  }
}

/**
 * Décide, pour un état donné de l'écran, ce qu'il faut faire de la dictée.
 * PURE : ne touche à rien, ne connaît ni le DOM ni le micro.
 *
 * @param {object} [etats] voir le vocabulaire en tête de fichier
 * @returns {{action: string, raison: string, delai: number}}
 *   `delai` n'a de sens que pour `VOCAL_DICTATION_ARM` (millisecondes).
 */
export function decideVocalDictation(etats = {}) {
  const e = etats || {};
  // 1. Projet sensible : rien ne s'ouvre (dictée cloud interdite).
  if (e.projetSensible === true) {
    return { action: VOCAL_DICTATION_DISARM, raison: "projet-sensible", delai: 0 };
  }
  // 2. Hors du mode Vocal : cet écran n'arme rien.
  if (e.modeOuvert !== true) {
    return { action: VOCAL_DICTATION_DISARM, raison: "hors-mode", delai: 0 };
  }
  // 3. Pilot lit : le micro l'entendrait et se transcrirait lui-même.
  if (e.pilotParle === true) {
    return { action: VOCAL_DICTATION_DISARM, raison: "pilot-parle", delai: 0 };
  }
  // 4. Pilot travaille : le tour en cours prime sur l'écoute.
  if (e.reflechit === true || e.occupe === true) {
    return { action: VOCAL_DICTATION_DISARM, raison: "tour-en-cours", delai: 0 };
  }
  // 5. Déjà ouverte : on ne l'ouvre pas une seconde fois.
  if (e.dicteeOuverte === true) {
    return { action: VOCAL_DICTATION_HOLD, raison: "deja-ouverte", delai: 0 };
  }
  // 5b. Arrêt MANUEL : un geste explicite ne se défait pas 350 ms plus tard.
  if (e.arretManuel === true) {
    return { action: VOCAL_DICTATION_HOLD, raison: "arret-manuel", delai: 0 };
  }
  // 6. Une erreur est en cours : aucune relance automatique (le geste 🎙️ la lève).
  if (typeof e.erreur === "string" && e.erreur !== "") {
    return { action: VOCAL_DICTATION_DISARM, raison: "erreur", delai: 0 };
  }
  // 7. Pas de dictée sur ce poste : la ligne d'état le dit, le clavier reste.
  if (e.transcription === false) {
    return { action: VOCAL_DICTATION_DISARM, raison: "sans-transcription", delai: 0 };
  }
  // 8. Repos : on arme, avec la marge qui convient au moment.
  const apresLecture = e.apresLecture === true;
  return {
    action: VOCAL_DICTATION_ARM,
    raison: apresLecture ? "apres-lecture" : "au-repos",
    delai: apresLecture ? VOCAL_ARM_AFTER_READ_MS : VOCAL_ARM_DELAY_MS,
  };
}

/**
 * Traduit une décision en EFFETS à appliquer, sans rien appliquer : c'est ce qui
 * rend l'idempotence vérifiable (« armer une seule fois »).
 *
 * `memoire` décrit ce qui existe déjà :
 *   dicteeOuverte  une session de dictée tourne
 *   minuteur       un armement est DÉJÀ programmé
 *
 * @param {object} [etats] voir `decideVocalDictation`
 * @param {{dicteeOuverte?: boolean, minuteur?: boolean}} [memoire]
 * @returns {{raison: string, desarmer: boolean, couper: boolean, delai: number}}
 *   desarmer : fermer la dictée ouverte ; couper : annuler l'armement programmé ;
 *   delai    : programmer un armement dans ce délai (0 = ne rien programmer).
 */
export function planVocalConversation(etats = {}, memoire = {}) {
  const decision = decideVocalDictation(etats);
  const ouverte = memoire.dicteeOuverte === true;
  const attente = memoire.minuteur === true;
  if (decision.action === VOCAL_DICTATION_DISARM) {
    return { raison: decision.raison, desarmer: ouverte, couper: attente, delai: 0 };
  }
  if (decision.action === VOCAL_DICTATION_HOLD) {
    // Rien à ouvrir, rien à fermer — et un armement déjà programmé est annulé
    // (le cas se produit quand la dictée a été ouverte par un geste).
    return { raison: decision.raison, desarmer: false, couper: attente, delai: 0 };
  }
  // Un armement déjà programmé n'est jamais reprogrammé (pas de report sans fin).
  if (attente) {
    return { raison: "deja-programme", desarmer: false, couper: false, delai: 0 };
  }
  return { raison: decision.raison, desarmer: false, couper: false, delai: decision.delai };
}
