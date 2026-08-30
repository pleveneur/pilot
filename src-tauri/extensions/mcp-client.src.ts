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
//   2. se connecte au PREMIER serveur `enabled` en transport `stdio` uniquement,
//   3. découvre tools/list et enregistre chaque outil sous `mcp_<serverId>_<name>`
//      via pi.registerTool (exécution qui redéclenche un callTool sur le serveur).
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

// Timeout de connexion au serveur stdio (ms). Garde-fou : un serveur absent ou
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
  const server = servers.find((s) => s.enabled !== false && s.transport === "stdio");
  if (!server || !server.command) {
    return; // Aucun serveur stdio enabled — fail-open.
  }

  const serverId = server.id ?? server.name ?? "mcp";

  // ── 2. Connexion stdio (avec garde-fou de timeout) ──
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args ?? [],
  });
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
        // Schéma dynamique inconnu à la compilation : on accepte n'importe quel
        // objet de propriétés (TypeBox externe, résolu par pi au runtime).
        parameters: Type.Record(Type.String(), Type.Unknown()),
        executionMode: "sequential",
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
          return runTool(client, toolName, params as Record<string, unknown>);
        },
      } as never);
    } catch {
      // Échec d'enregistrement (concurrence d'extensions) : fail-open.
    }
  }

  // ── Nettoyage à la fin de session (fermeture du process serveur stdio) ──
  api.on("session_shutdown", async () => {
    await safeClose(transport, client);
  });
}

// ── Utilitaires ──

async function runTool(
  client: Client,
  toolName: string,
  params: Record<string, unknown>
): Promise<{ content: { type: "text"; text: string }[] }> {
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
    return errorText(`MCP ${toolName} échec: ${String(err)}`);
  }
}

function errorText(msg: string): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: msg }] };
}

function formatMcpResult(res: unknown): {
  content: { type: "text"; text: string }[];
} {
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
    return { content: [{ type: "text", text: parts.join("\n") }] };
  } catch {
    return { content: [{ type: "text", text: JSON.stringify(res) }] };
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
  transport: StdioClientTransport,
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
