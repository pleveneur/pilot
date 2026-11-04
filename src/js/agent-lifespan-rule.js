// agent-lifespan-rule.js — SOURCE UNIQUE de la règle « agent JETABLE par
// défaut » de l'Assistant.
//
// Décision du propriétaire : pour un besoin PONCTUEL (diagnostic, analyse,
// vérification, rédaction de circonstance), l'Assistant ne doit PAS fabriquer un
// agent permanent dans le registre — il décrit un agent JETABLE dans sa demande.
// `create_agent` est RÉSERVÉ aux rôles DURABLES. L'Assistant ne peut pas
// supprimer une entrée du registre (c'est le propriétaire qui le fait) : une
// création inutile reste donc visible chez lui, indéfiniment.
//
// Ce module est PUR (aucun import, aucune I/O) et la règle n'est écrite QU'ICI :
//   1. côté extension pi, `pilot-assistant-actions.ts` l'importe
//      (`./agent-lifespan-rule.js`) et s'en sert pour les descriptions et les
//      consignes des outils `create_agent` / `run_agents` /
//      `run_assistant_agents` ;
//   2. côté Rust, `super_agent.rs` embarque CE FICHIER ENTIER (`include_str!`)
//      et en extrait la consigne pour l'injecter dans le prompt système de
//      l'Assistant.
//
// CONTRAT à ne pas casser (lu littéralement par Rust, `AGENT_LIFESPAN_RULE_OPEN`
// / `AGENT_LIFESPAN_RULE_CLOSE` dans `super_agent.rs`) :
//   - DÉBUT : la déclaration de la constante `AGENT_LIFESPAN_RULE`, immédiatement
//     suivie d'un accent grave ouvrant un gabarit de chaîne ;
//   - FIN   : un accent grave suivi d'un point-virgule fermant ce gabarit.
// Le texte ne contient donc NI accent grave NI `${`. Renommer la constante ou
// changer les délimiteurs fait perdre la règle dans le prompt : le verrou Rust
// `la_regle_de_l_agent_jetable_est_injectee_dans_le_prompt` (`super_agent.rs`)
// et le verrou front `agents-jetables-par-defaut.test.js` échouent alors.

/**
 * La consigne, en clair, injectée TELLE QUELLE dans le prompt système de
 * l'Assistant (aucune reformulation ailleurs).
 */
export const AGENT_LIFESPAN_RULE = `
Par défaut, un besoin ponctuel se traite avec un agent JETABLE, pas avec un agent permanent.

1. Besoin PONCTUEL (diagnostic, analyse, vérification, rédaction de circonstance — une tâche qui ne reviendra pas) : décris un AGENT JETABLE et lance-le, en renseignant « agents » (un nom + un rôle) dans run_agents ou run_assistant_agents. Rien n'est écrit dans le registre, l'agent n'apparaît PAS dans la liste des agents du propriétaire, et sa définition disparaît à la fin de la tâche (son travail — session, compte rendu — reste visible).
2. create_agent est RÉSERVÉ aux rôles DURABLES : un rôle que tu confieras encore dans plusieurs semaines, à plusieurs reprises. « Aucun agent du registre ne convient » n'est PAS une raison suffisante pour créer un agent permanent.
3. Dans le doute, ne crée RIEN : tu ne peux jamais supprimer une entrée du registre (c'est le propriétaire qui le fait), donc toute création inutile reste visible chez lui. Un agent jetable couvre le besoin ponctuel, sans laisser de trace.`;

/**
 * La même règle, en une phrase, pour les consignes d'outils données au modèle
 * (guidelines de l'extension pi). Aucune divergence : ce texte vit ici aussi.
 */
export const AGENT_LIFESPAN_RULE_GUIDELINE =
  "DEFAULT IS A THROWAWAY AGENT: for a ONE-OFF need (diagnosis, analysis, verification, one-shot writing) pass `agents` (name + role) to run_agents / run_assistant_agents — nothing is written to the registry, it never appears in the owner's agent list, and it disappears when the task ends. Use create_agent ONLY for a DURABLE role you will reuse over time. \"No registered agent fits\" is NOT enough reason to create a permanent agent: you can never delete a registry entry (the owner does), so every unnecessary creation stays visible forever. When in doubt, create nothing.";

/** Résumé court (libellés, en-têtes, commentaires de code). */
export const AGENT_LIFESPAN_RULE_SNIPPET =
  "agent jetable par défaut — create_agent réservé aux rôles durables";

/**
 * Décision PURE : quel genre d'agent pour ce besoin ?
 *
 * Le doute joue TOUJOURS en faveur du jetable : seul un besoin explicitement
 * déclaré durable autorise une entrée permanente dans le registre.
 *
 * @param {{durable?: boolean}} [need] besoin décrit par l'appelant
 * @returns {"throwaway"|"create_agent"} « throwaway » → agent jetable ; « create_agent » → agent permanent justifié
 */
export function decideAgentKind(need) {
  return need && need.durable === true ? "create_agent" : "throwaway";
}
