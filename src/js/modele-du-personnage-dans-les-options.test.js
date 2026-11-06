// modele-du-personnage-dans-les-options.test.js — TÂCHE 403 (suite).
//
// LE VERROU du champ « Modèle du personnage » : Présences n'a aucun écran, donc
// ce champ des Options est le SEUL endroit où le modèle IA d'un personnage peut
// être saisi. Ce fichier échoue si :
//   1. le champ, ses deux gestes ou sa phrase d'état DISPARAISSENT de l'écran
//      (ou sortent de la section Assistant) ;
//   2. la clé de configuration cesse d'être ADDITIVE (`#[serde(default)]`) ou
//      cesse d'être écrite à l'enregistrement complet (elle serait alors remise
//      à vide à chaque « Enregistrer ») ;
//   3. le préremplissage ne suit plus la fiche du personnage (l'écran mentirait
//      sur le modèle qui tourne) ou n'appelle plus les commandes réelles ;
//   4. le REPLI est court-circuité : une décision de modèle recopiée côté
//      écriture, un second canal de trace, ou une écriture qui casserait la
//      lecture de la fiche ;
//   5. l'écriture peut créer le dossier du personnage, toucher un autre fichier
//      que `modele.txt`, ou écrire une valeur mal formée (une faute de frappe ne
//      doit ni inventer un modèle ni en effacer un).
//
// Aucune valeur de total n'est figée : ce fichier décrit des RÈGLES.

import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  ASSISTANT_MODEL_KEY,
  ASSISTANT_MODEL_MAX_CHARS,
  ASSISTANT_MODEL_NONE,
  ASSISTANT_MODEL_READ_COMMAND,
  ASSISTANT_MODEL_WRITE_COMMAND,
  assistantModelHelpText,
  assistantModelIsUnspecified,
  assistantModelPrefill,
  normalizeAssistantModel,
} from "./assistant-model.js";
import { ASSISTANT_GENDER_KEY } from "./assistant-genre.js";
import { sliceSource } from "./source-slice.js";

/** Lit un fichier source avec les fins de ligne normalisées (piège CRLF CI). */
function read(rel) {
  return readFileSync(rel, "utf8").replace(/\r\n/g, "\n");
}

/** Découpe une fonction Rust par son en-tête, jusqu'à la ligne `}` seule. */
function rustFunction(src, header) {
  return sliceSource(src, header, "\n}\n", 60) + "\n}\n";
}

const settings = read("src/js/settings.js");
const personaRs = read("src-tauri/src/persona.rs");
const libRs = read("src-tauri/src/lib.rs");
const indexHtml = read("index.html");

// ── 1. La décision du champ, côté fenêtre (module pur) ─────────────────────

describe("modèle du personnage — la décision côté fenêtre", () => {
  it("la clé de configuration est ADDITIVE, à côté du genre (jamais à sa place)", () => {
    expect(ASSISTANT_MODEL_KEY).toBe("assistant_model");
    expect(ASSISTANT_MODEL_KEY).not.toBe(ASSISTANT_GENDER_KEY);
    expect(ASSISTANT_MODEL_NONE).toBe("");
    // Le vide est le DÉFAUT : aucun modèle propre, donc repli silencieux.
    expect(assistantModelIsUnspecified(ASSISTANT_MODEL_NONE)).toBe(true);
    expect(assistantModelIsUnspecified(undefined)).toBe(true);
    expect(assistantModelIsUnspecified("   ")).toBe(true);
    expect(assistantModelIsUnspecified("ollama/glm-5.2:cloud")).toBe(false);
  });

  it("la normalisation rogne, borne et retire les caractères de contrôle", () => {
    expect(normalizeAssistantModel("  ollama/glm-5.2:cloud\n")).toBe("ollama/glm-5.2:cloud");
    expect(normalizeAssistantModel(null)).toBe("");
    expect(normalizeAssistantModel(42)).toBe("");
    expect(normalizeAssistantModel("a\u0000b\u001fc")).toBe("abc");
    const long = "x".repeat(ASSISTANT_MODEL_MAX_CHARS + 40);
    expect(normalizeAssistantModel(long)).toHaveLength(ASSISTANT_MODEL_MAX_CHARS);
  });

  it("le préremplissage suit la FICHE quand un personnage est actif, sinon le souvenir", () => {
    // Personnage actif : c'est la fiche qui s'applique, donc c'est elle qu'on montre.
    expect(assistantModelPrefill(true, "ollama/glm-5.2:cloud", "openai/gpt-4o")).toBe(
      "ollama/glm-5.2:cloud",
    );
    // Fiche muette : le souvenir mémorisé par Pilot reste visible.
    expect(assistantModelPrefill(true, "", "openai/gpt-4o")).toBe("openai/gpt-4o");
    // AUCUN personnage : la fiche n'existe pas, elle ne peut donc rien imposer.
    expect(assistantModelPrefill(false, "ollama/glm-5.2:cloud", "")).toBe("");
    expect(assistantModelPrefill(false, "ollama/glm-5.2:cloud", "openai/gpt-4o")).toBe(
      "openai/gpt-4o",
    );
    // Rien nulle part : champ vide, repli sans message.
    expect(assistantModelPrefill(false, undefined, undefined)).toBe("");
  });

  it("la phrase d'aide dit la vérité des trois états, sans message technique", () => {
    const sansPersonnage = assistantModelHelpText({ active: false });
    const vide = assistantModelHelpText({ active: true, model: "" });
    const pourvu = assistantModelHelpText({ active: true, model: "ollama/glm-5.2:cloud" });
    expect(new Set([sansPersonnage, vide, pourvu]).size).toBe(3);
    expect(sansPersonnage).toContain("Aucun personnage");
    expect(vide).toContain("Vide");
    expect(pourvu).toContain("ollama/glm-5.2:cloud");
    // Le modèle introuvable se dit dans le volet EXISTANT de l'onglet 🧭.
    expect(pourvu).toContain("Événements");
    for (const phrase of [sansPersonnage, vide, pourvu]) {
      expect(phrase).not.toMatch(/undefined|null|Error/);
    }
  });

  it("les commandes sont nommées à UN SEUL endroit (aucun nom en dur dans l'écran)", () => {
    expect(ASSISTANT_MODEL_READ_COMMAND).toBe("read_assistant_persona_model");
    expect(ASSISTANT_MODEL_WRITE_COMMAND).toBe("write_assistant_persona_model");
    expect(settings).toContain("ASSISTANT_MODEL_READ_COMMAND");
    expect(settings).toContain("ASSISTANT_MODEL_WRITE_COMMAND");
    expect(settings).not.toContain('"read_assistant_persona_model"');
    expect(settings).not.toContain('"write_assistant_persona_model"');
  });
});

