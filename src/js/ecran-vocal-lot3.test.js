// Tests — LOT 3 : le NIVEAU DU MICRO du mode Vocal
// (RAPPORT-trois-modes-ecran-vocal.md, section « Lot 3 »).
//
// CE QUE CE FICHIER VERROUILLE (et pourquoi) :
//   1. Le lissage et la longueur du trait sont PURS et MESURES : montee rapide,
//      descente lente (aucun sautillement), 8 % au silence, jamais une valeur
//      inventee.
//   2. La permission part au PREMIER GESTE, jamais a l'entree du mode, et un
//      refus ne se represente pas tout seul.
//   3. Une panne (refus, absence, occupation, peripherique retire) donne un
//      message CLAIR et laisse le mode entierement utilisable : aucun blocage.
//   4. Le flux est REELLEMENT arrete a la sortie du mode : pistes `stop()`,
//      contexte audio ferme, boucle de mesure annulee — pas seulement ignore.
//   5. Un seul mecanisme : les API micro vivent dans vocal-mic.js, jamais dans
//      super-agent.js ; aucune reconnaissance de parole n'y entre.
//   6. Le micro ne tient AUCUN lecteur : depuis le lot 4a il signale une prise
//      de parole (`onSpeechStart`), le niveau continue de ne servir qu'a la
//      longueur du trait, et l'arret de la lecture vit dans super-agent.js.
//   7. En mouvement reduit, la longueur reste figee par etat : aucune valeur
//      n'est posee (sinon elle ecraserait la regle CSS figee).
//
// Les commentaires sont en ASCII ; les chaines qui viennent de l'interface
// (messages affiches, selecteurs CSS) sont copiees telles quelles.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sliceSource } from "./source-slice.js";
import {
  createVocalMic,
  micFailureMessage,
  smoothLevel,
  levelToWidth,
  planLevel,
  shouldAskVocalMic,
  rmsOf,
  MIC_FERME,
  MIC_ABSENT,
  MIC_OCCUPE,
  LEVEL_MIN_PCT,
  LEVEL_MAX_PCT,
} from "./vocal-mic.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) =>
  readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const CSS = lire("src/css/style.css");
const SUPER = lire("src/js/super-agent.js");
const MIC = lire("src/js/vocal-mic.js");
const README = lire("README.md");

/** Corps d'une fonction du module (jusqu'a la premiere accolade en colonne 3). */
function corpsFonction(src, entete) {
  const i = src.indexOf(entete);
  expect(i, `fonction absente : ${entete}`).toBeGreaterThan(-1);
  const fin = src.indexOf("\n  }", i);
  return src.slice(i, fin > -1 ? fin : undefined);
}

/**
 * Faux micro : un flux dont les pistes enregistrent leur arret, un contexte
 * audio qui note sa fermeture, et un analyseur qui rend les mesures fournies.
 * Aucune fenetre n'est necessaire : le moteur accepte tout cela en injection.
 */
function fauxMicro(mesures = [0.2, 0.4]) {
  const journal = { stops: [], closes: 0, demandes: 0, raf: 0, annulees: 0, pistes: [] };
  let i = 0;
  const piste = {
    kind: "audio",
    readyState: "live",
    stopped: false,
    listeners: {},
    stop() {
      this.stopped = true;
      this.readyState = "ended";
      journal.stops.push(this);
      // Le navigateur emet `ended` sur un arret : le moteur ne doit PAS le
      // prendre pour une panne quand c'est NOUS qui arretons.
      (this.listeners.ended || []).forEach((f) => f());
    },
    addEventListener(nom, f) {
      this.listeners[nom] = this.listeners[nom] || [];
      this.listeners[nom].push(f);
    },
  };
  journal.pistes.push(piste);
  const flux = { getTracks: () => [piste] };
  const analyseur = {
    fftSize: 1024,
    smoothingTimeConstant: 0,
    getFloatTimeDomainData(tampon) {
      const mesure = mesures[Math.min(i, mesures.length - 1)];
      i += 1;
      for (let k = 0; k < tampon.length; k += 1) tampon[k] = mesure;
    },
  };
  const contexte = {
    state: "running",
    createMediaStreamSource: () => ({ connect() {} }),
    createAnalyser: () => analyseur,
    close() {
      journal.closes += 1;
      return Promise.resolve();
    },
  };
  const navigatorFaux = {
    mediaDevices: {
      getUserMedia(constraintes) {
        journal.demandes += 1;
        journal.contraintes = constraintes;
        return Promise.resolve(flux);
      },
    },
  };
  // `requestAnimationFrame` SYNCHRONE est impossible (boucle infinie) : on
  // collecte les rappels et on les declenche a la main, image par image. Les
  // identifiants valent 1 + l'indice dans `images`, ce qui rend
  // `cancelAnimationFrame` fidele au navigateur (le rappel annule disparait).
  const images = [];
  const options = {
    navigator: navigatorFaux,
    AudioContext: function AudioContextFaux() {
      return contexte;
    },
    requestAnimationFrame(cb) {
      journal.raf += 1;
      images.push(cb);
      return images.length;
    },
    cancelAnimationFrame(id) {
      journal.annulees += 1;
      if (id >= 1 && id <= images.length) images[id - 1] = null;
    },
  };
  /** Joue `n` images de mesure (dans l'ordre des rappels en attente). */
  function jouer(n = 1) {
    let jouees = 0;
    while (jouees < n) {
      const idx = images.findIndex((c) => typeof c === "function");
      if (idx === -1) return;
      const cb = images[idx];
      images[idx] = null;
      jouees += 1;
      cb();
    }
  }
  /** Nombre d'images encore en attente (0 = plus aucune mesure en vol). */
  const restantes = () => images.filter((c) => typeof c === "function").length;
  return { journal, piste, flux, options, jouer, images, restantes };
}

