// onboarding-niveau2.js — Prise en main, NIVEAU 2 : l'équipe d'agents.
//
// Spec : `spec_onboarding.md` § « Niveau 2 ». Ce module APPREND à l'utilisateur,
// PLUS TARD et À LA DEMANDE, à se servir de son équipe d'agents. Décisions déjà
// tranchées et non réinterprétées ici :
//
//   • le niveau 2 RÉUTILISE l'écran « Équipe d'agents » qui existe déjà
//     (`agents-ui.js`, onglet `agents` de `tabs.js`) : aucun écran de gestion
//     dédié, aucun onglet nouveau, aucun bouton dans la colonne de gauche ;
//   • DEUX écrans facultatifs au maximum, dans le MÊME style de dialogue que le
//     niveau 1 : mêmes classes (`onboarding-screen`, `onboarding-body`,
//     `onboarding-step`, `onboarding-actions`…), aucune refonte de composant ;
//   • il ne s'ouvre JAMAIS tout seul : `openOnboardingTeamModal` EXIGE un geste
//     explicite (`gesture: true`). Sans geste, il ne touche pas au document et
//     rend `{ shown: false, reason: "no-gesture" }` — il ne revient donc jamais
//     à chaque démarrage ;
//   • tout est FACULTATIF : on peut tout fermer sans rien casser, sans rien
//     perdre et sans rien installer. AUCUNE écriture de configuration, AUCUNE
//     modification d'agent : le module LIT l'état de l'équipe, il ne la
//     reconfigure pas à la place de l'utilisateur ;
//   • aucun coût : aucun appel de modèle, aucune session d'agent lancée ;
//   • aucun cas muet : registre illisible ou équipe vide ⇒ la CAUSE et la MARCHE
//     À SUIVRE sont dites, avec un bouton « Réessayer » vivant ;
//   • à la fin, l'utilisateur est là où il faut pour agir : l'écran « Équipe
//     d'agents » EXISTANT, jamais une impasse ;
//   • si l'équipe est DÉJÀ configurée, rien ne lui est réappris de force : le
//     constat le dit et n'exige aucune modification.

import { animateModalOpen } from "./modal-anim.js";
import { toastError, toastInfo } from "./toast.js";

/** Fenêtre du niveau 2 (facultative, jamais ouverte seule). */
export const ONBOARDING_TEAM_MODAL_ID = "onboarding-team-modal";

/** Nombre d'écrans du niveau 2 (deux au maximum, décision tranchée). */
export const ONBOARDING_TEAM_SCREENS = 2;

/**
 * L'écran d'équipe EXISTANT (onglet déjà connu de `tabs.js`) : le niveau 2 n'en
 * crée aucun autre, il emmène l'utilisateur là où il peut agir.
 */
export const ONBOARDING_TEAM_AGENTS_TAB_LABEL = "Agents";
export const ONBOARDING_TEAM_AGENTS_TAB_MODE = "agents";

/** Nombre de noms d'agents cités dans le constat (les autres sont résumés). */
const MAX_NAMES = 6;

// ─────────────────────────────── fonctions pures ───────────────────────────

/**
 * Agents réellement déclarés, quelle que soit la forme reçue : un registre
 * (`{ agents: [...] }`), une liste, ou une fonction rendant l'un des deux
 * (l'écran d'équipe garde son registre en mémoire et le passe en direct).
 *
 * @param {{agents?: object[]}|object[]|Function|null|undefined} registryLike
 * @returns {{readable: boolean, agents: object[]}}
 */
export function onboardingTeamAgents(registryLike) {
  let raw = registryLike;
  if (typeof raw === "function") {
    try {
      raw = raw();
    } catch (_) {
      raw = null; // un registre illisible n'est jamais une exception
    }
  }
  const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.agents) ? raw.agents : null;
  if (!list) return { readable: false, agents: [] };
  return { readable: true, agents: list.filter((a) => a && typeof a === "object") };
}

