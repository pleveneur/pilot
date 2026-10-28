// Tests — L'ENVELOPPE DE PAROLE SUIT LE SON REEL (demande du proprietaire)
//
// CE QUE CE FICHIER VERROUILLE (et pourquoi) :
//   1. L'energie qui pilote l'enveloppe est celle de la BANDE HAUTE de la voix
//      (>= 4 kHz, jusqu'au plafond d'analyse) : silence -> 0, aigu riche ->
//      fort, son grave -> 0. Sans cela, l'enveloppe suivrait le volume et non
//      la voix : un grondement ferait respirer la lumiere.
//   2. Le lissage est celui du projet (montee 0,5, retombee 0,12) : aucune
//      pulsation inventee au repos — le silence ramene l'enveloppe au repos.
//   3. L'extension est BORNEE : 18 px au repos, 32 px a pleine voix au-dela de
//      l'anneau, jamais plus (le CSS applique `scale`, donc 32 x scale).
//   4. Un seul afficheur par voix : des que le contour spectral peint
//      (`.vocal-spectrum-live`), l'enveloppe s'efface ; la regle CSS du contour
//      reste la DERNIERE de la famille.
//   5. Mouvement reduit : l'enveloppe est FIXE mais VISIBLE (pleine taille,
//      opacite 1), et le code ne pose aucune valeur.
//   6. Le branchement : UN analyseur, cree a l'entree du mode Vocal, monte sur
//      le SEUL son que Pilot joue lui-meme (voix locale), debranche a la sortie.
//      `super-agent.js` ne contient aucune API audio.
//
// Les commentaires sont en ASCII ; les selecteurs CSS et les nombres lus sont
// copies tels quels depuis la feuille de style.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sliceSource } from "./source-slice.js";
import {
  ENVELOPE_RING_PX,
  ENVELOPE_MIN_PX,
  ENVELOPE_MAX_PX,
  ENVELOPE_MIN_ALPHA,
  ENVELOPE_SILENCE,
  ENVELOPE_FFT,
  highBandBins,
  highBandEnergy,
  smoothEnvelopeEnergy,
  envelopeFromEnergy,
  planSpeechEnvelope,
  createSpeechEnvelopeMeter,
} from "./vocal-enveloppe-aigu.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) =>
  readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const CSS = lire("src/css/style.css");
const SUPER = lire("src/js/super-agent.js");
const MODULE = lire("src/js/vocal-enveloppe-aigu.js");
const VOIX = lire("src/js/local-voice.js");

/** Corps d'un bloc CSS `selecteur { ... }` (premiere occurrence, verifiee). */
function bloc(css, selecteur) {
  return sliceSource(css, selecteur, "}", 2);
}

/** Corps d'une fonction (de sa declaration a l'accolade fermante en colonne 3). */
function corpsFonction(src, entete) {
  const i = src.indexOf(entete);
  expect(i, `fonction absente : ${entete}`).toBeGreaterThan(-1);
  const fin = src.indexOf("\n  }", i);
  return src.slice(i, fin > -1 ? fin : undefined);
}

/** Une image d'analyseur : `bins` octets, remplis par `valeur(i)`. */
function image(bins, valeur) {
  const data = new Uint8Array(bins);
  for (let i = 0; i < bins; i++) data[i] = valeur(i);
  return data;
}

/** Remplit la bande HAUTE (celle que le module selectionne) avec `octet`. */
function imageAigu(bins, sampleRate, octet, bas = 0) {
  const { start, end } = highBandBins(sampleRate, bins);
  return image(bins, (i) => (i >= start && i <= end ? octet : bas));
}

const TAUX = 22050; // Piper : voix locale en 22,05 kHz
const BINS = ENVELOPE_FFT / 2; // frequencyBinCount d'un analyseur de 512

