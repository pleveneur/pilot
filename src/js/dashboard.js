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
import markdownit from "markdown-it";

const md = markdownit({ html: false, linkify: true, typographer: true, breaks: true });

// Palette de couleurs pour les graphiques (cohérente avec le thème).
const CHART_COLORS = [
  "#6b8cff", "#4ade80", "#fbbf24", "#f87171", "#c084fc",
  "#22d3ee", "#fb923c", "#a3e635", "#f472b6", "#34d399",
];

/** Formate une date YYYY-MM-DD en libellé court (JJ/MM). */
function dayLabel(dateStr) {
  const d = String(dateStr || "").split("-");
  return d.length === 3 ? `${d[2]}/${d[1]}` : dateStr;
}

/** Crée un camembert (donut) SVG inline. segments: [{label, value, color}]. */
function donutChart(segments, { size = 120, thickness = 18 } = {}) {
  const NS = "http://www.w3.org/2000/svg";
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.classList.add("dash-donut");
  let offset = 0;
  for (const seg of segments) {
    const frac = seg.value / total;
    const len = frac * c;
    const circle = document.createElementNS(NS, "circle");
    circle.setAttribute("cx", size / 2);
    circle.setAttribute("cy", size / 2);
    circle.setAttribute("r", r);
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke", seg.color);
    circle.setAttribute("stroke-width", thickness);
    circle.setAttribute("stroke-dasharray", `${len} ${c - len}`);
    circle.setAttribute("stroke-dashoffset", -offset);
    circle.setAttribute("transform", `rotate(-90 ${size / 2} ${size / 2})`);
    const title = document.createElementNS(NS, "title");
    title.textContent = `${seg.label} : ${seg.value} (${(frac * 100).toFixed(1)}%)`;
    circle.appendChild(title);
    svg.appendChild(circle);
    offset += len;
  }
  return svg;
}

/** Crée un graphique en barres SVG inline. items: [{label, value}]. */
function barChart(items, { height = 100, color = "var(--accent, #6b8cff)", valueLabel = (v) => v } = {}) {
  const NS = "http://www.w3.org/2000/svg";
  const width = 260;
  const pad = 4;
  const n = items.length;
  const bw = (width - pad * (n + 1)) / n;
  const max = Math.max(...items.map((i) => i.value), 1);
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", "100%");
  svg.classList.add("dash-barchart");
  items.forEach((it, i) => {
    const x = pad + i * (bw + pad);
    const h = (it.value / max) * (height - 24);
    const y = height - 20 - h;
    const rect = document.createElementNS(NS, "rect");
    rect.setAttribute("x", x);
    rect.setAttribute("y", y);
    rect.setAttribute("width", bw);
    rect.setAttribute("height", h);
    rect.setAttribute("rx", 3);
    rect.setAttribute("fill", color);
    const title = document.createElementNS(NS, "title");
    title.textContent = `${it.label} : ${valueLabel(it.value)}`;
    rect.appendChild(title);
    svg.appendChild(rect);
    const text = document.createElementNS(NS, "text");
    text.setAttribute("x", x + bw / 2);
    text.setAttribute("y", height - 6);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("class", "dash-chart-label");
    text.textContent = it.label;
    svg.appendChild(text);
  });
  return svg;
}

/** Crée une légende horizontale pour un donut. */
function legend(items) {
  const el = document.createElement("div");
  el.className = "dash-legend";
  for (const it of items) {
    const item = document.createElement("span");
    item.className = "dash-legend-item";
    const swatch = document.createElement("span");
    swatch.className = "dash-legend-swatch";
    swatch.style.background = it.color;
    const label = document.createElement("span");
    label.textContent = `${it.label} (${it.value})`;
    item.appendChild(swatch);
    item.appendChild(label);
    el.appendChild(item);
  }
  return el;
}

