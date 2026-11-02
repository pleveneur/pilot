// mcp-tool-names.js — SEULE source du NOM des outils MCP exposés à l'agent.
//
// Module PUR (aucune I/O, aucun appel Tauri), testé en unitaire et partagé :
//   - par l'extension MCP (`src-tauri/extensions/mcp-client.src.ts`, bundlée
//     par esbuild → `pilot-mcp-client.ts`, généré) ;
//   - par les tests (`src/js/mcp-tool-names.test.js`).
//
// RÈGLE DE NOMMAGE (inchangée depuis le POC, elle ne doit pas bouger : des
// consignes d'agents s'appuient dessus) :
//     mcp_<identifiant du serveur>_<nom de l'outil chez le serveur>
//
// DEUX SITUATIONS, DEUX RÉPONSES (les deux cas restent séparés) :
//
// 1. Plusieurs serveurs chargés ENSEMBLE (la conversation de l'Assistant charge
//    tous les serveurs activés — décision du 2026-11-02). Deux serveurs
//    DIFFÉRENTS ne peuvent pas se disputer un nom d'outil : le nom porte
//    l'identifiant du serveur (`mcp_<id>_<outil>`). En revanche, deux entrées de
//    `mcp.json` qui portent le MÊME identifiant produiraient exactement les
//    mêmes noms : ce cas est EXPLICITE (`serverIdOwners` / `serverIdClashMessage`)
//    et, si les deux serveurs ont des identifiants distincts mais un outil de
//    même nom, `resolveToolNames` tranche en gardant le PREMIER serveur de la
//    configuration et en nommant le second — jamais un remplacement silencieux.
//
// 2. Dans un SEUL serveur : un `tools/list` qui déclare deux fois le même nom
//    d'outil. `pi.registerTool()` range les outils dans une table par nom
//    (dernier enregistré gagnant, sans message) : la première déclaration doit
//    donc être conservée et le doublon signalé, jamais remplacé en silence
//    (`duplicateToolNames` / `firstDeclarationOnly` / `duplicateToolNameMessage`).

/** Préfixe commun de tout outil MCP exposé à l'agent (ne pas changer). */
export const MCP_TOOL_NAME_PREFIX = "mcp_";

/** Séparateur entre l'identifiant du serveur et le nom de l'outil (ne pas changer). */
export const MCP_TOOL_NAME_SEPARATOR = "_";

/**
 * Identifiant de serveur utilisé dans le nom des outils : `id`, à défaut `name`,
 * à défaut `"mcp"` (résolution historique, reproduite à l'identique pour que
 * les noms déjà en service ne changent pas). Fonction pure.
 * @param {{id?: string, name?: string}|any} server
 * @returns {string}
 */
export function mcpServerId(server) {
  const s = server || {};
  const id = s.id ?? s.name ?? "mcp";
  return String(id);
}

/**
 * Nom sous lequel un outil MCP est enregistré chez pi. Fonction pure —
 * `registeredToolName("mcp-1", "echo") === "mcp_mcp-1_echo"`.
 * @param {string} serverId
 * @param {string} toolName
 * @returns {string}
 */
export function registeredToolName(serverId, toolName) {
  return `${MCP_TOOL_NAME_PREFIX}${String(serverId)}${MCP_TOOL_NAME_SEPARATOR}${String(toolName)}`;
}

/**
 * Libellé lisible d'un serveur pour les messages : son nom (et son identifiant
 * s'ils diffèrent), puis sa cible (adresse ou commande) — de quoi distinguer
 * deux entrées homonymes. Fonction pure.
 * @param {{id?: string, name?: string, url?: string, command?: string}|any} server
 * @returns {string}
 */
export function mcpServerLabel(server) {
  const s = server || {};
  const id = mcpServerId(s);
  const name = String(s.name ?? "").trim();
  const head = name && name !== id ? `${name} (${id})` : id;
  const target = String(s.url ?? "").trim() || String(s.command ?? "").trim();
  return target ? `${head} — ${target}` : head;
}

