// review.js — Onglet « 🔍 Review » : revue de code assistée par LLM (H5).
//
// L'agent joue le rôle de **second reviewer** sur le diff de la session :
//   - « modifs non commitées » → `git diff HEAD` (avant commit) ;
//   - « dernier commit »       → `git diff HEAD~1 HEAD` (après commit).
//
// On appelle la commande Tauri `ask_review` qui lance un process pi temporaire
// cadré (réutilise `help::ask_pi_caged` : aucune pollution de la session de
// coding principale). Le diff est injecté dans le prompt ; pi n'accède à aucun
// fichier du projet (cwd = dossier temporaire). L'historique de revue est géré
// côté frontend et réinjecté à chaque tour (le process pi est sans mémoire).
//
// Réutilise les styles `.help-*` (rendu cohérent avec l'onglet Aide) + un
// sélecteur de portée (scope) et un bouton « Lancer la revue ».

import { invoke } from "@tauri-apps/api/core";
import { renderMarkdown } from "./preview.js";

/**
 * Construit l'UI de l'onglet Review dans `container`.
 * @returns {{ wrapper: HTMLElement, unlisten: () => void }}
 */
export function createReview(container) {
  const wrapper = document.createElement("div");
  wrapper.className = "help-chat review-chat";
  wrapper.innerHTML = `
    <div class="help-header">
      <div class="help-title-row">
        <div class="help-title">🔍 Revue de code</div>
        <select class="review-scope" title="Portée du diff à reviewer">
          <option value="working">Modifs non commitées (vs HEAD)</option>
          <option value="last">Dernier commit (HEAD~1..HEAD)</option>
        </select>
        <select class="review-model-select" title="Modèle utilisé pour la revue">
          <option value="">— Chargement des modèles… —</option>
        </select>
      </div>
      <div class="help-subtitle">L'agent analyse le diff Git et joue le rôle de second reviewer : bugs, sécurité, perfs, style, cohérence specs. Lecture seule — il ne modifie rien.</div>
    </div>
    <div class="review-actions">
      <button class="review-launch" type="button" title="Lancer la revue du diff courant">🔍 Lancer la revue</button>
    </div>
    <div class="help-messages"></div>
    <div class="help-input-area">
      <textarea class="help-input" rows="1" placeholder="Question de suivi (ex: « approfondis la sécurité du fichier X ») — Entrée pour envoyer, Shift+Entrée = saut de ligne"></textarea>
      <button class="help-send" type="button" title="Envoyer">➤</button>
    </div>
  `;
  container.appendChild(wrapper);

  const messagesEl = wrapper.querySelector(".help-messages");
  const inputEl = wrapper.querySelector(".help-input");
  const sendBtn = wrapper.querySelector(".help-send");
  const launchBtn = wrapper.querySelector(".review-launch");
  const scopeSelect = wrapper.querySelector(".review-scope");
  const modelSelect = wrapper.querySelector(".review-model-select");

  const state = {
    history: [], // [{role, content}]
    isAsking: false,
    model: "", // "provider/modelId"
    scope: "working",
    hasReview: false, // une revue initiale a-t-elle déjà été faite ?
  };

  // Message d'accueil.
  appendAssistant(
    messagesEl,
    `Bonjour 👋 Je suis le **reviewer** de Pilot. Sélectionne une portée (modifs non commitées ou dernier commit), un modèle, puis clique sur **🔍 Lancer la revue** : j'analyserai le diff Git et je te donnerai une revue structurée (bugs, sécurité, perfs, style, cohérence specs). Ensuite, pose-moi des questions de suivi dans la zone en bas.`
  );

  // ── Sélecteur de portée ──
  scopeSelect.addEventListener("change", () => {
    state.scope = scopeSelect.value;
  });

  // ── Sélecteur de modèle ──
  initModelSelect(modelSelect, state).catch((e) => {
    console.error("initModelSelect (review) failed:", e);
    modelSelect.innerHTML = `<option value="">— Modèles indisponibles —</option>`;
    modelSelect.disabled = true;
  });

  // ── Lancer la revue initiale (question vide) ──
  launchBtn.addEventListener("click", () => sendReview(""));

  // ── Envoyer une question de suivi ──
  sendBtn.addEventListener("click", () => {
    const text = inputEl.value.trim();
    if (text) sendReview(text);
  });
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const text = inputEl.value.trim();
      if (text) sendReview(text);
    }
  });
  inputEl.addEventListener("input", autoResize);

  async function sendReview(question) {
    if (state.isAsking) return;
    if (!state.model) {
      appendError(messagesEl, "Aucun modèle sélectionné. Choisis un modèle dans la liste déroulante en haut de l'onglet Review avant de lancer la revue.");
      return;
    }

    const isInitial = question.trim().length === 0;

    if (isInitial) {
      // Revue initiale : message système indiquant la portée.
      const scopeLabel = state.scope === "last" ? "dernier commit" : "modifs non commitées";
      appendUser(messagesEl, `🔍 Lance la revue — portée : ${scopeLabel}.`);
    } else {
      appendUser(messagesEl, question);
      inputEl.value = "";
      autoResize();
    }
    state.history.push({ role: "user", content: isInitial ? `Lance la revue — portée : ${state.scope}.` : question });

    const thinkingEl = appendThinking(messagesEl);
    setAsking(true);

    try {
      // L'historique envoyé exclut le tour user qu'on vient d'ajouter.
      const answer = await invoke("ask_review", {
        scope: state.scope,
        question: isInitial ? "" : question,
        history: state.history.slice(0, -1),
      });
      thinkingEl.remove();
      const clean = (answer || "").trim() || "_(revue vide)_";
      appendAssistant(messagesEl, clean);
      state.history.push({ role: "assistant", content: clean });
      state.hasReview = true;
    } catch (e) {
      thinkingEl.remove();
      appendError(messagesEl, String(e));
      // Retirer le tour user raté de l'historique (permet de réessayer).
      state.history.pop();
    } finally {
      setAsking(false);
    }
  }

  function setAsking(v) {
    state.isAsking = v;
    sendBtn.disabled = v;
    inputEl.disabled = v;
    launchBtn.disabled = v;
    sendBtn.textContent = v ? "⏳" : "➤";
    if (!v) inputEl.focus();
  }

  function autoResize() {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + "px";
  }

  function unlisten() {
    // Rien à libérer (process pi temporaire tué par ask_review à chaque tour).
  }

  return { wrapper, unlisten };
}

