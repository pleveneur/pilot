// personnage-jamais-fige-dans-les-instructions.test.js
//
// VERROU DU CORRECTIF « un personnage ne se fige plus dans les instructions ».
//
// Un personnage activé dans Présences n'est que quatre fichiers lus dans un
// dossier : un nom, une image, un genre, un modèle. Rien de plus. Dès qu'il est
// désactivé, RIEN de lui ne doit continuer à s'appliquer : ni son nom, ni son
// genre, ni son modèle, ni une appellation qui lui serait propre.
//
// Ce verrou ÉCHOUE si l'une de ces régressions revient :
//   1. un NOM de personnage est recopié en dur dans un texte d'instructions livré
//      (le nom doit être RÉFÉRENCÉ par `{nom}`, jamais écrit) ;
//   2. un GENRE est imposé par défaut par ces mêmes textes (il ne vient que du
//      réglage `assistant_gender`, vide = rien, et de la fiche du personnage) ;
//   3. le nom utilisé par la RÈGLE DE RÉVEIL n'est plus le nom dynamique ;
//   4. l'injection cesse d'utiliser la règle unique du nom côté moteur ;
//   5. `save_config` réécrit de nouveau le prompt depuis la copie de la fenêtre
//      (une ancienne version reviendrait EN SILENCE, hors historique) ;
//   6. le jeton `{nom}` diverge entre le moteur (Rust) et la fenêtre (JS).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  INSTRUCTION_NAME_PLACEHOLDER,
  instructionNameTokenCount,
  promptNeedsDedicatedSave,
} from "./assistant-instructions.js";
import { DEFAULT_ASSISTANT_NAME } from "./assistant-persona.js";
import { decideVocalNameGate, vocalNameSentence } from "./vocal-nom-garde.js";
// Découpage de source VÉRIFIÉ : une ancre qui bouge ÉCHOUE au lieu de rendre un
// fragment vide (qui rendrait une assertion négative vraie par construction).
import { sliceSource } from "./source-slice.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) => readFileSync(resolve(ICI, rel), "utf8").replace(/\r\n/g, "\n");

const SUPER_AGENT_RS = lire("../../src-tauri/src/super_agent.rs");
const ASSISTANT_IDENTITY_RS = lire("../../src-tauri/src/assistant_identity.rs");
const LIB_RS = lire("../../src-tauri/src/lib.rs");
const INDEX_HTML = lire("../../index.html");

/** Le source Rust SANS son bloc de tests : ce qui est vraiment livré. */
function codeLivre(source) {
  return source.split("#[cfg(test)]")[0];
}

/** Le corps d'une fonction (de sa signature à son accolade fermante en colonne 0),
 *  commentaire de documentation compris : un nom cité dans la doc d'une fonction
 *  doit être compté avec elle. */
function corpsDeFonction(source, signature) {
  const debut = source.indexOf(signature);
  if (debut < 0) return "";
  const doc = source.lastIndexOf("/**", debut);
  const depuis = doc >= 0 && debut - doc < 3000 ? doc : debut;
  const fin = source.indexOf("\n}\n", debut);
  return fin < 0 ? source.slice(depuis) : source.slice(depuis, fin + 3);
}

/** Les textes d'instructions FIGÉS (constantes littérales) du moteur. */
function textesFiges() {
  const code = codeLivre(SUPER_AGENT_RS);
  const blocs = [];
  const re = /const\s+(SUPER_AGENT_[A-Z_]+)\s*:\s*&str\s*=\s*([\s\S]*?);\n\n/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    // Littéraux concaténés : on garde le contenu brut (les `\n` échappés restent
    // du texte, aucune analyse n'en dépend).
    if (m[1] === "SUPER_AGENT_ROLE_TEMPLATE") continue; // gabarit : testé à part
    blocs.push({ nom: m[1], texte: m[2] });
  }
  return blocs;
}

// Prénoms de personnages réels (le dossier personnel de l'auteur, la fiche
// d'exemple des tests) et le nom réglé par défaut. Aucun ne doit apparaître dans
// un texte livré : ils ne peuvent être que LUS à l'exécution.
const NOMS_INTERDITS = ["Sylvie", "Nova", "Camille", "Magnus"];
const GENRES_INTERDITS = ["féminin", "FÉMININ", "masculin", "MASCULIN"];

