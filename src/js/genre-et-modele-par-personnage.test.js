// genre-et-modele-par-personnage.test.js — TÂCHES 402 et 403.
//
// Ce que ce fichier VERROUILLE (chaque test échoue si sa règle disparaît) :
//   1. le genre a TROIS valeurs et une seule règle de normalisation côté fenêtre,
//      et « non précisé » (défaut) n'impose RIEN ;
//   2. la phrase de genre injectée dans le prompt est écrite à UN SEUL endroit
//      (`assistant_identity.rs`) : aucune copie en dur ailleurs — si une seconde
//      phrase apparaît, ou si la phrase unique disparaît, le test échoue ;
//   3. le réglage est ADDITIF : la clé `assistant_gender` est déclarée avec
//      `#[serde(default)]` (un ancien fichier de configuration reste lisible) et
//      l'enregistrement des Options l'écrit (sinon le réglage serait perdu à
//      chaque enregistrement, qui réécrit TOUTE la configuration) ;
//   4. la FICHE du personnage porte son genre et son modèle, lus sans jamais
//      ouvrir le portrait, et un fichier absent n'est jamais une erreur ;
//   5. le MODÈLE du personnage est décidé à UN SEUL endroit, avec un repli
//      TOUJOURS présent (modèle choisi → réglage dédié → défaut global) : c'est
//      ce repli qui garantit « aucun modèle défini pour le personnage = le
//      modèle réglé dans Pilot » ;
//   6. ce repli ne peut pas ÉCHOUER (aucun `Result` : le démarrage ne refuse
//      jamais à cause d'une fiche), il est DIT à l'utilisateur, et il ne touche
//      PAS la sélection de modèle par couple (projet, agent), qui reste réglée
//      sur la session de l'agent concerné.

import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  ASSISTANT_GENDER_FEMININE,
  ASSISTANT_GENDER_KEY,
  ASSISTANT_GENDER_MASCULINE,
  ASSISTANT_GENDER_NONE,
  ASSISTANT_GENDER_OPTIONS,
  assistantGenderIsUnspecified,
  assistantGenderLabel,
  decideAssistantGenderValue,
  normalizeAssistantGender,
} from "./assistant-genre.js";
import { sliceSource } from "./source-slice.js";

/** Lit un fichier source avec les fins de ligne normalisées (piège CRLF CI). */
function read(rel) {
  return readFileSync(rel, "utf8").replace(/\r\n/g, "\n");
}

/**
 * Découpe une fonction Rust par son en-tête, jusqu'à la ligne `}` seule à la
 * colonne zéro. Ancre absente ⇒ erreur (jamais un fragment vide qui ferait
 * passer l'assertion pour rien).
 */
function rustFunction(src, header) {
  return sliceSource(src, header, "\n}\n", 60) + "\n}\n";
}

// ── 1. Le genre côté fenêtre : trois valeurs, une normalisation ────────────

