// vocal-enveloppe-aigu.js — L'ENVELOPPE DE PAROLE SUIT LE SON REEL DE PILOT
// (demande du proprietaire : « le halo doit suivre le son, pas une pulsation
// decorative »).
//
// VOCABULAIRE (spec_modes_ecran_vocal.md §4, decision 5) : « le halo » designe
// UNIQUEMENT la voix de l'utilisateur (`.vocal-halo`, dans le disque). La lueur
// qui entoure le disque quand Pilot parle s'appelle « l'enveloppe de parole »
// (`.vocal-orb::before`, animation `vocal-speak-glow`). Ce module ne touche donc
// QUE l'enveloppe de parole : aucun nom de ce fichier ne parle de « halo ».
//
// CE QUE CE MODULE EST : la mesure de l'AIGU de la voix de Pilot, et sa
// projection sur l'enveloppe (extension + intensite). Les DECISIONS sont PURES
// et testables (aucun DOM, aucune API audio) :
//   - `highBandBins` / `highBandEnergy` : donnees d'un analyseur + frequence
//     d'echantillonnage -> 0..1, sur la bande la PLUS HAUTE de la voix ;
//   - `smoothEnvelopeEnergy` : lissage (montee rapide, retombee lente) ;
//   - `envelopeFromEnergy` : energie -> extension (18..32 px) + alpha (0,8..1) ;
//   - `planSpeechEnvelope` : qui a le droit de porter la parole (jamais deux
//     afficheurs, rien en mouvement reduit, rien sans mesure).
//
// CE QUE CE MODULE N'EST PAS : un afficheur. Il ne cree aucun noeud, ne lit
// aucun reglage, ne demande aucune permission. `super-agent.js` se contente de
// poser deux variables de style.
//
// CE QUI N'EST PAS MESURABLE, ET QUI LE RESTE (dit dans le rapport et la spec) :
// la voix du SYSTEME (`speechSynthesis`) ne rend AUCUN flux audio a la page ;
// aucun analyseur ne peut la voir. Dans ce cas le metre ne s'attache a rien,
// `planSpeechEnvelope` n'est jamais appele avec `disponible: true`, et
// l'enveloppe garde son animation existante : c'est un repli assume, pas une
// mesure inventee. Seule la voix LOCALE (Piper) joue un son que la page peut
// ecouter — c'est le cas couvert pour de vrai (`createMediaElementSource` +
// `AnalyserNode`, sur l'element audio de `local-voice.js`).

import { setLocalVoiceAudioTap } from "./local-voice.js";

/** Taille de la FFT de l'analyseur (meme fenetre que le contour, §5.2). */
export const ENVELOPE_FFT = 512;

/** Images par seconde de la mesure (30 /s, comme le contour). */
export const ENVELOPE_FPS = 30;

/**
 * Debut de la bande « aigu », en hertz : les consonnes et les sibilantes de la
 * voix. C'est la bande qui bouge quand on parle et qui ne bouge pas quand le
 * son est grave : elle fait « respirer » l'enveloppe avec les mots.
 */
export const ENVELOPE_HIGH_MIN_HZ = 4000;

/**
 * Borne haute de l'analyse, en hertz : la MEME regle que l'analyse du contour
 * (`vocal-equalizer.js` §5.2, `min(8000, 0,45 x taux)`). Recopiee a dessein :
 * le module du contour n'est branche a rien (son test le verifie) et cette
 * enveloppe ne doit pas le tirer dans l'application.
 */
export const ENVELOPE_HIGH_HZ = 8000;

/** Deuxieme borne de l'analyse : 45 % du taux d'echantillonnage. */
export const ENVELOPE_HIGH_RATIO = 0.45;

/** Sous cette moyenne, il n'y a rien : l'enveloppe reste au repos (§5.5). */
export const ENVELOPE_SILENCE = 0.03;

/** Facteur de montee du lissage (convention du projet, `smoothLevel`). */
export const ENVELOPE_RISE = 0.5;

/** Facteur de descente du lissage (retombee plus lente que la montee). */
export const ENVELOPE_FALL = 0.12;

/**
 * Rayon de l'anneau du disque, en pixels : 168 px de boite / 2. C'est le point
 * de depart de la couronne lumineuse (mesure de la feuille de style, §2.2).
 */
