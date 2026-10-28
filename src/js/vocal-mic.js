// vocal-mic.js — LOT 3 : le NIVEAU DU MICRO du mode Vocal
// (RAPPORT-trois-modes-ecran-vocal.md, § "Lot 3").
//
// SOURCE UNIQUE de la capture du micro de l'ecran Vocal : la demande de
// permission, la chaine d'analyse (flux -> analyseur), le lissage du niveau et
// l'ARRET REEL du flux. Aucun autre fichier du projet n'ouvre le micro pour cet
// ecran : `super-agent.js` ne fait que BRANCHER les trois retours ci-dessous (il
// ne contient pas une seule des API micro, ce que verrouille
// `ecran-vocal-lot2.test.js`).
//
// Ce que ce module NE fait PAS :
//   - aucune reconnaissance de parole (la dictee garde son propre moteur, dans
//     la barre de saisie) ;
//   - il n'ARRETE rien lui-meme : depuis le lot 4a il SIGNALE seulement qu'une
//     voix vient de commencer par-dessus la lecture (`onSpeechStart`) ; l'arret
//     de la lecture reste a l'appelant, par la voie qui existe deja ;
//   - aucun ecran de reglage et aucune memoire : la demande part a l'ENTREE du
//     mode (la MESURE ouvre en premier, decision du proprietaire), et le geste
//     de l'utilisateur n'est plus qu'un declencheur de REPRISE apres un echec.
//     Un seul chemin de demande, ici : `demander()`.
//
// ── LOT 4a : QUE PILOT NE SE COUPE PAS LUI-MEME ──────────────────────────────
// Le micro entend la voix de Pilot sortir des haut-parleurs. Une detection
// naive le ferait donc se taire aussitot, en boucle. Trois gardes, dans cet
// ordre :
//   1. l'ANNULATION D'ECHO est DEMANDEE au navigateur (contraintes ci-dessous)
//      puis RELUE sur la piste reellement obtenue (`getSettings`) : le
//      navigateur dit ce qu'il a applique, pas ce qu'on a souhaite ;
//   2. le RESIDU D'ECHO est MESURE au debut de chaque lecture, sur l'ATTAQUE
//      du son (les `BARGE_IN_MIN_MS` premieres millisecondes de la fenetre) et
//      le seuil de detection est pose AU-DESSUS de ce residu mesure ;
//   3. si l'annulation d'echo n'est pas averee, ou si le residu depasse
//      `BARGE_IN_RESIDUAL_MAX`, les seuils habituels ne sont PAS armes (Pilot
//      s'entendrait lui-meme). Un silence vaut mieux qu'une coupure qui se
//      declenche toute seule — mais un silence TOTAL ne vaut rien : c'est la
//      GARANTIE DE SECOURS ci-dessous qui prend le relais.
// La preuve d'annulation d'echo (point 1) est RELUE a chaque debut de lecture
// sur la piste deja ouverte : figee a l'ouverture du micro, elle interdisait la
// coupure pour toute la session des qu'elle valait `false`.
// Les chiffres REELLEMENT mesures sont rendus par `bargeInReport()`.
//
// ── GARANTIE DE SECOURS : LA VOIX FRANCHE FINIT TOUJOURS PAR COUPER ──────────
// Le cas « impossible a couper » est ferme sans toucher a un seul seuil : quand
// la garde n'est pas armee, une voix est jugee sur le RESIDU MESURE sur
// L'ATTAQUE du son et GELE pour cette lecture (le son que Pilot s'envoie a
// lui-meme), et doit le depasser
// de `BARGE_IN_FALLBACK_FACTOR` fois en le tenant `BARGE_IN_FALLBACK_MS`. Le son de Pilot ne franchit jamais
// son propre double ; une voix superposee, si. Le secours est plus prudent que
// la voie normale (marge plus large, voix tenue cinq fois plus longtemps). Une
// seule coupure par lecture, et la decision reste entierement ici.
//
// ── LOT 4b : PRENDRE LA PAROLE PENDANT QUE PILOT REFLECHIT ───────────────────
// Meme garde, meme signal (`onSpeechStart`), meme decision d'arreter cote
// appelant : la phase a change, pas le mecanisme. Pendant la reflexion Pilot
// ne produit AUCUN son — il n'y a donc rien a calibrer et rien a distinguer de
// sa propre voix : la garde reprend les DEUX regles qui protegent deja la
// lecture (plancher de bruit `BARGE_IN_MIN_LEVEL`, voix CONTINUE
// `BARGE_IN_MIN_MS`) et se rearne des que la voix retombe (une coupure par
// prise de parole). Aucun seuil nouveau, aucun reglage nouveau.
//
// Toutes les dependances du navigateur sont INJECTABLES (`navigator`,
// `AudioContext`, `requestAnimationFrame`) : le moteur se teste donc sans
// fenetre, et une panne de l'un d'eux ne peut jamais lever d'exception vers
// l'ecran (toute erreur devient un message clair via `onFailure`).

// Messages affiches dans l'UNIQUE ligne d'etat (§2.3). Ils disent ce qui se
// passe ET quoi faire ; ils ne bloquent jamais le mode (la saisie reste
// utilisable).
export const MIC_FERME = "Le micro est fermé.";
export const MIC_ABSENT = "Aucun micro n'est branché.";
export const MIC_OCCUPE = "Le micro est occupé par une autre application.";
export const MIC_MUET = "Le micro n'a pas répondu.";