// ---------------------------------------------------------------------------
describe("1. la bande haute (>= 4 kHz) est la seule source de l'enveloppe", () => {
  it("la bande commence au-dessus de 4 kHz et s'arrete au plafond d'analyse", () => {
    const { start, end } = highBandBins(TAUX, BINS);
    const binHz = TAUX / (2 * BINS);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    // La premiere case est au-dessus de 4 kHz (a une case pres), la derniere
    // ne depasse pas 4,5 x taux (le plafond du projet : 8 kHz a 22,05 kHz).
    expect(start * binHz).toBeGreaterThanOrEqual(3900);
    expect(end * binHz).toBeLessThanOrEqual(8000);
  });

  it("la selection suit le TAUX d'echantillonnage (aucun indice en dur)", () => {
    // Un contexte a 48 kHz place les memes frequences sur d'autres cases : si
    // les indices etaient ecrits en dur, la bande mesuree ne serait plus la
    // meme selon la machine.
    const a = highBandBins(22050, BINS);
    const b = highBandBins(48000, BINS);
    expect(b.start).not.toBe(a.start);
    const binHzB = 48000 / (2 * BINS);
    expect(b.start * binHzB).toBeGreaterThanOrEqual(3900);
    expect(b.end * binHzB).toBeLessThanOrEqual(8000);
  });

  it("un taux ou un nombre de cases illisible ne mesure RIEN", () => {
    expect(highBandBins(0, BINS).end).toBeLessThan(highBandBins(0, BINS).start);
    expect(highBandBins(TAUX, 0).end).toBeLessThan(highBandBins(TAUX, 0).start);
    expect(highBandEnergy(null, TAUX)).toBe(0);
    expect(highBandEnergy([], 0)).toBe(0);
    expect(highBandEnergy(new Uint8Array(0), TAUX)).toBe(0);
  });

  it("silence -> 0 : rien n'est invente au repos", () => {
    expect(highBandEnergy(image(BINS, () => 0), TAUX)).toBe(0);
    // Un souffle sous le plancher de silence reste du silence.
    expect(highBandEnergy(image(BINS, () => 1), TAUX)).toBe(0);
    expect(ENVELOPE_SILENCE).toBeGreaterThan(0);
  });

  it("aigu riche -> fort (proche du maximum)", () => {
    const energie = highBandEnergy(imageAigu(BINS, TAUX, 255), TAUX);
    expect(energie).toBeGreaterThan(0.9);
    expect(energie).toBeLessThanOrEqual(1);
  });

  it("son GRAVE -> quasi rien : l'enveloppe ne suit pas le volume", () => {
    // Basses pleines, bande haute vide : c'est un grondement, pas une voix.
    const { start } = highBandBins(TAUX, BINS);
    const grave = image(BINS, (i) => (i < start ? 255 : 0));
    expect(highBandEnergy(grave, TAUX)).toBe(0);
  });

  it("aigu faible -> valeur intermediaire, et la mesure est monotone", () => {
    const faible = highBandEnergy(imageAigu(BINS, TAUX, 40), TAUX);
    const moyen = highBandEnergy(imageAigu(BINS, TAUX, 100), TAUX);
    const fort = highBandEnergy(imageAigu(BINS, TAUX, 255), TAUX);
    expect(faible).toBeGreaterThan(0);
    expect(faible).toBeLessThan(moyen);
    expect(moyen).toBeLessThan(fort);
    expect(faible).toBeLessThan(0.5);
  });

  it("les octets aberrants sont ignores, jamais propages", () => {
    const sale = imageAigu(BINS, TAUX, 255);
    sale[highBandBins(TAUX, BINS).start] = NaN;
    sale[highBandBins(TAUX, BINS).start + 1] = -5;
    sale[highBandBins(TAUX, BINS).start + 2] = 900;
    const energie = highBandEnergy(sale, TAUX);
    expect(Number.isFinite(energie)).toBe(true);
    expect(energie).toBeGreaterThan(0.9);
  });
});

