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
import { agentDisplayLabel, backendKind } from "./backend-info.js";
import { appendDelegatedMessage } from "./agent-pi.js";
import {
  detectRepeatedBlock,
  detectRepeatedWord,
  detectRepeatedToolCalls,
  detectSemanticLoop,
} from "./loop-detection.js";
import { notifySuperAgentDone } from "./desktop-notify.js";
import { loadAgentRegistry, saveAgentRegistry, normalizeAgent, validateAgentId } from "./agents.js";
import { runAgentsForAssistant } from "./agents-bus.js";

const SUPERAGENT_CHANNEL = "rpc-event-superagent";

// 4.1 (R3) : id de l'agent standard du projet dans le registre (base `agents`).
// Utilisé UNIQUEMENT pour RÉSOUDRE l'objet cible d'une délégation (get_agent).
// Jamais utilisé comme cible directe d'envoi/arrêt : toute délégation utilise
// l'id résolu depuis l'objet (resolveDelegationAgentId), aligné sur la vue
// affichée (règle de cohérence ecrans.md).
const DEFAULT_AGENT_ID = "default";

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

/** Scroll intelligent : ne force le bas que si l'utilisateur est déjà en bas. */
function scrollSuperToBottom(messagesEl) {
  if (!messagesEl) return;
  if (messagesEl.scrollTop + messagesEl.clientHeight >= messagesEl.scrollHeight - SUPER_SCROLL_BOTTOM_THRESHOLD) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

/** État global de l'assistant (nom, clients, prompt, options) — cache sync. */
let configCache = { name: "Assistant", clients: [], project_client: {}, prompt: "", show_thinking: true, show_tools: false };

// Issue #47 : délégation en attente de feedback. Quand l'assistant délègue une
// tâche à l'agent d'un projet (delegate_to_coder), on mémorise la demande ici.
// À l'agent_end du chat standard, le résumé injecté au super-agent inclut le
// contexte de délégation (demande + résultat) pour que l'assistant mette à jour
// son suivi et décide des prochaines étapes. Puis on vide le tracker.
let pendingDelegation = null;

/** Recharge la config (nom, clients, prompt, options) depuis Rust. */
export async function refreshSuperAgentConfig() {
  try {
    configCache = await invoke("get_super_agent_config");
  } catch (_) {
    configCache = { name: "Assistant", clients: [], project_client: {}, prompt: "", show_thinking: true, show_tools: false };
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

// État de streaming partagé entre createSuperAgent et handleSuperAgentEvent
// (module scope : handleSuperAgentEvent y accède directement). Même structure
// de rendu que l'agent standard (agent-pi.js) : bloc assistant + flux
// chronologique (sections texte / pensée / outils) — voir issue #43.
let currentBody = null;      // élément `.agent-message-assistant` du tour courant
let currentFlow = null;      // sous-élément `.agent-stream-flow`
let currentTextSection = null; // section texte non fermée
let currentThinkingBlock = null; // bloc pensée courant
let pendingText = "";
let pendingRender = false;
let lastAssistantRawText = "";
let superShowThinking = true; // réglage « Afficher la réflexion » (issue #43)
let superShowTools = false;   // réglage « Afficher les outils » (issue #43)

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
let invisibleAgent = null; // { agentId, projectPath, messagesEl, banner, unlisten }
const INVISIBLE_LOOP_CHECK_INTERVAL_MS = 500;
const INVISIBLE_LOOP_BUFFER_MIN = 200;

// Recharger les options de rendu depuis la config cache.
function refreshSuperRenderOptions() {
  superShowThinking = configCache.show_thinking !== false;
  superShowTools = configCache.show_tools === true;
}

// ── Rendu de messages (même structure DOM que l'agent standard agent-pi.js) ──

/** Crée un bloc message assistant avec flux chronologique (comme agent-pi). */
function createSuperAgentBlock(messagesEl) {
  const el = document.createElement("div");
  el.className = "agent-message agent-message-assistant";
  const bubble = document.createElement("div");
  bubble.className = "agent-bubble agent-bubble-assistant";
  const flow = document.createElement("div");
  flow.className = "agent-stream-flow";
  bubble.appendChild(flow);
  el.appendChild(bubble);
  messagesEl.appendChild(el);
  scrollSuperToBottom(messagesEl);
  return el;
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
  const el = document.createElement("div");
  el.className = "agent-message agent-message-system";
  el.textContent = text;
  messagesEl.appendChild(el);
  scrollSuperToBottom(messagesEl);
}

// ── Création de l'interface ──

export async function createSuperAgent(container) {
  await refreshSuperAgentConfig();

  // Rafraîchir le nom de l'onglet quand la config change (paramètres ⚙️).
  window.addEventListener("pilot-config-changed", () => {
    refreshSuperAgentConfig().then(() => {
      const tabs = window._pilotTabs;
      if (tabs && typeof tabs.updateSuperAgentLabel === "function") {
        tabs.updateSuperAgentLabel(superAgentDisplayLabel());
      }
    });
  });

  const wrapper = document.createElement("div");
  wrapper.className = "agent-chat-container superagent-wrapper";

  // Zone des messages
  const messagesEl = document.createElement("div");
  messagesEl.className = "agent-chat-messages";
  wrapper.appendChild(messagesEl);

  // Barre d'outils
  const toolbar = document.createElement("div");
  toolbar.className = "agent-chat-toolbar superagent-toolbar";
  toolbar.innerHTML = `
    <button class="agent-btn" data-action="abort" title="Arrêter"><i data-lucide="square" class="icon-sm"></i></button>
    <button class="agent-btn" data-action="new-session" title="Nouvelle session"><i data-lucide="plus" class="icon-sm"></i></button>
    <button class="agent-btn" data-action="initialize" title="Initialiser le suivi du projet actif"><i data-lucide="sparkles" class="icon-sm"></i></button>
    <button class="agent-btn" data-action="projects" title="Projets & clients (associer un projet à un client)"><i data-lucide="building-2" class="icon-sm"></i></button>
    <button class="agent-btn" data-action="config" title="Configurer (nom, clients, prompt)"><i data-lucide="settings" class="icon-sm"></i></button>
    <select class="agent-model-select" id="superagent-model-select" title="Changer de modèle"></select>
    <span class="agent-status" id="superagent-status">Prêt</span>
  `;
  wrapper.appendChild(toolbar);

  // Zone de saisie
  const inputBar = document.createElement("div");
  inputBar.className = "agent-chat-input-bar";
  inputBar.innerHTML = `
    <textarea class="agent-input" id="superagent-input" rows="1" placeholder="Poser une question sur tous les projets… (Entrée pour envoyer)"></textarea>
    <button class="agent-btn agent-mic-btn" data-action="voice" title="Dictée vocale (transcription cloud)" aria-label="Dictée vocale"><i data-lucide="mic" class="icon-sm"></i></button>
    <button class="agent-btn agent-send-btn" data-action="send"><i data-lucide="send-horizontal" class="icon-sm"></i></button>
  `;
  wrapper.appendChild(inputBar);

  container.appendChild(wrapper);
  refreshIcons(wrapper);

  const statusEl = toolbar.querySelector("#superagent-status");
  const inputEl = inputBar.querySelector("#superagent-input");
  const modelSelect = toolbar.querySelector("#superagent-model-select");

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
  try {
    await invoke("start_super_agent_session");
  } catch (err) {
    console.error("Erreur démarrage session super-agent:", err);
  }
  loadModels();

  // État de streaming
  let isStreaming = false;
  // État partagé pour le rendu des questions (boutons pilot-choices).
  const state = { currentAssistantBlock: null };

  // ── Dictée vocale (Web Speech API) — comme l'agent standard ──
  // Transcription navigateur (cloud sur WebView2 Windows). Masqué si
  // SpeechRecognition non supporté. Desktop = secure context.
  const VOICE_LANG = "fr-FR";
  const voiceSupported = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const micBtn = inputBar.querySelector(".agent-mic-btn");
  if (micBtn && !voiceSupported) micBtn.style.display = "none";
  let voiceActive = false;
  let voiceRec = null;

  function stopVoiceInput() {
    // Empêche onresult/onend de réécrire le textarea après l'envoi.
    voiceActive = false;
    if (voiceRec) { try { voiceRec.stop(); } catch (_) {} }
    if (micBtn) micBtn.classList.remove("rec");
  }

  function resizeInput() {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + "px";
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
      const sep = preText && !preText.endsWith(" ") ? " " : "";
      inputEl.value = preText + sep + transcript;
      resizeInput();
    };
    rec.onerror = (ev) => {
      voiceActive = false; voiceRec = null;
      if (micBtn) micBtn.classList.remove("rec");
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        appendSystemMessage(messagesEl, "🎙️ Micro indisponible (" + ev.error + "). Vérifie qu'un micro est branché et autorisé (Réglages Windows → Confidentialité → Micro → applications de bureau). Alternative : web remote (HTTPS) depuis un téléphone ou un autre PC.");
      } else if (ev.error !== "no-speech" && ev.error !== "aborted") {
        appendSystemMessage(messagesEl, "🎙️ Erreur de dictée : " + ev.error);
      }
    };
    rec.onend = () => {
      const wasActive = voiceActive;
      voiceActive = false; voiceRec = null;
      if (micBtn) micBtn.classList.remove("rec");
      if (wasActive) {
        const sep = preText && !preText.endsWith(" ") ? " " : "";
        inputEl.value = preText + sep + finalText;
        resizeInput();
      }
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
        currentBody = null;
        currentFlow = null;
        currentTextSection = null;
        currentThinkingBlock = null;
        pendingText = "";
        pendingRender = false;
        lastAssistantRawText = "";
        state.currentAssistantBlock = null;
        // Issue #55 : fin de tour → reset du buffer de détection de boucle.
        superLoopBuffer = "";
        superLoopToolCalls = [];
        superLoopStopped = false;
      });
    } catch (err) {
      console.error("[rpc-event-superagent] erreur:", err);
    }
  });

  // ── Actions ──
  toolbar.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === "abort") {
      await invoke("abort_super_agent").catch(() => {});
    } else if (action === "new-session") {
      await invoke("new_super_agent_session").catch(() => {});
      messagesEl.innerHTML = "";
      appendSystemMessage(messagesEl, "🆕 Nouvelle session.");
    } else if (action === "initialize") {
      await initializeSuperAgent(messagesEl);
    } else if (action === "projects") {
      await showProjectsPanel(messagesEl, state);
    } else if (action === "config") {
      window.dispatchEvent(new CustomEvent("pilot-open-settings", { detail: { tab: "superagent" } }));
    } else if (action === "voice") {
      toggleVoiceInput();
    }
  });

  // ── Envoi (session persistante : streaming + mémoire de conversation) ──
  async function send() {
    const text = inputEl.value.trim();
    if (!text || isStreaming) return;
    if (voiceActive) stopVoiceInput();
    inputEl.value = "";
    inputEl.style.height = "auto";
    appendMessage(messagesEl, "user", text);
    isStreaming = true;
    statusEl.textContent = "Réfléchit…";
    try {
      await invoke("send_super_agent_prompt", { message: text });
      // La réponse arrive en streaming via le canal rpc-event-superagent
      // (handleSuperAgentEvent). On ne fait rien ici : on attend agent_end.
    } catch (err) {
      appendSystemMessage(messagesEl, `❌ ${err}`);
      isStreaming = false;
      statusEl.textContent = "Prêt";
    }
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

  // Auto-resize
  inputEl.addEventListener("input", () => {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + "px";
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

  const origUnlisten = unlisten;

  return {
    wrapper,
    unlisten: () => {
      origUnlisten();
      unlistenStateChanged();
      window.removeEventListener("pilot-agent-relay-request", onAgentRelayRequest);
      window._pilotSuperAgentOpen = false;
      // Issue #59 : notifier l'agent que l'onglet 🧭 Assistant est fermé.
      window.dispatchEvent(new CustomEvent("pilot-superagent-open-changed"));
    },
  };
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
  if (superLoopBuffer.length < SUPER_LOOP_BUFFER_MIN) return;
  if (
    detectRepeatedBlock(superLoopBuffer) ||
    detectRepeatedWord(superLoopBuffer) ||
    detectSemanticLoop(superLoopBuffer) ||
    detectRepeatedToolCalls(superLoopToolCalls)
  ) {
    superLoopStopped = true;
    console.warn("[loop-detection] boucle détectée sur l'assistant, arrêt");
    appendSystemMessage(
      messagesEl,
      "⚠️ L'assistant a tourné en boucle (répétition du même texte ou des mêmes appels d'outils). Génération arrêtée. Veuillez reformuler votre demande."
    );
    invoke("abort_super_agent").catch((e) =>
      console.error("Erreur abort_super_agent (loop):", e)
    );
  }
}

/**
 * Construit une empreinte compacte d'un tool call pour la détection de boucle
 * (issue #55). Pour bash, la commande est l'essentiel ; sinon on sérialise les
 * arguments de façon stable.
 * @param {string} toolName
 * @param {object} args
 * @returns {string}
 */
function buildToolLoopFingerprint(toolName, args) {
  const a = args || {};
  const command = a.command || a.cmd || "";
  if (command) return "tool::" + toolName + "::" + command;
  const path = a.path || a.file || "";
  if (path) return "tool::" + toolName + "::" + path;
  try {
    return "tool::" + toolName + "::" + JSON.stringify(a);
  } catch (_) {
    return "tool::" + toolName;
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
    if (
      title.startsWith("PILOT_ASSISTANT_DB_QUERY::") ||
      title.startsWith("PILOT_ASSISTANT_DB_EXEC::")
    ) {
      fingerprint = "db::" + title;
    } else {
      fingerprint = "input::" + title;
    }
  } else {
    fingerprint = method + "::" + (payload.title || "");
  }
  superLoopBuffer += fingerprint + "\n";
  maybeDetectSuperAgentLoop(messagesEl);
}

function handleSuperAgentEvent(payload, messagesEl, statusEl, state, onEnd) {
  const type = payload.type;
  if (type === "message_start") {
    const msg = payload.message;
    if (msg && msg.role === "assistant") {
      // Début d'un message assistant streamé : créer un bloc avec flux.
      if (!currentBody) {
        currentBody = createSuperAgentBlock(messagesEl);
        currentFlow = currentBody.querySelector(".agent-stream-flow");
      }
      currentTextSection = null;
      currentThinkingBlock = null;
      pendingText = "";
      pendingRender = false;
      lastAssistantRawText = "";
      // Issue #55 : nouveau message → reset du buffer de détection de boucle.
      superLoopBuffer = "";
      superLoopToolCalls = [];
      superLoopStopped = false;
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
    superLoopToolCalls.push(buildToolLoopFingerprint(toolName, payload.args));
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
      const bubble = currentBody.querySelector(".agent-bubble-assistant");
      const hasText = bubble && bubble.textContent && bubble.textContent.trim().length > 0;
      if (!hasChildren && !hasChoices && !hasText) {
        currentBody.remove();
      }
    }
    onEnd();
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
      }
    }
    return;
  }
  if (type === "agent_start") {
    statusEl.textContent = "Réfléchit…";
    return;
  }
  if (type === "agent_end") {
    statusEl.textContent = "Prêt";
    onEnd();
    return;
  }
  if (type === "extension_ui_request") {
    handleSuperAgentExtensionUiRequest(payload, messagesEl, state);
    return;
  }
  if (type === "process_exit" || type === "process_error") {
    statusEl.textContent = "Déconnecté";
    appendSystemMessage(messagesEl, "⚠️ Connexion au super-agent perdue.");
    // Issue #16 : anomalie de suivi — notifier (si le réglage est activé).
    notifySuperAgentDone({ title: "Pilot — Assistant", body: "⚠️ Connexion au super-agent perdue." }).catch(() => {});
    onEnd();
    return;
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
    const type = payload.notifyType || "info";
    const msg = payload.message || "";
    appendSystemMessage(messagesEl, `ℹ️ [${type}] ${msg}`);
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
    const title = payload.title || "";
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
      // sélectionnés (en parallèle) et renvoie le résultat agrégé comme `value`
      // de la réponse, pour que l'assistant continue son raisonnement.
      let info;
      try {
        info = JSON.parse(title.slice(RUN_AGENTS_SENTINEL.length));
      } catch (_) {
        await respondSuperAgent(id, JSON.stringify({ error: "Payload run_agents invalide." }), false);
        return;
      }
      const agentIds = Array.isArray(info.agent_ids) ? info.agent_ids.map(String) : [];
      const task = String(info.task || "").trim();
      if (agentIds.length === 0 || !task) {
        await respondSuperAgent(id, JSON.stringify({ error: "run_agents : au moins un agent et une tâche requis." }), false);
        return;
      }
      try {
        const registry = await loadAgentRegistry();
        const known = new Set((registry.agents || []).map((a) => a && a.id));
        const missing = agentIds.filter((aid) => !known.has(aid));
        if (missing.length > 0) {
          await respondSuperAgent(id, JSON.stringify({ error: `Agents inconnus : ${missing.join(", ")}.` }), false);
          return;
        }
        appendSystemMessage(messagesEl, `🤖 Je lance la tâche sur les agents : ${agentIds.join(", ")}…`);
        const assignments = agentIds.map((aid) => ({ agentId: aid, brief: task }));
        const result = await runAgentsForAssistant(assignments);
        appendSystemMessage(messagesEl, `✅ Tâche terminée par les agents sélectionnés.`);
        await respondSuperAgent(id, JSON.stringify({ ok: true, result }), false);
      } catch (e) {
        console.error("Erreur run_agents (assistant):", e);
        appendSystemMessage(messagesEl, `❌ Échec de la run agents : ${e}`);
        await respondSuperAgent(id, JSON.stringify({ error: String(e) }), false);
      }
      return;
    }
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
      // Mémoriser le projet sur lequel l'assistant travaille (distinct du projet
      // actif) : si l'utilisateur change ensuite de projet, l'assistant saura
      // qu'il travaillait sur celui-ci et pourra continuer la discussion dessus.
      invoke("set_super_agent_working_project", { path }).catch(() => {});
      appendSystemMessage(messagesEl, `✅ Projet « ${path} » ouvert et rendu actif.`);
      await respondSuperAgentAction(id, true);
    } else if (action === "delegate_to_coder") {
      const request = info.request;
      if (!request) {
        await respondSuperAgentAction(id, false);
        return;
      }
      appendSystemMessage(messagesEl, "🤖 Je lance l'agent du projet et lui transmets la demande…");
      const tabs = window._pilotTabs;
      if (!tabs) {
        appendSystemMessage(messagesEl, "❌ Impossible d'ouvrir l'agent du projet (gestionnaire d'onglets indisponible).");
        await respondSuperAgentAction(id, false);
        return;
      }
      // 4.1 (R3) : résoudre l'agent cible de la délégation depuis l'objet
      // persisté (get_agent) — jamais le littéral "default". Toute la délégation
      // (start invisible, canal d'événements, envoi, arrêt) cible cet id résolu,
      // aligné sur la vue affichée (règle de cohérence ecrans.md).
      const projectPath = window._pilotProjectPath || null;
      const agentId = await resolveDelegationAgentId(projectPath);
      if (!agentId) {
        appendSystemMessage(messagesEl, "❌ Impossible de résoudre l'agent cible de la délégation.");
        await respondSuperAgentAction(id, false);
        return;
      }
      // Évolution 64 : « agent invisible ». Si l'option est activée (défaut),
      // on démarre la session agent en arrière-plan SANS créer d'onglet agent
      // (startAgentInvisible) et on met en place le suivi (bouton Arrêter,
      // détection de boucle, notification de fin). Sinon, comportement actuel :
      // on ouvre l'onglet agent en arrière-plan (openFile sans bascule) pour
      // accéder à sa discussion.
      const invisible = configCache.super_agent_invisible_agent !== false;
      if (invisible) {
        // Démarrer la session agent en arrière-plan sans onglet (agent résolu).
        await tabs.startAgentInvisible(agentId);
        // Mettre en place le suivi de l'agent invisible (bouton Arrêter,
        // détection de boucle, notification de fin de tâche).
        startInvisibleAgentMonitoring(messagesEl, agentId, projectPath, request);
      } else {
        // Issue #49 : ouvrir/démarrer l'agent du projet SANS basculer sur son
        // onglet — on reste sur l'onglet Assistant pour attendre le retour de
        // l'agent (feedback de tâche déléguée, issue #47). `openFile(..., false)`
        // démarre la session en arrière-plan et retourne l'onglet agent (créé ou
        // existant) pour accéder à sa discussion.
        const agentTab = await tabs.openFile("", "agent", false, false);
        // Issue #45 : afficher la demande déléguée dans la discussion de l'agent
        // (à droite, comme un message utilisateur, mais en violet pour montrer
        // qu'elle provient de l'Assistant).
        const agentMessagesEl = agentTab && agentTab.agentElements ? agentTab.agentElements.messagesEl : null;
        if (agentMessagesEl) {
          appendDelegatedMessage(agentMessagesEl, request);
        }
      }
      // Issue #47 : mémoriser la délégation en attente. À l'agent_end, le résumé
      // injecté au super-agent inclura cette demande + le résultat de l'agent,
      // pour que l'assistant mette à jour son suivi et décide des prochaines
      // étapes (boucle de feedback agent → assistant).
      pendingDelegation = {
        request: String(request).slice(0, 500),
        projectPath,
      };
      // Envoyer la demande à l'agent standard (session active du projet).
      // La conversation de l'agent est CONSERVÉE entre les demandes : la purge
      // n'est plus systématique avant chaque délégation. L'Assistant peut purger
      // à la demande via l'outil `purge_agent_conversation` (début de
      // conversation ou arrêt de l'agent).
      // 4.1 : router la demande vers la session de L'agent résolu (équivalent
      // AgentService.send(agent_id, prompt) via send_agent_command_to, une seule
      // indirection par agent_id — plus de dépendance à la session « active »).
      await invoke("send_agent_command_to", {
        project_path: projectPath,
        agentId,
        command: { type: "prompt", message: request },
      });
      appendSystemMessage(messagesEl, "✅ Demande transmise à l'agent du projet (il travaille en arrière-plan, je reste ici pour son retour).");
      await respondSuperAgentAction(id, true);
    } else if (action === "purge_agent_conversation") {
      // Purge à la demande : l'Assistant appelle l'outil `purge_agent_conversation`
      // au début d'une conversation ou quand il faut arrêter l'agent. La commande
      // Rust préserve le modèle actif (new_session + ré-application du modèle).
      try {
        await invoke("purge_agent_conversation");
        appendSystemMessage(messagesEl, "🧹 Conversation de l'agent purgée (modèle actif préservé).");
        await respondSuperAgentAction(id, true);
      } catch (e) {
        console.error("Erreur purge conversation agent (assistant):", e);
        appendSystemMessage(messagesEl, `❌ Purge de la conversation de l'agent échouée : ${e}`);
        await respondSuperAgentAction(id, false);
      }
    } else if (action === "stop_agent") {
      // Arrêter l'agent du projet actif (coupe la session en cours, visible ou
      // invisible). 4.1 : cible l'agent RÉSOLU (pas un littéral) via
      // `stop_agent_session` (qui route vers AgentService.stop). Réutilise le
      // nettoyage du suivi de l'agent invisible s'il était actif.
      try {
        const projectPath = window._pilotProjectPath || null;
        const agentId = await resolveDelegationAgentId(projectPath);
        await invoke("stop_agent_session", { agentId: agentId || null }).catch(() => {});
        // Nettoyer aussi le suivi de l'agent invisible (bandeau + écouteur).
        if (typeof stopInvisibleAgentMonitoring === "function") {
          stopInvisibleAgentMonitoring();
        }
        appendSystemMessage(messagesEl, "🛑 Agent du projet arrêté.");
        await respondSuperAgentAction(id, true);
      } catch (e) {
        console.error("Erreur stop_agent (assistant):", e);
        appendSystemMessage(messagesEl, `❌ Échec de l'arrêt de l'agent : ${e}`);
        await respondSuperAgentAction(id, false);
      }
    } else if (action === "create_agent") {
      // Coordinateur assistant : crée un agent sur mesure dans le registre global
      // (~/.pilot/agents.json) quand les agents disponibles ne conviennent pas.
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
        agents.push(newAgent);
        registry.agents = agents;
        await saveAgentRegistry(registry);
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

// ── Agent invisible : suivi en arrière-plan (évolution 64) ──
//
// Quand l'option « agent invisible » est activée, l'Assistant délègue une
// demande à l'agent SANS créer d'onglet agent. On écoute alors le canal
// d'événements de l'agent en arrière-plan pour : (1) offrir un bouton
// « Arrêter » dans le chat de l'Assistant (coupure à tout moment), (2) détecter
// une boucle de réflexion (loop-detection) et arrêter l'agent automatiquement,
// (3) notifier l'utilisateur et injecter le feedback de délégation à la fin de
// la tâche (agent_end).

/**
 * Démarre le suivi réactif de l'agent invisible (bouton Arrêter + écoute du
 * canal). 4.3 : le bandeau « Arrêter » et la notification de fin sont pilotés
 * par l'état de l'objet (agent-state-changed + lecture get_agent), plus par un
 * état local non persisté. Le buffer de détection de boucle est SCOPÉ au
 * listener (closure), pas une variable de module transitoire.
 * @param {Element} messagesEl
 * @param {string} agentId - id résolu depuis l'objet (4.1).
 * @param {string|null} projectPath
 * @param {string} request - demande déléguée (contexte, pour le suivi).
 */
async function startInvisibleAgentMonitoring(messagesEl, agentId, projectPath, request) {
  // Couper tout suivi précédent (idempotent).
  stopInvisibleAgentMonitoring();

  // Afficher un bandeau de statut avec un bouton « Arrêter » dans le chat.
  const statusEl = document.createElement("div");
  statusEl.className = "agent-invisible-status";
  const label = document.createElement("span");
  label.className = "agent-invisible-label";
  label.textContent = "🤖 Agent en arrière-plan…";
  const stopBtn = document.createElement("button");
  stopBtn.className = "agent-btn agent-invisible-stop";
  stopBtn.textContent = "Arrêter";
  stopBtn.title = "Arrêter l'agent en arrière-plan";
  stopBtn.addEventListener("click", () => {
    stopInvisibleAgent();
  });
  statusEl.appendChild(label);
  statusEl.appendChild(stopBtn);
  messagesEl.appendChild(statusEl);
  scrollSuperToBottom(messagesEl);

  // Buffer de détection de boucle, SCOPÉ au listener (pas de variable de
  // module transitoire — issue #55, 4.3).
  const loop = { buffer: "", lastChecked: 0, stopped: false, toolCalls: [] };

  // Écouter le canal d'événements de l'agent (même canal que l'onglet agent),
  // en utilisant l'id RÉSOLU (4.1).
  let channel = "rpc-event";
  try {
    channel = await invoke("get_agent_event_channel", { agentId });
  } catch (_) {}
  const unlisten = await listen(channel, (event) => {
    try {
      handleInvisibleAgentEvent(event.payload, messagesEl, agentId, projectPath, loop);
    } catch (err) {
      console.error("[agent-invisible] erreur événement:", err);
    }
  });

  invisibleAgent = { agentId, projectPath, messagesEl, banner: statusEl, unlisten };
}

/** Traite un événement du canal de l'agent invisible. */
function handleInvisibleAgentEvent(payload, messagesEl, agentId, projectPath, loop) {
  const type = payload.type;
  if (type === "message_update") {
    const delta = payload.assistantMessageEvent;
    if (!delta) return;
    // Accumuler le flux streamé dans le buffer scpé pour la détection de boucle.
    if (delta.type === "text_delta" && typeof delta.delta === "string") {
      loop.buffer += delta.delta;
      maybeDetectInvisibleAgentLoop(messagesEl, loop, agentId);
    } else if (delta.type === "thinking_delta" && typeof delta.delta === "string") {
      loop.buffer += delta.delta;
      maybeDetectInvisibleAgentLoop(messagesEl, loop, agentId);
    }
    return;
  }
  if (type === "tool_execution_start") {
    // Issue #55 : accumuler une empreinte du tool call (ex: commande bash) pour
    // détecter une boucle d'OUTILS identiques, même sans texte streamé répété.
    const toolName = payload.toolName || payload.tool || "outil";
    loop.toolCalls.push(buildToolLoopFingerprint(toolName, payload.args));
    maybeDetectInvisibleAgentLoop(messagesEl, loop, agentId);
    return;
  }
  if (type === "agent_end") {
    // 4.2/4.3 : fin pilotée par l'état de l'objet. Si l'agent est en
    // Compacting, on N'INJECTE PAS de résumé « tâche non faite » (issue #54) et
    // on garde le suivi (le vrai agent_end post-compaction viendra finaliser).
    checkInvisibleAgentCompletion(messagesEl, agentId, projectPath);
    return;
  }
  if (type === "process_exit" || type === "process_error") {
    finalizeInvisibleAgent(
      messagesEl, agentId, projectPath,
      "⚠️ Connexion à l'agent en arrière-plan perdue."
    );
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

/** Finalise le suivi (idempotent) : nettoie le bandeau, notifie, feedback délégation. */
function finalizeInvisibleAgent(messagesEl, agentId, projectPath, message) {
  // Finaliser une seule fois (l'état de l'objet a déjà basculé).
  if (!invisibleAgent || invisibleAgent.agentId !== agentId) return;
  stopInvisibleAgentMonitoring();
  appendSystemMessage(messagesEl, message);
  // Injecter le feedback de délégation (consomme pendingDelegation → notification).
  injectSessionSummaryToSuperAgent(
    "L'agent a terminé la tâche déléguée en arrière-plan.",
    projectPath
  ).catch(() => {});
}

/** Détection de boucle de réflexion sur l'agent invisible (throttlée). */
function maybeDetectInvisibleAgentLoop(messagesEl, loop, agentId) {
  if (loop.stopped) return; // déjà arrêté pour boucle
  const now = Date.now();
  if (now - loop.lastChecked < INVISIBLE_LOOP_CHECK_INTERVAL_MS) return;
  loop.lastChecked = now;
  if (loop.buffer.length < INVISIBLE_LOOP_BUFFER_MIN) return;
  if (
    detectRepeatedBlock(loop.buffer) ||
    detectRepeatedWord(loop.buffer) ||
    detectSemanticLoop(loop.buffer) ||
    detectRepeatedToolCalls(loop.toolCalls)
  ) {
    loop.stopped = true;
    console.warn(`[loop-detection] boucle détectée sur l'agent invisible ${agentId}, arrêt`);
    appendSystemMessage(
      messagesEl,
      "⚠️ L'agent a tourné en boucle (répétition du même texte ou des mêmes appels d'outils). Agent arrêté."
    );
    stopInvisibleAgent();
  }
}

/**
 * Arrête l'agent invisible (session + suivi). 4.1 : cible l'id RÉSOLU.
 */
function stopInvisibleAgent() {
  const t = invisibleAgent;
  const agentId = t ? t.agentId : null;
  const messagesEl = t ? t.messagesEl : null;
  invoke("stop_agent_session", { agentId: agentId || null }).catch((e) =>
    console.error("Erreur stop_agent_session (agent invisible):", e)
  );
  stopInvisibleAgentMonitoring();
  if (messagesEl) {
    appendSystemMessage(messagesEl, "🛑 Agent en arrière-plan arrêté.");
  }
}

/** Nettoie le suivi de l'agent invisible (unlisten + bandeau). */
function stopInvisibleAgentMonitoring() {
  if (!invisibleAgent) return;
  if (invisibleAgent.unlisten) {
    try { invisibleAgent.unlisten(); } catch (_) {}
  }
  if (invisibleAgent.banner) {
    try { invisibleAgent.banner.remove(); } catch (_) {}
  }
  invisibleAgent = null;
}

/**
 * 4.1 (R3) : résout l'id de l'agent cible d'une délégation depuis l'objet
 * persisté (get_agent), jamais depuis un littéral. Cible l'agent standard du
 * projet (id `default` dans le registre global) — aligné sur la vue affichée.
 * @param {string|null} projectPath
 * @returns {Promise<string|null>}
 */
async function resolveDelegationAgentId(projectPath) {
  try {
    const agent = await invoke("get_agent", { agentId: DEFAULT_AGENT_ID, projectPath: null });
    if (agent && agent.id) return agent.id;
  } catch (_) {}
  // Fallback : agent du projet (per-project) s'il existe.
  try {
    const agent = await invoke("get_agent", { agentId: DEFAULT_AGENT_ID, projectPath: projectPath || null });
    if (agent && agent.id) return agent.id;
  } catch (_) {}
  // Dernier recours : l'onglet agent actuellement affiché.
  const tabs = window._pilotTabs;
  if (tabs && Array.isArray(tabs.tabs)) {
    const agentTab = tabs.tabs.find((t) => t.mode === "agent");
    if (agentTab && agentTab.agentId) return agentTab.agentId;
  }
  return null;
}

/**
 * 4.3 : piloté par l'événement `agent-state-changed` de Rust. Met à jour le
 * bandeau « Arrêter » selon l'état de l'objet et finalise quand l'objet n'est
 * plus actif (Stopped/Error/Unloaded) — plus par un état local transitoire.
 * @param {object} payload - { agentId, projectPath, loaded, busy, procState, visible }.
 */
function handleAgentStateChanged(payload) {
  const t = invisibleAgent;
  if (!t) return;
  if (!payload || payload.agentId !== t.agentId) return;
  const state = payload.procState || payload.state;
  const active =
    payload.visible === false &&
    (state === "Running" || state === "Paused" || state === "Compacting" || !!payload.busy);
  if (active && t.banner && !t.banner.isConnected) {
    // Le bandeau a été retiré (ex: réaffichage) → le re-créer via l'état objet.
    t.messagesEl.appendChild(t.banner);
    scrollSuperToBottom(t.messagesEl);
  }
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

  // Bloc dédié (distinct du flux de l'assistant) : en-tête + widget.
  const block = createSuperAgentBlock(messagesEl);
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
function renderSuperAgentChoice(messagesEl, state, id, title, options, multi, responder = respondSuperAgent, targetOverride = null) {
  const target = targetOverride || getSuperAgentAttachTarget(messagesEl, state);
  const wrapper = document.createElement("div");
  wrapper.className = "agent-choice";
  const titleEl = document.createElement("div");
  titleEl.className = "agent-choice-title";
  titleEl.textContent = title;
  wrapper.appendChild(titleEl);
  const buttons = document.createElement("div");
  buttons.className = "agent-choice-buttons";
  const respond = async (value, cancelled) => {
    const btns = wrapper.querySelectorAll("button");
    btns.forEach((b) => { b.disabled = true; });
    const inputs = wrapper.querySelectorAll(".agent-choice-input");
    inputs.forEach((i) => { i.disabled = true; });
    wrapper.classList.add("resolved");
    await responder(id, value, cancelled);
  };
  if (multi) {
    const selected = new Set();
    options.forEach((opt, i) => {
      const btn = document.createElement("button");
      btn.className = `agent-choice-btn agent-choice-opt-${i % 6}`;
      btn.textContent = opt;
      btn.addEventListener("click", () => {
        if (selected.has(opt)) { selected.delete(opt); btn.classList.remove("selected"); }
        else { selected.add(opt); btn.classList.add("selected"); }
      });
      buttons.appendChild(btn);
    });
    const note = document.createElement("input");
    note.type = "text";
    note.className = "agent-choice-input agent-choice-note";
    note.placeholder = "Ajouter une précision (optionnel)…";
    wrapper.appendChild(note);
    const validate = document.createElement("button");
    validate.className = "agent-choice-btn agent-choice-validate";
    validate.textContent = "✓ Valider";
    validate.addEventListener("click", () =>
      respond(JSON.stringify({ selected: [...selected], note: note.value.trim() }), false));
    buttons.appendChild(validate);
  } else {
    // Choix unique : toggle + Valider — permet de valider SANS choisir d'option
    // (précision libre, issue #39). `selected` = null si aucune option cochée.
    const note = document.createElement("input");
    note.type = "text";
    note.className = "agent-choice-input agent-choice-note";
    note.placeholder = "Ajouter une précision (optionnel)…";
    wrapper.appendChild(note);
    let selectedOpt = null;
    for (const [i, opt] of options.entries()) {
      const btn = document.createElement("button");
      btn.className = `agent-choice-btn agent-choice-opt-${i % 6}`;
      btn.textContent = opt;
      btn.addEventListener("click", () => {
        if (selectedOpt === opt) {
          selectedOpt = null;
          btn.classList.remove("selected");
        } else {
          selectedOpt = opt;
          buttons.querySelectorAll(".selected").forEach((b) => b.classList.remove("selected"));
          btn.classList.add("selected");
        }
      });
      buttons.appendChild(btn);
    }
    const validate = document.createElement("button");
    validate.className = "agent-choice-btn agent-choice-validate";
    validate.textContent = "✓ Valider";
    validate.addEventListener("click", () =>
      respond(JSON.stringify({ selected: selectedOpt, note: note.value.trim() }), false));
    buttons.appendChild(validate);
  }
  wrapper.appendChild(buttons);
  target.appendChild(wrapper);
  scrollSuperToBottom(messagesEl);
}

/** Rend des boutons Oui / Non inline.
 * @param {Function} responder - (id, value, cancelled) => Promise */
function renderSuperAgentConfirm(messagesEl, state, id, title, message, responder = respondSuperAgent, targetOverride = null) {
  const target = targetOverride || getSuperAgentAttachTarget(messagesEl, state);
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
  const buttons = document.createElement("div");
  buttons.className = "agent-choice-buttons";
  const note = document.createElement("input");
  note.type = "text";
  note.className = "agent-choice-input agent-choice-note";
  note.placeholder = "Ajouter une précision (optionnel)…";
  wrapper.appendChild(note);
  const respond = async (confirmed) => {
    const btns = wrapper.querySelectorAll("button");
    btns.forEach((b) => { b.disabled = true; });
    const inputs = wrapper.querySelectorAll(".agent-choice-input");
    inputs.forEach((i) => { i.disabled = true; });
    wrapper.classList.add("resolved");
    await responder(id, JSON.stringify({ confirmed, note: note.value.trim() }), false);
  };
  const yes = document.createElement("button");
  yes.className = "agent-choice-btn agent-choice-yes";
  yes.textContent = "✓ Oui";
  yes.addEventListener("click", () => respond(true));
  const no = document.createElement("button");
  no.className = "agent-choice-btn agent-choice-no";
  no.textContent = "✗ Non";
  no.addEventListener("click", () => respond(false));
  buttons.appendChild(yes);
  buttons.appendChild(no);
  wrapper.appendChild(buttons);
  target.appendChild(wrapper);
  scrollSuperToBottom(messagesEl);
}

/** Rend un champ de saisie inline.
 * @param {Function} responder - (id, value, cancelled) => Promise */
function renderSuperAgentInput(messagesEl, state, id, title, placeholder, responder = respondSuperAgent, targetOverride = null) {
  const target = targetOverride || getSuperAgentAttachTarget(messagesEl, state);
  const wrapper = document.createElement("div");
  wrapper.className = "agent-choice";
  const titleEl = document.createElement("div");
  titleEl.className = "agent-choice-title";
  titleEl.textContent = title;
  wrapper.appendChild(titleEl);
  const input = document.createElement("input");
  input.type = "text";
  input.className = "agent-choice-input";
  input.placeholder = placeholder || "";
  wrapper.appendChild(input);
  const buttons = document.createElement("div");
  buttons.className = "agent-choice-buttons";
  const respond = async (value, cancelled) => {
    const btns = wrapper.querySelectorAll("button");
    btns.forEach((b) => { b.disabled = true; });
    input.disabled = true;
    wrapper.classList.add("resolved");
    await responder(id, value, cancelled);
  };
  const ok = document.createElement("button");
  ok.className = "agent-choice-btn agent-choice-validate";
  ok.textContent = "✓ Valider";
  ok.addEventListener("click", () => respond(input.value, false));
  const cancel = document.createElement("button");
  cancel.className = "agent-choice-btn agent-choice-cancel";
  cancel.textContent = "Annuler";
  cancel.addEventListener("click", () => respond(null, true));
  buttons.appendChild(ok);
  buttons.appendChild(cancel);
  wrapper.appendChild(buttons);
  target.appendChild(wrapper);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") respond(input.value, false);
    if (e.key === "Escape") respond(null, true);
  });
  setTimeout(() => input.focus(), 0);
  scrollSuperToBottom(messagesEl);
}

// ── Initialisation du suivi du projet actif ──

/**
 * Injecte un résumé de session au super-agent (apprentissage en continu).
 * Appelé à l'agent_end du chat standard. Fire-and-forget.
 * @param {string} summary - résumé de la session (dernier échange).
 * @param {string} [projectPath] - chemin du projet actif.
 */
export async function injectSessionSummaryToSuperAgent(summary, projectPath) {
  // Issue #47 : si une délégation est en attente (delegate_to_coder), marquer le
  // résumé comme un feedback de tâche déléguée pour que l'assistant mette à jour
  // son suivi et décide des prochaines étapes. On consomme le tracker (une seule
  // fois) pour ne pas marquer les sessions suivantes.
  let finalSummary = String(summary || "");
  if (pendingDelegation) {
    const del = pendingDelegation;
    pendingDelegation = null;
    const marker =
      `[Tâche déléguée terminée] Demande transmise à l'agent du projet ${del.projectPath || ""} : ${del.request}\n`;
    finalSummary = marker + finalSummary;
    // Issue #16 : tâche déléguée terminée → notification native (si activée).
    notifySuperAgentDone({
      title: "Pilot — Assistant",
      body: `✅ Tâche déléguée terminée (projet « ${del.projectPath || "inconnu"} »). L'agent a répondu à la demande transmise.`,
    }).catch(() => {});
  }
  try {
    await invoke("inject_session_summary", {
      projectPath: projectPath || null,
      sessionId: null,
      summary: finalSummary.slice(0, 2000),
    });
  } catch (_) {
    // Silencieux : le super-agent n'est pas indispensable au chat.
  }
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
