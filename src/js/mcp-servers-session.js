// mcp-servers-session.js — QUELLE LISTE DE SERVEURS MCP UNE SESSION CHARGE.
//
// Module PUR (aucune I/O, aucun appel Tauri, aucun DOM), partagé par l'extension
// MCP (`src-tauri/extensions/mcp-client.src.ts`) et par les tests. Il est le SEUL
// endroit qui décide :
//   - quels serveurs sont ACTIVÉS (`enabled !== false`, la règle historique de
//     `mcp.json`) ;
//   - que DEUX entrées de `mcp.json` portant le MÊME identifiant sont refusées
//     ENSEMBLE (leurs outils porteraient exactement le même nom) ;
//   - et, quand `PILOT_MCP_SERVER` désigne un serveur, que la session ne charge
//     que CELUI-LÀ (comportement historique des agents, inchangé).
//
// DÉCISION DU PROPRIÉTAIRE (2026-11-02) : la conversation de l'Assistant ne se
// limite plus à « un serveur à la fois ». Sans `PILOT_MCP_SERVER`, la session
// charge TOUS les serveurs activés — l'Assistant choisit ensuite lequel utiliser
// en raisonnant, jamais parce qu'un seul serait branché. Un serveur DÉSACTIVÉ
// n'est jamais chargé (ni au démarrage, ni au rafraîchissement).
//
// Rien ici ne connaît une adresse, une commande, une variable d'environnement ni
// une clé : les messages ne nomment que l'IDENTIFIANT du serveur.

/** Politique de session : tous les serveurs activés. */
export const MCP_SESSION_ALL = "all";
/** Politique de session : un serveur désigné (`PILOT_MCP_SERVER`). */
export const MCP_SESSION_TARGET = "target";
/** Politique de session : rien à charger. */
export const MCP_SESSION_NONE = "none";

/**
 * Serveurs ACTIVÉS de la configuration, dans l'ordre de `mcp.json`.
 * Règle historique conservée : `enabled !== false` (une entrée sans champ
 * `enabled` est active — c'est ce que faisaient déjà l'extension et Rust).
 * Fonction pure.
 * @param {{servers?: any[]}|any} config
 * @returns {any[]}
 */
export function mcpEnabledServers(config) {
  const servers = (config && Array.isArray(config.servers) && config.servers) || [];
  return servers.filter((s) => s && s.enabled !== false);
}

/** Identifiant de serveur utilisé dans les noms d'outils (copie de la règle
 * historique `id ?? name ?? "mcp"`, sans import croisé : ce module ne dépend de
 * rien pour rester utilisable seul). Fonction pure. */
function serverIdOf(server) {
  const s = server || {};
  return String(s.id ?? s.name ?? "mcp");
}

/**
 * Regroupe les serveurs activés par identifiant. Deux entrées (ou plus) sur le
 * même identifiant produiraient les mêmes noms d'outils : le groupe est signalé
 * et AUCUN de ses membres n'est chargé. `owners` porte un libellé lisible par
 * entrée (son nom s'il diffère de l'identifiant, l'identifiant sinon) pour que le
 * message puisse désigner LESQUELLES sont en cause. Fonction pure.
 * @param {any[]} servers
 * @returns {{id: string, owners: string[]}[]}
 */
export function mcpAmbiguousServerIds(servers) {
  const groups = new Map();
  for (const server of Array.isArray(servers) ? servers : []) {
    const id = serverIdOf(server);
    const name = String((server && server.name) ?? "").trim();
    const label = name && name !== id ? `${name} (${id})` : id;
    const list = groups.get(id) || [];
    list.push(label);
    groups.set(id, list);
  }
  const ambiguous = [];
  for (const [id, owners] of groups) {
    if (owners.length > 1) ambiguous.push({ id, owners: owners.slice() });
  }
  return ambiguous;
}

