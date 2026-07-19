// update-release-notes.js — Génère un changelog à partir des commits entre le
// tag précédent et le tag courant, puis met à jour le `body` de la GitHub
// Release correspondante via l'API. Ce body est ensuite lu par
// `gen-latest-json.js` pour remplir le champ `notes` de latest.json, ce qui
// permet à l'updater d'afficher la liste des modifications dans la modale de
// mise à jour.
//
// Usage :
//   node scripts/update-release-notes.js <tag> <repo>
//
//   tag  : nom du tag (ex: v0.2.5)
//   repo : "OWNER/REPO"
//
// Nécessite GITHUB_TOKEN dans l'environnement (permissions "contents: write").
// Doit être exécuté après `actions/checkout` avec `fetch-depth: 0` (pour avoir
// l'historique Git et les tags locaux).

import { execSync } from "child_process";

const TAG = process.argv[2];
const REPO = process.argv[3];
const TOKEN = process.env.GITHUB_TOKEN;

if (!TAG || !REPO || !TOKEN) {
  console.error("Usage: node update-release-notes.js <tag> <OWNER/REPO>");
  console.error("GITHUB_TOKEN must be set.");
  process.exit(1);
}

// Retourne le tag de version le plus récent strictement antérieur à TAG
// (tri par date de création descendant). Chaîne vide s'il n'y en a pas.
function prevTag(tag) {
  try {
    const tags = execSync("git tag --sort=-creatordate --list 'v*'", {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean);
    const idx = tags.indexOf(tag);
    if (idx === -1 || idx + 1 >= tags.length) return "";
    return tags[idx + 1];
  } catch {
    return "";
  }
}

const HEADER =
  "Téléchargez et installez le binaire correspondant à votre plateforme. La mise à jour automatique est active pour les versions suivantes.";

(async () => {
  const prev = prevTag(TAG);
  const range = prev ? `${prev}..${TAG}` : TAG;
  let changelog = "";
  try {
    changelog = execSync(
      `git log --no-merges --pretty=format:"- %s" ${range}`,
      { encoding: "utf8" }
    ).trim();
  } catch (e) {
    console.warn(`⚠ git log a échoué (${e.message}), changelog vide.`);
  }

  const body = prev
    ? `${HEADER}\n\n## Modifications depuis ${prev}\n\n${changelog || "(aucun)"}`
    : `${HEADER}\n\n## Modifications\n\n${changelog || "(première release)"}`;

  // Récupère l'ID de la release via son tag.
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/releases/tags/${encodeURIComponent(TAG)}`,
    { headers: { Authorization: `token ${TOKEN}`, Accept: "application/vnd.github+json" } }
  );
  if (!res.ok) throw new Error(`GET release ${res.status}: ${await res.text()}`);
  const release = await res.json();
  if (!release.id) throw new Error("Release introuvable (pas d'ID).");

  // Met à jour le body de la release.
  const patch = await fetch(
    `https://api.github.com/repos/${REPO}/releases/${release.id}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `token ${TOKEN}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body }),
    }
  );
  if (!patch.ok) throw new Error(`PATCH release ${patch.status}: ${await patch.text()}`);

  console.log(
    `✓ Notes de release mises à jour pour ${TAG} (${body.length} car.${
      prev ? `, depuis ${prev}` : ""
    })`
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});