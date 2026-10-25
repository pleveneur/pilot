// onboarding-niveau1.test.js — Prise en main de la première ouverture, NIVEAU 1
// (spec_onboarding.md). Ce lot AJOUTE les écrans au socle : trois écrans courts,
// une sortie en UNE seule écriture de configuration, et l'option « Je découvre ».
//
// Ce fichier échoue si :
//   (a) la fenêtre s'ouvre alors que le socle dit de ne pas l'afficher (ou
//       s'ouvre sans état lisible) — c'est le critère cumulatif qui est protégé,
//       pas un simple drapeau ;
//   (b) la fenêtre s'ouvre par-dessus la vérification du moteur (attente non
//       bornée, ou pas d'attente du tout) ;
//   (c) « Passer » écrit autre chose que « déjà vu » ;
//   (d) « Terminer » n'écrit pas les DEUX réglages de lancement, ou écrit en
//       plusieurs fois (écriture partielle possible) ;
//   (e) un écran manque (moteur / projet / modèle / trois repères), ou la
//       fenêtre cesse d'être une modale existante (composant ou onglet nouveau) ;
//   (f) un cas devient muet : liste de modèles vide sans cause ni marche à
//       suivre, bouton « Réessayer » mort, « Passer » désactivé ;
//   (g) l'écran coûte quelque chose : appel de modèle ou session d'agent ;
//   (h) une couleur est écrite en dur ou un token est inventé dans la fenêtre.
//
// Aucun navigateur n'est requis (lecture des sources + fonctions pures).

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { sliceSource, neutraliserSource } from "./source-slice.js";
import {
  ONBOARDING_LAUNCH_SETTINGS,
  ONBOARDING_MODAL_ID,
  ONBOARDING_SCREENS,
  ONBOARDING_SEEN_KEY,
  ONBOARDING_STARTUP_WAIT_MS,
  initOnboarding,
  onboardingEngineReport,
  onboardingModelReport,
  onboardingPatchFinish,
  onboardingPatchSkip,
  onboardingProjectReport,
  onboardingShouldShow,
  onboardingStepLabel,
  waitForStartupHandback,
} from "./onboarding.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
// Fins de ligne normalisées (worktree CRLF sous Windows) — quality-gate § 3.4.
const read = (p) => readFileSync(resolve(root, p), "utf8").replace(/\r\n/g, "\n");

const JS = () => read("src/js/onboarding.js");
const HTML = () => read("index.html");
const MAIN = () => read("src/js/main.js");
const CSS = () => read("src/css/style.css");

/** Configuration de référence : une installation neuve, tous les défauts. */
const freshConfig = () => ({
  theme: "dark",
  rpc_agent_enabled: false,
  integrated_terminal: false,
  super_agent_default_model: "",
  onboarding_seen: false,
  recent_projects: [],
});

/** Espion d'ouverture : ne touche à aucun DOM. */
const makeOpenSpy = () => {
  const calls = [];
  const fn = async (ctx) => {
    calls.push(ctx);
  };
  fn.calls = calls;
  return fn;
};

