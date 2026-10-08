// Tests unitaires — screen-guard.js (garde-fous du contrôle de l'écran)

import { describe, it, expect } from "vitest";
import {
  DEFAULT_SCREEN_GUARD,
  SCREEN_DISABLED_MESSAGE,
  SCREEN_EMERGENCY_MESSAGE,
  SCREEN_GATE_SENTINEL,
  SCREEN_JOURNAL_ACCEPTED,
  SCREEN_JOURNAL_REFUSED,
  SCREEN_JOURNAL_SIMULATED,
  SCREEN_OUTCOME,
  SCREEN_SIMULATION_MESSAGE,
  formatScreenJournalLine,
  formatScreenTimestamp,
  isScreenServer,
  isScreenTool,
  parseScreenGuard,
  parseScreenJournal,
  parseScreenJournalLine,
  screenGateOutcome,
  summarizeScreenAction,
} from "./screen-guard.js";

describe("parseScreenGuard", () => {
  it("active le contrôle par défaut, en simulation (état sûr)", () => {
    expect(parseScreenGuard("{}")).toEqual({
      enabled: true,
      simulation: true,
      emergencyStop: false,
    });
    expect(DEFAULT_SCREEN_GUARD.enabled).toBe(true);
  });

  it("un contenu illisible retombe sur les défauts, jamais sur une autorisation", () => {
    expect(parseScreenGuard("pas du json")).toEqual({ ...DEFAULT_SCREEN_GUARD });
    expect(parseScreenGuard("")).toEqual({ ...DEFAULT_SCREEN_GUARD });
    expect(parseScreenGuard(null)).toEqual({ ...DEFAULT_SCREEN_GUARD });
  });

  it("lit les trois réglages écrits par Rust", () => {
    const text = JSON.stringify({
      screen_control_enabled: false,
      screen_control_simulation: false,
      screen_control_emergency_stop: true,
    });
    expect(parseScreenGuard(text)).toEqual({
      enabled: false,
      simulation: false,
      emergencyStop: true,
    });
  });

  it("un réglage à `false` n'est pas confondu avec un champ absent", () => {
    const onlyEmergency = JSON.stringify({ screen_control_emergency_stop: false });
    expect(parseScreenGuard(onlyEmergency)).toEqual({
      enabled: true,
      simulation: true,
      emergencyStop: false,
    });
  });
});

describe("isScreenServer", () => {
  it("reconnaît le drapeau explicite", () => {
    expect(isScreenServer({ screen: true, name: "Autre", command: "x" })).toBe(true);
    expect(isScreenServer({ screen: false, name: "Autre", command: "x" })).toBe(false);
  });

  it("reconnaît un serveur écran déjà configuré (nom ou commande)", () => {
    expect(isScreenServer({ name: "ScreenMCP" })).toBe(true);
    expect(isScreenServer({ name: "Contrôle de l'écran" })).toBe(true);
    expect(isScreenServer({ name: "Ecran" })).toBe(true);
    expect(
      isScreenServer({ name: "Bidule", command: "G:\\IA_PL\\ScreenMCP\\target\\release\\screenmcp.exe" }),
    ).toBe(true);
  });

  it("ne confond pas un serveur MCP ordinaire", () => {
    expect(isScreenServer({ name: "GitHub", command: "npx" })).toBe(false);
    expect(isScreenServer(null)).toBe(false);
  });
});

describe("isScreenTool", () => {
  it("ne retient que les outils du serveur écran", () => {
    expect(isScreenTool("mcp_mcp-2_capture_screen", "mcp-2")).toBe(true);
    expect(isScreenTool("mcp_mcp-3_search_repos", "mcp-2")).toBe(false);
    expect(isScreenTool("mcp_mcp-2_capture_screen", "")).toBe(false);
    expect(isScreenTool("", "mcp-2")).toBe(false);
  });
});

