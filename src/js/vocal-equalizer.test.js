// Tests — LOT A « les maths, invisibles » du cercle-equaliseur
// (CONCEPTION-cercle-equaliseur.md, revision 4, §5, §11 ; lot A).
//
// CE QUE CE FICHIER VERROUILLE (et pourquoi) :
//   1. Un WAV de synthese ecrit A LA MAIN (en-tete RIFF, 16 bits, 22 050 Hz —
//      les chiffres du document) est relu correctement : taux, echantillons,
//      et ramene en mono. Aucune API audio, aucun fichier : que la chaine.
//   2. Les 32 bandes couvrent 200 Hz -> min(8000, 0,45 x taux), AUCUNE vide,
//      AUCUNE case comptee deux fois (decision 1 : 32 valeurs reellement
//      distinctes), et un son de 1 000 Hz sort bien dans SA bande.
//   3. Les 32 zones sont toutes differentes, a 11,25 deg l'une de l'autre,
//      dans le sens horaire depuis 6 heures (k = 0 a 6 h, k = 8 a 9 h,
//      k = 16 a 12 h) : aucun miroir, un seul tour.
//   4. Le chemin est FERME et sans un seul segment droit (Catmull-Rom ->
//      Bezier, indices modulo 32), arrondi a 0,1 px.
//   5. AU SILENCE le chemin est VIDE : le cercle reste net, rien n'est dessine.
//   6. Le lissage monte vite (0,5) et redescend doucement (0,12), sans aucun
//      lissage spatial, sans depassement, sans valeur hors de 0..1.
//   7. La decision d'affichage est UNE fonction pure, couvre les quatre etats
//      et le mouvement reduit, et ne montre JAMAIS deux afficheurs de la meme
//      voix (contour et lueur interieure jamais ensemble).
//   8. Le calcul par image n'alloue rien (cible fournie reutilisee), le module
//      n'importe rien et n'est branche nulle part : ce lot est invisible.
//
// Les commentaires sont en ASCII ; les chaines mesurees sont copiees telles
// quelles. Aucun decoupage de source non protege : `sliceSource` est utilise.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sliceSource } from "./source-slice.js";
import {
  SPECTRUM_ZONES,
  SPECTRUM_LOW_HZ,
  SPECTRUM_HIGH_HZ,
  SPECTRUM_FPS,
  SPECTRUM_FFT,
  SPECTRUM_FLOOR_DB,
  SPECTRUM_CEIL_DB,
  SPECTRUM_SILENCE,
  SPECTRUM_RADIUS,
  SPECTRUM_AMPLITUDE,
  SPECTRUM_BOX,
  SPECTRUM_CENTER,
  SPECTRUM_RISE,
  SPECTRUM_FALL,
  wavFromBase64,
  spectrumHighHz,
  spectrumBandBins,
  spectrumTimelineFromSamples,
  spectrumTimelineFromDataUrl,
  spectrumFrameInto,
  spectrumSmooth,
  spectrumZoneAngle,
  spectrumZoneRadius,
  spectrumZonePoint,
  spectrumPath,
  spectrumPlan,
} from "./vocal-equalizer.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const MODULE = readFileSync(join(ICI, "vocal-equalizer.js"), "utf8").replace(/\r\n/g, "\n");
const RATE = 22050; // le taux annonce par le document pour le WAV de synthese

// ── Outils de test : WAV ecrit a la main, base64 sans dependance DOM ────────

/** Construit un WAV PCM 16 bits (en-tete RIFF) a partir d'echantillons. */
function wavBytes({ sampleRate = RATE, samples, interleave, channels = 1 }) {
  const trames = interleave ? interleave.length / channels : samples.length;
  const tailleData = trames * channels * 2;
  const taille = 44 + tailleData;
  const octets = new Uint8Array(taille);
  const view = new DataView(octets.buffer);
  const tag = (offset, texte) => {
    for (let i = 0; i < 4; i++) view.setUint8(offset + i, texte.charCodeAt(i));
  };
  tag(0, "RIFF");
  view.setUint32(4, taille - 8, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, tailleData, true);
  let p = 44;
  for (let i = 0; i < trames; i++) {
    for (let c = 0; c < channels; c++) {
      // `interleave` sert au test des canaux multiples (une valeur par canal et
      // par trame) ; `samples` ecrit la meme valeur dans chaque canal.
      const brut = interleave ? interleave[i * channels + c] : samples[i];
      const valeur = Math.max(-1, Math.min(1, brut));
      view.setInt16(p, Math.round(valeur * 32767), true);
      p += 2;
    }
  }
  return octets;
}

