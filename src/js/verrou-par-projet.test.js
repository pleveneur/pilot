// PREUVES — verrou par projet à lecteurs partagés (branche verrou-par-projet).
//
// Ces tests prouvent le comportement exigé de bout en bout, au niveau où la
// décision d'admission est réellement prise (bus d'agents + politique pure) :
//   (a) deux missions de LECTURE sur le MÊME projet tournent simultanément ;
//   (b) une mission qui MODIFIE sur un projet est refusée/mise en file tant
//       qu'une autre mission tourne sur ce projet ; une mission sur un AUTRE
//       projet n'attend pas.
//
// `beginRun(project, { readOnly })` est exactement ce qu'appelle
// `startParallelRun` après sa garde d'admission `isRunInProgress(project,
// { nature })` (elle-même utilisée par la file d'attente de super-agent.js).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Same stub as agents-bus.test.js: aucun accès Tauri réel en environnement Node.
import { vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));

import { beginRun, endRun, isRunInProgress, getRunState } from "./agents-bus.js";
import {
  canSendManualCommand,
  MANUAL_COMMAND_NATURE,
  MANUAL_COMMAND_BLOCKED_MESSAGE,
} from "./run-policy.js";

describe("PREUVE (a) — deux missions de LECTURE tournent en parallèle sur le même projet", () => {
  it("(a) deux lectures coexistuent (clés distinctes), sans être bloquées ni s'écraser", () => {
    const p = "preuve-a";
    // Admission de la 1re lecture : rien ne tourne → autorisée.
    expect(isRunInProgress(p, { nature: "read" })).toBe(false);
    const run1 = beginRun(p, { readOnly: true });

    // Admission de la 2e lecture : la 1re est une LECTURE partagée → autorisée.
    expect(isRunInProgress(p, { nature: "read" })).toBe(false);
    const run2 = beginRun(p, { readOnly: true });

    // Les deux runs vivent en même temps, avec des contextes distincts.
    expect(run1.runKey).not.toBe(run2.runKey);
    expect(run1.readonly).toBe(true);
    expect(run2.readonly).toBe(true);
    expect(run1.runKey.startsWith(`${p}#read:`)).toBe(true);
    expect(run2.runKey.startsWith(`${p}#read:`)).toBe(true);
    // Le PROJET RÉEL reste identique sur les deux contextes (routage par projet).
    expect([run1.project, run2.project]).toEqual([p, p]);

    // La fin de la 1re ne tue pas la 2de.
    endRun(p, run1.generation);
    expect(getRunState(p)).toBe("running");
    endRun(p, run2.generation);
    expect(getRunState(p)).toBe("idle");
  });
});

describe("PREUVE (b) — modification exclusive par projet, autres projets indépendants", () => {
  it("(b) une MODIFICATION attend toute run; une LECTURE attend une MODIFICATION; un autre projet n'attend pas", () => {
    const proj = "preuve-b";
    const autre = "preuve-b-autre";

    // 1. Une LECTURE tourne sur `proj`.
    const readRun = beginRun(proj, { readOnly: true });

    // Une modification sur `proj` est bloquée (sera mise en file par super-agent).
    expect(isRunInProgress(proj, { nature: "write" })).toBe(true);
    // Une autre lecture sur `proj` est autorisée (partage).
    expect(isRunInProgress(proj, { nature: "read" })).toBe(false);
    // Un projet DIFFÉRENT n'attend pas (ni en écriture, ni en lecture).
    expect(isRunInProgress(autre, { nature: "write" })).toBe(false);
    expect(isRunInProgress(autre, { nature: "read" })).toBe(false);

    endRun(proj, readRun.generation);

    // 2. Une modification tourne sur `proj`.
    const writeRun = beginRun(proj);
    expect(writeRun.readonly).toBe(false);
    // Elle est exclusive : toute autre mission sur `proj` attend…
    expect(isRunInProgress(proj, { nature: "write" })).toBe(true);
    expect(isRunInProgress(proj, { nature: "read" })).toBe(true);
    // …mais elle ne bloque pas un autre projet.
    expect(isRunInProgress(autre, { nature: "write" })).toBe(false);

    endRun(proj, writeRun.generation);
    expect(isRunInProgress(proj, { nature: "write" })).toBe(false);
    expect(isRunInProgress(proj, { nature: "read" })).toBe(false);
  });
});