/**
 * Serveurs ACTIVÉS qui répondent au même identifiant de serveur que `serverId`
 * (donc qui produiraient exactement les mêmes noms d'outils). Retourne leurs
 * libellés : plus d'un libellé = cas ambigu. Fonction pure.
 * @param {{id?: string, name?: string, enabled?: boolean}[]} servers
 * @param {string} serverId
 * @returns {string[]}
 */
export function serverIdOwners(servers, serverId) {
  const wanted = String(serverId);
  return (Array.isArray(servers) ? servers : [])
    .filter((s) => s && s.enabled !== false && mcpServerId(s) === wanted)
    .map((s) => mcpServerLabel(s));
}

/** Assemble des libellés en une énumération française lisible. Fonction pure. */
function joinLabels(labels) {
  const list = (labels || []).map((l) => `« ${l} »`);
  if (list.length <= 1) return list[0] || "";
  return `${list.slice(0, -1).join(", ")} et ${list[list.length - 1]}`;
}

/**
 * Message expliquant qu'un identifiant de serveur est porté par plusieurs
 * serveurs activés (donc que leurs outils auraient le même nom), et quoi faire.
 * `null` s'il n'y a pas d'ambiguïté. Fonction pure.
 * @param {string} serverId
 * @param {string[]} owners  libellés renvoyés par `serverIdOwners`
 * @returns {string|null}
 */
export function serverIdClashMessage(serverId, owners) {
  const list = Array.isArray(owners) ? owners : [];
  if (list.length < 2) return null;
  const example = registeredToolName(serverId, "exemple");
  return (
    `Nom d'outil MCP ambigu : les serveurs ${joinLabels(list)} portent le même ` +
    `identifiant de serveur « ${serverId} ». Leurs outils porteraient donc ` +
    `exactement le même nom (par ex. « ${example} ») et rien ne dirait lequel ` +
    `des deux serveurs est appelé. Aucun serveur MCP n'est donc chargé pour ` +
    `cette session. Pour rétablir MCP : désactivez l'un des deux serveurs, ou ` +
    `donnez-leur des identifiants (id) différents dans mcp.json.`
  );
}

/**
 * Noms d'outils déclarés PLUSIEURS FOIS dans un même `tools/list` (ordre de
 * première apparition). Les entrées sans nom exploitable sont ignorées.
 * Fonction pure.
 * @param {{name?: string}[]} tools
 * @returns {string[]}
 */
export function duplicateToolNames(tools) {
  const seen = new Set();
  const duplicates = [];
  for (const tool of Array.isArray(tools) ? tools : []) {
    const name = String((tool && tool.name) ?? "");
    if (!name) continue;
    if (seen.has(name)) {
      if (!duplicates.includes(name)) duplicates.push(name);
      continue;
    }
    seen.add(name);
  }
  return duplicates;
}

/**
 * Ne garde que la PREMIÈRE déclaration de chaque nom d'outil (le dernier
 * enregistré écraserait sinon le premier sans le dire). Fonction pure.
 * @template T
 * @param {T[]} tools
 * @returns {T[]}
 */
export function firstDeclarationOnly(tools) {
  const seen = new Set();
  const kept = [];
  for (const tool of Array.isArray(tools) ? tools : []) {
    const name = String((tool && tool.name) ?? "");
    if (name) {
      if (seen.has(name)) continue;
      seen.add(name);
    }
    kept.push(tool);
  }
  return kept;
}

/**
 * Message expliquant que deux serveurs chargés ENSEMBLE exposeraient le même nom
 * d'outil enregistré, que le premier garde l'outil et que rien n'a été remplacé
 * en silence. `null` si un seul serveur est concerné. Fonction pure.
 * @param {string} registeredName  nom enregistré (`mcp_<id>_<outil>`)
 * @param {string[]} owners  identifiants des serveurs concernés, premier = gardien
 * @returns {string|null}
 */