function wavBase64(options) {
  return Buffer.from(wavBytes(options)).toString("base64");
}

/** Decodeur base64 minimal : prouve que le module ne depend d'aucun `atob` global. */
const atobStub = (b64) => Buffer.from(b64, "base64").toString("binary");

/** Sinusoide pure, pour placer une energie connue dans UNE bande. */
function sinusoide({ hz = 1000, amplitude = 1, secondes = 1, sampleRate = RATE } = {}) {
  const n = Math.round(sampleRate * secondes);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  }
  return out;
}

/** Decoupe un chemin « M x y C... Z » en points absolus + controles. */
function lireChemin(d) {
  const morceaux = d.split(/[MCZ]/).filter((s) => s.trim() !== "");
  const nombres = (s) => s.trim().split(/\s+/).map(Number);
  const premier = nombres(morceaux[0]);
  const points = [{ x: premier[0], y: premier[1] }];
  const segments = [];
  for (let i = 1; i < morceaux.length; i++) {
    const v = nombres(morceaux[i]);
    const depart = points[points.length - 1];
    const c1 = { x: v[0], y: v[1] };
    const c2 = { x: v[2], y: v[3] };
    const arrivee = { x: v[4], y: v[5] };
    segments.push({ depart, c1, c2, arrivee });
    points.push(arrivee);
  }
  return { points, segments };
}

const croix = (a, b) => a.x * b.y - a.y * b.x;

// ---------------------------------------------------------------------------
describe("1. le WAV en memoire est relu, sans aucune API audio", () => {
  it("lit le taux annonce et les echantillons ecrits a la main", () => {
    const voulus = [0, 0.5, -0.5, 0.25, 1, -1];
    const wav = wavFromBase64(wavBase64({ samples: voulus }), { atob: atobStub });
    expect(wav).not.toBeNull();
    expect(wav.sampleRate).toBe(22050);
    expect(wav.bitsPerSample).toBe(16);
    expect(wav.channels).toBe(1);
    expect(Array.from(wav.samples)).toHaveLength(voulus.length);
    voulus.forEach((v, i) => expect(wav.samples[i]).toBeCloseTo(v, 4));
  });

  it("accepte un data: URL et un taux different (16 000 Hz)", () => {
    const url = `data:audio/wav;base64,${wavBase64({
      sampleRate: 16000,
      samples: sinusoide({ hz: 500, sampleRate: 16000, secondes: 0.2 }),
    })}`;
    const wav = wavFromBase64(url, { atob: atobStub });
    expect(wav.sampleRate).toBe(16000);
    expect(wav.samples.length).toBe(3200);
  });

  it("ramene plusieurs canaux en mono par moyenne", () => {
    const wav = wavFromBase64(
      wavBase64({ interleave: [0.5, 0.5, -0.25, -0.75], channels: 2 }),
      { atob: atobStub },
    );
    expect(wav.channels).toBe(2);
    expect(wav.samples).toHaveLength(2);
    // Moyenne des deux canaux, jamais leur somme (qui doublerait le niveau).
    expect(wav.samples[0]).toBeCloseTo(0.5, 4);
    expect(wav.samples[1]).toBeCloseTo(-0.5, 4);
  });

  it("refuse ce qui n'est pas un WAV PCM 16 bits exploitable", () => {
    expect(wavFromBase64("", { atob: atobStub })).toBeNull();
    expect(wavFromBase64("pas du tout du base64 !!", { atob: atobStub })).toBeNull();
    expect(wavFromBase64("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", { atob: atobStub })).toBeNull();
    // Sans decodeur fourni ET sans `atob` global, le module ne devine rien.
    const sauvegarde = globalThis.atob;
    try {
      globalThis.atob = undefined;
      expect(wavFromBase64(wavBase64({ samples: [0] }))).toBeNull();
    } finally {
      globalThis.atob = sauvegarde;
    }
  });
});

