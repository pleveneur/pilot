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

// En-tête d'une part de résultat agrégé, produite par `aggregateParallelResults`
// (`src/js/agents.js`) : « === Résultat de <agentId> (done|error|queued) === ».
const RUN_AGENT_PART_HEADER = /^=== Résultat de .+? \(([^)]+)\) ===$/gm;

/**
 * Détecte si une FIN de run est un ÉCHEC (issue #87, 2ᵉ moitié).
 *
 * Le groupe parallèle du bus d'agents signale sa fin par le callback « done »
 * MÊME lorsqu'un agent a échoué : le statut « error » est simplement agrégé
 * dans le texte du résultat (`agents-bus.js`, `failAgentTurn` → `onComplete` →
 * `emit("done")`, format `agents.js:aggregateParallelResults`). Sans relecture
 * du résultat, un échec était donc annoncé comme un succès (notification
 * « terminée » + son de fin + entrée de suivi), et l'avis de fin d'ÉCHEC
 * n'existait jamais.
 * @param {unknown} result - résultat agrégé (ou message d'échec préfixé
 *   « [Échec …] » produit par les chemins `onError`).
 * @returns {boolean} true si la run doit être considérée comme un échec.
 */
export function runAgentsResultFailed(result) {
  const text = String(result || "");
  if (!text) return false;
  // Message d'échec explicite (chemins `onError` / échec de préparation).
  if (/^\s*\[Échec/i.test(text)) return true;
  // Résultat agrégé : une seule part marquée « (error) » rend la run en échec.
  // `queued` (demande mise en file) n'est PAS un échec.
  for (const m of text.matchAll(RUN_AGENT_PART_HEADER)) {
    if (m[1].trim().toLowerCase() === "error") return true;
  }
  return false;
}

/**
 * Émet l'AVIS DE FIN d'une run d'agents délégués (T7, §3.6) : notification
 * desktop + son de fin, PUIS consignation du compte-rendu dans le suivi.
 *
 * L'avis de fin (notification + son) est émis EN PREMIER et exactement une
 * fois : sa survenue ne doit JAMAIS dépendre du succès de la consignation.
 * Avant ce correctif, la remise durable était attendue AVANT la notification :
 * une remise qui rejette (`invoke` en erreur) supprimait notification ET son,
 * sans trace (rejet non géré chez l'appelant, qui n'attendait pas la promesse).
 *
 * Entièrement testable : les trois effets (notification, son, consignation)
 * sont injectés par l'appelant (`notify` / `playSound` / `consign`).
 * @param {object} params
 * @param {boolean} params.ok - issue de la run (false = échec).
 * @param {string|null} params.projectPath - projet de la run (suffixe).
 * @param {unknown} params.result - compte-rendu brut (résultat ou échec).
 * @param {(opts: {title: string, body: string}) => unknown} params.notify
 * @param {(soundType: string) => unknown} params.playSound
 * @param {(result: unknown) => Promise<unknown>} params.consign
 * @returns {Promise<{ ok: boolean, notified: boolean, sound: boolean,
 *   consigned: boolean }>}
 */
export async function emitRunAgentsFinishNotice({ ok, projectPath, result, notify, playSound, consign }) {
  const { title, body } = buildRunAgentsNotification({ ok: ok === true, projectPath });
  // Avis de fin : émis en premier, une seule fois, quoi qu'il arrive ensuite.
  ignoreAsyncFailure(notify, { title, body });
  ignoreAsyncFailure(playSound, "fin");
  // Consignation dans le suivi (compte-rendu). Fail-open : un échec de remise
  // n'enlève PAS l'avis de fin déjà émis et ne remonte pas à l'appelant.
  let consigned = false;
  try {
    await consign(result);
    consigned = true;
  } catch (_) {
    consigned = false;
  }
  return { ok: ok === true, notified: true, sound: true, consigned };
}

/**
 * Appelle un émetteur sans jamais lever ni laisser un rejet non géré (une
 * notification est un confort : son échec ne doit pas casser la fin de run).
 * @param {(arg: unknown) => unknown} fn
 * @param {unknown} arg
 */
function ignoreAsyncFailure(fn, arg) {
  try {
    const res = fn(arg);
    if (res && typeof res.catch === "function") res.catch(() => {});
  } catch (_) {
    // fail-open : émetteur indisponible → on continue.
  }
}
