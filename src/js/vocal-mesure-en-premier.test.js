// Tests — CORRECTIF « LA MESURE DU NIVEAU EN PREMIER » (ecran Vocal).
//
// Le defaut corrige : deux captures micro coexistaient dans l'ecran Vocal — la
// MESURE du niveau (longueur du trait, detection de prise de parole) et la
// DICTEE (transcription). Un commit precedent avait inverse l'ordre : la dictee
// s'ouvrait ~350 ms apres l'entree, la mesure seulement au PREMIER GESTE. La
// dictee passait donc en premier, et si le pilote audio refusait la SECONDE
// capture, c'est la MESURE qui echouait : trait fige et « Le micro est occupe
// par une autre application » affiche alors que la dictee fonctionnait — une
// panne fantome permanente.
//
// CE QUE CE FICHIER VERROUILLE :
//   1. la MESURE s'ouvre a l'ENTREE du mode, AVANT tout armement de la dictee ;
//   2. si la mesure n'a pas pu s'ouvrir, la dictee ne s'arme PAS (regle
//      `mesure-fermee`) — la panne affichee est celle du micro, la seule phrase
//      existante, et le trait n'est pas casse par une dictee qui, elle, marche ;
//   3. aucun armement tant que la SENSIBILITE du projet n'est pas connue (regle
//      `sensibilite-inconnue`) : la transcription cloud ne s'ouvre jamais sur un
//      projet 🔒 dont l'etat n'est pas encore revenu ;
//   4. UNE entree dans le mode ne demande pas le micro deux fois (une seule voie
//      de demande, `requestVocalMeasure` → `vocalMic.demander()`) ;
//   5. les verrous existants tiennent : aucune API micro dans super-agent.js,
//      point d'application unique de la conversation, une seule session de
//      dictee (`new SR()`).
//
// Les commentaires sont en ASCII ; les chaines qui viennent de l'interface sont
// copiees telles quelles.
import { vi, describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  decideVocalDictation,
  planVocalConversation,
  VOCAL_DICTATION_ARM,
  VOCAL_DICTATION_DISARM,
} from "./vocal-conversation.js";
import { shouldAskVocalMic } from "./vocal-mic.js";
import { neutraliserSource } from "./source-slice.js";

// `super-agent.js` touche `window` au chargement et importe des modules Tauri :
// memes doublures que les autres tests d'ecran Vocal, posees AVANT l'import.
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
if (!globalThis.window) {
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
  };
}

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) => readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const SUPER = lire("src/js/super-agent.js");
const MIC = lire("src/js/vocal-mic.js");
// Le CODE seulement (commentaires et chaines neutralises) pour les COMPTAGES :
// une phrase de commentaire qui cite `vocalMic.demander()` ne doit pas faire
// croire a une seconde voie de demande.
const SUPER_CODE = neutraliserSource(SUPER);

/** Corps d'une fonction du module (jusqu'a la premiere accolade en colonne 3). */
function corpsFonction(src, entete) {
  const i = src.indexOf(entete);
  expect(i, `fonction absente : ${entete}`).toBeGreaterThan(-1);
  const fin = src.indexOf("\n  }", i);
  return src.slice(i, fin > -1 ? fin : undefined);
}

