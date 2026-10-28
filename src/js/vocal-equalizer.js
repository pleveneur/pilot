// vocal-equalizer.js — LOT A « les maths, invisibles » du cercle-equaliseur
// (CONCEPTION-cercle-equaliseur.md, revision 4, §5 et §11).
//
// CE QUE CE MODULE EST : le calcul PUR du contour du mode Vocal. Il relit les
// nombres d'un fichier WAV deja en memoire (la voix locale de Pilot, un
// `data:audio/wav;base64,...`) et les projette en 32 bandes de frequences, une
// par zone du cercle (11,25 deg par zone, sens horaire, un seul tour).
//
// CE QUE CE MODULE N'EST PAS, ET NE SERA JAMAIS : un afficheur. Aucun ecran,
// aucune peinture, aucun branchement dans ce lot. Aucun import, aucun acces au
// disque, au micro, au reseau, au DOM, ni a une horloge. Toutes les fonctions
// sont pures, sauf les deux qui ECRIVENT dans une cible FOURNIE par l'appelant
// (`spectrumFrameInto`, `spectrumSmooth`) : c'est ce qui garantit zero
// allocation dans le calcul par image.
//
// LES CHIFFRES VIENNENT DU DOCUMENT, PAS D'ICI :
//   - disque 168 px, anneau 2 px => rayon median R0 = 83 px (§5.1) ;
//   - amplitude A = 16 px (decision 3), donc Rmax = 99 px ;
//   - boite 216 x 216 px, centre (108, 108), marge 9 px (§5.1) ;
//   - 32 zones, bandes geometriques de 200 Hz a min(8000, 0,45 x sampleRate),
//     largeur 40^(1/32) = 1,122 par zone (§5.2) ;
//   - FFT 512 points, fenetre de Hann, delta f = sampleRate / 512 (§5.2) ;
//   - alpha(k) = 180 deg + 11,25 deg x k, x = 108 + r sin a, y = 108 - r cos a
//     (§5.2) : k = 0 est a 6 h, k = 8 a 9 h, k = 16 a 12 h ;
//   - FLOOR = -80 dB, CEIL = -30 dB, compression racine carree (§5.3) ;
//   - lissage temporel montee 0,5 / descente 0,12, AUCUN lissage spatial ;
//   - chemin ferme Catmull-Rom uniforme -> Bezier cubiques, indices modulo 32,
//     coordonnees arrondies a 0,1 px (§5.4) ;
//   - silence : max(v) < 0,03 => aucun chemin, le cercle reste net (§5.5).
//
// DEUX POINTS QUE LE DOCUMENT NE FIXE PAS, TRANCHEES ICI ET DITES DANS LE
// RAPPORT (RAPPORT-cercle-lot-a-maths.md) :
//   1. l'echelle absolue des puissances. La formule du §5.3 donne une SOMME
//      BRUTE de |X|^2, decalee de +20 log10(512/2) = +48 dB par rapport a une
//      echelle pleine echelle : tout son audible y saturerait a v = 1, et les
//      deux seules valeurs que le lot D doit MESURER (-80 / -30) n'auraient
//      plus aucun sens. Les puissances sont donc ramenees en dBFS, avec le gain
//      coherent de la fenetre de Hann (0,5) et le facteur 2 du spectre
//      unilateral — deux facteurs derives des choix DEJA ecrits au document,
//      aucune valeur nouvelle inventee ;
//   2. la borne haute de la derniere bande, `fin(31)` n'etant pas definie par la
//      formule du §5.2 (elle utilise `debut(k+1)`). Elle vaut ici
//      `debut(32) - 1`, bornee aux cases utiles de la FFT : la contiguite et
//      l'absence de case comptee deux fois sont donc vraies de bout en bout.
//
// Les commentaires sont en ASCII (convention du projet) ; les valeurs
// numeriques et les noms exportes sont ceux du document, tels quels.

/** Nombre de zones du contour (decision 1 : 32 zones toutes differentes). */
export const SPECTRUM_ZONES = 32;

/** Borne basse des bandes, en hertz (§5.2). */
export const SPECTRUM_LOW_HZ = 200;

/** Borne haute NOMINALE, en hertz : toujours bornee par 0,45 x sampleRate. */
export const SPECTRUM_HIGH_HZ = 8000;

