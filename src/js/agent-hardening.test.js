// Tests déterministes des protections du dialogue avec l'agent (R2 / LOT 5).
// Aucune attente réelle, aucun réseau, aucun DOM : uniquement des décisions pures.
import { describe, it, expect } from "vitest";
import {
  isTerminalAgentEnd,
  isCompletionCredible,
  completionRefusalReason,
  isResendLost,
  streamingBehaviorFor,
  buildPromptPayload,
  isPromptAccepted,
  COMMAND_DISCOVERY_ORDER,
  parseCommandsResponse,
  commandsFromUpdate,
  classifySlashInput,
  decideEditGate,
} from "./agent-hardening.js";

describe("F3 — faux « terminé »", () => {
  it("pi (sans isTerminal) reste terminal", () => {
    expect(isTerminalAgentEnd({ type: "agent_end" })).toBe(true);
    expect(isTerminalAgentEnd(null)).toBe(true);
  });

  it("un agent_end non terminal n'est pas une fin de run", () => {
    expect(isTerminalAgentEnd({ type: "agent_end", isTerminal: false })).toBe(false);
    expect(isTerminalAgentEnd({ type: "agent_end", isTerminal: true })).toBe(true);
  });

  it("ne croit pas un « terminé » sans production observable", () => {
    expect(isCompletionCredible({ producedText: true })).toBe(true);
    expect(isCompletionCredible({ producedToolResult: true })).toBe(true);
    expect(isCompletionCredible({})).toBe(false);
    expect(isCompletionCredible({ producedText: true, stopReason: "error" })).toBe(false);
    expect(isCompletionCredible({ producedText: true, stopReason: "aborted" })).toBe(false);
  });

  it("explique le refus, et se tait quand la production est crédible", () => {
    expect(completionRefusalReason({ producedText: true })).toBeNull();
    expect(completionRefusalReason({ stopReason: "error" })).toMatch(/erreur/);
    expect(completionRefusalReason({ stopReason: "aborted" })).toMatch(/interrompu/);
    expect(completionRefusalReason({})).toMatch(/sans production/);
  });
});

describe("F3 ter — relance perdue", () => {
  it("détecte une relance sans suite et seulement celle-là", () => {
    expect(isResendLost({ resendRequested: true })).toBe(true);
    expect(isResendLost({ resendRequested: true, followUpSeen: false })).toBe(true);
    expect(isResendLost({ resendRequested: true, followUpSeen: true })).toBe(false);
    expect(isResendLost({ followUpSeen: false })).toBe(false);
    expect(isResendLost()).toBe(false);
  });
});

describe("F8 — streamingBehavior", () => {
  it("n'ajoute rien hors streaming (comportement actuel inchangé)", () => {
    expect(streamingBehaviorFor("interrupt", false)).toBeNull();
    expect(streamingBehaviorFor(undefined, undefined)).toBeNull();
    expect(buildPromptPayload("salut")).toEqual({ message: "salut" });
    expect(buildPromptPayload("salut", { isStreaming: false, images: [] })).toEqual({ message: "salut" });
  });

  it("annonce steer pour une interruption, followUp sinon", () => {
    expect(streamingBehaviorFor("interrupt", true)).toBe("steer");
    expect(streamingBehaviorFor("", true)).toBe("followUp");
  });

  it("construit le corps du prompt pendant un run actif", () => {
    expect(buildPromptPayload("corrige", { isStreaming: true })).toEqual({
      message: "corrige",
      streamingBehavior: "followUp",
    });
    expect(buildPromptPayload("stop", { isStreaming: true, kind: "interrupt", images: ["a.png"] })).toEqual({
      message: "stop",
      images: ["a.png"],
      streamingBehavior: "steer",
    });
  });

  it("lit l'accusé de réception sans crier au loup", () => {
    expect(isPromptAccepted({ success: false })).toBe(false);
    expect(isPromptAccepted({ success: true })).toBe(true);
    expect(isPromptAccepted({})).toBeNull();
    expect(isPromptAccepted(null)).toBeNull();
  });
});

describe("F2 — nom de commande de secours", () => {
  it("essaie le nom actuel d'abord, le nom omp ensuite", () => {
    expect(COMMAND_DISCOVERY_ORDER).toEqual(["get_commands", "get_available_commands"]);
  });

  it("accepte la réponse enveloppée (result.data.commands) comme la réponse nue", () => {
    expect(parseCommandsResponse({ data: { commands: [{ name: "compact" }] } }).commands).toHaveLength(1);
    expect(parseCommandsResponse({ commands: [{ name: "handoff" }] }).commands).toHaveLength(1);
    expect(parseCommandsResponse({ success: false }).ok).toBe(false);
    expect(parseCommandsResponse({ data: { commands: [] } }).ok).toBe(false);
    expect(parseCommandsResponse(null).ok).toBe(false);
  });

  it("récupère les commandes poussées par available_commands_update", () => {
    expect(commandsFromUpdate({ type: "available_commands_update", commands: [{ name: "a" }] })).toHaveLength(1);
    expect(commandsFromUpdate({ type: "available_commands_update", data: { commands: [{ name: "b" }] } })).toHaveLength(1);
    expect(commandsFromUpdate({ type: "agent_end" })).toBeNull();
    expect(commandsFromUpdate({ type: "available_commands_update" })).toBeNull();
  });
});

describe("Commandes /… saisies par erreur", () => {
  it("un nom inconnu n'est jamais une commande", () => {
    expect(classifySlashInput("/resume", ["resume", "prompt"])).toEqual({ kind: "command", name: "resume", args: "" });
    expect(classifySlashInput("/resume 3", ["resume"])).toEqual({ kind: "command", name: "resume", args: "3" });
    expect(classifySlashInput("/resum", ["resume"])).toEqual({ kind: "unknown", name: "resum", args: "" });
    expect(classifySlashInput("/", ["resume"])).toEqual({ kind: "text", name: "", args: "" });
    expect(classifySlashInput("bonjour", ["resume"])).toEqual({ kind: "text", name: "", args: "bonjour" });
    expect(classifySlashInput(undefined)).toEqual({ kind: "text", name: "", args: "" });
  });
});

describe("Porte pré-écriture — décision pure séparée de l'écriture", () => {
  it("accepte → écrit ; refuse → n'écrit pas", () => {
    expect(decideEditGate(true)).toEqual({ apply: true, decision: "accept", write: true, closeDialog: true });
    expect(decideEditGate(false)).toEqual({ apply: true, decision: "reject", write: false, closeDialog: true });
  });

  it("une décision déjà résolue ne réapplique rien", () => {
    expect(decideEditGate(true, { resolved: true })).toEqual({ apply: false, decision: "accept", write: false, closeDialog: true });
    expect(decideEditGate(false, { resolved: true })).toEqual({ apply: false, decision: "reject", write: false, closeDialog: true });
  });
});
