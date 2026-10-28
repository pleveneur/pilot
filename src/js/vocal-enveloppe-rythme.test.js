// Tests — LA VOIX DU SYSTEME FAIT AUSSI BOUGER L'ENVELOPPE (rythme de la phrase)
//
// CE QUE CE FICHIER VERROUILLE (et pourquoi) :
//   1. Le TEXTE LU est decoupe en unites de rythme : mots -> syllabes,
//      ponctuation -> pauses (courte / longue / paragraphe). Deux phrases de
//      longueurs differentes ne peuvent donc pas donner le meme mouvement.
//   2. Position de lecture + unites -> intensite 0..1 : une PAUSE de ponctuation
//      est au REPOS, le SILENCE avant / apres aussi, une syllabe accentuée est
//      plus forte. Aucun aleatoire : le meme texte donne toujours le meme
//      mouvement.
//   3. UNE SEULE source a la fois : `planSpeechEnvelopeSource` rend `son` quand
//      le son est mesurable, `rythme` sinon, jamais les deux. En mouvement
//      reduit, personne n'ecrit (l'enveloppe reste FIXE mais VISIBLE par le CSS).
//   4. Le metre du rythme a le MEME contrat que celui du son (demarrer /
//      arreter / image lissee / repos a l'arret), et il ne mesure aucun son.
//   5. Le branchement : `read-aloud.js` joint au texte lu le MOTEUR qui lit
//      (fait, pas consigne) ; `super-agent.js` arme le rythme pour la voix du
//      systeme et le taire des que la voix locale parle.
//
// Les commentaires sont en ASCII ; les valeurs lues sont importees du module ou
// copiees depuis la feuille de style.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  ENVELOPE_SOURCE_SOUND,
  ENVELOPE_SOURCE_RHYTHM,
  RHYTHM_ACCENT_FINAL,
  RHYTHM_PAUSE_LONG_MS,
  RHYTHM_PAUSE_PARAGRAPH_MS,
  RHYTHM_PAUSE_SHORT_MS,
  countSpeechSyllables,
  createSpeechRhythmMeter,
  planSpeechEnvelopeSource,
  rhythmIntensity,
  speechRhythmUnits,
} from "./vocal-enveloppe-aigu.js";
import { sliceFrom } from "./source-slice.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) => readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const CSS = lire("src/css/style.css");
const SUPER = lire("src/js/super-agent.js");
const MODULE = lire("src/js/vocal-enveloppe-aigu.js");
const LECTURE = lire("src/js/read-aloud.js");

/** Corps d'une fonction de super-agent (de son en-tete a son accolade fermante). */
function corpsFonction(src, entete) {
  const i = src.indexOf(entete);
  expect(i, `fonction absente : ${entete}`).toBeGreaterThan(-1);
  const fin = src.indexOf("\n  }", i);
  return src.slice(i, fin > -1 ? fin : undefined);
}

/** Courbe d'intensite echantillonnee toutes les `pas` ms sur `duree` ms. */
function courbe(texte, pas = 50, duree = 5000) {
  const { units } = speechRhythmUnits(texte);
  const valeurs = [];
  for (let t = 0; t <= duree; t += pas) valeurs.push(rhythmIntensity(units, t));
  return valeurs;
}

/** Fenetre minimale : une horloge manipulable et une file d'images. */
function fenetreFactice() {
  const etat = { t: 0, images: [], annulees: 0, suite: 0 };
  return {
    etat,
    win: {
      performance: { now: () => etat.t },
      requestAnimationFrame: (cb) => {
        etat.suite += 1;
        etat.images.push({ id: etat.suite, cb });
        return etat.suite;
      },
      cancelAnimationFrame: (id) => {
        etat.annulees += 1;
        const i = etat.images.findIndex((item) => item && item.id === id);
        if (i > -1) etat.images[i] = null;
      },
    },
  };
}

/** Fait tourner `n` images (en avancant l'horloge de `pas` ms a chaque fois). */
function images(fenetre, n, pas = 16) {
  for (let i = 0; i < n; i += 1) {
    fenetre.etat.t += pas;
    const item = fenetre.etat.images.shift();
    if (item) item.cb();
  }
}

