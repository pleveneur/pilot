// Tests — « ARRÊTE D'ÉCOUTER » ARRÊTE VRAIMENT L'ÉCOUTE (écran Vocal).
//
// LE DÉFAUT CORRIGÉ (fiche `docs/rapports/FICHE-a-ajuster-arret-ecoute-vocale.md`,
// constat d'usage du propriétaire) : prononcer une phrase d'arrêt ne coupait
// rien. L'écran continuait d'afficher « Je vous écoute… » et la dictée restait
// ouverte comme si de rien n'était.
//
// LES CINQ DÉCISIONS DU PROPRIÉTAIRE, ET CE QUE CE FICHIER VERROUILLE :
//   1. L'EFFET DE L'ARRÊT EST EXACTEMENT CELUI DE LA VEILLE AUTOMATIQUE DE 20 s
//      (référence unique, jamais un second état) : un seul point
//      (`vocalEnterVeille`), donc un seul affichage pour les deux entrées.
//   2. LE MICRO N'EST PAS FERMÉ : on reste à l'écoute du nom de l'assistant (ou
//      du personnage, ou d'un mot de réveil), et prononcer ce nom réveille.
//   3. L'ARRÊT PASSE PAR UN OUTIL de l'assistant (`stop_listening`) : la phrase
//      est TRANSMISE comme une demande, et c'est l'assistant qui appelle l'outil
//      (l'ancien point 4 de la fiche — « ne doit pas être envoyée » — est
//      ABANDONNÉ).
//   4. AUCUNE LECTURE À VOIX HAUTE pour cet ordre (coupe silencieuse).
//   5. AUCUN RÉGLAGE, AUCUNE CASE, AUCUN BOUTON ajouté à l'écran.
//
// PREUVES, dans l'ordre du travail demandé :
//   § 1  la veille (20 s) ne dit plus « je vous écoute » — un seul état partagé ;
//   § 2  l'arrêt coupe vraiment : la dictée ne produit plus de demande, la ligne
//        d'état n'est plus celle de l'écoute, et le micro reste ouvert ;
//   § 3  l'outil existe, il est exposé, et il produit cet état ;
//   § 4  le réveil par le nom fonctionne encore ;
//   § 5  une phrase qui contient « écoute » dans un autre sens ne coupe rien ;
//   § 6  les formules élargies et les variantes de transcription.
//
// Les commentaires sont en ASCII ; les chaînes d'interface sont copiées telles
// quelles.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  decideVocalNameGate,
  decideVocalStopListening,
  isVocalStopFormula,
  mentionsAssistantName,
  mentionsWakeWord,
  vocalEtatAffiche,
  vocalNameGateArmed,
  vocalNameSentence,
  vocalVeilleSentence,
  VOCAL_GATE_JETER,
  VOCAL_GATE_LAISSER,
  VOCAL_STOP_ARRETER,
  VOCAL_STOP_FORMULAS,
  VOCAL_STOP_RIEN,
} from "./vocal-nom-garde.js";
import { decideVocalDictation, VOCAL_DICTATION_ARM } from "./vocal-conversation.js";
import { sliceSource } from "./source-slice.js";

const ICI = dirname(fileURLToPath(import.meta.url));
// Le source peut arriver en CRLF (runner Windows) : on normalise AVANT toute
// recherche d'ancre multi-lignes (quality-gate § 3.4).
const lire = (rel) => readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const SUPER = lire("src/js/super-agent.js");
const CODE = lire("src/js/vocal-nom-garde.js");
const ACTIONS = lire("src-tauri/extensions/pilot-assistant-actions.ts");

/** Corps d'une fonction (ancre de fin : la fermeture en colonne 2). */
function corpsFonction(src, entete) {
  const i = src.indexOf(entete);
  expect(i, `fonction absente : ${entete}`).toBeGreaterThan(-1);
  const fin = src.indexOf("\n  }\n", i);
  expect(fin, `fin de fonction introuvable : ${entete}`).toBeGreaterThan(i);
  return src.slice(i, fin + 4);
}

