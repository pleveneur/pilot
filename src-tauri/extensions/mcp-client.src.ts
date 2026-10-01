// mcp-client.src.ts — PILOT MCP CLIENT (SOURCE).
//
// SOURCE éditable à la main. Le fichier embarqué réel est
// `src-tauri/extensions/pilot-mcp-client.ts`, GÉNÉRÉ par esbuild à partir de ce
// fichier (`npm run build:mcp` → scripts/build-mcp-extension.js). Ne jamais
// modifier le fichier généré directement.
//
// Ce POC prouve que Pilot peut se connecter à un serveur MCP tier via une
// extension pi, en embarquant le SDK MCP (@modelcontextprotocol/sdk) BUNDLÉ.
// L'extension :
//   1. lit la config via process.env.PILOT_MCP_CONFIG (chemin d'un mcp.json —
//      Pilot le renseigne à la création du process pi, PAS via AppConfig),
//   2. choisit le serveur : `process.env.PILOT_MCP_SERVER` (id d'un serveur
//      cible, posé à la demande par l'assistant via run_agents / mcp_server)
//      s'il correspond à un serveur `enabled` — sinon retombe sur le PREMIER
//      serveur `enabled` (mêmes règles que `select_session_server` côté Rust),
//   3. choisit le transport selon le type du serveur : local (`stdio` =
//      programme) ou distant (`http`/`https` = adresse réseau, clé d'accès
//      présentée en EN-TÊTE `Authorization` via PILOT_MCP_SECRET — E2),
//   4. découvre tools/list et enregistre chaque outil sous
//      `mcp_<serverId>_<name>` via pi.registerTool (exécution qui redéclenche un
//      callTool sur le serveur).
//
// Fail-open : toute erreur (config absente, serveur indisponible, tools/list en
// échec) est interceptée — pi ne doit jamais planter à cause d'une extension MCP.
//
// NOTE : la factory des extensions pi ne reçoit AUCUN `ctx` UI (le `ctx` n'est
// fourni que dans les event handlers / tool execute). Ce POC reste donc MUET
// (fail-open silencieux) pour ne dépendre d'aucune surface UI non garantie.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
// Le SDK MCP est bundlé (external uniquement pour pi-coding-agent et typebox).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

// Timeout de connexion au serveur MCP (ms). Garde-fou : un serveur absent ou
// bloquant ne doit pas geler le démarrage de la session pi (fail-open).
const CONNECT_TIMEOUT_MS = 8000;
// Timeout d'un appel outil (callTool) une fois connecté.
const CALL_TIMEOUT_MS = 60000;

// Structure d'un serveur dans mcp.json (miroir de src-tauri/src/mcp_config.rs).
interface McpServerConfig {
  id?: string;
  name?: string;
  transport?: string;
  enabled?: boolean;
  command?: string;
  args?: string[];
  url?: string;
}

interface McpConfig {
  servers?: McpServerConfig[];
}

export default async function (api: ExtensionAPI): Promise<void> {
  // ── 1. Lecture de la config MCP via la variable d'environnement ──
  const configPath = process.env.PILOT_MCP_CONFIG;
  if (!configPath) {
    return; // MCP désactivé — fail-open silencieux.
  }

  let config: McpConfig;
  try {
    const raw = await readFileText(configPath);
    config = JSON.parse(raw) as McpConfig;
  } catch {
    return; // Config illisible — fail-open.
  }

  const servers = config.servers ?? [];
  // Serveur cible (brique B) : si PILOT_MCP_SERVER désigne un serveur enabled de
  // la config, on le prend ; sinon fail-back sur le 1er enabled. Mêmes règles
  // que `select_session_server` côté Rust : la clé transmise par Pilot (E2) est
  // celle du serveur que l'extension retient ici.
  const targetId = (process.env.PILOT_MCP_SERVER || "").trim();
  const enabledServers = servers.filter((s) => s.enabled !== false);
  const server =
    (targetId
      ? enabledServers.find((s) => (s.id ?? "") === targetId)
      : undefined) ?? enabledServers[0];
  if (!server) {
    return; // Aucun serveur enabled (ni cible valide) — fail-open.
  }

  const serverId = server.id ?? server.name ?? "mcp";

  // ── 2. Choix du transport selon le type du serveur (E3) ──
  // `http` / `https` = serveur distant joignable par le réseau ; toute autre
  // valeur reste un serveur local (programme), comportement du POC inchangé.
  const transportName = (server.transport ?? "").trim().toLowerCase();
  const isRemote = transportName === "http" || transportName === "https";
  // Clé d'accès du serveur distant (posée par Pilot, E2). Elle est présentée
  // dans un EN-TÊTE d'authentification : JAMAIS dans l'adresse, jamais
  // journalisée, jamais renvoyée au modèle (cf. redactSecret).
  const secret = (process.env.PILOT_MCP_SECRET || "").trim();

  let transport: Transport;
  try {
    if (isRemote) {
      const url = (server.url ?? "").trim();
      if (!url) {
        return; // Serveur distant sans adresse — fail-open.
      }
      transport = new StreamableHTTPClientTransport(new URL(url), {
        requestInit: secret
          ? { headers: { Authorization: `Bearer ${secret}` } }
          : undefined,
      });
    } else {
      if (!server.command) {
        return; // Serveur local sans commande — fail-open.
      }
      transport = new StdioClientTransport({
        command: server.command,
        args: server.args ?? [],
      });
    }
  } catch {
    return; // Adresse illisible — fail-open.
  }

  const client = new Client({ name: "pilot-mcp", version: "0.1.0" });

  let discovered: Array<{ name: string; description?: string; inputSchema?: unknown }> = [];
  try {
    await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, "MCP handshake");
    const toolsResult = await withTimeout(
      client.listTools(),
      CONNECT_TIMEOUT_MS,
      "MCP tools/list"
    );
    discovered = (toolsResult.tools ?? []) as typeof discovered;
  } catch {
    // Fail-open : on ne fait jamais planter pi, on ne bloque pas le démarrage.
    await safeClose(transport, client);
    return;
  }

  // ── 3. Enregistrement d'un outil pi par outil MCP découvert ──
  for (const tool of discovered) {
    const toolName = tool.name;
    const registeredName = `mcp_${serverId}_${toolName}`;
    const description =
      tool.description ?? `Outil MCP \`${toolName}\` fourni par le serveur \`${serverId}\`.`;

    try {
      api.registerTool({
        name: registeredName,
        label: `MCP ${toolName}`,
        description,
        promptSnippet: `${registeredName}: appeler l'outil MCP ${toolName}`,
        promptGuidelines: [
          `Use ${registeredName} to call the MCP tool \`${toolName}\` on the "${serverId}" server. Pass the arguments expected by the MCP tool (as an object of properties). Results are returned as text (JSON where applicable).`,
        ],
        // Schéma RÉEL déclaré par le serveur MCP (`tools/list` → `inputSchema`) :
        // sans lui, l'agent ne voit ni les noms des paramètres ni leurs types et
        // appelle l'outil au hasard.
        parameters: toolParametersSchema(tool.inputSchema),
        executionMode: "sequential",
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
          return runTool(client, toolName, params as Record<string, unknown>, secret);
        },
      } as never);
    } catch {
      // Échec d'enregistrement (concurrence d'extensions) : fail-open.
    }
  }

  // ── Nettoyage à la fin de session (fermeture du serveur local ou distant) ──
  api.on("session_shutdown", async () => {
    await safeClose(transport, client);
  });
}

