// agent-partial-text.js — CONSERVER le texte qu'un agent avait DEJA ECRIT quand
// il meurt ou plante.
//
// Defaut constate (relecture independante du 2026-10-23) : a la mort d'un agent
// (process_exit / process_error / extension_error), tout ce qu'il avait deja
// produit etait JETE — `failAgentTurn` remettait `ctx.streamingTextByAgent[agentId]`
// a zero sans jamais le lire, et cote Assistant `loop.lastText` etait remis a
// zero sans etre restitue. Une mission perdue ne laissait donc aucun texte
// exploitable, alors que l'agent avait peut-etre deja ecrit la moitie du travail.
//
// Ce module porte la partie PURE de la restitution (aucune I/O, aucun DOM) :
//   - `normalizePartialText` : texte utilisable (bornage, mention de troncature) ;
//   - `extractDelegationResultText` : lecture de la reponse de la recuperation
//     DEJA existante (`get_delegation_result` cote Rust — aucun doublon) ;
//   - `buildPartialTextDeathNotice` : la phrase rendue a l'assistant, qui dit
//     TOUJOURS la verite — le texte produit, ou explicitement « aucun texte
//     recupere ». Jamais de silence, jamais de texte invente.
//
// Le texte lui-meme n'est PAS ecrit dans un second journal : il rejoint la trace
// d'arret qui existe deja (`<projet>/.pilot/agent-stops.log`, champ `text=`,
// mecanique de `agent-stop-trace.js`).

/** Longueur maximale du texte restitue dans le message rendu a l'assistant. */
export const PARTIAL_TEXT_MAX_CHARS = 4000;

/** Longueur maximale du texte ecrit dans le champ `text=` du journal des arrets. */
export const PARTIAL_TEXT_TRACE_MAX_CHARS = 4000;

/** Emplacement (relatif au projet) du journal des arrets — jamais un second journal. */
export const PARTIAL_TEXT_LOG_HINT = ".pilot/agent-stops.log";

/**
 * Origine du texte restitue (dite a l'assistant, jamais devinee).
 * @type {Readonly<Record<string, string>>}
 */
export const PARTIAL_TEXT_SOURCE_LABELS = Object.freeze({
  memory: "memoire de la session",
  session: "session de l'agent conservee sur le disque",
  none: "aucune source",
});

/**
 * Rend un texte partiel utilisable : retire les espaces superflus, borne la
 * longueur et DIT la troncature (aucun texte n'est coupe en silence).
 *
 * @param {unknown} value - texte brut (peut etre null/undefined/non-chaine)
 * @param {number} [maxChars=PARTIAL_TEXT_MAX_CHARS]
 * @returns {string} "" quand il n'y a vraiment rien d'exploitable
 */
export function normalizePartialText(value, maxChars = PARTIAL_TEXT_MAX_CHARS) {
  if (value === undefined || value === null) return "";
  const raw = typeof value === "string" ? value : String(value);
  const text = raw.replace(/\r\n?/g, "\n").trim();
  if (!text) return "";
  const max = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : PARTIAL_TEXT_MAX_CHARS;
  if (text.length <= max) return text;
  const suffix = `\n[... texte tronque : ${text.length} caracteres au total, les derniers sont omis ...]`;
  const kept = text.slice(0, Math.max(0, max - suffix.length)).trimEnd();
  return kept + suffix;
}

/**
 * Extrait le texte utile de la reponse de `get_delegation_result`
 * (recuperation DEJA existante, aucune duplication de mecanisme).
 *
 * Formes acceptees :
 *  - `{ result: { role, text } }` (forme standard) ;
 *  - `{ result: "texte" }` (defensif) ;
 *  - `{ text }` (defensif, reponse deja aplatie).
 *
 * @param {unknown} response
 * @returns {string} "" si rien d'exploitable
 */
export function extractDelegationResultText(response) {
  if (!response || typeof response !== "object") {
    return typeof response === "string" ? normalizePartialText(response) : "";
  }
  const r = /** @type {Record<string, unknown>} */ (response);
  const result = r.result;
  if (typeof result === "string") return normalizePartialText(result);
  if (result && typeof result === "object") {
    const text = /** @type {Record<string, unknown>} */ (result).text;
    if (typeof text === "string") return normalizePartialText(text);
  }
  if (typeof r.text === "string") return normalizePartialText(r.text);
  return "";
}

/**
 * Phrase de restitution du texte d'un agent mort, ajoutee au message d'echec.
 *
 * Deux cas, tous deux EXPLICITES :
 *  - du texte a ete produit → il est donne, avec sa source et le fait que la
 *    mission n'est PAS terminee (et qu'elle n'est pas relancee) ;
 *  - rien n'a ete produit → « aucun texte recupere » est ecrit, avec la raison
 *    (memoire vide et session introuvable). Jamais un silence.
 *
 * @param {object} [input]
 * @param {string} [input.text] - texte deja ecrit par l'agent ("" si rien)
 * @param {string} [input.source] - "memory" | "session" | "none"
 * @param {number} [input.maxChars] - borne du texte restitue
 * @returns {string} bloc multi-lignes, jamais vide
 */
export function buildPartialTextDeathNotice({ text = "", source = "none", maxChars } = {}) {
  const kept = normalizePartialText(text, maxChars);
  if (!kept) {
    return (
      "Aucun texte recupere : l'agent s'est arrete avant d'ecrire quoi que ce soit " +
      "(memoire de la session vide, aucune session exploitable sur le disque). " +
      "La mission n'est PAS terminee et n'est pas relancee automatiquement."
    );
  }
  const where = PARTIAL_TEXT_SOURCE_LABELS[source] || PARTIAL_TEXT_SOURCE_LABELS.none;
  return (
    `Ce que l'agent avait deja ecrit avant son arret (lu dans la ${where}) — ` +
    "la mission n'est PAS terminee et n'est pas relancee automatiquement :\n" +
    `"""\n${kept}\n"""\n` +
    `Ce texte est conserve dans le journal des arrets d'agent (${PARTIAL_TEXT_LOG_HINT}).`
  );
}

/**
 * Compte rendu de la mort d'un agent, tel qu'il est rendu a l'assistant / au bus.
 * Le fait (interruption, mission non terminee, aucune relance) est dit, puis le
 * texte deja ecrit — ou la mention explicite « aucun texte recupere ».
 *
 * @param {object} [input]
 * @param {string} [input.text] - texte deja ecrit ("" si rien)
 * @param {string} [input.source] - "memory" | "session" | "none"
 * @returns {string}
 */
export function buildAgentDeathReport({ text = "", source = "none" } = {}) {
  return (
    "L'agent a ete interrompu avant la fin de sa tache (elle n'est PAS terminee et " +
    "n'est pas relancee automatiquement). " +
    buildPartialTextDeathNotice({ text, source: normalizePartialText(text) ? source : "none" })
  );
}