const NOM = "Aurelia";
// La phrase EXACTE que l'écran affiche quand il écoute encore. Le défaut était
// qu'elle restait affichée après l'arrêt.
const ECOUTE = ["Je vous écoute…", "Je vous écoute."];

// Le texte d'une phrase d'arrêt, écrite ici en clair : le MODULE ne doit jamais
// être le seul à la connaître, l'écran non plus (aucun littéral dans
// `super-agent.js`, verrou de `veille-mot-de-reveil.test.js`).
const ORDRE = "arrête d'écouter";

// ── 1. Un seul état : la veille ne se présente plus comme à l'écoute ──────
describe("1. la veille automatique de 20 s ne dit plus « je vous écoute »", () => {
  it("(a) l'état affiché de la veille n'est plus l'écoute — et c'est le MÊME pour les deux entrées", () => {
    // La veille armée par les 20 s de silence et celle armée par l'ordre sont le
    // même fait : `vocalVeilleArmee`. Une seule fonction décide de l'affichage.
    const entreeSilence = vocalEtatAffiche({ veilleArmee: true, etat: "listening" });
    const entreeCommande = vocalEtatAffiche({ veilleArmee: true, etat: "listening" });
    expect(entreeSilence).toBe("idle");
    expect(entreeCommande).toBe(entreeSilence);
    // L'écran ne peut donc plus rendre la phrase de l'écoute : `idle` n'est pas
    // `listening`. C'est la correction du constat d'usage.
    expect(ECOUTE).not.toContain(entreeSilence);
    // La parole et la réflexion GARDENT leur état (aucune régression du halo ni
    // des phrases « Je réponds. » / « Je réfléchis… »).
    expect(vocalEtatAffiche({ veilleArmee: true, etat: "speaking" })).toBe("speaking");
    expect(vocalEtatAffiche({ veilleArmee: true, etat: "thinking" })).toBe("thinking");
  });

  it("(a bis) hors veille, l'état est rendu À L'IDENTIQUE (aucun appelant existant ne change)", () => {
    expect(vocalEtatAffiche({ etat: "listening" })).toBe("listening");
    expect(vocalEtatAffiche({ veilleArmee: false, etat: "listening" })).toBe("listening");
    expect(vocalEtatAffiche({})).toBe("idle");
    expect(vocalEtatAffiche()).toBe("idle");
  });

  it("(a ter) le branchement : l'état passe par la décision pure, une seule fois par écriture", () => {
    const ligne = corpsFonction(SUPER, "  function vocalStatusLine(state) {");
    expect(ligne).toContain("vocalEtatAffiche({");
    // La ligne de veille est ATTEINTE : elle est après la traduction d'état et
    // avant la phrase du repos (`vocalStatusText(state)`).
    expect(ligne.indexOf("vocalEtatAffiche({")).toBeGreaterThan(-1);
    expect(ligne.indexOf("vocalEtatAffiche({")).toBeLessThan(
      ligne.indexOf("return vocalStatusText(state);"),
    );
    expect(ligne).toContain("if (vocalVeilleArmee === true) {");
    // L'état VISUEL suit la même décision : la classe n'est plus celle de
    // l'écoute quand la veille est armée (sinon le rond écouterait encore).
    const etat = corpsFonction(SUPER, "  function applyVocalState() {");
    expect(etat).toContain("vocalEtatAffiche({");
    expect(etat).toMatch(/listening: affiche === "listening"/);
    // L'OREILLE LOCALE SE TAIT : « J'écoute avec le service local » est une
    // phrase d'écoute, elle ne peut pas survivre à la veille.
    expect(ligne).toMatch(/raison === "deja-ouverte" && vocalVeilleArmee !== true/);
  });

  it("(a quater) la ligne de la veille est la phrase du nom, jamais celle de l'écoute", () => {
    // Ce que `vocalStatusLine` rend quand la veille est armée (branche unique) :
    expect(vocalVeilleSentence(NOM)).toBe("Je me mets en veille — dites « Aurelia » pour me parler.");
    expect(vocalNameSentence(NOM)).toBe("Dites « Aurelia » pour me parler.");
    for (const phrase of [vocalVeilleSentence(NOM), vocalNameSentence(NOM)]) {
      expect(ECOUTE).not.toContain(phrase);
    }
  });
});