/**
 * Message clair pour une panne de micro. PURE.
 * @param {string} nom nom d'erreur du navigateur (`err.name`), ou ""
 * @returns {string}
 */
export function micFailureMessage(nom) {
  switch (String(nom || "")) {
    case "NotAllowedError":
    case "SecurityError":
    case "PermissionDeniedError":
      return MIC_FERME;
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return MIC_ABSENT;
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return MIC_OCCUPE;
    case "SILENCE":
      return MIC_MUET;
    case "":
      return MIC_FERME;
    default:
      return "Le micro est indisponible.";
  }
}

/**
 * Lissage du niveau : MONTEE rapide, DESCENTE lente. C'est ce qui evite le
 * sautillement d'un trait colle a chaque mesure, sans retarder la reaction de
 * l'ecran a la voix (attaque ~30 ms, retombee ~130 ms a 60 images/s). PURE.
 * @param {number} precedent niveau lisse precedent (0..1)
 * @param {number} mesure mesure brute (0..1)
 * @param {{montee?: number, descente?: number}} [options]
 * @returns {number} niveau lisse (0..1)
 */
export function smoothLevel(precedent, mesure, options = {}) {
  const p = Number.isFinite(precedent) ? Math.max(0, Math.min(1, precedent)) : 0;
  const m = Number.isFinite(mesure) ? Math.max(0, Math.min(1, mesure)) : 0;
  const montee = Number.isFinite(options.montee) ? options.montee : 0.5;
  const descente = Number.isFinite(options.descente) ? options.descente : 0.12;
  const facteur = m > p ? montee : descente;
  const suivant = p + (m - p) * facteur;
  return Math.max(0, Math.min(1, suivant));
}

/** Largeur minimale du trait (le silence) et maximale, en pourcentage. */
export const LEVEL_MIN_PCT = 8;
export const LEVEL_MAX_PCT = 100;

/**
 * Niveau (0..1) -> longueur du trait (8..100 %). PURE.
 * Racine carree : l'oreille percoit le niveau en echelle logarithmique ; une
 * echelle lineaire collerait le trait au plancher sur une voix normale.
 * @param {number} niveau
 * @returns {number} pourcentage, arrondi au dixieme
 */
export function levelToWidth(niveau) {
  const n = Number.isFinite(niveau) ? Math.max(0, Math.min(1, niveau)) : 0;
  const part = Math.sqrt(n);
  const pct = LEVEL_MIN_PCT + part * (LEVEL_MAX_PCT - LEVEL_MIN_PCT);
  return Math.round(pct * 10) / 10;
}

/**
 * Ce qu'il faut ECRIRE a l'ecran pour un niveau donne. PURE.
 * Mouvement reduit (§4.3) : la longueur reste FIGEE par etat dans le CSS, aucune
 * valeur n'est posee — sinon une valeur en ligne ecraserait la regle figee.
 * @param {{niveau?: number, reduit?: boolean}} [etats]
 * @returns {{ecrire: boolean, largeur: number}}
 */
export function planLevel(etats = {}) {
  const e = etats || {};
  if (e.reduit === true) return { ecrire: false, largeur: 0 };
  return { ecrire: true, largeur: levelToWidth(e.niveau) };
}

/**
 * Faut-il demander le micro MAINTENANT ? PURE.
 *
 * La demande part a l'ENTREE du mode (correctif « mesure en premier ») : la
 * MESURE du niveau ouvre en premier, la dictee vient apres elle. Le GESTE n'est
 * plus qu'un second declencheur de la MEME demande (le bouton « Autoriser le
 * micro », apres un refus) — jamais une seconde demande.
 *
 * Trois refus : ni entree ni geste, demande deja partie (un refus ne se
 * represente pas tout seul : seul le bouton relance), et micro deja ouvert.
 * @param {{entree?: boolean, geste?: boolean, dejaDemande?: boolean,
 *   microActif?: boolean}} [etats]
 * @returns {boolean}
 */
export function shouldAskVocalMic(etats = {}) {
  const e = etats || {};
  if (e.entree !== true && e.geste !== true) return false;
  if (e.dejaDemande === true) return false;
  if (e.microActif === true) return false;
  return true;
}

/**
 * Contraintes DEMANDEES pour la capture du mode Vocal. L'annulation d'echo est
 * la premiere garde du lot 4a : sans elle, Pilot s'entend lui-meme. Aucune des
 * trois options n'est obligatoire pour un peripherique : celui qui les ignore
 * les ignore, et `getSettings()` dit ensuite ce qui a REELLEMENT ete applique.
 */
export const MIC_CONSTRAINTS = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
};

// ── LOT 4a : la garde « l'utilisateur parle par-dessus Pilot » ──────────────
//
// Toutes les durees sont en millisecondes ; tous les niveaux sont des RMS
// (0..1), la meme unite que `rmsOf` et que la longueur du trait.