// ── Utilitaires ──

/// Schéma TypeBox des paramètres d'un outil MCP, construit depuis le JSON Schema
/// `inputSchema` annoncé par le serveur (`tools/list`). Le schéma est transmis
/// tel quel (`Type.Unsafe`) : le modèle voit alors les vrais noms de paramètres
/// et leurs types. Un schéma absent ou non-objet retombe sur le schéma générique
/// historique (fail-open : l'outil reste appelable).
function toolParametersSchema(inputSchema: unknown) {
  const schema = inputSchema as { type?: string } | null;
  if (schema && typeof schema === "object" && schema.type === "object") {
    try {
      return Type.Unsafe(schema as never);
    } catch {
      // TypeBox indisponible/incompatible → repli générique ci-dessous.
    }
  }
  return Type.Record(Type.String(), Type.Unknown());
}

async function runTool(
  client: Client,
  toolName: string,
  params: Record<string, unknown>,
  secret: string
): Promise<{ content: { type: "text"; text: string }[]; isError: boolean }> {
  if (!client) {
    return errorText("Client MCP non connecté.");
  }
  try {
    const res = await withTimeout(
      client.callTool({ name: toolName, arguments: params }),
      CALL_TIMEOUT_MS,
      `MCP call ${toolName}`
    );
    return formatMcpResult(res);
  } catch (err) {
    // Masquage avant tout retour à l'agent : une erreur ne doit jamais
    // transporter la clé d'accès.
    return errorText(redactSecret(`MCP ${toolName} échec: ${String(err)}`, secret));
  }
}

/// Retire toute occurrence de la clé d'un texte (erreur renvoyée à l'agent).
function redactSecret(text: string, secret: string): string {
  if (!secret) {
    return text;
  }
  return text.split(secret).join("[clé masquée]");
}

// Une erreur locale de l'outil MCP (client absent, exception, échec de
// callTool) est toujours signalée comme telle à l'agent (`isError`).
function errorText(msg: string): {
  content: { type: "text"; text: string }[];
  isError: boolean;
} {
  return { content: [{ type: "text", text: msg }], isError: true };
}

function formatMcpResult(res: unknown): {
  content: { type: "text"; text: string }[];
  isError: boolean;
} {
  // Un outil MCP signale son échec DANS le résultat (`isError: true`), pas par
  // une erreur de protocole : sans propagation de ce drapeau, un refus arrive à
  // l'agent comme une réussite.
  const isError = (res as { isError?: unknown } | null)?.isError === true;
  try {
    const r = res as {
      content?: Array<{ type?: string; text?: string; [k: string]: unknown }>;
      structuredContent?: unknown;
    };
    const parts: string[] = [];
    if (Array.isArray(r.content)) {
      for (const c of r.content) {
        if (typeof c.text === "string") {
          parts.push(c.text);
        } else if (c.type === "json") {
          parts.push(JSON.stringify(c, null, 2));
        } else {
          parts.push(JSON.stringify(c));
        }
      }
    }
    if (r.structuredContent !== undefined) {
      parts.push(JSON.stringify(r.structuredContent, null, 2));
    }
    if (parts.length === 0) {
      parts.push(JSON.stringify(res));
    }
    return { content: [{ type: "text", text: parts.join("\n") }], isError };
  } catch {
    return { content: [{ type: "text", text: JSON.stringify(res) }], isError };
  }
}

async function readFileText(path: string): Promise<string> {
  // node:fs/promises disponible dans l'environnement pi (node runtime).
  const fs = await import("node:fs/promises");
  return fs.readFile(path, "utf8");
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout (${ms}ms): ${what}`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

async function safeClose(
  transport: Transport,
  client: Client | null
): Promise<void> {
  try {
    if (client) {
      await client.close();
    }
  } catch {
    /* ignore */
  }
  try {
    await transport.close();
  } catch {
    /* ignore */
  }
}