describe("genre de l'Assistant — la décision côté fenêtre", () => {
  it("trois choix seulement, et le défaut n'impose rien", () => {
    expect(ASSISTANT_GENDER_OPTIONS).toHaveLength(3);
    expect(ASSISTANT_GENDER_OPTIONS.map((o) => o.value)).toEqual([
      ASSISTANT_GENDER_NONE,
      ASSISTANT_GENDER_FEMININE,
      ASSISTANT_GENDER_MASCULINE,
    ]);
    // La valeur par défaut est VIDE : aucune consigne ne part au prompt.
    expect(ASSISTANT_GENDER_NONE).toBe("");
    expect(assistantGenderIsUnspecified(ASSISTANT_GENDER_NONE)).toBe(true);
  });

  it("une valeur inconnue ne devient JAMAIS un genre", () => {
    for (const inconnu of ["", "  ", null, undefined, "autre", "non précisé", 42, "x"]) {
      expect(normalizeAssistantGender(inconnu)).toBe(ASSISTANT_GENDER_NONE);
      expect(assistantGenderIsUnspecified(inconnu)).toBe(true);
    }
  });

  it("casse et accents sont tolérés, et l'aller-retour ne perd rien", () => {
    expect(normalizeAssistantGender("Féminin")).toBe(ASSISTANT_GENDER_FEMININE);
    expect(normalizeAssistantGender(" FEMININ ")).toBe(ASSISTANT_GENDER_FEMININE);
    expect(normalizeAssistantGender("Masculin")).toBe(ASSISTANT_GENDER_MASCULINE);
    // Ce que le champ enregistre se relit à l'identique (aucune boucle folle).
    for (const option of ASSISTANT_GENDER_OPTIONS) {
      expect(decideAssistantGenderValue(option.value)).toBe(option.value);
      expect(normalizeAssistantGender(decideAssistantGenderValue(option.value))).toBe(option.value);
    }
    // Un libellé lisible existe pour chaque valeur.
    for (const option of ASSISTANT_GENDER_OPTIONS) {
      expect(assistantGenderLabel(option.value)).toBe(option.label);
    }
  });

  it("la clé de configuration est une seule et est celle du Rust", () => {
    expect(ASSISTANT_GENDER_KEY).toBe("assistant_gender");
    const lib = read("src-tauri/src/lib.rs");
    expect(lib).toContain("assistant_gender: String");
  });
});

// ── 2. Une seule phrase de genre, à un seul endroit ────────────────────────

describe("consigne de genre — une seule source", () => {
  it("le module d'identité définit la fonction UNE fois", () => {
    const src = read("src-tauri/src/assistant_identity.rs");
    expect(src.match(/fn assistant_gender_instruction/g) ?? []).toHaveLength(1);
    const corps = rustFunction(src, "pub fn assistant_gender_instruction(");
    // Les deux genres produisent une consigne, « non précisé » n'en produit pas.
    expect(corps).toContain("AssistantGender::Feminine");
    expect(corps).toContain("AssistantGender::Masculine");
    expect(corps).toContain("AssistantGender::Unspecified => return String::new()");
  });

  it("aucune autre phrase de genre en dur dans le prompt de l'assistant", () => {
    // Seul le code de PRODUCTION est inspecté (avant les tests du module, qui
    // citent forcément la consigne pour la vérifier).
    const superAgent = read("src-tauri/src/super_agent.rs").split("#[cfg(test)]")[0];
    const identite = read("src-tauri/src/assistant_identity.rs").split("#[cfg(test)]")[0];
    // La consigne n'existe QUE dans le module d'identité : le prompt de
    // l'assistant ne contient aucune phrase de genre écrite à la main.
    for (const interdit of ["au féminin", "au masculin", "Identité de genre"]) {
      expect(superAgent).not.toContain(interdit);
      expect(identite).toContain(interdit);
    }
    // Et le prompt reçoit le bloc par le champ unique `identity`.
    expect(superAgent).toContain("identity: &'a str");
    expect(superAgent).toContain("full_system.push_str(blocks.identity)");
    expect(superAgent).toContain("assistant_identity::assistant_identity_block");
  });

  it("le réglage du fichier de configuration est additif (serde default)", () => {
    const lib = read("src-tauri/src/lib.rs");
    const bloc = sliceSource(
      lib,
      "    // Genre de l'Assistant",
      "    super_agent_clients: Vec<String>,",
      80,
    );
    expect(bloc).toContain("#[serde(default)]");
    expect(bloc).toContain("assistant_gender: String");
    // Le défaut de la structure est vide (aucun genre imposé).
    expect(lib).toContain("assistant_gender: String::new()");
  });
});

// ── 3. Le réglage existe à l'écran et survit à un enregistrement ───────────