/** Duree de la fenetre d'ouverture de la lecture, pendant laquelle on ne coupe jamais. */
export const BARGE_IN_CALIBRATION_MS = 600;
/** Plancher absolu du seuil : sous ce niveau, personne ne parle (bruit de fond). */
export const BARGE_IN_MIN_LEVEL = 0.05;
/** Marge exigee au-dessus du residu d'echo mesure. */
export const BARGE_IN_RESIDUAL_FACTOR = 1.8;
/** Residu tolere quand le navigateur PROUVE l'annulation d'echo. */
export const BARGE_IN_RESIDUAL_MAX = 0.03;
/** Residu tolere quand le navigateur ne le prouve PAS (casque, enceintes muettes). */
export const BARGE_IN_RESIDUAL_UNPROVEN_MAX = 0.01;
/** Duree de voix CONTINUE avant de couper (anti-claquement, anti-toussotement). */
export const BARGE_IN_MIN_MS = 200;
/** Pas de temps maximal pris en compte pour une image (anti-saut d'horloge). */
export const BARGE_IN_MAX_STEP_MS = 50;
// ── GARANTIE DE SECOURS (la voix franche finit TOUJOURS par couper) ────────
//
// La garde anti-echo peut etre muette : quand le peripherique declare ne pas
// annuler l'echo, ou quand le residu mesure est trop fort, `bargeInArmed`
// interdit la coupure. C'est necessaire (Pilot ne doit pas se couper lui-meme)
// mais insuffisant : une VRAIE voix n'etait alors jamais entendue, donc le cas
// « impossible a couper » existait. Le secours ci-dessous le ferme, sans
// toucher aux seuils existants et sans seconde capture : la reference n'est
// plus la fenetre de calibrage (qui peut etre muette ou polluee) mais **le son
// deja entendu dans CETTE lecture**, et une voix doit le depasser nettement et
// le tenir bien plus longtemps qu'un claquement.

/** Marge exigee au-dessus du son DEJA present (le plus fort entendu dans la lecture). */
export const BARGE_IN_FALLBACK_FACTOR = 2;
/** Duree de voix CONTINUE au-dessus du seuil de secours (5 fois `BARGE_IN_MIN_MS`). */
export const BARGE_IN_FALLBACK_MS = 1000;

/** Un echec de capture du a une CONTRAINTE (et non a un refus) ? PURE. */
export function isConstraintRejection(nom) {
  const n = String(nom || "");
  return n === "OverconstrainedError" || n === "TypeError" || n === "NotSupportedError";
}

/**
 * Annulation d'echo REELLEMENT appliquee a un flux, lue dans `getSettings()`.
 * PURE. Trois reponses, et la troisieme compte :
 *   - `true`  : le navigateur dit l'avoir appliquee ;
 *   - `false` : il dit ne pas l'appliquer — le micro entendra Pilot ;
 *   - `null`  : il ne le dit pas (ou le flux n'a pas de piste) — INCONNU.
 * @param {any} flux flux rendu par la capture
 * @returns {boolean|null}
 */
export function echoCancellationOf(flux) {
  if (!flux || typeof flux.getTracks !== "function") return null;
  let pistes = [];
  try {
    pistes = flux.getTracks() || [];
  } catch (_) {
    return null;
  }
  let vu = null;
  for (const piste of pistes) {
    if (!piste || typeof piste.getSettings !== "function") continue;
    let reglages = null;
    try {
      reglages = piste.getSettings();
    } catch (_) {
      reglages = null;
    }
    if (!reglages || typeof reglages.echoCancellation !== "boolean") continue;
    if (reglages.echoCancellation === true) return true;
    vu = false;
  }
  return vu;
}

/**
 * Seuil de detection d'une prise de parole, pose AU-DESSUS du residu d'echo
 * mesure. PURE : jamais sous `BARGE_IN_MIN_LEVEL` (bruit de fond), et aucune
 * valeur inventee quand la mesure manque (0).
 * @param {number} residuel niveau maximal observe pendant le calibrage
 * @returns {number}
 */
export function vocalEchoThreshold(residuel) {
  const r = Number.isFinite(residuel) ? Math.max(0, Math.min(1, residuel)) : 0;
  return Math.max(BARGE_IN_MIN_LEVEL, r * BARGE_IN_RESIDUAL_FACTOR);
}

/**
 * La detection est-elle ARMEE ? PURE. Elle ne l'est que si l'echo est maitrise :
 * annulation d'echo averee, ou — a defaut de preuve du navigateur — un residu
 * mesure vraiment negligeable. Une annulation d'echo declaree ABSENTE interdit
 * la detection, quel que soit le niveau : c'est la garde qui empeche Pilot de
 * se couper lui-meme.
 * @param {boolean|null} echoAnnule ce que dit `getSettings()`
 * @param {number} residuel residu d'echo mesure
 * @returns {boolean}
 */
export function bargeInArmed(echoAnnule, residuel) {
  const r = Number.isFinite(residuel) ? Math.max(0, Math.min(1, residuel)) : 0;
  if (echoAnnule === false) return false;
  if (r > BARGE_IN_RESIDUAL_MAX) return false;
  if (echoAnnule === true) return true;
  return r <= BARGE_IN_RESIDUAL_UNPROVEN_MAX;
}

/**
 * Seuil de la GARANTIE DE SECOURS, pose au-dessus du RESIDU MESURE. PURE.
 *
 * Pourquoi ce critere, et pourquoi il ne part pas sur le son de Pilot : le
 * residu mesure est le niveau du son que Pilot s'envoie a lui-meme, et il est
 * deja la AVANT que l'utilisateur puisse reagir (il ne monte que sur les
 * moments calmes, jamais sur une voix candidate). Exiger DEUX FOIS ce niveau
 * interdit a ce meme son de franchir son propre seuil, quel que soit son
 * volume, meme quand la preuve d'annulation d'echo manque. Une voix ajoutee au
 * son de Pilot, elle, est une ELEVATION nette : c'est elle — tenue
 * `BARGE_IN_FALLBACK_MS`, cinq fois plus longtemps qu'une coupure normale, et
 * avec une marge plus large que la voie normale (`BARGE_IN_RESIDUAL_FACTOR` =
 * 1,8) — qui est retenue. Le secours est donc plus PRUDENT que la voie
 * normale, et il ne remplace pas la garde anti-echo : il prend le relais quand
 * elle est desarmee.
 * @param {number} residuel residu d'echo mesure dans cette lecture
 * @returns {number}
 */
