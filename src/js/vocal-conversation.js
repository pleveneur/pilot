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
//   sessionsVides     TROP de fins d'écoute sans texte (plafond atteint : la
//                     dictée ne s'arme plus jusqu'au prochain geste)
//   erreur            message de la dernière erreur de dictée ("" = aucune)
//   transcription     la dictée est disponible sur ce poste (false = non)
//   apresLecture      la lecture vient de FINIR (on réarme avec un peu de marge)
//   sensibiliteConnue la réponse « ce projet est-il sensible ? » est ARRIVÉE
//                     (tant qu'elle n'est pas là, rien ne s'ouvre : on attend)
//   sensibiliteIndisponible l'attente de cette réponse a été BORNÉE et rien n'est
//                     arrivé à temps : le projet reste NON VÉRIFIÉ (jamais
//                     « libre » par défaut). Aucun armement automatique, mais
//                     l'écran le dit et le geste 🎙️ fonctionne.
//   mesureOuverte     la MESURE du niveau (longueur du trait, prise de parole)
//                     est RÉELLEMENT ouverte — la dictée vient APRÈS elle
//
// Vocabulaire de la décision (`decideVocalDictation`) :
//   action = VOCAL_DICTATION_ARM     la dictée doit être ouverte
//   action = VOCAL_DICTATION_DISARM  elle doit être fermée (si elle est ouverte)
//   action = VOCAL_DICTATION_HOLD    ne rien faire : elle est déjà ouverte
//
// Vocabulaire de la décision du SILENCE (`decideVocalSilenceSend`) :
//   action = VOCAL_SILENCE_WAIT    un mot vient d'arriver : attendre encore
//                                  VOCAL_SILENCE_SEND_MS (2 s)
//   action = VOCAL_SILENCE_CANCEL  annuler le minuteur (rien ne partira)
//   action = VOCAL_SILENCE_CLOSE   échéance atteinte sans nouveau mot : refermer
//                                  la dictée — l'envoi reste celui d'aujourd'hui
//
// L'ORDRE DES RÈGLES EST LA SPÉCIFICATION (il est testé tel quel) :
//   1. projet sensible   → jamais de dictée (règle du local-first, inchangée)
//   2. hors du mode      → aucune dictée n'est armée par cet écran
//   3. Pilot parle       → désarmée : on ne se transcrit pas soi-même
//   4. Pilot travaille   → désarmée : le tour en cours prime
//   5. déjà ouverte      → on ne l'ouvre pas deux fois (idempotence)
//   5b. arrêt manuel     → on ne la rouvre pas : un geste explicite prime sur
//                          l'automatisme (le geste 🎙️ la rouvre pour de bon)
//   5c. sessions vides   → on ne la rouvre plus toute seule : le moteur a rendu
//                          la main sans rien transcrire trop de fois de suite
//                          (le geste 🎙️ ou une nouvelle entrée rétablit)
//   6. erreur en cours   → désarmée : on ne relaie pas un échec en boucle
//   7. sans transcription→ désarmée, et la ligne d'état le dit (jamais muet)
//   7b. statut du projet NON VÉRIFIÉ (l'attente bornée de la réponse a expiré)
//                          → désarmée aussi : jamais de pari sur « projet
//                          libre ». Mais la ligne d'état le DIT et le geste 🎙️
//                          fonctionne : l'utilisateur décide, une fois averti.
//   7c. sensibilité pas encore connue → désarmée : on ATTEND la réponse au lieu
//                          de parier sur « projet libre ». La dictée cloud ne
//                          s'ouvre jamais sur un projet dont on ignore l'état.
//   7d. mesure du niveau pas ouverte → désarmée : la MESURE ouvre en premier,
//                          la dictée vient après elle. Une panne de mesure se
//                          voit donc comme une panne de mesure (phrase du micro,
//                          bouton « Autoriser le micro »), jamais comme une
//                          dictée qui marche avec un trait figé.
//   8. au repos          → ARMÉE, après un court délai (voir ci-dessous)
//
// Les règles 5 à 7 passent AVANT 7b/7d : une dictée ouverte par un GESTE
// explicite n'est pas refermée par une mesure fermée ou une réponse en
// retard — seule une sécurité (projet sensible) ou un état de conversation
// (parole, travail, erreur) la referme.

