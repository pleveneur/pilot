// gen-latest-json.js — Génère le fichier latest.json consommé par l'updater
// Tauri v2 à partir des assets d'une GitHub Release.
//
// Usage :
//   node scripts/gen-latest-json.js <tag> <repo> [outputPath]
//
//   tag  : nom du tag (ex: v0.2.0)
//   repo : "OWNER/REPO"
//
// Récupère les assets de la release via l'API GitHub, lit les fichiers .sig
// associés, et produit un JSON au format attendu par tauri-plugin-updater.
// Nécessite GITHUB_TOKEN dans l'environnement (permissions "contents: read").

const fs = require("fs");

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
const BASE = `https://github.com/${REPO}/releases/download/${TAG}`;

async function getReleaseAssets() {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/releases/tags/${encodeURIComponent(TAG)}`,
    { headers: { Authorization: `token ${TOKEN}`, Accept: "application/vnd.github+json" } }
  );
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.assets || [];
}

function findAsset(assets, name) {
  return assets.find((a) => a.name === name);
}

async function fetchSig(url) {
  if (!url) return "";
  const res = await fetch(url);
  if (!res.ok) return "";
  return (await res.text()).trim();
}

// Mapping plateforme Tauri -> { bin, sig } attendus.
// Les noms d'artefacts correspondent à la sortie de tauri-action (Tauri v2)
// avec productName "Pilot".
const PLATFORMS = [
  { key: "windows-x86_64", bin: `Pilot_${VERSION}_x64-setup.exe`, sig: `Pilot_${VERSION}_x64-setup.exe.sig` },
  { key: "darwin-aarch64", bin: `Pilot_${VERSION}_aarch64.dmg`, sig: `Pilot_${VERSION}_aarch64.dmg.sig` },
  { key: "darwin-x86_64", bin: `Pilot_${VERSION}_x64.dmg`, sig: `Pilot_${VERSION}_x64.dmg.sig` },
  { key: "linux-x86_64", bin: `Pilot_${VERSION}_amd64.AppImage`, sig: `Pilot_${VERSION}_amd64.AppImage.sig` },
];

(async () => {
  const assets = await getReleaseAssets();
  const platforms = {};

  for (const p of PLATFORMS) {
    const binAsset = findAsset(assets, p.bin);
    const sigAsset = findAsset(assets, p.sig);
    if (!binAsset) {
      console.warn(`⚠ Binaire manquant: ${p.bin} (plateforme ${p.key} ignorée)`);
      continue;
    }
    const signature = await fetchSig(sigAsset?.browser_download_url || "");
    if (!signature) {
      console.warn(`⚠ Signature manquante: ${p.sig} (plateforme ${p.key} ignorée)`);
      continue;
    }
    platforms[p.key] = { signature, url: binAsset.browser_download_url };
    console.log(`✓ ${p.key} -> ${p.bin}`);
  }

  if (Object.keys(platforms).length === 0) {
    console.error("Aucune plateforme valide trouvée. Abandon.");
    process.exit(2);
  }

  const out = {
    version: VERSION,
    notes: `Pilot ${VERSION}`,
    pub_date: new Date().toISOString(),
    platforms,
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`✓ ${OUT} généré (${Object.keys(platforms).length} plateforme(s))`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});