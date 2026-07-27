// feedback.js — Onglet « 💬 Feedback » : recueil des remarques / évolutions utilisateurs.
//
// Objectif : permettre à l'utilisateur d'envoyer facilement un retour (bug,
// évolution, remarque) et de consulter les retours déjà postés, **sans backend
// dédié** (zéro secret embarqué).
//
// Deux canaux d'envoi (Option 2) :
//   - « Ouvrir sur GitHub » → ouvre https://github.com/<repo>/issues/new avec
//     un titre + corps pré-construits (navigateur système via `open_in_browser`).
//   - « Envoyer par email » → mailto: vers l'adresse de feedback (client mail
//     par défaut, fallback sans compte GitHub).
//
// Lecture des retours existants (Option 3) : GET sur l'API REST publique de
// GitHub (dépôt public → pas de token, CORS `*`). Permet à l'utilisateur de
// vérifier si son idée existe déjà avant de poster.
//
// Aucune écriture sur le projet, aucune dépendance à pi. Consultable hors-ligne
// (seule la liste des issues nécessite le réseau).

import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { toastSuccess, toastError } from "./toast.js";

const REPO = "pleveneur/pilot";
const FEEDBACK_EMAIL = "patrick.leveneur@gmail.com";
const ISSUES_API = `https://api.github.com/repos/${REPO}/issues?state=all&per_page=50&sort=created&direction=desc`;
const NEW_ISSUE_URL = `https://github.com/${REPO}/issues/new`;

const TYPE_LABELS = {
  bug: "🐛 Bug",
  feature: "✨ Évolution",
  remark: "💬 Remarque",
};

let cachedVersion = "";

/** Construit le corps Markdown pré-rempli (envoyé à GitHub ET dans l'email). */
function buildBody(type, title, description, email, version, os) {
  const lines = [];
  lines.push(`### ${TYPE_LABELS[type] || "Remarque"}`);
  lines.push("");
  lines.push(`**${title}**`);
  lines.push("");
  lines.push(description);
  lines.push("");
  lines.push("---");
  lines.push("### Informations techniques");
  lines.push(`- Version de Pilot : \`${version || "inconnue"}\``);
  lines.push(`- OS : \`${os || "inconnu"}\``);
  if (email && email.trim()) {
    lines.push(`- Contact : \`${email.trim()}\``);
  } else {
    lines.push("- Contact : _non renseigné_");
  }
  lines.push("");
  lines.push("_(Envoyé depuis l'onglet Feedback de Pilot)_");
  return lines.join("\n");
}

