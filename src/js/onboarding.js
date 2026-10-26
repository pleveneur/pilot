// onboarding.js — Prise en main de la PREMIÈRE ouverture (niveau 1).
//
// Spec : `spec_onboarding.md`. Ce module ajoute les ÉCRANS du niveau 1 sur le
// socle déjà posé. Décisions déjà tranchées et non réinterprétées ici :
//
//   • forme = MODALE qui réutilise les parties existantes (`.modal`,
//     `.modal-content`, `.modal-header`, `.modal-close`, `.modal-actions`) :
//     aucun composant nouveau, aucun onglet, aucune navigation ;
//   • la décision d'afficher vient du socle (`get_onboarding_state`, calculée
//     en Rust par `onboarding_should_show`) et n'est JAMAIS recalculée ici :
//     ce module ne connaît que le champ `show` du verdict ;
//   • trois écrans courts, chacun un CONSTAT de ce qui est réellement là :
//       1. le moteur en service (pi ou plh) et son état ;
//       2. le projet sur lequel on travaille, ou comment en ouvrir un ;
//       3. les modèles réellement disponibles (registre de l'agent, disque) ;
//   • sortie = UNE SEULE écriture de configuration (jamais partielle) :
//       - « Terminer » et « Je découvre » posent « déjà vu » + les deux
//         réglages qui font que « Lancer l'agent » lance vraiment l'agent
//         (aujourd'hui, sur une installation neuve, il ouvre un terminal) ;
//       - « Passer », Échap et la croix ne posent QUE « déjà vu » ;
//   • aucun coût : aucun appel de modèle, aucune session lancée, aucun réglage
//     coûteux activé (la liste des modèles est lue sur DISQUE, pas par l'agent) ;
//   • aucun cas muet : quand quelque chose manque, la fenêtre dit la CAUSE et
//     la MARCHE À SUIVRE, avec un bouton « Réessayer » vivant ; « Passer » reste
//     toujours actif et Pilot reste utilisable ;
//   • la fenêtre ne s'ouvre JAMAIS par-dessus la vérification de mise à jour du
//     moteur : elle attend qu'elle rende la main, avec un délai BORNÉ. Passé ce
//     délai, elle ne s'ouvre pas (elle reviendra au prochain démarrage, puisque
//     « déjà vu » n'a pas été écrit).

import { invoke } from "@tauri-apps/api/core";
import { animateModalOpen } from "./modal-anim.js";
import { toastError, toastSuccess } from "./toast.js";
import { agentDisplayLabel, checkPiHealth, getBackendInfoSync, getPiHealthSync } from "./backend-info.js";
import { isPiStartupGateBlocking } from "./pi-startup-gate.js";
// Niveau 2 (FACULTATIF) : l'équipe d'agents. Ce module ne s'ouvre que sur un
// geste de l'utilisateur ; la prise en main ne fait que fournir son lien.
import { ONBOARDING_TEAM_MODAL_ID, openOnboardingTeamModal } from "./onboarding-niveau2.js";

/** Fenêtre de la prise en main. */
export const ONBOARDING_MODAL_ID = "onboarding-modal";
/** Fenêtre de proposition de mise à jour du moteur (jamais recouverte). */
export const ONBOARDING_PI_UPDATE_MODAL_ID = "pi-update-modal";

/** Nombre d'écrans du niveau 1. */
export const ONBOARDING_SCREENS = 3;

/**
 * Le SEUL champ de configuration que « Passer » a le droit de poser.
 * (Socle : `onboarding_seen`, `#[serde(default)]` côté Rust.)
 */
export const ONBOARDING_SEEN_KEY = "onboarding_seen";

/**
 * Les DEUX réglages qui font que « Lancer l'agent » lance l'agent :
 *   - `rpc_agent_enabled` : le bouton ouvre l'onglet de conversation de l'agent ;
 *   - `integrated_terminal` : filet de sécurité, si le RPC est coupé plus tard,
 *     le bouton ouvre au moins le terminal de l'agent DANS Pilot.
 * (Sur une installation neuve, les deux sont faux et le bouton ouvre une
 * fenêtre de terminal externe : c'est exactement ce que la prise en main règle.)
 */
