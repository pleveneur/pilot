// group-assistant.js — Assistant de groupe (GDS Phase C2, spec_gds.md §8)
//
// Écoute le canal `rpc-event-group` (session RPC dédiée de l'assistant de
// groupe, extension pilot-group-assistant) et traite ses `extension_ui_request`
// de type `input` préfixés par un sentinel PILOT_GROUP_* : exécute la commande
// Rust correspondante (lecture du suivi fusionné / création / recherche de
// tickets) et renvoie le résultat JSON comme `value` de la réponse
// `extension_ui_response` (même mécanisme que super-agent.js pour
// PILOT_ASSISTANT_*).
//
// L'assistant de groupe est STRICTEMENT en lecture seule sur le code des
// projets : il ne modifie que le suivi (tickets). Les commandes Rust refusent
// toute opération si le GDS est désactivé globalement (`gds_enabled`).

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const GROUP_CHANNEL = "rpc-event-group";

// Sentinels préfixant le titre d'un `input` d'outil (alignés sur
// pilot-group-assistant.ts).
const TRACKING_QUERY_SENTINEL = "PILOT_GROUP_TRACKING_QUERY::";
const TICKET_CREATE_SENTINEL = "PILOT_GROUP_TICKET_CREATE::";
const TICKET_SEARCH_SENTINEL = "PILOT_GROUP_TICKET_SEARCH::";
const PROJECT_QUERY_SENTINEL = "PILOT_GROUP_PROJECT_QUERY::";

/** Envoie la réponse d'une requête d'outil au processus pi de l'assistant de
 * groupe (extension_ui_response). `value` = résultat JSON (ou erreur). */
async function respondGroupAssistant(id, value, cancelled) {
  const cmd = { type: "extension_ui_response", id };
  if (cancelled) cmd.cancelled = true;
  else cmd.value = value;
  try {
    await invoke("send_group_assistant_command", { command: cmd });
  } catch (e) {
    console.error("Erreur extension_ui_response (assistant de groupe):", e);
  }
}

/** Traite une `extension_ui_request` de type `input` avec un sentinel PILOT_GROUP_*.
 * Exécute la commande Rust correspondante et renvoie le résultat JSON. */
async function handleGroupInput(payload, id) {
  const title = payload.title || "";
  if (title.startsWith(TRACKING_QUERY_SENTINEL)) {
    const scope = title.slice(TRACKING_QUERY_SENTINEL.length);
    try {
      const result = await invoke("group_assistant_tracking_query", { scope });
      await respondGroupAssistant(id, JSON.stringify(result), false);
    } catch (e) {
      await respondGroupAssistant(id, JSON.stringify({ error: String(e) }), false);
    }
    return;
  }
  if (title.startsWith(TICKET_CREATE_SENTINEL)) {
    const payloadJson = title.slice(TICKET_CREATE_SENTINEL.length);
    try {
      const result = await invoke("group_assistant_ticket_create", { payload: payloadJson });
      await respondGroupAssistant(id, JSON.stringify(result), false);
    } catch (e) {
      await respondGroupAssistant(id, JSON.stringify({ error: String(e) }), false);
    }
    return;
  }
  if (title.startsWith(TICKET_SEARCH_SENTINEL)) {
    const payloadJson = title.slice(TICKET_SEARCH_SENTINEL.length);
    try {
      const result = await invoke("group_assistant_ticket_search", { payload: payloadJson });
      await respondGroupAssistant(id, JSON.stringify(result), false);
    } catch (e) {
      await respondGroupAssistant(id, JSON.stringify({ error: String(e) }), false);
    }
    return;
  }
  if (title.startsWith(PROJECT_QUERY_SENTINEL)) {
    const scope = title.slice(PROJECT_QUERY_SENTINEL.length);
    try {
      const result = await invoke("group_assistant_project_query", { scope });
      await respondGroupAssistant(id, JSON.stringify(result), false);
    } catch (e) {
      await respondGroupAssistant(id, JSON.stringify({ error: String(e) }), false);
    }
    return;
  }
  // Sentinel inconnu : on répond avec une erreur pour ne pas bloquer pi.
  await respondGroupAssistant(id, JSON.stringify({ error: "Sentinel PILOT_GROUP_* inconnu." }), false);
}

/** Traite un événement `extension_ui_request` du canal de l'assistant de groupe. */
function handleGroupExtensionUiRequest(payload) {
  const method = payload.method;
  const id = payload.id;
  if (method === "input") {
    handleGroupInput(payload, id);
  }
  // Les autres méthodes (confirm/select/notify) ne sont pas utilisées par
  // l'extension pilot-group-assistant (outils via input uniquement).
}

/** Initialise l'écoute du canal `rpc-event-group`. Idempotent : un seul
 * listener actif. Appelé au démarrage de Pilot (main.js). */
export async function initGroupAssistant() {
  try {
    await listen(GROUP_CHANNEL, (event) => {
      const payload = event.payload;
      if (!payload || typeof payload !== "object") return;
      if (payload.type === "extension_ui_request") {
        handleGroupExtensionUiRequest(payload);
      }
    });
  } catch (e) {
    console.error("[rpc-event-group] erreur d'écoute:", e);
  }
}