/**
 * Décide la liste des serveurs à charger pour une session.
 *
 * `options.target` = identifiant passé par Pilot dans `PILOT_MCP_SERVER` :
 *   - non vide → politique `target` : ce serveur s'il est activé et non ambigu,
 *     sinon RIEN (l'appelant garde son repli historique sur le premier activé) ;
 *   - vide → politique `all` : tous les serveurs activés non ambigus.
 *
 * Le résultat porte aussi les ambiguïtés, pour que l'appelant les EXPLIQUE au
 * lieu de les ignorer en silence. Fonction pure (l'entrée n'est pas modifiée).
 * @param {{servers?: any[]}|any} config
 * @param {{target?: string}} [options]
 * @returns {{mode: string, targetId: string, servers: any[], ambiguous: {id: string, owners: string[]}[]}}
 */
export function planMcpSessionServers(config, options = {}) {
  const target = String((options && options.target) ?? "").trim();
  const enabled = mcpEnabledServers(config);
  const ambiguous = mcpAmbiguousServerIds(enabled);
  const refused = new Set(ambiguous.map((a) => a.id));

  if (target) {
    const hit = enabled.find((s) => serverIdOf(s) === target && !refused.has(target));
    return {
      mode: hit ? MCP_SESSION_TARGET : MCP_SESSION_NONE,
      targetId: target,
      servers: hit ? [hit] : [],
      ambiguous,
    };
  }

  const servers = enabled.filter((s) => !refused.has(serverIdOf(s)));
  return {
    mode: servers.length > 0 ? MCP_SESSION_ALL : MCP_SESSION_NONE,
    targetId: "",
    servers,
    ambiguous,
  };
}

/**
 * Différence entre la liste voulue et l'état déjà chargé : quoi charger, quoi
 * retirer. Un serveur déjà en cours de connexion n'est jamais relancé (une seule
 * tentative à la fois). Fonction pure.
 * @param {{servers: any[]}} plan
 * @param {{loaded?: string[], loading?: string[]}} [state]
 * @returns {{load: any[], drop: string[]}}
 */
export function planMcpRefresh(plan, state = {}) {
  const servers = (plan && Array.isArray(plan.servers) && plan.servers) || [];
  const loaded = new Set(Array.isArray(state && state.loaded) ? state.loaded : []);
  const loading = new Set(Array.isArray(state && state.loading) ? state.loading : []);
  const wanted = new Set(servers.map(serverIdOf));
  const load = servers.filter((s) => {
    const id = serverIdOf(s);
    return !loaded.has(id) && !loading.has(id);
  });
  const drop = [...loaded].filter((id) => !wanted.has(id));
  return { load, drop };
}

/**
 * Empreinte de ce qui détermine une CONNEXION (type, cible, arguments,
 * environnement, référence de clé). Sert uniquement à décider s'il faut
 * RÉESSAYER un serveur qui avait échoué : une fiche modifiée est retentée, une
 * fiche inchangée ne l'est pas (aucune attente répétée à chaque tour). Jamais
 * affichée, jamais journalisée. Fonction pure.
 * @param {any} server
 * @returns {string}
 */
export function mcpServerFingerprint(server) {
  const s = server || {};
  const env = s.env && typeof s.env === "object" ? Object.keys(s.env).sort() : [];
  const parts = [
    String(s.transport ?? ""),
    String(s.command ?? ""),
    JSON.stringify(Array.isArray(s.args) ? s.args : []),
    String(s.url ?? ""),
    String(s.secret_ref ?? ""),
    env.join(","),
    s.screen === true ? "screen" : "",
  ];
  return parts.join("\u0000");
}

/**
 * Vrai si ce serveur est encore ACTIVÉ dans la configuration relue. Utilisé au
 * moment d'un appel d'outil : un serveur désactivé pendant la conversation ne
 * doit plus rien exécuter, même si son outil est encore dans la liste du modèle.
 * Fonction pure.
 * @param {{servers?: any[]}|any} config
 * @param {string} serverId
 * @returns {boolean}
 */