describe("screenGateOutcome — décision avant chaque action", () => {
  it("réglage désactivé : refus immédiat, sans aucune action", () => {
    const o = screenGateOutcome({ enabled: false, simulation: false, emergencyStop: false });
    expect(o.action).toBe(SCREEN_OUTCOME.REFUSE);
    expect(o.reason).toBe(SCREEN_DISABLED_MESSAGE);
    expect(o.simulated).toBe(false);
  });

  it("arrêt d'urgence : refus immédiat, message explicite", () => {
    const o = screenGateOutcome({ enabled: true, simulation: false, emergencyStop: true });
    expect(o.action).toBe(SCREEN_OUTCOME.REFUSE);
    expect(o.reason).toBe(SCREEN_EMERGENCY_MESSAGE);
  });

  it("aucune autorisation permanente : chaque action redemande une confirmation", () => {
    const guard = { enabled: true, simulation: false, emergencyStop: false };
    // Dix appels de suite donnent dix confirmations : la porte ne « retient »
    // jamais un accord et ne renvoie jamais « autorisé » d'office.
    for (let i = 0; i < 10; i++) {
      expect(screenGateOutcome(guard).action).toBe(SCREEN_OUTCOME.CONFIRM);
    }
  });

  it("mode simulation : confirmation demandée PUIS action bloquée (rien de réel)", () => {
    const o = screenGateOutcome({ enabled: true, simulation: true, emergencyStop: false });
    expect(o.action).toBe(SCREEN_OUTCOME.CONFIRM);
    expect(o.simulated).toBe(true);
  });

  it("mode réel : confirmation puis exécution possible", () => {
    const o = screenGateOutcome({ enabled: true, simulation: false, emergencyStop: false });
    expect(o.action).toBe(SCREEN_OUTCOME.CONFIRM);
    expect(o.simulated).toBe(false);
  });

  it("un garde-fou absent n'autorise rien", () => {
    expect(screenGateOutcome(null).action).toBe(SCREEN_OUTCOME.REFUSE);
    expect(screenGateOutcome(undefined).action).toBe(SCREEN_OUTCOME.REFUSE);
  });

  it("le sentinel de confirmation est celui que reconnaît le frontend", () => {
    expect(SCREEN_GATE_SENTINEL).toBe("PILOT_SCREEN_GATE::");
  });
});

describe("summarizeScreenAction — journal sans contenu sensible", () => {
  it("masque le texte saisi, les mots de passe et les jetons", () => {
    const s = summarizeScreenAction({
      text: "mon mot de passe secret",
      password: "hunter2",
      token: "ghp_abcdef",
      content: "du contenu",
      value: "valeur",
    });
    expect(s).not.toContain("hunter2");
    expect(s).not.toContain("ghp_abcdef");
    expect(s).not.toContain("mon mot de passe secret");
    expect(s).toContain("[masqué]");
  });

  it("masque une valeur textuelle longue et garde les paramètres anodins", () => {
    const long = "x".repeat(300);
    const s = summarizeScreenAction({ clipboard: long, monitor: 1, key: "enter" });
    expect(s).not.toContain(long);
    expect(s).toContain("[masqué: 300 car.]");
    expect(s).toContain('"monitor":1');
    expect(s).toContain('"key":"enter"');
  });

  it("reste borné en longueur et tolère l'absence de paramètres", () => {
    expect(summarizeScreenAction({ a: "1".repeat(39), b: 2 })).toBeDefined();
    expect(summarizeScreenAction(null)).toBe("");
    expect(summarizeScreenAction({})).toBe("");
  });
});

