// Verrou — L'OREILLE INTÉGRÉE EST DANS L'APPLICATION LIVRÉE.
//
// Le moteur Whisper (`asr_whisper.rs`) n'existe dans le binaire que si Cargo est
// appelé avec `--features whisper`. Tant que ce drapeau n'était posé QUE sur la
// ligne de commande du propriétaire, la fonctionnalité existait dans le dépôt
// mais PAS dans ce que les utilisateurs installent : l'écran ne pouvait que
// répondre « le moteur intégré n'est pas compilé dans cette version de Pilot »,
// et il n'y avait rien à tester après installation.
//
// Ce fichier protège la décision de LIVRAISON (2026-11-16) :
//   1. le job `build` (Windows + macOS arm64 + macOS x64) pose le drapeau ;
//   2. les trois cibles publiées sont toujours celles de la matrice ;
//   3. la feature reste OPTIONNELLE (`default = []`) : un build sans drapeau
//      reste vert, et c'est celui de `cargo test` ;
//   4. le comportement par défaut ne bouge pas : l'oreille du service de voix
//      local reste le défaut (`local_dictation_engine`).
// Si l'un de ces points disparaît, ce test ÉCHOUE — c'est voulu.
//
// Lecture avec fins de ligne normalisées (piège CI Windows, `.gitattributes`).

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, "..", "..");

/** Lit un fichier du dépôt, fins de ligne normalisées. */
function lire(relatif) {
  return fs.readFileSync(path.join(RACINE, relatif), "utf8").replace(/\r\n/g, "\n");
}

/**
 * Bloc YAML d'un job : de «   <nom>: » jusqu'au prochain en-tête de job
 * (ligne à 2 espaces terminant par « : »). Même lecture que
 * `scripts/release-workflow.test.js`, pour ne pas en inventer une seconde.
 */
function blocJob(yaml, nom) {
  const lignes = yaml.split("\n");
  const debut = lignes.findIndex((l) => l === `  ${nom}:`);
  if (debut === -1) return "";
  const sortie = [];
  for (let i = debut + 1; i < lignes.length; i++) {
    if (/^ {2}[a-z][a-z0-9-]*:\s*$/.test(lignes[i])) break;
    sortie.push(lignes[i]);
  }
  return sortie.join("\n");
}

/** Les lignes de COMMANDE d'un bloc de job (les commentaires ne comptent pas). */
function lignesDeCommande(bloc) {
  return bloc
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
}

const WORKFLOW = lire(".github/workflows/release.yml");
const BUILD = blocJob(WORKFLOW, "build");

describe("1. Le drapeau `whisper` est posé là où l'application est réellement construite", () => {
  it("le job `build` existe et lance tauri-action", () => {
    expect(BUILD).not.toBe("");
    expect(BUILD).toContain("tauri-apps/tauri-action@v0");
  });

  it("la ligne `args:` de ce job porte `--features whisper`", () => {
    const commandes = lignesDeCommande(BUILD);
    const ligne = commandes
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith("args:"));
    expect(ligne, "aucune ligne `args:` dans le job build").toBeTruthy();
    expect(ligne).toContain("--features whisper");
    // La cible de la matrice ne doit pas être perdue au passage.
    expect(ligne).toContain("matrix.rust_target");
  });

  it("aucune autre commande de fabrication du job ne construit sans le drapeau", () => {
    const commandes = lignesDeCommande(BUILD);
    // tauri-action compile lui-même : aucune seconde compilation ne doit
    // exister à côté, sinon elle produirait un binaire SANS le moteur.
    expect(commandes).not.toMatch(/\bcargo build\b/);
    expect(commandes).not.toContain("npm run tauri build");
    // Le nombre de lignes `args:` reste 1 : un seul point de vérité.
    expect(commandes.split("\n").filter((l) => /^\s*args:/.test(l))).toHaveLength(1);
  });
});

describe("2. Les trois plateformes publiées sont couvertes", () => {
  it("la matrice `build` contient Windows et les deux macOS", () => {
    expect(BUILD).toContain("x86_64-pc-windows-msvc");
    expect(BUILD).toContain("aarch64-apple-darwin");
    expect(BUILD).toContain("x86_64-apple-darwin");
  });

  it("le drapeau n'est pas conditionné à une cible particulière", () => {
    const ligne = lignesDeCommande(BUILD)
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith("args:"));
    // Aucune expression conditionnelle : le drapeau vaut pour les trois.
    expect(ligne).not.toMatch(/if /);
    expect(ligne).not.toMatch(/matrix\.rust_target ==/);
  });
});

describe("3. La feature reste OPTIONNELLE : le build par défaut ne peut pas en dépendre", () => {
  const CARGO = lire("src-tauri/Cargo.toml");

  it("`default = []` et la dépendance optionnelle sont toujours là", () => {
    expect(CARGO).toMatch(/^default = \[\]$/m);
    expect(CARGO).toMatch(/whisper = \["dep:whisper-rs"\]/);
    expect(CARGO).toMatch(/whisper-rs = \{[^}]*optional = true/);
  });

  it("aucun module vocal existant ne dépend de la feature", () => {
    for (const fichier of [
      "src-tauri/src/asr_voicestudio.rs",
      "src-tauri/src/tts_local.rs",
      "src-tauri/src/tts_voicestudio.rs",
    ]) {
      expect(lire(fichier)).not.toContain('feature = "whisper"');
    }
  });

  it("le build sans la feature répond une phrase française, jamais un silence", () => {
    const rust = lire("src-tauri/src/asr_whisper.rs");
    expect(rust).toContain('cfg!(feature = "whisper")');
    expect(rust).toContain("moteur-non-compile");
    const js = lire("src/js/oreille-locale.js");
    expect(js).toContain("n'est pas compilé dans cette version de Pilot");
    // Et la conséquence réelle est toujours dite (retour à un service en ligne).
    expect(js).toContain("service en ligne");
  });
});

describe("4. Rien ne change par défaut pour l'utilisateur", () => {
  it("l'oreille par défaut reste le service de voix local", () => {
    const lib = lire("src-tauri/src/lib.rs");
    expect(lib).toMatch(/fn default_local_dictation_engine\(\)[^{]*\{\s*"voicestudio"\.to_string\(\)/);
  });

  it("le modèle n'est jamais téléchargé sans un geste", () => {
    // Le module qui CONSTATE le modèle n'ouvre aucune requête réseau : il est
    // frère du téléchargement, qui vit dans son propre fichier.
    const constat = lire("src-tauri/src/asr_whisper.rs");
    expect(constat).not.toMatch(/reqwest|ureq|TcpStream|https?:\/\//);
  });
});
