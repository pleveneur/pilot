// code-graph-view.js — Onglet « Graphe » : visualisation 2D du Code Graph
//
// Voir spec_code_graph.md (Option C). Remplace l'ancienne modale 📊 par un
// onglet dédié : en haut l'état + (re)construction (ancien contenu de la
// modale), en dessous la visualisation interactive du graphe (force-graph 2D).
//
// Fonctionnalités :
//   - Pan/zoom + disposition force-directed (force-graph, WebGL/Canvas).
//   - Clic sur un nœud → ouvre le fichier correspondant dans un onglet d'édition.
//   - Survol → surligne les connexions (calls / imports / extends).
//   - Coloration par type (fichier / classe / fonction / méthode / import / module).
//   - Filtres : par type de relation, par fichier, recherche de nœud.
//   - Sous-graphe contextuel : voisinage du fichier actif (analyse d'impact
//     avant édition), bascule vers le graphe complet.
//   - Légende des couleurs (nœuds + relations).
//
// force-graph est chargé en lazy (import dynamique) pour ne pas gonfler le
// bundle au démarrage.

import { invoke } from "@tauri-apps/api/core";
import { graphStatus, rebuildGraph } from "./code-graph.js";

// Couleurs par type de nœud — palettes adaptées au thème (sombre / clair).
const KIND_COLORS_DARK = {
  file: "#8b949e",
  module: "#d29922",
  class: "#f0883e",
  function: "#58a6ff",
  method: "#79c0ff",
  import: "#3fb950",
};
const KIND_COLORS_LIGHT = {
  file: "#6b7280",
  module: "#b45309",
  class: "#c2410c",
  function: "#1d4ed8",
  method: "#2563eb",
  import: "#15803d",
};

// Couleurs par type de relation — palettes adaptées au thème.
const RELATION_COLORS_DARK = {
  calls: "#ff6b6b",
  imports: "#4ade80",
  inherits: "#d2a8ff",
  references: "#a0a6b4",
  uses: "#6b8cff",
};
const RELATION_COLORS_LIGHT = {
  calls: "#d64545",
  imports: "#1f9d55",
  inherits: "#8b5cf6",
  references: "#6b7280",
  uses: "#3b5bdb",
};

function isLightTheme() {
  return document.body.classList.contains("theme-light");
}
function kindColors() {
  return isLightTheme() ? KIND_COLORS_LIGHT : KIND_COLORS_DARK;
}
function relationColors() {
  return isLightTheme() ? RELATION_COLORS_LIGHT : RELATION_COLORS_DARK;
}

/** Ajoute un canal alpha à une couleur hexadécimale #rrggbb. */
function withAlpha(hex, alpha) {
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
    const a = Math.round(alpha * 255).toString(16).padStart(2, "0");
    return hex + a;
  }
  return hex;
}

/** Trace un rectangle aux coins arrondis (compatible WebView2). */
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Crée la vue de l'onglet Graphe dans `wrapper`.
 * @param {HTMLElement} wrapper - conteneur de l'onglet (editor-wrapper)
 * @returns {{wrapper: HTMLElement, unlisten: Function}}
 */
