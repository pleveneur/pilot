// Tests — LOT 4a : « on parle par-dessus Pilot, Pilot se tait »
//
// CE QUE CE FICHIER VERROUILLE (et pourquoi) :
//   1. LE RISQUE N° 1 D'ABORD : Pilot ne se coupe pas lui-meme. La voix de Pilot
//      sort des haut-parleurs, le micro la reprend ; une detection naive le
//      ferait se taire en boucle. Trois gardes sont mesurees ici :
//        a. l'annulation d'echo est DEMANDEE puis RELUE sur la piste obtenue ;
//        b. le residu d'echo est MESURE au debut de chaque lecture, et le seuil
//           est pose AU-DESSUS de ce residu ;
//        c. tant que l'echo n'est pas maitrise, la detection n'est PAS armee :
//           Pilot lit jusqu'au bout, comme avant (un silence vaut mieux qu'une
//           coupure qui part toute seule).
//   2. Une vraie prise de parole, elle, coupe : il faut `BARGE_IN_MIN_MS` de voix
//      CONTINUE au-dessus du seuil, et UNE seule coupure par lecture.
//   3. L'arret emprunte la SEULE voie existante (`stopReading`, read-aloud.js) ;
//      aucun second lecteur, aucune reprise automatique.
//   4. Hors mode Vocal, rien ne change : les autres ecrans lisent jusqu'au bout.
//   5. Le micro reste dans vocal-mic.js ; l'ecran ne gagne aucune API audio.
//
// Les commentaires sont en ASCII ; les chaines qui viennent de l'interface sont
// copiees telles quelles.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  createVocalMic,
  stepSpeechGate,
  vocalEchoThreshold,
  bargeInArmed,
  emptySpeechGate,
  echoCancellationOf,
  isConstraintRejection,
  MIC_CONSTRAINTS,
  MIC_FERME,
  BARGE_IN_CALIBRATION_MS,
  BARGE_IN_MIN_LEVEL,
  BARGE_IN_MIN_MS,
  BARGE_IN_RESIDUAL_MAX,
  BARGE_IN_RESIDUAL_UNPROVEN_MAX,
} from "./vocal-mic.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) => readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
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

/** Une lecture de `dureeMs` a un niveau CONSTANT, en images de 16 ms. PURE. */
function jouerLecture(niveau, dureeMs, options = {}) {
  const pas = 16;
  const contexte = { parlant: true, dtMs: pas, echoAnnule: options.echoAnnule === undefined ? true : options.echoAnnule };
  let etat = options.etat || emptySpeechGate();
  const declenchements = [];
  let seuil = 0;
  for (let t = 0; t < dureeMs; t += pas) {
    const pasGarde = stepSpeechGate(etat, niveau, contexte);
    etat = pasGarde.etat;
    seuil = pasGarde.seuil;
    if (pasGarde.declenche) declenchements.push(t + pas);
  }
  return { etat, declenchements, seuil };
}

/**
 * Faux micro du lot 4a : flux dont la piste DIT son annulation d'echo, analyseur
 * qui rend une amplitude CONSTANTE, et une horloge virtuelle (aucun test ne
 * depend du temps reel).
 */
