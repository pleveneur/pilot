// release-gates.js — DÉCISIONS PURES DE LA CHAÎNE DE PUBLICATION.
//
// Une seule porte pour les trois refus que la chaîne de publication doit
// désormais opposer (audit `docs/rapports/RAPPORT-voies-de-contournement-livraison.md`,
// trou C7) :
//   1. un changelog lisible par l'utilisateur est OBLIGATOIRE
//      (`release-notes/vX.Y.Z.md`) — une note d'une ligne n'est pas un
//      changelog ;
//   2. une livraison INCOMPLÈTE (artefact signé manquant sur une cible du
//      chemin critique) est un ÉCHEC, plus un avertissement ;
//   3. republier un tag qui a déjà une Release est REFUSÉ, bruyamment.
//
// Chaque refus a une porte de sortie EXPLICITE, par variable d'environnement :
// une acceptation délibérée laisse une trace nommée dans le journal du run,
// jamais un silence.
//
// Module PUR (aucune I/O, aucun réseau) : `scripts/release-gates.test.js` le
// teste directement, et `scripts/gen-latest-json.js` / `scripts/create-release.js`
// ne décident plus rien eux-mêmes.

/** Accepter explicitement une Release existante (republier un tag). */
export const ALLOW_EXISTING_RELEASE_ENV = "ALLOW_EXISTING_RELEASE";
/** Accepter explicitement une publication SANS `release-notes/<tag>.md`. */
export const ALLOW_MISSING_NOTES_ENV = "ALLOW_MISSING_RELEASE_NOTES";
/** Accepter explicitement une livraison incomplète (cible sans artefact). */
export const ALLOW_INCOMPLETE_ENV = "ALLOW_INCOMPLETE_RELEASE";

/** Code de sortie d'un refus de publication (distinct d'une panne, qui sort 1). */
export const EXIT_RELEASE_REFUSED = 2;

/**
 * Cibles attendues du CHEMIN CRITIQUE : celles que le job `build` fabrique
 * (Windows + les deux macOS) et que `latest-json` doit trouver signées.
 *
 * Linux n'est PAS ici, et ce n'est pas un assouplissement : la topologie
 * (`scripts/release-workflow.test.js`) veut que la fabrication Linux soit un job
 * séparé, optionnel, qui ne retarde jamais `latest-json`. L'exiger ici ferait
 * échouer TOUTES les publications (Linux n'a pas fini quand `latest-json`
 * démarre). Sa présence reste ajoutée quand elle est disponible ; son absence
 * n'est pas un trou de livraison du chemin critique.
 */
export const CRITICAL_PLATFORMS = Object.freeze([
  "windows-x86_64",
  "darwin-aarch64",
  "darwin-x86_64",
]);

/** Cibles possibles mais NON critiques (fabrication séparée, donc optionnelle). */
export const OPTIONAL_PLATFORMS = Object.freeze(["linux-x86_64", "linux-aarch64"]);

/**
 * Chemin du changelog humain d'un tag : `release-notes/<version>.md`, la
 * version SANS le `v` initial (c'est la convention du dépôt, et c'est le
 * fichier committé avec le bump). SEULE définition de ce chemin : les deux
 * scripts de publication s'en servent, ils ne le recopient pas.
 * @param {string} tag ex. "v1.2.3" ("1.2.3" accepté)
 */
export function notesPathForTag(tag) {
  return `release-notes/${String(tag || "").replace(/^v/, "")}.md`;
}

/**
 * Vrai si le texte contient au moins une ligne LISIBLE par un utilisateur :
 * une ligne non vide qui n'est pas un simple titre Markdown. Un fichier réduit à
 * « # Pilot vX.Y.Z » n'est pas un changelog.
 * @param {string} texte
 */
export function hasReadableNotes(texte) {
  return String(texte || "")
    .split("\n")
    .map((l) => l.trim())
    .some((l) => l.length > 0 && !/^#{1,6}\s/.test(l) && !/^-{3,}$/.test(l));
}

/**
 * Décide si le changelog permet de publier. Pure.
 * @param {{tag: string, notes?: string|null, allowMissing?: boolean}} o
 * @returns {{ok: boolean, accepted: boolean, reason: string}}
 */
export function evaluateReleaseNotes({ tag, notes, allowMissing = false } = {}) {
  if (hasReadableNotes(notes)) {
    return { ok: true, accepted: false, reason: `changelog fourni pour ${tag}` };
  }
  const reason =
    `Aucun changelog lisible pour ${tag} : ` +
    `${notesPathForTag(tag)} est OBLIGATOIRE ` +
    `pour qu'une mise à jour soit compréhensible par l'utilisateur.`;
  if (allowMissing) {
    return {
      ok: true,
      accepted: true,
      reason: `${reason} Publication ACCEPTÉE explicitement (${ALLOW_MISSING_NOTES_ENV}).`,
    };
  }
  return { ok: false, accepted: false, reason };
}

/**
 * Décide si la livraison est complète sur le chemin critique. Pure.
 * @param {{platforms?: Record<string, unknown>, expected?: string[], allowIncomplete?: boolean}} o
 * @returns {{ok: boolean, accepted: boolean, missing: string[], reason: string}}
 */
export function evaluateDelivery({
  platforms = {},
  expected = CRITICAL_PLATFORMS,
  allowIncomplete = false,
} = {}) {
  const present = platforms || {};
  const missing = expected.filter((k) => !present[k]);
  if (missing.length === 0) {
    return { ok: true, accepted: false, missing: [], reason: `${expected.length} cible(s) du chemin critique présentes` };
  }
  const reason =
    `Livraison INCOMPLÈTE : ${missing.length}/${expected.length} cible(s) du chemin critique ` +
    `sans artefact signé (${missing.join(", ")}).`;
  if (allowIncomplete) {
    return {
      ok: true,
      accepted: true,
      missing,
      reason: `${reason} Publication ACCEPTÉE explicitement (${ALLOW_INCOMPLETE_ENV}).`,
    };
  }
  return { ok: false, accepted: false, missing, reason };
}

/**
 * Décide ce que le script de création de Release fait d'une réponse de l'API.
 * Pure. `already: true` = le tag a DÉJÀ une Release (republier / re-run).
 * @param {{tag: string, already: boolean, allowExisting?: boolean}} o
 * @returns {{ok: boolean, refused: boolean, accepted: boolean, reason: string}}
 */
export function evaluateExistingRelease({ tag, already, allowExisting = false } = {}) {
  if (!already) return { ok: true, refused: false, accepted: false, reason: `aucune Release pour ${tag}` };
  if (allowExisting) {
    return {
      ok: true,
      refused: false,
      accepted: true,
      reason: `Le tag ${tag} a déjà une Release : re-run ACCEPTÉ explicitement (${ALLOW_EXISTING_RELEASE_ENV}).`,
    };
  }
  return {
    ok: false,
    refused: true,
    accepted: false,
    reason:
      `Le tag ${tag} a DÉJÀ une Release GitHub. Republier un tag existant est refusé ` +
      "(la mise à jour automatique des utilisateurs installés se tromperait de version). " +
      `Bumpez la version et publiez un NOUVEAU numéro — pour un re-run volontaire, ` +
      `posez ${ALLOW_EXISTING_RELEASE_ENV}=1.`,
  };
}

/** Lit un drapeau d'acceptation dans un environnement (`"1"`, `"true"`, `"oui"`). */
export function flagEnabled(value) {
  return ["1", "true", "oui", "yes"].includes(String(value || "").trim().toLowerCase());
}