export function createCodeGraphView(wrapper) {
  let graph = null; // instance force-graph
  let fullData = { nodes: [], edges: [] }; // graphe complet exporté
  let currentData = { nodes: [], edges: [] }; // sous-ensemble affiché
  let destroyed = false;
  let fitPending = false; // recentrage à la prochaine stabilisation
  let autoAggregated = false; // vue par fichier auto-activée (1re ouverture)
  let focusedNode = null; // nœud sur lequel le graphe est recentré (voisinage)
  let lastClick = { id: null, time: 0 }; // détection double-clic

  // ── Construction du DOM ──
  wrapper.classList.add("codegraph-view");
  wrapper.innerHTML = `
    <div class="codegraph-panel">
      <div class="codegraph-toolbar">
        <div class="codegraph-status" id="cg-status"><span class="muted">Chargement…</span></div>
        <div class="codegraph-actions">
          <button id="cg-rebuild" class="web-btn"><i data-lucide="refresh-cw" class="icon-sm"></i> (Re)construire</button>
          <button id="cg-refresh" class="web-btn"><i data-lucide="rotate-cw" class="icon-sm"></i> Actualiser</button>
        </div>
      </div>
      <div class="codegraph-filters">
        <input id="cg-search" type="text" placeholder="🔍 Rechercher un nœud…" class="cg-input" />
        <select id="cg-relation-filter" class="cg-input" title="Filtrer par type de relation">
          <option value="">Toutes les relations</option>
          <option value="calls">calls</option>
          <option value="imports">imports</option>
          <option value="inherits">inherits</option>
          <option value="references">references</option>
          <option value="uses">uses</option>
        </select>
        <select id="cg-file-filter" class="cg-input" title="Filtrer par fichier">
          <option value="">Tous les fichiers</option>
        </select>
        <label class="cg-check" title="Regrouper les nœuds par fichier (vue module) — recommandé pour les gros projets">
          <input type="checkbox" id="cg-aggregate" /> Vue par fichier
        </label>
        <label class="cg-check" title="Afficher uniquement le voisinage du fichier actif">
          <input type="checkbox" id="cg-contextual" /> Sous-graphe (fichier actif)
        </label>
        <span id="cg-count" class="muted cg-count"></span>
      </div>
      <div class="codegraph-focus hidden" id="cg-focus">
        <span class="cg-focus-label">Focus : <b id="cg-focus-label"></b></span>
        <button id="cg-focus-reset" class="web-btn cg-focus-reset"><i data-lucide="x" class="icon-sm"></i> Réinitialiser</button>
      </div>
      <div class="codegraph-legend" id="cg-legend"></div>
      <div id="cg-canvas" class="codegraph-canvas"></div>
    </div>
  `;

  const statusEl = wrapper.querySelector("#cg-status");
  const canvasEl = wrapper.querySelector("#cg-canvas");
  const legendEl = wrapper.querySelector("#cg-legend");
  const searchEl = wrapper.querySelector("#cg-search");
  const relationEl = wrapper.querySelector("#cg-relation-filter");
  const fileEl = wrapper.querySelector("#cg-file-filter");
  const aggregateEl = wrapper.querySelector("#cg-aggregate");
  const contextualEl = wrapper.querySelector("#cg-contextual");
  const countEl = wrapper.querySelector("#cg-count");
  const focusEl = wrapper.querySelector("#cg-focus");
  const focusLabelEl = wrapper.querySelector("#cg-focus-label");
  const focusResetEl = wrapper.querySelector("#cg-focus-reset");
  const btnRebuild = wrapper.querySelector("#cg-rebuild");
  const btnRefresh = wrapper.querySelector("#cg-refresh");

  const projectPath = () => window._pilotProjectPath || "";

  // Couleurs du thème courant (variables CSS résolues).
  function themeColors() {
    const cs = getComputedStyle(document.body);
    return {
      bg: cs.getPropertyValue("--bg-editor").trim() || "#16181d",
      text: cs.getPropertyValue("--text-primary").trim() || "#e6e8ee",
      muted: cs.getPropertyValue("--text-secondary").trim() || "#a0a6b4",
      border: cs.getPropertyValue("--border").trim() || "rgba(255,255,255,0.12)",
    };
  }

  // ── Légende (couleurs des nœuds + relations) ──
  function renderLegend() {
    if (!legendEl) return;
    const nodeItems = Object.entries(kindColors())
      .map(([k, c]) => `<span class="cg-legend-item"><i class="cg-dot" style="background:${c}"></i>${k}</span>`)
      .join("");
    const relItems = Object.entries(relationColors())
      .map(([k, c]) => `<span class="cg-legend-item"><i class="cg-line" style="background:${c}"></i>${k}</span>`)
      .join("");
    legendEl.innerHTML =
      `<span class="cg-legend-title">Nœuds</span>${nodeItems}` +
      `<span class="cg-legend-sep"></span>` +
      `<span class="cg-legend-title">Relations</span>${relItems}` +
      `<span class="cg-legend-hint">· survol = connexions · clic = ouvrir le fichier · « Vue par fichier » pour les gros projets</span>`;
  }
  renderLegend();

  // ── Rendu de l'état (ancien contenu de la modale) ──
  function renderStatus(s) {
    if (!statusEl) return;
    const p = projectPath();
    if (!p) {
      statusEl.innerHTML = '<span class="muted">Ouvrez d\'abord un projet pour construire le graphe.</span>';
      return;
    }
    if (!s || !s.exists) {
      statusEl.innerHTML =
        '<span class="muted">Aucun graphe construit pour ce projet.</span> ' +
        '<small class="muted">Le graphe est construit automatiquement au 1er prompt (mode A) et mis à jour au fil de l\'eau. ' +
        'Cliquez sur « (Re)construire » pour le générer maintenant.</small>';
      return;
    }
    statusEl.innerHTML =
      `<span><b>Graphe construit</b> (${s.ready ? "prêt" : "vide"})</span>` +
      `<span> · Nœuds : <b>${s.nodes}</b> · Arêtes : <b>${s.edges}</b> · Construit le ${s.built_at || "—"}</span>` +
      '<span class="muted"> · Relations EXTRACTED (lues) / INFERRED (déduites)</span>';
  }

  // ── Sous-graphe contextuel : voisinage du fichier actif ──
  function buildContextualSubgraph(data) {
    // Le fichier actif est mémorisé dans window._lastEditedFile (capturé avant
    // l'ouverture de l'onglet Graphe, car l'onglet Graphe devient actif ensuite).
    const path = window._lastEditedFile ? window._lastEditedFile.replace(/\\/g, "/") : null;
    if (!path) return null;

    // Nœuds du fichier actif + leurs voisins directs.
    const fileNodes = data.nodes.filter((n) => n.path === path);
    if (fileNodes.length === 0) return null;
    const fileIds = new Set(fileNodes.map((n) => n.id));
    const neighborIds = new Set(fileIds);
    const keptEdges = data.edges.filter((e) => fileIds.has(e.source) || fileIds.has(e.target));
    for (const e of keptEdges) {
      neighborIds.add(e.source);
      neighborIds.add(e.target);
    }
    const keptNodes = data.nodes.filter((n) => neighborIds.has(n.id));
    return { nodes: keptNodes, edges: keptEdges, fileIds };
  }

  // ── Agrégation par fichier (vue « module ») pour les gros graphes ──
  // Regroupe tous les nœuds d'un même fichier en un seul nœud-fichier et
  // agrège les arêtes entre fichiers (relation dominante + nombre). Rend un
  // gros projet lisible (dépendances entre fichiers au lieu d'une pelote).
  function aggregateByFile(data) {
    const byPath = new Map();
    for (const n of data.nodes) {
      if (!byPath.has(n.path)) byPath.set(n.path, []);
      byPath.get(n.path).push(n);
    }
    const idToFile = new Map();
    for (const n of data.nodes) idToFile.set(n.id, n.path);

    const fileNodes = [];
    for (const [path, nodes] of byPath) {
      const label = path.split("/").pop() || path;
      fileNodes.push({
        id: "file:" + path,
        label,
        kind: "file",
        path,
        line: 0,
        _count: nodes.length, // nb de symboles internes → taille du nœud
      });
    }

    const edgeMap = new Map(); // "src|tgt" -> {source, target, relCounts, path}
    for (const e of data.edges) {
      const s = idToFile.get(e.source);
      const t = idToFile.get(e.target);
      if (!s || !t || s === t) continue;
      const key = s + "|" + t;
      if (!edgeMap.has(key)) {
        edgeMap.set(key, { source: "file:" + s, target: "file:" + t, relCounts: {}, path: e.path });
      }
      const agg = edgeMap.get(key);
      agg.relCounts[e.relation] = (agg.relCounts[e.relation] || 0) + 1;
    }
    const fileEdges = [];
    for (const agg of edgeMap.values()) {
      let bestRel = null, bestCount = -1;
      for (const [rel, c] of Object.entries(agg.relCounts)) {
        if (c > bestCount) { bestCount = c; bestRel = rel; }
      }
      fileEdges.push({
        source: agg.source,
        target: agg.target,
        relation: bestRel,
        confidence: "EXTRACTED",
        path: agg.path,
        count: bestCount,
      });
    }
    return { nodes: fileNodes, edges: fileEdges };
  }

  // ── Sous-graphe de focus : voisinage direct d'un nœud sélectionné ──
  function buildFocusSubgraph(data, focusId) {
    const focus = data.nodes.find((n) => n.id === focusId);
    if (!focus) return null;
    const neighborIds = new Set([focusId]);
    const keptEdges = data.edges.filter((e) => e.source === focusId || e.target === focusId);
    for (const e of keptEdges) {
      neighborIds.add(e.source);
      neighborIds.add(e.target);
    }
    const keptNodes = data.nodes.filter((n) => neighborIds.has(n.id));
    return { nodes: keptNodes, edges: keptEdges };
  }

  // ── Focus sur un nœud (réaffiche son voisinage sur le même onglet) ──
  function focusOn(id) {
    focusedNode = id;
    renderFocusBanner();
    applyFilters();
  }
  function resetFocus() {
    focusedNode = null;
    renderFocusBanner();
    applyFilters();
  }
  function renderFocusBanner() {
    if (!focusEl) return;
    if (!focusedNode) {
      focusEl.classList.add("hidden");
      return;
    }
    const node = fullData.nodes.find((n) => n.id === focusedNode);
    focusLabelEl.textContent = node ? node.label : focusedNode;
    focusEl.classList.remove("hidden");
  }

  // ── Application des filtres (relation + fichier + recherche) ──
  function applyFilters() {
    const rel = relationEl.value;
    const file = fileEl.value;
    const q = searchEl.value.trim().toLowerCase();

    let base = fullData;
    if (contextualEl.checked) {
      const sub = buildContextualSubgraph(fullData);
      if (sub) base = sub;
    }
    if (aggregateEl.checked) {
      base = aggregateByFile(base);
    }
    if (focusedNode) {
      const sub = buildFocusSubgraph(base, focusedNode);
      if (sub) base = sub;
    }

    let edges = base.edges;
    if (rel) edges = edges.filter((e) => e.relation === rel);
    if (file) edges = edges.filter((e) => e.path === file);

    let nodes = base.nodes;
    if (file) {
      const fileIds = new Set(base.nodes.filter((n) => n.path === file).map((n) => n.id));
      nodes = nodes.filter((n) => fileIds.has(n.id));
    }
    if (q) {
      nodes = nodes.filter((n) => n.label.toLowerCase().includes(q) || n.path.toLowerCase().includes(q));
    }

    currentData = { nodes, edges };
    renderGraph();
  }

  // ── Surlignage des connexions au survol ──
  function highlight(node) {
    if (!graph) return;
    const theme = themeColors();
    if (!node) {
      graph.nodeColor((n) => kindColors()[n.kind] || "#8b949e");
      graph.linkColor((e) => relationColors()[e.relation] || "#888");
      graph.linkWidth(2);
      return;
    }
    const linked = new Set([node.id]);
    currentData.edges.forEach((e) => {
      if (e.source === node.id || e.target === node.id) {
        linked.add(e.source);
        linked.add(e.target);
      }
    });
    graph.nodeColor((n) => (linked.has(n.id) ? kindColors()[n.kind] || "#8b949e" : theme.muted));
    graph.linkColor((e) =>
      (e.source === node.id || e.target === node.id) ? relationColors()[e.relation] || "#888" : theme.border
    );
    graph.linkWidth((e) => (e.source === node.id || e.target === node.id) ? 3 : 0.6);
  }

  // ── Rendu force-graph ──
  async function renderGraph() {
    if (destroyed) return;
    const { nodes, edges } = currentData;
    if (countEl) countEl.textContent = aggregateEl.checked
      ? `${nodes.length} fichiers · ${edges.length} liens`
      : `${nodes.length} nœuds · ${edges.length} arêtes`;

    if (nodes.length === 0) {
      if (graph) { graph._destructor && graph._destructor(); graph = null; }
      canvasEl.innerHTML = '<div class="muted cg-empty">Aucun nœud à afficher (filtres trop restrictifs ou graphe vide).</div>';
      return;
    }

    // force-graph en lazy-load.
    const ForceGraph = (await import("force-graph")).default;
    if (destroyed) return;

    if (!graph) {
      canvasEl.innerHTML = "";
      graph = ForceGraph()(canvasEl)
        .nodeId("id")
        .nodeLabel((n) => `${n.label}${n._count ? ` (${n._count} symboles)` : ` (${n.kind})`} — ${n.path}${n.line ? " L" + n.line : ""}`)
        .nodeColor((n) => kindColors()[n.kind] || "#8b949e")
        .nodeVal((n) => (n._count ? Math.min(3 + Math.sqrt(n._count), 12) : (n.kind === "file" ? 3 : 1.5)))
        .linkColor((e) => relationColors()[e.relation] || "#888")
        .linkLabel((e) => `${e.relation} [${e.confidence}]`)
        .linkWidth(2)
        .nodeRelSize(5)
        .linkDirectionalArrowLength(4)
        .linkDirectionalArrowRelPos(1)
        .linkCanvasObjectMode(() => "replace")
        .linkCanvasObject((link, ctx, globalScale) => {
          const start = link.source;
          const end = link.target;
          if (typeof start !== "object" || typeof end !== "object") return;
          const color = link.color || relationColors()[link.relation] || "#888";
          const width = (link.width || 2) / globalScale;
          // Halo coloré (glow) : rend le lien visible sur tout fond.
          ctx.beginPath();
          ctx.moveTo(start.x, start.y);
          ctx.lineTo(end.x, end.y);
          ctx.strokeStyle = withAlpha(color, 0.3);
          ctx.lineWidth = width + 5 / globalScale;
          ctx.stroke();
          // Ligne principale.
          ctx.beginPath();
          ctx.moveTo(start.x, start.y);
          ctx.lineTo(end.x, end.y);
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          ctx.stroke();
        })
        .nodeCanvasObjectMode(() => "replace")
        .nodeCanvasObject((node, ctx, globalScale) => {
          const theme = themeColors();
          const label = node.label;
          const fontSize = 10 / globalScale;
          const r = (node._count ? Math.min(4 + Math.sqrt(node._count), 14) : (node.kind === "file" ? 5 : 3.5)) / globalScale;

          // Cercle coloré.
          ctx.beginPath();
          ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
          ctx.fillStyle = node.color;
          ctx.fill();
          ctx.strokeStyle = withAlpha(theme.bg, 0.6);
          ctx.lineWidth = 1 / globalScale;
          ctx.stroke();

          // Étiquette avec fond adapté au thème.
          ctx.font = `${fontSize}px Sans-Serif`;
          const textWidth = ctx.measureText(label).width;
          const pad = fontSize * 0.35;
          const bw = textWidth + pad * 2;
          const bh = fontSize + pad * 2;
          const bx = node.x - bw / 2;
          const by = node.y - r - bh - 3 / globalScale;
          ctx.fillStyle = withAlpha(theme.bg, 0.85);
          ctx.strokeStyle = withAlpha(theme.border, 0.5);
          ctx.lineWidth = 0.5 / globalScale;
          roundRectPath(ctx, bx, by, bw, bh, 3);
          ctx.fill();
          ctx.stroke();
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = theme.text;
          ctx.fillText(label, node.x, by + bh / 2);
          node.__bckgDimensions = [bw, bh];
        })
        .onNodeClick((node) => {
          const now = Date.now();
          if (lastClick.id === node.id && now - lastClick.time < 350) {
            // Double-clic → ouvrir le fichier dans un onglet d'édition.
            lastClick = { id: null, time: 0 };
            if (node.path && window._pilotTabs) {
              const abs = projectPath().replace(/[\\/]+$/, "") + "/" + node.path;
              window._pilotTabs.openFile(abs, "edit").catch(() => {});
            }
            return;
          }
          lastClick = { id: node.id, time: now };
          // Clic simple → recentrer le graphe sur le voisinage de ce nœud.
          focusOn(node.id);
        })
        .onNodeHover((node) => {
          canvasEl.style.cursor = node ? "pointer" : "default";
          highlight(node);
        })
        .onEngineStop(() => {
          if (fitPending) {
            fitPending = false;
            graph.zoomToFit(400, 60);
          }
        })
        .cooldownTicks(120);
    }

    // Position initiale en cercle (centré) pour un layout stable et lisible.
    const n = nodes.length;
    const radius = Math.max(120, Math.sqrt(n) * 30);
    nodes.forEach((node, i) => {
      const angle = (i / n) * 2 * Math.PI;
      node.x = Math.cos(angle) * radius;
      node.y = Math.sin(angle) * radius;
    });

    graph.graphData({ nodes, links: edges });
    // Recentrer une fois la simulation stabilisée.
    fitPending = true;
  }

  // ── Chargement du graphe complet + peuplement des filtres ──
  async function load() {
    const p = projectPath();
    if (!p) { renderStatus(null); return; }
    const s = await graphStatus(p);
    renderStatus(s);
    if (!s || !s.exists || !s.ready) {
      fullData = { nodes: [], edges: [] };
      currentData = { nodes: [], edges: [] };
      renderGraph();
      return;
    }
    try {
      const exp = await invoke("graph_export", { projectPath: p });
      fullData = { nodes: exp.nodes || [], edges: exp.edges || [] };
      // Auto-activer la vue par fichier pour les gros graphes (1re ouverture).
      if (!autoAggregated && fullData.nodes.length > 250) {
        aggregateEl.checked = true;
        autoAggregated = true;
      }
      // Peupler le filtre fichier.
      const files = [...new Set(fullData.nodes.map((n) => n.path))].sort();
      const prev = fileEl.value;
      fileEl.innerHTML = '<option value="">Tous les fichiers</option>' +
        files.map((f) => `<option value="${f}">${f}</option>`).join("");
      fileEl.value = prev;
      applyFilters();
    } catch (e) {
      console.warn("[code-graph] export échec:", e);
      fullData = { nodes: [], edges: [] };
      renderGraph();
    }
  }

  // ── Événements ──
  btnRebuild.onclick = async () => {
    const p = projectPath();
    if (!p) return;
    btnRebuild.disabled = true;
    if (statusEl) statusEl.innerHTML = '<span class="muted">⏳ Construction du graphe… (peut prendre quelques secondes)</span>';
    try {
      const stats = await rebuildGraph(p);
      if (statusEl && stats) {
        statusEl.innerHTML =
          `<span><b>Graphe reconstruit</b></span>` +
          `<span> · Nœuds : <b>${stats.nodes}</b> · Arêtes : <b>${stats.edges}</b> · ${stats.files} fichiers en ${(stats.elapsed_ms / 1000).toFixed(1)} s</span>`;
      }
      const { toastInfo } = await import("./toast.js");
      toastInfo("📊 Graphe du projet reconstruit");
      await load();
    } catch (e) {
      if (statusEl) statusEl.innerHTML = `<span class="muted">❌ Échec : ${e}</span>`;
    } finally {
      btnRebuild.disabled = false;
    }
  };
  btnRefresh.onclick = async () => {
    try {
      await load();
      // Forcer un re-layout + recentrage même si les données sont identiques.
      if (graph) {
        graph.d3ReheatSimulation();
        graph.zoomToFit(400, 60);
      }
    } catch (e) {
      console.warn("[code-graph] refresh échec:", e);
      if (statusEl) statusEl.innerHTML = `<span class="muted">❌ Actualisation échouée : ${e}</span>`;
    }
  };
  searchEl.addEventListener("input", applyFilters);
  relationEl.addEventListener("change", applyFilters);
  fileEl.addEventListener("change", applyFilters);
  aggregateEl.addEventListener("change", applyFilters);
  contextualEl.addEventListener("change", applyFilters);
  focusResetEl.addEventListener("click", resetFocus);

  // Sélection d'un fichier dans l'explorateur → met à jour le sous-graphe
  // contextuel si l'onglet Graphe est visible et la case cochée.
  const onFileSelected = (e) => {
    if (!e.detail || !e.detail.path) return;
    window._lastEditedFile = e.detail.path;
    if (contextualEl.checked && wrapper.style.display !== "none") {
      applyFilters();
    }
  };
  document.addEventListener("pilot-file-selected", onFileSelected);

  // Changement de thème → re-rendre le graphe et la légende (couleurs adaptées).
  const onThemeChanged = () => {
    renderLegend();
    if (graph) applyFilters();
  };
  window.addEventListener("theme-changed", onThemeChanged);

  // Resize : force-graph suit la taille du conteneur.
  const ro = new ResizeObserver(() => {
    if (graph) graph.width(canvasEl.clientWidth).height(canvasEl.clientHeight);
  });
  ro.observe(canvasEl);

  // Chargement initial.
  load();

  // ── Nettoyage ──
  const unlisten = () => {
    destroyed = true;
    ro.disconnect();
    document.removeEventListener("pilot-file-selected", onFileSelected);
    window.removeEventListener("theme-changed", onThemeChanged);
    if (graph && graph._destructor) graph._destructor();
    graph = null;
  };

  return { wrapper, unlisten };
}
