#!/usr/bin/env node
// prepare-laya.js — Prépare les fichiers du SERVICE LAYA dans `src-tauri/laya/`
// pour qu'ils soient embarqués dans la version livrée de Pilot
// (`bundle.resources` de `src-tauri/tauri.conf.json`).
//
// Usage : node scripts/prepare-laya.js   (ou npm run prepare:laya)
//
// Pourquoi ce script existe : les fichiers de LayaPL ne sont JAMAIS versionnés
// dans le dépôt Pilot (dépôt et licence distincts). Ils sont recopiés au moment
// de la construction, depuis un dossier source hors dépôt.
//
// Provenance (dossier source) :
//   - variable d'environnement `LAYA_SOURCE_DIR` (absolue ou relative au dossier
//     courant) ;
//   - sinon, dossier voisin du dépôt : `<dépôt>/../LayaPL`.
//
// Ce qui est recopié (le STRICT nécessaire au démarrage et à l'inférence, établi
// en faisant réellement tourner le service depuis une copie préparée) :
//   laya-service.mjs                                  le service (point d'entrée)
//   laya-fetch.mjs                                    le téléchargeur du modèle
//   model-manifest.json                               adresse + tailles/empreintes
//   laya-ts/package.json                              type:module de la bibliothèque
//   laya-ts/dist/*.js                                 la bibliothèque compilée
//   laya-ts/node_modules/onnxruntime-node/package.json
//   laya-ts/node_modules/onnxruntime-node/dist/*.js   la liaison ONNX Runtime
//   laya-ts/node_modules/onnxruntime-common/dist/…   l'API commune (+ les
//                                                    package.json imbriqués,
//                                                    indispensables)
//   .../onnxruntime-node/bin/napi-v6/<os>/<arch>/*    le moteur natif DU SYSTÈME
//   laya-ts/node_modules/onnxruntime-common/...       l'API commune ONNX Runtime
//   node/node(.exe)                                   l'interpréteur embarqué
//
// Le binaire natif embarqué est celui du système qui construit : Windows
// aujourd'hui, Linux et macOS plus tard (aucun autre n'est copié, donc la version
// livrée ne pèse que ce qu'elle utilise). Les DLL propres à DirectML
// (DirectML.dll, dxcompiler.dll, dxil.dll) sont écartées : le service demande le
// fournisseur CPU (vérifié par une exécution réelle).
//
// Idempotent : le dossier cible est EFFACÉ puis reconstruit à l'identique.
// Sans réseau, sans git, sans dépendance npm.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const DEST = path.join(ROOT, "src-tauri", "laya");
const SRC = path.resolve(
  process.env.LAYA_SOURCE_DIR || path.join(ROOT, "..", "LayaPL")
);

// Dossier du binaire natif du moteur d'inférence : un seul système embarqué.
const PLATFORM_DIR = path.posix.join(
  "laya-ts/node_modules/onnxruntime-node/bin/napi-v6",
  process.platform,
  process.arch
);

// DLL utiles au seul fournisseur DirectML : le service demande le fournisseur
// CPU, donc elles ne sont pas embarquées (vérifié par une exécution réelle).
const DML_ONLY = ["DirectML.dll", "dxcompiler.dll", "dxil.dll"];

// Entrées dont l'absence dans un dossier source PRÉSENT est une erreur : mieux
// vaut échouer que livrer une copie incomplète en silence.
const REQUIRED = [
  "laya-service.mjs",
  "laya-fetch.mjs",
  "model-manifest.json",
  "laya-ts/package.json",
  "laya-ts/dist/index.js",
  "laya-ts/node_modules/onnxruntime-node/package.json",
  "laya-ts/node_modules/onnxruntime-node/dist/index.js",
  "laya-ts/node_modules/onnxruntime-common/package.json",
  "laya-ts/node_modules/onnxruntime-common/dist/cjs/index.js",
  PLATFORM_DIR,
];

/** Fichiers simples à recopier tels quels. */
const FILES = [
  "laya-service.mjs",
  "laya-fetch.mjs",
  "model-manifest.json",
  "laya-ts/package.json",
  "laya-ts/node_modules/onnxruntime-node/package.json",
  "laya-ts/node_modules/onnxruntime-common/package.json",
];

/**
 * Filtre des dossiers `dist` : le code `.js` ET les `package.json` imbriqués.
 * Ces derniers sont INDISPENSABLES : `onnxruntime-common/dist/cjs/package.json`
 * vaut `{"type":"commonjs"}` et c'est ce qui autorise Node à charger le
 * `dist/cjs/*.js` d'un paquet déclaré `"type":"module"`. Les omettre fait
 * échouer le chargement du modèle (« exports is not defined in ES module
 * scope »), constaté par une exécution réelle — pas par supposition.
 */
const KEEP_JS = (name) => name.endsWith(".js") || name === "package.json";

/** Arborescences à recopier, avec le filtre de fichiers appliqué à la source. */
const TREES = [
  { from: "laya-ts/dist", keep: KEEP_JS },
  {
    from: "laya-ts/node_modules/onnxruntime-node/dist",
    keep: KEEP_JS,
  },
  {
    from: "laya-ts/node_modules/onnxruntime-common/dist",
    keep: KEEP_JS,
  },
  {
    from: PLATFORM_DIR,
    keep: (name) => !DML_ONLY.includes(name),
  },
];

