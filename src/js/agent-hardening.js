// Agent dialogue hardening (R2 — étude oh-my-pi, LOT 5).
//
// Ce module ne contient que des DÉCISIONS PURES : aucune I/O, aucun accès DOM,
// aucune modification d'état. L'objectif est que chaque protection du dialogue
// avec l'agent soit vérifiable par un test déterministe, indépendamment du
// moteur (pi aujourd'hui, omp éventuellement plus tard).
//
// Sources des protections (rapport d'étude, non adopté comme moteur) :
//   - F3 : `agent_end` peut être non terminal → ne pas croire à une fin de run.
//   - F8 : pendant un streaming actif, préciser `streamingBehavior`.
//   - F2 : nom de commande de découverte de secours.

/**
 * F3 — L'événement `agent_end` marque-t-il vraiment la fin du run ?
 * pi (moteur actuel) n'émet pas `isTerminal` → terminal par défaut.
 * Un `isTerminal === false` explicite signifie « la session va reprendre ».
 */
export function isTerminalAgentEnd(event) {
  if (!event || typeof event !== "object") return true;
  return event.isTerminal !== false;
}

/**
 * F3 bis — Un « terminé » déclaré est-il crédible ?
 * On ne croit pas l'agent sur parole : il faut une production observable
 * (texte ou résultat d'outil) et un arrêt non fautif.
 */
export function isCompletionCredible(facts = {}) {
  const stopReason = typeof facts.stopReason === "string" ? facts.stopReason : "";
  if (stopReason === "error" || stopReason === "aborted") return false;
  return facts.producedText === true || facts.producedToolResult === true;
}

/**
 * F3 bis — Motif lisible quand un « terminé » n'est pas crédible.
 * Retourne `null` si la production est crédible.
 */
export function completionRefusalReason(facts = {}) {
  if (isCompletionCredible(facts)) return null;
  const stopReason = typeof facts.stopReason === "string" ? facts.stopReason : "";
  if (stopReason === "error") return "l'agent s'est arrêté sur une erreur";
  if (stopReason === "aborted") return "l'agent a été interrompu";
  return "l'agent déclare avoir terminé sans production observable";
}

/**
 * F3 ter — Une relance demandée sans suite observable est une relance perdue.
 * Le suivi est explicite (`resendRequested` / `followUpSeen`) : pas de minuterie,
 * donc testable sans attente réelle.
 */
export function isResendLost(facts = {}) {
  return facts.resendRequested === true && facts.followUpSeen !== true;
}

export const STREAMING_BEHAVIOR_STEER = "steer";
export const STREAMING_BEHAVIOR_FOLLOW_UP = "followUp";

/**
 * F8 — Comportement à annoncer au moteur quand un prompt part pendant un run
 * actif. `null` quand aucun run n'est en cours (comportement actuel inchangé).
 * kind : "interrupt" → steer ; sinon → followUp.
 */
export function streamingBehaviorFor(kind, isStreaming) {
  if (isStreaming !== true) return null;
  return kind === "interrupt" ? STREAMING_BEHAVIOR_STEER : STREAMING_BEHAVIOR_FOLLOW_UP;
}

/**
 * F8 — Construit le corps d'un prompt. Sans streaming actif, le corps est
 * strictement identique à celui d'aujourd'hui (message + images éventuelles).
 */
export function buildPromptPayload(message, opts = {}) {
  const payload = { message };
  if (Array.isArray(opts.images) && opts.images.length > 0) payload.images = opts.images;
  const behavior = streamingBehaviorFor(opts.kind, opts.isStreaming === true);
  if (behavior) payload.streamingBehavior = behavior;
  return payload;
}

/**
 * F8 — Un accusé de réception de prompt est-il un succès ? `null` = pas
 * d'information exploitable (on ne crie pas au loup).
 */
export function isPromptAccepted(response) {
  if (!response || typeof response !== "object") return null;
  if (response.success === false) return false;
  if (response.success === true) return true;
  return null;
}

/**
 * F2 — Noms de commande de découverte, dans l'ordre à essayer. Le premier est
 * celui utilisé aujourd'hui par Pilot (compatibilité pi), le second est le nom
 * exposé par omp.
 */
export const COMMAND_DISCOVERY_ORDER = ["get_commands", "get_available_commands"];

/** F2 — Réponse exploitable pour la découverte des commandes ? */
export function parseCommandsResponse(response) {
  if (!response || typeof response !== "object") return { ok: false, commands: [] };
  if (response.success === false) return { ok: false, commands: [] };
  const data = response.data || response;
  const commands = Array.isArray(data.commands) ? data.commands : [];
  return { ok: commands.length > 0, commands };
}

/**
 * F2 — Frame poussée `available_commands_update` : la palette doit la prendre en
 * compte (elle n'est jamais écoutée aujourd'hui → commandes perdues).
 */
export function commandsFromUpdate(event) {
  if (!event || typeof event !== "object") return null;
  if (event.type !== "available_commands_update") return null;
  const commands = Array.isArray(event.commands)
    ? event.commands
    : (event.data && Array.isArray(event.data.commands) ? event.data.commands : null);
  return Array.isArray(commands) ? commands : null;
}

/**
 * Commandes « /… » : une saisie n'est une commande que si son nom est connu.
 * Sinon c'est du texte libre (aucun effet destructeur), et un simple « / »
 * isolé n'est jamais une commande.
 */
export function classifySlashInput(text, knownNames = []) {
  const raw = typeof text === "string" ? text : "";
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) return { kind: "text", name: "", args: trimmed };
  const withoutSlash = trimmed.slice(1);
  const name = withoutSlash.split(/\s+/)[0] || "";
  if (!name) return { kind: "text", name: "", args: "" };
  const args = withoutSlash.slice(name.length).trim();
  const known = Array.isArray(knownNames) && knownNames.includes(name);
  return { kind: known ? "command" : "unknown", name, args };
}

/**
 * Porte pré-écriture (idée 2 de l'étude) — décision PURE, séparée de l'écriture :
 * que faut-il faire d'une décision d'acceptation/refus ? Aucun effet de bord ici.
 */
export function decideEditGate(accepted, opts = {}) {
  const isAlreadyResolved = opts.resolved === true;
  const decision = accepted === true ? "accept" : "reject";
  if (isAlreadyResolved) return { apply: false, decision, write: false, closeDialog: true };
  return { apply: true, decision, write: decision === "accept", closeDialog: true };
}