// ── 2. Le champ existe, dans la section Assistant, avec ses deux gestes ────

describe("modèle du personnage — l'écran", () => {
  const panneau = sliceSource(
    indexHtml,
    'data-settings-panel="superagent"',
    'data-settings-panel="',
    200,
  );

  it("un champ texte, deux boutons et une phrase d'état, dans la section Assistant", () => {
    expect(panneau).toContain('id="setting-assistant-model"');
    expect(panneau).toContain('type="text"');
    expect(panneau).toContain('id="btn-assistant-model-save"');
    expect(panneau).toContain('id="btn-assistant-model-clear"');
    expect(panneau).toContain('id="assistant-model-status"');
    // Le champ est décrit pour les lecteurs d'écran (état + note).
    expect(panneau).toContain('aria-describedby="assistant-model-status assistant-model-note"');
  });

  it("le champ vit à côté du GENRE, jamais dans un écran nouveau", () => {
    const genre = panneau.indexOf('id="setting-assistant-gender"');
    const modele = panneau.indexOf('id="setting-assistant-model"');
    expect(genre).toBeGreaterThan(-1);
    expect(modele).toBeGreaterThan(genre);
    // Aucune fenêtre propre : le champ est une ligne de réglage comme les autres.
    expect(panneau).toContain('class="setting-row setting-row-indent" id="assistant-model-row"');
  });
});

// ── 3. Le branchement réel : préremplissage, gestes et enregistrement ─────

describe("modèle du personnage — le branchement des Options", () => {
  it("le relit dans la fiche et affiche la valeur qui s'applique", () => {
    const fn = rustFunctionLike(settings, "async function refreshAssistantModel");
    expect(fn).toContain("ASSISTANT_MODEL_READ_COMMAND");
    expect(fn).toContain("assistantModelPrefill(");
    expect(fn).toContain("assistantModelHelpText(");
    // Fail-open : une panne de la commande n'affiche pas d'erreur à l'ouverture.
    expect(fn).toContain("catch");
    // Appelé au moins une fois au remplissage du panneau (sinon champ toujours vide).
    expect(settings).toContain("await refreshAssistantModel(currentConfig);");
  });

  it("les deux gestes écrivent par la commande dédiée, jamais tout seuls", () => {
    const fn = rustFunctionLike(settings, "async function applyAssistantModel");
    expect(fn).toContain("ASSISTANT_MODEL_WRITE_COMMAND");
    // Le texte affiché vient de la commande : aucune phrase de repli recopiée.
    expect(fn).toContain("res.message");
    // Les deux boutons sont branchés, et le second efface (valeur vide).
    expect(settings).toContain("btnAssistantModelSave.addEventListener(");
    expect(settings).toContain("btnAssistantModelClear.addEventListener(");
    expect(settings).toContain("applyAssistantModel(ASSISTANT_MODEL_NONE)");
  });

  it("la clé est écrite à l'enregistrement COMPLET, sinon elle serait effacée", () => {
    const enregistrement = sliceSource(
      settings,
      "assistant_gender: normalizeAssistantGender(",
      "super_agent_prompt: taSuperAgentPrompt",
      200,
    );
    const occurrences = enregistrement.split("assistant_model:").length - 1;
    expect(occurrences).toBe(1);
    expect(enregistrement).toContain("normalizeAssistantModel(");
    expect(enregistrement).toContain("ASSISTANT_MODEL_KEY");
  });
});

