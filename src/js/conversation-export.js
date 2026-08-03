// conversation-export.js — Export de conversation agent (F2/F3)
//
// Génère un export de la conversation agent (onglet π) à partir du DOM du chat
// (`#agent-chat-messages` / `.agent-chat-messages`). Deux sorties :
//   - F2 : Markdown (fichier .md, dialogue natif)
//   - F3 : HTML rendu (copié dans le presse-papiers)
//
// V1 : export du rendu visible (textes markdown rendus, pensée, outils,
// résultats, messages système/erreur). La conversation est rendue dans le DOM
// (pas de store central) → on la lit depuis le DOM.

import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { toastSuccess, toastError } from "./toast.js";

/** Extrait le texte brut d'un noeud (en ignorant les éléments de contenu masqué). */
function plainText(el) {
  if (!el) return "";
  return (el.textContent || "").trim();
}

/**
 * Parcourt le DOM du chat et construit une liste ordonnée d'événements.
 * Chaque événement : { kind, text, content }
 *  - kind : "user" | "assistant" | "thinking" | "tool" | "tool_result" | "system" | "error" | "compaction"
 *  - content : HTML rendu (assistant) — pour l'export HTML
 */
function collectMessages(container) {
  const out = [];
  if (!container) return out;

  for (const msg of container.querySelectorAll(":scope > .agent-message")) {
    if (msg.classList.contains("agent-message-user")) {
      const bubble = msg.querySelector(".agent-bubble-user");
      out.push({ kind: "user", text: plainText(bubble), content: bubble ? bubble.innerHTML : "" });
      continue;
    }

    if (msg.classList.contains("agent-message-system")) {
      out.push({ kind: "system", text: plainText(msg) });
      continue;
    }

    if (msg.classList.contains("agent-message-error")) {
      out.push({ kind: "error", text: plainText(msg) });
      continue;
    }

    // Assistant : parcourir le flux chronologique
    const flow = msg.querySelector(".agent-stream-flow") || msg;
    // Bloc assistant : concaténation du contenu
    const assistantParts = [];

    for (const child of flow.children) {
      if (child.classList.contains("agent-text-section")) {
        assistantParts.push({ html: child.innerHTML, text: plainText(child) });
      } else if (child.classList.contains("agent-thinking")) {
        const content = child.querySelector(".agent-thinking-content");
        out.push({ kind: "thinking", text: plainText(content || child) });
      } else if (child.classList.contains("agent-tool-inline")) {
        out.push({ kind: "tool", text: plainText(child) });
      } else if (child.classList.contains("agent-tool-result")) {
        const nameEl = child.querySelector(".agent-tool-result-name");
        const codeEl = child.querySelector(".agent-tool-result-content code");
        out.push({
          kind: "tool_result",
          text: (nameEl ? nameEl.textContent : "outil") + "\n" + plainText(codeEl),
          raw: codeEl ? codeEl.textContent : "",
        });
      } else if (child.classList.contains("agent-compaction-summary")) {
        out.push({ kind: "compaction", text: plainText(child) });
      }
    }

    if (assistantParts.length > 0) {
      const html = assistantParts.map((p) => p.html).join("\n");
      const text = assistantParts.map((p) => p.text).join("\n").trim();
      out.push({ kind: "assistant", text, content: html });
    }
  }

  return out;
}

