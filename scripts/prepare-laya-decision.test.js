// prepare-laya-decision.test.js — verrous du CORRECTIF DE LANCEMENT EN DEV.
//
// Incident : `npm run tauri dev` échouait sur la 3ᵉ étape de `beforeDevCommand`
// (`docs/rapports/RAPPORT-diagnostic-lancement-dev.md`) parce que
// `scripts/prepare-laya.js` EFFAÇAIT d'abord `src-tauri/laya` (123,5 Mo dont un
// `node.exe` de 96 Mo). Fichier tenu ouvert ⇒ `EPERM` non rattrapée ⇒ pile
// d'exception, code 1, Tauri n'affichait plus que « beforeDevCommand terminated
// with a non-zero status code »… et le dossier restait AMPUTÉ.
//
// Ce fichier couvre trois choses, et refuse de les mélanger (même discipline que
// `scripts/release-gates.test.js`) :
//   1. la DÉCISION, pure (`scripts/prepare-laya-decision.js`) : nombre de
//      tentatives, attente, comportement au-delà du plafond, bascule finale ;
//   2. le CABLAGE dans `scripts/prepare-laya.js`, vérifié sur la SOURCE — une
//      décision que personne n'appelle ne corrige rien ;
//   3. la REPRODUCTION RÉELLE d'un dossier tenu ouvert (Windows) : la cible doit
//      rester INTACTE et le message doit être lisible, jamais une pile.
//
// Preuve par mutation attendue : remettre `fs.rmSync(DEST, …)` au début du
// script, ou supprimer l'appel à `installDestination`, fait échouer les tests de
// cablage ; faire échouer le renommage de la cible fait échouer la reproduction.
//
// La lecture des sources normalise les fins de ligne (worktree CRLF) :
// cf. `.pi/skills/quality-gate/SKILL.md` § 3.4.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  EXIT_DESTINATION_LOCKED,
  PREVIOUS_SUFFIX,
  REMOVE_RETRY_ATTEMPTS,
  REMOVE_RETRY_DELAY_MS,
  TEMP_SUFFIX,
  TRANSIENT_CODES,
  copyFailureMessage,
  destinationIntactSentence,
  errorCode,
  failureIsTransient,
  installDestination,
  lockedDestinationMessage,
  previousDirFor,
  removeWithRetries,
  retryStep,
  temporaryCleanupSentence,
  temporaryDirFor,
} from "./prepare-laya-decision.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "prepare-laya.js");
const DECISION = path.join(HERE, "prepare-laya-decision.js");
const TARGET = "win32/x64";
const PLATFORM_DIR = path.join(
  "laya-ts/node_modules/onnxruntime-node/bin/napi-v6",
  TARGET
);

const REQUIRED_FILES = [
  "laya-service.mjs",
  "laya-fetch.mjs",
  "model-manifest.json",
  "laya-ts/package.json",
  "laya-ts/dist/index.js",
  "laya-ts/node_modules/onnxruntime-node/package.json",
  "laya-ts/node_modules/onnxruntime-node/dist/index.js",
  "laya-ts/node_modules/onnxruntime-common/package.json",
  "laya-ts/node_modules/onnxruntime-common/dist/cjs/index.js",
  path.join(PLATFORM_DIR, "onnxruntime.dll"),
];

/** Erreur système fabriquée (même forme que celle de Node). */
function sysError(code) {
  const e = new Error(`${code}: opération impossible`);
  e.code = code;
  return e;
}

