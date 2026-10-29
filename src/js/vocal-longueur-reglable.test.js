// Tests — LA LONGUEUR DES RÉPONSES ORALES DU MODE VOCAL SE RÈGLE (4 niveaux,
// « courtes » par défaut)
//
// CE QUE CE FICHIER VERROUILLE (et pourquoi) :
//   1. Les QUATRE niveaux existent (`tres-courte`, `courtes`, `moyenne`,
//      `detaillees`), chacun avec un libellé français, et un SEUL juge de ce
//      qu'une valeur vaut (`normalizeVocalBrevityLevel`) : valeur inconnue,
//      vide, nulle ou de casse différente ⇒ « courtes ».
//   2. Le DÉFAUT est « courtes » et demande DEUX phrases exactement (longueurs
//      arrêtées par le propriétaire : très courte = UNE phrase, courtes = DEUX
//      phrases, moyenne = QUATRE à SIX, détaillées = réponse développée).
//   3. Les CINQ invariants sont vrais pour LES QUATRE niveaux (test paramétré) :
//      (a) une demande de développement passe AVANT le niveau choisi ;
//      (b) une panne / un refus / une erreur / une demande de confirmation sont
//          dits ENTIÈREMENT ;
//      (c) aucune troncature (la brièveté vient de la consigne, jamais d'une
//          coupe) ;
//      (d) hors du mode Vocal, le texte est INCHANGÉ ;
//      (e) une demande vide ne reçoit aucune consigne.
//   4. Le RÉGLAGE est relu fail-open côté écran (valeur absente ou illisible ⇒
//      « courtes »), au montage ET dans le gestionnaire `pilot-config-changed`
//      DÉJÀ existant (aucun second écouteur), et appliqué à la demande SUIVANTE.
//   5. Le champ de configuration existe côté Rust avec un `#[serde(default)]`
//      (« courtes ») : aucune migration n'est nécessaire.
//   6. L'interface est un seul choix, dans la section « Mode Vocal » des
//      Paramètres (onglet Assistant), sous le curseur du délai d'envoi ; les
//      quatre libellés viennent du module pur (aucun libellé recopié en dur).
//   7. La documentation (spec du mode Vocal, spec de la lecture à voix haute,
//      aide embarquée) dit le réglage.
//
// Les commentaires sont en ASCII ; les chaînes qui viennent du code sont copiées
// telles quelles. Fins de ligne normalisées (quality-gate 3.4).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sliceSource } from "./source-slice.js";
import {
  VOCAL_BREVITY_DEFAULT_LEVEL,
  VOCAL_BREVITY_INSTRUCTION,
  VOCAL_BREVITY_LEVELS,
  composeVocalPrompt,
  normalizeVocalBrevityLevel,
  vocalBrevityInstruction,
  vocalBrevityLabel,
} from "./vocal-brevity.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) =>
  readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");

const MODULE = lire("src/js/vocal-brevity.js");
const SUPER = lire("src/js/super-agent.js");
const SETTINGS = lire("src/js/settings.js");
const HTML = lire("index.html");
// Le balisage seul (sans les commentaires) : un commentaire qui explique le
// reglage ne doit pas faire croire a un element supplementaire.
const HTML_NC = HTML.replace(/<!--[\s\S]*?-->/g, "");
const RUST = lire("src-tauri/src/lib.rs");
const SPEC_VOCAL = lire("spec_modes_ecran_vocal.md");
const SPEC_LECTURE = lire("spec_read_aloud.md");
const HELP = lire("help/overview.md");
const HANDBOOK = lire("help/handbook.md");

/** Corps d'une fonction (ancre de fin : fermeture en colonne 2). */
function corpsFonction(src, entete) {
  return sliceSource(src, entete, "\n  }\n", 40);
}

/**
 * La consigne du niveau PAR DEFAUT (« courtes » : DEUX phrases), recopiee ici
 * MOT POUR MOT : c'est ce qui part quand aucun niveau n'est transmis.
 */