/** Taille lisible (Mo, une décimale). Pur. */
function mo(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1) + " Mo";
}

/** Taille récursive d'un chemin (0 si absent). */
function sizeOf(target) {
  let st;
  try {
    st = fs.statSync(target);
  } catch {
    return 0;
  }
  if (!st.isDirectory()) return st.size;
  return fs
    .readdirSync(target)
    .reduce((sum, name) => sum + sizeOf(path.join(target, name)), 0);
}

/** Copie récursive d'un dossier en conservant le filtre. */
function copyTree(fromAbs, toAbs, keep) {
  fs.mkdirSync(toAbs, { recursive: true });
  for (const entry of fs.readdirSync(fromAbs, { withFileTypes: true })) {
    const src = path.join(fromAbs, entry.name);
    const dst = path.join(toAbs, entry.name);
    if (entry.isDirectory()) {
      copyTree(src, dst, keep);
    } else if (entry.isFile() && keep(entry.name)) {
      fs.copyFileSync(src, dst);
    }
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

// ── 1. Dossier cible toujours vidé puis recréé (idempotence stricte) ──
fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });

// ── 2. Dossier source absent : message clair, construction qui continue ──
// Le dossier cible existe quand même (un `bundle.resources` pointant sur un
// dossier inexistant ferait échouer la construction). Le paquet obtenu ne
// embarque simplement pas Laya : Pilot le DIT alors clairement à l'écran, au
// lieu d'échouer en silence.
if (!fs.existsSync(SRC) || !fs.statSync(SRC).isDirectory()) {
  console.warn(
    [
      "",
      "⚠️  Service Laya NON embarqué dans ce paquet.",
      `    Dossier source introuvable : ${SRC}`,
      "",
      "    Pour l'embarquer : placez le dossier de LayaPL à côté du dépôt Pilot",
      "    (…/LayaPL), ou indiquez son emplacement :",
      "        LAYA_SOURCE_DIR=/chemin/vers/LayaPL npm run prepare:laya",
      "",
      "    Conséquence sur la version construite : elle ne peut pas démarrer le",
      "    service Laya par elle-même. Le réglage « Programme du service »",
      "    (chemin indiqué à la main) reste utilisable, sans changement.",
      "",
      "    Rien d'autre n'est affecté : la construction se poursuit.",
      "",
    ].join("\n")
  );
  process.exit(0);
}

// ── 3. Dossier source présent : tout ce qui manque est une erreur ──
const missing = REQUIRED.filter((rel) => !fs.existsSync(path.join(SRC, rel)));
if (missing.length > 0) {
  fail(
    [
      "",
      `❌ Dossier source de LayaPL incomplet : ${SRC}`,
      "   Élément(s) manquant(s) :",
      ...missing.map((rel) => `     - ${rel}`),
      "",
      "   La version livrée serait incomplète : rien n'a été copié.",
      "   Reconstruisez LayaPL (npm install + npm run build dans laya-ts),",
      "   ou corrigez LAYA_SOURCE_DIR, puis relancez ce script.",
      "",
    ].join("\n")
  );
}

// ── 4. Copie ──
const copied = [];
for (const rel of FILES) {
  const src = path.join(SRC, rel);
  const dst = path.join(DEST, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  copied.push({ name: rel, bytes: fs.statSync(dst).size });
}
for (const { from, keep } of TREES) {
  const dst = path.join(DEST, from);
  copyTree(path.join(SRC, from), dst, keep);
  copied.push({ name: from + "/", bytes: sizeOf(dst) });
}

// ── 5. Interpréteur embarqué (la machine cible peut n'en avoir aucun) ──
// C'est l'interpréteur qui exécute CE script qui est embarqué. Sortie de secours
// explicite (`LAYA_EMBED_NODE=0`) pour les paquets qui s'en remettent au `node`
// du système.
let nodeEntry = null;
if (process.env.LAYA_EMBED_NODE === "0") {
  console.warn(
    "[prepare-laya] Interpréteur NON embarqué (LAYA_EMBED_NODE=0) : " +
      "la version livrée utilisera le Node.js du système."
  );
} else {
  const nodeName = path.basename(process.execPath);
  const rel = path.join("node", nodeName);
  const dst = path.join(DEST, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(process.execPath, dst);
  nodeEntry = { name: rel, bytes: fs.statSync(dst).size };
  copied.push(nodeEntry);
}

// ── 6. Récapitulatif ──
const total = copied.reduce((sum, e) => sum + e.bytes, 0);
console.log(`[prepare-laya] Source : ${SRC}`);
console.log(`[prepare-laya] Cible  : ${DEST}`);
for (const e of copied.sort((a, b) => b.bytes - a.bytes)) {
  console.log(`[prepare-laya]   ${mo(e.bytes).padStart(9)}  ${e.name}`);
}
console.log(
  `[prepare-laya] Embarqué : ${copied.length} entrées, ${mo(total)} ` +
    `(système : ${process.platform}/${process.arch})` +
    (nodeEntry ? "" : " — sans interpréteur embarqué")
);