// ── 1. DÉCISION PURE : réessais, attente, plafond ───────────────────────────
describe("réessais d'un effacement passagèrement refusé", () => {
  it("une panne passagère est réessayée puis réussit, sans attente superflue", async () => {
    const delays = [];
    let calls = 0;
    const res = await removeWithRetries({
      dest: "src-tauri/laya",
      remove: () => {
        calls += 1;
        if (calls < 3) throw sysError("EBUSY");
      },
      sleep: async (ms) => delays.push(ms),
    });

    expect(res).toEqual({ ok: true, attempts: 3, error: null });
    expect(calls).toBe(3);
    // Une attente ENTRE les tentatives, jamais après la réussite.
    expect(delays).toEqual([REMOVE_RETRY_DELAY_MS, REMOVE_RETRY_DELAY_MS]);
  });

  it("un succès du premier coup n'attend pas du tout", async () => {
    const delays = [];
    const res = await removeWithRetries({
      dest: "d",
      remove: () => {},
      sleep: async (ms) => delays.push(ms),
    });
    expect(res.ok).toBe(true);
    expect(res.attempts).toBe(1);
    expect(delays).toEqual([]);
  });

  it("au-delà du plafond : 8 tentatives, 7 attentes, échec rendu avec sa cause", async () => {
    const delays = [];
    let calls = 0;
    const res = await removeWithRetries({
      dest: "d",
      remove: () => {
        calls += 1;
        throw sysError("EPERM");
      },
      sleep: async (ms) => delays.push(ms),
    });

    expect(calls).toBe(REMOVE_RETRY_ATTEMPTS);
    expect(delays).toHaveLength(REMOVE_RETRY_ATTEMPTS - 1);
    // Aucune attente APRÈS la dernière tentative : on rend la panne tout de suite.
    expect(delays.every((ms) => ms === REMOVE_RETRY_DELAY_MS)).toBe(true);
    expect(res.ok).toBe(false);
    expect(res.attempts).toBe(REMOVE_RETRY_ATTEMPTS);
    expect(errorCode(res.error)).toBe("EPERM");
  });

  it("une panne DÉFINITIVE n'est pas réessayée (aucune attente pour rien)", async () => {
    const delays = [];
    let calls = 0;
    const res = await retryStep({
      action: () => {
        calls += 1;
        throw sysError("ENOSPC");
      },
      sleep: async (ms) => delays.push(ms),
    });
    expect(calls).toBe(1);
    expect(res.attempts).toBe(1);
    expect(res.ok).toBe(false);
    expect(delays).toEqual([]);
  });

  it("le plafond est réglable et respecté", async () => {
    let calls = 0;
    const res = await retryStep({
      action: () => {
        calls += 1;
        throw sysError("EBUSY");
      },
      attempts: 3,
      delayMs: 1,
      sleep: async () => {},
    });
    expect(calls).toBe(3);
    expect(res.attempts).toBe(3);
  });

  it("seuls les codes « tenu ouvert » sont passagers", () => {
    for (const code of TRANSIENT_CODES) {
      expect(failureIsTransient(sysError(code))).toBe(true);
      expect(failureIsTransient({ code: code.toLowerCase() })).toBe(true);
    }
    expect(failureIsTransient(sysError("ENOSPC"))).toBe(false);
    expect(failureIsTransient(sysError("EROFS"))).toBe(false);
    expect(failureIsTransient(null)).toBe(false);
    expect(errorCode({})).toBe("");
  });
});

// ── 2. DÉCISION PURE : la bascule finale ────────────────────────────────────
/**
 * Faux système de fichiers : enregistre l'ordre des opérations et permet de
 * faire échouer un geste précis (« tenu ouvert »).
 */
function fakeFs({ destExists = true, previousExists = false, locks = {} } = {}) {
  const calls = [];
  const state = { dest: destExists, previous: previousExists, tmp: true };
  let lockCount = {};
  const locked = (gesture) => {
    const max = locks[gesture] ?? 0;
    lockCount[gesture] = (lockCount[gesture] ?? 0) + 1;
    return lockCount[gesture] <= max;
  };
  return {
    calls,
    state,
    exists: (p) => {
      const suffix = p.endsWith(PREVIOUS_SUFFIX) ? "previous" : "dest";
      return suffix === "previous" ? state.previous : state.dest;
    },
    rename: (from, to) => {
      const toPrevious = to.endsWith(PREVIOUS_SUFFIX);
      calls.push(toPrevious ? "rename:dest->previous" : "rename:tmp->dest");
      if (locked(toPrevious ? "move-aside" : "place-new")) {
        throw sysError("EBUSY");
      }
      if (toPrevious) {
        state.dest = false;
        state.previous = true;
      } else {
        state.tmp = false;
        state.dest = true;
      }
    },
    remove: (p) => {
      const which = p.endsWith(PREVIOUS_SUFFIX) ? "previous" : "other";
      calls.push(`remove:${which}`);
      if (which === "previous") {
        if (locked("drop-previous")) throw sysError("EPERM");
        state.previous = false;
      }
    },
    sleep: async () => {},
  };
}