export const ONBOARDING_LAUNCH_SETTINGS = Object.freeze({
  rpc_agent_enabled: true,
  integrated_terminal: true,
});

/** Attente BORNÉE avant d'afficher (la vérification du moteur garde la priorité). */
export const ONBOARDING_STARTUP_WAIT_MS = 30_000;
/** Période d'observation pendant cette attente. */
export const ONBOARDING_POLL_MS = 100;

const NO_MODEL_OPTION = "";

// ─────────────────────────────── fonctions pures ───────────────────────────

/**
 * Faut-il afficher la prise en main ? UNIQUEMENT d'après le verdict du socle.
 *
 * Ne jamais remplacer ceci par `!state.onboarding_seen` : le critère du socle
 * est CUMULATIF (fichier de configuration absent ET champ non posé). Une
 * installation existante n'a pas le champ → elle verrait la fenêtre.
 *
 * @param {{show?: boolean}|null|undefined} state état renvoyé par `get_onboarding_state`
 * @returns {boolean}
 */
export function onboardingShouldShow(state) {
  return !!(state && state.show === true);
}

/**
 * Configuration à écrire pour « Passer » / Échap / croix : RIEN d'autre que
 * « déjà vu ». Un seul champ change, tous les autres sont rendus à l'identique.
 *
 * @param {object} config configuration courante (relue du disque)
 * @returns {object} copie avec `onboarding_seen: true` et rien d'autre
 */
export function onboardingPatchSkip(config) {
  const base = config && typeof config === "object" ? config : {};
  return { ...base, [ONBOARDING_SEEN_KEY]: true };
}

/**
 * Configuration à écrire pour « Terminer » / « Je découvre » : « déjà vu » + les
 * deux réglages de lancement (+ le modèle choisi, s'il y en a un). Une seule
 * écriture, jamais partielle.
 *
 * @param {object} config configuration courante (relue du disque)
 * @param {{model?: string}} [choice] modèle choisi à l'écran 3 (facultatif)
 * @returns {object}
 */
export function onboardingPatchFinish(config, choice = {}) {
  const base = config && typeof config === "object" ? config : {};
  const patched = {
    ...base,
    [ONBOARDING_SEEN_KEY]: true,
    ...ONBOARDING_LAUNCH_SETTINGS,
  };
  const model = typeof choice.model === "string" ? choice.model.trim() : "";
  // Rien de choisi → le modèle par défaut existant n'est pas écrasé.
  if (model) patched.super_agent_default_model = model;
  return patched;
}

/**
 * Libellé de l'étape courante (« Étape 2 sur 3 »).
 * @param {number} screen
 * @returns {string}
 */
export function onboardingStepLabel(screen) {
  const n = Math.min(Math.max(Number(screen) || 1, 1), ONBOARDING_SCREENS);
  return `Étape ${n} sur ${ONBOARDING_SCREENS}`;
}

/** Dernier segment d'un chemin (Windows ou POSIX), sans dépendance. */
function baseName(p) {
  const clean = String(p || "").replace(/[\\/]+$/, "");
  const parts = clean.split(/[\\/]/);
  return parts[parts.length - 1] || clean;
}

/**
 * Écran 1 — le moteur CONSTATÉ, en langage simple.
 * Toujours au moins une ligne ; en cas d'échec : la cause ET la marche à suivre.
 *
 * @param {{label?: string, optionsLabel?: string, health?: {ok?: boolean, version?: string, error?: string, path?: string}|null}} info
 * @returns {{ok: boolean, lines: string[]}}
 */
