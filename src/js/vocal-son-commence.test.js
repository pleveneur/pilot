// Tests — LA FENETRE DE MESURE S'OUVRE SUR LE DEBUT DU SON (correctif du
// defaut MIROIR de `6883eab`).
//
// CE QUE CE FICHIER VERROUILLE (et pourquoi) :
//
//   1. LE DEFAUT MIROIR. `6883eab` a rendu la 2e lecture coupable en limitant la
//      mesure a l'ATTAQUE du son. Mais la fenetre d'attaque s'ouvre sur
//      `notify("speaking")` (read-aloud.js), c'est-a-dire sur l'ANNONCE, donc
//      AVANT le premier son : `ensureVoices` attend les voix jusqu'a 1500 ms, et
//      la voix locale (Piper) synthetise le premier morceau par un processus.
//      Si le son demarre apres la fenetre, la reference mesuree est du SILENCE,
//      les seuils tombent au plancher (0,05) et le son de Pilot — constant — se
//      coupe LUI-MEME (200 ms en voie normale, 1000 ms par le secours).
//      Correction : `READ_ALOUD_SOUND_EVENT` (read-aloud.js) dit l'instant du
//      premier echantillon audible ; `vocal-mic.setSoundStarted()` rouvre la
//      fenetre LA (une seule fois par lecture).
//
//   2. CE QUI NE DOIT PAS CHANGER : une voix franche coupe toujours (2e, 3e,
//      10e lecture), le son de Pilot seul ne se coupe jamais, et AUCUN seuil de
//      decision ne change de valeur (600 / 200 / 0,05 / 0,03 / 0,01 / 1000,
//      marges 1,8 et 2).
//
//   3. LE BRANCHEMENT, de bout en bout : le signal part de read-aloud.js au
//      premier `onstart` (voix du systeme) ou au demarrage reel de la lecture
//      audio (voix locale), et l'ecran Vocal le transmet au micro.
//
// Les commentaires sont en ASCII ; les chaines qui viennent de l'interface sont
// copiees telles quelles.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createVocalMic, BARGE_IN_MIN_MS, BARGE_IN_FALLBACK_MS } from "./vocal-mic.js";
import { createSpeaker, READ_ALOUD_SOUND_EVENT, READ_ALOUD_STATE_EVENT } from "./read-aloud.js";
import { playLocalChunks } from "./local-voice.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) => readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const MIC = lire("src/js/vocal-mic.js");
const READ = lire("src/js/read-aloud.js");
const LOCAL = lire("src/js/local-voice.js");
const SUPER = lire("src/js/super-agent.js");

/** Corps d'une fonction du module (jusqu'a la premiere accolade en colonne 3). */
function corpsFonction(src, entete) {
  const i = src.indexOf(entete);
  expect(i, `fonction absente : ${entete}`).toBeGreaterThan(-1);
  const fin = src.indexOf("\n  }", i);
  return src.slice(i, fin > -1 ? fin : undefined);
}

/**
 * Faux micro (meme forme que `ecran-vocal-lot4a.test.js`) : flux dont la piste
 * DIT son annulation d'echo, analyseur qui rend une amplitude CONSTANTE, et une
 * horloge VIRTUELLE (aucun test ne depend du temps reel).
 */
