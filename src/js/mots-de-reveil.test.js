// Tests — LES MOTS DE RÉVEIL DE L'ÉCRAN VOCAL (réglage unique `vocal_wake_words`)
//
// CE QUE CE FICHIER VERROUILLE (et pourquoi) :
//   1. LE RÉGLAGE EST ADDITIF. Champ vide ⇒ comportement historique STRICTEMENT
//      inchangé : seul le nom ouvre la phrase. Rempli ⇒ les mots s'AJOUTENT au
//      nom, qui reste TOUJOURS accepté. Le jour où un mot de réveil remplacerait
//      le nom, ce fichier échoue.
//   2. UN SEUL MOT SUFFIT, n'importe où dans la phrase, et plusieurs mots dont un
//      seul est prononcé ouvrent la phrase.
//   3. LA TOLÉRANCE EST CELLE DU NOM, ni plus ni moins : casse, accents,
//      ponctuation, espaces ignorés (même fonction de comparaison).
//   4. UNE PHRASE SANS MOT NI NOM RESTE REFUSÉE : ni envoyée, ni conservée, ni
//      affichée (la règle du §6quater n'est pas contournée par le nouveau champ).
//   5. LE BRANCHEMENT NE DOUBLE RIEN : la décision reste prise à UN seul endroit
//      (`decideVocalNameGate`), le chemin d'envoi reste UNIQUE (`applyVoiceEnd`
//      → `send`), et la garde n'est importée par AUCUN autre écran (agent π, web
//      distant).
//   6. LE RÉGLAGE VIT À UN SEUL ENDROIT : un champ texte dans la section « Mode
//      Vocal » des Paramètres, une clé de configuration (`vocal_wake_words`,
//      défaut vide, jamais d'erreur si absente), relue à chaud.
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
  mentionsWakeWord,
  vocalNameGateArmed,
  VOCAL_GATE_JETER,
  VOCAL_GATE_LAISSER,
  VOCAL_WAKE_WORDS_KEY,
  wakeWordsFrom,
  wakeWordsText,
} from "./vocal-nom-garde.js";
import { sliceSource } from "./source-slice.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) => readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const SUPER = lire("src/js/super-agent.js");
const REGLAGES = lire("src/js/settings.js");
const HTML = lire("index.html");
const HTML_NC = HTML.replace(/<!--[\s\S]*?-->/g, "");
const RUST = lire("src-tauri/src/lib.rs");
const AGENT_PI = lire("src/js/agent-pi.js");
const WEB = lire("web/js/app.js");

const NOM = "Aurelia";
const MOTS = "Nova, hey Nova";

// ── 1. Le réglage est additif ─────────────────────────────────────────────
describe("1. le réglage est ADDITIF : le nom reste toujours accepté", () => {
  it("champ vide : le comportement d'avant, a l'identique", () => {
    // Sans réglage, la décision est celle du §6quater : le nom, rien d'autre.
    const jete = decideVocalNameGate({ modeOuvert: true, texte: "range le projet", nom: NOM });
    expect(jete.action).toBe(VOCAL_GATE_JETER);
    expect(jete.raison).toBe("nom-absent");
    const garde = decideVocalNameGate({ modeOuvert: true, texte: "Aurelia, range le projet", nom: NOM });
    expect(garde.action).toBe(VOCAL_GATE_LAISSER);
    expect(garde.raison).toBe("nom-entendu");
    // Un champ vide, une liste vide ou une valeur absente sont le MEME cas.
    for (const vide of ["", "   ", [], null, undefined, " , , "]) {
      expect(
        decideVocalNameGate({ modeOuvert: true, texte: "range le projet", nom: NOM, motsDeReveil: vide }).raison,
      ).toBe("nom-absent");
      expect(
        decideVocalNameGate({
          modeOuvert: true,
          texte: "Aurelia, range le projet",
          nom: NOM,
          motsDeReveil: vide,
        }).raison,
      ).toBe("nom-entendu");
    }
  });

  it("le nom reste accepte QUAND des mots de reveil sont regles", () => {
    const d = decideVocalNameGate({
      modeOuvert: true,
      texte: "Aurelia, range le projet",
      nom: NOM,
      motsDeReveil: MOTS,
    });
    expect(d.action).toBe(VOCAL_GATE_LAISSER);
    // La raison dit la verite : c'est bien le NOM qui a ouvert la phrase.
    expect(d.raison).toBe("nom-entendu");
  });
});

