// mcp-server-toggle.js — ACTIVER / DÉSACTIVER un serveur MCP NOMMÉ depuis la
// conversation de l'Assistant (décision du propriétaire : l'Assistant ne doit
// pas renvoyer l'utilisateur dans les Paramètres pour brancher le bon serveur).
//
// QUI FAIT QUOI (une seule responsabilité par endroit) :
//   - l'outil (`mcp_enable_server` / `mcp_disable_server`, extension
//     pilot-assistant-actions) transmet `{ server, enabled }` par le sentinel
//     `PILOT_ASSISTANT_MCP_SERVER::` — même mécanisme que `mcp_state`,
//     `open_project`, `delegate_to_coder` : aucune autre voie n'est créée ;
//   - la DÉCISION est ici (`planMcpServerToggle`, pure) : quel(s) serveur(s)
//     changent d'état, et ce qu'on répond. C'est le SEUL endroit où la règle
//     « un seul serveur branché par session ⇒ activer un serveur coupe les
//     autres » est appliquée ;
//   - l'ÉCRITURE est faite par Rust (`mcp_set_servers_enabled`), qui ne change
//     QUE le champ `enabled` des serveurs nommés, refuse un identifiant inconnu
//     et ne touche ni au client MCP (`mcp_enabled`), ni à la confirmation
//     (`mcp_agent_confirm`), ni au mode strict des clés, ni au contenu des
//     serveurs, ni aux secrets.
//
// RÈGLE DE CONFIRMATION : c'est l'ASSISTANT qui demande confirmation à
// l'utilisateur (`ask_confirm`) avant d'appeler l'outil — l'outil, lui, applique
// l'action demandée (doc dans la description des outils + la spec).
//
// Effet différé : le serveur branché est décidé AU SPAWN d'une session d'agent
// (`select_session_server` / `PILOT_MCP_SERVER`). La réponse le rappelle donc
// toujours : la prochaine session prend le nouveau serveur, une session en
// cours garde celui avec lequel elle a démarré.

/** Sentinel préfixant le titre d'un `input` des deux outils d'activation. */
export const MCP_SERVER_TOGGLE_SENTINEL = "PILOT_ASSISTANT_MCP_SERVER::";

/** Commande Rust qui applique les changements (écriture NARROW). */
export const MCP_SET_SERVERS_ENABLED_COMMAND = "mcp_set_servers_enabled";

/** Commande Rust qui relit l'état MCP (la même que l'outil `mcp_state`). */
export const MCP_GET_STATE_COMMAND = "mcp_get_state";

/** Rappel ajouté à CHAQUE réponse : le changement vaut à la prochaine session. */
export const MCP_NEXT_SESSION_NOTE =
  "Le changement prend effet à la prochaine session d'agent : une session déjà lancée garde le serveur avec lequel elle a démarré.";

/** Rappel ajouté à CHAQUE réponse : rien d'autre n'a été modifié. */
export const MCP_NO_OTHER_SETTING_NOTE =
  "Aucun autre réglage MCP n'a été touché (client MCP activé, confirmation requise, contenu des serveurs, secrets).";

/**
 * Identifiant de serveur normalisé (chaîne vide si absent). Fonction PURE.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeMcpServerId(value) {
  return typeof value === "string" ? value.trim() : "";
}

/** Un serveur est-il ACTIVÉ ? Lecture stricte (`true` seul active). PURE. */
function isEnabled(server) {
  return !!(server && server.enabled === true);
}

/**
 * Libellé lisible d'un serveur : « Nom » (id), ou l'id seul si le nom manque.
 * Fonction PURE.
 * @param {{id?: string, name?: string}|null|undefined} server
 * @returns {string}
 */
export function mcpServerLabel(server) {
  const id = normalizeMcpServerId(server && server.id);
  const name = server && typeof server.name === "string" ? server.name.trim() : "";
  if (name && id && name !== id) return `« ${name} » (${id})`;
  if (name) return `« ${name} »`;
  if (id) return `« ${id} »`;
  return "« (sans identifiant) »";
}

/**
 * Retrouve un serveur dans l'état MCP par son identifiant : correspondance
 * EXACTE après rognage des espaces, puis à la casse près (l'identifiant est un
 * choix de l'utilisateur, pas une valeur sensible). Fonction PURE.
 * @param {{servers?: Array<object>}|null|undefined} state
 * @param {string} id
 * @returns {{index: number, server: object}|null}
 */