function fauxMicro({ niveau = 0.01, echoCancellation = true } = {}) {
  const journal = { demandes: 0, stops: 0, paroles: [], echoCancellation, niveau };
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
      const courant = journal.niveau;
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
      getUserMedia() {
        journal.demandes += 1;
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
  return { journal, options, jouer };
}

/** Laisse tourner une minuterie (lecture audio factice). */
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

// ---------------------------------------------------------------------------
// 1. LE DEFAUT MIROIR : le son demarre LONGTEMPS apres l'annonce.
//
// C'est le cas de la 1re lecture a froid (voix du systeme, `ensureVoices`) et de
// la voix locale (synthese par un processus). Sans le signal « le son
// commence », la reference mesuree est du silence : le son de Pilot, pourtant
// seul en cause, depasse le plancher et se coupe lui-meme.
describe("1. le son demarre APRES l'annonce : Pilot ne se coupe pas lui-meme", () => {
  for (const echo of [true, false, null]) {
    it(`son demarre a 1500 ms, echo=${echo} : aucune coupure automatique`, async () => {
      const faux = fauxMicro({ niveau: 0.01, echoCancellation: echo });
      const moteur = createVocalMic(faux.options);
      await moteur.demander();
      moteur.setSpeaking(true); // ANNONCE : « Pilot parle » (avant tout son)
      faux.jouer(94); // ~1500 ms de silence : voix froide / synthese locale
      expect(moteur.bargeInReport().sonCommence, "le son n'a pas encore commence").toBe(false);
      moteur.setSoundStarted(); // LE SON COMMENCE
      expect(moteur.bargeInReport().sonCommence).toBe(true);
      faux.journal.niveau = 0.35; // le son de Pilot, fort et constant
      faux.jouer(320); // ~5 s
      expect(faux.journal.paroles).toHaveLength(0);
      // La reference est bien le SON DE PILOT (0,35), pas du silence.
      const rapport = moteur.bargeInReport();
      expect(rapport.refSecours).toBeCloseTo(0.35, 2);
      expect(rapport.seuil).toBeGreaterThan(0.35);
      moteur.fermer();
    });
  }

  it("le son demarre TARD mais une VRAIE voix par-dessus coupe quand meme", async () => {
    const faux = fauxMicro({ niveau: 0.01, echoCancellation: true });
    const moteur = createVocalMic(faux.options);
    await moteur.demander();
    moteur.setSpeaking(true);
    faux.jouer(94); // 1500 ms : le son n'a pas commence
    moteur.setSoundStarted();
    faux.journal.niveau = 0.02; // le son de Pilot, faible echo
    faux.jouer(40); // ~640 ms : le calibrage de 600 ms est purge
    faux.journal.niveau = 0.4; // l'utilisateur parle par-dessus
    faux.jouer(20); // ~320 ms
    expect(faux.journal.paroles).toHaveLength(1);
    expect(faux.journal.paroles[0].motif).toBe("voix-detectee");
    moteur.fermer();
  });
});

// ---------------------------------------------------------------------------
// 2. LE CAS NORMAL : le son demarre tout de suite, l'utilisateur parle apres.
describe("2. le son demarre immediatement : la voix par-dessus coupe toujours", () => {
  it("son immediat puis voix de l'utilisateur : une coupure, en BARGE_IN_MIN_MS", async () => {
    const faux = fauxMicro({ niveau: 0.012, echoCancellation: true });
    const moteur = createVocalMic(faux.options);
    await moteur.demander();
    moteur.setSpeaking(true);
    moteur.setSoundStarted();
    faux.jouer(40); // ~640 ms du son de Pilot : calibrage (600 ms) + attaque
    faux.journal.niveau = 0.4;
    faux.jouer(20); // ~320 ms de voix (> BARGE_IN_MIN_MS)
    expect(faux.journal.paroles).toHaveLength(1);
    // Le son de Pilot ne s'est pas coupe tout seul avant : une seule coupure,
    // et elle vient de la voix (`BARGE_IN_MIN_MS` de continuite exigee).
    expect(faux.journal.paroles[0].motif).toBe("voix-detectee");
    expect(faux.journal.paroles[0].seuil).toBeLessThan(0.4);
    moteur.fermer();
  });
});

// ---------------------------------------------------------------------------
// 3. LES ACQUIS : le droit de couper ne se consomme pas.
describe("3. la 2e, la 3e, la 10e lecture restent coupables (chacune ouverte sur le son)", () => {
  it("dix lectures d'affilee : dix coupures, une par lecture", async () => {
    const faux = fauxMicro({ niveau: 0.012, echoCancellation: true });
    const moteur = createVocalMic(faux.options);
    await moteur.demander();
    for (let i = 1; i <= 10; i += 1) {
      faux.journal.niveau = 0.012;
      moteur.setSpeaking(true); // annonce
      moteur.setSoundStarted(); // le son commence (moteur chaud : tout de suite)
      faux.jouer(40); // ~640 ms de lecture dans le calme (calibrage purge)
      faux.journal.niveau = 0.4; // voix franche et continue
      faux.jouer(20); // ~320 ms (> BARGE_IN_MIN_MS)
      expect(faux.journal.paroles, `lecture ${i}`).toHaveLength(i);
      moteur.setSpeaking(false);
      // Pause entre deux lectures : le niveau lisse redescend (le micro garde la
      // traine du son precedent), comme dans la vraie vie entre deux phrases.
      faux.journal.niveau = 0.012;
      faux.jouer(30);
    }
    moteur.fermer();
  });

  it("un signal tardif ne rouvre PAS la fenetre : une seule coupure par lecture", async () => {
    const faux = fauxMicro({ niveau: 0.012, echoCancellation: true });
    const moteur = createVocalMic(faux.options);
    await moteur.demander();
    moteur.setSpeaking(true);
    moteur.setSoundStarted();
    faux.jouer(40);
    faux.journal.niveau = 0.4;
    faux.jouer(20);
    expect(faux.journal.paroles).toHaveLength(1);
    const reference = moteur.bargeInReport().refSecours;
    // Un morceau suivant commence : le signal repart, la fenetre ne se rouvre pas.
    moteur.setSoundStarted();
    expect(moteur.bargeInReport().refSecours).toBe(reference);
    // Le niveau lisse redescend avant de rejouer : rien d'autre ne change.
    faux.journal.niveau = 0.012;
    faux.jouer(30);
    faux.journal.niveau = 0.4;
    faux.jouer(30);
    expect(faux.journal.paroles).toHaveLength(1);
    moteur.fermer();
  });

  it("hors lecture, le signal ne fait rien du tout", async () => {
    const faux = fauxMicro({ niveau: 0.012, echoCancellation: true });
    const moteur = createVocalMic(faux.options);
    await moteur.demander();
    moteur.setSoundStarted();
    expect(moteur.bargeInReport().sonCommence).toBe(false);
    expect(moteur.bargeInReport().motif).toBe("hors-lecture");
    moteur.fermer();
  });
});

// ---------------------------------------------------------------------------
// 4. LE SIGNAL PART AU BON MOMENT (fonctionnel, pas seulement source).
describe("4. read-aloud.js emet « le son commence » au premier echantillon audible", () => {
  /** Fenetre minimale : la synthese appelle `onstart` en parlant vraiment. */
  function fauxFenetre({ onstart = true } = {}) {
    const events = [];
    const utterances = [];
    class FakeCustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = (init && init.detail) || null;
      }
    }
    class Utterance {
      constructor(text) {
        this.text = text;
        this.onstart = null;
        this.onend = null;
        this.onerror = null;
      }
    }
    const synth = {
      speak(u) {
        utterances.push(u);
        if (onstart && typeof u.onstart === "function") u.onstart();
        setTimeout(() => u.onend && u.onend(), 0);
      },
      cancel() {},
      getVoices: () => [{ name: "Voix FR", lang: "fr-FR" }],
      addEventListener() {},
      removeEventListener() {},
    };
    const win = {
      speechSynthesis: synth,
      SpeechSynthesisUtterance: Utterance,
      CustomEvent: FakeCustomEvent,
      dispatchEvent(event) {
        events.push(event);
        return true;
      },
    };
    return { win, events, utterances };
  }

  it("l'annonce part AVANT le son, le signal « son » apres, et une seule fois", async () => {
    const { win, events } = fauxFenetre();
    const speaker = createSpeaker(win, { lang: "fr-FR", waitMs: 0, voiceName: "" });
    await speaker.speak("Une phrase. Deuxieme phrase. Troisieme phrase.");
    await tick();
    const types = events.map((e) => e.type);
    const annonce = types.indexOf(READ_ALOUD_STATE_EVENT);
    const son = types.indexOf(READ_ALOUD_SOUND_EVENT);
    expect(annonce).toBeGreaterThanOrEqual(0);
    expect(events[annonce].detail.state).toBe("speaking");
    // LE SON VIENT APRES L'ANNONCE : c'est tout le defaut corrige.
    expect(son).toBeGreaterThan(annonce);
    // UNE seule fois par lecture, meme avec trois morceaux.
    expect(types.filter((t) => t === READ_ALOUD_SOUND_EVENT)).toHaveLength(1);
  });

  it("une synthese qui ne dit jamais « onstart » n'emet aucun signal (rien n'a sonne)", async () => {
    const { win, events } = fauxFenetre({ onstart: false });
    const speaker = createSpeaker(win, { lang: "fr-FR", waitMs: 0, voiceName: "" });
    await speaker.speak("Une phrase.");
    await tick();
    expect(events.filter((e) => e.type === READ_ALOUD_SOUND_EVENT)).toHaveLength(0);
  });

  it("voix locale : le signal part au DEMARRAGE de la lecture audio, pas a la synthese", async () => {
    const demarrages = [];
    let demarrer = null;
    let arreter = null;
    class FakeAudio {
      constructor(src) {
        this.src = src;
      }
      play() {
        return new Promise((resolve) => {
          demarrer = resolve;
        });
      }
      pause() {}
    }
    const lecture = playLocalChunks({
      win: { Audio: FakeAudio },
      chunks: ["Bonjour."],
      synthesize: async () => "UklGRg==",
      onStopRegister: (stop) => {
        arreter = stop;
      },
      onSoundStart: () => demarrages.push("son"),
    });
    await tick();
    // La synthese est finie, le son n'a pas encore commence : rien n'est annonce.
    expect(demarrages).toHaveLength(0);
    demarrer(); // la lecture audio demarre vraiment
    await tick();
    expect(demarrages).toHaveLength(1);
    arreter(); // le son factice ne se termine pas tout seul
    const fin = await lecture;
    expect(fin.reason).toBe("stopped");
  });
});

