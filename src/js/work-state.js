// work-state.js — Instantané d'état de travail avant la coupe de l'historique
// (module PUR, testable — modèle : `super-agent-exchange-filter.js`).
//
// Quand l'historique de la conversation devient trop long, pi le compacte : les
// messages anciens disparaissent et seul un résumé est produit (affiché dans le
// chat, jamais conservé). L'agent peut alors perdre de vue ce sur quoi il
// travaillait. Juste AVANT la coupe, Pilot écrit donc un instantané COURT de
// l'état de travail dans `.pilot/work-state.md` ; l'extension `pilot-context`
// (`before_agent_start`) le relit au même endroit que le handoff de contexte et
// le réinjecte après la coupe.
//
// Deux contraintes : une borne de taille DURE (le but est de ne pas gonfler le
// contexte) et une phrase de fraîcheur DATÉE (l'instantané peut être réinjecté
// plusieurs tours plus tard : l'agent doit vérifier le disque avant d'agir).
//
// Ce module ne connaît ni Tauri ni le DOM : il reçoit des chaînes et une date.

/** Taille maximale (caractères) de l'instantané écrit sur disque. */
export const WORK_STATE_MAX_CHARS = 600;

/** Longueur maximale d'un champ individuel avant troncature. */
const FIELD_MAX_CHARS = 220;

/** Normalise un champ : chaîne non textuelle → "", espaces compactés. */
function clean(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** Tronque une chaîne à `max` caractères, en terminant par « … ». */
function truncate(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

/**
 * Construit l'instantané d'état de travail (borné) écrit avant une compaction.
 * @param {object} [fields]
 * @param {unknown} [fields.userPrompt] - dernière demande de l'utilisateur.
 * @param {unknown} [fields.assistantText] - dernière réponse utile de l'agent.
 * @param {unknown} [fields.orchestrationTask] - tâche d'orchestration en cours
 *   (« #12 Titre »), ou "" hors orchestration (lecture seule).
 * @param {Date} [fields.now] - date de l'instantané (défaut : maintenant).
 * @returns {string} instantané Markdown borné, ou "" si aucun champ exploitable
 *   (dans ce cas rien n'est écrit : l'extension n'injecte rien).
 */
export function buildWorkStateSnapshot({ userPrompt, assistantText, orchestrationTask, now } = {}) {
  const tache = truncate(clean(orchestrationTask), FIELD_MAX_CHARS);
  const demande = truncate(clean(userPrompt), FIELD_MAX_CHARS);
  const reponse = truncate(clean(assistantText), FIELD_MAX_CHARS);
  if (!tache && !demande && !reponse) return "";

  const when = now instanceof Date && !isNaN(now.getTime()) ? now : new Date();
  const date = when.toISOString().slice(0, 10);
  const lines = [
    "# État de travail (instantané pris avant la coupe de l'historique)",
    `⚠️ Enregistré le ${date} : des fichiers ont pu changer depuis — vérifie le disque avant d'agir.`,
    "",
  ];
  if (tache) lines.push(`- Tâche en cours : ${tache}`);
  if (demande) lines.push(`- Dernière demande : ${demande}`);
  if (reponse) lines.push(`- Dernière réponse : ${reponse}`);

  return truncate(lines.join("\n"), WORK_STATE_MAX_CHARS);
}