// ---------------------------------------------------------------------------
describe("2. lissage : montee rapide, retombee lente, jamais d'oscillation", () => {
  it("la montee est plus rapide que la retombee", () => {
    const montee = smoothEnvelopeEnergy(0, 1);
    const retombee = 1 - smoothEnvelopeEnergy(1, 0);
    expect(montee).toBeCloseTo(0.5, 5);
    expect(retombee).toBeCloseTo(0.12, 5);
    expect(montee).toBeGreaterThan(retombee);
  });

  it("la valeur reste bornee a 0..1, meme avec des entrees folles", () => {
    expect(smoothEnvelopeEnergy(-3, 4)).toBeCloseTo(0.5, 5);
    expect(smoothEnvelopeEnergy(Number.NaN, Number.NaN)).toBe(0);
    expect(smoothEnvelopeEnergy(0.5, 2)).toBeGreaterThan(0.5);
    expect(smoothEnvelopeEnergy(0.5, -2)).toBeLessThan(0.5);
  });

  it("le silence RAMENE au repos au lieu de faire pulser", () => {
    // Une voix qui se tait ne doit pas laisser une lumiere qui respire toute
    // seule : la suite de mesures nulles retombe vers 0, sans jamais remonter.
    let energie = 1;
    const suite = [];
    for (let i = 0; i < 40; i++) {
      energie = smoothEnvelopeEnergy(energie, 0);
      suite.push(energie);
    }
    for (let i = 1; i < suite.length; i++) {
      expect(suite[i]).toBeLessThan(suite[i - 1]);
    }
    expect(suite[suite.length - 1]).toBeLessThan(0.01);
  });
});

// ---------------------------------------------------------------------------
describe("3. extension bornee a ~32 px au-dela de l'anneau", () => {
  it("au repos : 18 px, la lueur ne s'eteint pas (alpha 0,8)", () => {
    const halo = envelopeFromEnergy(0);
    expect(halo.extension).toBe(ENVELOPE_MIN_PX);
    // Le facteur porte sur la boite ENTIERE (centre -> 116 px), pas sur les
    // 32 px d'extension : c'est ce qui garde le bord de la couronne a
    // 84 + 18 = 102 px au lieu de le ramener sous l'anneau.
    expect(halo.scale).toBeCloseTo((ENVELOPE_RING_PX + ENVELOPE_MIN_PX) / (ENVELOPE_RING_PX + ENVELOPE_MAX_PX), 3);
    expect(halo.scale).toBeCloseTo(0.8793, 3);
    // La couronne mesure donc EXACTEMENT l'extension annoncee.
    const rayonCss = (ENVELOPE_RING_PX + ENVELOPE_MAX_PX) * halo.scale;
    expect(rayonCss - ENVELOPE_RING_PX).toBeCloseTo(halo.extension, 0);
    expect(halo.alpha).toBe(ENVELOPE_MIN_ALPHA);
    expect(halo.alpha).toBe(0.8);
  });

  it("a pleine voix : 32 px, opacite pleine", () => {
    const halo = envelopeFromEnergy(1);
    expect(halo.extension).toBe(ENVELOPE_MAX_PX);
    expect(halo.extension).toBe(32);
    expect(halo.scale).toBe(1);
    expect(halo.alpha).toBe(1);
  });

  it("aucune valeur ne depasse le maximum, quelle que soit l'entree", () => {
    for (const e of [-1, 0, 0.1, 0.37, 0.5, 0.99, 1, 3, Number.NaN]) {
      const halo = envelopeFromEnergy(e);
      expect(halo.scale).toBeLessThanOrEqual(1);
      expect(halo.scale).toBeGreaterThanOrEqual(ENVELOPE_MIN_PX / ENVELOPE_MAX_PX);
      expect(halo.extension).toBeLessThanOrEqual(ENVELOPE_MAX_PX);
      expect(halo.extension).toBeGreaterThanOrEqual(ENVELOPE_MIN_PX);
      // L'extension affichee EST l'echelle : une seule verite, et la couronne
      // peinte fait bien 18 a 32 px au-dela de l'anneau de 84 px.
      const couronne = (ENVELOPE_RING_PX + ENVELOPE_MAX_PX) * halo.scale - ENVELOPE_RING_PX;
      expect(couronne).toBeCloseTo(halo.extension, 0);
      expect(couronne).toBeGreaterThanOrEqual(17.5);
      expect(couronne).toBeLessThanOrEqual(32.5);
      expect(halo.alpha).toBeGreaterThanOrEqual(ENVELOPE_MIN_ALPHA);
      expect(halo.alpha).toBeLessThanOrEqual(1);
    }
  });

  it("l'ecart du disque a la ligne d'etat laisse la place a ces 32 px", () => {
    // 32 px d'extension + 32 px d'ecart : le texte ne passe jamais dessous.
    expect(bloc(CSS, ".vocal-stage")).toMatch(/gap:\s*32px/);
    // La boite de l'enveloppe deborde de 32 px de l'anneau (168 + 2 x 32).
    expect(bloc(CSS, ".vocal-orb::before {")).toMatch(/inset:\s*-32px/);
  });
});