export function crossServerToolClashMessage(registeredName, owners) {
  const list = Array.isArray(owners) ? owners.map((o) => String(o)) : [];
  if (list.length < 2) return null;
  return (
    `Deux serveurs MCP activés exposeraient le même nom d'outil « ${registeredName} » ` +
    `(serveurs ${joinLabels(list)}). Le PREMIER de la liste (mcp.json) garde cet ` +
    `outil ; celui de l'autre serveur n'est PAS exposé, et rien n'a été remplacé ` +
    `en silence. Pour l'exposer aussi, donnez aux deux outils des noms différents ` +
    `chez les serveurs (ou des identifiants de serveur différents).`
  );
}

/**
 * Répartit les noms d'outils de PLUSIEURS serveurs chargés ensemble.
 *
 * Entrée : `[{ serverId, tools: [{ name, … }] }]`, dans l'ordre où les serveurs
 * ont été chargés (au premier chargement : l'ordre de `mcp.json`). Sortie :
 *   - `entries` : les mêmes entrées, chaque `tools` réduit aux outils dont le nom
 *     n'est pas déjà pris par un serveur PRÉCÉDENT ;
 *   - `clashes` : `[{ name, owners }]` — les noms disputés, avec la liste des
 *     serveurs concernés (le premier est celui qui garde l'outil).
 *
 * Le nom disputé est le nom ENREGISTRÉ (`mcp_<id>_<outil>`), celui que pi range
 * dans sa table : c'est lui qui décide, jamais le nom brut. Fonction pure.
 * @param {{serverId: string, tools: {name?: string}[]}[]} entries
 * @returns {{entries: {serverId: string, tools: any[]}[], clashes: {name: string, owners: string[]}[]}}
 */
export function resolveToolNames(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const claims = new Map(); // nom enregistré → [serverId, …] dans l'ordre
  for (const entry of list) {
    const serverId = String((entry && entry.serverId) ?? "");
    for (const tool of Array.isArray(entry && entry.tools) ? entry.tools : []) {
      const name = String((tool && tool.name) ?? "");
      if (!name) continue;
      const registered = registeredToolName(serverId, name);
      const owners = claims.get(registered) || [];
      if (!owners.includes(serverId)) owners.push(serverId);
      claims.set(registered, owners);
    }
  }
  const winner = new Map(); // nom enregistré → serverId qui le garde
  const kept = list.map((entry) => ({
    serverId: String((entry && entry.serverId) ?? ""),
    tools: [],
  }));
  list.forEach((entry, index) => {
    const serverId = kept[index].serverId;
    for (const tool of Array.isArray(entry && entry.tools) ? entry.tools : []) {
      const name = String((tool && tool.name) ?? "");
      if (!name) {
        kept[index].tools.push(tool);
        continue;
      }
      const registered = registeredToolName(serverId, name);
      const owner = winner.get(registered);
      if (owner !== undefined && owner !== serverId) continue; // pris avant lui
      if (owner === undefined) winner.set(registered, serverId);
      kept[index].tools.push(tool);
    }
  });
  const clashes = [];
  for (const [name, owners] of claims) {
    if (owners.length > 1) clashes.push({ name, owners });
  }
  return { entries: kept, clashes };
}

/**
 * Message expliquant qu'un serveur déclare plusieurs fois le même outil, et
 * qu'un seul (le premier) est exposé. `null` si aucun doublon. Fonction pure.
 * @param {string} serverId
 * @param {string[]} names  noms renvoyés par `duplicateToolNames`
 * @returns {string|null}
 */
export function duplicateToolNameMessage(serverId, names) {
  const dup = Array.isArray(names) ? names.filter((n) => !!n) : [];
  if (dup.length === 0) return null;
  const exposed = registeredToolName(serverId, dup[0]);
  return (
    `Le serveur MCP « ${serverId} » déclare plusieurs fois ${joinLabels(dup)}. ` +
    `Seule la première déclaration de chacun est exposée (par ex. « ${exposed} ») : ` +
    `un outil n'en remplace pas un autre en silence.`
  );
}