describe("prise en main — décision d'affichage (aucun second critère)", () => {
  it("n'ouvre rien quand le socle dit de ne pas afficher, même si le champ est faux", async () => {
    // Installation existante : le fichier de configuration est là, le champ
    // n'existe pas encore, et le socle répond `show: false`.
    const open = makeOpenSpy();
    const res = await initOnboarding({
      invoke: async () => ({ config_file_exists: true, onboarding_seen: false, show: false }),
      openModal: open,
    });
    expect(open.calls).toHaveLength(0);
    expect(res).toEqual({ shown: false, reason: "not-required" });
  });

  it("ouvre quand le socle le demande", async () => {
    const open = makeOpenSpy();
    const res = await initOnboarding({
      invoke: async () => ({ config_file_exists: false, onboarding_seen: false, show: true }),
      openModal: open,
      isBusy: () => false,
      startupCheck: Promise.resolve(),
    });
    expect(open.calls).toHaveLength(1);
    expect(res).toEqual({ shown: true, reason: "shown" });
  });

  it("n'ouvre rien quand l'état est illisible (jamais de fenêtre par défaut)", async () => {
    const open = makeOpenSpy();
    const res = await initOnboarding({
      invoke: async () => {
        throw new Error("ipc down");
      },
      openModal: open,
    });
    expect(open.calls).toHaveLength(0);
    expect(res.reason).toBe("state-unavailable");
  });

  it("`show` doit valoir VRAI au sens strict (aucune valeur approchante)", () => {
    expect(onboardingShouldShow({ show: true })).toBe(true);
    expect(onboardingShouldShow({ show: false, onboarding_seen: false })).toBe(false);
    expect(onboardingShouldShow({ show: "true" })).toBe(false);
    expect(onboardingShouldShow(null)).toBe(false);
    expect(onboardingShouldShow(undefined)).toBe(false);
  });

  it("la décision vient bien de la commande du socle, pas d'une lecture locale", () => {
    const src = JS();
    expect(src).toContain('invokeFn("get_onboarding_state")');
    // Le CODE (commentaires neutralisés) ne recalcule jamais la décision à
    // partir des deux faits bruts.
    const code = neutraliserSource(src);
    expect(code).not.toContain("config_file_exists &&");
    expect(code).not.toContain("!state.onboarding_seen");
  });
});

describe("prise en main — jamais par-dessus la vérification du moteur", () => {
  it("attend qu'une vérification qui ne répond pas, puis rend la main (borné)", async () => {
    const never = new Promise(() => {});
    const res = await waitForStartupHandback({
      startupCheck: never,
      isBusy: () => false,
      timeoutMs: 5,
    });
    // La vérification n'a pas répondu : le délai a parlé, et la fenêtre n'est
    // PAS ouverte (idle = false seulement si quelque chose bloque ENCORE).
    expect(res.settled).toBe("timed-out");
    expect(res.idle).toBe(true);
  });

  it("n'affiche pas tant que le terrain n'est pas rendu (garde ou fenêtre de mise à jour)", async () => {
    const res = await waitForStartupHandback({
      startupCheck: Promise.resolve("ok"),
      isBusy: () => true,
      timeoutMs: 30,
      pollMs: 5,
    });
    expect(res.idle).toBe(false);
    expect(res.settled).toBe("settled");
  });

  it("s'affiche dès que le terrain est rendu", async () => {
    let busy = true;
    const sleep = async () => {
      busy = false;
    };
    const res = await waitForStartupHandback({
      startupCheck: Promise.resolve(),
      isBusy: () => busy,
      timeoutMs: 50,
      pollMs: 10,
      sleep,
    });
    expect(res.idle).toBe(true);
  });

  it("un échec de vérification rend la main (aucune attente éternelle)", async () => {
    const failed = Promise.reject(new Error("réseau"));
    failed.catch(() => {});
    const res = await waitForStartupHandback({
      startupCheck: failed,
      isBusy: () => false,
      timeoutMs: 10,
    });
    expect(res.settled).toBe("settled");
    expect(res.idle).toBe(true);
  });

  it("le délai d'attente est BORNÉ (constante finie, pas d'infini)", () => {
    expect(Number.isFinite(ONBOARDING_STARTUP_WAIT_MS)).toBe(true);
    expect(ONBOARDING_STARTUP_WAIT_MS).toBeGreaterThan(0);
    expect(ONBOARDING_STARTUP_WAIT_MS).toBeLessThanOrEqual(60_000);
  });

  it("le démarrage n'attend pas la fenêtre : l'appel est détaché et après la vérification", () => {
    const main = MAIN();
    const call = "void initOnboarding({ tabs, sidebar });";
    expect(main).toContain(call);
    // La règle du propriétaire est INTACTE : la vérification du moteur reste
    // seule sur sa ligne, première et non attendue (verrou
    // `pi-update-startup.test.js`).
    expect(main).toMatch(/\n\s*runPiStartupCheck\(\);\n/);
    expect(main).not.toMatch(/await runPiStartupCheck/);
    // L'appel de la fenêtre vient APRÈS la vérification et APRÈS le chargement.
    const check = main.indexOf("runPiStartupCheck();");
    const open = main.indexOf(call);
    const overlay = main.indexOf('bootOverlay.classList.add("hidden");');
    expect(check).toBeGreaterThan(-1);
    expect(open).toBeGreaterThan(check);
    expect(open).toBeGreaterThan(overlay);
  });

  it("l'attente porte sur le gardien unique du terrain, pas sur un second état", () => {
    const src = JS();
    // Seul propriétaire : `pi-startup-gate.js` (aucun état de blocage recopié).
    expect(src).toContain('from "./pi-startup-gate.js"');
    expect(src).toContain("isPiStartupGateBlocking()");
    // Et la proposition de mise à jour affichée n'est jamais recouverte.
    expect(src).toContain("ONBOARDING_PI_UPDATE_MODAL_ID");
    expect(src).toContain('isModalVisible(ONBOARDING_PI_UPDATE_MODAL_ID)');
    // Aucun second drapeau de blocage inventé ici.
    expect(src).not.toContain("pi_startup_gate_busy");
    expect(src).not.toContain("PI_CHECKING_MAX_MS");
  });
});