describe("bascule finale : construire à côté puis remplacer d'un bloc", () => {
  it("cible absente : un seul renommage, aucune suppression préalable", async () => {
    const io = fakeFs({ destExists: false });
    const res = await installDestination({
      dest: "/x/laya",
      tmp: "/x/laya.tmp",
      ...io,
    });

    expect(res.ok).toBe(true);
    expect(res.stage).toBe("done");
    expect(res.steps).toEqual(["place-new"]);
    // Aucune destruction : la bascule n'efface jamais la cible d'abord.
    expect(io.calls).toEqual(["rename:tmp->dest"]);
  });

  it("cible présente : mise de côté, mise en place, puis effacement de l'ancienne", async () => {
    const io = fakeFs({ destExists: true });
    const res = await installDestination({
      dest: "/x/laya",
      tmp: "/x/laya.tmp",
      ...io,
    });

    expect(res.ok).toBe(true);
    expect(res.steps).toEqual(["move-aside", "place-new", "drop-previous"]);
    expect(io.calls).toEqual([
      "rename:dest->previous",
      "rename:tmp->dest",
      "remove:previous",
    ]);
    expect(res.previousLeftBehind).toBe(false);
  });

  it("cible TENUE OUVERTE : échec après le plafond, cible jamais touchée", async () => {
    const io = fakeFs({
      destExists: true,
      locks: { "move-aside": REMOVE_RETRY_ATTEMPTS },
    });
    const res = await installDestination({
      dest: "/x/laya",
      tmp: "/x/laya.tmp",
      ...io,
    });

    expect(res.ok).toBe(false);
    expect(res.stage).toBe("move-aside");
    expect(res.attempts).toBe(REMOVE_RETRY_ATTEMPTS);
    expect(errorCode(res.error)).toBe("EBUSY");
    // Aucune suppression de la cible n'a même été tentée : elle est intacte.
    expect(io.calls.every((c) => c === "rename:dest->previous")).toBe(true);
    expect(io.state.dest).toBe(true);
    // Le temporaire n'a pas été consommé : il peut être effacé proprement.
    expect(io.state.tmp).toBe(true);
  });

  it("échec de la mise en place : l'ancien dossier est REMIS en place", async () => {
    const io = fakeFs({
      destExists: true,
      locks: { "place-new": REMOVE_RETRY_ATTEMPTS },
    });
    const res = await installDestination({
      dest: "/x/laya",
      tmp: "/x/laya.tmp",
      ...io,
    });

    expect(res.ok).toBe(false);
    expect(res.stage).toBe("place-new");
    expect(res.restored).toBe(true);
    expect(io.state.dest).toBe(true);
    expect(destinationIntactSentence(res)).toContain("remis en place");
  });

  it("un ancien dossier resté d'une bascule interrompue est effacé avant la bascule", async () => {
    const io = fakeFs({ destExists: true, previousExists: true });
    const res = await installDestination({
      dest: "/x/laya",
      tmp: "/x/laya.tmp",
      ...io,
    });

    expect(res.ok).toBe(true);
    expect(res.steps).toEqual([
      "drop-previous",
      "move-aside",
      "place-new",
      "drop-previous",
    ]);
  });

  it("un ancien dossier impossible à effacer après coup n'est pas fatal", async () => {
    const io = fakeFs({
      destExists: true,
      locks: { "drop-previous": 99 },
    });
    const res = await installDestination({
      dest: "/x/laya",
      tmp: "/x/laya.tmp",
      ...io,
    });

    expect(res.ok).toBe(true);
    expect(res.previousLeftBehind).toBe(true);
  });
});

