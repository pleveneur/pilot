// catalogue-voix-locales.test.js — LE test qui tient la cohérence du catalogue
// des voix françaises locales entre les deux côtés de l'application.
//
// Pourquoi il existe : le catalogue est écrit deux fois (une fois en JS pour
// l'écran des Paramètres, une fois en Rust pour l'installation et la lecture).
// Une divergence — un identifiant renommé, une taille corrigée d'un seul côté,
// une voix ajoutée d'un côté seulement — ferait télécharger un fichier que le
// moteur ne saurait pas lire, ou annoncerait un total faux. Ce test ÉCHOUE dès
// que les deux catalogues ne décrivent plus les mêmes voix.
//
// Il vérifie aussi les garanties de l'INSTALLATION, qui doivent rester vraies
// (aucune suppression, reprise possible, moteur Windows seulement) : une
// régression sur ces points casse le test au lieu de passer inaperçue.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { sliceSource } from "./source-slice.js";

import {
  DEFAULT_LOCAL_VOICE_MODEL,
  LOCAL_VOICE_BUNDLE_MODELS,
  LOCAL_VOICE_ENGINE_ARCHIVE_BYTES,
  LOCAL_VOICE_MODELS,
  localVoiceBundleBytes,
} from "./local-voice.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

/** Lit un fichier du dépôt (fins de ligne normalisées : piège CI Windows). */
function read(relative) {
  return readFileSync(join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");
}

/** Bloc Rust d'une constante déclarée `pub const NAME ... ;`. */
function rustBlock(source, name) {
  const start = source.indexOf(`pub const ${name}`);
  if (start === -1) throw new Error(`constante Rust introuvable : ${name}`);  const end = source.indexOf("];", start);
  const semi = source.indexOf(";", start);
  const stop = end !== -1 && end < (semi === -1 ? Infinity : semi + 1) ? end + 2 : semi + 1;
  return source.slice(start, stop);
}

/** Valeur texte d'un champ Rust (`model: "fr_FR-…"`). */
function textField(chunk, field) {
  const match = chunk.match(new RegExp(`${field}:\\s*"([^"]*)"`));
  return match ? match[1] : null;
}

/** Valeur numérique d'un champ Rust (`onnx_bytes: 63_201_294`). */
function numberField(chunk, field) {
  const match = chunk.match(new RegExp(`${field}:\\s*([0-9_]+)`));
  return match ? Number(match[1].replace(/_/g, "")) : null;
}

/**
 * Valeur d'une constante Rust simple (`pub const X: &str = "…";`, `u64 = 12;`,
 * `&[&str] = &["a"];`) : le texte de la valeur, sans les guillemets.
 */
function rustConst(source, name) {
  const match = source.match(new RegExp(`pub const ${name}:\\s*[^=]+=\\s*([\\s\\S]*?);`));
  if (!match) throw new Error(`constante Rust introuvable : ${name}`);
  return match[1].trim().replace(/^"|"$/g, "");
}

/** Valeur numérique d'une constante Rust. */
function rustConstNumber(source, name) {
  return Number(rustConst(source, name).replace(/_/g, ""));
}

/** Entrées de la table Rust `VOICES` (le catalogue de référence). */
function rustVoices(source) {
  const block = rustBlock(source, "VOICES: ");
  const entries = [];
  const re = /LocalVoice\s*\{([\s\S]*?)\}/g;
  let match = re.exec(block);
  while (match) {
    const chunk = match[1];
    entries.push({
      model: textField(chunk, "model"),
      gender: textField(chunk, "gender"),
      quality: textField(chunk, "quality"),
      bytes: numberField(chunk, "onnx_bytes"),
      configBytes: numberField(chunk, "config_bytes"),
    });
    match = re.exec(block);
  }
  return entries;
}

/** Liste de noms Rust `pub const BUNDLE_MODELS: &[&str] = &["a", "b"];`. */
function rustBundleModels(source) {
  const block = rustBlock(source, "BUNDLE_MODELS");
  return [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

describe("catalogue des voix françaises : JS et Rust disent la MÊME chose", () => {
  const rustSource = read("src-tauri/src/tts_local.rs");
  const downloadSource = read("src-tauri/src/tts_local_download.rs");
  const voices = rustVoices(rustSource);

  it("la table Rust est lue (le test ne passe pas sur une table vide)", () => {
    expect(voices.length).toBe(LOCAL_VOICE_MODELS.length);
    expect(voices.length).toBeGreaterThan(0);
  });

  it("mêmes identifiants, des deux côtés (aucune voix inventée, aucune oubliée)", () => {
    const js = LOCAL_VOICE_MODELS.map((entry) => entry.model).sort();
    const rust = voices.map((entry) => entry.model).sort();
    expect(js).toEqual(rust);
    // Aucun doublon d'un côté comme de l'autre.
    expect(new Set(js).size).toBe(js.length);
    expect(new Set(rust).size).toBe(rust.length);
  });

  it("mêmes tailles attendues pour chaque voix (le total annoncé n'est pas faux)", () => {
    for (const entry of LOCAL_VOICE_MODELS) {
      const rust = voices.find((voice) => voice.model === entry.model);
      expect(rust, `${entry.model} absent du catalogue Rust`).toBeTruthy();
      expect(entry.bytes, `${entry.model} : taille .onnx différente`).toBe(rust.bytes);
      expect(entry.bytes).toBeGreaterThan(1_000_000);
      // Le fichier de configuration accompagne toujours le modèle.
      expect(rust.configBytes, `${entry.model} : configuration sans taille`).toBeGreaterThan(1_000);
      expect(rust.configBytes).toBeLessThan(100_000);
    }
  });

  it("mêmes genres et mêmes qualités (l'utilisateur lit « voix de femme » / « d'homme »)", () => {
    for (const entry of LOCAL_VOICE_MODELS) {
      const rust = voices.find((voice) => voice.model === entry.model);
      expect(entry.gender, `${entry.model} : genre différent`).toBe(rust.gender);
      expect(entry.quality, `${entry.model} : qualité différente`).toBe(rust.quality);
      expect(["femme", "homme"]).toContain(entry.gender);
      expect(["medium", "low"]).toContain(entry.quality);
      // Le nom du modèle porte la même qualité que la table.
      expect(entry.model.endsWith(`-${entry.quality}`)).toBe(true);
    }
  });

  it("la voix par défaut est la même des deux côtés", () => {
    expect(rustConst(rustSource, "DEFAULT_MODEL_NAME")).toBe(DEFAULT_LOCAL_VOICE_MODEL);
    // La voix par défaut fait partie du paquet installé par le geste unique.
    expect(LOCAL_VOICE_BUNDLE_MODELS).toContain(DEFAULT_LOCAL_VOICE_MODEL);
  });

  it("le geste unique installe exactement les deux voix annoncées (femme + homme, qualité moyenne)", () => {
    expect(rustBundleModels(downloadSource)).toEqual(LOCAL_VOICE_BUNDLE_MODELS);
    expect(LOCAL_VOICE_BUNDLE_MODELS.length).toBe(2);
    const bundle = LOCAL_VOICE_BUNDLE_MODELS.map((model) =>
      LOCAL_VOICE_MODELS.find((entry) => entry.model === model),
    );
    // Les deux voix existent bien au catalogue (aucun nom écrit à la main).
    expect(bundle.every(Boolean)).toBe(true);
    expect(bundle.map((entry) => entry.gender).sort()).toEqual(["femme", "homme"]);
    expect(bundle.every((entry) => entry.quality === "medium")).toBe(true);
  });

  it("le total annoncé avant le geste est celui du catalogue (moteur compris)", () => {
    const voicesBytes = LOCAL_VOICE_BUNDLE_MODELS.reduce((sum, model) => {
      const entry = LOCAL_VOICE_MODELS.find((voice) => voice.model === model);
      return sum + entry.bytes;
    }, 0);
    // Sans moteur installé : moteur + les deux voix.
    expect(localVoiceBundleBytes()).toBe(voicesBytes + LOCAL_VOICE_ENGINE_ARCHIVE_BYTES);
    // Moteur déjà présent (y compris celui d'une AUTRE version de Pilot) : il
    // n'est pas retéléchargé, donc le total baisse d'autant.
    expect(localVoiceBundleBytes({ engineInstalled: true })).toBe(voicesBytes);
    // La taille du moteur est la MÊME des deux côtés (une seule valeur).
    const engine = rustConstNumber(downloadSource, "ENGINE_ARCHIVE_BYTES");
    expect(engine).toBe(LOCAL_VOICE_ENGINE_ARCHIVE_BYTES);
    expect(engine).toBe(22_477_236);
  });

  it("l'archive du moteur vient du dépôt officiel de Piper (URL exacte, aucune autre)", () => {
    expect(rustConst(downloadSource, "ENGINE_ARCHIVE_URL")).toBe(
      "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip",
    );
    // Les modèles viennent du dépôt officiel des voix Piper.
    expect(rustConst(downloadSource, "VOICES_BASE_URL")).toBe(
      "https://huggingface.co/rhasspy/piper-voices/resolve/main",
    );
  });
});

describe("les garanties de l'installation restent vraies", () => {
  const downloadSource = read("src-tauri/src/tts_local_download.rs");
  const localSource = read("src-tauri/src/tts_local.rs");

  it("rien n'est jamais supprimé (ni fichier temporaire, ni archive, ni modèle)", () => {
    // Le code de production (avant les tests) ne supprime jamais rien : un
    // fichier interrompu reste en place, l'archive du moteur reste en place.
    // Découpage PROTÉGÉ (ancre de début et de fin exigées, fragment minimal) :
    // un fragment vide rendrait l'assertion négative vraie par construction.
    const production = sliceSource(
      downloadSource,
      "// tts_local_download.rs",
      "#[cfg(test)]",
      2000,
    );
    expect(production).not.toMatch(/remove_file\(/);
    expect(production).not.toMatch(/remove_dir/);
  });

  it("un téléchargement interrompu reprend là où il s'est arrêté (Range + .part)", () => {
    expect(downloadSource).toContain("RANGE");
    expect(rustConst(downloadSource, "PART_SUFFIX")).toBe(".part");
    expect(downloadSource).toContain("part_path(");
    // Le fichier final n'est publié qu'après vérification de la taille exacte.
    expect(downloadSource).toMatch(/received != expected/);
    expect(downloadSource).toMatch(/std::fs::rename\(/);
  });

  it("un fichier tronqué n'est JAMAIS déclaré installé (défaut corrigé)", () => {
    // La vérification compare la taille EXACTE attendue, des deux côtés.
    expect(localSource).toMatch(/pub fn file_complete/);
    expect(localSource).toMatch(/meta\.len\(\) == expected/);
    expect(downloadSource).toContain("tts_local::file_complete(");
    // Le catalogue porte donc bien une taille attendue par fichier.
    expect(LOCAL_VOICE_MODELS.every((entry) => entry.bytes > 0)).toBe(true);
  });

  it("le moteur ne s'installe que là où Pilot le fournit (Windows), et le dit ailleurs", () => {
    expect(localSource).toMatch(/pub fn engine_install_supported\(\) -> bool \{\s*cfg!\(windows\)/);
    // L'installation n'ajoute pas d'étape moteur quand Pilot ne le fournit pas.
    expect(downloadSource).toMatch(/!tts_local::piper_exe\(engine_root\)\.is_file\(\) && engine_supported/);
    // Le repli sur la voix du système est toujours annoncé, jamais silencieux.
    expect(localSource).toMatch(/voix du système/);
  });

  it("rien ne se télécharge sans geste : une seule porte d'entrée, une seule garde", () => {
    // Une seule commande de téléchargement, et une seule garde (un seul à la fois).
    expect([...downloadSource.matchAll(/pub async fn tts_local_download\(/g)].length).toBe(1);
    expect(downloadSource).toContain("compare_exchange(false, true");
    // Aucun appel automatique côté interface : le téléchargement n'est demandé
    // que par le geste (bouton ou choix d'une voix), jamais au rendu.
    const settings = read("src/js/settings.js");
    expect([...settings.matchAll(/downloadLocalVoiceModel\(/g)].length).toBe(1);
  });

  it("la voix réellement choisie est transmise au plan (choisir une voix la télécharge)", () => {
    // Le geste unique installe le paquet, mais le modèle DEMANDÉ doit entrer
    // dans le plan : sans cela, choisir `fr_FR-gilles-low` ou `fr_FR-siwis-low`
    // le laisserait manquant pour toujours (régression du téléchargement par
    // voix) alors que l'écran annonce que le geste installe ce qui manque.
    expect(downloadSource).toMatch(/fn install_order\(requested: Option<&str>\)/);
    expect(downloadSource).toMatch(/plan_bundle\(root, engine_root, Some\(model\)\)/);
    // La voix demandée n'est ajoutée qu'une fois (aucun doublon dans le plan).
    expect(downloadSource).toMatch(/if !order\.contains\(&chosen\)/);
    // Et elle est ajoutée APRÈS le paquet (le moteur et les deux voix d'abord).
    const orderFn = downloadSource.indexOf("fn install_order(");
    const pushChosen = downloadSource.indexOf("order.push(chosen)");
    expect(orderFn).toBeGreaterThan(-1);
    expect(pushChosen).toBeGreaterThan(orderFn);
  });

  it("le catalogue suit l'ordre du plan d'installation : moteur, puis la voix de femme, puis l'homme", () => {
    const engineStep = downloadSource.indexOf("id: ENGINE_STEP.to_string()");
    const voiceLoop = downloadSource.indexOf("for model in install_order(requested)");
    expect(engineStep).toBeGreaterThan(-1);
    expect(voiceLoop).toBeGreaterThan(engineStep);
    // La voix de femme est la première du paquet (c'est aussi la voix par défaut).
    expect(LOCAL_VOICE_BUNDLE_MODELS[0]).toBe(DEFAULT_LOCAL_VOICE_MODEL);
    expect(LOCAL_VOICE_MODELS.find((entry) => entry.model === LOCAL_VOICE_BUNDLE_MODELS[0]).gender).toBe(
      "femme",
    );
  });
});
