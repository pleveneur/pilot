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
// S'y ajoute (décision du propriétaire du 2026-11-15, « Contourne sans macOS »)
// la PORTÉE de la porte 2 : l'absence des deux paquets macOS est la SEULE
// livraison incomplète que la chaîne peut autoriser, et elle n'est autorisée
// que par `ALLOW_INCOMPLETE_RELEASE`, posée par le workflow après constat
// (seul macOS manque) — jamais par défaut, jamais en silence : la release
// porte alors une phrase en français qui dit que macOS n'est pas servi.
// (`evaluateMacosGap`, `macosMissingNotice`.)
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
/** Accepter explicitement une publication SANS `release-notes/v<version>.md`. */
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
 * Cibles macOS du chemin critique. Elles sont les SEULES dont l'absence peut
 * être autorisée nommément (décision du propriétaire du 2026-11-15 :
 * « Contourne sans macOS »). Aucune autre cible n'est jamais couverte par cette
 * autorisation : un Windows manquant reste un ÉCHEC (cf. `evaluateDelivery`).
 */
export const MACOS_PLATFORMS = Object.freeze(["darwin-aarch64", "darwin-x86_64"]);

/** Nom lisible d'une cible macOS (jamais une clé technique dans un texte utilisateur). */
const MACOS_LABELS = Object.freeze({
  "darwin-aarch64": "Mac Apple Silicon",
  "darwin-x86_64": "Mac Intel",
});

/**
 * Chemin du changelog humain d'un tag : `release-notes/v<version>.md`, la
 * version PRÉCÉDÉE du `v` — exactement le nom de fichier employé par la
 * convention du dépôt (`AGENTS.md` : « Rédiger le changelog utilisateur
 * `release-notes/vX.Y.Z.md` »), donc le fichier réellement committé avec le
 * bump. SEULE définition de ce chemin : les deux scripts de publication s'en
 * servent, ils ne le recopient pas.
 *
 * Le `v` est AJOUTÉ s'il manque et n'est jamais doublé : `"v1.2.3"`, `"1.2.3"`
 * et `"V1.2.3"` désignent tous `release-notes/v1.2.3.md`. Exiger le chemin
 * sans `v` (défaut antérieur, incident de publication 0.6.12) rendait la porte
 * du changelog INFALSIFIABLEMENT rouge : elle refusait toutes les versions,
 * y compris celles dont le changelog existait, et bloquait la publication.
 * @param {string} tag ex. "v1.2.3" ("1.2.3" accepté)
 */
export function notesPathForTag(tag) {
  const version = String(tag || "").trim().replace(/^v/i, "");
  return `release-notes/v${version}.md`;
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
  allowIncompleteScope = null,
} = {}) {
  const present = platforms || {};
  const missing = expected.filter((k) => !present[k]);
  if (missing.length === 0) {
    return { ok: true, accepted: false, missing: [], blocking: [], reason: `${expected.length} cible(s) du chemin critique présentes` };
  }
  // PORTÉE de l'autorisation. Par défaut (aucune portée fournie), le
  // propriétaire autorise explicitement TOUTE la livraison incomplète — c'est
  // la sortie de secours historique, inchangée. Les appelants qui n'ont le
  // droit d'autoriser QUE l'absence de macOS passent `MACOS_PLATFORMS` : une
  // cible hors portée manquante reste alors un refus, MÊME si le drapeau est
  // posé. C'est ce qui empêche « macOS absent » de couvrir un Windows manquant.
  const scope = allowIncomplete
    ? Array.isArray(allowIncompleteScope)
      ? allowIncompleteScope
      : expected
    : [];
  const blocking = missing.filter((k) => !scope.includes(k));
  const reason =
    `Livraison INCOMPLÈTE : ${missing.length}/${expected.length} cible(s) du chemin critique ` +
    `sans artefact signé (${missing.join(", ")}).`;
  if (blocking.length > 0) {
    const horsPortee = scope.length
      ? ` Hors de la portée autorisée (${scope.join(", ")}) : ${blocking.join(", ")}.`
      : "";
    return { ok: false, accepted: false, missing, blocking, reason: `${reason}${horsPortee}` };
  }
  return {
    ok: true,
    accepted: true,
    missing,
    blocking: [],
    reason:
      `${reason} Publication ACCEPTÉE explicitement (${ALLOW_INCOMPLETE_ENV})` +
      ` pour la seule cible autorisée (${scope.join(", ")}).`,
  };
}