export function fallbackThreshold(residuel) {
  const r = Number.isFinite(residuel) ? Math.max(0, Math.min(1, residuel)) : 0;
  return Math.max(BARGE_IN_MIN_LEVEL, r * BARGE_IN_FALLBACK_FACTOR);
}

/** Etat initial (et remis a zero) de la garde. PURE. */
export function emptySpeechGate() {
  return {
    dessusMs: 0,
    calibreMs: 0,
    residuel: 0,
    declenche: false,
    // Reference de la garantie de secours : le residu GELE sur l'ATTAQUE du
    // son, au debut de la lecture (le son que Pilot s'envoie), et la duree de
    // voix tenue AU-DESSUS de son seuil. Le residu, lui, continue de suivre
    // l'echo pour dire si la garde est armee ; cette reference-la ne bouge plus.
    refSecours: 0,
    dessusSosMs: 0,
  };
}

/**
 * UN pas de la garde. PURE : tout entre et sort par les arguments, donc la
 * garde se verifie sans micro et sans fenetre.
 *
 * Deroulement d'une lecture :
 *   - « calibrage » : on ne coupe jamais, et on MESURE le son de Pilot sur
 *     l'ATTAQUE (les `BARGE_IN_MIN_MS` premieres millisecondes de la fenetre) —
 *     le reste de la fenetre ne mesure plus rien, pour que la voix de
 *     l'utilisateur ne devienne pas la reference qui l'empeche de couper ;
 *   - ensuite une voix doit depasser le seuil SANS INTERRUPTION pendant
 *     `BARGE_IN_MIN_MS` pour que la garde se declenche ;
 *   - GARANTIE DE SECOURS : si la garde n'est PAS armee (echo douteux, preuve
 *     d'annulation absente ou residu trop fort), une voix qui depasse DEUX FOIS
 *     le residu mesure (`fallbackThreshold`) et le tient `BARGE_IN_FALLBACK_MS`
 *     coupe quand meme. Sans cela, un echo douteux rendait toute coupure
 *     impossible ;
 *   - elle ne se declenche qu'UNE fois par lecture (`declenche`), et l'etat est
 *     remis a zero a CHAQUE changement de lecture (debut comme fin) : ni le
 *     residu ni un verrou d'une lecture ne valent pour la suivante.
 *
 * Deroulement d'une REFLEXION (`reflechi`, lot 4b) : meme garde, sans
 * calibrage — Pilot est muet, il n'y a pas d'echo a mesurer. Seules comptent la
 * voix CONTINUE (`BARGE_IN_MIN_MS`) et le plancher de bruit existant. Le
 * verrou `declenche` se REOUVRE quand la voix retombe sous le seuil : une
 * coupure par prise de parole, jamais deux pour la meme phrase.
 *
 * @param {{dessusMs?: number, calibreMs?: number, residuel?: number, declenche?: boolean,
 *   refSecours?: number, dessusSosMs?: number}} etat
 * @param {number} mesure niveau lisse courant (0..1)
 * @param {{parlant?: boolean, reflechi?: boolean, dtMs?: number, echoAnnule?: boolean|null}} [contexte]
 * @returns {{etat: object, declenche: boolean, arme: boolean, seuil: number, motif: string}}
 */
