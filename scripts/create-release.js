// create-release.js — Crée la GitHub Release pour le tag donné, de manière
// idempotente. Si la release existe déjà (re-run du workflow), ne fait rien.
// Sinon, la crée (draft=false, prerelease=false) avec un body fixe qui sera
// ensuite mis à jour avec le changelog par gen-latest-json.js.
//
// REPUBLIER UN TAG EXISTANT EST REFUSÉ (verrou du lot B, trou C7.5 de
// docs/rapports/RAPPORT-voies-de-contournement-livraison.md) : le retour
// silencieux « rien à créer » laissait les builds réécrire les assets du même
// tag, donc servir aux utilisateurs installés un contenu qui n'était plus celui
// qu'ils avaient reçu. Le refus est net (code 2) et nomme la sortie de secours
// explicite `ALLOW_EXISTING_RELEASE=1` (re-run volontaire). La décision est
// PURE et vit à un seul endroit : `scripts/release-gates.js`.
//
// Le CHANGELOG est exigé AVANT cela (porte 0) : `release-notes/v<version>.md` doit
// exister et contenir au moins une ligne lisible. Sans lui, rien n'est publié —
// pas même la Release, et les trois fabrications ne sont pas lancées.
// Sortie de secours explicite : `ALLOW_MISSING_RELEASE_NOTES=1`.
//
// Usage :
//   node scripts/create-release.js <tag> <repo> [commitish]
//
//   tag       : nom du tag (ex: v0.2.9)
//   repo      : "OWNER/REPO"
//   commitish: SHA/branche cible du tag (défaut: GITHUB_SHA)
//
// Nécessite GITHUB_TOKEN (permissions "contents: write").

import {
  ALLOW_EXISTING_RELEASE_ENV,
  ALLOW_MISSING_NOTES_ENV,
  EXIT_RELEASE_REFUSED,
  evaluateExistingRelease,
  evaluateReleaseNotes,
  flagEnabled,
  notesPathForTag,
} from "./release-gates.js";
import { readFileSync } from "fs";

const TAG = process.argv[2];
const REPO = process.argv[3];
const COMMITISH = process.argv[4] || process.env.GITHUB_SHA;
const TOKEN = process.env.GITHUB_TOKEN;

if (!TAG || !REPO || !TOKEN) {
  console.error("Usage: node create-release.js <tag> <OWNER/REPO> [commitish]");
  console.error("GITHUB_TOKEN must be set.");
  process.exit(1);
}

const RELEASE_BODY = "";

const ALLOW_EXISTING = flagEnabled(process.env[ALLOW_EXISTING_RELEASE_ENV]);

/** Refus net et visible (annotation d'erreur dans le résumé du run GitHub). */
function refuse(reason) {
  console.error(`✗ ${reason}`);
  if (process.env.GITHUB_ACTIONS) console.log(`::error::${reason}`);
  process.exit(EXIT_RELEASE_REFUSED);
}

/**
 * Applique la décision de `release-gates.js` : refus net, ou acceptation
 * explicite journalisée. Renvoie la décision quand elle est terminale.
 */
function applyExistingRelease({ already }) {
  const answer = evaluateExistingRelease({ tag: TAG, already, allowExisting: ALLOW_EXISTING });
  if (!answer.ok) refuse(answer.reason);
  if (answer.accepted) {
    console.log(`↷ ${answer.reason}`);
    if (process.env.GITHUB_ACTIONS) console.log(`::warning::${answer.reason}`);
  }
  return answer;
}

/**
 * Lit le changelog humain du tag, ou null. Le chemin vient de
 * `release-gates.js` (une seule definition dans le depot).
 */
function lireChangelog(tag) {
  try {
    return readFileSync(notesPathForTag(tag), "utf8");
  } catch {
    return null;
  }
}

(async () => {
  // ── Porte 0 : CHANGELOG OBLIGATOIRE, avant TOUTE publication ────────────
  // Placée ici, elle refuse avant que la Release existe : une version ne part
  // pas sans note lisible par l'utilisateur, et les trois fabrications ne sont
  // même pas lancées. La même porte repasse dans `gen-latest-json.js` (le
  // fichier peut avoir disparu entre-temps) : même décision, un seul endroit.
  const notesDecision = evaluateReleaseNotes({
    tag: TAG,
    notes: lireChangelog(TAG),
    allowMissing: flagEnabled(process.env[ALLOW_MISSING_NOTES_ENV]),
  });
  if (!notesDecision.ok) refuse(notesDecision.reason);
  if (notesDecision.accepted) {
    console.log(`↷ ${notesDecision.reason}`);
    if (process.env.GITHUB_ACTIONS) console.log(`::warning::${notesDecision.reason}`);
  }

  // GET /releases/tags/{tag} : la réponse décide, via la porte unique.
  const get = await fetch(
    `https://api.github.com/repos/${REPO}/releases/tags/${encodeURIComponent(TAG)}`,
    { headers: { Authorization: `token ${TOKEN}`, Accept: "application/vnd.github+json" } }
  );
  if (get.status === 200) {
    const rel = await get.json();
    applyExistingRelease({ already: true });
    console.log(`✓ Release ${TAG} existe déjà (id ${rel.id}).`);
    return;
  }
  if (get.status !== 404) {
    throw new Error(`GET release ${get.status}: ${await get.text()}`);
  }
  // Release absente : la porte dit explicitement « rien à refuser ».
  applyExistingRelease({ already: false });

  // Crée la release.
  const body = {
    tag_name: TAG,
    name: `Pilot ${TAG}`,
    body: RELEASE_BODY,
    target_commitish: COMMITISH,
    draft: false,
    prerelease: false,
  };
  const post = await fetch(`https://api.github.com/repos/${REPO}/releases`, {
    method: "POST",
    headers: {
      Authorization: `token ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!post.ok) {
    // Une autre exécution parallèle a créé la release entre le GET et le POST :
    // c'est le MÊME cas « tag déjà publié », donc le MÊME refus (sauf
    // acceptation explicite). Plus de sortie silencieuse.
    const txt = await post.text();
    if (post.status === 422 && txt.includes("already_exists")) {
      applyExistingRelease({ already: true });
      console.log(`✓ Release ${TAG} créée concurremment.`);
      return;
    }
    throw new Error(`POST release ${post.status}: ${txt}`);
  }
  const rel = await post.json();
  console.log(`✓ Release ${TAG} créée (id ${rel.id}).`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});