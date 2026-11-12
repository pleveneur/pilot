// Verrou — L'OREILLE INTÉGRÉE (Whisper) COMPILE SANS OUTILLAGE C++.
//
// `whisper-rs-sys` générait ses liaisons FFI avec `bindgen`, qui exige
// `libclang` ; son chargeur PANIQUE quand il est absent (le repli prévu par
// l'amont n'est jamais atteint). La feature `whisper` ne compilait donc que sur
// une machine fournie en LLVM-MSVC.
//
// Ce fichier protège le correctif : la copie locale de `whisper-rs-sys`
// (`src-tauri/vendor/whisper-rs-sys`, déclarée en `[patch.crates-io]`) emploie
// les liaisons PRÉ-GÉNÉRÉES quand `libclang` est introuvable, et ces liaisons
// sont rendues neutres de plateforme. Si l'un de ces points disparaît, la
// compilation du moteur redevient impossible sans rien installer — et ce test
// ÉCHOUE (c'est voulu).
//
// Ce qui n'est PAS touché ici : le comportement par défaut de la dictée, la
// feature reste OPTIONNELLE (`default = []`), et le build par défaut doit
// rester vert même sans elle.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, "..", "..");
const VENDOR = "src-tauri/vendor/whisper-rs-sys";

/** Lit un fichier du dépôt, fins de ligne normalisées (piège CI Windows). */
function lire(relatif) {
  return fs.readFileSync(path.join(RACINE, relatif), "utf8").replace(/\r\n/g, "\n");
}

function existe(relatif) {
  return fs.existsSync(path.join(RACINE, relatif));
}

const CARGO_RACINE = lire("Cargo.toml");
const CARGO_DESKTOP = lire("src-tauri/Cargo.toml");
const BUILD_SYS = lire(`${VENDOR}/build.rs`);
const BINDINGS = lire(`${VENDOR}/src/bindings.rs`);
const CARGO_SYS = lire(`${VENDOR}/Cargo.toml`);

/** Numéro de ligne (0-indexé) de la première correspondance, ou -1. */
function ligneDe(source, aiguille) {
  const lignes = source.split("\n");
  return lignes.findIndex((ligne) => ligne.includes(aiguille));
}

/** Les `n` lignes qui précèdent `index` (bornées au début du fichier). */
function avant(lignes, index, n) {
  return lignes.slice(Math.max(0, index - n), index).join("\n");
}

/** Le texte d'une section TOML (`[nom]`), jusqu'à la section suivante. */
function section(toml, entete) {
  const lignes = toml.split("\n");
  const debut = lignes.findIndex((ligne) => ligne.trim() === entete);
  if (debut < 0) return "";
  const suite = lignes.findIndex((ligne, i) => i > debut && ligne.startsWith("["));
  return lignes.slice(debut, suite < 0 ? lignes.length : suite).join("\n");
}

describe("1. La copie locale de `whisper-rs-sys` est celle que cargo compile", () => {
  it("le manifeste racine la déclare en `[patch.crates-io]`", () => {
    const patch = section(CARGO_RACINE, "[patch.crates-io]");
    expect(patch).toContain("whisper-rs-sys");
    expect(patch).toContain(`path = "${VENDOR}"`);
  });

  it("la copie locale est complète (caisse + sources C de whisper.cpp)", () => {
    for (const fichier of [
      `${VENDOR}/Cargo.toml`,
      `${VENDOR}/build.rs`,
      `${VENDOR}/wrapper.h`,
      `${VENDOR}/src/lib.rs`,
      `${VENDOR}/src/bindings.rs`,
      `${VENDOR}/whisper.cpp/CMakeLists.txt`,
    ]) {
      expect(existe(fichier), `fichier manquant : ${fichier}`).toBe(true);
    }
    // Même version que celle verrouillée : un `cargo update` de la caisse
    // amont doit se voir ici (sinon le correctif ne s'appliquerait plus).
    expect(CARGO_SYS).toContain('name = "whisper-rs-sys"');
    expect(CARGO_SYS).toContain('version = "0.15.0"');
  });
});