/** Rapport maximal retenu pour la borne haute (§5.2 : 0,45 x sampleRate). */
export const SPECTRUM_HIGH_RATIO = 0.45;

/** Images par seconde de l'analyse (30 /s, §5.3 et §5.6). */
export const SPECTRUM_FPS = 30;

/** Taille de la FFT (512 points, fenetre de Hann, §5.2). */
export const SPECTRUM_FFT = 512;

/** Plancher de dessin, en dB. Une des deux valeurs NON DERIVABLES (lot D). */
export const SPECTRUM_FLOOR_DB = -80;

/** Plafond de dessin, en dB. L'autre valeur NON DERIVABLE (lot D). */
export const SPECTRUM_CEIL_DB = -30;

/** Sous ce maximum, il n'y a rien a dessiner : le cercle reste net (§5.5). */
export const SPECTRUM_SILENCE = 0.03;

/** Rayon de l'anneau, ligne mediane, en pixels (§5.1 : 168 / 2 - 1). */
export const SPECTRUM_RADIUS = 83;

/** Amplitude du contour, en pixels (decision 3 : 16 px). */
export const SPECTRUM_AMPLITUDE = 16;

/** Cote de la boite SVG, en pixels (§5.1 : 168 + 2 x 24). */
export const SPECTRUM_BOX = 216;

/** Centre de la boite, en pixels (§5.1 : 216 / 2). */
export const SPECTRUM_CENTER = SPECTRUM_BOX / 2;

/** Facteur de montee du lissage temporel (§5.3, `smoothLevel` de vocal-mic.js). */
export const SPECTRUM_RISE = 0.5;

/** Facteur de descente du lissage temporel (§5.3). */
export const SPECTRUM_FALL = 0.12;

/** Gain coherent de la fenetre de Hann (0,5) : derivee de la fenetre du §5.2. */
export const SPECTRUM_HANN_GAIN = 0.5;

// ── Petits outils numeriques ────────────────────────────────────────────────

function clamp01(valeur) {
  const v = Number.isFinite(valeur) ? valeur : 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function arrondi1(valeur) {
  const v = Number.isFinite(valeur) ? valeur : 0;
  const r = Math.round(v * 10) / 10;
  return r === 0 ? 0 : r;
}

/** Formate une coordonnee arrondie a 0,1 px (§5.4), sans « .0 » inutile. */
function formatCoord(valeur) {
  return String(arrondi1(valeur));
}

/** Borne haute REELLE de l'analyse, en hertz (§5.2 : min(8000, 0,45 x taux)). */
export function spectrumHighHz(sampleRate) {
  const taux = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 0;
  if (!taux) return 0;
  return Math.min(SPECTRUM_HIGH_HZ, SPECTRUM_HIGH_RATIO * taux);
}

// ── Les 32 bandes : bandes geometriques -> cases de la FFT ──────────────────
//
// Formule du §5.2, telle quelle :
//   debut(0) = round(200 / delta f)
//   debut(k) = max(debut(k-1) + 1, round(f(k) / delta f))    strictement croissant
//   fin(k)   = min(Nyquist, debut(k+1) - 1)                  contigu, jamais vide
// f(k) = 200 x (haute / 200)^(k/32) : la largeur d'une bande est 40^(1/32).

/**
 * Cases de la FFT couvertes par chacune des 32 bandes. PURE.
 * @param {number} sampleRate taux d'echantillonnage lu dans l'en-tete du WAV
 * @returns {Array<{start: number, end: number}>} 32 bandes, ou [] si le taux
 *   est illisible
 */
export function spectrumBandBins(sampleRate) {
  const taux = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 0;
  if (!taux) return [];
  const binHz = taux / SPECTRUM_FFT;
  const haute = spectrumHighHz(taux);
  if (!(haute > SPECTRUM_LOW_HZ)) return [];
  // Cases utiles d'une FFT reelle de 512 points : 0 a 256 (Nyquist inclus).
  const nyquist = SPECTRUM_FFT / 2;

  const debuts = new Array(SPECTRUM_ZONES + 1);
  for (let k = 0; k <= SPECTRUM_ZONES; k++) {
    const hz = SPECTRUM_LOW_HZ * Math.pow(haute / SPECTRUM_LOW_HZ, k / SPECTRUM_ZONES);
    const bin = Math.round(hz / binHz);
    debuts[k] = k === 0 ? bin : Math.max(debuts[k - 1] + 1, bin);
  }

  const bandes = new Array(SPECTRUM_ZONES);
  for (let k = 0; k < SPECTRUM_ZONES; k++) {
    const start = Math.min(debuts[k], nyquist);
    const end = Math.max(start, Math.min(nyquist, debuts[k + 1] - 1));
    bandes[k] = { start, end };
  }
  return bandes;
}

// ── FFT radix-2 en place (tables calculees UNE fois) ────────────────────────

let planFft = null;

function bitInverse(index, bits) {
  let out = 0;
  for (let b = 0; b < bits; b++) out = (out << 1) | ((index >> b) & 1);
  return out;
}

function planFftPour(n) {
  if (planFft && planFft.n === n) return planFft;
  const bits = Math.round(Math.log(n) / Math.log(2));
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  const rev = new Uint16Array(n);
  for (let i = 0; i < n; i++) rev[i] = bitInverse(i, bits);
  const fenetre = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    fenetre[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / n));
  }
  planFft = { n, cos, sin, rev, fenetre };
  return planFft;
}

