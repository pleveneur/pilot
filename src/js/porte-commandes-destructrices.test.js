/**
 * GARDE-FOU DES COMMANDES DESTRUCTRICES — la PORTE (comportement observé).
 *
 * Ce fichier ne lit pas la décision : il EXÉCUTE la porte embarquée dans une
 * session d'agent simulée (mêmes hooks que pi) et observe ce qui se passe.
 * C'est ce qui prouve les deux exigences de la demande :
 *   1. une commande destructrice ne part JAMAIS sans accord explicite — ni par
 *      oubli de réponse, ni par exception, ni en mode autonome ;
 *   2. une commande ordinaire passe normalement, sans fatiguer l'utilisateur.
 *
 * Le cœur de décision (`destructive-command.js`) n'existe pas dans
 * l'arborescence : il est écrit À CÔTÉ de l'extension au lancement
 * (`agent_service.rs`). `vitest.config.js` fait pointer ce spécifieur sur la
 * source unique du dépôt, ce qui permet d'exécuter la VRAIE porte.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import guard from "../../src-tauri/extensions/pilot-bash-guard.ts";
import { BASH_GATE_SENTINEL, parseDestructiveGateMessage } from "./destructive-command.js";
import { readableMachineText } from "./machine-sentinel.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = "/home/dev/projet";

afterEach(() => {
  vi.useRealTimers();
});

/** Charge l'extension comme pi : on intercepte l'enregistrement des hooks. */
function loadGuard() {
  const hooks = {};
  guard({
    on: (event, handler) => {
      (hooks[event] = hooks[event] || []).push(handler);
    },
  });
  expect(hooks.tool_call, "la porte doit écouter tool_call").toHaveLength(1);
  return hooks.tool_call[0];
}

/**
 * Contexte de session fidèle au mode RPC de pi : `confirm` n'est résolu que par
 * la réponse de Pilot… ou par la borne `timeout` (valeur par défaut `false`).
 * `answer` renvoyant `undefined` = Pilot ne répond JAMAIS.
 */
function makeCtx({ cwd = PROJECT, answer = () => false, confirmThrows = false } = {}) {
  const requests = [];
  const ctx = {
    cwd,
    ui: {
      confirm: (title, message, opts) => {
        requests.push({ title, message, opts });
        if (confirmThrows) throw new Error("dialogue indisponible");
        return new Promise((resolve) => {
          const value = answer({ title, message, opts });
          if (value === undefined) {
            if (opts && opts.timeout) setTimeout(() => resolve(false), opts.timeout);
            return; // aucune borne : la promesse ne serait jamais résolue
          }
          resolve(value);
        });
      },
    },
  };
  return { ctx, requests };
}

function shellEvent(command, toolName = "bash") {
  return { toolName, input: { command } };
}

describe("1. une commande destructrice ne part jamais sans accord", () => {
  it("`rm -rf` en pleine racine : l'agent DOIT demander l'accord", async () => {
    const hook = loadGuard();
    const { ctx, requests } = makeCtx({ answer: () => false });
    const result = await hook(shellEvent("rm -rf /"), ctx);

    expect(requests, "un dialogue de confirmation est attendu").toHaveLength(1);
    // La demande porte la sentinelle de la porte : Pilot affiche sa propre
    // confirmation lisible (commande, danger, conséquence), pas la fenêtre
    // générique « Oui / Non » de pi.
    expect(requests[0].message.startsWith(BASH_GATE_SENTINEL)).toBe(true);
    const payload = parseDestructiveGateMessage(requests[0].message);
    expect(payload.command).toBe("rm -rf /");
    expect(payload.family).toBe("disque");
    expect(requests[0].title).toContain("Commande dangereuse");
    // Refus → la commande n'est PAS lancée, et le motif le dit en français.
    expect(result.block).toBe(true);
    expect(result.reason).toContain("REFUSÉE");
    expect(result.reason).toContain("NON exécutée");
  });

  it("Pilot ne répond pas : la borne expirée équivaut à un REFUS (fail-closed)", async () => {
    vi.useFakeTimers();
    const hook = loadGuard();
    const { ctx, requests } = makeCtx({ answer: () => undefined });

    const pending = hook(shellEvent("git push --force origin main"), ctx);
    // La promesse ne doit pas être résolue avant la borne : c'est exactement ce
    // qui suspendait la session (bug « agents figés ») — sauf qu'ici la borne
    // est TOUJOURS fournie par l'extension.
    await vi.advanceTimersByTimeAsync(1);
    expect(requests).toHaveLength(1);
    expect(typeof requests[0].opts.timeout).toBe("number");
    expect(requests[0].opts.timeout).toBeGreaterThan(0);
    expect(requests[0].opts.timeout).toBeLessThanOrEqual(5 * 60 * 1000);

    await vi.advanceTimersByTimeAsync(requests[0].opts.timeout);
    const result = await pending;
    expect(result, "sans réponse, la commande ne part pas").toBeTruthy();
    expect(result.block).toBe(true);
  });

  it("le dialogue échoue : la commande est BLOQUÉE (à l'inverse d'une porte ouverte)", async () => {
    const hook = loadGuard();
    const { ctx } = makeCtx({ confirmThrows: true });
    const result = await hook(shellEvent("mkfs.ext4 /dev/sdb1"), ctx);
    expect(result.block).toBe(true);
    expect(result.reason).toContain("n'a pas pu vérifier");
  });

  it("un accord EXPLICITE laisse passer la commande (le garde-fou n'est pas un mur)", async () => {
    const hook = loadGuard();
    const { ctx, requests } = makeCtx({ answer: () => true });
    const result = await hook(shellEvent("rm -rf /home/dev/projet/build"), ctx);
    expect(requests).toHaveLength(1);
    expect(result).toBeUndefined();
  });

  it("les neuf familles exigées demandent toutes l'accord", async () => {
    const hook = loadGuard();
    const COMMANDS = [
      "rm -rf build",
      "rm -f donnees.csv",
      "dd if=/dev/zero of=/dev/sda",
      "mkfs.ext4 /dev/sdb1",
      "shutdown -h now",
      "chmod -R 777 .",
      "git push --force origin main",
      "git reset --hard origin/main",
      "cp secret.txt /home/dev/autre-projet/secret.txt",
    ];
    for (const command of COMMANDS) {
      const { ctx, requests } = makeCtx({ answer: () => false });
      const result = await hook(shellEvent(command), ctx);
      expect(requests, `« ${command} » doit demander l'accord`).toHaveLength(1);
      expect(result.block, `« ${command} » doit être bloquée si refusée`).toBe(true);
    }
  });
});

