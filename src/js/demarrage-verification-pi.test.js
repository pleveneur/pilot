// Tests — VÉRIFICATION DE LA VERSION DU MOTEUR (pi) AU DÉMARRAGE.
//
// Règle du propriétaire (non réinterprétée) :
//   1. au lancement de Pilot, la PREMIÈRE chose faite est de vérifier la version
//      du moteur `pi` ;
//   2. rien ne démarre avant la fin de cette vérification, ni pendant une
//      installation de `pi` : commande manuelle, lancement par l'Assistant,
//      mission mise en file, rejeu d'une mission en attente, délégation à un
//      agent ;
//   3. si la vérification échoue ou traîne, l'utilisateur est INFORMÉ (avec la
//      marche à suivre) et le travail reprend : jamais de blocage définitif ;
//   4. une seule décision (`run-policy.js`), un seul état (`pi-startup-gate.js`) :
//      pas de second gardien, pas de règle recopiée.
//
// Chaque contrôle de ce fichier ÉCHOUE si la garde correspondante est retirée
// (voir le rapport : neutralisation puis restauration à l'identique).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Notifications : observées (l'échec DOIT être dit à l'utilisateur), jamais
// affichées. Aucun accès Tauri n'est déclenché (dépendances injectées).
vi.mock("./toast.js", () => ({
  showToast: vi.fn(),
  initToasts: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
  toastInfo: vi.fn(),
  toastPersistent: vi.fn(),
}));

import * as gate from "./pi-startup-gate.js";
import * as policy from "./run-policy.js";
import * as piUpdate from "./pi-update.js";
import * as toast from "./toast.js";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(resolve(here, p), "utf8").replace(/\r\n/g, "\n");

const PROJECT = "G:\\IA_PL\\pilot";

beforeEach(() => {
  gate.__resetPiStartupGateForTest();
  vi.clearAllMocks();
});

describe("a — aucun lancement ne passe PENDANT la vérification", () => {
  it("le terrain est réservé synchronement et TOUS les chemins sont refusés", async () => {
    let releaseCheck;
    const check = vi.fn(() => new Promise((res) => { releaseCheck = res; }));
    const running = piUpdate.runPiStartupCheck({ probe: async () => {}, check });

    // Réservation posée dès le premier instant (aucun `await` avant) : l'appelant
    // n'a même pas encore rendu la main que le terrain est déjà réservé.
    expect(gate.isPiStartupGateBlocking()).toBe(true);

    // Chemin 1 — lancement d'une mission / rejeu (décideur du bus).
    expect(policy.canStartWork(PROJECT, "write", () => false)).toBe(false);
    expect(policy.canStartWork(PROJECT, "read", () => false)).toBe(false);
    // Chemin 2 — commande manuelle (synchrone et asynchrone).
    expect(policy.canSendManualCommand(PROJECT, () => false)).toBe(false);
    await expect(policy.canSendManualCommandAsync(PROJECT, () => false)).resolves.toBe(false);
    // Chemin 3 — première réflexion de l'Assistant.
    expect(policy.canAssistantReflect()).toBe(false);
    // Le motif EXACT est dit à l'utilisateur (texte du garde, une seule source).
    expect(policy.workBlockedMessage()).toBe(gate.PI_CHECKING_BLOCKED_MESSAGE);
    expect(policy.manualCommandBlockedMessage()).toBe(gate.PI_CHECKING_BLOCKED_MESSAGE);
    expect(policy.assistantReflectionBlockedMessage()).toBe(gate.PI_CHECKING_BLOCKED_MESSAGE);

    // Fin de la vérification : le travail reprend immédiatement.
    releaseCheck({ ok: true });
    await expect(running).resolves.toEqual({ ok: true, outcome: "checked" });
    expect(gate.isPiStartupGateBlocking()).toBe(false);
    expect(policy.canStartWork(PROJECT, "write", () => false)).toBe(true);
    expect(policy.canSendManualCommand(PROJECT, () => false)).toBe(true);
    expect(policy.canAssistantReflect()).toBe(true);
    // Aucune alerte : une vérification réussie n'inquiète personne.
    expect(toast.toastError).not.toHaveBeenCalled();
    expect(toast.toastWarning).not.toHaveBeenCalled();
  });
});