describe("les textes d'instructions livrés ne figent aucune identité", () => {
  it("aucun nom de personnage n'est recopié dans un texte figé", () => {
    const blocs = textesFiges();
    expect(blocs.length, "les textes figés doivent être trouvables").toBeGreaterThanOrEqual(6);
    for (const { nom, texte } of blocs) {
      for (const interdit of NOMS_INTERDITS) {
        expect(
          texte.includes(interdit),
          `${nom} nomme un personnage (${interdit}) : le nom doit être RÉFÉRENCÉ, jamais recopié`,
        ).toBe(false);
      }
    }
  });

  it("aucun genre n'est imposé par défaut dans ces textes", () => {
    for (const { nom, texte } of textesFiges()) {
      for (const genre of GENRES_INTERDITS) {
        expect(
          texte.includes(genre),
          `${nom} impose un genre (${genre}) : il ne vient que du réglage ou de la fiche`,
        ).toBe(false);
      }
    }
  });

  it("le rôle de l'assistant reste un GABARIT : un trou, jamais un nom", () => {
    const code = codeLivre(SUPER_AGENT_RS);
    const m = code.match(/const SUPER_AGENT_ROLE_TEMPLATE:\s*&str\s*=\s*"([\s\S]*?)";/);
    expect(m, "SUPER_AGENT_ROLE_TEMPLATE est introuvable").not.toBeNull();
    expect(m[1]).toContain("{}");
    for (const interdit of NOMS_INTERDITS) expect(m[1].includes(interdit)).toBe(false);
    // Le gabarit est rempli par la règle unique du nom, une seule fois.
    expect(code).toContain('SUPER_AGENT_ROLE_TEMPLATE.replacen("{}", &name, 1)');
  });

  it("le prompt par défaut proposé dans l'interface ne nomme personne", () => {
    const m = INDEX_HTML.match(/id="setting-superagent-prompt"[\s\S]*?placeholder="([\s\S]*?)"/);
    expect(m, "le champ « Prompt système » doit exister").not.toBeNull();
    for (const interdit of NOMS_INTERDITS) expect(m[1].includes(interdit)).toBe(false);
    for (const genre of GENRES_INTERDITS) expect(m[1].includes(genre)).toBe(false);
  });
});

describe("le nom du moment vient d'une seule règle, côté moteur aussi", () => {
  it("l'injection du prompt utilise la règle unique du nom et résout `{nom}`", () => {
    const code = codeLivre(SUPER_AGENT_RS);
    // Le nom n'est plus pris dans le seul réglage : la fiche du personnage passe
    // avant, exactement comme dans la fenêtre — dans LES DEUX chemins d'injection.
    for (const signature of [
      "pub(crate) fn do_send_super_agent_prompt(",
      "pub async fn ask_super_agent(",
    ]) {
      const body = corpsDeFonction(code, signature);
      expect(body, `chemin d'injection introuvable : ${signature}`).not.toBe("");
      expect(
        body.includes("crate::assistant_identity::assistant_display_name("),
        `${signature} doit nommer l'assistant par la règle unique`,
      ).toBe(true);
      expect(
        body.includes("crate::assistant_identity::resolve_instruction_name(&custom_prompt, &name)"),
        `${signature} doit résoudre {nom} avec le nom du moment`,
      ).toBe(true);
    }
    // L'ancienne règle locale (nom réglé seul) ne doit pas revenir.
    expect(code.includes('if name.trim().is_empty() { "Assistant".to_string() }')).toBe(false);
  });

  it("le nom par défaut et le jeton sont les MÊMES des deux côtés", () => {
    // Défaut identique : une divergence changerait le nom affiché d'un côté.
    expect(codeLivre(ASSISTANT_IDENTITY_RS)).toContain(
      `pub const ASSISTANT_DEFAULT_NAME: &str = "${DEFAULT_ASSISTANT_NAME}";`,
    );
    // Jeton identique : sinon le `{nom}` tapé par l'utilisateur cesserait
    // silencieusement de fonctionner.
    expect(codeLivre(ASSISTANT_IDENTITY_RS)).toContain(
      `pub const INSTRUCTION_NAME_TOKEN: &str = "${INSTRUCTION_NAME_PLACEHOLDER}";`,
    );
    expect(INSTRUCTION_NAME_PLACEHOLDER).toBe("{nom}");
  });

  it("un texte sans jeton est rendu inchangé (aucune régression)", () => {
    // Le contrat est écrit dans le module Rust ; on vérifie ici qu'aucun texte
    // livré n'utilise le jeton (sinon le prompt changerait sans que personne ne
    // l'ait demandé).
    for (const { nom, texte } of textesFiges()) {
      expect(
        instructionNameTokenCount(texte),
        `${nom} contient des références {nom} : les textes livrés ne doivent pas changer de forme`,
      ).toBe(0);
    }
  });
});

