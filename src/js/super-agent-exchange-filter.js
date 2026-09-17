// super-agent-exchange-filter.js — Filtre des échanges dignes d'être mémorisés
// par l'Assistant (module PUR, testable — modèle : `super-agent-reports.js`).
//
// À la fin d'un tour, le chat standard envoie à l'Assistant un résumé du dernier
// échange (voir `agent-pi.js`, agent_end) qui est consigné dans sa mémoire de
// suivi. Jusqu'ici, AUCUN filtre : un simple « bonjour » / « merci, au revoir »
// polluait la mémoire. Cette fonction décide si l'échange mérite d'être mémorisé.
//
// Seuils (volontairement prudents : on refuse le bruit évident, on garde tout
// échange porteur d'une demande et d'une réponse décrites) :
//   - MIN_TOTAL_CHARS = 60 : longueur minimale cumulée (demande + réponse,
//     espaces normalisés). En dessous, l'échange est trop court pour porter un
//     fait réutilisable.
//   - MIN_RESPONSE_CHARS = 20 : une réponse quasi vide (accusé sans contenu) ne
//     documente rien, même si la demande était longue.
//   - ACK_TOKENS : si TOUS les mots des deux parties sont protocolaires
//     (salutations, accusés de réception, remerciements, politesses), l'échange
//     est refusé quelle que soit sa longueur.
//
// Ce module ne connaît ni Tauri ni le DOM : il reçoit deux chaînes.
//
// Il porte aussi la garde des COMPTES RENDUS D'AGENTS (`shouldRememberAgentReport`),
// utilisée par les chemins de `super-agent.js` qui injectaient sans filtre :
//   - fin d'agent lancé en arrière-plan (invisible) ;
//   - points d'avancement et fins de run d'agents (`run_agents`).

import { RUN_PROGRESS_PREFIX } from "./run-agents-notify.js";

/** Longueur minimale cumulée (demande + réponse) pour mémoriser un échange. */
export const MIN_TOTAL_CHARS = 60;
/** Longueur minimale de la réponse (une réponse vide/elliptique ne dit rien). */
export const MIN_RESPONSE_CHARS = 20;

/** Mots protocolaires / politesses : s'ils suffisent à tout l'échange, on refuse. */
const ACK_TOKENS = new Set([
  // salutations / congés (fr + en)
  "bonjour", "bonsoir", "salut", "coucou", "hello", "hi", "hey", "bye",
  "revoir", "journee", "soiree", "bonne", "bientot", "a", "au",
  // accusés / remerciements
  "merci", "thanks", "thank", "you", "thx", "ok", "okay", "daccord", "accord",
  "oui", "non", "ouais", "bien", "parfait", "super", "nickel", "top", "cool",
  "de", "rien", "pas", "grave", "entendu", "compris", "recu", "noted",
  "please", "plait", "desole",
  // politesses / questions rituelles
  "et", "toi", "vous", "comment", "vas", "va", "allez", "que", "quoi",
  "tres", "aussi",
  "puis", "je", "peux", "tu", "faire", "pour", "aider", "besoin", "autre",
  "chose", "veux", "dis", "moi", "svp", "aujourd", "hui", "demain",
]);

/**
 * Décide si un échange (demande utilisateur + réponse agent) mérite d'être
 * mémorisé dans le suivi de l'Assistant.
 * @param {unknown} userPrompt - texte de la demande utilisateur du tour.
 * @param {unknown} assistantText - texte brut de la réponse de l'agent du tour.
 * @returns {boolean} true si l'échange doit être mémorisé.
 */
export function shouldRememberExchange(userPrompt, assistantText) {
  const demande = typeof userPrompt === "string" ? userPrompt.trim() : "";
  const reponse = typeof assistantText === "string" ? assistantText.trim() : "";
  // Échange vide ou tronqué : rien à mémoriser.
  if (!demande || !reponse) return false;
  // Réponse sans contenu réel (ou trop brève pour documenter quoi que ce soit).
  if (meaningfulLength(reponse) < MIN_RESPONSE_CHARS) return false;
  // Échange trop court au total.
  if (meaningfulLength(demande) + meaningfulLength(reponse) < MIN_TOTAL_CHARS) return false;
  // Échange purement protocolaire : refusé même s'il est long (ex: politesses).
  if (isPurelyProtocolary(demande + " " + reponse)) return false;
  return true;
}

