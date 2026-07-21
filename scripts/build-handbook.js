#!/usr/bin/env node
// build-handbook.js — Génère help/handbook.md (embarqué dans l'app via include_str!)
// à partir des blocs <!-- HELP:topic -->...<!-- /HELP:topic --> des fichiers sources.
//
// Usage : node scripts/build-handbook.js   (ou npm run build:handbook)
//
// Sources (ordre défini = ordre du handbook) :
//   1. help/overview.md      — généralités (rédigé, orienté utilisateur)
//   2. spec_rpc.md           — agent Pi
//   3. spec_orchestration.md — mode orchestration
//   4. spec_web_remote.md    — accès distant
//   5. spec_voice_input.md   — dictée vocale
//   6. spec_pdf2md.md        — PDF
//
// Ne pas éditer help/handbook.md directement : éditer les blocs HELP des sources
// puis relancer ce script.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const SOURCES = [
  "help/overview.md",
  "spec_rpc.md",
  "spec_orchestration.md",
  "spec_web_remote.md",
  "spec_voice_input.md",
  "spec_pdf2md.md",
  "spec_context_engine.md",
  "spec_diff_review.md",
  "spec_project_memory.md",
  "spec_review.md",
];
const OUT = path.join(ROOT, "help", "handbook.md");

// Regex : capture (1) topic-id, (2) contenu. Backreference \1 pour la fermeture.
const HELP_RE = /<!--\s*HELP:(\S+?)\s*-->([\s\S]*?)<!--\s*\/HELP:\1\s*-->/g;

function extractBlocks(filePath) {
  const abs = path.join(ROOT, filePath);
  if (!fs.existsSync(abs)) {
    console.warn(`[build-handbook] ⚠️ source manquante : ${filePath} (ignorée)`);
    return [];
  }
  const txt = fs.readFileSync(abs, "utf8");
  const blocks = [];
  let m;
  HELP_RE.lastIndex = 0;
  while ((m = HELP_RE.exec(txt)) !== null) {
    const topic = m[1];
    const body = m[2].trim();
    blocks.push({ topic, body, source: filePath });
  }
  return blocks;
}

function main() {
  const all = [];
  for (const src of SOURCES) {
    const blocks = extractBlocks(src);
    for (const b of blocks) all.push(b);
    console.log(`[build-handbook] ${src} : ${blocks.length} bloc(s)`);
  }

  if (all.length === 0) {
    console.error("[build-handbook] ❌ Aucun bloc HELP trouvé. Abandon.");
    process.exit(1);
  }

  const topics = all.map((b) => b.topic);
  const generated = new Date().toISOString().slice(0, 10);
  const header = [
    "<!-- PILOT-HELP generated=" + generated + " topics=" + topics.join(",") + " -->",
    "<!-- FICHIER GÉNÉRÉ — ne pas éditer. Source : help/overview.md + spec_*.md (blocs HELP). -->",
    "",
    "# Aide Pilot",
    "",
    "Tu es l'assistant d'aide de l'éditeur Pilot. Réponds aux questions de",
    "l'utilisateur en te basant sur le contenu de ce handbook.",
    "",
    "",
  ].join("\n");

  const body = all.map((b) => b.body).join("\n\n---\n\n");

  const out = header + body + "\n";

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, out, "utf8");
  console.log(
    `[build-handbook] ✅ ${OUT} généré (${all.length} blocs, ${out.length} octets, topics: ${topics.join(", ")})`
  );
}

main();