export function onboardingEngineReport(info = {}) {
  const label = info.label || "L'agent";
  const health = info.health || null;
  // Les marches a suivre ci-dessous renvoient vers l'onglet des Options, dont
  // le libelle NOMME le moteur en cours. Il vient donc de la source unique
  // (`agentDisplayLabel()`, passe par l'appelant) : renvoyer un utilisateur de
  // PLh vers « Agent Pi » serait un mensonge. Repli : defaut de cette source.
  const optionsTab = `⚙️ Options → « ${info.optionsLabel || "Agent Pi"} »`;
  if (!health) {
    return {
      ok: false,
      lines: [
        `L'état du moteur (${label}) n'a pas encore été relevé.`,
        `Marche à suivre : « Revérifier le moteur » ; si cela persiste, contrôlez ${optionsTab}.`,
      ],
    };
  }
  if (health.ok) {
    const version = health.version ? ` — version ${health.version}` : "";
    const path = health.path ? `Programme utilisé : ${health.path}` : "";
    return {
      ok: true,
      lines: [`${label} répond${version}.`, path].filter(Boolean),
    };
  }
  const path = health.path ? ` (${health.path})` : "";
  switch (health.error) {
    case "no_path":
      return {
        ok: false,
        lines: [
          "Aucun programme d'agent n'est configuré : Pilot ne sait pas encore quel moteur lancer.",
          `Marche à suivre : ${optionsTab}, puis indiquez le chemin du programme (pi ou plh).`,
        ],
      };
    case "not_executable":
      return {
        ok: false,
        lines: [
          `Le programme configuré n'a pas répondu${path}.`,
          `Marche à suivre : vérifiez ce chemin (${optionsTab}) : il doit désigner le programme pi ou plh, exécutable.`,
        ],
      };
    case "probe_failed":
      return {
        ok: false,
        lines: [
          "La vérification du moteur n'a pas pu se faire.",
          `Marche à suivre : « Revérifier le moteur » ; si cela persiste, contrôlez ${optionsTab}.`,
        ],
      };
    default: {
      const cause = health.error ? ` (${health.error})` : "";
      return {
        ok: false,
        lines: [
          `${label} n'a pas pu être vérifié${cause}.`,
          `Marche à suivre : « Revérifier le moteur », puis ${optionsTab} si le problème persiste.`,
        ],
      };
    }
  }
}

/**
 * Écran 2 — le projet sur lequel on travaille.
 * @param {string} projectPath chemin du projet ouvert ("" si aucun)
 * @returns {{open: boolean, name: string, lines: string[]}}
 */
export function onboardingProjectReport(projectPath) {
  const path = typeof projectPath === "string" ? projectPath.trim() : "";
  if (!path) {
    return {
      open: false,
      name: "",
      lines: [
        "Aucun projet n'est ouvert : Pilot travaille toujours dans un dossier de projet.",
        "Choisissez un dossier ci-dessous (ou le bouton « Projets »). C'est ce dossier que « Lancer l'agent » fera travailler.",
      ],
    };
  }
  return {
    open: true,
    name: baseName(path),
    lines: [`Projet ouvert : ${baseName(path)}`, path],
  };
}

/**
 * Écran 3 — les modèles RÉELLEMENT disponibles (lus sur disque, sans agent).
 * Jamais de liste vide muette : sans modèle, la cause et la marche à suivre
 * sont dites, et « Réessayer » reste proposé.
 *
 * @param {string[]|null|undefined} models liste « fournisseur/modèle »
 * @param {string} [error] message d'erreur de lecture, s'il y en a un
 * @returns {{ok: boolean, models: string[], lines: string[]}}
 */
export function onboardingModelReport(models, error) {
  const list = Array.isArray(models)
    ? models.filter((m) => typeof m === "string" && m.trim() !== "").map((m) => m.trim())
    : [];
  if (list.length > 0) {
    const plural = list.length > 1 ? "s" : "";
    return {
      ok: true,
      models: list,
      lines: [
        `${list.length} modèle${plural} disponible${plural} dans le registre de l'agent.`,
        "Vous pouvez déjà choisir celui que l'agent proposera par défaut ; ce choix se change à tout moment dans ⚙️ Options → « Fournisseurs ».",
      ],
    };
  }
  const cause = error ? String(error).trim() : "";
  const lines = [
    cause
      ? `La liste des modèles n'a pas pu être lue : ${cause}`
      : "Aucun modèle n'est déclaré dans le registre de l'agent.",
    "Marche à suivre : ⚙️ Options → « Fournisseurs » : ajoutez un fournisseur et au moins un modèle, puis « Réessayer ».",
  ];
  return { ok: false, models: [], lines };
}