/** Longueur minimale « utile » d'un compte rendu d'agent pour être mémorisé. */
export const MIN_REPORT_CHARS = 30;

/**
 * Comptes rendus GÉNÉRIQUES : ils annoncent une fin de tâche sans livrer de
 * résultat (agent sans texte final). Aucun fait réutilisable → non mémorisés.
 * Ancré en fin de chaîne : un texte qui AJOUTE un résultat (« … : 3 fichiers
 * modifiés ») ne correspond pas et reste mémorisé.
 */
const EMPTY_AGENT_REPORT_PATTERNS = [
  /^l['’]?agent a terminé (?:sa tâche|la tâche déléguée)(?: en arrière-plan)?\.?$/i,
];

/**
 * Décide si un COMPTE RENDU d'agent (résultat d'agent invisible, point
 * d'avancement ou fin de run d'agents) mérite d'être mémorisé dans le suivi de
 * l'Assistant. Réutilise la même prudence que `shouldRememberExchange` : on
 * refuse le bruit évident, on garde TOUT compte rendu porteur d'un résultat.
 * @param {unknown} text - compte rendu (déjà compilé) injecté à l'Assistant.
 * @returns {boolean} true si le compte rendu doit être mémorisé.
 */
export function shouldRememberAgentReport(text) {
  if (typeof text !== "string") return false;
  const raw = text.trim();
  if (!raw) return false;
  // Point d'avancement protocolaire (« [Info run_agents] … ») : c'est une
  // progression, pas un résultat (mise en file, démarrage, arrêt auto).
  if (raw.startsWith(RUN_PROGRESS_PREFIX)) return false;
  // Annonce générique de fin de tâche, sans résultat.
  if (EMPTY_AGENT_REPORT_PATTERNS.some((re) => re.test(raw))) return false;
  // Trop court pour porter un fait réutilisable (balisage ignoré).
  if (meaningfulLength(raw) < MIN_REPORT_CHARS) return false;
  // Purement protocolaire (politesses / accusés).
  if (isPurelyProtocolary(raw)) return false;
  return true;
}

/**
 * Décide si un compte rendu doit être REMIS à l'Assistant (donc consigné dans sa
 * mémoire de suivi : la remise EST la mémorisation). En cas de doute, on
 * CONSERVE (fail-open) : un drapeau absent ne bloque jamais la remise.
 * @param {unknown} memorable - verdict de `shouldRememberAgentReport` (ou
 *   `undefined` quand l'appelant ne filtre pas : comportement inchangé).
 * @param {{delegationPending?: boolean}} [ctx] - un feedback de délégation
 *   attend d'être remis : la remise est alors TOUJOURS faite, même pour un
 *   compte rendu sans valeur (le marqueur « [Tâche déléguée terminée] » d'une
 *   fin de tâche déléguée ne doit JAMAIS être perdu).
 * @returns {boolean} true si la remise doit avoir lieu.
 */
export function shouldDeliverAgentReport(memorable, ctx = {}) {
  if (memorable !== false) return true;
  return ctx.delegationPending === true;
}

/**
 * Longueur « utile » : espaces normalisés, en ignorant le balisage évident
 * (fences de code, puces, ponctuation) qui gonfle artificiellement le texte.
 * @param {string} text
 * @returns {number}
 */
function meaningfulLength(text) {
  return text.replace(/[`*_#>|~\-]+/g, " ").replace(/\s+/g, " ").trim().length;
}

/**
 * Vrai si le texte ne contient QUE des mots protocolaires (aucun mot porteur de
 * contenu). Un seul mot inconnu suffit à le considérer comme non protocolaire.
 * @param {string} text
 * @returns {boolean}
 */
function isPurelyProtocolary(text) {
  const tokens = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // accents retirés (comparaison robuste)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every((t) => ACK_TOKENS.has(t));
}
