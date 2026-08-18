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

/** Affiche une boîte de dialogue de confirmation personnalisée (Promise<bool>). */
function confirmDialog(title, bodyHtml) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const dlg = document.createElement("div");
    dlg.className = "modal-dialog";
    dlg.innerHTML = `
      <div class="modal-title">${title}</div>
      <div class="modal-body">${bodyHtml}</div>
      <div class="modal-actions">
        <button class="web-btn" data-act="cancel">Annuler</button>
        <button class="web-btn web-btn-danger" data-act="ok">Confirmer</button>
      </div>`;
    overlay.appendChild(dlg);
    document.body.appendChild(overlay);
    const close = (val) => { overlay.remove(); resolve(val); };
    dlg.querySelector('[data-act="cancel"]').addEventListener("click", () => close(false));
    dlg.querySelector('[data-act="ok"]').addEventListener("click", () => close(true));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(false); });
  });
}

/** Formate une taille en octets en libellé lisible (o / Ko / Mo / Go). */
function humanSize(bytes) {
  const b = Number(bytes || 0);
  const KB = 1024, MB = KB * 1024, GB = MB * 1024;
  if (b >= GB) return (b / GB).toFixed(1) + " Go";
  if (b >= MB) return (b / MB).toFixed(1) + " Mo";
  if (b >= KB) return (b / KB).toFixed(1) + " Ko";
  return b + " o";
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

  // ── Purge des fichiers inutiles : charge la liste des éléments purgeables,
  // affiche les checkboxes + bouton, gère la confirmation et le feedback. ──
  async function loadPurgeable(purgeBody, purgeCard, projectPath) {
    if (!projectPath) { purgeCard.style.display = "none"; return; }
    let items = [];
    try {
      items = await invoke("list_purgeable_items", { projectPath });
    } catch (e) {
      purgeCard.style.display = "none";
      return;
    }
    if (!items || items.length === 0) {
      purgeCard.style.display = "none";
      return;
    }
    purgeCard.style.display = "";
    purgeBody.innerHTML = "";

    const intro = document.createElement("div");
    intro.className = "dash-muted";
    intro.textContent = "Éléments détectés comme purgeables (dépendances, caches, artefacts de build, fichiers temporaires). Cochez les éléments à supprimer, puis cliquez « Purger la sélection ».";
    purgeBody.appendChild(intro);

    const list = document.createElement("div");
    list.className = "dash-purge-list";
    const checkboxes = [];
    for (const it of items) {
      const row = document.createElement("label");
      row.className = "dash-purge-row" + (it.category === "git_gc" ? " dash-purge-gc" : "");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.dataset.item = JSON.stringify(it);
      const label = document.createElement("span");
      label.className = "dash-purge-label";
      const rel = String(it.path || "").replace(projectPath, "").replace(/^[\\\\/]+/, "");
      label.innerHTML = `<strong>${it.name}</strong> <span class="dash-muted">${rel}</span>`;
      const size = document.createElement("span");
      size.className = "dash-list-val";
      size.textContent = it.size_h || humanSize(it.size);
      row.appendChild(cb);
      row.appendChild(label);
      row.appendChild(size);
      list.appendChild(row);
      checkboxes.push(cb);
    }
    purgeBody.appendChild(list);

    const actions = document.createElement("div");
    actions.className = "dash-purge-actions";
    const btn = document.createElement("button");
    btn.className = "web-btn web-btn-danger";
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="trash-2" class="icon-sm"></i> Purger la sélection';
    const feedback = document.createElement("div");
    feedback.className = "dash-purge-feedback";
    actions.appendChild(btn);
    actions.appendChild(feedback);
    purgeBody.appendChild(actions);

    const updateBtn = () => {
      const checked = checkboxes.filter((c) => c.checked);
      btn.disabled = checked.length === 0;
    };
    checkboxes.forEach((c) => c.addEventListener("change", updateBtn));

    btn.addEventListener("click", async () => {
      const checked = checkboxes.filter((c) => c.checked);
      if (!checked.length) return;
      const selected = checked.map((c) => JSON.parse(c.dataset.item));
      const totalBytes = selected.reduce((s, it) => s + (Number(it.size) || 0), 0);
      const isGcOnly = selected.length === 1 && selected[0].category === "git_gc";
      const summary = selected
        .map((it) => `<li>${it.name} ${it.category !== "git_gc" ? `<span class=\"dash-muted\">(${it.size_h || humanSize(it.size)})</span>` : ""}</li>`)
        .join("");
      const body = isGcOnly
        ? `<p>Voulez-vous compacter le dépôt Git (git gc) ?</p><p class="dash-muted">L'historique n'est pas supprimé.</p>`
        : `<p>Voulez-vous vraiment supprimer ces éléments ?</p><ul>${summary}</ul><p><strong>${humanSize(totalBytes)} seront libérés.</strong> Cette action est irréversible.</p>`;
      const ok = await confirmDialog("Confirmer la purge", body);
      if (!ok) return;
      btn.disabled = true;
      feedback.textContent = "Purge en cours…";
      try {
        const res = await invoke("purge_project_items", { projectPath, items: selected });
        const details = res.details || [];
        const okCount = details.filter((d) => d.ok).length;
        const failCount = details.length - okCount;
        feedback.innerHTML = `<strong>${res.freed_h || humanSize(res.freed)} libérés</strong> — ${okCount} réussite(s)${failCount ? `, ${failCount} échec(s)` : ""}.`;
        if (failCount) {
          const errs = details.filter((d) => !d.ok).map((d) => `${d.name}: ${d.error}`).join("\n");
          feedback.innerHTML += `<div class="dash-muted" style="white-space:pre-wrap;margin-top:4px">${errs}</div>`;
        }
        // Rafraîchir le dashboard (métriques + purge) après purge.
        await load();
      } catch (e) {
        feedback.innerHTML = `<span class="dash-error">❌ ${e}</span>`;
        btn.disabled = false;
      }
    });

    refreshIcons(purgeBody);
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
        // Détail : décisions et sessions récentes du projet (base de
        // l'assistant). Affiché uniquement si au moins un élément est
        // présent. Ligne pleine largeur sous la ligne du projet.
        const dec = Array.isArray(p.decisions_recentes) ? p.decisions_recentes : [];
        const ses = Array.isArray(p.sessions_recentes) ? p.sessions_recentes : [];
        if (dec.length || ses.length) {
          const detail = document.createElement("div");
          detail.className = "dash-tracking-detail";
          detail.style.cssText =
            "padding:4px 8px 8px;border-radius:6px;" +
            "background:color-mix(in srgb,var(--surface-2,#1c2029) 40%,transparent);" +
            "font-size:11px;color:var(--text-secondary,#a0a6b4);";
          const mkBlock = (label, items) => {
            if (!items.length) return null;
            const wrap = document.createElement("div");
            wrap.style.cssText = "margin-top:4px;";
            const t = document.createElement("div");
            t.style.cssText =
              "font-weight:600;color:var(--text-muted,#6b7280);text-transform:uppercase;" +
              "letter-spacing:0.03em;font-size:10px;";
            t.textContent = label;
            wrap.appendChild(t);
            const ul = document.createElement("ul");
            ul.style.cssText = "margin:2px 0 0;padding-left:16px;line-height:1.4;";
            for (const it of items) {
              const li = document.createElement("li");
              const txt = String(it || "");
              // Tronquer les résumés trop longs (max ~140 caractères).
              li.textContent = txt.length > 140 ? txt.slice(0, 137) + "…" : txt;
              ul.appendChild(li);
            }
            wrap.appendChild(ul);
            return wrap;
          };
          const dBlock = mkBlock("Décisions", dec);
          const sBlock = mkBlock("Sessions", ses);
          if (dBlock) detail.appendChild(dBlock);
          if (sBlock) detail.appendChild(sBlock);
          tbl.appendChild(detail);
        }
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
      sRow.appendChild(metric("Taille totale (hors exclus)", s.total_size_h || "—"));
      sRow.appendChild(metric("Taille réelle sur disque", s.disk_size_h || "—", "tout compris"));
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

      // ── Purge des fichiers inutiles (visible si éléments purgeables) ──
      const purge = card("Purge des fichiers inutiles", "trash-2");
      purge.el.classList.add("dash-card-wide");
      purge.el.style.display = "none";
      const purgeBody = purge.body;
      purgeBody.innerHTML = '<div class="dash-muted">Analyse des éléments purgeables…</div>';
      grid.appendChild(purge.el);
      // Chargement asynchrone des éléments purgeables (non bloquant).
      loadPurgeable(purgeBody, purge.el, p.path || "");

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
  let autoConfig = { enabled: true, seconds: 120 };
  let isActiveTab = true; // supposé actif à l'ouverture

  async function loadAutoConfig() {
    try {
      const cfg = await invoke("get_config");
      autoConfig.enabled = cfg.dashboard_auto_refresh !== false;
      const s = parseInt(cfg.dashboard_auto_refresh_seconds, 10);
      autoConfig.seconds = Number.isFinite(s) && s >= 2 ? s : 120;
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
