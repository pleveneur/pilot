// prepare-laya.test.js — filet du GARDE-FOU de fabrication du service Laya.
//
// Aucun risque pour le vrai dossier `src-tauri/laya/` : le script est recopié
// dans un bac à sable temporaire et exécuté comme un SOUS-PROCESSUS. Le script
// calcule sa racine depuis son propre chemin, donc son dossier cible est
// `<bac-à-sable>/src-tauri/laya`, jamais le vrai. C'est la fabrication RÉELLE
// qui est exécutée, pas une réimplémentation du contrôle.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("./prepare-laya.js", import.meta.url));
const TARGET = "win32/x64";
const PLATFORM_DIR = path.join(
  "laya-ts/node_modules/onnxruntime-node/bin/napi-v6",
  TARGET
);

/** Toutes les pièces requises (fichiers) + un fichier dans le dossier moteur. */
const REQUIRED_FILES = [
  "laya-service.mjs",
  "laya-fetch.mjs",
  "model-manifest.json",
  "laya-ts/package.json",
  "laya-ts/dist/index.js",
  "laya-ts/node_modules/onnxruntime-node/package.json",
  "laya-ts/node_modules/onnxruntime-node/dist/index.js",
  "laya-ts/node_modules/onnxruntime-common/package.json",
  "laya-ts/node_modules/onnxruntime-common/dist/cjs/index.js",
  path.join(PLATFORM_DIR, "onnxruntime.dll"),
];

const sandboxes = [];

function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-prepare-laya-"));
  sandboxes.push(root);
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(root, "scripts", "prepare-laya.js"));
  return root;
}

/** Source LayaPL factice : chaque pièce requise avec un contenu NON VIDE. */
function makeSource(root) {
  const src = path.join(root, "LayaPL");
  for (const rel of REQUIRED_FILES) {
    const abs = path.join(src, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `contenu:${rel}`);
  }
  return src;
}

function runScript(root, source, extraEnv = {}) {
  const script = path.join(root, "scripts", "prepare-laya.js");
  return spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      LAYA_SOURCE_DIR: source,
      LAYA_TARGET_PLATFORM: TARGET,
      LAYA_EMBED_NODE: "0",
      LAYA_ALLOW_MISSING: "",
      ...extraEnv,
    },
  });
}

afterEach(() => {
  for (const root of sandboxes.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("garde-fou de fabrication de prepare-laya", () => {
  it("une source complète et non vide passe (exit 0)", () => {
    const root = makeSandbox();
    const src = makeSource(root);
    const res = runScript(root, src);
    expect(res.status, res.stderr).toBe(0);
    // Le dossier cible du bac à sable a bien reçu des fichiers non vides.
    const copiedService = path.join(root, "src-tauri", "laya", "laya-service.mjs");
    expect(fs.statSync(copiedService).size).toBeGreaterThan(0);
  });

  it("un fichier requis de 0 octet fait ÉCHOUER la fabrication en le nommant", () => {
    const root = makeSandbox();
    const src = makeSource(root);
    // Le symptôme exact de 0.4.19 : présent, mais vide.
    fs.writeFileSync(path.join(src, "laya-service.mjs"), "");

    const res = runScript(root, src);

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("VIDE (0 octet)");
    expect(res.stderr).toContain("laya-service.mjs");
    expect(res.stderr).toContain("fabrication ARRÊTÉE");
    // Rien n'a été copié : le dossier cible reste vide.
    const dest = path.join(root, "src-tauri", "laya");
    expect(fs.existsSync(dest) ? fs.readdirSync(dest).length : 0).toBe(0);
  });

  it("un dossier moteur présent mais vide (0 octet) échoue aussi", () => {
    const root = makeSandbox();
    const src = makeSource(root);
    // Dossier existant, mais sans aucun fichier → taille récursive 0.
    fs.rmSync(path.join(src, PLATFORM_DIR, "onnxruntime.dll"));
    fs.mkdirSync(path.join(src, PLATFORM_DIR), { recursive: true });

    const res = runScript(root, src);

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("VIDE (0 octet)");
    expect(res.stderr).toContain("napi-v6");
  });

  it("une pièce absente reste signalée comme MANQUANTE (pas « vide »)", () => {
    const root = makeSandbox();
    const src = makeSource(root);
    fs.rmSync(path.join(src, "model-manifest.json"));

    const res = runScript(root, src);

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("MANQUANTE");
    expect(res.stderr).toContain("model-manifest.json");
    expect(res.stderr).not.toContain("VIDE (0 octet)");
  });
});
