// telegram-dialog.js — Telegram, étape 2, LOT 3 : l'Assistant « parle » sur
// Telegram.
//
// Objectif : ce que l'Assistant écrit dans sa conversation part AUSSI sur
// Telegram, REFORMULÉ EN UNE PHRASE SIMPLE (langage courant, aucun code, aucun
// nom de fichier, aucune liste technique, aucune commande). Seuls les messages
// UTILES sont transmis (réponse à une question du propriétaire, fin de mission /
// compte rendu, alerte, demande d'accord) ; les messages intermédiaires (étapes
// de travail, appels d'outils, bavardage technique) sont écartés.
//
// Déduplication : quand la communication Telegram du dialogue est ACTIVE, c'est
// l'Assistant qui parle — les avis BRUTS existants (fin de mission d'agent,
// anomalie) ne sont plus envoyés en plus (cf. `forwardToTelegram` dans
// desktop-notify.js, qui consulte `isTelegramDialogActive`). Quand elle est
// INACTIVE, les avis de l'étape 1 continuent exactement comme avant.
//
// Inertie totale : communication coupée OU Telegram non configuré (jeton ou
// identifiant de discussion vide) ⇒ RIEN n'est tenté (aucun accès réseau, aucune
// erreur visible, le jeton n'est jamais manipulé ici). La passerelle d'envoi
// existante (`telegram_notify`) est de toute façon inerte côté Rust tant que la
// passerelle n'est pas configurée.
//
// Le cœur est PUR (condensation en une phrase + filtrage) ; la passerelle a ses
// dépendances INJECTÉES : testable sans réseau, sans Tauri et sans horloge.

import { invoke } from "@tauri-apps/api/core";

/** Longueur maximale de la phrase envoyée à Telegram. */
export const TELEGRAM_DIALOG_MAX_CHARS = 200;

// ── Filtrage / classification ────────────────────────────────────────────────
// Signaux d'ALERTE (à transmettre en priorité).
const ALERT_RE =
  /(⚠️|❌|🚨|🔴|🛑|alerte|anomalie|erreur|échec|echec|échoué|echoue|bloqué|bloque|impossible|attention|danger|panne|injoignable|indisponible)/i;
