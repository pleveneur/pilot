// Tests — LOT 4a : « on parle par-dessus Pilot, Pilot se tait »
//
// CE QUE CE FICHIER VERROUILLE (et pourquoi) :
//   1. LE RISQUE N° 1 D'ABORD : Pilot ne se coupe pas lui-meme. La voix de Pilot
//      sort des haut-parleurs, le micro la reprend ; une detection naive le
//      ferait se taire en boucle. Trois gardes sont mesurees ici :
//        a. l'annulation d'echo est DEMANDEE puis RELUE sur la piste obtenue ;
//        b. le residu d'echo est MESURE au debut de chaque lecture, et le seuil
//           est pose AU-DESSUS de ce residu ;
//        c. tant que l'echo n'est pas maitrise, les seuils habituels ne sont
//           pas armes — mais une voix franche finit TOUJOURS par couper : c'est
//           la GARANTIE DE SECOURS (section 5), qui juge la voix sur le son
//           DEJA entendu dans la lecture, jamais sur la seule fenetre de
//           calibrage (qui peut etre muette ou polluee).
//   2. Une vraie prise de parole, elle, coupe : il faut `BARGE_IN_MIN_MS` de voix
//      CONTINUE au-dessus du seuil, et UNE seule coupure par lecture.
//   3. L'arret emprunte la SEULE voie existante (`stopReading`, read-aloud.js) ;
//      aucun second lecteur, aucune reprise automatique.
//      Depuis le lot 4b, la MEME garde sert aussi a couper le TRAVAIL quand la
//      voix prend la parole pendant une reflexion (vocal-couper-la-reflexion.test.js) :
//      l'arret de LECTURE, lui, reste un arret d'ecoute et n'arrete aucun agent.
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
  BARGE_IN_FALLBACK_MS,
  fallbackThreshold,
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
  const journal = { demandes: 0, contraintes: [], stops: 0, paroles: [], rapports: [], echoCancellation };
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
      const applique = journal.echoCancellation;
      return applique === null ? {} : { echoCancellation: applique };
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

  it("PREUVE par neutralisation : l'annulation d'echo reste la garde qui tient", () => {
    // Meme lecture (1 s de calme a 0,012, puis l'utilisateur parle a 0,5 pendant
    // 2 s) : la SEULE difference est ce que le peripherique DIT de son
    // annulation d'echo.
    const calme = jouerLecture(0.012, 1000, { echoAnnule: true }).etat;
    const averee = jouerLecture(0.5, 2000, { etat: calme, echoAnnule: true });
    const declareeAbsente = jouerLecture(0.5, 2000, { etat: calme, echoAnnule: false });
    // Annulation averee : la voix coupe dans le regime normal (`BARGE_IN_MIN_MS`).
    expect(averee.declenchements).toHaveLength(1);
    expect(averee.declenchements[0]).toBeLessThan(BARGE_IN_MIN_MS + 40);
    // Sans annulation d'echo, le regime normal est INTERDIT : la coupure, si elle
    // vient, ne peut venir que de la garantie de secours, donc bien plus tard.
    expect(declareeAbsente.declenchements).toHaveLength(1);
    expect(declareeAbsente.declenchements[0]).toBeGreaterThanOrEqual(BARGE_IN_FALLBACK_MS);
  });

  it("un echo deja trop fort pendant la lecture interdit le regime normal", () => {
    // Residu 0,08 : haut-parleurs sans annulation d'echo effective.
    const { declenchements } = jouerLecture(0.08, 5000, { echoAnnule: true });
    expect(declenchements).toEqual([]);
    expect(bargeInArmed(true, 0.08)).toBe(false);
    // Et une voix forte, dans la MEME lecture, ne coupe pas a `BARGE_IN_MIN_MS` :
    // le regime normal est bien interdit, seul le secours peut parler.
    const voix = jouerLecture(0.6, BARGE_IN_MIN_MS * 2, { etat: { ...emptySpeechGate(), calibreMs: 1000, residuel: 0.08, refSecours: 0.08 }, echoAnnule: true });
    expect(voix.declenchements).toEqual([]);
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

  it("le son de Pilot, present des la PREMIERE image, ne se coupe jamais lui-meme (meme sans preuve d'echo)", async () => {
    const faux = fauxMicro({ niveau: 0.4, echoCancellation: false });
    const moteur = createVocalMic(faux.options);
    await moteur.demander();
    moteur.setSpeaking(true);
    faux.jouer(300);
    expect(faux.journal.paroles).toHaveLength(0);
    const rapport = moteur.bargeInReport();
    expect(rapport.arme).toBe(false);
    expect(rapport.motif).toBe("echo-non-annule");
    // Le son deja present (0,4) est la reference du secours : il ne peut pas
    // franchir son propre double. C'est la preuve que le secours ne se declenche
    // pas sur le son de Pilot, meme tres fort.
    expect(rapport.refSecours).toBeCloseTo(0.4, 2);
    expect(rapport.seuilSecours).toBeGreaterThan(rapport.refSecours);
    // Une voix qui AJOUTE au son de Pilot, elle, finit par couper : ce n'est plus
    // le meme son, c'est une elevation tenue.
    faux.journal.niveau = 0.95;
    faux.jouer(120); // ~1,92 s
    expect(faux.journal.paroles).toHaveLength(1);
    expect(faux.journal.paroles[0].seuil).toBeGreaterThan(0.4);
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
    // Correctif de revue : la comparaison de chaine (`etat === "speaking"`) est
    // remplacee par la SEULE decision « Pilot parle » du projet, qui couvre la
    // lecture normale ET ses DEUX replis de voix (local-fallback /
    // system-fallback). Pendant un repli, l'ancienne ecriture laissait la garde
    // desarmee (on ne pouvait plus faire taire Pilot) et l'armement de la
    // dictee croyait au silence. La liste des etats vit dans read-aloud.js.
    expect(corps).toMatch(/vocalSpeaking = isReadAloudSpeaking\(etat\);/);
    expect(corps).not.toMatch(/vocalSpeaking = etat === "speaking"/);
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
    // L'arret de LECTURE n'arrete AUCUN agent : c'est un arret d'ecoute, pas un
    // arret de travail. Depuis le LOT 4b, c'est l'AUTRE etat (reflexion) qui
    // coupe le travail, et il le fait par le chemin d'arret PARTAGE du bouton
    // Stop (`stopSuperAgentTurn`) : aucun IPC d'arrete n'est ecrit dans cette
    // fonction, donc aucun second mecanisme n'apparait ici.
    expect(corps).not.toMatch(/invoke\(|agent_stop|abort_\w+|\bkill\b/i);
  });

  it("la trace chiffree de la mesure est ecrite (verifiable au vrai micro)", () => {
    const corps = corpsFonction(SUPER, "function vocalBargeIn");
    expect(corps).toMatch(/console\.info/);
    expect(corps).toMatch(/residu=/);
    expect(corps).toMatch(/seuil=/);
    // Le motif distingue la voie normale (`voix-detectee`, 200 ms) de la
    // garantie de secours (`voix-secours`, 1000 ms) : sans lui, impossible de
    // savoir au vrai micro laquelle a coupe.
    expect(corps).toMatch(/motif=/);
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

// ---------------------------------------------------------------------------
// GARANTIE DE SECOURS — le cas « impossible a couper » ne doit plus exister.
//
// Defaut constate : la preuve d'annulation d'echo etait lue UNE SEULE FOIS, a
// l'ouverture du micro. Quand elle valait `false` (ou quand le residu mesure
// depassait `BARGE_IN_RESIDUAL_MAX`), `bargeInArmed` interdisait la coupure
// pour TOUTE la session : une voix franche et continue ne coupait jamais, sans
// erreur et sans trace. Deux corrections, dans le meme module :
//   a. la preuve est RELUE a chaque debut de lecture, sur la piste deja
//      ouverte (aucune seconde capture) ;
//   b. une garantie de secours juge la voix sur le SON DEJA ENTENDU dans la
//      residu mesure au debut de la lecture, GELE pour cette lecture : une voix
//      qui depasse ce niveau de `BARGE_IN_FALLBACK_FACTOR` fois en le tenant
//      `BARGE_IN_FALLBACK_MS` coupe, meme garde desarmee.
describe("5. la GARANTIE DE SECOURS : une voix franche finit TOUJOURS par couper", () => {
  it("echo douteux (preuve declaree absente) + voix franche continue : la lecture est coupee", () => {
    // Echo de Pilot a 0,06 des la premiere image ; le peripherique declare ne
    // pas annuler l'echo : `bargeInArmed` est faux, le regime normal est interdit.
    const calme = jouerLecture(0.06, 2000, { echoAnnule: false });
    expect(calme.declenchements).toEqual([]);
    expect(bargeInArmed(false, calme.etat.residuel)).toBe(false);
    // L'utilisateur parle franchement par-dessus : la lecture est coupee.
    const voix = jouerLecture(0.4, 3000, { etat: calme.etat, echoAnnule: false });
    expect(voix.declenchements).toHaveLength(1);
    // Plus tard que la voie normale (200 ms) : la voix doit depasser nettement
    // le son deja present ET le tenir bien plus longtemps qu'un claquement.
    expect(voix.declenchements[0]).toBeGreaterThanOrEqual(BARGE_IN_FALLBACK_MS);
    expect(voix.declenchements[0]).toBeLessThan(BARGE_IN_FALLBACK_MS + 40);
    // Une seule coupure par lecture, meme si la voix continue.
    const apres = jouerLecture(0.4, 3000, { etat: voix.etat, echoAnnule: false });
    expect(apres.declenchements).toEqual([]);
  });

  it("contre-epreuve : le son de Pilot SEUL ne coupe jamais, dans les memes conditions", () => {
    // Meme peripherique (preuve declaree absente, garde desarmee), meme duree
    // de 30 s : le niveau ne depasse jamais son propre double, donc rien ne part.
    expect(jouerLecture(0.06, 30000, { echoAnnule: false }).declenchements).toEqual([]);
    // Et un echo FORT non plus, alors qu'il est tres au-dessus du plancher de
    // bruit : c'est le son deja present, pas une voix.
    expect(jouerLecture(0.4, 30000, { echoAnnule: false }).declenchements).toEqual([]);
  });

  it("une hausse MODEREE du son de Pilot (< au double) ne coupe pas", () => {
    // Pilot enchaine une phrase plus forte : tant que le niveau reste sous le
    // double de la reference gelee, ce n'est pas une voix superposee.
    let etat = jouerLecture(0.04, 2000, { echoAnnule: false }).etat;
    for (const palier of [0.05, 0.06, 0.07, 0.079]) {
      const pas = jouerLecture(palier, 3000, { etat, echoAnnule: false });
      expect(pas.declenchements).toEqual([]);
      etat = pas.etat;
    }
    expect(fallbackThreshold(0.04)).toBeCloseTo(0.08, 6);
  });

  it("LIMITE DITE : un saut instantane de plus du double tenu une seconde coupe (risque de fausse coupure)", () => {
    // Ce test ne verifie pas un oubli : il CHIFFRE la limite du critere retenu.
    // Le son de Pilot qui bondit d'un coup a plus du double de son niveau
    // habituel et s'y maintient une seconde sans le moindre creux est
    // indiscernable d'une voix. Le risque est borne par les deux constantes du
    // secours (facteur 2, duree 1000 ms) et documente dans la spec.
    const debut = jouerLecture(0.02, 3000, { echoAnnule: false }).etat;
    const saut = jouerLecture(0.1, 1500, { etat: debut, echoAnnule: false });
    expect(saut.declenchements).toHaveLength(1);
  });

  it("le seuil de secours est le double du residu mesure, jamais sous le plancher", () => {
    expect(fallbackThreshold(0)).toBe(BARGE_IN_MIN_LEVEL);
    expect(fallbackThreshold(Number.NaN)).toBe(BARGE_IN_MIN_LEVEL);
    // Sous le plancher : c'est le plancher qui decide.
    expect(fallbackThreshold(0.02)).toBeCloseTo(BARGE_IN_MIN_LEVEL, 6);
    // Au-dessus : deux fois le residu, donc jamais franchi par le son de Pilot.
    expect(fallbackThreshold(0.06)).toBeCloseTo(0.12, 6);
    expect(fallbackThreshold(0.4)).toBeCloseTo(0.8, 6);
    expect(fallbackThreshold(0.4)).toBeGreaterThan(0.4);
    // Plus prudent que la voie normale : marge plus large a residu egal.
    expect(fallbackThreshold(0.1)).toBeGreaterThan(vocalEchoThreshold(0.1));
  });

  it("la preuve d'annulation d'echo est RELUE au debut de CHAQUE lecture", async () => {
    const faux = fauxMicro({ niveau: 0.012, echoCancellation: false });
    const moteur = createVocalMic(faux.options);
    await moteur.demander();
    expect(moteur.bargeInReport().echoCancellation).toBe(false);
    moteur.setSpeaking(true);
    faux.jouer(120); // ~2 s de lecture dans le calme
    expect(moteur.bargeInReport().echoCancellation).toBe(false);
    // Meme voix forte : garde desarmee, rien ne part a `BARGE_IN_MIN_MS`.
    faux.journal.niveau = 0.5;
    faux.jouer(20); // ~320 ms
    expect(faux.journal.paroles).toHaveLength(0);
    moteur.setSpeaking(false);
    // Fin de la voix : le niveau retombe (deuxieme lecture dans le calme).
    faux.journal.niveau = 0.012;
    faux.jouer(40);
    // Le peripherique change d'avis pendant la session : la preuve doit etre
    // RELUE, sinon la coupure resterait interdite jusqu'a la sortie du mode.
    faux.journal.echoCancellation = true;
    moteur.setSpeaking(true);
    expect(moteur.bargeInReport().echoCancellation).toBe(true);
    faux.jouer(120);
    faux.journal.niveau = 0.5;
    faux.jouer(20);
    expect(faux.journal.paroles).toHaveLength(1);
    moteur.fermer();
  });

  it("la relecture se fait sur la piste DEJA ouverte : aucune seconde capture", () => {
    const corps = corpsFonction(MIC, "function setSpeaking(");
    // Même appel que la capture (`getSettings` via `echoCancellationOf`).
    expect(corps).toMatch(/echoAnnule = echoCancellationOf\(flux\)/);
    // Et aucun nouvel appel de capture dans le module.
    expect((MIC.match(/md\.getUserMedia\(/g) || []).length).toBe(1);
    expect(corps).not.toMatch(/getUserMedia|new AudioContext/);
  });
});