// ---------------------------------------------------------------------------
describe("2. les 32 bandes : aucune vide, aucune case comptee deux fois", () => {
  it("le document decide de la borne haute, jamais une constante", () => {
    expect(spectrumHighHz(22050)).toBe(SPECTRUM_HIGH_HZ); // 8000 < 0,45 x 22050
    expect(spectrumHighHz(16000)).toBe(7200); // 0,45 x 16000 borne a 7200
    expect(spectrumHighHz(0)).toBe(0);
    expect(spectrumHighHz(Number.NaN)).toBe(0);
  });

  it("couvre 200 Hz -> borne haute, en 32 bandes contigues et non vides", () => {
    for (const taux of [22050, 16000]) {
      const bandes = spectrumBandBins(taux);
      expect(bandes).toHaveLength(SPECTRUM_ZONES);
      const binHz = taux / SPECTRUM_FFT;
      bandes.forEach((b, k) => {
        expect(b.end).toBeGreaterThanOrEqual(b.start);
        expect(b.start).toBeGreaterThanOrEqual(0);
        expect(b.end).toBeLessThanOrEqual(SPECTRUM_FFT / 2);
        if (k > 0) expect(b.start).toBe(bandes[k - 1].end + 1); // contigu
      });
      // La premiere bande commence a 200 Hz, la derniere s'arrete a la borne haute.
      expect(bandes[0].start).toBe(Math.round(SPECTRUM_LOW_HZ / binHz));
      expect(bandes[SPECTRUM_ZONES - 1].end).toBe(
        Math.round(spectrumHighHz(taux) / binHz) - 1,
      );
      // Aucune case n'est comptee deux fois : le total des cases vaut l'etendue.
      const total = bandes.reduce((n, b) => n + (b.end - b.start + 1), 0);
      expect(total).toBe(bandes[SPECTRUM_ZONES - 1].end - bandes[0].start + 1);
    }
  });

  it("un son de 1 000 Hz sort dans SA bande, pas dans les 31 autres", () => {
    const timeline = spectrumTimelineFromSamples(RATE, sinusoide({ hz: 1000 }));
    expect(timeline).not.toBeNull();
    expect(timeline.fps).toBe(SPECTRUM_FPS);
    expect(timeline.sampleRate).toBe(RATE);
    expect(timeline.highHz).toBe(SPECTRUM_HIGH_HZ);
    expect(timeline.bandBins).toHaveLength(SPECTRUM_ZONES);
    // 22 050 / 512 = 43,07 Hz par case : 1000 Hz tombe dans la case 23.
    const case1000 = Math.round(1000 / (RATE / SPECTRUM_FFT));
    const attendue = timeline.bandBins.findIndex(
      (b) => case1000 >= b.start && case1000 <= b.end,
    );
    expect(attendue).toBeGreaterThan(0);

    const image = new Float32Array(SPECTRUM_ZONES);
    spectrumFrameInto(timeline, 5, image);
    image.forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    });
    // Pleine echelle : la bande du son est au plafond de dessin.
    expect(image[attendue]).toBeGreaterThan(0.9);

    // A -40 dBFS, un seul maximum franc : celui de la bande du 1 000 Hz (une
    // pleine echelle sature aussi ses voisines, la fenetre de Hann etant large
    // devant des bandes de 2-3 cases a cet endroit du spectre).
    const doux = spectrumTimelineFromSamples(RATE, sinusoide({ hz: 1000, amplitude: 0.01 }));
    spectrumFrameInto(doux, 5, image);
    let forte = 0;
    for (let k = 1; k < SPECTRUM_ZONES; k++) if (image[k] > image[forte]) forte = k;
    expect(forte).toBe(attendue);
    expect(image[attendue]).toBeGreaterThan(0.5);
    // ... et les bandes lointaines ne sont pas reveillees pour autant.
    expect(image[0]).toBe(0);
    expect(image[SPECTRUM_ZONES - 1]).toBe(0);
  });

  it("une ligne de temps porte une image par 1/30 s", () => {
    const timeline = spectrumTimelineFromSamples(RATE, sinusoide({ secondes: 1 }));
    expect(timeline.count).toBe(Math.ceil(RATE / Math.round(RATE / SPECTRUM_FPS)));
    expect(timeline.bands).toHaveLength(timeline.count * SPECTRUM_ZONES);
    expect(spectrumTimelineFromSamples(RATE, new Float32Array(0))).toBeNull();
    expect(spectrumTimelineFromSamples(0, sinusoide({ secondes: 0.1 }))).toBeNull();
    expect(spectrumTimelineFromDataUrl("n'importe quoi", { atob: atobStub })).toBeNull();
  });

  it("les deux constantes de dessin sont celles du document", () => {
    expect(SPECTRUM_FLOOR_DB).toBe(-80);
    expect(SPECTRUM_CEIL_DB).toBe(-30);
    expect(SPECTRUM_CEIL_DB).toBeGreaterThan(SPECTRUM_FLOOR_DB);
    expect(SPECTRUM_FFT).toBe(512);
    expect(SPECTRUM_SILENCE).toBe(0.03);
    expect(SPECTRUM_RADIUS).toBe(83);
    expect(SPECTRUM_AMPLITUDE).toBe(16);
    expect(SPECTRUM_BOX).toBe(216);
    expect(SPECTRUM_CENTER).toBe(108);
    expect(SPECTRUM_RISE).toBe(0.5);
    expect(SPECTRUM_FALL).toBe(0.12);
  });
});