export const ENVELOPE_RING_PX = 84;

/** Extension de l'enveloppe au repos, en pixels au-dela de l'anneau. */
export const ENVELOPE_MIN_PX = 18;

/** Extension de l'enveloppe pleine, en pixels au-dela de l'anneau. */
export const ENVELOPE_MAX_PX = 32;

/** Intensite de l'enveloppe au repos : elle ne s'eteint jamais (0,8). */
export const ENVELOPE_MIN_ALPHA = 0.8;

/** Intensite de l'enveloppe pleine. */
export const ENVELOPE_MAX_ALPHA = 1;

// ── Petits outils numeriques ────────────────────────────────────────────────

function clamp01(valeur) {
  const v = Number.isFinite(valeur) ? valeur : 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function arrondi(valeur, decales) {
  const facteur = Math.pow(10, decales);
  const v = Number.isFinite(valeur) ? valeur : 0;
  const r = Math.round(v * facteur) / facteur;
  return r === 0 ? 0 : r;
}

/**
 * Borne haute reelle de l'analyse, en hertz (`min(8000, 0,45 x taux)`).
 * @param {number} sampleRate
 * @returns {number} 0 si le taux est illisible
 */
export function envelopeHighHz(sampleRate) {
  const taux = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 0;
  if (!taux) return 0;
  return Math.min(ENVELOPE_HIGH_HZ, ENVELOPE_HIGH_RATIO * taux);
}

// ── La bande la plus haute, en cases d'analyseur ───────────────────────────
//
// `getByteFrequencyData` rend `frequencyBinCount` valeurs (une par case), la
// case `i` valant `i x taux / fftSize`, et `frequencyBinCount = fftSize / 2`.
// La largeur d'une case est donc `taux / (2 x nombre de cases)` : c'est ce qui
// permet de traduire « 4000 Hz » en un indice, quel que soit le taux choisi par
// la fenetre (44,1 kHz sur un poste, 48 kHz sur un autre).

/**
 * Cases de l'analyseur qui couvrent la bande AIGU (de 4 kHz au plafond).
 * PURE.
 * @param {number} sampleRate frequence d'echantillonnage du contexte audio
 * @param {number} bins `frequencyBinCount` (nombre de cases disponibles)
 * @returns {{start: number, end: number}} `end < start` quand rien n'est
 *   mesurable (taux ou nombre de cases illisible)
 */
export function highBandBins(sampleRate, bins) {
  const n = Number.isFinite(bins) && bins > 0 ? Math.trunc(bins) : 0;
  const taux = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 0;
  if (!n || !taux) return { start: 0, end: -1 };
  const binHz = taux / (2 * n);
  const haute = envelopeHighHz(taux);
  if (!(haute > 0) || !(binHz > 0)) return { start: 0, end: -1 };
  // Un taux tres bas ramenerait 4 kHz au-dela du plafond : on garde alors la
  // moitie haute de ce qui est mesurable, jamais une bande vide.
  const debutHz = Math.min(ENVELOPE_HIGH_MIN_HZ, haute / 2);
  const start = Math.max(1, Math.round(debutHz / binHz));
  const end = Math.min(n - 1, Math.floor(haute / binHz));
  if (!(end >= start)) return { start: 0, end: -1 };
  return { start, end };
}

/**
 * Energie de la bande AIGU d'une image d'analyseur, sur 0..1. PURE.
 *
 * Trois proprietes verifiees par test :
 *   - silence (toutes les cases a 0) -> 0, et rien d'autre : aucune pulsation
 *     inventee au repos ;
 *   - son riche en aigu (bande haute saturee) -> proche de 1 ;
 *   - son grave (bande haute vide, basses pleines) -> 0.
 *
 * La valeur brute est la MOYENNE des cases de la bande (0..1, les octets de
 * l'analyseur allant de 0 a 255), moins le plancher de silence, le tout passe
 * par une racine carree : la meme famille de compression que le contour, qui
 * rend un aigu faible lisible sans saturer au premier mot.
 *
 * @param {ArrayLike<number>} freqData octets 0..255 (`getByteFrequencyData`)
 * @param {number} sampleRate frequence d'echantillonnage du contexte
 * @returns {number} 0..1
 */
export function highBandEnergy(freqData, sampleRate) {
  const n = freqData && Number.isFinite(freqData.length) ? freqData.length : 0;
  if (!n) return 0;
  const { start, end } = highBandBins(sampleRate, n);
  if (!(end >= start)) return 0;
  let somme = 0;
  for (let i = start; i <= end; i++) {
    const octet = Number(freqData[i]);
    somme += Number.isFinite(octet) && octet > 0 ? Math.min(255, octet) / 255 : 0;
  }
  const moyenne = somme / (end - start + 1);
  if (!(moyenne >= ENVELOPE_SILENCE)) return 0;
  return clamp01(Math.sqrt((moyenne - ENVELOPE_SILENCE) / (1 - ENVELOPE_SILENCE)));
}

/**
 * Lissage temporel de l'energie : montee rapide (0,5), retombee lente (0,12).
 * PURE. Le silence ramene donc l'enveloppe au repos en quelques images, sans
 * a-coup.
 * @param {number} precedent valeur precedente (0..1)
 * @param {number} mesure valeur mesuree (0..1)
 * @returns {number} 0..1
 */
export function smoothEnvelopeEnergy(precedent, mesure) {
  const avant = clamp01(precedent);
  const apres = clamp01(mesure);
  const facteur = apres > avant ? ENVELOPE_RISE : ENVELOPE_FALL;
  return clamp01(avant + (apres - avant) * facteur);
}

/**
 * Energie -> extension et intensite de l'enveloppe. PURE.
 *
 * L'extension est l'ecart, en pixels, entre l'anneau du disque et le bord de
 * l'enveloppe : `ENVELOPE_MIN_PX` (18 px) au repos, `ENVELOPE_MAX_PX` (32 px)
 * a pleine voix.
 *
 * `scale` est le facteur applique au CSS (`transform: scale(...)`). ATTENTION :
 * la boite de l'enveloppe n'est pas un simple disque de 32 px — elle va du
 * centre jusqu'a `ENVELOPE_RING_PX + ENVELOPE_MAX_PX` (116 px, soit la boite de
 * 232 px). Une transformation reduit donc TOUTE la boite autour de son centre :
 * pour que le bord de la couronne tombe pile a `84 + extension`, il faut
 * `scale = (84 + extension) / 116`. Au repos : 102 / 116 = 0,8793 (la couronne
 * fait bien 18 px au-dela de l'anneau) ; a pleine voix : 1 (32 px). Diviser
 * l'extension par 32 donnerait 0,5625, ce qui ramenerait le bord a 65 px —
 * c'est-a-dire SOUS l'anneau, donc invisible : c'est ce piege que cette
 * formule evite.
 *
 * L'intensite ne s'effondre jamais : de 0,8 a 1 (l'enveloppe ne clignote pas,
 * elle respire), comme le plancher de l'animation qu'elle remplace.
 *
 * @param {number} energie 0..1
 * @returns {{energy: number, extension: number, scale: number, alpha: number}}
 */
export function envelopeFromEnergy(energie) {
  const e = clamp01(energie);
  const extension = arrondi(ENVELOPE_MIN_PX + (ENVELOPE_MAX_PX - ENVELOPE_MIN_PX) * e, 1);
  const rayon = ENVELOPE_RING_PX + extension;
  const scale = arrondi(rayon / (ENVELOPE_RING_PX + ENVELOPE_MAX_PX), 4);
  const alpha = arrondi(ENVELOPE_MIN_ALPHA + (ENVELOPE_MAX_ALPHA - ENVELOPE_MIN_ALPHA) * e, 3);
  return { energy: e, extension, scale, alpha };
}

/**
 * Qui a le droit de porter la parole de Pilot ? PURE.
 *
 * Trois refus, et chacun a sa raison :
 *   - `contourPeint` : le contour spectral peint deja cette voix
 *     (`.vocal-spectrum-live`, §7.3) — jamais deux afficheurs pour la meme voix ;
 *   - `reduit` : en mouvement reduit l'enveloppe est FIXE mais VISIBLE (le CSS
 *     la tient a l'opacite 1, sans animation) : aucune valeur n'est posee ;
 *   - `disponible` faux : aucune mesure (voix du systeme, analyseur absent ou
 *     refuse) : c'est l'animation existante qui reste le repli.
 *
 * @param {{energy?: number, reduit?: boolean, contourPeint?: boolean,
 *          disponible?: boolean}} [etats]
 * @returns {{live: boolean, energy: number, extension: number, scale: number,
 *            alpha: number}}
 */
export function planSpeechEnvelope(etats = {}) {
  const e = etats || {};
  const live = e.disponible === true && e.reduit !== true && e.contourPeint !== true;
  const halo = envelopeFromEnergy(live ? e.energy : 0);
  return {
    live,
    energy: halo.energy,
    extension: halo.extension,
    scale: halo.scale,
    alpha: halo.alpha,
  };
}

// ── Le branchement : UN analyseur sur le SEUL son que Pilot joue lui-meme ───
//
// Aucune API audio ne sort de ce module. Il n'y a qu'un seul analyseur, monte
// sur l'element audio de la voix locale (`local-voice.js` le lui tend par
// `setLocalVoiceAudioTap`, sans rien savoir de ce qu'on en fait). Il ne mesure
// donc jamais le micro, et il ne peut pas y avoir deux mesures pour une meme
// voix.

/**
 * Cree le metre de l'enveloppe de parole.
 *
 * @param {{win?: object, onEnergy?: (energie: number) => void}} [options]
 *   `onEnergy` recoit l'energie LISSEE (0..1) a chaque image, et une derniere
 *   fois 0 quand le son s'arrete (l'enveloppe revient au repos, sans pulsation)
 * @returns {{demarrer: () => void, arreter: () => void,
 *            attacher: (element: object) => Promise<boolean>,
 *            actif: () => boolean, mesure: () => number}}
 */
export function createSpeechEnvelopeMeter(options = {}) {
  const win = options.win || (typeof globalThis !== "undefined" ? globalThis.window : null);
  const onEnergy = typeof options.onEnergy === "function" ? options.onEnergy : null;

  let ctx = null;
  let analyser = null;
  let data = null;
  let source = null;
  let energy = 0;
  let actif = false;
  let minuteur = 0;
  const vus = new WeakSet();

  function contexte() {
    if (ctx) return ctx;
    const Ctor = win && (win.AudioContext || win.webkitAudioContext);
    if (typeof Ctor !== "function") return null;
    try {
      ctx = new Ctor();
    } catch (_) {
      ctx = null;
    }
    return ctx;
  }

  /** Le contexte tourne-t-il vraiment ? Sinon, on ne mesure RIEN. */
  async function contexteActif() {
    const c = contexte();
    if (!c) return null;
    if (c.state && c.state !== "running") {
      try {
        await c.resume();
      } catch (_) {
        /* un refus n'est pas une panne : on se tait */
      }
    }
    return !c.state || c.state === "running" ? c : null;
  }

  function annuler() {
    if (!minuteur) return;
    const cancel = win && win.cancelAnimationFrame;
    try {
      if (typeof cancel === "function") cancel.call(win, minuteur);
      else if (win && win.clearTimeout) win.clearTimeout.call(win, minuteur);
    } catch (_) {
      /* un minuteur deja mort ne bloque rien */
    }
    minuteur = 0;
  }

  function planifier() {
    if (!actif || minuteur) return;
    const raf = win && win.requestAnimationFrame;
    try {
      if (typeof raf === "function") {
        minuteur = raf.call(win, image);
        return;
      }
      if (win && win.setTimeout) {
        minuteur = win.setTimeout.call(win, image, 1000 / ENVELOPE_FPS);
      }
    } catch (_) {
      minuteur = 0;
    }
  }

  /** Une image : lire l'analyseur, lisser, publier. */
  function image() {
    minuteur = 0;
    if (!actif) return;
    const mesure = lire();
    energy = smoothEnvelopeEnergy(energy, mesure);
    if (onEnergy) onEnergy(energy);
    planifier();
  }

  function lire() {
    if (!analyser || !data || !ctx) return 0;
    try {
      analyser.getByteFrequencyData(data);
    } catch (_) {
      return 0;
    }
    return highBandEnergy(data, ctx.sampleRate);
  }

  /** Le son de ce morceau s'est arrete : l'enveloppe revient au repos. */
  function terminer() {
    annuler();
    energy = 0;
    if (onEnergy) onEnergy(0);
  }

  /**
   * Monte l'analyseur sur un element audio. Rend `true` seulement si la mesure
   * est REELLEMENT possible : sans contexte qui tourne, on ne touche pas a
   * l'element (aucun risque de rendre muette la voix locale).
   * @param {object} element element audio cree par local-voice.js
   * @returns {Promise<boolean>}
   */
  async function attacher(element) {
    if (!actif || !element) return false;
    if (vus.has(element)) return false;
    vus.add(element);
    const c = await contexteActif();
    if (!c) return false;
    // `paused` n'est PAS teste ici : l'element vient d'etre cree, il n'a pas
    // encore recu son `play()`. Seule une fin deja survenue interdit la mesure.
    if (element.ended === true) return false;
    if (!analyser) {
      try {
        analyser = c.createAnalyser();
        analyser.fftSize = ENVELOPE_FFT;
        // Le lissage est le NOTRE (`smoothEnvelopeEnergy`) : deux lissages
        // empiles rendraient la mesure molle et non verifiable.
        analyser.smoothingTimeConstant = 0;
        analyser.minDecibels = -100;
        analyser.maxDecibels = -30;
        data = new Uint8Array(analyser.frequencyBinCount);
        analyser.connect(c.destination);
      } catch (_) {
        analyser = null;
        data = null;
        return false;
      }
    }
    let src = null;
    try {
      src = c.createMediaElementSource(element);
    } catch (_) {
      // Une fenetre qui refuse cette API laisse la voix locale intacte : pas de
      // mesure, et l'animation existante reste le repli.
      return false;
    }
    try {
      const precedent = source;
      src.connect(analyser);
      source = src;
      if (precedent && precedent !== src && typeof precedent.disconnect === "function") {
        try {
          precedent.disconnect();
        } catch (_) {
          /* un noeud deja detache ne bloque rien */
        }
      }
    } catch (_) {
      return false;
    }
    energy = 0;
    try {
      if (typeof element.addEventListener === "function") {
        element.addEventListener("ended", terminer);
        element.addEventListener("pause", terminer);
        element.addEventListener("error", terminer);
      }
    } catch (_) {
      /* sans evenement, la boucle s'arrete a la sortie du mode */
    }
    // Le morceau s'est deja tu pendant que le contexte demarrait : aucune
    // image a mesurer, l'enveloppe reste au repos.
    if (element.paused === true || element.ended === true) {
      terminer();
      return false;
    }
    planifier();
    return true;
  }

  /** Branche l'unique espion du son local. Appele a l'entree du mode Vocal. */
  function demarrer() {
    if (actif) return;
    actif = true;
    setLocalVoiceAudioTap(attacher);
  }

  /** Debranche tout : plus aucune mesure, plus aucune boucle (sortie du mode). */
  function arreter() {
    if (!actif) return;
    actif = false;
    annuler();
    setLocalVoiceAudioTap(null);
    energy = 0;
    // Un contexte audio qui reste ouvert est un contexte perdu : le navigateur
    // n'en accorde qu'une poignee. On debranche et on le referme, pour que la
    // prochaine entree dans le mode reparte d'un contexte neuf.
    const ancien = ctx;
    ctx = null;
    try {
      if (source && typeof source.disconnect === "function") source.disconnect();
    } catch (_) {
      /* un noeud deja detache ne bloque rien */
    }
    try {
      if (analyser && typeof analyser.disconnect === "function") analyser.disconnect();
    } catch (_) {
      /* idem */
    }
    source = null;
    analyser = null;
    data = null;
    if (ancien && typeof ancien.close === "function") {
      try {
        const fin = ancien.close();
        if (fin && typeof fin.catch === "function") fin.catch(() => {});
      } catch (_) {
        /* un contexte deja ferme ne bloque rien */
      }
    }
  }

  return {
    demarrer,
    arreter,
    attacher,
    actif: () => actif,
    mesure: () => energy,
  };
}
