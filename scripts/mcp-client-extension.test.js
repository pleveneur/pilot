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

// ─────────────────────────────────────────────────────────────────────────────
// Garde-fous du contrôle de l'écran (paramètres → Serveurs MCP).
//
// Un serveur « écran » pilote la machine : la logique fine (décision, journal,
// rédaction) est testée dans `src/js/screen-guard.test.js`. Ici on vérifie que
// l'extension la BRANCHE : chaque action passe par la porte, un refus bloque
// l'appel, les réglages sont relus en direct et le journal est écrit.
// ─────────────────────────────────────────────────────────────────────────────

describe("extension MCP — garde-fous du contrôle de l'écran", () => {
  const gateBody = slice('api.on("tool_call"', "// ── Nettoyage à la fin de session");
  const guardBody = slice("async function readScreenGuard(", "/// Demande l'accord de l'utilisateur");
  const askBody = slice("async function askScreenConfirmation(", "/// Ajoute une ligne au journal");
  const journalBody = src.slice(src.indexOf("async function journalScreenAction("));

  it("branche la logique partagée des garde-fous (source unique de vérité)", () => {
    expect(src).toContain('from "../../src/js/screen-guard.js"');
    expect(src).toContain("isScreenServer(server)");
    expect(src).toContain("isScreenTool(event.toolName, serverId)");
    expect(src).toContain("screenGateOutcome(guard)");
  });

  it("n'enregistre pas les outils du serveur écran quand le contrôle est coupé", () => {
    // Contrôle désactivé / arrêt d'urgence : le serveur n'est même pas lancé.
    expect(src).toMatch(
      /if \(isScreen && !\(await readScreenGuard\(configPath\)\)\.enabled\) \{\s*return;/,
    );
  });

  it("relit les réglages à CHAQUE action (arrêt d'urgence immédiat)", () => {
    // Une valeur lue au démarrage ne suffirait pas : l'arrêt d'urgence doit
    // prendre effet sans redémarrer la session.
    expect(gateBody).toMatch(/const guard = await readScreenGuard\(configPath\);/);
    expect(guardBody).toContain("config.json");
    expect(guardBody).toContain('pathIn(dir, "config.json")');
  });

  it("refuse sans jamais appeler le serveur (blocage, pas filtrage)", () => {
    expect(gateBody).toMatch(/return \{ block: true, reason: outcome\.reason \};/);
    // Le refus utilisateur et l'absence d'interface bloquent aussi l'appel.
    expect(gateBody).toMatch(/return \{ block: true, reason: SCREEN_REFUSED_MESSAGE \};/);
    expect(gateBody).toMatch(/return \{ block: true, reason: SCREEN_NO_UI_MESSAGE \};/);
    // La porte ne fait pas le travail elle-même : elle autorise ou bloque, et
    // c'est `execute` (donc `runTool`) qui exécute l'action acceptée.
    expect(gateBody).not.toContain("runTool(");
  });

  it("demande une confirmation à l'utilisateur, avec un refus par défaut", () => {
    expect(askBody).toContain("ctx.ui.confirm(");
    expect(askBody).toContain("SCREEN_GATE_SENTINEL");
    // Fail-closed : une erreur de dialogue vaut refus, jamais accord.
    expect(askBody).toMatch(/catch \{\s*return false;/);
    expect(askBody).toMatch(/return answer === true;/);
  });

  it("mode simulation : accord donné mais aucune action réelle", () => {
    expect(gateBody).toMatch(/if \(outcome\.simulated\) \{/);
    expect(gateBody).toMatch(/return \{ block: true, reason: SCREEN_SIMULATION_MESSAGE \};/);
    // L'exécution réelle n'est atteinte qu'après : refus, absence d'UI,
    // simulation — dans cet ordre.
    const iSim = gateBody.indexOf("outcome.simulated");
    const iAccepted = gateBody.indexOf("SCREEN_JOURNAL_ACCEPTED");
    expect(iSim).toBeGreaterThanOrEqual(0);
    expect(iAccepted).toBeGreaterThan(iSim);
  });

  it("journalise chaque issue (heure, outil, résultat) dans le projet", () => {
    expect(journalBody).toContain("formatScreenJournalLine");
    expect(journalBody).toContain("appendFile");
    expect(journalBody).toContain("SCREEN_JOURNAL_RELATIVE_PATH");
    expect(journalBody).toContain("ctx.cwd");
    expect(gateBody).toContain("SCREEN_JOURNAL_REFUSED");
    expect(gateBody).toContain("SCREEN_JOURNAL_SIMULATED");
    expect(gateBody).toContain("SCREEN_JOURNAL_ACCEPTED");
    // Le journal ne doit jamais faire échouer une action (ni la bloquer).
    expect(journalBody).toMatch(/catch \{\s*\/\*/);
  });

  it("n'écrit jamais les paramètres bruts ni de contenu sensible dans le journal", () => {
    // Chaque écriture passe par le résumé rédacté.
    const journalled = gateBody.match(/journalScreenAction\([^;]*\);/g) ?? [];
    expect(journalled.length).toBeGreaterThanOrEqual(4);
    for (const call of journalled) {
      expect(call, `écriture non rédactée : ${call}`).toMatch(
        /summarizeScreenAction\(input\)|SCREEN_[A-Z_]+/,
      );
      expect(call, `paramètres bruts journalisés : ${call}`).not.toMatch(/JSON\.stringify\(input\)/);
    }
  });
});