/** FFT complexe en place (re/im de longueur n = plan.n). */
function fftEnPlace(re, im, plan) {
  const n = plan.n;
  const rev = plan.rev;
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let taille = 2; taille <= n; taille *= 2) {
    const demi = taille / 2;
    const pas = n / taille;
    for (let debut = 0; debut < n; debut += taille) {
      for (let k = 0; k < demi; k++) {
        const t = k * pas;
        const wr = plan.cos[t];
        const wi = -plan.sin[t];
        const i1 = debut + k;
        const i2 = i1 + demi;
        const xr = re[i2] * wr - im[i2] * wi;
        const xi = re[i2] * wi + im[i2] * wr;
        re[i2] = re[i1] - xr;
        im[i2] = im[i1] - xi;
        re[i1] += xr;
        im[i1] += xi;
      }
    }
  }
}

// ── Lecture d'un WAV en memoire (aucune API audio, aucun acces disque) ──────

function choisirAtob(options) {
  const fourni = options && typeof options.atob === "function" ? options.atob : null;
  if (fourni) return fourni;
  const global = typeof globalThis !== "undefined" ? globalThis : null;
  return global && typeof global.atob === "function" ? global.atob.bind(global) : null;
}

function etiquette(view, offset) {
  return (
    String.fromCharCode(view.getUint8(offset)) +
    String.fromCharCode(view.getUint8(offset + 1)) +
    String.fromCharCode(view.getUint8(offset + 2)) +
    String.fromCharCode(view.getUint8(offset + 3))
  );
}

/**
 * Lit un WAV PCM 16 bits depuis une chaine base64 (ou un `data:` URL).
 * PURE : ne lit rien d'autre que la chaine fournie. Les canaux multiples sont
 * ramenes en mono par moyenne, ce qui ne change ni le taux ni la duree.
 * @param {string} base64 chaine base64 nue ou `data:audio/wav;base64,....`
 * @param {{atob?: (b64: string) => string}} [options] decodeur base64 fourni
 * @returns {{sampleRate: number, samples: Float32Array, channels: number,
 *   bitsPerSample: number} | null} null si l'en-tete n'est pas exploitable
 */
export function wavFromBase64(base64, options = {}) {
  const decode = choisirAtob(options);
  if (!decode || typeof base64 !== "string") return null;
  const nu = base64.replace(/^data:[^,]*,/, "").trim();
  if (!nu) return null;
  let binaire;
  try {
    binaire = decode(nu);
  } catch {
    return null;
  }
  if (typeof binaire !== "string" || binaire.length < 44) return null;

  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i) & 0xff;
  const view = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  if (etiquette(view, 0) !== "RIFF" || etiquette(view, 8) !== "WAVE") return null;

  let fmt = null;
  let data = null;
  let offset = 12;
  while (offset + 8 <= octets.length) {
    const id = etiquette(view, offset);
    const taille = view.getUint32(offset + 4, true);
    const corps = offset + 8;
    if (id === "fmt " && corps + 16 <= octets.length) {
      fmt = {
        format: view.getUint16(corps, true),
        channels: view.getUint16(corps + 2, true),
        sampleRate: view.getUint32(corps + 4, true),
        bits: view.getUint16(corps + 14, true),
      };
    } else if (id === "data" && corps <= octets.length) {
      data = { start: corps, size: Math.min(taille, octets.length - corps) };
    }
    offset = corps + taille + (taille % 2);
  }
  if (!fmt || !data) return null;
  if (fmt.format !== 1 && fmt.format !== 0xfffe) return null;
  if (fmt.bits !== 16 || fmt.channels < 1 || !(fmt.sampleRate > 0)) return null;

  const bloc = fmt.channels * 2;
  const trames = Math.floor(data.size / bloc);
  if (trames < 1) return null;

  const samples = new Float32Array(trames);
  for (let i = 0; i < trames; i++) {
    let somme = 0;
    for (let c = 0; c < fmt.channels; c++) {
      somme += view.getInt16(data.start + i * bloc + c * 2, true) / 32768;
    }
    samples[i] = somme / fmt.channels;
  }
  return {
    sampleRate: fmt.sampleRate,
    samples,
    channels: fmt.channels,
    bitsPerSample: fmt.bits,
  };
}

