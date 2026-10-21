// super-agent-badges.js — Snapshot des badges projet des bulles de l'Assistant.
//
// Chantier « badge projet par bulle » : quand l'utilisateur envoie une demande
// dans l'onglet Assistant, on capture AU MOMENT DE L'ENVOI la liste des projets
// REELLEMENT cites dans le texte. Aucun repli sur le projet ouvert a l'ecran :
// sans projet cite, aucune etiquette (un nom faux fait croire a un travail sur
// le mauvais projet, pire que pas de nom). Les noms suivent l'ordre
// d'apparition dans le texte, sans doublon. La bulle de demande ET la bulle de
// reponse portent ces badges (figes pour toujours : aucun rafraichissement
// retrospectif).
//
// Chantier #15 : la bulle de RÉPONSE est en plus étendue avec les projets
// nommés dans le texte de la réponse de l'assistant (extendBadgesWithText),
// pour refléter les projets réellement discutés même si la demande n'en nommait
// aucun. Les badges de la demande restent en tête ; ceux détectés dans la
// réponse s'ajoutent ensuite, dédupliqués.
//
// Détection SANS IA : comparaison pure du texte à la liste des projets
// connus/ouverts côté UI. Correspondance insensible à la casse sur
//   - le nom affiché du projet (ex: « PLh »),
//   - la fin du chemin du projet (2-3 derniers segments, ex: « ia_pl/plh »).
// Un match exige des FRONTIÈRES DE MOTS (un texte qui parle de « pilotage »
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
 * Position de la PREMIERE occurrence de `needle` dans `haystack` respectant les
 * frontieres de mots : le caractere precedent et le caractere suivant ne
 * doivent pas etre des caracteres de mot. Insensible a la casse (deux chaines
 * deja en minuscules). Sert aussi a ordonner les etiquettes dans l'ordre
 * d'apparition dans le texte.
 * @param {string} haystack - texte normalise (minuscules).
 * @param {string} needle - motif (minuscule, deja trimme).
 * @returns {number} index de la premiere occurrence valide, ou -1.
 */
function firstWholeWordIndex(haystack, needle) {
  if (!haystack || !needle) return -1;
  let idx = haystack.indexOf(needle);
  while (idx >= 0) {
    const before = idx > 0 ? haystack[idx - 1] : "";
    const after = idx + needle.length < haystack.length ? haystack[idx + needle.length] : "";
    if (!isWordChar(before) && !isWordChar(after)) return idx;
    idx = haystack.indexOf(needle, idx + 1);
  }
  return -1;
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
  // Un `name` en base PEUT être le chemin complet (projet suivi non ouvert) :
  // ne jamais afficher un chemin comme badge, on retombe sur le dernier segment.
  if (name && /[\\/]/.test(name)) return pathTailName(name);
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
 * @returns {string[]} noms affichables des projets matches, dans l'ORDRE
 *   d'apparition dans le texte, dedupliques (casse differente = un seul nom).
 */
export function findNamedProjects(text, projects) {
  const hay = normalizeSeparators(text).toLowerCase();
  if (!hay) return [];
  const list = Array.isArray(projects) ? projects : [];
  const seen = new Set();
  // matches = { nom, index } : l'index est la premiere apparition dans le texte
  // (tous candidats du projet confondus). Le tri final donne l'ordre du texte.
  const matches = [];
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
    // Le DERNIER SEGMENT du chemin est un candidat à part entière : un projet
    // suivi mais non ouvert peut n'être cité que par son nom court (« PLh »),
    // alors que son `name` en base est le chemin complet. Les deux séparateurs
    // (`\` et `/`) sont déjà normalisés par pathTailName.
    const tail = pathTailName(path).toLowerCase();
    if (tail) candidates.push(tail);
    for (const suffix of pathSearchSuffixes(path)) {
      candidates.push(suffix.toLowerCase());
    }
    let bestIndex = -1;
    for (const candidate of candidates) {
      const idx = firstWholeWordIndex(hay, candidate);
      if (idx < 0) continue;
      if (bestIndex < 0 || idx < bestIndex) bestIndex = idx;
    }
    if (bestIndex >= 0) {
      seen.add(display.toLowerCase());
      matches.push({ name: display, index: bestIndex });
    }
  }
  // Ordre d'apparition dans le texte (tri stable : a index egal, ordre de liste).
  matches.sort((a, b) => a.index - b.index);
  return matches.map((m) => m.name);
}