// ---------------------------------------------------------------------------
// 5. AUCUN SEUIL NE BOUGE, ET LE BRANCHEMENT EST COMPLET (lecture des sources).
describe("5. seuils intacts et branchement complet", () => {
  it("aucune constante de decision n'a ete ajoutee ni renommee", () => {
    const constantes = (MIC.match(/export const (BARGE_IN_[A-Z_]+)/g) || [])
      .map((ligne) => ligne.replace("export const ", ""))
      .sort();
    expect(constantes).toEqual(
      [
        "BARGE_IN_CALIBRATION_MS",
        "BARGE_IN_FALLBACK_FACTOR",
        "BARGE_IN_FALLBACK_MS",
        "BARGE_IN_MAX_STEP_MS",
        "BARGE_IN_MIN_LEVEL",
        "BARGE_IN_MIN_MS",
        "BARGE_IN_RESIDUAL_FACTOR",
        "BARGE_IN_RESIDUAL_MAX",
        "BARGE_IN_RESIDUAL_UNPROVEN_MAX",
      ].sort()
    );
    // La garde pure n'est pas touchee par ce correctif.
    expect(MIC).toMatch(/function stepSpeechGate\(etat, mesure, contexte = \{\}\)/);
    expect((MIC.match(/calibreMs - dt < BARGE_IN_MIN_MS/g) || []).length).toBe(1);
  });

  it("setSoundStarted rouvre la fenetre sans toucher a un seul seuil", () => {
    const corps = corpsFonction(MIC, "function setSoundStarted(");
    expect(corps).toMatch(/garde = emptySpeechGate\(\)/);
    expect(corps).toMatch(/dernierTemps = 0/);
    expect(corps).not.toMatch(/BARGE_IN_/);
    // Une seule ouverture par lecture, et rien hors lecture.
    expect(corps).toMatch(/if \(!parlant\) return;/);
    expect(corps).toMatch(/if \(sonCommence\) return;/);
    // La fin (ou le debut) de lecture remet le drapeau a zero.
    expect(corpsFonction(MIC, "function setSpeaking(")).toMatch(/sonCommence = false/);
  });

  it("le signal est branche de bout en bout (read-aloud -> ecran -> micro)", () => {
    // 1. read-aloud.js emet l'evenement...
    expect(READ).toMatch(/export const READ_ALOUD_SOUND_EVENT = "pilot-read-aloud-sound"/);
    // 2. ... au premier `onstart` de la synthese du systeme...
    expect(READ).toMatch(/utterance\.onstart = \(\) => annoncerSon\(\)/);
    // 3. ... et au demarrage reel de la lecture audio de la voix locale.
    expect(READ).toMatch(/onSoundStart: annoncerSon/);
    expect(LOCAL).toMatch(/options\.onSoundStart/);
    expect(LOCAL).toMatch(/addEventListener\("playing", annoncerDebut\)/);
    // 4. L'ecran Vocal transmet l'instant au micro (et se desabonne a la sortie).
    expect(SUPER).toMatch(/window\.addEventListener\(READ_ALOUD_SOUND_EVENT, onVocalReadAloudSound\)/);
    expect(SUPER).toMatch(/vocalMic\.setSoundStarted\(\)/);
    expect(SUPER).toMatch(/removeEventListener\(READ_ALOUD_SOUND_EVENT, onVocalReadAloudSound\)/);
    // 5. Aucun second mecanisme de lecture, aucune seconde capture du micro.
    expect((MIC.match(/md\.getUserMedia\(/g) || []).length).toBe(1);
  });

  it("la duree d'attaque et celle du secours n'ont pas bouge", () => {
    expect(BARGE_IN_MIN_MS).toBe(200);
    expect(BARGE_IN_FALLBACK_MS).toBe(1000);
  });
});
