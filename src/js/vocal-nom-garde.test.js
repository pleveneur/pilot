// Tests — L'ÉCRAN VOCAL N'OBÉIT QU'À SON NOM (garde du nom)
//
// CE QUE CE FICHIER VERROUILLE (et pourquoi) :
//   1. LES CINQ RÈGLES de la décision, DANS L'ORDRE : hors mode, texte vide,
//      reprise en main (clavier), réveil (bouton « Réveiller »/geste 🎙️), puis
//      le nom. L'ordre EST la spécification : sans lui, un clic de secours
//      n'ouvrirait rien, ou un projet hors mode Vocal se mettrait à filtrer.
//   2. LA COMPARAISON EST ÉTROITE : casse, accents, ponctuation et espaces sont
//      ignorés ; le nom est accepté N'IMPORTE OÙ dans la phrase ; un très petit
//      nombre de variantes ÉVIDENTES de prononciation passent ; une phrase qui
//      parle d'autre chose ne passe pas. Le point de franchise (un nom mal
//      transcrit n'est PAS reconnu) est mesuré ici : c'est un choix assumé.
//   3. LE BRANCHEMENT — le vrai risque. Trois verrous de source :
//      a. la décision est prise AVANT l'envoi, sur le chemin UNIQUE
//         (`applyVoiceEnd` n'apparaît qu'une fois, `send` une fois) ;
//      b. le chemin « jeté » ne contient AUCUN envoi, AUCUN message : rien ne
//         part, rien n'est conservé, rien n'est affiché, et l'écran se réarme ;
//      c. les résultats intermédiaires n'écrivent rien tant que le nom n'est pas
//         entendu — donc aucun mot ne repousse l'échéance du silence.
//   4. LE BOUTON DE SECOURS « Réveiller » marche toujours : le geste 🎙️ pose le
//      réveil d'UNE phrase, consommé par la phrase qu'il a ouverte. C'est le
//      point le plus facile à casser : il est verrouillé deux fois.
//   5. LA LIGNE D'ÉTAT existante dit lequel des deux états est actif, sans
//      nouvel élément d'interface, sans réglage, et sans toucher aux phrases
//      déjà verrouillées ailleurs (« Je vous écoute. »).
//   6. HORS DE L'ÉCRAN VOCAL, RIEN NE CHANGE : ni le chat de l'agent π, ni le
//      web distant n'importent la garde.
//
// Les commentaires sont en ASCII ; les chaînes qui viennent de l'interface sont
// copiées telles quelles.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  decideVocalNameGate,
  mentionsAssistantName,
  foldSpoken,
  phoneticKey,
  vocalNameSentence,
  vocalNameGateArmed,
  VOCAL_GATE_JETER,
  VOCAL_GATE_LAISSER,
  VOCAL_GATE_MIN_KEY,
} from "./vocal-nom-garde.js";
import { sliceSource, neutraliserSource } from "./source-slice.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) => readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const SUPER = lire("src/js/super-agent.js");
const CODE = lire("src/js/vocal-nom-garde.js");
const AGENT_PI = lire("src/js/agent-pi.js");
const WEB = lire("web/js/app.js");
// Le code SANS commentaires ni chaînes : c'est lui seul qui est jugé quand on
// vérifie qu'une règle n'est pas recopiée ailleurs.
const CODE_NU = neutraliserSource(CODE);

/** Corps d'une fonction du module (jusqu'a la premiere accolade en colonne 3). */
function corpsFonction(src, entete) {
  const i = src.indexOf(entete);
  expect(i, `fonction absente : ${entete}`).toBeGreaterThan(-1);
  const fin = src.indexOf("\n  }\n", i);
  expect(fin, `fin de fonction introuvable : ${entete}`).toBeGreaterThan(i);
  return src.slice(i, fin + 4);
}

const NOM = "Aurelia";