// ---------------------------------------------------------------------------
describe("3. 32 zones toutes differentes, un seul sens horaire", () => {
  it("11,25 deg par zone, depuis 6 heures", () => {
    const pas = (2 * Math.PI) / SPECTRUM_ZONES;
    expect(spectrumZoneAngle(1) - spectrumZoneAngle(0)).toBeCloseTo(pas, 9);
    expect(spectrumZoneAngle(0)).toBeCloseTo(Math.PI, 9); // 180 deg
    expect(spectrumZoneAngle(SPECTRUM_ZONES)).toBeCloseTo(Math.PI, 9); // modulo
    expect((spectrumZoneAngle(0) * 180) / Math.PI).toBeCloseTo(180, 6);
    expect((spectrumZoneAngle(8) * 180) / Math.PI).toBeCloseTo(270, 6);
    expect((spectrumZoneAngle(16) * 180) / Math.PI).toBeCloseTo(360, 6);
  });

  it("les reperes du document : k = 0 a 6 h, k = 8 a 9 h, k = 16 a 12 h", () => {
    const zero = spectrumZonePoint(0, 0);
    expect(zero.x).toBeCloseTo(108, 6);
    expect(zero.y).toBeCloseTo(191, 6); // 108 + 83
    const neuf = spectrumZonePoint(8, 0);
    expect(neuf.x).toBeCloseTo(25, 6); // 108 - 83
    expect(neuf.y).toBeCloseTo(108, 6);
    const midi = spectrumZonePoint(16, 0);
    expect(midi.x).toBeCloseTo(108, 6);
    expect(midi.y).toBeCloseTo(25, 6);
  });

  it("aucune zone n'en double une autre, et le rayon suit la valeur", () => {
    expect(spectrumZoneRadius(0)).toBe(SPECTRUM_RADIUS);
    expect(spectrumZoneRadius(1)).toBe(SPECTRUM_RADIUS + SPECTRUM_AMPLITUDE);
    expect(spectrumZoneRadius(Number.NaN)).toBe(SPECTRUM_RADIUS);
    expect(spectrumZoneRadius(5)).toBe(SPECTRUM_RADIUS + SPECTRUM_AMPLITUDE); // borne a 1
    expect(spectrumZoneRadius(2)).toBe(SPECTRUM_RADIUS + SPECTRUM_AMPLITUDE); // 2 -> 1
    const points = [];
    for (let k = 0; k < SPECTRUM_ZONES; k++) {
      points.push(spectrumZonePoint(k, 0.1 + (k % 11) * 0.08));
    }
    const uniques = new Set(points.map((p) => `${p.x.toFixed(3)}|${p.y.toFixed(3)}`));
    expect(uniques.size).toBe(SPECTRUM_ZONES);
    // Le plus haut rayon ne sort jamais de la boite (marge de 9 px).
    points.forEach((p) => {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(SPECTRUM_BOX);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(SPECTRUM_BOX);
    });
  });
});

