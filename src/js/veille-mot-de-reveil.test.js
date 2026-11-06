// Tests — LA VEILLE (20 s de silence) ET « ARRÊTE D'ÉCOUTER »
//
// CE QUE CE FICHIER VERROUILLE (et pourquoi) :
//   1. LE CYCLE NORMAL de l'écran Vocal : on entre, on parle, ça part SANS nom.
//      Ce n'est qu'au bout de `VOCAL_ECOUTE_LIBRE_MS` de SILENCE que la garde du
//      nom s'arme. Toute parole détectée remet le compte à zéro. (a) (b) (d)
//   2. LE NOM lève la garde et fait repartir le compte de 20 s. (c)
//   3. « ARRÊTE D'ÉCOUTER » : la phrase d'arrêt met l'écran en attente du mot de
//      réveil, IMMÉDIATEMENT et SANS envoyer de demande. (e)
//   4. LA RECONNAISSANCE EST STRICTE : la phrase normalisée ENTIÈRE doit être
//      égale à une formule. Une phrase ordinaire qui contient un de ces mots ne
//      coupe JAMAIS l'écoute — dans le doute, on continue d'écouter. (f)
//   5. EN ATTENTE, la formule répétée ne produit RIEN : aucun message, aucun
//      envoi. (g)
//   6. LE BRANCHEMENT : une seule constante de délai, une seule liste de
//      formules, un seul compte à rebours, appliqué aux points qui existent
//      déjà (`vocalNoteWord`, `vocalSetLevel`, `enterVocal`, `exitVocal`,
//      `rec.onresult`, `rec.onend`, `vocalStatusLine`). Aucun second envoi.
//   7. HORS DE L'ÉCRAN VOCAL, RIEN NE CHANGE (agent π, web distant, dictée
//      ordinaire).
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
  decideVocalVeille,
  isVocalStopFormula,
  vocalNameGateArmed,
  vocalNameSentence,
  vocalVeilleSentence,
  VOCAL_ECOUTE_LIBRE_MS,
  VOCAL_GATE_JETER,
  VOCAL_GATE_LAISSER,
  VOCAL_STOP_ARRETER,
  VOCAL_STOP_FORMULAS,
  VOCAL_STOP_RIEN,
} from "./vocal-nom-garde.js";
import { sliceSource, neutraliserSource } from "./source-slice.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) => readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const SUPER = lire("src/js/super-agent.js");
const CODE = lire("src/js/vocal-nom-garde.js");
const AGENT_PI = lire("src/js/agent-pi.js");
const WEB = lire("web/js/app.js");
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