// ── 1. Les cinq règles, dans l'ordre ──────────────────────────────────────
describe("1. la décision dit quoi faire de la phrase", () => {
  it("hors de l'écran Vocal : rien ne change (règle 1)", () => {
    const d = decideVocalNameGate({ modeOuvert: false, texte: "range le projet", nom: NOM });
    expect(d.action).toBe(VOCAL_GATE_LAISSER);
    expect(d.raison).toBe("hors-mode");
  });

  it("sans texte : ni refus ni envoi (règle 2)", () => {
    for (const texte of ["", "   ", null, undefined]) {
      const d = decideVocalNameGate({ modeOuvert: true, texte, nom: NOM });
      expect(d.action).toBe(VOCAL_GATE_LAISSER);
      expect(d.raison).toBe("sans-texte");
    }
  });

  it("la saisie clavier n'est jamais filtrée (règle 3)", () => {
    const d = decideVocalNameGate({
      modeOuvert: true,
      texte: "range le projet",
      nom: NOM,
      repriseMain: true,
    });
    expect(d.action).toBe(VOCAL_GATE_LAISSER);
    expect(d.raison).toBe("reprise-main");
  });

  it("réveillé pour une phrase : le nom n'est pas exigé (règle 4)", () => {
    const d = decideVocalNameGate({ modeOuvert: true, texte: "range le projet", nom: NOM, reveil: true });
    expect(d.action).toBe(VOCAL_GATE_LAISSER);
    expect(d.raison).toBe("reveil");
    // Le réveil vaut pour UNE phrase : il est consommé, jamais pour la session.
    expect(d.consommeReveil).toBe(true);
  });

  it("le nom est exigé quand rien ne l'a réveillé (règle 5)", () => {
    const jete = decideVocalNameGate({ modeOuvert: true, texte: "range le projet", nom: NOM });
    expect(jete.action).toBe(VOCAL_GATE_JETER);
    expect(jete.raison).toBe("nom-absent");
    expect(jete.consommeReveil).toBe(false);
    const garde = decideVocalNameGate({ modeOuvert: true, texte: "Aurelia, range le projet", nom: NOM });
    expect(garde.action).toBe(VOCAL_GATE_LAISSER);
    expect(garde.raison).toBe("nom-entendu");
  });

  it("l'ordre des règles est celui de la spécification, pas un hasard", () => {
    // Le réveil passe AVANT le nom : un clic de secours doit suffire, sinon le
    // bouton « Réveiller » ne servirait à rien.
    expect(
      decideVocalNameGate({ modeOuvert: true, texte: "range le projet", nom: NOM, reveil: true }).raison,
    ).toBe("reveil");
    // La reprise en main passe AVANT le réveil et le nom : le clavier prime.
    expect(
      decideVocalNameGate({
        modeOuvert: true,
        texte: "range le projet",
        nom: NOM,
        reveil: true,
        repriseMain: true,
      }).raison,
    ).toBe("reprise-main");
    // Hors mode passe AVANT tout : l'écran Vocal ne filtre rien d'autre.
    expect(
      decideVocalNameGate({ modeOuvert: false, texte: "range le projet", nom: NOM, reveil: false }).raison,
    ).toBe("hors-mode");
  });

  it("un nom inutilisable ne mure jamais l'écran (fail-open)", () => {
    for (const nom of ["", "   ", "...", "???"]) {
      const d = decideVocalNameGate({ modeOuvert: true, texte: "range le projet", nom });
      expect(d.action).toBe(VOCAL_GATE_LAISSER);
      expect(d.raison).toBe("nom-inutilisable");
    }
  });

  it("rien ne lève, même sur des entrées absurdes", () => {
    for (const etats of [undefined, null, {}, { texte: 42, nom: 7 }, { modeOuvert: "oui" }]) {
      expect(() => decideVocalNameGate(etats)).not.toThrow();
    }
  });
});