/** Crée une ligne d'insight (« lecture intelligente »). */
function insight(text) {
  const el = document.createElement("div");
  el.className = "dash-insight";
  el.innerHTML = `<i data-lucide="lightbulb" class="icon-sm"></i><span>${text}</span>`;
  return el;
}

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
      const [data, tracking, supervision] = await Promise.all([
        invoke("get_project_dashboard"),
        invoke("get_project_tracking").catch(() => ({ projects: [] })),
        invoke("get_agent_supervision").catch(() => ({ projects: [] })),
      ]);
      render(data, tracking, supervision);
      refreshStatusEl.textContent = `✓ ${data.project?.refreshed_at || ""}`;
    } catch (e) {
      contentEl.innerHTML = `<div class="dash-error">❌ ${e}</div>`;
      refreshStatusEl.textContent = "✗ Échec";
    } finally {
      refreshBtn.disabled = false;
    }
  }

  // Recharge le tableau de bord uniquement si le projet actif a changé depuis
  // le dernier chargement (bascule de projet, ouverture/fermeture). Évite de
  // relancer l'analyse coûteuse à chaque bascule d'onglet dans le même projet.
  let lastProjectPath = window._pilotProjectPath || null;
  function refreshIfProjectChanged() {
    const cur = window._pilotProjectPath || null;
    if (cur !== lastProjectPath) {
      lastProjectPath = cur;
      load();
    }
  }

  // Recharge aussi quand le projet change alors que l'onglet 📊 est DÉJÀ actif
  // (fermeture/ouverture de projet depuis la barre latérale) : sans cela il
  // resterait sur des données périmées jusqu'au prochain switchTab.
  const onProjectSensitivity = () => refreshIfProjectChanged();
  document.addEventListener("pilot-project-sensitivity", onProjectSensitivity);

  function render(data, tracking, supervision) {
    const hasProject = data.has_project !== false;
    const p = data.project || {};
    subtitleEl.textContent = hasProject
      ? `${p.name || ""}${p.client ? ` · ${p.client}` : ""} — ${p.path || ""}`
      : "Aucun projet ouvert — activité de l'agent IA";

    // ── Bandeau d'alertes (partie projet uniquement) ──
    alertsEl.innerHTML = "";
    if (hasProject) {
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
    }

    contentEl.innerHTML = "";
    const grid = document.createElement("div");
    grid.className = "dash-grid";

    // ── Activité & Métriques de l'Agent IA (toujours visible) ──
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

    // ── Graphique : tokens & messages par jour (7 jours) ──
    const byDay = a.by_day || [];
    if (byDay.length) {
      const actTitle = document.createElement("div");
      actTitle.className = "dash-subsection";
      actTitle.textContent = "Activité par jour (7 jours)";
      act.body.appendChild(actTitle);
      const chartRow = document.createElement("div");
      chartRow.className = "dash-chart-row";
      const tBox = document.createElement("div");
      tBox.className = "dash-chart-box";
      tBox.appendChild(barChart(byDay.map((d) => ({ label: dayLabel(d.date), value: d.tokens || 0 })), { color: "var(--accent, #6b8cff)", valueLabel: fmt }));
      const tCap = document.createElement("div");
      tCap.className = "dash-chart-caption";
      tCap.textContent = "Tokens";
      tBox.appendChild(tCap);
      const mBox = document.createElement("div");
      mBox.className = "dash-chart-box";
      mBox.appendChild(barChart(byDay.map((d) => ({ label: dayLabel(d.date), value: d.messages || 0 })), { color: "#4ade80", valueLabel: fmt }));
      const mCap = document.createElement("div");
      mCap.className = "dash-chart-caption";
      mCap.textContent = "Messages";
      mBox.appendChild(mCap);
      chartRow.appendChild(tBox);
      chartRow.appendChild(mBox);
      act.body.appendChild(chartRow);
      const busiest = byDay.reduce((x, y) => ((y.tokens || 0) > (x.tokens || 0) ? y : x), byDay[0]);
      act.body.appendChild(insight(`Pic d'activité le ${busiest.date} (${fmt(busiest.tokens || 0)} tokens).`));
    }

    // ── Donut : répartition des actions de l'agent ──
    const autres = Math.max(0, (actions.total || 0) - (actions.bash || 0) - (actions.edit || 0) - (actions.write || 0));
    const actionSegs = [
      { label: "Bash", value: actions.bash || 0, color: CHART_COLORS[0] },
      { label: "Éditions", value: actions.edit || 0, color: CHART_COLORS[1] },
      { label: "Écritures", value: actions.write || 0, color: CHART_COLORS[2] },
      { label: "Autres", value: autres, color: CHART_COLORS[3] },
    ].filter((s) => s.value > 0);
    if (actionSegs.length) {
      const actTitle2 = document.createElement("div");
      actTitle2.className = "dash-subsection";
      actTitle2.textContent = "Répartition des actions";
      act.body.appendChild(actTitle2);
      const donutRow = document.createElement("div");
      donutRow.className = "dash-donut-row";
      donutRow.appendChild(donutChart(actionSegs));
      donutRow.appendChild(legend(actionSegs));
      act.body.appendChild(donutRow);
      const topAction = actionSegs.reduce((x, y) => (y.value > x.value ? y : x));
      act.body.appendChild(insight(`L'action la plus fréquente est ${topAction.label} (${fmt(topAction.value)}).`));
    }
    grid.appendChild(act.el);

    // ── Suivi multi-projets (via commande Rust get_project_tracking) ──
    // Affiché dès qu'au moins un projet est connu du suivi. Présente un tableau
    // récapitulatif : client, statut, tâches (ouvertes/total), activité de
    // l'agent et dernière session indexée. Permet de superviser tous les
    // projets ouverts d'un coup d'œil.
    const trackingProjects = (tracking && tracking.projects) || [];
    if (trackingProjects.length > 0) {
      const tr = card("Suivi multi-projets", "folders");
      // Sur grand écran, la table de suivi occupe toute la largeur (A12).
      tr.el.classList.add("dash-card-wide");
      const tbl = document.createElement("div");
      tbl.className = "dash-tracking-table";
      // En-tête.
      const head = document.createElement("div");
      head.className = "dash-tracking-row dash-tracking-head";
      head.innerHTML = `<span>Projet</span><span>Client</span><span>Statut</span><span>Tâches</span><span>Agent</span><span>Dernière session</span>`;
      tbl.appendChild(head);
      for (const p of trackingProjects) {
        const row = document.createElement("div");
        row.className = "dash-tracking-row" + (p.active ? " dash-tracking-active" : "");
        const nameCell = document.createElement("span");
        nameCell.className = "dash-tracking-name";
        nameCell.innerHTML = `${p.active ? "📍 " : ""}${p.name || ""}<span class="dash-tracking-path" title="${p.path || ""}">${p.path || ""}</span>`;
        const clientCell = document.createElement("span");
        clientCell.textContent = p.client || "—";
        const statusCell = document.createElement("span");
        statusCell.className = "dash-chip";
        statusCell.textContent = p.status || "suivi";
        const tasksCell = document.createElement("span");
        tasksCell.textContent = `${p.open_tasks || 0}/${p.task_count || 0}`;
        const agentCell = document.createElement("span");
        agentCell.className = "dash-tracking-agent" + (p.agent_busy ? " busy" : "");
        agentCell.innerHTML = p.agent_busy ? '<i data-lucide="loader" class="icon-sm"></i> En cours' : '✓ Prêt';
        const lastCell = document.createElement("span");
        lastCell.className = "dash-muted";
        lastCell.textContent = p.last_session ? String(p.last_session).slice(0, 10) : "—";
        row.appendChild(nameCell);
        row.appendChild(clientCell);
        row.appendChild(statusCell);
        row.appendChild(tasksCell);
        row.appendChild(agentCell);
        row.appendChild(lastCell);
        tbl.appendChild(row);
      }
      tr.body.appendChild(tbl);
      const openCount = trackingProjects.reduce((s, p) => s + (p.open_tasks || 0), 0);
      const busyCount = trackingProjects.filter((p) => p.agent_busy).length;
      tr.body.appendChild(insight(`${trackingProjects.length} projet(s) suivi(s) — ${openCount} tâche(s) ouverte(s), ${busyCount} agent(s) actif(s).`));
      grid.insertBefore(tr.el, grid.firstChild);
    }

    // ── Supervision des agents (P8) : vue agrégée des agents en cours sur
    // tous les projets, par projet, avec leur état (running / paused /
    // compacting / stopped). Réutilise la commande Rust get_agent_supervision
    // qui s'appuie sur AgentService::list_agent_sessions (P2).
    const supProjects = (supervision && supervision.projects) || [];
    if (supProjects.length > 0) {
      const sup = card("Supervision des agents", "activity");
      sup.el.classList.add("dash-card-wide");
      const supTbl = document.createElement("div");
      supTbl.className = "dash-tracking-table";
      const supHead = document.createElement("div");
      supHead.className = "dash-tracking-row dash-tracking-head";
      supHead.innerHTML = `<span>Projet</span><span>Agent</span><span>État</span><span>Mode</span>`;
      supTbl.appendChild(supHead);
      for (const proj of supProjects) {
        const agents = proj.agents || [];
        if (agents.length === 0) continue;
        for (const ag of agents) {
          const row = document.createElement("div");
          row.className = "dash-tracking-row";
          const projCell = document.createElement("span");
          projCell.className = "dash-tracking-name";
          projCell.innerHTML = `${proj.name || ""}<span class="dash-tracking-path" title="${proj.path || ""}">${proj.path || ""}</span>`;
          const agentCell = document.createElement("span");
          agentCell.textContent = ag.agent || "—";
          const stateCell = document.createElement("span");
          stateCell.className = "dash-chip";
          const st = ag.state || "stopped";
          stateCell.textContent = st;
          if (st === "running") stateCell.classList.add("dash-chip-running");
          else if (st === "paused") stateCell.classList.add("dash-chip-paused");
          else if (st === "compacting") stateCell.classList.add("dash-chip-compacting");
          else stateCell.classList.add("dash-chip-stopped");
          const modeCell = document.createElement("span");
          modeCell.className = "dash-muted";
          modeCell.textContent = ag.mode || "—";
          row.appendChild(projCell);
          row.appendChild(agentCell);
          row.appendChild(stateCell);
          row.appendChild(modeCell);
          supTbl.appendChild(row);
        }
      }
      sup.body.appendChild(supTbl);
      const runningCount = supProjects.reduce(
        (s, p) => s + (p.agents || []).filter((a) => a.state === "running").length,
        0
      );
      sup.body.appendChild(insight(`${runningCount} agent(s) en cours d'exécution sur ${supProjects.length} projet(s).`));
      grid.appendChild(sup.el);
    }

    // ── Partie projet (visible seulement quand un projet est ouvert) ──
    if (hasProject) {
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
      // ── Donut : code source vs non-code ──
      const codeSize = s.code_size || 0;
      const nonCode = Math.max(0, (s.total_size || 0) - codeSize);
      const storageSegs = [
        { label: "Code source", value: codeSize, color: CHART_COLORS[0] },
        { label: "Non-code", value: nonCode, color: CHART_COLORS[4] },
      ].filter((x) => x.value > 0);
      if (storageSegs.length) {
        const stTitle = document.createElement("div");
        stTitle.className = "dash-subsection";
        stTitle.textContent = "Code source vs non-code";
        storage.body.appendChild(stTitle);
        const donutRow = document.createElement("div");
        donutRow.className = "dash-donut-row";
        donutRow.appendChild(donutChart(storageSegs));
        donutRow.appendChild(legend(storageSegs));
        storage.body.appendChild(donutRow);
        const pct = (s.total_size || 0) > 0 ? Math.round((codeSize / s.total_size) * 100) : 0;
        storage.body.appendChild(insight(`Le code source représente ${pct}% du stockage total.`));
      }
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
        // ── Donut : répartition des langages ──
        const langSegs = l.distribution.slice(0, 8).map((d, i) => ({
          label: d.name,
          value: d.files || 0,
          color: CHART_COLORS[i % CHART_COLORS.length],
        }));
        if (langSegs.length) {
          const donutRow = document.createElement("div");
          donutRow.className = "dash-donut-row";
          donutRow.appendChild(donutChart(langSegs));
          donutRow.appendChild(legend(langSegs));
          lang.body.appendChild(donutRow);
          const top = langSegs.reduce((x, y) => (y.value > x.value ? y : x));
          const topPct = l.distribution[0] ? l.distribution[0].percent : 0;
          lang.body.appendChild(insight(`Le projet est dominé par ${top.label} (${topPct}%).`));
        }
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
      // ── Barres : commits & fichiers modifiés par jour (7 jours) ──
      const commitsByDay = e.commits_by_day || [];
      const filesByDay = e.files_by_day || [];
      if (commitsByDay.length || filesByDay.length) {
        const evoTitle = document.createElement("div");
        evoTitle.className = "dash-subsection";
        evoTitle.textContent = "Par jour (7 jours)";
        evo.body.appendChild(evoTitle);
        const chartRow = document.createElement("div");
        chartRow.className = "dash-chart-row";
        if (commitsByDay.length) {
          const cBox = document.createElement("div");
          cBox.className = "dash-chart-box";
          cBox.appendChild(barChart(commitsByDay.map((d) => ({ label: dayLabel(d.date), value: d.value || 0 })), { color: "var(--accent, #6b8cff)", valueLabel: fmt }));
          const cCap = document.createElement("div");
          cCap.className = "dash-chart-caption";
          cCap.textContent = "Commits";
          cBox.appendChild(cCap);
          chartRow.appendChild(cBox);
        }
        if (filesByDay.length) {
          const fBox = document.createElement("div");
          fBox.className = "dash-chart-box";
          fBox.appendChild(barChart(filesByDay.map((d) => ({ label: dayLabel(d.date), value: d.value || 0 })), { color: "#4ade80", valueLabel: fmt }));
          const fCap = document.createElement("div");
          fCap.className = "dash-chart-caption";
          fCap.textContent = "Fichiers modifiés";
          fBox.appendChild(fCap);
          chartRow.appendChild(fBox);
        }
        evo.body.appendChild(chartRow);
        const totalCommits = commitsByDay.reduce((s, d) => s + (d.value || 0), 0);
        if (totalCommits > 0) {
          const busiest = commitsByDay.reduce((x, y) => ((y.value || 0) > (x.value || 0) ? y : x), commitsByDay[0]);
          evo.body.appendChild(insight(`Pic de commits le ${busiest.date} (${fmt(busiest.value || 0)}).`));
        }
      }
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
        readme.innerHTML = md.render(c.readme);
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
    }

    contentEl.appendChild(grid);
    refreshIcons(container);
  }

  refreshBtn.addEventListener("click", load);
  load();

  // ── Auto-refresh (configurable, défaut 10 s, activé par défaut) ──
  // L'onglet 📊 recharge ses données automatiquement tant qu'il est actif/
  // visible. Le timer est piloté par la config (`dashboard_auto_refresh` +
  // `dashboard_auto_refresh_seconds`) et n'est actif que quand l'onglet est
  // l'onglet courant (pas de travail en arrière-plan inutile).
  let autoTimer = null;
  let autoConfig = { enabled: true, seconds: 10 };
  let isActiveTab = true; // supposé actif à l'ouverture

  async function loadAutoConfig() {
    try {
      const cfg = await invoke("get_config");
      autoConfig.enabled = cfg.dashboard_auto_refresh !== false;
      const s = parseInt(cfg.dashboard_auto_refresh_seconds, 10);
      autoConfig.seconds = Number.isFinite(s) && s >= 2 ? s : 10;
    } catch (_) {
      /* config indisponible : on garde les défauts */
    }
    scheduleAuto();
  }

  function scheduleAuto() {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    if (!autoConfig.enabled || !isActiveTab) return;
    const ms = Math.max(2, autoConfig.seconds) * 1000;
    autoTimer = setInterval(() => {
      // Ne pas relancer si un chargement est déjà en cours (refreshBtn.disabled).
      if (!refreshBtn.disabled) load();
    }, ms);
  }

  // Le tableau de bord est informé de son activation par `tabs.js` via la
  // méthode `setActive` exposée ci-dessous (appelée dans switchTab).
  function setActive(active) {
    isActiveTab = !!active;
    scheduleAuto();
    if (active) refreshIfProjectChanged();
  }

  // Recharger la config auto quand les paramètres changent (option activée/
  // désactivée ou durée modifiée) pour réagir sans redémarrage.
  document.addEventListener("pilot-config-changed", loadAutoConfig);
  loadAutoConfig();

  return {
    wrapper: container,
    unlisten: () => {
      document.removeEventListener("pilot-project-sensitivity", onProjectSensitivity);
      document.removeEventListener("pilot-config-changed", loadAutoConfig);
      if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    },
    refresh: refreshIfProjectChanged,
    setActive,
  };
}