// ---------------------------------------------------------------------------
describe("1. le niveau est MESURE puis lisse (aucun sautillement)", () => {
  it("la montee est plus rapide que la descente", () => {
    const monte = smoothLevel(0, 1);
    const descend = 1 - smoothLevel(1, 0);
    expect(monte).toBeGreaterThan(0.3);
    expect(descend).toBeLessThan(monte);
  });

  it("deux mesures identiques ne font pas sauter la valeur", () => {
    let n = 0;
    for (let k = 0; k < 30; k += 1) n = smoothLevel(n, 0.25);
    // Convergence douce et bornee (jamais de depassement).
    expect(n).toBeGreaterThan(0.24);
    expect(n).toBeLessThanOrEqual(0.25);
  });

  it("une mesure aberrante ne sort jamais de 0..1", () => {
    expect(smoothLevel(0.9, 5)).toBeLessThanOrEqual(1);
    expect(smoothLevel(0.1, -3)).toBeGreaterThanOrEqual(0);
    expect(smoothLevel(Number.NaN, Number.NaN)).toBe(0);
  });

  it("le silence donne 8 % et le maximum 100 %", () => {
    expect(levelToWidth(0)).toBe(LEVEL_MIN_PCT);
    expect(levelToWidth(1)).toBe(LEVEL_MAX_PCT);
    expect(levelToWidth(Number.NaN)).toBe(LEVEL_MIN_PCT);
  });

  it("la longueur croit avec le niveau (echelle perceptuelle, pas lineaire)", () => {
    let precedent = -1;
    for (const n of [0, 0.01, 0.05, 0.1, 0.3, 0.6, 1]) {
      const l = levelToWidth(n);
      expect(l).toBeGreaterThanOrEqual(precedent);
      expect(l).toBeGreaterThanOrEqual(LEVEL_MIN_PCT);
      expect(l).toBeLessThanOrEqual(LEVEL_MAX_PCT);
      precedent = l;
    }
    // Une voix normale (0,1) deplace le trait bien au-dela du plancher : une
    // echelle lineaire l'aurait laissee a 17 %.
    expect(levelToWidth(0.1)).toBeGreaterThan(30);
  });

  it("le RMS est calcule sur les echantillons, jamais invente", () => {
    expect(rmsOf([0, 0, 0, 0])).toBe(0);
    expect(rmsOf([1, -1, 1, -1])).toBeCloseTo(1, 5);
    expect(rmsOf([0.5, 0.5])).toBeCloseTo(0.5, 5);
    expect(rmsOf([])).toBe(0);
    expect(rmsOf(null)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("2. permission : au PREMIER GESTE, jamais a l'entree", () => {
  it("sans geste, on ne demande rien", () => {
    expect(shouldAskVocalMic({ geste: false })).toBe(false);
    expect(shouldAskVocalMic({})).toBe(false);
    expect(shouldAskVocalMic()).toBe(false);
  });

  it("au premier geste, on demande une fois", () => {
    expect(shouldAskVocalMic({ geste: true, dejaDemande: false })).toBe(true);
  });

  it("un refus ne se represente pas tout seul", () => {
    expect(shouldAskVocalMic({ geste: true, dejaDemande: true })).toBe(false);
  });

  it("un micro deja actif n'est pas redemande", () => {
    expect(shouldAskVocalMic({ geste: true, dejaDemande: false, microActif: true })).toBe(false);
  });

  it("l'ecran arme l'ecoute des gestes et ne demande RIEN a l'entree", () => {
    const entree = corpsFonction(SUPER, "function enterVocal");
    // Les deux gestes armes...
    expect(entree).toMatch(/addEventListener\("pointerdown", onVocalFirstGesture\)/);
    expect(entree).toMatch(/document\.addEventListener\("keydown", onVocalFirstGesture\)/);
    // ... et AUCUNE demande declenchee par l'entree elle-meme : la seule
    // apparition de `demander()` est dans le gestionnaire de clic du bouton de
    // depannage (geste explicite), verifie juste apres.
    const demandes = (entree.match(/vocalMic\.demander\(\)/g) || []).length;
    expect(demandes).toBe(1);
    expect(entree).toMatch(/addEventListener\("click"[\s\S]{0,300}vocalMic\.demander\(\)/);
    const geste = corpsFonction(SUPER, "function onVocalFirstGesture");
    expect(geste).toMatch(/shouldAskVocalMic\(/);
    expect(geste).toMatch(/vocalMic\.demander\(\)/);
  });

  it("la touche ecoutee sur le document est retiree a la sortie (aucune fuite)", () => {
    const sortie = corpsFonction(SUPER, "function exitVocal");
    expect(sortie).toMatch(/document\.removeEventListener\("keydown", onVocalFirstGesture\)/);
  });

  it("le bouton de depannage relance la demande sur un geste explicite", () => {
    const entree = corpsFonction(SUPER, "function enterVocal");
    expect(entree).toMatch(/vocal-mic-fix/);
    expect(entree).toMatch(/vocalMic\.demander\(\)/);
  });
});

// ---------------------------------------------------------------------------
describe("3. une panne de micro ne bloque JAMAIS le mode", () => {
  it("chaque cause donne un message clair", () => {
    expect(micFailureMessage("NotAllowedError")).toBe(MIC_FERME);
    expect(micFailureMessage("SecurityError")).toBe(MIC_FERME);
    expect(micFailureMessage("NotFoundError")).toBe(MIC_ABSENT);
    expect(micFailureMessage("OverconstrainedError")).toBe(MIC_ABSENT);
    expect(micFailureMessage("NotReadableError")).toBe(MIC_OCCUPE);
    expect(micFailureMessage("AbortError")).toBe(MIC_OCCUPE);
    // Cause inconnue : jamais un message vide, jamais une exception.
    expect(micFailureMessage("BizarreError").length).toBeGreaterThan(0);
    expect(MIC_FERME).toBe("Le micro est fermé.");
  });

  it("un refus remonte un message, et aucune mesure ne tourne", async () => {
    const vus = { pannes: [], ecoutes: [], niveaux: [] };
    const options = {
      navigator: {
        mediaDevices: {
          getUserMedia: () => Promise.reject(Object.assign(new Error("refus"), { name: "NotAllowedError" })),
        },
      },
      onLevel: (n) => vus.niveaux.push(n),
      onListening: (a) => vus.ecoutes.push(a),
      onFailure: (m) => vus.pannes.push(m),
    };
    const moteur = createVocalMic(options);
    await expect(moteur.demander()).resolves.toBe(false);
    expect(vus.pannes).toEqual([MIC_FERME]);
    expect(vus.ecoutes).toEqual([]); // jamais « ecoute » sans capture
    expect(moteur.estActif()).toBe(false);
  });

  it("sans API micro du tout, on le dit au lieu de lever", async () => {
    const pannes = [];
    const moteur = createVocalMic({ navigator: {}, onFailure: (m) => pannes.push(m) });
    await expect(moteur.demander()).resolves.toBe(false);
    expect(pannes).toEqual([MIC_ABSENT]);
  });

  it("un peripherique retire en pleine ecoute repasse au silence et le dit", async () => {
    const faux = fauxMicro([0.3]);
    const vus = { pannes: [], ecoutes: [], niveaux: [] };
    const moteur = createVocalMic({
      ...faux.options,
      onLevel: (n) => vus.niveaux.push(n),
      onListening: (a) => vus.ecoutes.push(a),
      onFailure: (m) => vus.pannes.push(m),
    });
    await moteur.demander();
    faux.jouer(1);
    expect(vus.ecoutes).toEqual([true]);
    // Le systeme signale la fin de piste (materiel debranche).
    (faux.piste.listeners.ended || []).forEach((f) => f());
    expect(vus.pannes).toEqual([MIC_OCCUPE]);
    expect(vus.ecoutes).toEqual([true, false]);
    expect(moteur.estActif()).toBe(false);
  });

  it("l'ecran affiche ce message et un bouton, sans rien bloquer", () => {
    const corps = corpsFonction(SUPER, "function vocalMicFailure");
    expect(corps).toMatch(/vocalMicFerme = String\(message/);
    expect(corps).toMatch(/applyVocalState\(\)/);
    const etat = corpsFonction(SUPER, "function applyVocalState");
    // Le message clair occupe l'unique ligne d'etat, au repos seulement : la
    // parole et la reflexion gardent la priorite.
    expect(etat).toMatch(/state === "idle" && vocalMicFerme/);
    expect(etat).toMatch(/vocal-mic-fix/);
    // La saisie et l'envoi ne dependent d'aucun etat de micro : aucune
    // desactivation n'est posee ici.
    expect(etat).not.toMatch(/disabled/);
  });

  it("l'etat « ecoute » n'est vrai que si le micro capte", () => {
    const corps = corpsFonction(SUPER, "function vocalSetListening");
    expect(corps).toMatch(/vocalMicListening = actif === true/);
    // Un arret du micro efface la longueur posee (le trait retombe au silence).
    expect(corps).toMatch(/vocalClearLevel\(\)/);
  });
});

// ---------------------------------------------------------------------------
describe("4. le flux est REELLEMENT arrete (pas seulement ignore)", () => {
  it("a la sortie du mode : pistes stop(), contexte ferme, boucle annulee", async () => {
    const faux = fauxMicro([0.3, 0.5, 0.2]);
    const niveaux = [];
    const pannes = [];
    const moteur = createVocalMic({
      ...faux.options,
      onLevel: (n) => niveaux.push(n),
      onFailure: (m) => pannes.push(m),
    });
    await moteur.demander();
    // Nothing is measured inside `demander()` : la premiere mesure est une image.
    expect(niveaux).toHaveLength(0);
    faux.jouer(3);
    expect(niveaux.length).toBe(3);
    expect(faux.journal.stops).toHaveLength(0);

    moteur.fermer();

    // Le peripherique est RENDU : la piste est arretee (readyState « ended »).
    expect(faux.journal.stops).toHaveLength(1);
    expect(faux.piste.stopped).toBe(true);
    expect(faux.piste.readyState).toBe("ended");
    // Le contexte audio est ferme et la mesure est annulee.
    expect(faux.journal.closes).toBe(1);
    expect(faux.journal.annulees).toBe(1);
    expect(faux.restantes()).toBe(0);
    expect(moteur.estActif()).toBe(false);
    // Un arret DECIDE par nous n'est pas une panne : aucun message d'erreur.
    expect(pannes).toEqual([]);
  });

  it("apres l'arret, plus aucune mesure n'est poussee", async () => {
    const faux = fauxMicro([0.3]);
    const niveaux = [];
    const moteur = createVocalMic({ ...faux.options, onLevel: (n) => niveaux.push(n) });
    await moteur.demander();
    moteur.fermer();
    const avant = niveaux.length;
    faux.jouer(3);
    expect(niveaux.length).toBe(avant);
  });

  it("quitter le mode pendant la demande ne laisse pas un flux ouvert", async () => {
    const faux = fauxMicro([0.2]);
    let resoudre = null;
    const moteur = createVocalMic({
      ...faux.options,
      navigator: {
        mediaDevices: {
          getUserMedia: () =>
            new Promise((r) => {
              resoudre = r;
            }),
        },
      },
    });
    const attente = moteur.demander();
    // L'utilisateur quitte l'ecran AVANT la reponse du navigateur.
    moteur.fermer();
    resoudre(faux.flux);
    await expect(attente).resolves.toBe(false);
    expect(faux.piste.stopped).toBe(true);
    expect(moteur.estActif()).toBe(false);
  });

  it("deux fermetures ne cassent rien (aucune exception)", async () => {
    const faux = fauxMicro([0.2]);
    const moteur = createVocalMic(faux.options);
    await moteur.demander();
    moteur.fermer();
    expect(() => moteur.fermer()).not.toThrow();
    expect(faux.journal.stops).toHaveLength(1);
  });

  it("la sortie de l'ecran ferme le micro, et l'entree le prepare sans l'ouvrir", () => {
    const sortie = corpsFonction(SUPER, "function exitVocal");
    expect(sortie).toMatch(/vocalMic\.fermer\(\)/);
    expect(sortie).toMatch(/vocalMic = null/);
    expect(sortie).toMatch(/vocalMicListening = false/);
    const entree = corpsFonction(SUPER, "function enterVocal");
    expect(entree).toMatch(/createVocalMic\(/);
    // Rien n'est ouvert a l'entree : `createVocalMic` ne demande rien.
    expect(MIC).toMatch(/export function createVocalMic/);
    const jusquaDemande = MIC.indexOf("async function demander");
    expect(jusquaDemande).toBeGreaterThan(-1);
    expect(MIC.slice(0, jusquaDemande)).not.toMatch(/getUserMedia\(/);
  });
});

// ---------------------------------------------------------------------------
describe("5. un seul mecanisme : la capture vit dans vocal-mic.js", () => {
  it("super-agent.js ne contient aucune API micro", () => {
    expect(SUPER).not.toMatch(/getUserMedia|AudioContext|AnalyserNode|mediaDevices/);
    const entree = corpsFonction(SUPER, "function enterVocal");
    expect(entree).toMatch(/from "\.\/vocal-mic\.js"|createVocalMic/);
  });

  it("vocal-mic.js ouvre le micro une seule fois (un seul appel de capture)", () => {
    expect((MIC.match(/md\.getUserMedia\(/g) || []).length).toBe(1);
    expect((MIC.match(/new contexteCtor/g) || []).length).toBe(1);
  });

  it("aucune reconnaissance de parole : le niveau ne transcrit rien", () => {
    expect(MIC).not.toMatch(/SpeechRecognition|webkitSpeechRecognition/);
    expect(MIC).not.toMatch(/transcript|interimResults/);
  });

  it("le micro ne tient AUCUN lecteur : il signale une prise de parole, il n'arrete rien", () => {
    // vocal-mic.js ne connait ni `stopReading` ni la synthese vocale : depuis le
    // lot 4a il SIGNALE (`onSpeechStart`), l'arret reste chez l'appelant.
    expect(MIC).not.toMatch(/stopReading|speechSynthesis|SpeechSynthesisUtterance/);
    expect(MIC).toMatch(/onSpeechStart/);
    // Et l'ecran ne fait que poser une longueur.
    const niveau = corpsFonction(SUPER, "function vocalSetLevel");
    expect(niveau).toMatch(/--vocal-level/);
    expect(niveau).not.toMatch(/stopReading|speechSynthesis/);
  });
});

// ---------------------------------------------------------------------------
describe("6. mouvement reduit : la longueur reste figee par etat", () => {
  it("aucune valeur n'est posee quand le mouvement est reduit", () => {
    expect(planLevel({ niveau: 0.5, reduit: true }).ecrire).toBe(false);
    expect(planLevel({ niveau: 0.5, reduit: true }).largeur).toBe(0);
  });

  it("sinon la valeur suit le niveau mesure", () => {
    const plan = planLevel({ niveau: 0.5, reduit: false });
    expect(plan.ecrire).toBe(true);
    expect(plan.largeur).toBe(levelToWidth(0.5));
  });

  it("l'ecran lit le MEME drapeau que les animations (aucun nouveau reglage)", () => {
    const corps = corpsFonction(SUPER, "function vocalSetLevel");
    expect(corps).toMatch(/vocalReducedMotion\(\)/);
    expect(corps).toMatch(/planLevel\(/);
  });

  it("le CSS fige toujours l'ecoute a 45 % en mouvement reduit", () => {
    expect(
      sliceSource(CSS, ".pilot-vocal.vocal-reduced.vocal-state-listening .vocal-level-bar", "}", 2),
    ).toMatch(/width:\s*45%/);
  });
});

// ---------------------------------------------------------------------------
describe("7. ce que voit l'utilisateur", () => {
  it("le bouton de depannage est MASQUE par defaut (aucun bruit a l'ecran)", () => {
    const corps = corpsFonction(SUPER, "function buildVocalOverlay");
    expect(corps).toMatch(/class="vocal-mic-fix hidden"/);
    expect(corps).toMatch(/Autoriser le micro/);
    // `hidden` n'est pas une classe globale de cette feuille : sans regle
    // explicite, le bouton resterait visible en permanence.
    expect(CSS).toMatch(/\.vocal-mic-fix\.hidden\s*\{\s*display:\s*none;?\s*\}/);
  });

  it("le README ne promet plus un trait inerte", () => {
    expect(README).toMatch(/trait de niveau/i);
    expect(README).not.toMatch(/sans micro pour l'instant/);
    expect(README).not.toMatch(/le trait\s+reste donc inerte/);
  });
});