/**
 * Phrase d'annonce, en français, de l'absence de macOS dans la livraison.
 * `null` quand macOS est servi : aucune phrase n'est alors ajoutée.
 *
 * Elle dit UNIQUEMENT ce qui est vrai : les paquets macOS manquent, donc les
 * postes macOS ne reçoivent pas cette mise à jour. Elle ne promet rien sur les
 * autres plateformes (ni Windows ni Linux), qui sont de toute façon visibles
 * dans la liste des fichiers de la release.
 * @param {string[]} missing cibles absentes (`evaluateDelivery().missing`)
 * @returns {string|null}
 */
export function macosMissingNotice(missing = []) {
  const absents = MACOS_PLATFORMS.filter((k) => (missing || []).includes(k));
  if (absents.length === 0) return null;
  const quels = absents.map((k) => MACOS_LABELS[k] || k).join(" et ");
  return (
    "> ⚠️ **macOS n'est pas servi cette fois.** " +
    `Aucun paquet d'installation macOS (${quels}) n'accompagne cette version : ` +
    "les postes macOS ne recevront pas cette mise à jour et resteront sur leur " +
    "version actuelle. Les fichiers publiés ci-dessous restent, eux, " +
    "téléchargeables et fonctionnels."
  );
}

/**
 * Décide si le workflow peut accorder l'autorisation de livraison incomplète
 * POUR CETTE RELEASE, à partir des noms des fichiers réellement déposés.
 *
 * Règle (une seule) : l'autorisation n'est accordée que lorsque le SEUL trou
 * est macOS — c'est-à-dire quand un artefact d'updater d'une AUTRE plateforme
 * est présent. Sans cela, le trou n'est pas « macOS absent », c'est une
 * livraison cassée, et le refus par défaut doit jouer.
 *
 * Pure : reçoit les noms de fichiers, ne joint rien.
 * @param {{assetNames?: string[], mapper?: (name: string) => (string|null)}} o
 * @returns {{allowIncomplete: boolean, macosMissing: boolean, otherPresent: boolean, notice: string|null, reason: string}}
 */
export function evaluateMacosGap({ assetNames = [], mapper } = {}) {
  const map = typeof mapper === "function" ? mapper : null;
  const keys = new Set();
  for (const name of assetNames || []) {
    const key = map ? map(name) : null;
    if (key) keys.add(key);
  }
  const macosMissing = MACOS_PLATFORMS.every((k) => !keys.has(k));
  const otherPresent = [...keys].some((k) => !MACOS_PLATFORMS.includes(k));
  if (!macosMissing) {
    return {
      allowIncomplete: false,
      macosMissing: false,
      otherPresent,
      notice: null,
      reason: "macOS est présent dans les fichiers de cette release.",
    };
  }
  if (!otherPresent) {
    return {
      allowIncomplete: false,
      macosMissing: true,
      otherPresent: false,
      notice: macosMissingNotice([...MACOS_PLATFORMS]),
      reason:
        "Aucun artefact d'updater d'aucune plateforme : ce n'est pas une absence " +
        "de macOS mais une livraison cassée, l'autorisation n'est PAS accordée.",
    };
  }
  return {
    allowIncomplete: true,
    macosMissing: true,
    otherPresent: true,
    notice: macosMissingNotice([...MACOS_PLATFORMS]),
    reason:
      "Seul macOS manque : autorisation de livraison incomplète accordée " +
      `explicitement pour cette release (${ALLOW_INCOMPLETE_ENV}), et annoncée ` +
      "dans la release.",
  };
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