/**
 * Capture (pur, testable) des badges projet pour un envoi : UNIQUEMENT les
 * projets reellement cites dans le texte, dans l'ordre d'apparition, sans
 * doublon. Aucun projet cite → liste VIDE (aucune etiquette).
 *
 * IMPORTANT (defaut corrige) : le projet ouvert a l'ecran n'est JAMAIS ajoute
 * par defaut. Le parametre `_activeProjectName` est conserve pour la
 * compatibilite des appels positionnels mais il est IGNORE : l'etiquette ne
 * doit refleter que la discussion, pas ce qui est ouvert dans Pilot.
 * Fail-open : texte vide ou projets invalides → liste vide, jamais d'exception.
 *
 * @param {string} text - texte de la demande.
 * @param {string|null} _activeProjectName - IGNORE (compatibilite d'appel).
 * @param {Array<{path?:string, name?:string}>} projects - projets connus/ouverts.
 * @returns {string[]} noms a afficher en badges (ordre d'apparition).
 */
export function captureProjectBadgeNames(text, _activeProjectName, projects) {
  return findNamedProjects(text, projects);
}

/**
 * Étend une liste de badges existants avec les projets nommés dans un texte
 * (pur, testable). Utilisé pour la bulle de RÉPONSE (chantier #15) : on part
 * des badges de la demande (projets réellement cités) et on y ajoute les
 * projets évoqués dans le texte de la réponse de l'assistant (voir la
 * description complète sur la fonction ci-dessous).
 * Choix des badges d'une bulle de l'Assistant (pur, testable) — PRIORITÉ, et
 * JAMAIS d'invention de nom :
 *   1. `explicitBadges` : fournis par l'appelant qui connaît le projet de
 *      l'échange (ex: relais d'une question → projet de CET agent) ;
 *   2. `turnBadges` : snapshot figé du tour en cours (demande de l'utilisateur
 *      ou compte rendu injecté qui a déclenché la réponse) ;
 *   3. sinon liste VIDE : l'information est inconnue, la bulle n'affiche AUCUN
 *      badge. On ne retombe JAMAIS sur le projet simplement sélectionné à
 *      l'écran : une bulle parlant d'un autre projet afficherait alors un nom
 *      FAUX (défaut corrigé — un nom faux fait croire à un travail sur le
 *      mauvais projet, pire que pas de nom).
 * Fail-open : arguments invalides → liste vide.
 *
 * @param {string[]|null} explicitBadges - badges connus de l'appelant.
 * @param {string[]|null} turnBadges - snapshot du tour en cours.
 * @returns {string[]}
 */
export function resolveBubbleBadgeNames(explicitBadges, turnBadges) {
  if (Array.isArray(explicitBadges) && explicitBadges.length) return explicitBadges;
  if (Array.isArray(turnBadges) && turnBadges.length) return turnBadges;
  return [];
}

/**
 * Etend une liste de badges existants avec les projets nommes dans un texte
 * (pur, testable). Utilise pour la bulle de REPONSE (chantier #15) : on part
 * des badges de la demande (projets cites) et on y ajoute les projets evoques
 * dans le texte de la reponse de l'assistant.
 * Regle : on ne retire JAMAIS un nom de base (il est correct : le texte de la
 * demande le citait) et on n'ajoute que des projets reellement cites dans le
 * texte scanne. Les badges de base restent en tete (ordre preserve) ; les
 * nouveaux suivent dans l'ordre d'apparition dans le texte. Dedupliques
 * (insensible a la casse). Fail-open : base/text/projets invalides → jamais
 * d'exception, jamais de doublon.
 *
 * @param {string[]} baseBadges - badges deja captures (ex: snapshot de la demande).
 * @param {string} text - texte supplementaire a scanner (ex: reponse de l'assistant).
 * @param {Array<{path?:string, name?:string}>} projects - projets connus/ouverts.
 * @returns {string[]} badges etendus (base en tete, dedupliques).
 */
export function extendBadgesWithText(baseBadges, text, projects) {
  const out = [];
  const seen = new Set();
  const push = (name) => {
    const key = String(name || "").trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(String(name).trim());
  };
  const base = Array.isArray(baseBadges) ? baseBadges : [];
  for (const b of base) push(b);
  // Texte vide/non string : matching sauté (base seule).
  if (typeof text === "string" && text.trim()) {
    for (const name of findNamedProjects(text, projects)) push(name);
  }
  return out;
}