describe("la règle du réveil utilise le nom DYNAMIQUE, jamais un nom écrit", () => {
  it("la phrase du réveil suit le nom qu'on lui donne", () => {
    const depuisPersonnage = vocalNameSentence("Camille");
    const depuisReglage = vocalNameSentence("Nova");
    expect(depuisPersonnage).toContain("Camille");
    expect(depuisReglage).toContain("Nova");
    expect(depuisPersonnage).not.toBe(depuisReglage);
  });

  it("la garde du nom ne connaît AUCUN nom en dur", () => {
    const source = lire("./vocal-nom-garde.js");
    for (const interdit of NOMS_INTERDITS) {
      expect(source.includes(interdit), `vocal-nom-garde.js nomme ${interdit}`).toBe(false);
    }
    // …et elle s'arme bien sur le nom reçu, pas sur une constante.
    const gate = decideVocalNameGate({
      modeOuvert: true,
      texte: "bonjour Camille, tu m'entends ?",
      nom: "Camille",
    });
    expect(gate.action).toBe("laisser");
    expect(gate.raison).toBe("nom-entendu");
    // Le nom d'UN AUTRE personnage ne fait pas entrer la phrase.
    const autre = decideVocalNameGate({
      modeOuvert: true,
      texte: "bonjour Sylvie, tu m'entends ?",
      nom: "Camille",
    });
    expect(autre.action).toBe("jeter");
  });

  it("l'écran passe le nom AFFICHÉ à la garde (source unique)", () => {
    const code = lire("./super-agent.js");
    // Chaque appel qui compose la phrase du nom part de `superAgentDisplayLabel()`.
    const appels = code.split("vocalNameSentence(").length - 1;
    const dynamiques = code.split("vocalNameSentence(superAgentDisplayLabel())").length - 1;
    expect(appels).toBeGreaterThan(0);
    expect(dynamiques, "la phrase du réveil doit partir du nom affiché").toBeGreaterThan(0);
    // Aucune phrase du réveil composée depuis une valeur écrite : hors du repli de
    // compatibilité d'une session de noyau plus ancien (libellé de SESSION, jamais
    // injecté dans un prompt), aucun nom ne doit subsister dans ce fichier.
    const sansRepliSession = code.replace(
      corpsDeFonction(code, "export function findAssistantSessionAgent("),
      "",
    );
    for (const interdit of NOMS_INTERDITS) {
      const reste = sansRepliSession.split(interdit).length - 1;
      expect(reste, `super-agent.js nomme ${interdit} hors du repli de session`).toBe(0);
    }
  });
});

describe("le prompt de l'assistant n'a qu'un écrivain et qu'un historique", () => {
  it("`save_config` PRÉSERVE le prompt en vigueur au lieu de le réécrire", () => {
    const body = corpsDeFonction(LIB_RS, "fn save_config(");
    expect(body, "la commande save_config doit être trouvable").not.toBe("");
    expect(
      body.includes("config.super_agent_prompt = en_vigueur;"),
      "save_config doit préserver le prompt vivant (sinon une ancienne version revient en silence)",
    ).toBe(true);
    // La configuration vivante reste la seule vérité pour tout le reste.
    expect(body).toContain("*state.config.lock().unwrap() = config;");
  });

  it("l'interface enregistre une modification du prompt par le chemin DÉDIÉ", () => {
    const code = lire("./settings.js");
    expect(code).toContain('invoke("set_super_agent_prompt", { prompt: nouveauPrompt })');
    expect(code).toContain("promptNeedsDedicatedSave(taSuperAgentPrompt.value");
    // Une modification réelle seulement : un autre enregistrement n'écrit rien.
    expect(promptNeedsDedicatedSave("a", "a")).toBe(false);
    expect(promptNeedsDedicatedSave("a", "b")).toBe(true);
    expect(promptNeedsDedicatedSave("", undefined)).toBe(false);
    expect(promptNeedsDedicatedSave(undefined, "")).toBe(false);
  });

  it("le changement de personnage redemande l'identité vivante (modèle compris)", () => {
    const code = lire("./super-agent.js");
    expect(code).toContain('invoke("refresh_assistant_identity")');
    // …au point UNIQUE du changement de personnage, pas ailleurs : le corps du
    // détecteur, découpé entre deux ancres présentes (sinon ÉCHEC).
    const corps = sliceSource(
      code,
      "export function startPersonaWatch()",
      "export function findAssistantSessionAgent(",
      200,
    );
    expect(corps).toContain('invoke("refresh_assistant_identity")');
    expect(corps).toContain("refreshAssistantPersonaAndApply()");
  });
});