function fauxMicro({ niveau = 0.01, echoCancellation = true, contraintesRefusees = false } = {}) {
  const journal = { demandes: 0, contraintes: [], stops: 0, paroles: [], rapports: [] };
  const piste = {
    kind: "audio",
    readyState: "live",
    listeners: {},
    stop() {
      journal.stops += 1;
    },
    addEventListener(nom, f) {
      this.listeners[nom] = this.listeners[nom] || [];
      this.listeners[nom].push(f);
    },
    getSettings() {
      return echoCancellation === null ? {} : { echoCancellation };
    },
  };
  const flux = { getTracks: () => [piste] };
  const analyseur = {
    fftSize: 1024,
    smoothingTimeConstant: 0,
    getFloatTimeDomainData(tampon) {
      let courant = journal.niveau === undefined ? niveau : journal.niveau;
      for (let k = 0; k < tampon.length; k += 1) tampon[k] = courant;
    },
  };
  const contexte = {
    state: "running",
    createMediaStreamSource: () => ({ connect() {} }),
    createAnalyser: () => analyseur,
    close: () => Promise.resolve(),
  };
  const navigatorFaux = {
    mediaDevices: {
      getUserMedia(contraintes) {
        journal.demandes += 1;
        journal.contraintes.push(contraintes);
        // Un peripherique qui refuse une contrainte precise : seul le repli
        // « micro simple » doit alors aboutir.
        if (contraintes && contraintes.audio && typeof contraintes.audio === "object" && contraintesRefusees) {
          return Promise.reject(Object.assign(new Error("contrainte"), { name: "OverconstrainedError" }));
        }
        return Promise.resolve(flux);
      },
    },
  };
  const images = [];
  let horloge = 0;
  const options = {
    navigator: navigatorFaux,
    AudioContext: function AudioContextFaux() {
      return contexte;
    },
    requestAnimationFrame(cb) {
      images.push(cb);
      return images.length;
    },
    cancelAnimationFrame(id) {
      if (id >= 1 && id <= images.length) images[id - 1] = null;
    },
    now: () => horloge,
    onLevel: () => {},
    onListening: () => {},
    onFailure: () => {},
    onSpeechStart: (rapport) => journal.paroles.push(rapport),
  };
  /** Joue `n` images de 16 ms (horloge virtuelle). */
  function jouer(n = 1, pas = 16) {
    let jouees = 0;
    while (jouees < n) {
      const idx = images.findIndex((c) => typeof c === "function");
      if (idx === -1) return;
      const cb = images[idx];
      images[idx] = null;
      jouees += 1;
      horloge += pas;
      cb();
    }
  }
  return { journal, piste, flux, options, jouer, niveauCourant: () => journal.niveau ?? niveau };
}