/**
 * Écran 1 — à quoi sert une équipe, et comment elle se compose (CONSTAT réel).
 * Jamais muet : sans registre lisible ou sans agent, la cause ET la marche à
 * suivre sont dites. Quand l'équipe est déjà en place, le constat le dit et
 * n'exige AUCUNE modification.
 *
 * @param {{agents?: object[]}|object[]|Function|null|undefined} registryLike
 * @param {string} [error] message de lecture, s'il y en a un
 * @returns {{ok: boolean, inPlace: boolean, count: number, names: string[], lines: string[]}}
 */
export function onboardingTeamComposition(registryLike, error) {
  const { readable, agents } = onboardingTeamAgents(registryLike);
  const cause = typeof error === "string" ? error.trim() : error ? String(error) : "";

  if (!readable) {
    return {
      ok: false,
      inPlace: false,
      count: 0,
      names: [],
      lines: [
        cause
          ? `La liste de vos agents n'a pas pu être lue : ${cause}`
          : "La liste de vos agents n'a pas pu être lue.",
        "Marche à suivre : « Réessayer » ; si cela persiste, fermez cette fenêtre et rouvrez l'écran « Équipe d'agents », qui recharge la liste.",
      ],
    };
  }

  if (agents.length === 0) {
    return {
      ok: false,
      inPlace: false,
      count: 0,
      names: [],
      lines: [
        "Aucun agent n'est déclaré : votre équipe est vide, Pilot ne peut donc déléguer aucune part du travail.",
        "Une équipe, c'est plusieurs agents qui se partagent le travail : chacun a un rôle, un modèle, et parfois des compétences.",
        "Marche à suivre : dans l'écran « Équipe d'agents », le bouton ↻ restaure les agents fournis d'origine et le bouton + ajoute un agent ; puis « Réessayer ».",
      ],
    };
  }

  const names = agents
    .map((a) => String(a.name || a.id || "").trim())
    .filter((n) => n !== "");
  const listed = names.slice(0, MAX_NAMES).join(", ");
  const suite = names.length > MAX_NAMES ? ", …" : "";
  const plural = agents.length > 1 ? "s" : "";
  return {
    ok: true,
    inPlace: true,
    count: agents.length,
    names,
    lines: [
      "Une équipe, c'est plusieurs agents qui se partagent le travail : chacun a un rôle, un modèle, et parfois des compétences.",
      `Votre équipe compte déjà ${agents.length} agent${plural}${listed ? ` : ${listed}${suite}` : ""} — rien ne vous oblige à la modifier.`,
      "🧭 Assistant répartit les demandes : vous décrivez la tâche, il choisit qui travaille et dans quel ordre.",
    ],
  };
}

/**
 * Écran 2 — le PREMIER GESTE concret, celui qui marche du premier coup.
 * Il ne lance rien, ne facture rien et ne modifie rien : on lit une fiche, puis
 * on confie la tâche à l'Assistant. Si l'équipe est vide, le premier geste
 * devient celui qui la remet en place.
 *
 * @param {{ok?: boolean}|null|undefined} composition résultat de `onboardingTeamComposition`
 * @returns {{ok: boolean, needsFirstAgents: boolean, lines: string[]}}
 */
export function onboardingTeamFirstGesture(composition) {
  const known = !!(composition && typeof composition.ok === "boolean");
  const ok = !!(composition && composition.ok === true);
  const lines = [
    "Le premier geste, celui qui marche du premier coup : dans l'écran « Équipe d'agents » (juste derrière cette fenêtre), cliquez le crayon d'une fiche pour lire son rôle — rien n'est lancé et rien n'est modifié tant que vous n'enregistrez pas.",
    "Pour faire travailler l'équipe : ouvrez 🧭 Assistant et décrivez la tâche en une phrase ; c'est lui qui choisit l'agent et suit le résultat.",
  ];
  const needsFirstAgents = known && !ok;
  if (needsFirstAgents) {
    lines.unshift(
      "Commencez par remettre une équipe en place : dans l'écran « Équipe d'agents », le bouton ↻ restaure les agents fournis d'origine, le bouton + ajoute un agent.",
    );
  }
  return { ok, needsFirstAgents, lines };
}

