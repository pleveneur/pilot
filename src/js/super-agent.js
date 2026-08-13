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

const SUPERAGENT_CHANNEL = "rpc-event-superagent";

// Rendu Markdown identique à l'agent standard (agent-pi.js).
const md = markdownit({
  html: false,
  linkify: true,
  typographer: true,
  breaks: true,
});

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
  messagesEl.scrollTop = messagesEl.scrollHeight;
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
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return bubble;
}

function appendSystemMessage(messagesEl, text) {
  const el = document.createElement("div");
  el.className = "agent-message agent-message-system";
  el.textContent = text;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
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

  // Auto-resize
  inputEl.addEventListener("input", () => {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + "px";
  });

  appendSystemMessage(messagesEl, `🧭 ${superAgentDisplayLabel()} prêt. Je suis en lecture seule : je suis vos projets (par client) de la demande à la livraison.`);

  return { wrapper, unlisten };
}

// ── Traitement des événements RPC ──

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
      if (!currentTextSection) currentTextSection = appendSuperTextSection("", false);
      if (!pendingRender && currentTextSection) {
        pendingRender = true;
        requestAnimationFrame(() => {
          pendingRender = false;
          if (currentTextSection && pendingText) {
            currentTextSection.innerHTML = md.render(pendingText);
          }
          messagesEl.scrollTop = messagesEl.scrollHeight;
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
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return;
  }
  if (type === "tool_execution_start") {
    const toolName = payload.toolName || payload.tool || "outil";
    if (!currentBody) {
      currentBody = createSuperAgentBlock(messagesEl);
      currentFlow = currentBody.querySelector(".agent-stream-flow");
    }
    appendSuperToolInline("outil", toolName);
    messagesEl.scrollTop = messagesEl.scrollHeight;
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
      // Ouvrir l'onglet agent du projet actif (le rend visible + démarre la
      // session RPC si elle était fermée). Idempotent : si déjà ouvert, bascule.
      await tabs.openFile("", "agent");
      // Issue #45 : afficher la demande déléguée dans la discussion de l'agent
      // (à droite, comme un message utilisateur, mais en violet pour montrer
      // qu'elle provient de l'Assistant). L'onglet agent est maintenant actif et
      // son conteneur de messages est accessible via agentElements.messagesEl.
      const activeTab = tabs.getActiveTab?.();
      const agentMessagesEl = activeTab && activeTab.agentElements ? activeTab.agentElements.messagesEl : null;
      if (agentMessagesEl) {
        appendDelegatedMessage(agentMessagesEl, request);
      }
      // Issue #47 : mémoriser la délégation en attente. À l'agent_end, le résumé
      // injecté au super-agent inclura cette demande + le résultat de l'agent,
      // pour que l'assistant mette à jour son suivi et décide des prochaines
      // étapes (boucle de feedback agent → assistant).
      pendingDelegation = {
        request: String(request).slice(0, 500),
        projectPath: window._pilotProjectPath || null,
      };
      // Envoyer la demande à l'agent standard (session active du projet).
      await invoke("send_agent_prompt", { message: request });
      appendSystemMessage(messagesEl, "✅ Demande transmise à l'agent du projet (son onglet est ouvert).");
      await respondSuperAgentAction(id, true);
    } else {
      await respondSuperAgentAction(id, false);
    }
  } catch (e) {
    console.error("Erreur action assistant:", e);
    appendSystemMessage(messagesEl, `❌ Action échouée : ${e}`);
    await respondSuperAgentAction(id, false);
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

/** Rend des boutons de choix inline (unique ou multi). */
function renderSuperAgentChoice(messagesEl, state, id, title, options, multi) {
  const target = getSuperAgentAttachTarget(messagesEl, state);
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
    await respondSuperAgent(id, value, cancelled);
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
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/** Rend des boutons Oui / Non inline. */
function renderSuperAgentConfirm(messagesEl, state, id, title, message) {
  const target = getSuperAgentAttachTarget(messagesEl, state);
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
    await respondSuperAgent(id, JSON.stringify({ confirmed, note: note.value.trim() }), false);
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
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/** Rend un champ de saisie inline. */
function renderSuperAgentInput(messagesEl, state, id, title, placeholder) {
  const target = getSuperAgentAttachTarget(messagesEl, state);
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
    await respondSuperAgent(id, value, cancelled);
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
  messagesEl.scrollTop = messagesEl.scrollHeight;
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
    messagesEl.scrollTop = messagesEl.scrollHeight;
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
  messagesEl.scrollTop = messagesEl.scrollHeight;
}