// ---------------------------------------------------------------------------
describe("1. la PREUVE anti-auto-coupure : le seuil est pose au-dessus du residu MESURE", () => {
  it("le seuil ne descend jamais sous le plancher (bruit de fond)", () => {
    expect(vocalEchoThreshold(0)).toBe(BARGE_IN_MIN_LEVEL);
    expect(vocalEchoThreshold(0.002)).toBeCloseTo(BARGE_IN_MIN_LEVEL, 6);
    expect(vocalEchoThreshold(Number.NaN)).toBe(BARGE_IN_MIN_LEVEL);
  });

  it("le seuil monte au-dessus du residu d'echo mesure", () => {
    // Residu 0,02 : le plancher (0,05) est encore au-dessus, donc la marge vaut
    // 2,5 fois l'echo de Pilot.
    expect(vocalEchoThreshold(0.02)).toBeCloseTo(BARGE_IN_MIN_LEVEL, 6);
    expect(vocalEchoThreshold(0.02) / 0.02).toBeGreaterThan(2);
    // Residu plus fort : c'est la marge qui prend le relais (0,05 x 1,8 = 0,09).
    expect(vocalEchoThreshold(0.05)).toBeCloseTo(0.09, 6);
    expect(vocalEchoThreshold(0.05)).toBeGreaterThan(0.05);
  });

  it("trente secondes d'echo residuel ne declenchent AUCUNE coupure", () => {
    // Annulation d'echo averee, residu mesure 0,012 pendant 30 s de lecture.
    const { declenchements, seuil } = jouerLecture(0.012, 30000, { echoAnnule: true });
    expect(declenchements).toEqual([]);
    expect(seuil).toBeCloseTo(BARGE_IN_MIN_LEVEL, 6);
  });

  it("une voix qui depasse le seuil coupe, et une seule fois par lecture", () => {
    // La MEME lecture, puis une vraie voix a 0,15 pendant 1 s.
    let etat = jouerLecture(0.012, 3000, { echoAnnule: true }).etat;
    const suite = jouerLecture(0.15, 1000, { etat, echoAnnule: true });
    expect(suite.declenchements).toHaveLength(1);
    // 200 ms de voix continue avant la coupure : jamais sur un claquement.
    expect(suite.declenchements[0]).toBeGreaterThanOrEqual(BARGE_IN_MIN_MS);
    expect(suite.declenchements[0]).toBeLessThan(BARGE_IN_MIN_MS + 40);
    // Le silence qui suit ne relance rien : la garde reste verrouillee.
    const apres = jouerLecture(0.012, 3000, { etat: suite.etat, echoAnnule: true });
    expect(apres.declenchements).toEqual([]);
  });

  it("un claquement plus court que la duree minimale ne coupe pas", () => {
    const debut = jouerLecture(0.012, 3000, { echoAnnule: true }).etat;
    // Un bruit bref (une seule image de 16 ms) : sous les 200 ms exiges.
    const court = jouerLecture(0.2, 16, { etat: debut, echoAnnule: true });
    expect(court.declenchements).toEqual([]);
    // Et la voix doit etre CONTINUE : deux eclats separes par du silence ne
    // s'additionnent pas.
    let etat = court.etat;
    const eclats = [16, 16, 16, 16, 16].map(() => jouerLecture(0.2, 16, { etat, echoAnnule: true }));
    for (const e of eclats) {
      expect(e.declenchements).toEqual([]);
      etat = jouerLecture(0.012, 32, { etat: e.etat, echoAnnule: true }).etat;
    }
  });

  it("aucun calibrage n'est fait pendant la lecture : on ne coupe pas avant de mesurer", () => {
    // Premiere image d'une lecture, avec deja une voix forte : le calibrage
    // passe avant la detection, donc aucune coupure immediate.
    const { declenchements } = jouerLecture(0.6, BARGE_IN_CALIBRATION_MS - 32, { echoAnnule: true });
    expect(declenchements).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("2. l'annulation d'echo : DEMANDEE, puis RELUE sur la piste obtenue", () => {
  it("la capture demande l'annulation d'echo (et non le micro brut)", () => {
    expect(MIC_CONSTRAINTS.audio.echoCancellation).toBe(true);
    expect(MIC_CONSTRAINTS.audio.noiseSuppression).toBe(true);
    // Un seul appel de capture : il porte ces contraintes.
    expect((MIC.match(/md\.getUserMedia\(/g) || []).length).toBe(1);
    expect(MIC).toMatch(/demanderFlux\(MIC_CONSTRAINTS\)/);
  });

  it("ce que le peripherique DIT est lu, et l'inconnu n'est pas une preuve", () => {
    expect(echoCancellationOf({ getTracks: () => [{ getSettings: () => ({ echoCancellation: true }) }] })).toBe(true);
    expect(echoCancellationOf({ getTracks: () => [{ getSettings: () => ({ echoCancellation: false }) }] })).toBe(false);
    // Le peripherique ne le dit pas : INCONNU, jamais « vrai » par defaut.
    expect(echoCancellationOf({ getTracks: () => [{ getSettings: () => ({}) }] })).toBe(null);
    expect(echoCancellationOf({ getTracks: () => [] })).toBe(null);
    expect(echoCancellationOf(null)).toBe(null);
    // Une piste qui leve une exception ne casse pas la capture.
    expect(
      echoCancellationOf({
        getTracks: () => [
          {
            getSettings() {
              throw new Error("non");
            },
          },
        ],
      })
    ).toBe(null);
  });

  it("sans annulation d'echo averee, la detection n'est PAS armee", () => {
    expect(bargeInArmed(false, 0)).toBe(false);
    // Meme avec un residu nul : le peripherique dit que le micro entendra Pilot.
    expect(bargeInArmed(false, 0.0001)).toBe(false);
    // Avere : une marge de 0,03 de residu reste acceptable.
    expect(bargeInArmed(true, 0.02)).toBe(true);
    // Avere mais echo trop fort : on ne coupe pas.
    expect(bargeInArmed(true, BARGE_IN_RESIDUAL_MAX + 0.001)).toBe(false);
    // Inconnu : il faut un residu vraiment negligeable (casque).
    expect(bargeInArmed(null, BARGE_IN_RESIDUAL_UNPROVEN_MAX)).toBe(true);
    expect(bargeInArmed(null, BARGE_IN_RESIDUAL_UNPROVEN_MAX + 0.001)).toBe(false);
  });

  it("PREUVE par neutralisation : l'annulation d'echo est bien la garde qui tient", () => {
    // Meme lecture (1 s de calme a 0,012, puis l'utilisateur parle a 0,5 pendant
    // 2 s) : la SEULE difference est ce que le peripherique DIT de son
    // annulation d'echo.
    const calme = jouerLecture(0.012, 1000, { echoAnnule: true }).etat;
    const averee = jouerLecture(0.5, 2000, { etat: calme, echoAnnule: true });
    const declareeAbsente = jouerLecture(0.5, 2000, { etat: calme, echoAnnule: false });
    expect(averee.declenchements).toHaveLength(1);
    // Sans annulation d'echo, AUCUNE coupure : c'est exactement le scenario
    // « hauts-parleurs sans annulation » qui ferait boucler Pilot.
    expect(declareeAbsente.declenchements).toEqual([]);
  });

  it("un echo deja trop fort pendant la lecture desarme la detection (jamais de coupure)", () => {
    // Residu 0,08 : haut-parleurs sans annulation d'echo effective.
    const { declenchements } = jouerLecture(0.08, 5000, { echoAnnule: true });
    expect(declenchements).toEqual([]);
    // Puis l'utilisateur parle fort : on ne coupe pas quand meme, car l'echo
    // n'est pas maitrise (le seuil ne peut plus distinguer voix et echo).
    expect(jouerLecture(0.6, 2000, { echoAnnule: true }).declenchements).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("3. le moteur : la garde ne s'arme que PENDANT la lecture", () => {
  it("hors lecture, rien n'est mesure pour couper (etat remis a zero)", () => {
    const etat = { dessusMs: 999, calibreMs: 999, residuel: 0.2, declenche: false };
    const pas = stepSpeechGate(etat, 0.9, { parlant: false, dtMs: 16, echoAnnule: true });
    expect(pas.declenche).toBe(false);
    expect(pas.motif).toBe("hors-lecture");
    expect(pas.etat).toEqual(emptySpeechGate());
  });

  it("trente secondes de lecture sans personne qui parle : zero coupure, mesurable", async () => {
    const faux = fauxMicro({ niveau: 0.012, echoCancellation: true });
    const moteur = createVocalMic(faux.options);
    await moteur.demander();
    moteur.setSpeaking(true);
    faux.jouer(1900); // ~30 s a 16 ms par image
    expect(faux.journal.paroles).toHaveLength(0);
    const rapport = moteur.bargeInReport();
    expect(rapport.echoCancellation).toBe(true);
    expect(rapport.arme).toBe(true);
    expect(rapport.calibre).toBe(true);
    expect(rapport.motif).toBe("a-l-ecoute");
    // Le seuil est bien au-dessus du residu REELLEMENT mesure.
    expect(rapport.residuel).toBeCloseTo(0.012, 2);
    expect(rapport.seuil).toBeGreaterThan(rapport.residuel);
    moteur.fermer();
  });

  it("une vraie voix pendant la lecture est signalee UNE fois, avec ses chiffres", async () => {
    const faux = fauxMicro({ niveau: 0.012, echoCancellation: true });
    const moteur = createVocalMic(faux.options);
    await moteur.demander();
    moteur.setSpeaking(true);
    faux.jouer(60); // ~1 s de lecture (calibrage + marge)
    faux.journal.niveau = 0.15; // l'utilisateur parle
    faux.jouer(40); // ~640 ms
    expect(faux.journal.paroles).toHaveLength(1);
    const rapport = faux.journal.paroles[0];
    expect(rapport.seuil).toBeGreaterThan(0.012);
    expect(rapport.residuel).toBeLessThan(rapport.seuil);
    // La garde se verrouille : continuer a parler ne re-coupe pas.
    faux.jouer(60);
    expect(faux.journal.paroles).toHaveLength(1);
    moteur.fermer();
  });

  it("la fin de la lecture remet la garde a zero : le residu d'une lecture ne vaut pas pour la suivante", async () => {
    const faux = fauxMicro({ niveau: 0.02, echoCancellation: true });
    const moteur = createVocalMic(faux.options);
    await moteur.demander();
    moteur.setSpeaking(true);
    faux.jouer(80);
    expect(moteur.bargeInReport().residuel).toBeGreaterThan(0.015);
    moteur.setSpeaking(false);
    const rapport = moteur.bargeInReport();
    expect(rapport.motif).toBe("hors-lecture");
    expect(rapport.residuel).toBe(0);
    expect(rapport.calibre).toBe(false);
    moteur.fermer();
  });

  it("un peripherique qui declare ne pas annuler l'echo ne coupe jamais", async () => {
    const faux = fauxMicro({ niveau: 0.4, echoCancellation: false });
    const moteur = createVocalMic(faux.options);
    await moteur.demander();
    moteur.setSpeaking(true);
    faux.jouer(300);
    expect(faux.journal.paroles).toHaveLength(0);
    const rapport = moteur.bargeInReport();
    expect(rapport.arme).toBe(false);
    expect(rapport.motif).toBe("echo-non-annule");
    moteur.fermer();
  });

  it("un peripherique qui ne dit rien (inconnu) et un echo franc ne coupent pas", async () => {
    const faux = fauxMicro({ niveau: 0.4, echoCancellation: null });
    const moteur = createVocalMic(faux.options);
    await moteur.demander();
    moteur.setSpeaking(true);
    faux.jouer(300);
    expect(faux.journal.paroles).toHaveLength(0);
    expect(moteur.bargeInReport().arme).toBe(false);
    moteur.fermer();
  });

  it("une contrainte refusee n'est pas une panne : le micro simple est redemande une seule fois", async () => {
    expect(isConstraintRejection("OverconstrainedError")).toBe(true);
    expect(isConstraintRejection("TypeError")).toBe(true);
    expect(isConstraintRejection("NotAllowedError")).toBe(false);
    const faux = fauxMicro({ niveau: 0.012, echoCancellation: null, contraintesRefusees: true });
    const moteur = createVocalMic(faux.options);
    const ok = await moteur.demander();
    expect(ok).toBe(true);
    expect(faux.journal.demandes).toBe(2);
    expect(faux.journal.contraintes[1]).toEqual({ audio: true });
    moteur.fermer();
  });

  it("un refus de l'utilisateur n'est pas retente et donne le message clair", async () => {
    const vus = [];
    const options = {
      navigator: {
        mediaDevices: {
          getUserMedia: () => Promise.reject(Object.assign(new Error("refus"), { name: "NotAllowedError" })),
        },
      },
      AudioContext: function AudioContextFaux() {
        return {};
      },
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: () => {},
      onFailure: (m) => vus.push(m),
    };
    const moteur = createVocalMic(options);
    expect(await moteur.demander()).toBe(false);
    expect(vus).toEqual([MIC_FERME]);
  });
});

// ---------------------------------------------------------------------------
describe("4. l'ecran : couper passe par la SEULE voie existante (stopReading)", () => {
  it("le signal du micro est branche sur la coupure", () => {
    const entree = corpsFonction(SUPER, "function enterVocal");
    expect(entree).toMatch(/onSpeechStart: vocalBargeIn/);
    // Le meme moteur que le lot 3 : aucun second mecanisme micro.
    expect((SUPER.match(/createVocalMic\(/g) || []).length).toBe(1);
  });

  it("l'etat « Pilot parle » est la seule source qui arme la garde", () => {
    const corps = corpsFonction(SUPER, "const onVocalReadAloudState");
    expect(corps).toMatch(/vocalSpeaking = etat === "speaking"/);
    expect(corps).toMatch(/vocalSyncMicSpeaking\(\)/);
    const sync = corpsFonction(SUPER, "function vocalSyncMicSpeaking");
    expect(sync).toMatch(/vocalMic\.setSpeaking\(vocalSpeaking\)/);
  });

  it("la coupure arrete la lecture et remet la saisie en main", () => {
    const corps = corpsFonction(SUPER, "function vocalBargeIn");
    expect(corps).toMatch(/stopReading\(\)/);
    expect(corps).toMatch(/inputEl\.focus\(\)/);
    // Aucune synthese vocale propre a l'ecran, aucune seconde lecture.
    expect(corps).not.toMatch(/speechSynthesis|SpeechSynthesisUtterance|new Audio\(|\.click\(\)/);
    // Et l'arret n'arrete AUCUN agent : c'est un arret d'ecoute, pas un arret de
    // travail (l'entonnoir des arrets d'agents n'a donc rien a tracer ici).
    expect(corps).not.toMatch(/stopAgent|agent_stop|abort|kill/i);
  });

  it("la trace chiffree de la mesure est ecrite (verifiable au vrai micro)", () => {
    const corps = corpsFonction(SUPER, "function vocalBargeIn");
    expect(corps).toMatch(/console\.info/);
    expect(corps).toMatch(/residu=/);
    expect(corps).toMatch(/seuil=/);
  });

  it("hors du mode Vocal, la coupure ne fait rien : les autres ecrans lisent jusqu'au bout", () => {
    const corps = corpsFonction(SUPER, "function vocalBargeIn");
    expect(corps).toMatch(/if \(!vocalOverlay\) return;/);
    // Et le seul endroit ou une garde du micro existe est `enterVocal`.
    expect((SUPER.match(/vocalMic\.setSpeaking\(/g) || []).length).toBe(1);
  });

  it("aucune reprise automatique apres une coupure (lot 4a borne)", () => {
    const corps = corpsFonction(SUPER, "function vocalBargeIn");
    expect(corps).not.toMatch(/autoReadVocalReply/);
    expect(corps).not.toMatch(/setTimeout/);
  });

  it("le README ne promet plus la coupure comme « a venir »", () => {
    expect(README).toMatch(/coupure|parler/i);
    expect(README).not.toMatch(/Ce qui \*\*reste à venir\*\* : la coupure de Pilot en parlant/);
    expect(README).toMatch(/trait de niveau/i);
  });
});