/**
 * Libellé de l'étape courante (« Étape 1 sur 2 »).
 * @param {number} screen
 * @returns {string}
 */
export function onboardingTeamStepLabel(screen) {
  const n = Math.min(Math.max(Number(screen) || 1, 1), ONBOARDING_TEAM_SCREENS);
  return `Étape ${n} sur ${ONBOARDING_TEAM_SCREENS}`;
}

/** Message lisible d'une erreur quelconque. */
function describe(e) {
  if (typeof e === "string") return e;
  return String((e && e.message) || e);
}

/**
 * Notifie sans jamais décider de la navigation : une notification qui échoue
 * (conteneur absent, contexte démonté) ne doit pas bloquer la sortie ni laisser
 * une fenêtre ouverte sur un échec silencieux.
 */
function notify(fn, message) {
  try {
    fn(message);
  } catch (_) {
    /* la notification est facultative, la décision ne l'est pas */
  }
}

// ─────────────────────────────── ouverture ─────────────────────────────────

/** Vrai tant que la fenêtre est ouverte (jamais deux fenêtres). */
let _open = false;

/**
 * Ouvre le niveau 2 — UNIQUEMENT sur un geste explicite de l'utilisateur.
 *
 * La garde du geste est la PREMIÈRE instruction, avant tout accès au document :
 * aucune autre voie (démarrage, minuterie, état de l'équipe, appel détaché) ne
 * peut afficher cette fenêtre.
 *
 * @param {{
 *   gesture?: boolean,                     // DOIT valoir `true` (clic de l'utilisateur)
 *   tabs?: object,                         // onglets de l'application (écran d'équipe existant)
 *   openAgentsScreen?: Function,           // ouvre l'écran d'équipe (sinon `tabs.openFile`)
 *   registry?: object|object[]|Function,   // état de l'équipe déjà en mémoire (lecture seule)
 *   loadRegistry?: Function,               // lecture de l'état de l'équipe
 * }} [deps]
 * @returns {Promise<{shown: boolean, reason: string}>}
 */