describe("b — aucun lancement ne passe PENDANT une installation de pi", () => {
  it("la réservation d'installation refuse tous les chemins et nomme la version", () => {
    gate.beginPiStartupUpdate({ version: "9.9.9" });

    expect(gate.isPiStartupGateBlocking()).toBe(true);
    expect(gate.getPiStartupGateState()).toMatchObject({ blocking: true, reason: "updating" });
    expect(policy.canStartWork(PROJECT, "write", () => false)).toBe(false);
    expect(policy.canSendManualCommand(PROJECT, () => false)).toBe(false);
    expect(policy.canAssistantReflect()).toBe(false);
    // Le message d'attente nomme l'opération ET la version.
    const message = policy.workBlockedMessage();
    expect(message).toContain("Mise à jour de l'agent Pi 9.9.9");
    expect(message).toBe(gate.piUpdatingBlockedMessage("9.9.9"));

    // Fin d'installation (succès ou échec) : le terrain est rendu.
    gate.endPiStartupGate("updated", { current: "9.9.9" });
    expect(policy.canStartWork(PROJECT, "write", () => false)).toBe(true);
  });
});

describe("c — un échec de vérification ne bloque JAMAIS le travail", () => {
  it("échec : terrain rendu, travail autorisé, rien ne reste armé", async () => {
    const check = vi.fn(async () => {
      throw new Error("réseau indisponible");
    });
    const res = await piUpdate.runPiStartupCheck({ probe: async () => {}, check });

    expect(res).toEqual({ ok: false, outcome: "check-failed" });
    expect(gate.isPiStartupGateBlocking()).toBe(false);
    expect(gate.getPiStartupGateState()).toMatchObject({ blocking: false, outcome: "check-failed" });
    expect(policy.canStartWork(PROJECT, "write", () => false)).toBe(true);
    expect(policy.canSendManualCommand(PROJECT, () => false)).toBe(true);
    expect(policy.canAssistantReflect()).toBe(true);
  });

  it("verdict d'échec du backend (sans exception) : même résultat", async () => {
    const res = await piUpdate.runPiStartupCheck({
      probe: async () => {},
      check: async () => ({ ok: false, reason: "check-failed", error: "boom" }),
    });

    expect(res).toEqual({ ok: false, outcome: "check-failed" });
    expect(policy.canStartWork(PROJECT, "write", () => false)).toBe(true);
  });

  it("vérification qui traîne : terrain rendu au délai, jamais de blocage définitif", async () => {
    const res = await piUpdate.runPiStartupCheck({
      probe: async () => {},
      check: () => new Promise(() => {}), // ne répond jamais
      timeoutMs: 10,
    });

    expect(res).toEqual({ ok: false, outcome: "check-timeout" });
    expect(gate.isPiStartupGateBlocking()).toBe(false);
    expect(policy.canStartWork(PROJECT, "write", () => false)).toBe(true);
  });

  it("filet de dernier recours du garde lui-même : au-delà du plafond, le terrain est rendu", () => {
    let now = 0;
    gate.__resetPiStartupGateForTest(() => now);
    gate.beginPiStartupCheck({ maxMs: 1000 });
    expect(gate.isPiStartupGateBlocking()).toBe(true);
    now = 5000;
    expect(gate.isPiStartupGateBlocking()).toBe(false);
    expect(gate.getPiStartupGateState()).toMatchObject({ blocking: false, outcome: "gate-timeout" });
    expect(policy.canStartWork(PROJECT, "write", () => false)).toBe(true);
  });
});

describe("d — l'échec est DIT à l'utilisateur, avec la marche à suivre", () => {
  it("échec : notification d'erreur contenant l'action à faire", async () => {
    await piUpdate.runPiStartupCheck({
      probe: async () => {},
      check: async () => {
        throw new Error("boom");
      },
    });

    expect(toast.toastError).toHaveBeenCalledTimes(1);
    const message = toast.toastError.mock.calls[0][0];
    expect(message).toBe(piUpdate.PI_CHECK_FAILED_MESSAGE);
    expect(message).toContain("pi update --self"); // quoi faire
    expect(message).toContain("le travail démarre"); // rien n'est bloqué
  });

  it("lenteur : notification d'avertissement, distincte de l'échec", async () => {
    await piUpdate.runPiStartupCheck({
      probe: async () => {},
      check: () => new Promise(() => {}),
      timeoutMs: 10,
    });

    expect(toast.toastWarning).toHaveBeenCalledTimes(1);
    const message = toast.toastWarning.mock.calls[0][0];
    expect(message).toBe(piUpdate.PI_CHECK_SLOW_MESSAGE);
    expect(message).toContain("pi update --self");
    expect(toast.toastError).not.toHaveBeenCalled();
  });
});

