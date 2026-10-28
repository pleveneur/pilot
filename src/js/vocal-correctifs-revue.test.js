// Tests — CORRECTIFS DE REVUE de l'ecran Vocal (commit f81897e)
//
// Trois defauts, trois corrections, et ce fichier les tient. Il ne teste pas
// l'ecran en entier (d'autres fichiers le font) : il verrouille ce qui etait
// FAUX et qui ne doit pas redevenir faux.
//
//   1. REPLI DE VOIX. `read-aloud.js` emet, en plus de `speaking`, deux etats de
//      repli : `local-fallback` (voix locale choisie indisponible) et
//      `system-fallback` (aucune voix du systeme dans la langue demandee). Dans
//      les deux cas Pilot PARLE. Le bouton de la bulle le savait deja (il passe
//      sur « Arreter » dans ces deux etats) ; l'ecran Vocal, non : il comparait
//      `etat === "speaking"`. Pendant tout un repli, la dictee s'armait donc en
//      pleine lecture (le micro transcrivait la voix de Pilot, la demande
//      repartait, Pilot repondait, se lisait, rearmait... : BOUCLE) et la prise
//      de parole ne faisait plus taire Pilot. La decision est desormais UNE
//      fonction pure, `isReadAloudSpeaking`, et sert les quatre chemins.
//   2. « DICTEE INDISPONIBLE » JAMAIS DIT. La decision pure connaissait deja la
//      raison `sans-transcription` et sa phrase ; la ligne d'etat ne la lisait
//      pas et affichait « Je vous écoute. » alors que rien ne s'armerait.
//   3. SESSIONS VIDES EN BOUCLE. Moteur qui rend la main sans rien transcrire :
//      l'ecoute se rearmerait indefiniment. Plafond : 3 fins vides en moins de
//      30 s suspendent l'armement automatique, et c'est un GESTE (🎙️ ou une
//      nouvelle entree dans le mode) qui le retablit — jamais le temps seul.
//
// Les commentaires sont en ASCII ; les chaines de l'interface sont copiees
// telles quelles. Les fins de ligne sont normalisees (quality-gate 3.4).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sliceSource, neutraliserSource } from "./source-slice.js";
import {
  isReadAloudSpeaking,
  READ_ALOUD_SPEAKING_STATES,
  READ_ALOUD_STATE_EVENT,
} from "./read-aloud.js";
import {
  decideVocalDictation,
  planVocalConversation,
  noteEmptyVocalSession,
  vocalDictationMessage,
  VOCAL_DICTATION_ARM,
  VOCAL_DICTATION_DISARM,
  VOCAL_DICTATION_HOLD,
  VOCAL_EMPTY_SESSION_LIMIT,
  VOCAL_EMPTY_SESSION_WINDOW_MS,
  VOCAL_MESSAGE_SANS_DICTEE,
  VOCAL_MESSAGE_DICTEE_ECHEC,
} from "./vocal-conversation.js";
import { VOICE_END_EMPTY } from "./voice-auto-send.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) =>
  readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");

const SUPER = lire("src/js/super-agent.js");
// Le source SANS les commentaires : les comptes portent sur le CODE, jamais sur
// la prose qui nomme une regle (quality-gate 3.4, incident du verrou satisfait
// par son propre commentaire).
const SUPER_CODE = neutraliserSource(SUPER);
const READ_ALOUD = lire("src/js/read-aloud.js");
const VOCAL_CONV = lire("src/js/vocal-conversation.js");
const SPEC = lire("spec_modes_ecran_vocal.md");
const README = lire("README.md");
const HELP = lire("help/overview.md");