// Demande d'accord / question au propriétaire.
const APPROVAL_RE =
  /(voulez-vous|souhaitez-vous|dois-je|confirmez|pouvez-vous|d'accord|validez|valider|choisissez|choisir|que dois|préférez|preferez)/i;
// Fin de mission / compte rendu.
const REPORT_RE =
  /(✅|🟢|\bdone\b|terminé|termine|fini|accompli|compte rendu|rapport|résumé|resume|synthèse|bilan|voici|mission|livré|livre|prêt|j'ai )/i;
// Message INTERMÉDIAIRE : narration d'étape (étapes de travail).
const INTERMEDIATE_RE =
  /^(je vais|je vais maintenant|i'?ll|i will|let me|laisse[- ]moi|je commence|j'?analyse|je regarde|je vérifie|je lance|je dois|maintenant|next|step|étape|etape|d'abord|first)\b/i;
// Bavardage technique court (accusés de réception sans contenu).
const SMALLTALK_RE =
  /^(ok|okay|d'accord|compris|bien reçu|bien recu|entendu|parfait|noté|note|merci|got it|understood|sure|c'est noté)\s*[.!…]*\s*$/i;

/**
 * Retire d'un texte tout ce qui est technique et illisible au téléphone : blocs
 * de code, code inline, liens, URL, chemins de fichiers, noms de fichiers,
 * commandes shell, marqueurs Markdown (titres, listes, citations, gras).
 * Fonction PURE.
 * @param {string} raw
 * @returns {string}
 */
export function stripTechnical(raw) {
  let t = String(raw ?? "");
  // Blocs de code (```…```) et code inline (`…`).
  t = t.replace(/```[\s\S]*?```/g, " ");
  t = t.replace(/`[^`]*`/g, " ");
  // Images et liens Markdown : on garde seulement le libellé.
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  // URL brutes.
  t = t.replace(/<?https?:\/\/\S+>?/gi, " ");
  // Chemins Windows (C:\…) et POSIX (/… ou ./… ou ../…).
  t = t.replace(/\b[A-Za-z]:\\[^\s,;:)]+/g, " ");
  t = t.replace(/(^|[\s(])(?:\.{0,2}\/|\/)[A-Za-z0-9._\-/]+/g, "$1");
  // Noms de fichiers avec une extension de code connue.
  t = t.replace(
    /\b[\w.\-]+\.(?:js|mjs|cjs|ts|tsx|jsx|rs|json|jsonl|md|css|html|htm|py|toml|lock|yml|yaml|txt|sh|bat|ps1|sql|vue|svelte|go|java|kt|c|h|cpp|hpp|cs|rb|php)\b/gi,
    " "
  );
  // Lignes de commande (prompt `$ `, `> `, `# `).
  t = t.replace(/^[ \t]*[$#>][ \t].*$/gm, " ");
  // Marqueurs Markdown : titres, listes, citations, gras.
  t = t.replace(/^[ \t]*#{1,6}[ \t]*/gm, "");
  t = t.replace(/^[ \t]*(?:[-*+•]|\d+[.)])[ \t]+/gm, "");
  t = t.replace(/^\s*>[ \t]?/gm, "");
  t = t.replace(/\*\*|__/g, "");
  // Compactage des espaces et nettoyage des ponctuations orphelines.
  t = t.replace(/\s+/g, " ").trim();
  t = t.replace(/\s+([.,;:!?])/g, "$1");
  return t.trim();
}

/**
 * Renvoie la première phrase d'un texte (le texte entier s'il n'y a pas de
 * ponctuation de fin de phrase). Évite de couper un nombre décimal (ex: « 1.5 »).
 * Fonction PURE.
 * @param {string} text
 * @returns {string}
 */
export function firstSentence(text) {
  const t = String(text ?? "");
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === "." || ch === "!" || ch === "?") {
      const prev = t[i - 1] || "";
      const next = t[i + 1];
      if (ch === "." && /\d/.test(prev) && /\d/.test(next || "")) continue;
      if (next === undefined || next === " ") return t.slice(0, i + 1);
    }
  }
  return t;
}

/**
 * Reformule un message de l'Assistant en UNE phrase simple : première phrase
 * débarrassée du technique, ponctuée et bornée en longueur. Retourne "" s'il ne
 * reste rien d'utile (message purement technique / code). Fonction PURE.
 * @param {string} raw
 * @returns {string}
 */
export function condenseAssistantMessage(raw) {
  const cleaned = stripTechnical(raw);
  if (!cleaned || !/[\p{L}\p{N}]/u.test(cleaned)) return "";
  let sentence = firstSentence(cleaned).replace(/\s+/g, " ").trim();
  if (!sentence) return "";
  if (!/[.!?…]$/.test(sentence)) sentence += ".";
  if (sentence.length > TELEGRAM_DIALOG_MAX_CHARS) {
    const cut = sentence.slice(0, TELEGRAM_DIALOG_MAX_CHARS - 1);
    const at = cut.lastIndexOf(" ");
    sentence = (at > 40 ? cut.slice(0, at) : cut).trimEnd() + "…";
  }
  return sentence;
}

/**
 * Classe un message de l'Assistant :
 *   - "empty"        : rien d'exploitable (que du code / des chemins) ;
 *   - "alert"        : alerte (erreur, anomalie, blocage…) ;
 *   - "approval"     : demande d'accord / question au propriétaire ;
 *   - "question"     : question ;
 *   - "report"       : fin de mission / compte rendu / réponse ;
 *   - "intermediate" : étape de travail, bavardage technique.
 * Fonction PURE.
 * @param {string} raw
 * @returns {"empty"|"alert"|"approval"|"question"|"report"|"intermediate"}
 */
export function classifyAssistantMessage(raw) {
  const rawText = String(raw ?? "");
  const cleaned = stripTechnical(rawText);
  if (!cleaned || !/[\p{L}\p{N}]/u.test(cleaned)) return "empty";
  const sample = rawText.toLowerCase();
  if (ALERT_RE.test(sample)) return "alert";
  const hasQuestion = cleaned.includes("?");
  if (hasQuestion && APPROVAL_RE.test(sample)) return "approval";
  if (hasQuestion) return "question";
  // Détection de la fin de mission / du compte rendu AVANT les étapes : un
  // message court qui annonce un résultat est utile même s'il commence par un
  // verbe de narration.
  if (REPORT_RE.test(sample)) return "report";
  if (SMALLTALK_RE.test(cleaned) || INTERMEDIATE_RE.test(cleaned.toLowerCase())) {
    return "intermediate";
  }
  if (cleaned.length < 12) return "intermediate";
  return "report";
}

/**
 * Vrai si le message mérite d'être transmis sur Telegram (réponse, compte
 * rendu, alerte, demande d'accord) — faux pour un message intermédiaire ou vide.
 * Fonction PURE.
 * @param {string} raw
 * @returns {boolean}
 */
export function isUsefulAssistantMessage(raw) {
  const kind = classifyAssistantMessage(raw);
  return kind !== "empty" && kind !== "intermediate";
}

// ── État de la communication du dialogue ─────────────────────────────────────
// Deux conditions cumulatives :
//   - `configured` : Telegram est configuré (jeton ET identifiant présents) ;
//   - `enabled`    : l'utilisateur a activé la communication via le bouton 🧭.
// Par défaut : désactivé. L'état persiste dans `AppConfig.telegram_dialog_enabled`
// (rechargé au démarrage) — jamais dans un stockage parallèle.

let dialogEnabled = false;
let dialogConfigured = false;

/** Fixe l'état « activé » (bouton 🧭). */
export function setTelegramDialogEnabled(value) {
  dialogEnabled = value === true;
}

/** L'utilisateur a-t-il activé la communication du dialogue ? */
export function isTelegramDialogEnabled() {
  return dialogEnabled;
}

/** Fixe l'état « Telegram configuré » (jeton + identifiant présents). */
export function setTelegramDialogConfigured(value) {
  dialogConfigured = value === true;
}

/** Telegram est-il configuré (jeton + identifiant de discussion) ? */
export function isTelegramDialogConfigured() {
  return dialogConfigured;
}

/**
 * Communication du dialogue réellement ACTIVE (activée ET configurée) : c'est
 * la condition qui coupe les avis bruts (anti-doublon) et autorise la parole de
 * l'Assistant.
 */
export function isTelegramDialogActive() {
  return dialogEnabled && dialogConfigured;
}

/** Réinitialise l'état (tests, arrêt). */
export function resetTelegramDialogState() {
  dialogEnabled = false;
  dialogConfigured = false;
}

/**
 * Vrai si Telegram est configuré : jeton de bot ET identifiant de discussion
 * non vides. C'est la condition de VISIBILITÉ du bouton 🧭 (rien d'autre : le
 * bouton reste totalement invisible tant que Telegram n'est pas configuré).
 * Fonction PURE.
 * @param {object|null} cfg
 * @returns {boolean}
 */
export function computeTelegramDialogVisibility(cfg) {
  const token = String((cfg && cfg.telegram_bot_token) || "").trim();
  const chatId = String((cfg && cfg.telegram_chat_id) || "").trim();
  return token.length > 0 && chatId.length > 0;
}

/** Envoi réel : passerelle d'envoi EXISTANTE (inerte si non configurée). */
function defaultSend(text) {
  return invoke("telegram_notify", { text });
}

/**
 * Transmet la réponse de l'Assistant sur Telegram, en UNE phrase simple.
 * Inerte (aucun envoi, aucune erreur) si la communication n'est pas active ou si
 * le message n'est pas utile. Les dépendances sont injectables (tests).
 *
 * @param {string} text - message complet de l'Assistant.
 * @param {object} [deps]
 * @param {() => boolean} [deps.isActive] - état (défaut : `isTelegramDialogActive`).
 * @param {(text: string) => unknown} [deps.send] - envoi (défaut : `telegram_notify`).
 * @returns {boolean} vrai si une phrase a été transmise.
 */
export function relayAssistantMessageToTelegram(text, deps = {}) {
  const isActive = deps.isActive || isTelegramDialogActive;
  if (!isActive()) return false;
  if (!isUsefulAssistantMessage(text)) return false;
  const line = condenseAssistantMessage(text);
  if (!line) return false;
  const send = deps.send || defaultSend;
  try {
    const result = send(line);
    if (result && typeof result.catch === "function") {
      result.catch(() => {});
    }
  } catch (_) {
    // Jamais visible : un échec de la parole de l'Assistant ne perturbe rien.
  }
  return true;
}

/**
 * Charge l'état depuis la configuration (commande `get_config` existante) :
 * met à jour l'état interne (activé + configuré) et renvoie ce qu'il faut pour
 * afficher le bouton. Un échec de lecture ⇒ état inerte (aucune erreur).
 *
 * @param {(cmd: string) => Promise<unknown>} [invokeFn] - injectable (tests).
 * @returns {Promise<{enabled: boolean, visible: boolean}>}
 */
export async function loadTelegramDialogConfig(invokeFn) {
  const call = invokeFn || invoke;
  let cfg = null;
  try {
    cfg = await call("get_config");
  } catch (_) {
    cfg = null; // fail-closed : non configuré, désactivé, aucune erreur
  }
  const visible = computeTelegramDialogVisibility(cfg);
  setTelegramDialogConfigured(visible);
  setTelegramDialogEnabled(cfg && cfg.telegram_dialog_enabled === true);
  return { enabled: isTelegramDialogEnabled(), visible };
}