const CONSIGNE_DEFAUT = [
  "## Mode vocal — parler court",
  "Cette demande vient de l'écran Vocal de Pilot : la conversation n'y est pas affichée et ta réponse va être LUE À VOIX HAUTE.",
  "Règle de conversation parlée : réponds en DEUX phrases, exactement deux, pas trois — comme à l'oral. Pas de listes, pas de titres, pas de tableaux, pas de noms de fichiers, pas de code. Va droit à ce qui est utile à dire à voix haute : ce que tu as fait, ce que ça donne, ce qu'il faut décider.",
  "Si l'utilisateur demande explicitement de développer ou plus de détails (« détaille », « explique », « pourquoi », « comment », « donne-moi le détail »), alors développe autant qu'il faut : la règle de brièveté NE S'APPLIQUE PLUS, donne le détail demandé en entier, en restant compréhensible à l'oreille (des phrases suivies, jamais un tableau ni de code).",
  "Exception qui passe AVANT la brièveté : une panne, un refus, une erreur (outil, micro, agent) ou une demande de confirmation se disent ENTIÈREMENT — tout ce qu'il faut pour comprendre et agir, même si c'est plus long que deux phrases. Ne cache jamais une information utile pour rester court.",
].join("\n");

/** Les quatre niveaux, un par cas du test parametre. */
const NIVEAUX = VOCAL_BREVITY_LEVELS;

// ── 1. Les quatre niveaux et leurs libelles ───────────────────────────────
describe("les quatre niveaux de longueur", () => {
  it("il y en a exactement quatre, aux cles stables et lisibles", () => {
    expect(NIVEAUX).toEqual(["tres-courte", "courtes", "moyenne", "detaillees"]);
    // Aucun doublon : chaque niveau est un cas distinct.
    expect(new Set(NIVEAUX).size).toBe(NIVEAUX.length);
  });

  it("chacun a un libelle francais, non vide et distinct", () => {
    const libelles = NIVEAUX.map((n) => vocalBrevityLabel(n));
    expect(libelles).toEqual(["Très courte", "Courtes", "Moyenne", "Détaillées"]);
    for (const l of libelles) expect(l.trim()).not.toBe("");
    expect(new Set(libelles).size).toBe(4);
  });

  it("le libelle passe par la normalisation (valeur inconnue ⇒ defaut)", () => {
    expect(vocalBrevityLabel("n-importe-quoi")).toBe("Courtes");
    expect(vocalBrevityLabel(null)).toBe("Courtes");
    expect(vocalBrevityLabel(undefined)).toBe("Courtes");
    expect(vocalBrevityLabel("")).toBe("Courtes");
  });
});

// ── 2. Le defaut : « courtes », soit DEUX phrases ────────────────────────
describe("le defaut : « courtes » dit DEUX phrases", () => {
  it("le niveau par defaut est « courtes »", () => {
    expect(VOCAL_BREVITY_DEFAULT_LEVEL).toBe("courtes");
  });

  it("la consigne par defaut est EXACTEMENT la consigne « deux phrases »", () => {
    expect(VOCAL_BREVITY_INSTRUCTION).toBe(CONSIGNE_DEFAUT);
    expect(vocalBrevityInstruction(VOCAL_BREVITY_DEFAULT_LEVEL)).toBe(CONSIGNE_DEFAUT);
    // Sans niveau transmis (ou avec un niveau inconnu), c'est elle qui part.
    expect(vocalBrevityInstruction()).toBe(CONSIGNE_DEFAUT);
    expect(vocalBrevityInstruction("inconnu")).toBe(CONSIGNE_DEFAUT);
    const demande = "Où en est le projet ?";
    expect(composeVocalPrompt(demande, { modeVocal: true })).toBe(
      `${demande}\n\n${CONSIGNE_DEFAUT}`
    );
    expect(composeVocalPrompt(demande, { modeVocal: true, niveau: "inconnu" })).toBe(
      `${demande}\n\n${CONSIGNE_DEFAUT}`
    );
  });

  it("une valeur inconnue, vide, nulle ou de casse differente ⇒ defaut", () => {
    for (const brut of [
      "tres-courtes",
      "TRES-COURTE",
      "Courtes",
      "MOYENNE",
      "detaille",
      "  ",
      "",
      null,
      undefined,
      42,
      {},
      [],
      true,
    ]) {
      expect(normalizeVocalBrevityLevel(brut), String(brut)).toBe(
        VOCAL_BREVITY_DEFAULT_LEVEL
      );
    }
    // Les quatre cles, elles, sont reconnues telles quelles (espaces autour
    // tolérés : ce n'est pas une autre casse).
    for (const niveau of NIVEAUX) {
      expect(normalizeVocalBrevityLevel(niveau)).toBe(niveau);
      expect(normalizeVocalBrevityLevel(` ${niveau} `)).toBe(niveau);
    }
    // La normalisation est idempotente.
    for (const niveau of NIVEAUX) {
      expect(normalizeVocalBrevityLevel(normalizeVocalBrevityLevel(niveau))).toBe(niveau);
    }
  });
});