export function stepSpeechGate(etat, mesure, contexte = {}) {
  const e = etat || {};
  const c = contexte || {};
  const m = Number.isFinite(mesure) ? Math.max(0, Math.min(1, mesure)) : 0;
  const dt = Number.isFinite(c.dtMs) ? Math.max(0, Math.min(BARGE_IN_MAX_STEP_MS, c.dtMs)) : 0;
  const echoAnnule = c.echoAnnule === true ? true : c.echoAnnule === false ? false : null;
  const suivant = {
    dessusMs: Number.isFinite(e.dessusMs) ? Math.max(0, e.dessusMs) : 0,
    calibreMs: Number.isFinite(e.calibreMs) ? Math.max(0, e.calibreMs) : 0,
    residuel: Number.isFinite(e.residuel) ? Math.max(0, Math.min(1, e.residuel)) : 0,
    declenche: e.declenche === true,
    refSecours: Number.isFinite(e.refSecours) ? Math.max(0, Math.min(1, e.refSecours)) : 0,
    dessusSosMs: Number.isFinite(e.dessusSosMs) ? Math.max(0, e.dessusSosMs) : 0,
  };
  // Hors lecture ET hors reflexion : la garde dort, et rien de ce qu'elle a
  // mesure ne survit.
  if (c.parlant !== true && c.reflechi !== true) {
    return { etat: emptySpeechGate(), declenche: false, arme: false, seuil: vocalEchoThreshold(0), motif: "hors-lecture" };
  }
  // ── LOT 4b : Pilot REFLECHIT (aucune voix de Pilot a distinguer) ──
  // Aucun calibrage : il n'y a pas d'echo a mesurer. Aucune condition
  // d'annulation d'echo : elle protege de la voix de Pilot, or Pilot se tait.
  if (c.parlant !== true) {
    const seuilReflexion = vocalEchoThreshold(0);
    if (suivant.declenche) {
      if (m <= seuilReflexion) {
        // La prise de parole est FINIE : la garde se rearne pour la suivante.
        suivant.declenche = false;
        suivant.dessusMs = 0;
        return { etat: suivant, declenche: false, arme: true, seuil: seuilReflexion, motif: "attente" };
      }
      return { etat: suivant, declenche: false, arme: true, seuil: seuilReflexion, motif: "deja-coupe" };
    }
    if (m > seuilReflexion) {
      suivant.dessusMs += dt;
      if (suivant.dessusMs >= BARGE_IN_MIN_MS) {
        suivant.declenche = true;
        return { etat: suivant, declenche: true, arme: true, seuil: seuilReflexion, motif: "voix-detectee" };
      }
      return { etat: suivant, declenche: false, arme: true, seuil: seuilReflexion, motif: "voix-en-cours" };
    }
    suivant.dessusMs = 0;
    return { etat: suivant, declenche: false, arme: true, seuil: seuilReflexion, motif: "attente" };
  }
  const arme = bargeInArmed(echoAnnule, suivant.residuel);
  const seuil = vocalEchoThreshold(suivant.residuel);
  if (suivant.declenche) {
    return { etat: suivant, declenche: false, arme, seuil, motif: "deja-coupe" };
  }
  if (suivant.calibreMs < BARGE_IN_CALIBRATION_MS) {
    suivant.calibreMs += dt;
    // ── LA REFERENCE SE PREND SUR L'ATTAQUE DU SON ────────────────────────
    // Seules les `BARGE_IN_MIN_MS` premieres millisecondes de la fenetre
    // mesurent : c'est la seule portion ou le son entendu ne peut pas encore
    // etre une reaction de l'utilisateur (il vient d'entendre Pilot
    // commencer). Le reste de la fenetre continue d'empecher toute coupure,
    // mais ne peut plus FAIRE MONTER la reference ni le residu : sinon la voix
    // qui doit couper devient la reference qui l'en empeche. Ce defaut etait
    // invisible a la 1re lecture (moteur de voix froid : la fenetre etait du
    // silence) et systematique ensuite (moteur chaud : le son de Pilot demarre
    // dans la fenetre, la voix de l'utilisateur par-dessus). Deplacer le
    // MOMENT de la mesure ne change aucune valeur de seuil.
    if (suivant.calibreMs - dt < BARGE_IN_MIN_MS) {
      suivant.residuel = Math.max(suivant.residuel, m);
      // La reference du secours se gele ici, sur l'attaque : une reference qui
      // suivrait la voix ne pourrait jamais etre depassee par elle.
      suivant.refSecours = Math.max(suivant.refSecours, m);
    }
    return { etat: suivant, declenche: false, arme, seuil: vocalEchoThreshold(suivant.residuel), motif: "calibrage" };
  }
  if (!arme) {
    // Echo non maitrise : les seuils habituels sont interdits (Pilot s'entendrait
    // lui-meme). C'est ici que joue la GARANTIE DE SECOURS : la voix est jugee
    // sur la reference GELEE du debut de lecture (le son que Pilot s'envoie),
    // pas sur le seul fait que la preuve d'annulation d'echo manque. Sans elle,
    // un echo douteux rendait toute coupure impossible.
    const seuilSecours = fallbackThreshold(suivant.refSecours);
    if (m > seuilSecours) {
      suivant.dessusSosMs += dt;
      if (suivant.dessusSosMs >= BARGE_IN_FALLBACK_MS) {
        suivant.declenche = true;
        return { etat: suivant, declenche: true, arme: false, seuil: seuilSecours, motif: "voix-secours" };
      }
      return { etat: suivant, declenche: false, arme: false, seuil: seuilSecours, motif: "secours-en-cours" };
    }
    // Le residu ne monte que sur les moments CALMES (`seuil` = marge normale
    // au-dessus de lui) : c'est ce qui dit si l'echo reste maitrise. Il ne sert
    // jamais au secours (reference gelee ci-dessus).
    if (m <= seuil) suivant.residuel = Math.max(suivant.residuel, m);
    return {
      etat: suivant,
      declenche: false,
      arme: false,
      seuil: seuilSecours,
      motif: echoAnnule === false ? "echo-non-annule" : "residuel-eleve",
    };
  }
  if (m > seuil) {
    suivant.dessusMs += dt;
    if (suivant.dessusMs >= BARGE_IN_MIN_MS) {
      suivant.declenche = true;
      return { etat: suivant, declenche: true, arme: true, seuil, motif: "voix-detectee" };
    }
    return { etat: suivant, declenche: false, arme: true, seuil, motif: "voix-en-cours" };
  }
  suivant.dessusMs = 0;
  // Le residu ne monte que sur les moments CALMES : une voix qui depasse le
  // seuil ne doit jamais devenir elle-meme la reference qui l'empeche de couper.
  suivant.residuel = Math.max(suivant.residuel, m);
  return { etat: suivant, declenche: false, arme: true, seuil: vocalEchoThreshold(suivant.residuel), motif: "attente" };
}

/**
 * Puissance efficace (RMS) d'un bloc d'echantillons [-1, 1]. PURE.
 * @param {ArrayLike<number>} echantillons
 * @returns {number} 0..1
 */