// ---------------------------------------------------------------------------
describe("1. le decoupage du texte lu en unites de rythme", () => {
  it("un mot donne des syllabes, la ponctuation donne des pauses", () => {
    const plan = speechRhythmUnits("Bonjour, je lis.");
    expect(plan.units.length).toBeGreaterThan(4);
    // Le premier mot est decoupe en syllabes, pas en une seule unite.
    const avantVirgule = plan.units.filter((u) => u.at < RHYTHM_PAUSE_SHORT_MS);
    expect(avantVirgule.filter((u) => u.type === "syllabe").length).toBe(2);
    // La virgule produit une pause COURTE, le point final une pause LONGUE.
    const pauses = plan.units.filter((u) => u.type === "pause").map((u) => u.duration);
    expect(pauses).toContain(RHYTHM_PAUSE_SHORT_MS);
    expect(pauses).toContain(RHYTHM_PAUSE_LONG_MS);
  });

  it("les unites sont contigues : une position de lecture tombe toujours dedans", () => {
    const plan = speechRhythmUnits("Une phrase, puis une autre.\n\nEt un paragraphe.");
    let attendu = 0;
    for (const u of plan.units) {
      expect(u.at).toBe(attendu);
      expect(u.duration).toBeGreaterThan(0);
      attendu = u.at + u.duration;
    }
    expect(plan.total).toBe(attendu);
    // Une ligne vide (paragraphe) fait la pause la plus longue.
    expect(plan.units.map((u) => u.duration)).toContain(RHYTHM_PAUSE_PARAGRAPH_MS);
  });

  it("la derniere syllabe d'un mot est ACCENTUEE, les autres non", () => {
    // « voiture » : trois groupes de voyelles qui sont aussi trois syllabes
    // (voi-tu-re), pour que le compte soit verifiable a l'oreille.
    const { units } = speechRhythmUnits("voiture");
    expect(units.filter((u) => u.type === "syllabe").map((u) => u.accent)).toEqual([
      0.55,
      0.55,
      RHYTHM_ACCENT_FINAL,
    ]);
  });

  it("le nombre de syllabes est stable et jamais nul", () => {
    expect(countSpeechSyllables("bonjour")).toBe(2);
    expect(countSpeechSyllables("a")).toBe(1);
    expect(countSpeechSyllables("")).toBe(1);
    expect(countSpeechSyllables(null)).toBe(1);
    expect(countSpeechSyllables("ordinateur")).toBe(countSpeechSyllables("ordinateur"));
  });

  it("un texte vide ne produit AUCUNE unite", () => {
    expect(speechRhythmUnits("").units).toEqual([]);
    expect(speechRhythmUnits("   \n  ").units).toEqual([]);
    expect(speechRhythmUnits(null).total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("2. position de lecture + unites -> intensite", () => {
  it("deux textes de longueurs differentes donnent DEUX mouvements differents", () => {
    const court = courbe("Oui.");
    const long = courbe("Oui, je vous explique la chose simplement et sans detour.");
    expect(speechRhythmUnits("Oui.").total).not.toBe(
      speechRhythmUnits("Oui, je vous explique la chose simplement et sans detour.").total,
    );
    const ecart = court.some((v, i) => Math.abs(v - (long[i] || 0)) > 0.15);
    expect(ecart).toBe(true);
  });

  it("une pause de ponctuation est AU REPOS (aucune pulsation pendant le souffle)", () => {
    const plan = speechRhythmUnits("Bonjour, je lis une phrase.");
    const pause = plan.units.find((u) => u.type === "pause" && u.duration >= RHYTHM_PAUSE_SHORT_MS);
    expect(pause).toBeTruthy();
    for (let k = 0; k < pause.duration; k += 20) {
      expect(rhythmIntensity(plan.units, pause.at + k)).toBe(0);
    }
  });

  it("le silence AVANT et APRES la lecture est le repos", () => {
    const plan = speechRhythmUnits("Une phrase courte.");
    expect(rhythmIntensity(plan.units, -1)).toBe(0);
    expect(rhythmIntensity(plan.units, plan.total)).toBe(0);
    expect(rhythmIntensity(plan.units, plan.total + 5000)).toBe(0);
    expect(rhythmIntensity([], 100)).toBe(0);
    expect(rhythmIntensity(null, 100)).toBe(0);
  });

  it("l'intensite est bornee a 0..1 et jamais nulle au coeur d'une syllabe", () => {
    const plan = speechRhythmUnits("Voici une phrase avec plusieurs mots accentues.");
    for (const u of plan.units) {
      if (u.type !== "syllabe") continue;
      const v = rhythmIntensity(plan.units, u.at + u.duration / 2);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(v).toBeCloseTo(u.accent, 5);
    }
  });

  it("AUCUN aleatoire : le meme texte donne exactement le meme mouvement", () => {
    const texte = "Le meme texte, deux fois, doit bouger pareil.";
    expect(JSON.stringify(speechRhythmUnits(texte))).toBe(
      JSON.stringify(speechRhythmUnits(texte)),
    );
    expect(courbe(texte)).toEqual(courbe(texte));
    expect(MODULE).not.toMatch(/Math\.random/);
  });
});

// ---------------------------------------------------------------------------
describe("3. une seule source a la fois, jamais deux", () => {
  it("la mesure du son l'emporte, le rythme ne prend la place que sans mesure", () => {
    expect(planSpeechEnvelopeSource({ mesure: true, rythme: true })).toBe(ENVELOPE_SOURCE_SOUND);
    expect(planSpeechEnvelopeSource({ mesure: true })).toBe(ENVELOPE_SOURCE_SOUND);
    expect(planSpeechEnvelopeSource({ rythme: true })).toBe(ENVELOPE_SOURCE_RHYTHM);
    expect(planSpeechEnvelopeSource({})).toBe("");
    expect(planSpeechEnvelopeSource()).toBe("");
  });

  it("mouvement reduit ou contour peint : PERSONNE n'ecrit", () => {
    expect(planSpeechEnvelopeSource({ reduit: true, mesure: true })).toBe("");
    expect(planSpeechEnvelopeSource({ reduit: true, rythme: true })).toBe("");
    expect(planSpeechEnvelopeSource({ contourPeint: true, rythme: true })).toBe("");
  });

  it("l'ecran verifie le proprietaire avant d'ecrire, et tait l'autre source", () => {
    const corps = corpsFonction(SUPER, "function vocalApplyEnvelopeEnergy");
    expect(corps).toMatch(/planSpeechEnvelopeSource\(/);
    expect(corps).toMatch(/proprietaire !== source/);
    // La mesure reelle qui arrive fait taire le rythme : jamais les deux.
    expect(corps).toMatch(/vocalStopRhythmMeter\(\)/);
    // Deux call-sites, deux sources nommees (aucun appel sans source).
    expect(SUPER).toMatch(/vocalApplyEnvelopeEnergy\(energie, ENVELOPE_SOURCE_SOUND\)/);
    expect(SUPER).toMatch(/vocalApplyEnvelopeEnergy\(energie, ENVELOPE_SOURCE_RHYTHM\)/);
  });

  it("le rythme n'est arme QUE pour la voix du systeme", () => {
    const corps = corpsFonction(SUPER, "function vocalSyncEnvelopeSource");
    expect(corps).toMatch(/READ_ALOUD_ENGINE_SYSTEM/);
    expect(corps).toMatch(/vocalStartRhythmMeter\(infos\.text\)/);
    expect(corps).toMatch(/vocalStopRhythmMeter\(\)/);
    // Le moteur est un FAIT joint a l'etat par read-aloud.js.
    expect(LECTURE).toMatch(/export const READ_ALOUD_ENGINE_SYSTEM = "systeme"/);
    expect(LECTURE).toMatch(/export const READ_ALOUD_ENGINE_LOCAL = "local"/);
    expect(LECTURE).toMatch(/notify\("speaking", undefined, \{ text: spokenText, engine: moteur \}\)/);
    expect(LECTURE).toMatch(/engine: READ_ALOUD_ENGINE_SYSTEM/);
    expect(LECTURE).toMatch(/detail\.engine = String\(infos\.engine\)/);
  });
});

// ---------------------------------------------------------------------------
describe("4. le metre du rythme (meme contrat que le metre du son)", () => {
  it("il publie une intensite lissee, bornee, qui bouge avec la phrase", () => {
    const fenetre = fenetreFactice();
    const mesures = [];
    const metre = createSpeechRhythmMeter({
      win: fenetre.win,
      onEnergy: (e) => mesures.push(e),
    });
    expect(metre.demarrer("Bonjour, je lis une phrase un peu longue pour bouger.")).toBe(true);
    expect(metre.actif()).toBe(true);
    images(fenetre, 20, 30);
    expect(mesures.length).toBeGreaterThan(5);
    for (const v of mesures) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    // Le mouvement n'est pas constant : le texte le decide.
    expect(new Set(mesures.map((v) => v.toFixed(2))).size).toBeGreaterThan(1);
    expect(metre.position()).toBeGreaterThan(0);
    metre.arreter();
  });

  it("l'arret publie le repos et ne laisse AUCUNE image en attente", () => {
    const fenetre = fenetreFactice();
    const mesures = [];
    const metre = createSpeechRhythmMeter({
      win: fenetre.win,
      onEnergy: (e) => mesures.push(e),
    });
    metre.demarrer("Une phrase pour tourner quelques images.");
    images(fenetre, 5, 25);
    const avant = mesures.length;
    metre.arreter();
    expect(metre.actif()).toBe(false);
    expect(metre.mesure()).toBe(0);
    expect(mesures.length).toBe(avant + 1);
    expect(mesures[mesures.length - 1]).toBe(0);
    images(fenetre, 5);
    expect(mesures.length).toBe(avant + 1);
  });

  it("un texte vide n'arme RIEN (aucune image, aucune valeur)", () => {
    const fenetre = fenetreFactice();
    const mesures = [];
    const metre = createSpeechRhythmMeter({
      win: fenetre.win,
      onEnergy: (e) => mesures.push(e),
    });
    expect(metre.demarrer("   ")).toBe(false);
    expect(metre.actif()).toBe(false);
    expect(fenetre.etat.images.filter(Boolean).length).toBe(0);
    expect(mesures).toEqual([]);
  });

  it("le rythme ne mesure AUCUN son et ne touche ni au DOM ni au micro", () => {
    // Decoupage VERIFIE (`sliceFrom`) : ancre absente => le test ECHOUE au lieu
    // de passer sur un fragment vide (src/js/source-slice.js).
    const corps = sliceFrom(MODULE, "export function createSpeechRhythmMeter", 200);
    expect(corps).not.toMatch(/createAnalyser\(|createMediaElementSource\(/);
    expect(corps).not.toMatch(/getUserMedia\(|mediaDevices|speechSynthesis/);
    expect(corps).not.toMatch(/\bdocument\./);
    expect(corps).not.toMatch(/Math\.random/);
  });

  it("le mode Vocal arme et desarme le metre (entree / sortie du mode)", () => {
    const sortie = corpsFonction(SUPER, "function exitVocal");
    expect(sortie).toMatch(/vocalStopRhythmMeter\(\)/);
    expect(sortie).toMatch(/vocalClearEnvelope\(\)/);
    // L'etat de lecture est le SEUL signal utilise pour choisir la source.
    expect(SUPER).toMatch(/if \(vocalSpeaking\) vocalSyncEnvelopeSource\(detail\);/);
    expect(SUPER).toMatch(/else vocalStopRhythmMeter\(\);/);
  });
});

// ---------------------------------------------------------------------------
describe("5. mouvement reduit : fixe mais visible, et aucune valeur posee", () => {
  it("le CSS tient l'enveloppe a sa taille pleine, opacite 1, sans animation", () => {
    expect(CSS).toMatch(
      /\.pilot-vocal\.vocal-reduced\.vocal-state-speaking \.vocal-orb::before \{[^}]*opacity: 1;[^}]*animation: none;/s,
    );
  });

  it("le code n'arme pas le rythme en mouvement reduit (aucune valeur ecrite)", () => {
    const corps = corpsFonction(SUPER, "function vocalStartRhythmMeter");
    expect(corps).toMatch(/vocalReducedMotion\(\)/);
    expect(corps).toMatch(/vocalStopRhythmMeter\(\)/);
    expect(planSpeechEnvelopeSource({ reduit: true, rythme: true })).toBe("");
  });
});