// ---------------------------------------------------------------------------
describe("4. un seul afficheur par voix (jamais deux)", () => {
  it("la decision pure refuse la mesure quand le contour peint deja", () => {
    expect(
      planSpeechEnvelope({ energy: 1, disponible: true, contourPeint: true }).live,
    ).toBe(false);
    expect(planSpeechEnvelope({ energy: 1, disponible: true }).live).toBe(true);
  });

  it("sans mesure disponible, l'enveloppe garde son repli (rien n'est pose)", () => {
    // Voix du SYSTEME : aucun flux audio accessible -> `disponible` faux.
    const plan = planSpeechEnvelope({ energy: 1, disponible: false });
    expect(plan.live).toBe(false);
    expect(plan.extension).toBe(ENVELOPE_MIN_PX);
  });

  it("en mouvement reduit, le code ne pose AUCUNE valeur", () => {
    const plan = planSpeechEnvelope({ energy: 1, reduit: true, disponible: true });
    expect(plan.live).toBe(false);
  });

  it("le CSS : la regle du contour reste la DERNIERE de la famille", () => {
    const directe = CSS.indexOf(".pilot-vocal.vocal-envelope-live.vocal-state-speaking");
    const contour = CSS.indexOf(".pilot-vocal.vocal-spectrum-live.vocal-state-speaking");
    const reduit = CSS.indexOf(".pilot-vocal.vocal-reduced.vocal-state-speaking .vocal-orb::before");
    expect(directe).toBeGreaterThan(-1);
    expect(contour).toBeGreaterThan(directe);
    expect(reduit).toBeGreaterThan(directe);
    expect(
      bloc(CSS, ".pilot-vocal.vocal-spectrum-live.vocal-state-speaking .vocal-orb::before"),
    ).toMatch(/opacity:\s*0/);
  });
});

