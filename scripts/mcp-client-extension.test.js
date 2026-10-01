// mcp-client-extension.test.js — filet de sécurité de l'extension MCP (E3).
//
// L'extension n'a pas de structure de test propre : elle est bundlée par esbuild
// (`npm run build:mcp`) et tourne dans le process `pi`. On contrôle donc la
// SOURCE `src-tauri/extensions/mcp-client.src.ts` : le transport distant doit
// être branché, et la clé (`PILOT_MCP_SECRET`) ne doit pouvoir apparaître que
// dans l'en-tête d'authentification ou dans le masquage des erreurs.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(here, "../src-tauri/extensions/mcp-client.src.ts");
const src = readFileSync(SOURCE, "utf8");
const secretLines = src.split("\n").filter((l) => l.includes("secret"));

/// Extrait le texte de la source entre deux marqueurs (test chirurgical : on ne
/// dépend que des noms de fonctions, pas des numéros de ligne).
function slice(from, to) {
  const start = src.indexOf(from);
  const end = src.indexOf(to);
  expect(start, `marqueur absent : ${from}`).toBeGreaterThanOrEqual(0);
  expect(end, `marqueur absent : ${to}`).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("extension MCP — second transport (E3)", () => {
  it("importe et construit le transport HTTP distant du SDK (sans nouvelle dépendance)", () => {
    expect(src).toContain('from "@modelcontextprotocol/sdk/client/streamableHttp.js"');
    expect(src).toMatch(/new StreamableHTTPClientTransport\(/);
  });

  it("choisit le transport selon le type du serveur", () => {
    // distant = adresse réseau ; local = programme (comportement inchangé).
    expect(src).toMatch(/transportName === "http" \|\| transportName === "https"/);
    expect(src).toMatch(/new URL\(url\)/);
    expect(src).toMatch(/new StdioClientTransport\(\{\s*command: server\.command,\s*args: server\.args \?\? \[\],/);
  });

  it("transmet les variables d'environnement déclarées au serveur local (tâche 308)", () => {
    // Sans cette transmission, un serveur maison qui exige un réglage (jeton,
    // chemin…) refuse de démarrer et l'agent ne voit aucun outil.
    expect(src).toMatch(/env: \{ \.\.\.process\.env, \.\.\.\(server\.env \?\? \{\}\) \}/);
  });

  it("présente la clé en EN-TÊTE, jamais dans l'adresse", () => {
    expect(src).toMatch(/headers: \{ Authorization: `Bearer \$\{secret\}` \}/);
    expect(src).not.toMatch(/new URL\([^)]*secret/);
    expect(src).not.toMatch(/url[^\n]*\$\{secret\}/i);
  });

  it("ne journalise jamais la clé, la masque dans les erreurs renvoyées à l'agent", () => {
    expect(src).not.toMatch(/console\./);
    expect(src).toMatch(/redactSecret\(`MCP \$\{toolName\} échec: \$\{String\(err\)\}`, secret\)/);
  });

  it("n'utilise la clé nulle part ailleurs que dans les emplacements autorisés", () => {
    // Invariant : aucune ligne portant le secret ne doit l'envoyer au modèle
    // (description / promptSnippet / promptGuidelines), le journaliser (console /
    // logger), ni le lever dans une erreur. Une erreur ne peut le citer que si
    // elle passe par redactSecret.
    for (const line of secretLines) {
      expect(line, `ligne suspecte : ${line}`).not.toMatch(/console\.|\blogger\b|\bthrow\b/);
      expect(line, `ligne suspecte : ${line}`).not.toMatch(/description|promptSnippet|promptGuidelines/);
      if (line.includes("errorText(")) {
        expect(line).toContain("redactSecret(");
      }
    }
    expect(secretLines.length).toBeGreaterThan(0); // le contrôle porte bien sur quelque chose
  });

  it("remonte le drapeau d'erreur d'un outil MCP à l'agent (tâche 306)", () => {
    // Un outil MCP signale son échec DANS le résultat (`isError: true`), pas par
    // une erreur de protocole : sans propagation de ce drapeau, un refus
    // (« je ne peux pas faire ça ») arrive à l'agent comme une réussite.
    const formatBody = slice("function formatMcpResult(", "async function readFileText(");
    const errorBody = slice("function errorText(", "function formatMcpResult(");
    const runBody = slice("async function runTool(", "// Retire toute occurrence de la clé");

    // 1. La réponse d'erreur locale (client absent, exception) est une erreur.
    expect(errorBody).toMatch(/isError:\s*true/);

    // 2. Tous les retours du formatage MCP portent le drapeau, lu sur le résultat.
    expect(formatBody).toMatch(/\.isError === true/);
    const returns = formatBody.match(/return \{[\s\S]*?\};/g) ?? [];
    expect(returns.length).toBeGreaterThanOrEqual(2);
    for (const r of returns) {
      expect(r, `retour sans isError : ${r}`).toMatch(/isError/);
    }

    // 3. Le chemin d'appel annonce le drapeau dans son type de retour.
    expect(runBody).toMatch(/isError/);
  });

  it("conserve le fail-open et le garde-fou de timeout", () => {
    expect(src).toContain("CONNECT_TIMEOUT_MS");
    expect(src).toMatch(/catch \{\s*\/\/ Fail-open/);
    expect(src).toContain("safeClose(transport, client)");
  });
});