/** Délai avant d'armer au repos : on laisse l'écran se poser (fondu de 0,3 s). */
export const VOCAL_ARM_DELAY_MS = 350;

/**
 * Délai avant de réarmer après la LECTURE d'une réponse : plus long que le
 * délai au repos, parce que la voix de Pilot sort encore des haut-parleurs
 * quand le dernier mot est prononcé. Ce n'est pas une garde anti-écho (elle
 * vit dans vocal-mic.js et n'est pas touchée) : c'est une marge de silence.
 */
export const VOCAL_ARM_AFTER_READ_MS = 600;

/**
 * PLAFOND DES SESSIONS VIDES — nombre de fins d'écoute SANS TEXTE qui suspendent
 * l'armement automatique de la dictée.
 *
 * Le cycle que ce plafond arrête : le moteur de reconnaissance rend la main sans
 * rien transcrire (`no-speech`), la fin d'écoute réapplique l'état, la dictée se
 * réarme 350 ms plus tard, et cela sans fin — le micro est rouvert en boucle et
 * rien ne se passe à l'écran. Trois sessions vides dans une fenêtre courte ne
 * sont plus un hasard : on cesse d'armer.
 */
export const VOCAL_EMPTY_SESSION_LIMIT = 3;

/**
 * Fenêtre de temps du plafond (ms) : au-delà, une fin d'écoute vide ancienne ne
 * compte plus (un silence de plusieurs minutes n'est pas une boucle).
 */
export const VOCAL_EMPTY_SESSION_WINDOW_MS = 30000;

export const VOCAL_DICTATION_ARM = "armer";
export const VOCAL_DICTATION_DISARM = "desarmer";
export const VOCAL_DICTATION_HOLD = "rien";

/**
 * DÉLAI DE SILENCE APRÈS LE DERNIER MOT (ms) — décision du propriétaire :
 * **deux secondes après le dernier mot récupéré, s'il n'y a pas de nouveau mot,
 * la demande part.**
 *
 * Le défaut que cette valeur corrige : l'envoi n'avait lieu qu'à la FIN que
 * déclare le moteur de reconnaissance du navigateur, et cette fin peut arriver
 * plusieurs secondes après le dernier mot (le moteur attend son propre silence,
 * parfois très long). L'écran ne décidait donc jamais lui-même que la phrase
 * était terminée : on parlait, le texte s'écrivait, puis on attendait.
 *
 * Cette valeur n'est PAS un réglage : elle ne se règle ni ne s'affiche, et il
 * n'existe aucun autre délai de ce genre dans l'écran.
 */
export const VOCAL_SILENCE_SEND_MS = 2000;

/** Attendre encore : le minuteur est (re)programmé à `VOCAL_SILENCE_SEND_MS`. */
export const VOCAL_SILENCE_WAIT = "attendre";
/** Ne rien fermer, et annuler le minuteur en vol s'il y en a un. */
export const VOCAL_SILENCE_CANCEL = "annuler";
/** Échéance atteinte sans nouveau mot : refermer la dictée (l'envoi suit). */
export const VOCAL_SILENCE_CLOSE = "fermer";

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
 * Statut du projet NON VÉRIFIÉ : la réponse « ce projet est-il sensible ? »
 * n'est pas arrivée à temps. On ne parie JAMAIS sur « projet libre » (envoyer
 * l'audio d'un projet confidentiel au service de transcription serait pire que
 * le silence) : aucun armement automatique. Mais l'écran le DIT, et le geste du
 * bouton 🎙️ fonctionne — c'est l'utilisateur qui décide, une fois averti.
 */
