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
//   - aucune coupure de la parole de Pilot (lot 4) : le niveau n'est lu que
//     pour la longueur du trait, jamais pour decider de se taire ;
//   - aucun ecran de reglage et aucune memoire : la demande part au premier
//     geste dans le mode, jamais a l'entree.
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
 * Trois refus : sans geste de l'utilisateur (jamais a l'entree du mode), si la
 * demande est deja partie (un refus ne se represente pas tout seul : seul le
 * bouton « Autoriser le micro » relance), et si le micro capte deja.
 * @param {{geste?: boolean, dejaDemande?: boolean, microActif?: boolean}} [etats]
 * @returns {boolean}
 */
export function shouldAskVocalMic(etats = {}) {
  const e = etats || {};
  if (e.geste !== true) return false;
  if (e.dejaDemande === true) return false;
  if (e.microActif === true) return false;
  return true;
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
 * Trois retours, tous facultatifs :
 *   - `onLevel(niveau)` : niveau lisse (0..1), a chaque image utile ;
 *   - `onListening(actif)` : vrai SEULEMENT quand le micro capte reellement ;
 *   - `onFailure(message)` : message clair quand le micro est ferme (refus,
 *     absence, occupation, panne) — le mode reste utilisable.
 *
 * @param {{
 *   onLevel?: (niveau: number) => void,
 *   onListening?: (actif: boolean) => void,
 *   onFailure?: (message: string) => void,
 *   navigator?: any, AudioContext?: any,
 *   requestAnimationFrame?: (cb: Function) => number,
 *   cancelAnimationFrame?: (id: number) => void,
 * }} [options]
 */
export function createVocalMic(options = {}) {
  const surNiveau = typeof options.onLevel === "function" ? options.onLevel : () => {};
  const surEcoute = typeof options.onListening === "function" ? options.onListening : () => {};
  const surPanne = typeof options.onFailure === "function" ? options.onFailure : () => {};
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
    if (typeof raf === "function") {
      boucle = raf(mesurer);
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
   * Demande le micro (geste de l'utilisateur requis par l'appelant). Resout
   * `true` si le micro capte, `false` sinon — ne rejette jamais.
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
    try {
      brut = await md.getUserMedia({ audio: true });
    } catch (err) {
      // Le mode a pu etre quitte pendant la demande : l'echec ne concerne plus
      // aucun ecran, il n'est donc pas signale.
      if (!ferme) surPanne(micFailureMessage(err && err.name ? err.name : ""));
      return false;
    }
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

  return {
    demander,
    fermer,
    estActif: () => actif,
  };
}