describe("2. le quotidien passe normalement", () => {
  const ORDINARY = [
    "npm test",
    "npm run build",
    "git status",
    "git diff",
    "git push origin main",
    "ls -la",
    "cat README.md",
    "node scripts/build.js",
    "cargo test --workspace",
    "mkdir -p src/js/nouveau",
    "echo coucou > resultat.txt",
  ];

  it("aucune commande ordinaire n'ouvre de dialogue", async () => {
    const hook = loadGuard();
    for (const command of ORDINARY) {
      const { ctx, requests } = makeCtx();
      const result = await hook(shellEvent(command), ctx);
      expect(requests, `« ${command} » ne doit rien demander`).toHaveLength(0);
      expect(result, `« ${command} » ne doit pas être bloquée`).toBeUndefined();
    }
  });

  it("les outils qui ne sont pas des commandes ne sont pas filtrés ici", async () => {
    const hook = loadGuard();
    const { ctx, requests } = makeCtx();
    const result = await hook(
      { toolName: "write", input: { path: "notes.md", content: "rm -rf /" } },
      ctx,
    );
    expect(requests).toHaveLength(0);
    expect(result).toBeUndefined();
  });

  it("une entrée sans commande ne demande rien (aucune gêne inutile)", async () => {
    const hook = loadGuard();
    const { ctx, requests } = makeCtx();
    const result = await hook({ toolName: "bash", input: {} }, ctx);
    expect(requests).toHaveLength(0);
    expect(result).toBeUndefined();
  });

  it("l'accord n'est demandé QUE pour la commande dangereuse d'une série", async () => {
    const hook = loadGuard();
    const asked = [];
    for (const command of ["npm test", "git push --force", "npm run lint"]) {
      const { ctx, requests } = makeCtx({ answer: () => false });
      await hook(shellEvent(command), ctx);
      if (requests.length) asked.push(command);
    }
    expect(asked).toEqual(["git push --force"]);
  });
});

describe("3. la demande reste lisible (règle protégée : aucune sentinelle brute)", () => {
  it("le message affichable est en français et ne montre jamais la sentinelle", async () => {
    const hook = loadGuard();
    const { ctx, requests } = makeCtx({ answer: () => false });
    await hook(shellEvent("git reset --hard origin/main"), ctx);
    const shown = readableMachineText(requests[0].message);
    expect(shown).not.toContain("PILOT_");
    expect(shown).not.toContain("{");
    expect(shown).toContain("git reset --hard origin/main");
    expect(shown).toContain("Pourquoi c'est dangereux");
  });

  it("le titre affichable est une phrase française, jamais une famille machine", async () => {
    const hook = loadGuard();
    const { ctx, requests } = makeCtx({ answer: () => false });
    await hook(shellEvent("shutdown /s /t 0"), ctx);
    const shownTitle = readableMachineText(requests[0].title);
    expect(shownTitle).not.toContain("PILOT_");
    expect(shownTitle).toContain("Commande dangereuse");
  });
});

describe("4. la porte ne dépend d'aucun réglage (ni modèle, ni autonomie)", () => {
  const SOURCE = readFileSync(resolve(HERE, "../../src-tauri/extensions/pilot-bash-guard.ts"), "utf8");

  it("aucun réglage d'autonomie ni de fichier n'est lu par la porte", () => {
    // Le défaut mesuré : un agent autonome ne demandait rien. Ici la porte ne
    // lit AUCUN réglage — elle est la même pour tous les modèles.
    for (const forbidden of ["confirm_file_edits", "autonomous", "orchestration", "provider", "model"]) {
      expect(SOURCE.includes(forbidden), `« ${forbidden} » ne doit pas dispenser de la porte`).toBe(false);
    }
  });

  it("elle n'auto-répond jamais : le seul `confirm` est celui de l'extension", () => {
    expect(SOURCE).toMatch(/ctx\.ui\.confirm\(/);
    // Aucune réponse fabriquée (aucun `confirmed: true` en dur).
    expect(SOURCE).not.toMatch(/confirmed\s*:\s*true/);
  });
});