// ── 2. La comparaison : tolérante, mais étroite ───────────────────────────
describe("2. la comparaison du nom", () => {
  it("casse, accents, ponctuation et espaces sont ignorés", () => {
    expect(mentionsAssistantName("AURELIA range le projet", NOM)).toBe(true);
    expect(mentionsAssistantName("Aurélia, range ça", "Aurelia")).toBe(true);
    expect(mentionsAssistantName("Aurelia.", NOM)).toBe(true);
    expect(mentionsAssistantName("  aurelia   range  ", NOM)).toBe(true);
    expect(mentionsAssistantName("Hé, Aurelia !", NOM)).toBe(true);
  });

  it("le nom est accepté n'importe où dans la phrase", () => {
    expect(mentionsAssistantName("Aurelia range le projet", NOM)).toBe(true);
    expect(mentionsAssistantName("range le projet Aurelia", NOM)).toBe(true);
    expect(mentionsAssistantName("range, Aurelia, le projet", NOM)).toBe(true);
  });

  it("un nom composé est reconnu en entier", () => {
    expect(mentionsAssistantName("bonjour Marie Claire", "Marie Claire")).toBe(true);
    expect(mentionsAssistantName("bonjour Marie", "Marie Claire")).toBe(false);
  });

  it("quelques variantes ÉVIDENTES de prononciation passent", () => {
    // ph/f, qu/k, y/i, consonne finale muette du français.
    expect(mentionsAssistantName("bonjour Sophie", "Sofie")).toBe(true);
    expect(mentionsAssistantName("bonjour Yann", "Iann")).toBe(true);
    expect(mentionsAssistantName("bonjour Benoit", "Benoit")).toBe(true);
    expect(mentionsAssistantName("bonjour Bernar", "Bernard")).toBe(true);
    // Le nom peut être coupé en deux par la reconnaissance.
    expect(mentionsAssistantName("bonjour no va", "Nova")).toBe(true);
  });

  it("mais elle reste ÉTROITE : parler d'autre chose ne déclenche rien", () => {
    const voisins = [
      "range le projet",
      "bonne année", // proche de « Anne » : refusé (les lettres doublées comptent)
      "nouveau projet", // proche de « Nova » : refusé
      "aurelien range le projet", // proche de « Aurelia » : refusé
      "aurélie range le projet",
      "orélia",
    ];
    for (const phrase of voisins) {
      expect(mentionsAssistantName(phrase, "Aurelia"), phrase).toBe(false);
    }
    expect(mentionsAssistantName("bonne année", "Anne")).toBe(false);
    expect(mentionsAssistantName("nouveau projet", "Nova")).toBe(false);
  });

  it("aucune comparaison approximative au-delà des variantes évidentes", () => {
    // Un nom trop court pour la comparaison « au son » n'est comparé qu'exactement.
    expect(VOCAL_GATE_MIN_KEY).toBe(3);
    expect(mentionsAssistantName("bonjour ma", "Max")).toBe(false);
    expect(mentionsAssistantName("bonjour Max", "Max")).toBe(true);
  });

  it("la forme comparable ne lève jamais et ne garde que des mots", () => {
    expect(foldSpoken(null)).toBe("");
    expect(foldSpoken("  L'Assistant, c'est Fini !  ")).toBe("l assistant c est fini");
    expect(phoneticKey("")).toBe("");
    expect(mentionsAssistantName(null, NOM)).toBe(false);
    expect(mentionsAssistantName("Aurelia", null)).toBe(false);
  });
});