// ── La ligne de temps : 32 bandes par image, calculees UNE fois ─────────────
//
// Le document (§5.6) place l'analyse « au debut du morceau » (3-8 ms pour
// 90 images) : tout est donc calcule ici, une fois, et l'image par image ne
// fait plus que recopier 32 nombres (`spectrumFrameInto`, zero allocation).

/**
 * Construit la ligne de temps a partir d'echantillons deja en memoire. PURE
 * (mis a part le plan de FFT, table constante recalculee a l'identique).
 * @param {number} sampleRate
 * @param {Float32Array|number[]} samples echantillons mono, dans [-1, 1]
 * @returns {{fps: number, count: number, bands: Float32Array,
 *   sampleRate: number, highHz: number,
 *   bandBins: Array<{start: number, end: number}>} | null}
 */
export function spectrumTimelineFromSamples(sampleRate, samples) {
  const taux = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 0;
  if (!taux || !samples || !(samples.length >= 1)) return null;
  const bandBins = spectrumBandBins(taux);
  if (bandBins.length !== SPECTRUM_ZONES) return null;

  const saut = Math.max(1, Math.round(taux / SPECTRUM_FPS));
  const count = Math.max(1, Math.ceil(samples.length / saut));
  const bands = new Float32Array(count * SPECTRUM_ZONES);

  const plan = planFftPour(SPECTRUM_FFT);
  const re = new Float64Array(SPECTRUM_FFT);
  const im = new Float64Array(SPECTRUM_FFT);
  const fenetre = plan.fenetre;
  // Facteur 2 (spectre unilateral) / (N x gain coherent de Hann) : une sinusoide
  // pleine echelle dans une case donne une amplitude de 1, donc 0 dBFS.
  const echelle = (2 / (SPECTRUM_FFT * SPECTRUM_HANN_GAIN)) ** 2;
  const etendue = SPECTRUM_CEIL_DB - SPECTRUM_FLOOR_DB;

  for (let image = 0; image < count; image++) {
    const depart = image * saut;
    for (let i = 0; i < SPECTRUM_FFT; i++) {
      const brut = samples[depart + i];
      re[i] = (typeof brut === "number" && Number.isFinite(brut) ? brut : 0) * fenetre[i];
      im[i] = 0;
    }
    fftEnPlace(re, im, plan);

    for (let k = 0; k < SPECTRUM_ZONES; k++) {
      const bande = bandBins[k];
      const cases = bande.end - bande.start + 1;
      let somme = 0;
      for (let b = bande.start; b <= bande.end; b++) {
        somme += re[b] * re[b] + im[b] * im[b];
      }
      const puissance = (echelle * somme) / cases;
      const db = 10 * Math.log10(puissance + 1e-12);
      const v = clamp01((db - SPECTRUM_FLOOR_DB) / etendue);
      // Compression d'affichage (§5.3, etape 4) : la racine carree est deja
      // appliquee ici, le lissage temporel recoit donc des valeurs 0..1.
      bands[image * SPECTRUM_ZONES + k] = Math.sqrt(v);
    }
  }

  return {
    fps: SPECTRUM_FPS,
    count,
    bands,
    sampleRate: taux,
    highHz: spectrumHighHz(taux),
    bandBins,
  };
}

/**
 * Construit la ligne de temps depuis un `data:audio/wav;base64,...`.
 * @param {string} url
 * @param {{atob?: (b64: string) => string}} [options]
 * @returns {ReturnType<typeof spectrumTimelineFromSamples>}
 */
