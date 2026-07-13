// help.js — Onglet « ❓ Aide » : chat LLM sur le handbook de Pilot (spec_help.md).
//
// L'utilisateur pose une question sur l'utilisation/paramétrage de Pilot ; on
// appelle la commande Tauri `ask_help` qui lance un process pi temporaire
// (--no-session, cadré « pas d'outils / pas de fichiers ») avec le handbook en
// contexte, et renvoie la réponse. L'historique d'aide est géré côté frontend
// et réinjecté à chaque tour (le process pi est sans mémoire).
//
// Un sélecteur de modèle (en haut de l'onglet) choisit le modèle pi utilisé :
// pi --no-session n'a pas de modèle par défaut, donc un modèle explicite est
// obligatoire. Le choix est persisté dans la config Pilot (help_model) via
// la commande set_help_model.

import { invoke } from "@tauri-apps/api/core";
import { renderMarkdown } from "./preview.js";

/**
 * Construit l'UI de l'onglet Aide dans `container`.
 * @returns {{ wrapper: HTMLElement, unlisten: () => void }}
 */
export function createHelp(container) {
  const wrapper = document.createElement("div");
  wrapper.className = "help-chat";
  wrapper.innerHTML = `
    <div class="help-header">
      <div class="help-title-row">
        <div class="help-title">❓ Aide Pilot</div>
        <select class="help-model-select" title="Modèle utilisé pour l'aide">
          <option value="">— Chargement des modèles… —</option>
        </select>
      </div>
      <div class="help-subtitle">Pose une question sur l'utilisation ou le paramétrage de Pilot. Les réponses sont basées sur la documentation embarquée.</div>
    </div>
    <div class="help-messages"></div>
    <div class="help-input-area">
      <textarea class="help-input" rows="1" placeholder="Pose ta question sur Pilot… (Entrée pour envoyer, Shift+Entrée = saut de ligne)"></textarea>
      <button class="help-send" type="button" title="Envoyer">➤</button>
    </div>
  `;
  container.appendChild(wrapper);

  const messagesEl = wrapper.querySelector(".help-messages");
  const inputEl = wrapper.querySelector(".help-input");
  const sendBtn = wrapper.querySelector(".help-send");
  const modelSelect = wrapper.querySelector(".help-model-select");

  // État local à cet onglet aide.
  const state = {
    history: [], // [{role:"user"|"assistant", content:"..."}]
    isAsking: false,
    model: "", // modèle sélectionné (format "provider/modelId")
  };

  // Message d'accueil (pas de suggestions / FAQ — choix utilisateur).
  appendAssistant(messagesEl, "Bonjour 👋 Je suis l'assistant d'aide de **Pilot**. Pose-moi une question sur l'utilisation ou le paramétrage de l'éditeur (raccourcis, agent Pi, accès distant, dictée vocale, PDF, etc.) et je répondrai à partir de la documentation.");

  // ── Initialisation du sélecteur de modèle ──
  initModelSelect(modelSelect, state).catch((e) => {
    console.error("initModelSelect failed:", e);
    modelSelect.innerHTML = `<option value="">— Modèles indisponibles —</option>`;
    modelSelect.disabled = true;
  });

  // ── Envoi d'une question ──
  async function sendQuestion() {
    const text = inputEl.value.trim();
    if (!text || state.isAsking) return;

    if (!state.model) {
      appendError(messagesEl, "Aucun modèle sélectionné. Choisis un modèle dans la liste déroulante en haut de l'onglet Aide avant de poser une question.");
      return;
    }

    inputEl.value = "";
    autoResize();
    appendUser(messagesEl, text);
    state.history.push({ role: "user", content: text });

    const thinkingEl = appendThinking(messagesEl);
    setAsking(true);

    try {
      const answer = await invoke("ask_help", {
        question: text,
        history: state.history.slice(0, -1), // historique sans la question courante
      });
      thinkingEl.remove();
      const clean = (answer || "").trim() || "_(réponse vide)_";
      appendAssistant(messagesEl, clean);
      state.history.push({ role: "assistant", content: clean });
    } catch (e) {
      thinkingEl.remove();
      appendError(messagesEl, String(e));
      // En cas d'erreur, on ne pousse pas dans l'historique (la question reste
      // seule côté user ; l'utilisateur peut reformuler).
    } finally {
      setAsking(false);
    }
  }

  function setAsking(v) {
    state.isAsking = v;
    sendBtn.disabled = v;
    inputEl.disabled = v;
    sendBtn.textContent = v ? "⏳" : "➤";
    if (!v) inputEl.focus();
  }

  // ── Événements ──
  sendBtn.addEventListener("click", sendQuestion);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendQuestion();
    }
  });
  inputEl.addEventListener("input", autoResize);

  function autoResize() {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + "px";
  }

  // Focus initial
  setTimeout(() => inputEl.focus(), 50);

  // unlisten : rien à nettoyer côté backend (process pi temporaire déjà tué par
  // ask_help). On retourne une fonction vide pour cohérence avec tabs.js.
  function unlisten() {
    // Rien à libérer (pas d'écouteur global, pas de session persistante).
  }

  return { wrapper, unlisten };
}

