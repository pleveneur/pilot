// super-agent-badges.js — Snapshot des badges projet des bulles de l'Assistant.
//
// Chantier « badge projet par bulle » : quand l'utilisateur envoie une demande
// dans l'onglet 🧭 Assistant, on capture AU MOMENT DE L'ENVOI la liste des
// projets concernés = projet actif à cet instant + chaque projet explicitement
// nommé dans le texte. La bulle de demande ET la bulle de réponse portent ces
// badges (figés pour toujours : aucun rafraîchissement rétrospectif).
//
// Détection SANS IA : comparaison pure du texte de la demande à la liste des
// projets connus/ouverts côté UI. Correspondance insensible à la casse sur
//   - le nom affiché du projet (ex: « PLh »),
//   - la fin du chemin du projet (2-3 derniers segments, ex: « ia_pl/plh »).
// Un match exige des FRONTIÈRES DE MOTS (une demande qui parle de « pilotage »
// ne doit pas matcher un projet « pilot »).
// Module 100 % pur (aucun DOM, aucun invoke) → testable unitairement.

/** Normalise les séparateurs de chemin (\ → /) — Windows/macOS/Linux. */
function normalizeSeparators(p) {
  return String(p || "").replace(/\\/g, "/");
}

/** Test « caractère de mot » : lettre (ASCII + latin de base/accentué), chiffre
 * ou underscore. Utilisé pour les frontières de mots de la détection. Le texte
 * a été mis en minuscules avant appel. */
function isWordChar(ch) {
  if (!ch) return false;
  return /[a-z0-9_àáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿœß]/i.test(ch);
}

/**
 * Cherche une occurrence de `needle` dans `haystack` avec frontières de mots :
 * le caractère précédent et le caractère suivant ne doivent pas être des
 * caractères de mot. Insensible à la casse (deux chaînes déjà en minuscules).
 * @param {string} haystack - texte normalisé (minuscules).
 * @param {string} needle - motif (minuscule, déjà trimmé).
 * @returns {boolean}
 */
function containsWholeWord(haystack, needle) {
  if (!haystack || !needle) return false;
  let idx = haystack.indexOf(needle);
  while (idx >= 0) {
    const before = idx > 0 ? haystack[idx - 1] : "";
    const after = idx + needle.length < haystack.length ? haystack[idx + needle.length] : "";
    if (!isWordChar(before) && !isWordChar(after)) return true;
    idx = haystack.indexOf(needle, idx + 1);
  }
  return false;
}

/** Dernier segment non vide d'un chemin (séparateurs / ou \). */
export function pathTailName(path) {
  const segs = normalizeSeparators(path).split("/").filter(Boolean);
  return segs.length ? segs[segs.length - 1] : "";
}

/**
 * Suffixes de chemin exploitables pour la détection (2-3 derniers segments,
 * ex: « ia_pl/plh »). Un seul segment est couvert par le nom affiché.
 * @param {string} path - chemin normalisé (séparateurs /).
 * @returns {string[]}
 */
export function pathSearchSuffixes(path) {
  const segs = normalizeSeparators(path).split("/").filter(Boolean);
  const out = [];
  for (let k = Math.min(3, segs.length) ; k >= 2 ; k--) {
    out.push(segs.slice(-k).join("/"));
  }
  return out;
}

/** Nom affichable d'un projet candidat : name (si non vide) sinon fin du chemin. */
function candidateDisplayName(p) {
  if (!p || typeof p !== "object") return "";
  const name = typeof p.name === "string" ? p.name.trim() : "";
  return name || pathTailName(p.path) || "";
}

/**
 * Détermine les projets nommés dans un texte (pur, testable).
 * Compare le texte à la liste des projets connus/ouverts. Un projet matche si
 * son nom affiché OU une fin de son chemin apparaît dans le texte avec des
 * frontières de mots (insensible à la casse). Fail-open : text/projets
 * invalides → aucun match, jamais d'exception.
 *
 * @param {string} text - texte de la demande de l'utilisateur.
 * @param {Array<{path?:string, name?:string}>} projects - projets connus/ouverts.
 * @returns {string[]} noms affichables des projets matchés (ordre de la liste,
 *   dédupliqués, sans doublon avec la casse différente).
 */
export function findNamedProjects(text, projects) {
  const hay = normalizeSeparators(text).toLowerCase();
  if (!hay) return [];
  const list = Array.isArray(projects) ? projects : [];
  const seen = new Set();
  const out = [];
  for (const p of list) {
    if (!p || typeof p !== "object") continue;
    const display = candidateDisplayName(p);
    if (!display || seen.has(display.toLowerCase())) continue;
    const path = normalizeSeparators(p.path);
    const candidates = [];
    const nameCand = typeof p.name === "string" ? p.name.trim().toLowerCase() : "";
    if (nameCand || pathTailName(path)) {
      // Le nom affiché est par construction le plus court candidat.
      candidates.push(display.toLowerCase());
    }
    for (const suffix of pathSearchSuffixes(path)) {
      candidates.push(suffix.toLowerCase());
    }
    const matched = candidates.some((c) => containsWholeWord(hay, c));
    if (matched) {
      seen.add(display.toLowerCase());
      out.push(display);
    }
  }
  return out;
}

/**
 * Capture (pur, testable) des badges projet pour un envoi : projet actif à
 * cet instant + projets nommés détectés dans le texte, dédupliqués (le projet
 * actif reste en tête ; les autres suivent dans l'ordre de la liste).
 * Fail-open : texte vide → projet actif seul ; aucun projet → liste vide
 * (jamais bloquant, jamais d'exception).
 *
 * @param {string} text - texte de la demande.
 * @param {string|null} activeProjectName - nom du projet actif à l'envoi.
 * @param {Array<{path?:string, name?:string}>} projects - projets connus/ouverts.
 * @returns {string[]} noms à afficher en badges (ordre stable).
 */
export function captureProjectBadgeNames(text, activeProjectName, projects) {
  const out = [];
  const seen = new Set();
  const push = (name) => {
    const key = String(name || "").trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(String(name).trim());
  };
  push(activeProjectName);
  // Texte vide/non string : matching sauté (projet actif seul).
  if (typeof text === "string" && text.trim()) {
    for (const name of findNamedProjects(text, projects)) push(name);
  }
  return out;
}