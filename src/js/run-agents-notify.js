// run-agents-notify.js — Compte-rendu et notification de fin d'une run
// d'agents délégués (T7, spec_orchestration_multiagents.md §3.6 / §5.5).
//
// Module PUR / testable (aucun import navigateur, aucun effet de bord) : la
// distinction « point d'avancement » vs « fin de tâche », la compilation du
// compte-rendu injecté à l'assistant et la construction de la notification
// desktop y sont extraites pour être unit-testées.
//
// Rappel du besoin (T7) : quand une run d'agents délégués se termine, la fin
// doit être signalée par un événement (au lieu d'un polling) — compte-rendu,
// notification desktop + son configuré, consignation dans le suivi. Un
// « point d'avancement » (mise en file ⏳, démarrage ▶️, arrêt auto ⏱️) est
// consigné mais ne déclenche NI notification desktop NI son de fin.

// Préfixe des messages d'avancement injectés à l'assistant pendant une run.
// Un message préfixé ainsi est un POINT D'AVANCEMENT (pas une fin de run) :
// il est injecté pour consignation mais n'est pas un compte-rendu final.
export const RUN_PROGRESS_PREFIX = "[Info run_agents]";

/**
 * Distingue un « point d'avancement » d'une « fin de tâche » de run.
 * @param {unknown} result - texte injecté à l'assistant (ou à construire).
 * @returns {boolean} true si c'est un point d'avancement, pas une fin.
 */
export function isRunProgressMessage(result) {
  return typeof result === "string" && result.startsWith(RUN_PROGRESS_PREFIX);
}

/**
 * Compile le compte-rendu (summary) injecté à l'assistant pour consignation
 * dans son suivi (base clients/projets/tâches). Une fin de run est encadrée
 * par le marqueur « Tâche run_agents terminée » ; un point d'avancement est
 * injecté tel quel (déjà explicite via son préfixe).
 * @param {unknown} result - résultat agrégé, message d'échec ou info.
 * @returns {string} le summary à injecter.
 */
export function buildRunAgentsSummary(result) {
  const text = String(result || "");
  if (isRunProgressMessage(text)) {
    return text;
  }
  return `[Tâche run_agents terminée] Résultat de la run d'agents :\n${text}`;
}

/**
 * Construit la notification desktop de fin de run (T7).
 * @param {object} params — { ok:boolean, projectPath:string|null }.
 * @returns {{ title:string, body:string }}
 */
export function buildRunAgentsNotification({ ok, projectPath }) {
  const suffix = projectPath ? ` (projet « ${projectPath} »)` : "";
  if (ok) {
    return {
      title: "Pilot — Run d'agents terminée",
      body: `✅ La run d'agents déléguée est terminée${suffix}.`,
    };
  }
  return {
    title: "Pilot — Run d'agents en échec",
    body: `❌ La run d'agents déléguée a échoué${suffix}.`,
  };
}
