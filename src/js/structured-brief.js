// structured-brief.js — Enveloppe de brief structuré pour les agents appelés
// par l'assistant (TÂCHE T1 : fiabiliser l'usage des agents).
//
// Module PUR / testable. L'enveloppe (contexte, objectif, consignes, ce qu'il
// ne faut PAS faire) est appliquée MÉCANIQUEMENT côté super-agent.js à la
// demande déléguée, sur LES DEUX chemins de délégation : `run_agents` ET
// `delegate_to_coder` (pas seulement l'un des deux), sans dépendre du bon
// vouloir de l'assistant. Le bus d'agents (agents-bus.js) ne l'applique PAS :
// il reçoit le brief déjà enveloppé. Inspiré du mode manuel (prompt structuré
// + purge), car une tâche bien formulée évite les boucles de run_agents.

/** Consigne quality-gate à préfixer aux prompts (vide si désactivée). */
export function qualityGateInstruction(enabled) {
  if (enabled === false) return "";
  return "Respecte le protocole quality-gate (.pi/skills/quality-gate/SKILL.md) avant de modifier. Lance cargo test --lib avant de committer.\n\n";
}

/** Marqueurs de sections d'un brief structuré, pour la détection d'existant. */
export const STRUCTURED_SECTION_MARKERS = [
  "## Contexte",
  "## Objectif",
  "## Consignes",
  "## Ce qu'il ne faut PAS faire",
];

// Nombre minimal de sections présentes pour considérer qu'un brief est déjà
// structuré (évite de dupliquer les sections que l'assistant aurait rédigées).
const MIN_SECTIONS = 2;

/**
 * Détecte si un texte contient déjà les sections d'un brief structuré.
 * @param {string} text
 * @returns {boolean}
 */
export function hasStructuredSections(text) {
  const t = String(text || "");
  let count = 0;
  for (const marker of STRUCTURED_SECTION_MARKERS) {
    if (t.includes(marker)) count++;
  }
  return count >= MIN_SECTIONS;
}

/**
 * Construit un brief STRUCTURÉ complet pour les agents (contexte, objectif,
 * consignes, ce qu'il ne faut PAS faire) — reproduit la structure du mode
 * manuel pour que l'agent réussisse du premier coup. Préfixé par la consigne
 * quality-gate si activée.
 * @param {string} task - tâche brute fournie par l'assistant.
 * @param {boolean} [qualityGateEnabled=true]
 * @returns {string}
 */
export function buildStructuredBrief(task, qualityGateEnabled = true) {
  const qg = qualityGateInstruction(qualityGateEnabled);
  const t = String(task || "").trim();
  return (
    qg +
    "## Contexte\n" +
    "Tu es un agent du registre de Pilot, lancé par l'assistant de suivi multi-projets. " +
    "Exécute la tâche suivante de façon autonome et complète, dans le projet de travail indiqué.\n\n" +
    "## Objectif\n" +
    (t || "(tâche non précisée)") +
    "\n\n" +
    "## Consignes\n" +
    "- Analyse le projet avant d'agir : lis les fichiers concernés et l'arborescence.\n" +
    "- Modifie UNIQUEMENT ce qui est nécessaire à l'objectif.\n" +
    "- Vérifie ton travail : compile (cargo test --lib si Rust) et tests avant de conclure.\n" +
    "- Termine par un résumé concis de ce que tu as fait (DONE: ...).\n\n" +
    "## Ce qu'il ne faut PAS faire\n" +
    "- Ne pas modifier des fichiers hors de l'objectif.\n" +
    "- Ne pas répéter des actions identiques en boucle : si une action échoue, change d'approche.\n" +
    "- Ne pas inventer de résultats : si tu ne peux pas vérifier, dis-le clairement.\n"
  );
}

/**
 * Applique l'enveloppe de brief structuré à une tâche UNIQUEMENT si elle n'en
 * contient pas déjà les sections (ne duplique pas les sections déjà rédigées
 * par l'assistant). Préfixe toujours la consigne quality-gate quand activée.
 * @param {string} task
 * @param {boolean} [qualityEnabled=true]
 * @returns {string}
 */
export function ensureStructuredBrief(task, qualityEnabled = true) {
  const t = String(task || "");
  if (hasStructuredSections(t)) {
    return qualityGateInstruction(qualityEnabled) + t;
  }
  return buildStructuredBrief(t, qualityEnabled);
}

/**
 * Point d'entrée unique pour l'enveloppe mécanique côté UI : applique le brief
 * structuré seulement si `forceStructured` est activé (défaut true), sinon ne
 * fait que préfixer la consigne quality-gate (si activée).
 * @param {string} task
 * @param {object} [opts]
 * @param {boolean} [opts.forceStructured=true]
 * @param {boolean} [opts.qualityGate=true]
 * @returns {string}
 */
export function applyAssistantBriefEnvelope(task, { forceStructured = true, qualityGate = true } = {}) {
  if (forceStructured === false) {
    return qualityGateInstruction(qualityGate) + String(task || "");
  }
  return ensureStructuredBrief(task, qualityGate);
}
