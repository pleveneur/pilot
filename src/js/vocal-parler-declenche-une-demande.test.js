// Tests — PARLER DANS L'ECRAN VOCAL DECLENCHE UNE DEMANDE
//
// CE QUE CE FICHIER VERROUILLE (et pourquoi) :
//   1. La dictee s'ARME toute seule au repos (aucun bouton a toucher) et se
//      DESARME pendant que Pilot parle et pendant qu'il travaille. Elle se
//      REARME apres la lecture, avec une marge de silence plus longue.
//   2. Elle ne s'arme qu'UNE fois (idempotence : ni deux sessions, ni deux
//      minuteries) et un geste explicite de l'utilisateur prime toujours.
//   3. Elle est FERMEE aux trois sorties du mode : aucun peripherique ne reste
//      ouvert derriere l'ecran.
//   4. Pendant une dictee, la voix ne peut PAS etre prise pour une prise de
//      parole (garde anti-larsen deja en place pour la lecture) : sinon Pilot
//      se couperait sur les mots qu'on lui dicte. Les seuils ne bougent pas.
//   5. Une panne de dictee se VOIT dans l'unique ligne d'etat : la conversation
//      n'est pas affichee dans cet ecran, donc une erreur ecrite dans les
//      messages serait INVISIBLE. Le clavier reste utilisable.
//   6. Aucun second moteur de transcription, aucun second envoi : une seule
//      voie de demarrage (`startVoiceInput`) et le chemin d'envoi EXISTANT.
//
// Les commentaires sont en ASCII ; les chaines qui viennent du code sont
// copiees telles quelles.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sliceSource } from "./source-slice.js";
import {
  VOCAL_ARM_DELAY_MS,
  VOCAL_ARM_AFTER_READ_MS,
  VOCAL_DICTATION_ARM,
  VOCAL_DICTATION_DISARM,
  VOCAL_DICTATION_HOLD,
  VOCAL_MESSAGE_DICTEE_ECHEC,
  VOCAL_MESSAGE_MIC_OCCUPE,
  VOCAL_MESSAGE_MIC_REFUSE,
  VOCAL_MESSAGE_RESEAU,
  VOCAL_MESSAGE_SENSIBLE,
  VOCAL_MESSAGE_SANS_DICTEE,
  decideVocalDictation,
  planVocalConversation,
  vocalDictationMessage,
} from "./vocal-conversation.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) =>
  readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");

// Le source peut arriver en CRLF (runner Windows) : `lire` normalise AVANT toute
// recherche d'ancre multi-lignes (quality-gate 3.4).
const SUPER = lire("src/js/super-agent.js");
const MODULE = lire("src/js/vocal-conversation.js");

/** Corps d'une fonction (ancre de fin : la fermeture en colonne 2). */
function corpsFonction(src, entete) {
  return sliceSource(src, entete, "\n  }\n", 40);
}

