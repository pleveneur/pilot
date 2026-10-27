// super-agent.js — Assistant de suivi (spec_super_agent.md)
//
// Onglet 🧭 Assistant : assistant de suivi multi-projets, lecture seule.
// Session RPC dédiée (canal rpc-event-superagent), couleur d'accent distincte
// des agents de coding. Gère le chat, la config (nom, clients, prompt) et
// l'initialisation.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import markdownit from "markdown-it";
import { refreshIcons } from "./icons.js";
// Lecture a voix haute des reponses de l'assistant : rangee d'actions sous la
// bulle (bouton Ecouter / Arreter). Regles (nettoyage du balisage, decoupage en
// phrases, une seule lecture a la fois) regroupees dans read-aloud.js.
// LOT 2 (ecran Vocal) : `READ_ALOUD_STATE_EVENT` est la SEULE source de l'etat
// « Pilot parle » de cet ecran, et `stopReading` est le SEUL arret : aucun
// second mecanisme de lecture n'est cree.
import { attachReadAloud, READ_ALOUD_STATE_EVENT, stopReading } from "./read-aloud.js";
// LOT 3 (ecran Vocal) : le NIVEAU DU MICRO. Toute la capture (demande de
// permission, flux, analyseur, lissage, ARRET reel) vit dans vocal-mic.js ; ce
// fichier ne fait que brancher ses trois retours et ne contient donc aucune des
// API micro (ce que verrouille ecran-vocal-lot2.test.js).
import {
  createVocalMic,
  planLevel,
  shouldAskVocalMic,
  MIC_FERME,
} from "./vocal-mic.js";
// Envoi AUTOMATIQUE a la fin d'une dictee vocale : la decision et l'ORDRE
// (refermer la session -> ecrire la zone -> envoyer) vivent dans CE module, le
// meme que celui de l'onglet agent pi — aucune copie de logique ici, et le
// `send` reste le chemin d'envoi existant du fichier (Entree / bouton Envoyer).
import { applyVoiceEnd } from "./voice-auto-send.js";
import { agentDisplayLabel, backendKind } from "./backend-info.js";
import { appendDelegatedMessage, purgeAgentTabView } from "./agent-pi.js";
import {
  detectRepeatedBlock,
  detectRepeatedWord,
  detectRepeatedToolCalls,
  detectSemanticLoop,
  buildToolLoopFingerprint,
  buildAgentStopRequest,
  // RÈGLE 2 : une LECTURE (outil de lecture pure ou commande shell consultative)
  // n'est jamais un motif d'arrêt — classifieur PARTAGÉ avec le bus et l'onglet
  // agent principal (auparavant l'Assistant comptait toute lecture et coupait au
  // bout de 3 consultations identiques).
  isReadOnlyAgentToolCall,
} from "./loop-detection.js";
// Journal disque du MOTIF des arrêts automatiques (correctif faux positif de
// détection de boucle : la cause de l'arrêt doit survivre à la session).
import { traceAutomaticAgentStop } from "./agent-stop-trace.js";
// TEXTE DÉJÀ ÉCRIT D'UN AGENT MORT : quand un agent lancé en arrière-plan meurt
// ou plante, ce qu'il avait déjà rédigé est CONSERVÉ et restitué (le buffer
// `loop.lastText` était accumulé puis remis à zéro sans jamais être lu).
import {
  normalizePartialText as normalizePartialAgentText,
  buildAgentDeathReport,
} from "./agent-partial-text.js";
import { notifySuperAgentDone, playAssistantSound } from "./desktop-notify.js";
// Son de fin DIFFÉRÉ jusqu'à la fin réelle de l'affichage (le son ne doit plus
// partir pendant que la réponse / le raisonnement s'écrit encore). L'émetteur
// réel (`playAssistantSound`, qui relit `assistant_sound_enabled`) est branché
// ici : l'inertie du réglage est donc strictement inchangée.
import { armDoneSound, noteSoundRenderActivity, markSoundRenderIdle, resetDeferredSound, setDeferredSoundPlayer } from "./sound-deferred.js";
setDeferredSoundPlayer(playAssistantSound);
import { loadAgentRegistry, upsertAgent, normalizeAgent, validateAgentId } from "./agents.js";
import { runAgentsForAssistantAsync, setBusNotifyCallback, isRunInProgress, releaseStuckRunLock, endRun, ASSISTANT_SPACE, RUN_LAUNCH_MIN_STUCK_IDLE_MS, listExclusivityWaitingDemands } from "./agents-bus.js";
import { applyAssistantBriefEnvelope } from "./structured-brief.js";
import { buildDelegationContext, prefixDelegationContext } from "./super-agent-context.js";
import { shouldScheduleTick, parseScheduleEvery, formatReminderNotificationLabel, planDueReminderInjections, buildReminderInjection, buildReminderInjectionMessage, formatReminderGroupNotificationLabel, formatReminderHoldNotice, createReminderHoldGuard } from "./super-agent-schedule.js";
// MÉNAGE DES RAPPELS : décision UNIQUE (pures) des rappels devenus inutiles —
// mêmes règles pour le ménage automatique (une fois par jour) et pour le bouton
// « Supprimer les rappels inutiles » de Paramètres → Assistant.
import { classifyScheduleCleanup, cleanupApplyPayload } from "./super-agent-schedule-cleanup.js";
import { mountCollapsibleAgentList, subscribeAgentActivity, getAgentActivitySnapshot, buildRunningMissions, renderMissionsPanelHtml, normalizeMissionResume, agentPanelEventsListElement, agentPanelTasksListElement, agentPanelNoteEvent, onAgentPanelTabChange, setAgentPanelTabsVisibility, splitMissions, setAgentPanelTaskCount, isAgentPanelPaneVisible } from "./agent-activity.js";
// Compteur du bouton « Travail » : les commandes TAPEES A LA MAIN mises en file
// sur un projet sont une famille d'attente a part entiere (elles n'etaient
// comptees nulle part, donc le total affiche etait faux).
import { listAllProjectCommands } from "./project-task-queue.js";
import { buildRunAgentsSummary, runAgentsResultFailed, emitRunAgentsFinishNotice } from "./run-agents-notify.js";
import { shouldRememberAgentReport, shouldDeliverAgentReport } from "./super-agent-exchange-filter.js";
import { captureProjectBadgeNames, extendBadgesWithText, pathTailName, resolveBubbleBadgeNames, addConcernedBadge, badgeNameFromProjectPath } from "./super-agent-badges.js";
import { periodBounds, periodKindLabel, formatPeriodReport, weekBounds } from "./period-report.js";
import { isGdsConnected, isProjectGds } from "./gds-status.js";
import { isBusyStale, isProjectWorking } from "./exclusivity-queue.js";
// TERRAIN RÉSERVÉ : tant que le terrain est occupé par une opération GLOBALE —
// vérification de la version du moteur `pi` ou son installation
// (`pi-startup-gate.js`), mise à jour de Pilot (`update-window.js`) — RIEN ne
// démarre (ni mission, ni délégation, ni réflexion de l'Assistant).
// La DÉCISION est celle du gardien unique `run-policy.js` (`isTerrainReserved`,
// `terrainReservedMessage`, `canAssistantReflect`) : ici on ne fait que la
// consulter, jamais une copie locale de la règle.
import {
  isTerrainReserved,
  terrainReservedMessage,
  canAssistantReflect,
  assistantReflectionBlockedMessage,
} from "./run-policy.js";
// MISE À JOUR DE PILOT : plus aucune priorité d'affichage à accorder. La mise à
// jour n'a PLUS besoin d'un terrain libre pour s'afficher (seule une
// INSTALLATION réserve le terrain, décision du propriétaire 2026-11) : elle ne
// retarde donc plus la relance AUTOMATIQUE du travail (mission sortie de file,
// délégation en file). Aucun import de `updater.js` n'est nécessaire ici.
import { shouldFinalizeOnAgentEnd } from "./agent-hardening.js";
import { toastInfo } from "./toast.js";
import { createReportDeliveryGate } from "./super-agent-reports.js";
// REÇU VISIBLE d'un compte rendu remis (invariant : un compte rendu remis laisse
// TOUJOURS une trace visible dans la conversation, quoi que dise ou ne dise pas
// le modèle). Module pur ; le rendu DOM de la bulle est juste en dessous.
import { deliverReportReceipt } from "./super-agent-receipt.js";
// RÈGLE 4 : identité de MISSION d'une demande mise en file (numéro monotone +
// agents visés). Une demande rejouée porte TOUJOURS la sienne — le rapport livré
// et le journal d'abandon la NOMMENT, donc une incohérence devient visible.
import { nextMissionId, makeMissionIdentity, annotateMissionReport, stampQueuedMission, stampQueuedMissionResume, missionQueueLabel } from "./mission-identity.js";
// AGENT JETABLE (décision propriétaire du 2026-10-21) : un rôle peut être fourni
// DANS la demande (`run_agents` avec des objets agent) → agent éphémère gardé en
// mémoire seule (aucune ligne dans la table `agents`), qui n'existe que le temps
// de la tâche. Purge assurée à la fin de la mission (`settleRun`).
import { buildEphemeralAgent, persistEphemeralAgent, disposeEphemeralAgents, isEphemeralAgentId } from "./ephemeral-agents.js";
// GARDE-FOU DU LIVRABLE (défaut « l'agent rend un plan ») : refus au lancement
// d'une demande d'ÉCRITURE adressée à un agent en LECTURE SEULE, et vérification
// des fichiers réellement attendus sur disque (`expected_files`). Sans demande
// d'écriture explicite ni fichier déclaré, RIEN ne change (rétrocompatibilité).
import { normalizeExpectedFiles, readOnlyWriteRefusalMessage } from "./deliverable-guard.js";
// MISSION P3 (défaut D3) : IDENTITÉ DE PROJET normalisée, SOURCE UNIQUE.
// La file de missions, les états de délégation et les drapeaux de run étaient
// indexés par le chemin BRUT : deux écritures du même dossier (« G:\IA_PL\pilot »
// et « g:/ia_pl/pilot/ ») produisaient deux files jumelles, dont l'une devenait
// invisible (jamais lue, jamais rejouée). Toutes les clés de ces maps passent
// maintenant par `project-key.js`. Le chemin réel reste transmis tel quel au
// backend : une clé n'est jamais utilisée comme chemin.
import { projectKey, projectScopedKey, deleteProjectScoped, sameProject } from "./project-key.js";
import {
  parseMemoryRemovePayload,
  parseMemoryRestorePayload,
  parseMemoryTrashListPayload,
  formatMemoryTrashList,
} from "./super-agent-memory.js";
import {
  askTelegramQuestion,
  settleTelegramQuestion,
  answerTelegramQuestionFromApp,
  clearTelegramQuestion,
} from "./telegram-questions.js";
// Telegram (étape 2, lot 3) : l'Assistant « parle » sur Telegram. Relaie sa
// réponse finale (reformulée en une phrase simple) et gère le bouton d'activation
// (visible uniquement si Telegram est configuré, état persisté).
import {
  classifyAssistantMessageWithLaya,
  flushRawTelegramAvis,
  isTelegramDialogActive,
  loadTelegramDialogConfig,
  relayAssistantMessageToTelegram,
  setRawAvisTurnProbe,
} from "./telegram-dialog.js";
// Réglage UNIQUE « me prévenir sur Telegram » (AppConfig
// `telegram_notify_enabled`) : l'outil UNIQUE `telegram_notifications` passe par
// ici, dans le chat de l'onglet 🧭 comme depuis un message Telegram reçu — LIRE
// (aucun argument) et CHANGER (enabled: true/false) empruntent le MÊME chemin.
// Aucune valeur d'état n'est injectée dans le prompt de l'assistant. L'interface
// est rafraîchie quand la réception Telegram réactive le réglage d'office.
import {
  TELEGRAM_NOTIFY_CHANGED_EVENT,
  readTelegramNotifyEnabled,
  setTelegramNotifyEnabled,
  telegramNotifyConfirmation,
  telegramNotifyStateAnswer,
} from "./telegram-notify-setting.js";
// Refonte des messages Telegram : le NOM COURT du projet vient de l'UNIQUE
// fonction du projet (`projectShortName`) — jamais un chemin, jamais un nom
// recopié à la main. « Assistant » seulement si aucun projet n'est ouvert.
import { projectShortName } from "./telegram-messages.js";
// TROIS MODES D'ECRAN (lot 1 puis lot 2, RAPPORT-trois-modes-ecran-vocal.md §1
// a §3) : le mode est decide et memorise par `screen-mode.js` (source unique),
// qui dit aussi QUEL ecran possede chaque mode (`screenModeScreen`). Ici,
// l'onglet Assistant ne fait que trois choses : DEPLACER le bouton unique dans
// la barre de l'ecran ouvert (et le restituer a la sortie), entrer dans
// l'ecran demande / en sortir, et SIGNALER l'entree / la sortie REELLES pour
// que la cle de memoire reste juste (bouton retour, Echap, fermeture de
// l'onglet). Aucun second bouton, aucun ecran de « Detaille » redessine.
import {
  LEGACY_IMMERSIVE_KEY,
  SCREEN_MODE_APPLY_EVENT,
  SCREEN_MODE_BUTTON_ID,
  getScreenMode,
  isImmersiveScreenMode,
  noteImmersiveEntered,
  noteImmersiveExited,
  rememberScreenMode,
  screenModeScreen,
} from "./screen-mode.js";

/**
 * Projet à afficher en tête des messages Telegram de l'Assistant : le nom court
 * du projet actif, ou « Assistant » quand aucun projet n'est ouvert.
 * @returns {string}
 */
function assistantTelegramProject() {
  const active =
    typeof window !== "undefined" && window ? window._pilotProjectPath || "" : "";
  return projectShortName(active) || "Assistant";
}

const SUPERAGENT_CHANNEL = "rpc-event-superagent";

// P0-4 : le plafond de taille de ce qui est VERSÉ dans la conversation de
// l'assistant est défini UNE SEULE FOIS côté Rust
// (`MAX_INJECTED_MESSAGE_CHARS`, `super_agent.rs`) : il borne le message
// d'injection ENTIER (préfixe + résumé + avis de troncature). Le frontend ne
// tronque plus (aucune valeur recopiée) et envoie le texte COMPLET, que Rust
// conserve tel quel en base ; seule la copie injectée est bornée.

/**
 * Verdict de lancement d'une run d'agents (défaut « faux succès de lancement »).
 * `launched` reflète le DÉMARRAGE RÉEL rapporté par le bus (onStart) — jamais la
 * simple intention de lancer. Un lancement refusé (verrou déjà pris) ou une
 * erreur de préparation avant démarrage ne doit JAMAIS être annoncé comme un
 * succès. `queued` signale une mise en file (pas un lancement).
 * @param {{started?: boolean, queued?: boolean, error?: string|null}} launchResult
 * @returns {{ok: boolean, launched: boolean, queued: boolean, error: string|null}}
 */
export function computeRunLaunchVerdict(launchResult) {
  const r = launchResult || {};
  const launched = r.started === true;
  const queued = r.queued === true;
  // `preparing` : plus AUCUN chemin de lancement ne le produit (mission 381 :
  // l'estimation préalable automatique a été supprimée, le lancement ne rend
  // jamais la main avant le démarrage réel ou la mise en file). Le champ est
  // conservé — toujours `false` en pratique — pour ne pas casser les appelants
  // ni les accusés déjà persistés qui le lisent.
  const preparing = r.preparing === true;
  // Issue #87 : l'accusé ne doit JAMAIS annoncer « ok » alors que rien ne s'est
  // passé. Une demande réellement lancée, mise en file d'attente ou en cours de
  // préparation est un succès ; dans TOUT autre cas (refus, abandon silencieux,
  // résultat de lancement illisible) on force une erreur explicite : l'assistant
  // (et l'utilisateur) doit savoir POURQUOI la mission n'a pas démarré, au lieu
  // de lire un `{ok:true}` vide de sens qui masque la perte de la demande.
  const ok = launched || queued || preparing;
  return {
    ok,
    launched,
    queued,
    preparing,
    error: r.error || (ok ? null : "Lancement non effectué : aucun démarrage ni mise en file (raison non rapportée par le lanceur)."),
  };
}

// 4.1 (R3) : id de l'agent standard du projet dans le registre (base `agents`).
// Utilisé UNIQUEMENT pour RÉSOUDRE l'objet cible d'une délégation (get_agent).
// Jamais utilisé comme cible directe d'envoi/arrêt : toute délégation utilise
// l'id résolu depuis l'objet (resolveDelegationAgentId), aligné sur la vue
// affichée (règle de cohérence ecrans.md).
const DEFAULT_AGENT_ID = "default";

/**
 * MISSION 381 — Refus EXPLICITE quand un ou plusieurs agents demandés sont
 * inconnus du registre. Le message nomme les identifiants inconnus, affirme
 * qu'AUCUN agent n'a été lancé et donne la LISTE DES AGENTS DISPONIBLES :
 * jamais de substitution silencieuse (la mission ne part jamais vers un agent
 * que l'utilisateur n'a pas demandé).
 * @param {string[]} missing - identifiants demandés introuvables
 * @param {{agents?: Array<{id?: string}>}|null} registry - registre des agents
 * @returns {string}
 */
export function unknownAgentsError(missing, registry) {
  const ids = (Array.isArray(missing) ? missing : []).filter(Boolean);
  const available = ((registry && registry.agents) || [])
    .map((a) => (a && a.id ? String(a.id) : ""))
    .filter(Boolean);
  return `Agents inconnus : ${ids.join(", ")}. Aucun agent n'a été lancé. Agents disponibles : ${
    available.length ? available.join(", ") : "aucun"
  }.`;
}

// Rendu Markdown identique à l'agent standard (agent-pi.js).
const md = markdownit({
  html: false,
  linkify: true,
  typographer: true,
  breaks: true,
});

// Seuil (px) : on ne force le scroll en bas que si l'utilisateur est déjà en
// bas (ou proche), pour ne pas l'empêcher de remonter pendant que l'assistant
// écrit (issue #60).
const SUPER_SCROLL_BOTTOM_THRESHOLD = 60;

// Ordonnancement chronologique des messages d'info de l'assistant (#20).
// Chaque message d'info reçoit un `seq` unique à l'émission ; les messages
// arrivés hors ordre sont mis en attente dans `pendingInfo` jusqu'à ce que
// leur séquence soit atteinte, garantissant un affichage chronologique.
let infoSeq = 0;
const pendingInfo = {};
let nextInfoSeq = 0;

// ── Panneau des événements système (tâche #139) ──
// Les événements système (délégations, démarrage/arrêt d'agents, erreurs,
// connexion perdue, notifications) sont retirés du centre de la discussion. Ils
// sont affichés dans le panneau du SUIVI DU TRAVAIL (haut droite, ouvert par le
// cercle d'activité), onglet « Événements » — panneau unique partagé avec la
// liste des agents et les missions : plus de panneau ni de bouton « cloche »
// propres à l'onglet Assistant. Le compteur de non-lus est porté par le cercle.
// Les éléments interactifs (confirm/select/choice) restent au centre.
const SUPER_EVENTS_MAX = 150; // tampon mémoire (évite un panneau illisible)
// Filet de rejeu du volet « Tâches » : le volet est alimenté par le store
// d'activité tant qu'il est affiché (abonnement posé par loadSuperMissions).
let superMissionsUnsub = null;      // désabonnement du store d'activité (volet ouvert) pour le détail
let stopPanelTabWatch = null;       // désabonnement du suivi des onglets du panneau global

// ── Overlay plein écran des événements (tâche #160) ──
// Quand le réglage `super_agent_events_overlay_enabled` est actif, chaque
// événement du volet « Événements » s'affiche AUSSI en bandeau discret AU CENTRE de
// l'écran (au-dessus de tout), avec disparition automatique après une durée
// réglable (défaut 5 s). Un SEUL emplacement : le dernier événement REMPLACE le
// précédent et le minuteur repart (jamais d'empilement). Les questions
// interactives (confirm/select/choice) ne passent PAS par cette source
// (pushSuperAgentSystemEvent) et restent exclusivement au centre du chat.
const SUPER_EVENTS_OVERLAY_FADE_MS = 400; // fade-out court (~400 ms)
let superEventsOverlayEl = null;          // élément overlay (unique)
let superEventsOverlayTimer = null;       // minuteur d'affichage
let superEventsOverlayHideTimer = null;   // minuteur de retrait après fade-out

/** Normalise la durée d'affichage de l'overlay (secondes) : défaut 5, borné à
 * [1, 120]. Pur et testable (tâche #160).
 * @param {number|undefined} seconds
 * @returns {number}
 */
export function normalizeOverlaySeconds(seconds) {
  const n = Math.floor(Number(seconds));
  if (!Number.isFinite(n) || n <= 0) return 5;
  return Math.min(Math.max(n, 1), 120);
}

/** Mappe un niveau d'événement (info|warn|error|success) vers la classe CSS de
 * la pastille de l'overlay (même palette que le volet « Événements »). Pur et
 * testable (tâche #160).
 * @param {string} level
 * @returns {string} info|warning|danger|success
 */
export function superEventOverlayLevelClass(level) {
  if (level === "error") return "danger";
  if (level === "warn") return "warning";
  if (level === "success") return "success";
  return "info";
}

/** Affiche (ou remplace) le bandeau central d'événement (tâche #160). Fail-open :
 * réglage désactivé → aucun affichage (comportement actuel inchangé).
 * @param {string} level info|warn|error|success
 * @param {string} text texte déjà filtré (trim + chemin nu exclus)
 */
function showSuperEventOverlay(level, text) {
  const cfg = configCache || {};
  if (cfg.super_agent_events_overlay_enabled !== true) return;
  const seconds = normalizeOverlaySeconds(cfg.super_agent_events_overlay_seconds);
  // Un seul emplacement : l'élément est créé une fois puis RÉUTILISÉ (le
  // dernier événement remplace le précédent, jamais d'empilement).
  if (!superEventsOverlayEl) {
    superEventsOverlayEl = document.createElement("div");
    superEventsOverlayEl.className = "superagent-events-overlay";
    const dot = document.createElement("span");
    dot.className = "superagent-events-overlay-dot";
    const label = document.createElement("span");
    label.className = "superagent-events-overlay-text";
    superEventsOverlayEl.appendChild(dot);
    superEventsOverlayEl.appendChild(label);
    document.body.appendChild(superEventsOverlayEl);
  }
  // Annule un éventuel fade-out en cours : le bandeau redevient pleinement
  // visible avec le NOUVEAU contenu et le minuteur repart de zéro.
  if (superEventsOverlayTimer) { clearTimeout(superEventsOverlayTimer); superEventsOverlayTimer = null; }
  if (superEventsOverlayHideTimer) { clearTimeout(superEventsOverlayHideTimer); superEventsOverlayHideTimer = null; }
  superEventsOverlayEl.classList.remove("fade-out");
  const dot = superEventsOverlayEl.querySelector(".superagent-events-overlay-dot");
  const label = superEventsOverlayEl.querySelector(".superagent-events-overlay-text");
  if (dot) dot.className = "superagent-events-overlay-dot " + superEventOverlayLevelClass(level);
  if (label) label.textContent = text;
  // Disparition automatique après `seconds` secondes : fade-out court puis retrait.
  superEventsOverlayTimer = setTimeout(() => {
    if (!superEventsOverlayEl) return;
    superEventsOverlayEl.classList.add("fade-out");
    superEventsOverlayHideTimer = setTimeout(() => {
      if (superEventsOverlayEl) { superEventsOverlayEl.remove(); superEventsOverlayEl = null; }
    }, SUPER_EVENTS_OVERLAY_FADE_MS);
  }, seconds * 1000);
}

/** Retire l'overlay plein écran + ses minuteurs (fermeture de l'onglet 🧭). */
function hideSuperEventOverlay() {
  if (superEventsOverlayTimer) { clearTimeout(superEventsOverlayTimer); superEventsOverlayTimer = null; }
  if (superEventsOverlayHideTimer) { clearTimeout(superEventsOverlayHideTimer); superEventsOverlayHideTimer = null; }
  if (superEventsOverlayEl) { superEventsOverlayEl.remove(); superEventsOverlayEl = null; }
}

/** Décision pure (testable) : faut-il descendre en bas ? Vrai si l'utilisateur
 * est déjà en bas (ou presque, seuil `threshold`). Ne force pas le bas si
 * l'utilisateur a volontairement remonté pour relire (issue #60). */
export function shouldScrollSuperToBottom(scrollTop, clientHeight, scrollHeight, threshold = SUPER_SCROLL_BOTTOM_THRESHOLD) {
  return scrollTop + clientHeight >= scrollHeight - threshold;
}

/**
 * Calcule le nouvel état du flag de suivi automatique `superAtBottom` à partir
 * de la position de scroll. Pur et testable. Utilisé par le listener `scroll`
 * du conteneur de messages : quand l'utilisateur est au bas (ou proche, seuil
 * `threshold`), le suivi est ré-armé (true) ; dès qu'il remonte au-dessus du
 * seuil pour relire, le suivi est désactivé (false). Conserve le comportement
 * issue #60 : on ne force pas le bas si l'utilisateur a remonté pour relire.
 *
 * Le flag est « ré-armé » dès que l'utilisateur redescend tout en bas avec
 * l'ascenseur : la prochaine fois que du contenu arrive, le suivi redevient
 * actif à 100 %. Fonction pure de la position courante (pas d'état précédent)
 * : la position suffit à décider si l'on suit.
 */
export function computeSuperAtBottomFlag(scrollTop, clientHeight, scrollHeight, threshold = SUPER_SCROLL_BOTTOM_THRESHOLD) {
  return shouldScrollSuperToBottom(scrollTop, clientHeight, scrollHeight, threshold);
}

/**
 * Décision pure (testable) : détermine si le fond de la zone de saisie de
 * l'assistant doit porter la teinte « réflexion » (dégradé discret basé sur
 * --superagent-accent, même couleur que le cercle respirant) à la réception
 * d'un événement RPC super-agent. Aligné sur le cercle respirant
 * (agent-activity.js) et sur l'état `backendBusy` :
 *   - agent_start → réflexion active (true)
 *   - agent_end / process_exit / process_error → repos (false)
 *   - autres événements → pas de changement (null) : on conserve l'état courant.
 * Réutilise le MÊME signal d'état que le bandeau `busyHint` (pas une nouvelle
 * source de vérité).
 * @param {string} type
 * @returns {boolean|null}
 */
export function superAgentReflectingFromEvent(type) {
  if (type === "agent_start") return true;
  if (type === "agent_end" || type === "process_exit" || type === "process_error") return false;
  return null;
}

/**
 * Decision PURE (testable) : la zone de saisie de la conversation de
 * l'Assistant doit-elle porter le signal de travail (classe
 * `superagent-input-reflecting`, respiration du fond du champ) ?
 *
 * UNE seule question : « l'Assistant lui-meme est-il en train de travailler ? ».
 * Le travail des AUTRES agents (agent d'un projet, agent delegue, agent sans
 * onglet, file d'attente d'un projet) n'entre PAS dans cette decision : il a
 * son propre signal — le point qui respire de la liste des agents — et ne doit
 * jamais faire croire, dans l'onglet 🧭, que l'Assistant travaille. Coupler la
 * zone de saisie a l'etat global (`anyBusy`) faisait clignoter la barre en
 * boucle alors que l'Assistant etait au repos et qu'un seul AUTRE agent
 * travaillait.
 *
 * Regles :
 *  - `agentReflecting` : l'Assistant lui-meme reflechit (agent_start, poll de
 *    `get_agent_supervision`, remis a false des qu'il ne traite plus) ;
 *  - `pendingQuestion` : une question d'agent attend une reponse — la barre
 *    reste alors en mode normal, prete a saisir la precision (chantier #132) ;
 *    aucune teinte, meme si l'Assistant reflechit.
 * Toute autre cle d'un objet d'etats est IGNOREE (aucun second etat ne peut
 * rallumer la zone de saisie sans passer par cette fonction).
 * @param {{agentReflecting?: boolean, pendingQuestion?: boolean}} etats
 * @returns {boolean} true si la zone de saisie doit respirer.
 */
/**
 * Etat AFFICHE de l'ecran Vocal (lot 2, RAPPORT-trois-modes-ecran-vocal.md §4).
 * UN SEUL etat a la fois, par ordre de priorite : la parole (la voix sort)
 * prime sur la reflexion, qui prime sur l'ecoute. Depuis le lot 3, « ecoute »
 * est alimente par le NIVEAU REELLEMENT MESURE (vocal-mic.js) : l'appelant ne
 * passe `listening` que si le micro capte, jamais pour signaler une demande de
 * permission ni une intention.
 * @param {{speaking?: boolean, reflecting?: boolean, listening?: boolean}} [etats]
 * @returns {"idle"|"listening"|"thinking"|"speaking"}
 */
export function vocalScreenState(etats = {}) {
  const e = etats || {};
  if (e.speaking === true) return "speaking";
  if (e.reflecting === true) return "thinking";
  if (e.listening === true) return "listening";
  return "idle";
}

/** Classe CSS de l'etat de l'ecran Vocal (une seule classe a la fois). */
export function vocalStateClass(etats = {}) {
  return `vocal-state-${vocalScreenState(etats)}`;
}

/**
 * L'UNIQUE ligne d'etat de l'ecran Vocal (§2.3) : une seule phrase, jamais
 * coloree par l'etat (la couleur vit dans l'objet). Le texte est lu tel quel
 * dans le rapport.
 * @param {"idle"|"listening"|"thinking"|"speaking"} state
 * @returns {string}
 */
export function vocalStatusText(state) {
  switch (state) {
    case "listening":
      return "Je vous écoute…";
    case "thinking":
      return "Je réfléchis…";
    case "speaking":
      return "Je réponds.";
    default:
      return "Je vous écoute.";
  }
}

/**
 * Reduction de mouvement (§4.3) : l'ecran Vocal lit le MEME drapeau que les
 * animations d'ouverture (modal-anim.js) — `prefers-reduced-motion` PLUS le
 * parametre utilisateur `_pilotModalAnimations` (défaut : respecter la
 * preference systeme). Aucun nouveau reglage n'est cree.
 * @returns {boolean}
 */
export function vocalReducedMotion(win) {
  const w = win || (typeof window !== "undefined" ? window : null);
  if (!w || typeof w.matchMedia !== "function") return false;
  let reduit = false;
  try {
    reduit = !!w.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (_) {
    return false;
  }
  return reduit && w._pilotModalAnimations !== true;
}

export function superAgentInputReflecting(etats = {}) {
  const e = etats || {};
  if (e.pendingQuestion === true) return false;
  return e.agentReflecting === true;
}

/**
 * Consigne préparée envoyée dans la conversation de l'Assistant par le bouton
 * « Analyser et ranger mes données » de l'onglet 🧭 (spec_super_agent.md §7).
 *
 * Fonction pure : le texte est verrouillé par un test qui exige ses garanties
 * (lecture seule stricte, rapport écrit + proposition de rangement en trois
 * parties, aveu honnête de ce qui n'a pas pu être examiné) et l'interdiction de
 * toute modification. Aucune machinerie nouvelle n'est ajoutée au cœur du
 * logiciel : l'Assistant dispose déjà de ses outils pour LIRE son dossier de
 * travail (`~/.pilot/assistant/`) et sa base de suivi
 * (`~/.pilot/super-agent.db`) ; ce texte décrit le travail et ses limites.
 * @returns {string}
 */
export function buildDataAnalysisPrompt() {
  return [
    "**Analyser et ranger mes données — analyse en LECTURE SEULE.**",
    "",
    "Cette consigne a été préparée par le bouton « Analyser et ranger mes données » de l'onglet Assistant. Elle décrit exactement le travail attendu et ses limites : suis-la telle quelle.",
    "",
    "**1) Examine, en lecture seule :**",
    "- ton dossier de travail (`~/.pilot/assistant/`, organisé par client puis par projet) : ce qu'il contient, comment c'est rangé, ce qui est vide, en double ou orphelin ;",
    "- ta base de suivi (`~/.pilot/super-agent.db` : clients, projets, tâches, décisions, jalons, résumés de session).",
    "Utilise uniquement tes outils de LECTURE (lecture de fichiers, `db_query` en SELECT).",
    "",
    "**2) Interdictions — pendant toute cette analyse :**",
    "- ne RIEN modifier, ne RIEN supprimer, ne rien renommer, ne rien déplacer ;",
    "- aucune écriture : pas de `db_execute`, aucun fichier créé, édité, renommé ou supprimé ;",
    "- tu ne fais que lire et rapporter : ce n'est pas un rangement, c'est une analyse.",
    "",
    "**3) Rends un rapport écrit dans cette conversation :**",
    "- ce que contiennent tes données : volumes, organisation, ce qui est bien rangé et ce qui l'est moins ;",
    "- doublons, incohérences, éléments orphelins, dossiers ou tables vides, noms ambigus ;",
    "- ce que tu n'as pas pu conclure (et pourquoi).",
    "",
    "**4) Présente ensuite une PROPOSITION DE RANGEMENT**, clairement séparée en trois parties :",
    "- **ce qui est sûr** : rangement évident, sans risque ;",
    "- **ce qui est discutable** : il y a un choix à faire ;",
    "- **ce qui doit être décidé par l'utilisateur** : ce que tu ne peux pas trancher seul.",
    "",
    "**5) Honnêteté :** si quelque chose n'a pas pu être examiné (outil indisponible, donnée illisible, dossier inaccessible), dis-le explicitement au lieu de le passer sous silence. N'invente aucun chiffre.",
    "",
    "Rappel final : tu ne modifies rien. Tu observes, tu rapportes et tu proposes — l'utilisateur décidera ensuite du rangement.",
  ].join("\n");
}

// Flag de suivi automatique du bas (ré-armé par le listener `scroll`). Module
// scope : une seule discussion assistant à la fois. Vrai par défaut (on suit
// le flux au démarrage) ; passe à false quand l'utilisateur remonte pour relire
// (issue #60) ; repasse à true dès qu'il redescend en bas (ré-armement).
let superAtBottom = true;

/** Scroll intelligent : ne force le bas que si le suivi automatique est actif
 * (flag `superAtBottom` ré-armé par le listener `scroll`). Contrairement à un
 * calcul ponctuel à chaque message, le flag persiste : même si le contenu
 * grandit de plus de `threshold` px d'un coup, le suivi continue tant que
 * l'utilisateur n'est pas remonté. */
function scrollSuperToBottom(messagesEl) {
  if (!messagesEl) return;
  if (superAtBottom) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

/** État global de l'assistant (nom, clients, prompt, options) — cache sync. */
let configCache = { name: "Assistant", clients: [], project_client: {}, prompt: "", show_thinking: true, show_tools: false, super_agent_quality_gate: true, super_agent_auto_check_startup: false };

// Issue #47 : délégation en attente de feedback. Quand l'assistant délègue une
// tâche à l'agent d'un projet (delegate_to_coder), on mémorise la demande.
// À l'agent_end du chat standard, le résumé injecté au super-agent inclut le
// contexte de délégation (demande + résultat) pour que l'assistant mette à jour
// son suivi et décide des prochaines étapes. Puis on vide le tracker.
//
// Issue #66 : file d'attente des délégations. Quand l'assistant délègue une
// nouvelle demande (delegate_to_coder) à un agent qui n'a pas fini sa tâche
// précédente, la demande était PERDUE (pi ne traite pas un 2ᵉ prompt pendant
// qu'il travaille — il l'ignore silencieusement). On met maintenant la demande
// en file et on la transmet à la fin de la tâche en cours (agent_end).
//
// VERROU PAR PROJET : ces trois états (`pending`, `busy`, `queue`) sont indexés
// par projet, comme le verrou de run des missions (`agents-bus.js`). Une
// délégation vers le projet B ne doit pas être mise en file derrière une
// délégation en cours sur le projet A, et la fin d'une tâche sur A ne doit pas
// être étiquetée avec la demande du projet B. Vidée sur agent_end (visible via
// injectSessionSummaryToSuperAgent, invisible via finalizeInvisibleAgent — les
// deux appellent flushDelegationQueue avec le projet concerné).
const delegationStates = new Map(); // clé projet (NORMALISÉE) → { busy, queue, pending }
export function delegationState(projectPath) {
  const key = projectKey(projectPath);
  let st = delegationStates.get(key);
  if (!st) {
    st = { busy: false, queue: [], pending: null };
    delegationStates.set(key, st);
  }
  return st;
}

// Anti-« compte rendu marqué transmis avant lecture » : les comptes rendus de
// run / délégation passent par une PORTE (module pur `super-agent-reports.js`).
// `inject_session_summary` (Rust) écrit TOUJOURS le compte rendu dans la table
// durable `session_summaries` (`delivered=0`) avant toute tentative d'injection :
// la porte confie donc TOUJOURS l'entrée à cette remise, même quand l'assistant
// est occupé. Dans ce cas elle transmet `defer: true` (flag front `backendBusy`,
// fiable car posé dès l'envoi utilisateur) : la ligne est écrite mais NON marquée
// livrée, car pi, en pleine génération, ignorerait le nouveau prompt → le rejeu
// Rust la délivre dès la libération. Plus aucune perte au redémarrage / à la
// fermeture de l'onglet (l'ancienne file en mémoire n'était pas durable).
// `sendSuperAgentReport` fait la remise réelle ; `replay` déclenche le rejeu.
const superAgentReportGate = createReportDeliveryGate({
  isBusy: () => backendBusy,
  send: (entry, opts) => sendSuperAgentReport(entry, opts),
  replay: () => invoke("replay_superagent_summaries"),
});

// P0-1 : état RÉEL du backend super-agent (busy / libre), maintenu par
// get_agent_supervision (poll) et les événements agent_start/agent_end. La garde
// d'envoi de `send()` s'appuie sur ce flag (et sur isStreaming) pour ne PAS
// accepter puis perdre une saisie envoyée à un backend occupé (l'état local
// isStreaming peut être en retard sur le backend réel).
let backendBusy = false;

// P0 (issue #84) : buffer borné des derniers `process_error` (stderr réel du
// processus super-agent), drainé au fil de l'eau. Utilisé par le message
// « Connexion au super-agent perdue » pour exposer la cause réelle (au lieu de
// la masquer) quand la session reste morte après la fenêtre de grâce. Taille
// bornée (jamais de stack complète).
const SUPER_AGENT_STDERR_MAX = 6000;
let superAgentStderrBuffer = "";

// P1-6 + T5 : suivi des run_agents lancés par l'assistant, INDEXÉ PAR PROJET.
// Deux runs vers des PROJETS DIFFÉRENTS ne se mettent PAS en file mutuellement
// (parallélisme par projet) ; seules les runs vers le MÊME projet sont mises en
// file quand l'une est déjà en cours. P1-5 : la finalisation (settleRun) est
// module-level et passée par inject_session_summary (Rust) → elle survit à la
// fermeture de l'onglet 🧭 (notification + injection du résultat).
let runAgentsInFlightByProject = {}; // project (clé normalisée) → true (run en cours)
export const runAgentsQueueByProject = {}; // project (clé normalisée) → [{ launch }]
// P1 — FENÊTRE DE COURSE DU REJEU (angle mort de la relecture indépendante).
// Une mission SORTIE de la file (`shift` de la tête) n'est pas encore une run
// INSCRITE au bus : pendant cet instant la file paraît VIDE et le bus paraît
// LIBRE. Une demande qui arrivait dans cette fenêtre ne voyait donc aucun
// occupant et DÉMARRAIT devant la mission rejouée (doublon d'ordre, exactement
// le défaut P1 par un autre chemin). La « réservation » ci-dessous est posée
// SYNCHRONEMENT au retrait de la tête (aucun `await` ne peut s'intercaler) et
// levée quand le lancement a été inscrit au bus — ou a échoué. Elle compte comme
// une mission DEVANT toute demande qui arrive, jamais devant la mission
// elle-même (`dequeue`), donc le rejeu ne se bloque pas lui-même.
let runAgentsMissionClaimByProject = {}; // project (clé) → [{ label, at }]
// Durée de vie MAXIMALE d'une réservation : une inscription au bus prend
// quelques secondes ; au-delà, la réservation est considérée périmée et n'est
// plus comptée (aucune attente fantôme possible).
const MISSION_CLAIM_MAX_MS = 60 * 1000;

// ── MISSION P3 : clés de projet NORMALISÉES des files/flags de l'assistant ──
// Une seule écriture par dossier : la clé EXISTANTE si le projet est déjà
// présent (quelle que soit son écriture), sinon la clé canonique.
// `missionQueueKey` est exportée pour les tests (et pour tout module qui doit
// LIRE la file) : la clé n'est PAS un chemin, elle ne sert qu'à indexer.
export function missionQueueKey(projectPath) {
  return projectScopedKey(runAgentsQueueByProject, projectPath || "");
}
function inFlightKey(projectPath) {
  return projectScopedKey(runAgentsInFlightByProject, projectPath || "");
}
function missionReplayKey(projectPath) {
  return projectScopedKey(runAgentsQueueReplayByProject, projectPath || "");
}
function watchdogKey(projectPath) {
  return projectScopedKey(runAgentsWatchdogByProject, projectPath || "");
}
function delegationReplayKey(projectPath) {
  return projectScopedKey(delegationQueueReplayByProject, projectPath || "");
}
// Filet de sécurité (watchdog) PAR PROJET : si une run ne se termine pas sous
// quelques minutes (ex: blocage du lancement, verrou graphe), on réinitialise
// le flag du projet et on vide sa file pour empêcher le blocage permanent des
// runs suivantes de CE projet. Timer module-level, annulé dans `settleRun`.
let runAgentsWatchdogByProject = {}; // project → timer id
// 15 min (et non 5) : ce watchdog ne relance ni n'arrête rien — il ne réinitialise
// un flag et ne vide la file que si la run est jugée MORTE. Sur un travail
// légitime long et SILENCIEUX (build, tests, installation, analyse), 5 min de
// silence n'étaient pas une preuve suffisante : la file d'attente du projet
// pouvait être vidée alors que l'agent produisait encore. Il revérifie à chaque
// tour et repousse l'échéance tant que la run progresse.
const RUN_AGENTS_WATCHDOG_MS = 15 * 60 * 1000; // 15 min

// ── Mission 385 : file d'attente VISIBLE du projet ─────────────────────────
// LECTURE seule et ABANDON de la file de missions, pour la file d'attente
// affichée dans l'onglet de l'agent et la commande `/file` (`/file vide`).
// Aucune logique de lancement n'est modifiée ici : ce sont des accesseurs.

/**
 * RÈGLE 4 — ALLOUE l'identité de mission d'un LANCEMENT d'agents
 * (`run_agents` / `run_assistant_agents`) : numéro monotone (`nextMissionId`)
 * + agents réellement visés.
 *
 * Point UNIQUE d'allocation : les deux branches de lancement l'appellent, puis
 * cette MÊME identité est (a) posée sur l'entrée de file par
 * `enqueueMissionForProject` (via `stampQueuedMission`) et (b) portée jusqu'au
 * compte rendu livré par `finishRunAgentsToSuperAgent`. Une identité n'est donc
 * jamais fabriquée par l'appelant : un test qui prouve la RÈGLE 4 peut la
 * relire sur l'entrée de file effectivement estampillée, jamais sur une
 * constante de fixture (sinon neutraliser l'identité en production resterait
 * invisible).
 * @param {Array<string>|null|undefined} agentIds - agents réellement visés
 * @returns {{id: number|null, agentIds: string[]}}
 */
export function allocateMissionIdentity(agentIds) {
  return makeMissionIdentity(nextMissionId(), agentIds);
}

/**
 * RÈGLE 4 — MISE EN FILE d'une mission : chemin de PRODUCTION UNIQUE.
 *
 * Les trois chemins d'empilement de l'assistant (`run_agents` via
 * `launchOrQueue`, `run_agents` via `startRun`, `run_assistant_agents`) passent
 * désormais par CETTE fonction : la demande est poussée, son libellé est posé,
 * puis son IDENTITÉ de mission est allouée par `stampQueuedMission` (numéro
 * monotone + agents visés, avec refus du double empilement). Un seul endroit à
 * vérifier, donc aucune branche ne peut oublier l'identité.
 *
 * Le libellé est posé APRÈS le `push` : les tests d'accusé de lancement (#87)
 * vérifient l'invariant « la ligne de mise en file ne contient que `launch` ».
 * @param {string} projectPath - projet ciblé (clé de file)
 * @param {Function} launch - lancement à exécuter quand le projet sera libre
 * @param {string} label - texte de la demande (affiché « en attente »)
 * @param {object} [identity] - identité préparée (`makeMissionIdentity`)
 * @returns {{entry:object, id:number|null, duplicate:boolean, count:number}}
 */
export function enqueueMissionForProject(projectPath, launch, label, identity) {
  const target = missionQueueKey(projectPath);
  if (!runAgentsQueueByProject[target]) runAgentsQueueByProject[target] = [];
  const queue = runAgentsQueueByProject[target];
  queue.push({ launch });
  queue.at(-1).label = label;
  const stamped = stampQueuedMission(queue, queue.at(-1), identity) || {};
  return {
    entry: queue.at(-1),
    id: typeof stamped.id === "number" ? stamped.id : null,
    duplicate: !!stamped.duplicate,
    count: queue.length,
  };
}

/**
 * REMET une mission à SON RANG (tête de file) — bug « la tâche mise en file
 * exécute une autre tâche que la sienne ».
 *
 * Une mission qui SORT de la file (`dequeue`) puis trouve le projet encore
 * occupé est remise en file par le chemin unique `enqueueMissionForProject`, qui
 * pousse toujours en QUEUE de file. Elle perdait donc son rang : les missions
 * arrivées DERRIÈRE elle passaient devant, et le créneau libéré finissait par
 * exécuter une AUTRE demande que celle dont c'était le tour. La remise en file
 * d'une mission rejouée doit donc la replacer en TÊTE (aucun changement pour
 * une demande qui arrive : elle s'empile normalement en queue).
 *
 * Idempotente et sans effet de bord : une entrée déjà en tête, absente de la
 * file (ou un projet sans file) n'est jamais déplacée et aucune file
 * n'est créée. L'ordre des autres missions est strictement préservé.
 * @param {string} projectPath - projet (clé de file)
 * @param {object} entry - entrée de file à replacer en tête
 * @returns {boolean} `true` si l'entrée est (ou était déjà) en tête
 */
export function restoreQueuedMissionRank(projectPath, entry) {
  const queue = runAgentsQueueByProject[missionQueueKey(projectPath)];
  if (!Array.isArray(queue) || !entry || typeof entry !== "object") return false;
  const at = queue.indexOf(entry);
  if (at < 0) return false;
  if (at === 0) return true;
  queue.splice(at, 1);
  queue.unshift(entry);
  return true;
}

/**
 * Missions de l'assistant en attente pour un projet, dans l'ordre de démarrage.
 * @param {string} projectPath
 * @returns {Array<{label:string}>}
 */
export function getProjectMissionQueue(projectPath) {
  return (runAgentsQueueByProject[missionQueueKey(projectPath)] || []).map((entry) => ({
    label: String((entry && entry.label) || "mission de l'assistant"),
    // RÈGLE 4 : identité de la mission (numéro monotone + agents visés), pour
    // que l'interface puisse NOMMER la demande en attente.
    id: entry && typeof entry.id === "number" ? entry.id : null,
    agentIds: Array.isArray(entry && entry.agentIds) ? entry.agentIds.slice() : [],
    // RÉSUMÉ COURT fourni avec la demande ("" s'il n'y en avait pas).
    resume: entry && typeof entry.resume === "string" ? entry.resume : "",
  }));
}

/**
 * P1 — ORDRE D'ARRIVÉE : nombre de missions DÉJÀ EN ATTENTE devant une demande.
 *
 * Défaut corrigé (D1 du rapport `rapport-file-attente-pertes-doublons.md`) : à
 * l'admission d'une demande, la file du projet n'était JAMAIS consultée — seul
 * le verrou de run décidait. Dès que ce verrou paraissait libre, la demande qui
 * arrivait démarrait DEVANT les missions déjà en attente (lancements directs
 * horodatés 08:45:07Z, 09:15:07Z, 09:21:05Z, 09:25:28Z).
 *
 * `dequeue` : le lancement qui SORT de la file (rejeu, `launchQueuedMission`) ne
 * se compte pas lui-même comme « devant » — sinon la mission rejouée se
 * remettrait en file derrière elle-même, indéfiniment.
 * @param {string} projectPath - projet (clé de file)
 * @param {{dequeue?:boolean}} [opts]
 * @returns {number} nombre de missions en attente devant cette demande
 */
export function pendingMissionsAhead(projectPath, opts = {}) {
  if (opts && opts.dequeue) return 0;
  const queued = (runAgentsQueueByProject[missionQueueKey(projectPath)] || []).length;
  // P1 (fenêtre de course du rejeu) : une mission sortie de la file dont la run
  // n'est pas encore inscrite au bus est TOUJOURS devant une demande qui arrive.
  return queued + pendingMissionClaims(projectPath).length;
}

/**
 * P1 — RÉSERVATIONS des missions SORTIES de la file mais pas encore inscrites au
 * bus (voir `runAgentsMissionClaimByProject`).
 *
 * Une réservation périmée (lancement qui ne s'est jamais conclu : promesse
 * perdue, backend figé) ne doit pas retenir indéfiniment les demandes ; la borne
 * reste large devant une inscription au bus (quelques secondes) et le rejeu,
 * lui, n'est jamais bloqué par une réservation.
 * @param {string} projectPath - projet (clé de file)
 * @param {number} [now] - horloge (injectée par les tests)
 * @returns {Array<{label:string, at:number}>} réservations encore valides
 */
export function pendingMissionClaims(projectPath, now = Date.now()) {
  const key = missionQueueKey(projectPath);
  const claims = runAgentsMissionClaimByProject[key] || [];
  if (claims.length === 0) return [];
  const live = claims.filter((c) => c && Number.isFinite(c.at) && now - c.at < MISSION_CLAIM_MAX_MS);
  if (live.length !== claims.length) {
    if (live.length > 0) runAgentsMissionClaimByProject[key] = live;
    else delete runAgentsMissionClaimByProject[key];
  }
  return live.map((c) => ({ label: c.label, at: c.at }));
}

/**
 * P1 — RÉSERVE le créneau pour une mission SORTIE de la file.
 *
 * Appelée par le point UNIQUE de lancement d'une mission en file
 * (`launchQueuedMission`), donc juste après le `shift` de l'appelant : aucun
 * `await` ne s'intercale entre le retrait de la tête et la réservation, la
 * fenêtre « file vide + bus libre » n'est donc jamais observable par une
 * demande qui arrive.
 * @param {string} projectPath - projet (clé de file)
 * @param {string} label - libellé de la mission (nommée dans la trace)
 * @param {number} [now] - horloge (injectée par les tests)
 * @returns {() => void} libération IDEMPOTENTE de la réservation
 */
export function claimDequeuedMission(projectPath, label, now = Date.now()) {
  const key = missionQueueKey(projectPath);
  const claim = { label: String(label == null ? "" : label) || "(mission de l'assistant)", at: now };
  if (!runAgentsMissionClaimByProject[key]) runAgentsMissionClaimByProject[key] = [];
  runAgentsMissionClaimByProject[key].push(claim);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const claims = runAgentsMissionClaimByProject[key] || [];
    const at = claims.indexOf(claim);
    if (at >= 0) claims.splice(at, 1);
    if (claims.length === 0) delete runAgentsMissionClaimByProject[key];
  };
}

/**
 * P1 — libellés des missions DÉJÀ devant une demande : file puis missions en
 * cours d'inscription au bus (réservations). Sert à NOMMER ce qui n'est pas
 * doublé, dans la trace comme à l'écran.
 * @param {string} projectPath - projet (clé de file)
 * @returns {string[]}
 */
export function pendingMissionAheadLabels(projectPath) {
  const labels = (runAgentsQueueByProject[missionQueueKey(projectPath)] || []).map((entry) => missionQueueLabel(entry));
  for (const claim of pendingMissionClaims(projectPath)) {
    labels.push(`${claim.label} (en cours de démarrage)`);
  }
  return labels;
}

/**
 * P1 — DÉCISION D'ADMISSION d'une demande d'agents (point UNIQUE).
 *
 * Les trois points d'entrée (`run_agents` via `launchOrQueue`, `run_agents` via
 * `startRun`, `run_assistant_agents`) décident par CETTE fonction, dans cet
 * ordre :
 *   1. des missions attendent déjà pour ce projet → la demande s'empile
 *      DERRIÈRE elles (`reason: "queue-ahead"`) : l'ordre d'arrivée est
 *      respecté, aucune mission en file n'est doublée ;
 *   2. le projet est réellement occupé → la demande s'empile
 *      (`reason: "busy"`, comportement historique) ;
 *   3. sinon → démarrage immédiat (`queue: false`).
 * @param {string} projectPath - projet (clé de file)
 * @param {{busy?:boolean, dequeue?:boolean}} [opts] - projet occupé / lancement
 *   issu du rejeu de la file
 * @returns {{queue:boolean, pending:number, reason:string}}
 */
export function decideMissionAdmission(projectPath, opts = {}) {
  const pending = pendingMissionsAhead(projectPath, opts);
  if (pending > 0) return { queue: true, pending, reason: "queue-ahead" };
  if (opts && opts.busy) return { queue: true, pending, reason: "busy" };
  return { queue: false, pending, reason: "" };
}

/**
 * P1 — TRACE de la décision « respecter l'ordre d'arrivée ».
 *
 * Un démarrage immédiat demandé alors qu'une mission attend est une décision
 * EXPLICITE et TRACÉE : elle ne démarre pas, et le motif est écrit dans le
 * journal des arrêts automatiques du projet (`<projet>/.pilot/agent-stops.log`,
 * repli global) par le point unique (`traceQueueAbandon`) — la demande arrivée
 * ne peut donc jamais écraser une mission en file sans laisser de trace.
 * @param {string} project - projet (clé de file)
 * @param {string[]} aheadLabels - missions DÉJÀ en attente (nommées)
 * @param {string} arrivingLabel - demande qui arrive (nommée)
 * @returns {Promise<void>|undefined}
 */
export function traceMissionQueuedBehindPending(project, aheadLabels, arrivingLabel) {
  console.warn(
    "[super-agent] admission FIFO :",
    `${(aheadLabels || []).length} mission(s) déjà en file — « ${String(arrivingLabel || "").slice(0, 80)} » est mise en file DERRIÈRE elles.`
  );
  return traceQueueAbandon({
    project,
    family: "mission",
    labels: aheadLabels,
    reason: "queue-order-respected",
    detected: "admission-fifo",
  });
}

/**
 * RÈGLE 4 — POINT UNIQUE d'écriture de la trace d'abandon d'une file.
 *
 * Une file vidée laisse TOUJOURS une ligne dans le journal des arrêts
 * automatiques (`<projet>/.pilot/agent-stops.log`, repli global pour un espace
 * réservé comme `__assistant__`) : motif nommé (`reason`), contexte d'abandon
 * (`detected`) et libellés des demandes réellement abandonnées — une ligne par
 * FAMILLE de file.
 *
 * C'est le SEUL endroit qui journalise un abandon de file : les quatre chemins
 * d'abandon (`abandonProjectMissionQueue`, `abandonQueuedRunAgentsMissions`,
 * `abandonProjectDelegationQueue`, `abandonQueuedDelegations`) y passent. Aucun
 * appelant ne peut donc oublier la trace (règle « une file ne se perd jamais
 * sans trace »), et aucune famille n'est journalisée deux fois.
 * @param {{project:string, family:string, labels:string[], reason?:string, detected?:string}} params
 * @returns {Promise<void>|undefined} promesse d'écriture (fire-and-forget pour
 *   les appels synchrones)
 */
function traceQueueAbandon({ project, family, labels, reason, detected }) {
  const list = (labels || []).map((label) => String(label || "")).filter(Boolean);
  if (list.length === 0) return undefined;
  // Un espace réservé (`__assistant__`) n'est pas un projet : le journal prend
  // alors son repli global (`<app_data_dir>/agent-stops.log`).
  const projectPath = project === ASSISTANT_SPACE ? "" : project || "";
  // Fail-open : un journal impossible à écrire ne bloque jamais un abandon (sa
  // trace d'échec est déjà dite par `agent-stop-trace`).
  return traceAutomaticAgentStop({
    reason: reason || "queue-abandoned",
    detected: detected || "queue-abandoned",
    agentId: "",
    projectPath,
    detail: `${list.length} ${family}(s) en file : ${list.join(" · ")}`.slice(0, 300),
  }).catch(() => {});
}

/**
 * Abandonne les missions de l'assistant en attente d'un projet (mission 385).
 * Le nombre abandonné est retourné (toujours annoncé à l'utilisateur).
 *
 * RÈGLE 4 : la trace est écrite ICI, pas par l'appelant. Un nouveau chemin
 * d'appel (chien de garde, arrêt, vue distante) ne peut donc pas perdre des
 * demandes en silence. L'écriture du journal suit en tâche de fond pour que la
 * fonction reste synchrone (le décompte est affiché immédiatement).
 * @param {string} projectPath
 * @param {{reason?:string, detected?:string}} [opts] - motif et contexte d'abandon
 * @returns {number} nombre de missions abandonnées
 */
export function abandonProjectMissionQueue(projectPath, opts = {}) {
  const target = missionQueueKey(projectPath);
  const queue = runAgentsQueueByProject[target];
  const removed = queue ? queue.length : 0;
  if (removed === 0) {
    delete runAgentsQueueByProject[target];
    return 0;
  }
  // Nommer AVANT de vider : c'est tout l'objet du correctif.
  const labels = queue.map((entry) => missionQueueLabel(entry));
  queue.length = 0;
  delete runAgentsQueueByProject[target];
  traceQueueAbandon({
    // La trace garde le chemin RÉEL (`projectPath`) : le journal vit DANS le
    // projet ; `target` n'est qu'une clé de file, jamais un chemin utilisable.
    project: projectPath || "",
    family: "mission",
    labels,
    reason: opts.reason,
    detected: opts.detected,
  });
  return removed;
}

/**
 * RETRAIT CIBLE d'UNE mission EN ATTENTE (et non vidage de la file).
 *
 * Defaut corrige : la file d'un projet ne savait oublier QU'EN ENTIER
 * (`abandonProjectMissionQueue`). Une demande perimee, devenue sans objet,
 * gardait sa place et prenait le verrou du projet a son tour (`reason=queue-
 * order-respected detected=admission-fifo` dans le journal des arrets), ce qui
 * bloquait le travail utile pendant des dizaines de minutes.
 *
 * Regles tenues :
 *   1. SEULE la mission designee disparait ; les autres restent en file et
 *      GARDENT leur ordre (aucun tri, aucun deplacement) ;
 *   2. la mission EN COURS ne se retire pas par ce chemin (elle n'est plus dans
 *      la file ; arreter un agent est un autre geste) ;
 *   3. le verrou du projet n'est NI pris NI relache ici : la place liberee est
 *      reprise par la suivante, le rejeu est rearme pour elle ;
 *   4. RÈGLE 4 : la ligne de journal est ecrite ICI (point unique
 *      `traceQueueAbandon`) avec le motif et le nom de la mission retiree.
 * @param {string} projectPath - projet ciblé (`__assistant__` : repli global)
 * @param {{id?:number, index?:number, label?:string, reason?:string, detected?:string}} opts
 *   `id` : numero de mission ; `index` : position dans la file (1 = tete) ;
 *   `label` : libelle exact (dernier recours)
 * @returns {{ok:boolean, removed:number, id:number|null, label:string, remaining:number, reason:string, message:string}}
 */
export function removeQueuedMission(projectPath, opts = {}) {
  const target = missionQueueKey(projectPath);
  const queue = runAgentsQueueByProject[target] || [];
  const remainingNow = () => (runAgentsQueueByProject[target] || []).length;
  const refuse = (reason, message) => ({
    ok: false,
    removed: 0,
    id: null,
    label: "",
    remaining: remainingNow(),
    reason,
    message,
  });

  const rawId = Number(opts && opts.id);
  const rawIndex = Number(opts && opts.index);
  const wantedLabel = typeof (opts && opts.label) === "string" ? opts.label.trim() : "";
  const hasId = Number.isFinite(rawId) && rawId > 0;
  const hasIndex = Number.isFinite(rawIndex) && rawIndex > 0;
  if (!hasId && !hasIndex && !wantedLabel) {
    return refuse(
      "no-selector",
      "Aucune mission designee : precisez le numero de mission ou le rang affiche par /file. Rien n'a ete retire.",
    );
  }
  if (queue.length === 0) {
    // Rien n'attend : la demande visee est donc en cours d'execution (elle
    // n'est plus dans la file) ou deja partie.
    return refuse(
      "empty",
      "Aucune mission en attente sur ce projet : rien n'a ete retire. Arreter une mission EN COURS d'execution est un autre geste.",
    );
  }

  let position = -1;
  if (hasId) position = queue.findIndex((entry) => entry && Number(entry.id) === Math.trunc(rawId));
  else if (hasIndex) position = Math.trunc(rawIndex) - 1;
  else position = queue.findIndex((entry) => missionQueueLabel(entry) === wantedLabel);
  if (position < 0 || position >= queue.length) {
    // Une mission sortie de la file (reservation posee, run en vol) n'est plus
    // « en attente » : on ne peut pas la retirer d'ici.
    const running =
      !!runAgentsInFlightByProject[inFlightKey(projectPath)] ||
      pendingMissionClaims(projectPath).length > 0;
    if (running) {
      return refuse(
        "mission-running",
        "Cette mission n'est plus en ATTENTE : elle demarre ou s'execute. Le retrait ne concerne que les missions en attente (arreter un agent est un autre geste). Rien n'a ete retire.",
      );
    }
    return refuse(
      "not-found",
      "Mission introuvable dans la file d'attente de ce projet (deja retiree ou deja demarree). Rien n'a ete retire.",
    );
  }

  // Retrait ATOMIQUE d'une seule entree : les suivantes gardent leur ordre.
  const [entry] = queue.splice(position, 1);
  const left = queue.length;
  if (left === 0) delete runAgentsQueueByProject[target];

  const label = missionQueueLabel(entry);
  const numericId = entry && Number.isFinite(Number(entry.id)) ? Math.trunc(Number(entry.id)) : null;

  // RÈGLE 4 : la trace est ecrite ICI (meme journal que les abandons, motif
  // distinct) — le retrait ne peut donc pas passer inapercu.
  traceQueueAbandon({
    project: projectPath || "",
    family: "mission",
    labels: [label],
    reason: (opts && opts.reason) || "queue-mission-removed",
    detected: (opts && opts.detected) || "remove-one",
  });

  // AGENT JETABLE : les agents ephemeres de la mission retiree n'auront jamais
  // de tache — ils sont purges avec elle (les lignes du registre des agents ne
  // sont jamais touchees : `disposeEphemeralAgents` ignore les identifiants
  // persistants).
  const ephemeralIds = [];
  for (const aid of entry && Array.isArray(entry.agentIds) ? entry.agentIds : []) {
    if (isEphemeralAgentId(aid)) ephemeralIds.push(aid);
  }
  if (ephemeralIds.length > 0) {
    disposeEphemeralAgents(ephemeralIds, projectPath || null).catch(() => {});
  }

  // Liberte rendue a la file : le verrou du projet n'est ni pris ni relache ici
  // (la place n'est pas « liberee » au sens du verrou, elle est simplement
  // rendue disponible) ; le rejeu est rearme pour que la suivante demarre des
  // que le projet est reellement libre. File vide : rien a rejouer.
  if (left > 0) armQueueReplay(projectPath);

  const message =
    left > 0
      ? `Mission retiree de la file d'attente : ${label}. Il reste ${left} demande(s) en attente, dans leur ordre ; la suivante demarrera des que le projet sera libre.`
      : `Mission retiree de la file d'attente : ${label}. La file ne contient plus aucune demande en attente (la tache en cours, s'il y en a une, continue).`;
  return { ok: true, removed: 1, id: numericId, label, remaining: left, reason: "", message };
}

/**
 * RÈGLE 4 — ABANDON EXPLICITE et TRACÉ d'une file de missions.
 *
 * Le watchdog de run vidait la file par `runAgentsQueueByProject[target].length
 * = 0` : les demandes encore en attente disparaissaient SANS laisser ni motif
 * ni nom. Elles étaient donc perdues en silence (l'utilisateur et l'assistant ne
 * savaient pas lesquelles, ni pourquoi). Cette fonction est le SEUL chemin
 * d'abandon automatique d'une file de missions : elle nomme chaque demande
 * abandonnée (mission #N « texte »), écrit le motif dans le journal des arrêts
 * automatiques du projet (`<projet>/.pilot/agent-stops.log`, repli global) et
 * le rend VISIBLE (console + notification).
 * @param {string} target - projet (clé de file)
 * @param {{reason?:string, detected?:string}} [opts]
 * @returns {Promise<{count:number, labels:string[]}>}
 */
export async function abandonQueuedRunAgentsMissions(target, opts = {}) {
  const key = missionQueueKey(target);
  const queue = runAgentsQueueByProject[key] || [];
  const count = queue.length;
  if (count === 0) {
    delete runAgentsQueueByProject[key];
    return { count: 0, labels: [] };
  }
  // Nommer AVANT de vider : c'est tout l'objet du correctif.
  const labels = queue.map((entry) => missionQueueLabel(entry));
  // AGENT JETABLE : les agents éphémères des missions abandonnées n'auront jamais
  // de tâche — ils sont purgés avec elles (les entrées du registre, elles, ne
  // sont jamais touchées : `disposeEphemeralAgents` ignore les identifiants
  // persistants). Collecté AVANT `queue.length = 0`.
  const abandonedEphemeralIds = [];
  for (const entry of queue) {
    if (entry && Array.isArray(entry.agentIds)) {
      for (const aid of entry.agentIds) {
        if (isEphemeralAgentId(aid)) abandonedEphemeralIds.push(aid);
      }
    }
  }
  // Le rejeu périodique n'a plus rien à rejouer.
  const replay = runAgentsQueueReplayByProject[key];
  if (replay) {
    clearTimeout(replay);
    delete runAgentsQueueReplayByProject[key];
  }
  queue.length = 0;
  delete runAgentsQueueByProject[key];
  const reason = opts.reason || "queue-abandoned";
  // AGENT JETABLE : purge des définitions éphémères des missions abandonnées.
  if (abandonedEphemeralIds.length > 0) {
    await disposeEphemeralAgents(abandonedEphemeralIds, target || null).catch(() => {});
  }
  // Trace écrite par le point UNIQUE d'abandon de file (règle 4).
  await traceQueueAbandon({
    // Chemin RÉEL pour le journal (le journal vit DANS le projet), la clé
    // `key` n'étant qu'un index de file.
    project: target || "",
    family: "mission",
    labels,
    reason,
    detected: opts.detected || "watchdog",
  });
  const message = `⚠️ ${count} demande(s) en file d'attente abandonnée(s) : ${labels.join(" · ")}. Le motif est consigné (${reason}).`;
  console.warn("[super-agent] file de missions :", message);
  try {
    // Refonte des messages Telegram : ALERTE d'UNE ligne — nom court du PROJET
    // en tête, ce qui bloque et la décision attendue. Aucun numéro de mission,
    // aucun motif interne, aucun libellé de file (ils restent dans la console).
    await notifySuperAgentDone({
      title: "Pilot — Assistant",
      body: message,
      project: target || "",
      ok: false,
      type: "alert",
      problem: "des demandes en attente ont été abandonnées",
      decision: "relancer les demandes si elles sont toujours utiles",
    });
  } catch (_) {
    /* notification indisponible : la console porte déjà l'information */
  }
  return { count, labels };
}

/**
 * P2 — CONSERVATION (puis rejeu) d'une file de missions non vide à l'arrêt d'un
 * agent.
 *
 * Défaut corrigé (D2 du rapport `rapport-file-attente-pertes-doublons.md`) :
 * l'arrêt d'un agent concluait « le projet est libre » sur la seule foi du verrou
 * de run (`isRunInProgress`), qui ne lit que les contextes du BUS d'agents. Un
 * verrou périmé, une relance `stale-session-restart` ou un agent parqué
 * suffisaient à le faire mentir : la file était alors VIDÉE
 * (`abandonQueuedRunAgentsMissions`) et les missions en attente étaient
 * définitivement perdues alors que des sessions étaient encore VIVANTES (trace
 * `2026-10-20T09:25:10.347Z` : mission #14 détruite par `queue-abandoned`, session
 * `codeur` n°13 arrêtée 17 s plus tard).
 *
 * Comportement par DÉFAUT désormais : la file est CONSERVÉE telle quelle (aucun
 * `shift`, aucun `length = 0`), chaque mission est NOMMÉE dans le journal des
 * arrêts (`queue-kept`) et à l'écran, et le rejeu périodique est ARMÉ. Ce rejeu
 * ne lance la tête de file qu'une fois l'admission RÉELLEMENT libre — jugée sur
 * l'ACTIVITÉ des agents (`isRunStillActive`, la même sonde que le rejeu, sonde
 * LÉGÈRE sans liste de sessions), jamais sur un verrou.
 * @param {string} target - projet (clé de file)
 * @param {{reason?:string, detected?:string}} [opts]
 * @returns {Promise<{count:number, labels:string[], replayArmed:boolean}>}
 */
export async function keepQueuedRunAgentsMissions(target, opts = {}) {
  const key = missionQueueKey(target);
  const queue = runAgentsQueueByProject[key] || [];
  const count = queue.length;
  if (count === 0) return { count: 0, labels: [], replayArmed: false };
  // Nommer les missions CONSERVÉES : la trace doit dire lesquelles survivent.
  const labels = queue.map((entry) => missionQueueLabel(entry));
  const reason = opts.reason || "queue-kept";
  await traceQueueAbandon({
    project: target || "",
    family: "mission",
    labels,
    reason,
    detected: opts.detected || "stop-agent",
  });
  // La file reste EN PLACE, dans son ordre : le rejeu la reprendra. Le
  // déclencheur est armé pour garantir ce rejeu même quand aucune fin de run du
  // bus ne viendra le réveiller (arrêt manuel, commande manuelle, agent parqué).
  armQueueReplay(key);
  const message = `📋 ${count} mission(s) conservée(s) en file d'attente : ${labels.join(" · ")}. Elles seront rejouées dès que le projet est libre (motif consigné : ${reason}).`;
  console.warn("[super-agent] file de missions :", message);
  try {
    // Refonte des messages Telegram : les missions sont CONSERVÉES et rejouées
    // automatiquement — aucune information décisive, aucune action attendue du
    // propriétaire. Filtré À LA SOURCE : rien ne part sur Telegram (`telegram:
    // false`). L'information reste dans la console et dans la trace disque.
    await notifySuperAgentDone({ title: "Pilot — Assistant", body: message, telegram: false });
  } catch (_) {
    /* notification indisponible : la console porte déjà l'information */
  }
  return { count, labels, replayArmed: true };
}

/**
 * Délégations (issue #66) en attente pour un projet, dans l'ordre.
 *
 * `agentId` est l'agent RÉELLEMENT visé, résolu et enregistré avec la demande
 * avant sa mise en file : la file visible du projet peut donc dire quel agent
 * traitera la délégation (aucun nom déduit, aucune supposition).
 * @param {string} projectPath
 * @returns {Array<{label:string, agentId:string}>}
 */
export function getProjectDelegationQueue(projectPath) {
  const queue = (delegationState(projectPath).queue || []);
  return queue.map((item) => ({
    label: String((item && item.request) || "délégation"),
    agentId: String((item && item.agentId) || ""),
  }));
}

/**
 * Abandonne les délégations en attente d'un projet (mission 385).
 *
 * RÈGLE 4 : la trace est écrite ICI, pas par l'appelant (même garantie que pour
 * les missions). L'écriture du journal suit en tâche de fond pour que la
 * fonction reste synchrone.
 * @param {string} projectPath
 * @param {{reason?:string, detected?:string}} [opts] - motif et contexte d'abandon
 * @returns {number} nombre de délégations abandonnées
 */
export function abandonProjectDelegationQueue(projectPath, opts = {}) {
  const target = projectPath || "";
  const ds = delegationState(target);
  const queue = ds.queue || [];
  const removed = queue.length;
  if (removed === 0) return 0;
  // Nommer AVANT de vider : c'est tout l'objet du correctif.
  const labels = queue.map((item) => String((item && item.request) || "délégation").slice(0, 120));
  queue.length = 0;
  traceQueueAbandon({
    project: target,
    family: "délégation",
    labels,
    reason: opts.reason,
    detected: opts.detected,
  });
  return removed;
}

/**
 * RÈGLE 4 — ABANDON EXPLICITE et TRACÉ d'une file de DÉLÉGATIONS.
 *
 * L'arrêt explicite d'un agent (`stop_agent`) vidait la file de délégations par
 * `delegationState(projectPath).queue.length = 0` : les demandes encore en
 * attente disparaissaient sans nom, sans motif et sans que l'utilisateur (ni
 * l'assistant) sache lesquelles. Cette fonction est le SEUL chemin d'abandon
 * d'une file de délégations : elle NOMME chaque demande, écrit le motif dans le
 * journal des arrêts automatiques (`<projet>/.pilot/agent-stops.log`, repli
 * global) et le rend visible (console + notification).
 * @param {string} projectPath - projet des délégations
 * @param {{reason?:string, detected?:string}} [opts]
 * @returns {Promise<{count:number, labels:string[]}>}
 */
export async function abandonQueuedDelegations(projectPath, opts = {}) {
  const target = projectPath || "";
  const ds = delegationState(target);
  const queue = ds.queue || [];
  const count = queue.length;
  if (count === 0) return { count: 0, labels: [] };
  // Nommer AVANT de vider : c'est tout l'objet du correctif.
  const labels = queue.map((item) => String((item && item.request) || "délégation").slice(0, 120));
  queue.length = 0;
  const reason = opts.reason || "queue-abandoned";
  // Trace écrite par le point UNIQUE d'abandon de file (règle 4).
  await traceQueueAbandon({
    project: target,
    family: "délégation",
    labels,
    reason,
    detected: opts.detected || "stop-agent",
  });
  const message = `⚠️ ${count} délégation(s) en file d'attente abandonnée(s) : ${labels.join(" · ")}. Le motif est consigné (${reason}).`;
  console.warn("[super-agent] file de délégations :", message);
  try {
    // Refonte des messages Telegram : ALERTE d'UNE ligne, projet en tête.
    await notifySuperAgentDone({
      title: "Pilot — Assistant",
      body: message,
      project: target || "",
      ok: false,
      type: "alert",
      problem: "des demandes en attente ont été abandonnées",
      decision: "relancer la demande si elle est toujours utile",
    });
  } catch (_) {
    /* notification indisponible : la console porte déjà l'information */
  }
  return { count, labels };
}

// POINT G : déclencheur de rejeu GARANTI de la file de missions.
// Une mission peut être mise en file derrière : une run du bus, une commande
// MANUELLE (le bus ne la voit pas), un prompt distant, ou une run d'assistant.
// Or seule la fin d'une run du bus (`settleRun`) rejouait la file : une mission
// mise en file derrière une commande manuelle pouvait rester bloquée POUR
// TOUJOURS, alors que le message promettait « elle démarrera automatiquement à
// la fin de la tâche en cours ». On sonde donc périodiquement l'admission
// RÉELLE du projet — même sonde consciente de l'activité que le watchdog
// (`isRunStillActive` : verrou du bus OU travail réel en cours) — et on lance la
// tête de file dès que le projet est libre. Map DÉDIÉE (pour ne pas écraser le
// watchdog de run du même projet, qui peut coexister) et indexée PAR PROJET :
// un projet libre n'attend jamais un autre projet.
let runAgentsQueueReplayByProject = {}; // project → timer id
// ponytail: sondage périodique (latence max 15 s après la libération du projet)
// plutôt qu'un réveil événementiel sur chaque fin d'occupation — la sonde
// d'admission est déjà réutilisée telle quelle. Passer à un réveil direct si
// l'attente devient perceptible.
const RUN_AGENTS_QUEUE_REPLAY_MS = 15 * 1000;

// Faux positifs du garde-fou de run : la sonde d'admission du rejeu de file
// (cadencée à 15 s) appelait `releaseStuckRunLock` sans condition de durée, ce
// qui libérait une run qui venait de démarrer (agent pas encore enregistré côté
// Rust) ou qui travaillait en silence (réflexion, lecture d'un gros fichier,
// série de tests) — travail perdu. Un observateur PÉRIODIQUE n'a pas à couper si
// vite : on exige une inactivité d'au moins 2 min (alignée sur la fenêtre
// d'activité « récente » du moteur) avant toute libération par une porte ambiguë
// (agents déclarés actifs mais silencieux, travail en file sans porteur).
// La protection réelle (verrou fantôme, agent mort, réservation abandonnée)
// reste assurée au-delà de ce délai.
const RUN_AGENTS_QUEUE_REPLAY_MIN_STUCK_IDLE_MS = 2 * 60 * 1000;

/**
 * Filet de sécurité CONSCIENT DE L'ACTIVITÉ (watchdog run_agents) : détermine
 * si une run d'agents de l'assistant est encore réellement active sur le projet
 * donné, pour ne JAMAIS couper une tâche légitime longue qui progresse encore.
 *   - Source de vérité du verrou : si le bus d'agents exécute encore une run
 *     sur ce projet (`isRunInProgress(runProject)`), l'agent travaille → actif.
 *   - Sinon, on sonde l'ACTIVITÉ (`agent_activity_probe`, sonde LÉGÈRE) : la run
 *     est considérée active uniquement si un agent du projet cible TRAVAILLE
 *     RÉELLEMENT (`isProjectWorking` : busy non périmé, outil en cours, ou
 *     activité récente). Un processus simplement VIVANT mais au repos (agent
 *     settled, busy périmé) ne compte PAS : sinon le verrou de run ne se libère
 *     jamais et les demandes suivantes restent en file (faux « lancé »).
 *   - Fail-open : en cas d'erreur de supervision, on renvoie `true` (actif) —
 *     une erreur de supervision ne doit JAMAIS couper une run saine.
 *
 * ⚠️ INTERDIT : `list_agent_sessions` ici. Cette fonction est le SEUL point de
 * sonde des deux rejeux PÉRIODIQUES (file de missions et file de délégations,
 * cadencés à 15 s). `list_agent_sessions` envoie un `get_state` SYNCHRONE à
 * chaque session vivante (timeout 2 s) et lit la table `agents` : appelée en
 * boucle, elle gèle la file de travail du projet (défaut constaté : 25-30 min
 * de blocage). `agent_activity_probe` donne la même information utile (qui
 * TRAVAILLE ?) sans base et sans RPC. Verrouillé par
 * `sonde-rejeu-sans-liste-sessions.test.js`.
 * @param {string} [runProject]
 * @returns {Promise<boolean>}
 */
async function isRunStillActive(runProject) {
  // Verrou « running » FANTÔME (aucun agent ne travaille) : la sonde bloquerait
  // POUR TOUJOURS. Le rejeu de la file de missions et celui de la file de
  // délégations sondent l'admission AVANT de lancer, donc sans jamais appeler
  // `releaseStuckRunLock` : une mission acceptée (« mise en file ») ne démarrait
  // jamais et RIEN ne disait pourquoi. Les chemins de LANCEMENT libèrent d'abord
  // ce verrou (`launchOrQueue`, `startRun`, watchdog) : on applique le même
  // ordre ici, au seul point de sonde partagé par les deux files. Idempotent :
  // ne libère qu'un verrou réellement inactif.
  await releaseStuckRunLock(runProject, { requireIdleMs: RUN_AGENTS_QUEUE_REPLAY_MIN_STUCK_IDLE_MS });
  if (isRunInProgress(runProject)) return true;
  try {
    // SONDE LÉGÈRE (consigne absolue du propriétaire) : la LISTE DES SESSIONS
    // est INTERDITE dans un cadencement — voir l'avertissement de la docstring.
    // `agent_activity_probe` renvoie la même projection utile au décideur
    // (`project`, `alive`, `busy`, `toolInProgress`, `lastActivity`), lue en
    // mémoire, sans accès base ni `get_state` RPC.
    const res = await invoke("agent_activity_probe");
    const sessions = (res && res.sessions) || [];
    return isProjectWorking(sessions, runProject);
  } catch (_) {
    return true; // fail-open : ne jamais couper une run saine par erreur
  }
}

/**
 * POINT G — contrôle de rejeu de la file de missions d'un projet (UNE passe).
 * Lance la tête de file si — et seulement si — l'admission du projet est libre
 * (bus sans run ET aucun agent du projet ne travaille réellement). Ne mute rien
 * si la file est vide ou le projet occupé : l'appelant réarme alors le
 * déclencheur. Extrait pour être testé de façon déterministe (injection de la
 * sonde d'admission).
 * @param {string} target - projet (clé de file)
 * @param {{isAdmissionFree?: (target: string) => Promise<boolean>}} [deps]
 * @returns {Promise<{replayed: boolean, reason: string}>}
 */
export async function replayQueuedMissionForProject(target, deps = {}) {
  if (!target) return { replayed: false, reason: "no_target" };
  const queue = runAgentsQueueByProject[missionQueueKey(target)] || [];
  if (queue.length === 0) return { replayed: false, reason: "empty" };
  // (la clé de file est résolue par `missionQueueKey` : une seule file par dossier)
  // TERRAIN RÉSERVÉ (vérification/installation du moteur `pi`, ou mise à jour de
  // Pilot) : le terrain n'est PAS libre — la mission RESTE en file (jamais
  // perdue, jamais lancée) et repart d'elle-même quand il est rendu.
  const isFree = deps.isAdmissionFree || (async (p) => !isTerrainReserved() && !(await isRunStillActive(p)));
  let free;
  try {
    free = await isFree(target);
  } catch (_) {
    free = false; // fail-closed : on réessaie, la mission en file reste en file
  }
  if (!free) return { replayed: false, reason: "busy" };
  const next = queue.shift();
  if (!next) {
    deleteProjectScoped(runAgentsQueueByProject, target);
    return { replayed: false, reason: "empty" };
  }
  // Volet (c) : lancement PROTÉGÉ (voir `launchQueuedMission`) — un échec du
  // lancement ne perd ni la mission ni le verrou local du projet.
  launchQueuedMission(target, next);
  return { replayed: true, reason: "launched" };
}

/**
 * POINT G — arme (une seule fois) le déclencheur de rejeu périodique du projet.
 * Tant que la file n'est pas vide, le contrôle se réarme : une mission mise en
 * file a donc TOUJOURS un déclencheur de rejeu, quelle que soit la raison du
 * blocage. Une passe sur file vide est un no-op (rien à rejouer).
 * @param {string} target
 */
export function armQueueReplay(target) {
  const key = missionReplayKey(target);
  if (!target || runAgentsQueueReplayByProject[key]) return;
  runAgentsQueueReplayByProject[key] = setTimeout(async () => {
    delete runAgentsQueueReplayByProject[key];
    await replayQueuedMissionForProject(target);
    // Une passe réussie ne retire QU'UNE mission de la file : on se réarme dès
    // qu'il en RESTE, succès ou échec — sinon la 2ᵉ mission perdrait tout
    // déclencheur (R1, relecture indépendante).
    if ((runAgentsQueueByProject[missionQueueKey(target)] || []).length > 0) {
      armQueueReplay(target); // encore des missions en file : on reste prêt
    }
  }, RUN_AGENTS_QUEUE_REPLAY_MS);
}

/**
 * Point de suivi 344 (volet c) — LANCEMENT PROTÉGÉ de la mission qui sort de la
 * file d'attente.
 *
 * Défaut corrigé : la tête de file était lancée directement, sans protection,
 * alors que le flag « run en vol » du projet (`runAgentsInFlightByProject`) est
 * posé AVANT l'appel. Si le lancement échouait — promesse rejetée (préparation
 * de run impossible) ou exception synchrone — la mission avait DÉJÀ été retirée
 * de la file (`shift`) : elle était perdue en silence ET le projet restait
 * marqué « run en vol », si bien que toutes les missions suivantes de ce projet
 * étaient mises en file jusqu'au watchdog (attente fantôme). L'appel
 * est désormais protégé : en cas d'échec, la mission est remise EN TÊTE de file
 * (jamais perdue), le projet est libéré et le rejeu périodique est réarmé.
 * @param {string} target - projet (clé de file)
 * @param {{launch: function(): (Promise<unknown>|unknown)}} entry - mission en file (sortie de file par l'appelant)
 * @returns {void}
 */
function launchQueuedMission(target, entry) {
  if (!target || !entry) return;
  // TERRAIN RÉSERVÉ : une mission SORTIE de la file ne démarre pas tant que le
  // terrain est occupé (vérification/installation du moteur `pi`, ou mise à jour
  // de Pilot). Elle est remise EN TÊTE — aucune perte, ordre d'arrivée conservé —
  // et le rejeu la reprend dès que la place est rendue. Ce garde est placé DANS
  // le point de passage unique : il couvre donc aussi les lancements directs
  // déclenchés par la fin d'une run, pas seulement le rejeu périodique.
  if (isTerrainReserved()) {
    const blockedKey = missionQueueKey(target);
    if (!runAgentsQueueByProject[blockedKey]) runAgentsQueueByProject[blockedKey] = [];
    if (!runAgentsQueueByProject[blockedKey].includes(entry)) {
      runAgentsQueueByProject[blockedKey].unshift(entry);
    }
    armQueueReplay(target);
    return;
  }
  // MISE À JOUR DE PILOT : aucune priorité d'affichage n'est plus accordée. La
  // mise à jour s'affiche sans occuper le terrain, elle ne retarde donc jamais
  // la mission suivante (l'ancien garde d'attente retardait le lancement de
  // plusieurs secondes pour laisser la place à un écran qui bloquait tout).
  // P1 — FENÊTRE DE COURSE : la mission vient d'être retirée de la file par
  // l'appelant (`shift`) et n'est pas encore inscrite au bus. La réservation est
  // posée ICI, synchronement (aucun `await` entre le shift et elle) : une
  // demande qui arrive pendant l'inscription voit un occupant et s'empile
  // DERRIÈRE, au lieu de démarrer devant la mission rejouée. Elle est levée dès
  // que le lancement est conclu (inscrit au bus, ou en échec et remis en file).
  const releaseClaim = claimDequeuedMission(target, missionQueueLabel(entry));
  runAgentsInFlightByProject[inFlightKey(target)] = true;
  const onFailure = (err) => {
    console.warn("[super-agent] lancement d'une mission en file en échec :", err);
    // Le projet ne doit pas rester marqué « run en vol » (attente fantôme pour
    // toutes les missions suivantes) ; la libération est immédiate.
    runAgentsInFlightByProject[inFlightKey(target)] = false;
    // La mission, déjà retirée de la file par le `shift` de l'appelant, y
    // retourne EN TÊTE : un lancement en échec n'a rien démarré, aucun doublon
    // possible (`includes` protège d'une remise en file déjà faite).
    const queueKey = missionQueueKey(target);
    if (!runAgentsQueueByProject[queueKey]) runAgentsQueueByProject[queueKey] = [];
    if (!runAgentsQueueByProject[queueKey].includes(entry)) runAgentsQueueByProject[queueKey].unshift(entry);
    // Le rejeu périodique reprend la mission dès que le projet est libre.
    armQueueReplay(target);
    // Réservation levée APRÈS la remise en file : la file porte alors la
    // mission, donc aucune fenêtre vide ne s'ouvre entre les deux.
    releaseClaim();
  };
  let result;
  try {
    // P1 : la mission qui SORT de la file est lancée en tant que telle
    // (`dequeue`) — elle ne se compte donc pas comme « une mission devant » et
    // ne se remet jamais derrière elle-même.
    result = entry.launch({ dequeue: true });
  } catch (e) {
    onFailure(e);
    return;
  }
  if (result && typeof result.then === "function") {
    // Réservation levée quand le lancement est CONCLU (run inscrite au bus, ou
    // échec traité ci-dessus) — jamais avant, sinon la fenêtre se rouvrirait.
    result.then(() => releaseClaim(), onFailure);
  } else {
    releaseClaim();
  }
}

// Point de suivi 344 (volet c) — points d'entrée de TEST (jamais utilisés en
// production) : état observable de la file de missions d'un projet et remise à
// zéro des timers/file, pour prouver la libération du verrou local, de la file
// et du statut après une interruption.
/** @param {string} target @returns {{inFlight:boolean,queueLength:number,replayArmed:boolean,watchdogArmed:boolean,claims:number}} */
export function __superAgentQueueStateForTest(target) {
  return {
    inFlight: !!runAgentsInFlightByProject[inFlightKey(target)],
    queueLength: (runAgentsQueueByProject[missionQueueKey(target)] || []).length,
    replayArmed: !!runAgentsQueueReplayByProject[missionReplayKey(target)],
    watchdogArmed: !!runAgentsWatchdogByProject[watchdogKey(target)],
    // P1 (fenêtre de course du rejeu) : missions sorties de la file et pas encore
    // inscrites au bus — elles comptent comme « devant » les demandes qui arrivent.
    claims: pendingMissionClaims(target).length,
  };
}

/** Remet à zéro file, flag et timers de la file de missions (tests uniquement). */
export function __resetSuperAgentQueueForTest() {
  for (const t of Object.keys(runAgentsQueueReplayByProject)) {
    clearTimeout(runAgentsQueueReplayByProject[missionReplayKey(t)]);
    delete runAgentsQueueReplayByProject[missionReplayKey(t)];
  }
  for (const t of Object.keys(delegationQueueReplayByProject)) {
    clearTimeout(delegationQueueReplayByProject[delegationReplayKey(t)]);
    delete delegationQueueReplayByProject[delegationReplayKey(t)];
  }
  for (const t of Object.keys(runAgentsWatchdogByProject)) {
    clearTimeout(runAgentsWatchdogByProject[watchdogKey(t)]);
    delete runAgentsWatchdogByProject[watchdogKey(t)];
  }
  for (const t of Object.keys(runAgentsQueueByProject)) delete runAgentsQueueByProject[missionQueueKey(t)];
  for (const t of Object.keys(runAgentsInFlightByProject)) delete runAgentsInFlightByProject[inFlightKey(t)];
  for (const t of Object.keys(runAgentsMissionClaimByProject)) delete runAgentsMissionClaimByProject[missionQueueKey(t)];
}

// POINT C (file de DÉLÉGATIONS, issue #66) — déclencheur de rejeu explicite,
// même modèle que la file de missions (`replayQueuedMissionForProject`) :
// sonde RÉELLE de l'activité de l'agent cible, fail-closed, la demande n'est
// jamais perdue. La file n'était vidée qu'à l'`agent_end` de l'agent cible :
// une demande mise en file derrière un prompt DISTANT (session principale, dont
// l'`agent_end` n'atteint pas le suivi de l'assistant) restait coincée en
// silence. Le chemin distant (`web_server.rs` → `do_send_agent_prompt`) ne
// court-circuite pas ce rejeu : il n'écrit pas dans la file, c'est cette sonde
// périodique qui la relance dès que l'agent est réellement libre.
let delegationQueueReplayByProject = {}; // project → timer id
// ponytail: sonde périodique (latence max 15 s) plutôt qu'un réveil événementiel
// sur chaque fin d'occupation — même pas que la file de missions, sonde réutilisée.
const DELEGATION_QUEUE_REPLAY_MS = 15 * 1000;

/**
 * POINT C — contrôle de rejeu de la file de DÉLÉGATIONS d'un projet (UNE passe).
 * Transmet la tête de file si — et seulement si — l'agent cible ne travaille
 * réellement plus (sonde d'activité, pas l'état local `ds.busy` qui peut être
 * périmé par une fin de tâche non reçue). Fail-closed : sonde en échec → la
 * demande reste en file, jamais perdue. Extrait pour être testé de façon
 * déterministe (injection de la sonde et du vidage).
 * @param {string} projectPath
 * @param {{isAgentFree?: (p: string) => Promise<boolean>, flush?: (p: string) => void}} [deps]
 * @returns {Promise<{replayed: boolean, reason: string}>}
 */
export async function replayDelegationQueueForProject(projectPath, deps = {}) {
  if (!projectPath) return { replayed: false, reason: "no_target" };
  const ds = delegationState(projectPath);
  if (ds.queue.length === 0) return { replayed: false, reason: "empty" };
  const isFree = deps.isAgentFree || (async (p) => !isTerrainReserved() && !(await isRunStillActive(p)));
  let free;
  try {
    free = await isFree(projectPath);
  } catch (_) {
    free = false; // fail-closed : on réessaie, la demande reste en file
  }
  if (!free) return { replayed: false, reason: "busy" };
  (deps.flush || flushDelegationQueue)(projectPath);
  return { replayed: true, reason: "flushed" };
}

/**
 * POINT C — arme (une seule fois) le déclencheur de rejeu périodique de la file
 * de délégations d'un projet. Tant que la file n'est pas vide, le contrôle se
 * réarme : une demande mise en file a donc TOUJOURS un déclencheur de rejeu,
 * quelle que soit la raison du blocage. Une passe sur file vide est un no-op.
 * @param {string} projectPath
 */
export function armDelegationQueueReplay(projectPath) {
  const key = delegationReplayKey(projectPath);
  if (!projectPath || delegationQueueReplayByProject[key]) return;
  delegationQueueReplayByProject[key] = setTimeout(async () => {
    delete delegationQueueReplayByProject[key];
    await replayDelegationQueueForProject(projectPath);
    // Même règle que la file de missions (R1) : on se réarme dès qu'il RESTE
    // des demandes, succès ou échec (une passe réussie n'en retire qu'une).
    if (delegationState(projectPath).queue.length > 0) {
      armDelegationQueueReplay(projectPath); // encore des demandes : on reste prêt
    }
  }, DELEGATION_QUEUE_REPLAY_MS);
}

// A19 : synthèse vocale (Web Speech API) — lit la dernière réponse de
// l'assistant quand le mode « Assistant Only » immersif est actif et que le
// toggle « synthèse » est activé. Module-scope car handleSuperAgentEvent y
// accède (agent_end).
let speakEnabled = false;
function speak(text) {
  if (!text || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "fr-FR";
    window.speechSynthesis.speak(u);
  } catch (_) {}
}

/** Enveloppe de brief structuré (TÂCHE T1) : déléguée au module pur
 * structured-brief.js et appliquée MÉCANIQUEMENT ici (super-agent.js) sur les
 * deux chemins de délégation : `run_agents` ET `delegate_to_coder`. La consigne
 * quality-gate et l'enveloppe (contexte/objectif/consignes/ce qu'il ne faut
 * PAS faire) ne sont plus reconstruites localement. NB : le bus d'agents
 * (agents-bus.js) ne construit PAS l'enveloppe — il reçoit le brief déjà
 * enveloppé. */

/**
 * Rassemble le CONTEXTE DE SUIVI a joindre a une demande deleguee (module pur
 * super-agent-context.js) : projet concerne, taches suivies, decisions et
 * sessions recentes, memoire de session de l'assistant, objectif de la demande.
 * FAIL-OPEN : toute erreur (suivi indisponible) renvoie "" — une delegation
 * n'est jamais bloquee ni retardee definitivement par le contexte.
 * @param {string|null} projectPath
 * @param {string} task
 * @returns {Promise<string>} bloc de contexte ("" si l'assistant ne sait rien).
 */
async function loadDelegationContext(projectPath, task) {
  try {
    const [tracking, sessionMemory] = await Promise.all([
      invoke("get_super_agent_tracking").catch(() => null),
      invoke("super_agent_load_session_memory").catch(() => null),
    ]);
    return buildDelegationContext({ tracking, sessionMemory, projectPath, task });
  } catch (_) {
    return "";
  }
}

/**
 * Joint le contexte de suivi (court et borne) a la demande deleguee et le
 * signale dans la conversation de l'assistant. Le contexte est PREFIXE : il
 * complete la demande (clairement separe par son titre), il ne la remplace
 * pas. Sans contexte, la demande part inchangee.
 * @param {HTMLElement} messagesEl
 * @param {string} brief
 * @param {string|null} projectPath
 * @param {string} task
 * @returns {Promise<string>}
 */
async function attachDelegationContext(messagesEl, brief, projectPath, task) {
  const context = await loadDelegationContext(projectPath, task);
  if (!context) return brief;
  appendSystemMessage(messagesEl, "🧠 Contexte de suivi joint à la demande de l'agent.");
  return prefixDelegationContext(brief, context);
}

/**
 * BUG « une tâche mise en file exécute la tâche précédente » — le CONTEXTE DE
 * SUIVI d'une mission est relu AU LANCEMENT, jamais figé à l'ARRIVÉE.
 *
 * Le contexte de suivi (projet, tâches suivies, décisions, sessions, mémoire de
 * session) est un INSTANTANÉ : il décrit « où en est le chantier ». Lu à
 * l'ARRIVÉE de la demande, il décrit la mission qui tourne à ce moment-là. Une
 * demande mise en file l'emportait donc jusqu'à son tour — et comme ce bloc est
 * PREFIXÉ au brief (donc lu en premier par l'agent), l'agent commençait par
 * exécuter l'étape PRÉCÉDENTE alors que son objectif, plus bas dans le prompt,
 * était bien le sien.
 *
 * Le brief de BASE (enveloppe structurée + consigne quality-gate) ne dépend pas
 * du suivi : il est calculé une fois. Ici, seul le contexte est relu — au moment
 * où la mission sort RÉELLEMENT de la file — et réappliqué à toutes les
 * affectations, qui portent donc toujours le brief réellement envoyé aux agents.
 *
 * Fail-open : une lecture impossible laisse le brief de base intact (aucun
 * contexte inventé, aucune exception). Ne touche ni la file, ni son ordre, ni
 * ses rangs, ni le principe « une seule tâche à la fois par projet ».
 * @param {Array<object>} assignments - affectations de la mission (mutées sur place)
 * @param {string} baseBrief - brief SANS contexte de suivi
 * @param {string|null} projectPath - projet cible (null = hors projet)
 * @param {string} task - demande déléguée
 * @param {{loadContext?: (projectPath: string|null, task: string) => Promise<string>}} [deps]
 *   injection de la LECTURE du contexte (tests ; en production : lecture réelle)
 * @returns {Promise<string>} brief réellement porté par les affectations
 */
export async function refreshAssignmentsBrief(assignments, baseBrief, projectPath, task, deps = {}) {
  const base = String(baseBrief == null ? "" : baseBrief);
  const load = deps && typeof deps.loadContext === "function" ? deps.loadContext : loadDelegationContext;
  let context = "";
  try {
    context = String((await load(projectPath, task)) || "");
  } catch (_) {
    context = ""; // suivi indisponible : la demande part inchangée
  }
  const brief = prefixDelegationContext(base, context);
  const list = Array.isArray(assignments) ? assignments : [];
  for (const item of list) {
    if (item && typeof item === "object") item.brief = brief;
  }
  return brief;
}

/** Recharge la config (nom, clients, prompt, options) depuis Rust. */
export async function refreshSuperAgentConfig() {
  try {
    configCache = await invoke("get_super_agent_config");
  } catch (_) {
    configCache = { name: "Assistant", clients: [], project_client: {}, prompt: "", show_thinking: true, show_tools: false, super_agent_quality_gate: true, super_agent_auto_check_startup: false };
  }
  refreshSuperRenderOptions();
  return configCache;
}

/** Renvoie le cache sync de la config. */
export function getSuperAgentConfigSync() {
  return configCache;
}

/** Nom affichable de l'assistant (titre d'onglet). */
export function superAgentDisplayLabel() {
  return configCache.name || "Assistant";
}

/**
 * Sélectionne, dans la liste d'agents d'un projet pseudo-global de supervision, la
 * session de l'assistant : le libellé suit le nom réglé (⚙️ → Assistant → Nom).
 * La correspondance exacte est privilégiée ; on ne retombe sur l'ancien libellé codé
 * en dur « Magnus » que s'il n'existe AUCUNE session au nom configuré (compatibilité
 * avec un cœur plus ancien). Purement fonctionnel (aucune config ni DOM) : testable.
 */
export function findAssistantSessionAgent(agents, label) {
  const list = agents || [];
  const wanted = (label || "").trim();
  if (wanted) {
    const exact = list.find((a) => a && a.agent === wanted);
    if (exact) return exact;
  }
  return list.find((a) => a && a.agent === "Magnus") || null;
}

/**
 * Issue #46 : bascule automatiquement sur l'onglet Assistant (🧭) une fois le
 * projet chargé, si l'onglet assistant est ouvert (l'assistant est « activé »
 * par l'utilisateur). Ne force rien si l'onglet n'existe pas (assistant non
 * utilisé) pour ne pas surprendre. Appelé après chargement de projet et au
 * démarrage de Pilot.
 */
export function switchToSuperAgent() {
  const tabs = window._pilotTabs;
  if (!tabs || !tabs.tabs) return;
  const superTab = tabs.tabs.find((t) => t.mode === "superagent");
  if (superTab && typeof tabs.switchTab === "function") {
    tabs.switchTab(superTab.id);
  }
}

// Palette de couleurs par projet : ~10 teintes lisibles en thème dark ET
// light. La couleur est STABLE pour un même projet (hash du nom → palette).
const PROJECT_COLOR_PALETTE = [
  "#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#14b8a6",
];
function projectColor(projectName) {
  if (!projectName) return null;
  let hash = 0;
  for (let i = 0; i < projectName.length; i++) {
    hash = ((hash << 5) - hash + projectName.charCodeAt(i)) | 0;
  }
  return PROJECT_COLOR_PALETTE[Math.abs(hash) % PROJECT_COLOR_PALETTE.length];
}

// État de streaming partagé entre createSuperAgent et handleSuperAgentEvent
// (module scope : handleSuperAgentEvent y accède directement). Même structure
// de rendu que l'agent standard (agent-pi.js) : bloc assistant + flux
// chronologique (sections texte / pensée / outils) — voir issue #43.
let currentBody = null;      // élément `.agent-message-assistant` du tour courant
let currentFlow = null;      // sous-élément `.agent-stream-flow`
// Badges projet de la bulle courante (chantier « badge par bulle ») : snapshot
// capturé au moment où l'utilisateur envoie sa demande = UNIQUEMENT les projets
// explicitement nommés dans le texte, dans l'ordre d'apparition (module pur
// super-agent-badges.js). Les bulles du tour (réponse incluse) héritent du
// snapshot, qui est FIGÉ pour toujours : changer le projet actif ne modifie
// plus jamais les badges déjà affichés. Null = aucun tour en cours. Les bulles
// créées hors tour (question relais, widget) portent des badges EXPLICITES
// quand leur appelant connaît le projet. Quand le texte ne nomme aucun projet,
// la regle de choix (source de verite unique : `resolveBubbleBadgeNames`) prend
// le projet REELLEMENT concerne par l'echange, puis en DERNIER RECOURS le
// projet ouvert au moment de la creation de la bulle.
let currentTurnProjectBadges = null;
// REGLE 2 (decision proprietaire 2026-10-22) : projets REELLEMENT concernes
// par le tour en cours (mission/agents lances, agent cible, projet transmis a
// un agent, projet ouvert par l'assistant). Notes au fil du tour, remis a zero
// a chaque nouveau tour, puis FIGES pour la bulle. Un projet vise prime sur le
// projet ouvert a l'ecran : jamais un nom faux.
let currentTurnConcernedBadges = [];
// Badges reellement choisis pour chaque bulle (cle = element de bulle) : permet
// d'ETENDRE la bulle de reponse (#15) sans perdre les noms deja figes (nommes,
// concernes, ou en dernier recours projet ouvert fige a la creation).
const bubbleBadgeSnapshots = new WeakMap();

/** Note un projet REELLEMENT concerne par le tour en cours (regle 2). La regle
 * de normalisation (chemin -> nom, dedup) vit dans le module pur des badges. */
function noteConcernedProject(pathOrName) {
  currentTurnConcernedBadges = addConcernedBadge(currentTurnConcernedBadges, pathOrName);
}

/** Badge du projet ouvert A CET INSTANT (regle 3 : dernier recours). L'appelant
 * le fige dans la bulle au moment de sa creation : jamais recalcule apres.
 * Aucun projet ouvert -> liste vide (aucun nom invente). */
function currentOpenProjectBadges() {
  const path = (typeof window !== "undefined" && window._pilotProjectPath) || "";
  const name = badgeNameFromProjectPath(path);
  return name ? [name] : [];
}
let currentTextSection = null; // section texte non fermée
let currentThinkingBlock = null; // bloc pensée courant
let pendingText = "";
let pendingRender = false;
let lastAssistantRawText = "";
let superShowThinking = true; // réglage « Afficher la réflexion » (issue #43)
let superShowTools = false;   // réglage « Afficher les outils » (issue #43)
// Toggles du bandeau « assistant occupé » et de la teinte « réflexion » de la
// barre de saisie, exposés au module scope pour que handleSuperAgentEvent (qui
// est au niveau module) puisse les appeler. Assigned dans createSuperAgent
// (le modèle ne les a pas dans son scope, mais le handler module si).
let superSetBusyHint = () => {};
let superSetReflecting = () => {};

/**
 * Fin de flux (agent_end) : le dernier delta est rendu via requestAnimationFrame.
 * On attend que la frame soit peinte, puis on déclare le rendu au repos — c'est
 * à cet instant (et pas à la réception du signal de fin) que le son de fin armé
 * est joué. Repli setTimeout hors navigateur (tests).
 *
 * RÈGLE : seul un `agent_end` VRAIMENT terminal clôt le tour. `agent_end` peut
 * être émis avec `willRetry: true` (erreur transitoire, troncature, compaction,
 * continuation) et la session REPART : déclarer le rendu au repos ferait sonner
 * le bip alors que l'assistant reprend sa réflexion (`agent-hardening.js`
 * `shouldFinalizeOnAgentEnd`, déjà appliqué au suivi des agents délégués).
 * @param {object} [event] - payload de l'événement `agent_end`.
 */
function flushSuperRenderThenSoundIdle(event) {
  if (!shouldFinalizeOnAgentEnd(event)) return;
  const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (cb) => setTimeout(cb, 0);
  raf(() => raf(() => markSoundRenderIdle("superagent")));
}

// ── Questions en attente (chantier #132) ──
// Boutons de choix réunis avec la barre de saisie principale : quand
// l'assistant (ou un agent relayé, tâche #22) pose une question (ask_choice /
// ask_confirm / ask_multi_choice / ask_input), une rangée interactive de
// boutons est affichée dans #pendingBar, SOUS la barre de saisie principale
// (hors du fil défilant, toujours accessible). La précision / la réponse est
// saisie dans la textarea principale (#superagent-input). Les payloads envoyés
// ({selected,note}/{confirmed,note}/{value}) restent IDENTIQUES à avant :
// seule la présentation change. Une seule question active à la fois, file FIFO
// si concurrence (ex: plusieurs agents qui relayent simultanément).
let pendingBarEl = null;        // conteneur #pendingBar (défini par createSuperAgent)
let pendingInputEl = null;      // textarea #superagent-input (défini par createSuperAgent)
let superMessagesEl = null;     // zone des messages du chat (définie par createSuperAgent)
const pendingQuestions = [];    // file FIFO de questions en attente
// Telegram (étape 2, lot 1) : question actuellement publiée sur Telegram, pour
// ne pas la republier à chaque re-rendu. Réinitialisé à la fermeture de l'onglet.
let telegramAskedQuestion = null;
const SUPERAGENT_PLACEHOLDER_DEFAULT = "Poser une question sur tous les projets… (Entrée pour envoyer)";
const PENDING_NOTE_PLACEHOLDER = "Votre précision (optionnel)… puis validez";

/** Relie la barre de questions en attente à la barre de saisie principale. */
function registerPendingBar(barEl, inputEl) {
  pendingBarEl = barEl;
  pendingInputEl = inputEl;
  // Re-rend une éventuelle question déjà mise en file avant l'enregistrement.
  renderActivePendingQuestion();
}

/** Y a-t-il au moins une question en attente ? */
function hasPendingQuestion() {
  return pendingQuestions.length > 0;
}

/** Efface la textarea principale (uniquement après un envoi réussi). */
function clearPendingInput() {
  if (pendingInputEl) {
    pendingInputEl.value = "";
    pendingInputEl.style.height = "auto";
  }
}

/** Rend la question active (tête de file) dans #pendingBar. */
function renderActivePendingQuestion() {
  if (!pendingBarEl) return;
  pendingBarEl.innerHTML = "";
  const q = pendingQuestions[0];
  if (!q) return;
  const bar = document.createElement("div");
  bar.className = "agent-pending-bar";
  pendingBarEl.appendChild(bar);
  q.render(bar);
  // Chantier #132 : pendant l'attente d'un choix, la barre reste en mode
  // normal, prête à saisir — on retire toute teinte « réflexion » (le dégradé
  // ne s'applique qu'à la réflexion réelle, cf. superSetReflecting).
  if (pendingInputEl && pendingInputEl.parentElement) {
    pendingInputEl.parentElement.classList.remove("superagent-input-reflecting");
  }
  // Ajustements A19 : en mode assistant seul, l'anneau de réflexion vit autour
  // du logo hero — retiré lui aussi tant qu'une question attend une réponse
  // (même logique que le retrait de la teinte de la barre ci-dessus).
  const reflectingHero = document.querySelector(".sa-immersive-hero.sa-immersive-reflecting");
  if (reflectingHero) reflectingHero.classList.remove("sa-immersive-reflecting");
  // Placeholder de la barre adapté quand une question est en attente.
  if (pendingInputEl) pendingInputEl.placeholder = q.placeholder || PENDING_NOTE_PLACEHOLDER;
}

/** Ajoute une question à la file et re-rend la barre. */
function enqueuePendingQuestion(q) {
  pendingQuestions.push(q);
  renderActivePendingQuestion();
  syncTelegramQuestion();
}

/** Finalise la question active (après envoi) et passe à la suivante (FIFO). */
function finalizePendingQuestion() {
  const done = pendingQuestions.shift();
  renderActivePendingQuestion();
  if (pendingInputEl && !hasPendingQuestion()) {
    pendingInputEl.placeholder = SUPERAGENT_PLACEHOLDER_DEFAULT;
  }
  // Telegram (étape 2, lot 1) : la question résolue dans l'application est
  // marquée comme telle (première réponse gagne) ; la question suivante, s'il
  // y en a une, prend sa place sur Telegram.
  syncTelegramQuestion(done);
}

// ── Telegram (étape 2, lot 1) : questions / réponses depuis Telegram ──
// La question active (tête de file de `pendingQuestions`) est AUSSI envoyée sur
// Telegram via la passerelle d'envoi existante. Le propriétaire répond par un
// numéro (option) ou un texte libre ; la réponse est appliquée par `q.submit`,
// exactement comme une réponse donnée dans l'application.

/** Décrit une question en attente pour Telegram (titre, message, options). */
function telegramDescriptorOf(q) {
  const options = Array.isArray(q.options) ? q.options : [];
  if (q.confirmed !== undefined) {
    return { kind: "confirm", title: q.title, message: q.message || "", options: ["Oui", "Non"] };
  }
  if (q.multi) return { kind: "multi", title: q.title, options };
  if (options.length) return { kind: "choice", title: q.title, options };
  return { kind: "input", title: q.title };
}

/**
 * Applique une réponse reçue par Telegram à la question en cours, par le MÊME
 * chemin que si le propriétaire avait répondu dans l'application (`q.submit`) :
 *   - option (numéro) → choix unique / multi / confirmation ;
 *   - sélection (question à choix multiple validée par « Terminé ») → toutes
 *     les options cochées, dans l'ordre des options ;
 *   - confirmation par texte (accord / refus CLAIR) → `q.confirmed` ;
 *   - texte libre → valeur de saisie, ou précision d'un choix (mêmes règles que
 *     la validation de la barre de saisie) ;
 *   - texte ambigu sur une confirmation (`undecided`) → garde-fou : aucune
 *     décision (la question a déjà été reposée par la passerelle).
 * @param {object} q - question active.
 * @param {{kind: string, index?: number, value?: string, confirmed?: boolean, values?: string[]}} parsed
 */
export async function applyTelegramAnswer(q, parsed) {
  if (parsed.kind === "undecided") return; // jamais de confirmation par défaut
  if (parsed.kind === "selection") {
    // CHOIX MULTIPLE : la sélection complète remplace l'ensemble courant, puis
    // la question est envoyée une seule fois (aucune réponse avant « Terminé »).
    if (!q.multi) return;
    q.selected = new Set(Array.isArray(parsed.values) ? parsed.values : []);
    await q.submit("", false);
    return;
  }
  if (parsed.kind === "option") {
    if (q.multi) q.selected.add(parsed.value);
    else if (q.confirmed !== undefined) q.confirmed = parsed.value === "Oui";
    else q.selected = parsed.value;
    await q.submit("", false);
    return;
  }
  if (parsed.kind === "decision" && q.confirmed !== undefined) {
    q.confirmed = parsed.confirmed === true;
    await q.submit("", false);
    return;
  }
  await q.submit(parsed.value, false);
}

/**
 * Synchronise la passerelle Telegram avec la question active :
 *   - marque la question `settled` comme résolue (première réponse gagne) ;
 *   - publie sur Telegram la nouvelle tête de file, si elle change.
 */
function syncTelegramQuestion(settled) {
  if (settled) settleTelegramQuestion(settled);
  const q = pendingQuestions[0];
  if (!q || q === telegramAskedQuestion) return;
  telegramAskedQuestion = q;
  askTelegramQuestion(q, telegramDescriptorOf(q), (parsed) => applyTelegramAnswer(q, parsed));
}

/** Envoie la réponse d'une question : marque la barre résolue, envoie, puis
 * efface le champ et passe à la question suivante en cas de succès. En cas
 * d'échec, on ne vide PAS le champ et on réactive la barre. */
async function finishPendingQuestion(q, value, cancelled) {
  if (pendingBarEl) pendingBarEl.querySelectorAll("button").forEach((b) => { b.disabled = true; });
  // Affiche dans la discussion ce que l'utilisateur a répondu (choix unique /
  // multi / confirmation / saisie), pour qu'en relisant la conversation on
  // sache ce qui a été choisi. Cas d'annulation : rien à afficher.
  if (!cancelled && superMessagesEl) {
    let label;
    if (q.multi) {
      label = q.selected && q.selected.size ? [...q.selected].join(", ") : "aucune option";
    } else if (q.confirmed !== undefined) {
      label = q.confirmed ? "Oui" : "Non";
    } else if (q.selected !== undefined) {
      label = q.selected || "aucune option";
    } else {
      label = String(value ?? "");
    }
    const note = (typeof value === "string" && value.startsWith("{"))
      ? (() => { try { return JSON.parse(value).note; } catch (_) { return ""; } })()
      : "";
    if (note) label += ` (${note})`;
    appendMessage(superMessagesEl, "user", "Réponse : " + label);
  }
  // Bug d'affichage : après une réponse inline (choix / confirmation / saisie),
  // on ferme la bulle assistant en cours (celle qui contenait la question) pour
  // que la continuation de l'assistant démarre une NOUVELLE bulle, au lieu de se
  // ré-injecter dans l'ancienne (même logique que `send()` après un message
  // utilisateur). Le bandeau de la question reste dans sa bulle (déjà dans le
  // DOM) ; seul le streaming suivant est réorienté vers un nouveau bloc.
  currentBody = null;
  currentFlow = null;
  currentTextSection = null;
  currentThinkingBlock = null;
  pendingText = "";
  pendingRender = false;
  lastAssistantRawText = "";
  // Snapshot de badges conservé : la continuation (réponse à la question)
  // hérite des badges de la demande qui a ouvert le tour. Reset seulement à
  // la vraie fin de tour (onEnd) ou au prochain envoi utilisateur.
  try {
    // Telegram (étape 2, lot 1) : la question est RÉSERVÉE (résolue + application
    // en cours) AVANT l'envoi — une seconde soumission très rapprochée (autre
    // clic, réponse Telegram) est donc inopérante. Si l'envoi échoue, la question
    // est rouverte (la barre reste affichée, Telegram reste utilisable).
    const outcome = await answerTelegramQuestionFromApp(q, () => q.responder(q.id, value, cancelled));
    // Course « première réponse gagne » : si cette soumission a été refusée
    // (question déjà répondue / application concurrente en cours), ne JAMAIS
    // finaliser — sinon la file avancerait à tort (question suivante perdue).
    if (outcome && outcome.applied === false) return;
    clearPendingInput();
    finalizePendingQuestion();
  } catch (err) {
    console.error("Erreur envoi choix assistant:", err);
    renderActivePendingQuestion();
  }
}

/** Valide la question active avec la précision saisie (appel depuis send()). */
function validatePendingQuestion(raw) {
  const q = pendingQuestions[0];
  if (!q) return;
  const note = (raw || "").trim();
  q.submit(note, false);
}

// ── Détection de boucle dans la réflexion (issue #55) ──
// Même mécanique que l'agent standard (loop-detection.js, issue #37) : on
// accumule le flux streamé (text_delta + thinking_delta) et, si un bloc répété
// est détecté, on ARRÊTE l'assistant avec un message clair. Pas de reprise
// automatique avec correction : l'assistant est un outil de suivi, pas un
// codeur — quand il boucle, on stoppe et on invite l'utilisateur à reformuler.
let superLoopBuffer = "";
let superLoopLastChecked = 0;
let superLoopStopped = false;
// Issue #55 : empreintes des derniers tool calls (ex: commandes bash) pour
// détecter une boucle d'OUTILS (le modèle enchaîne des appels identiques sans
// streamer de texte répété).
let superLoopToolCalls = [];
const SUPER_LOOP_CHECK_INTERVAL_MS = 500;
const SUPER_LOOP_BUFFER_MIN = 200;

// ── Agent invisible (évolution 64) — suivi réactif (4.3) ──
// Quand l'option « agent invisible » est activée, l'Assistant délègue une
// demande à l'agent SANS créer d'onglet agent. On écoute alors le canal
// d'événements de l'agent en arrière-plan pour : (1) offrir un bouton
// « Arrêter » dans le chat de l'Assistant (coupure à tout moment), (2) détecter
// une boucle de réflexion (loop-detection) et arrêter l'agent automatiquement,
// (3) notifier l'utilisateur et injecter le feedback de délégation à la fin.
// 4.3 : le bandeau « Arrêter » et la notification de fin sont pilotés par l'état
// de l'objet (agent-state-changed + lecture get_agent), plus par un état local
// non persisté. On ne conserve donc ici QUE l'IDENTITÉ de la délégation en
// cours (id résolu + projet) et ses références DOM/unlisten. Le buffer de
// détection de boucle est scopé au listener (closure), pas une variable de
// module transitoire.
// Issue #135 : map des suivis d'agents invisibles indexée par clé
// (agentId, projectPath) — deux agents invisibles peuvent tourner en parallèle
// sur deux projets différents sans s'écraser (perte d'événements du premier).
const invisibleAgents = new Map(); // key -> { agentId, projectPath, messagesEl, unlisten, loop, sessionUid }
const INVISIBLE_LOOP_CHECK_INTERVAL_MS = 500;
const INVISIBLE_LOOP_BUFFER_MIN = 200;

// Recharger les options de rendu depuis la config cache.
function refreshSuperRenderOptions() {
  superShowThinking = configCache.show_thinking !== false;
  superShowTools = configCache.show_tools === true;
}

// ── Rendu de messages (même structure DOM que l'agent standard agent-pi.js) ──

/** Crée un bloc message assistant avec flux chronologique (comme agent-pi).
 * Une seule bulle par tour d'agent par projet (Règle 1) : on ne crée pas de
 * nouvelle bulle à chaque `message_end` intermédiaire, seulement à `agent_end`
 * ou la fin du tour. La bulle porte la couleur du projet (Règle 3 : hash du
 * nom → palette). */
export function createSuperAgentBlock(messagesEl, explicitBadges = null) {
  const el = document.createElement("div");
  el.className = "agent-message agent-message-assistant";
  const bubble = document.createElement("div");
  bubble.className = "agent-bubble agent-bubble-assistant";
  // Badges projet (snapshot) : la regle de choix est UNIQUE et vit dans
  // `resolveBubbleBadgeNames` (module pur super-agent-badges.js) :
  //   1. badges explicites (l'appelant connait le projet : relais d'un agent) ;
  //   2. projets nommes dans le texte de la demande (ordre d'apparition) ;
  //   3. projets REELLEMENT concernes par l'echange (mission/agents lances,
  //      agent cible, projet transmis, projet ouvert par l'assistant) ;
  //   4. DERNIER RECOURS : projet ouvert au moment de la creation de la bulle
  //      (un nom utile vaut mieux qu'aucune etiquette) ;
  //   5. rien de tout cela → AUCUNE etiquette (jamais de nom invente).
  // Fige pour toujours : aucun recalcul ni rafraichissement retrospectif.
  const badgeNames = resolveBubbleBadgeNames(
    explicitBadges,
    currentTurnProjectBadges,
    currentTurnConcernedBadges,
    currentOpenProjectBadges()
  );
  // Snapshot fige de la bulle (sert a l'etendre a agent_end sans rien perdre).
  bubbleBadgeSnapshots.set(el, badgeNames);
  const color = projectColor(badgeNames[0]);
  renderProjectBadgesInto(bubble, badgeNames);
  if (color) {
    // Border-left coloré par projet (Règle 3). Inline style pour primer sur
    // la règle `.superagent-wrapper .agent-bubble-assistant` qui force
    // `border-left: 3px solid var(--superagent-accent)`. Diluted tint for a
    // soft pastel edge, still distinct per project in both themes.
    bubble.style.borderLeftColor = `color-mix(in srgb, ${color} 40%, transparent)`;
  }
  const flow = document.createElement("div");
  flow.className = "agent-stream-flow";
  bubble.appendChild(flow);
  el.appendChild(bubble);
  messagesEl.appendChild(el);
  // Bouton de lecture a voix haute : sur les SEULES reponses de l'assistant
  // (jamais sur un message utilisateur ni sur un evenement systeme).
  attachReadAloud(el, { win: globalThis.window, doc: globalThis.document, refreshIcons });
  scrollSuperToBottom(messagesEl);
  return el;
}

/**
 * Rend les badges « 📁 nom » d'une bulle (chantier badge-par-bulle). Une bulle
 * peut parler de PLUSIEURS projets : chaque nom donne un badge compact,
 * posés dans une rangée `.agent-project-badges` en tête de bulle (la bulle
 * assistant est un flex column, la bulle user est en bloc — conteneur adapté
 * aux deux). Un seul nom → rangée à badge unique. Aucun nom → rien. La
 * couleur est STABLE par projet (hash → palette, `projectColor`), appliquée
 * en rendu pastel inline (même dilution que le rendering historique, lisible
 * en thème dark ET light). Les badges sont créés une fois : cette fonction
 * n'est PAS rappelée sur des bulles existantes (pas de retouche rétrospective).
 * @param {HTMLElement} bubble - élément bulle (assistant ou user).
 * @param {string[]} badgeNames - noms à afficher (snapshot, déjà dedupliqué).
 */
function renderProjectBadgesInto(bubble, badgeNames) {
  if (!bubble || !Array.isArray(badgeNames) || badgeNames.length === 0) return;
  const stack = document.createElement("div");
  stack.className = "agent-project-badges";
  for (const projectName of badgeNames) {
    const badge = document.createElement("div");
    badge.className = "agent-project-badge";
    badge.textContent = "📁 " + projectName;
    const color = projectColor(projectName);
    if (color) {
      // Pastel rendering : couleur brute diluée à l'affichage pour rester
      // lisible en thème dark ET light (même pattern que --superagent-accent).
      badge.style.background = `color-mix(in srgb, ${color} 14%, transparent)`;
      badge.style.color = `color-mix(in srgb, ${color} 70%, var(--text-primary))`;
      badge.style.borderColor = `color-mix(in srgb, ${color} 32%, transparent)`;
    }
    stack.appendChild(badge);
  }
  bubble.insertBefore(stack, bubble.firstChild);
}

/**
 * Garde-fou anti-blocage : résout la promise en `fallback` après `ms` ms si
 * elle n'a pas déjà résolu (les invokes restent locaux et ultra rapides ; le
 * snapshot ne doit JAMAIS retarder l'envoi d'une demande).
 */
function withTimeout(promise, ms, fallback) {
  let timer = null;
  const guard = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, guard]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** Garde de duree du snapshot projets (ms) : au-dela, fail-open (badges de
 * base conserves) plutot que retarder l'envoi. Les invokes sont locaux (DB/UI)
 * et repondent en quelques ms → marge large. */
const BADGE_PROJECTS_COLLECT_TIMEOUT_MS = 800;

/** Retire le suffixe « - (GDS) » d'un nom de badge (format d'affichage Pilot).
 * Utilisé avant d'étendre/re-suffixer les badges (chantier #15) pour éviter
 * un double suffixe quand un badge déjà étiqueté GDS est réutilisé comme base. */
function stripGdsSuffix(name) {
  return String(name || "").replace(/\s*-\s*\(GDS\)\s*$/i, "");
}

/**
 * Snapshot des badges pour un envoi : projette la liste des projets
 * connus/ouverts côtés UI dans le module pur (captureProjectBadgeNames).
 * Candidats = projets ouverts (list_open_projects, chemins) + projets suivis
 * connus (list_super_agent_projects, {path, name}) ; dédupliqués par chemin.
 * AUCUN repli sur le projet actif : l'etiquette ne montre que les projets
 * reellement cites, rien quand aucun n'est cite (un nom faux est pire que pas
 * de nom). Fail-open : toute erreur ou lenteur → aucun badge a l'envoi, jamais
 * bloquant.
 *
 * Si `baseBadges` est fourni (bulle de RÉPONSE, chantier #15), on part de ces
 * badges (snapshot de la demande) et on les étend avec les projets nommés dans
 * `text` (texte de la réponse) via extendBadgesWithText, au lieu de repartir
 * de zéro : les noms corrects de la demande ne sont jamais perdus. Les
 * suffixes GDS sont retirés avant extension puis ré-appliqués une seule fois
 * sur le résultat.
 * @param {string} text - texte à scanner (demande ou réponse de l'assistant).
 * @param {string[]|null} [baseBadges] - badges de base (null → snapshot classique).
 * @returns {Promise<string[]>} noms de badges (ordre d'apparition).
 */
async function collectBubbleBadgeProjects(text, baseBadges = null) {
  // Echec/lenteur : on conserve la base quand on en a une (noms corrects),
  // sinon aucune etiquette. Jamais le projet ouvert a l'ecran.
  const fallback = Array.isArray(baseBadges) ? baseBadges : [];
  try {
    const resolved = await withTimeout((async () => {
      const [opened, tracked] = await Promise.allSettled([
        invoke("list_open_projects"),
        invoke("list_super_agent_projects"),
      ]);
      const candidates = [];
      const seen = new Set();
      const push = (path, name) => {
        const key = String(path || name || "");
        if (!key || seen.has(key)) return;
        seen.add(key);
        candidates.push({ path: path || "", name: name || null });
      };
      if (opened.status === "fulfilled" && Array.isArray(opened.value)) {
        for (const p of opened.value) {
          if (typeof p === "string" && p) push(p, null);
        }
      }
      if (tracked.status === "fulfilled" && Array.isArray(tracked.value && tracked.value.projects)) {
        for (const p of tracked.value.projects) {
          if (p && (p.path || p.name)) push(p.path || "", p.name || null);
        }
      }
      // baseBadges fourni → on étend (réponse) ; sinon snapshot classique (demande).
      const names = baseBadges
        ? extendBadgesWithText((baseBadges || []).map(stripGdsSuffix), text, candidates)
        : captureProjectBadgeNames(text, null, candidates);
      // Indicateur « (GDS) » : suffixe ajouté au nom du badge si le projet est
      // branché sur un GDS (config .pilot/gds.json activée). Fail-open : non
      // branché. Les invokes sont locaux/rapides ; toute lenteur → fallback.
      if (names.length) {
        try {
          const gdsByDisplay = new Map();
          await Promise.all(candidates.map(async (c) => {
            const display = (c.name && String(c.name).trim()) || pathTailName(c.path);
            if (!display) return;
            if (isGdsConnected(await isProjectGds(c.path))) gdsByDisplay.set(display.toLowerCase(), true);
          }));
          return names.map((n) => {
            const raw = stripGdsSuffix(n);
            return gdsByDisplay.has(raw.trim().toLowerCase()) ? `${raw} - (GDS)` : raw;
          });
        } catch (_) {
          return names.map(stripGdsSuffix); // fail-open : badges sans suffixe
        }
      }
      return names;
    })(), BADGE_PROJECTS_COLLECT_TIMEOUT_MS, fallback);
    return resolved;
  } catch (_) {
    return fallback; // fail-open : jamais bloquant
  }
}

/**
 * Chantier #15 : étend les badges de la bulle de RÉPONSE avec les projets
 * nommés dans le texte de la réponse de l'assistant. Appelé à `agent_end`,
 * quand le texte complet de la réponse est connu. Remplace la rangée de badges
 * existante de la bulle (celle du snapshot de la demande) par la version
 * étendue. Fire-and-forget (jamais bloquant) : en cas d'échec ou de lenteur,
 * la bulle garde ses badges de la demande (fail-open).
 * @param {HTMLElement} bubble - bulle de réponse (élément .agent-message-assistant).
 * @param {string[]} baseBadges - badges du snapshot de la demande (peut être une
 *   liste vide : la réponse peut alors apporter des projets réellement cités).
 * @param {string} text - texte complet de la réponse de l'assistant.
 */
async function extendResponseBubbleBadges(bubble, baseBadges, text) {
  if (!bubble || !Array.isArray(baseBadges)) return;
  if (!text || !String(text).trim()) return;
  const extended = await collectBubbleBadgeProjects(String(text), baseBadges);
  if (!extended.length) return;
  const old = bubble.querySelector(".agent-project-badges");
  if (old) old.remove();
  renderProjectBadgesInto(bubble, extended);
}

/** Ajoute (ou réutilise) une section texte rendue en Markdown. */
function appendSuperTextSection(content, reuse = true) {
  if (!currentFlow) return null;
  let section = null;
  if (reuse) {
    const sections = currentFlow.querySelectorAll(".agent-text-section");
    for (let i = sections.length - 1; i >= 0; i--) {
      if (!sections[i].dataset.closed) { section = sections[i]; break; }
    }
  }
  if (!section) {
    section = document.createElement("div");
    section.className = "agent-text-section";
    currentFlow.appendChild(section);
  }
  if (content) section.innerHTML = md.render(content);
  return section;
}

/** Ajoute un bloc pensée (respecte le réglage « Afficher la réflexion »). */
function appendSuperThinkingSection(content, allowEmpty = false) {
  if (!currentFlow) return null;
  const trimmed = (content || "").trim();
  if (!allowEmpty && (!trimmed || trimmed === "{}")) return null;
  const block = document.createElement("div");
  block.className = "agent-thinking";
  if (superShowThinking) {
    block.innerHTML = `<div class="agent-thinking-content">${trimmed ? escapeHtmlForSuper(trimmed) : ""}</div>`;
  } else {
    block.innerHTML = `<div class="agent-thinking-dots">pensée</div>`;
  }
  currentFlow.appendChild(block);
  return block;
}

/** Ajoute une ligne outil (respecte le réglage « Afficher les outils »). */
function appendSuperToolInline(label, name) {
  if (!currentFlow || !superShowTools) return null;
  const line = document.createElement("div");
  line.className = "agent-tool-inline";
  const lab = document.createElement("span");
  lab.className = "agent-tool-label";
  lab.textContent = label || "outil";
  const code = document.createElement("code");
  code.textContent = name || "";
  line.appendChild(lab);
  line.appendChild(code);
  currentFlow.appendChild(line);
  return line;
}

/** Échappe le HTML (pour les blocs pensée, rendus en texte brut). */
function escapeHtmlForSuper(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Résume la mémoire de session (reprise) en une courte phrase pour le message
 * système « 🔁 Reprise de session — … ». Le résumé est un objet JSON structuré
 * (current_topic, active_project, work_in_progress, notes). Fail-open : tout
 * JSON invalide retombe sur le texte brut tronqué.
 * @param {string} resume
 * @returns {string}
 */
function sessionMemorySummary(resume) {
  try {
    const r = JSON.parse(resume);
    const bits = [];
    if (r.current_topic) bits.push(String(r.current_topic));
    if (r.active_project) bits.push(String(r.active_project));
    const wip = Array.isArray(r.work_in_progress) ? r.work_in_progress.length : 0;
    if (wip > 0) bits.push(`${wip} chantier${wip > 1 ? "s" : ""} en cours`);
    const summary = bits.join(" · ").trim();
    if (summary) return summary.slice(0, 200);
    return String(r.notes || "reprise").slice(0, 200);
  } catch (_) {
    return String(resume || "reprise").slice(0, 200);
  }
}

function appendMessage(messagesEl, role, text) {
  const el = document.createElement("div");
  el.className = `agent-message agent-message-${role}`;
  const bubble = document.createElement("div");
  bubble.className = `agent-bubble agent-bubble-${role}`;
  if (role === "assistant") {
    bubble.innerHTML = md.render(text || "");
  } else {
    bubble.textContent = text;
  }
  el.appendChild(bubble);
  messagesEl.appendChild(el);
  scrollSuperToBottom(messagesEl);
  return bubble;
}

function appendSystemMessage(messagesEl, text) {
  const trimmed = String(text || "").trim();
  // #31 : ne jamais afficher de bulle vide ou qui ne contient qu'un chemin de
  // projet (sans contexte). Un message d'info doit toujours porter un libellé
  // utile (ex: « Projet ouvert : X ») ; sinon on ne l'affiche pas.
  if (!trimmed || isBareProjectPath(trimmed)) return;
  // Telegram (étape 2, lot 3) : les ALERTES affichées à l'utilisateur (erreur,
  // anomalie, blocage) partent aussi sur Telegram, en une phrase simple, quand
  // la communication du dialogue est active. Les autres messages système
  // (accueil, session, suivi) ne sont jamais transmis.
  //
  // Incrément 1 Laya (§7.6 étape 4) : la DÉCISION « alerte à transmettre ? » est
  // prise par le service Laya local quand il est disponible (classement en une
  // fraction de seconde, aucun jeton, confiance tracée) ; service éteint ou
  // modèle non chargé → repli STRICT sur la règle de mots-clés d'avant. C'est un
  // feu et oubli : jamais bloquant pour l'affichage, jamais d'erreur visible.
  if (isTelegramDialogActive()) {
    classifyAssistantMessageWithLaya(trimmed).then((verdict) => {
      if (verdict.kind === "alert") {
        relayAssistantMessageToTelegram(trimmed, { project: assistantTelegramProject() });
      }
    });
  }
  const seq = infoSeq++;
  pendingInfo[seq] = { messagesEl, text: trimmed };
  flushPendingInfo();
}

/**
 * Détecte un texte qui n'est qu'un chemin de projet (sans libellé/contexte).
 * Chemin Windows (C:\...) ou POSIX (/... ou ~/...), sans espace.
 * @param {string} s
 * @returns {boolean}
 */
function isBareProjectPath(s) {
  return /^[A-Za-z]:[\\/]/.test(s) || /^[~/]/.test(s);
}

/**
 * Infère le niveau de sévérité d'un événement système depuis son préfixe
 * (tâche #139). Les messages d'info de l'assistant sont préfixés par une
 * icône emoji (❌ erreur, ⚠️ avertissement, ✅ succès) ; tout le reste est
 * considéré comme de l'info. @returns {string} info|warn|error|success
 */
function inferSuperEventLevel(text) {
  if (/^❌/.test(text)) return "error";
  if (/^⚠️/.test(text)) return "warn";
  if (/^✅/.test(text)) return "success";
  return "info";
}

/** Formate un horodatage discret HH:MM pour un événement système. */
function formatSuperEventTime(d) {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * Ajoute un événement système dans le volet « Événements » du panneau du suivi
 * du travail (haut droite). `level` ∈ info|warn|error|success. Si l'utilisateur
 * ne regarde pas déjà cette liste, le compteur de non-lus augmente et la
 * pastille du cercle s'allume (agent-activity.js). Tampon mémoire borné
 * (SUPER_EVENTS_MAX).
 * @param {string} level
 * @param {string} text
 */
function pushSuperAgentSystemEvent(level, text, title) {
  const trimmed = String(text || "").trim();
  if (!trimmed || isBareProjectPath(trimmed)) return;
  // Tâche #160 : même source que la liste des événements → overlay plein écran
  // (si le réglage est activé). Indépendant du panneau : s'affiche même si
  // l'interface du panneau n'est pas encore prête (fail-open symétrique).
  showSuperEventOverlay(level, trimmed);
  const list = agentPanelEventsListElement();
  if (!list) return; // panneau pas encore prêt (interface non initialisée)
  const item = document.createElement("div");
  item.className = "sa-events-item";
  const dot = document.createElement("span");
  const dotLevel = level === "error" ? "danger" : level === "warn" ? "warning" : level === "success" ? "success" : "info";
  dot.className = "sa-events-item-dot " + dotLevel;
  const label = document.createElement("span");
  label.className = "sa-events-text";
  label.textContent = trimmed;
  // Issue #36 : le prompt complet du rappel reste consultable au survol.
  if (title) label.title = String(title);
  const time = document.createElement("span");
  time.className = "sa-events-time";
  time.textContent = formatSuperEventTime(new Date());
  item.appendChild(dot);
  item.appendChild(label);
  item.appendChild(time);
  list.prepend(item);
  // Tampon mémoire borné : on retire les plus anciens (fin de liste).
  while (list.children.length > SUPER_EVENTS_MAX) {
    list.lastChild.remove();
  }
  // Signal d'attention sur le cercle (compteur de non-lus), sauf si la liste
  // des événements est sous les yeux de l'utilisateur.
  agentPanelNoteEvent();
}

/** Affiche les messages d'info en attente dans l'ordre de leur séquence. */
function flushPendingInfo() {
  while (pendingInfo[nextInfoSeq]) {
    const { text } = pendingInfo[nextInfoSeq];
    delete pendingInfo[nextInfoSeq];
    nextInfoSeq++;
    pushSuperAgentSystemEvent(inferSuperEventLevel(text), text);
  }
}

/**
 * Applique le réglage global `super_agent_tasks_tab_enabled` (ACTIVÉ PAR DÉFAUT)
 * au panneau du suivi du travail : activé → onglet « Tâches » présent (ordre
 * définitif des onglets : Agents, Tâches, Événements) ;
 * désactivé → panneau historique (Agents + Événements). Fail-open : réglage
 * illisible → onglet présent. Le panneau est GLOBAL (haut droite) : c'est
 * agent-activity.js qui l'applique, ici on ne fait que lui passer la config
 * (appelée à la création de l'onglet Assistant ET à chaque changement de
 * configuration — la bascule est à chaud, sans rouvrir l'onglet).
 */
function applySuperEventsTabsVisibility() {
  setAgentPanelTabsVisibility(configCache || {});
}

/**
 * Réagit au changement d'onglet du panneau du suivi du travail. La surveillance
 * des missions ne s'arrête PLUS sur un autre onglet : le compteur du bouton
 * « Travail » doit rester vrai (il se figerait dès qu'on regarde ailleurs). Le
 * RENDU de la liste, lui, n'a lieu que lorsque le volet « Tâches » est affiché
 * (voir renderSuperMissions) : aucun travail d'affichage inutile, aucune photo
 * périmée au retour (on repeint a l'affichage).
 * @param {{tab: string, open: boolean}} state
 */
function onPanelTabChanged(state) {
  if (!state || !state.open || state.tab !== "tasks") return;
  loadSuperMissions();
}

/**
 * Rendu du volet « En cours » : les MISSIONS RÉELLEMENT en cours de chaque agent
 * (source : store d'activité partagé, mêmes données que l'indicateur d'activité
 * du haut d'écran — aucun appel supplémentaire au moteur), plus les missions en
 * file d'attente. Deux groupes EXPLICITES et NUMÉROTÉS (« En cours (n) » puis
 * « En attente (n) »), chaque ligne portant son rang, l'agent et le projet : on
 * voit d'un coup d'œil ce qui tourne et l'ordre de la file. Un agent au repos
 * n'y figure pas ; un agent occupé silencieusement (outil long) y reste. Aucune
 * mission → message explicite, jamais une liste vide trompeuse. Le rendu est
 * PUR (renderMissionsPanelHtml, agent-activity.js).
 */
/**
 * Publie le COMPTE des missions sur le bouton « Travail » et retourne les
 * missions (aucun rendu de liste). Une seule source de calcul pour le bouton et
 * pour l'onglet : `buildRunningMissions` puis `splitMissions` (fonctions pures).
 * C'est LE calcul du compteur « Travail » : il n'en existe pas d'autre, ni pour
 * le mode normal, ni pour le mode « Assistant seul », et les deux modes lisent
 * le MEME noeud du document (`#agent-activity`, jamais duplique).
 * @returns {Array} missions courantes (buildRunningMissions)
 */
export function publishSuperMissionsCount() {
  const missions = buildRunningMissions(getAgentActivitySnapshot().list, collectQueuedMissions());
  const { running, waiting } = splitMissions(missions);
  setAgentPanelTaskCount(running.length, waiting.length);
  return missions;
}

// ── Abonnement UNIQUE du compteur « Travail » ─────────────────────────────
// Le compte ne doit pas dependre de l'ouverture de l'onglet 🧭 Assistant : au
// demarrage, aucun onglet 🧭 n'existe, donc `startSuperMissionsWatch()` n'a
// jamais tourne et le bouton « Travail » restait MUET alors que des agents
// travaillaient ou que des commandes attendaient leur tour. En mode
// « Assistant seul », l'onglet a forcement ete ouvert auparavant : le compteur
// y etait juste. Les deux modes pouvaient donc afficher deux valeurs
// differentes alors qu'il n'y avait qu'un seul calcul — la divergence venait
// de l'ABONNEMENT, pas du calcul. Ce demarrage, appele par `main.js` sans
// dependance a un onglet, supprime la cause : UN abonnement, UN calcul, UN
// noeud, pour les deux modes.
let taskCounterUnsub = null;

/**
 * Demarre le compteur « Travail » — idempotent : quel que soit le nombre
 * d'appels (demarrage de Pilot, ouverture puis fermeture de l'onglet 🧭), il
 * n'existe qu'UN abonnement, donc qu'une seule publication du compte.
 * @returns {boolean} true si l'abonnement vient d'etre pose.
 */
export function startTaskCounter() {
  if (taskCounterUnsub) return false;
  taskCounterUnsub = subscribeAgentActivity(publishSuperMissionsCount);
  return true;
}

function renderSuperMissions() {
  // Le COMPTE est publie AVANT tout rendu : il ne dépend pas de l'affichage du
  // volet, seulement des mêmes données que lui. Le bouton et l'onglet ne
  // peuvent donc pas se contredire.
  const missions = publishSuperMissionsCount();
  // Rendu de la liste : uniquement quand le volet « Tâches » est a l'ecran.
  if (!isAgentPanelPaneVisible("tasks")) return;
  const superTasksList = agentPanelTasksListElement();
  if (!superTasksList) return;
  superTasksList.innerHTML = renderMissionsPanelHtml(missions);
  refreshIcons(superTasksList);
}

/** Libellé lisible d'un projet (« Assistant » pour les espaces réservés). */
function missionProjectLabel(project) {
  if (!project || project === ASSISTANT_SPACE) return "Assistant";
  return pathTailName(project) || project;
}

/** Missions EN ATTENTE, tous projets (files de délégation et de runs). */
/**
 * Missions EN ATTENTE, tous projets. Quatre familles, toutes lues dans un etat
 * DEJA tenu par l'application (aucune structure nouvelle, aucun appel au
 * moteur) :
 *  1. les delegations de l'assistant (`delegationStates`) ;
 *  2. les demandes de `run_agents` (`runAgentsQueueByProject`) ;
 *  3. les commandes TAPEES A LA MAIN mises en file sur un projet
 *     (`project-task-queue.js`) — oubliees jusqu'ici, donc total faux ;
 *  4. les agents qui attendent leur tour dans la file d'exclusivite du bus
 *     (`agents-bus.js`) — oublies aussi.
 */
function collectQueuedMissions() {
  const out = [];
  for (const [project, st] of delegationStates) {
    for (const q of st.queue || []) {
      out.push({ project: missionProjectLabel(project), mission: q.request || "" });
    }
  }
  for (const [project, queue] of Object.entries(runAgentsQueueByProject)) {
    for (const item of queue || []) {
      // Le RÉSUMÉ COURT fourni avec la demande (s'il y en a un) accompagne la
      // mission en attente : le panneau affiche cette phrase, sinon il retombe
      // sur l'extraction du libellé de la demande (comportement antérieur).
      out.push({ project: missionProjectLabel(project), mission: item.label || "", resume: item.resume || "" });
    }
  }
  // FAMILLE 3 : commandes manuelles en file (project-task-queue.js).
  for (const cmd of listAllProjectCommands()) {
    out.push({ project: missionProjectLabel(cmd.project), mission: cmd.label || "", agent: cmd.agent || "" });
  }
  // FAMILLE 4 : demandes en file d'exclusivite du bus (agents-bus.js).
  for (const demand of listExclusivityWaitingDemands()) {
    out.push({
      project: missionProjectLabel(demand.project),
      mission: demand.brief || "",
      resume: demand.resume || "",
      agent: demand.agent || "",
    });
  }
  return out;
}

/**
 * Active la surveillance des missions tant que le volet est affiché (store
 * partagé : aucun polling propre, l'affichage suit le rafraîchissement existant).
 */
function startSuperMissionsWatch() {
  if (!superMissionsUnsub) superMissionsUnsub = subscribeAgentActivity(renderSuperMissions);
  renderSuperMissions();
}

/** Coupe la surveillance des missions (volet fermé ou onglet Événements). */
function stopSuperMissionsWatch() {
  if (superMissionsUnsub) {
    superMissionsUnsub();
    superMissionsUnsub = null;
  }
}

/**
 * Affiche le volet « En cours » : missions des agents en travail (store
 * partagé) + missions en file d'attente, marquées « en attente ».
 */
function loadSuperMissions() {
  const superTasksList = agentPanelTasksListElement();
  if (!superTasksList) return;
  superTasksList.innerHTML = `<div class="dash-loading">Chargement des missions…</div>`;
  startSuperMissionsWatch();
}

/**
 * Tâche #136 : détecte une ABSENCE d'outils de l'assistant et affiche la
 * bannière d'anomalie le cas échéant. Le statut des extensions (source des
 * outils) est posé au spawn de la session super-agent (Rust) ; comme le spawn
 * est lancé en fire-and-forget juste avant, on interroge en polling jusqu'à ce
 * que le statut soit connu. Fail-open : si on ne peut pas le déterminer (jamais
 * lancé, erreur), on n'affiche rien. Le comportement normal (outils présents)
 * est strictement inchangé (bannière masquée).
 * @param {HTMLElement|null} bannerEl Élément bannière à afficher/masquer.
 */
async function checkSuperAgentTools(bannerEl) {
  let status = null;
  // ~10 s max : le spawn écrit les extensions puis lance pi ; on attend que le
  // statut soit connu sans bloquer l'ouverture de l'onglet.
  for (let i = 0; i < 20; i++) {
    try {
      status = await invoke("get_super_agent_tools_status");
    } catch (_) {
      status = null;
    }
    if (status && status.known) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!status || !status.known) return;
  // Correctif démarrage lent : si la sonde a ÉCHOUÉ (statut indéterminé), on
  // n'affiche PAS la bannière (évite le faux positif « l'assistant n'a aucun
  // outil » pendant un démarrage lent). La bannière ne s'affiche que si la
  // sonde est OK mais qu'aucune extension n'a été construite.
  if (status.probe_failed) return;
  const noTools =
    !status.ext_supported || (Number(status.extensions_built) || 0) === 0;
  if (bannerEl) bannerEl.hidden = !noTools;
}

// ── Création de l'interface ──

export async function createSuperAgent(container) {
  await refreshSuperAgentConfig();
  // Issue #71 : refléter immédiatement le nom personnalisé de l'assistant au
  // chargement de l'onglet (pas seulement après un changement de config).
  const initTabs = window._pilotTabs;
  if (initTabs && typeof initTabs.updateSuperAgentLabel === "function") {
    initTabs.updateSuperAgentLabel(superAgentDisplayLabel());
  }

  // Rafraîchir le nom de l'onglet quand la config change (paramètres ⚙️).
  // Issue #12 : le handler est stocké pour être retiré dans `unlisten` (sinon
  // chaque recréation de l'onglet 🧭 accumule un listener → N appels par
  // changement de config et références à window._pilotTabs après teardown).
  const onConfigChanged = () => {
    refreshSuperAgentConfig().then(() => {
      // Réglage global de l'onglet « Tâches » : activation/désactivation à chaud,
      // sans redémarrer (le panneau du suivi du travail suit immédiatement).
      applySuperEventsTabsVisibility();
      const tabs = window._pilotTabs;
      if (tabs && typeof tabs.updateSuperAgentLabel === "function") {
        tabs.updateSuperAgentLabel(superAgentDisplayLabel());
      }
      // Ajustement A19 : l'accueil du mode Assistant Only affiche le nom réel
      // de l'assistant — le rafraîchir si l'overlay est déjà ouvert.
      if (immersiveOverlay) {
        const heroTitle = immersiveOverlay.querySelector(".sa-immersive-hero-title");
        if (heroTitle) heroTitle.textContent = `Bonjour, je suis ${immersiveAssistantName()}`;
      }
    });
  };
  window.addEventListener("pilot-config-changed", onConfigChanged);

  const wrapper = document.createElement("div");
  wrapper.className = "agent-chat-container superagent-wrapper";

  // Zone des messages
  const messagesEl = document.createElement("div");
  superWarnMessagesEl = messagesEl; // T6 : cible des alertes d'échec d'injection
  superMessagesEl = messagesEl; // cible du rendu des réponses aux questions
  // Reçus de comptes rendus arrivés AVANT l'ouverture de cet onglet : ils sont
  // affichés maintenant (la bulle est produite à la remise, pas à la fin d'un
  // rendu ; une surface montée plus tard ne doit rien perdre).
  flushPendingReportReceipts();
  messagesEl.className = "agent-chat-messages";
  wrapper.appendChild(messagesEl);

  // SOUCIS 1 (réarmement du suivi automatique) : listener `scroll` qui maintient
  // le flag `superAtBottom`. Quand l'utilisateur remonte pour relire, le suivi
  // est désactivé (issue #60) ; dès qu'il redescend tout en bas, le suivi est
  // ré-armé → les prochains messages le suivront à nouveau à 100 %.
  const onSuperScroll = () => {
    superAtBottom = computeSuperAtBottomFlag(
      messagesEl.scrollTop,
      messagesEl.clientHeight,
      messagesEl.scrollHeight
    );
  };
  messagesEl.addEventListener("scroll", onSuperScroll, { passive: true });

  // Barre d'outils
  const toolbar = document.createElement("div");
  toolbar.className = "agent-chat-toolbar superagent-toolbar";
  toolbar.innerHTML = `
    <button class="agent-btn" data-action="immersive" title="Mode assistant seul : tout masquer sauf la discussion (Ctrl+Shift+A)"><i data-lucide="maximize-2" class="icon-sm"></i></button>
    <button class="agent-btn" data-action="abort" title="Arrêter"><i data-lucide="square" class="icon-sm"></i></button>
    <button class="agent-btn" data-action="new-session" title="Nouvelle session"><i data-lucide="plus" class="icon-sm"></i></button>
    <button class="agent-btn" data-action="initialize" title="Initialiser le suivi du projet actif"><i data-lucide="sparkles" class="icon-sm"></i></button>
    <button class="agent-btn" data-action="projects" title="Projets & clients (associer un projet à un client)"><i data-lucide="building-2" class="icon-sm"></i></button>
    <button class="agent-btn" data-action="config" title="Configurer (nom, clients, prompt)"><i data-lucide="settings" class="icon-sm"></i></button>
    <button class="agent-btn" data-action="period-report" title="Bilan de période (tâches terminées, décisions, jalons, blocages)"><i data-lucide="calendar-range" class="icon-sm"></i></button>
    <button class="agent-btn" data-action="analyze-data" title="Analyser et ranger mes données (analyse en lecture seule : rapport + proposition de rangement)"><i data-lucide="folder-search" class="icon-sm"></i></button>
    <button class="agent-btn" data-action="telegram-dialog" id="superagent-telegram-btn" title="Communication Telegram" aria-label="Communication Telegram" hidden><i data-lucide="message-circle" class="icon-sm"></i></button>
    <select class="agent-model-select" id="superagent-model-select" title="Changer de modèle"></select>
    <span class="agent-status" id="superagent-status">Prêt</span>
  `;
  wrapper.appendChild(toolbar);

  // ── Telegram (étape 2, lot 3, spec_telegram.md) : communication du dialogue ──
  // Bouton d'activation dans l'onglet 🧭. Il est TOTALEMENT invisible tant que la
  // passerelle n'est pas réellement en état de fonctionner : interrupteur
  // principal « Notifications Telegram » coché ET jeton + identifiant présents
  // dans les Paramètres (→ onglet Assistant). Un réglage dupliqué ici serait
  // trompeur : on ne propose pas un bouton qui ne pourrait rien envoyer. Désactivé
  // par défaut et persisté (`AppConfig.telegram_dialog_enabled`), il est relu au
  // chargement → l'état survit aux redémarrages. Activé, l'Assistant vous parle
  // sur Telegram (une phrase simple) et les avis bruts non critiques sont
  // retardés (anti-doublon sans perte, cf. `deliverRawTelegramAvis`).
  const telegramBtn = toolbar.querySelector("#superagent-telegram-btn");
  const applyTelegramDialogButton = (state) => {
    if (!telegramBtn) return;
    telegramBtn.hidden = !(state && state.visible);
    const on = !!(state && state.enabled);
    telegramBtn.classList.toggle("active", on);
    telegramBtn.title = on
      ? "Communication Telegram activée : l'Assistant vous parle sur Telegram — cliquez pour couper"
      : "Activer la communication Telegram (l'Assistant vous parle en une phrase)";
  };
  const refreshTelegramDialogButton = async () => {
    try {
      applyTelegramDialogButton(await loadTelegramDialogConfig());
    } catch (_) {
      // Inerte : un état illisible laisse le bouton invisible (jamais d'erreur).
    }
  };
  const onTelegramPrefsChanged = () => { refreshTelegramDialogButton(); };
  refreshTelegramDialogButton();
  window.addEventListener("pilot-config-changed", onTelegramPrefsChanged);
  // Réactivation AUTOMATIQUE du réglage « me prévenir sur Telegram » : elle est
  // décidée côté Rust à la réception d'un message du PROPRIÉTAIRE (telegram.rs)
  // et signalée ici pour que le bouton de communication se rafraîchisse sans
  // redémarrage. Aucun état recopié : on relit la configuration.
  window.addEventListener(TELEGRAM_NOTIFY_CHANGED_EVENT, onTelegramPrefsChanged);

  // Bascule l'état (clic sur le bouton) puis le persiste via la configuration.
  async function toggleTelegramDialog() {
    let cfg;
    try {
      cfg = await invoke("get_config");
    } catch (e) {
      console.error("get_config:", e);
      appendSystemMessage(messagesEl, "⚠️ Configuration indisponible : la communication Telegram reste inchangée.");
      return;
    }
    const next = !(cfg && cfg.telegram_dialog_enabled === true);
    try {
      await invoke("save_config", { config: { ...cfg, telegram_dialog_enabled: next } });
    } catch (e) {
      console.error("save_config:", e);
      appendSystemMessage(messagesEl, "⚠️ Impossible d'enregistrer le réglage Telegram.");
      return;
    }
    // Relire la config : met à jour l'état interne (parole + anti-doublon) ET le bouton.
    await refreshTelegramDialogButton();
    appendSystemMessage(
      messagesEl,
      next
        ? "📨 Communication Telegram activée : je vous parle directement sur Telegram."
        : "📨 Communication Telegram coupée."
    );
  }

  // Tâche #136 : bannière d'anomalie — si l'assistant n'a AUCUN outil à sa
  // disposition (extensions assistant non chargées au spawn, ex: porte
  // `probe_extension_support` qui échoue sur PLh), on le signale clairement
  // plutôt que de laisser croire qu'il fonctionne normalement. Masquée par
  // défaut : le comportement normal (outils présents) reste inchangé.
  const toolsBanner = document.createElement("div");
  toolsBanner.className = "superagent-tools-warning";
  toolsBanner.hidden = true;
  toolsBanner.textContent =
    "⚠️ Anomalie : l'assistant n'a aucun outil à sa disposition, il ne peut que réfléchir. " +
    "Les outils ne remontent pas depuis le backend — vérifiez votre configuration.";
  wrapper.appendChild(toolsBanner);

  // Zone de saisie
  const inputBar = document.createElement("div");
  inputBar.className = "agent-chat-input-bar";
  inputBar.innerHTML = `
    <textarea class="agent-input" id="superagent-input" rows="1" placeholder="Poser une question sur tous les projets… (Entrée pour envoyer)"></textarea>
    <button class="agent-btn agent-mic-btn" data-action="voice" title="Dictée vocale (transcription cloud)" aria-label="Dictée vocale"><i data-lucide="mic" class="icon-sm"></i></button>
    <button class="agent-btn agent-send-btn" data-action="send"><i data-lucide="send-horizontal" class="icon-sm"></i></button>
  `;
  wrapper.appendChild(inputBar);

  // ── Suivi du travail (haut droite) : AUCUN panneau propre ici ──
  // Les événements système et les missions des agents sont deux volets du
  // panneau unique ouvert par le cercle d'activité (agent-activity.js) : plus de
  // bouton « cloche » dans la barre de saisie, plus de panneau en bas à droite
  // (un seul endroit à l'écran pour suivre le travail). Ce module ne fait
  // qu'ALIMENTER ce panneau (événements poussés dans sa liste, missions
  // rechargées quand son onglet « Tâches » s'affiche).
  if (stopPanelTabWatch) stopPanelTabWatch();
  stopPanelTabWatch = onAgentPanelTabChange(onPanelTabChanged);
  // Compteur du bouton « Travail » : il vit DES L'OUVERTURE de l'onglet, sans
  // attendre que le volet « Taches » ait ete affiche (sinon le bouton resterait
  // muet alors que des missions tournent).
  startSuperMissionsWatch();
  // Réglage global : onglet « Tâches » présent ou non.
  applySuperEventsTabsVisibility();
  // Indicateur discret « assistant occupé » (Bug 1 UX) : bandeau inséré au-dessus
  // de la barre de saisie. Visible uniquement quand l'utilisateur tente d'envoyer
  // pendant que l'assistant est occupé ; disparaît quand le backend redevient libre.
  const busyHint = document.createElement("div");
  busyHint.className = "agent-busy-hint";
  busyHint.textContent = "⏳ L'assistant travaille — ton message sera envoyé quand il est libre";
  busyHint.hidden = true;
  wrapper.insertBefore(busyHint, inputBar);
  // Chantier #132 : barre des questions en attente (boutons de choix) affichée
  // SOUS la barre de saisie principale, hors du fil défilant. Remplie par les
  // fonctions renderSuperAgent* via registerPendingBar.
  const pendingBar = document.createElement("div");
  pendingBar.id = "pendingBar";
  pendingBar.className = "agent-pending-bar-container";
  wrapper.appendChild(pendingBar);

  container.appendChild(wrapper);

  // ── Bilan de période (Idée 5, Lot A) ──
  // Panneau de la vue de suivi : choix de la période (semaine en cours / semaine
  // dernière / période libre), affichage du bilan mis en forme et bouton
  // « Copier ». Les bornes de période et la mise en forme du texte sont des
  // fonctions PURES (`period-report.js`), testées sans DOM. Le rassemblement des
  // données est fait par la commande Tauri `super_agent_period_report`.
  const periodReportEl = document.createElement("div");
  periodReportEl.id = "super-period-report";
  periodReportEl.className = "super-tracking super-period-report hidden";
  periodReportEl.innerHTML = `
    <div class="super-period-controls">
      <label class="super-period-kind-label" for="super-period-kind">Période</label>
      <select id="super-period-kind" class="super-period-kind">
        <option value="this-week">Semaine en cours</option>
        <option value="last-week">Semaine dernière</option>
        <option value="custom">Période libre</option>
      </select>
      <span class="super-period-custom hidden">
        <input type="date" id="super-period-from" aria-label="Début de la période" />
        <span class="dash-muted">→</span>
        <input type="date" id="super-period-to" aria-label="Fin de la période" />
      </span>
      <button class="agent-btn super-period-refresh" title="Afficher le bilan"><i data-lucide="refresh-cw" class="icon-sm"></i><span>Afficher</span></button>
      <button class="agent-btn super-period-copy" title="Copier le bilan" disabled><i data-lucide="copy" class="icon-sm"></i><span>Copier</span></button>
    </div>
    <div class="super-period-meta dash-muted"></div>
    <pre class="super-period-text">Choisissez une période puis cliquez sur « Afficher ».</pre>
  `;
  container.appendChild(periodReportEl);

  const periodKindEl = periodReportEl.querySelector("#super-period-kind");
  const periodCustomEl = periodReportEl.querySelector(".super-period-custom");
  const periodFromEl = periodReportEl.querySelector("#super-period-from");
  const periodToEl = periodReportEl.querySelector("#super-period-to");
  const periodMetaEl = periodReportEl.querySelector(".super-period-meta");
  const periodTextEl = periodReportEl.querySelector(".super-period-text");
  const periodCopyBtn = periodReportEl.querySelector(".super-period-copy");
  let periodReportText = "";

  // Champs de période libre préremplis sur la semaine en cours (repli pratique).
  {
    const initial = weekBounds(new Date());
    periodFromEl.value = initial.from;
    periodToEl.value = initial.to;
  }
  const syncPeriodCustomVisibility = () => {
    periodCustomEl.classList.toggle("hidden", periodKindEl.value !== "custom");
  };
  periodKindEl.addEventListener("change", syncPeriodCustomVisibility);
  syncPeriodCustomVisibility();

  // Rassemble et affiche le bilan de la période choisie. Les bornes sont
  // calculées côté JS (`periodBounds`, heure locale) et envoyées au backend
  // sous forme de deux dates ISO ; le projet visé est le projet actif de
  // l'application, ou TOUS les projets suivis s'il n'y en a pas.
  async function loadPeriodReport() {
    const kind = periodKindEl.value;
    const bounds = periodBounds(kind, new Date(), {
      from: periodFromEl.value,
      to: periodToEl.value,
    });
    if (!bounds) {
      periodMetaEl.textContent = "Période incomplète : choisissez deux dates.";
      periodTextEl.textContent = "";
      periodReportText = "";
      periodCopyBtn.disabled = true;
      return;
    }
    const projectPath = window._pilotProjectPath || null;
    periodMetaEl.textContent = `Période ${bounds.from} → ${bounds.to} · ${
      projectPath ? pathTailName(projectPath) : "tous les projets"
    }`;
    periodTextEl.textContent = "Chargement du bilan…";
    periodCopyBtn.disabled = true;
    try {
      const report = await invoke("super_agent_period_report", {
        from: bounds.from,
        to: bounds.to,
        projectPath,
      });
      periodReportText = formatPeriodReport(report, {
        title: `Bilan de période — ${periodKindLabel(kind)}`,
      });
      periodTextEl.textContent = periodReportText;
      periodCopyBtn.disabled = false;
    } catch (err) {
      console.error("super_agent_period_report:", err);
      periodReportText = "";
      periodTextEl.textContent = `Erreur : ${String(err)}`;
      periodCopyBtn.disabled = true;
    }
  }

  // Copie le bilan affiché (texte prêt à coller). Repli sans exception : si le
  // presse-papiers est inaccessible, on sélectionne le texte pour un Ctrl+C.
  async function copyPeriodReport() {
    if (!periodReportText) return;
    try {
      await navigator.clipboard.writeText(periodReportText);
      toastInfo("Bilan de période copié dans le presse-papiers.");
    } catch (_) {
      const range = document.createRange();
      range.selectNodeContents(periodTextEl);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      toastInfo("Texte sélectionné : copiez-le avec Ctrl+C.");
    }
  }

  periodReportEl
    .querySelector(".super-period-refresh")
    .addEventListener("click", () => loadPeriodReport());
  periodCopyBtn.addEventListener("click", () => copyPeriodReport());
  refreshIcons(periodReportEl);

  // La vue Kanban multi-projets (get_super_agent_kanban) s'ouvre dans un
  // ONGLET DÉDIÉ de Pilot (mode `superagent-kanban`) via le bouton #btn-superkanban
  // de la sidebar, onglet Assistant (spec_super_agent.md). Elle n'occupe plus
  // le panneau inférieur.

  refreshIcons(wrapper);

  const statusEl = toolbar.querySelector("#superagent-status");
  const inputEl = inputBar.querySelector("#superagent-input");
  const modelSelect = toolbar.querySelector("#superagent-model-select");
  const analyzeDataBtn = toolbar.querySelector('[data-action="analyze-data"]');
  registerPendingBar(pendingBar, inputEl);
  // Affiche/masque le bandeau « assistant occupé » dans la barre de saisie.
  function setBusyHint(visible) {
    superSetBusyHint(visible);
  }
  superSetBusyHint = (visible) => {
    if (busyHint) busyHint.hidden = !visible;
  };

  // Évolution UI : teinte « réflexion » du fond de la zone de saisie. Quand
  // l'assistant réfléchit (agent_start → agent_end), on applique la classe
  // `superagent-input-reflecting` au conteneur de la barre de saisie
  // (`inputBar`) : un dégradé discret basé sur --superagent-accent (même
  // couleur que le cercle respirant) apparaît en douceur. Disparaît au repos.
  // Réutilise le MÊME signal d'état que `busyHint`/`backendBusy` (agent_start /
  // agent_end), pas une nouvelle source de vérité. Ne verrouille pas la saisie
  // (le textarea reste utilisable) et ne touche pas au contenu saisi.
  // Ce signal suit UNIQUEMENT la session de l'Assistant (voir
  // `superAgentInputReflecting`) : le travail des agents des projets garde son
  // propre indicateur (point de la liste, compteur « Travail ») et ne fait
  // jamais clignoter cette zone de saisie.
  function setReflecting(reflecting) {
    superSetReflecting(reflecting);
  }
  // Teinte « réflexion », commune aux deux modes : la classe
  // `superagent-input-reflecting` fait respirer le fond de la barre — en mode
  // standard sur la barre de l'onglet, en mode assistant seul sur la barre
  // DÉPLACÉE dans l'overlay (mêmes classes CSS, donc même respiration ; cet
  // effet y avait été retiré par mégarde par la maquette V4). En mode
  // immersif s'ajoute l'anneau pulsant autour du cercle du logo hero (classe
  // `sa-immersive-reflecting`). L'état est mémorisé (`reflectingActive`) pour
  // resynchroniser l'effet au bon endroit quand on bascule de mode pendant
  // une réflexion (voir applyReflecting appelé par enterImmersive /
  // exitImmersive).
  let reflectingActive = false;
  // ── LOT 2 : etat de l'ecran Vocal (RAPPORT-trois-modes-ecran-vocal.md §2 a §4) ──
  // Declares ICI, et pas dans la section de l'ecran, pour une raison d'ORDRE :
  // `setReflecting` (juste en dessous) est appele des l'ouverture de l'onglet et
  // resynchronise cet ecran (`applyVocalState`). Les declarer plus bas les
  // exposerait a la zone morte temporelle (`let`) pendant ces premiers appels.
  let vocalOverlay = null;
  // Places d'origine (parent + voisin suivant) des deux noeuds DEPLACES : le
  // bouton unique des modes et la barre de saisie. Patron identique a celui de
  // « Travail » : restitution exacte, sans doublon ni perte.
  let vocalModeButtonHome = null;
  let vocalInputHome = null;
  // Placeholder d'origine de la zone de saisie : l'ecran Vocal en pose un plus
  // court (§2.4, « Écrivez, ou parlez. ») et le restitue tel quel a la sortie.
  let vocalPlaceholderHome = null;
  // true pendant que la lecture a voix haute tourne (evenement
  // `pilot-read-aloud-state`, emis par read-aloud.js) : SEULE source de l'etat
  // « Pilot parle ». Aucun second lecteur n'est cree.
  let vocalSpeaking = false;
  // ── LOT 3 : le micro REEL de l'ecran Vocal ──
  // La mecanique (flux, analyseur, lissage, arret des pistes) vit dans
  // vocal-mic.js. Ici, trois etats seulement :
  //  - `vocalMicListening` : vrai SEULEMENT quand le micro capte reellement —
  //    c'est la SEULE source de l'etat « ecoute » (ni une intention, ni une
  //    demande de permission) ;
  //  - `vocalMicFerme` : message clair quand le micro est ferme (refus, absence,
  //    occupation, panne) — le mode reste utilisable et rien n'est bloque ;
  //  - `vocalMicDemande` : la demande de permission est partie. Elle ne se
  //    represente pas toute seule : seul le bouton « Autoriser le micro » la
  //    relance (jamais une demande a l'entree du mode).
  let vocalMic = null;
  let vocalMicListening = false;
  let vocalMicFerme = "";
  let vocalMicDemande = false;
  // Aucune autre source n'alimente cette teinte : l'anneau du logo hero du mode
  // assistant seul, le bandeau « occupe », le bouton « Analyser et ranger mes
  // donnees » et le travail des agents des projets gardent leur propre signal.
  function applyReflecting() {
    const pending = hasPendingQuestion();
    // Anneau pulsant du logo hero (mode assistant seul) : inchange, lie a la
    // seule reflexion de l'Assistant.
    if (immersiveOverlay) {
      const hero = immersiveOverlay.querySelector(".sa-immersive-hero");
      if (hero) hero.classList.toggle("sa-immersive-reflecting", reflectingActive && !pending);
    }
    // Zone de saisie : une seule decision (superAgentInputReflecting), meme
    // style et meme animation que ceux deja appliques (aucune regle CSS
    // nouvelle). Aucun abonnement a l'etat global des agents : la zone ne
    // respire que pendant le travail de l'Assistant lui-meme.
    const inputActive = superAgentInputReflecting({
      agentReflecting: reflectingActive,
      pendingQuestion: pending,
    });
    if (inputBar) inputBar.classList.toggle("superagent-input-reflecting", inputActive);
  }
  superSetReflecting = (reflecting) => {
    // Chantier #132 : pendant l'attente d'un choix (question en attente), la
    // barre ne passe PAS en teinte « réflexion » — elle reste en mode normal,
    // prête à saisir la précision. La teinte ne s'applique qu'au travail
    // réel (aucune question en attente).
    reflectingActive = !!reflecting;
    applyReflecting();
    // LOT 2 : l'ecran Vocal suit la MEME source d'etat (aucune nouvelle source
    // de verite) — l'objet passe en « reflexion » des que l'Assistant traite.
    applyVocalState();
    // Bouton « Analyser et ranger mes données » : désactivé pendant que
    // l'Assistant travaille (MÊME signal que la teinte de réflexion, pas une
    // nouvelle source de vérité). Deux conséquences voulues : l'utilisateur
    // voit immédiatement que le travail a démarré, et un second clic ne peut
    // pas lancer une analyse en parallèle.
    if (analyzeDataBtn) {
      analyzeDataBtn.disabled = !!reflecting;
      analyzeDataBtn.title = reflecting
        ? "Analyse en cours… (lecture seule : rapport + proposition de rangement)"
        : "Analyser et ranger mes données (analyse en lecture seule : rapport + proposition de rangement)";
    }
  };

  // ── Chargement de la liste des modèles ──
  // Source primaire : lecture fichier models.json (get_available_models_list),
  // fiable et sans dépendre d'une session. Fallback : RPC list_agent_models
  // (nécessite la session de l'agent de coding standard).
  async function loadModels() {
    let models = [];
    // 1. Lecture fichier (aucune session requise).
    try {
      const list = await invoke("get_available_models_list");
      if (Array.isArray(list) && list.length > 0) {
        models = list.map((s) => {
          const idx = s.indexOf("/");
          return { provider: idx >= 0 ? s.slice(0, idx) : s, id: idx >= 0 ? s.slice(idx + 1) : "", label: s };
        });
      }
    } catch (e) {
      console.warn("get_available_models_list (fichier) échoué:", e);
    }
    // 2. Fallback RPC (session agent standard).
    if (models.length === 0) {
      try {
        const result = await invoke("list_agent_models");
        if (result && result.data && Array.isArray(result.data.models)) models = result.data.models;
        else if (result && Array.isArray(result.data)) models = result.data;
        else if (result && Array.isArray(result)) models = result;
        models = models.map((m) => {
          if (typeof m === "string") {
            const idx = m.indexOf("/");
            return { provider: idx >= 0 ? m.slice(0, idx) : m, id: idx >= 0 ? m.slice(idx + 1) : "", label: m };
          }
          return m;
        });
      } catch (e) {
        console.warn("list_agent_models (RPC) échoué:", e);
      }
    }
    if (models.length === 0) {
      modelSelect.innerHTML = '<option value="">Aucun modèle</option>';
      return;
    }
    let html = "";
    for (const m of models) {
      const provider = m.provider || m.providerId || "?";
      const id = m.id || m.modelId || "?";
      const label = m.label || `${provider}/${id}`;
      html += `<option value="${provider}/${id}">${label}</option>`;
    }
    modelSelect.innerHTML = html;
    // Appliquer un modèle à la session : d'abord le modèle courant s'il existe,
    // sinon le modèle par défaut (registre global). Ne jamais laisser un échec de
    // get_super_agent_state bloquer l'application du défaut.
    let cur = "";
    try {
      const st = await invoke("get_super_agent_state");
      if (st && st.data && st.data.model) {
        cur = (st.data.model.provider || "") + "/" + (st.data.model.id || "");
      } else if (st && st.currentModel) {
        cur = st.currentModel;
      }
    } catch (_) {}
    if (cur && Array.from(modelSelect.options).some((o) => o.value === cur)) {
      modelSelect.value = cur;
    } else {
      // Aucun modèle actif : résoudre le défaut et l'appliquer à la session.
      let def = "";
      try {
        const kind = backendKind();
        const stem = (kind && kind !== "unknown") ? kind : "pi";
        const acfg = await invoke("read_model_aliases", { stem });
        if (acfg && typeof acfg.defaultModel === "string") def = acfg.defaultModel;
      } catch (_) {}
      if (def && Array.from(modelSelect.options).some((o) => o.value === def)) {
        modelSelect.value = def;
        const [provider, modelId] = def.split("/", 2);
        try {
          await invoke("set_super_agent_model", { provider, modelId });
        } catch (_) {}
      }
    }
  }

  // ── Changement de modèle ──
  modelSelect.addEventListener("change", async () => {
    const value = modelSelect.value;
    if (!value) return;
    const [provider, modelId] = value.split("/", 2);
    try {
      await invoke("set_super_agent_model", { provider, modelId });
      appendSystemMessage(messagesEl, `🔄 Modèle changé : ${provider}/${modelId}`);
    } catch (err) {
      appendSystemMessage(messagesEl, `❌ Impossible de changer de modèle : ${err}`);
    }
  });

  // ── Démarrage de la session (lazy côté Rust, mais on l'initie ici) ──
  // Fire-and-forget : ne PAS attendre le spawn du processus pi + handshake RPC
  // (peut prendre plusieurs secondes). Le démarrage de l'onglet 🧭 (et donc de
  // Pilot au démarrage) ne doit pas patienter. La session se lance en
  // arrière-plan ; `send_super_agent_prompt` la démarre paresseusement si besoin.
  invoke("start_super_agent_session").catch((err) => {
    console.error("Erreur démarrage session super-agent:", err);
  });
  // Tâche #136 : au démarrage de l'onglet, détecter une absence d'outils de
  // l'assistant (anomalie) et afficher la bannière le cas échéant. Fire-and-
  // forget : ne bloque pas l'ouverture de l'onglet.
  checkSuperAgentTools(toolsBanner);
  // T5 : à l'ouverture de l'onglet 🧭, rejouer les résumés en attente
  // (comptes-rendus persistés mais jamais délivrés car session fermée/occupée).
  // Fire-and-forget : ne bloque pas l'ouverture de l'onglet.
  invoke("replay_superagent_summaries").catch((err) => {
    console.error("Erreur rejeu résumés super-agent:", err);
  });
  // Mémoire de session (reprise) : après un redémarrage de Pilot, afficher où on
  // en est (sujet en cours / chantiers en cours) pour que l'utilisateur reprenne
  // la discussion. Fail-open : sans mémoire, on n'affiche rien.
  invoke("super_agent_load_session_memory")
    .then((resume) => {
      if (resume) {
        appendSystemMessage(messagesEl, `🔁 Reprise de session — ${sessionMemorySummary(resume)}`);
      }
    })
    .catch(() => {});
  loadModels();

  // État de streaming
  let isStreaming = false;
  // Bug 1 (UX) : vrai quand on a déjà informé l'utilisateur qu'il ne peut pas
  // envoyer pendant que l'assistant est occupé (évite de répéter le message).
  let busyNotified = false;
  // État partagé pour le rendu des questions (boutons pilot-choices).
  const state = { currentAssistantBlock: null };

  // ── Dictée vocale (Web Speech API) — comme l'agent standard ──
  // Transcription navigateur (cloud sur WebView2 Windows). Masqué si
  // SpeechRecognition non supporté. Desktop = secure context.
  const VOICE_LANG = "fr-FR";
  const voiceSupported = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const micBtn = inputBar.querySelector(".agent-mic-btn");
  if (micBtn && !voiceSupported) micBtn.style.display = "none";
  // Libellé au repos du bouton micro (rétabli à chaque fin de dictée : aucun
  // bouton ne doit rester affiché « Arrêter la dictée » sans écoute).
  const MIC_TITLE_IDLE = "Dictée vocale (transcription cloud)";
  let voiceActive = false;
  let voiceRec = null;
  // Reprise en main : `true` quand l'UTILISATEUR a tapé, collé ou vidé la zone de
  // saisie PENDANT l'écoute. Les écritures du moteur de reconnaissance sont
  // programmatiques (`inputEl.value = …`) et n'émettent AUCUN évènement `input` :
  // tout `input` reçu pendant l'écoute vient donc de l'utilisateur. Dans ce cas,
  // la zone n'est plus réécrite (sa saisie prime) et rien ne part tout seul
  // (décision : `decideVoiceAutoSend({ userEdited })`, même règle que l'agent π).
  let voiceUserTookOver = false;
  if (inputEl) {
    inputEl.addEventListener("input", () => {
      if (voiceActive) voiceUserTookOver = true;
    });
  }

  function stopVoiceInput() {
    // Empêche onresult/onend de réécrire le textarea après l'envoi.
    voiceActive = false;
    if (voiceRec) { try { voiceRec.stop(); } catch (_) {} }
    if (micBtn) { micBtn.classList.remove("rec"); micBtn.title = MIC_TITLE_IDLE; }
  }

  /**
   * Plafond de hauteur de la zone de saisie : 200 px dans l'onglet, 120 px en
   * mode Vocal (§2.4) — l'objet lumineux ne doit jamais etre ecrase par une
   * saisie qui grandit. Aucune autre difference : meme noeud, meme envoi.
   */
  function inputMaxHeight() {
    return vocalOverlay ? 120 : 200;
  }

  function resizeInput() {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, inputMaxHeight()) + "px";
  }

  function toggleVoiceInput() {
    if (!voiceSupported) return;
    if (isStreaming) { appendSystemMessage(messagesEl, "⏳ L'assistant est en cours, patiente la fin pour dicter."); return; }
    if (voiceActive) { stopVoiceInput(); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = VOICE_LANG;
    rec.interimResults = true;
    rec.continuous = true;
    const preText = inputEl.value;
    let finalText = "";
    // Chaque dictée repart d'une zone « non reprise en main » : le drapeau ne
    // survit jamais à la dictée précédente.
    voiceUserTookOver = false;
    const norm = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");
    rec.onresult = (e) => {
      if (!voiceActive) return;
      // Chrome Android (continuous=true) finalise des résultats cumulatifs (chaque
      // résultat contient les précédents) ; desktop incrémental → concaténer.
      const finals = [];
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finals.push(r[0].transcript);
        else interim = r[0].transcript;
      }
      if (finals.length >= 2 && norm(finals[finals.length - 1]).startsWith(norm(finals[finals.length - 2]))) {
        finalText = finals[finals.length - 1];
      } else {
        finalText = finals.join(" ");
      }
      let transcript;
      if (interim) {
        if (finalText && norm(interim).startsWith(norm(finalText))) transcript = interim;
        else transcript = (finalText ? finalText + " " : "") + interim;
      } else {
        transcript = finalText;
      }
      if (voiceUserTookOver) return; // l'utilisateur a repris la main : sa saisie prime
      const sep = preText && !preText.endsWith(" ") ? " " : "";
      inputEl.value = preText + sep + transcript;
      resizeInput();
    };
    rec.onerror = (ev) => {
      // Session refermée ICI : la fin d'écoute qui suit (onend) ne doit RIEN
      // envoyer (erreur de reconnaissance, refus de permission, panne réseau).
      voiceActive = false; voiceRec = null;
      if (micBtn) { micBtn.classList.remove("rec"); micBtn.title = MIC_TITLE_IDLE; }
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        appendSystemMessage(messagesEl, "🎙️ Micro indisponible (" + ev.error + "). Vérifie qu'un micro est branché et autorisé (Réglages Windows → Confidentialité → Micro → applications de bureau). Alternative : web remote (HTTPS) depuis un téléphone ou un autre PC.");
      } else if (ev.error !== "no-speech" && ev.error !== "aborted") {
        appendSystemMessage(messagesEl, "🎙️ Erreur de dictée : " + ev.error);
      }
    };
    rec.onend = () => {
      // `wasActive` est lu AVANT de refermer la session : c'est la seule chose qui
      // distingue une fin NORMALE d'une fin sur erreur / arrêt manuel, et c'est
      // aussi ce qui empêche un second envoi si `onend` arrive deux fois.
      const wasActive = voiceActive;
      // Décision et ORDRE (refermer → écrire → envoyer) délégués au module PARTAGÉ
      // `applyVoiceEnd` — le même que l'onglet agent π. L'envoi emprunte le chemin
      // EXISTANT (Entrée / bouton Envoyer, fonction `send`) : aucun second
      // mécanisme, et la zone est vidée par ce même chemin.
      applyVoiceEnd({
        sessionActive: wasActive,
        preText,
        dictatedText: finalText,
        userEdited: voiceUserTookOver,
        closeSession: () => { voiceActive = false; voiceRec = null; },
        write: (value) => { inputEl.value = value; resizeInput(); },
        send: () => { send(); },
      });
      if (micBtn) { micBtn.classList.remove("rec"); micBtn.title = MIC_TITLE_IDLE; }
    };
    try {
      rec.start();
      voiceRec = rec; voiceActive = true;
      if (micBtn) { micBtn.classList.add("rec"); micBtn.title = "Arrêter la dictée"; }
    } catch (err) {
      appendSystemMessage(messagesEl, "🎙️ Impossible de démarrer la dictée : " + err.message);
    }
  }

  // ── Écoute des événements RPC ──
  const unlisten = await listen(SUPERAGENT_CHANNEL, (event) => {
    const payload = event.payload;
    try {
      handleSuperAgentEvent(payload, messagesEl, statusEl, state, () => {
        isStreaming = false;
        backendBusy = false;
        busyNotified = false;
        setBusyHint(false);
        setReflecting(false);
        currentBody = null;
        currentFlow = null;
        currentTextSection = null;
        currentThinkingBlock = null;
        pendingText = "";
        pendingRender = false;
        lastAssistantRawText = "";
        state.currentAssistantBlock = null;
        // Fin de tour → snapshot consommé : les bulles affichées gardent leurs
        // badges figés ; le prochain envoi capturera un nouveau snapshot.
        currentTurnProjectBadges = null;
        currentTurnConcernedBadges = [];
        // Issue #55 : fin de tour → reset du buffer de détection de boucle.
        superLoopBuffer = "";
        superLoopToolCalls = [];
        superLoopStopped = false;
        // Assistant libéré → rejouer les comptes rendus mis en attente (fin de
        // run survenue pendant que l'assistant rédigeait).
        flushPendingSuperAgentReports().catch(() => {});
        // LOT 2 (§5) : en mode Vocal, la réponse qui vient de se terminer est lue
        // à voix haute. On actionne le bouton d'écoute existant (aucune seconde
        // lecture) ; hors mode Vocal, cette fonction ne fait rien.
        autoReadVocalReply();
      });
    } catch (err) {
      console.error("[rpc-event-superagent] erreur:", err);
    }
  });

  // ── Mode « Assistant Only » immersif (A19) ──
  // Overlay plein écran : tout est masqué sauf le chat + une barre minimale
  // (bouton retour + titre + ⚙) + hero (logo rond + accueil, maquette V4).
  // Réutilise les éléments existants (messagesEl, inputBar) en les DÉPLAÇANT
  // dans l'overlay — aucun rendu dupliqué, la dictée vocale et le rendu du
  // chat restent ceux de l'onglet normal. Le dernier mode choisi est mémorisé
  // (localStorage) et restauré à la réouverture de l'onglet.
  // Ajustements A19 : ni bouton de synthèse vocale (🔊), ni suivi du travail
  // (cercle + panneau) dans ce mode — ils restent propres au mode standard.
  // Le NOM de la cle est celui de `screen-mode.js` (une seule source) : il
  // n'est plus lu ici, il continue d'etre ECRIT pour permettre un retour
  // arriere vers une version anterieure (RAPPORT §1.3).
  const IMMERSIVE_KEY = LEGACY_IMMERSIVE_KEY;
  let immersiveOverlay = null;
  // Résumé des agents repliable (point ⇆ liste, barre du haut) : désabonnement
  // au store partagé de agent-activity.js, posé à l'entrée et retiré à la
  // sortie du mode.
  let immersiveAgentsUnsubscribe = null;
  // Suivi du travail (« Travail » + compteur « en cours / total ») : en mode
  // assistant seul, le MEME noeud du mode normal est DEPLACE dans la barre du
  // mode (jamais recopie, jamais recalcule). On memorise ici sa place
  // d'origine (parent + voisin suivant) pour une restitution EXACTE a la
  // sortie : aucune place perdue, aucun doublon.
  let immersiveActivityHome = null;
  // LOT 1 (trois modes d'ecran) : le bouton UNIQUE des modes est DEPLACE dans
  // la barre du mode, juste apres le titre « Pilot » (meme noeud, jamais
  // recopie), avec memorisation de sa place d'origine pour une restitution
  // EXACTE a la sortie — meme patron que « Travail » juste au-dessus.
  let immersiveModeButtonHome = null;
  // Éléments créés avec l'overlay, réutilisés à chaque entrée en mode immersif.
  let immersiveSuggestions = null;
  let immersiveDisclaimer = null;

  /** Nom réel de l'assistant courant (config de l'onglet 🧭), avec fallback
   * propre si aucun nom n'est disponible. */
  function immersiveAssistantName() {
    const label = (superAgentDisplayLabel() || "").trim();
    return label || "Pilot Assistant";
  }

  function buildImmersiveOverlay() {
    const ov = document.createElement("div");
    ov.className = "superagent-immersive";
    // Barre du haut conforme à la maquette ASS_Only_V4 : gauche = bouton
    // retour (flèche) + titre « Pilot » ; droite = résumé des agents REPLIÉ
    // par défaut en un petit point unique (respire quand un agent ou
    // l'assistant travaille, via le store partagé agent-activity.js ; un clic
    // déploie la liste informative, un second clic replie) + UN SEUL bouton ⚙
    // qui ouvre les paramètres existants de l'assistant (modale Paramètres,
    // onglet « Assistant »). Sous la barre : hero (logo Pilot rond dans un
    // cercle + message d'accueil, comme la maquette). Les suggestions et le disclaimer
    // vivent dans la zone basse (.sa-suggestions / .sa-immersive-disclaimer)
    // — les éléments du chat (messagesEl, inputBar…) sont DÉPLACÉS dans
    // l'overlay, jamais dupliqués.
    ov.innerHTML = `
      <div class="sa-immersive-top">
        <button class="agent-btn sa-immersive-back" data-imm="back" title="Revenir au mode standard"><i data-lucide="arrow-left" class="icon"></i></button>
        <span class="sa-immersive-title">Pilot</span>
        <div class="sa-immersive-agents" data-imm="agents"></div>
        <button class="agent-btn sa-immersive-settings" data-imm="settings" title="Options de l'assistant"><i data-lucide="settings" class="icon"></i></button>
      </div>
      <div class="sa-immersive-hero">
        <div class="sa-immersive-hero-mark"><img src="/logo_pilot_vector.svg" alt="Pilot"></div>
        <h1 class="sa-immersive-hero-title">Bonjour, je suis ${immersiveAssistantName()}</h1>
        <div class="sa-immersive-hero-subtitle">Comment puis-je vous aider aujourd'hui&nbsp;?</div>
      </div>
      <div class="sa-immersive-messages"></div>
      <div class="sa-immersive-input"></div>
    `;
    ov.querySelector('[data-imm="back"]').addEventListener("click", exitImmersive);
    ov.querySelector('[data-imm="settings"]').addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("pilot-open-settings", { detail: { tab: "superagent" } }));
    });
    // Suggestions (maquette V4, cahier des charges §4.3) : chips cliquables
    // qui PRÉREMPLISSENT la zone de saisie et lui donnent le focus — elles
    // n'envoient PAS (cohérent avec le comportement du chat).
    const sugg = document.createElement("div");
    sugg.className = "sa-suggestions";
    for (const label of [
      "Faire un point sur un projet",
      "Déléguer une demande à l'agent",
      "Préparer une livraison",
      "Lister les tâches en cours",
    ]) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = label;
      chip.addEventListener("click", () => {
        inputEl.value = label;
        resizeInput();
        inputEl.focus();
      });
      sugg.appendChild(chip);
    }
    immersiveSuggestions = sugg;
    // Disclaimer (maquette V4) : mention discrète sous la barre de saisie,
    // déplacée dans l'overlay à l'entrée, retirée à la sortie.
    const disclaimer = document.createElement("div");
    disclaimer.className = "sa-immersive-disclaimer";
    disclaimer.textContent = "Pilot Assistant peut se tromper. Vérifiez les informations importantes.";
    immersiveDisclaimer = disclaimer;
    return ov;
  }

  function enterImmersive() {
    if (immersiveOverlay) return;
    // JAMAIS deux pleins ecrans superposes (§3.2) : le mode Vocal se retire
    // d'abord, meme si l'appelant (raccourci, bascule, restauration) a oublie
    // de le faire. La garde est ici, au seul endroit qui cree l'overlay.
    if (vocalOverlay) exitVocal();
    immersiveOverlay = buildImmersiveOverlay();
    // Résumé des agents : replié en un point qui respire quand un agent ou
    // l'assistant travaille ; un clic déploie la liste, un second replie.
    // Abonnement au store partagé de agent-activity.js (même source de
    // données que l'indicateur du mode standard). Désabonnement à la sortie
    // (exitImmersive).
    immersiveAgentsUnsubscribe = mountCollapsibleAgentList(
      immersiveOverlay.querySelector('[data-imm="agents"]')
    );
    immersiveOverlay.querySelector(".sa-immersive-messages").appendChild(messagesEl);
    const immInput = immersiveOverlay.querySelector(".sa-immersive-input");
    // Suggestions (préremplissent la saisie, n'envoient pas).
    if (immersiveSuggestions) immInput.appendChild(immersiveSuggestions);
    if (busyHint && busyHint.parentNode) busyHint.parentNode.removeChild(busyHint);
    immInput.appendChild(busyHint);
    immInput.appendChild(inputBar);
    if (pendingBar) immInput.appendChild(pendingBar);
    // Disclaimer (maquette V4) : mention sous la barre de saisie.
    if (immersiveDisclaimer) immInput.appendChild(immersiveDisclaimer);
    // Suivi du travail : l'entree « Travail » (point + mot + compteur
    // « en cours / total » + son panneau a trois onglets) est DEPLACEE dans la
    // barre du mode, juste a gauche du resume des agents. C'est le MEME noeud
    // DOM, peint par le MEME code (agent-activity.js) et alimente par la MEME
    // source (publishSuperMissionsCount) : les deux modes ne peuvent pas
    // afficher deux nombres differents, et il n'existe aucun second calcul.
    const activity = document.getElementById("agent-activity");
    const agentsHost = immersiveOverlay.querySelector('[data-imm="agents"]');
    if (activity && agentsHost && agentsHost.parentNode) {
      immersiveActivityHome = { parent: activity.parentNode, next: activity.nextSibling };
      agentsHost.parentNode.insertBefore(activity, agentsHost);
    }
    // LOT 1 (trois modes d'ecran) : le bouton UNIQUE des modes est DEPLACE ici,
    // juste apres le titre « Pilot » — donc AVANT l'entree « Travail », qui
    // reste elle-meme avant le point des agents (ordre : retour, titre, MODE,
    // Travail, agents, ⚙). Un seul noeud dans tout le document : la rangee
    // d'onglets ne le perd pas, il y revient a la sortie.
    const screenModeButton = document.getElementById(SCREEN_MODE_BUTTON_ID);
    if (screenModeButton && agentsHost && agentsHost.parentNode) {
      immersiveModeButtonHome = {
        parent: screenModeButton.parentNode,
        next: screenModeButton.nextSibling,
      };
      const ancre =
        activity && activity.parentNode === agentsHost.parentNode ? activity : agentsHost;
      agentsHost.parentNode.insertBefore(screenModeButton, ancre);
    }
    document.body.appendChild(immersiveOverlay);
    document.body.classList.add("superagent-immersive-active");
    refreshIcons(immersiveOverlay);
    localStorage.setItem(IMMERSIVE_KEY, "1");
    // Mode REELLEMENT affiche : la cle de memoire suit (sans ecraser un mode
    // demande par le bouton — « Vocal » emprunte cet ecran au lot 1).
    noteImmersiveEntered();
    // Ajustements A19 : si l'assistant réfléchissait déjà au moment de la
    // bascule, reporter l'indicateur sur le logo hero (et calmer la barre).
    applyReflecting();
    // Issue #82 : la conversation (messagesEl déplacé dans l'overlay) ne
    // réinitialisait jamais le scroll → mode immersif ouvert en haut au lieu
    // du bas (dernier message) après une remontée de l'historique. Réarme le
    // suivi automatique puis force le bas, en réutilisant scrollSuperToBottom.
    superAtBottom = true;
    scrollSuperToBottom(messagesEl);
  }

  function exitImmersive() {
    if (!immersiveOverlay) return;
    // Résumé des agents : désabonnement au store partagé.
    if (immersiveAgentsUnsubscribe) {
      immersiveAgentsUnsubscribe();
      immersiveAgentsUnsubscribe = null;
    }
    // Remettre chaque élément à sa place d'origine, dans le bon ordre, pour
    // rester symétrique avec enterImmersive (sans doublon ni perte).
    // messagesEl était le premier enfant du wrapper (avant la toolbar).
    wrapper.insertBefore(messagesEl, toolbar);
    // inputBar doit être dans le wrapper AVANT d'insérer busyHint devant lui
    // (sinon insertBefore lève une DOMException et le retour échoue).
    wrapper.appendChild(inputBar);
    wrapper.insertBefore(busyHint, inputBar);
    // pendingBar revenait en fin de wrapper. (statusEl n'est plus déplacé : il
    // reste dans la toolbar, masqué par la règle T6 — l'indicateur d'activité
    // n'apparaît plus en mode immersif. Le panneau des événements n'est plus
    // déplacé non plus : il reste en mode standard, ajustement A19.)
    wrapper.appendChild(pendingBar);
    // Suivi du travail : restitution EXACTE dans la rangee d'onglets (meme
    // parent, meme voisin), AVANT le retrait de l'overlay — sinon le noeud
    // serait detruit avec lui et le mode normal perdrait son compteur.
    //
    // ORDRE DE RESTITUTION (lot 1) : le bouton des MODES d'abord, l'entree
    // « Travail » ensuite. A l'entree, la place d'origine de « Travail » etait
    // le bouton des modes ; comme celui-ci est lui aussi dans l'overlay, son
    // voisin est momentanement introuvable et « Travail » serait ajoute en fin
    // de rangee (apres les boutons systeme). En restaurant le bouton d'abord,
    // le voisin de « Travail » redevient valide : l'ordre d'origine
    // (« Travail » -> MODE -> boutons systeme) est rendu a l'identique.
    const modeHome = immersiveModeButtonHome;
    const modeButton = document.getElementById(SCREEN_MODE_BUTTON_ID);
    if (modeButton && modeHome && modeHome.parent) {
      const next = modeHome.next && modeHome.next.parentNode === modeHome.parent ? modeHome.next : null;
      modeHome.parent.insertBefore(modeButton, next);
    }
    immersiveModeButtonHome = null;
    const activity = document.getElementById("agent-activity");
    if (activity && immersiveActivityHome && immersiveActivityHome.parent) {
      const home = immersiveActivityHome;
      const next = home.next && home.next.parentNode === home.parent ? home.next : null;
      home.parent.insertBefore(activity, next);
    }
    immersiveActivityHome = null;
    // Disclaimer : retiré avec l'overlay (réinséré à la prochaine entrée).
    if (immersiveDisclaimer && immersiveDisclaimer.parentNode) immersiveDisclaimer.remove();
    immersiveOverlay.remove();
    immersiveOverlay = null;
    document.body.classList.remove("superagent-immersive-active");
    localStorage.setItem(IMMERSIVE_KEY, "0");
    // Mode REELLEMENT affiche : retour a « Detaille » dans la cle de memoire.
    noteImmersiveExited();
    // Ajustements A19 : si l'assistant réfléchissait encore, reporter
    // l'indicateur sur la barre de saisie (comportement du mode standard).
    applyReflecting();
  }

  // ── LOT 2 : ecran du mode Vocal (RAPPORT-trois-modes-ecran-vocal.md §2 a §4) ──
  // Un SECOND plein ecran, JAMAIS superpose a celui de l'assistant seul : on
  // sort d'abord de l'autre mode, puis on entre ici. Rien du chat n'est
  // redessine : la barre de saisie de l'onglet Assistant est DEPLACEE ici (meme
  // noeud, meme envoi, meme dictee) et restituee exactement a la sortie. Aucun
  // historique n'est affiche pendant la conversation (decision de coordination
  // du lot 2) : seulement l'objet, la ligne d'etat et la saisie.
  //
  // Ce que ce mode N'A PAS (et ne pretend pas avoir) :
  //   - la REPRISE de l'ecoute apres la reponse et le mode conversation
  //     continue (suite du lot 4) : Pilot ne relance jamais une lecture tout
  //     seul apres avoir ete coupe ;
  //   - d'historique : l'ecran ne montre rien de la conversation.
  // Le micro et le niveau reel sont du LOT 3 (voir vocal-mic.js). La COUPURE de
  // Pilot quand on parle par-dessus lui est du LOT 4a : voir `vocalBargeIn`.
  const VOCAL_ACTIVE_CLASS = "pilot-vocal-active";
  // Les etats de l'ecran Vocal (`vocalOverlay`, places d'origine, `vocalSpeaking`)
  // sont declares plus HAUT, juste apres `reflectingActive` : `setReflecting` les
  // lit des l'ouverture de l'onglet. Ici ne restent que les fonctions.

  /**
   * LOT 3 : longueur du trait = NIVEAU MESURE. En mouvement reduit, rien n'est
   * pose : le CSS fige alors la longueur par etat (§4.3), et une valeur posee
   * en ligne ecraserait cette regle figee.
   */
  function vocalSetLevel(niveau) {
    if (!vocalOverlay) return;
    const plan = planLevel({ niveau, reduit: vocalReducedMotion() });
    if (!plan.ecrire) return;
    vocalOverlay.style.setProperty("--vocal-level", plan.largeur + "%");
  }

  /** Retire la valeur posee : le trait retombe au silence (8 %). */
  function vocalClearLevel() {
    if (!vocalOverlay) return;
    vocalOverlay.style.removeProperty("--vocal-level");
  }

  /**
   * Etat « ecoute » : vrai SEULEMENT quand le micro capte vraiment (§2.3).
   * Aucune demande de permission, aucune intention ne l'allume.
   */
  function vocalSetListening(actif) {
    const etait = vocalMicListening;
    vocalMicListening = actif === true;
    if (!vocalMicListening) vocalClearLevel();
    if (etait !== vocalMicListening) applyVocalState();
  }

  /**
   * Micro ferme (refus, absence, occupation, panne) : un message clair le dit et
   * un bouton permet de reessayer. Le mode Vocal reste entierement utilisable
   * (ligne d'etat, saisie, envoi, lecture) : jamais de blocage.
   */
  function vocalMicFailure(message) {
    vocalMicListening = false;
    vocalMicFerme = String(message || MIC_FERME);
    vocalClearLevel();
    applyVocalState();
  }

  /**
   * La permission part au PREMIER GESTE dans le mode, jamais a l'entree. Un seul
   * essai automatique : un refus ne se represente pas tout seul, c'est le bouton
   * « Autoriser le micro » qui relance (geste explicite).
   */
  function onVocalFirstGesture() {
    if (!vocalOverlay || !vocalMic) return;
    const demander = shouldAskVocalMic({
      geste: true,
      dejaDemande: vocalMicDemande,
      microActif: vocalMicListening,
    });
    if (!demander) return;
    vocalMicDemande = true;
    vocalMic.demander().then(() => {
      // LOT 4a : le micro vient peut-etre de s'ouvrir PENDANT que Pilot lit ;
      // la garde doit alors s'armer sur l'etat reel de la lecture.
      vocalSyncMicSpeaking();
    });
  }

  function buildVocalOverlay() {
    const ov = document.createElement("div");
    ov.className = "pilot-vocal vocal-state-idle";
    // Mouvement REDUIT (§4.3) : meme drapeau que les animations d'ouverture,
    // aucun nouveau reglage. Le CSS coupe alors les animations et fige la
    // longueur du trait par etat.
    if (vocalReducedMotion()) ov.classList.add("vocal-reduced");
    // Structure (de haut en bas) : la barre de 44 px (qui recoit le bouton des
    // modes), l'objet lumineux + son trait + l'UNIQUE ligne d'etat, puis la
    // zone de saisie discrete. Aucun cadre, aucune carte, aucune bordure
    // autour de l'objet.
    ov.innerHTML = `
      <div class="vocal-top"></div>
      <div class="vocal-stage">
        <div class="vocal-orb" aria-hidden="true"></div>
        <div class="vocal-level" aria-hidden="true"><span class="vocal-level-bar"></span></div>
        <div class="vocal-status" role="status" aria-live="polite">Je vous écoute.</div>
        <!-- LOT 3 (§2.5) : bouton de depannage, MASQUE tant que le micro capte.
             Il n'apparait que si le micro est ferme (refus, absence, panne) ;
             le mode reste utilisable sans lui. -->
        <button type="button" class="vocal-mic-fix hidden">Autoriser le micro</button>
      </div>
      <div class="vocal-input"></div>
    `;
    return ov;
  }

  /** Applique l'etat visuel : UNE seule classe d'etat, et la ligne de texte. */
  function applyVocalState() {
    if (!vocalOverlay) return;
    const etats = {
      speaking: vocalSpeaking,
      reflecting: reflectingActive,
      listening: vocalMicListening,
    };
    const state = vocalScreenState(etats);
    vocalOverlay.classList.remove(
      "vocal-state-idle",
      "vocal-state-listening",
      "vocal-state-thinking",
      "vocal-state-speaking"
    );
    vocalOverlay.classList.add(vocalStateClass(etats));
    const ligne = vocalOverlay.querySelector(".vocal-status");
    // Une seule ligne (§2.3) : les trois phrases de l'ecran, et — au repos
    // seulement — le message clair du micro ferme quand il y en a un. La
    // parole et la reflexion gardent la priorite sur ce message.
    const texte = state === "idle" && vocalMicFerme ? vocalMicFerme : vocalStatusText(state);
    if (ligne && ligne.textContent !== texte) ligne.textContent = texte;
    const fix = vocalOverlay.querySelector(".vocal-mic-fix");
    if (fix) fix.classList.toggle("hidden", !vocalMicFerme);
  }

  /**
   * LOT 4a : « Pilot parle » est le SEUL signal qui arme la garde du micro
   * (`setSpeaking` dans vocal-mic.js). Il n'est jamais devine ici : il vient de
   * l'etat de la lecture, et la garde se remet a zero des qu'il retombe.
   */
  function vocalSyncMicSpeaking() {
    if (!vocalMic) return;
    vocalMic.setSpeaking(vocalSpeaking);
  }

  /**
   * LOT 4a : L'UTILISATEUR PARLE PAR-DESSUS PILOT -> Pilot se tait, tout de
   * suite et proprement (pas de phrase hachee, pas de reprise : une phrase est
   * toujours arretee entre deux morceaux, jamais au milieu d'un souffle).
   *
   * Trois regles tenues ici :
   *   1. L'ARRET emprunte la SEULE voie existante (`stopReading`, read-aloud.js) :
   *      aucun second lecteur, aucun second mecanisme.
   *   2. La DECISION d'arreter n'est pas prise ici : c'est la garde du micro
   *      (vocal-mic.js) qui la prend, et elle ne se declenche que si
   *      l'annulation d'echo est averee ET si le niveau depasse le residu d'echo
   *      qu'elle vient de mesurer. Une voix qui n'est que l'echo de Pilot ne peut
   *      donc pas le faire taire (voir `bargeInReport`).
   *   3. HORS mode Vocal, cette fonction ne fait rien : les autres ecrans lisent
   *      leurs reponses jusqu'au bout, comme avant.
   * @param {{residuel?: number, seuil?: number}} [rapport] chiffres de la mesure
   */
  function vocalBargeIn(rapport) {
    if (!vocalOverlay) return;
    if (!vocalSpeaking) return;
    // Trace chiffree de la mesure : elle ne s'affiche pas, elle sert a verifier
    // au vrai micro qu'aucune coupure ne part toute seule (residuel << seuil).
    try {
      if (typeof console !== "undefined" && console.info) {
        console.info(
          "[vocal] prise de parole : residu=" +
            (rapport ? rapport.residuel : "?") +
            " seuil=" +
            (rapport ? rapport.seuil : "?")
        );
      }
    } catch (_) {
      /* une console absente ne doit pas empecher de se taire */
    }
    stopReading();
    // L'objet repasse en « ecoute » (le micro capte deja, l'etat suit) et la
    // saisie reprend la main : le curseur y retourne pour dicter ou corriger
    // tout de suite. Aucune modale ouverte ne se fait voler le curseur.
    applyVocalState();
    if (inputEl && !document.querySelector(".modal:not(.hidden)")) {
      try {
        inputEl.focus();
      } catch (_) {
        /* un champ absent ne bloque rien */
      }
    }
  }

  function enterVocal() {
    if (vocalOverlay) return;
    // REGLE DE COORDINATION (§3.2) : deux pleins ecrans ne se superposent
    // jamais. On sort d'abord de « Assistant seul ».
    if (immersiveOverlay) exitImmersive();
    vocalOverlay = buildVocalOverlay();
    // Barre de saisie de l'onglet Assistant : DEPLACEE (meme noeud, meme envoi,
    // meme dictee). Sa place d'origine est memorisee pour une restitution
    // exacte a la sortie.
    const zone = vocalOverlay.querySelector(".vocal-input");
    if (inputBar && zone) {
      vocalInputHome = { parent: inputBar.parentNode, next: inputBar.nextSibling };
      zone.appendChild(inputBar);
    }
    // Bouton UNIQUE des modes : DEPLACE dans la barre haute (une seule barre de
    // 44 px, le bouton a gauche). Aucune copie, aucun second bouton.
    const barre = vocalOverlay.querySelector(".vocal-top");
    const modeButton = document.getElementById(SCREEN_MODE_BUTTON_ID);
    if (modeButton && barre) {
      vocalModeButtonHome = { parent: modeButton.parentNode, next: modeButton.nextSibling };
      barre.appendChild(modeButton);
    }
    document.body.appendChild(vocalOverlay);
    document.body.classList.add(VOCAL_ACTIVE_CLASS);
    refreshIcons(vocalOverlay);
    // ── LOT 3 : le micro de cet ecran ──
    // RIEN n'est ouvert a l'entree : la demande de permission part au PREMIER
    // GESTE dans le mode (un clic, une touche). On arme simplement l'ecoute des
    // gestes ; le moteur (vocal-mic.js) reste inerte jusque-la.
    vocalMicDemande = false;
    vocalMicListening = false;
    vocalMicFerme = "";
    vocalMic = createVocalMic({
      onLevel: vocalSetLevel,
      onListening: vocalSetListening,
      onFailure: vocalMicFailure,
      // LOT 4a : voix detectee par-dessus la lecture -> Pilot se tait.
      onSpeechStart: vocalBargeIn,
    });
    // Si Pilot lit DEJA au moment ou le micro s'ouvre, la garde part armee :
    // l'etat de la lecture est repose, jamais devine.
    vocalSyncMicSpeaking();
    vocalOverlay.addEventListener("pointerdown", onVocalFirstGesture);
    // La touche est ecoutee sur le document (et non sur l'ecran) : le mode Vocal
    // est le seul ecran visible a ce moment-la, et un focus qui n'est encore
    // dans aucun champ ne doit pas laisser le micro ferme pour toujours.
    document.addEventListener("keydown", onVocalFirstGesture);
    const fixMic = vocalOverlay.querySelector(".vocal-mic-fix");
    if (fixMic) {
      fixMic.addEventListener("click", () => {
        // Geste EXPLICITE : la demande repart. Un refus precedent ne condamne
        // pas l'ecran (par exemple apres avoir autorise le micro dans Windows).
        vocalMicFerme = "";
        vocalMicDemande = true;
        applyVocalState();
        if (vocalMic) {
          vocalMic.demander().then(() => {
            vocalSyncMicSpeaking();
          });
        }
      });
    }
    // Placeholder plus court : ici, le modele de phrase de l'assistant (28 mots)
    // serait du bruit (§2.4). Restitue a la sortie.
    if (inputEl) {
      vocalPlaceholderHome = inputEl.placeholder;
      inputEl.placeholder = "Écrivez, ou parlez.";
      resizeInput();
    }
    // Le mode REELLEMENT affiche est ecrit par la SEULE source des modes
    // (`screen-mode.js`) : entrer ici, c'est etre en « Vocal », meme quand on
    // vient de « Assistant seul » (dont la sortie a ecrit « Detaille »).
    rememberScreenMode("vocal");
    applyVocalState();
  }

  function exitVocal() {
    if (!vocalOverlay) return;
    // QUITTER l'ecran, c'est rendre le silence : si Pilot est en train de lire
    // (lecture declenchee par ce mode), sortir l'arrete. Sans cela, une voix
    // lancee ici continuerait dans « Detaille », qui ne doit rien changer a son
    // propre comportement. L'arret passe par la SEULE voie existante.
    if (vocalSpeaking) stopReading();
    // LOT 3 : le micro est COUPE a la sortie — flux ARRETE (pistes `stop()`),
    // contexte audio ferme, boucle de mesure annulee. Pas seulement « ignore » :
    // aucun peripherique ne reste ouvert derriere l'ecran. Les deux ecouteurs de
    // geste disparaissent avec l'overlay.
    if (vocalMic) {
      vocalMic.fermer();
      vocalMic = null;
    }
    vocalMicListening = false;
    vocalMicFerme = "";
    vocalMicDemande = false;
    document.removeEventListener("keydown", onVocalFirstGesture);
    // Symetrie exacte de enterVocal : le bouton des modes d'abord (il doit
    // sortir de l'overlay AVANT son retrait, sinon le noeud serait detruit),
    // puis la barre de saisie.
    const modeHome = vocalModeButtonHome;
    const modeButton = document.getElementById(SCREEN_MODE_BUTTON_ID);
    if (modeButton && modeHome && modeHome.parent) {
      const next = modeHome.next && modeHome.next.parentNode === modeHome.parent ? modeHome.next : null;
      modeHome.parent.insertBefore(modeButton, next);
    }
    vocalModeButtonHome = null;
    if (inputBar && vocalInputHome && vocalInputHome.parent) {
      const next = vocalInputHome.next && vocalInputHome.next.parentNode === vocalInputHome.parent ? vocalInputHome.next : null;
      vocalInputHome.parent.insertBefore(inputBar, next);
    }
    vocalInputHome = null;
    vocalOverlay.remove();
    vocalOverlay = null;
    document.body.classList.remove(VOCAL_ACTIVE_CLASS);
    // Placeholder d'origine de la zone de saisie, et hauteur replafonnee pour
    // l'onglet (200 px) : la barre revient exactement comme elle etait.
    if (inputEl && vocalPlaceholderHome !== null) {
      inputEl.placeholder = vocalPlaceholderHome;
      vocalPlaceholderHome = null;
      resizeInput();
    }
    // Mode REELLEMENT affiche : retour a « Detaille » dans la cle de memoire.
    noteImmersiveExited();
    // La teinte de reflexion de la zone de saisie (desormais revenue dans
    // l'onglet) est resynchronisee sur l'etat reel.
    applyReflecting();
  }

  /**
   * LOT 2 (§5) : en mode Vocal, la reponse de l'Assistant est lue a voix haute
   * AUTOMATIQUEMENT. Aucun second mecanisme de lecture n'est cree : on actionne
   * le bouton d'ecoute DEJA pose sous la derniere reponse (`attachReadAloud`,
   * read-aloud.js) — meme nettoyage du texte, meme decoupage, memes voix, une
   * seule lecture a la fois. Hors mode Vocal : rien du tout (la regle « aucune
   * lecture automatique » ne change pas).
   */
  function autoReadVocalReply() {
    if (!vocalOverlay) return;
    const boutons = messagesEl.querySelectorAll(".agent-message-assistant .agent-read-btn");
    const bouton = boutons.length ? boutons[boutons.length - 1] : null;
    if (!bouton || bouton.disabled) return;
    // Deja en lecture (ou en attente de voix) : on ne relance pas une seconde
    // lecture par-dessus la premiere.
    const etat = bouton.dataset ? bouton.dataset.readState : "";
    if (etat && etat !== "idle") return;
    try {
      bouton.click();
    } catch (_) {
      /* une lecture qui ne part pas ne bloque jamais la conversation */
    }
  }

  // Raccourci clavier de bascule (maquette V4) : Ctrl+Shift+A (Cmd+Shift+A sur
  // macOS) entre en mode assistant seul / en sort. Actif tant que l'onglet 🧭
  // existe (les éléments du chat vivent dans sa vue) ; retiré à sa fermeture.
  const onImmersiveKeydown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "A" || e.key === "a")) {
      e.preventDefault();
      // LOT 2 : si l'ecran Vocal est ouvert, ce raccourci en SORT (on ne
      // superpose jamais deux pleins ecrans). Sinon, comportement inchange.
      if (vocalOverlay) exitVocal();
      else if (immersiveOverlay) exitImmersive();
      else enterImmersive();
    }
  };
  document.addEventListener("keydown", onImmersiveKeydown);

  // LOT 2 (§3.2) : la TROISIEME facon de quitter l'ecran Vocal — la touche
  // Echap, comme le bouton des modes et la fermeture de l'onglet. Cet ecouteur
  // ne concerne QUE le mode Vocal : « Detaille » et « Assistant seul » gardent
  // exactement leur comportement. Si une modale est ouverte, Echap lui
  // appartient : on ne quitte pas le mode sous elle.
  const onVocalKeydown = (e) => {
    if (!vocalOverlay || e.key !== "Escape") return;
    if (document.querySelector(".modal:not(.hidden)")) return;
    e.preventDefault();
    exitVocal();
  };
  document.addEventListener("keydown", onVocalKeydown);

  // LOT 2 : etat « Pilot parle ». `pilot-read-aloud-state` est la SEULE source
  // de cet etat (emis par read-aloud.js a chaque changement) ; l'ecran Vocal ne
  // devine jamais la parole et ne cree aucun second lecteur.
  const onVocalReadAloudState = (e) => {
    const etat = e && e.detail ? e.detail.state : "";
    const parlait = vocalSpeaking;
    vocalSpeaking = etat === "speaking";
    // LOT 4a : la garde du micro ne s'arme QUE pendant la lecture, et se remet a
    // zero a la fin (le residu d'echo d'une lecture ne vaut pas pour la suivante).
    vocalSyncMicSpeaking();
    if (parlait !== vocalSpeaking) applyVocalState();
  };
  window.addEventListener(READ_ALOUD_STATE_EVENT, onVocalReadAloudState);

  // Lot B « Reglages en onglet » : ouvrir les Options quitte D'ABORD le mode
  // assistant seul. L'overlay immersif vit au-dessus de tout : sans cette
  // sortie, l'onglet ouvert s'afficherait DERRIERE lui (voile plein écran).
  // Écouteur unique, retiré avec les autres à la fermeture de l'onglet 🧭.
  const onExitAssistantOnly = () => {
    if (vocalOverlay) exitVocal();
    if (immersiveOverlay) exitImmersive();
  };
  window.addEventListener("pilot-exit-assistant-only", onExitAssistantOnly);

  // LOT 1 (trois modes d'ecran) : le bouton UNIQUE demande un mode en publiant
  // `pilot-screen-mode-apply` (src/js/screen-mode.js). Ici on ne fait qu'entrer
  // dans l'ecran correspondant ou en sortir — aucun ecran de « Detaille » ni
  // d'« Assistant seul » n'est redessine.
  // LOT 2 : « Vocal » a desormais SON ecran (§2) ; on sort d'abord de l'autre
  // plein ecran pour ne jamais en superposer deux.
  const onScreenModeApply = (e) => {
    const mode = e && e.detail ? e.detail.mode : "";
    // Ecran REELLEMENT demande, decide une seule fois par `screen-mode.js`.
    const ecran = screenModeScreen(mode);
    if (ecran === "vocal") {
      if (!vocalOverlay) enterVocal();
      return;
    }
    if (vocalOverlay) exitVocal();
    if (ecran === "assistant") {
      if (!immersiveOverlay) enterImmersive();
    } else if (immersiveOverlay) {
      exitImmersive();
    }
  };
  window.addEventListener(SCREEN_MODE_APPLY_EVENT, onScreenModeApply);

  // ── Actions ──
  toolbar.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === "immersive") {
      enterImmersive();
    } else if (action === "abort") {
      // Arrêt manuel de l'assistant : le flux peut s'interrompre sans jamais
      // signaler son repos. On remet le lecteur de son différé à zéro pour que
      // la surface « superagent » restée active ne retarde plus de 12 s le son
      // de la prochaine mission.
      resetDeferredSound();
      // R3-EXCEPTION-MANUEL : arrêt demandé EXPLICITEMENT par un clic de
      // l'utilisateur (bouton Stop) — ce n'est pas un arrêt automatique, donc
      // aucune trace d'arrêt automatique n'est écrite ici (exception assumée,
      // déclarée par le test des sites d'arrêt).
      await invoke("abort_super_agent").catch(() => {});
    } else if (action === "new-session") {
      await invoke("new_super_agent_session").catch(() => {});
      messagesEl.innerHTML = "";
      // Reset de l'état de streaming : les bulles sont supprimées du DOM.
      currentBody = null;
      currentFlow = null;
      currentTextSection = null;
      currentThinkingBlock = null;
      pendingText = "";
      pendingRender = false;
      lastAssistantRawText = "";
      currentTurnProjectBadges = null;
      currentTurnConcernedBadges = [];
      // SOUCIS 1 : une nouvelle session réarme le suivi automatique du bas.
      superAtBottom = true;
      appendSystemMessage(messagesEl, "🆕 Nouvelle session.");
    } else if (action === "initialize") {
      await initializeSuperAgent(messagesEl);
    } else if (action === "projects") {
      await showProjectsPanel(messagesEl, state);
    } else if (action === "config") {
      window.dispatchEvent(new CustomEvent("pilot-open-settings", { detail: { tab: "superagent" } }));
    } else if (action === "period-report") {
      // Bilan de période (Idée 5, Lot A) : panneau d'affichage + copie.
      if (periodReportEl.classList.contains("hidden")) {
        periodReportEl.classList.remove("hidden");
        loadPeriodReport();
      } else {
        periodReportEl.classList.add("hidden");
      }
    } else if (action === "analyze-data") {
      await launchDataAnalysis();
    } else if (action === "voice") {
      toggleVoiceInput();
    } else if (action === "telegram-dialog") {
      await toggleTelegramDialog();
    }
  });

  // ── Envoi (session persistante : streaming + mémoire de conversation) ──
  async function send() {
    // LOT 2 (§3.1) : en mode Vocal, ecrire puis valider pendant que Pilot parle
    // ARRETE la lecture et le message part — une seule voix a la fois. Cet
    // arret ne concerne QUE l'ecran Vocal : dans l'onglet, la lecture en cours
    // n'est pas interrompue par un envoi (comportement inchange).
    if (vocalOverlay) stopReading();
    // Chantier #132 : si une question est en attente, on valide la question
    // (la précision saisie dans la barre devient la note) au lieu d'envoyer un
    // nouveau message chat. Le champ n'est pas vidé en cas d'échec.
    if (hasPendingQuestion()) {
      validatePendingQuestion(inputEl.value);
      return;
    }
    const text = inputEl.value.trim();
    if (!text) return;
    // RÈGLE DE DÉMARRAGE (règle du propriétaire) : tant que la version du moteur
    // `pi` n'a pas été vérifiée — et pendant son installation — Pilot ne commence
    // pas à « réfléchir ». Décideur UNIQUE : `canAssistantReflect` (run-policy.js).
    // La saisie est CONSERVÉE (jamais perdue) et l'utilisateur sait pourquoi.
    if (!canAssistantReflect()) {
      appendSystemMessage(
        messagesEl,
        `${assistantReflectionBlockedMessage()}\n\nVotre message est conservé dans le champ : renvoyez-le dès que la vérification est terminée.`,
      );
      return;
    }
    // P0-1 : la garde repose sur l'état RÉEL du backend (backendBusy, mis à
    // jour par get_agent_supervision et l'événement agent_start), en plus de
    // l'état local isStreaming. Un backend occupé en arrière-plan (prompt
    // distant, relance programmée, compaction) ne doit pas accepter puis perdre
    // la saisie : on la conserve dans le champ et on informe l'utilisateur.
    if (isStreaming || backendBusy) {
      // Bug 1 (UX) : pendant que l'assistant est occupé, ne pas perdre
      // silencieusement le texte saisi. On le garde dans le champ (aucun
      // effacement) et on informe l'utilisateur une seule fois par tour occupé.
      if (!busyNotified) {
        busyNotified = true;
        statusEl.textContent = "⏳ Occupé…";
        setBusyHint(true);
      }
      return;
    }
    if (voiceActive) stopVoiceInput();
    inputEl.value = "";
    inputEl.style.height = "auto";
    // L'ENGAGEMENT du propriétaire (défaut 1 de la relecture) n'est PAS posé ici :
    // il l'est par le SIGNAL UNIQUE émis côté Rust dans
    // `do_send_super_agent_prompt` (évènement `pilot-superagent-owner-engaged`),
    // qui couvre la saisie directe ET le prompt venu du web distant. Un seul
    // drapeau, un seul posé.
    const userBubble = appendMessage(messagesEl, "user", text);
    // Snapshot des badges projet (chantier badge-par-bulle) : capturé ICI, au
    // moment de l'envoi = UNIQUEMENT les projets explicitement nommés dans la
    // demande (detection sans IA, module pur). Aucun repli sur le projet ouvert
    // dans Pilot : sans projet cité, aucune étiquette.
    const badgeNames = await collectBubbleBadgeProjects(text);
    if (userBubble) renderProjectBadgesInto(userBubble, badgeNames);
    // Règle 1 : nouveau tour utilisateur → fermer la bulle assistant en cours
    // (reset complet) pour qu'un nouveau tour démarre dans une NOUVELLE bulle,
    // qui héritera du snapshot ci-dessus. Snapshot FIGÉ : jamais recalculé.
    currentBody = null;
    currentFlow = null;
    currentTextSection = null;
    currentThinkingBlock = null;
    pendingText = "";
    pendingRender = false;
    lastAssistantRawText = "";
    currentTurnProjectBadges = badgeNames;
    // REGLE 2 : le nouveau tour repart sans projet « concerne » ; les projets
    // reellement touches seront notes au fil du tour, puis figes dans la bulle.
    currentTurnConcernedBadges = [];
    isStreaming = true;
    backendBusy = true;
    statusEl.textContent = "Réfléchit…";
    setReflecting(true);
    try {
      await invoke("send_super_agent_prompt", { message: text });
      // La réponse arrive en streaming via le canal rpc-event-superagent
      // (handleSuperAgentEvent). On ne fait rien ici : on attend agent_end.
    } catch (err) {
      appendSystemMessage(messagesEl, `❌ ${err}`);
      isStreaming = false;
      backendBusy = false;
      statusEl.textContent = "Prêt";
      setReflecting(false);
    }
  }

  // ── Bouton « Analyser et ranger mes données » (spec_super_agent.md §7) ──
  // Un clic dépose dans la conversation une consigne PRÉPARÉE (fonction pure
  // `buildDataAnalysisPrompt`) qui impose une analyse en LECTURE SEULE puis un
  // rapport + une proposition de rangement. Le clic a un effet visible
  // immédiat : la bulle de la demande apparaît et le bouton se désactive (la
  // désactivation est pilotée par `setReflecting`, donc elle tient pendant
  // toute l'analyse). Les deux gardes ci-dessous empêchent en plus un lancement
  // pendant une question en attente ou pendant que l'Assistant travaille.
  async function launchDataAnalysis() {
    if (hasPendingQuestion()) {
      appendSystemMessage(messagesEl, "ℹ️ Répondez d'abord à la question en attente, puis relancez l'analyse.");
      return;
    }
    if (isStreaming || backendBusy) {
      appendSystemMessage(messagesEl, "⏳ Analyse impossible pour l'instant : l'Assistant est déjà en train de travailler.");
      return;
    }
    inputEl.value = buildDataAnalysisPrompt();
    await send();
  }

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  inputBar.querySelector('[data-action="send"]').addEventListener("click", send);
  // Le bouton micro (dictée vocale) est dans inputBar, pas dans toolbar : on lui
  // attache un listener dédié (même pattern que le bouton send) pour que le clic
  // soit bien capté (issue #62).
  inputBar.querySelector('[data-action="voice"]').addEventListener("click", toggleVoiceInput);

  // Auto-resize (plafond : 200 px dans l'onglet, 120 px en mode Vocal)
  inputEl.addEventListener("input", () => {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, inputMaxHeight()) + "px";
  });

  appendSystemMessage(messagesEl, `🧭 ${superAgentDisplayLabel()} prêt. Je suis en lecture seule : je suis vos projets (par client) de la demande à la livraison.`);

  // ── Relais passif des choix d'agent via l'assistant (tâche de suivi #22) ──
  // Un agent du projet peut émettre un `extension_ui_request` pilot-choices
  // (ask_choice / ask_confirm / ask_input / ask_multi_choice). Quand l'onglet
  // 🧭 est ouvert, agent-pi.js déclenche `pilot-agent-relay-request` ; on rend
  // la question ici (dans la conversation de l'assistant) et la réponse est
  // routée vers LA bonne session agent via `send_agent_command_to` (multi-agents
  // : chaque agent est identifié, les réponses ne sont pas mélangées).
  const onAgentRelayRequest = (e) => {
    const d = e.detail || {};
    try {
      relayAgentChoiceRequest(d.payload, d.agentId, d.projectPath, messagesEl, state);
    } catch (err) {
      console.error("[relais-agent] erreur:", err);
    }
  };
  window.addEventListener("pilot-agent-relay-request", onAgentRelayRequest);
  window._pilotSuperAgentOpen = true;
  // Anti-doublon Telegram (lot 3) : l'onglet est VIVANT — un tour de l'Assistant
  // en cours repousse l'envoi des avis bruts retardés jusqu'à sa fin (fin de tour
  // où l'Assistant aura parlé, ou non).
  setRawAvisTurnProbe(() => backendBusy);
  // Issue #59 : notifier l'agent que l'onglet 🧭 Assistant est ouvert (pour
  // désactiver sa saisie si l'option est activée).
  window.dispatchEvent(new CustomEvent("pilot-superagent-open-changed"));

  // 4.3 : suivi réactif de l'agent invisible piloté par l'état de l'objet. On
  // écoute `agent-state-changed` (émis par Rust à chaque transition) pour mettre
  // à jour le bandeau « Arrêter » et la notification de fin sans état local
  // transitoire.
  const unlistenStateChanged = await listen("agent-state-changed", (event) => {
    try {
      handleAgentStateChanged(event.payload);
    } catch (err) {
      console.error("[agent-state-changed] erreur:", err);
    }
  });

  // DÉFAUT 1 (relecture du correctif d26717e) — SIGNAL UNIQUE d'engagement du
  // propriétaire. Il est émis par Rust dans `do_send_super_agent_prompt`
  // (`super_agent.rs`), donc il couvre les DEUX chemins d'écriture qui n'ont
  // aucun autre point commun : la saisie directe de l'onglet (qui appelle cette
  // même commande) et le prompt venu du WEB distant (`web_server.rs`).
  //
  // DÉFAUT 3 (3ᵉ audit) : l'écoute de ce signal est désormais enregistrée AU
  // NIVEAU DE L'APPLICATION (`initOwnerEngagementWatch`, appelée au démarrage
  // de Pilot), et NON plus ici. L'enregistrer dans la fabrique d'onglet la
  // retirait à sa fermeture, alors que l'émission côté Rust est inconditionnelle :
  // un prompt envoyé depuis l'accès web distant pendant que l'onglet était fermé
  // était donc perdu, et les relances restaient retenues à la réouverture en
  // affirmant « écrivez » alors que le propriétaire venait d'écrire. Aucun second
  // drapeau n'a été créé : c'est le MÊME, posé par le même signal.
  //
  // Bug #81 : arrêt AUTOMATIQUE de l'agent standard (MainSession) par le
  // moniteur Rust (process pi standard figé vivant). Les agents délégués
  // (run_agents) sont gérés par agents-bus.js (ctx de run) ; ici on ne gère
  // QUE l'agent standard, identifié par le reason dédié émis côté Rust. On
  // libère le créneau de délégation et on flushe la file : la prochaine
  // demande en attente sera transmise à un agent redémarré (la session a été
  // arrêtée côté Rust, la délégation suivante la recrée).
  const unlistenAutoStop = await listen("agent-auto-stopped", (event) => {
    try {
      const p = event.payload || {};
      const agentId = p.agent;
      const reason = p.reason || "";
      // Ne gérer que l'arrêt auto de l'agent standard (reason dédié). Les
      // agents délégués run_agents sont gérés par agents-bus.js.
      if (!agentId || !reason.includes("Agent standard")) return;
      console.warn("[super-agent] arrêt automatique de l'agent standard", agentId, reason);
      // Libère le créneau de délégation DU PROJET (`p.project` est émis côté
      // Rust) et transmet la prochaine demande en file (si présente) à un agent
      // redémarré. Ne casse pas l'ordre de la file.
      flushDelegationQueue(p.project);
      appendSystemMessage(
        superMessagesEl,
        `⏱️ L'agent du projet a été arrêté automatiquement (bloqué sans progression). Les demandes en file seront transmises à un agent redémarré.`
      );
    } catch (err) {
      console.error("[agent-auto-stopped] erreur (super-agent):", err);
    }
  });

  // Badges par bulle : plus d'écoute de `project_changed` pour re-étiqueter
  // la bulle courante (ancien comportement `refreshSuperBubbleProject`, badge
  // « projet courant global » supprimé). Chaque bulle garde les badges FIGÉS
  // de sa demande (snapshot à l'envoi) : changer le projet actif — y compris
  // via un changement distant — ne modifie plus les bulles déjà affichées.

  const origUnlisten = unlisten;

  // A15 : le statut « Prêt » de l'assistant reflète l'état réel de la machine à
  // états AgentService (via get_agent_supervision). L'assistant est le projet
  // pseudo-global "" (agent superagent, libellé « Assistant (Magnus) »).
  // running/compacting = en traitement ; paused/stopped = en attente. On corrige
  // le statut dans les deux sens, sans toucher aux états d'erreur/déconnecté.
  const superStatusPoll = setInterval(async () => {
    try {
      const sup = await invoke("get_agent_supervision");
      if (!sup || !sup.projects) return;
      const proj = sup.projects.find((p) => !(p.path || ""));
      // Le libellé de l'assistant suit le nom réglé (⚙️ → Assistant → Nom) : on
      // compare le libellé courant, avec repli sur l'ancien libellé codé en dur
      // (compatibilité avec un cœur qui n'aurait pas encore la correction).
      const superLabel = superAgentDisplayLabel();
      const agent = proj && findAssistantSessionAgent(proj.agents, superLabel);
      // Anti-blocage (bug démarrage) : ne verrouille « occupé » QUE si le
      // processus super-agent est RÉELLEMENT en cours de génération (état
      // running/compacting) ET vivant (`alive`). Un processus mort/déconnecté
      // (process_exit reçu, session non vivante) ne doit pas verrouiller la
      // saisie : l'utilisateur doit pouvoir resaisir.
      const alive = !!(agent && agent.alive);
      // Correctif V2 : quand le processus redevient vivant après un faux
      // départ/redémarrage, retirer le message « Connexion perdue » devenu
      // obsolète (sinon il s'accumule et « apparaît/disparaît » à chaque crash).
      // Ne retire rien si la session reste morte (vrai blocage préservé).
      if (alive) removeSuperAgentDisconnectedEvent();
      const processing = alive && (agent.state === "running" || agent.state === "compacting");
      const isStreaming = statusEl.classList.contains("agent-status-streaming");
      const isError = statusEl.classList.contains("agent-status-error");
      // A15 : bascule vers « Réfléchit… » dès que l'assistant traite, même si
      // l'élément est encore dans son état initial (classe agent-status seule,
      // sans agent-status-idle). L'ancienne condition exigeait la classe idle,
      // absente à la création de l'onglet → le statut restait « Prêt » pendant
      // tout le travail. On protège uniquement les états d'erreur.
      //
      // Chantier « saisie-réflexion » : la teinte de la zone de saisie est
      // pilotée par la SEULE session de l'Assistant (état `processing` de
      // get_agent_supervision), SANS la garde `!isStreaming`.
      // Cette garde était fragile : `isStreaming` dérive de la classe
      // `agent-status-streaming` posée par le poll lui-même et NON réinitialisée
      // à l'agent_end (onEnd ne reset que le texte, pas la classe). Si
      // l'assistant se remettait à réfléchir dans la fenêtre où la classe était
      // encore `streaming` (et sans agent_start reçu), la garde sautait
      // `setReflecting(true)` → l'effet de la zone de saisie ne se déclenchait
      // pas alors que l'Assistant travaillait.
      // Aucun état GLOBAL n'alimente cette teinte : le travail des autres agents
      // a son propre signal (point de la liste, compteur « Travail »).
      if (processing && !isError) {
        backendBusy = true;
        statusEl.textContent = "Réfléchit…";
        statusEl.className = "agent-status agent-status-streaming";
        setReflecting(true);
      } else if (!processing && isStreaming) {
        backendBusy = false;
        statusEl.textContent = "Prêt";
        statusEl.className = "agent-status agent-status-idle";
        setReflecting(false);
      } else if (!processing) {
        // P0-1 : aucune session en traitement → l'assistant est libre, même
        // après un échec d'envoi qui n'a pas passé par onEnd. Évite de laisser
        // backendBusy verrouillé sur true (sinon les envois suivants seraient
        // bloqués sans raison).
        backendBusy = false;
        // Filet de sécurité : retire la teinte si elle était restée active
        // (ex: agent_end manqué). L'effet ne reste jamais bloqué quand
        // l'assistant ne réfléchit plus — aucune autre source ne peut le
        // rallumer (le travail des autres agents n'entre pas dans la décision).
        setReflecting(false);
      }
      // Filet périodique : si l'assistant est libre (aucun traitement) et que
      // des comptes rendus sont en attente, en rejouer un (no-op si occupé).
      flushPendingSuperAgentReports().catch(() => {});
    } catch (_) { /* ignore */ }
  }, 2000);

  // Chantier #13 : ticker des relances programmées (toutes les 10 s).
  startScheduleTicker();

  // A19 / LOT 1 (trois modes d'ecran) : restaurer le dernier mode choisi a la
  // reouverture de l'onglet Assistant. La lecture passe par screen-mode.js (qui
  // porte la migration de l'ancien reglage binaire) ; LOT 2 : « Vocal » ouvre
  // desormais SON ecran, les deux autres gardent le leur.
  {
    const modeAuMontage = getScreenMode();
    if (screenModeScreen(modeAuMontage) === "vocal") enterVocal();
    else if (isImmersiveScreenMode(modeAuMontage)) enterImmersive();
  }

  return {
    wrapper,
    unlisten: async () => {
      clearInterval(superStatusPoll);
      // Tâche #160 : retirer l'overlay plein écran + ses minuteurs (sinon
      // éléments orphelins dans le body et timers qui tournent après fermeture).
      hideSuperEventOverlay();
      // SOUCIS 1 : retirer le listener `scroll` (évite la fuite à la recréation
      // de l'onglet 🧭).
      messagesEl.removeEventListener("scroll", onSuperScroll);
      // Chantier #13 : arrêter le ticker des relances programmées (évite la
      // même fuite que `pilot-config-changed` — cf. problème #12).
      stopScheduleTicker();
      // A19 : si l'onglet est fermé en mode immersif, remettre les éléments
      // dans le wrapper et retirer l'overlay (évite des éléments orphelins).
      // LOT 2 (§3.2) : fermer l'onglet Assistant quitte AUSSI le mode Vocal
      // (troisieme voie de sortie), et l'etat « Pilot parle » est oublie.
      if (vocalOverlay) {
        stopReading();
        exitVocal();
      }
      vocalSpeaking = false;
      if (immersiveOverlay) exitImmersive();
      origUnlisten();
      unlistenStateChanged();
      try { unlistenAutoStop(); } catch (_) {}
      window.removeEventListener("pilot-agent-relay-request", onAgentRelayRequest);
      window.removeEventListener("pilot-config-changed", onConfigChanged);
      window.removeEventListener("pilot-config-changed", onTelegramPrefsChanged);
      document.removeEventListener("keydown", onImmersiveKeydown);
      document.removeEventListener("keydown", onVocalKeydown);
      window.removeEventListener(READ_ALOUD_STATE_EVENT, onVocalReadAloudState);
      window.removeEventListener("pilot-exit-assistant-only", onExitAssistantOnly);
      window.removeEventListener(SCREEN_MODE_APPLY_EVENT, onScreenModeApply);
      window._pilotSuperAgentOpen = false;
      // Chantier #132 + tâche #141 : nettoyer la barre des questions en attente.
      // IMPORTANT : avant de vider la file, LIBÉRER le backend pour chaque
      // question pendante (répondre {cancelled:true} via le responder). Sinon le
      // process pi reste bloqué en attente de la réponse (jamais d'agent_end) et
      // l'indicateur « Réfléchit » reste bloqué à la réouverture (issue #141).
      // On attend la libération AVANT que closeTab n'arrête la session (sinon le
      // kill du process précéderait l'agent_end et busy resterait à true).
      for (const q of pendingQuestions) {
        try {
          await q.responder(q.id, null, true);
        } catch (_) { /* une réponse qui échoue ne bloque pas la fermeture */ }
      }
      pendingQuestions.length = 0;
      // Telegram (étape 2, lot 1) : oublier la question publiée (onglet fermé,
      // plus aucune question en cours) et annuler son rappel éventuel.
      telegramAskedQuestion = null;
      clearTelegramQuestion();
      if (pendingBar) pendingBar.innerHTML = "";
      pendingBarEl = null;
      pendingInputEl = null;
      superMessagesEl = null;
      // Suivi du travail (haut droite) : on retire nos abonnements (le panneau
      // est GLOBAL, il survit à la fermeture de l'onglet Assistant ; seuls nos
      // propres branchements sont libérés). Les événements déjà affichés restent
      // dans le panneau — aucune donnée perdue.
      if (stopPanelTabWatch) {
        stopPanelTabWatch();
        stopPanelTabWatch = null;
      }
      stopSuperMissionsWatch();
      // ... MAIS le compteur du bouton « Travail » doit rester VRAI onglet
      // ferme : des agents et des demandes en file continuent de vivre (les
      // commandes manuelles d'un projet, par exemple). L'abonnement UNIQUE du
      // compteur (startTaskCounter, deja pose au demarrage de Pilot et SANS
      // rendu de liste) prend le relais : le compte ne se fige jamais, ne ment
      // jamais et ne se dedouble pas (aucun second calcul).
      startTaskCounter();
      // Issue #59 : notifier l'agent que l'onglet 🧭 Assistant est fermé.
      // Anti-doublon Telegram (lot 3) : l'Assistant ne peut plus parler → les
      // avis bruts retardés partent MAINTENANT (aucun événement perdu), et la
      // sonde de tour est retirée.
      setRawAvisTurnProbe(null);
      flushRawTelegramAvis();
      window.dispatchEvent(new CustomEvent("pilot-superagent-open-changed"));
    },
  };
}

// Chantier #13 : ticker des relances programmées de l'assistant. Appelé toutes
// les 10 s. Ne tick que si l'onglet 🧭 est ouvert (session vivante) ; sinon on
// ne fait rien (les schedules `every` accumulent un retard, repris à la reprise).
// Les rappels dus sont injectés dans la conversation via `send_super_agent_command`
// (raw `send_superagent`, sans réinjecter tout le système).
const SCHEDULE_TICK_INTERVAL_MS = 10000;
let scheduleTicker = null;

// Issue #135 : ids des rappels dont l'injection est en cours dans cette fenêtre.
// Le tick ne marque plus `last_run_at` côté Rust : un rappel reste « dû » tant
// qu'il n'a pas été livré (injecté alors que l'assistant était libre) et marqué
// via `super_agent_schedule_mark_done`. Ce set évite d'injecter un DOUBLON si
// plusieurs ticks se succèdent avant le marquage ; on retire l'id dès que le
// rappel est marqué livré.
const pendingReminderIds = new Set();

// MÉNAGE DES RAPPELS : utilité d'une exécution de rappel. Quand un rappel est
// livré, on retient son id ; les appels d'outils du tour DÉCLENCHÉ par ce rappel
// sont comptés (un rappel qui ne fait rien est inutile : au bout de 20
// exécutions stériles consécutives, la règle de ménage n° 3 le désactive — elle
// ne le supprime pas). En cas de doute (erreur, interruption, relance
// technique du backend), on ne compte RIEN : le rappel est conservé.
let reminderUtilityProbe = null;

function noteReminderTurnOutcome() {
  const probe = reminderUtilityProbe;
  reminderUtilityProbe = null;
  if (!probe || probe.doubtful) return;
  // Fire-and-forget : un échec d'écriture ne doit jamais perturber le chat.
  invoke("super_agent_schedule_note_run", { id: probe.id, detected: probe.tools > 0 }).catch(() => {});
}

// RÉGLAGE « Vérifier les points à faire à l'ouverture de la session » : le
// propriétaire a-t-il LUI-MÊME écrit dans la conversation depuis le début de
// cette session ? La décision d'injecter ou de retenir un rappel dû est prise par
// `planDueReminderInjections` (super-agent-schedule.js), qui est le SEUL endroit
// où cette règle est écrite.
//
// PORTÉE DU DRAPEAU (2ᵉ relecture, point 1) — « une session d'assistant » =
// **une exécution de Pilot**, pas « l'onglet 🧭 est ouvert ». C'est la même unité
// que la mémoire de session côté Rust (« après un redémarrage de Pilot, la
// session repart de zéro », `super_agent_load_session_memory`). La remise à zéro
// est donc la valeur INITIALE ci-dessous, posée une seule fois par démarrage de
// Pilot — et NULLE PART ailleurs : ni à l'ouverture, ni à la recréation de
// l'onglet, ni à l'ouverture du ticker (`startScheduleTicker`), qui suivaient
// auparavant l'ouverture d'un onglet.
//
// Pourquoi : l'écoute Telegram tourne SANS l'onglet. Un message reçu onglet
// fermé était donc traité (et marquait bien l'engagement), puis OUBLIÉ à la
// réouverture de l'onglet : les relances restaient retenues et le signal disait
// « écrivez » alors que le propriétaire venait d'écrire. Parcours verrouillé par
// `relances-relecture.test.js` (« message Telegram reçu onglet fermé → ouverture
// de l'onglet → la relance part »).
//
// DÉFAUT 1 (relecture du correctif d26717e) — UN SEUL SIGNAL pose cet engagement,
// émis par Rust dans `do_send_super_agent_prompt` (`super_agent.rs`) : il couvre la
// saisie directe de l'onglet ET le prompt venu du WEB distant, qui n'ont pas
// d'autre point commun. Auparavant, seul `send()` le posait : un message arrivé
// par Telegram ou par le web distant laissait les relances retenues alors que le
// propriétaire avait bel et bien écrit. Écoute :
// `pilot-superagent-owner-engaged`, enregistrée au niveau de l'APPLICATION par
// `initOwnerEngagementWatch` ci-dessous (plus dans la fabrique d'onglet — cf.
// défaut 3 du 3ᵉ audit). Telegram marque le MÊME drapeau juste avant de déposer
// le message (ce chemin n'entre pas par `do_send_super_agent_prompt`) : un seul
// drapeau, jamais deux.
let ownerEngagedThisSession = false;

// DÉFAUT 3 (3ᵉ audit) — L'ÉCOUTE DE CE SIGNAL VIT AU NIVEAU DE L'APPLICATION, pas
// dans la fabrique de l'onglet 🧭. Raison : l'émission est INCONDITIONNELLE côté
// Rust (`do_send_super_agent_prompt`), donc un prompt envoyé depuis l'ACCÈS WEB
// DISTANT arrive aussi quand l'onglet est fermé. L'écoute enregistrée dans la
// fabrique — et retirée à sa fermeture — perdait cet évènement : à la
// réouverture, les relances restaient retenues et le signal disait « écrivez »
// alors que le propriétaire venait d'écrire (défaut déjà corrigé pour Telegram,
// resté ouvert pour le web). Même remède que l'écoute Telegram : un
// enregistrement qui ne dépend d'AUCUN onglet.
//
// Idempotente : un seul enregistrement par exécution de Pilot, quel que soit le
// nombre d'appels (le drapeau reste UNIQUE, aucun second drapeau, aucun
// compteur en base).
let ownerEngagementWatchInstalled = false;
export async function initOwnerEngagementWatch() {
  if (ownerEngagementWatchInstalled) return;
  ownerEngagementWatchInstalled = true;
  try {
    await listen("pilot-superagent-owner-engaged", () => {
      ownerEngagedThisSession = true;
    });
  } catch (e) {
    // Écoute indisponible : on ne garde pas l'état « installée » (une nouvelle
    // tentative reste possible) et le reste de Pilot continue normalement.
    ownerEngagementWatchInstalled = false;
    console.warn("[super-agent] écoute de l'engagement du propriétaire indisponible:", e);
  }
}

// DÉFAUT 2 — Échecs CONSÉCUTIFS d'envoi par rappel, EN MÉMOIRE (aucune écriture
// en base). Sert à faire tourner les rappels : celui qui vient d'échouer passe
// après les autres, et au-delà de `REMINDER_MAX_CONSECUTIVE_FAILURES` il est
// écarté tant qu'un autre peut partir. La décision reste dans
// `planDueReminderInjections` ; ici on ne fait que compter et oublier.
const reminderFailureCounts = new Map();

// DÉFAUT 4 — Le signal de retenue n'est affiché qu'UNE fois par session de
// conversation : la règle d'unicité vit dans `createReminderHoldGuard`
// (super-agent-schedule.js), remise à zéro à chaque ouverture du ticker.
const reminderHoldGuard = createReminderHoldGuard();

/**
 * Une passe du ticker des relances : interroge Rust, laisse
 * `planDueReminderInjections` décider (réglage du propriétaire, rotation,
 * regroupement), puis exécute le plan. Aucun rappel retenu n'est JAMAIS marqué
 * comme exécuté.
 */
async function scheduleTick() {
  if (!shouldScheduleTick(window._pilotSuperAgentOpen)) return;
  // Issue #134 : le réglage super_agent_auto_check_startup gouverne le lancement
  // automatique d'un rappel dû AU DÉMARRAGE (promesse du réglage). Le tick
  // périodique continue de tourner, mais il ne remet une relance due qu'à
  // l'assistant libre ET — au démarrage — seulement si le propriétaire l'a
  // demandé (réglage activé) ou s'il a lui-même ouvert la conversation.
  let res;
  try {
    res = await invoke("super_agent_schedule_tick");
  } catch (_) {
    return;
  }
  const due = (res && res.due) || [];
  // Oubli des compteurs d'échecs des rappels qui ne sont plus dus (livrés,
  // désactivés, supprimés) : la mémoire ne grossit pas indéfiniment.
  if (reminderFailureCounts.size > 0) {
    const dueIds = new Set(due.map((d) => d && d.id));
    for (const id of [...reminderFailureCounts.keys()]) {
      if (!dueIds.has(id)) reminderFailureCounts.delete(id);
    }
  }
  const plan = planDueReminderInjections({
    due,
    pendingIds: pendingReminderIds,
    backendBusy,
    autoCheckStartup: configCache.super_agent_auto_check_startup === true,
    ownerEngaged: ownerEngagedThisSession,
    failureCounts: reminderFailureCounts,
    now: Date.now(),
  });
  // DÉFAUT 4 : la retenue n'est plus silencieuse. UN signal système par
  // session, seulement quand la cause est « le propriétaire n'a pas écrit »
  // (un assistant occupé se débloque seul : pas de message inutile).
  if (reminderHoldGuard.shouldNotify(plan.waitingForOwner)) {
    appendSystemMessage(superMessagesEl, formatReminderHoldNotice(plan.waitingForOwner));
  }
  // Rien à remettre : les rappels retenus restent DUS (jamais marqués) et
  // seront représentés à la passe suivante (10 s) dans les mêmes conditions.
  const items = plan.toInject;
  if (items.length === 0) return;
  // DÉFAUT SÉRIEUX (3ᵉ audit) : le message du lot est désormais borné PAR
  // RELANCE, donc la troncature du message entier est structurellement
  // impossible. `readable` = les relances dont le texte est RÉELLEMENT dans le
  // message : c'est cette liste-là, et elle seule, que l'on peut marquer comme
  // envoyées. Une relance retirée faute de place redevient « due » (jamais
  // marquée, jamais perdue).
  const injection = buildReminderInjection(items);
  const readable = injection.delivered;
  // Seules les relances RÉELLEMENT remises sont marquées « en vol » : une
  // relance retirée faute de place reste due et repart à la passe suivante.
  for (const d of readable) pendingReminderIds.add(d.id);
  try {
    // MÉNAGE DES RAPPELS : la sonde d'utilité ne suit qu'UNE relance seule. Un
    // lot regroupé ne compte RIEN (en cas de doute on conserve le rappel).
    reminderUtilityProbe = readable.length === 1 ? { id: readable[0].id, tools: 0, doubtful: false } : null;
    // DÉFAUT 3 : UN SEUL envoi par passe. Les retardataires sont regroupés dans
    // ce message (« N relances échues : … »), donc un arriéré n'ouvre plus N
    // tours successifs de l'assistant.
    await invoke("send_super_agent_command", {
      command: { type: "prompt", message: injection.message },
    });
    // Issue #36 : le rappel s'affiche dans le panneau Événements (cloche)
    // et via un toast discret, plus en bulle au milieu du fil. Le prompt
    // complet reste consultable au survol (title de l'événement).
    // L'horodatage est celui de la LIVRAISON (maintenant), pas l'échéance
    // théorique `nextFireAt` : en cas de tick en retard, c'est le moment où
    // la relance a réellement été remise à l'assistant qui est affiché.
    const deliveredAt = new Date();
    if (readable.length === 1) {
      const reminderLabel = formatReminderNotificationLabel(deliveredAt);
      pushSuperAgentSystemEvent("info", reminderLabel, readable[0].prompt);
      toastInfo(reminderLabel);
    } else {
      const groupLabel = formatReminderGroupNotificationLabel(readable.length, deliveredAt);
      pushSuperAgentSystemEvent(
        "info",
        groupLabel,
        readable.map((d) => d.prompt).join("\n\n"),
      );
      toastInfo(groupLabel);
    }
    // Livraison effective → marquer chaque relance LISIBLE du lot comme exécutée
    // (issue #135). Une relance RETENUE n'arrive jamais ici : elle n'est ni dans
    // `readable`, ni marquée.
    for (const d of readable) {
      try {
        await invoke("super_agent_schedule_mark_done", { id: d.id });
      } catch (_) { /* échec de marquage : le rappel sera re-renvoyé, pas de blocage */ }
      reminderFailureCounts.delete(d.id);
    }
  } catch (_) {
    // Échec d'envoi : aucun tour ne sera déclenché par ce lot, on annule la
    // sonde d'utilité (aucune exécution n'est comptée stérile) et CHAQUE rappel
    // du lot compte un échec consécutif — en mémoire seulement.
    if (reminderUtilityProbe && items.some((d) => d.id === reminderUtilityProbe.id)) {
      reminderUtilityProbe = null;
    }
    for (const d of items) {
      reminderFailureCounts.set(d.id, (reminderFailureCounts.get(d.id) || 0) + 1);
    }
  } finally {
    for (const d of items) pendingReminderIds.delete(d.id);
  }
}

function startScheduleTicker() {
  if (scheduleTicker) return;
  // ATTENTION (2ᵉ relecture, point 1) : l'engagement du propriétaire n'est
  // SURTOUT PAS remis à zéro ici. Cette fonction suit l'ouverture d'un onglet,
  // alors que le drapeau vaut pour une SESSION D'ASSISTANT, c'est-à-dire une
  // exécution de Pilot (cf. sa déclaration) : le remettre à zéro ici perdait le
  // message reçu par Telegram pendant que l'onglet était fermé.
  //
  // Le signal de retenue, LUI, est propre à la SESSION DE CONVERSATION : il est
  // écrit DANS la conversation (`superMessagesEl`), laquelle est recréée à
  // chaque ouverture de l'onglet. L'annoncer une seule fois pour toute
  // l'exécution de Pilot le rendrait invisible dans la nouvelle conversation
  // alors que des relances restent retenues. Sa portée est donc « au plus une
  // fois par session de conversation (= par ouverture de l'onglet 🧭) ».
  reminderHoldGuard.reset();
  reminderFailureCounts.clear();
  scheduleTicker = setInterval(scheduleTick, SCHEDULE_TICK_INTERVAL_MS);
  // MÉNAGE DES RAPPELS : une passe automatique par SESSION, bornée à une par
  // jour côté donnée (assistant_meta.schedule_cleanup_at). Non bloquant et
  // silencieux : chaque suppression est journalisée côté backend.
  maybeAutoCleanupSchedules();
}

/**
 * Ménage automatique des rappels inutiles (règle 5 : au plus une fois par jour).
 * Ne décide RIEN ici : lit l'état, laisse `classifyScheduleCleanup` décider,
 * applique le plan rendu. Une erreur (base indisponible, backend ancien) est
 * silencieuse — le ménage ne doit jamais gêner le démarrage de l'Assistant.
 */
async function maybeAutoCleanupSchedules() {
  try {
    const state = await invoke("super_agent_schedule_cleanup_state");
    const plan = classifyScheduleCleanup({
      schedules: (state && state.schedules) || [],
      now: Date.now(),
      lastCleanupAt: (state && state.lastCleanupAt) || null,
      // Ménage automatique : jamais deux fois dans la même journée.
      enforceDailyGuard: true,
    });
    if (!plan.run) return;
    const payload = cleanupApplyPayload(plan);
    // Même une passe sans rien à faire est appliquée : elle date le ménage (sinon
    // chaque session recompterait la totalité des rappels).
    await invoke("super_agent_schedule_cleanup_apply", payload);
  } catch (_) { /* ménage best-effort : aucun impact sur la conversation */ }
}

function stopScheduleTicker() {
  if (scheduleTicker) {
    clearInterval(scheduleTicker);
    scheduleTicker = null;
  }
}

// ── Traitement des événements RPC ──

/**
 * Accumule un delta streamé dans le buffer de réflexion de l'assistant puis,
 * de façon throttlée, détecte un éventuel bouclage (issue #55). En cas de
 * boucle, ARRÊTE l'assistant (abort_super_agent) et affiche un message clair.
 * Pas de reprise automatique : l'assistant est un outil de suivi, pas un codeur.
 * @param {Element} messagesEl
 */
function maybeDetectSuperAgentLoop(messagesEl) {
  if (superLoopStopped) return; // déjà arrêté pour boucle
  const now = Date.now();
  if (now - superLoopLastChecked < SUPER_LOOP_CHECK_INTERVAL_MS) return;
  superLoopLastChecked = now;
  // Issue #10 : la détection d'une boucle d'OUTILS (detectRepeatedToolCalls) est
  // indépendante de la longueur du buffer texte. Un agent qui répète la même
  // requête DB (db_query/db_execute) sans streamer de texte ne remplit pas
  // forcément SUPER_LOOP_BUFFER_MIN → on vérifie les tool calls AVANT le garde
  // de longueur du buffer texte, sinon la boucle d'outils n'est jamais détectée.
  if (detectRepeatedToolCalls(superLoopToolCalls)) {
    superLoopStopped = true;
    console.warn("[loop-detection] boucle d'outils détectée sur l'assistant, arrêt");
    // Motif journalisé sur disque (fail-open) : l'arrêt automatique laisse une trace.
    traceAutomaticAgentStop({
      reason: "loop-detection",
      detected: "tool-calls",
      agentId: "assistant",
      projectPath: window._pilotProjectPath || "",
    }).catch(() => {});
    appendSystemMessage(
      messagesEl,
      "⚠️ L'assistant a tourné en boucle (répétition du même texte ou des mêmes appels d'outils). Génération arrêtée. Veuillez reformuler votre demande."
    );
    invoke("abort_super_agent").catch((e) =>
      console.error("Erreur abort_super_agent (loop):", e)
    );
    // Arrêt automatique (boucle) : la surface de rendu ne signalera pas son
    // repos → remise à zéro pour ne pas retarder le son suivant.
    resetDeferredSound();
    return;
  }
  if (superLoopBuffer.length < SUPER_LOOP_BUFFER_MIN) return;
  if (
    detectRepeatedBlock(superLoopBuffer) ||
    detectRepeatedWord(superLoopBuffer) ||
    detectSemanticLoop(superLoopBuffer)
  ) {
    superLoopStopped = true;
    console.warn("[loop-detection] boucle détectée sur l'assistant, arrêt");
    traceAutomaticAgentStop({
      reason: "loop-detection",
      detected: "text",
      agentId: "assistant",
      projectPath: window._pilotProjectPath || "",
    }).catch(() => {});
    appendSystemMessage(
      messagesEl,
      "⚠️ L'assistant a tourné en boucle (répétition du même texte ou des mêmes appels d'outils). Génération arrêtée. Veuillez reformuler votre demande."
    );
    invoke("abort_super_agent").catch((e) =>
      console.error("Erreur abort_super_agent (loop):", e)
    );
    resetDeferredSound();
  }
}

/**
 * 4.2 (issue #55) : les boucles pilotées par OUTILS (db_query/db_execute dont
 * les résultats reviennent en `extension_ui_request`, pas en deltas streamés)
 * échappent au détecteur qui n'accumule que les deltas. On accumule ici une
 * empreinte compacte de chaque réponse d'outil dans le buffer de détection puis
 * on relance la vérification — un agent qui répète la même requête DB se fait
 * donc détecter et arrêter, même s'il ne stream plus de texte.
 * @param {Element} messagesEl
 * @param {string} method - méthode d'extension_ui_request (confirm/select/input/notify).
 * @param {object} payload - payload de la requête.
 */
function accumulateSuperLoopToolResponse(messagesEl, method, payload) {
  let fingerprint;
  if (method === "input") {
    // Les requêtes DB arrivent via un sentinel dans le titre : le SQL répété est
    // la signature de la boucle. On le capture tel quel pour la détection.
    const title = payload.title || "";
    if (title.startsWith("PILOT_ASSISTANT_DB_QUERY::")) {
      // Issue #10 : on réutilise buildToolLoopFingerprint pour produire la MÊME
      // empreinte que tool_execution_start (db_query) → la détection d'outils
      // (detectRepeatedToolCalls) voit les requêtes DB répétées, que
      // tool_execution_start soit émis ou non, sans doublon ni format divergent.
      fingerprint = buildToolLoopFingerprint("db_query", {
        sql: title.slice("PILOT_ASSISTANT_DB_QUERY::".length),
      });
    } else if (title.startsWith("PILOT_ASSISTANT_DB_EXEC::")) {
      fingerprint = buildToolLoopFingerprint("db_execute", {
        sql: title.slice("PILOT_ASSISTANT_DB_EXEC::".length),
      });
    } else if (title.startsWith("PILOT_ASSISTANT_RUN_AGENTS::")) {
      // Anti-boucle run_agents : l'assistant relance la même délégation à
      // l'identique (mêmes agents + même tâche). On construit une empreinte
      // STABLE (agent_ids + tâche normalisée) pour que detectRepeatedToolCalls
      // attrape les run_agents identiques répétés, même si le JSON brut diffère
      // (ordre des champs, espaces). On alimente aussi le buffer texte avec la
      // tâche pour la détection sémantique (run_agents avec des tâches
      // légèrement reformulées mais mêmes idées).
      let raInfo = {};
      try {
        raInfo = JSON.parse(title.slice("PILOT_ASSISTANT_RUN_AGENTS::".length));
      } catch (_) {}
      const raIds = (Array.isArray(raInfo.agent_ids) ? raInfo.agent_ids.map(String) : []).join(",");
      const raTask = String(raInfo.task || "").trim();
      fingerprint = buildToolLoopFingerprint("run_agents", { agent_ids: raIds, task: raTask });
      superLoopBuffer += "run_agents task: " + raTask + "\n";
    } else if (title.startsWith("PILOT_ASSISTANT_DOC::")) {
      // Documentation intégrée (answer_from_documentation) : deux questions
      // identiques dans le même tour sont un motif de boucle (le plafond d'un
      // appel par tour reste la première barrière, posée côté extension).
      fingerprint = buildToolLoopFingerprint("answer_from_documentation", {
        question: title.slice("PILOT_ASSISTANT_DOC::".length),
      });
    } else if (title.startsWith("PILOT_ASSISTANT_SESSIONS::")) {
      // Issue #143 : empreinte concordante pour list_agent_sessions (le sentinel
      // arrive via un input d'outil, pas via tool_execution_start).
      fingerprint = buildToolLoopFingerprint("list_agent_sessions", {});
    } else if (title.startsWith("PILOT_ASSISTANT_MCP_STATE::")) {
      // MCP piloté (brique C) : empreinte stable pour mcp_state (l'état MCP ne
      // change que rarement — une répétition est une boucle).
      fingerprint = buildToolLoopFingerprint("mcp_state", {});
    } else {
      fingerprint = "input::" + title;
    }
  } else {
    fingerprint = method + "::" + (payload.title || "");
  }
  superLoopBuffer += fingerprint + "\n";
  // Issue #10 : alimenter aussi le détecteur d'outils pour que les requêtes DB
  // répétées soient détectées même si le buffer texte est court. On déduplique
  // les empreintes consécutives identiques pour éviter qu'un même outil émis à
  // la fois par tool_execution_start ET par extension_ui_request ne fasse
  // déclencher la boucle trop tôt (2 requêtes au lieu de 3).
  if (superLoopToolCalls[superLoopToolCalls.length - 1] !== fingerprint) {
    superLoopToolCalls.push(fingerprint);
  }
  maybeDetectSuperAgentLoop(messagesEl);
}

function handleSuperAgentEvent(payload, messagesEl, statusEl, state, onEnd) {
  const type = payload.type;
  if (type === "message_start") {
    const msg = payload.message;
    if (msg && msg.role === "assistant") {
      // Badges par bulle : plus de « nouvelle bulle si le projet actif change »
      // (ancienne Règle 2 supprimée). La bulle en cours garde les badges FIGÉS
      // de sa demande jusqu'à la fin du tour, même si `open_project` change le
      // projet actif pendant le tour.
      // Début d'un message assistant streamé : créer un bloc avec flux.
      // Règle 1 : on réutilise la bulle courante si elle existe déjà (tour en
      // cours) → les messages intermédiaires (texte → outil → texte) restent
      // dans la MÊME bulle, on ne crée pas de nouvelle bulle à chaque message.
      if (!currentBody) {
        currentBody = createSuperAgentBlock(messagesEl);
        currentFlow = currentBody.querySelector(".agent-stream-flow");
      }
      currentTextSection = null;
      currentThinkingBlock = null;
      pendingText = "";
      pendingRender = false;
      lastAssistantRawText = "";
    }
    return;
  }
  if (type === "message_update") {
    const delta = payload.assistantMessageEvent;
    if (!delta) return;
    // Deltas de texte.
    if (delta.type === "text_start") {
      if (!currentBody) {
        currentBody = createSuperAgentBlock(messagesEl);
        currentFlow = currentBody.querySelector(".agent-stream-flow");
      }
      currentTextSection = appendSuperTextSection("", false);
      pendingText = "";
      pendingRender = false;
    } else if (delta.type === "text_delta" && typeof delta.delta === "string") {
      if (!currentBody) {
        currentBody = createSuperAgentBlock(messagesEl);
        currentFlow = currentBody.querySelector(".agent-stream-flow");
      }
      pendingText += delta.delta;
      lastAssistantRawText += delta.delta;
      // Du texte arrive encore à l'écran : aucun son tant que ce n'est pas fini.
      noteSoundRenderActivity("superagent");
      // Issue #55 : accumuler le flux pour la détection de boucle.
      superLoopBuffer += delta.delta;
      maybeDetectSuperAgentLoop(messagesEl);
      if (!currentTextSection) currentTextSection = appendSuperTextSection("", false);
      if (!pendingRender && currentTextSection) {
        pendingRender = true;
        requestAnimationFrame(() => {
          pendingRender = false;
          if (currentTextSection && pendingText) {
            currentTextSection.innerHTML = md.render(pendingText);
          }
          scrollSuperToBottom(messagesEl);
        });
      }
    } else if (delta.type === "text_end") {
      pendingRender = false;
      if (currentTextSection && pendingText) {
        currentTextSection.innerHTML = md.render(pendingText);
      }
      if (currentTextSection) currentTextSection.dataset.closed = "true";
      pendingText = "";
    } else if (delta.type === "thinking_start") {
      if (!currentBody) {
        currentBody = createSuperAgentBlock(messagesEl);
        currentFlow = currentBody.querySelector(".agent-stream-flow");
      }
      currentThinkingBlock = appendSuperThinkingSection("", true);
    } else if (delta.type === "thinking_delta" && typeof delta.delta === "string") {
      if (!currentBody) {
        currentBody = createSuperAgentBlock(messagesEl);
        currentFlow = currentBody.querySelector(".agent-stream-flow");
      }
      // Issue #55 : accumuler la réflexion streamée pour la détection de boucle.
      superLoopBuffer += delta.delta;
      maybeDetectSuperAgentLoop(messagesEl);
      // La réflexion affichée compte aussi comme du texte en cours d'écriture.
      noteSoundRenderActivity("superagent");
      if (currentThinkingBlock) {
        if (superShowThinking) {
          const content = currentThinkingBlock.querySelector(".agent-thinking-content");
          if (content) content.textContent += delta.delta;
        } else {
          const dots = currentThinkingBlock.querySelector(".agent-thinking-dots");
          if (dots) {
            const n = (dots.textContent.match(/\./g) || []).length;
            dots.textContent = "pensée" + ".".repeat(n >= 3 ? 1 : n + 1);
          }
        }
      }
    } else if (delta.type === "thinking_end") {
      if (currentThinkingBlock) {
        if (!superShowThinking) {
          currentThinkingBlock.remove();
        } else {
          const content = currentThinkingBlock.querySelector(".agent-thinking-content");
          const hasContent = content && content.textContent.trim().length > 0;
          if (!hasContent) currentThinkingBlock.remove();
        }
        currentThinkingBlock = null;
      }
    } else if (delta.type === "toolcall_start") {
      if (!currentBody) {
        currentBody = createSuperAgentBlock(messagesEl);
        currentFlow = currentBody.querySelector(".agent-stream-flow");
      }
      // On affiche l'outil à tool_execution_start (quand le nom est connu).
    } else if (delta.type === "toolcall_end") {
      // Rien à faire ici (le nom/args arrivent via tool_execution_start).
    }
    scrollSuperToBottom(messagesEl);
    return;
  }
  if (type === "tool_execution_start") {
    const toolName = payload.toolName || payload.tool || "outil";
    // Issue #55 : accumuler une empreinte du tool call (ex: commande bash) pour
    // détecter une boucle d'OUTILS identiques, même sans texte streamé répété.
    // RÈGLE 2 : une LECTURE n'est jamais un motif d'arrêt — ni un outil de lecture
    // pure, ni une commande shell PROUVÉE consultative (git status/diff/log, ls,
    // rg, sed -n…). Elle n'alimente donc pas l'historique qui peut arrêter
    // l'assistant (auparavant 3 lectures identiques suffisaient à le couper).
    if (!isReadOnlyAgentToolCall(toolName, payload.args)) {
      superLoopToolCalls.push(buildToolLoopFingerprint(toolName, payload.args));
    }
    // LECTURE comprise : un rappel qui déclenche une consultation n'est pas
    // stérile (règle de ménage n° 3). Tout appel d'outil compte comme détection.
    if (reminderUtilityProbe) reminderUtilityProbe.tools += 1;
    maybeDetectSuperAgentLoop(messagesEl);
    if (!currentBody) {
      currentBody = createSuperAgentBlock(messagesEl);
      currentFlow = currentBody.querySelector(".agent-stream-flow");
    }
    appendSuperToolInline("outil", toolName);
    scrollSuperToBottom(messagesEl);
    return;
  }
  if (type === "message_end") {
    // Fin du message streamé. Vérifier une erreur (ex: serveur LLM injoignable).
    pendingRender = false;
    const endMsg = payload.message;
    if (endMsg && endMsg.stopReason === "error" && endMsg.errorMessage) {
      appendSystemMessage(messagesEl, `❌ ${endMsg.errorMessage}`);
      statusEl.textContent = "Erreur";
    } else if (currentBody) {
      // Finaliser la section texte en attente.
      if (currentTextSection && pendingText) {
        currentTextSection.innerHTML = md.render(pendingText);
        pendingText = "";
      }
      // Retirer le bloc si rien de visible (évite les bulles vides / espaces
      // parasites entre réponses — issue #42). On ne retire que s'il n'y a ni
      // texte, ni pensée visible, ni outil, ni widget attaché.
      const flow = currentBody.querySelector(".agent-stream-flow");
      const hasChildren = flow && flow.children.length > 0;
      const hasChoices = currentBody.querySelector(".agent-choice");
      const hasText = flow && flow.textContent && flow.textContent.trim().length > 0;
      if (!hasChildren && !hasChoices && !hasText) {
        currentBody.remove();
        // Bulle vide retirée : libérer les refs pour que le prochain
        // message_start crée une NOUVELLE bulle (sinon on réutiliserait un
        // nœud détaché et le contenu suivant serait invisible).
        currentBody = null;
        currentFlow = null;
        currentTextSection = null;
        currentThinkingBlock = null;
      }
    }
    // Règle 1 : on NE reset PAS currentBody ici. Un tour d'agent peut contenir
    // plusieurs messages (texte → outil → texte) ; tout doit rester dans la
    // MÊME bulle. Le reset complet se fait à `agent_end` (onEnd) ou quand
    // l'utilisateur envoie un nouveau message.
    return;
  }
  if (type === "message") {
    const msg = payload.message;
    if (msg && msg.role === "assistant") {
      if (msg.stopReason === "error" && msg.errorMessage) {
        appendSystemMessage(messagesEl, `❌ ${msg.errorMessage}`);
        statusEl.textContent = "Erreur";
        onEnd();
        return;
      }
      const content = msg.content;
      let text = "";
      if (typeof content === "string") text = content;
      else if (Array.isArray(content)) {
        for (const part of content) {
          if (part.type === "text") text += part.text || "";
        }
      }
      if (text) {
        currentBody = createSuperAgentBlock(messagesEl);
        currentFlow = currentBody.querySelector(".agent-stream-flow");
        appendSuperTextSection(text, false);
        pendingText = "";
        // Chantier #15 : mémoriser le texte complet de la réponse (fallback non
        // streamé) pour l'extension des badges à agent_end.
        lastAssistantRawText = text;
      }
    }
    return;
  }
  if (type === "agent_start") {
    // P0-1 : l'événement agent_start reflète l'état RÉEL du backend — marque
    // l'assistant occupé immédiatement (même si la garde locale isStreaming est
    // en retard), pour que `send()` ne l'accepte puis perde une saisie.
    backendBusy = true;
    // Le tour commence RÉELLEMENT : la surface de rendu est occupée dès le
    // premier instant, sans attendre le premier delta. Un son de fin armé
    // pendant ce tour (compte rendu différé) ne doit pas être joué à sa fin :
    // il appartient au tour suivant (cf. sound-deferred.js).
    noteSoundRenderActivity("superagent");
    statusEl.textContent = "Réfléchit…";
    superSetReflecting(true);
    return;
  }
  if (type === "agent_end") {
    statusEl.textContent = "Prêt";
    // MÉNAGE DES RAPPELS : le tour déclenché par un rappel peut être relancé par
    // le backend (willRetry). Seule une fin RÉELLE permet de conclure à une
    // exécution stérile — sinon on ne compte rien (« en cas de doute : on garde »).
    if (shouldFinalizeOnAgentEnd(payload)) noteReminderTurnOutcome();
    else if (reminderUtilityProbe) reminderUtilityProbe.doubtful = true;
    // Chantier #15 : étendre les badges de la bulle de RÉPONSE avec les projets
    // nommés dans le texte de la réponse (en plus du snapshot de la demande).
    // On capture la bulle, les badges de base et le texte AVANT onEnd() (qui
    // reset currentBody/currentTurnProjectBadges/lastAssistantRawText), puis on
    // met à jour la bulle en fire-and-forget (jamais bloquant, fail-open).
    const respBubble = currentBody;
    // Badges FIGES de la bulle (nommes + concernes + dernier recours) : la
    // reponse peut y AJOUTER les projets qu'elle nomme, jamais en retirer.
    const respBase = (respBubble && bubbleBadgeSnapshots.get(respBubble)) || currentTurnProjectBadges;
    const respText = lastAssistantRawText;
    // Telegram (étape 2, lot 3) : l'Assistant « parle » — sa réponse finale est
    // reformulée en UNE phrase simple et transmise (les messages intermédiaires
    // sont écartés). Aucun envoi, aucune erreur si la communication est coupée.
    // Anti-doublon SANS PERTE : si l'Assistant n'a rien transmis (réponse vide ou
    // écartée par le filtre), les avis bruts retardés pendant ce tour partent
    // maintenant — un événement ne peut plus rester sans aucune information.
    const spokenToTelegram = relayAssistantMessageToTelegram(respText, {
      project: assistantTelegramProject(),
    });
    onEnd();
    if (!spokenToTelegram) flushRawTelegramAvis();
    // Fin de flux : une fois la dernière frame de rendu peinte, le rendu est au
    // repos → le son de fin armé (délégation / run d'agents) peut être joué.
    // Ignoré si cet agent_end n'est pas terminal (la session reprend).
    flushSuperRenderThenSoundIdle(payload);
    if (respBubble && respBase && respText && String(respText).trim()) {
      extendResponseBubbleBadges(respBubble, respBase, respText).catch((e) => console.error("extendResponseBubbleBadges erreur:", e));
    }
    // Bug 2 (UX) : à la fin de la génération, redescendre en bas si l'utilisateur
    // était en bas (le contenu a fini de grandir). Ne force pas si l'utilisateur
    // a volontairement remonté pour relire.
    scrollSuperToBottom(messagesEl);
    // A19 : synthèse vocale — lire la réponse complète si activée.
    if (speakEnabled) speak(lastAssistantRawText);
    return;
  }
  if (type === "extension_ui_request") {
    handleSuperAgentExtensionUiRequest(payload, messagesEl, state);
    return;
  }
  if (type === "process_exit" || type === "process_error") {
    // Faux départ au lancement : le processus pi du super-agent meurt une fois
    // puis est relancé automatiquement par la politique anti-boucle Rust. On
    // réinitialise l'état immédiatement (onEnd) mais on DIFFÈRE l'affichage du
    // message d'alerte : si la session redevient vivante dans la fenêtre de
    // grâce, on ne montre rien ; sinon (vrai blocage) on déclenche l'alerte.
    // P0 (issue #84) : bufferiser le stderr réel (process_error) pour pouvoir
    // l'exposer dans le message si la session reste morte (onFail). Les bulles
    // étant rendues via textContent, le texte est HTML-sûr.
    if (type === "process_error" && payload && typeof payload.text === "string") {
      superAgentStderrBuffer = (superAgentStderrBuffer + payload.text).slice(-SUPER_AGENT_STDERR_MAX);
    }
    onEnd();
    // Échec du processus : aucun signal de fin de rendu ne viendra. On remet le
    // lecteur de son différé à zéro (surface active périmée → son suivant
    // immédiat, jamais retardé par le délai de sécurité).
    resetDeferredSound();
    scheduleTransientDisconnect(messagesEl, statusEl, () => {
      const msg = buildSuperAgentDisconnectedMessage();
      appendSystemMessage(messagesEl, msg);
      // Issue #16 : anomalie de suivi — notifier (si le réglage est activé).
      notifySuperAgentDone({
        title: "Pilot — Assistant",
        body: msg,
        project: assistantTelegramProject(),
        ok: false,
        type: "alert",
        problem: "la connexion à l'assistant est perdue",
        decision: "le relancer depuis son onglet",
      }).catch(() => {});
      // Son « point » : point important / anomalie (si le son est activé).
      playAssistantSound("point").catch(() => {});
    });
    return;
  }
}

/**
 * Message « Connexion au super-agent perdue », enrichi d'un court extrait de
 * stderr réel (issue #84) quand le buffer en contient un, pour révéler la cause
 * au lieu de la masquer. Extrait borné (~500 chars), HTML-sûr (rendu via
 * textContent), jamais de stack complète. Sans extrait, retourne le message
 * générique seul (comportement d'avant). `buf` est optionnel : en prod, le
 * buffer interne `superAgentStderrBuffer` est utilisé (module) ; fourni pour
 * tester le formatage en isolation (vitest).
 * @param {string|undefined} [buf]
 * @returns {string}
 */
export function buildSuperAgentDisconnectedMessage(buf) {
  const base = "⚠️ Connexion au super-agent perdue.";
  const raw = buf !== undefined ? String(buf) : superAgentStderrBuffer || "";
  const extract = superAgentStderrExtractFrom(raw);
  if (!extract) return base;
  return `${base} Cause probable : ${extract}`;
}

/**
 * Extrait court (~500 chars) du dernier stderr super-agent, nettoyé des
 * caractères de contrôle et des lignes vides (diagnostic lisible, pas de
 * bruit). Retourne "" si aucun stderr n'a été capturé. Pure et testable.
 * @param {string} raw
 * @returns {string}
 */
export function superAgentStderrExtractFrom(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const clean = s
    .split(/\r?\n/)
    .map((l) => l.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trimEnd())
    .filter(Boolean)
    .join(" | ");
  return clean.length <= 500 ? clean : "…" + clean.slice(-500);
}

/**
 * Fenêtre de grâce (ms) après un faux départ du super-agent (correctif V2).
 * Alignée sur la politique anti-crash Rust (agent_service.rs) :
 * SUPERAGENT_CRASH_WINDOW=20 s + SUPERAGENT_RESTART_COOLDOWN=30 s. L'ancienne
 * valeur (8 s) était inférieure au cooldown de redémarrage légitime : pendant
 * un redémarrage/cooldown (>8 s), le frontend déclarait « perdue » à tort.
 * Exportée pour les tests (vitest).
 */
export const SUPER_AGENT_GRACE_WINDOW_MS = 30000;

/**
 * Détecte un message « Connexion au super-agent perdue » (avec ou sans extrait
 * de stderr). Pure et testable — utilisée pour retirer le message obsolète
 * quand le processus redevient vivant (correctif V2).
 * @param {string} text
 * @returns {boolean}
 */
export function isSuperAgentDisconnectedMessage(text) {
  return String(text || "").includes("Connexion au super-agent perdue");
}

/**
 * Décide si le message « Connexion perdue » doit être retiré : uniquement si
 * le processus est redevenu vivant (`alive`) ET qu'un tel message est présent.
 * Pure et testable. Ne masque jamais un VRAI blocage : si la session reste
 * morte (`alive=false`), on ne retire rien.
 * @param {boolean} alive
 * @param {boolean} hasDisconnectedMessage
 * @returns {boolean}
 */
export function shouldClearDisconnectedMessage(alive, hasDisconnectedMessage) {
  return !!alive && !!hasDisconnectedMessage;
}

/**
 * Délai de grâce après un faux départ du super-agent (onglet 🧭 Assistant).
 * Un `process_exit` au lancement est souvent transitoire : le processus pi meurt
 * une fois puis est relancé automatiquement (politique anti-boucle Rust). On
 * sonde la vivacité du super-agent via get_agent_supervision (agent
 * « Assistant (Magnus) », champ `alive`) toutes les 500 ms pendant ~30 s
 * (SUPER_AGENT_GRACE_WINDOW_MS, aligné sur le cooldown anti-crash Rust) :
 *   - redevient vivant  → reconnexion : PAS d'alerte, statut remis à « Prêt »
 *     (style idle, comme le poll de statut), trace console pour diagnostic.
 *   - toujours mort à l'expiration → onFail() qui déclenche l'alerte (message +
 *     notification + son) : on ne masque jamais un VRAI blocage.
 */
function scheduleTransientDisconnect(messagesEl, statusEl, onFail) {
  const GRACE_WINDOW_MS = SUPER_AGENT_GRACE_WINDOW_MS;
  const POLL_MS = 500;
  const start = Date.now();
  const timer = setInterval(async () => {
    let alive = false;
    try {
      const sup = await invoke("get_agent_supervision");
      const proj = sup && sup.projects && sup.projects.find((p) => !(p.path || ""));
      // Le libellé de la session d'assistant suit le nom réglé (⚙️ → Assistant →
      // Nom) : on compare le libellé courant, avec repli sur l'ancien libellé codé
      // en dur (compatibilité avec un cœur qui n'aurait pas encore la correction).
      // Sinon, renommer l'assistant faisait échouer cette sonde de reconnexion
      // (libellé « Magnus » introuvable) : un faux départ rattrapé était pris
      // pour un vrai blocage au bout de la fenêtre de grâce.
      const superLabel = superAgentDisplayLabel();
      const agent = proj && findAssistantSessionAgent(proj.agents, superLabel);
      alive = !!(agent && agent.alive);
    } catch (_) { /* ignore, on garde alive=false et on test le délai */ }
    if (alive) {
      // Faux départ rattrapé : le processus est de nouveau vivant.
      clearInterval(timer);
      statusEl.textContent = "Prêt";
      statusEl.className = "agent-status agent-status-idle";
      console.log("[super-agent] reconnexion après faux départ");
      return;
    }
    if (Date.now() - start >= GRACE_WINDOW_MS) {
      // Vrai blocage : la session est restée morte — ne rien masquer.
      clearInterval(timer);
      statusEl.textContent = "Déconnecté";
      onFail();
    }
  }, POLL_MS);
}

/**
 * Retire le message « Connexion au super-agent perdue » du volet « Événements »
 * du panneau du suivi du travail quand le processus redevient vivant (correctif
 * V2). Idempotent et fail-open : si le panneau n'existe pas ou qu'aucun message
 * n'est présent, ne fait rien. Ne retire JAMAIS un message si la session reste
 * morte (vrai blocage) — la décision est pilotée par `shouldClearDisconnectedMessage`
 * côté appelant (superStatusPoll, `alive`).
 */
function removeSuperAgentDisconnectedEvent() {
  const superEventsList = agentPanelEventsListElement();
  if (!superEventsList) return;
  const items = superEventsList.querySelectorAll(".sa-events-item");
  for (const item of items) {
    if (isSuperAgentDisconnectedMessage(item.textContent)) {
      item.remove();
      break;
    }
  }
}

// ── Questions posées par l'assistant (pilot-choices) ──

/**
 * Gère les demandes d'interaction de l'extension pilot-choices (ask_choice,
 * ask_confirm, ask_input, ask_multi_choice) : rend des boutons inline dans le
 * chat et renvoie la réponse au processus pi via `send_super_agent_command`.
 */
async function handleSuperAgentExtensionUiRequest(payload, messagesEl, state) {
  const { id, method } = payload;

  // 4.2 (issue #55) : accumuler une empreinte de la réponse d'outil dans le
  // buffer de détection de boucle (pas seulement les deltas streamés).
  try {
    accumulateSuperLoopToolResponse(messagesEl, method, payload);
  } catch (_) {}

  if (method === "notify") {
    // Tâche #139 : les notifications pures (informatif) partent dans le panneau
    // des événements système, PAS au centre de la discussion. Les éléments
    // interactifs (confirm/select/choice) restent au centre.
    const type = payload.notifyType || "info";
    const msg = payload.message || "";
    const level = type === "error" ? "error" : type === "warn" || type === "warning" ? "warn" : type === "success" ? "success" : "info";
    pushSuperAgentSystemEvent(level, msg);
    return;
  }

  if (method === "setStatus" || method === "setWidget" || method === "setTitle" || method === "set_editor_text") {
    return;
  }

  if (method === "confirm") {
    // Action assistant (TÂCHE 2) : l'extension pilot-assistant-actions envoie un
    // confirm avec un message sentinel + JSON ({action, path|request}). On
    // intercepte pour exécuter l'action (ouvrir un projet / déléguer à l'agent
    // du projet) au lieu d'afficher des boutons Oui/Non.
    const ACTION_SENTINEL = "PILOT_ASSISTANT_ACTION::";
    const rawMsg = payload.message || "";
    if (rawMsg.startsWith(ACTION_SENTINEL)) {
      handleSuperAgentAction(id, rawMsg.slice(ACTION_SENTINEL.length), messagesEl);
      return;
    }
    // Son « attention » : l'assistant pose une question (si le son est activé).
    playAssistantSound("attention").catch(() => {});
    renderSuperAgentConfirm(messagesEl, state, id, payload.title || "Confirmation", payload.message || "");
  } else if (method === "select") {
    const options = payload.options || [];
    const rawTitle = payload.title || "Choix";
    const MULTI_SENTINEL = "PILOT_MULTI_CHOICE::";
    const CONFIRM_SENTINEL = "PILOT_CONFIRM::";
    const multi = rawTitle.startsWith(MULTI_SENTINEL);
    const confirm = rawTitle.startsWith(CONFIRM_SENTINEL);
    let title = rawTitle;
    let confirmMessage = "";
    if (multi) {
      title = rawTitle.slice(MULTI_SENTINEL.length);
    } else if (confirm) {
      try {
        const parsed = JSON.parse(rawTitle.slice(CONFIRM_SENTINEL.length));
        title = parsed.title || "Confirmation";
        confirmMessage = parsed.message || "";
      } catch {
        title = rawTitle.slice(CONFIRM_SENTINEL.length);
      }
    }
    if (confirm) {
      renderSuperAgentConfirm(messagesEl, state, id, title, confirmMessage);
    } else {
      // Son « attention » : l'assistant pose une question (si le son est activé).
      playAssistantSound("attention").catch(() => {});
      renderSuperAgentChoice(messagesEl, state, id, title, options, multi);
    }
  } else if (method === "input") {
    // Outils DB de l'assistant (pilot-assistant-db) : le titre est préfixé par un
    // sentinel + le SQL. On exécute la requête via Rust et on renvoie le résultat
    // (JSON) comme `value` de la réponse, au lieu d'afficher un champ de saisie.
    const DB_QUERY_SENTINEL = "PILOT_ASSISTANT_DB_QUERY::";
    const DB_EXEC_SENTINEL = "PILOT_ASSISTANT_DB_EXEC::";
    const PROMPT_SENTINEL = "PILOT_ASSISTANT_PROMPT::";
    const RUN_AGENTS_SENTINEL = "PILOT_ASSISTANT_RUN_AGENTS::";
    const RUN_ASSISTANT_AGENTS_SENTINEL = "PILOT_ASSISTANT_RUN_ASSISTANT_AGENTS::";
    const SESSIONS_SENTINEL = "PILOT_ASSISTANT_SESSIONS::";
    const MCP_STATE_SENTINEL = "PILOT_ASSISTANT_MCP_STATE::";
    const MEMORY_SAVE_SENTINEL = "PILOT_ASSISTANT_MEMORY_SAVE::";
    const MEMORY_REMOVE_SENTINEL = "PILOT_ASSISTANT_MEMORY_REMOVE::";
    const MEMORY_RESTORE_SENTINEL = "PILOT_ASSISTANT_MEMORY_RESTORE::";
    const MEMORY_TRASH_LIST_SENTINEL = "PILOT_ASSISTANT_MEMORY_TRASH_LIST::";
    const DELEGATION_SENTINEL = "PILOT_ASSISTANT_DELEGATION::";
    const PROJECT_SNAPSHOT_SENTINEL = "PILOT_ASSISTANT_PROJECT_SNAPSHOT::";
    const GIT_STATUS_SENTINEL = "PILOT_ASSISTANT_GIT_STATUS::";
    const GIT_LOG_SENTINEL = "PILOT_ASSISTANT_GIT_LOG::";
    const TELEGRAM_NOTIFY_SENTINEL = "PILOT_ASSISTANT_TELEGRAM_NOTIFY::";
    const SCHEDULE_SENTINEL = "PILOT_ASSISTANT_SCHEDULE::";
    const TOOLS_SENTINEL = "PILOT_ASSISTANT_TOOLS::";
    // Documentation intégrée de Pilot (outil `answer_from_documentation`, lot
    // « l'assistant répond sur la doc ») : le titre porte UNIQUEMENT la
    // question. Une seule entrée, aucun chemin de projet, aucun fichier.
    // Le relais exécute la commande du socle (`ask_help_doc`) — aucun second
    // mécanisme, aucune lecture de fichier.
    const DOC_SENTINEL = "PILOT_ASSISTANT_DOC::";
    // Retrait CIBLE d'une mission en attente (outil `remove_queued_mission`).
    // L'assistant ne voit jamais la file : il designe la demande par son rang
    // affiche (`/file`) ou par son numero de mission.
    const QUEUE_REMOVE_SENTINEL = "PILOT_ASSISTANT_QUEUE_REMOVE::";
    const title = payload.title || "";
    if (title.startsWith(QUEUE_REMOVE_SENTINEL)) {
      let info = {};
      try {
        info = JSON.parse(title.slice(QUEUE_REMOVE_SENTINEL.length)) || {};
      } catch (_) {
        info = {};
      }
      // Chargement PARESSEUX : la vue de file importe deja ce module (eviter un
      // cycle d'imports statique) — et elle reste la SEULE source de l'ordre
      // affiche (rangs), donc la seule a savoir traduire un rang en mission.
      let result;
      try {
        const { removeProjectQueuedMission } = await import("./project-queue-view.js");
        const project = (typeof info.project === "string" && info.project) || window._pilotProjectPath || ".";
        result = removeProjectQueuedMission(project, {
          rank: info.rank,
          missionId: info.mission_id != null ? info.mission_id : info.missionId,
          reason: "queue-mission-removed",
          detected: "assistant-remove-one",
        });
      } catch (e) {
        result = { ok: false, removed: 0, remaining: 0, reason: "error", message: `Retrait impossible : ${String(e)}` };
      }
      await respondSuperAgent(
        id,
        JSON.stringify({
          ok: !!result.ok,
          removed: result.removed || 0,
          remaining: Number.isFinite(result.remaining) ? result.remaining : 0,
          reason: result.reason || "",
          message: result.message || "",
        }),
        false,
      );
      return;
    }
    if (title.startsWith(MEMORY_SAVE_SENTINEL)) {
      // Mémoire de session (pilot-assistant-session-memory) : l'assistant
      // enregistre un résumé compact (sujet en cours, chantiers en cours) via
      // l'outil `update_session_memory`. On le persiste via Rust et on renvoie
      // « ok » comme `value` de la réponse.
      const resume = title.slice(MEMORY_SAVE_SENTINEL.length);
      try {
        await invoke("super_agent_save_session_memory", { resume });
        await respondSuperAgent(id, JSON.stringify({ ok: true }), false);
      } catch (e) {
        await respondSuperAgent(id, JSON.stringify({ error: String(e) }), false);
      }
      return;
    }
    if (title.startsWith(MEMORY_REMOVE_SENTINEL)) {
      // Mémoire de session (pilot-assistant-session-memory) : retrait ciblé d'un
      // fait (entrée work_in_progress, ou vidage d'un champ texte) via l'outil
      // `remove_session_memory`. Le retrait part dans une corbeille bornée côté
      // Rust (donc annulable) ; on renvoie la nouvelle mémoire + l'identifiant du
      // retrait (`trash_id`), qui permet de le remettre en place précisément.
      const parsed = parseMemoryRemovePayload(title.slice(MEMORY_REMOVE_SENTINEL.length));
      if (parsed.error) {
        await respondSuperAgent(id, JSON.stringify({ error: parsed.error }), false);
        return;
      }
      try {
        const result = await invoke("super_agent_remove_session_memory", {
          target: parsed.target,
          field: parsed.field || null,
        });
        await respondSuperAgent(
          id,
          JSON.stringify({ ok: true, memory: result.memory, trash_id: result.trash_id }),
          false,
        );
      } catch (e) {
        await respondSuperAgent(id, JSON.stringify({ error: String(e) }), false);
      }
      return;
    }
    if (title.startsWith(MEMORY_TRASH_LIST_SENTINEL)) {
      // Mémoire de session (pilot-assistant-session-memory) : parcours de la
      // corbeille via l'outil `list_session_memory_trash`. On liste les retraits
      // en attente (du plus récent au plus ancien) avec leur identifiant, pour
      // pouvoir cibler la remise en place sans annuler les retraits plus récents.
      const parsed = parseMemoryTrashListPayload(
        title.slice(MEMORY_TRASH_LIST_SENTINEL.length),
      );
      if (parsed.error) {
        await respondSuperAgent(id, JSON.stringify({ error: parsed.error }), false);
        return;
      }
      try {
        const result = await invoke("super_agent_list_session_memory_trash");
        await respondSuperAgent(id, JSON.stringify({ ok: true, ...formatMemoryTrashList(result) }), false);
      } catch (e) {
        await respondSuperAgent(id, JSON.stringify({ error: String(e) }), false);
      }
      return;
    }
    if (title.startsWith(MEMORY_RESTORE_SENTINEL)) {
      // Mémoire de session (pilot-assistant-session-memory) : remise en place
      // d'un retrait via l'outil `restore_session_memory` (par id, ou le plus
      // récent si l'id est absent). On renvoie la nouvelle mémoire en JSON.
      const parsed = parseMemoryRestorePayload(title.slice(MEMORY_RESTORE_SENTINEL.length));
      if (parsed.error) {
        await respondSuperAgent(id, JSON.stringify({ error: parsed.error }), false);
        return;
      }
      try {
        const result = await invoke("super_agent_restore_session_memory", {
          id: parsed.id || null,
        });
        await respondSuperAgent(id, JSON.stringify({ ok: true, memory: result }), false);
      } catch (e) {
        await respondSuperAgent(id, JSON.stringify({ error: String(e) }), false);
      }
      return;
    }
    if (title.startsWith(DB_QUERY_SENTINEL)) {
      const sql = title.slice(DB_QUERY_SENTINEL.length);
      try {
        const result = await invoke("super_agent_db_query", { sql });
        await respondSuperAgent(id, JSON.stringify(result), false);
      } catch (e) {
        await respondSuperAgent(id, JSON.stringify({ error: String(e) }), false);
      }
      return;
    }
    if (title.startsWith(DB_EXEC_SENTINEL)) {
      const sql = title.slice(DB_EXEC_SENTINEL.length);
      try {
        const result = await invoke("super_agent_db_execute", { sql });
        await respondSuperAgent(id, JSON.stringify(result), false);
      } catch (e) {
        await respondSuperAgent(id, JSON.stringify({ error: String(e) }), false);
      }
      return;
    }
    if (title.startsWith(DOC_SENTINEL)) {
      // Réponse à partir de la documentation intégrée : on délègue à la commande
      // du socle (help::answer_from_handbook) et on renvoie le résultat
      // structuré (texte, sections recoupées, drapeaux) en JSON. Aucun accès aux
      // fichiers du projet : la commande ne prend QUE la question.
      const question = title.slice(DOC_SENTINEL.length);
      try {
        const answer = await invoke("ask_help_doc", { question });
        await respondSuperAgent(id, JSON.stringify(answer), false);
      } catch (e) {
        await respondSuperAgent(id, JSON.stringify({ error: String(e) }), false);
      }
      return;
    }
    if (title.startsWith(PROMPT_SENTINEL)) {
      const newPrompt = title.slice(PROMPT_SENTINEL.length);
      try {
        await invoke("set_super_agent_prompt", { prompt: newPrompt });
        await respondSuperAgent(id, JSON.stringify({ ok: true }), false);
      } catch (e) {
        await respondSuperAgent(id, JSON.stringify({ error: String(e) }), false);
      }
      return;
    }
    if (title.startsWith(RUN_AGENTS_SENTINEL)) {
      // Outil run_agents (coordinateur assistant) : l'assistant choisit quels
      // agents utiliser et confie une tâche. Pilot lance la run sur les agents
      // sélectionnés (en parallèle) en ARRIÈRE-PLAN (non bloquant) et renvoie
      // « ok » immédiatement pour que l'assistant finisse son tour (l'input
      // utilisateur reste débloqué pendant que les agents travaillent). Le
      // résultat agrégé est injecté à l'assistant à la fin de la run via
      // inject_session_summary.
      let info;
      try {
        info = JSON.parse(title.slice(RUN_AGENTS_SENTINEL.length));
      } catch (_) {
        await respondSuperAgent(id, JSON.stringify({ error: "Payload run_agents invalide." }), false);
        return;
      }
      // AGENT JETABLE : la demande peut décrire l'agent elle-même (`agents` :
      // tableau d'objets `{ name, role, … }`) au lieu de nommer un agent du
      // registre. Ces agents sont créés EN MÉMOIRE SEULE (aucune écriture en
      // base) et ne vivent que le temps de cette tâche.
      const inlineAgents = (Array.isArray(info.agents) ? info.agents : []).filter(
        (s) => s && typeof s === "object" && !Array.isArray(s)
      );
      const agentIds = Array.isArray(info.agent_ids) ? info.agent_ids.map(String) : [];
      const task = String(info.task || "").trim();
      // RÉSUMÉ COURT fourni avec la demande (facultatif) : une phrase qui dit la
      // tâche réelle, plafonnée à 120 caractères. Il est conservé avec la
      // mission (en cours ET en attente) et affiché EN PREMIER dans le panneau
      // des tâches, au lieu d'être déduit du prompt après coup. Absent ou
      // inutilisable → `""` : l'affichage retombe alors sur l'extraction de
      // l'objectif (comportement antérieur, aucune régression).
      const resume = normalizeMissionResume(info.resume);
      // Ciblage de projet (run_agents) : chemin absolu du projet cible, ou null
      // → projet actif par défaut (rétrocompatible). MCP piloté (brique B) :
      // serveur MCP cible (id) que les agents chargent à la demande.
      const targetProject = (info.project && String(info.project).trim()) || null;
      const mcpServer = (info.mcp_server && String(info.mcp_server).trim()) || null;
      if ((agentIds.length === 0 && inlineAgents.length === 0) || !task) {
        await respondSuperAgent(id, JSON.stringify({ error: "run_agents : au moins un agent et une tâche requis." }), false);
        return;
      }
      try {
        // Valider que le projet cible existe avant de lancer (sinon erreur claire).
        if (targetProject) {
          const exists = await invoke("file_exists", { path: targetProject });
          if (!exists) {
            await respondSuperAgent(id, JSON.stringify({ error: `run_agents : le projet cible « ${targetProject} » n'existe pas.` }), false);
            return;
          }
        }
        const registry = await loadAgentRegistry();
        const known = new Set((registry.agents || []).map((a) => a && a.id));
        const missing = agentIds.filter((aid) => !known.has(aid));
        if (missing.length > 0) {
          await respondSuperAgent(id, JSON.stringify({ error: unknownAgentsError(missing, registry) }), false);
          return;
        }
        // AGENT JETABLE : matérialiser les agents fournis à la volée, APRÈS la
        // vérification des identifiants du registre (le garde ci-dessus reste
        // inchangé et ne dépend d'aucun agent éphémère). Aucune ligne n'est
        // écrite dans la table `agents` : l'enregistrement se fait côté cœur
        // Rust en MÉMOIRE (repli de `get_agent`), et le magasin JS porte la
        // définition pour le bus. Si l'enregistrement échoue, on RENONCE au
        // lancement (sinon le spawn « seederait » une ligne en base : exactement
        // ce que la mission interdit).
        const ephemeralScope = targetProject || window._pilotProjectPath || null;
        const ephemeralAgents = [];
        for (const spec of inlineAgents) {
          const built = buildEphemeralAgent(spec, { projectPath: ephemeralScope || null });
          if (!built) {
            await respondSuperAgent(
              id,
              JSON.stringify({ error: "run_agents : agent fourni à la volée invalide (un rôle ou un nom est requis)." }),
              false
            );
            return;
          }
          try {
            await persistEphemeralAgent(built, ephemeralScope || null);
          } catch (e) {
            await respondSuperAgent(
              id,
              JSON.stringify({ error: `run_agents : impossible de préparer l'agent jetable « ${built.name} » (${e}). Aucun agent n'a été lancé.` }),
              false
            );
            return;
          }
          ephemeralAgents.push(built);
        }
        // Identifiants de la mission = agents du registre + agents jetables (ces
        // derniers ne peuvent pas être « inconnus » : ils viennent d'être créés).
        for (const built of ephemeralAgents) agentIds.push(built.id);
        // GARDE-FOU LIVRABLE (1/2) — REFUS AU LANCEMENT. Une demande qui demande
        // EXPLICITEMENT d'écrire/créer/modifier un fichier et qui ne vise QUE des
        // agents en lecture seule est refusée AVANT tout démarrage : sinon Pilot
        // annonce « tâche terminée » sur un fichier qui n'existera jamais (défaut
        // du rapport rapport-diagnostic-agent-rend-un-plan.md). Le refus NOMME
        // l'agent, la raison et la sortie, et remonte à l'assistant comme une
        // erreur d'outil — il n'échoue pas en silence. Dans le doute (pas de verbe
        // d'écriture, pas de cible de fichier) : aucune décision, on lance comme
        // avant.
        const expectedFiles = normalizeExpectedFiles(info.expected_files);
        const requestedAgents = agentIds
          .map((aid) => {
            const ag = (registry.agents || []).find((a) => a && a.id === aid);
            if (ag) return { id: ag.id, name: ag.name || ag.id, readonly: ag.readonly === true };
            const eph = ephemeralAgents.find((a) => a.id === aid);
            return eph ? { id: eph.id, name: eph.name || eph.id, readonly: eph.readonly === true } : null;
          })
          .filter(Boolean);
        const readOnlyRefusal = readOnlyWriteRefusalMessage({ tool: "run_agents", agents: requestedAgents, task, expectedFiles });
        if (readOnlyRefusal) {
          // Aucun agent n'a été lancé : les agents jetables préparés pour cette
          // demande n'ont plus lieu d'exister (aucune session, rien en base).
          disposeEphemeralAgents(agentIds, ephemeralScope || null).catch(() => {});
          appendSystemMessage(messagesEl, `⛔ ${readOnlyRefusal}`);
          await respondSuperAgent(id, JSON.stringify({ error: readOnlyRefusal, launched: false }), false);
          return;
        }
        appendSystemMessage(messagesEl, `🤖 Je lance la tâche sur les agents : ${agentIds.join(", ")}…`);
        // Anti-boucle : l'enveloppe de brief STRUCTURÉ (contexte/objectif/
        // consignes/ce qu'il ne faut PAS faire) est appliquée ICI, côté
        // super-agent.js, via applyAssistantBriefEnvelope (elle garantit aussi
        // la consigne quality-gate). Le bus d'agents (agents-bus.js) passe le
        // brief tel quel à l'agent — c'est donc ce module qui construit
        // l'enveloppe, pas le bus. + purge de la conversation de chaque agent
        // avant la run (contexte vierge). Le CONTEXTE DE SUIVI de l'assistant
        // (projet, tâches, décisions, sessions, mémoire) est joint
        // automatiquement AU LANCEMENT, sur le projet cible (`attachLaunchContext`
        // ci-dessous) — jamais figé ici : une demande mise en file derrière une
        // autre ne doit pas emporter le contexte de la mission PRÉCÉDENTE.
        const baseBrief = applyAssistantBriefEnvelope(task, {
          forceStructured: configCache.super_agent_force_structured_brief !== false,
          qualityGate: configCache.super_agent_quality_gate !== false,
        });
        // BUG « une tâche mise en file exécute la tâche précédente » : le contexte
        // de suivi est relu DANS LE CHEMIN DE LANCEMENT (`attachLaunchContext`,
        // appelé par `launchOrQueue` au moment réel du démarrage, donc aussi au
        // rejeu de la file). À l'arrivée, seule l'enveloppe (qui ne dépend pas du
        // suivi) est appliquée.
        const assignments = agentIds.map((aid) => ({
          agentId: aid,
          brief: baseBrief,
          project: targetProject,
          mcp_server: mcpServer,
          resume,
          // GARDE-FOU LIVRABLE (2/2) : fichiers déclarés comme réellement
          // attendus sur disque (chemins relatifs au projet) + dossier de
          // référence où les chercher en fin de mission. Vides ⇒ comportement
          // antérieur, inchangé.
          expectedFiles,
          expectedFilesBase: targetProject || window._pilotProjectPath || null,
        }));
        // CONTEXTE DE SUIVI relu AU LANCEMENT (voir `refreshAssignmentsBrief`) :
        // la mission peut avoir attendu en file, le suivi a changé depuis son
        // arrivée. Appelé dans le chemin de lancement, jamais à l'arrivée.
        let launchContextAnnounced = false;
        const attachLaunchContext = async () => {
          const brief = await refreshAssignmentsBrief(assignments, baseBrief, targetProject || window._pilotProjectPath || null, task);
          if (brief !== baseBrief && !launchContextAnnounced) {
            launchContextAnnounced = true;
            appendSystemMessage(messagesEl, "🧠 Contexte de suivi joint à la demande de l'agent.");
          }
          return brief;
        };
        // Nature de la mission : LECTURE seulement si TOUS les agents demandés
        // sont en lecture seule (registre des agents, champ `readonly`). Une
        // mission de LECTURE est partagée ; une MODIFICATION est exclusive sur
        // le projet (verrou par projet à lecteurs partagés).
        const missionReadOnly = agentIds.every((aid) => {
          const ag = (registry.agents || []).find((a) => a && a.id === aid);
          if (ag) return ag.readonly === true;
          // AGENT JETABLE : sa nature vient de la définition fournie à la volée.
          const eph = ephemeralAgents.find((a) => a.id === aid);
          return !!(eph && eph.readonly === true);
        });
        const missionNature = missionReadOnly ? "read" : "write";
        const projectPath = window._pilotProjectPath || null;
        // T5 : exclusivité des spécialités par projet. Si un agent demandé est
        // déjà actif sur le projet cible, la demande sera mise en file d'attente
        // (elle se lancera à la fin de la tâche en cours). On prévient
        // l'assistant immédiatement pour qu'il sache que la demande n'est pas
        // perdue mais différée.
        const target = targetProject || window._pilotProjectPath || ".";
        // REGLE 2 (nommage des bulles) : le projet VISE par la mission est le
        // projet reellement concerne par ce tour (il prime sur le projet ouvert).
        noteConcernedProject(targetProject || window._pilotProjectPath || null);
        try {
          const sessionsRes = await invoke("list_agent_sessions");
          const sessions = (sessionsRes && sessionsRes.sessions) || [];
          // Verrou fantôme (busy-stale) : un agent busy retenu par un process pi
          // figé (ni settled ni exit) est compté comme actif par le filtre brut
          // `s.busy && mode==='agent_process'`, ce qui prévient l'assistant et met
          // la demande en file derrière un fantôme. Une session busy-stale n'est
          // plus exclusive (tâche 1) : on ne la compte PAS comme active.
          const stale = sessions.some((s) => s.mode === "agent_process" && sameProject(s.project, target) && isBusyStale(s));
          const staleProject = targetProject || window._pilotProjectPath || null;
          const staleDeleg = delegationState(staleProject);
          if (stale && (staleDeleg.busy || staleDeleg.queue.length > 0)) {
            // C'est là qu'a échoué 205e417 (côté super-agent seulement) : le
            // pré-check de run_agents ne libérait pas le flux de DÉLÉGATION. Un
            // agent standard busy-stale retient busy=true sans jamais émettre
            // agent_end → toutes les délégations suivantes s'empilent dans la
            // file pour toujours. On libère le flag DU PROJET et on rejoue la
            // demande suivante (flushDelegationQueue) pour ne pas laisser les
            // demandes coincées derrière un fantôme.
            appendSystemMessage(messagesEl, `🧹 ${staleDeleg.queue.length} demande(s) en file de délégation libérée(s) : l'agent marqué actif est figé (busy-stale, sans progression).`);
            staleDeleg.busy = false;
            flushDelegationQueue(staleProject);
          }
          const queuedIds = agentIds.filter((aid) =>
            sessions.some((s) => s.agent === aid && s.busy && s.mode === "agent_process" && sameProject(s.project, target) && !isBusyStale(s))
          );
          if (queuedIds.length > 0) {
            const msg = `⏳ L'agent${queuedIds.length > 1 ? "s" : ""} ${queuedIds.join(", ")} est déjà actif sur ce projet. La demande est mise en file d'attente ; elle démarrera automatiquement dès que le projet sera libre.`;
            appendSystemMessage(messagesEl, msg);
            injectRunAgentsResultToSuperAgent(`[Info run_agents] ${msg}`, projectPath);
          }
        } catch (_) {
          // Sonde indisponible : on ne bloque pas le lancement (fail-open).
        }
        // T5 : informer l'assistant quand une demande en file d'attente démarre
        // réellement, ou quand un agent délégué est arrêté automatiquement (T2,
        // message ⏱️). (événement notify du bus d'agents).
        setBusNotifyCallback(({ agentId, message }) => {
          if (message && (message.startsWith("⏳") || message.startsWith("▶️") || message.startsWith("⏱️"))) {
            injectRunAgentsResultToSuperAgent(`[Info run_agents] ${message}`, projectPath);
          }
          // Point de suivi 331 : rendre VISIBLE le repli de modèle dans le
          // panneau d'événements de l'Assistant (là où la run a été lancée).
          if (message && message.startsWith("⚠️ Modèle")) {
            pushSuperAgentSystemEvent("warn", message);
          }
        });
        // Non bloquant : on lance la run en arrière-plan et on renvoie « ok »
        // immédiatement. Le résultat est injecté à l'assistant à la fin.
        // P1-5/P1-6 : la finalisation passe par `settleRun` (module-level, via
        // inject_session_summary côté Rust) pour survivre à la fermeture de
        // l'onglet ; et `startRun` met en file un second lancement au lieu
        // d'échouer si une run est déjà en cours (bus agents : « Une run est
        // déjà en cours »).
        let runSettled = false;
        // RÈGLE 4 : identité de CETTE mission (numéro monotone + agents visés).
        // Elle est posée sur l'entrée de file (si la demande y est mise) ET
        // portée jusqu'au compte rendu livré à l'assistant : une demande rejouée
        // depuis la file annonce donc SA demande, jamais celle d'une autre.
        // Allocation par le point unique de production (voir
        // `allocateMissionIdentity`).
        const missionIdentity = allocateMissionIdentity(agentIds);
        // T5 : la file et le verrou de run sont indexés PAR PROJET (`target` =
        // projet cible de la run). Une run sur un AUTRE projet ne bloque pas.
        const settleRun = (ok, result) => {
          if (runSettled) return; // anti double-résolution (onDone + catch)
          runSettled = true;
          runAgentsInFlightByProject[inFlightKey(target)] = false;
          // Annule le watchdog du projet : la run s'est terminée normalement.
          const wd = runAgentsWatchdogByProject[watchdogKey(target)];
          if (wd) {
            clearTimeout(wd);
            delete runAgentsWatchdogByProject[watchdogKey(target)];
          }
          // Injection + notification desktop + son (survit à la fermeture de
          // l'onglet : fonctions module-level, persistance côté Rust).
          finishRunAgentsToSuperAgent(result, projectPath, ok, missionIdentity);
          // AGENT JETABLE : la tâche est finie → la définition éphémère cesse
          // d'exister (sessions arrêtées, magasins JS et Rust purgés). Le TRAVAIL
          // reste visible : session indexée, compte rendu ci-dessus, journal
          // d'arrêts automatiques. Purge limitée aux agents DE CETTE mission :
          // les entrées du registre ne sont jamais touchées.
          disposeEphemeralAgents(agentIds, targetProject || window._pilotProjectPath || null).catch(() => {});
          // Lancer la run suivante mise en file pour CE projet, s'il y en a une.
          // Volet (c) : lancement PROTÉGÉ (voir `launchQueuedMission`).
          const queue = runAgentsQueueByProject[missionQueueKey(target)] || [];
          const next = queue.shift();
          if (next) {
            launchQueuedMission(target, next);
          } else {
            deleteProjectScoped(runAgentsQueueByProject, target);
          }
        };
        // Renvoie une promesse résolue avec le RÉSULTAT DU DÉMARRAGE
        // ({ started, error }) : `started` ne vaut true que si la run est
        // réellement marquée « running » par le bus (hook `onStart`), pas
        // seulement parce qu'on a appelé la fonction. Si le verrou est refusé ou
        // la préparation échoue, on rapporte un ÉCHEC DE LANCEMENT (défaut « faux
        // succès de lancement » : l'assistant annonçait « lancé » alors que rien
        // n'avait démarré).
        const launchRun = () => attachLaunchContext().then(() => new Promise((resolve) => {
          let startReported = false;
          const reportStart = (started, error) => {
            if (startReported) return;
            startReported = true;
            resolve({ started, error: error ? String(error) : null });
          };
          runAgentsForAssistantAsync(
            assignments,
            (result) => {
              // T7 : fin de tâche → compte-rendu + notification desktop + son +
              // consignation. Issue #87 (2ᵉ moitié) : le groupe parallèle signale
              // sa fin par « done » MÊME quand un agent a échoué (statut « error »
              // agrégé dans le texte) → l'issue réelle est relue du résultat, pour
              // ne jamais annoncer un échec comme un succès.
              const ok = !runAgentsResultFailed(result);
              appendSystemMessage(messagesEl, ok
                ? `✅ Tâche terminée par les agents sélectionnés.`
                : `❌ Tâche terminée en ÉCHEC par les agents sélectionnés.`);
              settleRun(ok, result);
              reportStart(true, null);
            },
            (err) => {
              const msg = err && err.message ? err.message : String(err);
              // T7 : fin de tâche (échec) → compte-rendu + notification + son.
              appendSystemMessage(messagesEl, `❌ Échec de la run agents : ${msg}`);
              settleRun(false, `[Échec de la run agents] ${msg}`);
              reportStart(false, msg);
            },
            { purge: true, onStart: () => reportStart(true, null) }
          ).catch((e) => {
            // Erreur de PRÉPARATION (initAgentsBus / reloadAgentsRegistry) : la
            // run n'a pas abouti. T7 : fin de tâche (échec) → notification + son.
            console.error("Erreur préparation run_agents (assistant):", e);
            appendSystemMessage(messagesEl, `❌ Échec de la préparation de la run agents : ${e}`);
            settleRun(false, `[Échec de la préparation de la run agents] ${e}`);
            reportStart(false, e && e.message ? e.message : String(e));
          });
        }));

        // MISSION 381 — AUCUNE ESTIMATION PRÉALABLE AUTOMATIQUE.
        // Le lancement démarre EXACTEMENT les agents demandés : aucun agent
        // auxiliaire (ex. planificateur) n'est démarré en amont, et le texte de
        // la mission n'est JAMAIS remis à un autre agent que ceux nommés. Le
        // fichier `.pilot/reservations.json` et sa porte pré-écriture restent en
        // place, mais plus rien ne les alimente automatiquement au lancement.
        //
        // Retest du verrou au moment du LANCEMENT : si une autre run a pris le
        // projet entre-temps, `launchRun` lèverait « Une run est déjà en cours »
        // APRÈS que l'assistant ait répondu « lancé » (faux succès, lancement
        // perdu). On met alors la demande en FILE (mécanisme existant) — elle
        // démarrera dès la fin de la run en cours — au lieu de la perdre.
        const launchOrQueue = async (launchOpts = {}) => {
          // Plancher : un verrou de run RÉCENT n'est jamais libéré ici — sinon le
          // lancement fermait la run d'un agent qui travaillait encore. On met
          // alors la demande en file.
          await releaseStuckRunLock(target, { requireIdleMs: RUN_LAUNCH_MIN_STUCK_IDLE_MS });
          // POINT D : le bus ne voit PAS une commande MANUELLE en cours (elle
          // n'inscrit aucune run). On sonde en plus l'activité réelle de l'agent
          // du projet — même sonde que la délégation (isProjectAgentBusy) — pour
          // une mission d'ÉCRITURE : on met alors en file au lieu de modifier le
          // projet pendant qu'un agent y travaille. Une LECTURE reste légitime.
          const busyManual = missionNature === "write" && await isProjectAgentBusy(target);
          // P1 — ORDRE D'ARRIVÉE : la FILE du projet est consultée AVANT de
          // décider de démarrer (D1 du rapport
          // `rapport-file-attente-pertes-doublons.md`). Une mission déjà en
          // attente ne peut plus être doublée par une demande qui arrive.
          // `runAgentsInFlightByProject` n'est pas sondé ici : ce drapeau est posé
          // par la demande ELLE-MÊME avant son propre lancement (`startRun`), le
          // lire ici la mettrait en file derrière elle-même. Ce qui manquait — la
          // run issue de la file pas encore INSCRITE au bus — est porté par la
          // réservation de `launchQueuedMission`, comptée par
          // `pendingMissionsAhead` : la fenêtre de course du rejeu est fermée.
          const admission = decideMissionAdmission(target, {
            // TERRAIN RÉSERVÉ (vérification/installation du moteur `pi`, ou mise
            // à jour de Pilot) : la demande est MISE EN FILE (aucun lancement,
            // aucune perte).
            busy: isRunInProgress(target, { nature: missionNature }) || busyManual || isTerrainReserved(),
            dequeue: !!(launchOpts && launchOpts.dequeue),
          });
          if (admission.queue) {
            // Verrou occupé par une AUTRE run : renoncer au flag in-flight de
            // CETTE demande (il repassera à true au vrai lancement depuis la
            // file) et désarmer son watchdog.
            runAgentsInFlightByProject[inFlightKey(target)] = false;
            const wd = runAgentsWatchdogByProject[watchdogKey(target)];
            if (wd) { clearTimeout(wd); delete runAgentsWatchdogByProject[watchdogKey(target)]; }
            // P1 : missions DÉJÀ en attente (nommées AVANT l'empilement).
            const aheadLabels = pendingMissionAheadLabels(target);
            // RÈGLE 4 : mise en file par le chemin de PRODUCTION UNIQUE (libellé +
            // identité de mission + refus du double empilement).
            const queued = enqueueMissionForProject(target, launchMission, task, missionIdentity);
            // RANG : la mission qui vient de SORTIR de la file (rejeu) reprend sa
            // place en TÊTE — sinon elle passait DERRIÈRE les missions arrivées
            // après elle et le créneau libéré exécutait une autre demande que la
            // sienne.
            if (launchOpts && launchOpts.dequeue) restoreQueuedMissionRank(target, queued.entry);
            // RÉSUMÉ COURT : conservé AVEC la mission en attente (facultatif).
            stampQueuedMissionResume(queued.entry, resume);
            if (queued.duplicate) {
              appendSystemMessage(messagesEl, `ℹ️ Cette demande (mission #${queued.id}) est déjà en file : aucun doublon créé.`);
            }
            // POINT G : la mise en file n'est plus confiée au seul `settleRun`. On
            // arme le déclencheur de rejeu du projet (sonde d'admission réelle),
            // sinon une mission mise en file derrière une commande MANUELLE (que le
            // bus ne voit pas) reste bloquée pour toujours.
            armQueueReplay(target);
            if (admission.reason === "queue-ahead") {
              // Décision EXPLICITE et TRACÉE : la demande ne double pas la file.
              traceMissionQueuedBehindPending(target, aheadLabels, task);
              appendSystemMessage(messagesEl, `⏳ ${admission.pending} demande(s) attendent déjà sur ce projet — votre demande est mise en file DERRIÈRE elles ; elle démarrera à son tour, dans l'ordre d'arrivée.`);
            } else if (isTerrainReserved()) {
              // TERRAIN RÉSERVÉ : motif EXACT (vérification, installation du
              // moteur ou mise à jour de Pilot) — le texte vient du gardien
              // unique, jamais d'une copie.
              appendSystemMessage(messagesEl, `${terrainReservedMessage()}\n\nVotre demande est mise en file : elle démarrera dès que le terrain sera libre (vérification ou installation du moteur, mise à jour de Pilot).`);
            } else {
              appendSystemMessage(messagesEl, "⏳ Une run d'agents est déjà en cours sur ce projet — je la mets en file d'attente ; elle démarrera automatiquement dès que le projet sera libre.");
            }
            return { queued: true, started: false, error: null }; // mise en file : PAS un lancement
          }
          const launched = await launchRun();
          // `started` provient du bus (onStart / onError) : il reflète le
          // DÉMARRAGE RÉEL, pas l'intention de lancer.
          return { queued: false, started: !!launched.started, error: launched.error || null };
        };
        // Lancement de la mission : DIRECT. Aucune étape préalable, aucun accusé
        // de lancement différé — le verdict rendu à l'assistant reflète le
        // démarrage réel (`launched`) ou la mise en file (`queued`).
        const launchMission = (missionLaunchOpts) => launchOrQueue(missionLaunchOpts);
        // Garde anti-chevauchement (P1-6 + T5) — met en file si une run
        // est déjà en cours sur CE projet, sinon lance immédiatement. La détection
        // s'appuie sur le flag local du projet `runAgentsInFlightByProject[target]`
        // ET sur l'état réel du bus via `isRunInProgress(target)` (source de vérité
        // du verrou « Une run est déjà en cours » levé par agents-bus.js). Ce flag
        // local peut être en retard (run lancée hors de la file de l'assistant,
        // watchdog ayant réinitialisé le flag alors que le bus est resté occupé) :
        // en vérifiant aussi le bus, une demande arrivant pendant une run en cours
        // sur CE projet est TOUJOURS mise en file, jamais un échec brutal.
        const startRun = async (launchOpts = {}) => {
          // Bug : verrou de run fantôme. Si le bus d'agents est resté bloqué en
          // "running" (run précédente jamais finalisée — process pi lancé mais
          // jamais d'agent_start/agent_end, ou groupe parallèle dont pending ne
          // descend jamais à 0), `isRunInProgress` renvoie true pour toujours et
          // toutes les demandes suivantes seraient mises en file sans jamais
          // démarrer (launched:true mais aucun agent ne s'active). On force
          // d'abord la libération d'un verrou bloqué MAIS INACTIF
          // (releaseStuckRunLock ne libère que si aucun agent n'est réellement
          // en activité) pour que la demande courante démarre immédiatement.
          // Plancher : jamais de libération d'un verrou RÉCENT (agent qui travaille
          // en silence) — la demande est alors mise en file.
          await releaseStuckRunLock(target, { requireIdleMs: RUN_LAUNCH_MIN_STUCK_IDLE_MS });
          // Si le flag local est resté à true alors que le bus n'a plus de run
          // en cours (run précédente jamais finalisée, verrou fantôme), le
          // réinitialiser pour ne pas mettre la demande en file derrière une
          // run morte.
          const blockedByBus = isRunInProgress(target, { nature: missionNature });
          if (runAgentsInFlightByProject[inFlightKey(target)] && !isRunInProgress(target)) {
            runAgentsInFlightByProject[inFlightKey(target)] = false;
          }
          // Nature de la mission : une LECTURE partage le créneau avec d'autres
          // lectures et n'attend qu'une MODIFICATION réellement en cours ; une
          // MODIFICATION attend toute run en cours sur le projet.
          const blockedByFlag = missionNature === "write" && runAgentsInFlightByProject[inFlightKey(target)];
          // P1 — ORDRE D'ARRIVÉE : même point de décision que `launchOrQueue`
          // (`decideMissionAdmission`) — la file est consultée AVANT de démarrer.
          const admission = decideMissionAdmission(target, {
            // TERRAIN RÉSERVÉ (vérification/installation du moteur `pi`, ou mise
            // à jour de Pilot) : la demande est MISE EN FILE (aucun lancement,
            // aucune perte).
            busy: !!(blockedByFlag || blockedByBus || isTerrainReserved()),
            dequeue: !!(launchOpts && launchOpts.dequeue),
          });
          if (admission.queue) {
            // P1 : missions DÉJÀ en attente (nommées AVANT l'empilement).
            const aheadLabels = pendingMissionAheadLabels(target);
            // RÈGLE 4 : même chemin de mise en file que `launchOrQueue` (une seule
            // mission, un seul numéro) + refus du double empilement.
            const queued = enqueueMissionForProject(target, launchMission, task, missionIdentity);
            // RANG : même garantie que dans `launchOrQueue` — une mission
            // rejouée qui trouve le projet encore occupé reprend la TÊTE de file.
            if (launchOpts && launchOpts.dequeue) restoreQueuedMissionRank(target, queued.entry);
            // RÉSUMÉ COURT : conservé AVEC la mission en attente (facultatif).
            stampQueuedMissionResume(queued.entry, resume);
            if (queued.duplicate) {
              appendSystemMessage(messagesEl, `ℹ️ Cette demande (mission #${queued.id}) est déjà en file : aucun doublon créé.`);
            }
            // POINT G : même garantie que dans `launchOrQueue` — déclencheur de
            // rejeu armé sur le projet (voir `armQueueReplay`).
            armQueueReplay(target);
            if (admission.reason === "queue-ahead") {
              // Décision EXPLICITE et TRACÉE : la demande ne double pas la file.
              traceMissionQueuedBehindPending(target, aheadLabels, task);
              appendSystemMessage(messagesEl, `⏳ ${admission.pending} demande(s) attendent déjà sur ce projet — votre demande est mise en file DERRIÈRE elles ; elle démarrera à son tour, dans l'ordre d'arrivée.`);
            } else if (isTerrainReserved()) {
              // TERRAIN RÉSERVÉ : motif EXACT, fourni par le gardien unique.
              appendSystemMessage(messagesEl, `${terrainReservedMessage()}\n\nVotre demande est mise en file : elle démarrera dès que le terrain sera libre (vérification ou installation du moteur, mise à jour de Pilot).`);
            } else {
              appendSystemMessage(messagesEl, "⏳ Une run d'agents est déjà en cours sur ce projet — je la mets en file d'attente ; elle démarrera automatiquement dès que le projet sera libre.");
            }
            // Issue #87 : accusé de lancement structuré (même contrat que les
            // autres branches de lancement). Renvoyer `true` produisait
            // un accusé mensonger `{ok:true, launched:false, queued:false,
            // preparing:false, error:null}` : la demande ÉTAIT mise en file mais
            // l'accusé prétendait qu'il ne s'était rien passé.
            return { queued: true, started: false, preparing: false, error: null };
          }
          runAgentsInFlightByProject[inFlightKey(target)] = true;
          // Filet de sécurité CONSCIENT DE L'ACTIVITÉ : si la run ne se termine
          // pas sous RUN_AGENTS_WATCHDOG_MS, on ne réinitialise PAS aveuglément.
          // On vérifie d'abord si la run est encore réellement active (bus en
          // cours, agent vivant). Une tâche légitime longue qui progresse encore
          // est laissée se poursuivre : on repousse simplement l'échéance. On ne
          // réinitialise le flag et ne vide la file QUE si la run est réellement
          // morte/inactive (blocage du lancement, verrou graphe, agent éteint).
          const runAgentsWatchdogHandler = async () => {
            // Si la run s'est terminée pendant la sonde (settleRun appelé), ne
            // rien faire : le désarmement normal a déjà eu lieu.
            if (runSettled) return;
            // Bug : verrou de run fantôme. Si le bus est resté bloqué en
            // "running" (run jamais finalisée), `isRunStillActive` ci-dessous
            // renvoie true pour toujours (isRunInProgress) et le watchdog
            // repousserait indéfiniment l'échéance sans jamais vider la file.
            // On force d'abord la libération d'un verrou bloqué MAIS INACTIF.
            await releaseStuckRunLock(target);
            // La run a pu se terminer pendant la sonde : ne rien faire non plus.
            if (runSettled) return;
            const stillActive = await isRunStillActive(target);
            // La run a pu se terminer pendant la sonde : ne rien faire non plus.
            if (runSettled) return;
            if (stillActive) {
              // La run progresse encore : repousser l'échéance, continuer
              // d'attendre. Jamais de coupe artificielle d'une tâche saine.
              runAgentsWatchdogByProject[watchdogKey(target)] = setTimeout(runAgentsWatchdogHandler, RUN_AGENTS_WATCHDOG_MS);
              return;
            }
            // La run est réellement morte/inactive : comportement actuel.
            console.warn("[super-agent] watchdog : run d'agents bloquée, réinitialisation du flag et abandon TRACÉ de la file.");
            runAgentsInFlightByProject[inFlightKey(target)] = false;
            delete runAgentsWatchdogByProject[watchdogKey(target)];
            // RÈGLE 4 : la file n'est JAMAIS vidée en silence. Chaque demande
            // abandonnée est NOMMÉE, le motif est écrit au journal des arrêts
            // automatiques du projet et l'abandon est notifié.
            const abandoned = await abandonQueuedRunAgentsMissions(target);
            appendSystemMessage(
              messagesEl,
              `⚠️ La run d'agents n'a pas abouti sous ${Math.round(RUN_AGENTS_WATCHDOG_MS / 60000)} min — le flag de run a été réinitialisé.` +
                (abandoned.count > 0
                  ? ` ${abandoned.count} demande(s) en file abandonnée(s) et consignée(s) : ${abandoned.labels.join(" · ")}.`
                  : "")
            );
          };
          runAgentsWatchdogByProject[watchdogKey(target)] = setTimeout(runAgentsWatchdogHandler, RUN_AGENTS_WATCHDOG_MS);
          return await launchMission(); // { queued, started, error } : verdict du lancement réel
        };
        // Réponse à l'outil : verdict de lancement RÉEL (agent démarré ou
        // mission mise en file). Aucun accusé « en préparation » : il n'existe
        // plus d'étape préalable qui pourrait différer le démarrage (mission 381).
        const launchResult = await startRun();
        await respondSuperAgent(id, JSON.stringify(computeRunLaunchVerdict(launchResult)), false);
      } catch (e) {
        console.error("Erreur run_agents (assistant):", e);
        appendSystemMessage(messagesEl, `❌ Échec de la run agents : ${e}`);
        await respondSuperAgent(id, JSON.stringify({ error: String(e) }), false);
      }
      return;
    }
    if (title.startsWith(RUN_ASSISTANT_AGENTS_SENTINEL)) {
      // Outil run_assistant_agents (tâche #140) : l'assistant délègue une tâche
      // à des agents d'assistant SANS rattachement à un projet. Les agents
      // tournent dans l'espace réservé `~/.pilot/assistant/` (projet réservé
      // ASSISTANT_SPACE, distinct de ""), sans contexte de projet injecté.
      // Lancement en ARRIÈRE-PLAN (non bloquant), résultat agrégé injecté à la
      // fin — comme run_agents mais sans projet cible, sans réservations et
      // sans file par projet (clé de run distincte "__assistant__").
      let info;
      try {
        info = JSON.parse(title.slice(RUN_ASSISTANT_AGENTS_SENTINEL.length));
      } catch (_) {
        await respondSuperAgent(id, JSON.stringify({ error: "Payload run_assistant_agents invalide." }), false);
        return;
      }
      const agentIds = Array.isArray(info.agent_ids) ? info.agent_ids.map(String) : [];
      const task = String(info.task || "").trim();
      const workspace = (info.workspace && String(info.workspace).trim()) || null;
      // RÉSUMÉ COURT fourni avec la demande (facultatif) — MÊME contrat que
      // `run_agents` : conservé avec la mission (en cours ET en attente),
      // affiché en premier dans le panneau. Absent → repli sur l'extraction.
      const resume = normalizeMissionResume(info.resume);
      // MCP piloté (brique B) : serveur MCP cible (id) pour les agents d'assistant.
      const mcpServer = (info.mcp_server && String(info.mcp_server).trim()) || null;
      if (agentIds.length === 0 || !task) {
        await respondSuperAgent(id, JSON.stringify({ error: "run_assistant_agents : au moins un agent et une tâche requis." }), false);
        return;
      }
      try {
        const registry = await loadAgentRegistry();
        const known = new Set((registry.agents || []).map((a) => a && a.id));
        const missing = agentIds.filter((aid) => !known.has(aid));
        if (missing.length > 0) {
          await respondSuperAgent(id, JSON.stringify({ error: unknownAgentsError(missing, registry) }), false);
          return;
        }
        // GARDE-FOU LIVRABLE (1/2) — REFUS AU LANCEMENT, mêmes règles que
        // `run_agents` (les agents d'assistant sont soumis aux mêmes garanties) :
        // une demande d'ÉCRITURE explicite visant uniquement des agents en
        // lecture seule ne démarre rien et le dit, avec la sortie à suivre.
        const expectedFiles = normalizeExpectedFiles(info.expected_files);
        const requestedAgents = agentIds.map((aid) => {
          const ag = (registry.agents || []).find((a) => a && a.id === aid);
          return ag ? { id: ag.id, name: ag.name || ag.id, readonly: ag.readonly === true } : { id: aid, name: aid, readonly: false };
        });
        const readOnlyRefusal = readOnlyWriteRefusalMessage({
          tool: "run_assistant_agents",
          agents: requestedAgents,
          task,
          expectedFiles,
        });
        if (readOnlyRefusal) {
          appendSystemMessage(messagesEl, `⛔ ${readOnlyRefusal}`);
          await respondSuperAgent(id, JSON.stringify({ error: readOnlyRefusal, launched: false }), false);
          return;
        }
        // GARDE-FOU LIVRABLE (2/2) : dossier de référence des livrables déclarés
        // = espace fourni, sinon l'espace réservé des agents d'assistant.
        let expectedFilesBase = workspace;
        if (expectedFiles.length > 0 && !expectedFilesBase) {
          try {
            expectedFilesBase = await invoke("get_assistant_workspace");
          } catch (_) {
            expectedFilesBase = null; // vérification annoncée comme impossible, jamais un faux échec
          }
        }
        appendSystemMessage(messagesEl, `🤖 Je lance la tâche d'assistant sur les agents : ${agentIds.join(", ")}…`);
        // Enveloppe de brief STRUCTURÉ (même mécanisme que run_agents) pour que
        // l'agent d'assistant réussisse du premier coup. Aucun projet cible ici
        // (agent hors projet) : seul le suivi de session de l'assistant est
        // joint, AU LANCEMENT (voir `attachLaunchContext`), et rien du tout s'il
        // ne sait rien.
        const baseBrief = applyAssistantBriefEnvelope(task, {
          forceStructured: configCache.super_agent_force_structured_brief !== false,
          qualityGate: configCache.super_agent_quality_gate !== false,
        });
        // Projet réservé : l'agent d'assistant n'est lié à aucun projet.
        const target = ASSISTANT_SPACE;
        const assignments = agentIds.map((aid) => ({
          agentId: aid,
          brief: baseBrief,
          project: target,
          mcp_server: mcpServer,
          resume,
          // GARDE-FOU LIVRABLE : mêmes règles que `run_agents` (fichiers
          // déclarés vérifiés en fin de mission, échec explicite si absent).
          expectedFiles,
          expectedFilesBase: expectedFilesBase || null,
        }));
        // CONTEXTE DE SUIVI relu AU LANCEMENT (bug « une tâche mise en file
        // exécute la tâche précédente », même correctif que `run_agents`).
        let launchContextAnnounced = false;
        const attachLaunchContext = async () => {
          const brief = await refreshAssignmentsBrief(assignments, baseBrief, null, task);
          if (brief !== baseBrief && !launchContextAnnounced) {
            launchContextAnnounced = true;
            appendSystemMessage(messagesEl, "🧠 Contexte de suivi joint à la demande de l'agent.");
          }
          return brief;
        };
        const projectPath = window._pilotProjectPath || null;
        let runSettled = false;
        // RÈGLE 4 : identité de la mission d'assistant (même mécanisme que
        // `run_agents`) — posée sur l'entrée de file et portée au compte rendu.
        // Allocation par le point unique de production.
        const missionIdentity = allocateMissionIdentity(agentIds);
        const settleRun = (ok, result) => {
          if (runSettled) return;
          runSettled = true;
          runAgentsInFlightByProject[inFlightKey(target)] = false;
          const wd = runAgentsWatchdogByProject[watchdogKey(target)];
          if (wd) {
            clearTimeout(wd);
            delete runAgentsWatchdogByProject[watchdogKey(target)];
          }
          finishRunAgentsToSuperAgent(result, projectPath, ok, missionIdentity);
          // POINT E : rejouer la mission suivante RÉELLEMENT mise en file (même
          // file que `run_agents`). Sans ce vidage, un accusé « queued » restait
          // sans effet et la mission était perdue en silence.
          // Volet (c) : lancement PROTÉGÉ (voir `launchQueuedMission`).
          const queue = runAgentsQueueByProject[missionQueueKey(target)] || [];
          const next = queue.shift();
          if (next) {
            launchQueuedMission(target, next);
          } else {
            deleteProjectScoped(runAgentsQueueByProject, target);
          }
        };
        const startRun = async (launchOpts = {}) => {
          // Bug : verrou de run fantôme (même correctif que run_agents) —
          // libérer un verrou de bus bloqué MAIS INACTIF avant la garde pour
          // que la demande d'assistant démarre immédiatement au lieu de rester
          // en file derrière une run morte. Plancher : un verrou RÉCENT (agent qui
          // travaille) n'est pas libéré — mise en file au lieu d'un kill.
          await releaseStuckRunLock(target, { requireIdleMs: RUN_LAUNCH_MIN_STUCK_IDLE_MS });
          if (runAgentsInFlightByProject[inFlightKey(target)] && !isRunInProgress(target)) {
            runAgentsInFlightByProject[inFlightKey(target)] = false;
          }
          // P1 — ORDRE D'ARRIVÉE : la file est consultée AVANT de démarrer (même
          // point de décision que `run_agents`).
          const admission = decideMissionAdmission(target, {
            busy: runAgentsInFlightByProject[inFlightKey(target)] || isRunInProgress(target),
            dequeue: !!(launchOpts && launchOpts.dequeue),
          });
          if (admission.queue) {
            // P1 : missions DÉJÀ en attente (nommées AVANT l'empilement).
            const aheadLabels = pendingMissionAheadLabels(target);
            // POINT E : mise en file RÉELLE (même file que `run_agents`, rejouée
            // par `settleRun`). Auparavant ce chemin répondait « queued » sans
            // jamais pousser dans une file → mission perdue en silence.
            // Volet (c) : la promesse de `startRun` est RETOURNÉE (et non avalée),
            // sinon un échec du lancement devenait un rejet non géré et laissait
            // le projet marqué « run en vol » — voir `launchQueuedMission`.
            // RÈGLE 4 : identité de la mission d'assistant en file (le numéro
            // survit à la fermeture du chat : il est porté par la file, indexée
            // par projet/espace) — même chemin de production unique.
            const queued = enqueueMissionForProject(target, (missionLaunchOpts) => startRun(missionLaunchOpts), task, missionIdentity);
            // RANG : une mission rejouée qui trouve le projet encore occupé
            // reprend la TÊTE de file (même garantie que les deux autres chemins).
            if (launchOpts && launchOpts.dequeue) restoreQueuedMissionRank(target, queued.entry);
            // RÉSUMÉ COURT : conservé AVEC la mission en attente (facultatif).
            stampQueuedMissionResume(
              (runAgentsQueueByProject[missionQueueKey(target)] || []).at(-1),
              resume
            );
            // POINT G : la file d'assistant est couverte par le MÊME déclencheur de
            // rejeu (aucune run d'assistant ne pose de watchdog : sans cela une
            // demande pouvait rester en vol sans suite).
            armQueueReplay(target);
            if (admission.reason === "queue-ahead") {
              // Décision EXPLICITE et TRACÉE : la demande ne double pas la file.
              traceMissionQueuedBehindPending(target, aheadLabels, task);
              appendSystemMessage(messagesEl, `⏳ ${admission.pending} demande(s) attendent déjà sur ce projet — votre demande est mise en file DERRIÈRE elles ; elle démarrera à son tour, dans l'ordre d'arrivée.`);
            } else {
              appendSystemMessage(messagesEl, "⏳ Une run d'assistant est déjà en cours — la demande est mise en file ; elle démarrera automatiquement dès que le projet sera libre.");
            }
            return false; // PAS lancée maintenant : RÉELLEMENT mise en file
          }
          runAgentsInFlightByProject[inFlightKey(target)] = true;
          // Le contexte de suivi est relu ICI, au moment réel du démarrage (donc
          // aussi au rejeu depuis la file), jamais celui figé à l'arrivée.
          await attachLaunchContext();
          runAgentsForAssistantAsync(
            assignments,
            (result) => {
              // Issue #87 (2ᵉ moitié) : même relecture de l'issue réelle que pour
              // `run_agents` (un agent d'assistant en échec remonte par « done »
              // avec un statut « error » agrégé).
              const ok = !runAgentsResultFailed(result);
              appendSystemMessage(messagesEl, ok
                ? `✅ Tâche d'assistant terminée par les agents sélectionnés.`
                : `❌ Tâche d'assistant terminée en ÉCHEC par les agents sélectionnés.`);
              settleRun(ok, result);
            },
            (err) => {
              const msg = err && err.message ? err.message : String(err);
              appendSystemMessage(messagesEl, `❌ Échec de la run d'assistant : ${msg}`);
              settleRun(false, `[Échec de la run d'assistant] ${msg}`);
            },
            { purge: true }
          ).catch((e) => {
            console.error("Erreur préparation run_assistant_agents (assistant):", e);
            appendSystemMessage(messagesEl, `❌ Échec de la préparation de la run d'assistant : ${e}`);
            settleRun(false, `[Échec de la préparation de la run d'assistant] ${e}`);
          });
          return true; // réellement lancée maintenant
        };
        const launchedNow = await startRun();
        await respondSuperAgent(id, JSON.stringify({ ok: true, launched: launchedNow, queued: !launchedNow }), false);
      } catch (e) {
        console.error("Erreur run_assistant_agents (assistant):", e);
        appendSystemMessage(messagesEl, `❌ Échec de la run d'assistant : ${e}`);
        await respondSuperAgent(id, JSON.stringify({ error: String(e) }), false);
      }
      return;
    }
    if (title.startsWith(SESSIONS_SENTINEL)) {
      // Outil list_agent_sessions (P2) : l'assistant demande la vue d'ensemble
      // des sessions d'agents. On interroge la commande Rust et on renvoie le
      // résultat (JSON) comme `value` de la réponse.
      try {
        const result = await invoke("list_agent_sessions");
        await respondSuperAgent(id, JSON.stringify(result), false);
      } catch (e) {
        await respondSuperAgent(id, JSON.stringify({ error: String(e) }), false);
      }
      return;
    }
    if (title.startsWith(MCP_STATE_SENTINEL)) {
      // Outil mcp_state (brique C) : l'assistant interroge l'état MCP
      // { enabled, confirm, servers } pour savoir s'il doit demander une
      // confirmation avant qu'un agent utilise un serveur MCP, et pour choisir
      // un serveur cible (mcp_server) à passer à run_agents.
      try {
        const result = await invoke("mcp_get_state");
        await respondSuperAgent(id, JSON.stringify(result), false);
      } catch (e) {
        await respondSuperAgent(id, JSON.stringify({ error: String(e) }), false);
      }
      return;
    }
    if (title.startsWith(DELEGATION_SENTINEL)) {
      // Outil get_delegation_result (P5) : l'assistant récupère le résultat
      // d'une délégation. Le titre contient un JSON {project, session_id?,
      // agent_id?} — Résolution côté Rust : fichier de session exact (session_id)
      // → session vivante (get_messages) → jsonl le plus récent de l'agent
      // (agents d'orchestration sans session persistée).
      try {
        const info = JSON.parse(title.slice(DELEGATION_SENTINEL.length));
        const result = await invoke("get_delegation_result", {
          project: String(info.project || ""),
          sessionId: info.session_id ? String(info.session_id) : null,
          agentId: info.agent_id ? String(info.agent_id) : null,
        });
        await respondSuperAgent(id, JSON.stringify(result), false);
      } catch (e) {
        await respondSuperAgent(id, JSON.stringify({ error: String(e) }), false);
      }
      return;
    }
    if (title.startsWith(PROJECT_SNAPSHOT_SENTINEL)) {
      // Outil project_snapshot (A1) : l'assistant demande un état structuré d'un
      // projet (fichiers, langages, Git, métriques). Le titre contient un JSON
      // {project}. On exécute la commande Rust (lecture seule) et on renvoie le
      // résultat (JSON) comme `value` de la réponse.
      try {
        const info = JSON.parse(title.slice(PROJECT_SNAPSHOT_SENTINEL.length));
        const result = await invoke("project_snapshot", {
          project: String(info.project || ""),
        });
        await respondSuperAgent(id, JSON.stringify(result), false);
      } catch (e) {
        await respondSuperAgent(id, JSON.stringify({ error: String(e) }), false);
      }
      return;
    }
    if (title.startsWith(GIT_STATUS_SENTINEL)) {
      // Outil git_status (A2) : l'assistant demande l'état Git d'un projet
      // (branche, fichiers modifiés/ajoutés/supprimés, en attente). Le titre
      // contient un JSON {project}. On exécute la commande Rust (lecture seule)
      // et on renvoie le résultat (JSON) comme `value` de la réponse.
      try {
        const info = JSON.parse(title.slice(GIT_STATUS_SENTINEL.length));
        const result = await invoke("git_status_project", {
          project: String(info.project || ""),
        });
        await respondSuperAgent(id, JSON.stringify(result), false);
      } catch (e) {
        await respondSuperAgent(id, JSON.stringify({ error: String(e) }), false);
      }
      return;
    }
    if (title.startsWith(GIT_LOG_SENTINEL)) {
      // Outil git_log (A2) : l'assistant demande l'historique des commits d'un
      // projet (20 derniers, message, auteur, date). Le titre contient un JSON
      // {project}. On exécute la commande Rust (lecture seule) et on renvoie le
      // résultat (JSON) comme `value` de la réponse.
      try {
        const info = JSON.parse(title.slice(GIT_LOG_SENTINEL.length));
        const result = await invoke("git_log_project", {
          project: String(info.project || ""),
        });
        await respondSuperAgent(id, JSON.stringify(result), false);
      } catch (e) {
        await respondSuperAgent(id, JSON.stringify({ error: String(e) }), false);
      }
      return;
    }
    if (title.startsWith(TELEGRAM_NOTIFY_SENTINEL)) {
      // Outil UNIQUE « me prévenir sur Telegram » : LECTURE et CHANGEMENT.
      // Sans valeur (`enabled` absent) on renvoie l'état en clair ; avec une
      // valeur on l'applique (champ `AppConfig.telegram_notify_enabled`, seule
      // source de vérité, persistée par `save_config`) et on renvoie le nouvel
      // état. Une seule porte : rien n'est injecté dans le prompt.
      let req = {};
      try {
        req = JSON.parse(title.slice(TELEGRAM_NOTIFY_SENTINEL.length)) || {};
      } catch (_) {
        req = {};
      }
      const wanted = typeof req.enabled === "boolean" ? req.enabled : null;
      if (wanted === null) {
        const read = await readTelegramNotifyEnabled();
        await respondSuperAgent(
          id,
          read.ok
            ? telegramNotifyStateAnswer(read.enabled)
            : `Réglage « me prévenir sur Telegram » : impossible de le lire (${read.error || "configuration indisponible"}). L'état n'a pas été modifié.`,
          false,
        );
        return;
      }
      const res = await setTelegramNotifyEnabled(wanted);
      if (res.ok) {
        appendSystemMessage(messagesEl, `📨 ${telegramNotifyConfirmation(res.enabled)}`);
        await respondSuperAgent(id, telegramNotifyStateAnswer(res.enabled), false);
      } else {
        appendSystemMessage(
          messagesEl,
          "⚠️ Impossible d'enregistrer le réglage « me prévenir sur Telegram » : il reste inchangé.",
        );
        await respondSuperAgent(
          id,
          `Échec : le réglage « me prévenir sur Telegram » est inchangé (${res.error || "écriture impossible"}).`,
          false,
        );
      }
      return;
    }
    if (title.startsWith(SCHEDULE_SENTINEL)) {
      // Outil schedule (chantier #13) : l'assistant programme des relances
      // différées/périodiques. Le titre contient un JSON {op, name, prompt,
      // everySeconds, id}. On exécute la commande Rust et on renvoie le
      // résultat (JSON) comme `value` de la réponse.
      let req;
      try {
        req = JSON.parse(title.slice(SCHEDULE_SENTINEL.length));
      } catch (_) {
        await respondSuperAgent(id, JSON.stringify({ error: "Payload schedule invalide." }), false);
        return;
      }
      try {
        let result;
        if (req.op === "create") {
          // Lot A idée 6 : `every` est optionnel. Si l'assistant ne précise AUCUNE
          // fréquence (champ absent, 0 ou invalide), on envoie `null` : Rust
          // applique alors le réglage « Fréquence des rappels de surveillance »
          // (1 heure par défaut). Une fréquence explicite est transmise telle
          // quelle (le garde-fou >= 60 s reste côté Rust).
          const everySeconds = Number(req.everySeconds);
          result = await invoke("super_agent_schedule_create", {
            name: String(req.name || ""),
            prompt: String(req.prompt || ""),
            every: Number.isFinite(everySeconds) && everySeconds > 0 ? everySeconds : null,
            // Relance UNIQUE (`once: true`) : consommée à la première livraison,
            // puis supprimée par la règle de ménage n° 2 une fois périmée.
            once: req.once === true,
          });
        } else if (req.op === "list") {
          result = await invoke("super_agent_schedule_list");
        } else if (req.op === "delete") {
          result = await invoke("super_agent_schedule_delete", { id: Number(req.id) });
        } else if (req.op === "set_enabled") {
          result = await invoke("super_agent_schedule_set_enabled", {
            id: Number(req.id),
            enabled: Boolean(req.enabled),
          });
        } else {
          result = { error: `Opération schedule inconnue : ${req.op}` };
        }
        await respondSuperAgent(id, JSON.stringify(result), false);
      } catch (e) {
        await respondSuperAgent(id, JSON.stringify({ error: String(e) }), false);
      }
      return;
    }
    if (title.startsWith(TOOLS_SENTINEL)) {
      // Outils de suivi multi-projets de l'assistant (pilot-assistant-tools, Phase 2).
      // Le titre est préfixé par le sentinel commun + le nom d'outil + le payload
      // JSON : PILOT_ASSISTANT_TOOLS::<toolName>::<JSON>. On exécute la commande
      // Rust correspondante et on renvoie le résultat (JSON) comme `value` de la
      // réponse, au lieu d'afficher un champ de saisie.
      const rest = title.slice(TOOLS_SENTINEL.length);
      const sep = rest.indexOf("::");
      if (sep < 0) {
        await respondSuperAgent(id, JSON.stringify({ error: "Payload tools invalide." }), false);
        return;
      }
      const toolName = rest.slice(0, sep);
      let params;
      try {
        params = JSON.parse(rest.slice(sep + 2));
      } catch (_) {
        await respondSuperAgent(id, JSON.stringify({ error: "Payload tools invalide." }), false);
        return;
      }
      try {
        let result;
        switch (toolName) {
          case "create_task":
            result = await invoke("super_agent_create_task", {
              projectPath: String(params.projectPath || ""),
              title: String(params.title || ""),
              description: params.description != null ? String(params.description) : null,
              deadline: params.deadline != null ? String(params.deadline) : null,
              dependsOnTaskId:
                params.dependsOnTaskId != null ? Number(params.dependsOnTaskId) : null,
            });
            break;
          case "set_task_dependency":
            result = await invoke("super_agent_set_task_dependency", {
              taskId: Number(params.taskId),
              dependsOnTaskId:
                params.dependsOnTaskId != null ? Number(params.dependsOnTaskId) : null,
            });
            break;
          case "update_task_status":
            result = await invoke("super_agent_update_task_status", {
              taskId: Number(params.taskId),
              status: String(params.status || ""),
            });
            break;
          case "add_decision":
            result = await invoke("super_agent_add_decision", {
              projectPath: String(params.projectPath || ""),
              summary: String(params.summary || ""),
              taskId: params.taskId != null ? Number(params.taskId) : null,
            });
            break;
          case "add_milestone":
            result = await invoke("super_agent_add_milestone", {
              projectPath: String(params.projectPath || ""),
              title: String(params.title || ""),
              dueDate: params.dueDate != null ? String(params.dueDate) : null,
            });
            break;
          case "set_deadline":
            result = await invoke("super_agent_set_deadline", {
              taskId: Number(params.taskId),
              deadline: params.deadline != null ? String(params.deadline) : null,
            });
            break;
          case "flag_blocker":
            result = await invoke("super_agent_flag_blocker", {
              taskId: Number(params.taskId),
              reason: String(params.reason || ""),
            });
            break;
          case "get_project_timeline":
            result = await invoke("super_agent_get_project_timeline", {
              projectPath: String(params.projectPath || ""),
            });
            break;
          case "handoff_to_project":
            result = await invoke("super_agent_handoff_to_project", {
              sourcePath: String(params.sourcePath || ""),
              targetPath: String(params.targetPath || ""),
              taskId: Number(params.taskId),
            });
            break;
          case "read_project_file":
            result = await invoke("super_agent_read_project_file", {
              projectPath: String(params.projectPath || ""),
              relPath: String(params.relPath || ""),
            });
            break;
          case "search_project":
            result = await invoke("super_agent_search_project", {
              projectPath: String(params.projectPath || ""),
              query: String(params.query || ""),
              useRegex: Boolean(params.useRegex),
              extensions: params.extensions != null ? String(params.extensions) : "",
              maxResults: params.maxResults != null ? Number(params.maxResults) : null,
            });
            break;
          case "project_overview":
            result = await invoke("super_agent_project_overview");
            break;
          case "check_project_health":
            result = await invoke("super_agent_check_project_health", {
              projectPath: String(params.projectPath || ""),
            });
            break;
          case "search_sessions":
            result = await invoke("super_agent_search_sessions", {
              projectPath: String(params.projectPath || ""),
              params: params.params || {},
            });
            break;
          default:
            result = { error: `Outil assistant inconnu : ${toolName}` };
        }
        await respondSuperAgent(id, JSON.stringify(result), false);
      } catch (e) {
        await respondSuperAgent(id, JSON.stringify({ error: String(e) }), false);
      }
      return;
    }
    // Son « attention » : l'assistant pose une question (si le son est activé).
    playAssistantSound("attention").catch(() => {});
    renderSuperAgentInput(messagesEl, state, id, title, payload.placeholder || "");
  }
}

/**
 * Exécute une action assistant (TÂCHE 2) : ouverture d'un projet ou délégation
 * d'une demande de code à l'agent standard du projet. Répond au processus pi du
 * super-agent avec `confirmed: true/false` (l'extension lit ce champ au niveau
 * racine de la réponse, comme la porte pré-écriture pilot-edit-gate).
 */
async function handleSuperAgentAction(id, jsonStr, messagesEl) {
  let info;
  try {
    info = JSON.parse(jsonStr);
  } catch (_) {
    await respondSuperAgentAction(id, false);
    return;
  }
  const action = info.action;
  try {
    if (action === "open_project") {
      const path = info.path;
      if (!path) {
        await respondSuperAgentAction(id, false);
        return;
      }
      appendSystemMessage(messagesEl, `📂 J'ouvre le projet « ${path} »…`);
      const sidebar = window._pilotGetSidebar?.();
      if (!sidebar) {
        appendSystemMessage(messagesEl, "❌ Impossible d'ouvrir le projet (barre latérale indisponible).");
        await respondSuperAgentAction(id, false);
        return;
      }
      await sidebar.openProjectByPath(path);
      // Badges par bulle : pas de re-étiquetage de la bulle courante — elle
      // garde les badges figés de sa demande. Les bulles suivantes prendront
      // leur PROPRE snapshot à leur envoi.
      // Mémoriser le projet sur lequel l'assistant travaille (distinct du projet
      // actif) : si l'utilisateur change ensuite de projet, l'assistant saura
      // qu'il travaillait sur celui-ci et pourra continuer la discussion dessus.
      invoke("set_super_agent_working_project", { path }).catch(() => {});
      // REGLE 2 (nommage des bulles) : le projet que l'assistant ouvre est un
      // projet REELLEMENT concerne par ce tour — les bulles suivantes le portent.
      noteConcernedProject(path);
      appendSystemMessage(messagesEl, `✅ Projet « ${path} » ouvert et rendu actif.`);
      await respondSuperAgentAction(id, true);
    } else if (action === "delegate_to_coder") {
      if (!info.request) {
        await respondSuperAgentAction(id, false);
        return;
      }
      // A13 (assistant headless multi-projets) : un `project` explicite permet
      // de déléguer à un projet NON actif. Son agent est démarré en arrière-plan
      // (invisible) sans ouvrir le projet ni l'onglet. Sinon, on retombe sur le
      // projet actif (comportement historique).
      const projectPath = info.project || window._pilotProjectPath || null;
      // REGLE 2 (nommage des bulles) : le projet A QUI la demande est transmise
      // est le projet reellement concerne — jamais le projet ouvert s'il differe.
      noteConcernedProject(projectPath);
      // TÂCHE T1 : l'enveloppe de brief structuré (contexte/objectif/consignes/
      // ce qu'il ne faut PAS faire) est appliquée mécaniquement à la demande
      // déléguée, en plus de la consigne quality-gate (config). Ne duplique pas
      // les sections que l'assistant aurait déjà rédigées. Le CONTEXTE DE SUIVI
      // de l'assistant est joint au préalable (mêmes données que `run_agents`).
      const baseRequest = applyAssistantBriefEnvelope(info.request, {
        forceStructured: configCache.super_agent_force_structured_brief !== false,
        qualityGate: configCache.super_agent_quality_gate !== false,
      });
      // Demande réellement transmise maintenant (= brief de base + contexte de
      // suivi lu à l'instant). Si la demande est MISE EN FILE, c'est ce même
      // brief de base qui part avec l'entrée et le contexte sera RELU à la
      // transmission (voir `flushDelegationQueue`) : une demande en file ne doit
      // jamais décrire la tâche précédente (bug « une tâche mise en file exécute
      // la tâche précédente »).
      const delegationTask = String(info.request || "");
      const request = await attachDelegationContext(messagesEl, baseRequest, projectPath, delegationTask);
      appendSystemMessage(messagesEl, `🤖 Je lance l'agent du projet et lui transmets la demande…`);
      const tabs = window._pilotTabs;
      if (!tabs) {
        appendSystemMessage(messagesEl, "❌ Impossible d'ouvrir l'agent du projet (gestionnaire d'onglets indisponible).");
        await respondSuperAgentAction(id, false);
        return;
      }
      // 4.1 (R3) + tâche 209 : résoudre l'agent cible de la délégation depuis
      // l'objet persisté (get_agent) — jamais le littéral "default". L'agent
      // est OBLIGATOIREMENT désigné (`agent_id` de l'outil) : sans désignation,
      // la délégation est REFUSÉE avec un message explicite (plus aucun repli
      // silencieux sur le codeur ou l'agent par défaut). Toute la délégation
      // (start invisible, canal d'événements, envoi, arrêt) cible cet id
      // résolu, aligné sur la vue affichée (règle de cohérence ecrans.md).
      const target = await resolveDelegationTarget(projectPath, info.agentId || null);
      const agentId = target.id;
      if (!target.ok || !agentId) {
        // Cause C2 : un agent EXPLICITEMENT demandé mais introuvable ne doit
        // JAMAIS être rabattu en silence sur un autre agent — la demande
        // partirait au mauvais agent sans que personne ne le sache. Erreur
        // explicite (id demandé) et AUCUN lancement.
        const detail = target.error || "agent cible introuvable";
        appendSystemMessage(messagesEl, `❌ Délégation annulée : ${detail}. Aucun agent n'a été lancé.`);
        await respondSuperAgentAction(id, false);
        return;
      }
      // GARDE-FOU LIVRABLE (1/2) — MÊME refus au lancement que `run_agents` : une
      // demande qui demande EXPLICITEMENT d'écrire un fichier ne part pas vers un
      // agent en LECTURE SEULE (elle serait « terminée » sans aucun fichier).
      // L'agent cible est déjà résolu : le refus le NOMME et ne lance rien.
      const delegationRefusal = readOnlyWriteRefusalMessage({
        tool: "delegate_to_coder",
        agents: [{ id: target.id, name: target.name, readonly: target.readonly === true }],
        task: String(info.request || ""),
      });
      if (delegationRefusal) {
        appendSystemMessage(messagesEl, `⛔ ${delegationRefusal}`);
        await respondSuperAgentAction(id, false);
        return;
      }
      // Afficher l'agent retenu (celui explicitement désigné) — le retour est
      // explicite, pas de détournement silencieux vers un autre agent.
      appendSystemMessage(messagesEl, `🤖 Agent retenu pour la délégation : « ${target.name} » (${target.id}).`);
      // Évolution 64 : « agent invisible ». Si l'option est activée (défaut),
      // on démarre la session agent en arrière-plan SANS créer d'onglet agent
      // (startAgentInvisible) et on met en place le suivi (bouton Arrêter,
      // détection de boucle, notification de fin). Sinon, comportement actuel :
      // on ouvre l'onglet agent en arrière-plan (openFile sans bascule) pour
      // accéder à sa discussion.
      // P6 : le paramètre `background` de l'outil delegate_to_coder (si fourni)
      // force le mode invisible, sinon on retombe sur la config utilisateur.
      // A13 : pour un projet NON actif, on force le mode invisible (headless) —
      // on ne peut pas ouvrir l'onglet d'un projet non affiché.
      const invisible = (typeof info.background === "boolean")
        ? info.background
        : (configCache.super_agent_invisible_agent !== false);
      const forceInvisible = !!info.project && !sameProject(projectPath, window._pilotProjectPath || null);
      // #11 : si l'onglet agent du projet cible n'est PAS ouvert, on délègue en
      // arrière-plan (startAgentInvisible) même si background=false — on ne peut
      // pas ouvrir l'onglet d'un agent fermé. Si l'onglet est déjà ouvert, on
      // garde le comportement actuel (openFile). Le paramètre `background`
      // existant reste inchangé (il force toujours l'invisible).
      const agentTabOpen = !!(tabs.tabs && tabs.tabs.find((t) => t.mode === "agent" && t.agentId === agentId));

      // Issue #66 : si l'agent travaille déjà (sur une délégation précédente ou
      // un prompt manuel), on NE perd PAS la demande — on la met en file
      // (traitée à la fin de la tâche en cours via flushDelegationQueue).
      // `ds.busy` couvre les délégations consécutives DU PROJET ; `isProjectBusy`
      // couvre le cas où l'agent est occupé par un prompt manuel (onglet visible).
      const ds = delegationState(projectPath);
      // TERRAIN RÉSERVÉ (vérification/installation du moteur `pi`, ou mise à
      // jour de Pilot) : MÊME traitement qu'un agent occupé (mise en file,
      // jamais de perte).
      const busy = ds.busy || isTerrainReserved() || await isProjectAgentBusy(projectPath);
      if (busy) {
        // `baseRequest` + `task` voyagent AVEC l'entrée de file : le contexte de
        // suivi est relu au moment de la transmission, jamais figé à l'arrivée.
        ds.queue.push({
          request,
          baseRequest,
          task: delegationTask,
          projectPath,
          agentId,
          messagesEl,
          invisible,
          forceInvisible,
          agentTabOpen,
        });
        // POINT C : la demande en file est TOUJOURS rejouée (sonde réelle de
        // l'agent cible) — jamais de blocage silencieux si l'agent_end n'arrive
        // pas (prompt distant, session figée…).
        armDelegationQueueReplay(projectPath);
        if (isTerrainReserved()) {
          // Motif EXACT fourni par le gardien unique (vérification, installation
          // du moteur ou mise à jour de Pilot) : l'utilisateur sait pourquoi et
          // QUAND ça repart.
          appendSystemMessage(messagesEl, `${terrainReservedMessage()}\n\nLa demande est mise en file : elle sera transmise à l'agent dès que le terrain sera libre (vérification ou installation du moteur, mise à jour de Pilot).`);
        } else {
          appendSystemMessage(messagesEl, "📋 L'agent travaille déjà sur une tâche. Demande mise en file (elle sera transmise à la fin de la tâche en cours).");
        }
        await respondSuperAgentAction(id, true);
        return;
      }

      ds.busy = true;
      const ok = await transmitDelegationToAgent({ request, projectPath, agentId, messagesEl, tabs, invisible, forceInvisible, agentTabOpen });
      if (!ok) {
        ds.busy = false;
        await respondSuperAgentAction(id, false);
        return;
      }
      appendSystemMessage(messagesEl, `✅ Demande transmise à l'agent « ${target.name} » (${target.id}) (il travaille en arrière-plan, je reste ici pour son retour).`);
      await respondSuperAgentAction(id, true);
    } else if (action === "purge_agent_conversation") {
      // Purge à la demande : l'Assistant appelle l'outil `purge_agent_conversation`
      // au début d'une conversation ou quand il faut arrêter l'agent. La commande
      // Rust préserve le modèle actif (new_session + ré-application du modèle).
      try {
        await invoke("purge_agent_conversation");
        // Bug d'affichage : le backend a reçu `new_session` (session repart à
        // zéro) mais le DOM de l'onglet agent gardait l'ancienne discussion.
        // On vide donc visuellement la conversation de l'onglet agent actif.
        const tabManager = window._pilotTabs;
        const agentTabs = (tabManager && Array.isArray(tabManager.tabs))
          ? tabManager.tabs.filter((t) => t && t.mode === "agent")
          : [];
        const activeAgentTab =
          agentTabs.find((t) => t.id === tabManager.activeTabId) || agentTabs[0];
        // Cas agent invisible / aucun onglet agent ouvert : rien à vider visuellement.
        if (activeAgentTab && activeAgentTab.agentElements && activeAgentTab.agentElements.messagesEl) {
          activeAgentTab.agentElements.messagesEl.innerHTML = "";
        }
        appendSystemMessage(messagesEl, "🧹 Conversation de l'agent purgée (modèle actif préservé).");
        await respondSuperAgentAction(id, true);
      } catch (e) {
        console.error("Erreur purge conversation agent (assistant):", e);
        appendSystemMessage(messagesEl, `❌ Purge de la conversation de l'agent échouée : ${e}`);
        await respondSuperAgentAction(id, false);
      }
    } else if (action === "stop_agent") {
      // Arrêter un agent (coupe la session en cours, visible ou invisible).
      // 4.1 : cible l'agent RÉSOLU (pas un littéral) via `stop_agent_session`
      // (qui route vers AgentService.stop). Issue #23/#22 : si l'assistant
      // fournit un `agentId` cible (agent secondaire/spécialisé/spécifique créé
      // à la volée et lancé via run_agents), on l'arrête précisément ; sinon on
      // retombe sur l'agent standard du projet. Réutilise le nettoyage du suivi
      // de l'agent invisible s'il était actif.
      try {
        const projectPath = info.project || window._pilotProjectPath || null;
        const targetAgentId = info.agentId || await resolveDelegationAgentId(projectPath);
        // R3-EXCEPTION-MANUEL : arrêt demandé EXPLICITEMENT (par l'assistant ou par
        // l'utilisateur) — ce n'est pas un arrêt automatique, donc aucune trace
        // d'arrêt automatique n'est écrite ici (le test des sites d'arrêt le
        // déclare en exception assumée).
        await invoke("stop_agent_session", { agentId: targetAgentId || null, projectPath }).catch(() => {});
        // Nettoyer aussi le suivi de l'agent invisible (bandeau + écouteur).
        if (typeof stopInvisibleAgentMonitoring === "function") {
          stopInvisibleAgentMonitoring(targetAgentId, projectPath);
        }
        // Issue #66 : l'arrêt annule les délégations en file d'attente — on ne
        // veut pas qu'elles soient (re)transmises automatiquement après un arrêt
        // explicite (l'utilisateur/assistant a décidé d'interrompre le travail).
        // RÈGLE 4 : chaque demande abandonnée est NOMMÉE, journalisée et annoncée
        // (auparavant le vidage était muet : les demandes disparaissaient).
        const stoppedDeleg = delegationState(projectPath);
        if (stoppedDeleg.queue.length > 0) {
          const delegated = await abandonQueuedDelegations(projectPath, { detected: "stop-agent" });
          appendSystemMessage(messagesEl, `📋 ${delegated.count} demande(s) en file d'attente annulée(s) par l'arrêt de l'agent : ${delegated.labels.join(" · ")} (motif consigné).`);
        }
        stoppedDeleg.busy = false;
        // POINT C : l'arrêt doit aussi libérer la place du PROJET pour la file
        // des MISSIONS (`runAgentsQueueByProject`, indexée par projet).
        // Même traitement que la file de délégation : si plus aucune run ne
        // tourne sur ce projet, on libère le créneau — mais la file n'est PLUS
        // vidée (P2) : les missions en attente sont CONSERVÉES, nommées et
        // rejouées (le verrou de bus ne prouve pas que le projet est libre).
        // Si une autre tâche tourne encore sur le projet, la file reste posée
        // (visible) et se videra normalement à la fin de cette tâche.
        const queueKey = (info.project && String(info.project).trim()) || window._pilotProjectPath || ".";
        await releaseStuckRunLock(queueKey);
        const stillRunning = isRunInProgress(queueKey);
        const waitingMissions = (runAgentsQueueByProject[missionQueueKey(queueKey)] || []).length;
        if (!stillRunning) {
          runAgentsInFlightByProject[inFlightKey(queueKey)] = false;
          const wd = runAgentsWatchdogByProject[watchdogKey(queueKey)];
          if (wd) { clearTimeout(wd); delete runAgentsWatchdogByProject[watchdogKey(queueKey)]; }
          if (waitingMissions > 0) {
            // P2 : un arrêt d'agent ne DÉTRUIT PLUS une file non vide. Le verrou
            // de run peut être périmé (relance, agent parqué, run terminée) : il
            // ne prouve pas que le projet est libre. On CONSERVE les missions,
            // on les NOMME (journal + écran) et on arme leur rejeu, qui jugera la
            // disponibilité sur les sessions réellement vivantes.
            const kept = await keepQueuedRunAgentsMissions(queueKey, { detected: "stop-agent" });
            appendSystemMessage(messagesEl, `📋 ${kept.count} mission(s) conservée(s) en file d'attente par l'arrêt de l'agent : ${kept.labels.join(" · ")} — elles seront rejouées dès que le projet sera libre (motif consigné).`);
          } else {
            delete runAgentsQueueByProject[missionQueueKey(queueKey)];
          }
        } else if (waitingMissions > 0) {
          appendSystemMessage(messagesEl, `⏳ ${waitingMissions} mission(s) toujours en attente : une autre tâche tourne encore sur ce projet.`);
        }
        // POINT F : même trou pour la file des missions D'ASSISTANT
        // (`runAgentsQueueByProject[ASSISTANT_SPACE]`, alimentée par
        // `run_assistant_agents`). Aucun chemin d'arrêt ne la vidait : une
        // mission d'assistant mise en file derrière une run d'assistant arrêtée
        // ne se rejouait jamais (pas de watchdog côté assistant) et disparaissait
        // sans un mot. MÊME traitement que pour un projet, sur la SEULE clé
        // ASSISTANT_SPACE (les files et verrous des projets ne sont pas touchés).
        const assistantKey = ASSISTANT_SPACE;
        const pendingAssistant = (runAgentsQueueByProject[missionQueueKey(assistantKey)] || []).length;
        if (pendingAssistant > 0) {
          await releaseStuckRunLock(assistantKey);
          if (!isRunInProgress(assistantKey)) {
            runAgentsInFlightByProject[inFlightKey(assistantKey)] = false;
            const wdA = runAgentsWatchdogByProject[watchdogKey(assistantKey)];
            if (wdA) { clearTimeout(wdA); delete runAgentsWatchdogByProject[watchdogKey(assistantKey)]; }
            // P2 : même règle que pour un projet — une file non vide est
            // CONSERVÉE (jamais détruite sur la foi d'un verrou), chaque mission
            // est nommée, et le rejeu est armé (jugé sur les sessions vivantes).
            const keptAssistant = await keepQueuedRunAgentsMissions(assistantKey, { detected: "stop-agent" });
            appendSystemMessage(messagesEl, `📋 ${keptAssistant.count} mission(s) d'assistant conservée(s) en file d'attente par l'arrêt de l'agent : ${keptAssistant.labels.join(" · ")} — elles seront rejouées dès que l'assistant sera libre (motif consigné).`);
          } else {
            appendSystemMessage(messagesEl, `⏳ ${pendingAssistant} mission(s) d'assistant toujours en attente : une autre tâche d'assistant tourne encore.`);
          }
        }
        // #28 : si l'agent arrêté est l'agent standard du projet actif
        // (`default`), fermer son onglet s'il est ouvert (évite un onglet
        // fantôme alors que l'agent n'est plus fonctionnel). Ne touche pas aux
        // onglets des agents secondaires/spécialisés ni aux onglets d'édition.
        const isStandardAgent = !targetAgentId || targetAgentId === "default";
        if (isStandardAgent) {
          const tabManager = window._pilotTabs;
          const defaultAgentTab = tabManager && Array.isArray(tabManager.tabs)
            ? tabManager.tabs.find((t) => t && t.mode === "agent" && t.agentId === "default")
            : null;
          if (defaultAgentTab && typeof tabManager.closeTab === "function") {
            tabManager.closeTab(defaultAgentTab.id, { skipConfirm: true }).catch(() => {});
          }
        }
        appendSystemMessage(messagesEl, `🛑 Agent ${targetAgentId ? `« ${targetAgentId} »` : "du projet"} arrêté.`);
        await respondSuperAgentAction(id, true);
      } catch (e) {
        console.error("Erreur stop_agent (assistant):", e);
        appendSystemMessage(messagesEl, `❌ Échec de l'arrêt de l'agent : ${e}`);
        await respondSuperAgentAction(id, false);
      }
    } else if (action === "create_agent") {
      // Coordinateur assistant : crée un agent sur mesure dans le registre global
      // (base SQLite `pilot.db`) quand les agents disponibles ne conviennent pas.
      const agent = info.agent;
      if (!agent || !agent.id || !agent.name || !agent.role) {
        appendSystemMessage(messagesEl, "❌ create_agent : id, name et role sont requis.");
        await respondSuperAgentAction(id, false);
        return;
      }
      try {
        const registry = await loadAgentRegistry();
        const agents = Array.isArray(registry.agents) ? registry.agents : [];
        const existing = agents.map((a) => a && a.id);
        const check = validateAgentId(agent.id, existing);
        if (!check.ok) {
          appendSystemMessage(messagesEl, `❌ ${check.error}`);
          await respondSuperAgentAction(id, false);
          return;
        }
        const newAgent = normalizeAgent({
          id: agent.id,
          name: agent.name,
          icon: agent.icon || "🤖",
          description: agent.description || "",
          role: agent.role,
          models: agent.models || { pi: "", plh: "" },
          capabilities: agent.capabilities || [],
          readonly: !!agent.readonly,
          keep_context: !!agent.keep_context,
          max_calls_per_run: typeof agent.max_calls_per_run === "number" ? agent.max_calls_per_run : 5,
          call_depth: typeof agent.call_depth === "number" ? agent.call_depth : 1,
        });
        // P4 : écriture atomique de l'agent seul (upsert) au lieu de
        // replace_agents (delete-all + re-insert). Garantit la persistance réelle
        // sur disque sans risque de perte partielle du registre.
        await upsertAgent(newAgent);
        appendSystemMessage(messagesEl, `✅ Agent « ${newAgent.name} » (${newAgent.id}) créé dans le registre global.`);
        await respondSuperAgentAction(id, true);
      } catch (e) {
        console.error("Erreur create_agent (assistant):", e);
        appendSystemMessage(messagesEl, `❌ Échec de la création de l'agent : ${e}`);
        await respondSuperAgentAction(id, false);
      }
    } else {
      await respondSuperAgentAction(id, false);
    }
  } catch (e) {
    console.error("Erreur action assistant:", e);
    appendSystemMessage(messagesEl, `❌ Action échouée : ${e}`);
    await respondSuperAgentAction(id, false);
  }
}

// ── Issue #66 : file d'attente des délégations ──
//
// `transmitDelegationToAgent` démarre/reprend la session de l'agent cible et
// lui envoie la demande. `isProjectAgentBusy` sonde l'activité (busy) de
// l'agent du projet. `flushDelegationQueue` est appelée à l'agent_end pour
// envoyer la délégation suivante mise en file.

/**
 * Démarre/reprend la session de l'agent cible et lui transmet la demande.
 * Gère les deux chemins : invisible (startAgentInvisible + suivi) et visible
 * (openFile en arrière-plan + affichage de la demande déléguée).
 * @returns {Promise<boolean>} true si la demande a été transmise.
 */
export async function transmitDelegationToAgent({ request, projectPath, agentId, messagesEl, tabs, invisible, forceInvisible, agentTabOpen }) {
  let agentTab = null;
  try {
    if (invisible || forceInvisible || !agentTabOpen) {
      // Démarrer la session agent en arrière-plan sans onglet (agent résolu).
      await tabs.startAgentInvisible(agentId, projectPath);
      // Mettre en place le suivi de l'agent invisible (bouton Arrêter,
      // détection de boucle, notification de fin de tâche).
      startInvisibleAgentMonitoring(messagesEl, agentId, projectPath, request);
    } else {
      // Issue #49 : ouvrir/démarrer l'agent du projet SANS basculer sur son
      // onglet — on reste sur l'onglet Assistant pour attendre le retour.
      // Cause C3 : ouvrir l'onglet de l'agent RÉSOLU (pas le littéral
      // `default`) — sinon le message délégué s'affiche dans le mauvais onglet
      // et la session transmise n'est pas celle de l'agent visé.
      agentTab = await tabs.openFile("", "agent", false, false, agentId, projectPath);
    }
    // Chantier 5/5 (v0.3.8) : purge automatique avant délégation. Si l'option
    // est activée (défaut) et que l'agent a DÉJÀ une conversation (a déjà
    // travaillé), on purge cette conversation (mécanique bouton « + » :
    // new_session + ré-application du modèle actif) PUIS on envoie la demande —
    // chaque demande repart d'un contexte vierge au lieu d'hériter de tout le
    // fil précédent (délégations « hyper long »). La conversation déjà vierge
    // n'est pas re-purgée (le backend compare l'historique get_messages).
    // Les messages directs de l'utilisateur dans l'onglet agent ne passent PAS
    // ici : aucune purge sur ses retouches. Fail-open : si la purge échoue
    // (session absente, backend muet…), on transmet quand même la demande
    // (comportement d'avant).
    let purgedBefore = false;
    if (configCache.super_agent_purge_before_delegate !== false) {
      try {
        purgedBefore = await invoke("purge_agent_conversation_to", { projectPath, agentId });
      } catch (e) {
        console.warn("Purge automatique avant délégation impossible:", e);
      }
      if (purgedBefore) {
        // Bug d'affichage : la conversation backend est repartie à zéro — vider la
        // discussion DOM de l'onglet agent (s'il existe) et réinitialiser les
        // flags Context Engine (réinjection au prochain envoi).
        purgeAgentTabView(agentId, projectPath);
        appendSystemMessage(messagesEl, "🧹 Conversation de l'agent purgée avant la nouvelle demande (modèle actif préservé).");
      }
    }
    if (!invisible && !forceInvisible && agentTabOpen) {
      // Issue #45 : afficher la demande déléguée dans la discussion de l'agent
      // (APRÈS la purge — la nouvelle demande démarre une discussion vierge).
      const agentMessagesEl = agentTab && agentTab.agentElements ? agentTab.agentElements.messagesEl : null;
      if (agentMessagesEl) {
        appendDelegatedMessage(agentMessagesEl, request);
      }
    }
    // Issue #47 : mémoriser la délégation en attente (consommée à l'agent_end
    // pour injecter le feedback au super-agent).
    delegationState(projectPath).pending = {
      request: String(request),
      projectPath,
    };
    // Envoyer la demande à l'agent (session du projet, agent résolu).
    await invoke("send_agent_command_to", {
      project_path: projectPath,
      agentId,
      command: { type: "prompt", message: request },
    });
    return true;
  } catch (e) {
    console.error("Erreur transmission délégation:", e);
    appendSystemMessage(messagesEl, `❌ Échec de la transmission de la demande à l'agent : ${e}`);
    return false;
  }
}

/**
 * Indique si l'agent d'un projet est actuellement occupé (travaille sur une
 * tâche). Sonde l'activité RPC du projet via `get_project_agent_states` (pour
 * le projet actif / un projet ouvert avec un onglet visible). Pour un projet
 * headless non ouvert, retombe sur l'état de délégation du projet (les agents
 * headless ne sont pilotés QUE par délégation, donc il les couvre).
 * @param {string|null} projectPath
 * @returns {Promise<boolean>}
 */
export async function isProjectAgentBusy(projectPath) {
  try {
    const states = await invoke("get_project_agent_states");
    const key = projectPath || window._pilotProjectPath || null;
    if (key && states && states[key]) {
      return !!states[key].busy;
    }
  } catch (_) {}
  // Projet non listé (headless non ouvert) : on ne sait pas — on retombe sur
  // l'état de délégation du projet (géré par l'appelant via le `||`).
  return false;
}

/**
 * Vide la file des délégations en attente DU PROJET : marque l'agent du projet
 * comme libre, puis s'il reste une demande en file, la transmet (et remet
 * l'agent occupé). Appelée à l'agent_end (visible via
 * injectSessionSummaryToSuperAgent, invisible via finalizeInvisibleAgent) en
 * passant le projet concerné, pour ne pas libérer la file d'un autre projet.
 * @param {string|null} projectPath
 */
function flushDelegationQueue(projectPath) {
  const ds = delegationState(projectPath);
  ds.busy = false;
  if (ds.queue.length === 0) return;
  if (isTerrainReserved()) {
    // TERRAIN RÉSERVÉ : rien ne démarre. La demande RESTE en tête de file (le
    // rejeu périodique la reprendra dès que le terrain sera libre) — aucune
    // demande n'est consommée puis perdue.
    armDelegationQueueReplay(projectPath);
    return;
  }
  // MISE À JOUR DE PILOT : aucune priorité d'affichage (voir `launchQueuedMission`).
  // La mise à jour s'affiche sans occuper le terrain : elle ne retarde plus la
  // demande suivante.
  const tabs = window._pilotTabs;
  if (!tabs) {
    // Gestionnaire d'onglets indisponible : on GARDE la demande en tête de file
    // (le rejeu périodique la reprendra) au lieu de la consommer puis la perdre
    // — SEUL chemin qui perdait vraiment une demande (R10).
    console.warn("[delegation-queue] tabs indisponibles, demande conservée en file");
    return;
  }
  const next = ds.queue.shift();
  ds.busy = true;
  // BUG « une tâche mise en file exécute la tâche précédente » : le CONTEXTE DE
  // SUIVI de la demande en file est RELU MAINTENANT — au moment de sa
  // transmission — et non celui figé à son arrivée (il décrivait alors la tâche
  // qui tournait, donc la tâche PRÉCÉDENTE). Une entrée historique sans
  // `baseRequest` part inchangée (comportement antérieur préservé).
  const requestNow = next.baseRequest != null
    ? refreshAssignmentsBrief([], next.baseRequest, next.projectPath || null, String(next.task || ""))
    : Promise.resolve(next.request);
  // Transmettre la demande suivante (fire-and-forget : le résultat sera
  // reporté dans le chat via transmitDelegationToAgent).
  requestNow
    .then((request) => transmitDelegationToAgent({
      request,
      projectPath: next.projectPath,
      agentId: next.agentId,
      messagesEl: next.messagesEl,
      tabs,
      invisible: next.invisible,
      forceInvisible: next.forceInvisible,
      agentTabOpen: next.agentTabOpen,
    }))
    .then((ok) => {
      if (ok) {
        appendSystemMessage(next.messagesEl, "📋 Demande mise en file transmise à l'agent (la tâche précédente est terminée).");
      } else {
        // Échec de la transmission : on libère et on essaie la suite.
        ds.busy = false;
        flushDelegationQueue(next.projectPath);
      }
    })
    .catch((e) => {
      // Jamais de demande perdue en silence : on libère la place et on réessaie.
      console.warn("[delegation-queue] transmission de la demande en file en échec :", e);
      ds.busy = false;
      armDelegationQueueReplay(next.projectPath);
    });
}

// ── Agent invisible : suivi en arrière-plan (évolution 64) ──
//
// Quand l'option « agent invisible » est activée, l'Assistant délègue une
// demande à l'agent SANS créer d'onglet agent. On écoute alors le canal
// d'événements de l'agent en arrière-plan pour : (1) détecter une boucle de
// réflexion (loop-detection) et arrêter l'agent automatiquement, (2) notifier
// l'utilisateur et injecter le feedback de délégation à la fin de la tâche
// (agent_end). L'affichage d'un bandeau a été retiré (retour utilisateur) : le
// suivi reste 100 % fonctionnel, seule la partie visuelle disparaît.

/**
 * Démarre le suivi réactif de l'agent invisible (écoute du canal). 4.3 : la
 * notification de fin est pilotée par l'état de l'objet (agent-state-changed +
 * lecture get_agent), plus par un état local non persisté. Le buffer de
 * détection de boucle est SCOPÉ au listener (closure), pas une variable de
 * module transitoire.
 * @param {Element} messagesEl
 * @param {string} agentId - id résolu depuis l'objet (4.1).
 * @param {string|null} projectPath
 * @param {string} request - demande déléguée (contexte, pour le suivi).
 * @param {object} [options]
 * @param {number|null} [options.sessionUid] - uid de session si l'appelant le
 *   connaît (garde de propriété à l'arrêt automatique).
 */
async function startInvisibleAgentMonitoring(messagesEl, agentId, projectPath, request, options = {}) {
  // Issue #135 : on ne coupe plus les suivis précédents — chaque agent invisible
  // a son propre suivi dans la map invisibleAgents (clé agentId+projectPath).
  //
  // Retour utilisateur : plus aucun bandeau visuel « Agent en arrière-plan… »
  // au-dessus de la barre de saisie. Le suivi reste identique (écoute du canal,
  // détection de boucle, fin de tâche, arrêt via l'outil stop_agent).

  // Buffer de détection de boucle, SCOPÉ au listener (pas de variable de
  // module transitoire — issue #55, 4.3).
  const loop = { buffer: "", lastText: "", priorText: "", lastChecked: 0, stopped: false, toolCalls: [] };

  // Écouter le canal d'événements de l'agent (même canal que l'onglet agent),
  // en utilisant l'id RÉSOLU (4.1).
  let channel = "rpc-event";
  try {
    channel = await invoke("get_agent_event_channel", { agentId, projectPath });
  } catch (_) {}
  const unlisten = await listen(channel, (event) => {
    try {
      handleInvisibleAgentEvent(event.payload, messagesEl, agentId, projectPath, loop);
    } catch (err) {
      console.error("[agent-invisible] erreur événement:", err);
    }
  });

  const sessionUid =
    typeof (options && options.sessionUid) === "number" && Number.isFinite(options.sessionUid) && options.sessionUid > 0
      ? options.sessionUid
      : null;
  invisibleAgents.set(invisibleAgentKey(agentId, projectPath), {
    agentId, projectPath, messagesEl, unlisten, loop, sessionUid,
  });
}

/** Clé d'indexation d'un suivi d'agent invisible (agentId + projectPath). */
function invisibleAgentKey(agentId, projectPath) {
  return `${agentId || ""}::${projectPath || ""}`;
}

/** Traite un événement du canal de l'agent invisible. */
function handleInvisibleAgentEvent(payload, messagesEl, agentId, projectPath, loop) {
  const type = payload.type;
  // Restitution fiable : nouveau message assistant → repartir d'un texte vide
  // (le compte rendu de fin ne doit contenir que le DERNIER message de l'agent).
  if (type === "message_start") {
    const m = payload.message;
    if (m && m.role === "assistant") {
      // On REPART d'un texte vide pour le compte rendu courant, mais le texte
      // déjà produit n'est plus jeté : il est conservé de côté. Si le processus
      // meurt ensuite, c'est le dernier texte réellement écrit qui est restitué.
      if (normalizePartialAgentText(loop.lastText)) loop.priorText = loop.lastText;
      loop.lastText = "";
    }
    return;
  }
  if (type === "message_update") {
    const delta = payload.assistantMessageEvent;
    if (!delta) return;
    // Accumuler le flux streamé dans le buffer scpé pour la détection de boucle.
    if (delta.type === "text_delta" && typeof delta.delta === "string") {
      loop.buffer += delta.delta;
      // Restitution fiable : mémoriser le texte assistant (hors réflexion) pour
      // le compte rendu de fin de tâche transmis à l'assistant.
      loop.lastText += delta.delta;
      maybeDetectInvisibleAgentLoop(messagesEl, loop, agentId, projectPath);
    } else if (delta.type === "thinking_delta" && typeof delta.delta === "string") {
      loop.buffer += delta.delta;
      maybeDetectInvisibleAgentLoop(messagesEl, loop, agentId, projectPath);
    }
    return;
  }
  if (type === "tool_execution_start") {
    // Issue #55 : accumuler une empreinte du tool call (ex: commande bash) pour
    // détecter une boucle d'OUTILS identiques, même sans texte streamé répété.
    const toolName = payload.toolName || payload.tool || "outil";
    // RÈGLE 2 : une LECTURE (outil de lecture pure, commande shell consultative)
    // n'alimente JAMAIS l'historique d'actions — la répéter est de l'exploration
    // légitime, pas une boucle. Seul un appel qui MODIFIE peut fonder un arrêt.
    if (!isReadOnlyAgentToolCall(toolName, payload.args)) {
      loop.toolCalls.push(buildToolLoopFingerprint(toolName, payload.args));
    }
    maybeDetectInvisibleAgentLoop(messagesEl, loop, agentId, projectPath);
    return;
  }
  if (type === "agent_end") {
    // 4.2/4.3 : fin pilotée par l'état de l'objet. Si l'agent est en
    // Compacting, on N'INJECTE PAS de résumé « tâche non faite » (issue #54) et
    // on garde le suivi (le vrai agent_end post-compaction viendra finaliser).
    //
    // F5 (avis de fin prématuré, Kodali 30-09) : `agent_end` n'est PAS forcément
    // terminal — pi peut l'émettre avec `willRetry: true` (erreur transitoire,
    // troncature, compaction, continuation) puis repartir. Annoncer « terminé »
    // ici faussait le suivi pendant que l'agent travaillait encore. On réarme les
    // buffers et on attend le prochain agent_end / l'agent_settled, exactement
    // comme le bus (agents-bus.js).
    if (!shouldFinalizeOnAgentEnd(payload)) {
      loop.buffer = "";
      // Le texte déjà produit est CONSERVÉ (relance, compaction, continuation) :
      // une mort qui suivrait ne doit pas emporter le travail déjà rédigé.
      if (normalizePartialAgentText(loop.lastText)) loop.priorText = loop.lastText;
      loop.lastText = "";
      return;
    }
    checkInvisibleAgentCompletion(messagesEl, agentId, projectPath);
    return;
  }
  if (type === "agent_settled") {
    // Filet « zéro perte » : `agent_settled` = run TOTALEMENT terminée (aucune
    // relance/compaction en attente). Si l'`agent_end` final a été raté, on
    // finalise ici (idempotent : `finalizeInvisibleAgent` ne fait rien si le
    // suivi est déjà consommé).
    checkInvisibleAgentCompletion(messagesEl, agentId, projectPath);
    return;
  }
  if (type === "process_exit" || type === "process_error") {
    // MORT / PLANTE : on conserve et on rend visible le texte que l'agent avait
    // déjà écrit (au lieu d'un simple « Connexion perdue » qui le jetait).
    void reportInvisibleAgentDeath(messagesEl, agentId, projectPath, loop, type);
    return;
  }
}

/**
 * Vérifie l'état de l'objet à l'agent_end : si Compacting, on ignore (issue
 * #54, l'assistant ne marque pas la tâche comme faite/non-faite pendant une
 * compaction). Sinon, finalise le suivi (notification + feedback délégation).
 */
async function checkInvisibleAgentCompletion(messagesEl, agentId, projectPath) {
  try {
    // L'agent standard est global (project_path NULL) ; get_agent le lit tel quel.
    const agent = await invoke("get_agent", { agentId, projectPath: null });
    if (agent && agent.state === "Compacting") return; // ne pas finaliser
  } catch (_) {
    // Lecture d'état indisponible : on finalise prudemment (l'agent_end réel).
  }
  finalizeInvisibleAgent(
    messagesEl, agentId, projectPath,
    "✅ L'agent a terminé sa tâche en arrière-plan."
  );
}

/**
 * Compose le compte rendu de fin de tâche d'un agent invisible (fonction pure).
 * Le RÉSULTAT réel (dernier message assistant de l'agent) est inclus ; s'il est
 * vide (agent sans texte final), on retombe sur un libellé générique. Sans ce
 * texte, l'assistant coordinateur reçoit un compte rendu vide et croit que rien
 * n'a été fait, ce qui le pousse à relancer inutilement.
 * @param {unknown} finalText - dernier message assistant de l'agent (peut être "").
 * @returns {string}
 */
export function buildInvisibleAgentFinalSummary(finalText) {
  const text = typeof finalText === "string" ? finalText.trim() : "";
  return text
    ? `Résultat de l'agent : ${text}`
    : "L'agent a terminé la tâche déléguée en arrière-plan.";
}

/**
 * Compose le compte rendu d'un agent MORT ou planté (fonction pure) : ce que
 * l'agent avait DÉJÀ écrit, ou — s'il n'a rien écrit — la mention explicite
 * « aucun texte récupéré ». Jamais un silence, jamais un texte inventé.
 * @param {unknown} partialText - texte accumulé avant la mort (peut être "")
 * @returns {string}
 */
export function buildInvisibleAgentDeathSummary(partialText) {
  const text = normalizePartialAgentText(partialText);
  return buildAgentDeathReport({ text, source: text ? "memory" : "none" });
}

/**
 * Signale la mort d'un agent invisible : trace disque (même journal que les
 * arrêts — champ `text=`) puis compte rendu à l'assistant avec le texte déjà
 * produit. Aucune relance automatique : on conserve, on ne rejoue rien.
 * @param {Element} messagesEl
 * @param {string} agentId
 * @param {string|null} projectPath
 * @param {object} loop - buffers du suivi (lastText / priorText)
 * @param {string} type - "process_exit" | "process_error"
 * @returns {Promise<void>}
 */
async function reportInvisibleAgentDeath(messagesEl, agentId, projectPath, loop, type) {
  const kept =
    normalizePartialAgentText(loop && loop.lastText) ||
    normalizePartialAgentText(loop && loop.priorText);
  const tracked = invisibleAgents.get(invisibleAgentKey(agentId, projectPath));
  const uid = tracked ? tracked.sessionUid : null;
  // RÈGLE 3 : même emplacement de trace que les autres arrêts (jamais un
  // second journal) ; l'écriture ne bloque jamais la fin de tâche.
  await traceAutomaticAgentStop({
    reason: "session-error",
    detected: type === "process_error" ? "process-error" : "process-exit",
    agentId,
    projectPath,
    uid,
    text: kept,
  }).catch(() => {});
  finalizeInvisibleAgent(
    messagesEl,
    agentId,
    projectPath,
    `⚠️ Connexion à l'agent en arrière-plan perdue. ${buildInvisibleAgentDeathSummary(kept)}`,
    { death: true },
  );
}

/** Finalise le suivi (idempotent) : notifie, feedback délégation. */
function finalizeInvisibleAgent(messagesEl, agentId, projectPath, message, options = {}) {
  // Finaliser une seule fois (l'état de l'objet a déjà basculé).
  const key = invisibleAgentKey(agentId, projectPath);
  const t = invisibleAgents.get(key);
  if (!t) return;
  // Récupérer le DERNIER message assistant réellement produit AVANT de supprimer
  // le suivi (le loop est porté par l'entrée de la map).
  const finalText =
    (t.loop && typeof t.loop.lastText === "string" && t.loop.lastText) ||
    (t.loop && typeof t.loop.priorText === "string" ? t.loop.priorText : "") ||
    "";
  stopInvisibleAgentMonitoring(agentId, projectPath);
  appendSystemMessage(messagesEl, message);
  // Injecter le feedback de délégation (consomme pending → notification
  // + consignation dans le suivi de l'assistant), avec le RÉSULTAT de l'agent.
  // Garde de curation : un compte rendu sans résultat (agent sans texte final)
  // n'est pas mémorisé — SAUF s'il porte le feedback d'une délégation en attente
  // (la fin de tâche déléguée n'est jamais perdue, cf. `injectSessionSummaryToSuperAgent`).
  // MORT / PLANTE : le compte rendu dit ce que l'agent avait écrit, ou
  // explicitement qu'aucun texte n'a été récupéré (jamais un silence).
  const reportSummary = options && options.death
    ? buildInvisibleAgentDeathSummary(finalText)
    : buildInvisibleAgentFinalSummary(finalText);
  injectSessionSummaryToSuperAgent(reportSummary, projectPath, {
    remember: shouldRememberAgentReport(reportSummary),
  }).catch(() => {});
}

/** Détection de boucle de réflexion sur l'agent invisible (throttlée). */
function maybeDetectInvisibleAgentLoop(messagesEl, loop, agentId, projectPath) {
  if (loop.stopped) return; // déjà arrêté pour boucle
  const now = Date.now();
  if (now - loop.lastChecked < INVISIBLE_LOOP_CHECK_INTERVAL_MS) return;
  loop.lastChecked = now;
  // RÈGLE 2 (même correctif que l'Assistant, issue #10) : une boucle d'OUTILS se
  // juge sur les APPELS, pas sur la longueur du texte streamé. La sortie anticipée
  // « buffer trop court » (garde anti-faux-positif du texte) rendait la détection
  // d'outils MUETTE tant que le modèle n'avait pas écrit 200 caractères : un agent
  // invisible qui répétait le même `edit` sans texte n'était jamais arrêté.
  const toolLoop = detectRepeatedToolCalls(loop.toolCalls);
  // Motif RÉELLEMENT déclenché : il est journalisé sur disque (agent-stops.log)
  // pour ne plus confondre « répétition du même texte » et « boucle d'outils ».
  const textLoop =
    !toolLoop &&
    loop.buffer.length >= INVISIBLE_LOOP_BUFFER_MIN &&
    (detectRepeatedBlock(loop.buffer) ||
      detectRepeatedWord(loop.buffer) ||
      detectSemanticLoop(loop.buffer));
  if (textLoop || toolLoop) {
    loop.stopped = true;
    console.warn(`[loop-detection] boucle détectée sur l'agent invisible ${agentId}, arrêt`);
    appendSystemMessage(
      messagesEl,
      "⚠️ L'agent a tourné en boucle (répétition du même texte ou des mêmes appels d'outils). Agent arrêté."
    );
    stopInvisibleAgent(agentId, projectPath, {
      reason: "loop-detection",
      detected: textLoop ? "text" : "tool-calls",
    });
  }
}

/**
 * Arrête l'agent invisible (session + suivi). 4.1 : cible l'id RÉSOLU.
 *
 * Arrêt automatique : le MOTIF est journalisé sur disque, et l'uid de session
 * suivi est transmis quand il est connu, pour que la garde de propriété de
 * `stop_agent_process` protège ce chemin (ne jamais tuer la session d'une autre
 * exécution).
 * @param {string} agentId
 * @param {string|null} projectPath
 * @param {object} [options]
 * @param {string} [options.reason="loop-detection"] - cause de l'arrêt
 * @param {string} [options.detected="unknown"] - détecteur déclenché
 * @param {number|null} [options.sessionUid] - uid de session connu de l'appelant
 */
async function stopInvisibleAgent(agentId, projectPath, options = {}) {
  const key = invisibleAgentKey(agentId, projectPath);
  const t = invisibleAgents.get(key);
  const messagesEl = t ? t.messagesEl : null;
  const reason = options.reason || "loop-detection";
  const detected = options.detected || "unknown";
  // uid : celui fourni par l'appelant, sinon celui mémorisé au démarrage du suivi.
  const candidates = [options.sessionUid, t ? t.sessionUid : null];
  const uid = candidates.find((v) => typeof v === "number" && Number.isFinite(v) && v > 0) || null;
  // Trace disque du motif (fail-open : jamais bloquant).
  traceAutomaticAgentStop({ reason, detected, agentId, projectPath, uid }).catch(() => {});
  const req = buildAgentStopRequest({ agentId, projectPath, uid });
  let stopped = false;
  try {
    await invoke(req.cmd, req.args);
    stopped = true;
    if (req.guarded) {
      // `stop_agent_session` est le SEUL chemin qui libère l'activité du projet
      // (issue #13 / tâche 335) : après un arrêt gardé, on repasse par lui
      // (idempotent — la session est déjà arrêtée).
      await invoke("stop_agent_session", { agentId: agentId || null, projectPath }).catch(() => {});
    }
  } catch (e) {
    if (req.guarded) {
      // Garde de propriété : la session suivie a été remplacée depuis son
      // lancement → on NE tue PAS la session en place.
      console.warn("[loop-detection] arrêt refusé (session remplacée):", e);
    } else {
      console.error("Erreur stop_agent_session (agent invisible):", e);
    }
  }
  stopInvisibleAgentMonitoring(agentId, projectPath);
  if (messagesEl) {
    appendSystemMessage(
      messagesEl,
      stopped ? "🛑 Agent en arrière-plan arrêté." : "🛑 Session suivie déjà remplacée : rien à arrêter."
    );
  }
}

/** Nettoie le suivi de l'agent invisible (unlisten). */
function stopInvisibleAgentMonitoring(agentId, projectPath) {
  // Sans clé : nettoyage global de tous les suivis (arrêt complet).
  if (agentId === undefined) {
    for (const t of Array.from(invisibleAgents.values())) {
      if (t.unlisten) { try { t.unlisten(); } catch (_) {} }
    }
    invisibleAgents.clear();
    return;
  }
  const key = invisibleAgentKey(agentId, projectPath);
  const t = invisibleAgents.get(key);
  if (!t) return;
  if (t.unlisten) {
    try { t.unlisten(); } catch (_) {}
  }
  invisibleAgents.delete(key);
}

/**
 * Décision PURE de résolution de la cible d'une délégation (cause C2).
 * Séparée de l'I/O (`resolveDelegationTarget`) pour être testable sans Tauri.
 *
 * Règle : l'agent cible doit être EXPLICITEMENT désigné (`requestedAgentId`).
 *  - désigné et résolu → c'est la cible, et rien d'autre ;
 *  - désigné mais INTROUVABLE → ERREUR EXPLICITE (`ok:false` + `error` portant
 *    l'id demandé) et AUCUN lancement ;
 *  - AUCUN agent désigné → REFUS EXPLICITE (`ok:false` + `error` demandant de
 *    préciser l'agent) et AUCUN lancement. Aucun repli implicite sur le codeur
 *    du projet ou sur l'agent par défaut : la demande ne part plus jamais vers
 *    un agent que l'utilisateur n'a pas désigné.
 * @param {object} input
 * @param {string|null} input.requestedAgentId
 * @param {{id:string,name:string}|null} input.requested
 * @returns {{ok:boolean, id:string|null, name:string|null, error:string|null}}
 */
export function resolveDelegationTargetDecision({ requestedAgentId, requested }) {
  if (!requestedAgentId) {
    return {
      ok: false,
      id: null,
      name: null,
      readonly: false,
      error: "Aucun agent n'a été désigné pour cette tâche. Précise quel agent doit la faire",
    };
  }
  if (requested && requested.id) {
    return { ok: true, id: requested.id, name: requested.name || requested.id, readonly: requested.readonly === true, error: null };
  }
  return {
    ok: false,
    id: null,
    name: null,
    readonly: false,
    error: `agent demandé introuvable : « ${requestedAgentId} »`,
  };
}

/**
 * 4.1 (R3) + tâche 209 : résout l'agent CIBLE d'une délégation depuis l'objet
 * persisté (get_agent), jamais depuis un littéral, ET son libellé d'affichage.
 * L'agent doit être EXPLICITEMENT désigné par l'assistant (`agent_id`) : s'il
 * manque ou s'il est INTROUVABLE, la décision est un refus explicite (cause C2)
 * — aucun repli implicite, aucun lancement.
 * @param {string|null} projectPath
 * @param {string|null} [requestedAgentId]
 * @returns {Promise<{ok: boolean, id: string|null, name: string|null, error: string|null}>}
 */
async function resolveDelegationTarget(projectPath, requestedAgentId) {
  const requested = requestedAgentId ? await lookupAgent(requestedAgentId, projectPath) : null;
  return resolveDelegationTargetDecision({
    requestedAgentId: requestedAgentId || null,
    requested,
  });
}

/**
 * Résout un agent par id (base globale puis scope projet) avec libellé. Retourne
 * null si introuvable dans les deux scopes.
 * @param {string} agentId
 * @param {string|null} projectPath
 * @returns {Promise<{id: string, name: string}|null>}
 */
async function lookupAgent(agentId, projectPath) {
  const scopes = projectPath ? [null, projectPath] : [null];
  for (const scope of scopes) {
    try {
      const agent = await invoke("get_agent", { agentId, projectPath: scope });
      if (agent && agent.id) {
        return { id: agent.id, name: agent.name || agent.id, readonly: agent.readonly === true };
      }
    } catch (_) {}
  }
  return null;
}

/**
 * 4.1 (R3) : id seul de l'agent standard du projet (compat : arrêt ciblé
 * `stop_agent`). Ordre inchangé : agent par défaut global, sinon agent par
 * défaut projet, sinon littéral `default`. La résolution codeur de la tâche 209
 * est réservée à `resolveDelegationTarget` (chemin de délégation).
 * @param {string|null} projectPath
 * @returns {Promise<string>}
 */
async function resolveDelegationAgentId(projectPath) {
  const def = await lookupAgent(DEFAULT_AGENT_ID, projectPath);
  return def ? def.id : DEFAULT_AGENT_ID;
}

/**
 * 4.3 : piloté par l'événement `agent-state-changed` de Rust. Finalise quand
 * l'objet n'est plus actif (Stopped/Error/Unloaded) — plus par un état local
 * transitoire.
 * @param {object} payload - { agentId, projectPath, loaded, busy, procState, visible }.
 */
function handleAgentStateChanged(payload) {
  if (!payload) return;
  const key = invisibleAgentKey(payload.agentId, payload.projectPath);
  const t = invisibleAgents.get(key);
  if (!t) return;
  const state = payload.procState || payload.state;
  const active =
    payload.visible === false &&
    (state === "Running" || state === "Paused" || state === "Compacting" || !!payload.busy);
  if (!active && (state === "Stopped" || state === "Error" || state === "Unloaded")) {
    // Fin pilotée par l'état de l'objet (si pas déjà finalisé).
    finalizeInvisibleAgent(
      t.messagesEl, t.agentId, t.projectPath,
      "✅ L'agent a terminé sa tâche en arrière-plan."
    );
  }
}


/** Répond à une action assistant (confirmed au niveau racine, comme edit-gate). */
async function respondSuperAgentAction(id, ok) {
  try {
    await invoke("send_super_agent_command", {
      command: { type: "extension_ui_response", id, confirmed: ok, cancelled: !ok },
    });
  } catch (e) {
    console.error("Erreur extension_ui_response (action assistant):", e);
  }
}

/** Cible d'attache des boutons : le flux de la bulle assistant courante (ou en crée une). */
function getSuperAgentAttachTarget(messagesEl, state) {
  // Attacher au flux du bloc assistant courant si possible (rendu harmonisé, #43).
  if (currentFlow) return currentFlow;
  let attachTo = state.currentAssistantBlock;
  if (!attachTo) {
    attachTo = createSuperAgentBlock(messagesEl);
    currentFlow = attachTo.querySelector(".agent-stream-flow");
    state.currentAssistantBlock = attachTo;
  }
  return currentFlow || attachTo;
}

/** Envoie la réponse d'un bouton au processus pi du super-agent. */
async function respondSuperAgent(id, value, cancelled) {
  const cmd = { type: "extension_ui_response", id };
  if (cancelled) cmd.cancelled = true;
  else cmd.value = value;
  try {
    await invoke("send_super_agent_command", { command: cmd });
  } catch (e) {
    console.error("Erreur extension_ui_response (super-agent):", e);
  }
}

/** Envoie la réponse d'un bouton RELAIS à la session agent ciblée (tâche #22). */
async function respondAgentRelay(projectPath, agentId, id, value, cancelled) {
  const cmd = { type: "extension_ui_response", id };
  if (cancelled) cmd.cancelled = true;
  else cmd.value = value;
  try {
    await invoke("send_agent_command_to", { projectPath, agentId, command: cmd });
  } catch (e) {
    console.error("Erreur extension_ui_response (relais agent):", e);
  }
}

/**
 * Relais passif et transparent des choix d'un agent du projet via l'assistant
 * (tâche de suivi #22). Reçoit un `extension_ui_request` pilot-choices émis par
 * un agent de projet (agent-pi.js le détecte et déclenche l'événement
 * `pilot-agent-relay-request`) et le rend dans le chat 🧭 avec un en-tête
 * identifiant l'agent source. L'utilisateur peut annoter / modifier / valider sa
 * réponse, qui est alors routée vers LA bonne session agent (multi-agents).
 */
function relayAgentChoiceRequest(payload, agentId, projectPath, messagesEl, state) {
  const { id, method } = payload;
  // Répondre en routant vers la session agent ciblée (et non le super-agent).
  const responder = (value, cancelled) =>
    respondAgentRelay(projectPath, agentId, id, value, cancelled);

  // Bloc dédié (distinct du flux de l'assistant) : en-tête + widget. Badges
  // EXPLICITES : la question vient de l'agent de CE projet (projectPath), et
  // non du projet actuellement sélectionné à l'écran (défaut corrigé).
  const relayProjectName = pathTailName(projectPath);
  const block = createSuperAgentBlock(messagesEl, relayProjectName ? [relayProjectName] : null);
  const target = block.querySelector(".agent-stream-flow") || block;
  const label = agentId === "default" ? "par défaut" : agentId;
  const header = document.createElement("div");
  header.className = "agent-relay-header";
  header.textContent = `🤖 L'agent « ${label} » du projet attend une réponse :`;
  target.appendChild(header);

  if (method === "confirm") {
    renderSuperAgentConfirm(messagesEl, state, id, payload.title || "Confirmation", payload.message || "", responder, target);
  } else if (method === "select") {
    const options = payload.options || [];
    const rawTitle = payload.title || "Choix";
    const MULTI = "PILOT_MULTI_CHOICE::";
    const CONFIRM = "PILOT_CONFIRM::";
    const multi = rawTitle.startsWith(MULTI);
    const confirm = rawTitle.startsWith(CONFIRM);
    let title = rawTitle;
    let confirmMessage = "";
    if (multi) {
      title = rawTitle.slice(MULTI.length);
    } else if (confirm) {
      try {
        const parsed = JSON.parse(rawTitle.slice(CONFIRM.length));
        title = parsed.title || "Confirmation";
        confirmMessage = parsed.message || "";
      } catch {
        title = rawTitle.slice(CONFIRM.length);
      }
    }
    if (confirm) {
      renderSuperAgentConfirm(messagesEl, state, id, title, confirmMessage, responder, target);
    } else {
      renderSuperAgentChoice(messagesEl, state, id, title, options, multi, responder, target);
    }
  } else if (method === "input") {
    renderSuperAgentInput(messagesEl, state, id, payload.title || "Entrée", payload.placeholder || "", responder, target);
  }
  scrollSuperToBottom(messagesEl);
}

/** Rend des boutons de choix inline (unique ou multi).
 * @param {Function} responder - (id, value, cancelled) => Promise ; par défaut
 *   envoie au super-agent, sinon (relais) route vers la session agent ciblée.
 * @param {HTMLElement|null} targetOverride - cible d'attache (sinon auto). */
/** Bandeau informatif (lecture seule) posé dans le fil pour une question. */
function makeChoiceBanner(title, message) {
  const wrapper = document.createElement("div");
  wrapper.className = "agent-choice";
  const titleEl = document.createElement("div");
  titleEl.className = "agent-choice-title";
  titleEl.textContent = title;
  wrapper.appendChild(titleEl);
  if (message) {
    const msg = document.createElement("div");
    msg.className = "agent-choice-message";
    msg.textContent = message;
    wrapper.appendChild(msg);
  }
  return wrapper;
}

/** Rend la rangée de boutons (unique ou multi) de la question dans #pendingBar. */
function renderChoicePendingBar(q, bar) {
  bar.innerHTML = "";
  const titleEl = document.createElement("div");
  titleEl.className = "agent-pending-title";
  titleEl.textContent = q.title;
  bar.appendChild(titleEl);
  const buttons = document.createElement("div");
  buttons.className = "agent-choice-buttons";
  if (q.multi) {
    q.options.forEach((opt, i) => {
      const btn = document.createElement("button");
      btn.className = `agent-choice-btn agent-choice-opt-${i % 6}` + (q.selected.has(opt) ? " selected" : "");
      btn.textContent = opt;
      btn.addEventListener("click", () => {
        if (q.selected.has(opt)) q.selected.delete(opt); else q.selected.add(opt);
        renderActivePendingQuestion();
      });
      buttons.appendChild(btn);
    });
  } else {
    // Choix unique : toggle + Valider — permet de valider SANS choisir d'option
    // (précision libre, issue #39). `selected` = null si aucune option cochée.
    q.options.forEach((opt, i) => {
      const btn = document.createElement("button");
      btn.className = `agent-choice-btn agent-choice-opt-${i % 6}` + (q.selected === opt ? " selected" : "");
      btn.textContent = opt;
      btn.addEventListener("click", () => {
        q.selected = (q.selected === opt) ? null : opt;
        renderActivePendingQuestion();
      });
      buttons.appendChild(btn);
    });
  }
  const validate = document.createElement("button");
  validate.className = "agent-choice-btn agent-choice-validate";
  validate.textContent = "✓ Valider";
  validate.addEventListener("click", () =>
    validatePendingQuestion(pendingInputEl ? pendingInputEl.value.trim() : ""));
  buttons.appendChild(validate);
  bar.appendChild(buttons);
}

/** Rend la rangée Oui / Non de la question dans #pendingBar. */
function renderConfirmPendingBar(q, bar) {
  bar.innerHTML = "";
  const titleEl = document.createElement("div");
  titleEl.className = "agent-pending-title";
  titleEl.textContent = q.title;
  bar.appendChild(titleEl);
  const buttons = document.createElement("div");
  buttons.className = "agent-choice-buttons";
  const note = () => (pendingInputEl ? pendingInputEl.value.trim() : "");
  const yes = document.createElement("button");
  yes.className = "agent-choice-btn agent-choice-yes";
  yes.textContent = "✓ Oui";
  yes.addEventListener("click", () => { q.confirmed = true; validatePendingQuestion(note()); });
  const no = document.createElement("button");
  no.className = "agent-choice-btn agent-choice-no";
  no.textContent = "✗ Non";
  no.addEventListener("click", () => { q.confirmed = false; validatePendingQuestion(note()); });
  buttons.appendChild(yes);
  buttons.appendChild(no);
  bar.appendChild(buttons);
}

/** Rend la rangée Valider / Annuler pour une demande de saisie libre. */
function renderInputPendingBar(q, bar) {
  bar.innerHTML = "";
  const titleEl = document.createElement("div");
  titleEl.className = "agent-pending-title";
  titleEl.textContent = q.title;
  bar.appendChild(titleEl);
  const buttons = document.createElement("div");
  buttons.className = "agent-choice-buttons";
  const ok = document.createElement("button");
  ok.className = "agent-choice-btn agent-choice-validate";
  ok.textContent = "✓ Valider";
  ok.addEventListener("click", () => validatePendingQuestion(pendingInputEl ? pendingInputEl.value.trim() : ""));
  const cancel = document.createElement("button");
  cancel.className = "agent-choice-btn agent-choice-cancel";
  cancel.textContent = "Annuler";
  cancel.addEventListener("click", () => {
    const active = pendingQuestions[0];
    if (active) active.submit("", true);
  });
  buttons.appendChild(ok);
  buttons.appendChild(cancel);
  bar.appendChild(buttons);
}

/** Rend des boutons de choix (unique ou multi). La rangée interactive vit dans
 * #pendingBar (sous la barre de saisie) ; le fil reçoit un bandeau informatif.
 * @param {Function} responder - (id, value, cancelled) => Promise ; par défaut
 *   envoie au super-agent, sinon (relais) route vers la session agent ciblée.
 * @param {HTMLElement|null} targetOverride - cible d'attache (sinon auto). */
function renderSuperAgentChoice(messagesEl, state, id, title, options, multi, responder = respondSuperAgent, targetOverride = null) {
  const target = targetOverride || getSuperAgentAttachTarget(messagesEl, state);
  // Bandeau informatif en lecture seule dans le fil.
  target.appendChild(makeChoiceBanner(title, ""));
  const q = {
    id, title, responder, multi,
    options: options.slice(),
    selected: multi ? new Set() : null,
    placeholder: PENDING_NOTE_PLACEHOLDER,
  };
  q.render = (bar) => renderChoicePendingBar(q, bar);
  q.submit = async (note, cancelled) => {
    let value;
    if (cancelled) value = null;
    else if (q.multi) value = JSON.stringify({ selected: [...q.selected], note });
    else value = JSON.stringify({ selected: q.selected, note });
    await finishPendingQuestion(q, value, cancelled);
  };
  enqueuePendingQuestion(q);
  // Bug 2 (UX) : scroll intelligent (respecte la distinction « utilisateur a
  // remonté pour relire ») — ne force le bas que si l'utilisateur était en bas.
  scrollSuperToBottom(messagesEl);
}

/** Rend des boutons Oui / Non. La rangée interactive vit dans #pendingBar.
 * @param {Function} responder - (id, value, cancelled) => Promise */
function renderSuperAgentConfirm(messagesEl, state, id, title, message, responder = respondSuperAgent, targetOverride = null) {
  const target = targetOverride || getSuperAgentAttachTarget(messagesEl, state);
  target.appendChild(makeChoiceBanner(title, message));
  const q = {
    id, title, responder, confirmed: true, message,
    placeholder: PENDING_NOTE_PLACEHOLDER,
  };
  q.render = (bar) => renderConfirmPendingBar(q, bar);
  q.submit = async (note, cancelled) => {
    let value;
    if (cancelled) value = null;
    else value = JSON.stringify({ confirmed: q.confirmed, note });
    await finishPendingQuestion(q, value, cancelled);
  };
  enqueuePendingQuestion(q);
  // Bug 2 (UX) : scroll intelligent (respecte la distinction « utilisateur a
  // remonté pour relire ») — ne force le bas que si l'utilisateur était en bas.
  scrollSuperToBottom(messagesEl);
}

/** Rend une demande de saisie libre. La réponse est tapée dans la barre
 * principale ; la rangée Valider / Annuler vit dans #pendingBar.
 * @param {Function} responder - (id, value, cancelled) => Promise */
function renderSuperAgentInput(messagesEl, state, id, title, placeholder, responder = respondSuperAgent, targetOverride = null) {
  const target = targetOverride || getSuperAgentAttachTarget(messagesEl, state);
  target.appendChild(makeChoiceBanner(title, ""));
  const q = {
    id, title, responder,
    placeholder: placeholder || PENDING_NOTE_PLACEHOLDER,
  };
  q.render = (bar) => renderInputPendingBar(q, bar);
  q.submit = async (note, cancelled) => {
    if (cancelled) await finishPendingQuestion(q, null, true);
    else await finishPendingQuestion(q, note, false);
  };
  enqueuePendingQuestion(q);
  // Focus la barre principale, prête à saisir la réponse.
  if (pendingInputEl) setTimeout(() => pendingInputEl.focus(), 0);
  // Bug 2 (UX) : scroll intelligent (respecte la distinction « utilisateur a
  // remonté pour relire ») — ne force le bas que si l'utilisateur était en bas.
  scrollSuperToBottom(messagesEl);
}

// ── Initialisation du suivi du projet actif ──

/**
 * Injecte un résumé de session au super-agent (apprentissage en continu).
 * Appelé à l'agent_end du chat standard. Fire-and-forget.
 * @param {string} summary - résumé de la session (dernier échange).
 * @param {string} [projectPath] - chemin du projet actif.
 */
// ── Alerte d'échec d'injection (T6) ──
// Avertit l'utilisateur (⚠️) UNIQUEMENT en cas de statut "error" lors de
// l'injection d'un compte-rendu à l'assistant. Les cas "queued" restent
// silencieux : ils sont couverts par le rejeu à la réouverture de l'onglet.
// Debounce anti-spam : au plus 1 affichage / 60 s par catégorie.
const injectionWarnLast = {}; // catégorie → timestamp (ms)
const INJECTION_WARN_MIN_INTERVAL = 60_000;
let superWarnMessagesEl = null; // défini par createSuperAgent

// ── REÇU VISIBLE d'un compte rendu remis (C1 du diagnostic du 2026-10-26) ──
// Un compte rendu pouvait être écrit en base, remis, LU et exploité sans que
// RIEN ne l'affiche : la seule surface était le texte libre du modèle, qu'un
// tour d'outils peut terminer sans un mot. Chaque remise affiche donc
// maintenant une BULLE de reçu dans la CONVERSATION (contenu, jamais un repère
// d'onglet : aucune pastille, aucun badge).
// Reçus produits alors que la conversation n'est pas montée (onglet 🧭 jamais
// ouvert) : gardés en mémoire et affichés dès sa création. Le texte affiché est
// toujours le texte RÉELLEMENT remis (aucune réécriture du compte rendu).
const pendingReportReceipts = [];

/**
 * Affiche la bulle de reçu d'un compte rendu remis (titre + projet/taille/statut
 * + texte replié). Le texte n'est jamais réécrit : seule sa lecture est bornée
 * (`super-agent-receipt.js`, `REPORT_RECEIPT_FOLD_MAX`).
 * @param {HTMLElement|null} messagesEl - conversation de l'assistant.
 * @param {object|null} receipt - reçu construit (module pur).
 * @returns {boolean} vrai si la bulle est affichée.
 */
function appendReportReceipt(messagesEl, receipt) {
  if (!receipt) return false;
  if (!messagesEl) {
    pendingReportReceipts.push(receipt);
    return false;
  }
  const el = document.createElement("div");
  el.className = "agent-message agent-message-system agent-message-receipt";
  const head = document.createElement("div");
  head.className = "agent-receipt-title";
  head.textContent = receipt.title;
  const meta = document.createElement("div");
  meta.className = "agent-receipt-meta";
  meta.textContent = receipt.meta;
  el.appendChild(head);
  el.appendChild(meta);
  // Texte REPLIÉ : fermé par défaut (on ne submerge pas la conversation),
  // ouvrable d'un clic. `<details>` natif : aucune dépendance, accessible.
  if (receipt.shown) {
    const details = document.createElement("details");
    details.className = "agent-receipt-details";
    const summaryEl = document.createElement("summary");
    summaryEl.textContent = receipt.truncated ? "Ouvrir le texte reçu (extrait)" : "Ouvrir le texte reçu";
    const pre = document.createElement("pre");
    pre.className = "agent-receipt-text";
    pre.textContent = receipt.shown;
    details.appendChild(summaryEl);
    details.appendChild(pre);
    el.appendChild(details);
  }
  messagesEl.appendChild(el);
  scrollSuperToBottom(messagesEl);
  return true;
}

/** Affiche les reçus mis en attente faute de conversation montée. */
function flushPendingReportReceipts() {
  if (!superWarnMessagesEl || pendingReportReceipts.length === 0) return;
  const pending = pendingReportReceipts.splice(0, pendingReportReceipts.length);
  for (const receipt of pending) appendReportReceipt(superWarnMessagesEl, receipt);
}

function warnInjectionFailure(status, detail, category) {
  if (status !== "error") return;
  const now = Date.now();
  const last = injectionWarnLast[category] || 0;
  if (now - last < INJECTION_WARN_MIN_INTERVAL) return;
  injectionWarnLast[category] = now;
  const text = `⚠️ Échec d'injection d'un compte-rendu à l'assistant : ${String(detail || "erreur inconnue")}`;
  console.warn(text);
  if (superWarnMessagesEl) {
    appendSystemMessage(superWarnMessagesEl, text);
  } else {
    // Refonte des messages Telegram : événement INTERNE (le compte-rendu sera
    // rejoué), aucune décision attendue du propriétaire → rien sur Telegram.
    notifySuperAgentDone({ title: "Pilot — Assistant", body: text, telegram: false }).catch(() => {});
  }
}

export async function flushPendingSuperAgentReports() {
  return superAgentReportGate.flush();
}

/**
 * Remise RÉELLE d'un compte rendu à l'assistant (invoke `inject_session_summary`).
 * Appelée par la porte `superAgentReportGate` à CHAQUE compte rendu (durable).
 * `opts.defer` (assistant occupé) : la ligne est écrite en base mais l'injection
 * immédiate n'est pas tentée → `delivered=0`, rejouée plus tard. Le marqueur de
 * délégation éventuel est consommé ICI : son texte est figé dans le compte rendu
 * (donc persisté en base) et n'est jamais perdu, même en remise différée.
 * @param {{summary: string, projectPath: string|null, category: string, delegation?: object|null}} entry
 * @param {{defer?: boolean}} [opts]
 * @returns {Promise<unknown>} résultat de `inject_session_summary`.
 */
async function sendSuperAgentReport(entry, opts = {}) {
  let summary = entry.summary;
  if (entry.delegation) {
    const del = entry.delegation;
    // Consommer le marqueur AU MOMENT de la remise (et seulement si c'est
    // toujours le même marqueur : une délégation plus récente ne doit pas être
    // écrasée par une remise tardive). Le texte du marqueur est inclus dans le
    // compte rendu, donc persisté en base même si la remise est différée.
    const delState = delegationStates.get(projectKey(del.projectPath));
    if (delState && delState.pending === del) delState.pending = null;
    const marker =
      `[Tâche déléguée terminée] Demande transmise à l'agent du projet ${del.projectPath || ""} : ${del.request}\n`;
    summary = marker + summary;
    // Issue #16 : tâche déléguée terminée → notification native (si activée).
    // Refonte des messages Telegram : message de FIN du projet CONCERNÉ (un
    // message = un projet) — nom court en tête, verdict « livré », aucune
    // information d'étape, aucun chemin de fichier.
    notifySuperAgentDone({
      title: "Pilot — Assistant",
      body: `✅ Tâche déléguée terminée (projet « ${del.projectPath || "inconnu"} »). L'agent a répondu à la demande transmise.`,
      project: del.projectPath || "",
      ok: true,
    }).catch(() => {});
    // Son « fin » : tâche d'agent terminée (si le son est activé). ARMÉ et non
    // joué ici : le compte rendu va lancer un tour de l'Assistant dont le texte
    // s'affiche en streaming — le son doit attendre la fin réelle de ce rendu.
    armDoneSound("fin");
  }
  const res = await invoke("inject_session_summary", {
    projectPath: entry.projectPath || null,
    sessionId: null,
    summary,
    defer: !!opts.defer,
  });
  warnInjectionFailure(res && res.status, res && res.detail, entry.category || "session");
  // Compte rendu remis IMMÉDIATEMENT (statut « delivered ») : c'est ce prompt qui
  // déclenche le tour suivant, et le projet concerné est celui du compte rendu
  // (connu ici) — sans quoi la réponse de l'Assistant retomberait sur le projet
  // affiché à l'écran, souvent sans rapport avec la tâche dont il rend compte.
  // Consommé par la première bulle du tour, remis à null en fin de tour (onEnd).
  if (!opts.defer && res && res.status === "delivered") {
    const reportProjectName = pathTailName(entry.projectPath);
    currentTurnProjectBadges = reportProjectName ? [reportProjectName] : null;
  }
  // INVARIANT : un compte rendu remis laisse TOUJOURS une trace visible, quel
  // que soit ce que le modèle décide d'écrire (un tour d'outils peut n'avoir
  // aucun texte). Sans cela, un rapport peut être remis, lu et exploité sans que
  // le propriétaire puisse constater son arrivée (défaut du 2026-10-26, mission
  // #3). L'appel est INCONDITIONNEL : les trois statuts (delivered/queued/error)
  // produisent une bulle, avec le statut réel.
  deliverReportReceipt(entry, res, {
    summary,
    projectName: pathTailName(entry.projectPath),
    append: (receipt) => appendReportReceipt(superWarnMessagesEl, receipt),
  });
  return res;
}

/**
 * Remet à la conversation de l'Assistant un message VENU DE L'EXTÉRIEUR (étape 2
 * Telegram : message écrit par le propriétaire à son bot). Passe par la MÊME
 * porte durable que les comptes rendus d'agents : `inject_session_summary`
 * écrit TOUJOURS la ligne en base (`delivered=0`) avant toute tentative
 * d'injection, puis le rejeu Rust la délivre dès que l'assistant est libre —
 * aucun message n'est perdu si l'assistant est occupé ou absent.
 *
 * Volontairement SANS effet de bord sur les délégations (à la différence de
 * `injectSessionSummaryToSuperAgent`) : un message entrant n'est pas un retour
 * de tâche.
 * @param {string} text - texte du message reçu.
 * @returns {Promise<unknown>}
 */
export async function injectExternalMessageToSuperAgent(text) {
  // DÉFAUT 1 (relecture) — Telegram : le propriétaire a LUI-MÊME écrit. Ce
  // message n'entre pas par `do_send_super_agent_prompt`, donc le signal unique
  // émis là-bas ne passe pas ici : on marque le MÊME drapeau (jamais un second),
  // sinon les relances resteraient retenues alors que le propriétaire a écrit.
  ownerEngagedThisSession = true;
  await superAgentReportGate.deliver({
    summary: text,
    projectPath: null,
    category: "telegram",
  });
}

/**
 * File d'attente de la porte : rejoue un compte rendu en attente dès que
 * l'assistant est libre (appelée à la fin de tour et par le poll d'état).
 * @returns {Promise<unknown>}
 */
export async function injectSessionSummaryToSuperAgent(summary, projectPath, opts = {}) {
  // Issue #47 : si une délégation est en attente (delegate_to_coder), le résumé
  // sera marqué comme feedback de tâche déléguée pour que l'assistant mette à
  // jour son suivi. Le marqueur n'est PAS consommé ici : il l'est à la livraison
  // réelle (sendSuperAgentReport), pour ne pas le perdre si le compte rendu est
  // mis en attente (assistant occupé).
  // P0-4 : borne la taille du résumé avant injection.
  const projectDelegationState = delegationStates.get(projectKey(projectPath));
  const entry = {
    summary,
    projectPath: projectPath || null,
    category: "session",
    delegation: projectDelegationState ? projectDelegationState.pending : null,
  };
  // Garde de curation (fil de mémoire) : l'appelant signale une entrée sans
  // valeur via `opts.remember = false` (filtre) ; elle n'est alors pas remise,
  // donc pas mémorisée. EXCEPTION ABSOLUE : si un feedback de délégation attend
  // d'être remis, la remise est faite même sans valeur — le compte rendu de fin
  // de tâche déléguée (marqueur « [Tâche déléguée terminée] ») n'est jamais
  // perdu. Sans `opts.remember` (chat standard, déjà filtré en amont), le
  // comportement reste inchangé.
  if (shouldDeliverAgentReport(opts.remember, { delegationPending: !!entry.delegation })) {
    await superAgentReportGate.deliver(entry);
  }
  // Issue #66 : l'agent a terminé sa tâche — vider la file des délégations
  // en attente (transmettre la demande suivante mise en file, s'il y en a).
  // Appelé aussi bien pour l'agent_end visible (agent-pi.js) que pour l'agent
  // invisible (finalizeInvisibleAgent appelle cette même fonction). Toujours
  // exécuté, indépendamment du filtre de mémorisation ci-dessus.
  flushDelegationQueue(projectPath);
}

/**
 * Injecte un message d'une run d'agents (`run_agents`) à l'assistant, pour
 * consignation dans son suivi (base clients/projets/tâches) via
 * `inject_session_summary`. Non bloquante. Distinct de
 * `injectSessionSummaryToSuperAgent` : pas de marqueur de délégation ni de
 * flush de la file — c'est un retour de run d'agents, pas une délégation
 * `delegate_to_coder`.
 *
 * T7 : cette primitive injecte un message SANS déclencher de notification
 * desktop ni de son (elle sert aussi bien aux POINTS D'AVANCEMENT qu'aux FINS
 * de run — la distinction est faite à l'appel). Pour une fin de tâche (avec
 * notification + son), utiliser `finishRunAgentsToSuperAgent`.
 * @param {string} result - texte agrégé de la run (ou message d'échec/info).
 * @param {string|null} projectPath - chemin du projet actif.
 * @param {{remember?:boolean, identity?:{id?:number, agentIds?:string[]}|null}} [opts]
 */
// Exporté pour PROUVER la RÈGLE 4 de bout en bout : le compte rendu livré est
// étiqueté avec l'identité de SA mission (numéro + agents), jamais celle d'une
// autre demande (voir `file-attente-regle-4.test.js`).
export async function injectRunAgentsResultToSuperAgent(result, projectPath, opts = {}) {
  // Garde de curation (fil de mémoire) : un point d'avancement protocolaire
  // (« [Info run_agents] … » : mise en file, démarrage ▶️, arrêt auto ⏱️)
  // n'apporte aucun fait réutilisable → non mémorisé. Une FIN de run force la
  // remise (`{ remember: true }`, voir `finishRunAgentsToSuperAgent`) : un
  // résultat de run (ou un échec de run) n'est jamais filtré.
  const memorable = opts.remember === true || shouldRememberAgentReport(result);
  if (!shouldDeliverAgentReport(memorable)) return;
  // P0-4 : borne la taille du compte-rendu agrégé (ne pas encombrer le contexte
  // de l'assistant). Porte d'accusé de lecture via superAgentReportGate.
  // RÈGLE 4 : le compte rendu est ÉTIQUETÉ avec l'identité de la mission qui l'a
  // produit (numéro monotone + agents visés). Un rapport rejoué depuis la file
  // s'annonce donc avec SA demande — impossible de l'attribuer à une autre.
  await superAgentReportGate.deliver({
    summary: annotateMissionReport(buildRunAgentsSummary(result), opts.identity),
    projectPath: projectPath || null,
    category: "runagents",
  });
}

/**
 * Fin de tâche d'une run d'agents délégués (T7, §3.6).
 *
 * Quand une run se termine (succès ou échec), l'assistant est prévenu par
 * événement : (a) compte-rendu injecté pour consignation dans son suivi,
 * (b) notification desktop native (réglage `notify_super_agent_done`) et
 * (c) son de fin configuré (`assistant_sound_enabled`).
 *
 * `ok=true` → succès ; `ok=false` → échec (la notification l'indique).
 * @param {string} result - compte-rendu de fin (résultat ou message d'échec).
 * @param {string|null} projectPath - chemin du projet actif.
 * @param {boolean} ok - true si la run a abouti.
 * @param {{id?:number, agentIds?:string[]}|null} [identity] - RÈGLE 4 : identité
 *   de la mission (numéro monotone + agents visés), jointe au compte rendu.
 */
// Exporté pour PROUVER la RÈGLE 4 de bout en bout : c'est LE chemin de
// production d'un compte rendu de fin de run (annotation de l'identité de
// mission comprise). Un test doit passer par lui, avec l'identité réellement
// allouée, plutôt que d'appeler l'annotation avec une constante de fixture.
export async function finishRunAgentsToSuperAgent(result, projectPath, ok, identity = null) {
  // Issue #87 (2ᵉ moitié) : le groupe parallèle du bus signale sa fin par
  // « done » MÊME quand un agent a échoué (statut « error » agrégé dans le
  // texte). Une run dont un agent a échoué est donc un ÉCHEC, jamais un succès.
  const effectiveOk = ok === true && !runAgentsResultFailed(result);
  // Avis de fin (notification desktop si `notify_super_agent_done`, son si
  // `assistant_sound_enabled`) émis EN PREMIER et une seule fois, puis
  // consignation dans le suivi (fail-open, cf. `emitRunAgentsFinishNotice`).
  await emitRunAgentsFinishNotice({
    ok: effectiveOk,
    projectPath,
    result,
    notify: notifySuperAgentDone,
    // Fin de run : son ARMÉ (pas joué) — il partira à la fin de l'affichage du
    // compte rendu injecté à l'assistant (cf. `armDoneSound`).
    playSound: armDoneSound,
    consign: (r) => injectRunAgentsResultToSuperAgent(r, projectPath, { remember: true, identity }),
  });
  return effectiveOk;
}

export async function initializeSuperAgent(messagesEl) {
  try {
    const active = await invoke("get_active_project");
    if (!active) {
      appendSystemMessage(messagesEl, "⚠️ Aucun projet actif. Ouvrez un projet puis réessayez.");
      return;
    }
    appendSystemMessage(messagesEl, `🔍 Initialisation du suivi du projet « ${active} »…`);
    await invoke("initialize_super_agent", { projectPath: active });
  } catch (err) {
    appendSystemMessage(messagesEl, `❌ ${err}`);
  }
}

// ── Projets & clients (association projet → client) ──

/**
 * Affiche un panneau dans le chat listant les projets connus avec un sélecteur
 * de client pour chacun. Le changement de client appelle `set_project_client`
 * (persisté dans la config).
 */
async function showProjectsPanel(messagesEl, state) {
  let projects = [];
  let clients = [];
  try {
    const res = await invoke("list_super_agent_projects");
    projects = (res && res.projects) || [];
  } catch (e) {
    appendSystemMessage(messagesEl, `❌ Impossible de lister les projets : ${e}`);
    return;
  }
  try {
    const res = await invoke("list_clients");
    clients = (res && res.clients) || [];
  } catch (_) {}

  const target = getSuperAgentAttachTarget(messagesEl, state);
  const wrapper = document.createElement("div");
  wrapper.className = "agent-choice superagent-projects";
  const titleEl = document.createElement("div");
  titleEl.className = "agent-choice-title";
  titleEl.textContent = "Projets & clients";
  wrapper.appendChild(titleEl);

  // ── Nouveau client (issue #38) : créer un client sans passer par les
  // Paramètres. Le bouton appelle `add_client` (persisté dans la config) puis
  // ré-affiche le panneau pour que le nouveau client soit disponible dans les
  // sélecteurs.
  const newClientRow = document.createElement("div");
  newClientRow.className = "superagent-new-client";
  const newClientInput = document.createElement("input");
  newClientInput.type = "text";
  newClientInput.className = "agent-choice-input";
  newClientInput.placeholder = "Nom du nouveau client…";
  newClientInput.maxLength = 120;
  const addClientBtn = document.createElement("button");
  addClientBtn.className = "agent-choice-btn agent-choice-validate";
  addClientBtn.textContent = "+ Ajouter un client";
  const addClient = async () => {
    const name = newClientInput.value.trim();
    if (!name) return;
    if (clients.some((c) => c.name === name)) {
      appendSystemMessage(messagesEl, `ℹ️ Le client « ${name} » existe déjà.`);
      return;
    }
    addClientBtn.disabled = true;
    newClientInput.disabled = true;
    try {
      await invoke("add_client", { name });
      appendSystemMessage(messagesEl, `✅ Client « ${name} » ajouté.`);
      // Ré-afficher le panneau pour refléter le nouveau client.
      wrapper.remove();
      await showProjectsPanel(messagesEl, state);
    } catch (e) {
      appendSystemMessage(messagesEl, `❌ Impossible d'ajouter le client : ${e}`);
      addClientBtn.disabled = false;
      newClientInput.disabled = false;
    }
  };
  addClientBtn.addEventListener("click", addClient);
  newClientInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addClient();
  });
  newClientRow.appendChild(newClientInput);
  newClientRow.appendChild(addClientBtn);
  wrapper.appendChild(newClientRow);

  if (projects.length === 0) {
    const empty = document.createElement("div");
    empty.className = "agent-choice-message";
    empty.textContent = "Aucun projet suivi pour l'instant. Ouvrez un projet puis cliquez sur ✨ (Initialiser) pour démarrer le suivi.";
    wrapper.appendChild(empty);
    target.appendChild(wrapper);
    scrollSuperToBottom(messagesEl);
    return;
  }

  const list = document.createElement("div");
  list.className = "superagent-project-list";
  for (const p of projects) {
    const path = p.path || "";
    const name = p.name || path.split(/[\\/]/).pop() || path;
    const row = document.createElement("div");
    row.className = "superagent-project-row";
    const nameEl = document.createElement("div");
    nameEl.className = "superagent-project-name";
    nameEl.textContent = name;
    nameEl.title = path;
    const select = document.createElement("select");
    select.className = "superagent-project-client";
    const noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = "— Aucun client —";
    select.appendChild(noneOpt);
    for (const c of clients) {
      const opt = document.createElement("option");
      opt.value = c.name || "";
      opt.textContent = c.name || "";
      select.appendChild(opt);
    }
    select.value = p.client || "";
    select.addEventListener("change", async () => {
      const val = select.value;
      try {
        await invoke("set_project_client", { projectPath: path, client: val || null });
        appendSystemMessage(messagesEl, val
          ? `✅ Projet « ${name} » associé au client « ${val} ».`
          : `ℹ️ Projet « ${name} » détaché de tout client.`);
      } catch (e) {
        appendSystemMessage(messagesEl, `❌ Impossible d'associer le client : ${e}`);
      }
    });
    row.appendChild(nameEl);
    row.appendChild(select);
    list.appendChild(row);
  }
  wrapper.appendChild(list);
  target.appendChild(wrapper);
  scrollSuperToBottom(messagesEl);
}