export function rmsOf(echantillons) {
  if (!echantillons || typeof echantillons.length !== "number" || echantillons.length === 0) return 0;
  let somme = 0;
  for (let i = 0; i < echantillons.length; i += 1) {
    const v = echantillons[i];
    if (Number.isFinite(v)) somme += v * v;
  }
  const rms = Math.sqrt(somme / echantillons.length);
  return Number.isFinite(rms) ? Math.min(1, rms) : 0;
}

/**
 * Moteur du micro de l'ecran Vocal.
 *
 * Tres retours, tous facultatifs :
 *   - `onLevel(niveau)` : niveau lisse (0..1), a chaque image utile ;
 *   - `onListening(actif)` : vrai SEULEMENT quand le micro capte reellement ;
 *   - `onFailure(message)` : message clair quand le micro est ferme (refus,
 *     absence, occupation, panne) — le mode reste utilisable.
 *
 * Et un quatrieme depuis le lot 4a : `onSpeechStart(rapport)` — une voix vient
 * de depasser le seuil de la garde PENDANT que Pilot lit a voix haute. Il ne
 * part qu'une fois par lecture, et seulement si la garde est armee. Depuis le
 * lot 4b, il part aussi quand la voix prend la parole pendant que Pilot
 * REFLECHIT (meme signal, meme forme de rapport : l'appelant decide quoi
 * arreter).
 *
 * @param {{
 *   onLevel?: (niveau: number) => void,
 *   onListening?: (actif: boolean) => void,
 *   onFailure?: (message: string) => void,
 *   onSpeechStart?: (rapport: {residuel: number, seuil: number}) => void,
 *   navigator?: any, AudioContext?: any,
 *   requestAnimationFrame?: (cb: Function) => number,
 *   cancelAnimationFrame?: (id: number) => void,
 *   now?: () => number,
 * }} [options]
 */
