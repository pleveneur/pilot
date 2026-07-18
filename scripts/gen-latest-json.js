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

async function getReleaseAssets() {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/releases/tags/${encodeURIComponent(TAG)}`,
    { headers: { Authorization: `token ${TOKEN}`, Accept: "application/vnd.github+json" } }
  );
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.assets || [];
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
  const assets = await getReleaseAssets();

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

  const out = {
    version: VERSION,
    notes: `Pilot ${VERSION}`,
    pub_date: new Date().toISOString(),
    platforms,
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`✓ ${OUT} généré (${nbOk} plateforme(s))`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});