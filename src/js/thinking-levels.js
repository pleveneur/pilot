// thinking-levels.js — socle pur du « niveau de réflexion » (T1).
//
// Module SANS dépendance et SANS import de l'environnement graphique
// (Tauri/DOM) : il doit rester testable seul sous Node (voir
// thinking-levels.test.js). Il est branché par `agents-bus.js` (T5 : application
// du niveau au lancement d'un agent) et par l'interface (T7).
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

/** Valeur d'un sélecteur signifiant « non réglé » (suivre les niveaux inférieurs). */
export const THINKING_UNSET_LABEL = "Non réglé (suit le moteur)";

/** Texte affiché quand la liste des niveaux n'a pas pu être obtenue. */
export const THINKING_UNAVAILABLE_MESSAGE =
  "Indisponible — lancez une session pour interroger le moteur.";

/**
 * Contenu d'un sélecteur de niveau de réflexion, à partir des niveaux réellement
 * supportés par le modèle. **PURE** : aucune liste n'est inventée, aucun accès IPC.
 *
 * @param {string[]} levels niveaux supportés (session vivante ou repli disque)
 * @param {object} [options]
 * @param {string} [options.current] valeur enregistrée ("" = non réglé)
 * @param {string} [options.provider] fournisseur, pour nommer l'indisponibilité
 * @param {string} [options.unsetLabel] libellé de l'entrée « non réglé »
 * @returns {{options: {value: string, label: string}[], disabled: boolean, message: string}}
 *   `disabled` + `message` : le sélecteur doit être désactivé et remplacé par le
 *   texte (état « ce modèle ne sait pas raisonner », §8 du plan). La valeur
 *   enregistrée reste TOUJOURS présente dans `options`, même en état désactivé :
 *   sans cela, enregistrer la configuration effacerait le réglage (le `.value`
 *   d'un sélecteur sans option vaut `""`).
 */
export function thinkingLevelOptions(levels, options = {}) {
  const unsetLabel = options.unsetLabel || THINKING_UNSET_LABEL;
  const provider = String(options.provider || "").trim();
  const current = String(options.current || "").trim();
  const supported = (Array.isArray(levels) ? levels : []).filter((lvl) =>
    THINKING_LEVELS.includes(lvl),
  );
  const base = [{ value: "", label: unsetLabel }];
  if (current && !supported.includes(current)) {
    base.push({ value: current, label: `${thinkingLabel(current)} (non supporté par ce modèle)` });
  }
  // Les niveaux supportés sont ajoutés sans doublon : la valeur enregistrée reste
  // sélectionnable dans tous les cas, y compris quand le sélecteur est désactivé.
  const seen = new Set(base.map((o) => o.value));
  const entries = [
    ...base,
    ...supported
      .filter((lvl) => !seen.has(lvl))
      .map((lvl) => ({ value: lvl, label: thinkingLabel(lvl) })),
  ];
  // Aucun niveau connu (registre illisible, modèle absent du disque) → état
  // indéterminé : le moteur seul pourra répondre.
  if (supported.length === 0) {
    return { options: entries, disabled: true, message: THINKING_UNAVAILABLE_MESSAGE };
  }
  // Modèle sans raisonnement : un menu à une seule entrée n'apprend rien.
  if (supported.length === 1 && supported[0] === "off") {
    const message = provider
      ? `Ce modèle ne propose pas de niveau de réflexion (fournisseur « ${provider} »).`
      : "Ce modèle ne propose pas de niveau de réflexion.";
    return { options: entries, disabled: true, message };
  }
  return { options: entries, disabled: false, message: "" };
}