// ── 3. Le branchement : là où la garde compte vraiment ────────────────────
describe("3. la garde est appliquée sur le chemin UNIQUE d'envoi", () => {
  it("la décision est prise AVANT l'envoi, et l'envoi reste unique", () => {
    const fin = sliceSource(SUPER, "      if (wasActive === true) {", "      // PLAFOND DES SESSIONS VIDES", 200);
    const iGarde = fin.indexOf("decideVocalNameGate(");
    const iJet = fin.indexOf("VOCAL_GATE_JETER");
    const iEnvoi = fin.indexOf("applyVoiceEnd({");
    expect(iGarde).toBeGreaterThan(-1);
    expect(iJet).toBeGreaterThan(iGarde);
    expect(iEnvoi).toBeGreaterThan(iJet);
    // Aucun second mécanisme d'envoi n'a été ajouté : le fichier garde UN seul
    // `applyVoiceEnd({` (verrou historique de plusieurs tests).
    expect((SUPER.match(/applyVoiceEnd\(\{/g) || []).length).toBe(1);
  });

  it("le chemin « jeté » ne contient AUCUN envoi, AUCUN message, AUCUNE trace", () => {
    const jete = sliceSource(
      SUPER,
      "        if (gardeNom.action === VOCAL_GATE_JETER) {",
      "      // Décision et ORDRE",
      200,
    );
    expect(jete).not.toMatch(/send\(|applyVoiceEnd|appendSystemMessage|appendMessage|vocalNoteEmptySession/);
    // Rien n'est conservé : la zone redevient ce qu'elle était avant la phrase.
    expect(jete).toContain("if (inputEl.value !== preText) { inputEl.value = preText; resizeInput(); }");
    // L'écoute continue : la session se referme PUIS l'état est réappliqué (le
    // réarmement existant repart de là).
    expect(jete).toContain("applyVocalState();");
    // Aucune échéance de silence ne survit à une phrase jetée.
    expect(jete).toContain("vocalMotRecu = false;");
    expect(jete).toContain("clearVocalSilenceTimer();");
  });

  it("une phrase jetée n'est pas comptée comme une panne du moteur", () => {
    const jete = sliceSource(
      SUPER,
      "        if (gardeNom.action === VOCAL_GATE_JETER) {",
      "      // Décision et ORDRE",
      200,
    );
    // Le plafond des sessions vides est remis à zéro : une phrase entendue mais
    // jetée n'est pas une dictée qui n'a pas fonctionné.
    expect(jete).toContain("vocalSessionsVides = [];");
  });

  it("RIEN ne s'écrit tant que le nom n'est pas entendu (résultats intermédiaires)", () => {
    const inter = sliceSource(SUPER, "      if (voiceUserTookOver) return;", "      const sep = preText", 200);
    const iGarde = inter.indexOf("vocalNameGateArmed(");
    const iNom = inter.indexOf("mentionsAssistantName(");
    const iSortie = inter.lastIndexOf("return;");
    expect(iGarde).toBeGreaterThan(-1);
    expect(iNom).toBeGreaterThan(iGarde);
    expect(iSortie).toBeGreaterThan(iNom);
    // L'écriture du texte dans la zone est APRÈS la garde (dans le même bloc de
    // résultats) : c'est ce qui garantit « rien n'est affiché ».
    const bloc = sliceSource(SUPER, "      if (voiceUserTookOver) return;", "    rec.onerror = ", 300);
    const iGardeBloc = bloc.indexOf("vocalNameGateArmed(");
    const iEcriture = bloc.indexOf("inputEl.value = preText + sep + transcript;");
    const iMot = bloc.indexOf("vocalNoteWord();");
    expect(iGardeBloc).toBeGreaterThan(-1);
    expect(iEcriture).toBeGreaterThan(iGardeBloc);
    expect(iMot).toBeGreaterThan(iEcriture);
    // Et aucun `vocalNoteWord()` dans la branche qui renonce : sans mot compté,
    // aucune échéance de silence n'est programmée, donc rien ne part.
    const renonce = sliceSource(SUPER, "        if (inputEl.value !== preText) inputEl.value = preText;", "      const sep = preText", 40);
    expect(renonce).not.toContain("vocalNoteWord");
  });

  it("aucun second envoi, aucun second chemin de décision n'est créé", () => {
    // La garde n'apparaît QUE sur les trois points qui connaissent la dictée.
    expect((SUPER.match(/decideVocalNameGate\(/g) || []).length).toBe(1);
    expect((SUPER.match(/vocalNameGateArmed\(/g) || []).length).toBe(1);
    expect((SUPER.match(/vocalNameSentence\(/g) || []).length).toBe(1);
  });

  it("le nom vient de la SEULE source existante, jamais d'une seconde règle", () => {
    expect(SUPER).toMatch(/import \{[\s\S]{0,400}vocal-nom-garde\.js/);
    // Le module de la garde ne sait pas calculer un nom : il le reçoit (le
    // contrôle porte sur le CODE, pas sur les commentaires qui expliquent la
    // source — sinon il suffirait de nommer la fonction pour « passer »).
    expect(CODE_NU).not.toMatch(/configCache|personaDisplayName|getAssistantPersonaName|superAgentDisplayLabel/);
    // Le fichier applicatif, lui, lit le nom là où il est déjà décidé.
    expect(SUPER).toMatch(/export function superAgentDisplayLabel\(\)/);
    const points = SUPER.match(/superAgentDisplayLabel\(\)/g) || [];
    expect(points.length).toBeGreaterThanOrEqual(3);
  });
});

// ── 4. Le bouton de secours ne casse pas ──────────────────────────────────
describe("4. « Réveiller » reste un vrai secours", () => {
  it("le geste 🎙️ (donc le bouton du cercle) pose le réveil d'UNE phrase", () => {
    const geste = corpsFonction(SUPER, "  function toggleVoiceInput() {");
    expect(geste).toContain("vocalReveilUnePhrase = true;");
    // Le réveil est posé AVANT le démarrage de la dictée, sinon la première
    // phrase serait jugée sans nom.
    expect(geste.indexOf("vocalReveilUnePhrase = true;")).toBeLessThan(geste.indexOf("startVoiceInput();"));
  });

  it("le bouton du cercle emprunte la MÊME voie : aucun second démarrage", () => {
    expect(SUPER).toMatch(/relance\.addEventListener\("click", toggleVoiceInput\)/);
  });

  it("le réveil est consommé par la phrase qu'il a ouverte", () => {
    const fin = sliceSource(SUPER, "      if (wasActive === true) {", "      // PLAFOND DES SESSIONS VIDES", 200);
    expect(fin).toContain("if (gardeNom.consommeReveil === true) vocalReveilUnePhrase = false;");
  });

  it("le réveil ne survit pas à la sortie de l'écran", () => {
    const sortie = corpsFonction(SUPER, "  function exitVocal() {");
    expect(sortie).toContain("vocalReveilUnePhrase = false;");
  });

  it("la règle « réveillé ⇒ le nom n'est pas exigé » est bien celle du module", () => {
    expect(decideVocalNameGate({ modeOuvert: true, texte: "range le projet", nom: NOM, reveil: true }).action).toBe(
      VOCAL_GATE_LAISSER,
    );
    expect(decideVocalNameGate({ modeOuvert: true, texte: "range le projet", nom: NOM, reveil: false }).action).toBe(
      VOCAL_GATE_JETER,
    );
  });
});

// ── 5. La ligne d'état : deux états, une seule ligne ─────────────────────
describe("5. la ligne d'état dit lequel des deux états est actif", () => {
  it("deux phrases différentes, chacune simple", () => {
    const armee = vocalNameSentence(NOM);
    expect(armee).toBe("Dites « Aurelia » pour me parler.");
    expect(armee).not.toMatch(/\n/);
    expect(armee.length).toBeLessThan(80);
    expect(vocalNameSentence("")).toBe("Dites mon nom pour me parler.");
    // La phrase de l'état « réveillé » n'est pas recopiée ici : c'est celle du
    // repos, déjà verrouillée ailleurs.
    expect(CODE_NU).not.toMatch(/Je vous écoute/);
  });

  it("la ligne existante porte la phrase, sans nouvel élément ni réglage", () => {
    const ligne = corpsFonction(SUPER, "  function vocalStatusLine(state) {");
    // La phrase du nom n'est dite QUE quand la veille est armée (20 s de
    // silence, ou arrêt demandé à la voix) — sinon on est en écoute libre et
    // c'est la phrase du repos qui parle.
    expect(ligne).toContain("if (vocalVeilleArmee === true) {");
    expect(ligne).toContain("return vocalNameSentence(superAgentDisplayLabel());");
    expect(ligne).toContain("return vocalStatusText(state);");
    // L'ordre déjà verrouillé par d'autres tests est intact.
    expect(ligne).toMatch(/if \(state !== "idle"\) return vocalStatusText\(state\);\s*if \(vocalMicFerme\) return vocalMicFerme;/);
    expect(ligne).toContain("if (demandesEnAttente.length > 0) return VOCAL_MESSAGE_DEMANDE_ACCUSEE;");
  });

  it("les phrases déjà verrouillées de `vocalStatusText` n'ont pas bougé", () => {
    const etat = corpsFonction(SUPER, "export function vocalStatusText(state) {");
    expect(etat).toContain('return "Je vous écoute…";');
    expect(etat).toContain('return "Je vous écoute.";');
  });

  it("la garde est sans effet hors du mode Vocal", () => {
    expect(vocalNameGateArmed({ modeOuvert: false, nom: NOM })).toBe(false);
    expect(vocalNameGateArmed({ modeOuvert: true, nom: NOM })).toBe(true);
    expect(vocalNameGateArmed({ modeOuvert: true, nom: NOM, reveil: true })).toBe(false);
    expect(vocalNameGateArmed({ modeOuvert: true, nom: "" })).toBe(false);
  });
});

// ── 6. Hors de l'écran Vocal, rien ne change ─────────────────────────────
describe("6. hors de l'écran Vocal, aucun changement", () => {
  it("le chat de l'agent π n'importe pas la garde", () => {
    expect(AGENT_PI).not.toMatch(/vocal-nom-garde/);
    expect(AGENT_PI).not.toMatch(/decideVocalNameGate|mentionsAssistantName/);
  });

  it("le web distant n'importe pas la garde", () => {
    expect(WEB).not.toMatch(/vocal-nom-garde|decideVocalNameGate/);
  });

  it("le module de la garde ne touche à rien d'extérieur", () => {
    expect(CODE).not.toMatch(/document\.|window\.|setTimeout|setInterval|navigator\.|invoke\(|SpeechRecognition/);
    expect(CODE).not.toMatch(/^import /m);
  });

  it("le micro, la transcription et le service de voix ne sont pas touchés", () => {
    // La garde ne parle jamais au micro : elle décide de la CONSÉQUENCE.
    expect(CODE).not.toMatch(/vocal-mic|getUserMedia|tts_|voicestudio|piper/i);
    const inter = sliceSource(SUPER, "      if (voiceUserTookOver) return;", "      const sep = preText", 200);
    expect(inter).not.toMatch(/vocalMic\.|stopVoiceInput|rec\.stop/);
  });
});
