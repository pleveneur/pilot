// gen-latest-json.js — Génère le fichier latest.json consommé par l'updater
// Tauri v2 à partir des assets d'une GitHub Release.
//
// Usage :
//   node scripts/gen-latest-json.js <tag> <repo> [outputPath]
//
//   tag  : nom du tag (ex: v0.2.2)
//   repo : "OWNER/REPO"
//
// Récupère les assets de la release via l'API GitHub, détecte les fichiers
// `.sig` (signatures générées par Tauri quand `bundle.createUpdaterArtifacts`
// est true + `TAURI_SIGNING_PRIVATE_KEY` défini), lit leur contenu, et
// associe chaque signature à son binaire pour produire un JSON au format
// attendu par tauri-plugin-updater.
//
// La détection est basée sur des patterns (pas de noms exacts) car la
// nomenclature des artefacts varie selon la plateforme et la version :
//   - Windows : Pilot_<ver>_x64-setup.exe  (+ .sig)
//   - macOS    : Pilot_<ver>_<arch>.app.tar.gz  (+ .sig)  ← l'updater
//                utilise le .app.tar.gz, PAS le .dmg
//   - Linux    : Pilot_<ver>_amd64.AppImage  (+ .sig)
//
// Nécessite GITHUB_TOKEN dans l'environnement (permissions "contents: read").

import fs from "fs";
import { execSync } from "child_process";

const TAG = process.argv[2];
const REPO = process.argv[3];
const OUT = process.argv[4] || "latest.json";
const TOKEN = process.env.GITHUB_TOKEN;

if (!TAG || !REPO || !TOKEN) {
  console.error("Usage: node gen-latest-json.js <tag> <OWNER/REPO> [outputPath]");
  console.error("GITHUB_TOKEN must be set.");
  process.exit(1);
}

const VERSION = TAG.replace(/^v/, "");

const RELEASE_HEADER =
  "Téléchargez et installez le binaire correspondant à votre plateforme. La mise à jour automatique est active pour les versions suivantes.";