// ── 3. Le contenu de chaque niveau (le coeur) ─────────────────────────────
describe("chaque niveau dit sa longueur, en clair", () => {
  // Les nombres EXACTS arretes par le proprietaire, en toutes lettres dans la
  // consigne (pour qu'un modele ne les lise pas de travers).
  const ATTENDU = {
    "tres-courte": /en UNE phrase, une seule, pas deux/,
    courtes: /en DEUX phrases, exactement deux, pas trois/,
    moyenne: /QUATRE À SIX PHRASES/,
    detaillees: /COMPLÈTE ET DÉVELOPPÉE/,
  };

  for (const niveau of NIVEAUX) {
    it(`« ${niveau} » annonce sa longueur`, () => {
      expect(vocalBrevityInstruction(niveau)).toMatch(ATTENDU[niveau]);
    });
  }

  it("la longueur de chaque niveau est le nombre EXACT retenu", () => {
    const tresCourte = vocalBrevityInstruction("tres-courte");
    expect(tresCourte).toMatch(/UNE phrase/);
    expect(tresCourte).toMatch(/pas deux/);
    // Aucune autre fourchette ne subsiste pour ce niveau.
    expect(tresCourte).not.toMatch(/UNE À DEUX/);

    const courtes = vocalBrevityInstruction("courtes");
    expect(courtes).toMatch(/DEUX phrases/);
    expect(courtes).toMatch(/pas trois/);
    expect(courtes).not.toMatch(/TROIS PHRASES/);
    expect(courtes).not.toMatch(/AU PLUS/);

    const moyenne = vocalBrevityInstruction("moyenne");
    expect(moyenne).toMatch(/QUATRE À SIX PHRASES/);

    // « detaillees » ne fixe aucun nombre : c'est le niveau sans plafond.
    expect(vocalBrevityInstruction("detaillees")).not.toMatch(/PHRASES/);
  });

  it("« moyenne » ajoute le pourquoi quand il aide", () => {
    expect(vocalBrevityInstruction("moyenne")).toMatch(/donne le pourquoi quand il aide/);
  });

  it("« detaillees » reste une reponse PARLEE : ni tableau, ni code, ni nom de fichier", () => {
    const consigne = vocalBrevityInstruction("detaillees");
    expect(consigne).toMatch(/pas de tableaux/i);
    expect(consigne).toMatch(/pas de code/i);
    expect(consigne).toMatch(/jamais un nom de fichier lu à voix haute/);
    expect(consigne).toMatch(/dite à l'oreille/);
    // Elle ne fixe PAS de nombre de phrases : c'est le niveau sans plafond.
    expect(consigne).not.toMatch(/PHRASES AU PLUS/);
  });

  it("les quatre consignes sont differentes (aucun niveau ne se confond)", () => {
    const textes = NIVEAUX.map((n) => vocalBrevityInstruction(n));
    expect(new Set(textes).size).toBe(4);
  });

  it("toutes interdisent listes, titres, tableaux, noms de fichiers et code", () => {
    for (const niveau of NIVEAUX) {
      const consigne = vocalBrevityInstruction(niveau);
      expect(consigne, niveau).toMatch(/pas de listes/i);
      expect(consigne, niveau).toMatch(/pas de titres/i);
      expect(consigne, niveau).toMatch(/pas de tableaux|jamais de tableau/i);
      expect(consigne, niveau).toMatch(/pas de noms de fichiers|jamais un nom de fichier/i);
      expect(consigne, niveau).toMatch(/pas de code/i);
      expect(consigne, niveau).toMatch(/utile à dire à voix haute/i);
    }
  });
});

// ── 4. Les cinq invariants, POUR LES QUATRE NIVEAUX ───────────────────────
describe("ce qui ne change jamais, quel que soit le niveau", () => {
  for (const niveau of NIVEAUX) {
    it(`« ${niveau} » : developper passe AVANT le niveau choisi`, () => {
      const consigne = vocalBrevityInstruction(niveau);
      // Les quatre mots que l'utilisateur peut dire, tels quels.
      for (const mot of ["détaille", "explique", "pourquoi", "comment"]) {
        expect(consigne, `${niveau}/${mot}`).toContain(mot);
      }
      expect(consigne).toMatch(/demande explicitement de développer/);
      expect(consigne).toMatch(/alors développe/);
      expect(consigne).toMatch(/compréhensible à l'oreille/);
      // La PRIORITE est dite, en clair, dans chaque niveau.
      if (niveau === VOCAL_BREVITY_DEFAULT_LEVEL) {
        // Le niveau par defaut garde sa formulation d'origine : c'est « alors
        // développe » qui tranche, juste apres la regle de longueur.
        expect(CONSIGNE_DEFAUT).toContain("alors développe");
      } else {
        expect(consigne).toMatch(/passe AVANT le niveau de longueur choisi/);
      }
    });

    it(`« ${niveau} » : une panne, un refus, une erreur se disent ENTIEREMENT`, () => {
      const consigne = vocalBrevityInstruction(niveau);
      for (const cas of ["panne", "refus", "erreur", "micro", "demande de confirmation"]) {
        expect(consigne, `${niveau}/${cas}`).toContain(cas);
      }
      expect(consigne).toMatch(/AVANT la brièveté/);
      expect(consigne).toMatch(/ENTIÈREMENT/);
      expect(consigne).toMatch(/Ne cache jamais une information utile/);
    });

    it(`« ${niveau} » : AUCUNE troncature, la demande reste intacte`, () => {
      const longue = "mot ".repeat(4000).trim();
      const message = composeVocalPrompt(longue, { modeVocal: true, niveau });
      expect(message.length).toBe(
        longue.length + 2 + vocalBrevityInstruction(niveau).length
      );
      expect(message.slice(0, longue.length)).toBe(longue);
    });

    it(`« ${niveau} » : hors du mode Vocal, le texte est INCHANGE`, () => {
      const demande = "Où en est le projet Pilot ?";
      expect(composeVocalPrompt(demande, { niveau })).toBe(demande);
      expect(composeVocalPrompt(demande, { modeVocal: false, niveau })).toBe(demande);
      expect(composeVocalPrompt(demande, null)).toBe(demande);
      expect(composeVocalPrompt(demande, { niveau })).not.toContain("Mode vocal");
    });

    it(`« ${niveau} » : une demande vide ne recoit aucune consigne`, () => {
      for (const vide of ["", "   ", "\n\n", null, undefined, 42]) {
        expect(composeVocalPrompt(vide, { modeVocal: true, niveau })).toBe(
          typeof vide === "string" ? vide : ""
        );
      }
    });
  }

  it("le module ne coupe rien : aucune primitive de troncature, aucun plafond", () => {
    const code = MODULE.split("\n")
      .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
      .join("\n");
    expect(code).not.toContain(".slice(");
    expect(code).not.toContain(".substring(");
    expect(code).not.toContain(".substr(");
    expect(code).not.toMatch(/MAX_[A-Z_]*CHARS/);
    expect(code).not.toMatch(/\.length\s*>\s*\d/);
  });

  it("le module reste PUR : ni DOM, ni invoke, ni etat, ni cle de configuration", () => {
    expect(MODULE).not.toContain("document.");
    expect(MODULE).not.toContain("window.");
    expect(MODULE).not.toContain("localStorage");
    expect(MODULE).not.toContain("invoke(");
    expect(MODULE).not.toContain("vocal_brevity_level");
  });

  it("la consigne est construite a UN SEUL endroit (aucune copie ailleurs)", () => {
    expect((MODULE.match(/export function vocalBrevityInstruction\(/g) || [])).toHaveLength(1);
    expect((MODULE.match(/export function composeVocalPrompt\(/g) || [])).toHaveLength(1);
    // Les autres modules ne recopient ni les consignes ni les cles de niveau.
    for (const nom of ["agent-pi.js", "vocal-mic.js", "vocal-conversation.js", "voice-auto-send.js"]) {
      const src = lire(`src/js/${nom}`);
      expect(src, nom).not.toContain("Mode vocal — parler court");
      expect(src, nom).not.toContain("PHRASES AU PLUS");
    }
    expect(lire("src-tauri/src/super_agent.rs")).not.toContain("PHRASES AU PLUS");
  });
});

// ── 5. Le reglage : relecture fail-open, application a la demande suivante ─
describe("le reglage est relu sans redemarrage, et il est fail-open", () => {
  it("une seule variable d'etat porte le niveau, et elle est normalisee", () => {
    expect((SUPER.match(/let vocalLongueurNiveau = /g) || [])).toHaveLength(1);
    const refresh = corpsFonction(SUPER, "async function refreshVocalLongueurNiveau()");
    // Lecture de la configuration + juge unique.
    expect(refresh).toContain('await invoke("get_config")');
    expect(refresh).toContain("normalizeVocalBrevityLevel(cfg && cfg.vocal_brevity_level)");
    // FAIL-OPEN : une configuration illisible retombe sur le defaut.
    expect(refresh).toContain("normalizeVocalBrevityLevel(null)");
    // Aucun niveau recopie en dur dans l'ecran.
    expect(SUPER).not.toContain('"tres-courte"');
    expect(SUPER).not.toContain('"detaillees"');
  });

  it("elle est appelee au montage ET dans le gestionnaire deja existant", () => {
    // Deux appels exactement : montage + changement de reglage.
    expect((SUPER.match(/refreshVocalLongueurNiveau\(\);/g) || [])).toHaveLength(2);
    // Aucun NOUVEL ecouteur : un seul `pilot-config-changed` par handler.
    expect((SUPER.match(/addEventListener\("pilot-config-changed"/g) || []).length).toBeGreaterThan(0);
    const handler = sliceSource(
      SUPER,
      "  const onConfigChanged = () => {",
      "  window.addEventListener(\"pilot-config-changed\", onConfigChanged);",
      100
    );
    expect(handler).toContain("refreshVocalLongueurNiveau();");
  });

  it("le niveau est transmis au SEUL point de composition (a l'envoi)", () => {
    const send = sliceSource(
      SUPER,
      "  async function send() {",
      "  // ── Bouton « Analyser et ranger mes données »",
      1000
    );
    expect(send).toContain("niveau: vocalLongueurNiveau,");
    expect(send).toContain("composeVocalPrompt(text, {");
    // Le niveau est lu au moment de composer : un reglage change s'applique a la
    // demande SUIVANTE, jamais a une demande deja partie.
    expect(SUPER).not.toContain("send_super_agent_prompt\", { message: messageAgent, niveau");
  });

  it("Rust : un champ a `#[serde(default)]`, donc aucune migration", () => {
    expect(RUST).toContain("#[serde(default = \"default_vocal_brevity_level\")]");
    expect(RUST).toContain("vocal_brevity_level: String,");
    expect(RUST).toContain('fn default_vocal_brevity_level() -> String { "courtes".to_string() }');
    // Initialise dans `Default` : une configuration neuve porte le defaut.
    expect(RUST).toContain("vocal_brevity_level: default_vocal_brevity_level(),");
  });
});

// ── 6. L'interface : un seul choix, dans la section « Mode Vocal » ────────
describe("Parametres → onglet Assistant → section « Mode Vocal »", () => {
  const ID = 'id="setting-vocal-brevity-level"';

  it("le choix existe une seule fois, dans la section du mode Vocal", () => {
    expect(HTML.split(ID).length - 1).toBe(1);
    const section = sliceSource(
      HTML_NC,
      '<div class="settings-section" id="settings-section-vocal-delay">',
      "\n          </div>\n",
      200
    );
    expect(section).toContain(ID);
    // Sous le curseur du delai d'envoi, dans la MEME section.
    const curseur = section.indexOf('id="setting-vocal-silence-send"');
    const choix = section.indexOf(ID);
    expect(curseur).toBeGreaterThan(-1);
    expect(choix).toBeGreaterThan(curseur);
    // Toujours dans l'onglet Assistant.
    const panneau = HTML.indexOf('data-settings-panel="superagent"');
    const suivant = HTML.indexOf('data-settings-panel="', panneau + 10);
    const debut = HTML.indexOf(ID);
    expect(debut).toBeGreaterThan(panneau);
    expect(suivant === -1 || debut < suivant).toBe(true);
  });

  it("libelle relie et phrase d'explication en francais simple", () => {
    const section = sliceSource(
      HTML_NC,
      '<div class="settings-section" id="settings-section-vocal-delay">',
      "\n          </div>\n",
      200
    );
    expect(section).toMatch(/<label for="setting-vocal-brevity-level"/);
    expect(section).toContain('aria-describedby="vocal-brevity-note"');
    expect(section).toContain('id="vocal-brevity-note"');
    expect(section).toMatch(/role="note"/);
    expect(section).toMatch(/deux phrases/);
  });

  it("aucun libelle recopie en dur : les quatre entrees viennent du module pur", () => {
    const section = sliceSource(
      HTML_NC,
      '<div class="settings-section" id="settings-section-vocal-delay">',
      "\n          </div>\n",
      200
    );
    // Le balisage ne porte AUCUNE entree : le choix est rempli par settings.js.
    expect(section).not.toContain("<option");
    for (const libelle of ["Très courte", "Courtes", "Moyenne", "Détaillées"]) {
      expect(HTML_NC).not.toContain(`${libelle}</option>`);
    }
    // Les libelles viennent de la source unique `vocalBrevityLabel`.
    expect(SETTINGS).toContain('getElementById("setting-vocal-brevity-level")');
    expect(SETTINGS).toContain("vocalBrevityLabel(niveau)");
    expect(SETTINGS).toContain("for (const niveau of VOCAL_BREVITY_LEVELS)");
    expect(SETTINGS).not.toContain('"Très courte"');
  });

  it("memorisation : la valeur enregistree est toujours normalisee", () => {
    expect(SETTINGS).toMatch(/vocal_brevity_level: normalizeVocalBrevityLevel\(/);
    // Relecture au chargement de la modale.
    expect(SETTINGS).toMatch(
      /refreshVocalBrevityLevel\(currentConfig && currentConfig\.vocal_brevity_level\);/
    );
  });
});

// ── 7. La documentation dit le reglage ───────────────────────────────────
describe("documentation : le reglage est dit aux trois endroits", () => {
  it("la spec du mode Vocal nomme les quatre niveaux et le defaut", () => {
    expect(SPEC_VOCAL).toContain("vocalBrevityInstruction");
    expect(SPEC_VOCAL).toContain("vocal_brevity_level");
    expect(SPEC_VOCAL).toMatch(/très courte/i);
    expect(SPEC_VOCAL).toMatch(/détaillées/i);
    expect(SPEC_VOCAL).toMatch(/courtes.*par défaut|défaut.*courtes/i);
    expect(SPEC_VOCAL).toMatch(/demande suivante/i);
  });

  it("la spec de la lecture a voix haute nomme le voisin et les quatre niveaux", () => {
    expect(SPEC_LECTURE).toContain("#setting-vocal-brevity-level");
    expect(SPEC_LECTURE).toMatch(/vocal_brevity_level/);
  });

  it("l'aide embarquee le dit en langage utilisateur (source puis handbook)", () => {
    expect(HELP).toMatch(/Longueur des réponses à l'oral/);
    expect(HELP).toMatch(/Très courte/);
    expect(HANDBOOK).toMatch(/Longueur des réponses à l'oral/);
    expect(HANDBOOK).toMatch(/Très courte/);
  });
});
