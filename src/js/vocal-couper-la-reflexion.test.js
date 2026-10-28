// Tests — LOT 4b : « je parle pendant que Pilot réfléchit, il s'arrête »
//
// CE QUE CE FICHIER VERROUILLE (et pourquoi) :
//   1. LE CHEMIN D'ARRÊT EST RÉUTILISÉ, PAS DUPLIQUÉ. Le bouton Stop de la
//      conversation et la prise de parole passent par LA MÊME fonction
//      (`stopSuperAgentTurn`) et donc par le MÊME IPC, compté ici : un second
//      mécanisme d'arrêt, un `invoke("abort_super_agent")` de plus, feraient
//      rougir ce fichier.
//   2. UNE SEULE COUPURE PAR PRISE DE PAROLE, jamais sur un bruit court, jamais
//      sur un souffle : la garde du micro (vocal-mic.js) est la MÊME que celle
//      de la lecture, elle gagne seulement sa phase « réflexion » (pas de
//      calibrage : Pilot est muet, il n'y a pas d'écho à mesurer). AUCUN seuil
//      nouveau n'est introduit — un test le prouve sur le source.
//   3. LE CAS « PILOT LIT SA RÉPONSE » NE CHANGE PAS : la parole prime sur la
//      réflexion, et la lecture garde ses règles (calibrage du résidu d'écho).
//   4. RIEN NE CHANGE HORS DU MODE VOCAL : la fonction de coupure sort
//      immédiatement quand l'écran Vocal n'est pas affiché.
//   5. L'écran n'a gagné aucun bouton, aucun réglage, aucune ligne d'état : les
//      quatre phrases de l'écran et sa priorité d'états sont inchangées.
//
// Les commentaires sont en ASCII ; les chaînes qui viennent de l'interface sont
// copiées telles quelles.
import { vi, describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// Le projet interdit un découpage de source calculé à la main dans les tests
// (une ancre absente rendrait l'assertion vraie par construction) : on passe par
// les helpers vérifiés de source-slice.js.
import { sliceSource } from "./source-slice.js";
import {
  createVocalMic,
  stepSpeechGate,
  emptySpeechGate,
  vocalEchoThreshold,
  BARGE_IN_MIN_MS,
  BARGE_IN_MIN_LEVEL,
  BARGE_IN_CALIBRATION_MS,
  BARGE_IN_FALLBACK_MS,
} from "./vocal-mic.js";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("markdown-it", () => ({
  default: vi.fn(() => ({ use() { return this; }, render: () => "" })),
}));
vi.mock("./icons.js", () => ({ refreshIcons: vi.fn() }));
vi.mock("./backend-info.js", () => ({ agentDisplayLabel: vi.fn(), backendKind: vi.fn() }));
vi.mock("./agent-pi.js", () => ({ appendDelegatedMessage: vi.fn(), purgeAgentTabView: vi.fn() }));
vi.mock("./loop-detection.js", () => ({
  detectRepeatedBlock: vi.fn(), detectRepeatedWord: vi.fn(),
  detectRepeatedToolCalls: vi.fn(), detectSemanticLoop: vi.fn(),
  buildToolLoopFingerprint: vi.fn(),
}));
vi.mock("./desktop-notify.js", () => ({ notifySuperAgentDone: vi.fn(), playAssistantSound: vi.fn() }));
vi.mock("./agents.js", () => ({
  loadAgentRegistry: vi.fn(), upsertAgent: vi.fn(), normalizeAgent: vi.fn(),
  validateAgentId: vi.fn(), classifyAgent: vi.fn(),
}));
vi.mock("./agents-bus.js", () => ({
  runAgentsForAssistant: vi.fn(), runAgentsForAssistantAsync: vi.fn(), setBusNotifyCallback: vi.fn(),
}));
vi.mock("./reservations.js", () => ({ estimateAndReserve: vi.fn() }));
vi.mock("./structured-brief.js", () => ({ applyAssistantBriefEnvelope: vi.fn() }));
vi.mock("./super-agent-schedule.js", () => ({
  shouldScheduleTick: vi.fn(),
  parseScheduleEvery: vi.fn(),
  formatReminderNotificationLabel: vi.fn(),
  planDueReminderInjections: vi.fn(() => ({ toInject: [], mode: "none", held: [], waitingForOwner: 0 })),
  buildReminderInjectionMessage: vi.fn(),
  formatReminderGroupNotificationLabel: vi.fn(),
  formatReminderHoldNotice: vi.fn(),
  createReminderHoldGuard: vi.fn(() => ({ reset() {}, shouldNotify: () => false })),
}));

// `super-agent.js` pose des écouteurs au chargement du module (preview.js) : un
// `window` minimal suffit, comme dans ecran-vocal-lot2.test.js.
if (!globalThis.window) {
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
  };
}