export function spectrumTimelineFromDataUrl(url, options = {}) {
  const wav = wavFromBase64(url, options);
  if (!wav) return null;
  return spectrumTimelineFromSamples(wav.sampleRate, wav.samples);
}

/**
 * Projette UNE image de la ligne de temps dans une cible FOURNIE. PURE, et
 * ZERO ALLOCATION : la cible est reutilisee telle quelle, la fonction la rend.
 * @param {object|null} timeline ligne de temps (`spectrumTimelineFrom*`)
 * @param {number} index numero d'image (borne a la ligne de temps)
 * @param {Float32Array|number[]} cible cible de 32 valeurs, ecrite en place
 * @returns {Float32Array|number[]|null} la cible, ou null si elle est absente
 */
export function spectrumFrameInto(timeline, index, cible) {
  const cibleOk = cible && Number.isFinite(cible.length) && cible.length > 0 ? cible : null;
  if (!cibleOk) return null;
  const n = Math.min(SPECTRUM_ZONES, cibleOk.length);
  const vide = !timeline || !timeline.bands || !(timeline.count > 0);
  if (vide) {
    for (let k = 0; k < n; k++) cibleOk[k] = 0;
    return cibleOk;
  }
  const i = Number.isFinite(index)
    ? Math.max(0, Math.min(timeline.count - 1, Math.trunc(index)))
    : 0;
  const base = i * SPECTRUM_ZONES;
  for (let k = 0; k < n; k++) cibleOk[k] = timeline.bands[base + k];
  return cibleOk;
}

/**
 * Lissage TEMPOREL, bande par bande, sans aucun lissage spatial (§5.3) :
 * montee 0,5 (50 % du chemin en une image), descente 0,12 (retombee lente).
 * PURE, et ZERO ALLOCATION : l'etat fourni est ecrit en place.
 * @param {Float32Array|number[]} etat valeurs lissees precedentes (0..1)
 * @param {Float32Array|number[]} valeurs valeurs de l'image (0..1)
 * @returns {Float32Array|number[]|null} l'etat, ou null s'il est absent
 */
export function spectrumSmooth(etat, valeurs) {
  const state = etat && Number.isFinite(etat.length) && etat.length > 0 ? etat : null;
  if (!state) return null;
  const n = Math.min(SPECTRUM_ZONES, state.length);
  for (let k = 0; k < n; k++) {
    const mesure = valeurs ? clamp01(valeurs[k]) : 0;
    const precedent = clamp01(state[k]);
    const facteur = mesure > precedent ? SPECTRUM_RISE : SPECTRUM_FALL;
    state[k] = clamp01(precedent + (mesure - precedent) * facteur);
  }
  return state;
}

// ── Geometrie : angles et rayons des 32 zones (§5.2, §5.3) ──────────────────

/**
 * Angle de la zone k, en radians, mesure DEPUIS 12 HEURES dans le sens HORAIRE
 * (c'est l'angle utilise tel quel par `x = 108 + r sin a`, `y = 108 - r cos a`).
 * alpha(k) = PI + k x 2 PI / 32.
 * @param {number} k numero de zone (ramene modulo 32)
 * @returns {number} radians
 */
export function spectrumZoneAngle(k) {
  const zone = Number.isFinite(k)
    ? ((Math.trunc(k) % SPECTRUM_ZONES) + SPECTRUM_ZONES) % SPECTRUM_ZONES
    : 0;
  return Math.PI + (zone * 2 * Math.PI) / SPECTRUM_ZONES;
}

/**
 * Rayon d'une zone : r = 83 + 16 x v (§5.3, etape 6). PURE.
 * @param {number} valeur 0..1
 * @returns {number} pixels
 */
export function spectrumZoneRadius(valeur) {
  return SPECTRUM_RADIUS + SPECTRUM_AMPLITUDE * clamp01(valeur);
}

/**
 * Point de la zone k dans la boite 216 x 216 (§5.2). PURE.
 * @param {number} k numero de zone
 * @param {number} valeur 0..1
 * @returns {{x: number, y: number}}
 */
export function spectrumZonePoint(k, valeur) {
  const angle = spectrumZoneAngle(k);
  const r = spectrumZoneRadius(valeur);
  return {
    x: SPECTRUM_CENTER + r * Math.sin(angle),
    y: SPECTRUM_CENTER - r * Math.cos(angle),
  };
}