export async function openOnboardingTeamModal(deps = {}) {
  if (deps.gesture !== true) return { shown: false, reason: "no-gesture" };
  if (_open) return { shown: false, reason: "already-open" };
  if (typeof document === "undefined") return { shown: false, reason: "no-dom" };
  const modal = document.getElementById(ONBOARDING_TEAM_MODAL_ID);
  if (!modal) {
    console.warn("[onboarding] fenêtre du niveau 2 absente du document :", ONBOARDING_TEAM_MODAL_ID);
    return { shown: false, reason: "modal-missing" };
  }

  const el = (id) => document.getElementById(id);
  const stepEl = el("onboarding-team-step");
  const roleBody = el("onboarding-team-role-body");
  const gestureBody = el("onboarding-team-gesture-body");
  const retryBtn = el("btn-onboarding-team-retry");
  const skipBtn = el("btn-onboarding-team-skip");
  const prevBtn = el("btn-onboarding-team-prev");
  const nextBtn = el("btn-onboarding-team-next");
  const closeBtn = el("onboarding-team-close");
  const screens = Array.from(modal.querySelectorAll("[data-onboarding-team-screen]"));

  const view = { screen: 1, composition: null, busy: false };

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

  const render = () => {
    for (const section of screens) {
      const n = Number(section.getAttribute("data-onboarding-team-screen"));
      section.classList.toggle("hidden", n !== view.screen);
    }
    if (stepEl) stepEl.textContent = onboardingTeamStepLabel(view.screen);
    prevBtn?.classList.toggle("hidden", view.screen === 1);
    if (nextBtn) {
      nextBtn.textContent =
        view.screen === ONBOARDING_TEAM_SCREENS ? "Voir mon équipe d'agents" : "Suivant";
    }
  };

  const renderContent = () => {
    const composition = view.composition;
    // Aucun cas muet : tant que l'équipe est en cours de lecture, on le DIT.
    fill(
      roleBody,
      composition ? composition.lines : ["Lecture de votre équipe d'agents…"],
    );
    fill(gestureBody, onboardingTeamFirstGesture(composition).lines);
    if (composition) retryBtn?.classList.toggle("hidden", composition.ok);
    render();
  };

  // ── lecture de l'état de l'équipe (aucune session, aucune écriture) ───────
  const readRegistry = async () => {
    if (typeof deps.registry !== "undefined") return deps.registry;
    if (typeof deps.loadRegistry === "function") return await deps.loadRegistry();
    // Repli : lecture du registre d'agents (base/disque, sans lancer d'agent).
    const { loadAgentRegistry } = await import("./agents.js");
    return await loadAgentRegistry();
  };

  const refresh = async () => {
    if (view.busy) return;
    view.busy = true;
    retryBtn?.setAttribute("disabled", "disabled");
    let raw = null;
    let error = "";
    try {
      raw = await readRegistry();
    } catch (e) {
      error = describe(e);
    }
    view.busy = false;
    retryBtn?.removeAttribute("disabled");
    view.composition = onboardingTeamComposition(raw, error);
    renderContent();
  };

  // ── sortie : l'écran d'équipe EXISTANT (jamais une impasse) ──────────────
  const showTeamScreen = async () => {
    const opener = typeof deps.openAgentsScreen === "function" ? deps.openAgentsScreen : null;
    if (opener) {
      try {
        await opener();
      } catch (e) {
        // On ne referme pas sur un échec silencieux : la fenêtre reste, l'erreur
        // est dite, et l'utilisateur peut réessayer.
        notify(toastError, `Écran « Équipe d'agents » non ouvert : ${describe(e)}`);
        return false;
      }
    } else if (deps.tabs && typeof deps.tabs.openFile === "function") {
      try {
        await deps.tabs.openFile(ONBOARDING_TEAM_AGENTS_TAB_LABEL, ONBOARDING_TEAM_AGENTS_TAB_MODE);
      } catch (e) {
        notify(toastError, `Écran « Équipe d'agents » non ouvert : ${describe(e)}`);
        return false;
      }
    } else {
      // Ouvert depuis l'écran d'équipe lui-même : il est déjà là, derrière.
      close();
      notify(toastInfo, "L'écran « Équipe d'agents » est juste derrière : cette fenêtre se ferme.");
      return true;
    }
    close();
    return true;
  };

  // ── câblage ──────────────────────────────────────────────────────────────
  const onKeydown = (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close(); // aucune écriture : fermer ne décide rien à la place de personne
  };

  function close() {
    modal.classList.add("hidden");
    document.removeEventListener("keydown", onKeydown, true);
    _open = false;
  }

  skipBtn?.addEventListener("click", () => close());
  closeBtn?.addEventListener("click", () => close());
  prevBtn?.addEventListener("click", () => {
    if (view.screen > 1) view.screen -= 1;
    render();
  });
  nextBtn?.addEventListener("click", () => {
    if (view.screen < ONBOARDING_TEAM_SCREENS) {
      view.screen += 1;
      render();
      return;
    }
    void showTeamScreen();
  });
  retryBtn?.addEventListener("click", () => void refresh());

  // ── premier affichage ────────────────────────────────────────────────────
  _open = true;
  view.screen = 1;
  view.composition = null;
  renderContent();
  modal.classList.remove("hidden");
  document.addEventListener("keydown", onKeydown, true);
  animateModalOpen(modal);
  void refresh();
  return { shown: true, reason: "shown" };
}