// ── 2. Un seul mot suffit ─────────────────────────────────────────────────
describe("2. un mot de reveil entendu ouvre la phrase", () => {
  it("un mot regle, n'importe ou dans la phrase", () => {
    for (const texte of [
      "Nova, range le projet",
      "range le projet Nova",
      "dis-moi Nova ce que tu penses du projet",
    ]) {
      const d = decideVocalNameGate({ modeOuvert: true, texte, nom: NOM, motsDeReveil: MOTS });
      expect(d.action, texte).toBe(VOCAL_GATE_LAISSER);
      expect(d.raison, texte).toBe("mot-reveil");
    }
  });

  it("plusieurs mots regles : un SEUL prononce suffit", () => {
    // « hey Nova » est regle mais c'est « Nova » qui a ete entendu (et l'inverse).
    expect(mentionsWakeWord("Nova, range le projet", MOTS)).toBe(true);
    expect(mentionsWakeWord("hey Nova, range le projet", MOTS)).toBe(true);
    // Un troisieme mot, jamais prononce, ne gene pas les deux premiers.
    expect(mentionsWakeWord("range le projet, Nove", "Nova, hey Nova, Nove")).toBe(true);
    // Aucun des mots prononces : rien ne s'ouvre.
    expect(mentionsWakeWord("range le projet", MOTS)).toBe(false);
  });

  it("les petits noms d'un mot compose sont distingues : « hey Nova » ne vaut pas « Nova » seul", () => {
    // Un mot de reveil est une EXPRESSION, pas une liste de mots separes.
    expect(mentionsWakeWord("hey Nova, range le projet", "hey Nova")).toBe(true);
    expect(mentionsWakeWord("hé, nova, range le projet", "hey Nova")).toBe(false);
  });
});

// ── 3. La tolerance est celle du nom ──────────────────────────────────────
describe("3. casse, accents et ponctuation sont ignores (comme le nom)", () => {
  it("majuscules, accents, ponctuation, espaces multiples", () => {
    const variantes = [
      "NOVA range le projet",
      "nova, range le projet",
      "Nôva ! range le projet",
      "  Nova   range le projet  ",
      "NOVA ? range le projet.",
    ];
    for (const texte of variantes) {
      expect(mentionsWakeWord(texte, "Nova"), texte).toBe(true);
      expect(
        decideVocalNameGate({ modeOuvert: true, texte, nom: NOM, motsDeReveil: "Nova" }).raison,
        texte,
      ).toBe("mot-reveil");
    }
    // Le mot de reveil accentue se compare aussi sans accent (l'inverse).
    expect(mentionsWakeWord("hey Lea, range le projet", "Léa")).toBe(true);
    // La MEME fonction de comparaison que le nom : aucune seconde regle.
    expect(mentionsWakeWord("NOVA", "Nova")).toBe(mentionsAssistantName("NOVA", "Nova"));
  });

  it("une phrase qui parle d'autre chose ne passe pas", () => {
    for (const texte of ["range le projet", "nouvelle version", "il a neigé cette nuit"]) {
      const d = decideVocalNameGate({ modeOuvert: true, texte, nom: NOM, motsDeReveil: "Nova" });
      expect(d.action, texte).toBe(VOCAL_GATE_JETER);
      expect(d.raison, texte).toBe("nom-absent");
    }
  });
});