export const VOCAL_MESSAGE_SENSIBILITE_INCONNUE =
  "État du projet non vérifié : appuyez sur le micro pour dicter, ou écrivez votre demande.";

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
    // Meme phrase pour la RAISON que pour le code du moteur : le poste n'a pas
    // de reconnaissance vocale (`sans-transcription`, lu par la ligne d'etat),
    // ou le navigateur l'a refusee (`non-supporte`, lu sur l'erreur). Une panne,
    // une phrase — jamais deux textes pour la meme chose.
    case "sans-transcription":
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
  // 5c. PLAFOND DES SESSIONS VIDES : le moteur a rendu la main sans rien
  // transcrire trop de fois de suite. On ne rouvre plus le micro tout seul ;
  // un geste de l'utilisateur (🎙️) ou une nouvelle entrée dans le mode rétablit.
  if (e.sessionsVides === true) {
    return { action: VOCAL_DICTATION_HOLD, raison: "sessions-vides", delai: 0 };
  }
  // 6. Une erreur est en cours : aucune relance automatique (le geste 🎙️ la lève).
  if (typeof e.erreur === "string" && e.erreur !== "") {
    return { action: VOCAL_DICTATION_DISARM, raison: "erreur", delai: 0 };
  }
  // 7. Pas de dictée sur ce poste : la ligne d'état le dit, le clavier reste.
  if (e.transcription === false) {
    return { action: VOCAL_DICTATION_DISARM, raison: "sans-transcription", delai: 0 };
  }
  // 7b. STATUT DU PROJET NON VÉRIFIÉ (l'attente a été BORNÉE et le moteur n'a
  // rien répondu dans le délai) : jamais d'armement automatique — on ne devine
  // pas « projet libre » — mais la ligne d'état le dit et le geste 🎙️ décide.
  // Placée AVANT 7c et APRÈS la règle 5 (« déjà ouverte ») : une dictée ouverte
  // par un GESTE n'est jamais refermée par cette raison.
  if (e.sensibiliteIndisponible === true) {
    return { action: VOCAL_DICTATION_DISARM, raison: "sensibilite-indisponible", delai: 0 };
  }
  // 7c. SENSIBILITÉ PAS ENCORE CONNUE : on attend la réponse (quelques
  // millisecondes) au lieu d'ouvrir une dictée CLOUD sur un projet dont on
  // ignore s'il est 🔒. La réponse arrivée, l'état est réappliqué et l'armement
  // se fait normalement : rien n'est perdu, rien n'est demandé deux fois.
  if (e.sensibiliteConnue !== true) {
    return { action: VOCAL_DICTATION_DISARM, raison: "sensibilite-inconnue", delai: 0 };
  }
  // 7d. MESURE DU NIVEAU PAS OUVERTE : elle ouvre en PREMIER (décision du
  // propriétaire), la dictée vient APRÈS elle. Tant qu'elle n'est pas ouverte,
  // aucune dictée ne s'arme : l'écran ne peut pas promettre l'écoute quand il
  // ne mesure rien, et une panne de mesure ne peut pas se déguiser en dictée
  // qui fonctionne.
  if (e.mesureOuverte !== true) {
    return { action: VOCAL_DICTATION_DISARM, raison: "mesure-fermee", delai: 0 };
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
 * Enregistre une fin d'écoute VIDE et dit si le plafond est atteint.
 *
 * PURE : aucun état interne, aucune horloge lue ici (l'instant est un
 * paramètre), aucun effet. L'appelant garde la liste rendue et la repose au
 * prochain appel.
 *
 * Une fin d'écoute est VIDE quand le moteur de reconnaissance a rendu la main
 * sans rien transcrire (`VOICE_END_EMPTY` de voice-auto-send.js) : une erreur,
 * un arrêt manuel ou une reprise en main de l'utilisateur ne comptent pas.
 *
 * @param {number[]} [sessions] instants (ms) des fins d'écoute vides déjà vues
 * @param {number} [maintenant] instant courant (ms)
 * @returns {{sessions: number[], suspendu: boolean}} historique borné à la
 *   fenêtre (`VOCAL_EMPTY_SESSION_WINDOW_MS`), et décision du plafond
 */
export function noteEmptyVocalSession(sessions = [], maintenant = 0) {
  const now = Number.isFinite(maintenant) ? maintenant : 0;
  const fenetre = VOCAL_EMPTY_SESSION_WINDOW_MS;
  const gardees = (Array.isArray(sessions) ? sessions : []).filter(
    (t) => Number.isFinite(t) && t <= now && now - t < fenetre,
  );
  gardees.push(now);
  return { sessions: gardees, suspendu: gardees.length >= VOCAL_EMPTY_SESSION_LIMIT };
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

/**
 * Décide ce que le SILENCE APRÈS LE DERNIER MOT doit faire.
 *
 * PURE : ne touche à rien, ne connaît ni le DOM, ni le micro, ni le minuteur.
 * Appelée à DEUX moments, avec le MÊME état :
 *   - `"mot"`      un texte vient d'être récupéré (provisoire **ou** définitif) :
 *                  il REPOUSSE l'échéance — c'est ainsi qu'on ne coupe jamais
 *                  quelqu'un qui parle encore ;
 *   - `"echeance"` le délai est écoulé sans nouveau mot : on peut refermer.
 *
 * L'ORDRE DES RÈGLES EST LA SPÉCIFICATION (il est testé tel quel) :
 *   1. hors du mode          → rien ne part (cet écran n'envoie aucune demande)
 *   2. Pilot parle           → rien : il ne s'envoie pas une demande par-dessus
 *   3. Pilot travaille       → rien : le tour en cours prime
 *   4. dictée refermée       → rien (fin du moteur, erreur, arrêt : déjà traité)
 *   5. reprise en main       → rien : l'utilisateur a tapé, sa saisie prime
 *   6. aucun mot récupéré    → rien à envoyer (et rien n'a été écrit)
 *   7. échéance + des mots   → FERMER la dictée ; l'envoi reste celui
 *                              d'aujourd'hui (fin d'écoute → envoi automatique)
 *   8. mot reçu              → attendre `VOCAL_SILENCE_SEND_MS` de plus
 *
 * @param {object} [etats] `modeOuvert`, `pilotParle`, `reflechit`, `occupe`,
 *   `dicteeOuverte`, `repriseMain`, `motEntendu`
 * @param {"mot"|"echeance"} [moment] d'où vient la question
 * @returns {{action: string, raison: string, delai: number}}
 */
export function decideVocalSilenceSend(etats = {}, moment = "mot") {
  const e = etats || {};
  const annuler = (raison) => ({ action: VOCAL_SILENCE_CANCEL, raison, delai: 0 });
  // 1. Hors du mode Vocal : cet écran n'envoie rien tout seul.
  if (e.modeOuvert !== true) return annuler("hors-mode");
  // 2. Pilot lit sa réponse : on ne s'envoie pas une demande par-dessus lui.
  if (e.pilotParle === true) return annuler("pilot-parle");
  // 3. Pilot travaille : le tour en cours prime sur l'écoute.
  if (e.reflechit === true || e.occupe === true) return annuler("tour-en-cours");
  // 4. La dictée est déjà refermée : il n'y a plus rien à fermer ni à envoyer.
  if (e.dicteeOuverte !== true) return annuler("dictee-fermee");
  // 5. Reprise en main : sa saisie prime, rien ne part sans sa validation.
  if (e.repriseMain === true) return annuler("reprise-main");
  // 6. Aucun mot récupéré : une dictée muette n'envoie rien.
  if (e.motEntendu !== true) return annuler("sans-mot");
  // 7. Échéance atteinte sans nouveau mot : la phrase est terminée, on referme.
  if (moment === "echeance") {
    return { action: VOCAL_SILENCE_CLOSE, raison: "silence", delai: 0 };
  }
  // 8. Un mot vient d'arriver : il repousse l'échéance (aucune coupure en pleine
  // phrase). Le minuteur en vol est remplacé — il n'y en a jamais deux.
  return { action: VOCAL_SILENCE_WAIT, raison: "mot-entendu", delai: VOCAL_SILENCE_SEND_MS };
}