describe("prise en main — « Passer » n'écrit QUE « déjà vu »", () => {
  it("le correctif de « Passer » ne pose qu'un champ, sans toucher aux autres", () => {
    const config = freshConfig();
    const patched = onboardingPatchSkip(config);
    expect(patched[ONBOARDING_SEEN_KEY]).toBe(true);
    expect(Object.keys(patched).sort()).toEqual(Object.keys(config).sort());
    for (const key of Object.keys(config)) {
      if (key === ONBOARDING_SEEN_KEY) continue;
      expect(patched[key], `le champ ${key} ne doit pas bouger`).toEqual(config[key]);
    }
    // Aucun réglage de lancement n'est activé par « Passer ».
    expect(patched.rpc_agent_enabled).toBe(false);
    expect(patched.integrated_terminal).toBe(false);
  });

  it("dans le source, « Passer » n'emploie pas les réglages de lancement", () => {
    const src = JS();
    const body = sliceSource(
      src,
      "export function onboardingPatchSkip(",
      "export function onboardingPatchFinish(",
      100,
    );
    expect(body).not.toContain("ONBOARDING_LAUNCH_SETTINGS");
    expect(body).not.toContain("rpc_agent_enabled");
    expect(body).not.toContain("integrated_terminal");
    expect(body).not.toContain("super_agent_default_model");
  });

  it("l'écriture de « Passer » passe par la sortie unique (une seule écriture)", () => {
    const src = JS();
    const skip = sliceSource(src, "const skip = async () => {", "const finish = async", 100);
    expect(skip).toContain("onboardingPatchSkip");
    expect(skip).toContain("writeOnce");
    // La fenêtre se ferme TOUJOURS, même si l'écriture a échoué.
    expect(skip).toContain("close()");
  });
});