// ── 1. Le cycle normal : on entre, on parle, et ça part sans nom ──────────
describe("1. le cycle normal de l'écran Vocal", () => {
  it("(a) juste après l'entrée, une phrase SANS nom est acceptée", () => {
    const libre = decideVocalNameGate({
      modeOuvert: true,
      texte: "range le projet",
      nom: NOM,
      ecouteLibre: true,
    });
    expect(libre.action).toBe(VOCAL_GATE_LAISSER);
    expect(libre.raison).toBe("ecoute-libre");
    // Et la garde n'est PAS armée : c'est le cas de tous les jours.
    expect(vocalNameGateArmed({ modeOuvert: true, nom: NOM, ecouteLibre: true })).toBe(false);
  });

  it("(a bis) le même texte, une fois le compte échu, est jeté", () => {
    const arme = decideVocalNameGate({
      modeOuvert: true,
      texte: "range le projet",
      nom: NOM,
      ecouteLibre: false,
    });
    expect(arme.action).toBe(VOCAL_GATE_JETER);
    expect(arme.raison).toBe("nom-absent");
    expect(vocalNameGateArmed({ modeOuvert: true, nom: NOM, ecouteLibre: false })).toBe(true);
  });

  it("(b) au bout de 20 s de silence, la garde s'arme", () => {
    expect(VOCAL_ECOUTE_LIBRE_MS).toBe(20000);
    const avant = decideVocalVeille({ modeOuvert: true, ecouleMs: VOCAL_ECOUTE_LIBRE_MS - 1 });
    expect(avant.armer).toBe(false);
    expect(avant.raison).toBe("silence-court");
    const apres = decideVocalVeille({ modeOuvert: true, ecouleMs: VOCAL_ECOUTE_LIBRE_MS });
    expect(apres.armer).toBe(true);
    expect(apres.raison).toBe("silence-atteint");
  });

  it("(c) le nom lève la garde, et le compte de 20 s repart", () => {
    const entendu = decideVocalNameGate({
      modeOuvert: true,
      texte: "Aurelia, range le projet",
      nom: NOM,
      ecouteLibre: false,
    });
    expect(entendu.action).toBe(VOCAL_GATE_LAISSER);
    expect(entendu.raison).toBe("nom-entendu");
    // Le compte repart : une veille DÉJÀ armée ne se réarme pas toute seule, et
    // la durée repart de zéro (source : `vocalExitVeille` relance le minuteur).
    expect(decideVocalVeille({ modeOuvert: true, veilleArmee: true, ecouleMs: 60000 }).armer).toBe(false);
  });

  it("(d) une parole régulière empêche l'armement", () => {
    // Chaque parole reçue repousse l'échéance : à 19 s on est encore en écoute
    // libre, et un mot remet le compte à zéro (donc jamais 20 s de silence).
    expect(decideVocalVeille({ modeOuvert: true, ecouleMs: 19000 }).armer).toBe(false);
    expect(decideVocalVeille({ modeOuvert: true, ecouleMs: 0 }).armer).toBe(false);
    // Le rebours n'existe PAS quand la garde est déjà armée : l'état est stable.
    expect(decideVocalVeille({ modeOuvert: true, veilleArmee: true, ecouleMs: 999999 })).toEqual({
      armer: false,
      raison: "deja-en-veille",
    });
  });

  it("les deux règles qui protègent l'existant sont intactes", () => {
    // Réveil d'une phrase : le nom n'est pas exigé, même garde armée.
    expect(
      decideVocalNameGate({ modeOuvert: true, texte: "range le projet", nom: NOM, reveil: true }).raison,
    ).toBe("reveil");
    // Saisie clavier : jamais filtrée.
    expect(
      decideVocalNameGate({ modeOuvert: true, texte: "range", nom: NOM, repriseMain: true }).raison,
    ).toBe("reprise-main");
  });
});

// ── 2. « Arrête d'écouter » : l'écran se met en attente du mot de réveil ──
describe("2. l'arrêt demandé à la voix", () => {
  it("(e) une formule d'arrêt met l'écran en attente", () => {
    for (const formule of VOCAL_STOP_FORMULAS) {
      const d = decideVocalStopListening({ modeOuvert: true, texte: formule });
      expect(d.action, formule).toBe(VOCAL_STOP_ARRETER);
      expect(d.raison).toBe("arret");
    }
    // La casse, les accents et la ponctuation n'ont aucune importance.
    expect(isVocalStopFormula("ARRETE D'ECOUTER")).toBe(true);
    expect(isVocalStopFormula("  Arrête d’écouter.  ")).toBe(true);
    expect(isVocalStopFormula("tais toi")).toBe(true);
  });

  it("(e bis) l'arrêt ne vient pas d'une phrase à côté : comparaison STRICTE", () => {
    for (const phrase of [
      "arrête d'écouter la radio",
      "le silence est total dans ce dossier",
      "mets le projet au repos",
      "tu peux te reposer après le build",
      "silence, le dossier est vide",
      "Aurelia arrête d'écouter",
    ]) {
      expect(isVocalStopFormula(phrase), phrase).toBe(false);
      expect(decideVocalStopListening({ modeOuvert: true, texte: phrase }).action).toBe(VOCAL_STOP_RIEN);
    }
  });

  it("(f) une phrase ordinaire ne coupe JAMAIS l'écoute (dans le doute, on écoute)", () => {
    const d = decideVocalStopListening({
      modeOuvert: true,
      texte: "je voudrais que tu arrêtes d'écouter la radio et que tu ranges le projet",
    });
    expect(d.action).toBe(VOCAL_STOP_RIEN);
    expect(d.raison).toBe("pas-formule");
  });

  it("(g) en attente, la formule répétée ne produit RIEN", () => {
    const d = decideVocalStopListening({ modeOuvert: true, texte: "arrête d'écouter", veilleArmee: true });
    expect(d.action).toBe(VOCAL_STOP_RIEN);
    expect(d.raison).toBe("deja-en-veille");
    // Et la phrase tombe alors dans la garde du nom, qui la jette : aucun envoi.
    expect(
      decideVocalNameGate({
        modeOuvert: true,
        texte: "arrête d'écouter",
        nom: NOM,
        ecouteLibre: false,
      }).action,
    ).toBe(VOCAL_GATE_JETER);
  });

  it("hors de l'écran Vocal, la formule ne fait rien (aucun changement ailleurs)", () => {
    const d = decideVocalStopListening({ modeOuvert: false, texte: "arrête d'écouter" });
    expect(d.action).toBe(VOCAL_STOP_RIEN);
    expect(d.raison).toBe("hors-mode");
  });

  it("l'accusé est UNE phrase, et c'est la même que la ligne d'attente", () => {
    const accuse = vocalVeilleSentence(NOM);
    expect(accuse).toBe("Je me mets en veille — dites « Aurelia » pour me parler.");
    expect(accuse).not.toMatch(/\n/);
    expect(accuse.length).toBeLessThan(80);
    expect(vocalVeilleSentence("")).toBe("Je me mets en veille — dites mon nom pour me parler.");
    // Le nom vient de la source unique, jamais recopié : la phrase de la garde
    // continue d'exister et de dire la même chose autrement.
    expect(vocalNameSentence(NOM)).toBe("Dites « Aurelia » pour me parler.");
  });
});