// ---------------------------------------------------------------------------
describe("4. le chemin est ferme et n'a aucun segment droit", () => {
  const valeurs = Array.from({ length: SPECTRUM_ZONES }, (_, k) => 0.05 + (k % 7) * 0.1);
  const chemin = spectrumPath(valeurs);

  it("commence par M, porte 32 courbes C et se ferme par Z", () => {
    expect(chemin.startsWith("M")).toBe(true);
    expect(chemin.endsWith("Z")).toBe(true);
    expect(chemin.match(/C/g)).toHaveLength(SPECTRUM_ZONES);
    expect(chemin).not.toContain("L"); // aucun raccord droit dans la chaine
    expect(chemin.length).toBeGreaterThan(700); // ~0,9 Ko au document
    expect(chemin.length).toBeLessThan(1600);
  });

  it("se referme exactement sur son premier point (aucune couture)", () => {
    const { points } = lireChemin(chemin);
    expect(points).toHaveLength(SPECTRUM_ZONES + 1);
    const premier = points[0];
    const dernier = points[points.length - 1];
    expect(dernier.x).toBeCloseTo(premier.x, 6);
    expect(dernier.y).toBeCloseTo(premier.y, 6);
    // 32 points distincts : les 32 zones sont bien toutes differentes.
    const uniques = new Set(points.slice(0, SPECTRUM_ZONES).map((p) => `${p.x}|${p.y}`));
    expect(uniques.size).toBe(SPECTRUM_ZONES);
  });

  it("aucun segment n'est une droite : les controles sont hors de la corde", () => {
    const { segments } = lireChemin(chemin);
    expect(segments).toHaveLength(SPECTRUM_ZONES);
    segments.forEach((s) => {
      const corde = { x: s.arrivee.x - s.depart.x, y: s.arrivee.y - s.depart.y };
      const versC1 = { x: s.c1.x - s.depart.x, y: s.c1.y - s.depart.y };
      const versC2 = { x: s.c2.x - s.depart.x, y: s.c2.y - s.depart.y };
      // Une droite aurait un produit vectoriel nul : ici il vaut ~7 px^2.
      expect(Math.abs(croix(corde, versC1))).toBeGreaterThan(1);
      expect(Math.abs(croix(corde, versC2))).toBeGreaterThan(1);
    });
  });

  it("les coordonnees sont arrondies a 0,1 px", () => {
    const nombres = chemin.match(/-?\d+(?:\.\d+)?/g) || [];
    expect(nombres.length).toBeGreaterThan(100);
    nombres.forEach((n) => {
      const decimales = n.includes(".") ? n.split(".")[1].length : 0;
      expect(decimales).toBeLessThanOrEqual(1);
    });
  });
});

// ---------------------------------------------------------------------------
describe("5. au silence, rien n'est dessine", () => {
  it("le chemin est vide au silence exact et sous le seuil", () => {
    expect(spectrumPath(new Array(SPECTRUM_ZONES).fill(0))).toBe("");
    expect(spectrumPath(new Float32Array(SPECTRUM_ZONES))).toBe("");
    expect(spectrumPath(new Array(SPECTRUM_ZONES).fill(0.02))).toBe("");
    expect(spectrumPath(new Array(SPECTRUM_ZONES).fill(Number.NaN))).toBe("");
  });

  it("le seuil est bien 0,03 : juste en dessous rien, juste au-dessus le contour", () => {
    const dessous = new Array(SPECTRUM_ZONES).fill(0.029);
    const dessus = new Array(SPECTRUM_ZONES).fill(0.031);
    expect(spectrumPath(dessous)).toBe("");
    expect(spectrumPath(dessus)).not.toBe("");
    // Une seule zone au-dessus du seuil suffit (le maximum decide).
    const uneSeule = new Array(SPECTRUM_ZONES).fill(0);
    uneSeule[7] = 0.04;
    expect(spectrumPath(uneSeule)).not.toBe("");
    // Entree inutilisable : aucun chemin, jamais une exception.
    expect(spectrumPath(null)).toBe("");
    expect(spectrumPath([])).toBe("");
    expect(spectrumPath([1, 1, 1])).toBe("");
  });

  it("une ligne de temps silencieuse ne donne aucun chemin", () => {
    const timeline = spectrumTimelineFromSamples(RATE, new Float32Array(RATE / 4));
    const image = new Float32Array(SPECTRUM_ZONES);
    spectrumFrameInto(timeline, 0, image);
    expect(Array.from(image).every((v) => v === 0)).toBe(true);
    expect(spectrumPath(image)).toBe("");
  });
});