describe("prise en main — « Terminer » pose les DEUX réglages, d'un seul coup", () => {
  it("« Terminer » active le RPC de l'agent et le terminal intégré", () => {
    const config = freshConfig();
    const patched = onboardingPatchFinish(config);
    expect(patched[ONBOARDING_SEEN_KEY]).toBe(true);
    expect(patched.rpc_agent_enabled).toBe(true);
    expect(patched.integrated_terminal).toBe(true);
    // Deux réglages, pas plus : le thème et les autres champs sont intacts.
    expect(patched.theme).toBe(config.theme);
    expect(patched.recent_projects).toEqual(config.recent_projects);
    expect(ONBOARDING_LAUNCH_SETTINGS.rpc_agent_enabled).toBe(true);
    expect(ONBOARDING_LAUNCH_SETTINGS.integrated_terminal).toBe(true);
  });

  it("le modèle choisi est repris, et rien n'est écrasé si aucun n'est choisi", () => {
    const config = freshConfig();
    expect(
      onboardingPatchFinish(config, { model: "anthropic/claude-x" }).super_agent_default_model,
    ).toBe("anthropic/claude-x");
    expect(onboardingPatchFinish(config, { model: "  " }).super_agent_default_model).toBe("");
    expect(onboardingPatchFinish(config, {}).super_agent_default_model).toBe("");
  });

  it("une seule écriture dans tout le module (jamais partielle)", () => {
    const src = JS();
    const saves = src.match(/invokeFn\("save_config"/g) || [];
    expect(saves).toHaveLength(1);
    // Cette écriture unique reçoit une configuration COMPLÈTE, pas un patch
    // partiel : elle est construite à partir de la configuration relue.
    const once = sliceSource(src, "const writeOnce = async", "const describe =", 100);
    expect(once).toContain('invokeFn("get_config")');
    expect(once).toContain('invokeFn("save_config", { config: patched })');
  });

  it("un échec d'écriture est DIT et ne ferme pas la fenêtre en douce", () => {
    const src = JS();
    const finish = sliceSource(src, "const finish = async", "// ── câblage", 100);
    expect(finish).toContain("showError(");
    // En cas d'échec, la fermeture est APRÈS le retour anticipé : on ne ferme
    // pas une fenêtre dont l'enregistrement a échoué.
    const earlyReturn = finish.indexOf("return false;");
    const close = finish.indexOf("close();");
    expect(earlyReturn).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(earlyReturn);
  });
});

describe("prise en main — les écrans existent et disent la vérité", () => {
  it("la modale réutilise les parties existantes et porte ses trois écrans", () => {
    const html = HTML();
    const modal = sliceSource(
      html,
      `id="${ONBOARDING_MODAL_ID}"`,
      'id="audit-modal"',
      500,
    );
    expect(modal).toContain('class="modal hidden"');
    expect(modal).toContain("modal-content onboarding-content");
    expect(modal).toContain("modal-actions");
    for (let n = 1; n <= ONBOARDING_SCREENS; n += 1) {
      expect(modal).toContain(`data-onboarding-screen="${n}"`);
    }
    expect(modal).toContain('id="onboarding-discover"');
    // Les quatre sorties existent, « Passer » n'est jamais désactivé.
    for (const id of [
      "btn-onboarding-skip",
      "btn-onboarding-discover",
      "btn-onboarding-prev",
      "btn-onboarding-next",
      "onboarding-close",
    ]) {
      expect(modal).toContain(`id="${id}"`);
    }
    expect(modal).not.toMatch(/id="btn-onboarding-skip"[^>]*disabled/);
  });

  it("aucun onglet, aucun écran de navigation propre n'est créé", () => {
    const src = JS();
    // Le SEUL onglet ouvert par la fenêtre est celui de l'Assistant (option
    // « Je découvre »), jamais un onglet de prise en main.
    const opened = src.match(/\bopenFile\s*\??\.\s*\(/g) || [];
    expect(opened).toHaveLength(1);
    expect(src).toContain('"superagent"');
    expect(src).not.toContain("createTab");
    expect(src).not.toContain("onboarding-tab");
  });

  it("l'écran du moteur dit la cause ET la marche à suivre", () => {
    const ok = onboardingEngineReport({ label: "L'agent Pi", health: { ok: true, version: "1.2.3" } });
    expect(ok.ok).toBe(true);
    expect(ok.lines.join(" ")).toContain("1.2.3");

    const noPath = onboardingEngineReport({ label: "L'agent Pi", health: { ok: false, error: "no_path" } });
    expect(noPath.ok).toBe(false);
    expect(noPath.lines.join(" ")).toContain("Options");

    const broken = onboardingEngineReport({
      label: "L'agent Pi",
      health: { ok: false, error: "not_executable", path: "C:/pi" },
    });
    expect(broken.lines.join(" ")).toContain("C:/pi");

    // Jamais de constat vide, même sans relevé.
    expect(onboardingEngineReport({}).lines.length).toBeGreaterThan(0);
    expect(onboardingEngineReport({}).ok).toBe(false);
  });

  it("l'écran du projet dit le projet ouvert, ou comment en ouvrir un", () => {
    const none = onboardingProjectReport("");
    expect(none.open).toBe(false);
    expect(none.lines.join(" ")).toContain("Projets");

    const opened = onboardingProjectReport("C:/travaux/mon-projet");
    expect(opened.open).toBe(true);
    expect(opened.name).toBe("mon-projet");
    expect(opened.lines.join(" ")).toContain("C:/travaux/mon-projet");
  });

  it("l'écran des modèles ne montre jamais une liste vide muette", () => {
    const some = onboardingModelReport(["anthropic/a", "openai/b"], "");
    expect(some.ok).toBe(true);
    expect(some.models).toHaveLength(2);

    const empty = onboardingModelReport([], "");
    expect(empty.ok).toBe(false);
    expect(empty.models).toEqual([]);
    expect(empty.lines.join(" ")).toContain("Fournisseurs");
    expect(empty.lines.join(" ")).toContain("Réessayer");

    const failed = onboardingModelReport(null, "lecture models.json: refusée");
    expect(failed.ok).toBe(false);
    expect(failed.lines.join(" ")).toContain("refusée");
    expect(failed.lines.join(" ")).toContain("Fournisseurs");
  });

  it("« Réessayer » et le choix de dossier sont câblés (aucun bouton mort)", () => {
    const src = JS();
    expect(src).toContain('engineRetry?.addEventListener("click"');
    expect(src).toContain('modelRetry?.addEventListener("click"');
    expect(src).toContain('chooseProject?.addEventListener("click"');
    // Le sélecteur de dossier est celui de l'application (aucun second chemin).
    expect(src).toContain("ctx.sidebar.openProject()");
    expect(src).toContain("modelField?.classList.toggle");
  });

  it("l'étape est annoncée et bornée aux trois écrans", () => {
    expect(onboardingStepLabel(1)).toBe("Étape 1 sur 3");
    expect(onboardingStepLabel(3)).toBe("Étape 3 sur 3");
    expect(onboardingStepLabel(0)).toBe("Étape 1 sur 3");
    expect(onboardingStepLabel(9)).toBe("Étape 3 sur 3");
  });
});

describe("prise en main — aucun coût, aucun appel d'agent", () => {
  it("les modèles sont lus sur DISQUE (registre), jamais par une session", () => {
    const src = JS();
    expect(src).toContain('invokeFn("get_available_models_list")');
    for (const interdit of [
      "list_agent_models",
      "list_agent_sessions",
      "run_agents",
      "send_prompt",
      "start_agent",
      "prompt_agent",
    ]) {
      expect(src).not.toContain(interdit);
    }
  });

  it("la seule sonde exécutée est la vérification locale du moteur", () => {
    const src = JS();
    expect(src).toContain("checkPiHealth()");
    expect(src).toContain("getPiHealthSync()");
    expect(src).not.toContain("check_pi_update");
    expect(src).not.toContain("tts_local");
  });
});

describe("prise en main — apparence (tokens existants seulement)", () => {
  it("la feuille de style décrit la fenêtre sans couleur en dur", () => {
    const css = CSS();
    const block = sliceSource(
      css,
      "PRISE EN MAIN DE LA PREMIÈRE OUVERTURE (spec_onboarding.md, niveau 1)",
      "/* --- Popup de sélection des modèles Orchestration --- */",
      400,
    );
    expect(block).toContain(".modal-content.onboarding-content");
    expect(block).toContain(".onboarding-body");
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(block).not.toMatch(/\brgba?\(/);
    // Aucun token nouveau : le bloc ne déclare aucune variable.
    expect(block).not.toMatch(/^\s*--[a-z-]+\s*:/m);
    // Le texte secondaire n'est employé que sur les surfaces partagées.
    expect(block).toContain("var(--text-secondary)");
    expect(block).toContain("var(--bg-hover)");
  });
});