// ── 4. Les autres regles ne bougent pas ───────────────────────────────────
describe("4. les regles existantes tiennent toujours", () => {
  it("hors du mode Vocal, rien ne change", () => {
    const d = decideVocalNameGate({
      modeOuvert: false,
      texte: "range le projet",
      nom: NOM,
      motsDeReveil: MOTS,
    });
    expect(d.action).toBe(VOCAL_GATE_LAISSER);
    expect(d.raison).toBe("hors-mode");
  });

  it("le clavier n'est jamais filtre", () => {
    const d = decideVocalNameGate({
      modeOuvert: true,
      texte: "range le projet",
      nom: NOM,
      motsDeReveil: MOTS,
      repriseMain: true,
    });
    expect(d.action).toBe(VOCAL_GATE_LAISSER);
    expect(d.raison).toBe("reprise-main");
  });

  it("le bouton « Reveiller » passe AVANT le nom et les mots de reveil", () => {
    const d = decideVocalNameGate({
      modeOuvert: true,
      texte: "range le projet",
      nom: NOM,
      motsDeReveil: MOTS,
      reveil: true,
    });
    expect(d.raison).toBe("reveil");
    expect(d.consommeReveil).toBe(true);
  });

  it("un mot de reveil inutilisable est ignore, jamais une faille", () => {
    // « , , » n'est pas un mot : la garde reste celle du nom.
    const d = decideVocalNameGate({
      modeOuvert: true,
      texte: "range le projet",
      nom: NOM,
      motsDeReveil: " , . , - ",
    });
    expect(d.action).toBe(VOCAL_GATE_JETER);
    expect(d.raison).toBe("nom-absent");
    expect(mentionsWakeWord("range le projet", " , . ")).toBe(false);
  });

  it("le fail-open du nom illisible survit, mais ne joue que sans mot de reveil", () => {
    // Nom inutilisable, aucun mot de reveil : on laisse passer (comportement
    // historique du §6quater, inchange).
    const sansMots = decideVocalNameGate({ modeOuvert: true, texte: "range le projet", nom: "..." });
    expect(sansMots.action).toBe(VOCAL_GATE_LAISSER);
    expect(sansMots.raison).toBe("nom-inutilisable");
    // Nom inutilisable MAIS un mot de reveil lisible : c'est lui qui filtre.
    const avecMots = decideVocalNameGate({
      modeOuvert: true,
      texte: "range le projet",
      nom: "...",
      motsDeReveil: "Nova",
    });
    expect(avecMots.action).toBe(VOCAL_GATE_JETER);
    expect(avecMots.raison).toBe("nom-absent");
    expect(
      decideVocalNameGate({ modeOuvert: true, texte: "Nova", nom: "...", motsDeReveil: "Nova" }).raison,
    ).toBe("mot-reveil");
  });
});

// ── 5. Le champ texte : separation et normalisation ───────────────────────
describe("5. la saisie libre est normalisee UNE fois", () => {
  it("virgules, points-virgules, retours a la ligne et espaces en trop", () => {
    expect(wakeWordsFrom("Nova, hey Nova")).toEqual(["Nova", "hey Nova"]);
    expect(wakeWordsFrom("Nova;hey Nova\nPilot")).toEqual(["Nova", "hey Nova", "Pilot"]);
    expect(wakeWordsFrom("  Nova  ,   hey   Nova  ")).toEqual(["Nova", "hey Nova"]);
  });

  it("entrees vides et doublons ignores (casse et accents compris)", () => {
    expect(wakeWordsFrom(", ,")).toEqual([]);
    expect(wakeWordsFrom("Nova, nova, NOVA")).toEqual(["Nova"]);
    expect(wakeWordsFrom("Léa, lea")).toEqual(["Léa"]);
    // Une valeur absente n'est pas une erreur : c'est le champ vide.
    for (const rien of [null, undefined, ""]) expect(wakeWordsFrom(rien)).toEqual([]);
  });

  it("une SEULE forme ecrite, donc un seul texte pour un meme reglage", () => {
    expect(wakeWordsText("  nova ,, HEY  nova ,héy nova ")).toBe("nova, HEY nova");
    expect(wakeWordsText(wakeWordsText("Nova, hey Nova"))).toBe("Nova, hey Nova");
    // Deux ecritures differentes du MEME reglage rendent le meme texte.
    expect(wakeWordsText("Nova,hey Nova")).toBe(wakeWordsText("Nova ;  hey Nova\nNova"));
  });

  it("la cle de configuration est unique et stable", () => {
    expect(VOCAL_WAKE_WORDS_KEY).toBe("vocal_wake_words");
  });
});