// ── 1. Les decisions pures ─────────────────────────────────────────────────
describe("decision : quand la dictee s'arme et quand elle se desarme", () => {
  // Correctif « mesure en premier » : l'armement automatique exige desormais
  // DEUX faits etablis, en plus de l'etat de conversation — la MESURE du niveau
  // est ouverte (`mesureOuverte`) et la sensibilite du projet est connue
  // (`sensibiliteConnue`). Ces deux drapeaux sont donc passes aux tests qui
  // attendent un ARMEMENT : sans eux, la decision refuse d'ouvrir, ce qui est
  // exactement la regle 7b/7c (verifiee dans
  // `vocal-mesure-en-premier.test.js`).
  const PRET = { sensibiliteConnue: true, mesureOuverte: true };

  it("au repos, la dictee s'ARME toute seule (aucun bouton a toucher)", () => {
    const d = decideVocalDictation({ modeOuvert: true, ...PRET });
    expect(d.action).toBe(VOCAL_DICTATION_ARM);
    expect(d.raison).toBe("au-repos");
    expect(d.delai).toBe(VOCAL_ARM_DELAY_MS);
  });

  it("apres la lecture d'une reponse, elle se REARME avec une marge plus longue", () => {
    const d = decideVocalDictation({ modeOuvert: true, apresLecture: true, ...PRET });
    expect(d.action).toBe(VOCAL_DICTATION_ARM);
    expect(d.raison).toBe("apres-lecture");
    expect(d.delai).toBe(VOCAL_ARM_AFTER_READ_MS);
    // La marge est bien PLUS longue : la voix de Pilot sort encore des
    // haut-parleurs quand le dernier mot est prononce.
    expect(VOCAL_ARM_AFTER_READ_MS).toBeGreaterThan(VOCAL_ARM_DELAY_MS);
  });

  it("pendant que Pilot PARLE, la dictee est DESARMEE (on ne se transcrit pas soi-meme)", () => {
    const d = decideVocalDictation({ modeOuvert: true, pilotParle: true });
    expect(d.action).toBe(VOCAL_DICTATION_DISARM);
    expect(d.raison).toBe("pilot-parle");
  });

  it("pendant que Pilot TRAVAILLE, la dictee est DESARMEE (le tour en cours prime)", () => {
    expect(decideVocalDictation({ modeOuvert: true, reflechit: true }).raison).toBe("tour-en-cours");
    expect(decideVocalDictation({ modeOuvert: true, occupe: true }).raison).toBe("tour-en-cours");
    // Les deux a la fois ne changent rien.
    expect(
      decideVocalDictation({ modeOuvert: true, reflechit: true, occupe: true }).action
    ).toBe(VOCAL_DICTATION_DISARM);
  });

  it("hors du mode Vocal, cet ecran n'arme RIEN", () => {
    const d = decideVocalDictation({ modeOuvert: false });
    expect(d.action).toBe(VOCAL_DICTATION_DISARM);
    expect(d.raison).toBe("hors-mode");
  });

  it("un projet SENSIBLE ne dicte jamais (dictee cloud interdite, regle inchangee)", () => {
    const d = decideVocalDictation({ modeOuvert: true, projetSensible: true });
    expect(d.action).toBe(VOCAL_DICTATION_DISARM);
    expect(d.raison).toBe("projet-sensible");
    // Le refus du projet sensible passe AVANT tout le reste, meme au repos.
    expect(decideVocalDictation({ projetSensible: true }).raison).toBe("projet-sensible");
  });

  it("une session deja ouverte n'est PAS rouverte (idempotence)", () => {
    const d = decideVocalDictation({ modeOuvert: true, dicteeOuverte: true });
    expect(d.action).toBe(VOCAL_DICTATION_HOLD);
    expect(d.raison).toBe("deja-ouverte");
    expect(d.delai).toBe(0);
  });

  it("un ARRET MANUEL prime sur l'automatisme (le geste de l'utilisateur)", () => {
    const d = decideVocalDictation({ modeOuvert: true, arretManuel: true });
    expect(d.action).toBe(VOCAL_DICTATION_HOLD);
    expect(d.raison).toBe("arret-manuel");
  });

  it("une erreur en cours n'est pas relancee en boucle", () => {
    const d = decideVocalDictation({ modeOuvert: true, erreur: "Micro refusé" });
    expect(d.action).toBe(VOCAL_DICTATION_DISARM);
    expect(d.raison).toBe("erreur");
  });

  it("sans transcription sur ce poste, rien ne s'arme (mais l'ecran reste utilisable)", () => {
    const d = decideVocalDictation({ modeOuvert: true, transcription: false });
    expect(d.action).toBe(VOCAL_DICTATION_DISARM);
    expect(d.raison).toBe("sans-transcription");
  });

  it("sans argument, la decision est celle du repos hors mode (aucune exception)", () => {
    expect(decideVocalDictation().action).toBe(VOCAL_DICTATION_DISARM);
    expect(decideVocalDictation().raison).toBe("hors-mode");
  });
});

