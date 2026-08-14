// dashboard.js — Onglet « 📊 Tableau de bord » (issue #51)
//
// Vue détaillée du projet actif, alimentée par la commande Rust
// `get_project_dashboard` (métriques fichiers/Git + base de suivi de
// l'assistant + index de sessions). Lecture seule. Sections :
//   - En-tête (nom, chemin, client, statut de rafraîchissement)
//   - Stockage & Poids
//   - État Git
//   - Analyse du Code & Langages
//   - Activité & Métriques de l'Agent IA
//   - Évolution & Vélocité
//   - Contexte & Documentation
//   - Bandeau d'Alertes & Suggestions

import { invoke } from "@tauri-apps/api/core";
import { refreshIcons } from "./icons.js";

/** Formate un horodatage epoch (ms) en « il y a … » relatif. */
function relativeTime(ms) {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  const s = Math.floor(diff / 1000);
  if (s < 60) return "à l'instant";
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `il y a ${d} j`;
  return new Date(ms).toLocaleDateString();
}

/** Formate un nombre avec séparateur de milliers. */
function fmt(n) {
  return (n ?? 0).toLocaleString("fr-FR");
}

/** Crée une carte (section) du tableau de bord. */
function card(title, icon) {
  const el = document.createElement("div");
  el.className = "dash-card";
  const head = document.createElement("div");
  head.className = "dash-card-head";
  head.innerHTML = `<i data-lucide="${icon}" class="icon-sm"></i><span>${title}</span>`;
  const body = document.createElement("div");
  body.className = "dash-card-body";
  el.appendChild(head);
  el.appendChild(body);
  return { el, body };
}

/** Crée une tuile de métrique (label + valeur). */
function metric(label, value, sub) {
  const el = document.createElement("div");
  el.className = "dash-metric";
  el.innerHTML = `<div class="dash-metric-value">${value}</div><div class="dash-metric-label">${label}</div>`;
  if (sub) {
    const s = document.createElement("div");
    s.className = "dash-metric-sub";
    s.textContent = sub;
    el.appendChild(s);
  }
  return el;
}

