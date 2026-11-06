#!/usr/bin/env node
// prepare-laya.js — Prépare les fichiers du SERVICE LAYA dans `src-tauri/laya/`
// pour qu'ils soient embarqués dans la version livrée de Pilot
// (`bundle.resources` de `src-tauri/tauri.conf.json`).
//
// Usage : node scripts/prepare-laya.js   (ou npm run prepare:laya)
//
// GARDE-FOU : par défaut, une pièce MANQUANTE ou VIDE (0 octet) fait ÉCHOUER la
// construction. Un paquet publié sans Laya serait un paquet qui annonce une
// fonction qu'il n'a pas : mieux vaut ne rien publier du tout. Un fichier de
// zéro octet passerait un simple test d'existence et rendrait la version
// inutilisable en silence — il est donc traité comme une pièce absente. Mode
// tolérant explicite
// (`--allow-missing` ou `LAYA_ALLOW_MISSING=1`, utilisé par le mode dev et par
// la seule cible macOS Intel — le moteur n'existe pas pour elle) : avertissement
// puis sortie 0, dossier cible laissé vide, la version livrée le DIT à l'écran.
//
// Cible d'embarquement : `LAYA_TARGET_PLATFORM` (`<os>/<arch>`, ex. `win32/x64`,
// `darwin/arm64`, `linux/x64`) sinon la machine qui construit. La CI construit
// macOS Intel sur un runner ARM : sans cette variable, le service embarqué
// aurait le mauvais moteur natif.
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
// Seul le binaire natif de la CIBLE est copié (aucun autre, donc la version
// livrée ne pèse que ce qu'elle utilise). Les DLL propres à DirectML
// (DirectML.dll, dxcompiler.dll, dxil.dll) sont écartées : le service demande le
// fournisseur CPU (vérifié par une exécution réelle).
//
// Idempotent : la nouvelle version est construite dans `src-tauri/laya.tmp`
// puis BASCULÉE en une fois sur `src-tauri/laya` (voir plus bas). Sans réseau,
// sans git, sans dépendance npm.
//
// ROBUSTESSE DU LANCEMENT EN DEV (incident « beforeDevCommand terminated with a
// non-zero status code », `docs/rapports/RAPPORT-diagnostic-lancement-dev.md`) :
//   - un effacement / renommage refusé pour cause de fichier TENU OUVERT est
//     réessayé (8 fois, 150 ms d'écart) avant d'être déclaré en échec ;
//   - au-delà du plafond, le script ne déverse plus de pile d'exception : il dit
//     quoi faire en français et sort en 2 (`scripts/prepare-laya-decision.js`) ;
//   - la cible n'est JAMAIS effacée d'abord : elle est remplacée d'un bloc, donc
//     un échec ne peut plus la laisser amputée.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  EXIT_DESTINATION_LOCKED,
  REMOVE_RETRY_DELAY_MS,
  copyFailureMessage,
  failureHeadline,
  installDestination,
  lockedDestinationMessage,
  previousDirFor,
  removeWithRetries,
  temporaryCleanupSentence,
  temporaryDirFor,
} from "./prepare-laya-decision.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const DEST = path.join(ROOT, "src-tauri", "laya");
// Dossier de travail : la copie s'y construit, la cible n'est touchée qu'à la fin.
const STAGE = temporaryDirFor(DEST);
const PREVIOUS = previousDirFor(DEST);

/** Attente courte entre deux tentatives (n'immobilise pas la boucle). */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Effacement récursif tolérant (l'absence n'est pas une erreur). */
const removeDeep = (target) =>
  fs.rmSync(target, { recursive: true, force: true });

const SRC = path.resolve(
  process.env.LAYA_SOURCE_DIR || path.join(ROOT, "..", "LayaPL")
);

