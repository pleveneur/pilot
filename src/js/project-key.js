// project-key.js — IDENTITÉ DE PROJET : une seule façon de nommer un dossier.
//
// Défaut corrigé (D3 du rapport `rapport-file-attente-pertes-doublons.md`) : la
// clé de projet était comparée en CHAÎNE BRUTE à plusieurs endroits (file de
// missions de l'assistant, file de délégations, verrou de run du bus, file
// d'exclusivité, réservations de fichiers), alors qu'un autre module normalisait
// déjà le chemin. Deux écritures du MÊME dossier (« G:\IA_PL\pilot » et
// « g:/ia_pl/pilot/ », par exemple) désignaient donc deux projets distincts :
// une file devenait invisible (jamais relue) ou n'était jamais rejouée.
//
// Ce module est la SOURCE UNIQUE de cette identité. Il est PUR (aucune I/O) et
// ne produit JAMAIS de chemin réel : seulement une clé de comparaison. Les
// chemins réels transmis au backend (Rust, processus d'agents) ne passent pas
// par ici — une clé n'est donc jamais utilisée comme chemin.
//
// Convention de normalisation (celle qui existait déjà dans
// `super-agent-context.js`, désormais implémentée ICI seulement) :
//   - séparateurs uniformisés en '/' (barre oblique inverse acceptée) ;
//   - barres obliques répétées réduites, barre finale retirée ;
//   - préfixes relatifs « ./ » retirés ;
//   - casse ignorée (minuscules) ;
//   - espaces de bord retirés.
// Les valeurs sentinelles de l'application restent distinctes : « » (espace
// assistant hors projet) et « . » (projet actif implicite) ne se confondent pas
// avec un chemin réel.

/**
 * Normalise un chemin de projet pour comparer deux écritures du même chemin
 * (séparateurs Windows/Unix, barres répétées ou finales, préfixe relatif,
 * casse). Ne renvoie jamais un chemin utilisable pour une I/O : c'est une CLÉ.
 * @param {string} path
 * @returns {string}
 */
export function normalizeProjectPath(path) {
  return String(path == null ? "" : path)
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/\/+$/, "")
    .replace(/^(?:\.\/)+/, "")
    .toLowerCase();
}

/**
 * Clé canonique d'un projet (identité utilisée par les files, le verrou de run
 * et les réservations).
 * @param {string} project
 * @returns {string}
 */
export function projectKey(project) {
  return normalizeProjectPath(project);
}

/**
 * Deux écritures désignent-elles le MÊME projet ?
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function sameProject(a, b) {
  return projectKey(a) === projectKey(b);
}

/**
 * Projet porté par une clé composite « projet\u{1f}agent » (ou « projet » seul).
 * @param {string} key
 * @returns {string}
 */
export function scopedProjectOfKey(key) {
  const k = String(key == null ? "" : key);
  const i = k.indexOf("\u{1f}");
  return i < 0 ? k : k.slice(0, i);
}

/**
 * Une clé composite « projet\u{1f}agent » appartient-elle au projet donné,
 * quelle que soit l'écriture de son chemin ?
 * @param {string} key
 * @param {string} project
 * @returns {boolean}
 */
export function queueKeyMatchesProject(key, project) {
  return sameProject(scopedProjectOfKey(key), project);
}

/**
 * Clé EXISTANTE d'un objet indexé par projet qui désigne le projet donné
 * (comparaison normalisée : une entrée écrite avec une autre écriture du même
 * chemin est retrouvée). `null` si aucune n'existe.
 * @param {object} record
 * @param {string} project
 * @returns {string|null}
 */
export function findProjectScopedKey(record, project) {
  if (!record || typeof record !== "object") return null;
  const canonical = projectKey(project);
  if (Object.prototype.hasOwnProperty.call(record, canonical)) return canonical;
  for (const key of Object.keys(record)) {
    if (sameProject(key, canonical)) return key;
  }
  return null;
}

/**
 * Clé à utiliser pour ÉCRIRE dans un objet indexé par projet : la clé existante
 * du projet s'il y en a une (quelle que soit son écriture), sinon la clé
 * canonique. Deux écritures du même dossier ne créent donc jamais deux entrées.
 * @param {object} record
 * @param {string} project
 * @returns {string}
 */
export function projectScopedKey(record, project) {
  return findProjectScopedKey(record, project) || projectKey(project);
}

/**
 * Supprime TOUTES les entrées d'un objet indexé par projet qui désignent le
 * projet donné (toutes écritures confondues).
 * @param {object} record
 * @param {string} project
 * @returns {number} nombre d'entrées supprimées
 */
export function deleteProjectScoped(record, project) {
  if (!record || typeof record !== "object") return 0;
  let removed = 0;
  for (const key of Object.keys(record)) {
    if (sameProject(key, project)) {
      delete record[key];
      removed += 1;
    }
  }
  return removed;
}