describe("journal — écriture et relecture", () => {
  it("une ligne écrite est relue à l'identique", () => {
    const line = formatScreenJournalLine({
      at: "2026-10-08 14:03:22",
      tool: "mcp_mcp-2_capture_screen",
      outcome: SCREEN_JOURNAL_ACCEPTED,
      detail: '{"monitor":1}',
    });
    expect(line).toBe('2026-10-08 14:03:22  mcp_mcp-2_capture_screen  accepté  {"monitor":1}');
    expect(parseScreenJournalLine(line)).toEqual({
      at: "2026-10-08 14:03:22",
      tool: "mcp_mcp-2_capture_screen",
      outcome: SCREEN_JOURNAL_ACCEPTED,
      detail: '{"monitor":1}',
    });
  });

  it("les trois résultats sont relus, y compris un détail contenant des espaces", () => {
    for (const outcome of [
      SCREEN_JOURNAL_ACCEPTED,
      SCREEN_JOURNAL_REFUSED,
      SCREEN_JOURNAL_SIMULATED,
    ]) {
      const line = formatScreenJournalLine({
        at: "2026-10-08 00:00:01",
        tool: "mcp_mcp-2_move_mouse",
        outcome,
        detail: "x à 10 20 puis clic gauche",
      });
      const parsed = parseScreenJournalLine(line);
      expect(parsed && parsed.outcome).toBe(outcome);
      expect(parsed && parsed.detail).toBe("x à 10 20 puis clic gauche");
    }
  });

  it("un horodatage sans détail reste relisible", () => {
    const line = formatScreenJournalLine({
      at: "2026-10-08 14:03:22",
      tool: "mcp_mcp-2_capture_screen",
      outcome: SCREEN_JOURNAL_REFUSED,
      detail: SCREEN_EMERGENCY_MESSAGE,
    });
    const parsed = parseScreenJournalLine(line);
    expect(parsed && parsed.outcome).toBe(SCREEN_JOURNAL_REFUSED);
    expect(parsed && parsed.detail).toBe(SCREEN_EMERGENCY_MESSAGE);
  });

  it("ignore les lignes illisibles ou étrangères", () => {
    expect(parseScreenJournalLine("")).toBeNull();
    expect(parseScreenJournalLine("texte ajouté à la main")).toBeNull();
    expect(parseScreenJournalLine("2026-10-08 14:03:22  outil  peut-être  rien")).toBeNull();
  });

  it("parseScreenJournal relit un fichier complet, du plus récent au plus ancien", () => {
    const text = [
      formatScreenJournalLine({
        at: "2026-10-08 14:00:00",
        tool: "mcp_mcp-2_capture_screen",
        outcome: SCREEN_JOURNAL_ACCEPTED,
        detail: "",
      }),
      "ligne parasite",
      formatScreenJournalLine({
        at: "2026-10-08 14:05:00",
        tool: "mcp_mcp-2_click",
        outcome: SCREEN_JOURNAL_SIMULATED,
        detail: "",
      }),
      "",
    ].join("\n");
    const entries = parseScreenJournal(text);
    expect(entries).toHaveLength(2);
    expect(entries[0].at).toBe("2026-10-08 14:05:00");
    expect(entries[1].at).toBe("2026-10-08 14:00:00");
  });

  it("parseScreenJournal borne le nombre de lignes renvoyées", () => {
    const text = Array.from({ length: 20 }, (_, i) =>
      formatScreenJournalLine({
        at: `2026-10-08 14:00:${String(i).padStart(2, "0")}`,
        tool: "mcp_mcp-2_click",
        outcome: SCREEN_JOURNAL_ACCEPTED,
        detail: "",
      }),
    ).join("\n");
    expect(parseScreenJournal(text, 5)).toHaveLength(5);
  });

  it("horodate en heure locale, au format lisible attendu", () => {
    const at = formatScreenTimestamp(new Date(2026, 9, 8, 14, 3, 22));
    expect(at).toBe("2026-10-08 14:03:22");
    expect(parseScreenJournalLine(formatScreenJournalLine({ at, tool: "t", outcome: "refusé" }))).not.toBeNull();
  });

  it("formatScreenJournalLine sait produire son propre horodatage", () => {
    const line = formatScreenJournalLine({ tool: "t", outcome: SCREEN_JOURNAL_ACCEPTED });
    expect(parseScreenJournalLine(line)).not.toBeNull();
  });

  it("le message de simulation est compréhensible et n'annonce aucun effet réel", () => {
    expect(SCREEN_SIMULATION_MESSAGE).toContain("simul");
    expect(SCREEN_SIMULATION_MESSAGE).toContain("rien n'a été exécuté");
  });
});