// Cible d'embarquement (`<os>/<arch>`) : celle du PAQUET construit, jamais
// forcément celle de la machine qui le construit.
const TARGET = String(
  process.env.LAYA_TARGET_PLATFORM || `${process.platform}/${process.arch}`
).trim();

// Mode tolérant : pièce manquante = avertissement au lieu d'échec.
const ALLOW_MISSING =
  process.argv.includes("--allow-missing") ||
  ["1", "true", "yes"].includes(
    String(process.env.LAYA_ALLOW_MISSING || "").toLowerCase()
  );

// Dossier du binaire natif du moteur d'inférence : une seule cible embarquée.
const PLATFORM_DIR = path.posix.join(
  "laya-ts/node_modules/onnxruntime-node/bin/napi-v6",
  TARGET
);

// DLL utiles au seul fournisseur DirectML : le service demande le fournisseur
// CPU, donc elles ne sont pas embarquées (vérifié par une exécution réelle).
const DML_ONLY = ["DirectML.dll", "dxcompiler.dll", "dxil.dll"];

// Entrées dont l'absence OU la taille NULLE dans un dossier source PRÉSENT est
// une erreur : mieux vaut échouer que livrer une copie incomplète (ou vide) en
// silence.
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

/**
 * Classe une pièce requise. PURE.
 *   `null`    : utilisable (présente et non vide) ;
 *   "missing" : absente ;
 *   "empty"   : présente mais de taille NULLE (0 octet).
 *
 * Un fichier présent mais vide est traité EXACTEMENT comme une pièce absente :
 * c'est le symptôme qui a livré une version inutilisable en silence (0.4.19).
 */
function pieceProblem(exists, bytes) {
  if (!exists) return "missing";
  if (bytes === 0) return "empty";
  return null;
}

/** Taille récursive d'un chemin (0 si absent ou vide). */
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

function fail(message, code = 1) {
  // La première ligne NOMME l'étape : Tauri n'affichera pas qu'un code non nul.
  console.error(failureHeadline());
  console.error(message);
  process.exit(code);
}

/// Avertissement de mode tolérant : la construction CONTINUE sans Laya.
async function warnMissing(lines) {
  console.warn(lines.join("\n"));
  console.warn(
    `[prepare-laya] ⚠️  Aucune ressource embarquée : ${DEST} reste vide.\n` +
      "[prepare-laya]     La version obtenue ne peut pas démarrer le service " +
      "Laya par elle-même ; l'écran le dira clairement.\n"
  );
  // La cible est laissée VIDE : on efface au mieux (un dossier tenu ouvert ici
  // n'a aucune raison d'arrêter un mode tolérant — on le dit et on continue).
  const removed = await removeWithRetries({
    dest: DEST,
    remove: removeDeep,
    sleep,
  });
  if (!removed.ok) {
    console.warn(
      `[prepare-laya] ⚠️  L'ancien contenu de ${DEST} n'a pas pu être effacé` +
        " (un autre programme le tient ouvert).\n" +
        "[prepare-laya]     Il sera remplacé au prochain lancement réussi."
    );
  }
  fs.mkdirSync(DEST, { recursive: true });
  process.exit(0);
}

// ── 1. Cible validée, puis dossier de travail préparé À CÔTÉ de la cible ──
// Le format de la cible est validé AVANT tout `path.join`.
if (!/^[a-z0-9]+\/[a-z0-9]+$/i.test(TARGET)) {
  fail(
    `❌ LAYA_TARGET_PLATFORM invalide : « ${TARGET} ».\n` +
      "   Format attendu : <os>/<arch>, par exemple win32/x64, darwin/arm64, linux/x64."
  );
}