function detectOS() {
  try {
    const ua = navigator.userAgent || "";
    if (/Win/.test(ua)) return "Windows";
    if (/Mac/.test(ua)) return "macOS";
    if (/Linux/.test(ua)) return "Linux";
    return ua;
  } catch (_) {
    return "inconnu";
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch (_) {
    return iso || "";
  }
}

/**
 * Construit l'UI de l'onglet Feedback dans `container`.
 * @returns {{ wrapper: HTMLElement, unlisten: () => void }}
 */
export function createFeedback(container) {
  const wrapper = document.createElement("div");
  wrapper.className = "fb-panel";
  wrapper.innerHTML = `
    <div class="fb-header">
      <div class="fb-title">💬 Feedback</div>
      <p class="fb-intro">
        Une remarque, un bug, une idée d'évolution ? Envoyez-nous votre retour.
        Il sera ouvert sur GitHub (où vous pourrez suivre son traitement) ou
        envoyé par email. Vous pouvez aussi consulter les retours déjà postés
        pour éviter un doublon.
      </p>
    </div>

    <div class="fb-section">
      <h3 class="fb-section-title">Envoyer un retour</h3>

      <label class="fb-field">
        <span class="fb-label">Type</span>
        <select id="fb-type" class="fb-select">
          <option value="bug">🐛 Bug</option>
          <option value="feature">✨ Évolution</option>
          <option value="remark">💬 Remarque</option>
        </select>
      </label>

      <label class="fb-field">
        <span class="fb-label">Titre court <span class="fb-req">*</span></span>
        <input id="fb-title" type="text" class="fb-input" maxlength="120" placeholder="Résumé en une phrase" />
      </label>

      <label class="fb-field">
        <span class="fb-label">Description <span class="fb-req">*</span></span>
        <textarea id="fb-desc" class="fb-textarea" rows="7" placeholder="Détaillez : contexte, étapes pour reproduire un bug, résultat attendu, etc."></textarea>
      </label>

      <label class="fb-field">
        <span class="fb-label">Votre email (optionnel)</span>
        <input id="fb-email" type="email" class="fb-input" maxlength="120" placeholder="Pour une réponse si besoin" />
      </label>

      <div class="fb-meta" id="fb-meta">Chargement des informations…</div>

      <div class="fb-actions">
        <button id="fb-github" class="fb-btn fb-btn-primary" title="Ouvrir une issue sur GitHub dans votre navigateur">
          <i data-lucide="external-link" class="icon-sm"></i> Ouvrir sur GitHub
        </button>
        <button id="fb-email-btn" class="fb-btn" title="Envoyer par email dans votre client mail">
          <i data-lucide="mail" class="icon-sm"></i> Envoyer par email
        </button>
      </div>
      <p class="fb-hint">
        GitHub nécessite un compte. Pas de compte ? Utilisez « Envoyer par email ».
      </p>
    </div>

    <div class="fb-section">
      <div class="fb-section-row">
        <h3 class="fb-section-title">Remarques déjà envoyées</h3>
        <button id="fb-refresh" class="fb-btn fb-btn-ghost" title="Rafraîchir la liste">
          <i data-lucide="refresh-cw" class="icon-sm"></i> Rafraîchir
        </button>
      </div>
      <input id="fb-search" type="search" class="fb-input fb-search" placeholder="Filtrer les retours (titre, label…)…" />
      <div id="fb-list" class="fb-list">
        <div class="fb-list-loading">Chargement…</div>
      </div>
    </div>
  `;

  container.appendChild(wrapper);

  // --- Icônes Lucide injectées dynamiquement : on les rend via refreshIcons.
  // Import dynamique pour éviter une dépendance circulaire au chargement.
  import("./icons.js").then(({ refreshIcons }) => {
    refreshIcons(wrapper);
  });

  // --- Métadonnées auto (version + OS) ---
  const versionP = getVersion().catch(() => "inconnue");
  versionP.then((v) => { cachedVersion = v; });
  const os = detectOS();
  Promise.all([versionP]).then(([v]) => {
    const meta = wrapper.querySelector("#fb-meta");
    if (meta) {
      meta.innerHTML = `Joins automatiquement : <b>Pilot ${escapeHtml(v)}</b> · <b>${escapeHtml(os)}</b>`;
    }
  });

  // --- État ---
  let allIssues = [];

  function currentInput() {
    const type = wrapper.querySelector("#fb-type").value;
    const title = wrapper.querySelector("#fb-title").value.trim();
    const description = wrapper.querySelector("#fb-desc").value.trim();
    const email = wrapper.querySelector("#fb-email").value.trim();
    return { type, title, description, email, version: cachedVersion, os };
  }

  function validate() {
    const { title, description } = currentInput();
    const ok = title.length >= 3 && description.length >= 5;
    const gh = wrapper.querySelector("#fb-github");
    const em = wrapper.querySelector("#fb-email-btn");
    if (gh) gh.disabled = !ok;
    if (em) em.disabled = !ok;
  }

  wrapper.querySelector("#fb-title").addEventListener("input", validate);
  wrapper.querySelector("#fb-desc").addEventListener("input", validate);
  validate();

  // --- Envoi GitHub ---
  wrapper.querySelector("#fb-github").addEventListener("click", async () => {
    const { type, title, description, email, version, os } = currentInput();
    if (title.length < 3 || description.length < 5) return;
    const subject = `[${type}] ${title}`;
    const body = buildBody(type, title, description, email, version, os);
    const url = `${NEW_ISSUE_URL}?title=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    try {
      await invoke("open_in_browser", { path: url });
      toastSuccess("Issue GitHub ouverte dans votre navigateur");
    } catch (e) {
      toastError("Ouverture du navigateur impossible : " + e);
    }
  });

  // --- Envoi email ---
  wrapper.querySelector("#fb-email-btn").addEventListener("click", async () => {
    const { type, title, description, email, version, os } = currentInput();
    if (title.length < 3 || description.length < 5) return;
    const subject = `[Pilot][${type}] ${title}`;
    const body = buildBody(type, title, description, email, version, os);
    const mailto = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    try {
      await invoke("open_in_browser", { path: mailto });
      toastSuccess("Email préparé dans votre client mail");
    } catch (e) {
      toastError("Ouverture du client mail impossible : " + e);
    }
  });

  // --- Liste des issues existantes ---
  async function loadIssues() {
    const listEl = wrapper.querySelector("#fb-list");
    listEl.innerHTML = `<div class="fb-list-loading">Chargement…</div>`;
    try {
      const res = await fetch(ISSUES_API, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (res.status === 403 || res.status === 429) {
        // Rate limit anonyme dépassée (60 req/h).
        const reset = res.headers.get("X-RateLimit-Reset");
        const when = reset ? new Date(parseInt(reset, 10) * 1000).toLocaleTimeString() : "plus tard";
        listEl.innerHTML = `<div class="fb-list-error">⏳ Limite GitHub atteinte. Réessayez après ${when}.</div>`;
        return;
      }
      if (!res.ok) {
        listEl.innerHTML = `<div class="fb-list-error">Erreur GitHub (HTTP ${res.status}).</div>`;
        return;
      }
      const data = await res.json();
      // L'endpoint /issues renvoie aussi les PR : on filtre.
      allIssues = (Array.isArray(data) ? data : []).filter((i) => !i.pull_request);
      renderIssues(allIssues);
    } catch (e) {
      listEl.innerHTML = `<div class="fb-list-error">Réseau indisponible : ${escapeHtml(String(e))}</div>`;
    }
  }

  function renderIssues(issues) {
    const listEl = wrapper.querySelector("#fb-list");
    if (!issues.length) {
      listEl.innerHTML = `<div class="fb-list-empty">Aucun retour pour le moment. Soyez le premier !</div>`;
      return;
    }
    listEl.innerHTML = issues
      .map((i) => {
        const state = i.state === "open" ? "🟢" : "🔴";
        const labels = (i.labels || [])
          .map((l) => `<span class="fb-issue-label">${escapeHtml(l.name)}</span>`)
          .join("");
        const date = fmtDate(i.created_at);
        return `
          <a class="fb-issue ${i.state === "closed" ? "fb-issue-closed" : ""}" href="${escapeHtml(i.html_url)}" target="_blank" rel="noopener noreferrer">
            <div class="fb-issue-top">
              <span class="fb-issue-state" title="${i.state}">${state}</span>
              <span class="fb-issue-num">#${i.number}</span>
              <span class="fb-issue-title">${escapeHtml(i.title)}</span>
            </div>
            <div class="fb-issue-meta">
              <span class="fb-issue-author">@${escapeHtml((i.user && i.user.login) || "?")}</span>
              <span class="fb-issue-date">${date}</span>
              ${labels ? `<span class="fb-issue-labels">${labels}</span>` : ""}
            </div>
          </a>`;
      })
      .join("");
    // Les liens sont des <a target=_blank> : on les ouvre via open_in_browser
    // pour fiabilité (Tauri peut ne pas ouvrir target=_blank dans le navigateur).
    listEl.querySelectorAll("a.fb-issue").forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        invoke("open_in_browser", { path: a.href }).catch(() => {
          // Fallback : laisse le navigateur webview tenter
          window.open(a.href, "_blank");
        });
      });
    });
  }

  // Filtre local
  wrapper.querySelector("#fb-search").addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase().trim();
    if (!q) {
      renderIssues(allIssues);
      return;
    }
    const filtered = allIssues.filter((i) => {
      const hay = (
        (i.title || "") +
        " " +
        (i.number + "") +
        " " +
        (i.labels || []).map((l) => l.name).join(" ") +
        " " +
        ((i.user && i.user.login) || "")
      ).toLowerCase();
      return hay.includes(q);
    });
    renderIssues(filtered);
  });

  wrapper.querySelector("#fb-refresh").addEventListener("click", loadIssues);

  // Chargement initial
  loadIssues();

  return {
    wrapper,
    unlisten: () => {
      // Rien à désallouer (pas d'écouteur global persistant).
    },
  };
}