// POINT B — le verrou n'est pas contournable par une commande manuelle.
// Une commande envoyée à la main (prompt tapé dans l'interface) peut modifier
// le projet : elle compte comme MODIFICATION exclusive et passe par la même
// politique d'admission que les missions. Ces tests ÉCHOUENT si l'on revient au
// comportement d'avant (garde absente du chemin manuel, ou nature « lecture »).
describe("POINT B — commande manuelle soumise à la politique d'admission", () => {
  it("la nature d'une commande manuelle est une MODIFICATION exclusive", () => {
    expect(MANUAL_COMMAND_NATURE).toBe("write");
  });

  it("refusée tant qu'une mission tourne sur le MÊME projet — jamais bloquée par un autre projet", () => {
    const proj = "point-b";
    const autre = "point-b-autre";
    // Rien ne tourne → autorisée.
    expect(canSendManualCommand(proj, isRunInProgress)).toBe(true);
    // Même une mission de LECTURE bloque la commande manuelle (exclusive).
    const readRun = beginRun(proj, { readOnly: true });
    expect(canSendManualCommand(proj, isRunInProgress)).toBe(false);
    expect(canSendManualCommand(autre, isRunInProgress)).toBe(true);
    endRun(proj, readRun.generation);
    // Une mission de MODIFICATION bloque aussi.
    const writeRun = beginRun(proj);
    expect(canSendManualCommand(proj, isRunInProgress)).toBe(false);
    endRun(proj, writeRun.generation);
    expect(canSendManualCommand(proj, isRunInProgress)).toBe(true);
  });

  it("le prompt manuel (agent-pi.js) applique la garde AVANT d'envoyer le prompt", () => {
    const src = readFileSync(new URL("./agent-pi.js", import.meta.url), "utf8");
    const guardIdx = src.indexOf("!canSendManualCommand(window._pilotProjectPath");
    const sendIdx = src.indexOf('invoke("send_agent_prompt", payload)');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(src).toContain("MANUAL_COMMAND_BLOCKED_MESSAGE");
    expect(sendIdx).toBeGreaterThan(-1);
    // La garde est branchée dans le chemin d'envoi, avant l'invoke.
    expect(guardIdx).toBeLessThan(sendIdx);
  });
});

// POINT C — arrêter un agent libère aussi la place du PROJET.
// La file des MISSIONS (`runAgentsQueueByProject`, indexée par projet) n'était
// pas vidée à l'arrêt : une mission en attente ne démarrait jamais puis était
// perdue par le watchdog. Ce test ÉCHOUE si la branche `stop_agent` cesse de
// libérer le créneau / la file du projet, ou cesse de le signaler.
// POINT B1/B2/B3 — plus aucun chemin manuel n'appelle `send_agent_prompt` en
// direct : chacun passe par la politique d'admission (`canSendManualCommandAsync`)
// AVANT l'envoi, avec un refus visible. Ces tests ÉCHOUENT si l'un des trois
// chemins revient à un `invoke("send_agent_prompt")` non gardé.
function assertGuardBeforeSend(src, label) {
  const guardIdx = src.indexOf("canSendManualCommandAsync(");
  const sendIdx = src.indexOf('invoke("send_agent_prompt", {');
  const refuseIdx = src.indexOf("MANUAL_COMMAND_BLOCKED_MESSAGE");
  expect(guardIdx, `${label} : garde absente`).toBeGreaterThan(-1);
  expect(refuseIdx, `${label} : refus non visible`).toBeGreaterThan(-1);
  expect(sendIdx, `${label} : envoi absent`).toBeGreaterThan(-1);
  expect(guardIdx, `${label} : la garde doit précéder l'envoi`).toBeLessThan(sendIdx);
}

describe("POINT B1 — menu contextuel de la barre latérale (sidebar.js)", () => {
  it("B1 — le garde précède l'envoi direct, refus visible", () => {
    const src = readFileSync(new URL("./sidebar.js", import.meta.url), "utf8");
    const handlerIdx = src.indexOf("ctxSendAgent.addEventListener(");
    const endIdx = src.indexOf("ctxAddPromptBuilder.addEventListener(", handlerIdx);
    expect(handlerIdx).toBeGreaterThan(-1);
    assertGuardBeforeSend(src.slice(handlerIdx, endIdx), "sidebar.js ctxSendAgent");
  });
});

describe("POINT B2 — bouton « Envoyer à l'agent » du constructeur de prompts", () => {
  it("B2 — le garde précède l'envoi direct, refus visible", () => {
    const src = readFileSync(new URL("./prompt-builder.js", import.meta.url), "utf8");
    const fnIdx = src.indexOf("async function sendToAgent()");
    expect(fnIdx).toBeGreaterThan(-1);
    assertGuardBeforeSend(src.slice(fnIdx), "prompt-builder.js sendToAgent");
  });
});