// ── Sélecteur de modèle (similaire à help.js, persiste review_model) ──

async function initModelSelect(select, state) {
  const [models, config] = await Promise.all([
    invoke("get_available_models_list"),
    invoke("get_config"),
  ]);

  if (!Array.isArray(models) || models.length === 0) {
    select.innerHTML = `<option value="">— Aucun modèle —</option>`;
    select.disabled = true;
    return;
  }

  const opts = ['<option value="">— Sélectionner un modèle —</option>'];
  for (const m of models) {
    opts.push(`<option value="${escapeAttr(m)}">${escapeHtml(m)}</option>`);
  }
  select.innerHTML = opts.join("");
  select.disabled = false;

  const saved = (config && config.review_model) || "";
  if (saved && models.includes(saved)) {
    select.value = saved;
    state.model = saved;
  } else {
    // Réutiliser help_model si déjà choisi (cohérence), sinon 1er de la liste.
    const fallback = (config && config.help_model && models.includes(config.help_model)) ? config.help_model : models[0];
    select.value = fallback;
    state.model = fallback;
    try {
      await invoke("set_review_model", { model: fallback });
    } catch (e) {
      console.warn("Persistance review_model impossible:", e);
    }
  }

  select.addEventListener("change", async () => {
    state.model = select.value;
    if (state.model) {
      try {
        await invoke("set_review_model", { model: state.model });
      } catch (e) {
        console.warn("Persistance review_model impossible:", e);
      }
    }
  });
}

// ── Rendu des messages (identique à help.js) ──

function scrollToBottom(messagesEl) {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendUser(messagesEl, text) {
  const el = document.createElement("div");
  el.className = "help-msg help-msg-user";
  el.textContent = text;
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
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}