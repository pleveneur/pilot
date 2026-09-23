// scripts/mcp-test-server-http.js — Serveur MCP HTTP MINIMAL (test hors ligne du
// bouton « Tester la connexion » d'un serveur MCP DISTANT, étape E4).
//
// À lancer soi-même : Pilot ne le lance JAMAIS.
//
// Usage :
//   node scripts/mcp-test-server-http.js               # réponse JSON (port 8787)
//   node scripts/mcp-test-server-http.js --sse         # réponse en flux d'événements
//   node scripts/mcp-test-server-http.js --port 9000
//
// Puis dans Pilot : ajouter un serveur MCP distant d'adresse
//   http://127.0.0.1:8787/mcp
// et cliquer « Tester la connexion ». La clé, si renseignée, arrive dans
// l'en-tête `Authorization: Bearer …` (jamais dans l'adresse). Elle n'est
// jamais journalisée ici (masquée).

import http from "node:http";

const args = process.argv.slice(2);
const sse = args.includes("--sse");
const portArg = args.indexOf("--port");
const port = portArg >= 0 ? Number(args[portArg + 1]) : 8787;

const server = http.createServer((req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Méthode non supportée" }));
    return;
  }
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    let msg = {};
    try {
      msg = JSON.parse(body || "{}");
    } catch {
      /* corps illisible : on répond une erreur JSON-RPC générique */
    }
    const auth = String(req.headers["authorization"] || "(aucune clé)");
    console.log(
      `[mcp-test-server-http] ${msg.method || "?"} — Authorization: ${
        auth.startsWith("Bearer ") ? "Bearer ***" : auth
      }`
    );
    if (msg.method === "initialize") {
      const payload = {
        jsonrpc: "2.0",
        id: msg.id ?? 1,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "pilot-mcp-test-http", version: "0.1.0" },
        },
      };
      if (sse) {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        });
        res.write(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
        res.end();
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      }
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id ?? 1, result: {} }));
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(
    `[mcp-test-server-http] serveur MCP de test sur http://127.0.0.1:${port}/mcp` +
      (sse ? " (flux d'événements)" : " (JSON)")
  );
});