// Restes d'une exécution interrompue (`.tmp` / `.old`) : effacés au mieux. Un
// reste non effaçable ne doit pas empêcher un nouveau lancement ; il est alors
// signalé, et le dossier de travail porte un nom neuf plus bas.
for (const leftover of [STAGE, PREVIOUS]) {
  const cleaned = await removeWithRetries({ dest: leftover, remove: removeDeep, sleep });
  if (!cleaned.ok) {
    console.warn(
      `[prepare-laya] ⚠️  Un reste de lancement précédent n'a pas pu être effacé :\n` +
        `[prepare-laya]     ${leftover}\n` +
        "[prepare-laya]     Il sera repris au prochain lancement ; la cible actuelle n'est pas touchée."
    );
  }
}

// Dossier de travail : vide et prêt à recevoir la nouvelle version.
fs.mkdirSync(STAGE, { recursive: true });

// ── 2. Dossier source absent ──
// Le dossier cible existe quand même (un `bundle.resources` pointant sur un
// dossier inexistant ferait échouer la construction). En mode STRICT (défaut,
// c'est le cas de toute construction destinée à publication), l'absence de la
// source ARRÊTE la fabrication : un paquet livré sans Laya annoncerait une
// fonction qu'il n'a pas. En mode tolérant, on continue sans rien embarquer et
// la version le dit à l'écran.
if (!fs.existsSync(SRC) || !fs.statSync(SRC).isDirectory()) {
  const lines = [
    "",
    "⚠️  Source de LayaPL introuvable : rien à embarquer.",
    `    Dossier source : ${SRC}`,
    "",
    "    Pour l'embarquer : placez le dossier de LayaPL à côté du dépôt Pilot",
    "    (…/LayaPL), ou indiquez son emplacement :",
    "        LAYA_SOURCE_DIR=/chemin/vers/LayaPL npm run prepare:laya",
    `    Cible demandée : ${TARGET}`,
    "",
  ];
  if (ALLOW_MISSING) {
    lines.push("    Mode tolérant : la construction se poursuit SANS Laya.", "");
    await warnMissing(lines);
  }
  fail(
    [
      ...lines,
      "    La version livrée serait incomplète : fabrication ARRÊTÉE.",
      "    (Mode tolérant pour un build de développement : --allow-missing)",
      "",
    ].join("\n")
  );
}

// ── 3. Dossier source présent : ce qui manque OU ce qui est vide est une erreur ──
// Un simple test d'existence laisserait passer un fichier de 0 octet : présent,
// mais inutilisable — exactement le défaut constaté sur 0.4.19. La taille nulle
// est donc traitée comme une absence, et le message dit LEQUEL est vide.
const problems = REQUIRED.map((rel) => {
  const abs = path.join(SRC, rel);
  const exists = fs.existsSync(abs);
  return { rel, problem: pieceProblem(exists, exists ? sizeOf(abs) : 0) };
}).filter((p) => p.problem !== null);
if (problems.length > 0) {
  const missing = problems.filter((p) => p.problem === "missing");
  const empty = problems.filter((p) => p.problem === "empty");
  const lines = [
    "",
    `❌ Pièce(s) problématique(s) dans la source LayaPL : ${SRC}`,
    ...missing.map((p) => `     - MANQUANTE      : ${p.rel}`),
    ...empty.map((p) => `     - VIDE (0 octet) : ${p.rel}`),
    `   Cible demandée : ${TARGET}`,
    "",
    ...(empty.length > 0
      ? [
          "   Une pièce VIDE (0 octet) est traitée comme une pièce absente : la",
          "   livrer rendrait le service inutilisable sans le dire. Remplissez-la",
          "   (source LayaPL incomplète) puis relancez.",
          "",
        ]
      : []),
    "   Cas fréquents :",
    "     - LayaPL pas encore installé/compilé → npm ci puis npm run build dans laya-ts ;",
    "     - moteur natif absent pour CETTE cible (ex. darwin/x64) → cette plateforme",
    "       n'est pas supportée par la version d'onnxruntime-node utilisée.",
    "     - LAYA_SOURCE_DIR pointe sur le mauvais dossier.",
    "",
  ];
  if (ALLOW_MISSING) {
    lines.push("    Mode tolérant : la construction se poursuit SANS Laya.", "");
    await warnMissing(lines);
  }
  fail(
    [
      ...lines,
      "   La version livrée serait incomplète : rien n'a été copié, fabrication ARRÊTÉE.",
      "",
    ].join("\n")
  );
}

