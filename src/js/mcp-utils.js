// mcp-utils.js — Helpers purs du client MCP (POC) — testés en unitaire.
//
// Ces fonctions sont PURES (aucune I/O, aucun appel Tauri) et utilisées par
// settings.js pour l'onglet « Serveurs MCP ». Elles sont isolées ici pour être
// testées sans mock (vitest).

/** Transport MCP supporté par le POC (unique — pas de http/sse). */
export const MCP_TRANSPORT = "stdio";

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
 * Valide un serveur MCP avant sauvegarde. Retourne une chaîne d'erreur, ou
 * null si le serveur est valide.
 * @param {{name?: string, command?: string}} server
 * @returns {string|null}
 */
export function validateServer(server) {
  const s = server || {};
  if (!String(s.name || "").trim()) return "Le nom du serveur est requis.";
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
 * Construit l'objet serveur MCP (format {id,name,transport,enabled,command,args})
 * à partir du formulaire. Le transport est toujours "stdio" (POC).
 * @param {string} id
 * @param {{name: string, command: string, argsText: string, enabled: boolean}[]|any} form
 * @returns {{id:string,name:string,transport:string,enabled:boolean,command:string,args:string[]}}
 */
export function buildServer(id, form) {
  return {
    id,
    name: String((form && form.name) || "").trim(),
    transport: MCP_TRANSPORT,
    // Le serveur est activé par défaut sauf désactivation explicite.
    enabled: (form && form.enabled === undefined) ? true : !!(form && form.enabled),
    command: String((form && form.command) || "").trim(),
    args: parseArgs((form && form.argsText) || ""),
  };
}