// ── 3. MESSAGES : lisibles, actionnables, sans pile ─────────────────────────
describe("messages d'échec", () => {
  const message = lockedDestinationMessage({
    dest: "G:\\IA_PL\\pilot\\src-tauri\\laya",
    attempts: REMOVE_RETRY_ATTEMPTS,
    delayMs: REMOVE_RETRY_DELAY_MS,
    error: sysError("EPERM"),
    stage: "move-aside",
  });

  it("nomme le dossier, le nombre de tentatives et la cause", () => {
    expect(message).toContain("src-tauri\\laya");
    expect(message).toContain(`${REMOVE_RETRY_ATTEMPTS} tentative`);
    expect(message).toContain(`${REMOVE_RETRY_DELAY_MS} ms`);
    expect(message).toContain("EPERM");
  });

  it("dit QUOI FAIRE, en français et dans l'ordre", () => {
    expect(message).toContain("Ce qu'il faut faire");
    expect(message).toMatch(/1\. fermez Pilot/);
    expect(message).toMatch(/2\. arrêtez le service Laya/);
    expect(message).toMatch(/3\. relancez la commande \(npm run tauri dev\)/);
  });

  it("annonce que l'état existant est intact, et ne déverse aucune pile", () => {
    expect(message).toContain("Rien n'a été effacé");
    expect(message).not.toMatch(/\n\s+at /);
    expect(message).not.toContain("node:fs");
  });

  it("le code de sortie est explicite et distinct d'un échec de garde-fou", () => {
    expect(EXIT_DESTINATION_LOCKED).toBe(2);
    expect(EXIT_DESTINATION_LOCKED).not.toBe(0);
    expect(EXIT_DESTINATION_LOCKED).not.toBe(1);
  });

  it("l'échec d'une copie nomme la pièce et le geste, sans pile", () => {
    const m = copyFailureMessage({
      rel: "node/node.exe",
      target: "G:\\IA_PL\\pilot\\src-tauri\\laya",
      error: sysError("EPERM"),
    });
    expect(m).toContain("node/node.exe");
    expect(m).toContain("EPERM");
    expect(m).toContain("n'a pas été abîmé");
    expect(m).not.toMatch(/\n\s+at /);
  });

  it("dit ce qu'est devenu le dossier temporaire", () => {
    expect(
      temporaryCleanupSentence({ tmp: "/x/laya.tmp", removed: true })
    ).toContain("a été supprimée");
    expect(
      temporaryCleanupSentence({ tmp: "/x/laya.tmp", removed: false })
    ).toContain("sera reprise au prochain lancement");
  });

  it("les suffixes de travail sont ceux annoncés", () => {
    expect(temporaryDirFor("/x/laya")).toBe(`/x/laya${TEMP_SUFFIX}`);
    expect(previousDirFor("/x/laya")).toBe(`/x/laya${PREVIOUS_SUFFIX}`);
  });
});

// ── 4. CABLAGE dans le script réel ──────────────────────────────────────────
function lire(rel) {
  return fs.readFileSync(rel, "utf8").replace(/\r\n/g, "\n");
}

/**
 * Retire les commentaires pour ne juger que le CODE. Ne retire que les
 * commentaires qui occupent des lignes ENTIÈRES : un `//` en fin de ligne ou un
 * `/*` au milieu d'un texte (ex. « dist/*.js ») n'est jamais pris pour un
 * commentaire, sinon une ancre de code pourrait être avalée par erreur.
 */
