// vocal-discussion-turns.js — LE FILTRE DES TOURS DE PAROLE de l'aperçu de la
// colonne de gauche de l'écran Vocal (SOURCE UNIQUE, pure : aucun DOM, aucune
// horloge, aucun accès Tauri).
//
// Pourquoi ce module : l'aperçu de la colonne de gauche ne montre QUE ce qui a
// été DIT — la demande du propriétaire (transcrite) et la réponse de
// l'assistant. Il ne montre rien d'autre : ni réflexion interne, ni appel
// d'outil, ni résultat d'outil, ni message système, ni trace, ni diff de code,
// ni journal. Ces familles circulent pourtant dans la conversation (le bus
// d'agents et le chat les posent), donc la décision « ceci est une parole, ceci
// n'en est pas une » doit être écrite UNE fois, et testée sur elle-même.
//
// Ce module ne lit rien et n'écrit rien : `super-agent.js` lui passe les
// messages qu'il a lus, il rend les seuls tours de parole. La coupe au budget
// de lignes reste dans `vocal-sides.js` (`vocalDiscussionView`).

/**
 * Le rôle du PROPRIÉTAIRE (celui qui parle à l'assistant). C'est la valeur
 * historique du chat (`.agent-message-user`) : on ne la change pas.
 */
export const VOCAL_TURN_OWNER = "user";

/** Le rôle de l'ASSISTANT (celui qui répond). */
export const VOCAL_TURN_ASSISTANT = "assistant";

/** Les deux seuls rôles qui ont le droit de paraître dans l'aperçu. */
export const VOCAL_SPEECH_ROLES = Object.freeze([VOCAL_TURN_OWNER, VOCAL_TURN_ASSISTANT]);

/**
 * Les familles qui ne sont JAMAIS une parole. Elles sont nommées ici, au même
 * endroit que la règle, pour qu'un test puisse les passer une par une et
 * vérifier qu'aucune ne paraît.
 */
export const VOCAL_SILENT_KINDS = Object.freeze([
  "thinking",
  "reasoning",
  "reflexion",
  "reaction",
  "tool",
  "tool-call",
  "tool-call-request",
  "tool-result",
  "tool_use",
  "tool_result",
  "system",
  "receipt",
  "trace",
  "log",
  "journal",
  "diff",
  "patch",
  "meta",
]);

/**
 * Les familles qui SONT une parole. Un message qui porte explicitement une
 * autre famille est écarté, même si son rôle ressemble aux deux nôtres : c'est
 * la seconde barrière (la première étant la lecture elle-même).
 */
export const VOCAL_SPEECH_KINDS = Object.freeze(["message", "text", "speech", "bubble", "reply"]);

/** Les écritures tolérées du rôle du propriétaire (alias historiques). */
const ALIAS_OWNER = Object.freeze(["user", "owner", "proprietaire", "propriétaire", "utilisateur"]);

/** Les écritures tolérées du rôle de l'assistant. */
const ALIAS_ASSISTANT = Object.freeze(["assistant", "agent", "pilot"]);

/**
 * Rend le rôle normalisé d'un message : `user`, `assistant`, ou `""` quand ce
 * n'est pas un des deux rôles de la conversation parlée.
 *
 * @param {unknown} role rôle brut (chaîne attendue)
 * @returns {string} `"user"`, `"assistant"` ou `""`
 */
export function normalizeVocalTurnRole(role) {
  if (typeof role !== "string") return "";
  const brut = role.trim().toLowerCase();
  if (!brut) return "";
  if (ALIAS_OWNER.includes(brut)) return VOCAL_TURN_OWNER;
  if (ALIAS_ASSISTANT.includes(brut)) return VOCAL_TURN_ASSISTANT;
  return "";
}

/**
 * Vrai si ce message est un TOUR DE PAROLE affichable dans l'aperçu.
 *
 * Trois conditions, dans cet ordre :
 *   1. c'est un objet, et son rôle est celui du propriétaire ou de l'assistant ;
 *   2. s'il porte une famille (`kind`), elle est une famille de parole — une
 *      réflexion ou un résultat d'outil glissé dans un message qui « ressemble »
 *      à une réponse est donc écarté ;
 *   3. il porte un texte non vide (un message vide n'est pas une parole : il
 *      ferait un trou dans la colonne).
 *
 * @param {{role?:unknown, kind?:unknown, text?:unknown}} message message lu
 * @returns {boolean} vrai si le message doit paraître
 */
export function isVocalSpeechTurn(message) {
  if (!message || typeof message !== "object") return false;
  if (!normalizeVocalTurnRole(message.role)) return false;
  const kind = message.kind;
  if (kind !== undefined && kind !== null && kind !== "") {
    if (typeof kind !== "string") return false;
    const famille = kind.trim().toLowerCase();
    if (!VOCAL_SPEECH_KINDS.includes(famille)) return false;
  }
  return typeof message.text === "string" && message.text.trim() !== "";
}

/**
 * Les seuls tours de parole d'une liste lue dans la conversation, dans l'ordre
 * où ils ont été dits (du plus ancien au plus récent).
 *
 * @param {Array<{role?:unknown, kind?:unknown, text?:unknown}>} messages
 * @returns {Array<{role:string, text:string}>} les tours de parole, filtrés
 */
export function vocalSpeechTurns(messages) {
  const lus = Array.isArray(messages) ? messages : [];
  const tours = [];
  for (const message of lus) {
    if (!isVocalSpeechTurn(message)) continue;
    tours.push({
      role: normalizeVocalTurnRole(message.role),
      text: String(message.text),
    });
  }
  return tours;
}