export function findMcpServer(state, id) {
  const wanted = normalizeMcpServerId(id);
  if (!wanted) return null;
  const servers = Array.isArray(state && state.servers) ? state.servers : [];
  const exact = servers.findIndex(
    (s) => s && normalizeMcpServerId(s.id) === wanted,
  );
  if (exact !== -1) return { index: exact, server: servers[exact] };
  const lower = wanted.toLowerCase();
  const loose = servers.findIndex(
    (s) => s && normalizeMcpServerId(s.id).toLowerCase() === lower,
  );
  if (loose !== -1) return { index: loose, server: servers[loose] };
  return null;
}

/** Liste des identifiants connus, pour un message d'erreur utile. PURE. */
function knownServerIds(state) {
  const servers = Array.isArray(state && state.servers) ? state.servers : [];
  return servers
    .map((s) => normalizeMcpServerId(s && s.id))
    .filter((s) => s.length > 0);
}

/**
 * DÉCISION d'une activation/désactivation de serveur MCP — AUCUNE I/O. Fonction
 * PURE, la seule à connaître la règle d'exclusivité.
 *
 * Rend :
 *   - `{ ok: false, reason, message, knownServers }` si la demande est
 *     inutilisable (identifiant absent) ou si l'identifiant est INCONNU — le
 *     message est clair et rien n'est modifié ;
 *   - `{ ok: true, id, name, enabled, changes, disabledOthers, changed }` sinon.
 *     `changes` est la liste EXACTE des états à écrire (`[{ id, enabled }]`), et
 *     `disabledOthers` nomme les serveurs coupés par l'activation (aucun effet de
 *     bord silencieux).
 *
 * Règle d'exclusivité : Pilot ne branche qu'UN serveur par session
 * (`select_session_server` : le premier activé). Activer un serveur coupe donc
 * les AUTRES serveurs activés, et le dit. Désactiver n'active personne d'office.
 *
 * @param {{servers?: Array<object>}|null|undefined} state état lu par `mcp_get_state`
 * @param {{server?: string, enabled?: boolean}} request
 * @returns {object}
 */
export function planMcpServerToggle(state, request = {}) {
  const servers = Array.isArray(state && state.servers) ? state.servers : [];
  const id = normalizeMcpServerId(request.server);
  const enabled = request.enabled === true;
  if (!id) {
    return {
      ok: false,
      reason: "missing-server",
      message:
        "Aucun serveur MCP n'a été nommé : rien n'a été modifié. Indiquez l'identifiant du serveur voulu (il se lit avec mcp_state).",
      knownServers: knownServerIds(state),
    };
  }
  const hit = findMcpServer(state, id);
  if (!hit) {
    const known = knownServerIds(state);
    const liste = known.length ? known.join(", ") : "aucun serveur configuré";
    return {
      ok: false,
      reason: "unknown-server",
      message: `Serveur MCP inconnu : « ${id} ». Rien n'a été modifié. Serveurs connus : ${liste}.`,
      knownServers: known,
    };
  }
  const target = hit.server;
  const targetId = normalizeMcpServerId(target.id);
  const changes = [];
  const disabledOthers = [];
  if (isEnabled(target) !== enabled) {
    changes.push({ id: targetId, enabled });
  }
  if (enabled) {
    // Activation EXCLUSIVE : tout autre serveur activé est coupé, et nommé.
    servers.forEach((s, index) => {
      if (index === hit.index || !s) return;
      if (!isEnabled(s)) return;
      const otherId = normalizeMcpServerId(s.id);
      if (!otherId) return;
      changes.push({ id: otherId, enabled: false });
      disabledOthers.push(mcpServerLabel(s));
    });
  }
  return {
    ok: true,
    id: targetId,
    name: target.name || targetId,
    enabled,
    wasEnabled: isEnabled(target),
    changed: changes.length > 0,
    changes,
    disabledOthers,
  };
}

/**
 * Réponse de l'outil (texte rendu au modèle) : dit ce qui a changé, ce qui a été
 * coupé, que le changement vaut à la prochaine session et que rien d'autre n'a
 * été touché. Fonction PURE.
 * @param {object} plan résultat de `planMcpServerToggle`
 * @returns {string}
 */
