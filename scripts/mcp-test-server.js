// mcp-test-server.js — Serveur MCP stdio MINIMAL pour le POC.
//
// Propose un seul outil `echo` : renvoie le texte passé en argument (permet de
// prouver la connexion client↔serveur MCP, la découverte tools/list et l'appel
// callTool). À lancer de façon autonome par l'extension MCP client de Pilot :
//
//   node scripts/mcp-test-server.js
//
// Format du mcp.json attendu (configuré via la commande `mcp_save_servers`) :
// {
//   "servers": [
//     {
//       "id": "test",
//       "name": "Test MCP Server",
//       "transport": "stdio",
//       "enabled": true,
//       "command": "node",
//       "args": ["scripts/mcp-test-server.js"]
//     }
//   ]
// }

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  {
    name: "pilot-mcp-test-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "echo",
        description:
          "Renvoie le texte fourni dans l'argument `text`. Sert de preuve de connexion MCP client↔serveur.",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", description: "Le texte à renvoyer" },
          },
          required: ["text"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = request.params.arguments ?? {};

  if (name === "echo") {
    return {
      content: [
        {
          type: "text",
          text: `pong: ${String(args.text ?? "")}`,
        },
      ],
    };
  }

  return {
    content: [{ type: "text", text: `Outil MCP inconnu: ${name}` }],
    isError: true,
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Le transport stdio garde le process vivant tant que stdin/stdout sont ouverts.
}

main().catch((err) => {
  console.error("[mcp-test-server] Erreur:", err);
  process.exit(1);
});
