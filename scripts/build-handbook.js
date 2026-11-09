#!/usr/bin/env node
// build-handbook.js — Génère help/handbook.md (embarqué dans l'app via include_str!)
// à partir des blocs <!-- HELP:topic -->...<!-- /HELP:topic --> des fichiers sources.
//
// Usage : node scripts/build-handbook.js   (ou npm run build:handbook)
//
// Sources (ordre défini = ordre du handbook) : voir SOURCES ci-dessous.
// Ne pas éditer help/handbook.md directement : éditer les blocs HELP des sources
// puis relancer ce script.
//
// DEUX GARANTIES (correctif « le worktree est sale en permanence ») :
//   1. Le contenu produit ne dépend QUE des sources : aucune date, aucun
//      horodatage, aucun ordre non déterministe. Deux générations identiques
//      produisent donc EXACTEMENT le même texte.
//   2. Le fichier n'est RÉÉCRIT que si son contenu change réellement. Une
//      génération sans changement ne touche pas la date de modification, donc
//      `git status` reste propre et les revues de diff restent lisibles.
//   3. Le contenu est composé par `composeHandbook()` (pure), exportée pour être
//      tenue par le test `scripts/build-handbook.test.js`.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const SOURCES = [
  "help/overview.md",
  "spec_pilot.md",
  "spec_rpc.md",
  "spec_orchestration.md",
  "spec_web_remote.md",
  "spec_voice_input.md",
  "spec_modes_ecran_vocal.md",
  "spec_pdf2md.md",
  "spec_context_engine.md",
  "spec_code_graph.md",
  "spec_diff_review.md",
  "spec_project_memory.md",
  "spec_review.md",
  "spec_orchestration_reviewer.md",
  "spec_session_history.md",
  "spec_gestion_agents.md",
  "spec_agents_md.md",
  "spec_multiprojects.md",
  "spec_interproject.md",
  "spec_super_agent.md",
  "spec_dashboard.md",
  "spec_vault.md",
  "spec_anomaly.md",
  "spec_telegram.md",
  "spec_laya.md",
];
const OUT = path.join(ROOT, "help", "handbook.md");

// Regex : capture (1) topic-id, (2) contenu. Backreference \1 pour la fermeture.
const HELP_RE = /<!--\s*HELP:(\S+?)\s*-->([\s\S]*?)<!--\s*\/HELP:\1\s*-->/g;

/** Extrait les blocs HELP d'un fichier source (liste vide si le fichier manque). */
export function extractBlocks(filePath, root = ROOT) {
  const abs = path.join(root, filePath);
  if (!fs.existsSync(abs)) {
    console.warn(`[build-handbook] ⚠️ source manquante : ${filePath} (ignorée)`);
    return [];
  }
  // Fins de ligne normalisées en LF : le handbook produit est canonique quel que
  // soit le worktree (CRLF ou LF), donc identique d'une machine à l'autre —
  // c'est aussi ce que `.gitattributes` impose aux fichiers texte du dépôt.
  const txt = fs.readFileSync(abs, "utf8").replace(/\r\n/g, "\n");
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

/** Lit tous les blocs de toutes les sources, dans l'ordre défini. */
export function collectBlocks(sources = SOURCES, root = ROOT, log = console.log) {
  const all = [];
  for (const src of sources) {
    const blocks = extractBlocks(src, root);
    for (const b of blocks) all.push(b);
    log(`[build-handbook] ${src} : ${blocks.length} bloc(s)`);
  }
  return all;
}

/**
 * Compose le texte du handbook. PURE : à blocs égaux, texte IDENTIQUE — aucune
 * date, aucun horodatage (deux générations identiques ne peuvent pas différer).
 */
export function composeHandbook(blocks) {
  const topics = blocks.map((b) => b.topic);
  const header = [
    "<!-- PILOT-HELP topics=" + topics.join(",") + " -->",
    "<!-- FICHIER GÉNÉRÉ — ne pas éditer. Source : help/overview.md + spec_*.md (blocs HELP). -->",
    "",
    "# Aide Pilot",
    "",
    "Tu es l'assistant d'aide de l'éditeur Pilot. Réponds aux questions de",
    "l'utilisateur en te basant sur le contenu de ce handbook.",
    "",
    "",
  ].join("\n");

  // Marqueur de thème devant chaque bloc. Il ne servait qu'à la copie de la
  // documentation sur disque (un fichier par thème), retirée : la réponse sur le
  // mode d'emploi passe par UN SEUL chemin, l'outil `answer_from_documentation`
  // (handbook embarqué). Le marqueur est conservé tel quel (aucun contenu du
  // handbook ne change) : il documente la provenance de chaque bloc.
  // Le séparateur `---` du corps ne peut pas servir de frontière : un bloc peut
  // légitimement en contenir un.
  const body = blocks
    .map((b) => `<!-- HELP-TOPIC:${b.topic} -->\n${b.body}`)
    .join("\n\n---\n\n");

  return header + body + "\n";
}

/**
 * Écrit le fichier SEULEMENT si le contenu change. Rend `true` si le fichier a
 * été (ré)écrit, `false` s'il était déjà à jour (le fichier n'est alors pas
 * touché : aucune date de modification, aucun diff Git inutile).
 * Les fins de ligne sont normalisées pour la COMPARAISON seule (piège CRLF).
 */
export function writeIfChanged(outFile, content) {
  let existing = null;
  try {
    existing = fs.readFileSync(outFile, "utf8");
  } catch {
    existing = null;
  }
  const canonique = (t) => t.replace(/\r\n/g, "\n");
  if (existing !== null && canonique(existing) === canonique(content)) return false;
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, content, "utf8");
  return true;
}

/** Génère le handbook. Rend `{ out, blocks, written }`. */
export function generateHandbook({ sources = SOURCES, root = ROOT, outFile = OUT, log = console.log } = {}) {
  const all = collectBlocks(sources, root, log);
  if (all.length === 0) {
    console.error("[build-handbook] ❌ Aucun bloc HELP trouvé. Abandon.");
    return { out: "", blocks: 0, written: false, failed: true };
  }
  const out = composeHandbook(all);
  const written = writeIfChanged(outFile, out);
  log(
    written
      ? `[build-handbook] ✅ ${outFile} généré (${all.length} blocs, ${out.length} octets)`
      : `[build-handbook] = ${outFile} déjà à jour (${all.length} blocs, ${out.length} octets) — fichier non touché`
  );
  return { out, blocks: all.length, written, failed: false };
}

function main() {
  const res = generateHandbook();
  if (res.failed) process.exit(1);
}

// N'exécute la génération que si le script est lancé directement (l'import par
// un test ne doit rien écrire sur le disque).
const direct = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (direct) main();