describe("réglage visible — Options → Assistant", () => {
  it("l'écran propose les trois choix, dans l'ordre, avec le défaut vide", () => {
    const html = read("index.html");
    const select = sliceSource(html, 'id="setting-assistant-gender"', "</select>", 120);
    expect(select).toContain('<option value="">Non précisé');
    expect(select).toContain('<option value="feminin">Féminin</option>');
    expect(select).toContain('<option value="masculin">Masculin</option>');
  });

  it("les Options lisent ET enregistrent le genre (jamais perdu)", () => {
    const js = read("src/js/settings.js");
    // Lecture : la valeur passe TOUJOURS par la normalisation.
    expect(js).toContain("normalizeAssistantGender(currentConfig[ASSISTANT_GENDER_KEY])");
    // Enregistrement : la clé est écrite dans l'objet sauvegardé.
    expect(js).toContain("assistant_gender: normalizeAssistantGender(");
    // Le module importé est le seul à fournir la décision.
    expect(js).toContain('from "./assistant-genre.js"');
  });
});

// ── 4. La fiche du personnage : deux champs de plus, jamais d'erreur ───────

describe("fiche du personnage — genre et modèle", () => {
  it("les noms de fichiers sont déclarés une seule fois", () => {
    const persona = read("src-tauri/src/persona.rs");
    expect(persona.match(/PERSONA_GENDER_FILE: &str = "genre\.txt"/g) ?? []).toHaveLength(1);
    expect(persona.match(/PERSONA_MODEL_FILE: &str = "modele\.txt"/g) ?? []).toHaveLength(1);
  });

  it("la lecture de la fiche renseigne les deux champs, sans erreur si absents", () => {
    const persona = read("src-tauri/src/persona.rs");
    const lecture = rustFunction(persona, "pub fn read_persona(dir: &Path) -> Persona {");
    expect(lecture).toContain("PERSONA_GENDER_FILE");
    expect(lecture).toContain("PERSONA_MODEL_FILE");
    // Un fichier absent donne `None` (donc réglage de Pilot), jamais une panne.
    expect(lecture).not.toContain("expect(");
    expect(lecture).not.toContain("unwrap()");
    expect(lecture).not.toContain("?;");
  });

  it("l'identité lue à chaque message ne charge JAMAIS le portrait", () => {
    const persona = read("src-tauri/src/persona.rs");
    const identite = rustFunction(
      persona,
      "pub fn read_persona_identity(dir: &Path) -> PersonaIdentity {",
    );
    expect(identite).not.toContain("PERSONA_IMAGE_FILE");
    expect(identite).not.toContain("read_persona(dir)");
    // Et l'assemblage du prompt passe bien par cette lecture légère.
    const superAgent = read("src-tauri/src/super_agent.rs");
    expect(superAgent).toContain("read_active_persona_identity");
  });
});

// ── 5. Le modèle du personnage : une décision, un repli toujours présent ───

describe("modèle par personnage — décision unique et repli", () => {
  it("la priorité des modèles est écrite une seule fois", () => {
    const identite = read("src-tauri/src/assistant_identity.rs");
    expect(identite.match(/pub fn decide_assistant_model/g) ?? []).toHaveLength(1);
    const decision = rustFunction(identite, "pub fn decide_assistant_model(");
    // Les quatre étages, dans l'ordre, et la fiche en tête.
    const fiche = decision.indexOf("AssistantModelSource::Persona");
    const choisi = decision.indexOf("AssistantModelSource::Chosen");
    const dedie = decision.indexOf("AssistantModelSource::Dedicated");
    const global = decision.indexOf("AssistantModelSource::Global");
    expect(fiche).toBeGreaterThan(0);
    expect(choisi).toBeGreaterThan(fiche);
    expect(dedie).toBeGreaterThan(choisi);
    expect(global).toBeGreaterThan(dedie);
  });

  it("un modèle de personnage introuvable retombe sur Pilot AVEC une trace", () => {
    const identite = read("src-tauri/src/assistant_identity.rs");
    const decision = rustFunction(identite, "pub fn decide_assistant_model(");
    expect(decision).toContain("trace = Some(");
    expect(decision).toContain("introuvable");
    // La trace est publiée (jamais un échec silencieux, jamais bloquant).
    const superAgent = read("src-tauri/src/super_agent.rs");
    expect(superAgent).toContain("pilot-assistant-model-trace");
    expect(superAgent).toContain("decision.trace.as_deref()");
  });

  it("le démarrage de session passe par la décision, pas par une chaîne recopiée", () => {
    const superAgent = read("src-tauri/src/super_agent.rs");
    const demarrage = rustFunction(
      superAgent,
      "pub(crate) fn do_start_super_agent_session(state: &AppState, app: &AppHandle) -> Result<(), String> {",
    );
    expect(demarrage).toContain("assistant_session_model(");
    // Plus de chaîne de repli écrite en clair dans le démarrage : elle vit dans
    // le module d'identité (sinon deux règles finiraient par diverger).
    expect(demarrage).not.toContain("resolve_super_agent_model(");
  });
});