function sansCommentaires(src) {
  return src
    .replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("câblage de prepare-laya.js", () => {
  const code = sansCommentaires(lire(SCRIPT));

  it("le script n'efface plus la cible d'abord (défaut d'origine)", () => {
    expect(code).not.toMatch(/fs\.rmSync\(\s*DEST/);
    expect(code).not.toMatch(/fs\.rmSync\(\s*path\.join\(\s*ROOT/);
  });

  it("il réessaie et il bascule par les décisions du module dédié", () => {
    expect(code).toMatch(/from "\.\/prepare-laya-decision\.js"/);
    expect(code).toMatch(/removeWithRetries\(/);
    expect(code).toMatch(/installDestination\(/);
    expect(code).toMatch(/lockedDestinationMessage\(/);
    expect(code).toMatch(/EXIT_DESTINATION_LOCKED/);
  });

  it("il construit dans le dossier temporaire, pas dans la cible", () => {
    expect(code).toMatch(/temporaryDirFor\(DEST\)/);
    // Aucune copie ne vise la cible directement.
    expect(code).not.toMatch(/path\.join\(DEST,\s*rel\)/);
    expect(code).toMatch(/const dst = path\.join\(STAGE, rel\)/);
  });

  it("il nomme l'étape fautive pour que Tauri ne dise pas qu'un code non nul", () => {
    expect(code).toMatch(/failureHeadline\(\)/);
  });
});

// ── 5. REPRODUCTION RÉELLE : dossier tenu ouvert (Windows) ──────────────────
const sandboxes = [];

function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-laya-lock-"));
  sandboxes.push(root);
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(root, "scripts", "prepare-laya.js"));
  fs.copyFileSync(
    DECISION,
    path.join(root, "scripts", "prepare-laya-decision.js")
  );
  return root;
}

function makeSource(root) {
  const src = path.join(root, "LayaPL");
  for (const rel of REQUIRED_FILES) {
    const abs = path.join(src, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `contenu:${rel}`);
  }
  return src;
}

function runScript(root, source) {
  return spawnSync(
    process.execPath,
    [path.join(root, "scripts", "prepare-laya.js")],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        LAYA_SOURCE_DIR: source,
        LAYA_TARGET_PLATFORM: TARGET,
        LAYA_EMBED_NODE: "0",
        LAYA_ALLOW_MISSING: "",
      },
    }
  );
}

afterEach(() => {
  for (const root of sandboxes.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("reproduction : un programme tient le dossier laya ouvert", () => {
  it.runIf(process.platform === "win32")(
    "échec LISIBLE (code 2) puis cible INTACTE, et le lancement suivant réussit",
    async () => {
      const root = makeSandbox();
      const src = makeSource(root);
      const dest = path.join(root, "src-tauri", "laya");

      // Le dossier contient déjà une « version complète » : elle ne doit pas
      // être amputée par l'échec (c'était le second défaut de l'incident).
      fs.mkdirSync(path.join(dest, "node"), { recursive: true });
      fs.writeFileSync(path.join(dest, "laya-service.mjs"), "ancienne version");
      fs.writeFileSync(path.join(dest, "node", "node.exe"), "ancien node");

      // Le verrou : un processus dont le répertoire courant EST la cible.
      // Windows refuse alors de la renommer (EBUSY) et de l'effacer (EPERM) —
      // exactement ce que produit un `node.exe` lancé depuis ce dossier.
      const holder = spawn(
        process.execPath,
        ["-e", "setTimeout(() => {}, 60000)"],
        { cwd: dest, windowsHide: true }
      );
      await new Promise((resolve, reject) => {
        holder.once("spawn", resolve);
        holder.once("error", reject);
      });
      await new Promise((r) => setTimeout(r, 400));

      let locked;
      try {
        locked = runScript(root, src);
      } finally {
        holder.kill();
        await new Promise((r) => holder.once("exit", r));
      }

      // 1. L'échec est VISIBLE et LISIBLE : code explicite, message français.
      expect(locked.status).toBe(EXIT_DESTINATION_LOCKED);
      expect(locked.stderr).toContain("prepare-laya");
      expect(locked.stderr).toContain("Ce qu'il faut faire");
      expect(locked.stderr).toContain("npm run tauri dev");
      // Aucune trace technique incompréhensible (pile d'exception Node).
      expect(locked.stderr).not.toMatch(/\n\s+at /);
      expect(locked.stderr).not.toContain("node:fs");

      // 2. L'état existant n'a pas été détruit.
      expect(fs.readFileSync(path.join(dest, "laya-service.mjs"), "utf8")).toBe(
        "ancienne version"
      );
      expect(fs.readFileSync(path.join(dest, "node", "node.exe"), "utf8")).toBe(
        "ancien node"
      );
      // Aucun dossier de travail laissé derrière.
      expect(fs.existsSync(temporaryDirFor(dest))).toBe(false);

      // 3. Verrou libéré : le lancement suivant aboutit et remplace le contenu.
      const retry = runScript(root, src);
      expect(retry.status, retry.stderr).toBe(0);
      expect(
        fs.readFileSync(path.join(dest, "laya-service.mjs"), "utf8")
      ).toBe("contenu:laya-service.mjs");
      expect(fs.existsSync(path.join(dest, "node", "node.exe"))).toBe(false);
      expect(fs.existsSync(temporaryDirFor(dest))).toBe(false);
      expect(fs.existsSync(previousDirFor(dest))).toBe(false);
    },
    60000
  );

  it("chemin normal : le dossier final est complet et identique au contenu préparé", () => {
    const root = makeSandbox();
    const src = makeSource(root);
    const dest = path.join(root, "src-tauri", "laya");

    // Deux exécutions de suite : l'idempotence est le comportement attendu.
    expect(runScript(root, src).status).toBe(0);
    const first = fs.readFileSync(path.join(dest, "laya-service.mjs"), "utf8");
    expect(runScript(root, src).status).toBe(0);

    expect(fs.readFileSync(path.join(dest, "laya-service.mjs"), "utf8")).toBe(
      first
    );
    for (const rel of REQUIRED_FILES) {
      const abs = path.join(dest, rel);
      expect(fs.existsSync(abs), rel).toBe(true);
      expect(fs.statSync(abs).size, rel).toBeGreaterThan(0);
    }
    // Aucun reste de travail après un succès.
    expect(fs.existsSync(temporaryDirFor(dest))).toBe(false);
    expect(fs.existsSync(previousDirFor(dest))).toBe(false);
  });
});