// ---------------------------------------------------------------------------
describe("6. le lissage monte vite et redescend doucement", () => {
  it("0,5 en montee et 0,12 en descente, sans depassement", () => {
    const etat = new Float32Array(SPECTRUM_ZONES);
    spectrumSmooth(etat, new Array(SPECTRUM_ZONES).fill(1));
    // Une image suffit a faire la moitie du chemin (attaque franche).
    etat.forEach((v) => expect(v).toBeCloseTo(0.5, 6));

    spectrumSmooth(etat, new Array(SPECTRUM_ZONES).fill(0));
    // Une seule image de silence ne fait retomber que de 12 % de la valeur.
    etat.forEach((v) => expect(v).toBeCloseTo(0.5 - 0.5 * 0.12, 6));
  });

  it("remonte en trois images, redescend lentement", () => {
    const monte = new Float32Array(SPECTRUM_ZONES);
    const plein = new Array(SPECTRUM_ZONES).fill(1);
    const suite = [];
    for (let i = 0; i < 3; i++) {
      spectrumSmooth(monte, plein);
      suite.push(monte[0]);
    }
    expect(suite[0]).toBeCloseTo(0.5, 6);
    expect(suite[2]).toBeCloseTo(0.875, 6); // 88 % du chemin en 3 images
    // La descente est plus lente : il faut bien plus de trois images.
    const descendant = new Float32Array(SPECTRUM_ZONES).fill(1);
    for (let i = 0; i < 3; i++) spectrumSmooth(descendant, new Array(SPECTRUM_ZONES).fill(0));
    expect(descendant[0]).toBeGreaterThan(0.6);
    expect(descendant[0]).toBeLessThan(0.7);
  });

  it("aucun lissage SPATIAL : une zone ne contamine pas ses voisines", () => {
    const etat = new Float32Array(SPECTRUM_ZONES);
    const image = new Array(SPECTRUM_ZONES).fill(0);
    image[10] = 1;
    spectrumSmooth(etat, image);
    expect(etat[10]).toBeCloseTo(0.5, 6);
    expect(etat[9]).toBe(0);
    expect(etat[11]).toBe(0);
  });

  it("reste toujours dans 0..1, meme avec des mesures aberrantes", () => {
    const etat = new Float32Array(SPECTRUM_ZONES);
    spectrumSmooth(etat, new Array(SPECTRUM_ZONES).fill(9));
    etat.forEach((v) => expect(v).toBeLessThanOrEqual(1));
    spectrumSmooth(etat, new Array(SPECTRUM_ZONES).fill(-9));
    etat.forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
    const sale = new Float32Array(SPECTRUM_ZONES);
    sale[0] = Number.NaN;
    sale[1] = Number.POSITIVE_INFINITY;
    spectrumSmooth(sale, new Array(SPECTRUM_ZONES).fill(Number.NaN));
    sale.forEach((v) => {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    });
    expect(spectrumSmooth(null, [1])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("7. la decision d'affichage : quatre etats, jamais deux afficheurs", () => {
  const fort = new Array(SPECTRUM_ZONES).fill(0.6);
  const silence = new Array(SPECTRUM_ZONES).fill(0);

  it("parole avec son analysable : le contour porte la voix de Pilot", () => {
    const plan = spectrumPlan({ etat: "speaking", enParole: true, valeurs: fort });
    expect(plan.dessiner).toBe(true);
    expect(plan.chemin).toBe(spectrumPath(fort));
    expect(plan.lueur).toBe(false);
    expect(plan.porteur).toBe("contour");
  });

  it("parole sans son analysable : l'enveloppe est le repli, contour retire", () => {
    const plan = spectrumPlan({ etat: "speaking", enParole: true, valeurs: silence });
    expect(plan.dessiner).toBe(false);
    expect(plan.chemin).toBe("");
    expect(plan.lueur).toBe(false);
    expect(plan.porteur).toBe("enveloppe");
  });

  it("ecoute : la lueur interieure porte la voix de l'utilisateur", () => {
    const plan = spectrumPlan({ etat: "listening" });
    expect(plan.dessiner).toBe(false);
    expect(plan.chemin).toBe("");
    expect(plan.lueur).toBe(true);
    expect(plan.porteur).toBe("lueur");
  });

  it("repos et reflexion : aucun afficheur de voix", () => {
    for (const etat of ["idle", "thinking"]) {
      const plan = spectrumPlan({ etat });
      expect(plan.dessiner).toBe(false);
      expect(plan.chemin).toBe("");
      expect(plan.lueur).toBe(false);
      expect(plan.porteur).toBe("");
    }
  });

  it("mouvement reduit : aucun contour, et la lueur reste (figee par le CSS)", () => {
    const parole = spectrumPlan({ etat: "speaking", enParole: true, valeurs: fort, reduit: true });
    expect(parole.dessiner).toBe(false);
    expect(parole.chemin).toBe("");
    expect(parole.porteur).toBe("enveloppe");
    const ecoute = spectrumPlan({ etat: "listening", reduit: true });
    expect(ecoute.lueur).toBe(true);
    expect(ecoute.porteur).toBe("lueur");
  });

  it("jamais les deux a la fois, quel que soit l'etat", () => {
    const etats = ["idle", "listening", "thinking", "speaking", "", undefined];
    for (const etat of etats) {
      for (const reduit of [false, true]) {
        for (const valeurs of [fort, silence]) {
          const plan = spectrumPlan({ etat, reduit, valeurs, enParole: etat === "speaking" });
          expect(plan.dessiner && plan.lueur).toBe(false);
          expect(plan.dessiner).toBe(plan.chemin !== "");
          if (plan.dessiner) expect(plan.porteur).toBe("contour");
          if (plan.lueur) expect(plan.porteur).toBe("lueur");
        }
      }
    }
    // Appel sans argument : au repos, rien n'est dessine, aucune exception.
    expect(spectrumPlan()).toEqual({ dessiner: false, chemin: "", lueur: false, porteur: "" });
  });
});

// ---------------------------------------------------------------------------
describe("8. calcul par image sans allocation, module pur et non branche", () => {
  it("reutilise la cible fournie, sans rien allouer", () => {
    const timeline = spectrumTimelineFromSamples(RATE, sinusoide({ secondes: 0.5 }));
    const cible = new Float32Array(SPECTRUM_ZONES);
    const rendue = spectrumFrameInto(timeline, 3, cible);
    expect(rendue).toBe(cible); // la MEME cible, pas une copie
    expect(spectrumFrameInto(timeline, 9999, cible)).toBe(cible); // index borne
    expect(spectrumFrameInto(timeline, -5, cible)).toBe(cible);
    expect(spectrumFrameInto(null, 0, cible)).toBe(cible); // silence sur
    expect(Array.from(cible).every((v) => v === 0)).toBe(true);
    expect(spectrumFrameInto(timeline, 0, null)).toBeNull();
    // La ligne de temps n'est jamais modifiee par la lecture d'une image.
    const avant = timeline.bands.slice(0, SPECTRUM_ZONES);
    spectrumFrameInto(timeline, 0, cible);
    expect(Array.from(timeline.bands.slice(0, SPECTRUM_ZONES))).toEqual(Array.from(avant));
  });

  it("le corps de la projection par image ne contient aucun `new`", () => {
    const corps = sliceSource(
      MODULE,
      "export function spectrumFrameInto(",
      "export function spectrumSmooth(",
      200,
    );
    expect(corps).not.toContain("new ");
    expect(corps).not.toContain(".slice(");
    expect(corps).not.toContain("Array.from");
  });

  it("le module est pur : aucun import, aucun acces au navigateur, au disque, au reseau", () => {
    expect(MODULE).not.toMatch(/^\s*import\s/m);
    expect(MODULE).not.toContain("require(");
    expect(MODULE).not.toContain("document.");
    expect(MODULE).not.toContain("window.");
    expect(MODULE).not.toContain("AudioContext");
    expect(MODULE).not.toContain("createMediaElementSource");
    expect(MODULE).not.toContain("getUserMedia");
    expect(MODULE).not.toContain("fetch(");
    expect(MODULE).not.toContain("localStorage");
    expect(MODULE).not.toContain("invoke(");
    expect(MODULE).not.toContain("setInterval");
    expect(MODULE).not.toContain("requestAnimationFrame");
    expect(MODULE).not.toContain("Date.now");
  });

  it("le lot A ne branche RIEN : aucun ecran ne connait ce module", () => {
    for (const fichier of [
      "super-agent.js",
      "read-aloud.js",
      "local-voice.js",
      "vocal-mic.js",
      "vocal-conversation.js",
    ]) {
      const source = readFileSync(join(ICI, fichier), "utf8");
      expect(source, `${fichier} ne doit pas importer le lot A`).not.toContain(
        "vocal-equalizer",
      );
    }
    const css = readFileSync(join(ICI, "..", "css", "style.css"), "utf8");
    expect(css).not.toContain("vocal-equalizer");
    expect(css).not.toContain("vocal-spectrum-path"); // le SVG est au lot C
  });
});