// ── 2. Le plan (effets) : une seule session, un seul armement ──────────────
describe("plan : ce qu'il faut faire, sans rien faire", () => {
  it("desarmer ferme la session ouverte, et n'invente rien quand il n'y en a pas", () => {
    const p = planVocalConversation(
      { modeOuvert: true, pilotParle: true },
      { dicteeOuverte: true }
    );
    expect(p.desarmer).toBe(true);
    const rien = planVocalConversation({ modeOuvert: true, pilotParle: true }, {});
    expect(rien.desarmer).toBe(false);
  });

  it("un armement DEJA programme n'est jamais reprogramme (pas de report sans fin)", () => {
    const pret = { modeOuvert: true, sensibiliteConnue: true, mesureOuverte: true };
    const p = planVocalConversation(pret, { minuteur: true });
    expect(p.delai).toBe(0);
    expect(p.raison).toBe("deja-programme");
  });

  it("desarmer annule l'armement programme (aucune minuterie orpheline)", () => {
    const p = planVocalConversation({ modeOuvert: true, reflechit: true }, { minuteur: true });
    expect(p.couper).toBe(true);
    expect(p.delai).toBe(0);
    // Meme chose quand le geste de l'utilisateur a ouvert la session.
    const geste = planVocalConversation(
      { modeOuvert: true, dicteeOuverte: true, sensibiliteConnue: true, mesureOuverte: true },
      { minuteur: true },
    );
    expect(geste.couper).toBe(true);
  });

  it("le plan ne fait rien d'autre : ni session, ni minuteur, ni envoi", () => {
    // Un module PUR : aucun effet de bord, aucune dependance, aucun acces au
    // navigateur. Les commentaires sont retires avant lecture (quality-gate 3.4 :
    // un verrou ne doit pas etre satisfait par sa propre prose).
    const code = MODULE.split("\n")
      .filter((l) => !l.trimStart().startsWith("//"))
      .join("\n");
    expect(code).not.toContain("setTimeout");
    expect(code).not.toContain("window.");
    expect(code).not.toContain("document.");
    expect(code).not.toContain("import ");
    expect(code).not.toContain("SpeechRecognition");
    expect(code).not.toContain("getUserMedia");
  });
});

// ── 3. La ligne d'etat : une panne de dictee se VOIT ───────────────────────
describe("messages : la ligne d'etat dit ce qui se passe", () => {
  it("chaque panne a UNE phrase, et jamais deux lignes", () => {
    expect(vocalDictationMessage("not-allowed")).toBe(VOCAL_MESSAGE_MIC_REFUSE);
    expect(vocalDictationMessage("service-not-allowed")).toBe(VOCAL_MESSAGE_MIC_REFUSE);
    expect(vocalDictationMessage("audio-capture")).toBe(VOCAL_MESSAGE_MIC_OCCUPE);
    expect(vocalDictationMessage("network")).toBe(VOCAL_MESSAGE_RESEAU);
    expect(vocalDictationMessage("projet-sensible")).toBe(VOCAL_MESSAGE_SENSIBLE);
    expect(vocalDictationMessage("non-supporte")).toBe(VOCAL_MESSAGE_SANS_DICTEE);
    expect(vocalDictationMessage("language-not-supported")).toBe(VOCAL_MESSAGE_DICTEE_ECHEC);
    for (const phrase of [
      VOCAL_MESSAGE_MIC_REFUSE,
      VOCAL_MESSAGE_MIC_OCCUPE,
      VOCAL_MESSAGE_RESEAU,
      VOCAL_MESSAGE_SENSIBLE,
      VOCAL_MESSAGE_SANS_DICTEE,
      VOCAL_MESSAGE_DICTEE_ECHEC,
    ]) {
      expect(phrase).not.toContain("\n");
      expect(phrase.length).toBeLessThan(90);
    }
  });

  it("le silence et l'arret demande ne sont PAS des pannes (aucun message)", () => {
    expect(vocalDictationMessage("no-speech")).toBe("");
    expect(vocalDictationMessage("aborted")).toBe("");
    expect(vocalDictationMessage("")).toBe("");
    expect(vocalDictationMessage(null)).toBe("");
    expect(vocalDictationMessage(undefined)).toBe("");
  });

  it("chaque message laisse le clavier utilisable (il ne dit jamais d'attendre)", () => {
    for (const phrase of [
      VOCAL_MESSAGE_MIC_REFUSE,
      VOCAL_MESSAGE_MIC_OCCUPE,
      VOCAL_MESSAGE_RESEAU,
      VOCAL_MESSAGE_SENSIBLE,
      VOCAL_MESSAGE_SANS_DICTEE,
      VOCAL_MESSAGE_DICTEE_ECHEC,
    ]) {
      expect(phrase.toLowerCase()).toContain("écrivez");
    }
  });
});