/** Crée le tableau de bord dans `container`. */
export function createDashboard(container) {
  container.classList.add("dashboard-view");
  container.innerHTML = `
    <div class="dash-scroll">
      <div class="dash-header">
        <div class="dash-header-title">
          <div class="dash-title">📊 Tableau de bord</div>
          <div class="dash-subtitle" id="dash-subtitle">Chargement…</div>
        </div>
        <div class="dash-header-actions">
          <span class="dash-refresh-status" id="dash-refresh-status"></span>
          <button id="dash-refresh" class="web-btn"><i data-lucide="rotate-cw" class="icon-sm"></i> Actualiser</button>
        </div>
      </div>
      <div id="dash-alerts" class="dash-alerts"></div>
      <div id="dash-content" class="dash-grid">
        <div class="dash-loading">Analyse du projet en cours…</div>
      </div>
    </div>
  `;
  refreshIcons(container);

  const contentEl = container.querySelector("#dash-content");
  const alertsEl = container.querySelector("#dash-alerts");
  const subtitleEl = container.querySelector("#dash-subtitle");
  const refreshStatusEl = container.querySelector("#dash-refresh-status");
  const refreshBtn = container.querySelector("#dash-refresh");

  async function load() {
    refreshStatusEl.textContent = "⏳ Analyse…";
    refreshBtn.disabled = true;
    try {
      const data = await invoke("get_project_dashboard");
      render(data);
      refreshStatusEl.textContent = `✓ ${data.project?.refreshed_at || ""}`;
    } catch (e) {
      contentEl.innerHTML = `<div class="dash-error">❌ ${e}</div>`;
      refreshStatusEl.textContent = "✗ Échec";
    } finally {
      refreshBtn.disabled = false;
    }
  }

  function render(data) {
    const p = data.project || {};
    subtitleEl.textContent = `${p.name || ""}${p.client ? ` · ${p.client}` : ""} — ${p.path || ""}`;

    // ── Bandeau d'alertes ──
    alertsEl.innerHTML = "";
    const alerts = data.alerts || [];
    if (alerts.length === 0) {
      const ok = document.createElement("div");
      ok.className = "dash-alert dash-alert-ok";
      ok.textContent = "✅ Aucun point d'attention particulier.";
      alertsEl.appendChild(ok);
    } else {
      for (const a of alerts) {
        const el = document.createElement("div");
        el.className = `dash-alert dash-alert-${a.level || "info"}`;
        el.textContent = (a.level === "warning" ? "⚠️ " : "ℹ️ ") + a.text;
        alertsEl.appendChild(el);
      }
    }

    contentEl.innerHTML = "";
    const grid = document.createElement("div");
    grid.className = "dash-grid";

    // ── Stockage & Poids ──
    const s = data.storage || {};
    const storage = card("Stockage & Poids", "database");
    const sRow = document.createElement("div");
    sRow.className = "dash-metrics-row";
    sRow.appendChild(metric("Taille totale", s.total_size_h || "—"));
    sRow.appendChild(metric("Fichiers", fmt(s.file_count)));
    sRow.appendChild(metric("Dossiers", fmt(s.dir_count)));
    sRow.appendChild(metric("Code source", s.code_size_h || "—", `${fmt(s.code_file_count)} fichiers`));
    storage.body.appendChild(sRow);
    if (s.heaviest && s.heaviest.length) {
      const hTitle = document.createElement("div");
      hTitle.className = "dash-subsection";
      hTitle.textContent = "Fichiers les plus lourds";
      storage.body.appendChild(hTitle);
      const list = document.createElement("ul");
      list.className = "dash-list";
      for (const f of s.heaviest.slice(0, 5)) {
        const li = document.createElement("li");
        const rel = String(f.path || "").split(/[\\/]/).pop();
        li.innerHTML = `<span class="dash-list-path" title="${f.path}">${rel}</span><span class="dash-list-val">${f.size_h}</span>`;
        list.appendChild(li);
      }
      storage.body.appendChild(list);
    }
    grid.appendChild(storage.el);

    // ── État Git ──
    const g = data.git || {};
    const git = card("État Git", "git-branch");
    if (g.is_repo) {
      const gRow = document.createElement("div");
      gRow.className = "dash-metrics-row";
      gRow.appendChild(metric("Branche", g.branch || "—"));
      gRow.appendChild(metric("Modifiés", fmt(g.modified)));
      gRow.appendChild(metric("Non suivis", fmt(g.untracked)));
      gRow.appendChild(metric("Prêts (staged)", fmt(g.staged)));
      git.body.appendChild(gRow);
    } else {
      git.body.innerHTML = `<div class="dash-muted">Ce projet n'est pas un dépôt Git.</div>`;
    }
    grid.appendChild(git.el);

    // ── Analyse du Code & Langages ──
    const l = data.languages || {};
    const lang = card("Analyse du Code & Langages", "code-2");
    const m = l.metrics || {};
    const lRow = document.createElement("div");
    lRow.className = "dash-metrics-row";
    lRow.appendChild(metric("Lignes", fmt(m.lines)));
    lRow.appendChild(metric("Fonctions", fmt(m.functions)));
    lRow.appendChild(metric("Classes", fmt(m.classes)));
    lRow.appendChild(metric("TODO", fmt(l.todos), `${fmt(l.fixmes)} FIXME`));
    lang.body.appendChild(lRow);
    if (l.distribution && l.distribution.length) {
      const dTitle = document.createElement("div");
      dTitle.className = "dash-subsection";
      dTitle.textContent = "Répartition par langage";
      lang.body.appendChild(dTitle);
      const bars = document.createElement("div");
      bars.className = "dash-bars";
      for (const d of l.distribution.slice(0, 8)) {
        const row = document.createElement("div");
        row.className = "dash-bar-row";
        const label = document.createElement("span");
        label.className = "dash-bar-label";
        label.textContent = `${d.name} (${d.files} f.)`;
        const track = document.createElement("div");
        track.className = "dash-bar-track";
        const fill = document.createElement("div");
        fill.className = "dash-bar-fill";
        fill.style.width = `${Math.min(100, d.percent)}%`;
        track.appendChild(fill);
        const pct = document.createElement("span");
        pct.className = "dash-bar-pct";
        pct.textContent = `${d.percent}%`;
        row.appendChild(label);
        row.appendChild(track);
        row.appendChild(pct);
        bars.appendChild(row);
      }
      lang.body.appendChild(bars);
    }
    if (l.dependencies && l.dependencies.length) {
      const depTitle = document.createElement("div");
      depTitle.className = "dash-subsection";
      depTitle.textContent = "Écosystème de dépendances";
      lang.body.appendChild(depTitle);
      const chips = document.createElement("div");
      chips.className = "dash-chips";
      for (const dep of l.dependencies) {
        const c = document.createElement("span");
        c.className = "dash-chip";
        c.textContent = dep;
        chips.appendChild(c);
      }
      lang.body.appendChild(chips);
    }
    grid.appendChild(lang.el);

    // ── Activité & Métriques de l'Agent IA ──
    const a = data.activity || {};
    const act = card("Activité & Métriques de l'Agent IA", "activity");
    const aRow = document.createElement("div");
    aRow.className = "dash-metrics-row";
    aRow.appendChild(metric("Sessions", fmt(a.session_count)));
    aRow.appendChild(metric("Tokens (7 j)", fmt(a.tokens_7d)));
    aRow.appendChild(metric("Messages", fmt(a.total_messages)));
    aRow.appendChild(metric("Dernière session", a.last_session ? a.last_session.slice(0, 10) : "—"));
    act.body.appendChild(aRow);
    const actions = a.actions || {};
    const aRow2 = document.createElement("div");
    aRow2.className = "dash-metrics-row";
    aRow2.appendChild(metric("Actions totales", fmt(actions.total)));
    aRow2.appendChild(metric("Bash", fmt(actions.bash)));
    aRow2.appendChild(metric("Éditions (edit)", fmt(actions.edit)));
    aRow2.appendChild(metric("Écritures (write)", fmt(actions.write)));
    act.body.appendChild(aRow2);
    grid.appendChild(act.el);

    // ── Évolution & Vélocité ──
    const e = data.evolution || {};
    const evo = card("Évolution & Vélocité (7 jours)", "trending-up");
    const eRow = document.createElement("div");
    eRow.className = "dash-metrics-row";
    eRow.appendChild(metric("Commits", fmt(e.commits_7d)));
    eRow.appendChild(metric("Fichiers modifiés", fmt(e.files_modified_7d)));
    eRow.appendChild(metric("Lignes modifiées", fmt(e.lines_modified_7d)));
    eRow.appendChild(metric("Taille modifiée", e.size_modified_7d_h || "—"));
    evo.body.appendChild(eRow);
    grid.appendChild(evo.el);

    // ── Contexte & Documentation ──
    const c = data.context || {};
    const ctx = card("Contexte & Documentation", "book-open");
    if (c.readme) {
      const rTitle = document.createElement("div");
      rTitle.className = "dash-subsection";
      rTitle.textContent = "README";
      ctx.body.appendChild(rTitle);
      const readme = document.createElement("div");
      readme.className = "dash-readme";
      readme.textContent = c.readme;
      ctx.body.appendChild(readme);
    }
    if (c.memory_files && c.memory_files.length) {
      const memTitle = document.createElement("div");
      memTitle.className = "dash-subsection";
      memTitle.textContent = "Mémoire / décisions";
      ctx.body.appendChild(memTitle);
      const chips = document.createElement("div");
      chips.className = "dash-chips";
      for (const f of c.memory_files) {
        const chip = document.createElement("span");
        chip.className = "dash-chip";
        chip.textContent = f;
        chips.appendChild(chip);
      }
      ctx.body.appendChild(chips);
    }
    if (c.recent_files && c.recent_files.length) {
      const recTitle = document.createElement("div");
      recTitle.className = "dash-subsection";
      recTitle.textContent = "Derniers fichiers modifiés";
      ctx.body.appendChild(recTitle);
      const list = document.createElement("ul");
      list.className = "dash-list";
      for (const f of c.recent_files) {
        const li = document.createElement("li");
        li.innerHTML = `<span class="dash-list-path">${f.path}</span><span class="dash-list-val">${relativeTime(f.mtime)}</span>`;
        list.appendChild(li);
      }
      ctx.body.appendChild(list);
    }
    grid.appendChild(ctx.el);

    contentEl.appendChild(grid);
    refreshIcons(container);
  }

  refreshBtn.addEventListener("click", load);
  load();

  return { wrapper: container, unlisten: null };
}