// ── 4. Côté Rust : clé additive, commandes branchées, écriture encadrée ───

describe("modèle du personnage — le socle Rust", () => {
  it("la configuration gagne un champ ADDITIF, vide par défaut", () => {
    const structure = sliceSource(
      libRs,
      "    #[serde(default)]\n    assistant_gender: String,",
      "    assistant_model: String,",
      40,
    );
    expect(structure).toContain("#[serde(default)]");
    expect(libRs).toContain("assistant_model: String::new(),");
    // Les deux clés cohabitent : le genre n'est jamais remplacé.
    expect(libRs).toContain("assistant_gender: String::new(),");
  });

  it("les deux commandes sont enregistrées (sinon l'écran appellerait le vide)", () => {
    expect(libRs).toContain("persona::read_assistant_persona_model,");
    expect(libRs).toContain("persona::write_assistant_persona_model,");
    expect(personaRs).toContain("pub fn read_assistant_persona_model(");
    expect(personaRs).toContain("pub fn write_assistant_persona_model(");
  });

  it("l'écriture ne touche QUE modele.txt, et ne crée jamais le dossier", () => {
    const ecriture = rustFunction(personaRs, "pub fn write_persona_model(");
    expect(ecriture).toContain("dir.join(PERSONA_MODEL_FILE)");
    for (const autre of [
      "PERSONA_NAME_FILE",
      "PERSONA_IMAGE_FILE",
      "PERSONA_GENDER_FILE",
      "fs::create_dir_all",
      "fs::remove_file",
      "fs::remove_dir_all",
    ]) {
      expect(ecriture).not.toContain(autre);
    }
    // Le reste du module (hors tests) reste en LECTURE SEULE : aucun dossier créé,
    // aucun fichier supprimé. On cherche l'APPEL réel (`fs::…`), jamais le mot
    // cité dans un commentaire de contrat.
    const horsTests = sliceSource(personaRs, "use serde::Serialize;", "\n#[cfg(test)]", 100);
    expect(horsTests).not.toContain("fs::create_dir_all");
    expect(horsTests).not.toContain("fs::remove_dir_all");
    expect(horsTests).not.toContain("fs::remove_file");
  });

  it("une valeur mal formée est REFUSÉE, jamais confondue avec un effacement", () => {
    const decision = rustFunction(personaRs, "pub fn decide_model_write(");
    // Le vide est traité AVANT la grammaire : un champ vide efface ;
    const vide = decision.indexOf("texte.is_empty()");
    const grammaire = decision.indexOf("normalize_model_line(texte)");
    expect(vide).toBeGreaterThan(-1);
    expect(grammaire).toBeGreaterThan(vide);
    // … et un champ rempli mais illisible est un refus qui dit quoi écrire.
    expect(decision).toContain("Err(");
    expect(decision).toContain("fournisseur/modèle");
  });

  it("le dépôt HISTORIQUE n'est jamais une cible d'écriture", () => {
    const cible = rustFunction(personaRs, "pub fn active_persona_dir(");
    expect(cible).toContain("PersonaDepot::Legacy => None");
    expect(cible).toContain("PersonaDepot::Personal");
    // Un dépôt qui existe mais ne nomme aucun personnage n'est pas une cible.
    expect(cible).toContain("nom.is_some()");
  });

  it("le REPLI n'est pas court-circuité : aucune seconde décision de modèle", () => {
    // La décision du modèle effectif reste dans `assistant_identity.rs`, appelée
    // par `super_agent::assistant_session_model` — jamais recopiée ici.
    expect(personaRs).not.toContain("decide_assistant_model(");
    const commande = rustFunction(personaRs, "pub fn write_assistant_persona_model(");
    expect(commande).toContain("assistant_session_model(");
    // Un seul canal de trace dans tout le socle : celui du démarrage de session.
    const fichiers = readdirSync("src-tauri/src").filter((f) => f.endsWith(".rs"));
    const emissions = fichiers.reduce((total, f) => {
      const src = read(`src-tauri/src/${f}`);
      return total + src.split('"pilot-assistant-model-trace"').length - 1;
    }, 0);
    expect(emissions).toBe(1);
    // Et aucune seconde publication d'évènement depuis le module d'écriture.
    expect(commande).not.toContain(".emit(");
  });
});

/**
 * Découpe une fonction JavaScript par son en-tête, jusqu'à la prochaine ligne
 * `}` seule à la colonne zéro (même garde que `rustFunction` : ancre absente ⇒
 * erreur, jamais un fragment vide qui ferait passer l'assertion pour rien).
 */
function rustFunctionLike(src, header) {
  return sliceSource(src, header, "\n  }\n", 80) + "\n  }\n";
}