// ── 6. Le repli ne bloque rien, il se dit, et il ne touche pas les agents ──

describe("modèle par personnage — jamais bloquant, toujours dit, jamais imposé aux agents", () => {
  it("un modèle inconnu ne peut pas faire échouer le démarrage", () => {
    const superAgent = read("src-tauri/src/super_agent.rs");
    const decision = rustFunction(superAgent, "pub(crate) fn assistant_session_model(");
    // Elle décide, elle ne REFUSE pas : aucun `Result` à propager, donc aucune
    // panne possible au démarrage (la fiche ne peut pas bloquer l'assistant).
    expect(decision).toContain("-> crate::assistant_identity::AssistantModelDecision");
    expect(decision).not.toContain("-> Result");
    expect(decision).not.toContain("?;");
    // La fiche est lue en fail-open : aucune fiche = chaîne de Pilot.
    expect(decision).toContain("read_active_persona_identity(app)");
    expect(decision).toContain("unwrap_or_default()");
  });

  it("le repli est DIT à l'utilisateur, pas seulement écrit dans un journal", () => {
    const superAgent = read("src/js/super-agent.js");
    // L'évènement publié par Rust est réellement ÉCOUTÉ et affiché…
    expect(superAgent).toContain('listen("pilot-assistant-model-trace"');
    expect(superAgent).toContain('pushSuperAgentSystemEvent("warn"');
    // … par une écoute enregistrée au démarrage (pas à l'ouverture d'un onglet).
    expect(read("src/js/main.js")).toContain("initAssistantModelTraceWatch()");
  });

  it("la fiche n'est lue que sur le chemin de l'Assistant", () => {
    // Un seul fichier Rust APPELLE la lecture de l'identité du personnage actif :
    // le prompt et le modèle de l'ASSISTANT (`persona.rs` la DÉFINIT, il ne
    // l'appelle pas). Aucune couche agent ne la consulte.
    const fichiers = readdirSync("src-tauri/src").filter((f) => f.endsWith(".rs"));
    const appelants = fichiers.filter((f) => {
      if (f === "persona.rs") return false; // définition, pas un appel
      return read(`src-tauri/src/${f}`).includes("read_active_persona_identity");
    });
    expect(appelants).toEqual(["super_agent.rs"]);
  });

  it("la sélection de modèle par couple (projet, agent) reste sur SA session", () => {
    const agents = read("src-tauri/src/agents.rs");
    const commande = rustFunction(agents, "pub async fn set_agent_process_model(");
    // Le modèle d'un agent se règle toujours sur SA session, comme avant.
    expect(commande).toContain('"type": "set_model"');
    expect(commande).toContain("send_sync(&project, &agent_id, cmd)");
    // Et rien de la fiche du personnage n'intervient dans ce chemin.
    expect(commande).not.toContain("persona");
    expect(commande).not.toContain("assistant_identity");
    expect(commande).not.toContain("assistant_session_model");
  });
});