// ── 3. Le branchement : un seul délai, une seule liste, un seul compte ───
describe("3. le branchement dans l'écran", () => {
  it("les 20 s sont UNE constante, et ils ne sont recopiés nulle part", () => {
    expect((CODE.match(/VOCAL_ECOUTE_LIBRE_MS\s*=\s*20000/g) || []).length).toBe(1);
    expect(SUPER).toMatch(/VOCAL_ECOUTE_LIBRE_MS/);
    // Aucun `20000`/`20_000` en dur dans l'écran : la valeur vient du module.
    expect(SUPER).not.toMatch(/\b20[_,]?000\b/);
  });

  it("les formules d'arrêt sont UNE liste, dans le module seul", () => {
    expect((CODE.match(/export const VOCAL_STOP_FORMULAS/g) || []).length).toBe(1);
    // Aucune formule recopiée dans l'écran : la comparaison est celle du module.
    expect(SUPER).not.toMatch(/arrête d'écouter|tais-toi/);
  });

  it("le compte à rebours est armé à l'entrée et défait à la sortie du mode", () => {
    const entree = corpsFonction(SUPER, "  function enterVocal() {");
    expect(entree).toContain("vocalVeilleArmee = false;");
    expect(entree).toContain("vocalRestartVeilleTimer();");
    const sortie = corpsFonction(SUPER, "  function exitVocal() {");
    expect(sortie).toContain("vocalVeilleArmee = false;");
    expect(sortie).toContain("clearVocalVeilleTimer();");
  });

  it("Toute parole détectée repart le compte (transcription ET niveau mesuré)", () => {
    const mot = corpsFonction(SUPER, "  function vocalNoteWord() {");
    expect(mot).toContain("vocalRestartVeilleTimer();");
    const niveau = corpsFonction(SUPER, "  function vocalSetLevel(niveau) {");
    expect(niveau).toContain("if (pas.capte === true) vocalRestartVeilleTimer();");
  });

  it("le nom lève la veille par le SEUL chemin prévu", () => {
    const fin = corpsFonction(SUPER, "  function vocalRestartVeilleTimer() {");
    // La décision reste PURE : elle est demandée, jamais réécrite ici.
    expect(fin).toContain("decideVocalVeille({");
    expect(fin).toContain("vocalEnterVeille(\"silence\");");
    const sortie = corpsFonction(SUPER, "  function vocalExitVeille() {");
    expect(sortie).toContain("vocalVeilleArmee = false;");
    expect(sortie).toContain("vocalRestartVeilleTimer();");
  });

  it("la phrase d'arrêt est reconnue AVANT d'écrire, et n'écrit rien", () => {
    const inter = sliceSource(SUPER, "      const nomAttendu = superAgentDisplayLabel();", "      const sep = preText", 400);
    expect(inter).toContain("decideVocalStopListening({");
    expect(inter).toContain("vocalEnterVeille(\"commande\");");
    // Rien ne part, aucun message n'est ajouté : le seul effet est l'état.
    expect(inter).not.toMatch(/\bsend\(|appendSystemMessage|applyVoiceEnd/);
    // Et la décision vient du module (aucune formule écrite ici).
    expect(inter).toContain("VOCAL_STOP_ARRETER");
  });

  it("en fin d'écoute, l'arrêt est reconnu AVANT la garde du nom", () => {
    const fin = sliceSource(SUPER, "      if (wasActive === true) {", "      // PLAFOND DES SESSIONS VIDES", 400);
    const iStop = fin.indexOf("decideVocalStopListening({");
    const iGarde = fin.indexOf("decideVocalNameGate({");
    expect(iStop).toBeGreaterThan(-1);
    expect(iGarde).toBeGreaterThan(-1);
    expect(iStop, "l'arrêt doit être reconnu avant la garde").toBeLessThan(iGarde);
    // Un seul envoi, celui qui existe déjà.
    expect((SUPER.match(/applyVoiceEnd\(/g) || []).length).toBe(1);
    expect((SUPER.match(/decideVocalNameGate\(/g) || []).length).toBe(1);
  });

  it("la ligne d'état : le nom quand la veille est armée, l'accusé si on l'a demandée", () => {
    const ligne = corpsFonction(SUPER, "  function vocalStatusLine(state) {");
    expect(ligne).toContain("if (vocalVeilleArmee === true) {");
    expect(ligne).toContain(
      "if (vocalVeilleParCommande === true) return vocalVeilleSentence(superAgentDisplayLabel());",
    );
    expect(ligne).toContain("return vocalNameSentence(superAgentDisplayLabel());");
    // Une seule composition de l'accusé, et il n'est jamais recopié.
    expect((SUPER.match(/vocalVeilleSentence\(/g) || []).length).toBe(1);
  });

  it("l'écoute libre est PASSÉE à la garde, aux deux points qui décident", () => {
    // Les deux appels de la garde reçoivent `ecouteLibre` depuis l'état réel de
    // l'écran : sans ça, la garde resterait armée dès l'entrée et plus rien ne
    // partirait sans le nom (le défaut que cette évolution corrige).
    const appels = SUPER.match(/ecouteLibre: vocalVeilleArmee !== true,/g) || [];
    expect(appels.length).toBe(2);
  });

  it("le module reste PUR (aucun DOM, aucun minuteur, aucun import)", () => {
    expect(CODE).not.toMatch(/document\.|window\.|setTimeout|setInterval|navigator\.|invoke\(/);
    expect(CODE).not.toMatch(/^import /m);
    // Le délai et la liste sont des données, pas des effets.
    expect(CODE_NU).toContain("VOCAL_ECOUTE_LIBRE_MS");
    expect(CODE_NU).toContain("VOCAL_STOP_FORMULAS");
  });
});

// ── 4. Hors de l'écran Vocal, rien ne change ──────────────────────────────
describe("4. hors de l'écran Vocal, aucun changement", () => {
  it("l'agent π et le web distant n'importent ni la veille ni l'arrêt", () => {
    for (const src of [AGENT_PI, WEB]) {
      expect(src).not.toMatch(/decideVocalVeille|decideVocalStopListening|VOCAL_STOP_FORMULAS/);
      expect(src).not.toMatch(/VOCAL_ECOUTE_LIBRE_MS/);
    }
  });

  it("la dictée ordinaire n'est pas filtrée : la garde ne joue que dans l'écran", () => {
    // Le corps de la garde ne agit que si l'écran Vocal est réellement ouvert.
    for (const raison of ["hors-mode"]) {
      expect(decideVocalNameGate({ modeOuvert: false, texte: "range le projet", nom: NOM }).raison).toBe(raison);
      expect(
        decideVocalStopListening({ modeOuvert: false, texte: "arrête d'écouter" }).raison,
      ).toBe(raison);
    }
  });
});