// ---------------------------------------------------------------------------
describe("5. mouvement reduit : fixe mais visible (jamais eteint)", () => {
  it("le CSS garde la pleine taille et l'opacite 1, sans animation", () => {
    const corps = bloc(
      CSS,
      ".pilot-vocal.vocal-reduced.vocal-state-speaking .vocal-orb::before",
    );
    expect(corps).toMatch(/opacity:\s*1/);
    expect(corps).toMatch(/animation:\s*none/);
    // Aucun `transform` : la boite de 232 px est deja a son extension pleine.
    expect(corps).not.toMatch(/transform/);
  });

  it("la regle qui mesure l'enveloppe pose une animation nulle", () => {
    const corps = bloc(
      CSS,
      ".pilot-vocal.vocal-envelope-live.vocal-state-speaking .vocal-orb::before",
    );
    expect(corps).toMatch(/animation:\s*none/);
    expect(corps).toMatch(/transition:\s*none/);
    expect(corps).toMatch(/opacity:\s*var\(--vocal-envelope-alpha, 1\)/);
    expect(corps).toMatch(/transform:\s*scale\(var\(--vocal-envelope-scale/);
  });
});

// ---------------------------------------------------------------------------
describe("6. le branchement : un analyseur, sur le seul son que Pilot joue", () => {
  /** Fenetre simulee : un contexte audio factice, pilote image par image. */
  function fauxWindow(octet = 255) {
    const etat = { images: [], annulees: 0, sources: 0, contexte: null, contextes: 0, fermes: 0 };
    let suite = 0;
    class FauxAnalyser {
      constructor() {
        this.fftSize = 0;
        this.smoothingTimeConstant = 1;
        this.minDecibels = 0;
        this.maxDecibels = 0;
        this.destination = null;
        this.frequencyBinCount = BINS;
      }
      connect(destination) {
        this.destination = destination;
      }
      getByteFrequencyData(data) {
        const { start, end } = highBandBins(22050, data.length);
        for (let i = 0; i < data.length; i++) {
          data[i] = i >= start && i <= end ? octet : 0;
        }
      }
    }
    class FauxContexte {
      constructor() {
        this.sampleRate = 22050;
        this.state = "running";
        this.destination = { nom: "enceinte" };
        this.analyser = null;
        etat.contexte = this;
        etat.contextes += 1;
      }
      close() {
        etat.fermes += 1;
        this.state = "closed";
        return Promise.resolve();
      }
      createAnalyser() {
        this.analyser = new FauxAnalyser();
        return this.analyser;
      }
      createMediaElementSource(element) {
        etat.sources += 1;
        return {
          element,
          connect: () => {},
          disconnect: () => {},
        };
      }
      async resume() {}
    }
    return {
      etat,
      AudioContext: FauxContexte,
      requestAnimationFrame: (cb) => {
        suite += 1;
        etat.images.push({ id: suite, cb });
        return suite;
      },
      cancelAnimationFrame: (id) => {
        etat.annulees += 1;
        const i = etat.images.findIndex((item) => item.id === id);
        if (i > -1) etat.images[i] = null;
      },
      setTimeout: (cb) => {
        suite += 1;
        etat.images.push({ id: suite, cb });
        return suite;
      },
      clearTimeout: (id) => {
        etat.annulees += 1;
        const i = etat.images.findIndex((item) => item.id === id);
        if (i > -1) etat.images[i] = null;
      },
    };
  }

  /** Fait tourner `n` images du metre. */
  function images(win, n) {
    for (let i = 0; i < n; i++) {
      const item = win.etat.images.shift();
      if (item) item.cb();
    }
  }

  function fauxElement() {
    return {
      paused: false,
      ended: false,
      ecouteurs: {},
      addEventListener(type, fn) {
        this.ecouteurs[type] = fn;
      },
    };
  }

  it("il mesure le son REELLEMENT joue (et publie l'energie lissee)", async () => {
    const win = fauxWindow();
    const mesures = [];
    const metre = createSpeechEnvelopeMeter({
      win,
      onEnergy: (e) => mesures.push(e),
    });
    metre.demarrer();
    expect(metre.actif()).toBe(true);
    const element = fauxElement();
    const attache = await metre.attacher(element);
    expect(attache).toBe(true);
    expect(win.etat.contexte.analyser.fftSize).toBe(ENVELOPE_FFT);
    // Le lissage est celui du module : l'analyseur ne lisse pas deux fois.
    expect(win.etat.contexte.analyser.smoothingTimeConstant).toBe(0);
    images(win, 6);
    expect(mesures.length).toBeGreaterThan(2);
    expect(mesures[0]).toBeGreaterThan(0);
    expect(mesures[mesures.length - 1]).toBeGreaterThan(mesures[0]);
    expect(metre.mesure()).toBeGreaterThan(0.5);
  });

  it("quand le son s'arrete, il publie 0 et ne tourne plus (aucune pulsation)", async () => {
    const win = fauxWindow();
    const mesures = [];
    const metre = createSpeechEnvelopeMeter({ win, onEnergy: (e) => mesures.push(e) });
    metre.demarrer();
    const element = fauxElement();
    await metre.attacher(element);
    images(win, 4);
    expect(mesures[mesures.length - 1]).toBeGreaterThan(0);
    const avant = mesures.length;
    element.ecouteurs.ended(); // le morceau est fini
    expect(mesures.length).toBe(avant + 1);
    expect(mesures[mesures.length - 1]).toBe(0);
    images(win, 3); // plus aucune image en attente
    expect(mesures.length).toBe(avant + 1);
  });

  it("la sortie du mode debranche TOUT (metre inactif, plus de boucle)", async () => {
    const win = fauxWindow();
    const metre = createSpeechEnvelopeMeter({ win, onEnergy: () => {} });
    metre.demarrer();
    await metre.attacher(fauxElement());
    images(win, 2);
    const restantesAvant = win.etat.images.filter(Boolean).length;
    expect(restantesAvant).toBeGreaterThan(0);
    metre.arreter();
    expect(metre.actif()).toBe(false);
    expect(metre.mesure()).toBe(0);
    const restantes = win.etat.images.filter(Boolean).length;
    expect(restantes).toBe(0);
    // Le contexte audio est REFERME : une poignee de contextes par onglet,
    // entrer et sortir du mode dix fois ne doit pas les epuiser.
    expect(win.etat.fermes).toBe(1);
    // Apres l'arret, un nouvel element n'est plus mesure du tout.
    expect(await metre.attacher(fauxElement())).toBe(false);
  });

  it("une nouvelle entree dans le mode repart d'un contexte NEUF", async () => {
    const win = fauxWindow();
    const premier = createSpeechEnvelopeMeter({ win, onEnergy: () => {} });
    premier.demarrer();
    await premier.attacher(fauxElement());
    premier.arreter();
    const second = createSpeechEnvelopeMeter({ win, onEnergy: () => {} });
    second.demarrer();
    expect(await second.attacher(fauxElement())).toBe(true);
    expect(win.etat.contextes).toBe(2);
    second.arreter();
  });

  it("sans contexte audio, il ne touche PAS au son (aucune voix rendue muette)", async () => {
    const metre = createSpeechEnvelopeMeter({ win: {}, onEnergy: () => {} });
    metre.demarrer();
    expect(await metre.attacher(fauxElement())).toBe(false);
    metre.arreter();
  });

  it("un contexte suspendu qui refuse de repartir -> aucune mesure", async () => {
    const win = fauxWindow();
    class Suspendu extends win.AudioContext {
      constructor() {
        super();
        this.state = "suspended";
      }
      async resume() {
        throw new Error("refus");
      }
    }
    const metre = createSpeechEnvelopeMeter({
      win: { ...win, AudioContext: Suspendu },
      onEnergy: () => {},
    });
    metre.demarrer();
    expect(await metre.attacher(fauxElement())).toBe(false);
    metre.arreter();
  });

  it("le module ne touche NI au DOM NI au micro (decisions pures)", () => {
    expect(MODULE).not.toMatch(/\bdocument\./);
    expect(MODULE).not.toMatch(/getUserMedia\(|mediaDevices|SpeechSynthesisUtterance/);
    // Un seul analyseur, un seul element source : aucune seconde mesure.
    expect((MODULE.match(/createAnalyser\(/g) || []).length).toBe(1);
    expect((MODULE.match(/createMediaElementSource\(/g) || []).length).toBe(1);
  });

  it("local-voice.js tend son element audio, sans savoir qui l'ecoute", () => {
    expect(VOIX).toMatch(/export function setLocalVoiceAudioTap\(fn\)/);
    // Un seul point de branchement, a la CREATION de l'element audio.
    expect((VOIX.match(/if \(audioTap\) \{/g) || []).length).toBe(1);
    expect(VOIX).toMatch(/const tap = audioTap;/);
    expect(VOIX).toMatch(/tap\(audio\)/);
    // Un espion asynchrone ne fait jamais echouer une lecture.
    expect(VOIX).toMatch(/suite\.catch\(\(\) => \{\}\)/);
  });

  it("super-agent.js : le metre vit avec le mode Vocal (entree / sortie)", () => {
    const entree = corpsFonction(SUPER, "function enterVocal");
    expect(entree).toMatch(/createSpeechEnvelopeMeter\(/);
    expect(entree).toMatch(/vocalEnvelopeMeter\.demarrer\(\)/);
    const sortie = corpsFonction(SUPER, "function exitVocal");
    expect(sortie).toMatch(/vocalEnvelopeMeter\.arreter\(\)/);
    expect(sortie).toMatch(/vocalClearEnvelope\(\)/);
    // Aucune API audio dans l'ecran : tout vit dans le module.
    expect(SUPER).not.toMatch(/AudioContext|AnalyserNode|createMediaElementSource/);
  });

  it("l'ecran ne pose que deux variables et une classe (aucun noeud cree)", () => {
    const corps = corpsFonction(SUPER, "function vocalApplyEnvelopeEnergy");
    expect(corps).toMatch(/planSpeechEnvelope\(/);
    expect(corps).toMatch(/--vocal-envelope-scale/);
    expect(corps).toMatch(/--vocal-envelope-alpha/);
    expect(corps).toMatch(/vocal-envelope-live/);
    expect(corps).not.toMatch(/createElement|innerHTML|appendChild/);
  });
});