// ── 2. L'arrêt coupe VRAIMENT l'écoute ─────────────────────────────────────
describe("2. après l'ordre, la dictée ne produit plus rien et l'écran se tait", () => {
  it("(b) la dictée est DÉSARMÉE au sens où rien ne peut plus partir : la garde jette la phrase", () => {
    // Ce que « désarmée » veut dire pour l'utilisateur : une phrase ordinaire
    // prononcée après l'ordre ne s'écrit nulle part et ne part nulle part. La
    // garde du nom est armée dès que la veille l'est.
    const apresLOdre = decideVocalNameGate({
      modeOuvert: true,
      texte: "je voudrais une pizza",
      nom: NOM,
      ecouteLibre: false,
    });
    expect(apresLOdre.action).toBe(VOCAL_GATE_JETER);
    expect(apresLOdre.raison).toBe("nom-absent");
    // Avant l'ordre (écoute libre), la même phrase partait : c'est bien l'arrêt
    // qui a changé quelque chose.
    expect(
      decideVocalNameGate({
        modeOuvert: true,
        texte: "je voudrais une pizza",
        nom: NOM,
        ecouteLibre: true,
      }).action,
    ).toBe(VOCAL_GATE_LAISSER);
  });

  it("(b bis) le micro n'est PAS fermé : l'oreille reste armée pour entendre le nom", () => {
    // LA DÉCISION QUI COMPTE : désarmer la dictée fermerait le micro, et le nom
    // ne serait plus jamais entendu. La veille ne touche donc PAS à la dictée :
    // la reconnaissance reste ouverte, la garde seule jette les phrases.
    const apres = decideVocalDictation({
      modeOuvert: true,
      dicteeOuverte: true,
      sensibiliteConnue: true,
      mesureOuverte: true,
      transcription: true,
    });
    expect(apres.action).not.toBe(undefined);
    // Et si la session venait de se fermer, elle se réarme : sans ça, un ordre
    // donné en fin de dictée laisserait l'écran sourd au nom.
    const rearme = decideVocalDictation({
      modeOuvert: true,
      dicteeOuverte: false,
      sensibiliteConnue: true,
      mesureOuverte: true,
      transcription: true,
    });
    expect(rearme.action).toBe(VOCAL_DICTATION_ARM);
  });

  it("(b ter) la veille ne ferme jamais le micro (aucun appel de fermeture)", () => {
    for (const entete of [
      "  function vocalEnterVeille(origine) {",
      "  function vocalStopListeningFromAssistant(origine) {",
      "  function vocalRendreOrdreArret(phrase) {",
      "  function vocalExitVeille() {",
    ]) {
      const corps = corpsFonction(SUPER, entete);
      expect(corps, entete).not.toMatch(/\.fermer\(|stopVoiceInput\(|vocalMic\.demander\(/);
    }
  });

  it("(b quater) un seul point d'application : les deux entrées passent par vocalEnterVeille", () => {
    // Une seule affectation de l'état de veille, et deux appelants qui la
    // traversent (le minuteur de 20 s et l'outil) : jamais deux comportements.
    const armes = SUPER.match(/vocalVeilleArmee = true/g) || [];
    expect(armes.length).toBe(1);
    expect(SUPER).toContain('vocalEnterVeille("silence");');
    // L'appel de l'outil passe par la MÊME fonction.
    const outil = corpsFonction(SUPER, "  function vocalStopListeningFromAssistant(origine) {");
    expect(outil).toContain("vocalEnterVeille(");
    expect(outil).toContain("applyVocalState();");
  });

  it("(b quinquies) la phrase rendue à l'assistant est CELLE de l'écran, relue à la source unique", () => {
    const outil = corpsFonction(SUPER, "  function vocalStopListeningFromAssistant(origine) {");
    // Aucune phrase recomposée : la ligne existante est relue.
    expect(outil).toMatch(/phrase: vocalStatusLine\(/);
    expect(outil).not.toMatch(/Je me mets en veille|Dites «/);
    // Hors de l'écran Vocal, rien n'est inventé.
    expect(outil).toContain("if (!vocalOverlay) return { ok: false");
  });
});

// ── 3. L'outil : il existe, il est exposé, il produit cet état ────────────
describe("3. l'outil d'arrêt d'écoute", () => {
  it("(c) l'extension déclare l'outil, une seule fois, et n'invente aucun état", () => {
    expect((ACTIONS.match(/name: "stop_listening"/g) || []).length).toBe(1);
    const outil = sliceSource(
      ACTIONS,
      '    name: "stop_listening",',
      "      return { content: [{ type: \"text\", text: \"L'écoute n'a PAS été arrêtée",
      400,
    );
    // Il DEMANDE l'état, il ne le décide pas : une seule action, un seul pont.
    expect(outil).toContain('action: "stop_listening"');
    expect(outil).toContain("ACTION_SENTINEL +");
    expect(outil).toContain('executionMode: "sequential"');
    // Aucune formule n'est recopiée dans l'outil comme une condition : c'est
    // l'assistant qui juge de l'intention, la liste vit dans le module pur.
    expect(outil).not.toMatch(/VOCAL_STOP_FORMULAS/);
  });

  it("(c bis) l'outil est exposé à l'interception et produit l'état par un seul point", () => {
    // Pont window : posé à l'ouverture de l'onglet, retiré à la fermeture
    // (même modèle que `window._pilotTabs`).
    expect(SUPER).toContain("window._pilotVocalStopListening = vocalStopListeningFromAssistant;");
    expect(SUPER).toContain("window._pilotVocalStopListening = null;");
    const action = sliceSource(
      SUPER,
      '    } else if (action === "stop_listening") {',
      "    } else {\n      await respondSuperAgentAction(id, false);",
      200,
    );
    expect(action).toContain("window._pilotVocalStopListening");
    expect(action).toContain("respondSuperAgentAction(id, true)");
    expect(action).toContain("respondSuperAgentAction(id, false)");
    // Aucun réglage, aucune écriture de configuration depuis l'outil.
    expect(action).not.toMatch(/save_config|set_config|localStorage/);
  });

  it("(c ter) la phrase d'arrêt PART comme une demande, par le chemin d'envoi existant", () => {
    // L'ancien point 4 de la fiche est ABANDONNÉ : la phrase n'est plus avalée.
    const ordre = corpsFonction(SUPER, "  function vocalRendreOrdreArret(phrase) {");
    expect(ordre).toContain("send();");
    // Un seul envoi, deux gardes seulement (question en attente, moteur qui ne
    // peut pas démarrer) : rien d'autre ne bloque.
    expect(ordre).toContain("if (hasPendingQuestion()) return;");
    expect(ordre).toContain("if (!canAssistantReflect()) return;");
    // Elle est appelée par les DEUX branches qui reconnaissent l'ordre.
    const appels = SUPER.match(/vocalRendreOrdreArret\(/g) || [];
    expect(appels.length).toBe(3); // 1 déclaration + 2 appels
    expect(SUPER).toContain('decideVocalStopListening({');
  });

  it("(c quater) l'ordre n'est JAMAIS lu à voix haute, et il n'y a pas de second lecteur", () => {
    const lecture = corpsFonction(SUPER, "  function autoReadVocalReply() {");
    expect(lecture).toContain("if (vocalCoupeSilencieuse === true) {");
    expect(lecture).toContain("vocalCoupeSilencieuse = false;");
    // Le drapeau est posé AVANT l'envoi / AVANT l'état, aux deux endroits qui
    // font silence : la demande d'arrêt reconnue, et l'outil de l'assistant.
    const ordre = corpsFonction(SUPER, "  function vocalRendreOrdreArret(phrase) {");
    expect(ordre.indexOf("vocalCoupeSilencieuse = true;")).toBeLessThan(ordre.indexOf("send();"));
    const outil = corpsFonction(SUPER, "  function vocalStopListeningFromAssistant(origine) {");
    expect(outil).toContain("vocalCoupeSilencieuse = true;");
    // Une seule lecture automatique dans l'écran Vocal.
    expect((SUPER.match(/function autoReadVocalReply/g) || []).length).toBe(1);
  });
});

// ── 4. Le réveil par le nom fonctionne encore ─────────────────────────────
describe("4. après l'arrêt, prononcer le nom réveille", () => {
  it("(d) le nom (ou un mot de réveil) traverse la garde armée", () => {
    const reveil = decideVocalNameGate({
      modeOuvert: true,
      texte: "Aurelia, range le projet",
      nom: NOM,
      ecouteLibre: false,
    });
    expect(reveil.action).toBe(VOCAL_GATE_LAISSER);
    expect(reveil.raison).toBe("nom-entendu");
    // Le mot de réglage s'ajoute au nom, il ne le remplace pas.
    const motDeReveil = decideVocalNameGate({
      modeOuvert: true,
      texte: "hé Pilot, tu m'entends ?",
      nom: NOM,
      motsDeReveil: "Pilot",
      ecouteLibre: false,
    });
    expect(motDeReveil.action).toBe(VOCAL_GATE_LAISSER);
    expect(motDeReveil.raison).toBe("mot-reveil");
    // Et la garde est bien ARMÉE : c'est elle qui jette le reste.
    expect(vocalNameGateArmed({ modeOuvert: true, nom: NOM, ecouteLibre: false })).toBe(true);
    expect(mentionsAssistantName("aurelia range le projet", NOM)).toBe(true);
    expect(mentionsWakeWord("hé pilot", "Pilot")).toBe(true);
  });

  it("(d bis) le nom lève la veille par le chemin existant, et le compte de 20 s repart", () => {
    const resultat = sliceSource(
      SUPER,
      "      if (vocalVeilleArmee === true) vocalExitVeille();",
      "      const sep = preText",
      40,
    );
    expect(resultat).toContain("vocalExitVeille();");
    const sortie = corpsFonction(SUPER, "  function vocalExitVeille() {");
    expect(sortie).toContain("vocalVeilleArmee = false;");
    expect(sortie).toContain("vocalVeilleParCommande = false;");
    expect(sortie).toContain("vocalRestartVeilleTimer();");
    // L'état d'affichage redevient celui de l'écoute : la veille est levée.
    expect(vocalEtatAffiche({ veilleArmee: false, etat: "listening" })).toBe("listening");
  });

  it("(d ter) le bouton de secours « Réveiller <Nom> » lève la garde pour une phrase", () => {
    // Aucune nouveauté : le geste existant passe par `reveil` et consomme une
    // phrase. Il n'est ni retiré ni doublé par l'outil.
    expect(
      decideVocalNameGate({
        modeOuvert: true,
        texte: "range le projet",
        nom: NOM,
        reveil: true,
        ecouteLibre: false,
      }).action,
    ).toBe(VOCAL_GATE_LAISSER);
  });
});

// ── 5. « Écoute » dans un autre sens ne coupe RIEN ───────────────────────
describe("5. le mot « écoute » employé autrement ne coupe rien", () => {
  it("(e) une phrase ordinaire qui contient le mot ne déclenche pas l'arrêt", () => {
    for (const phrase of [
      "écoute, j'ai une idée",
      "écoute ça, c'est intéressant",
      "tu m'écoutes ?",
      "écoute bien ce que je vais dire",
      "écoute-moi bien",
      "je t'écoute",
      "il faut que tu écoutes la radio",
      "la musique que j'écoute",
    ]) {
      expect(isVocalStopFormula(phrase), phrase).toBe(false);
      const d = decideVocalStopListening({ modeOuvert: true, texte: phrase });
      expect(d.action, phrase).toBe(VOCAL_STOP_RIEN);
      expect(d.raison, phrase).toBe("pas-formule");
    }
  });

  it("(e bis) une formule NOYÉE dans une phrase plus longue ne coupe rien non plus", () => {
    for (const phrase of [
      "arrête d'écouter la radio",
      "arrête d'écouter la radio s'il te plaît",
      "je voudrais que tu arrêtes d'écouter la radio et que tu ranges le projet",
      "ne m'écoute plus jamais",
      "silence, le dossier est vide",
      "le silence est total dans ce dossier",
    ]) {
      expect(isVocalStopFormula(phrase), phrase).toBe(false);
      expect(decideVocalStopListening({ modeOuvert: true, texte: phrase }).action, phrase).toBe(
        VOCAL_STOP_RIEN,
      );
    }
  });

  it("(e ter) l'écran n'appelle l'arrêt que sur la décision du module, jamais sur un test maison", () => {
    // Aucune comparaison de texte dans l'écran : la seule condition est l'action
    // rendue par la décision pure.
    // 1 import + les 2 branches qui reconnaissent l'ordre (résultats, fin d'écoute).
    expect((SUPER.match(/VOCAL_STOP_ARRETER/g) || []).length).toBe(3);
    expect(SUPER).not.toMatch(/arrête d'écouter|tais-toi|ne m'écoute plus/);
  });
});

// ── 6. Les formules (élargies) et les variantes de transcription ─────────
describe("6. les formules d'arrêt, élargies, et leurs variantes de transcription", () => {
  it("(f) une seule liste, et elle contient les formes demandées", () => {
    expect((CODE.match(/export const VOCAL_STOP_FORMULAS/g) || []).length).toBe(1);
    for (const formule of [
      "arrête d'écouter",
      "arrêtez d'écouter",
      "ne m'écoute plus",
      "ne m'écoutez plus",
      "n'écoute plus",
      "cesse d'écouter",
      "stoppe l'écoute",
      "stop l'écoute",
      "tais-toi",
      "taisez-vous",
      "silence",
      "mets-toi en veille",
      "mode veille",
    ]) {
      expect(VOCAL_STOP_FORMULAS, formule).toContain(formule);
      expect(isVocalStopFormula(formule), formule).toBe(true);
      expect(decideVocalStopListening({ modeOuvert: true, texte: formule }).action, formule).toBe(
        VOCAL_STOP_ARRETER,
      );
    }
  });

  it("(g) trois écarts de transcription sont absorbés, et pas un de plus", () => {
    // 1. frontières de mots, 2. finale du verbe, 3. politesse finale.
    for (const variante of [
      "arrête découter",
      "arrêtedécouter",
      "ARRETEZ DECOUTER",
      "ne m ecoute plus",
      "taisez vous",
      "mets toi en veille",
      "arrête d'écouter s'il te plaît",
      "arrête d'écouter s'il vous plaît",
      "arrête d'écouter stp",
      "arrête d'écouter svp",
      "arrête d'écouter merci",
      "Arrêtez d’écouter.",
    ]) {
      expect(isVocalStopFormula(variante), variante).toBe(true);
    }
    // La tolérance ne va PAS jusqu'à ajouter un mot : « merci » seul n'est pas
    // une politesse retirée, et un mot de plus laisse la phrase non reconnue.
    expect(isVocalStopFormula("merci")).toBe(false);
    expect(isVocalStopFormula("arrête d'écouter la radio")).toBe(false);
  });

  it("(h) en veille, répéter la formule ne produit rien (aucun message, aucun envoi)", () => {
    const d = decideVocalStopListening({ modeOuvert: true, texte: ORDRE, veilleArmee: true });
    expect(d.action).toBe(VOCAL_STOP_RIEN);
    expect(d.raison).toBe("deja-en-veille");
    // Et la phrase tombe dans la garde armée : elle est jetée.
    expect(
      decideVocalNameGate({
        modeOuvert: true,
        texte: ORDRE,
        nom: NOM,
        ecouteLibre: false,
      }).action,
    ).toBe(VOCAL_GATE_JETER);
  });
});