// ---------------------------------------------------------------------------
describe("1. la MESURE s'ouvre a l'entree, AVANT la dictee", () => {
  it("la decision n'arme rien tant que la mesure n'est pas ouverte", () => {
    const d = decideVocalDictation({ modeOuvert: true, sensibiliteConnue: true, mesureOuverte: false });
    expect(d.action).toBe(VOCAL_DICTATION_DISARM);
    expect(d.raison).toBe("mesure-fermee");
    // Des que la mesure est ouverte, le meme etat arme : c'est bien la mesure
    // (et rien d'autre) qui manquait.
    const ouvert = decideVocalDictation({ modeOuvert: true, sensibiliteConnue: true, mesureOuverte: true });
    expect(ouvert.action).toBe(VOCAL_DICTATION_ARM);
    expect(ouvert.raison).toBe("au-repos");
  });

  it("la mesure se decide sur l'etat REELLEMENT ouvert du micro", () => {
    // `mesureOuverte` n'est pas un souhait : c'est `vocalMicListening`, pose par
    // le moteur apres l'ouverture reelle de la capture.
    expect(corpsFonction(SUPER, "function vocalConversationState")).toMatch(
      /mesureOuverte:\s*vocalMicListening === true/,
    );
  });

  it("l'entree du mode demande la mesure AVANT le premier apply (donc avant l'armement)", () => {
    const entree = corpsFonction(SUPER, "function enterVocal");
    const demande = entree.indexOf('requestVocalMeasure("entree")');
    expect(demande).toBeGreaterThan(-1);
    // L'armement ne part que de `applyVocalState` → `vocalSyncConversation` :
    // la demande de mesure doit donc la PRECEDER dans le corps de l'entree.
    const armement = entree.lastIndexOf("applyVocalState()");
    expect(armement).toBeGreaterThan(demande);
    // Et la sensibilite est relue avant, elle aussi (regle 7b).
    const sensibilite = entree.indexOf("refreshVocalSensitivity()");
    expect(sensibilite).toBeGreaterThan(-1);
    expect(sensibilite).toBeLessThan(armement);
  });

  it("la mesure n'est plus demandee au premier geste (aucun second mecanisme)", () => {
    // L'ecouteur de geste qui demandait le micro a disparu : il ne reste que
    // l'entree et le bouton de reprise, tous deux passant par la MEME fonction.
    expect(SUPER_CODE).not.toMatch(/onVocalFirstGesture/);
    expect((SUPER_CODE.match(/requestVocalMeasure\(/g) || []).length).toBe(3); // definition + 2 appels
    expect((SUPER_CODE.match(/vocalMic\.demander\(\)/g) || []).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("2. mesure fermee : la dictee ne s'arme pas, la panne affichee est celle du micro", () => {
  it("aucun armement n'est programme quand la mesure a echoue", () => {
    // Aucun delai d'armement n'est rendu : rien ne sera programme.
    const calme = planVocalConversation(
      { modeOuvert: true, sensibiliteConnue: true, mesureOuverte: false },
      { dicteeOuverte: false, minuteur: false },
    );
    expect(calme.raison).toBe("mesure-fermee");
    expect(calme.delai).toBe(0);
    // Et un armement DEJA programme est annule.
    const attente = planVocalConversation(
      { modeOuvert: true, sensibiliteConnue: true, mesureOuverte: false },
      { dicteeOuverte: false, minuteur: true },
    );
    expect(attente.couper).toBe(true);
    expect(attente.delai).toBe(0);
  });

  it("la ligne d'etat dit la panne du micro, avec la phrase EXISTANTE", () => {
    // La ligne d'etat n'invente rien : le message du micro passe avant les
    // raisons de la dictee, et le bouton de reprise est le seul remede.
    const ligne = corpsFonction(SUPER, "function vocalStatusLine");
    expect(ligne).toMatch(/if \(vocalMicFerme\) return vocalMicFerme;/);
    // Le module du micro n'a pas gagne de second etat de panne.
    expect((MIC.match(/MIC_FERME|MIC_ABSENT|MIC_OCCUPE|MIC_MUET/g) || []).length).toBeGreaterThan(0);
    expect(MIC).not.toMatch(/MIC_MESURE|MIC_PARTIEL/);
  });

  it("la dictee n'est pas ouverte pour autant (aucune capture fantome)", () => {
    // L'armement programme reverifie la MEME decision au moment d'ouvrir : la
    // mesure tombe entre-temps, la dictee ne part pas.
    const applique = corpsFonction(SUPER, "function vocalApplyConversationPlan");
    expect(applique).toMatch(
      /if \(decideVocalDictation\(vocalConversationState\(\)\)\.action !== VOCAL_DICTATION_ARM\) return;/,
    );
  });
});

// ---------------------------------------------------------------------------
describe("3. aucun armement tant que la sensibilite du projet n'est pas connue", () => {
  it("la decision refuse d'ouvrir avant la reponse, et le dit par sa raison", () => {
    const d = decideVocalDictation({ modeOuvert: true, mesureOuverte: true, sensibiliteConnue: false });
    expect(d.action).toBe(VOCAL_DICTATION_DISARM);
    expect(d.raison).toBe("sensibilite-inconnue");
    // Sans le drapeau du tout (appelant qui ne le fournit pas), meme refus :
    // l'oubli est du cote sur, jamais du cote « on ouvre quand meme ».
    expect(decideVocalDictation({ modeOuvert: true, mesureOuverte: true }).raison).toBe(
      "sensibilite-inconnue",
    );
  });

  it("un projet sensible reste refuse AVANT tout le reste (regle inchangee)", () => {
    const d = decideVocalDictation({ modeOuvert: true, projetSensible: true, mesureOuverte: true });
    expect(d.action).toBe(VOCAL_DICTATION_DISARM);
    expect(d.raison).toBe("projet-sensible");
  });

  it("la reponse est ATTENDUE : le drapeau n'est vrai qu'apres l'IPC", () => {
    const relu = corpsFonction(SUPER, "function refreshVocalSensitivity");
    // Avant l'appel : inconnue.
    expect(relu).toMatch(/vocalSensibiliteConnue = false;[\s\S]*invoke\("is_project_sensitive"/);
    // Apres l'appel (succes ET echec) : connue, puis etat reapplique.
    expect(relu).toMatch(/vocalSensibiliteConnue = true;/);
    expect(relu).toMatch(/if \(vocalOverlay\) applyVocalState\(\);/);
    // Aucun projet ouvert : rien a demander, et c'est CONNU (mode utilisable).
    expect(relu).toMatch(/vocalProjectSensible = false;\s*\n\s*vocalSensibiliteConnue = true;/);
  });

  it("un changement de projet est relu, et l'ecouteur est retire a la sortie", () => {
    // Meme relecture que l'entree, branchee sur l'evenement existant.
    expect(SUPER).toMatch(
      /document\.addEventListener\("pilot-project-sensitivity", onVocalProjectSensitivity\)/,
    );
    expect(SUPER).toMatch(
      /document\.removeEventListener\("pilot-project-sensitivity", onVocalProjectSensitivity\)/,
    );
    expect((SUPER.match(/refreshVocalSensitivity\(\);/g) || []).length).toBeGreaterThan(-1);
  });

  it("le geste 🎙️ n'ouvre pas au hasard pendant l'attente", () => {
    const geste = corpsFonction(SUPER, "function toggleVoiceInput");
    // Pendant l'attente (reponse pas encore arrivee) : le geste n'ouvre pas au
    // hasard. MAIS une fois l'attente BORNEE sans reponse, le projet est
    // « non verifie » : le geste DOIT fonctionner (sinon le bouton rendait la
    // main en silence — defaut corrige). D'ou la seconde moitie de la garde.
    expect(geste).toMatch(
      /if \(!vocalSensibiliteConnue && !vocalSensibiliteIndisponible\) return;/,
    );
    // Le refus « projet sensible » existe toujours, avec sa phrase.
    expect(geste).toMatch(/vocalProjectSensible/);
  });
});

// ---------------------------------------------------------------------------
describe("4. une entree dans le mode ne demande pas le micro deux fois", () => {
  it("la garde de demande refuse la seconde demande", () => {
    expect(shouldAskVocalMic({ entree: true, dejaDemande: false })).toBe(true);
    // La meme entree redemandee, ou un geste apres l'entree : rien de plus.
    expect(shouldAskVocalMic({ entree: true, dejaDemande: true })).toBe(false);
    expect(shouldAskVocalMic({ geste: true, dejaDemande: true })).toBe(false);
    // Micro deja ouvert par la mesure : on ne le rouvre pas.
    expect(shouldAskVocalMic({ entree: true, dejaDemande: false, microActif: true })).toBe(false);
  });

  it("il n'existe qu'UNE voie de demande, et elle porte la garde", () => {
    const demande = corpsFonction(SUPER, "function requestVocalMeasure(origine)");
    expect(demande).toMatch(/entree: origine === "entree"/);
    expect(demande).toMatch(/geste: origine !== "entree"/);
    expect(demande).toMatch(/dejaDemande: vocalMicDemande/);
    expect(demande).toMatch(/microActif: vocalMicListening/);
    expect(demande).toContain("vocalMic.demander()");
    // Aucune autre demande ecrite a la main dans tout le module.
    expect((SUPER_CODE.match(/vocalMic\.demander\(\)/g) || []).length).toBe(1);
    // Le bouton de reprise leve la garde AVANT de relancer la MEME demande.
    const entree = corpsFonction(SUPER, "function enterVocal");
    expect(entree).toMatch(/vocalMicDemande = false;[\s\S]{0,200}requestVocalMeasure\("geste"\)/);
  });
});

// ---------------------------------------------------------------------------
describe("5. les verrous existants tiennent", () => {
  it("aucune API micro dans super-agent.js", () => {
    expect(SUPER).not.toMatch(/getUserMedia|AudioContext|AnalyserNode|mediaDevices/);
  });

  it("le moteur du micro ne demande rien de lui-meme", () => {
    const jusquaDemande = MIC.indexOf("async function demander");
    expect(jusquaDemande).toBeGreaterThan(-1);
    expect(MIC.slice(0, jusquaDemande)).not.toMatch(/getUserMedia\(/);
  });

  it("un seul point d'application de la conversation, une seule session de dictee", () => {
    expect((SUPER.match(/vocalSyncConversation\(\);/g) || []).length).toBe(1);
    expect((SUPER.match(/new SR\(\)/g) || []).length).toBe(1);
  });

  it("le trait continue d'animation pendant la dictee (aucune suspension)", () => {
    // Le correctif ne touche ni les seuils de coupure ni l'animation : la mesure
    // ne sert qu'a la longueur du trait, jamais a la dictee.
    expect(MIC).toMatch(/export function smoothLevel/);
    expect(MIC).not.toMatch(/BARGE_IN_VOICE_ON =/);
    expect(SUPER).not.toMatch(/vocalSetLevel[\s\S]{0,200}voiceActive/);
  });
});
