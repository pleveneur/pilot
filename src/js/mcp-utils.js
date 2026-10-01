// mcp-utils.js — Helpers purs du client MCP (POC) — testés en unitaire.
//
// Ces fonctions sont PURES (aucune I/O, aucun appel Tauri) et utilisées par
// settings.js pour l'onglet « Serveurs MCP ». Elles sont isolées ici pour être
// testées sans mock (vitest).

/** Transports MCP supportés : local (commande) et distant (adresse réseau). */
export const MCP_TRANSPORT_STDIO = "stdio";
export const MCP_TRANSPORT_HTTP = "http";

/** Transport par défaut d'un nouveau serveur : local (stdio), comme avant. */
export const MCP_TRANSPORT = MCP_TRANSPORT_STDIO;

/**
 * Vrai si le transport désigne un serveur distant (`http`/`https`). Toute
 * autre valeur (y compris vide ou inconnue) est traitée comme locale, comme
 * coté Rust (`McpServer::transport_kind`). Fonction pure.
 * @param {string} transport
 * @returns {boolean}
 */
export function isRemoteTransport(transport) {
  const t = String(transport || "").trim().toLowerCase();
  return t === MCP_TRANSPORT_HTTP || t === "https";
}

/**
 * Découpe une chaîne d'arguments en tableau, en préservant les groupes entre
 * guillemets simples ou doubles. Retourne toujours un tableau (défaut []).
 * @param {string} text
 * @returns {string[]}
 */
export function parseArgs(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return [];
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  const out = [];
  let m;
  while ((m = re.exec(trimmed)) !== null) {
    if (m[1] !== undefined) out.push(m[1].replace(/\\"/g, '"'));
    else if (m[2] !== undefined) out.push(m[2].replace(/\\'/g, "'"));
    else if (m[3] !== undefined) out.push(m[3]);
  }
  return out;
}

/**
 * Série un tableau d'arguments en une chaîne lisible (chaque argument contenant
 * un espace ou une guillemet est encadré de guillemets doubles échappées).
 * @param {string[]} args
 * @returns {string}
 */
export function formatArgs(args) {
  return (Array.isArray(args) ? args : [])
    .map((a) => {
      const s = String(a);
      if (/[\s"'\\]/.test(s)) return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
      return s;
    })
    .join(" ");
}

/**
 * Découpe un texte de variables d'environnement (une déclaration « NOM=valeur »
 * par ligne) en objet. Les lignes vides et les commentaires `#` sont ignorés,
 * comme les lignes sans `=` ou sans nom. Fonction pure.
 * @param {string} text
 * @returns {Record<string,string>}
 */
export function parseEnv(text) {
  const out = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i < 1) continue;
    const name = trimmed.slice(0, i).trim();
    if (!name) continue;
    out[name] = trimmed.slice(i + 1).trim();
  }
  return out;
}

/**
 * Série un objet de variables d'environnement en texte « NOM=valeur », une
 * déclaration par ligne (inverse de `parseEnv`). Fonction pure.
 * @param {Record<string,string>|undefined} env
 * @returns {string}
 */
export function formatEnv(env) {
  if (!env || typeof env !== "object") return "";
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

/**
 * Valide un serveur MCP avant sauvegarde, PAR TYPE : un serveur distant exige
 * une adresse, un serveur local une commande. Retourne une chaîne d'erreur, ou
 * null si le serveur est valide.
 * @param {{name?: string, transport?: string, command?: string, url?: string}} server
 * @returns {string|null}
 */
export function validateServer(server) {
  const s = server || {};
  if (!String(s.name || "").trim()) return "Le nom du serveur est requis.";
  if (isRemoteTransport(s.transport)) {
    if (!String(s.url || "").trim()) return "L'adresse du serveur distant est requise.";
    return null;
  }
  if (!String(s.command || "").trim()) return "La commande du serveur est requise.";
  return null;
}

/**
 * Génère un id de serveur libre (`mcp-N`) en évitant les collisions.
 * @param {{id?: string}[]} existing
 * @returns {string}
 */
export function newServerId(existing) {
  const ids = new Set((existing || []).map((s) => s && s.id));
  let n = 1;
  while (ids.has(`mcp-${n}`)) n++;
  return `mcp-${n}`;
}

/**
 * Normalise le résultat de `mcp_test_connection` ({ok, server, error}).
 * Retourne toujours `{ ok: boolean, error: string }`.
 * @param {any} payload
 * @returns {{ok: boolean, error: string}}
 */
export function testResult(payload) {
  return {
    ok: !!(payload && payload.ok),
    error: (payload && payload.error) || "",
  };
}

/**
 * Construit l'objet serveur MCP (format
 * {id,name,transport,enabled,command,args,env,url,secret_ref}) à partir du
 * formulaire. Le transport est `stdio` (local) par défaut : un formulaire sans
 * type reste donc rétrocompatible avec la configuration existante.
 * La référence de clé (`secret_ref`) n'est jamais la clé elle-même, seulement
 * l'entrée du coffre ; elle n'est conservée que pour un serveur distant. Les
 * variables d'environnement ne concernent que le serveur local (elles sont
 * transmises au programme lancé).
 * @param {string} id
 * @param {{name?: string, transport?: string, command?: string, argsText?: string, envText?: string, url?: string, secretRef?: string, enabled?: boolean}|any} form
 * @returns {{id:string,name:string,transport:string,enabled:boolean,command:string,args:string[],env:Record<string,string>,url:string,secret_ref:string|null}}
 */
export function buildServer(id, form) {
  const f = form || {};
  const transport = String(f.transport || MCP_TRANSPORT).trim().toLowerCase() || MCP_TRANSPORT;
  const remote = isRemoteTransport(transport);
  return {
    id,
    name: String(f.name || "").trim(),
    transport,
    // Le serveur est activé par défaut sauf désactivation explicite.
    enabled: f.enabled === undefined ? true : !!f.enabled,
    // Serveur local : commande + arguments ; serveur distant : vides.
    command: remote ? "" : String(f.command || "").trim(),
    args: remote ? [] : parseArgs(f.argsText || ""),
    // Variables d'environnement : seulement pour un serveur local (transmises
    // au programme lancé par Pilot/pi).
    env: remote ? {} : parseEnv(f.envText || ""),
    // Serveur distant : adresse + référence de coffre (jamais la clé).
    url: remote ? String(f.url || "").trim() : "",
    secret_ref: remote ? String(f.secretRef || "").trim() || null : null,
  };
}
