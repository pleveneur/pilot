// session-history.js — Onglet « 📜 Historique » : sessions agent searchable (H9).
//
// Index local `.pilot/sessions.jsonl` (append-style) + tags dans
// `.pilot/sessions-tags.json`. Rétro-indexation depuis le dossier de sessions
// pi du projet à la 1re ouverture (si l'index est absent). Capture live des
// nouvelles sessions via `record_session_entry` (agent-pi.js).
//
// Ne dépend pas de pi : l'historique est consultable hors-ligne.
// Voir spec_session_history.md.

import { invoke } from "@tauri-apps/api/core";
import { renderMarkdown } from "./preview.js";
import { refreshIcons } from "./icons.js";
import { toastInfo, toastSuccess, toastError } from "./toast.js";

/**
 * Construit l'UI de l'onglet Historique dans `container`.
 * @returns {{ wrapper: HTMLElement, unlisten: () => void }}
 */
export function createSessionHistory(container) {
  const wrapper = document.createElement("div");
  wrapper.className = "help-chat history-chat";
  wrapper.innerHTML = `
    <div class="help-header">
      <div class="help-title-row">
        <div class="help-title">📜 Historique des sessions</div>
        <button class="history-reindex-btn" type="button" title="Reconstruire l'index depuis le dossier de sessions pi">
          <i data-lucide="refresh-cw" class="icon-sm"></i> Réindexer
        </button>
      </div>
      <div class="help-subtitle">Retrouve une décision, un prompt ou les fichiers touchés par une session. Recherche full-text (commencer par <code>/</code> pour une regex). L'index est local (<code>.pilot/sessions.jsonl</code>), jamais envoyé au cloud.</div>
    </div>
    <div class="history-filters">
      <input type="search" class="history-q" placeholder="Rechercher (prompt, résumé, fichiers…) — /regex" autocomplete="off" />
      <select class="history-kind" title="Type de session">
        <option value="">Tous les types</option>
        <option value="chat">💬 Chat</option>
        <option value="orchestration">🧠 Orchestration</option>
        <option value="review">🔍 Review</option>
      </select>
      <input type="text" class="history-tag" placeholder="tag" autocomplete="off" />
      <input type="text" class="history-file" placeholder="fichier (chemin relatif)" autocomplete="off" />
      <span class="history-count"></span>
    </div>
    <div class="history-body">
      <div class="history-list"></div>
      <div class="history-detail">
        <div class="history-detail-empty">Sélectionne une session pour afficher son détail.</div>
      </div>
    </div>
  `;
  container.appendChild(wrapper);

  const qEl = wrapper.querySelector(".history-q");
  const kindEl = wrapper.querySelector(".history-kind");
  const tagEl = wrapper.querySelector(".history-tag");
  const fileEl = wrapper.querySelector(".history-file");
  const countEl = wrapper.querySelector(".history-count");
  const listEl = wrapper.querySelector(".history-list");
  const detailEl = wrapper.querySelector(".history-detail");
  const reindexBtn = wrapper.querySelector(".history-reindex-btn");

  const state = {
    entries: [],
    allTags: [],
    selectedId: null,
    debounceTimer: null,
    indexed: false,
  };

  // ── Recherche ──
  async function runSearch() {
    try {
      const params = {
        query: qEl.value.trim(),
        kind: kindEl.value,
        tag: tagEl.value.trim(),
        file: fileEl.value.trim(),
        limit: 200,
      };
      const res = await invoke("search_sessions", { params });
      state.entries = (res && res.entries) || [];
      state.indexed = !!(res && res.indexed);
      countEl.textContent = `${state.entries.length} session${state.entries.length > 1 ? "s" : ""}`;
      renderList();
      // 1re ouverture : si l'index n'existe pas, rétro-indexer.
      if (!state.indexed) {
        autoReindex();
      }
    } catch (e) {
      console.error("search_sessions:", e);
      toastError("Recherche historique échouée");
    }
  }

  function debouncedSearch() {
    clearTimeout(state.debouncedTimer);
    state.debouncedTimer = setTimeout(runSearch, 250);
  }

  // ── Rétro-indexation automatique à la 1re ouverture ──
  async function autoReindex() {
    try {
      const n = await invoke("index_sessions");
      if (n > 0) {
        toastInfo(`Rétro-indexation : ${n} session${n > 1 ? "s" : ""} indexée${n > 1 ? "s" : ""}.`);
      }
      await runSearch();
    } catch (e) {
      console.error("autoReindex:", e);
    }
  }

  // ── Réindexation manuelle ──
  reindexBtn.addEventListener("click", async () => {
    reindexBtn.disabled = true;
    try {
      const n = await invoke("index_sessions");
      toastSuccess(`Index reconstruit : ${n} session${n > 1 ? "s" : ""}.`);
      await runSearch();
    } catch (e) {
      console.error("reindex:", e);
      toastError("Réindexation échouée");
    } finally {
      reindexBtn.disabled = false;
    }
  });

  // ── Rendu de la liste ──
  function renderList() {
    if (state.entries.length === 0) {
      listEl.innerHTML = `<div class="history-empty">Aucune session. Lance une session agent ou clique sur « Réindexer ».</div>`;
      return;
    }
    const html = state.entries
      .map((e) => {
        const id = e.id || "";
        const selected = id === state.selectedId ? " selected" : "";
        const date = formatDate(e.timestamp);
        const prompt = escapeHtml(e.prompt || "(sans prompt)");
        const model = e.model ? escapeHtml(e.model) : "";
        const kind = e.kind || "chat";
        const kindBadge = kindBadgeHtml(kind);
        const tags = (e.tags || [])
          .map((t) => `<span class="history-tag-chip">${escapeHtml(t)}</span>`)
          .join("");
        const files = (e.files || []).slice(0, 3);
        const filesHtml = files.length
          ? `<div class="history-files">📄 ${files.map((f) => escapeHtml(f)).join(", ")}${(e.files || []).length > 3 ? ` +${(e.files || []).length - 3}` : ""}</div>`
          : "";
        const costHtml = e.cost != null ? `<span class="history-cost">$${Number(e.cost).toFixed(2)}</span>` : "";
        const tokensHtml = e.tokens != null ? `<span class="history-tokens">${fmtTokens(e.tokens)} tok</span>` : "";
        return `
        <div class="history-item${selected}" data-id="${escapeAttr(id)}">
          <div class="history-item-top">
            <span class="history-date">${date}</span>
            ${kindBadge}
            ${costHtml}
            ${tokensHtml}
          </div>
          <div class="history-prompt">${prompt}</div>
          ${model ? `<div class="history-model">${model}</div>` : ""}
          ${filesHtml}
          ${tags ? `<div class="history-tags">${tags}</div>` : ""}
        </div>`;
      })
      .join("");
    listEl.innerHTML = html;
    // Clic → détail
    listEl.querySelectorAll(".history-item").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.getAttribute("data-id");
        state.selectedId = id;
        renderList();
        renderDetail(id);
      });
    });
  }

  // ── Rendu du détail ──
  async function renderDetail(id) {
    detailEl.innerHTML = `<div class="history-detail-loading">Chargement…</div>`;
    try {
      const res = await invoke("get_session_detail", { id });
      const entry = res.entry || {};
      const messages = res.messages || [];
      const tags = entry.tags || [];

      const files = entry.files || [];
      const filesHtml = files.length
        ? `<div class="history-detail-files"><b>Fichiers touchés (${files.length}) :</b> ${files.map((f) => `<code>${escapeHtml(f)}</code>`).join(" ")}</div>`
        : "";

      const tagsHtml = tags
        .map((t) => `<span class="history-tag-chip removable" data-tag="${escapeAttr(t)}">${escapeHtml(t)} <i data-lucide="x" class="icon-sm"></i></span>`)
        .join("") + `<input type="text" class="history-tag-add" placeholder="+ tag" autocomplete="off" list="history-taglist" />`;
      const datalist = `<datalist id="history-taglist">${state.allTags.map((t) => `<option value="${escapeAttr(t)}">`).join("")}</datalist>`;

      detailEl.innerHTML = `
        <div class="history-detail-header">
          <div class="history-detail-title">${escapeHtml(entry.prompt || "(sans prompt)")}</div>
          <div class="history-detail-meta">
            <span>${formatDate(entry.timestamp)}</span>
            ${entry.model ? `<span>· ${escapeHtml(entry.model)}</span>` : ""}
            ${entry.cost != null ? `<span>· $${Number(entry.cost).toFixed(4)}</span>` : ""}
            ${entry.tokens != null ? `<span>· ${fmtTokens(entry.tokens)} tokens</span>` : ""}
            <span>· ${entry.turns || 0} tour(s)</span>
          </div>
          ${filesHtml}
          <div class="history-detail-tags">${tagsHtml}</div>
          ${datalist}
        </div>
        <div class="history-detail-messages"></div>
      `;
      const msgsEl = detailEl.querySelector(".history-detail-messages");
      for (const m of messages) {
        const role = m.role || "";
        const text = m.text || "";
        const tools = m.tools || [];
        const cls = role === "user" ? "history-msg-user" : "history-msg-assistant";
        const roleLabel = role === "user" ? "🧑 Toi" : "🤖 Agent";
        let body = "";
        if (text) {
          body += renderMarkdown(text);
        }
        if (tools.length) {
          body += `<div class="history-msg-tools">`;
          for (const t of tools) {
            const p = t.path ? ` — <code>${escapeHtml(t.path)}</code>` : "";
            body += `<div class="history-msg-tool"><i data-lucide="wrench" class="icon-sm"></i> ${escapeHtml(t.name || "tool")}${p}</div>`;
          }
          body += `</div>`;
        }
        const div = document.createElement("div");
        div.className = `history-msg ${cls}`;
        div.innerHTML = `<div class="history-msg-role">${roleLabel}</div><div class="history-msg-body">${body || "<i>(vide)</i>"}</div>`;
        msgsEl.appendChild(div);
      }
      if (messages.length === 0) {
        msgsEl.innerHTML = `<div class="history-empty">Aucun message détaillé disponible (fichier de session pi introuvable — session en <code>--no-session</code> ?).</div>`;
      }
      refreshIcons(detailEl);
      // ── Édition des tags ──
      bindTagEditing(id, entry);
    } catch (e) {
      console.error("get_session_detail:", e);
      detailEl.innerHTML = `<div class="history-empty">❌ Erreur : ${escapeHtml(String(e))}</div>`;
    }
  }

  function bindTagEditing(id, entry) {
    // Retirer un tag
    detailEl.querySelectorAll(".history-tag-chip.removable").forEach((chip) => {
      chip.addEventListener("click", async () => {
        const t = chip.getAttribute("data-tag");
        let tags = (entry.tags || []).filter((x) => x !== t);
        try {
          await invoke("set_session_tags", { id, tags });
          await reloadTags();
          renderDetail(id);
          runSearch();
        } catch (e) {
          toastError("Maj tag échouée");
        }
      });
    });
    // Ajouter un tag
    const addInput = detailEl.querySelector(".history-tag-add");
    if (addInput) {
      addInput.addEventListener("keydown", async (ev) => {
        if (ev.key === "Enter") {
          const v = addInput.value.trim();
          if (!v) return;
          let tags = (entry.tags || []).slice();
          if (!tags.includes(v)) tags.push(v);
          try {
            await invoke("set_session_tags", { id, tags });
            await reloadTags();
            renderDetail(id);
            runSearch();
          } catch (e) {
            toastError("Maj tag échouée");
          }
        }
      });
    }
  }

  async function reloadTags() {
    try {
      state.allTags = (await invoke("list_session_tags")) || [];
    } catch (_) {
      state.allTags = [];
    }
  }

  // ── Listeners ──
  [qEl, tagEl, fileEl].forEach((el) => el.addEventListener("input", debouncedSearch));
  kindEl.addEventListener("change", debouncedSearch);

  // Initial load
  reloadTags().then(runSearch);

  const unlisten = () => {
    clearTimeout(state.debouncedTimer);
  };

  return { wrapper, unlisten };
}

