// detect-macos-gap.js — LA SEULE AUTORISATION de livraison sans macOS.
//
// Décision du propriétaire (2026-11-15) : « Contourne sans macOS. » Une
// publication peut donc partir SANS les installateurs macOS, mais jamais en
// silence : cette étape du workflow constate l'absence, l'ANNONCE (journal du
// run + phrase dans la release), et n'accorde l'autorisation
// (`ALLOW_INCOMPLETE_RELEASE=1`) que si le SEUL trou est macOS.
//
// Rôle exact : lire les fichiers réellement déposés sur la Release et écrire
// `allow_incomplete=1` (ou rien) dans `$GITHUB_OUTPUT`. C'est cette valeur, et
// elle seule, que le job `latest-json` transmet à `gen-latest-json.js`. Sans
// elle, `gen-latest-json.js` REFUSE une livraison incomplète : le refus par
// défaut est intact.
//
// Aucune décision n'est prise ici : la règle est PURE et vit dans
// `scripts/release-gates.js` (`evaluateMacosGap`), testée par
// `scripts/publication-sans-macos.test.js`.
//
// Usage :
//   node scripts/detect-macos-gap.js <tag> <OWNER/REPO>
//
// Nécessite GITHUB_TOKEN (permissions « contents: read »).

import fs from "fs";

import { platformFromBinaryName } from "./latest-json-platforms.js";
import { evaluateMacosGap } from "./release-gates.js";

const TAG = process.argv[2];
const REPO = process.argv[3];
const TOKEN = process.env.GITHUB_TOKEN;

if (!TAG || !REPO || !TOKEN) {
  console.error("Usage: node detect-macos-gap.js <tag> <OWNER/REPO>");
  console.error("GITHUB_TOKEN must be set.");
  process.exit(1);
}

/** Trace visible dans le résumé du run (jamais un silence). */
function warn(reason) {
  console.warn(`↷ ${reason}`);
  if (process.env.GITHUB_ACTIONS) console.log(`::warning::${reason}`);
}

/** Écrit une sortie d'étape GitHub (no-op hors Actions). */
function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) {
    console.log(`${name}=${value}`);
    return;
  }
  // Forme à délimiteur : robuste aux valeurs vides.
  fs.appendFileSync(file, `${name}<<PILOT_OUT\n${value}\nPILOT_OUT\n`);
}

(async () => {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/releases/tags/${encodeURIComponent(TAG)}`,
    { headers: { Authorization: `token ${TOKEN}`, Accept: "application/vnd.github+json" } }
  );
  if (!res.ok) {
    // Sans Release lisible, rien ne peut être publié : on s'arrête bruyamment
    // plutôt que d'accorder une autorisation à l'aveugle.
    const reason = `Release ${TAG} illisible (HTTP ${res.status}) : aucune autorisation de livraison incomplète.`;
    console.error(`✗ ${reason}`);
    if (process.env.GITHUB_ACTIONS) console.log(`::error::${reason}`);
    process.exit(1);
  }
  const data = await res.json();
  const assetNames = (data.assets || []).map((a) => a.name);

  const verdict = evaluateMacosGap({ assetNames, mapper: platformFromBinaryName });

  console.log(`Fichiers de la release ${TAG} : ${assetNames.length}`);
  if (verdict.allowIncomplete) {
    // L'absence est dite AVANT toute publication, dans le journal du run :
    // la phrase exacte qui partira dans la release, et le motif de
    // l'autorisation (annotation `::warning::`, jamais un silence).
    console.log(verdict.notice);
    warn(verdict.reason);
    setOutput("allow_incomplete", "1");
  } else {
    console.log(`✓ ${verdict.reason}`);
    setOutput("allow_incomplete", "");
    if (verdict.macosMissing) {
      // Livraison cassée (aucun artefact d'updater d'aucune plateforme) :
      // ce n'est pas « macOS absent », `gen-latest-json.js` va refuser.
      console.log("Aucune autre plateforme livrée : la publication va être refusée.");
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