// ── 4. Copie DANS LE DOSSIER DE TRAVAIL (la cible n'est pas encore touchée) ──
const copied = [];
let copying = "(préparation)";
try {
  for (const rel of FILES) {
    copying = rel;
    const src = path.join(SRC, rel);
    const dst = path.join(STAGE, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    copied.push({ name: rel, bytes: fs.statSync(dst).size });
  }
  for (const { from, keep } of TREES) {
    copying = from + "/";
    const dst = path.join(STAGE, from);
    copyTree(path.join(SRC, from), dst, keep);
    copied.push({ name: from + "/", bytes: sizeOf(dst) });
  }
} catch (e) {
  // Jamais de pile d'exception dans la figure de l'utilisateur : on nomme la
  // pièce et le geste, puis on sort. La cible est intacte (copie à côté).
  await removeWithRetries({ dest: STAGE, remove: removeDeep, sleep });
  fail(copyFailureMessage({ rel: copying, target: DEST, error: e }));
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
  // L'interpréteur embarqué est celui de la MACHINE qui construit : il n'est
  // valable que si sa plateforme et son architecture sont celles de la cible.
  // Embarquer l'interpréteur d'une autre architecture donnerait un paquet qui
  // ne démarre pas — mieux vaut s'arrêter ici, en le disant.
  const hostTarget = `${process.platform}/${process.arch}`;
  if (hostTarget !== TARGET) {
    fail(
      `❌ Interpréteur embarqué impossible : celui de cette machine est ${hostTarget},\n` +
        `   alors que la cible demandée est ${TARGET}.\n` +
        "   Construisez sur une machine de la même cible, ou utilisez\n" +
        "   LAYA_EMBED_NODE=0 (la version livrée utilisera alors le Node.js du\n" +
        "   système, s'il est installé)."
    );
  }
  const nodeName = path.basename(process.execPath);
  const rel = path.join("node", nodeName);
  const dst = path.join(STAGE, rel);
  try {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(process.execPath, dst);
  } catch (e) {
    await removeWithRetries({ dest: STAGE, remove: removeDeep, sleep });
    fail(copyFailureMessage({ rel, target: DEST, error: e }));
  }
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
    `(cible : ${TARGET})` +
    (nodeEntry ? "" : " — sans interpréteur embarqué")
);

// ── 7. BASCULE en une fois : la cible n'est jamais effacée d'abord ──
// C'est ce qui supprime le défaut d'origine : un échec de la bascule laisse
// `src-tauri/laya` TELLE QU'ELLE ÉTAIT, jamais amputée.
const install = await installDestination({
  dest: DEST,
  tmp: STAGE,
  exists: (target) => fs.existsSync(target),
  rename: (from, to) => fs.renameSync(from, to),
  remove: removeDeep,
  sleep,
});

if (!install.ok) {
  const cleaned = await removeWithRetries({ dest: STAGE, remove: removeDeep, sleep });
  fail(
    lockedDestinationMessage({
      dest: DEST,
      attempts: install.attempts,
      delayMs: REMOVE_RETRY_DELAY_MS,
      error: install.error,
      stage: install.stage,
      restored: install.restored === true,
    }) +
      "\n" +
      temporaryCleanupSentence({ tmp: STAGE, removed: cleaned.ok }),
    EXIT_DESTINATION_LOCKED
  );
}

if (install.previousLeftBehind) {
  console.warn(
    `[prepare-laya] ⚠️  L'ancienne version (${PREVIOUS}) n'a pas pu être effacée :\n` +
      "[prepare-laya]     elle n'est plus utilisée et sera reprise au prochain lancement."
  );
}