/** Construit une représentation Markdown des événements. */
export function toMarkdown(events) {
  const lines = [];
  for (const ev of events) {
    switch (ev.kind) {
      case "user":
        lines.push("### 👤 Vous\n" + ev.text);
        break;
      case "assistant":
        lines.push("### 🤖 Agent\n" + (ev.text || "(réponse sans texte)"));
        break;
      case "thinking":
        lines.push("> 💭 *Pensée :* " + ev.text);
        break;
      case "tool":
        lines.push("🔧 `" + ev.text + "`");
        break;
      case "tool_result":
        lines.push("📥 Résultat outil :\n```\n" + (ev.raw || ev.text) + "\n```");
        break;
      case "system":
        lines.push("_ℹ️ " + ev.text + "_");
        break;
      case "error":
        lines.push("❌ **" + ev.text + "**");
        break;
      case "compaction":
        lines.push("🧹 " + ev.text);
        break;
      default:
        lines.push(ev.text);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

/** Construit un HTML autonome (style inline minimal) des événements. */
export function toHtml(events) {
  const parts = [];
  for (const ev of events) {
    if (ev.kind === "user") {
      parts.push(`<div class="msg user"><div class="label">👤 Vous</div><div class="bubble">${ev.content || escText(ev.text)}</div></div>`);
    } else if (ev.kind === "assistant") {
      parts.push(`<div class="msg assistant"><div class="label">🤖 Agent</div><div class="bubble">${ev.content || escText(ev.text)}</div></div>`);
    } else if (ev.kind === "thinking") {
      parts.push(`<div class="msg thinking"><em>💭 ${escText(ev.text)}</em></div>`);
    } else if (ev.kind === "tool") {
      parts.push(`<div class="msg tool"><code>🔧 ${escText(ev.text)}</code></div>`);
    } else if (ev.kind === "tool_result") {
      parts.push(`<div class="msg tool-result"><pre>${escText(ev.raw || ev.text)}</pre></div>`);
    } else if (ev.kind === "system") {
      parts.push(`<div class="msg system">ℹ️ ${escText(ev.text)}</div>`);
    } else if (ev.kind === "error") {
      parts.push(`<div class="msg error">❌ ${escText(ev.text)}</div>`);
    } else if (ev.kind === "compaction") {
      parts.push(`<div class="msg system">🧹 ${escText(ev.text)}</div>`);
    }
  }

  const date = new Date().toISOString().slice(0, 19).replace("T", " ");
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>Conversation agent — ${date}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 800px; margin: 24px auto; padding: 0 16px; background: #1e1e1e; color: #eee; }
  h1 { font-size: 18px; }
  .msg { margin: 12px 0; }
  .label { font-weight: 600; font-size: 12px; opacity: 0.7; margin-bottom: 4px; }
  .bubble { background: #2a2a2a; padding: 10px 12px; border-radius: 8px; }
  .msg.user .bubble { background: #1f3a5f; }
  .msg.thinking, .msg.system, .msg.error { font-size: 13px; opacity: 0.85; }
  .msg.tool code { font-size: 12px; opacity: 0.7; }
  .msg.tool-result pre { background: #111; padding: 8px; border-radius: 6px; overflow: auto; font-size: 12px; }
  pre, code { white-space: pre-wrap; word-break: break-word; }
</style>
</head>
<body>
<h1>Conversation agent — ${date}</h1>
${parts.join("\n")}
</body>
</html>`;
}

function escText(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

/**
 * Exporte la conversation agent en Markdown (F2). Ouvre un dialogue de
 * sauvegarde natif puis écrit le fichier .md.
 * @param {HTMLElement} container - la zone `.agent-chat-messages`
 * @param {string} projectName - nom du projet (pour le nom de fichier)
 */
export async function exportConversationMarkdown(container, projectName = "") {
  if (!container) {
    toastError("Aucune conversation à exporter.");
    return;
  }
  const events = collectMessages(container);
  if (events.length === 0) {
    toastError("La conversation est vide.");
    return;
  }

  const date = new Date().toISOString().slice(0, 10);
  const base = (projectName ? projectName + "-" : "") + "conversation-" + date;
  const md = `# Conversation agent — ${new Date().toISOString().slice(0, 19).replace("T", " ")}\n\n---\n\n` + toMarkdown(events) + "\n";

  try {
    const outPath = await save({
      defaultPath: base + ".md",
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!outPath) return; // annulé
    await invoke("write_file_content", { path: outPath, content: md });
    toastSuccess("Conversation exportée : " + outPath.split(/[/\\]/).pop());
  } catch (err) {
    toastError("Erreur export : " + err);
  }
}

/**
 * Copie le HTML rendu de la conversation dans le presse-papiers (F3).
 * @param {HTMLElement} container
 */
export async function copyConversationHtml(container) {
  if (!container) {
    toastError("Aucune conversation à copier.");
    return;
  }
  const events = collectMessages(container);
  if (events.length === 0) {
    toastError("La conversation est vide.");
    return;
  }

  const html = toHtml(events);
  try {
    await navigator.clipboard.writeText(html);
    toastSuccess("Conversation copiée en HTML dans le presse-papiers.");
  } catch (err) {
    toastError("Copie impossible : " + err);
  }
}