// ── 6. Le branchement ne double rien ─────────────────────────────────────
describe("6. un seul point de decision, un seul chemin d'envoi", () => {
  it("la garde est armee sur le nom OU sur un mot de reveil utilisable", () => {
    expect(vocalNameGateArmed({ modeOuvert: true, nom: NOM })).toBe(true);
    expect(vocalNameGateArmed({ modeOuvert: true, nom: NOM, motsDeReveil: MOTS })).toBe(true);
    // Nom illisible + un mot de reveil : la garde reste armee (sinon le refus
    // fonderait sur rien).
    expect(vocalNameGateArmed({ modeOuvert: true, nom: "...", motsDeReveil: MOTS })).toBe(true);
    // Nom illisible + aucun mot de reveil : fail-open, comme avant.
    expect(vocalNameGateArmed({ modeOuvert: true, nom: "..." })).toBe(false);
    // Hors du mode, jamais armee ; le reveil du bouton la leve.
    expect(vocalNameGateArmed({ modeOuvert: false, nom: NOM, motsDeReveil: MOTS })).toBe(false);
    expect(vocalNameGateArmed({ modeOuvert: true, nom: NOM, motsDeReveil: MOTS, reveil: true })).toBe(false);
    // Un mot de reveil inutilisable n'arme rien de plus.
    expect(vocalNameGateArmed({ modeOuvert: true, nom: "", motsDeReveil: " , " })).toBe(false);
  });

  it("la decision est prise UNE fois, avec les mots de reveil, sur le chemin unique", () => {
    expect((SUPER.match(/decideVocalNameGate\(/g) || []).length).toBe(1);
    expect((SUPER.match(/applyVoiceEnd\(/g) || []).length).toBe(1);
    const fin = sliceSource(SUPER, "    rec.onend = () => {", "      applyVocalState();\n    };", 2000);
    expect(fin).toContain("decideVocalNameGate({");
    expect(fin).toContain("motsDeReveil: vocalMotsDeReveil");
    // Le chemin « jete » ne contient aucun envoi : rien ne part.
    const jete = sliceSource(
      fin,
      "if (gardeNom.action === VOCAL_GATE_JETER) {",
      "      // Décision et ORDRE",
      100,
    );
    expect(jete).not.toContain("send(");
    expect(jete).not.toContain("applyVoiceEnd");
  });

  it("les resultats intermediaires respectent les mots de reveil", () => {
    const resultats = sliceSource(SUPER, "    rec.onresult = (e) => {", "    rec.onend = () => {", 1000);
    expect(resultats).toContain("motsDeReveil: vocalMotsDeReveil");
    expect(resultats).toContain("mentionsWakeWord(transcript, vocalMotsDeReveil)");
    // ... mais le nom reste exige en premier : la regle d'origine est intacte.
    expect(resultats).toContain("mentionsAssistantName(transcript, nomAttendu)");
  });

  it("les mots de reveil sont relus a chaud, et fail-open", () => {
    expect(SUPER).toContain("async function refreshVocalMotsDeReveil()");
    expect(SUPER).toContain("vocalMotsDeReveil = wakeWordsFrom(cfg && cfg.vocal_wake_words)");
    // Une configuration illisible laisse la liste VIDE : comportement d'avant.
    const corps = sliceSource(
      SUPER,
      "  async function refreshVocalMotsDeReveil() {",
      "  /**\n   * Relit le delai regle",
      100,
    );
    expect(corps).toContain("vocalMotsDeReveil = [];");
    // Relu au montage ET sur le changement de reglage existant (aucun second
    // ecouteur) : au moins deux appels.
    expect((SUPER.match(/refreshVocalMotsDeReveil\(\)/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it("aucun autre ecran n'importe la garde", () => {
    expect(AGENT_PI).not.toContain("vocal-nom-garde");
    expect(WEB).not.toContain("vocal-nom-garde");
    expect(AGENT_PI).not.toContain("vocal_wake_words");
    expect(WEB).not.toContain("vocal_wake_words");
  });
});

// ── 7. Le reglage : un champ, une cle ────────────────────────────────────
describe("7. le reglage vit a un seul endroit", () => {
  it("le champ texte est dans la section « Mode Vocal », avec son aide", () => {
    const section = sliceSource(
      HTML_NC,
      '<div class="settings-section" id="settings-section-vocal-delay">',
      "\n          </div>\n",
      200,
    );
    expect(section).toContain('id="setting-vocal-wake-words"');
    expect(section).toContain('type="text"');
    expect(section).toContain('for="setting-vocal-wake-words"');
    expect(section).toContain('aria-describedby="vocal-wake-words-note"');
    expect(section).toContain('id="vocal-wake-words-note"');
    expect(section).toContain('role="note"');
    // L'exemple du proprietaire est visible, et la promesse du champ vide est
    // ecrite noire sur blanc.
    expect(section).toContain("Nova, hey Nova");
    expect(section).toContain("Champ vide");
    // Un seul champ pour ce reglage dans toute l'application.
    expect((HTML.match(/id="setting-vocal-wake-words"/g) || []).length).toBe(1);
  });

  it("les reglages existants de la section sont intacts", () => {
    const section = sliceSource(
      HTML_NC,
      '<div class="settings-section" id="settings-section-vocal-delay">',
      "\n          </div>\n",
      200,
    );
    expect(section).toContain('id="setting-vocal-silence-send"');
    expect(section).toContain('id="setting-vocal-brevity-level"');
    expect(section).toContain('id="setting-local-dictation"');
  });

  it("l'enregistrement ecrit la valeur normalisee, une seule fois", () => {
    expect((REGLAGES.match(/vocal_wake_words:/g) || []).length).toBe(1);
    expect(REGLAGES).toContain("wakeWordsText(");
    // Relu et affiche a l'ouverture : le champ montre ce qui est memorise.
    expect(REGLAGES).toContain("inputVocalWakeWords.value = wakeWordsText(brut)");
  });

  it("la cle est lue par la fenetre et enregistree par la configuration Rust", () => {
    expect(SUPER).toContain("cfg.vocal_wake_words");
    // Le champ Rust est ADDITIF : jamais d'erreur si le fichier de config est
    // ancien (champ absent ⇒ chaine vide ⇒ le nom seul).
    const i = RUST.indexOf("    vocal_wake_words: String,");
    expect(i, "champ absent de la configuration Rust").toBeGreaterThan(-1);
    const debut = RUST.indexOf("struct AppConfig");
    expect(debut, "structure de configuration absente").toBeGreaterThan(-1);
    const justeAvant = RUST.slice(debut, i);
    // L'attribut `#[serde(default)]` precede IMMEDIATEMENT le champ : aucun
    // autre champ entre les deux (sinon un fichier de configuration ancien
    // ferait echouer la lecture).
    const dernierAttribut = justeAvant.lastIndexOf("#[serde(default)]");
    expect(dernierAttribut).toBeGreaterThan(0);
    const depuisAttribut = justeAvant.slice(dernierAttribut);
    expect(depuisAttribut.trim().split(/\n/)[0]).toBe("#[serde(default)]");
    expect((depuisAttribut.match(/:\s/g) || []).length).toBe(0);
    expect(RUST).toContain("vocal_wake_words: String::new()");
  });
});
