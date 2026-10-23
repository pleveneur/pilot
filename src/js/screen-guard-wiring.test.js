// Tests — branchement des garde-fous du contrôle de l'écran (câblage UI/I/O).
//
// Le cœur décisionnel est testé dans `screen-guard.test.js`. Ici on vérifie que
// le CÂBLAGE existe réellement : sans lui, la porte ne s'exécute jamais (et le
// défaut « chaque action confirmée + journal + arrêt d'urgence » serait faux).
// Même approche que `agent-pi-listeners.test.js` : assertions de source.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(resolve(here, p), "utf8");

const agentPi = read("agent-pi.js");
const relay = read("agent-choice-relay.js");
const settings = read("settings.js");
const html = read("../../index.html");
const extension = read("../../src-tauri/extensions/mcp-client.src.ts");

describe("contrôle de l'écran — dialogue de confirmation (agent-pi.js)", () => {
  it("intercepte le sentinel de l'extension AVANT le mode orchestration", () => {
    // Ordre critique : en orchestration autonome, le confirm « nu » est
    // auto-approuvé (plus bas) ; un agent autonome ne doit jamais obtenir la
    // main sur l'écran sans témoin.
    const iScreen = agentPi.indexOf("rawMsg.startsWith(SCREEN_GATE_SENTINEL)");
    const iOrch = agentPi.indexOf("if (state.orchestrationRunning) {", iScreen);
    expect(iScreen).toBeGreaterThanOrEqual(0);
    expect(iOrch).toBeGreaterThan(iScreen);
  });

  it("répond avec `confirmed` (une réponse sans ce champ vaut refus côté pi)", () => {
    expect(agentPi).toMatch(
      /command: \{ type: "extension_ui_response", id, confirmed: !!accepted, cancelled: !accepted \}/,
    );
  });

  it("refuse en session autonome au lieu de laisser l'agent se répondre", () => {
    expect(agentPi).toMatch(
      /if \(state\.orchestrationRunning\) \{[\s\S]{0,400}?await answer\(false\);/,
    );
  });

  it("marque le dialogue et y place l'arrêt d'urgence", () => {
    expect(agentPi).toContain('overlay.setAttribute("data-screen-gate", "1")');
    expect(agentPi).toContain('"🛑 Arrêt d\'urgence"');
    expect(agentPi).toContain("engageScreenEmergencyStop();");
    expect(agentPi).toContain("denyPendingScreenGates();");
  });

  it("refuse l'action en attente sur l'événement d'arrêt d'urgence", () => {
    expect(agentPi).toMatch(
      /onGlobal\(window, "pilot-screen-emergency-stop", denyPendingScreenGates\)/,
    );
    // Le refus clique le bouton « Refuser » du dialogue marqué.
    expect(agentPi).toMatch(/querySelectorAll\("\[data-screen-gate\]"\)/);
    expect(agentPi).toMatch(/querySelector\("\.agent-diff-btn-reject"\)/);
  });

  it("n'expose plus le dialogue d'écran au relais de l'assistant", () => {
    // La décision « relayable » vit désormais dans `agent-choice-relay.js`
    // (source unique partagée avec le bus d'agent) : c'est LÀ que le contrôle de
    // l'écran est exclu du relais, et `agent-pi.js` consomme cette décision.
    expect(relay).toMatch(
      /if \(msg\.startsWith\(SCREEN_GATE_SENTINEL\)\) return false;/,
    );
    expect(agentPi).toMatch(
      /import \{ AGENT_RELAY_EVENT, isRelayableAgentChoice \} from "\.\/agent-choice-relay\.js";/,
    );
  });
});

describe("contrôle de l'écran — réglages (settings.js + index.html)", () => {
  it("offre les cases d'autorisation et de simulation, et les boutons d'action", () => {
    for (const id of [
      "setting-mcp-screen-enabled",
      "setting-mcp-screen-simulation",
      "btn-mcp-screen-stop",
      "btn-mcp-screen-resume",
      "btn-mcp-screen-log",
      "mcp-screen-log",
      "mcp-f-screen",
    ]) {
      expect(html, `élément manquant : ${id}`).toContain(`id="${id}"`);
    }
  });

  it("persiste l'arrêt d'urgence côté Rust (survit au redémarrage)", () => {
    expect(settings).toMatch(
      /invoke\("mcp_set_screen_guard", \{ enabled, simulation, emergencyStop \}\)/,
    );
    // Le bouton d'arrêt coupe l'autorisation ET prévient les onglets d'agents.
    expect(settings).toMatch(
      /saveScreenGuard\(false, false, true\)[\s\S]{0,200}?pilot-screen-emergency-stop/,
    );
    expect(settings).toMatch(/saveScreenGuard\(true, true, false\)/);
  });

  it("réécrit les trois champs à chaque enregistrement des Paramètres", () => {
    // `save_config` remplace TOUTE la configuration : un champ absent
    // retomberait sur sa valeur par défaut (arrêt d'urgence levé).
    for (const key of [
      "screen_control_enabled",
      "screen_control_simulation",
      "screen_control_emergency_stop",
    ]) {
      expect(settings, `champ absent de applySettings : ${key}`).toContain(`${key}:`);
    }
  });

  it("affiche le journal du projet ouvert et porte le drapeau écran du serveur", () => {
    expect(settings).toContain("SCREEN_JOURNAL_RELATIVE_PATH");
    expect(settings).toContain("parseScreenJournal(text, 100)");
    expect(settings).toContain("read_file_content");
    expect(settings).toMatch(/screen: mcpFScreen \? mcpFScreen\.checked : false/);
    expect(settings).toMatch(/mcpFScreen\.checked = s \? !!s\.screen : false/);
  });
});

describe("contrôle de l'écran — l'extension MCP porte la porte", () => {
  it("importe la logique pure partagée (source unique)", () => {
    expect(extension).toContain('from "../../src/js/screen-guard.js"');
    expect(extension).toContain("screenGateOutcome(guard)");
  });

  it("bloque l'action avant toute exécution et journalise chaque issue", () => {
    expect(extension).toMatch(/return \{ block: true, reason: outcome\.reason \};/);
    expect(extension).toContain("journalScreenAction(ctx, event.toolName");
  });
});