// ---------------------------------------------------------------------------
describe("1. « Pilot parle » : une seule decision, replis de voix compris", () => {
  it("vraie pendant la lecture normale ET pendant ses deux replis", () => {
    expect(isReadAloudSpeaking("speaking")).toBe(true);
    expect(isReadAloudSpeaking("local-fallback")).toBe(true);
    expect(isReadAloudSpeaking("system-fallback")).toBe(true);
  });

  it("vraie pour CES TROIS etats, et pour eux seuls", () => {
    // La liste est la definition : si un etat de lecture est ajoute demain, il
    // doit etre ajoute ici EN CONNAISSANCE DE CAUSE (parler = micro a proteger).
    expect(READ_ALOUD_SPEAKING_STATES).toEqual([
      "speaking",
      "local-fallback",
      "system-fallback",
    ]);
    for (const etat of ["", "unavailable", "empty", "stopped", "ended", "no-voice", "idle"]) {
      expect(isReadAloudSpeaking(etat), etat).toBe(false);
    }
  });

  it("ne tombe dans aucun piege de verite (null, undefined, nombre, objet)", () => {
    for (const faux of [null, undefined, 0, 1, {}, [], true]) {
      expect(isReadAloudSpeaking(faux)).toBe(false);
    }
  });

  it("l'ecran juge comme le bouton de la bulle (aucune deuxieme regle au monde)", () => {
    // Le bouton de la bulle bascule deja sur « Arreter » pour les deux replis :
    // la lecture CONTINUE. L'ecran Vocal qui, lui, croyait au silence etait donc
    // le seul a se tromper.
    expect(READ_ALOUD).toMatch(/else if \(state === "local-fallback"\) \{\s*setState\("speaking"\);/);
    expect(READ_ALOUD).toMatch(/else if \(state === "system-fallback"\) \{\s*setState\("speaking"\);/);
  });
});

// ---------------------------------------------------------------------------
describe("2. Le branchement : une fonction, quatre chemins, aucune chaine", () => {
  const etat = corpsFonction(SUPER, "const onVocalReadAloudState");

  it("l'affectation unique de `vocalSpeaking` passe par la decision", () => {
    expect(etat).toMatch(/vocalSpeaking = isReadAloudSpeaking\(etat\);/);
  });

  it("elle est appelee UNE fois dans tout le module, et nulle part ailleurs", () => {
    // Un second appelant pourrait diverger (c'est exactement ce qui est arrive).
    // Compte sur le CODE (commentaires neutralises), pas sur la prose.
    expect((SUPER_CODE.match(/isReadAloudSpeaking\(etat\)/g) || []).length).toBe(1);
    // Les SEULES affectations existantes : la declaration, la lecture d'etat, la
    // remise a zero a la sortie du mode. Aucune autre, et aucune par comparaison.
    expect(SUPER_CODE.match(/vocalSpeaking = [^;]+;/g)).toEqual([
      "vocalSpeaking = false;",
      "vocalSpeaking = isReadAloudSpeaking(etat);",
      "vocalSpeaking = false;",
    ]);
    // Et aucun autre endroit ne compare l'etat de lecture a la chaine d'origine.
    expect(SUPER_CODE).not.toMatch(/===\s*"speaking"/);
    expect(SUPER_CODE).not.toMatch(/state === "local-fallback"|state === "system-fallback"/);
  });

  it("les quatre chemins passent tous par `vocalSpeaking` (aucun n'est oublie)", () => {
    // armement de la dictee
    expect(corpsFonction(SUPER, "function vocalConversationState")).toMatch(
      /pilotParle:\s*vocalSpeaking === true/,
    );
    // garde du micro (prise de parole)
    expect(corpsFonction(SUPER, "function vocalSyncMicSpeaking")).toMatch(
      /vocalMic\.setSpeaking\(vocalSpeaking\)/,
    );
    // coupure
    expect(SUPER).toMatch(/speaking:\s*vocalSpeaking,\s*reflecting: reflectingActive/);
    // sortie du mode
    expect(corpsFonction(SUPER, "function exitVocal")).toMatch(/stopReading\(\)/);
  });
});

// ---------------------------------------------------------------------------
describe("3. « La dictee n'est pas disponible » est dit, au lieu d'etre promis", () => {
  it("la decision pure connait deja la raison et tient la dictee fermee", () => {
    const d = decideVocalDictation({
      modeOuvert: true,
      transcription: false,
      projetSensible: false,
      dicteeOuverte: false,
    });
    // DESARMER, pas seulement « ne pas armer » : une dictée laissée ouverte est
    // refermée et un armement en attente est annulé (la phrase l'annonce).
    expect(d.action).toBe(VOCAL_DICTATION_DISARM);
    expect(d.raison).toBe("sans-transcription");
    // La phrase existe deja : aucune n'est inventee pour l'occasion.
    expect(vocalDictationMessage("sans-transcription")).toBe(VOCAL_MESSAGE_SANS_DICTEE);
    expect(VOCAL_MESSAGE_SANS_DICTEE).toContain("écrivez votre demande");
  });

  it("la ligne d'etat l'affiche au repos, par le point d'ecriture unique", () => {
    // L'ecriture de la ligne reste la fin d'applyVocalState (verrou de l'ecran
    // nu) : elle appelle `vocalStatusLine`, qui interroge la MEME decision.
    expect(corpsFonction(SUPER, "function applyVocalState")).toMatch(
      /const texte = vocalStatusLine\(state\);/,
    );
    const ligne = corpsFonction(SUPER, "function vocalStatusLine");
    expect(ligne).toMatch(/decideVocalDictation\(vocalConversationState\(\)\)\.raison/);
    expect(ligne).toMatch(/raison === "sans-transcription"\) return VOCAL_MESSAGE_SANS_DICTEE;/);
  });

  it("la parole et la reflexion gardent la priorite sur ce message", () => {
    const ligne = corpsFonction(SUPER, "function vocalStatusLine");
    // Premier test de la fonction : tout etat anime sort avant les messages.
    expect(ligne).toMatch(/^\s*if \(state !== "idle"\) return vocalStatusText\(state\);/m);
  });
});

// ---------------------------------------------------------------------------
describe("4. Plafond des sessions vides : 3 en 30 s, puis plus d'armement", () => {
  const T0 = 1_700_000_000_000;

  it("deux fins vides ne suspendent rien, la troisieme suspend", () => {
    const a = noteEmptyVocalSession([], T0);
    expect(a.suspendu).toBe(false);
    expect(a.sessions).toHaveLength(1);
    const b = noteEmptyVocalSession(a.sessions, T0 + 1000);
    expect(b.suspendu).toBe(false);
    const c = noteEmptyVocalSession(b.sessions, T0 + 2000);
    expect(c.suspendu).toBe(true);
    expect(VOCAL_EMPTY_SESSION_LIMIT).toBe(3);
  });

  it("les fins vides ANCIENNES ne comptent plus (un silence n'est pas une boucle)", () => {
    const vieux = [T0, T0 + 1000, T0 + 2000];
    // 40 s plus tard, la fenetre de 30 s est videe : on repart de zero.
    const r = noteEmptyVocalSession(vieux, T0 + 40_000);
    expect(r.sessions).toHaveLength(1);
    expect(r.suspendu).toBe(false);
    expect(VOCAL_EMPTY_SESSION_WINDOW_MS).toBe(30_000);
  });

  it("elle est PURE : l'entree n'est jamais modifiee", () => {
    const entree = [T0];
    noteEmptyVocalSession(entree, T0 + 10);
    expect(entree).toEqual([T0]);
    // Et elle resiste a une entree absente ou abimee.
    expect(noteEmptyVocalSession(undefined, T0).suspendu).toBe(false);
    expect(noteEmptyVocalSession("n'importe quoi", T0).sessions).toHaveLength(1);
  });

  it("la decision la place apres l'arret manuel et avant les erreurs", () => {
    const suspendu = decideVocalDictation({
      modeOuvert: true,
      transcription: true,
      dicteeOuverte: false,
      sessionsVides: true,
    });
    expect(suspendu.action).toBe(VOCAL_DICTATION_HOLD);
    expect(suspendu.raison).toBe("sessions-vides");
    // Un arret manuel reste prioritaire (le geste prime sur le compteur)...
    expect(
      decideVocalDictation({ modeOuvert: true, transcription: true, arretManuel: true, sessionsVides: true })
        .raison,
    ).toBe("arret-manuel");
    // ...et le plafond passe avant un message d'erreur (il n'en cree pas un).
    expect(
      decideVocalDictation({ modeOuvert: true, transcription: true, sessionsVides: true, erreur: "micro" })
        .raison,
    ).toBe("sessions-vides");
    // Hors du mode, le plafond ne dit rien : l'ecran Vocal seul est concerne.
    expect(decideVocalDictation({ modeOuvert: false, sessionsVides: true }).raison).toBe("hors-mode");
  });

  it("elle annule un armement deja programme, sans fermer une dictee ouverte par un geste", () => {
    const plan = planVocalConversation(
      { modeOuvert: true, transcription: true, sessionsVides: true },
      { dicteeOuverte: false, minuteur: true },
    );
    expect(plan.couper).toBe(true);
    expect(plan.desarmer).toBe(false);
    expect(plan.delai).toBe(0);
    // La phrase affichee est celle qui existait deja pour une dictee en echec.
    expect(vocalDictationMessage("sessions-vides")).toBe(VOCAL_MESSAGE_DICTEE_ECHEC);
  });

  it("le compteur ne compte QUE les fins vides normales, et seulement dans l'ecran", () => {
    const compte = corpsFonction(SUPER, "function vocalNoteEmptySession");
    // Hors du mode : rien n'est compte (l'onglet agent pi ne change pas).
    expect(compte).toMatch(/if \(!vocalOverlay\) return;/);
    // Seule une fin NORMALE et VIDE compte : jamais une erreur, un arret manuel
    // ou une reprise en main (c'est `applyVoiceEnd` qui tranche, pas ce code).
    expect(compte).toMatch(/fin\.reason !== VOICE_END_EMPTY/);
    expect(compte).toMatch(/noteEmptyVocalSession\(vocalSessionsVides, Date\.now\(\)\)/);
    // Le vide est constate a UN seul endroit (voice-auto-send.js) : aucune
    // seconde detection de « pas de texte » n'est ecrite ici.
    expect(compte).not.toMatch(/dictatedText|\.trim\(\)|finalText/);
    expect(VOICE_END_EMPTY).toBe("texte-vide");
  });

  it("le verrou est pose par la fin d'ecoute et par rien d'autre", () => {
    // `onend` lit le resultat d'`applyVoiceEnd` et le passe au compteur.
    expect(SUPER).toMatch(/const fin = applyVoiceEnd\(\{/);
    expect(SUPER).toMatch(/vocalNoteEmptySession\(fin\);/);
    expect((SUPER_CODE.match(/vocalDicteeSuspendue = true/g) || []).length).toBe(1);
    // Il entre dans l'etat par le champ que la decision pure lit.
    expect(SUPER).toMatch(/sessionsVides: vocalDicteeSuspendue === true,/);
  });

  it("seul un GESTE le leve : le bouton 🎙️ et l'entree dans le mode", () => {
    const bouton = corpsFonction(SUPER, "function toggleVoiceInput");
    expect(bouton).toMatch(/vocalSessionsVides = \[\];/);
    expect(bouton).toMatch(/vocalDicteeSuspendue = false;/);
    const entree = corpsFonction(SUPER, "function enterVocal");
    expect(entree).toMatch(/vocalSessionsVides = \[\];/);
    expect(entree).toMatch(/vocalDicteeSuspendue = false;/);
    // Aucune levee par le temps : pas de minuterie, pas de remise a zero dans
    // le rearmement automatique (sinon le plafond ne servirait a rien).
    const sync = corpsFonction(SUPER, "function vocalSyncConversation");
    expect(sync).not.toMatch(/vocalDicteeSuspendue|vocalSessionsVides/);
    // Et le module de decision n'ecrit aucun etat : il ne fait que decider.
    expect(VOCAL_CONV).not.toMatch(/localStorage|Date\.now\(\)/);
  });
});

// ---------------------------------------------------------------------------
describe("5. La documentation dit la verite de l'ecran", () => {
  it("la spec distingue le micro de MESURE de la DICTEE, et nomme le repli", () => {
    expect(SPEC).toMatch(/micro de MESURE/);
    expect(SPEC).toMatch(/local-fallback/);
    expect(SPEC).toMatch(/plafond arrête les sessions vides/i);
  });

  it("le README et l'aide embarquee disent la meme chose, en langage utilisateur", () => {
    expect(README).toMatch(/micro et la dictée restent ouverts pendant tout le mode/);
    expect(README).toMatch(/trois fois de suite/);
    // Correctif « la mesure en premier » : la documentation ne dit plus que le
    // micro de mesure attend un geste — il s'ouvre des l'entree, avant la
    // dictee. C'est la phrase que l'utilisateur lit qui change ici, pas le
    // fonctionnement : ancienne attente (/micro de mesure à votre premier geste/)
    // devenue fausse, remplacee par l'ordre reel.
    expect(HELP).toMatch(/micro de mesure dès l'entrée/);
    expect(README).toMatch(/micro de mesure dès l'entrée/);
  });
});

// ---------------------------------------------------------------------------
/** Corps d'une fonction du module (`sliceSource` LEVE si l'ancre a disparu). */
function corpsFonction(source, ancre) {
  return sliceSource(source, ancre, "\n  }", 40);
}