describe("e — une seule décision, un seul état : pas de second gardien", () => {
  const policySrc = read("run-policy.js");
  const gateSrc = read("pi-startup-gate.js");
  const updateSrc = read("pi-update.js");
  const main = read("main.js");

  it("le gardien unique combine les réservations (moteur + mise à jour de Pilot)", () => {
    expect(policySrc).toContain("return isPiStartupGateBlocking() || isUpdateWindowReserved();");
    expect(policySrc).toContain("return piStartupGateMessage() || updateWindowBlockedMessage();");
    expect(policySrc).toContain("export function canAssistantReflect()");
  });

  it("le module du garde ne possède QUE son état (il ne recompose aucune autre règle)", () => {
    expect(gateSrc).not.toContain("isUpdateWindowReserved");
    // Il ne DÉCIDE pas et n'appelle aucun autre gardien : il ne détient que son
    // propre état (les commentaires peuvent citer le gardien, pas l'appeler).
    expect(gateSrc).not.toContain("canStartWork(");
    expect(gateSrc).not.toContain("isRunInProgress(");
    expect(gateSrc).not.toContain("from \"./run-policy.js\"");
    // Il n'arme rien tout seul et ne notifie personne : la séquence est ailleurs.
    expect(gateSrc).not.toContain("toast");
  });

  it("aucun module de lancement ne lit l'état du garde directement", () => {
    const consumers = [
      "main.js",
      "tabs.js",
      "agent-pi.js",
      "agents-bus.js",
      "super-agent.js",
      "sidebar.js",
      "prompt-builder.js",
      "updater.js",
      "orchestration.js",
    ].filter((f) => read(f).includes("isPiStartupGateBlocking"));
    expect(consumers).toEqual([]); // la décision passe par run-policy.js
    expect(policySrc).toContain("isPiStartupGateBlocking");
  });

  it("une seule séquence arme et rend le terrain (pi-update.js)", () => {
    const modules = [
      "main.js",
      "tabs.js",
      "agent-pi.js",
      "agents-bus.js",
      "super-agent.js",
      "sidebar.js",
      "prompt-builder.js",
      "updater.js",
    ];
    const armers = modules.filter((f) => /beginPiStartup(Check|Update)\(/.test(read(f)));
    expect(armers).toEqual([]);
    expect(updateSrc).toContain("beginPiStartupCheck({ maxMs: timeoutMs })");
    expect(updateSrc).toContain("beginPiStartupUpdate({ version: _latest })");
    expect(updateSrc).toContain("endPiStartupGate(outcome,");
  });

  it("les chemins de lancement consultent TOUS ce même gardien", () => {
    // Commande manuelle (saisie, palette, prompt) et rejeu de la file manuelle.
    for (const f of ["agent-pi.js", "sidebar.js", "prompt-builder.js"]) {
      expect(read(f)).toContain("canSendManualCommandAsync");
    }
    // Mission mise en file / rejeu / délégation : décideur du bus et gardien du
    // super-agent (admissions, rejeux, vidage de file).
    expect(read("agents-bus.js")).toContain("canStartWork(runProject, nature, isRunInProgress)");
    const superAgent = read("super-agent.js");
    expect(superAgent).toContain("isTerrainReserved()");
    expect(superAgent).toContain("canAssistantReflect()");
  });

  it("l'installation de pi est encadrée (réservation avant, terrain rendu après)", () => {
    const body = updateSrc.slice(updateSrc.indexOf("async function doUpdate()"));
    const armIdx = body.indexOf("beginPiStartupUpdate(");
    const invokeIdx = body.indexOf('invoke("update_pi")');
    const endIdx = body.indexOf("endPiStartupGate(outcome");
    expect(armIdx).toBeGreaterThan(-1);
    expect(invokeIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(-1);
    expect(armIdx).toBeLessThan(invokeIdx); // réservé AVANT l'installation
    expect(endIdx).toBeGreaterThan(invokeIdx); // rendu APRÈS, dans un finally
    expect(body).toContain("} finally {");
  });

  it("la séquence de démarrage est lancée en tout premier (main.js)", () => {
    expect(main).toContain("runPiStartupCheck();");
    expect(main.indexOf("runPiStartupCheck();")).toBeLessThan(main.indexOf("initTheme();"));
  });
});