export function mcpToggleAnswer(plan) {
  if (!plan || plan.ok !== true) {
    return plan && plan.message
      ? plan.message
      : "Demande d'activation MCP inutilisable : rien n'a été modifié.";
  }
  const label = `« ${plan.name} »` + (plan.id && plan.name !== plan.id ? ` (${plan.id})` : "");
  if (!plan.changed) {
    return plan.enabled
      ? `MCP : le serveur ${label} est DÉJÀ activé — rien à changer. ${MCP_NEXT_SESSION_NOTE} ${MCP_NO_OTHER_SETTING_NOTE}`
      : `MCP : le serveur ${label} est DÉJÀ désactivé — rien à changer. ${MCP_NO_OTHER_SETTING_NOTE}`;
  }
  if (plan.enabled) {
    const coupes = plan.disabledOthers.length
      ? ` Pour respecter la règle « un seul serveur branché par session », ces serveurs activés ont été COUPÉS : ${plan.disabledOthers.join(", ")}.`
      : " Aucun autre serveur n'était activé : aucun n'a été coupé.";
    const etat = plan.wasEnabled
      ? `MCP : le serveur ${label} était DÉJÀ activé ; c'est désormais le SEUL serveur activé.`
      : `MCP : le serveur ${label} est maintenant ACTIVÉ.`;
    return `${etat}${coupes} ${MCP_NEXT_SESSION_NOTE} ${MCP_NO_OTHER_SETTING_NOTE}`;
  }
  return `MCP : le serveur ${label} est maintenant DÉSACTIVÉ. Pilot ne le branchera plus ; les autres serveurs gardent leur état (aucun serveur n'est activé d'office à sa place). ${MCP_NEXT_SESSION_NOTE} ${MCP_NO_OTHER_SETTING_NOTE}`;
}

/**
 * Ligne système courte affichée dans la conversation de l'Assistant, pour que
 * le changement soit VISIBLE par l'utilisateur (jamais un effet silencieux).
 * Fonction PURE.
 * @param {object} plan
 * @returns {string}
 */
export function mcpToggleSystemMessage(plan) {
  if (!plan || plan.ok !== true) return "⚠️ Serveur MCP inchangé.";
  const label = `« ${plan.name} »`;
  if (plan.enabled) {
    const coupes = plan.disabledOthers.length
      ? ` — serveur(s) coupé(s) : ${plan.disabledOthers
          .map((l) => l.replace(/[«»]/g, "").trim())
          .join(", ")}`
      : "";
    const verbe = plan.wasEnabled ? "déjà activé" : "activé";
    return `🔌 Serveur MCP ${label} ${verbe}${coupes}.`;
  }
  return `🔌 Serveur MCP ${label} désactivé.`;
}

/**
 * Applique la demande : LIT l'état (`mcp_get_state`), DÉCIDE
 * (`planMcpServerToggle`) puis ÉCRIT (`mcp_set_servers_enabled`, seulement les
 * états `enabled`). Aucune autre commande n'est appelée, donc aucun autre
 * réglage ne peut être modifié par ce chemin.
 *
 * Fail-safe : une lecture ou une écriture impossible laisse la configuration
 * INCHANGÉE et renvoie un message clair (jamais une exception qui remonte).
 *
 * @param {{server?: string, enabled?: boolean}} request
 * @param {object} [deps]
 * @param {(cmd: string, args?: object) => Promise<unknown>} [deps.invokeFn]
 * @returns {Promise<object>} le plan, enrichi de `written` (identifiants écrits)
 */
export async function applyMcpServerToggle(request = {}, deps = {}) {
  const call = deps.invokeFn || defaultInvoke;
  let state;
  try {
    state = await call(MCP_GET_STATE_COMMAND, {});
  } catch (e) {
    return {
      ok: false,
      reason: "state-unavailable",
      message: `Impossible de lire l'état MCP (${String(e)}). Rien n'a été modifié : réessayez, ou passez par Paramètres → Serveurs MCP.`,
    };
  }
  const plan = planMcpServerToggle(state, request);
  if (!plan.ok) return plan;
  if (plan.changes.length === 0) return { ...plan, written: [] };
  let written;
  try {
    const res = await call(MCP_SET_SERVERS_ENABLED_COMMAND, { changes: plan.changes });
    written = res && Array.isArray(res.applied) ? res.applied : [];
    if (res && res.ok === false) {
      return {
        ok: false,
        reason: "write-refused",
        message: `Pilot a refusé le changement (${String(res.error || "raison inconnue")}). Rien n'a été modifié.`,
      };
    }
  } catch (e) {
    return {
      ok: false,
      reason: "write-failed",
      message: `Échec de l'enregistrement de l'état des serveurs MCP (${String(e)}). L'état précédent est conservé.`,
    };
  }
  return { ...plan, written };
}

/** Appel Tauri par défaut (import paresseux : ce module reste testable seul). */
function defaultInvoke(cmd, args) {
  return import("@tauri-apps/api/core").then((m) => m.invoke(cmd, args));
}