// ── 4. Le cablage : un seul point, une seule voie, aucune fuite ────────────
describe("cablage dans super-agent.js", () => {
  it("importe le module de decision (et ne recopie aucune regle)", () => {
    expect(SUPER).toContain('} from "./vocal-conversation.js";');
    expect(SUPER).toContain("decideVocalDictation,");
    expect(SUPER).toContain("planVocalConversation,");
    // Aucune copie de la decision dans l'appelant.
    expect(SUPER).not.toContain("export function decideVocalDictation");
  });

  it("UN SEUL point d'application : la fin de applyVocalState", () => {
    const etat = corpsFonction(SUPER, "function applyVocalState()");
    expect(etat).toContain("vocalSyncConversation();");
    // Le point d'application est bien la DERNIERE instruction de la fonction :
    // la decision voit donc l'etat qui vient d'etre applique.
    const fin = etat.trimEnd();
    expect(fin.endsWith("vocalSyncConversation();\n  }") || fin.endsWith("vocalSyncConversation();")).toBe(
      true
    );
    // Une seule occurrence dans TOUT le fichier : aucun second appelant.
    expect((SUPER.match(/vocalSyncConversation\(\);/g) || [])).toHaveLength(1);
  });

  it("UNE SEULE voie de demarrage : startVoiceInput pour le geste ET pour l'armement", () => {
    const demarrage = corpsFonction(SUPER, "function startVoiceInput()");
    expect((SUPER.match(/new SR\(\)/g) || [])).toHaveLength(1);
    // Le moteur est bien construit dans la voie unique.
    expect(demarrage).toContain("const SR = window.SpeechRecognition || window.webkitSpeechRecognition;");
    expect(demarrage).toContain("rec.start();");
    // Le bouton 🎙️ lui delegue...
    const geste = corpsFonction(SUPER, "function toggleVoiceInput()");
    expect(geste).toContain("startVoiceInput();");
    expect(geste).not.toContain("new SR()");
    // ...et l'armement automatique aussi (aucun second moteur).
    const armement = corpsFonction(SUPER, "function armVoiceInput()");
    expect(armement).toContain("startVoiceInput();");
    expect(armement).not.toContain("new SR()");
  });

  it("l'armement est idempotent : jamais deux sessions, jamais deux minuteries", () => {
    const armement = corpsFonction(SUPER, "function armVoiceInput()");
    expect(armement).toContain("if (voiceActive) return;");
    const sync = corpsFonction(SUPER, "function vocalApplyConversationPlan(plan)");
    expect(sync).toContain("if (!plan.delai || vocalArmTimer) return;");
    // Une seule minuterie : une seule affectation de vocalArmTimer = setTimeout.
    expect((SUPER.match(/vocalArmTimer = setTimeout\(/g) || [])).toHaveLength(1);
  });

  it("la decision est REEVALUEE a l'echeance (l'etat a pu changer pendant l'attente)", () => {
    const plan = corpsFonction(SUPER, "function vocalApplyConversationPlan(plan)");
    expect(plan).toContain("if (decideVocalDictation(vocalConversationState()).action !== VOCAL_DICTATION_ARM) return;");
    expect(plan).toContain("armVoiceInput();");
  });

  it("les trois sorties du mode FERMENT la dictee et annulent l'armement", () => {
    const sortie = corpsFonction(SUPER, "function exitVocal()");
    expect(sortie).toContain("clearVocalArmTimer();");
    expect(sortie).toContain("if (voiceActive) stopVoiceInput();");
    // Les autres sorties passent toutes par exitVocal() (aucune ne court-circuite).
    expect(SUPER).toMatch(/function enterImmersive\([\s\S]{0,600}exitVocal\(\)/);
    expect(SUPER).toMatch(/const onExitAssistantOnly = \(\) => \{[\s\S]{0,600}exitVocal\(\)/);
    expect(SUPER).toMatch(/onVocalKeydown[\s\S]{0,600}exitVocal\(\)/);
  });

  it("la fin de lecture REARME (c'est le moment ou l'oreille se rouvre)", () => {
    const etat = corpsFonction(SUPER, "const onVocalReadAloudState = (e) => {");
    expect(etat).toContain("if (parlait && !vocalSpeaking) vocalApresLecture = true;");
    expect(etat).toContain("applyVocalState();");
  });

  it("pendant une dictee, la voix ne declenche PAS la coupure (les seuils ne bougent pas)", () => {
    const coupure = corpsFonction(SUPER, "function vocalBargeIn(rapport)");
    const garde = coupure.indexOf("if (voiceActive) return;");
    const cible = coupure.indexOf("vocalInterruptTarget(");
    expect(garde).toBeGreaterThan(-1);
    expect(cible).toBeGreaterThan(garde);
    // Aucun seuil n'est touche dans l'ecran : ceux de l'hysteresis d'ecoute
    // gardent leurs deux valeurs (0,06 pour entrer, 0,03 pour sortir).
    expect(SUPER).toContain("export const VOCAL_VOICE_ON = 0.06;");
    expect(SUPER).toContain("export const VOCAL_VOICE_OFF = 0.03;");
  });

  it("une erreur de dictee prend la LIGNE D'ETAT, jamais la conversation masquee", () => {
    const rapport = corpsFonction(SUPER, "function reportVoiceFailure(message, ecranMessage)");
    expect(rapport).toContain("vocalMicFerme = vocalDictationErreur;");
    expect(rapport).toContain("applyVocalState();");
    // Hors du mode Vocal, le message va dans la conversation (comportement inchange).
    expect(rapport).toContain("appendSystemMessage(messagesEl, texte);");
    // En mode Vocal, la conversation n'est PAS ecrite : le chemin rend la main
    // AVANT l'ecriture dans les messages (ordre verifie, pas de decoupage).
    const branche = rapport.indexOf("if (vocalOverlay) {");
    const sortie = rapport.indexOf("return;", branche);
    const conversation = rapport.indexOf("appendSystemMessage(messagesEl, texte);");
    expect(branche).toBeGreaterThan(-1);
    expect(sortie).toBeGreaterThan(branche);
    expect(conversation).toBeGreaterThan(sortie);
    // Le moteur d'erreur route bien par ce canal en mode Vocal.
    const erreur = sliceSource(SUPER, "    rec.onerror = (ev) => {", "    rec.onend = () => {", 100);
    expect(erreur).toContain("reportVoiceFailure(vocalDictationMessage(ev.error));");
    expect(erreur).toContain("if (vocalOverlay) {");
  });

  it("aucun second envoi : la dictee garde le chemin existant (applyVoiceEnd -> send)", () => {
    // `startVoiceInput` PORTE le `rec.onend` existant : il contient donc le seul
    // envoi du fichier, et un seul (aucun second mecanisme ajoute).
    const demarrage = corpsFonction(SUPER, "function startVoiceInput()");
    expect((demarrage.match(/send\(/g) || [])).toHaveLength(1);
    for (const entete of [
      "function armVoiceInput()",
      "function vocalSyncConversation()",
      "function vocalApplyConversationPlan(plan)",
    ]) {
      const bloc = corpsFonction(SUPER, entete);
      expect(bloc, entete).not.toContain("send(");
      expect(bloc, entete).not.toContain("applyVoiceEnd");
    }
    // Un seul applyVoiceEnd dans le fichier, celui qui existait deja.
    expect((SUPER.match(/applyVoiceEnd\(\{/g) || [])).toHaveLength(1);
  });

  it("aucune API micro n'entre dans l'ecran (le micro reste dans vocal-mic.js)", () => {
    for (const appel of ["navigator.mediaDevices", "getUserMedia(", "new AudioContext", "webkitAudioContext"]) {
      expect(SUPER, appel).not.toContain(appel);
    }
  });

  it("le projet sensible est relu a l'entree du mode (dictee cloud interdite)", () => {
    const entree = corpsFonction(SUPER, "function enterVocal()");
    expect(entree).toContain("refreshVocalSensitivity();");
    const relu = corpsFonction(SUPER, "function refreshVocalSensitivity()");
    expect(relu).toContain('invoke("is_project_sensitive"');
    // Fail-open : une erreur d'IPC laisse la dictee possible.
    expect(relu).toContain("vocalProjectSensible = false;");
  });
});