// ── Helpers ──

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

function formatDate(iso) {
  if (!iso) return "";
  // iso = "2026-08-01T14:23:00"
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtTokens(n) {
  if (n == null) return "?";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function kindBadgeHtml(kind) {
  switch (kind) {
    case "orchestration":
      return `<span class="history-kind-badge kind-orch" title="Session d'orchestration">🧠 orch</span>`;
    case "review":
      return `<span class="history-kind-badge kind-review" title="Revue de code">🔍 rev</span>`;
    default:
      return `<span class="history-kind-badge kind-chat" title="Chat agent">💬 chat</span>`;
  }
}

// ── Capture live (utilisé par agent-pi.js) ──
// Construit une entrée d'index depuis les données de session courante et
// l'enregistre via `record_session_entry`. Retourne le nb de sessions indexées.
export async function recordCurrentSession({
  id,
  model,
  prompt,
  summary,
  files,
  tokens,
  cost,
  turns,
  origin,
  kind = "chat",
  parent = null,
}) {
  try {
    const entry = {
      id: id || "",
      timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "").replace("T", "T"),
      model: model || "",
      prompt: prompt || "",
      summary: summary || "",
      files: files || [],
      tags: [],
      tokens: tokens ?? null,
      cost: cost ?? null,
      turns: turns || 0,
      duration_s: null,
      origin: origin || null,
      kind,
      parent,
    };
    if (!entry.id) return 0;
    await invoke("record_session_entry", { entry });
    return 1;
  } catch (e) {
    console.error("recordCurrentSession:", e);
    return 0;
  }
}