export function mcpServerStillEnabled(config, serverId) {
  const wanted = String(serverId ?? "");
  return mcpEnabledServers(config).some((s) => serverIdOf(s) === wanted);
}

/**
 * Message expliquant que deux serveurs activés portent le même identifiant, donc
 * que leurs outils auraient exactement le même nom : aucun des deux n'est chargé,
 * les autres serveurs activés restent disponibles. Ne nomme que les identifiants
 * (aucune adresse, aucune commande, aucune clé). Fonction pure.
 * @param {string} id
 * @param {string[]} [owners]
 * @returns {string}
 */
export function mcpAmbiguousIdNotice(id, owners) {
  const names = Array.isArray(owners) ? owners.filter((o) => typeof o === "string" && o) : [];
  const count = Math.max(2, names.length || 2);
  const lesquels = names.length > 1 ? ` (${names.join(", ")})` : "";
  return (
    `MCP : ${count} serveurs activés portent le même identifiant « ${id} »${lesquels}. ` +
    `Leurs outils porteraient exactement le même nom (mcp_${id}_…), donc AUCUN ` +
    `des deux n'est chargé — les autres serveurs activés restent disponibles et ` +
    `la conversation continue. Pour rétablir : désactivez-en un ou donnez-leur ` +
    `des identifiants différents (Options → Serveurs MCP).`
  );
}

/**
 * Message clair pour un serveur qui n'a pas pu être chargé. Le serveur n'est
 * jamais retenté en boucle : la conversation continue avec les autres. Ne nomme
 * que l'identifiant du serveur. Fonction pure.
 * @param {string} id
 * @param {"timeout"|"connect"|"no-command"|"no-url"|"bad-url"} kind
 * @returns {string}
 */
export function mcpServerUnavailableNotice(id, kind) {
  const name = `« ${id} »`;
  switch (kind) {
    case "timeout":
      return (
        `MCP : le serveur ${name} ne répond pas (délai dépassé) — il n'est pas chargé. ` +
        `Les autres serveurs activés restent disponibles et la conversation continue.`
      );
    case "no-command":
      return (
        `MCP : le serveur ${name} n'a pas de commande à lancer — il n'est pas chargé. ` +
        `Les autres serveurs activés restent disponibles.`
      );
    case "no-url":
    case "bad-url":
      return (
        `MCP : le serveur ${name} n'a pas d'adresse utilisable — il n'est pas chargé. ` +
        `Les autres serveurs activés restent disponibles.`
      );
    default:
      return (
        `MCP : le serveur ${name} est injoignable — il n'est pas chargé. ` +
        `Les autres serveurs activés restent disponibles et la conversation continue.`
      );
  }
}

/**
 * Message rendu au modèle quand un outil MCP est appelé alors que son serveur
 * n'est plus chargé (désactivé depuis les Options, ou retiré de la liste). Le
 * modèle reçoit une phrase ACTIONNABLE, jamais une erreur technique. Fonction
 * pure.
 * @param {string} id
 * @param {string} registeredName  nom de l'outil tel qu'exposé (`mcp_<id>_<outil>`)
 * @returns {string}
 */
export function mcpToolUnavailableMessage(id, registeredName) {
  return (
    `L'outil ${registeredName} n'est pas disponible : le serveur MCP « ${id} » est ` +
    `désactivé. Aucun appel n'a été envoyé. Réactivez-le dans les Options → ` +
    `Serveurs MCP (ou demandez-le à l'utilisateur), puis réessayez au tour suivant.`
  );
}

/**
 * Message d'information quand AUCUN serveur n'est activé : l'Assistant doit le
 * savoir pour ne pas promettre une action impossible. Fonction pure.
 * @returns {string}
 */
export function mcpNoServerNotice() {
  return (
    "MCP : aucun serveur n'est activé, donc aucun outil MCP n'est disponible. " +
    "Activez-en un dans les Options → Serveurs MCP."
  );
}