// ── Le chemin SVG (§5.4) ────────────────────────────────────────────────────

function zonesLues(valeurs) {
  if (!valeurs || !Number.isFinite(valeurs.length) || valeurs.length < SPECTRUM_ZONES) {
    return null;
  }
  const zones = new Array(SPECTRUM_ZONES);
  for (let k = 0; k < SPECTRUM_ZONES; k++) zones[k] = clamp01(valeurs[k]);
  return zones;
}

/**
 * Chemin SVG du contour, ou "" quand il n'y a rien a dessiner. PURE.
 *
 * Courbe FERMEE : 32 points, Catmull-Rom uniforme convertie en Bezier cubiques
 * avec indices modulo 32 (le segment 32 -> 1 est trace par la meme formule, donc
 * aucune couture), coordonnees arrondies a 0,1 px. AU SILENCE (max < 0,03) le
 * chemin est VIDE : le cercle reste net, rien n'est dessine.
 * @param {Float32Array|number[]} valeurs 32 valeurs 0..1
 * @returns {string} « M...C...Z », ou ""
 */
export function spectrumPath(valeurs) {
  const zones = zonesLues(valeurs);
  if (!zones) return "";
  let maximum = 0;
  for (let k = 0; k < SPECTRUM_ZONES; k++) {
    if (zones[k] > maximum) maximum = zones[k];
  }
  if (!(maximum >= SPECTRUM_SILENCE)) return "";

  const points = new Array(SPECTRUM_ZONES);
  for (let k = 0; k < SPECTRUM_ZONES; k++) points[k] = spectrumZonePoint(k, zones[k]);

  const n = SPECTRUM_ZONES;
  let d = `M${formatCoord(points[0].x)} ${formatCoord(points[0].y)}`;
  for (let k = 0; k < n; k++) {
    const p0 = points[(k - 1 + n) % n];
    const p1 = points[k];
    const p2 = points[(k + 1) % n];
    const p3 = points[(k + 2) % n];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d +=
      `C${formatCoord(c1x)} ${formatCoord(c1y)} ` +
      `${formatCoord(c2x)} ${formatCoord(c2y)} ` +
      `${formatCoord(p2.x)} ${formatCoord(p2.y)}`;
  }
  return `${d}Z`;
}

// ── L'UNIQUE decision d'affichage du contour (§11) ──────────────────────────
//
// « Un afficheur, une voix. Un etat, un mouvement. » Une seule fonction pure dit
// qui porte la parole, et JAMAIS deux afficheurs pour la meme voix :
//   - le CONTOUR porte la voix de Pilot quand elle est analysable ;
//   - l'ENVELOPPE de parole est son repli quand elle ne l'est pas (§7.3) ;
//   - la LUEUR interieure (halo d'ecoute) porte la voix de l'utilisateur, et
//     seulement en etat « ecoute » (§6.5) — donc jamais en meme temps.
// Le contrat du document (`{ dessiner, chemin }`) est rendu tel quel ; `lueur` et
// `porteur` sont ADDITIFS et ne changent rien au dessin du contour.

/**
 * Decision d'affichage du contour. PURE : aucun effet de bord, aucun DOM.
 * @param {{enParole?: boolean, reduit?: boolean, etat?: string,
 *   valeurs?: Float32Array|number[]}} [etats]
 * @returns {{dessiner: boolean, chemin: string, lueur: boolean,
 *   porteur: "contour"|"lueur"|"enveloppe"|""}}
 */
export function spectrumPlan(etats = {}) {
  const e = etats || {};
  const enParole = e.enParole === true || e.etat === "speaking";
  const reduit = e.reduit === true;
  const chemin = enParole && !reduit ? spectrumPath(e.valeurs) : "";
  const dessiner = chemin !== "";
  // Jamais les deux afficheurs a la fois : la lueur n'existe que si le contour
  // ne peint rien, et seulement dans l'unique etat ou une voix d'utilisateur
  // existe (mouvement reduit inclus : elle est alors figee a 0,55 par le CSS).
  const lueur = !dessiner && e.etat === "listening";
  let porteur = "";
  if (dessiner) porteur = "contour";
  else if (lueur) porteur = "lueur";
  else if (enParole) porteur = "enveloppe";
  return { dessiner, chemin, lueur, porteur };
}