/** Vrai si une fenêtre du document est visible (jamais en erreur si absente). */
function isModalVisible(id) {
  if (typeof document === "undefined") return false;
  const el = document.getElementById(id);
  return !!(el && !el.classList.contains("hidden"));
}

const SETTLED = "settled";
const TIMED_OUT = "timed-out";

/**
 * Attend qu'une promesse soit réglée, sans jamais dépasser `timeoutMs`.
 * @returns {Promise<"settled"|"timed-out">}
 */
async function settledWithin(promise, timeoutMs, sleep) {
  if (!promise || typeof promise.then !== "function") return SETTLED;
  const outcome = await Promise.race([
    Promise.resolve(promise).then(
      () => SETTLED,
      () => SETTLED, // un échec rend AUSSI la main (échec réseau ≈ 1 s côté pi-update.js)
    ),
    Promise.resolve(sleep(timeoutMs)).then(() => TIMED_OUT),
  ]);
  return outcome === SETTLED ? SETTLED : TIMED_OUT;
}

/**
 * Attend que le terrain de démarrage soit RENDU : la vérification du moteur est
 * réglée (ou son délai est écoulé) et rien ne bloque plus (garde de démarrage,
 * fenêtre de mise à jour du moteur affichée).
 *
 * Toujours borné, jamais d'exception : passer de la vérification à la fenêtre ne
 * doit jamais empêcher Pilot de démarrer.
 *
 * @param {{
 *   startupCheck?: Promise<any>,
 *   isBusy?: () => boolean,
 *   timeoutMs?: number,
 *   pollMs?: number,
 *   sleep?: (ms: number) => Promise<any>,
 *   now?: () => number,
 * }} [deps]
 * @returns {Promise<{idle: boolean, settled: "settled"|"timed-out"}>}
 */
export async function waitForStartupHandback(deps = {}) {
  const sleep =
    typeof deps.sleep === "function"
      ? deps.sleep
      : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const now = typeof deps.now === "function" ? deps.now : () => Date.now();
  const timeoutMs =
    Number.isFinite(deps.timeoutMs) && deps.timeoutMs >= 0
      ? deps.timeoutMs
      : ONBOARDING_STARTUP_WAIT_MS;
  const pollMs = Number.isFinite(deps.pollMs) && deps.pollMs > 0 ? deps.pollMs : ONBOARDING_POLL_MS;
  const settled = await settledWithin(deps.startupCheck, timeoutMs, sleep);

  const deadline = now() + timeoutMs;
  for (;;) {
    let busy = false;
    try {
      busy = typeof deps.isBusy === "function" ? !!deps.isBusy() : false;
    } catch (_) {
      busy = false; // un gardien illisible ne bloque pas la fenêtre
    }
    if (!busy) return { idle: true, settled };
    if (now() >= deadline) return { idle: false, settled };
    await sleep(pollMs);
  }
}

// ─────────────────────────────── ouverture ─────────────────────────────────

/** Vrai tant que la fenêtre est ouverte (jamais deux fenêtres). */
let _open = false;

/**
 * Point d'entrée du démarrage : lit l'état, attend que le terrain soit rendu,
 * puis ouvre la fenêtre SI (et seulement si) le socle le demande.
 *
 * N'échoue jamais : le démarrage de Pilot ne dépend pas de cette fenêtre.
 *
 * @param {{
 *   tabs?: object, sidebar?: object,
 *   startupCheck?: Promise<any>,
 *   invoke?: Function, openModal?: Function,
 *   isBusy?: () => boolean, timeoutMs?: number, pollMs?: number,
 *   sleep?: (ms: number) => Promise<any>, now?: () => number,
 * }} [deps]
 * @returns {Promise<{shown: boolean, reason: string}>}
 */