export function createVocalMic(options = {}) {
  const surNiveau = typeof options.onLevel === "function" ? options.onLevel : () => {};
  const surEcoute = typeof options.onListening === "function" ? options.onListening : () => {};
  const surPanne = typeof options.onFailure === "function" ? options.onFailure : () => {};
  const surParole = typeof options.onSpeechStart === "function" ? options.onSpeechStart : () => {};
  const maintenant =
    typeof options.now === "function"
      ? options.now
      : () =>
          typeof performance !== "undefined" && typeof performance.now === "function"
            ? performance.now()
            : Date.now();
  const nav = options.navigator || (typeof navigator !== "undefined" ? navigator : null);
  const contexteCtor =
    options.AudioContext ||
    (typeof window !== "undefined" ? window.AudioContext || window.webkitAudioContext || null : null);
  const raf =
    options.requestAnimationFrame ||
    (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame.bind(window)
      : null);
  const caf =
    options.cancelAnimationFrame ||
    (typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function"
      ? window.cancelAnimationFrame.bind(window)
      : null);

  // Etat interne : `flux` non nul = un peripherique est REELLEMENT ouvert.
  let flux = null;
  let contexte = null;
  let analyseur = null;
  let tampon = null;
  let boucle = 0;
  let niveau = 0;
  let actif = false;
  let ferme = false;
  // ── LOT 4a ──
  // `parlant` : Pilot lit a voix haute MAINTENANT (pose par l'appelant a partir
  // de l'etat de la lecture, jamais devine ici). `echoAnnule` : ce que le
  // peripherique dit de son annulation d'echo (true / false / null = inconnu).
  let parlant = false;
  // ── LOT 4b ──
  // `reflechi` : l'Assistant TRAITE maintenant, sans rien dire (pose par
  // l'appelant a partir de l'etat de reflexion de l'onglet, jamais devine ici).
  let reflechi = false;
  let echoAnnule = null;
  let garde = emptySpeechGate();
  let dernierTemps = 0;

  function arreterBoucle() {
    if (boucle && typeof caf === "function") {
      try {
        caf(boucle);
      } catch (_) {
        /* une image non annulee n'empeche pas l'arret du flux */
      }
    }
    boucle = 0;
  }

  /**
   * Arret REEL : les pistes sont arretees (le temoin du systeme s'eteint, le
   * peripherique est rendu), le contexte audio est ferme, la boucle est
   * annulee. Ne pas seulement « ignorer » le flux : il resterait ouvert.
   */
  function liberer() {
    // `actif` d'abord : l'arret des pistes peut emettre `ended` de facon
    // SYNCHRONE, et ce signal ne doit pas etre pris pour une panne alors que
    // c'est NOUS qui arretons.
    const etait = actif;
    actif = false;
    arreterBoucle();
    const f = flux;
    flux = null;
    if (f && typeof f.getTracks === "function") {
      let pistes = [];
      try {
        pistes = f.getTracks() || [];
      } catch (_) {
        pistes = [];
      }
      for (const piste of pistes) {
        try {
          piste.stop();
        } catch (_) {
          /* une piste deja terminee n'a rien a arreter */
        }
      }
    }
    const c = contexte;
    contexte = null;
    analyseur = null;
    tampon = null;
    if (c && typeof c.close === "function") {
      try {
        const p = c.close();
        if (p && typeof p.catch === "function") p.catch(() => {});
      } catch (_) {
        /* un contexte deja ferme n'a rien a fermer */
      }
    }
    niveau = 0;
    // La garde du lot 4a repart d'une mesure neuve : aucun residu d'une session
    // precedente ne survit a une nouvelle capture.
    parlant = false;
    reflechi = false;
    garde = emptySpeechGate();
    dernierTemps = 0;
    if (etait) surEcoute(false);
  }

  function mesurer() {
    if (!actif || !analyseur) return;
    try {
      analyseur.getFloatTimeDomainData(tampon);
    } catch (_) {
      // Analyseur devenu muet (peripherique retire) : on s'arrete proprement.
      liberer();
      surPanne(micFailureMessage("TrackStartError"));
      return;
    }
    niveau = smoothLevel(niveau, rmsOf(tampon));
    try {
      surNiveau(niveau);
    } catch (_) {
      /* un ecran absent ne doit pas arreter la mesure */
    }
    mesurerParole();
    if (typeof raf === "function") {
      boucle = raf(mesurer);
    }
  }

  /**
   * LOT 4a : un pas de la garde, sur le niveau que l'ecran vient d'afficher (le
   * meme chiffre, pas une seconde mesure). Le signal ne part qu'une fois : la
   * garde se verrouille jusqu'au debut de la lecture suivante — ou jusqu'a ce
   * que la voix retombe pendant une reflexion (lot 4b).
   */
  function mesurerParole() {
    const instant = maintenant();
    const dtMs = dernierTemps ? Math.max(0, instant - dernierTemps) : 0;
    dernierTemps = instant;
    const pas = stepSpeechGate(garde, niveau, { parlant, reflechi, dtMs, echoAnnule });
    garde = pas.etat;
    if (!pas.declenche) return;
    try {
      surParole({ residuel: garde.residuel, seuil: pas.seuil, motif: pas.motif });
    } catch (_) {
      /* l'appelant ne doit pas casser la mesure */
    }
  }

  function brancher() {
    if (!contexteCtor || typeof contexteCtor !== "function") return false;
    try {
      contexte = new contexteCtor();
    } catch (_) {
      contexte = null;
      return false;
    }
    try {
      if (contexte.state === "suspended" && typeof contexte.resume === "function") {
        const p = contexte.resume();
        if (p && typeof p.catch === "function") p.catch(() => {});
      }
    } catch (_) {
      /* un contexte suspendu reste utilisable a la prochaine image */
    }
    let source = null;
    try {
      source = contexte.createMediaStreamSource(flux);
      analyseur = contexte.createAnalyser();
      analyseur.fftSize = 1024;
      // Lissage de l'analyseur volontairement bas : le lissage FIN est fait par
      // `smoothLevel` (montee / descente distinctes), pour ne pas cumuler deux
      // lissages et retarder l'affichage.
      analyseur.smoothingTimeConstant = 0.2;
      tampon = new Float32Array(analyseur.fftSize);
      source.connect(analyseur);
    } catch (_) {
      analyseur = null;
      return false;
    }
    return true;
  }

  /**
   * Demande le micro. L'APPELANT decide QUAND (entree du mode, ou geste de
   * reprise) : ce module ne connait ni le mode ni les gestes. Resout `true` si
   * le micro capte, `false` sinon — ne rejette jamais.
   * @returns {Promise<boolean>}
   */
  async function demander() {
    if (ferme) return false;
    if (actif) return true;
    const md = nav && nav.mediaDevices;
    if (!md || typeof md.getUserMedia !== "function") {
      surPanne(micFailureMessage("NotFoundError"));
      return false;
    }
    let brut = null;
    let echec = null;
    // UN SEUL appel de capture pour tout le fichier (verrouille par test) : il
    // sert aux contraintes du lot 4a ET au repli simple ci-dessous.
    const demanderFlux = (contraintes) => md.getUserMedia(contraintes);
    try {
      brut = await demanderFlux(MIC_CONSTRAINTS);
    } catch (err) {
      echec = err;
      // Un peripherique qui refuse une contrainte precise n'est PAS un micro
      // absent ni un refus de l'utilisateur : on redemande le micro simple, une
      // seule fois. L'annulation d'echo repasse alors a l'appreciation du
      // navigateur, et `getSettings()` dira ce qu'il en est reellement.
      if (isConstraintRejection(err && err.name)) {
        try {
          brut = await demanderFlux({ audio: true });
          echec = null;
        } catch (err2) {
          echec = err2;
        }
      }
    }
    if (!brut) {
      // Le mode a pu etre quitte pendant la demande : l'echec ne concerne plus
      // aucun ecran, il n'est donc pas signale.
      if (!ferme) surPanne(micFailureMessage(echec && echec.name ? echec.name : ""));
      return false;
    }
    // PREUVE de l'annulation d'echo, lue sur la piste REELLEMENT obtenue : c'est
    // elle qui autorise (ou interdit) la detection d'une prise de parole.
    echoAnnule = echoCancellationOf(brut);
    // Le mode a ete quitte pendant la demande : le flux obtenu est REFERME tout
    // de suite, jamais laisse ouvert en arriere-plan.
    if (ferme) {
      try {
        (brut.getTracks() || []).forEach((p) => p.stop());
      } catch (_) {
        /* rien a arreter */
      }
      return false;
    }
    flux = brut;
    if (!brancher()) {
      liberer();
      surPanne(micFailureMessage("TrackStartError"));
      return false;
    }
    // Une panne du peripherique en cours d'ecoute (debranche, pris par une autre
    // application) doit se voir : l'ecran repasse au silence et le dit.
    let pistes = [];
    try {
      pistes = flux.getTracks() || [];
    } catch (_) {
      pistes = [];
    }
    for (const piste of pistes) {
      try {
        if (typeof piste.addEventListener === "function") {
          piste.addEventListener("ended", () => {
            if (!actif) return; // arret DECIDE par nous (sortie du mode)
            liberer();
            surPanne(micFailureMessage("TrackStartError"));
          });
        }
      } catch (_) {
        /* une piste sans evenement n'empeche pas la mesure */
      }
    }
    actif = true;
    niveau = 0;
    surEcoute(true);
    // Premiere mesure a l'image SUIVANTE (jamais dans l'appel) : la demande se
    // termine proprement, et l'arret peut annuler la boucle sans image en vol.
    if (typeof raf === "function") {
      boucle = raf(mesurer);
    } else {
      mesurer();
    }
    return true;
  }

  /** Quitte l'ecran : le micro est coupe pour de bon (aucun flux residuel). */
  function fermer() {
    ferme = true;
    liberer();
  }

  /**
   * LOT 4a : Pilot se met a lire (vrai) ou cesse de lire (faux). Appele par
   * l'ecran a partir de l'etat de la lecture : le micro ne devine jamais qui
   * parle. La garde ne s'arme que sur un debut de lecture, et se remet a zero
   * des la fin — le residu d'une lecture ne vaut pas pour la suivante.
   *
   * La PREUVE d'annulation d'echo est RELUE ici, a chaque annonce de lecture,
   * sur la piste DEJA ouverte (meme appel `getSettings()`, aucune seconde
   * capture). Lue une seule fois a l'ouverture du micro, elle se figeait pour
   * toute la session : une valeur `false` interdisait alors la coupure jusqu'a
   * la sortie du mode, sans aucune trace. La relire ne change aucun seuil.
   *
   * La garde est remise a ZERO a CHAQUE changement de `parlant` (debut comme
   * fin de lecture) : chaque lecture est une prise de parole NEUVE, avec sa
   * propre mesure et sa propre decision. Remise a zero seulement a la fin, elle
   * laissait un verrou pose pendant la REFLEXION (`declenche`) survivre a la
   * lecture suivante, qui sortait alors en `deja-coupe` et ne pouvait plus etre
   * coupee du tout.
   * @param {boolean} actif
   */
  function setSpeaking(actif) {
    const etat = actif === true;
    if (etat && flux) echoAnnule = echoCancellationOf(flux);
    if (etat === parlant) return;
    parlant = etat;
    garde = emptySpeechGate();
    dernierTemps = 0;
  }

  /**
   * LOT 4b : « Pilot reflechit » (vrai) ou ne reflechit plus (faux). Meme
   * discipline que `setSpeaking` : l'etat est repose par l'appelant, jamais
   * devine ici. A la FIN de la reflexion, la garde repart de ZERO, comme aux
   * autres remises a zero : la mesure de continuite ne s'additionne pas d'un
   * tour a l'autre, et le verrou de coupure d'une prise de parole pendant la
   * reflexion ne survit pas a la lecture qui suit (il l'aurait avalee entiere).
   * Une prise de parole pendant la reflexion est deja bornee a UNE coupure par
   * la garde elle-meme, qui se rearme des que la voix retombe.
   * @param {boolean} actif
   */
  function setThinking(actif) {
    const etat = actif === true;
    if (etat === reflechi) return;
    reflechi = etat;
    if (!etat) {
      garde = emptySpeechGate();
      dernierTemps = 0;
    }
  }

  /**
   * Les CHIFFRES de la garde, tels qu'ils sont mesures sur ce micro : de quoi
   * verifier au vrai peripherique qu'aucune coupure ne peut partir toute seule
   * (residu, seuil, arme ou non).
   *
   * Quand la garde n'est pas armee, `seuil` est celui de la GARANTIE DE SECOURS
   * (au-dessus du son deja present) : c'est le chiffre qui compte alors, et
   * c'est lui qu'il faut comparer au residu releve.
   * @returns {{echoCancellation: boolean|null, residuel: number, seuil: number,
   *   arme: boolean, calibre: boolean, motif: string, pendant: string,
   *   seuilSecours: number}}
   */
  function bargeInReport() {
    const arme = bargeInArmed(echoAnnule, garde.residuel);
    const seuilSecours = fallbackThreshold(garde.refSecours);
    const seuil = arme || !parlant ? vocalEchoThreshold(garde.residuel) : seuilSecours;
    const calibre = garde.calibreMs >= BARGE_IN_CALIBRATION_MS;
    let motif = "hors-lecture";
    if (parlant) {
      if (!calibre) motif = "calibrage";
      else if (!arme) {
        motif = garde.declenche
          ? "voix-secours"
          : garde.dessusSosMs > 0
            ? "secours-en-cours"
            : echoAnnule === false
              ? "echo-non-annule"
              : "residuel-eleve";
      } else motif = garde.declenche ? "voix-detectee" : "a-l-ecoute";
    } else if (reflechi) {
      // LOT 4b : pas de calibrage a attendre, l'echo n'a pas d'objet ici.
      motif = garde.declenche ? "voix-detectee" : "a-l-ecoute";
    }
    const pendant = parlant ? "lecture" : reflechi ? "reflexion" : "";
    return {
      echoCancellation: echoAnnule,
      residuel: Math.round(garde.residuel * 1000) / 1000,
      seuil: Math.round(seuil * 1000) / 1000,
      arme,
      calibre,
      motif,
      pendant,
      seuilSecours: Math.round(seuilSecours * 1000) / 1000,
      refSecours: Math.round(garde.refSecours * 1000) / 1000,
    };
  }

  return {
    demander,
    fermer,
    setSpeaking,
    setThinking,
    bargeInReport,
    estActif: () => actif,
  };
}