const { vocalInterruptTarget, vocalScreenState, vocalStatusText } = await import("./super-agent.js");

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) => readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const SUPER = lire("src/js/super-agent.js");
const MIC = lire("src/js/vocal-mic.js");

/** Fragment de source ENTRE deux ancres (vérifié : une ancre absente lève). */
function corps(debut, fin, minLen = 80) {
  return sliceSource(SUPER, debut, fin, minLen);
}

/** Même chose dans le source du moteur micro. */
function corpsMic(debut, fin, minLen = 40) {
  return sliceSource(MIC, debut, fin, minLen);
}

const combien = (texte, motif) => (texte.match(motif) || []).length;

/**
 * Joue `dureeMs` d'un niveau CONSTANT, en images de 16 ms, sur la garde du
 * micro. PURE : aucun micro, aucune fenêtre, aucune horloge réelle.
 * @returns {{etat: object, declenchements: number[]}}
 */
function jouer(niveau, dureeMs, options = {}) {
  const pas = 16;
  let etat = options.etat || emptySpeechGate();
  const declenchements = [];
  const contexte = {
    parlant: options.parlant === true,
    reflechi: options.reflechi !== false,
    dtMs: pas,
    echoAnnule: options.echoAnnule === undefined ? null : options.echoAnnule,
  };
  for (let t = 0; t < dureeMs; t += pas) {
    const r = stepSpeechGate(etat, niveau, contexte);
    etat = r.etat;
    if (r.declenche) declenchements.push(t + pas);
  }
  return { etat, declenchements };
}

/**
 * Faux micro : flux dont la piste DIT son annulation d'echo, analyseur qui rend
 * une amplitude PILOTÉE, et une horloge virtuelle (aucun test ne dépend du
 * temps réel).
 */