export async function initOnboarding(deps = {}) {
  const invokeFn = typeof deps.invoke === "function" ? deps.invoke : invoke;
  let state = null;
  try {
    state = await invokeFn("get_onboarding_state");
  } catch (e) {
    // Sans état, aucune décision n'est possible : on ne montre rien (jamais de
    // fenêtre sur une installation existante) et on le dit dans la console.
    console.warn("[onboarding] état de la prise en main illisible :", e);
    return { shown: false, reason: "state-unavailable" };
  }
  // LA décision est celle du socle. Aucun second critère n'est inventé ici.
  if (!onboardingShouldShow(state)) return { shown: false, reason: "not-required" };
  if (_open) return { shown: false, reason: "already-open" };

  const handback = await waitForStartupHandback({
    startupCheck: deps.startupCheck,
    isBusy:
      typeof deps.isBusy === "function"
        ? deps.isBusy
        : () =>
            isPiStartupGateBlocking() || isModalVisible(ONBOARDING_PI_UPDATE_MODAL_ID),
    timeoutMs: deps.timeoutMs,
    pollMs: deps.pollMs,
    sleep: deps.sleep,
    now: deps.now,
  });
  if (!handback.idle) {
    // Le terrain n'a pas été rendu dans le délai : on ne s'ouvre pas PAR-DESSUS
    // la vérification. Rien n'est écrit → la fenêtre reviendra au démarrage
    // suivant, ce qui est exactement le comportement voulu.
    console.warn("[onboarding] vérification du moteur toujours en cours : affichage reporté.");
    return { shown: false, reason: "startup-not-idle" };
  }

  const openFn = typeof deps.openModal === "function" ? deps.openModal : openOnboardingModal;
  try {
    await openFn(deps);
  } catch (e) {
    console.warn("[onboarding] ouverture impossible :", e);
    return { shown: false, reason: "open-failed" };
  }
  return { shown: true, reason: "shown" };
}

/**
 * Construit puis affiche la fenêtre. Séparée de `initOnboarding` pour être
 * remplaçable en test (aucune décision n'est prise ici, seulement l'écran).
 *
 * @param {{tabs?: object, sidebar?: object, invoke?: Function}} [ctx]
 * @returns {Promise<void>}
 */