describe("2. `bindgen` n'est plus une condition de compilation", () => {
  it("les liaisons pré-générées servent dès que `libclang` est introuvable", () => {
    const lignes = BUILD_SYS.split("\n");
    const aiguillage = lignes.findIndex((ligne) => ligne.includes("if bundled_bindings_only() {"));
    expect(aiguillage, "l'aiguillage vers les liaisons pré-générées a disparu").toBeGreaterThan(0);
    // La variable d'environnement de l'amont reste honorée (échappatoire
    // documentée), mais elle n'est plus la SEULE porte d'entrée.
    expect(BUILD_SYS).toContain("WHISPER_DONT_GENERATE_BINDINGS");
    expect(BUILD_SYS).toContain("libclang_candidates");
    expect(BUILD_SYS).toContain("find_libclang");
    // La recherche couvre la variable dédiée ET le PATH (aucun chemin en dur
    // n'est imposé au propriétaire).
    expect(BUILD_SYS).toContain("LIBCLANG_PATH");
    expect(BUILD_SYS).toContain('env::var_os("PATH")');
  });

  it("le fichier de liaisons employé est surveillé (il doit relancer le script)", () => {
    expect(BUILD_SYS).toContain("cargo:rerun-if-changed=src/bindings.rs");
  });

  it("`bindgen` n'est appelé que si `libclang` a été trouvé", () => {
    // L'appel à `bindgen::Builder` doit vivre dans la branche `else` de
    // l'aiguillage : on vérifie l'ORDRE (aiguillage, puis génération).
    const indexAiguillage = BUILD_SYS.indexOf("if bundled_bindings_only() {");
    const indexBindgen = BUILD_SYS.indexOf("bindgen::Builder::default()");
    expect(indexBindgen).toBeGreaterThan(indexAiguillage);
  });

  it("le `PATH` des binaires lancés par cargo n'est plus noyé (4e changement)", () => {
    // L'amont annonçait CHAQUE sous-dossier de l'arbre CMake (200+) comme
    // `rustc-link-search` ; cargo les reporte dans le `PATH` des binaires qu'il
    // exécute, et au-delà de 8 191 caractères `cmd.exe` ne trouve plus `ping` :
    // quatre tests tombaient sous `--features whisper`, sans rapport avec le
    // produit. Le filtre ne doit pas être retiré.
    expect(BUILD_SYS).toContain("fn dossier_porte_une_bibliotheque");
    const lignes = BUILD_SYS.split("\n");
    const index = ligneDe(BUILD_SYS, "fn add_link_search_path(dir: &std::path::Path)");
    expect(index).toBeGreaterThan(0);
    expect(
      lignes.slice(index, index + 12).join("\n"),
      "l'annonce des chemins de liaison n'est plus filtrée",
    ).toContain("dossier_porte_une_bibliotheque(dir)");
    // Les extensions qui portent réellement une bibliothèque restent couvertes.
    for (const extension of [".lib", ".a", ".dylib", ".so"]) {
      expect(BUILD_SYS).toContain(`"${extension}"`);
    }
  });
});

describe("3. Les liaisons pré-générées sont neutres de plateforme", () => {
  /** Vérifie que l'assertion de disposition nommée est bornée à la glibc. */
  function assertionBornee(nom) {
    const lignes = BINDINGS.split("\n");
    const index = lignes.findIndex((ligne) => ligne.includes(`["Size of ${nom}"]`));
    expect(index, `assertion introuvable : ${nom}`).toBeGreaterThan(0);
    expect(
      avant(lignes, index, 8),
      `l'assertion de ${nom} n'est pas bornée à target_env = "gnu"`,
    ).toContain('#[cfg(target_env = "gnu")]');
  }

  it("les trois dispositions de `stdio.h` de la glibc ne s'appliquent qu'à la glibc", () => {
    // Ce sont ces trois assertions qui faisaient échouer Windows et macOS.
    assertionBornee("_G_fpos_t");
    assertionBornee("_G_fpos64_t");
    assertionBornee("_IO_FILE");
  });

  it("les énumérations suivent la règle de la plateforme (MSVC = signé)", () => {
    // `whisper-rs` déclare `repr(i32)` sur Windows-MSVC : sans la variante
    // signée, il ne compile pas (`expected i32, found u32`).
    for (const nom of ["ggml_log_level", "whisper_gretype"]) {
      const alias = new RegExp(`pub type ${nom} = ::std::os::raw::c_uint;`);
      expect(BINDINGS).toMatch(alias);
      expect(BINDINGS).toContain(`pub type ${nom} = ::std::os::raw::c_int;`);
    }
    expect(BINDINGS).toContain('#[cfg(all(windows, not(target_env = "gnu")))]');
  });
});

describe("4. Le comportement par défaut ne bouge pas", () => {
  it("la feature reste OPTIONNELLE : `default = []`", () => {
    const features = section(CARGO_DESKTOP, "[features]");
    expect(features).toContain("default = []");
    expect(features).toContain('whisper = ["dep:whisper-rs"]');
    // La dépendance reste `optional = true` : rien n'est compilé sans la feature.
    expect(CARGO_DESKTOP).toContain("whisper-rs = { version = \"0.16\", optional = true }");
  });

  it("aucun fichier de dictée existant n'est devenu dépendant de la feature", () => {
    // L'oreille du service local, la synthèse Piper et la synthèse VoiceStudio
    // gardent leur propre chemin : le correctif ne les touche pas.
    for (const fichier of [
      "src-tauri/src/asr_voicestudio.rs",
      "src-tauri/src/tts_local.rs",
      "src-tauri/src/tts_voicestudio.rs",
    ]) {
      const source = lire(fichier);
      expect(source.includes('feature = "whisper"'), `${fichier} dépend de whisper`).toBe(false);
    }
  });
});

describe("5. La preuve de liaison existe côté Rust", () => {
  it("un test appelle réellement le moteur natif quand la feature est active", () => {
    const rust = lire("src-tauri/src/asr_whisper.rs");
    expect(rust).toContain("fn avec_la_feature_le_moteur_natif_est_lie_et_repond");
    // Le test doit être sous la feature (il n'a de sens qu'avec le moteur).
    const lignes = rust.split("\n");
    const index = ligneDe(rust, "fn avec_la_feature_le_moteur_natif_est_lie_et_repond");
    expect(avant(lignes, index, 12)).toContain('#[cfg(feature = "whisper")]');
  });
});