function fauxMicro({ niveau = 0.012, echoCancellation = true } = {}) {
  const journal = { demandes: 0, stops: 0, paroles: [], niveau };
  const piste = {
    kind: "audio",
    readyState: "live",
    stop() {
      journal.stops += 1;
    },
    addEventListener() {},
    getSettings() {
      return echoCancellation === null ? {} : { echoCancellation };
    },
  };
  const flux = { getTracks: () => [piste] };
  const analyseur = {
    fftSize: 1024,
    smoothingTimeConstant: 0,
    getFloatTimeDomainData(tampon) {
      for (let k = 0; k < tampon.length; k += 1) tampon[k] = journal.niveau;
    },
  };
  const contexte = {
    state: "running",
    createMediaStreamSource: () => ({ connect() {} }),
    createAnalyser: () => analyseur,
    close: () => Promise.resolve(),
  };
  const images = [];
  let horloge = 0;
  const options = {
    navigator: {
      mediaDevices: {
        getUserMedia() {
          journal.demandes += 1;
          return Promise.resolve(flux);
        },
      },
    },
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
  function jouerImages(n = 1) {
    let jouees = 0;
    while (jouees < n) {
      const idx = images.findIndex((c) => typeof c === "function");
      if (idx === -1) return;
      const cb = images[idx];
      images[idx] = null;
      jouees += 1;
      horloge += 16;
      cb();
    }
  }
  return { journal, options, jouerImages };
}

// ---------------------------------------------------------------------------
describe("1. le chemin d'arret est REUTILISE, pas duplique", () => {
  it("le bouton Stop et la voix passent par la MEME fonction", () => {
    const arret = corps("async function stopSuperAgentTurn() {", "\n  toolbar.addEventListener");
    expect(arret).toMatch(/await invoke\("abort_super_agent"\)/);
    // UN SEUL IPC d'arrete dans la fonction partagee : elle ne fait pas deux
    // choses differentes selon l'appelant.
    expect(combien(arret, /invoke\("abort_super_agent"\)/g)).toBe(1);
    // Le lecteur de son differe est remis a zero, comme avant l'extraction.
    expect(arret).toMatch(/resetDeferredSound\(\)/);
    // L'arrete reste MANUEL : exception declaree, jamais journalisee comme un
    // arret automatique (regle 3 du projet).
    expect(arret).toContain("R3-EXCEPTION-MANUEL");

    // Le clic sur Stop emprunte cette fonction, il n'ecrit plus l'IPC lui-meme.
    const clic = corps('if (action === "abort") {', '} else if (action === "new-session") {', 20);
    expect(clic).toMatch(/await stopSuperAgentTurn\(\)/);
    expect(clic).not.toContain('invoke("abort_super_agent")');
  });

  it("la prise de parole n'ajoute AUCUN site d'arrete (cardinalite inchangee)", () => {
    // 3 = 2 arrets AUTOMATIQUES sur boucle (traces) + 1 arret MANUEL partage
    // par le bouton Stop et par la voix. Le lot 4b n'en ajoute pas un 4e : il
    // rejoint le troisieme.
    expect(combien(SUPER, /invoke\("abort_super_agent"\)/g)).toBe(3);
    // Une SEULE definition, et exactement deux appelants (bouton Stop, prise de
    // parole) : un troisieme appelant serait un second mecanisme d'arrete.
    expect(combien(SUPER, /async function stopSuperAgentTurn\(\)/g)).toBe(1);
    expect(combien(SUPER, /(?:await |void )stopSuperAgentTurn\(\)/g)).toBe(2);
  });

  it("la coupure vocale ne contient AUCUN IPC et n'arrete que ce qu'il faut", () => {
    const coupure = corps("function vocalBargeIn(rapport) {", "\n  function enterVocal() {");
    // Aucun IPC ecrit ici : l'arrete du travail passe par la fonction partagee.
    expect(coupure).not.toMatch(/invoke\(/);
    // Les deux seules voies existantes, choisies par la decision pure.
    expect(coupure).toMatch(/if \(cible === "lecture"\) stopReading\(\);/);
    expect(coupure).toMatch(/stopSuperAgentTurn\(\)/);
    // Une seule fois : aucun delai, aucune reprise, aucun second essai.
    expect(combien(coupure, /stopSuperAgentTurn\(\)/g)).toBe(1);
    expect(coupure).not.toMatch(/setTimeout|setInterval/);
    // Hors mode Vocal, rien ne se passe (les autres ecrans sont inchanges).
    expect(coupure).toMatch(/if \(!vocalOverlay\) return;/);
  });
});

// ---------------------------------------------------------------------------
describe("2. la decision : la parole prime, la reflexion ensuite, rien au repos", () => {
  it("Pilot qui PARLE garde la priorite (comportement du lot 4a inchange)", () => {
    expect(vocalInterruptTarget({ speaking: true, reflecting: true })).toBe("lecture");
    expect(vocalInterruptTarget({ speaking: true, reflecting: false })).toBe("lecture");
  });

  it("Pilot qui REFLECHIT est interrompu", () => {
    expect(vocalInterruptTarget({ reflecting: true })).toBe("reflexion");
    expect(vocalInterruptTarget({ speaking: false, reflecting: true })).toBe("reflexion");
  });

  it("au repos et sur une valeur approchee, parler ne coupe RIEN", () => {
    expect(vocalInterruptTarget({})).toBe("");
    expect(vocalInterruptTarget(null)).toBe("");
    expect(vocalInterruptTarget({ reflecting: "true", speaking: 1 })).toBe("");
  });
});

// ---------------------------------------------------------------------------
describe("3. la garde : UNE coupure par prise de parole, jamais sur un bruit court", () => {
  it("le silence ne coupe jamais (10 s)", () => {
    expect(jouer(0, 10000).declenchements).toEqual([]);
    // Un souffle regulier sous le plancher de bruit non plus.
    expect(jouer(BARGE_IN_MIN_LEVEL - 0.01, 10000).declenchements).toEqual([]);
  });

  it("un bruit COURT (une image) ne coupe pas", () => {
    expect(jouer(0.4, 16).declenchements).toEqual([]);
    // Et des eclats separes par du silence ne s'additionnent pas : la voix doit
    // etre CONTINUE.
    let etat = emptySpeechGate();
    for (let i = 0; i < 5; i += 1) {
      const eclat = jouer(0.4, 16, { etat });
      expect(eclat.declenchements).toEqual([]);
      etat = jouer(0, 64, { etat: eclat.etat }).etat;
    }
  });

  it("une vraie prise de parole coupe UNE seule fois", () => {
    const debut = jouer(0.15, 2000);
    expect(debut.declenchements).toHaveLength(1);
    // Le temps de voix CONTINUE exige : jamais sur un claquement.
    expect(debut.declenchements[0]).toBeGreaterThanOrEqual(BARGE_IN_MIN_MS);
    expect(debut.declenchements[0]).toBeLessThan(BARGE_IN_MIN_MS + 40);
    // Continuer de parler ne recoupe pas : le travail n'est arrete qu'une fois.
    const suite = jouer(0.15, 4000, { etat: debut.etat });
    expect(suite.declenchements).toEqual([]);
  });

  it("la garde se rearne quand la voix retombe (une coupure par prise de parole)", () => {
    const premiere = jouer(0.15, 2000);
    expect(premiere.declenchements).toHaveLength(1);
    // La phrase est finie (retour au silence) : le tour suivant pourra etre
    // interrompu a son tour, sans delai ni reglage.
    const silence = jouer(0, 500, { etat: premiere.etat });
    expect(silence.declenchements).toEqual([]);
    const seconde = jouer(0.15, 2000, { etat: silence.etat });
    expect(seconde.declenchements).toHaveLength(1);
  });

  it("aucun calibrage pendant la reflexion : la coupure part tout de suite", () => {
    // Une voix des la premiere image : la garde coupe a `BARGE_IN_MIN_MS`, donc
    // BIEN AVANT la duree de calibrage du mode lecture. Sans cela, parler
    // pendant une reflexion laisserait Pilot travailler encore 0,6 s.
    const { declenchements } = jouer(0.2, 2000);
    expect(declenchements).toHaveLength(1);
    expect(declenchements[0]).toBeLessThan(BARGE_IN_CALIBRATION_MS);
  });

  it("Pilot qui PARLE ET reflechit garde les regles de la lecture (calibrage et echo)", () => {
    // Meme priorite que l'etat affiche : quand Pilot parle, la garde de LECTURE
    // s'applique, calibrage compris — meme si l'agent reflechit en meme temps.
    const pendantCalibrage = jouer(0.6, BARGE_IN_CALIBRATION_MS - 32, {
      parlant: true,
      reflechi: true,
      echoAnnule: true,
    });
    expect(pendantCalibrage.declenchements).toEqual([]);
    // Et un echo non maitrise ne laisse plus la lecture sans coupure : la MEME
    // voix coupe par la GARANTIE DE SECOURS du mode lecture, mais BIEN plus tard
    // que la voie normale (calibrage, puis `BARGE_IN_FALLBACK_MS` de voix tenue
    // au-dessus du son deja present) alors qu'en reflexion seule elle coupe en
    // `BARGE_IN_MIN_MS`. C'est bien l'etat qui choisit les regles, jamais un
    // chemin parallele.
    const calme = jouer(0.08, 1000, { parlant: true, reflechi: true, echoAnnule: true }).etat;
    const lecture = jouer(0.6, 2000, { etat: calme, parlant: true, reflechi: true, echoAnnule: true });
    expect(lecture.declenchements).toHaveLength(1);
    expect(lecture.declenchements[0]).toBeGreaterThanOrEqual(BARGE_IN_FALLBACK_MS);
    const reflexion = jouer(0.6, 2000);
    expect(reflexion.declenchements).toHaveLength(1);
    expect(reflexion.declenchements[0]).toBeLessThan(BARGE_IN_CALIBRATION_MS);
  });

  it("le mode « reflexion » ne pose AUCUN seuil nouveau (lecture du source)", () => {
    const branche = corpsMic("if (c.parlant !== true) {", "\n  const arme = bargeInArmed(");
    // Uniquement le plancher de bruit deja utilise par la lecture...
    expect(branche).toMatch(/vocalEchoThreshold\(0\)/);
    // ...et aucune constante inventee (ni duree, ni niveau, ni facteur).
    expect(branche).not.toMatch(/\d\.\d+/);
    expect(branche).not.toMatch(/BARGE_IN_CALIBRATION_MS|BARGE_IN_RESIDUAL/);
  });
});

// ---------------------------------------------------------------------------
describe("4. le moteur : le signal part du MEME point que pour la lecture", () => {
  it("pendant la reflexion, une vraie voix est signalee UNE fois", async () => {
    const faux = fauxMicro({ niveau: 0.012, echoCancellation: true });
    const moteur = createVocalMic(faux.options);
    expect(await moteur.demander()).toBe(true);
    moteur.setThinking(true);
    faux.jouerImages(60); // ~1 s de reflexion dans le calme
    expect(faux.journal.paroles).toHaveLength(0);
    expect(moteur.bargeInReport().pendant).toBe("reflexion");
    faux.journal.niveau = 0.15; // l'utilisateur prend la parole
    faux.jouerImages(40); // ~640 ms
    expect(faux.journal.paroles).toHaveLength(1);
    // Continuer de parler ne recoupe pas.
    faux.jouerImages(60);
    expect(faux.journal.paroles).toHaveLength(1);
    moteur.fermer();
  });

  it("hors reflexion, le meme micro ne signale rien (etat remis a zero)", async () => {
    const faux = fauxMicro({ niveau: 0.012, echoCancellation: true });
    const moteur = createVocalMic(faux.options);
    await moteur.demander();
    moteur.setThinking(true);
    faux.journal.niveau = 0.15;
    faux.jouerImages(30);
    expect(faux.journal.paroles).toHaveLength(1);
    moteur.setThinking(false);
    expect(moteur.bargeInReport().motif).toBe("hors-lecture");
    expect(moteur.bargeInReport().pendant).toBe("");
    faux.jouerImages(120);
    expect(faux.journal.paroles).toHaveLength(1);
    moteur.fermer();
  });
});

// ---------------------------------------------------------------------------
describe("5. le branchement : l'etat de reflexion de l'ecran arme la garde", () => {
  it("une seule source d'etat : `reflectingActive` (celle de l'ecran)", () => {
    const bascule = corps("superSetReflecting = (reflecting) => {", "\n  // ── Chargement de la liste");
    expect(bascule).toMatch(/reflectingActive = !!reflecting;/);
    expect(bascule).toMatch(/vocalSyncMicThinking\(\)/);
    // Même signal que l'écran : aucune seconde source de verite.
    expect(bascule).toMatch(/applyVocalState\(\)/);
  });

  it("le moteur micro ne recoit l'etat que d'un seul endroit", () => {
    const sync = corps("function vocalSyncMicThinking() {", "function vocalBargeIn(rapport) {");
    expect(sync).toMatch(/vocalMic\.setThinking\(reflectingActive === true\)/);
    // Un seul appel de `setThinking` dans tout le fichier de l'ecran.
    expect(combien(SUPER, /\.setThinking\(/g)).toBe(1);
  });

  it("une reflexion DEJA en cours a l'ouverture de l'ecran est reposee", () => {
    const entree = corps("function enterVocal() {", "\n  function exitVocal() {");
    expect(entree).toMatch(/vocalSyncMicThinking\(\)/);
    // Le meme point de branchement que la lecture (aucun second moteur micro).
    expect(combien(SUPER, /createVocalMic\(/g)).toBe(1);
    expect(entree).toMatch(/onSpeechStart: vocalBargeIn/);
  });
});

// ---------------------------------------------------------------------------
describe("6. ce qui ne devait pas changer", () => {
  it("l'ecran Vocal n'a gagne ni bouton, ni ligne d'etat", () => {
    const ecran = corps("function buildVocalOverlay() {", "function applyVocalState() {");
    // Aucun nouveau noeud d'action : le seul bouton ajoute par le lot 3 est
    // celui du micro ferme, inchange.
    expect(ecran).not.toMatch(/data-action/);
    expect(ecran).not.toMatch(/stopSuperAgentTurn|vocalInterruptTarget/);
    // Les quatre phrases de l'ecran et leur priorite sont inchangees.
    expect(vocalStatusText("idle")).toBe("Je vous écoute.");
    expect(vocalStatusText("listening")).toBe("Je vous écoute…");
    expect(vocalStatusText("thinking")).toBe("Je réfléchis…");
    expect(vocalStatusText("speaking")).toBe("Je réponds.");
    expect(vocalScreenState({ speaking: true, reflecting: true, listening: true })).toBe("speaking");
    expect(vocalScreenState({ reflecting: true, listening: true })).toBe("thinking");
  });

  it("aucun reglage nouveau, aucune memoire : la garde ne lit ni config ni stockage", () => {
    const garde = corpsMic("if (c.parlant !== true) {", "\n  const arme = bargeInArmed(");
    expect(garde).not.toMatch(/localStorage|get_config|save_config|invoke\(/);
    // Le moteur micro non plus : tout son etat vient de l'appelant.
    expect(MIC).not.toMatch(/localStorage|get_config|save_config/);
  });

  it("l'arret de LECTURE reste un arret d'ecoute (lot 4a intact)", () => {
    const coupure = corps("function vocalBargeIn(rapport) {", "\n  function enterVocal() {");
    // La lecture s'arrete par la voie existante, sans arreter de travail.
    expect(coupure).toMatch(/stopReading\(\)/);
    expect(coupure).not.toMatch(/speechSynthesis|new Audio\(|\.click\(\)/);
    // La saisie reprend la main dans les deux cas.
    expect(coupure).toMatch(/inputEl\.focus\(\)/);
  });
});