// ── Sélecteur de modèle ──

/**
 * Peuple le <select> avec les modèles disponibles (get_available_models_list),
 * présélectionne le modèle persisté dans la config (help_model). Si aucun
 * modèle n'est configuré, auto-sélectionne le 1er de la liste et le persiste
 * (pour que l'aide fonctionne immédiatement, sans action utilisateur).
 */
async function initModelSelect(select, state) {
  // Récupérer en parallèle la liste des modèles et le modèle persisté.
  const [models, config] = await Promise.all([
    invoke("get_available_models_list"),
    invoke("get_config"),
  ]);

  if (!Array.isArray(models) || models.length === 0) {
    select.innerHTML = `<option value="">— Aucun modèle —</option>`;
    select.disabled = true;
    return;
  }

  // Construire les options : placeholder + modèles.
  const opts = ['<option value="">— Sélectionner un modèle —</option>'];
  for (const m of models) {
    opts.push(`<option value="${escapeAttr(m)}">${escapeHtml(m)}</option>`);
  }
  select.innerHTML = opts.join("");
  select.disabled = false;

  const saved = (config && config.help_model) || "";
  if (saved && models.includes(saved)) {
    select.value = saved;
    state.model = saved;
  } else {
    // Aucun modèle persisté (ou obsolète) : auto-sélectionner le 1er pour que
    // l'aide fonctionne immédiatement, et le persister.
    select.value = models[0];
    state.model = models[0];
    try {
      await invoke("set_help_model", { model: models[0] });
    } catch (e) {
      console.warn("Persistance help_model impossible:", e);
    }
  }

  // Réagir aux changements manuels de l'utilisateur.
  select.addEventListener("change", async () => {
    state.model = select.value;
    if (state.model) {
      try {
        await invoke("set_help_model", { model: state.model });
      } catch (e) {
        console.warn("Persistance help_model impossible:", e);
      }
    }
  });
}

// ── Rendu des messages ──

function scrollToBottom(messagesEl) {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendUser(messagesEl, text) {
  const el = document.createElement("div");
  el.className = "help-msg help-msg-user";
  el.textContent = text; // texte brut (sécurisé, pas de HTML utilisateur)
  messagesEl.appendChild(el);
  scrollToBottom(messagesEl);
}

function appendAssistant(messagesEl, markdown) {
  const el = document.createElement("div");
  el.className = "help-msg help-msg-assistant";
  const body = document.createElement("div");
  body.className = "help-msg-body";
  body.innerHTML = renderMarkdown(markdown);
  el.appendChild(body);
  messagesEl.appendChild(el);
  scrollToBottom(messagesEl);
}

function appendThinking(messagesEl) {
  const el = document.createElement("div");
  el.className = "help-msg help-msg-assistant";
  el.innerHTML = `<div class="help-msg-body help-thinking"><span class="help-dot"></span><span class="help-dot"></span><span class="help-dot"></span></div>`;
  messagesEl.appendChild(el);
  scrollToBottom(messagesEl);
  return el;
}

function appendError(messagesEl, message) {
  const el = document.createElement("div");
  el.className = "help-msg help-msg-error";
  el.innerHTML = `⚠️ <span>${escapeHtml(message)}</span>`;
  messagesEl.appendChild(el);
  scrollToBottom(messagesEl);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}