// POINT B3 — la commande /prompt (popup de templates) etait explicitement
// EXCLUE du garde au motif qu'elle est une « slash-command ». Or elle ENVOIE
// reellement un prompt a un agent : elle doit donc passer par la politique,
// sans casser les commandes de l'interface qui ne lancent aucun travail (elles
// restent hors du garde). Le refus est visible et la saisie est conservee.
describe("POINT B3 — popup de prompt /prompt (agent-pi.js applyPromptSelection)", () => {
  it("B3 — le garde precede l'envoi ET tout effacement de la saisie", () => {
    const src = readFileSync(new URL("./agent-pi.js", import.meta.url), "utf8");
    const fnIdx = src.indexOf("async function applyPromptSelection()");
    const nextIdx = src.indexOf("\nfunction ", fnIdx + 1);
    expect(fnIdx).toBeGreaterThan(-1);
    const body = src.slice(fnIdx, nextIdx > fnIdx ? nextIdx : undefined);
    assertGuardBeforeSend(body, "agent-pi.js applyPromptSelection");
    // La garde est posee AVANT tout effacement de la saisie (texte conserve).
    const clearIdx = body.indexOf('acInputEl.value = ""');
    expect(clearIdx).toBeGreaterThan(-1);
    expect(body.indexOf("canSendManualCommandAsync(")).toBeLessThan(clearIdx);
    // Les commandes qui ne lancent pas de travail restent hors du garde : la
    // condition d'exclusion du chat (`!isSlashCommand`) est intacte.
    expect(src).toContain('invoke("send_agent_prompt", payload)');
    expect(src).toContain("!isSlashCommand && !canSendManualCommand(window._pilotProjectPath");
  });
});

// POINT D — sens inverse : une mission d'ÉCRITURE (`run_agents`) doit voir une
// commande manuelle en cours (le bus ne la voit pas) et être MISE EN FILE, au
// lieu de démarrer en parallèle. Même garde pour deux commandes manuelles
// concurrentes sur le même projet (deux onglets d'agent). Ces tests ÉCHOUENT si
// l'on revient à la seule sonde du bus.
describe("POINT D — le sens inverse : commande manuelle vs mission d'écriture", () => {
  it("run_agents sonde l'activité du projet en écriture et met en file", () => {
    const src = readFileSync(new URL("./super-agent.js", import.meta.url), "utf8");
    const fnIdx = src.indexOf("const launchOrQueue = async () => {");
    const endIdx = src.indexOf("const reportDeferredLaunch", fnIdx);
    expect(fnIdx).toBeGreaterThan(-1);
    const body = src.slice(fnIdx, endIdx);
    expect(body).toContain("isProjectAgentBusy(target)");
    expect(body).toContain('missionNature === "write"');
    // Mise en file réelle (même file que les autres missions), pas un refus sec.
    expect(body).toContain("runAgentsQueueByProject[target].push(");
  });

  it("deux commandes manuelles concurrentes : le chat sonde aussi l'activité", () => {
    const src = readFileSync(new URL("./agent-pi.js", import.meta.url), "utf8");
    const fnIdx = src.indexOf("const sendPrompt = async () => {");
    const endIdx = src.indexOf("if (voiceActive) stopVoiceInput();", fnIdx);
    expect(fnIdx).toBeGreaterThan(-1);
    const body = src.slice(fnIdx, endIdx);
    expect(body).toContain("canSendManualCommandAsync(window._pilotProjectPath");
    expect(body).toContain("isProjectAgentBusy");
    expect(body).toContain("MANUAL_COMMAND_BLOCKED_MESSAGE");
  });
});

describe("POINT C — l'arrêt d'un agent libère la file de missions du projet", () => {
  it("la branche stop_agent libère le créneau et vide la file de missions (avec message)", () => {
    const src = readFileSync(new URL("./super-agent.js", import.meta.url), "utf8");
    const stopIdx = src.indexOf('action === "stop_agent"');
    const nextIdx = src.indexOf('action === "create_agent"', stopIdx);
    expect(stopIdx).toBeGreaterThan(-1);
    expect(nextIdx).toBeGreaterThan(stopIdx);
    const branch = src.slice(stopIdx, nextIdx);
    expect(branch).toContain("releaseStuckRunLock(queueKey)");
    expect(branch).toContain("runAgentsInFlightByProject[queueKey]");
    expect(branch).toContain("runAgentsQueueByProject[queueKey]");
    // La suite n'est jamais perdue en silence : un message est émis.
    expect(branch).toContain("mission(s) en attente annulée(s)");
  });
});