// Retourne le tag de version le plus récent strictement antérieur à TAG
// (tri par date de création descendant). Chaîne vide s'il n'y en a pas.
function prevTag(tag) {
  try {
    // Liste tous les tags (sans pattern shell pour rester cross-platform :
    // cmd.exe ne gère pas les simples quotes comme bash). On filtre ceux
    // qui commencent par 'v' en JS.
    const tags = execSync("git tag --sort=-creatordate", {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean)
      .filter((t) => t.startsWith("v"));
    const idx = tags.indexOf(tag);
    if (idx === -1 || idx + 1 >= tags.length) return "";
    return tags[idx + 1];
  } catch {
    return "";
  }
}

// Génère le changelog (commits depuis le tag précédent) + le body complet
// à afficher sur la page GitHub de la release et dans le champ `notes`
// de latest.json (consommé par l'updater).
function buildChangelogBody() {
  const prev = prevTag(TAG);
  const range = prev ? `${prev}..${TAG}` : TAG;
  let changelog = "";
  try {
    changelog = execSync(
      `git log --no-merges --pretty=format:%s ${range}`,
      { encoding: "utf8" }
    )
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((s) => `- ${s}`)
      .join("\n");
  } catch (e) {
    console.warn(`⚠ git log a échoué (${e.message}), changelog vide.`);
  }
  const body = prev
    ? `${RELEASE_HEADER}\n\n## Modifications depuis ${prev}\n\n${changelog || "(aucun)"}`
    : `${RELEASE_HEADER}\n\n## Modifications\n\n${changelog || "(première release)"}`;
  return { body, prev };
}

// Retourne l'objet release GitHub complet (assets + id pour le PATCH).
async function getRelease() {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/releases/tags/${encodeURIComponent(TAG)}`,
    { headers: { Authorization: `token ${TOKEN}`, Accept: "application/vnd.github+json" } }
  );
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { assets: data.assets || [], id: data.id };
}

// Met à jour le body de la release GitHub (visible sur la page release).
async function patchReleaseBody(releaseId, body) {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/releases/${releaseId}`,
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
  if (!res.ok) throw new Error(`PATCH release ${res.status}: ${await res.text()}`);
}

async function fetchSig(url) {
  if (!url) return "";
  const res = await fetch(url);
  if (!res.ok) return "";
  return (await res.text()).trim();
}

// Map un nom de binaire vers la clé plateforme Tauri attendue par l'updater.
// Retourne null si le fichier n'est pas un artefact d'updater reconnu.
function platformFromBinaryName(name) {
  const n = name.toLowerCase();
  if (n.endsWith("-setup.exe") || n.endsWith(".msi")) return "windows-x86_64";
  if (n.endsWith(".app.tar.gz")) {
    if (n.includes("aarch64")) return "darwin-aarch64";
    if (n.includes("x64")) return "darwin-x86_64";
    return null;
  }
  if (n.endsWith(".appimage")) {
    if (n.includes("aarch64")) return "linux-aarch64";
    return "linux-x86_64";
  }
  return null;
}

(async () => {
  // Génère le changelog depuis les commits et met à jour le body de la
  // release GitHub (visible sur la page release). On utilise ce même
  // body comme `notes` dans latest.json — pas de re-fetch de l'API, donc
  // pas de condition de course entre la mise à jour du body et sa lecture.
  const { body: changelogBody, prev } = buildChangelogBody();
  const { assets, id: releaseId } = await getRelease();
  await patchReleaseBody(releaseId, changelogBody);
  console.log(`✓ Body de la release mis à jour${prev ? ` (depuis ${prev})` : ""} — ${changelogBody.length} car.`);

  // Index des assets par nom pour une lookup rapide.
  const byName = new Map(assets.map((a) => [a.name, a]));

  // Pour chaque fichier .sig, on dérive le nom du binaire (sans .sig) et
  // on détermine la plateforme cible. On ignore les .sig dont le binaire
  // correspondant n'est pas un artefact d'updater (ex: .dmg.sig n'est pas
  // utilisé par l'updater macOS qui préfère le .app.tar.gz).
  const platforms = {};
  let nbOk = 0;
  let nbSkipped = 0;

  for (const sigAsset of assets.filter((a) => a.name.endsWith(".sig"))) {
    const binName = sigAsset.name.slice(0, -4); // retire ".sig"
    const binAsset = byName.get(binName);
    if (!binAsset) {
      console.warn(`⚠ Binaire manquant pour la signature: ${sigAsset.name}`);
      nbSkipped++;
      continue;
    }
    const key = platformFromBinaryName(binName);
    if (!key) {
      // Pas un artefact d'updater (ex: .dmg, .deb, .rpm) — ignoré.
      nbSkipped++;
      continue;
    }
    const signature = await fetchSig(sigAsset.browser_download_url);
    if (!signature) {
      console.warn(`⚠ Signature vide: ${sigAsset.name} (${key} ignorée)`);
      nbSkipped++;
      continue;
    }
    platforms[key] = { signature, url: binAsset.browser_download_url };
    console.log(`✓ ${key} -> ${binName}`);
    nbOk++;
  }

  if (nbOk === 0) {
    console.error(
      `Aucune plateforme valide trouvée (${nbSkipped} ignorée(s)). ` +
        "Vérifiez que bundle.createUpdaterArtifacts=true et TAURI_SIGNING_PRIVATE_KEY sont définis."
    );
    process.exit(2);
  }

  // Changelog de la release : on utilise le body généré depuis les commits
  // (déjà patché sur la release GitHub ci-dessus). Fallback sur un simple
  // titre si le body est vide.
  const notes = changelogBody.trim() || `Pilot ${VERSION}`;

  const out = {
    version: VERSION,
    notes,
    pub_date: new Date().toISOString(),
    platforms,
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`✓ ${OUT} généré (${nbOk} plateforme(s), ${notes.length} car. de notes)`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});