export async function openOnboardingModal(ctx = {}) {
  if (typeof document === "undefined") return;
  const invokeFn = typeof ctx.invoke === "function" ? ctx.invoke : invoke;
  const modal = document.getElementById(ONBOARDING_MODAL_ID);
  if (!modal) {
    console.warn("[onboarding] fenêtre absente du document :", ONBOARDING_MODAL_ID);
    return;
  }
  if (_open) return;

  const el = (id) => document.getElementById(id);
  const stepEl = el("onboarding-step");
  const engineBody = el("onboarding-engine-body");
  const engineRetry = el("btn-onboarding-engine-retry");
  const projectBody = el("onboarding-project-body");
  const chooseProject = el("btn-onboarding-choose-project");
  const modelBody = el("onboarding-model-body");
  const modelSelect = el("onboarding-model-select");
  const modelField = modelSelect ? modelSelect.closest(".onboarding-field") : null;
  const modelRetry = el("btn-onboarding-model-retry");
  const discoverSection = el("onboarding-discover");
  const errorEl = el("onboarding-error");
  const skipBtn = el("btn-onboarding-skip");
  const discoverBtn = el("btn-onboarding-discover");
  const prevBtn = el("btn-onboarding-prev");
  const nextBtn = el("btn-onboarding-next");
  const closeBtn = el("onboarding-close");
  // Point d'entrée DISCRET du niveau 2 (équipe d'agents) : facultatif, jamais
  // ouvert tout seul, et sans aucune écriture de configuration.
  const teamLearnBtn = el("btn-onboarding-team-learn");
  const screens = Array.from(modal.querySelectorAll("[data-onboarding-screen]"));

  const view = { screen: 1, discover: false, model: NO_MODEL_OPTION, busy: false };

  // ── rendu ────────────────────────────────────────────────────────────────
  const fill = (node, lines) => {
    if (!node) return;
    node.replaceChildren();
    for (const line of lines) {
      const p = document.createElement("p");
      p.textContent = line;
      node.appendChild(p);
    }
  };

  const showError = (message) => {
    if (!errorEl) return;
    if (!message) {
      errorEl.classList.add("hidden");
      errorEl.textContent = "";
      return;
    }
    errorEl.textContent = message;
    errorEl.classList.remove("hidden");
  };

  const renderEngine = () => {
    const report = onboardingEngineReport({
      label: engineLabel(),
      // Meme source unique que le bandeau et l'onglet des Options : la marche a
      // suivre nomme l'onglet tel qu'il est REELLEMENT affiche.
      optionsLabel: agentDisplayLabel(),
      health: getPiHealthSync(),
    });
    fill(engineBody, report.lines);
    engineRetry?.classList.toggle("hidden", report.ok);
  };

  const renderProject = () => {
    const report = onboardingProjectReport(window._pilotProjectPath);
    fill(projectBody, report.lines);
    // Le bouton reste toujours utile : il ouvre le sélecteur de dossier natif.
    chooseProject?.classList.toggle("hidden", !ctx.sidebar || view.busy);
  };

  const renderModels = (models, error) => {
    const report = onboardingModelReport(models, error);
    fill(modelBody, report.lines);
    if (modelSelect) {
      modelSelect.replaceChildren();
      const none = document.createElement("option");
      none.value = NO_MODEL_OPTION;
      none.textContent = "Garder le modèle déjà réglé";
      modelSelect.appendChild(none);
      for (const spec of report.models) {
        const opt = document.createElement("option");
        opt.value = spec;
        opt.textContent = spec;
        modelSelect.appendChild(opt);
      }
      modelSelect.value = report.models.includes(view.model) ? view.model : NO_MODEL_OPTION;
    }
    modelField?.classList.toggle("hidden", !report.ok);
    modelRetry?.classList.toggle("hidden", report.ok);
  };

  const render = () => {
    for (const section of screens) {
      const n = Number(section.getAttribute("data-onboarding-screen"));
      section.classList.toggle("hidden", view.discover || n !== view.screen);
    }
    discoverSection?.classList.toggle("hidden", !view.discover);
    if (stepEl) {
      stepEl.textContent = view.discover ? "Trois repères" : onboardingStepLabel(view.screen);
    }
    prevBtn?.classList.toggle("hidden", view.discover || view.screen === 1);
    discoverBtn?.classList.toggle("hidden", view.discover);
    if (nextBtn) {
      nextBtn.textContent = view.discover
        ? "Ouvrir l'Assistant"
        : view.screen === ONBOARDING_SCREENS
          ? "Terminer"
          : "Suivant";
    }
  };

  // ── lectures (aucun appel de modèle, aucune session) ─────────────────────
  const engineLabel = () => {
    const info = getBackendInfoSync();
    return info && info.kind === "plh" ? "L'agent PLh" : "L'agent Pi";
  };

  const loadModels = async () => {
    try {
      const models = await invokeFn("get_available_models_list");
      renderModels(models, "");
    } catch (e) {
      renderModels([], typeof e === "string" ? e : String(e && e.message ? e.message : e));
    }
  };

  const recheckEngine = async () => {
    if (view.busy) return;
    view.busy = true;
    engineRetry?.setAttribute("disabled", "disabled");
    try {
      await checkPiHealth();
      renderEngine();
    } finally {
      view.busy = false;
      engineRetry?.removeAttribute("disabled");
    }
  };

  // ── sortie : UNE seule écriture de configuration ─────────────────────────
  const writeOnce = async (patch) => {
    let config;
    try {
      config = await invokeFn("get_config");
    } catch (e) {
      return { ok: false, error: `La configuration n'a pas pu être relue : ${describe(e)}` };
    }
    const patched = patch(config);
    try {
      await invokeFn("save_config", { config: patched });
    } catch (e) {
      return { ok: false, error: `L'enregistrement a échoué : ${describe(e)}` };
    }
    return { ok: true };
  };

  const describe = (e) => (typeof e === "string" ? e : String((e && e.message) || e));

  const close = () => {
    modal.classList.add("hidden");
    document.removeEventListener("keydown", onKeydown, true);
    _open = false;
  };

  /** « Passer », Échap, croix : ne posent QUE « déjà vu ». */
  const skip = async () => {
    if (view.busy) return;
    view.busy = true;
    showError("");
    const res = await writeOnce(onboardingPatchSkip);
    view.busy = false;
    close();
    if (!res.ok) {
      // Rien n'a été persisté à moitié : le champ n'a pas bougé. On le dit.
      toastError(
        `Prise en main non marquée comme vue (rien n'a été enregistré) — ${res.error}. ` +
          "Elle pourra revenir au prochain démarrage.",
      );
    }
    return res.ok;
  };

  /** « Terminer » / « Ouvrir l'Assistant » : deux réglages + « déjà vu », d'un coup. */
  const finish = async ({ openAssistant = false } = {}) => {
    if (view.busy) return false;
    view.busy = true;
    showError("");
    if (nextBtn) nextBtn.setAttribute("disabled", "disabled");
    const res = await writeOnce((config) => onboardingPatchFinish(config, { model: view.model }));
    if (!res.ok) {
      // Échec : on le DIT, on ne ferme pas, et rien n'a été écrit (écriture
      // unique : soit tout passe, soit rien).
      view.busy = false;
      nextBtn?.removeAttribute("disabled");
      showError(`${res.error} — rien n'a été enregistré. Vous pouvez réessayer.`);
      toastError(res.error);
      return false;
    }
    view.busy = false;
    nextBtn?.removeAttribute("disabled");
    close();
    toastSuccess(
      "Prise en main terminée : « Lancer l'agent » ouvre maintenant la conversation de l'agent.",
    );
    if (openAssistant) {
      try {
        const { superAgentDisplayLabel } = await import("./super-agent.js");
        await ctx.tabs?.openFile?.(superAgentDisplayLabel(), "superagent");
      } catch (e) {
        toastError(`Onglet Assistant non ouvert : ${describe(e)}`);
      }
    }
    return true;
  };

  // ── câblage ──────────────────────────────────────────────────────────────
  const onKeydown = (event) => {
    if (event.key !== "Escape") return;
    // La fenêtre du niveau 2, si elle est ouverte PAR-DESSUS, traite Échap
    // elle-même : sans cette garde, Échap fermerait le niveau 2 ET marquerait
    // la prise en main comme vue, ce qui n'est pas le geste de l'utilisateur.
    if (isModalVisible(ONBOARDING_TEAM_MODAL_ID)) return;
    event.preventDefault();
    void skip();
  };

  skipBtn?.addEventListener("click", () => void skip());
  closeBtn?.addEventListener("click", () => void skip());
  discoverBtn?.addEventListener("click", () => {
    view.discover = true;
    render();
  });
  prevBtn?.addEventListener("click", () => {
    if (view.screen > 1) view.screen -= 1;
    render();
  });
  nextBtn?.addEventListener("click", () => {
    if (view.discover) {
      void finish({ openAssistant: true });
      return;
    }
    if (view.screen < ONBOARDING_SCREENS) {
      view.screen += 1;
      render();
      return;
    }
    void finish();
  });
  engineRetry?.addEventListener("click", () => void recheckEngine());
  teamLearnBtn?.addEventListener("click", () => {
    // Geste EXPLICITE (`gesture: true`) : c'est la seule façon d'ouvrir le
    // niveau 2. La prise en main reste ouverte derrière, et rien n'est écrit.
    void openOnboardingTeamModal({ gesture: true, tabs: ctx.tabs });
  });
  modelRetry?.addEventListener("click", () => void loadModels());
  modelSelect?.addEventListener("change", () => {
    view.model = modelSelect.value || NO_MODEL_OPTION;
  });
  chooseProject?.addEventListener("click", async () => {
    if (!ctx.sidebar || view.busy) return;
    view.busy = true;
    try {
      await ctx.sidebar.openProject();
    } catch (e) {
      toastError(`Ouverture du projet impossible : ${describe(e)}`);
    } finally {
      view.busy = false;
      renderProject();
    }
  });

  // ── premier affichage ────────────────────────────────────────────────────
  _open = true;
  showError("");
  renderEngine();
  renderProject();
  renderModels([], "");
  render();
  modal.classList.remove("hidden");
  document.addEventListener("keydown", onKeydown, true);
  animateModalOpen(modal);
  void loadModels();
}
