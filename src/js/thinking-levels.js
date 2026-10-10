// thinking-levels.js — socle pur du « niveau de réflexion » (T1).
//
// Module SANS effet sur le comportement actuel : rien ne l'importe encore.
// Aucune dépendance, aucun import de l'environnement graphique (Tauri/DOM) :
// il doit rester testable seul sous Node (voir thinking-levels.test.js).
//
// Les niveaux sont ceux du moteur pi (`--thinking off|minimal|low|medium|high|
// xhigh|max`). Aucune liste n'est inventée : la liste réellement supportée est
// toujours fournie par l'appelant (session vivante ou repli disque).

/** Ordre croissant de réflexion. Les clés seules sont techniques (pas d'affichage). */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** Clé technique → libellé français affiché à l'utilisateur. */
export const THINKING_LEVEL_LABELS = {
  off: "Désactivé (réponse directe)",
  minimal: "Minimal",
  low: "Faible",
  medium: "Moyen (recommandé)",
  high: "Élevé",
  xhigh: "Très élevé",
  max: "Maximal",
};

/** Aide affichée en `title` au-dessus des sélecteurs de niveau. */
export const THINKING_LEVEL_HINT =
  "Plus le niveau est élevé, plus le modèle réfléchit avant de répondre : " +
  "réponses souvent meilleures, mais plus lentes et plus coûteuses.";

/** Libellé français d'une clé. Clé inconnue (ou absente) → texte neutre lisible. */
export function thinkingLabel(key) {
  if (typeof key === "string" && key in THINKING_LEVEL_LABELS) {
    return THINKING_LEVEL_LABELS[key];
  }
  return key ? String(key) : "Non réglé";
}

/** Rang d'une clé dans l'ordre de réflexion, ou -1 si inconnue. */
export function thinkingLevelRank(key) {
  return THINKING_LEVELS.indexOf(key);
}

/**
 * Niveaux supportés d'après une entrée de `models-store.json` (repli hors-ligne).
 * - entrée absente / non-objet → [] (on n'invente rien) ;
 * - `reasoning: false` → ["off"] ;
 * - `thinkingLevelMap` : clés de valeur non `null` ; `off` est retenu dès que la
 *   clé existe ou que le modèle n'est pas explicitement non-raisonnant ;
 * - pas de `thinkingLevelMap` exploitable → [].
 */
export function availableThinkingLevels(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
  if (entry.reasoning === false) return ["off"];
  const map = entry.thinkingLevelMap;
  if (!map || typeof map !== "object" || Array.isArray(map)) return [];
  // Ici `reasoning` n'est pas explicitement faux → `off` est toujours possible.
  return THINKING_LEVELS.filter(
    (key) => key === "off" || (map[key] !== null && map[key] !== undefined),
  );
}

/**
 * Ramène `requested` aux capacités du modèle : niveau supporté inchangé, sinon
 * le palier supporté immédiatement inférieur (jamais supérieur). Si aucun palier
 * inférieur n'existe, on rend le plus faible niveau supporté. Liste vide → null.
 */
export function clampThinkingLevel(requested, available) {
  const levels = Array.isArray(available)
    ? available.filter((lvl) => THINKING_LEVELS.includes(lvl))
    : [];
  if (levels.length === 0) return null;
  const wanted = thinkingLevelRank(requested);
  if (wanted < 0) return null;
  let best = null;
  for (const level of levels) {
    const rank = thinkingLevelRank(level);
    if (rank <= wanted && (best === null || rank > thinkingLevelRank(best))) best = level;
  }
  if (best !== null) return best;
  return levels.reduce((a, b) => (thinkingLevelRank(a) <= thinkingLevelRank(b) ? a : b));
}

/**
 * Choix selon l'ordre de priorité (du plus fort au plus faible) : première
 * valeur non vide. Aucune valeur → null (le moteur garde alors son propre défaut).
 */
export function pickThinkingLevel(candidates) {
  if (!Array.isArray(candidates)) return null;
  for (const value of candidates) {
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}
