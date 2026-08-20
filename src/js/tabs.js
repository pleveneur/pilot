// tabs.js — Gestion des onglets (édition / prévisualisation / terminal)

import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { createEditor, getContent, setContent, destroyEditor, setWordWrap } from "./editor.js";
import { recordRecentFile } from "./recent-files.js";
import { getLanguageName } from "./languages.js";
import { createPreview, updatePreview, bindMermaidFunctions } from "./preview.js";
import { createPdfPreview } from "./pdf-preview.js";
import { createImageViewer } from "./image-viewer.js";
import { createCsvPreview } from "./csv-preview.js";
import { createTerminal, killTerminal } from "./terminal.js";
import { createAgentPi, renderMessageHistory, activateAgentTab } from "./agent-pi.js";
import { agentDisplayLabel, getPiHealthSync, checkPiHealth } from "./backend-info.js";
import { createHelp } from "./help.js";
import { createReview } from "./review.js";
import { createSessionHistory } from "./session-history.js";
import { createFeedback } from "./feedback.js";
import { scheduleOutlineUpdate } from "./outline.js";
import { toastError } from "./toast.js";
import { animatePanelOpen } from "./modal-anim.js";
import { createPromptBuilder } from "./prompt-builder.js";
import { EditorView } from "@codemirror/view";
import { getFileList } from "./file-list.js";
import { createAgents } from "./agents-ui.js";
import { createSuperAgent, superAgentDisplayLabel } from "./super-agent.js";
import { openGitDiffModal } from "./diff-view.js";
import { scheduleSave } from "./session-persistence.js";
import { showLoading, hideLoading } from "./loading.js";

const statusCursor = document.getElementById("status-cursor");
const statusFiletype = document.getElementById("status-filetype");
const statusStats = document.getElementById("status-stats");
const statusEncoding = document.getElementById("status-encoding");
const statusEol = document.getElementById("status-eol");

/** Compare deux chemins sans tenir compte des séparateurs (\ vs /).
 *  Les onglets ouverts via l'explorateur utilisent le séparateur natif de l'OS
 *  (\ sur Windows), tandis que les appels programmatiques (agents-md.js,
 *  project-memory.js…) construisent le chemin avec /. Sans cette normalisation,
 *  openFile ne détectait pas le doublon et ouvrait un second onglet identique. */
/** Échappe le HTML pour injection sûre dans innerHTML (conflit de fichier). */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function samePath(a, b) {
  if (a === b) return true;

  if (!a || !b) return false;
  return a.replace(/\\/g, "/") === b.replace(/\\/g, "/");
}

/** Rejoint un chemin relatif à la racine du projet (séparateur natif). */
function joinPath(root, rel) {
  const sep = root.includes("\\") ? "\\" : "/";
  const clean = String(rel).replace(/^[\\/]+/, "").replace(/[\\/]+$/, "");
  if (!clean) return root;
  return root.replace(/[\\/]+$/, "") + sep + clean;
}
const statusAutosave = document.getElementById("status-autosave");

let tabIdCounter = 0;

class Tab {
  constructor(id, path, name, mode) {
    this.id = id;
    this.path = path;
    this.name = name;
    this.mode = mode; // 'edit' | 'preview' | 'pdf' | 'image' | 'csv' | 'terminal'
    this.dirty = false;
    this.savedContent = ""; // contenu sauvegardé sur disque
    this.view = null; // EditorView (edit) | HTMLElement (preview/terminal)
    this.wrapper = null; // div conteneur dans #editor-container
    this.terminalId = null; // ID du PTY pour les onglets terminal
    this.unlistenTerminal = null; // fonction pour unlisten des événements terminal
    // Split mode (éditeur + prévisualisation côte à côte)
    this.splitMode = false;
    this.splitDivider = null;
    this.splitPreviewPane = null;
    this.splitPreviewWrapper = null;
    this.splitUpdateTimer = null;
    this.splitScrollSyncActive = false;
    this.splitEditorScrollHandler = null;
    this.splitPreviewScrollHandler = null;
    this.splitClickHandler = null;
    this.splitDragHandlers = null;
    // Commande projet (#29) : identité de la commande (repérage onglet existant)
    this.projectCommandId = null;
    // Scratchpad : pas de fichier associé
    this.isScratchpad = false;
    // 3.1 : identifiant d'agent résolu depuis la base (`get_agent`/`list_agents`),
    // jamais dérivé d'un compteur volatil. L'état logique (loaded/state/busy)
    // vit sur l'objet Agent (table `agents`) ; l'onglet ne porte que l'état de
    // VUE (agentReady / agentElements / unlistenRpc / view), plus d'état de
    // session.
    this.agentId = null;
  }
}

class TabsManager {
  constructor() {
    this.tabs = [];
    this.activeTabId = null;
    this.tabBar = document.getElementById("tab-bar");
    this.container = document.getElementById("editor-container");

    // Drag & drop des onglets (réorganisation) — drag manuel (mousedown/move/up)
    // car Tauri dragDropEnabled=true intercepte les drags HTML5 natifs (réservés aux
    // fichiers externes via onDragDropEvent), ce qui empêche dragstart/drop sur les onglets.
    this._dragState = null; // { tab, btn, startX, startY, dragging, indicatorBtn }
    this._dragThreshold = 4; // px avant de considérer un mousedown comme un drag
    this._bindDragGlobalListeners();

    // Auto-save
    this._autoSaveEnabled = false;
    this._autoSaveDelay = 3000;
    this._autoSaveTimer = null;
    // Word wrap
    this._wordWrapEnabled = false;
    // Multi-onglets agents (spec_multi_agents) : si true, on peut ouvrir
    // plusieurs onglets agent indépendants sur le même projet (bouton « + »).
    this._multiAgentEnabled = false;
    // Évolution « Tableau de bord systématique » : si true, l'onglet 📊 Tableau
    // de bord est verrouillé en position (juste après l'onglet 🧭 Assistant,
    // avant le bouton « + ») et n'est pas déplaçable au drag.
    this._dashboardAutoOpen = false;
    // 3.1 : plus d'état de session sur le gestionnaire. L'agent actif se lit
    // depuis l'objet (AgentService.get_state / get_agent) ; l'idempotence est
    // gérée par le service, pas par un pointeur volatil local.

    // Charger la config auto-save au démarrage
    invoke("get_config").then((config) => {
      this._autoSaveEnabled = config.auto_save || false;
      this._autoSaveDelay = config.auto_save_delay || 3000;
      this._multiAgentEnabled = config.multi_agent_tabs === true;
      this._updateMultiAgentButton();
      this._dashboardAutoOpen = config.dashboard_auto_open === true;
      this._wordWrapEnabled = config.word_wrap || false;
      this._updateAutoSaveStatus();
      // Appliquer le word wrap sur les onglets déjà ouverts
      this._applyWordWrap();
    }).catch(() => {});

    // Écouter les changements de config
    window.addEventListener("pilot-config-changed", (e) => {
      const config = e.detail;
      this._autoSaveEnabled = config.auto_save || false;
      this._autoSaveDelay = config.auto_save_delay || 3000;
      this._updateAutoSaveStatus();
      // Multi-onglets agents : mettre à jour le bouton « + » de la barre d'onglets.
      const newMulti = config.multi_agent_tabs === true;
      if (newMulti !== this._multiAgentEnabled) {
        this._multiAgentEnabled = newMulti;
        this._updateMultiAgentButton();
      }
      // Tableau de bord systématique : mettre à jour le verrouillage de position
      // de l'onglet 📊 (re-positionnement dans la barre).
      const newDash = config.dashboard_auto_open === true;
      if (newDash !== this._dashboardAutoOpen) {
        this._dashboardAutoOpen = newDash;
        this._repositionDashboardTab();
      }
      // Word wrap
      const newWrap = config.word_wrap || false;
      if (newWrap !== this._wordWrapEnabled) {
        this._wordWrapEnabled = newWrap;
        this._applyWordWrap();
      }
    });

    // Renommer l'onglet agent (et la barre de statut) quand le backend change
    // (pi ↔ plh), car la sonde peut terminer après l'ouverture de l'onglet.
    // Multi-onglets agents : on ne renomme que l'agent PAR DÉFAUT (les onglets
    // supplémentaires ont un nom personnalisé « Agent N »).
    window.addEventListener("pilot-backend-changed", () => {
      const agentTab = this.tabs.find((t) => t.mode === "agent" && t.agentId === "default");
      if (!agentTab) return;
      const newLabel = agentDisplayLabel();
      if (agentTab.name === newLabel) return;
      agentTab.name = newLabel;
      const btn = this.tabBar.querySelector(`[data-tab-id="${agentTab.id}"]`);
      if (btn) {
        const nameSpan = btn.querySelector(".tab-name");
        if (nameSpan) nameSpan.textContent = `π ${newLabel} (RPC)`;
      }
      // Mettre à jour la barre de statut si l'onglet agent est actif.
      const active = this.getActiveTab();
      if (active && active.mode === "agent") {
        statusFiletype.textContent = `${active.name} (RPC)`;
      }
    });
  }

  /**
   * Multi-onglets agents : affiche/retire le bouton « + » de la barre d'onglets
   * (ouvre un nouvel onglet agent indépendant) selon l'option `multi_agent_tabs`.
   */
  _updateMultiAgentButton() {
    let btn = this.tabBar.querySelector(".tab-add-agent");
    if (!this._multiAgentEnabled) {
      if (btn) btn.remove();
      return;
    }
    if (btn) return;
    btn = document.createElement("div");
    btn.className = "tab tab-special tab-add-agent";
    btn.title = "Nouvel onglet agent indépendant";
    btn.innerHTML = `<span class="tab-name">＋</span>`;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      this._openNewAgentTab();
    });
    // Le bouton « + » doit TOUJOURS rester en première position de la barre
    // d'onglets (avant tous les autres onglets). `prepend` garantit qu'il est
    // inséré en tête, et comme il n'a pas de `data-tab-id`, le drag & drop ne
    // peut ni le déplacer ni placer un onglet avant lui.
    this.tabBar.prepend(btn);
  }

  /**
   * Multi-onglets agents : ouvre un nouvel onglet agent indépendant (id
   * `agent-<n>` auto-incrémenté, nom « Agent <n> »). Chaque agent a sa propre
   * session/conversation persistée.
   */
  async _openNewAgentTab() {
    // Trouver le prochain numéro d'agent libre (agent-1, agent-2, ...).
    let n = 1;
    const used = new Set(this.tabs.filter((t) => t.mode === "agent" && t.agentId && t.agentId !== "default").map((t) => t.agentId));
    // Éviter les ids déjà configurés dans `.pilot/agents.json` (issue #35), même
    // si l'onglet correspondant n'est pas encore ouvert, pour ne pas créer un
    // doublon d'id (agent-N) entre config et onglets manuels.
    if (window._pilotProjectPath) {
      try {
        const cfg = await invoke("read_project_agents", { projectPath: window._pilotProjectPath });
        for (const a of cfg || []) used.add(a.id);
      } catch (_) {}
    }
    while (used.has(`agent-${n}`)) n++;
    const agentId = `agent-${n}`;
    await this._openAgent(`Agent ${n}`, agentId);
  }

  /**
   * Ouvre un fichier dans un onglet
   * @param {string} path
   * @param {'edit'|'preview'|'terminal'} mode
   * @param {boolean} [runDefault] - lancer la commande par défaut (terminal uniquement)
   */
  async openFile(path, mode = "edit", runDefault = false, switchTo = true) {
    // Onglet Agent Pi (RPC)
    if (mode === "agent") {
      return await this._openAgent(path || agentDisplayLabel(), "default", runDefault, switchTo);
    }

    // Onglet Super-agent (🧭) — spec_super_agent.md : assistant de suivi
    // multi-projets, lecture seule, couleur d'accent distincte.
    if (mode === "superagent") {
      await this._openSuperAgent(path || superAgentDisplayLabel());
      return;
    }

    // Onglet Aide (❓) — spec_help.md : chat LLM sur le handbook.
    if (mode === "help") {
      await this._openHelp(path || "Aide");
      return;
    }

    // Onglet Review (🔍) — spec_review.md : revue de code assistée (H5).
    if (mode === "review") {
      await this._openReview(path || "Review");
      return;
    }

    // Onglet Historique (📜) — spec_session_history.md : sessions searchable (H9).
    if (mode === "history") {
      await this._openHistory(path || "Historique");
      return;
    }

    // Onglet Feedback (💬) — spec_feedback.md : remarques/évolutions utilisateurs.
    if (mode === "feedback") {
      await this._openFeedback(path || "Feedback");
      return;
    }

    // Onglet Agents (🎭) — spec_gestion_agents.md : équipe d'agents multi-rôles.
    if (mode === "agents") {
      await this._openAgents(path || "Agents");
      return;
    }

    // Onglet Graphe (📊) — spec_code_graph.md : visualisation 2D du Code Graph.
    if (mode === "code-graph") {
      await this._openCodeGraph(path || "Graphe");
      return;
    }

    // Onglet Tableau de bord (📊) — issue #51 : vue détaillée du projet actif.
    if (mode === "dashboard") {
      await this._openDashboard(path || "Tableau de bord");
      return;
    }

    // Onglet Coffre (🔐) — issue #52 : coffre fort de mots de passe chiffré.
    if (mode === "vault") {
      await this._openVault(path || "Coffre");
      return;
    }

    // Onglet Prompt Builder
    if (mode === "prompt-builder") {
      await this._openPromptBuilder();
      return;
    }

    // Onglet Terminal
    if (mode === "terminal") {
      await this._openTerminal(path || "Terminal", runDefault);
      return;
    }

    // Fichiers PDF → mode forcé 'pdf'
    if (path.endsWith('.pdf')) {
      // Vérifier si déjà ouvert en mode pdf
      const existing = this.tabs.find((t) => samePath(t.path, path) && t.mode === "pdf");
      if (existing) {
        this.switchTab(existing.id);
        return;
      }
      await this._openPdf(path);
      recordRecentFile(path);
      return;
    }

    // Fichiers image → mode 'image'
    const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff', 'tif', 'avif'];
    const fileExt = path.split('.').pop()?.toLowerCase() || '';
    if (IMAGE_EXTS.includes(fileExt)) {
      const existing = this.tabs.find((t) => samePath(t.path, path) && t.mode === "image");
      if (existing) {
        this.switchTab(existing.id);
        return;
      }
      await this._openImage(path);
      recordRecentFile(path);
      return;
    }

    // Fichiers CSV → mode 'csv' (prévisualisation tableau)
    if (mode === "csv") {
      const existing = this.tabs.find((t) => samePath(t.path, path) && t.mode === "csv");
      if (existing) {
        this.switchTab(existing.id);
        return;
      }
      await this._openCsv(path);
      recordRecentFile(path);
      return;
    }

    // Vérifier si déjà ouvert dans le même mode (non-PDF seulement, les PDF sont gérés plus haut)
    const existing = this.tabs.find((t) => samePath(t.path, path) && t.mode === mode);
    if (existing) {
      this.switchTab(existing.id);
      return;
    }

    let content = "";
    try {
      showLoading("Chargement de " + path.split(/[/\\]/).pop() + "…");
      content = await invoke("read_file_content", { path });
    } catch (e) {
      console.error("Erreur lecture fichier:", e);
      toastError("Impossible de lire le fichier");
      return;
    } finally {
      hideLoading();
    }

    const name = path.split(/[/\\]/).pop();
    const id = ++tabIdCounter;
    const tab = new Tab(id, path, name, mode);
    tab.savedContent = content;

    // Créer le wrapper et la vue
    tab.wrapper = document.createElement("div");
    tab.wrapper.className = "editor-wrapper";
    tab.wrapper.style.display = "none";

    if (mode === "edit") {
      const isMd = path.endsWith('.md');
      const fileProvider = isMd ? () => getFileList() : null;
      tab.view = await createEditor(tab.wrapper, content, (dirty) => {
        if (dirty) {
          const current = getContent(tab.view);
          tab.dirty = current !== tab.savedContent;
          // Mettre à jour la prévisualisation en mode split
          if (tab.splitMode) {
            this._updateSplitPreview(tab);
          }
          // Mettre à jour l'outline si actif
          scheduleOutlineUpdate();
          // Programmer l'auto-save si activé
          this.scheduleAutoSave();
        } else {
          tab.dirty = false;
        }
        this._updateTabButton(tab);
      }, (view) => {
        this._updateCursorPos(view);
        this._updateStats(tab);
      }, isMd, fileProvider, path);
      tab.dirty = false;
      // Appliquer le word wrap si activé dans la config
      if (this._wordWrapEnabled) {
        setWordWrap(tab.view, true);
      }
    } else {
      tab.view = await createPreview(tab.wrapper, content, window._pilotProjectPath || null);
      // Issue #22 : chemin source pour résoudre les liens relatifs de la prévisualisation
      tab.view.dataset.sourcePath = path;
    }

    this.container.appendChild(tab.wrapper);
    // Bind Mermaid interactive functions now that the wrapper is in the live DOM
    bindMermaidFunctions(tab.wrapper);
    this.tabs.push(tab);
    this._renderTabButton(tab);
    this.switchTab(id);
    recordRecentFile(path);
    this._scheduleSave();
  }

  /**
   * Ouvre l'onglet Agent Pi (RPC) avec l'interface de chat.
   * 3.2 : ouvre une VUE sur l'objet Agent (table `agents`). Ne démarre la
   * session que si l'objet n'est pas chargé (loaded == false) ; sinon pose
   * visible=1 et reprend la vue. L'idempotence est gérée par l'AgentService :
   * jamais d'erreur « session déjà active ».
   */
  async _openAgent(label, agentId = "default", runDefault = false, switchTo = true) {
    const projectPath = window._pilotProjectPath || null;

    // 3.2.1 : résoudre l'agent depuis la base. L'état logique (loaded/state)
    // vit sur l'objet, pas sur l'onglet. Si l'objet n'existe pas encore en base
    // (ex: agent par défaut non seedé), on le traite comme non chargé : la
    // session sera démarrée au besoin, sans vue d'erreur.
    let agentLoaded = false;
    try {
      const agent = await invoke("get_agent", { agentId, projectPath });
      if (agent) agentLoaded = !!agent.loaded;
    } catch (_) {
      // get_agent peut échouer (agent introuvable) → considéré non chargé.
    }

    // Vérifier si un onglet agent avec CET id est déjà ouvert (entrée agent_views).
    const existing = this.tabs.find((t) => t.mode === "agent" && t.agentId === agentId);
    if (existing) {
      // Issue #65 : après un stop_agent, la session RPC est détruite mais
      // l'onglet peut rester ouvert (closeTab est asynchrone fire-and-forget,
      // ou l'onglet appartient à un agent secondaire non fermé par l'assistant).
      // L'ancien chemin « onglet existant » ne relançait PAS la session → la
      // délégation suivante échouait (« Échec de la transmission ») et purge /
      // open_project ne recréaient rien. On relance donc la session si l'objet
      // n'est plus chargé (loaded=false après arrêt) : start_agent_session est
      // idempotent (reprend si vivante, relance si morte).
      if (!agentLoaded) {
        try { await invoke("start_agent_session", { agentId, projectPath }); } catch (_) {}
      }
      // 3.2 : on ne démarre/parke rien — l'AgentService gère l'idempotence. On
      // pose simplement visible=1 sur l'objet et on reprend la vue.
      try { await invoke("set_agent_visible", { agentId, projectPath, visible: true }); } catch (_) {}
      if (switchTo) {
        this.switchTab(existing.id);
      } else {
        // Issue #49 : ouvrir en arrière-plan SANS basculer sur l'onglet agent
        // (l'assistant reste sur son onglet pour attendre le retour).
        if (existing.agentElements) activateAgentTab(existing.agentElements);
      }
      return existing;
    }

    const id = ++tabIdCounter;
    const tab = new Tab(id, "", label || agentDisplayLabel(), "agent");
    tab.agentId = agentId;

    tab.wrapper = document.createElement("div");
    tab.wrapper.className = "editor-wrapper";
    tab.wrapper.style.display = "none";

    this.container.appendChild(tab.wrapper);
    this.tabs.push(tab);
    this._renderTabButton(tab);
    // Issue #49 : si switchTo=false (délégation depuis l'assistant), on démarre
    // la session en arrière-plan SANS rendre l'onglet agent actif — l'utilisateur
    // reste sur l'onglet Assistant pour attendre le retour de l'agent.
    if (switchTo) this.switchTab(id);
    // Persister immédiatement la vue agent pour ce projet : sans cela, ouvrir
    // l'onglet agent ne déclenchait aucune sauvegarde et la vue n'était mise à
    // jour que si une autre sauvegarde survenait avant de quitter le projet →
    // un projet quitté après avoir ouvert l'agent perdait son onglet au retour.
    this._scheduleSave();

    // ── E4 : health check de l'agent avant de tenter start_agent_session ──
    // Si l'exécutable configuré (pi/plh) est absent ou ne répond pas, on affiche
    // un écran guidé (bouton « Ouvrir les paramètres ») au lieu de lancer une
    // session RPC qui planterait silencieusement.
    let health = getPiHealthSync();
    if (!health) health = await checkPiHealth();
    if (health && !health.ok) {
      const reason = health.error === "no_path"
        ? "Aucun chemin d'exécutable n'est configuré."
        : health.error === "not_executable"
          ? `L'exécutable « ${health.path} » est introuvable ou injoignable.`
          : health.error === "probe_failed"
            ? "La sonde du backend a échoué."
            : "Raison inconnue.";
      tab.wrapper.style.display = "flex";
      tab.wrapper.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;text-align:center;padding:32px;color:var(--text-color);">
          <div style="font-size:48px;margin-bottom:16px;opacity:.5;">π</div>
          <div style="font-size:18px;font-weight:600;margin-bottom:8px;">${agentDisplayLabel()} indisponible</div>
          <div style="font-size:13px;max-width:420px;margin-bottom:18px;opacity:.8;">${reason}</div>
          <button id="pi-health-open-settings" style="padding:8px 16px;border:1px solid var(--border-color);background:var(--bg-color);color:var(--text-color);border-radius:6px;cursor:pointer;">⚙️ Ouvrir les paramètres</button>
          <div style="font-size:11px;margin-top:14px;opacity:.5;">Une fois le chemin configuré et enregistré, rouvre cet onglet.</div>
        </div>`;
      const btn = tab.wrapper.querySelector("#pi-health-open-settings");
      if (btn) btn.addEventListener("click", () => {
        window.dispatchEvent(new CustomEvent("pilot-open-settings"));
      });
      return;
    }

    // 3.2 : démarrer la session UNIQUEMENT si l'objet n'est pas chargé. Si
    // l'objet est déjà chargé (processus vivant), on pose visible=1 et on
    // reprend la vue : createAgentPi relit l'historique depuis la session
    // vivante. Aucun start superflu → jamais d'erreur « session déjà active ».
    const shouldStart = !agentLoaded;
    showLoading(`Démarrage de ${label || agentDisplayLabel()}…`);
    try {
      // Issue #26 : vérifier (en arrière-plan) si une mise à jour de Pi est
      // disponible et proposer de la faire. Ne fait rien si backend non pi,
      // « Ne plus demander » activé, ou déjà en cours.
      window._pilotCheckPiUpdate?.();

      // start_agent_session délègue à AgentService::start (idempotent).
      // Retourne true si la session a été reprise, false si nouvelle.
      let resumed = false;
      if (shouldStart) {
        resumed = await invoke("start_agent_session", { agentId });
      }

      // Créer l'interface de chat (vue). Si l'objet était déjà chargé, la
      // conversation est relue depuis la session vivante (renderMessageHistory).
      const result = await createAgentPi(tab.wrapper, resumed === true, agentId);
      tab.view = result.wrapper;
      tab.unlistenRpc = result.unlisten;
      tab.unlistenDragDrop = result.unlistenDragDrop;
      tab.agentElements = result.elements;
      tab.agentReady = true;
      // Issue #49 : ne pas activer les globals d'UI de l'agent si on ne bascule
      // pas (l'onglet Assistant reste actif — ses globals d'autocomplétion ne
      // doivent pas être écrasés). Ils seront activés au prochain switchTab.
      if (switchTo) activateAgentTab(result.elements);

      // 3.2 : rendre l'objet visible (visible=1) après création de la vue.
      try { await invoke("set_agent_visible", { agentId, projectPath, visible: true }); } catch (_) {}

      // Re-rendre l'historique de la session du projet (multi-projets). pi reprend
      // sa session par répertoire projet ; on attend que pi soit prêt (poll court)
      // puis on recharge les messages de la discussion en cours.
      const msgContainer = result.wrapper.querySelector(".agent-chat-messages");
      if (msgContainer) {
        for (let i = 0; i < 10; i++) {
          const n = await renderMessageHistory(msgContainer);
          if (n !== -1) break; // -1 = session pas prête → réessayer ; 0+ = fait (vide ou non)
          if (i < 9) await new Promise((r) => setTimeout(r, 300));
        }
      }

    } catch (e) {
      console.error("Erreur session agent:", e);
      tab.wrapper.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--danger);">
          <div style="font-size:48px;margin-bottom:16px;">π</div>
          <div style="font-size:18px;font-weight:600;margin-bottom:8px;">${agentDisplayLabel()}</div>
          <div style="font-size:13px;">❌ Erreur: ${e}</div>
        </div>
      `;
    } finally {
      hideLoading();
    }
    return tab;
  }

  /**
   * Évolution 64 : agit sur l'OBJET Agent pour le rendre « invisible » — aucun
   * onglet (Tab) créé. Utilisé par l'Assistant (🧭) quand l'option « agent
   * invisible » est activée : la délégation s'exécute sans aucun onglet agent
   * visible. 3.3 : pose `visible=0` sur l'objet puis démarre la session
   * (AgentService::start). L'objet porte visible=0, loaded=true, state=Running.
   * A13 (assistant headless multi-projets) : un `projectPath` explicite permet
   * de démarrer l'agent d'un projet NON actif en arrière-plan (sans ouvrir le
   * projet ni l'onglet). Sinon, on retombe sur le projet actif.
   * @param {string} [agentId] — id de l'agent (défaut "default").
   * @param {string|null} [projectPath] — chemin du projet cible (défaut : projet actif).
   */
  async startAgentInvisible(agentId = "default", projectPath = null) {
    const target = projectPath || window._pilotProjectPath || null;
    // 3.3 : rendre l'objet invisible AVANT de démarrer (visible=0).
    try { await invoke("set_agent_visible", { agentId, projectPath: target, visible: false }); } catch (_) {}
    // Démarre/reprend la session (AgentService::start, idempotent). Aucun Tab
    // créé : la vue n'existe pas, mais l'objet porte loaded=true.
    return await invoke("start_agent_session", { agentId, projectPath: target });
  }

  /**
   * Ouvre l'onglet Aide (❓) — chat LLM sur le handbook (spec_help.md).
   * Pas de session RPC persistante : l'aide lance un process pi temporaire
   * (--no-session) via la commande ask_help à chaque question.
   */
  async _openHelp(label = "Aide") {
    const existing = this.tabs.find((t) => t.mode === "help");
    if (existing) {
      this.switchTab(existing.id);
      return;
    }

    const id = ++tabIdCounter;
    const tab = new Tab(id, "", label, "help");

    tab.wrapper = document.createElement("div");
    tab.wrapper.className = "editor-wrapper help-wrapper";
    tab.wrapper.style.display = "none";

    this.container.appendChild(tab.wrapper);
    this.tabs.push(tab);
    this._renderTabButton(tab);
    this.switchTab(id);

    try {
      const result = createHelp(tab.wrapper);
      tab.view = result.wrapper;
      tab.unlistenHelp = result.unlisten;
    } catch (e) {
      console.error("Erreur onglet Aide:", e);
      tab.wrapper.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--danger);">
          <div style="font-size:48px;margin-bottom:16px;">❓</div>
          <div style="font-size:18px;font-weight:600;margin-bottom:8px;">Aide</div>
          <div style="font-size:13px;">❌ Erreur: ${e}</div>
        </div>`;
    }
  }

  /**
   * Ouvre l'onglet Super-agent (🧭) — spec_super_agent.md : assistant de
   * suivi multi-projets, lecture seule, couleur d'accent distincte.
   */
  async _openSuperAgent(label = "Assistant") {
    const existing = this.tabs.find((t) => t.mode === "superagent");
    if (existing) {
      this.switchTab(existing.id);
      return;
    }

    const id = ++tabIdCounter;
    const tab = new Tab(id, "", label, "superagent");

    tab.wrapper = document.createElement("div");
    tab.wrapper.className = "editor-wrapper superagent-wrapper";
    tab.wrapper.style.display = "none";

    this.container.appendChild(tab.wrapper);
    this.tabs.push(tab);
    this._renderTabButton(tab);
    this.switchTab(id);
    // L'onglet Super-agent est GLOBAL : on persiste son état d'ouverture dans la
    // config (pas par projet) pour le rouvrir au démarrage de Pilot.
    // #30 : await + gestion d'erreur pour garantir que la config est bien écrite
    // (un fire-and-forget avalé pouvait laisser super_agent_open=False au
    // redémarrage, l'onglet n'étant alors pas restauré).
    try {
      await invoke("set_super_agent_open", { open: true });
    } catch (e) {
      console.error("Erreur persistance ouverture onglet Assistant:", e);
    }

    try {
      const result = await createSuperAgent(tab.wrapper);
      tab.view = result.wrapper;
      tab.superTrackingRefresh = result.superTrackingRefresh;
      tab.unlistenSuperAgent = result.unlisten;
    } catch (e) {
      console.error("Erreur onglet Assistant:", e);
      tab.wrapper.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--danger);">
          <div style="font-size:48px;margin-bottom:16px;">🧭</div>
          <div style="font-size:18px;font-weight:600;margin-bottom:8px;">Assistant</div>
          <div style="font-size:13px;">❌ Erreur: ${e}</div>
        </div>`;
    }
  }

  /**
   * Met à jour le nom affiché de l'onglet Super-agent (🧭) après un changement
   * de config (nom de l'assistant). Re-rend le bouton d'onglet.
   */
  updateSuperAgentLabel(label) {
    const tab = this.tabs.find((t) => t.mode === "superagent");
    if (!tab) return;
    tab.name = label || "Assistant";
    const oldBtn = this.tabBar.querySelector(`[data-tab-id="${tab.id}"]`);
    if (oldBtn) oldBtn.remove();
    this._renderTabButton(tab);
  }

  /**
   * Ouvre l'onglet Review (🔍) — revue de code assistée (H5, spec_review.md).
   * Chat LLM cadré sur le diff Git (process pi temporaire via ask_review).
   */
  async _openReview(label = "Review") {
    const existing = this.tabs.find((t) => t.mode === "review");
    if (existing) {
      this.switchTab(existing.id);
      return;
    }

    const id = ++tabIdCounter;
    const tab = new Tab(id, "", label, "review");

    tab.wrapper = document.createElement("div");
    tab.wrapper.className = "editor-wrapper review-wrapper help-wrapper";
    tab.wrapper.style.display = "none";

    this.container.appendChild(tab.wrapper);
    this.tabs.push(tab);
    this._renderTabButton(tab);
    this.switchTab(id);

    try {
      const result = createReview(tab.wrapper);
      tab.view = result.wrapper;
      tab.unlistenReview = result.unlisten;
    } catch (e) {
      console.error("Erreur onglet Review:", e);
      tab.wrapper.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--danger);">
          <div style="font-size:48px;margin-bottom:16px;">🔍</div>
          <div style="font-size:18px;font-weight:600;margin-bottom:8px;">Review</div>
          <div style="font-size:13px;">❌ Erreur: ${e}</div>
        </div>`;
    }
  }

  /**
   * Ouvre l'onglet Historique (📜) — sessions agent searchable (H9,
   * spec_session_history.md). Index local `.pilot/sessions.jsonl`, ne dépend
   * pas de pi (consultable hors-ligne).
   */
  async _openHistory(label = "Historique") {
    const existing = this.tabs.find((t) => t.mode === "history");
    if (existing) {
      this.switchTab(existing.id);
      return;
    }

    const id = ++tabIdCounter;
    const tab = new Tab(id, "", label, "history");

    tab.wrapper = document.createElement("div");
    tab.wrapper.className = "editor-wrapper history-wrapper";
    tab.wrapper.style.display = "none";

    this.container.appendChild(tab.wrapper);
    this.tabs.push(tab);
    this._renderTabButton(tab);
    this.switchTab(id);

    try {
      const result = await createSessionHistory(tab.wrapper);
      tab.view = result.wrapper;
      tab.unlistenHistory = result.unlisten;
    } catch (e) {
      console.error("Erreur onglet Historique:", e);
      tab.wrapper.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--danger);">
          <div style="font-size:48px;margin-bottom:16px;">📜</div>
          <div style="font-size:18px;font-weight:600;margin-bottom:8px;">Historique</div>
          <div style="font-size:13px;">❌ Erreur: ${e}</div>
        </div>`;
    }
  }

  /**
   * Ouvre l'onglet Feedback (💬) — remarques / évolutions utilisateurs
   * (spec_feedback.md). Sans backend ni dépendance à pi : envoi GitHub/email
   * + lecture des issues existantes via l'API publique GitHub.
   */
  async _openFeedback(label = "Feedback") {
    const existing = this.tabs.find((t) => t.mode === "feedback");
    if (existing) {
      this.switchTab(existing.id);
      return;
    }

    const id = ++tabIdCounter;
    const tab = new Tab(id, "", label, "feedback");

    tab.wrapper = document.createElement("div");
    tab.wrapper.className = "editor-wrapper feedback-wrapper";
    tab.wrapper.style.display = "none";

    this.container.appendChild(tab.wrapper);
    this.tabs.push(tab);
    this._renderTabButton(tab);
    this.switchTab(id);

    try {
      const result = createFeedback(tab.wrapper);
      tab.view = result.wrapper;
      tab.unlistenFeedback = result.unlisten;
    } catch (e) {
      console.error("Erreur onglet Feedback:", e);
      tab.wrapper.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--danger);">
          <div style="font-size:48px;margin-bottom:16px;">💬</div>
          <div style="font-size:18px;font-weight:600;margin-bottom:8px;">Feedback</div>
          <div style="font-size:13px;">❌ Erreur: ${e}</div>
        </div>`;
    }
  }

  /**
   * Ouvre l'onglet Agents (🎭) — gestion d'agents multi-rôles (spec_gestion_agents.md).
   */
  async _openAgents(label = "Agents") {
    const existing = this.tabs.find((t) => t.mode === "agents");
    if (existing) {
      this.switchTab(existing.id);
      return;
    }

    const id = ++tabIdCounter;
    const tab = new Tab(id, "", label, "agents");

    tab.wrapper = document.createElement("div");
    tab.wrapper.className = "editor-wrapper agents-wrapper";
    tab.wrapper.style.display = "none";

    this.container.appendChild(tab.wrapper);
    this.tabs.push(tab);
    this._renderTabButton(tab);
    this.switchTab(id);

    try {
      const result = await createAgents(tab.wrapper);
      tab.view = result.wrapper;
      tab.unlistenAgents = result.unlisten;
    } catch (e) {
      console.error("Erreur onglet Agents:", e);
      tab.wrapper.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--danger);">
          <div style="font-size:48px;margin-bottom:16px;">🎭</div>
          <div style="font-size:18px;font-weight:600;margin-bottom:8px;">Agents</div>
          <div style="font-size:13px;">❌ Erreur: ${e}</div>
        </div>`;
    }
  }

  /**
   * Ouvre l'onglet Graphe (📊) — visualisation 2D du Code Graph
   * (spec_code_graph.md, Option C). Remplace l'ancienne modale.
   */
  async _openCodeGraph(label = "Graphe") {
    const existing = this.tabs.find((t) => t.mode === "code-graph");
    if (existing) {
      this.switchTab(existing.id);
      return;
    }

    const id = ++tabIdCounter;
    const tab = new Tab(id, "", label, "code-graph");

    tab.wrapper = document.createElement("div");
    tab.wrapper.className = "editor-wrapper codegraph-wrapper";
    tab.wrapper.style.display = "none";

    this.container.appendChild(tab.wrapper);
    this.tabs.push(tab);
    this._renderTabButton(tab);
    this.switchTab(id);

    try {
      const { createCodeGraphView } = await import("./code-graph-view.js");
      const result = createCodeGraphView(tab.wrapper);
      tab.view = result.wrapper;
      tab.unlistenCodeGraph = result.unlisten;
    } catch (e) {
      console.error("Erreur onglet Graphe:", e);
      tab.wrapper.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--danger);">
          <div style="font-size:48px;margin-bottom:16px;">📊</div>
          <div style="font-size:18px;font-weight:600;margin-bottom:8px;">Graphe</div>
          <div style="font-size:13px;">❌ Erreur: ${e}</div>
        </div>`;
    }
  }

  /**
   * Ouvre l'onglet Prompt Builder
   */
  async _openPromptBuilder() {
    // Vérifier si déjà ouvert
    const existing = this.tabs.find((t) => t.mode === "prompt-builder");
    if (existing) {
      this.switchTab(existing.id);
      return;
    }

    const { getSidebar } = await import("./sidebar.js");
    const sidebar = getSidebar();

    const id = ++tabIdCounter;
    const tab = new Tab(id, "", "Prompt Builder", "prompt-builder");

    tab.wrapper = document.createElement("div");
    tab.wrapper.className = "editor-wrapper";
    tab.wrapper.style.display = "none";

    this.container.appendChild(tab.wrapper);
    this.tabs.push(tab);
    this._renderTabButton(tab);
    this.switchTab(id);

    try {
      const result = await createPromptBuilder(tab.wrapper, sidebar);
      tab.view = result.wrapper;
      tab.unlistenPromptBuilder = result.unlisten;
    } catch (e) {
      console.error("Erreur Prompt Builder:", e);
      tab.wrapper.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--danger);">
          <div style="font-size:48px;margin-bottom:16px;">🧩</div>
          <div style="font-size:18px;font-weight:600;margin-bottom:8px;">Prompt Builder</div>
          <div style="font-size:13px;">❌ Erreur: ${e}</div>
        </div>
      `;
    }
  }

  /**
   * Ouvre l'onglet Tableau de bord (📊) — issue #51 : vue détaillée du projet
   * actif (stockage, Git, langages, activité agent, vélocité, contexte).
   * Lecture seule, alimenté par `get_project_dashboard` (Rust).
   */
  async _openDashboard(label = "Tableau de bord") {
    const existing = this.tabs.find((t) => t.mode === "dashboard");
    if (existing) {
      this.switchTab(existing.id);
      return;
    }

    const id = ++tabIdCounter;
    const tab = new Tab(id, "", label, "dashboard");

    tab.wrapper = document.createElement("div");
    tab.wrapper.className = "editor-wrapper dashboard-wrapper";
    tab.wrapper.style.display = "none";

    this.container.appendChild(tab.wrapper);
    this.tabs.push(tab);
    this._renderTabButton(tab);
    this.switchTab(id);

    try {
      const { createDashboard } = await import("./dashboard.js");
      const result = createDashboard(tab.wrapper);
      tab.view = result.wrapper;
      tab.unlistenDashboard = result.unlisten;
      tab.dashboardRefresh = result.refresh;
      tab.dashboardSetActive = result.setActive;
    } catch (e) {
      console.error("Erreur onglet Tableau de bord:", e);
      tab.wrapper.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--danger);">
          <div style="font-size:48px;margin-bottom:16px;">📊</div>
          <div style="font-size:18px;font-weight:600;margin-bottom:8px;">Tableau de bord</div>
          <div style="font-size:13px;">❌ Erreur: ${e}</div>
        </div>`;
    }
  }

  /**
   * Ouvre l'onglet Coffre (🔐) — issue #52 : coffre fort de mots de passe
   * chiffré (AES-256-GCM, mot de passe maître). Fichier ~/.pilot/vault.json.
   */
  async _openVault(label = "Coffre") {
    const existing = this.tabs.find((t) => t.mode === "vault");
    if (existing) {
      this.switchTab(existing.id);
      return;
    }

    const id = ++tabIdCounter;
    const tab = new Tab(id, "", label, "vault");

    tab.wrapper = document.createElement("div");
    tab.wrapper.className = "editor-wrapper vault-wrapper";
    tab.wrapper.style.display = "none";

    this.container.appendChild(tab.wrapper);
    this.tabs.push(tab);
    this._renderTabButton(tab);
    this.switchTab(id);

    try {
      const { createVault } = await import("./vault.js");
      const result = createVault(tab.wrapper);
      tab.view = result.wrapper;
      tab.unlistenVault = result.unlisten;
    } catch (e) {
      console.error("Erreur onglet Coffre:", e);
      tab.wrapper.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--danger);">
          <div style="font-size:48px;margin-bottom:16px;">🔐</div>
          <div style="font-size:18px;font-weight:600;margin-bottom:8px;">Coffre</div>
          <div style="font-size:13px;">❌ Erreur: ${e}</div>
        </div>`;
    }
  }

  /**
   * Ouvre un terminal intégré dans un onglet
   */
  async _openTerminal(label, runDefault = false) {
    const id = ++tabIdCounter;
    const tab = new Tab(id, "", label || "Terminal", "terminal");

    tab.wrapper = document.createElement("div");
    tab.wrapper.className = "editor-wrapper";
    tab.wrapper.style.display = "none";
    tab.isAgentTerminal = runDefault;

    this.container.appendChild(tab.wrapper);
    this.tabs.push(tab);
    this._renderTabButton(tab);
    this.switchTab(id);

    // Lancer le terminal intégré
    try {
      const result = await createTerminal(tab.wrapper, "", runDefault);
      tab.view = result.wrapper;
      tab.terminal = result.terminal;
      tab.terminalId = result.terminalId;
      tab.unlistenTerminal = result.unlisten;
      // Focus automatique dans le terminal
      setTimeout(() => result.terminal.focus(), 100);
    } catch (e) {
      tab.wrapper.innerHTML = `<div style="padding:2em;color:var(--danger);">❌ Erreur terminal: ${e}</div>`;
    }
  }

  /**
   * Lance une commande projet (#17) dans un onglet terminal dédié (#29).
   * Titre de l'onglet = nom de la commande. Si la même commande est déjà
   * ouverte, on bascule dessus (sans relancer le process). Fermer l'onglet tue
   * le PTY (comportement identique au terminal intégré).
   * @param {{id: string, name: string, command: string, cwd?: string}} cmd
   */
  async openProjectCommand(cmd) {
    const existing = this.tabs.find(
      (t) => t.mode === "terminal" && t.projectCommandId === cmd.id
    );
    if (existing) {
      this.switchTab(existing.id);
      return;
    }

    const label = cmd.name || cmd.command;
    const id = ++tabIdCounter;
    const tab = new Tab(id, "", label, "terminal");
    tab.projectCommandId = cmd.id;

    tab.wrapper = document.createElement("div");
    tab.wrapper.className = "editor-wrapper";
    tab.wrapper.style.display = "none";

    this.container.appendChild(tab.wrapper);
    this.tabs.push(tab);
    this._renderTabButton(tab);
    this.switchTab(id);

    const projectPath = window._pilotProjectPath || "";
    try {
      const result = await createTerminal(tab.wrapper, projectPath, false, {
        cwd: cmd.cwd ? joinPath(projectPath, cmd.cwd) : projectPath,
        command: cmd.command,
      });
      tab.view = result.wrapper;
      tab.terminal = result.terminal;
      tab.terminalId = result.terminalId;
      tab.unlistenTerminal = result.unlisten;
      setTimeout(() => result.terminal.focus(), 100);
    } catch (e) {
      tab.wrapper.innerHTML = `<div style="padding:2em;color:var(--danger);">❌ Erreur: ${e}</div>`;
    }
  }

  /**
   * Ouvre un fichier PDF dans un onglet de prévisualisation
   */
  async _openPdf(path) {
    // Vérifier si déjà ouvert
    const existing = this.tabs.find((t) => t.path === path && t.mode === "pdf");
    if (existing) {
      this.switchTab(existing.id);
      return;
    }

    showLoading("Chargement du PDF…");
    const name = path.split(/[/\\]/).pop();
    const id = ++tabIdCounter;
    const tab = new Tab(id, path, name, "pdf");
    tab.savedContent = "";

    tab.wrapper = document.createElement("div");
    tab.wrapper.className = "editor-wrapper";
    tab.wrapper.style.display = "none";

    try {
      tab.view = await createPdfPreview(tab.wrapper, path);
    } catch (err) {
      tab.wrapper.innerHTML = `<div style="padding:2em;color:var(--danger);">❌ Erreur: ${err.message || err}</div>`;
    } finally {
      hideLoading();
    }

    this.container.appendChild(tab.wrapper);
    this.tabs.push(tab);
    this._renderTabButton(tab);
    this.switchTab(id);
  }

  /**
   * Ouvre une image dans un onglet de prévisualisation
   */
  async _openImage(path) {
    const existing = this.tabs.find((t) => t.path === path && t.mode === "image");
    if (existing) {
      this.switchTab(existing.id);
      return;
    }

    showLoading("Chargement de l'image…");
    const name = path.split(/[/\\]/).pop();
    const id = ++tabIdCounter;
    const tab = new Tab(id, path, name, "image");
    tab.savedContent = "";

    tab.wrapper = document.createElement("div");
    tab.wrapper.className = "editor-wrapper";
    tab.wrapper.style.display = "none";

    try {
      tab.view = await createImageViewer(tab.wrapper, path);
    } catch (err) {
      tab.wrapper.innerHTML = `<div style="padding:2em;color:var(--danger);">❌ Erreur: ${err.message || err}</div>`;
    } finally {
      hideLoading();
    }

    this.container.appendChild(tab.wrapper);
    this.tabs.push(tab);
    this._renderTabButton(tab);
    this.switchTab(id);
  }

  /**
   * Ouvre un fichier CSV dans un onglet de prévisualisation
   */
  async _openCsv(path) {
    const existing = this.tabs.find((t) => t.path === path && t.mode === "csv");
    if (existing) {
      this.switchTab(existing.id);
      return;
    }

    showLoading("Chargement du CSV…");
    const name = path.split(/[/\\]/).pop();
    const id = ++tabIdCounter;
    const tab = new Tab(id, path, name, "csv");
    tab.savedContent = "";

    tab.wrapper = document.createElement("div");
    tab.wrapper.className = "editor-wrapper";
    tab.wrapper.style.display = "none";

    try {
      tab.view = await createCsvPreview(tab.wrapper, path);
    } catch (err) {
      tab.wrapper.innerHTML = `<div style="padding:2em;color:var(--danger);">❌ Erreur: ${err.message || err}</div>`;
    } finally {
      hideLoading();
    }

    this.container.appendChild(tab.wrapper);
    this.tabs.push(tab);
    this._renderTabButton(tab);
    this.switchTab(id);
  }

  /**
   * Ouvre l'onglet Brouillon (Scratchpad)
   * Contenu persiste dans localStorage (multi-pages par projet, issue #53).
   */
  async _openScratchpad() {
    // Vérifier si déjà ouvert
    const existing = this.tabs.find((t) => t.isScratchpad);
    if (existing) {
      this.switchTab(existing.id);
      return;
    }

    const id = ++tabIdCounter;
    const tab = new Tab(id, "", "\u{1F4DD} Brouillon", "edit");
    tab.isScratchpad = true;

    // Charger les pages depuis localStorage (multi-pages par projet, issue #53)
    const data = this._loadScratchpadData();
    tab.scratchPages = data.pages;
    tab.scratchActiveId = data.pages[0]?.id || null;
    const activePage = tab.scratchPages.find((p) => p.id === tab.scratchActiveId) || tab.scratchPages[0];
    const content = activePage ? activePage.content : "";
    tab.savedContent = content;

    // Créer le wrapper
    tab.wrapper = document.createElement("div");
    tab.wrapper.className = "editor-wrapper";
    tab.wrapper.style.display = "none";

    // Barre d'outils scratchpad (export)
    const toolbar = document.createElement("div");
    toolbar.className = "scratchpad-toolbar";
    toolbar.innerHTML = `
      <span class="scratchpad-label">\u{1F4DD} Brouillon — sauvegardé localement, rattaché au projet courant</span>
      <button class="scratchpad-btn" data-action="scratchpad-export" title=\"Exporter vers un fichier .md du projet\">\u{1F4BE} Exporter</button>
    `;
    tab.wrapper.appendChild(toolbar);

    // Barre des pages (mini-onglets, issue #53)
    const pagesBar = document.createElement("div");
    pagesBar.className = "scratchpad-pages";
    tab.wrapper.appendChild(pagesBar);

    // Conteneur éditeur
    const editorContainer = document.createElement("div");
    editorContainer.className = "scratchpad-editor";
    tab.wrapper.appendChild(editorContainer);

    // Créer l'éditeur CodeMirror
    tab.view = await createEditor(editorContainer, content, (dirty) => {
      if (dirty) {
        const current = getContent(tab.view);
        tab.dirty = current !== tab.savedContent;
        // Sauvegarder dans localStorage à chaque modification
        this._saveScratchpad(tab);
        // Mettre à jour l'outline si actif
        scheduleOutlineUpdate();
      } else {
        tab.dirty = false;
      }
      this._updateTabButton(tab);
    }, (view) => {
      this._updateCursorPos(view);
      this._updateStats(tab);
    }, true, null, ""); // markdown mode, no file provider
    tab.dirty = false;
    // Appliquer le word wrap si activé dans la config
    if (this._wordWrapEnabled) {
      setWordWrap(tab.view, true);
    }

    // Rendre les mini-onglets des pages
    this._renderScratchpadPages(tab, pagesBar);

    // Handler export
    toolbar.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-action=\"scratchpad-export\"]");
      if (!btn) return;
      await this._exportScratchpad(tab);
    });

    this.container.appendChild(tab.wrapper);
    this.tabs.push(tab);
    this._renderTabButton(tab);
    this.switchTab(id);
  }

  /**
   * Clé localStorage du brouillon, distincte par projet (multi-pages par projet).
   * Fallback sur la clé globale si aucun projet n'est ouvert.
   */
  _scratchpadKey() {
    const projectPath = window._pilotProjectPath;
    if (!projectPath) return "pilot-scratchpad";
    return "pilot-scratchpad::" + projectPath.replace(/\\/g, "/");
  }

  /**
   * Génère un identifiant unique de page de brouillon.
   */
  _newScratchId() {
    return "sp-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  /**
   * Charge les pages du brouillon depuis localStorage (format JSON multi-pages,
   * issue #53), avec migration de l'ancien brouillon (1 page en texte brut).
   * @returns {{ pages: Array<{id:string,name:string,content:string}> }}
   */
  _loadScratchpadData() {
    const key = this._scratchpadKey();
    let raw = "";
    try { raw = localStorage.getItem(key) || ""; } catch (_) {}
    if (raw) {
      // Nouveau format JSON { pages: [...] }
      try {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.pages) && parsed.pages.length > 0) {
          // Nettoyer les pages (garantir id/name/content)
          const pages = parsed.pages.map((p, i) => ({
            id: p.id || this._newScratchId(),
            name: (p.name && String(p.name).trim()) || "Page " + (i + 1),
            content: typeof p.content === "string" ? p.content : "",
          }));
          return { pages };
        }
      } catch (_) {
        // Pas du JSON → ancien format texte brut → migration ci-dessous
      }
      // Migration : ancien contenu texte brut → première page "Notes"
      const pages = [{ id: this._newScratchId(), name: "Notes", content: raw }];
      this._persistScratchData({ pages });
      return { pages };
    }
    // Aucun contenu → une page vide par défaut
    const pages = [{ id: this._newScratchId(), name: "Notes", content: "" }];
    this._persistScratchData({ pages });
    return { pages };
  }

  /**
   * Persiste les pages du brouillon dans localStorage (JSON par projet).
   */
  _persistScratchData(data) {
    try {
      localStorage.setItem(this._scratchpadKey(), JSON.stringify(data));
    } catch (_) {}
  }

  /**
   * Sauvegarde le contenu de la page active du brouillon dans localStorage.
   */
  _saveScratchpad(tab) {
    if (!tab.isScratchpad || !tab.view) return;
    try {
      const content = getContent(tab.view);
      const page = tab.scratchPages.find((p) => p.id === tab.scratchActiveId);
      if (page) page.content = content;
      this._persistScratchData({ pages: tab.scratchPages });
      tab.savedContent = content;
      tab.dirty = false;
    } catch (_) {}
  }

  /**
   * Rendu des mini-onglets de pages du brouillon (issue #53).
   */
  _renderScratchpadPages(tab, pagesBar) {
    pagesBar.innerHTML = "";
    for (const page of tab.scratchPages) {
      const el = document.createElement("div");
      el.className = "scratchpad-page-tab" + (page.id === tab.scratchActiveId ? " active" : "");
      el.dataset.pageId = page.id;

      const name = document.createElement("span");
      name.className = "scratchpad-page-name";
      name.textContent = page.name || "Sans nom";
      // Issue #68 : un clic SIMPLE sur le nom doit OUVRIR la page (la bascule est
      // gérée par le clic sur le conteneur el ci-dessous) ; le renommage se fait
      // au DOUBLE-clic, comme les onglets de fichiers.
      name.title = "Double-cliquer pour renommer";
      name.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        this._renameScratchPage(tab, pagesBar, page, name);
      });

      const del = document.createElement("button");
      del.className = "scratchpad-page-del";
      del.textContent = "✕";
      del.title = "Supprimer la page";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        this._deleteScratchPage(tab, pagesBar, page);
      });

      el.appendChild(name);
      el.appendChild(del);
      el.addEventListener("click", () => this._switchScratchPage(tab, pagesBar, page.id));
      pagesBar.appendChild(el);
    }

    const add = document.createElement("button");
    add.className = "scratchpad-page-add";
    add.textContent = "+";
    add.title = "Ajouter une page";
    add.addEventListener("click", () => this._addScratchPage(tab, pagesBar));
    pagesBar.appendChild(add);
  }

  /**
   * Bascule vers une page du brouillon (sauvegarde la page courante au passage).
   */
  _switchScratchPage(tab, pagesBar, pageId) {
    if (pageId === tab.scratchActiveId) return;
    // Sauvegarder le contenu de la page courante avant de basculer
    const current = getContent(tab.view);
    const curPage = tab.scratchPages.find((p) => p.id === tab.scratchActiveId);
    if (curPage) curPage.content = current;
    // Basculer sur la page cible
    tab.scratchActiveId = pageId;
    const next = tab.scratchPages.find((p) => p.id === pageId);
    const content = next ? next.content : "";
    setContent(tab.view, content, { preserveCursor: false });
    tab.savedContent = content;
    tab.dirty = false;
    this._persistScratchData({ pages: tab.scratchPages });
    this._renderScratchpadPages(tab, pagesBar);
    this._updateTabButton(tab);
  }

  /**
   * Ajoute une nouvelle page vide au brouillon et bascule dessus.
   */
  _addScratchPage(tab, pagesBar) {
    const n = tab.scratchPages.length + 1;
    const page = { id: this._newScratchId(), name: "Page " + n, content: "" };
    tab.scratchPages.push(page);
    this._switchScratchPage(tab, pagesBar, page.id);
  }

  /**
   * Renomme une page du brouillon via un champ inline.
   */
  _renameScratchPage(tab, pagesBar, page, nameEl) {
    const input = document.createElement("input");
    input.className = "scratchpad-page-input";
    input.value = page.name || "";
    input.maxLength = 40;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    const commit = () => {
      const val = input.value.trim();
      if (val) page.name = val;
      this._persistScratchData({ pages: tab.scratchPages });
      this._renderScratchpadPages(tab, pagesBar);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        this._renderScratchpadPages(tab, pagesBar);
      }
    });
    input.addEventListener("blur", commit);
  }

  /**
   * Supprime une page du brouillon (avec confirmation). Si c'est la dernière
   * page, on la vide à la place (on ne laisse jamais le brouillon sans page).
   */
  async _deleteScratchPage(tab, pagesBar, page) {
    if (tab.scratchPages.length <= 1) {
      page.content = "";
      this._persistScratchData({ pages: tab.scratchPages });
      setContent(tab.view, "", { preserveCursor: false });
      tab.savedContent = "";
      tab.dirty = false;
      this._updateTabButton(tab);
      return;
    }
    const ok = await confirm(`Supprimer la page « ${page.name || "Sans nom"} » ?`, {
      title: "Pilot",
      kind: "warning",
    });
    if (!ok) return;
    const idx = tab.scratchPages.findIndex((p) => p.id === page.id);
    tab.scratchPages.splice(idx, 1);
    if (tab.scratchActiveId === page.id) {
      const next = tab.scratchPages[Math.min(idx, tab.scratchPages.length - 1)];
      tab.scratchActiveId = next.id;
      const content = next.content;
      setContent(tab.view, content, { preserveCursor: false });
      tab.savedContent = content;
      tab.dirty = false;
    }
    this._persistScratchData({ pages: tab.scratchPages });
    this._renderScratchpadPages(tab, pagesBar);
    this._updateTabButton(tab);
  }

  /**
   * Exporte le contenu de la page active du brouillon vers un fichier .md du projet
   */
  async _exportScratchpad(tab) {
    if (!tab.isScratchpad || !tab.view) return;
    const content = getContent(tab.view);
    const { save } = await import("@tauri-apps/plugin-dialog");
    const projectPath = window._pilotProjectPath || "";
    const defaultPath = projectPath ? projectPath.replace(/\\/g, "/") + "/brouillon.md" : "brouillon.md";
    const filePath = await save({
      defaultPath,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!filePath) return;
    try {
      await invoke("write_file_content", { path: filePath, content });
      const { toastSuccess } = await import("./toast.js");
      toastSuccess("Brouillon exporté vers " + filePath.split(/[/\\]/).pop());
    } catch (err) {
      const { toastError } = await import("./toast.js");
      toastError("Erreur export : " + err);
    }
  }

  /**
   * Ferme un onglet (avec sauvegarde automatique si modifié)
   */
  async closeTab(tabId, options = {}) {
    const idx = this.tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return;
    const tab = this.tabs[idx];

    // Confirmation avant de fermer un onglet agent (sauf si skipConfirm)
    if (tab.mode === "agent" && !options.skipConfirm) {
      const ok = await confirm("Voulez-vous vraiment fermer l'onglet Agent ?", { title: "Pilot", kind: "warning" });
      if (!ok) return;
    }

    // Sauvegarde auto si modifié (uniquement pour mode edit, pas scratchpad)
    if (tab.mode === "edit" && tab.dirty && !tab.isScratchpad) {
      try {
        const content = getContent(tab.view);
        await invoke("write_file_content", { path: tab.path, content });
      } catch (e) {
        console.error("Erreur sauvegarde auto:", e);
      }
    }

    // Nettoyage split mode
    if (tab.splitMode) {
      this._exitSplitMode(tab);
    }
    // Sauvegarder le scratchpad avant destruction
    if (tab.isScratchpad && tab.view) {
      this._saveScratchpad(tab);
    }
    // Nettoyage
    if (tab.mode === "edit" && tab.view) {
      destroyEditor(tab.view);
    }
    // Nettoyage terminal
    if (tab.mode === "terminal") {
      if (tab.unlistenTerminal) {
        tab.unlistenTerminal();
        tab.unlistenTerminal = null;
      }
      if (tab.terminalId) {
        killTerminal(tab.terminalId).catch(() => {});
        tab.terminalId = null;
      }
      if (tab.wrapper && tab.wrapper._resizeObserver) {
        tab.wrapper._resizeObserver.disconnect();
      }
    }
    // Nettoyage agent RPC
    if (tab.mode === "agent") {
      if (tab.unlistenRpc) {
        tab.unlistenRpc();
        tab.unlistenRpc = null;
      }
      if (tab.unlistenDragDrop) {
        tab.unlistenDragDrop();
        tab.unlistenDragDrop = null;
      }
      // 3.4 : fermer la VUE ne doit PAS tuer l'objet Agent. On supprime l'entrée
      // `agent_views` (l'onglet est retiré ci-dessous via this.tabs.splice) et on
      // pose visible=0 sur l'objet. L'objet reste `loaded` et le processus reste
      // Running/Paused. Arrêt réel UNIQUEMENT via une action explicite (« Arrêter »).
      try {
        await invoke("set_agent_visible", {
          agentId: tab.agentId || "default",
          projectPath: window._pilotProjectPath || null,
          visible: false,
        });
      } catch (_) {}
    }
    // Nettoyage super-agent (spec_super_agent.md) : arrêter la session dédiée.
    if (tab.mode === "superagent") {
      if (tab.unlistenSuperAgent) {
        tab.unlistenSuperAgent();
        tab.unlistenSuperAgent = null;
      }
      if (!options.skipAgentStop) {
        invoke("stop_super_agent_session").catch(() => {});
      }
    }
    // Nettoyage prompt builder
    if (tab.mode === "prompt-builder" && tab.unlistenPromptBuilder) {
      tab.unlistenPromptBuilder();
      tab.unlistenPromptBuilder = null;
    }
    // Nettoyage onglet Aide (❓) — spec_help.md
    if (tab.mode === "help" && tab.unlistenHelp) {
      tab.unlistenHelp();
      tab.unlistenHelp = null;
    }
    // Nettoyage onglet Review (🔍) — spec_review.md (H5)
    if (tab.mode === "review" && tab.unlistenReview) {
      tab.unlistenReview();
      tab.unlistenReview = null;
    }
    // Nettoyage onglet Historique (📜) — spec_session_history.md (H9)
    if (tab.mode === "history" && tab.unlistenHistory) {
      tab.unlistenHistory();
      tab.unlistenHistory = null;
    }
    // Nettoyage onglet Feedback (💬) — spec_feedback.md
    if (tab.mode === "feedback" && tab.unlistenFeedback) {
      tab.unlistenFeedback();
      tab.unlistenFeedback = null;
    }
    // Nettoyage onglet Agents (🎭) — spec_gestion_agents.md
    if (tab.mode === "agents" && tab.unlistenAgents) {
      tab.unlistenAgents();
      tab.unlistenAgents = null;
      invoke("stop_all_agent_processes").catch(() => {});
    }
    // Nettoyage onglet Graphe (📊) — spec_code_graph.md
    if (tab.mode === "code-graph" && tab.unlistenCodeGraph) {
      tab.unlistenCodeGraph();
      tab.unlistenCodeGraph = null;
    }
    // Nettoyage onglet Tableau de bord (📊) — spec_dashboard.md
    if (tab.mode === "dashboard" && tab.unlistenDashboard) {
      tab.unlistenDashboard();
      tab.unlistenDashboard = null;
    }
    if (tab.wrapper && tab.wrapper.parentNode) {
      tab.wrapper.remove();
    }

    // Retirer le bouton onglet
    const btn = this.tabBar.querySelector(`[data-tab-id="${tabId}"]`);
    if (btn) btn.remove();

    this.tabs.splice(idx, 1);

    // Basculer sur un autre onglet ou afficher le message vide
    if (this.activeTabId === tabId) {
      if (this.tabs.length > 0) {
        const next = this.tabs[Math.min(idx, this.tabs.length - 1)];
        this.switchTab(next.id);
      } else {
        this.activeTabId = null;
        this._showEmpty();
      }
    }
    this._scheduleSave();
  }

  /**
   * Ferme un onglet par chemin, sans sauvegarde (utilisé pour suppression)
   */
  closeTabByPath(path) {
    const tab = this.tabs.find((t) => samePath(t.path, path));
    if (!tab) return;
    // Nettoyage split mode
    if (tab.splitMode) {
      this._exitSplitMode(tab);
    }
    // Nettoyage sans sauvegarde
    if (tab.mode === "edit" && tab.view) {
      destroyEditor(tab.view);
    }
    // Nettoyage terminal
    if (tab.mode === "terminal") {
      if (tab.unlistenTerminal) {
        tab.unlistenTerminal();
        tab.unlistenTerminal = null;
      }
      if (tab.terminalId) {
        killTerminal(tab.terminalId).catch(() => {});
        tab.terminalId = null;
      }
      if (tab.wrapper && tab.wrapper._resizeObserver) {
        tab.wrapper._resizeObserver.disconnect();
      }
    }
    // Nettoyage agent RPC
    if (tab.mode === "agent") {
      if (tab.unlistenRpc) {
        tab.unlistenRpc();
        tab.unlistenRpc = null;
      }
      if (tab.unlistenDragDrop) {
        tab.unlistenDragDrop();
        tab.unlistenDragDrop = null;
      }
      // 3.4 : fermer la vue préserve l'objet — on pose visible=0, on n'arrête pas
      // le processus. Arrêt réel uniquement via une action explicite.
      invoke("set_agent_visible", {
        agentId: tab.agentId || "default",
        projectPath: window._pilotProjectPath || null,
        visible: false,
      }).catch(() => {});
    }
    // Nettoyage super-agent (spec_super_agent.md)
    if (tab.mode === "superagent") {
      if (tab.unlistenSuperAgent) {
        tab.unlistenSuperAgent();
        tab.unlistenSuperAgent = null;
      }
      invoke("stop_super_agent_session").catch(() => {});
      // L'onglet Super-agent est GLOBAL : on persiste son état de fermeture dans
      // la config (pas par projet).
      invoke("set_super_agent_open", { open: false }).catch(() => {});
    }
    // Nettoyage prompt builder
    if (tab.mode === "prompt-builder" && tab.unlistenPromptBuilder) {
      tab.unlistenPromptBuilder();
      tab.unlistenPromptBuilder = null;
    }
    // Nettoyage onglet Aide (❓) — spec_help.md
    if (tab.mode === "help" && tab.unlistenHelp) {
      tab.unlistenHelp();
      tab.unlistenHelp = null;
    }
    // Nettoyage onglet Review (🔍) — spec_review.md (H5)
    if (tab.mode === "review" && tab.unlistenReview) {
      tab.unlistenReview();
      tab.unlistenReview = null;
    }
    // Nettoyage onglet Historique (📜) — spec_session_history.md (H9)
    if (tab.mode === "history" && tab.unlistenHistory) {
      tab.unlistenHistory();
      tab.unlistenHistory = null;
    }
    // Nettoyage onglet Feedback (💬) — spec_feedback.md
    if (tab.mode === "feedback" && tab.unlistenFeedback) {
      tab.unlistenFeedback();
      tab.unlistenFeedback = null;
    }
    // Nettoyage onglet Agents (🎭) — spec_gestion_agents.md
    if (tab.mode === "agents" && tab.unlistenAgents) {
      tab.unlistenAgents();
      tab.unlistenAgents = null;
      invoke("stop_all_agent_processes").catch(() => {});
    }
    // Nettoyage onglet Graphe (📊) — spec_code_graph.md
    if (tab.mode === "code-graph" && tab.unlistenCodeGraph) {
      tab.unlistenCodeGraph();
      tab.unlistenCodeGraph = null;
    }
    // Nettoyage onglet Tableau de bord (📊) — spec_dashboard.md
    if (tab.mode === "dashboard" && tab.unlistenDashboard) {
      tab.unlistenDashboard();
      tab.unlistenDashboard = null;
    }
    if (tab.wrapper && tab.wrapper.parentNode) {
      tab.wrapper.remove();
    }
    const btn = this.tabBar.querySelector(`[data-tab-id="${tab.id}"]`);
    if (btn) btn.remove();

    const idx = this.tabs.indexOf(tab);
    this.tabs.splice(idx, 1);

    if (this.activeTabId === tab.id) {
      if (this.tabs.length > 0) {
        const next = this.tabs[Math.min(idx, this.tabs.length - 1)];
        this.switchTab(next.id);
      } else {
        this.activeTabId = null;
        this._showEmpty();
      }
    }
    this._scheduleSave();
  }

  /**
   * Renomme tous les onglets dont le chemin est dans un dossier renommé
   */
  renameFolderTabs(oldFolderPath, newFolderPath) {
    // Normaliser les séparateurs
    const sep = oldFolderPath.includes("\\") ? "\\" : "/";
    const oldPrefix = oldFolderPath.replace(/\//g, sep).replace(new RegExp(sep + "?$"), sep);
    const newPrefix = newFolderPath.replace(/\//g, sep).replace(new RegExp(sep + "?$"), sep);

    for (const tab of this.tabs) {
      const tabPath = tab.path.replace(/\//g, sep);
      if (tabPath === oldFolderPath || tabPath.startsWith(oldPrefix)) {
        const relative = tabPath.slice(oldPrefix.length);
        const newPath = newPrefix + relative;
        this._updateTabPath(tab, newPath);
      }
    }
  }

  /**
   * Met à jour le chemin d'un onglet et son affichage
   */
  _updateTabPath(tab, newPath) {
    tab.path = newPath;
    tab.name = newPath.replace(/\\/g, "/").split("/").pop();
    const btn = this.tabBar.querySelector(`[data-tab-id="${tab.id}"]`);
    if (btn) {
      const icon = tab.mode === "preview" ? "👁️ " : tab.mode === "pdf" ? "📕 " : "csv" ? "📊 " : "";
      const suffix = tab.mode === "preview" ? " (aperçu)" : tab.mode === "pdf" ? " (PDF)" : tab.mode === "csv" ? " (CSV)" : "";
      btn.querySelector(".tab-name").textContent = icon + tab.name + suffix;
      btn.title = tab.path;
    }
    if (tab.wrapper) {
      tab.wrapper.dataset.path = newPath;
    }
    if (this.activeTabId === tab.id) {
      this._updateStatusBar(tab);
    }
    this._scheduleSave();
  }

  /**
   * Met à jour le chemin de tous les onglets liés à un fichier renommé
   * (un même fichier peut être ouvert en mode edit + preview simultanément).
   */
  renameTabPath(oldPath, newPath) {
    for (const tab of this.tabs) {
      if (tab.path === oldPath) {
        this._updateTabPath(tab, newPath);
      }
    }
  }

  /**
   * Bascule vers un onglet
   */
  switchTab(tabId) {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    // Cacher l'ancien
    if (this.activeTabId !== null) {
      const old = this.tabs.find((t) => t.id === this.activeTabId);
      if (old && old.wrapper) old.wrapper.style.display = "none";
      // Retirer classe active de l'ancien bouton
      const oldBtn = this.tabBar.querySelector(
        `[data-tab-id="${this.activeTabId}"]`
      );
      if (oldBtn) oldBtn.classList.remove("active");
      // Tableau de bord : signaler la désactivation (stop auto-refresh).
      if (old && old.mode === "dashboard" && old.dashboardSetActive) {
        old.dashboardSetActive(false);
      }
    }

    // Afficher le nouveau
    this.activeTabId = tabId;
    if (tab.wrapper) {
      tab.wrapper.style.display = "";
      this._hideEmpty();
      // Animation d'ouverture d'un NOUVEL onglet (zoom depuis le point du clic) :
      // uniquement à la première affiche, pas à chaque bascule. L'origine est la
      // position du dernier clic (ligne du fichier / bouton du panneau bas).
      if (tab.animated !== true) {
        tab.animated = true;
        const src = window._pilotLastClick;
        animatePanelOpen(tab.wrapper, src ? src.x : undefined, src ? src.y : undefined);
      }
    }

    // Marquer le bouton actif
    const btn = this.tabBar.querySelector(`[data-tab-id="${tabId}"]`);
    if (btn) btn.classList.add("active");

    // Focus éditeur si mode édition
    if (tab.mode === "edit" && tab.view) {
      setTimeout(() => {
        // Ne pas voler le focus si un renommage d'onglet est en cours (dblclick).
        const rbtn = this.tabBar.querySelector(`[data-tab-id="${tabId}"]`);
        if (rbtn && rbtn.dataset.renaming === "1") return;
        tab.view.focus();
      }, 0);
    }
    // Focus terminal si mode terminal
    if (tab.mode === "terminal" && tab.terminal) {
      setTimeout(() => {
        const rbtn = this.tabBar.querySelector(`[data-tab-id="${tabId}"]`);
        if (rbtn && rbtn.dataset.renaming === "1") return;
        tab.terminal.focus();
      }, 0);
    }

    this._updateStatusBar(tab);
    // Mettre à jour l'outline quand on change d'onglet
    scheduleOutlineUpdate();

    // 3.5 : plus de parking/reprise à la bascule — l'AgentService gère
    // l'idempotence. On réactive simplement les globals d'UI de l'onglet agent.
    if (tab.mode === "agent" && tab.agentElements) activateAgentTab(tab.agentElements);

    // Tableau de bord : recharger les données si le projet actif a changé
    // depuis le dernier affichage (bascule de projet, ouverture/fermeture).
    if (tab.mode === "dashboard") {
      if (tab.dashboardRefresh) tab.dashboardRefresh();
      if (tab.dashboardSetActive) tab.dashboardSetActive(true);
    }

    // Tableau de bord de suivi multi-projets (Assistant 🧭) : recharger à
    // chaque activation de l'onglet.
    if (tab.mode === "superagent" && tab.superTrackingRefresh) {
      tab.superTrackingRefresh();
    }
  }

  _updateCursorPos(view) {
    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    statusCursor.textContent = `Ln ${line.number}, Col ${pos - line.from + 1}`;
  }

  _getFileType(path) {
    const ext = path.split('.').pop().toLowerCase();
    // Use languages.js for rich language names, with image format fallbacks
    const imageTypes = { png: 'PNG', jpg: 'JPEG', jpeg: 'JPEG', gif: 'GIF', webp: 'WebP', svg: 'SVG', bmp: 'BMP', ico: 'ICO', tiff: 'TIFF', tif: 'TIFF', avif: 'AVIF' };
    if (imageTypes[ext]) return imageTypes[ext];
    return getLanguageName(ext);
  }

  _updateStatusBar(tab) {
    if (tab && tab.isScratchpad) {
      this._updateCursorPos(tab.view);
      statusFiletype.textContent = "📝 Brouillon (Markdown)";
      this._updateStats(tab);
      statusEncoding.textContent = "";
      statusEol.textContent = "";
      statusAutosave.textContent = "";
    } else if (tab && tab.mode === "edit") {
      const isMd = tab.path.endsWith('.md') || tab.isScratchpad;
      const ft = this._getFileType(tab.path);
      this._updateCursorPos(tab.view);
      if (tab.splitMode) {
        statusFiletype.textContent = `${ft} (split)    Ctrl+Shift+E Split | Ctrl+Shift+O Outline`;
      } else if (isMd) {
        statusFiletype.textContent = `${ft}    Ctrl+B Gras | Ctrl+I Italique | Ctrl+K Lien | Ctrl+Shift+E Split | Ctrl+Shift+O Outline`;
      } else {
        statusFiletype.textContent = ft;
      }
      // Stats : mots / caractères / lignes
      this._updateStats(tab);
      // Encodage et EOL
      this._updateFileInfo(tab);
    } else if (tab && tab.mode === "agent") {
      statusFiletype.textContent = `${agentDisplayLabel()} (RPC)`;
      statusCursor.textContent = '';
      statusStats.textContent = '';
      statusEncoding.textContent = '';
      statusEol.textContent = '';
      statusAutosave.textContent = '';
    } else if (tab && tab.mode === "superagent") {
      statusFiletype.textContent = `${superAgentDisplayLabel()} (Suivi)`;
      statusCursor.textContent = '';
      statusStats.textContent = '';
      statusEncoding.textContent = '';
      statusEol.textContent = '';
      statusAutosave.textContent = '';
    } else if (tab && tab.mode === "prompt-builder") {
      statusFiletype.textContent = 'Prompt Builder';
      statusCursor.textContent = '';
      statusStats.textContent = '';
      statusEncoding.textContent = '';
      statusEol.textContent = '';
      statusAutosave.textContent = '';
    } else if (tab && tab.mode === "terminal") {
      statusFiletype.textContent = 'Terminal';
      statusCursor.textContent = '';
      statusStats.textContent = '';
      statusEncoding.textContent = '';
      statusEol.textContent = '';
      statusAutosave.textContent = '';
    } else if (tab && tab.mode === "pdf") {
      statusFiletype.textContent = 'PDF (aperçu)';
      statusCursor.textContent = '';
      statusStats.textContent = '';
      statusEncoding.textContent = '';
      statusEol.textContent = '';
      statusAutosave.textContent = '';
    } else if (tab && tab.mode === "csv") {
      statusFiletype.textContent = 'CSV (aperçu)';
      statusCursor.textContent = '';
      statusStats.textContent = '';
      statusEncoding.textContent = '';
      statusEol.textContent = '';
      statusAutosave.textContent = '';
    } else if (tab && tab.mode === "image") {
      statusFiletype.textContent = 'Image (aperçu)';
      statusCursor.textContent = '';
      statusStats.textContent = '';
      statusEncoding.textContent = '';
      statusEol.textContent = '';
      statusAutosave.textContent = '';
    } else if (tab && tab.mode === "preview") {
      statusFiletype.textContent = this._getFileType(tab.path) + ' (aperçu)';
      statusCursor.textContent = '';
      statusStats.textContent = '';
      statusEncoding.textContent = '';
      statusEol.textContent = '';
      statusAutosave.textContent = '';
    } else {
      statusCursor.textContent = '';
      statusFiletype.textContent = '';
      statusStats.textContent = '';
      statusEncoding.textContent = '';
      statusEol.textContent = '';
      statusAutosave.textContent = '';
    }
  }

  /** Compteur de mots / caractères / lignes + temps de lecture */
  _updateStats(tab) {
    if (!tab || !tab.view) { statusStats.textContent = ''; return; }
    const doc = tab.view.state.doc;
    const text = doc.toString();
    const lines = doc.lines;
    const chars = text.length;

    // Compteur de mots : split sur whitespace, ignore les vides
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;

    const isMd = tab.path.endsWith('.md');
    if (isMd) {
      // Temps de lecture estimé (~200 mots/min)
      const minutes = Math.ceil(words / 200);
      const readTime = minutes < 1 ? "< 1 min" : `~${minutes} min`;
      statusStats.textContent = `${words} mots · ${chars} car. · ${lines} lignes · ${readTime} lecture`;
    } else {
      statusStats.textContent = `${chars} car. · ${lines} lignes`;
    }
  }

  /** Encodage et fin de ligne */
  async _updateFileInfo(tab) {
    if (!tab || !tab.path) {
      statusEncoding.textContent = '';
      statusEol.textContent = '';
      statusAutosave.textContent = '';
      return;
    }
    try {
      const info = await invoke("get_file_info", { path: tab.path });
      statusEncoding.textContent = info.encoding;
      statusEol.textContent = info.eol;
    } catch (_) {
      statusEncoding.textContent = '';
      statusEol.textContent = '';
      statusAutosave.textContent = '';
    }
  }

  /** Indicateur visuel auto-save dans la barre de statut */
  _updateAutoSaveStatus() {
    const el = document.getElementById("status-autosave");
    if (!el) return;
    if (this._autoSaveEnabled) {
      el.textContent = `💾 Auto (${this._autoSaveDelay / 1000}s)`;
      el.title = `Sauvegarde automatique toutes les ${this._autoSaveDelay / 1000}s`;
    } else {
      el.textContent = '';
    }
  }

  /** Applique le word wrap sur tous les onglets éditeur ouverts */
  _applyWordWrap() {
    for (const tab of this.tabs) {
      if (tab.mode === "edit" && tab.view) {
        setWordWrap(tab.view, this._wordWrapEnabled);
      }
    }
  }

  /** Programme un auto-save après modification */
  scheduleAutoSave() {
    if (!this._autoSaveEnabled) return;
    if (this._autoSaveTimer) clearTimeout(this._autoSaveTimer);
    this._autoSaveTimer = setTimeout(() => {
      this._doAutoSave();
    }, this._autoSaveDelay);
  }

  /** Exécute l'auto-save pour tous les onglets dirty */
  async _doAutoSave() {
    for (const tab of this.tabs) {
      if (tab.dirty && tab.mode === "edit" && tab.view) {
        try {
          if (tab.isScratchpad) {
            this._saveScratchpad(tab);
          } else {
            const { getContent } = await import("./editor.js");
            const content = getContent(tab.view);
            await invoke("write_file_content", { path: tab.path, content });
            tab.dirty = false;
            tab.savedContent = content;
          }
          const btn = this.tabBar.querySelector(`[data-tab-id="${tab.id}"]`);
          if (btn) {
            const dirty = btn.querySelector(".tab-dirty");
            if (dirty) dirty.remove();
          }
        } catch (_) {
          // Silencieux — on réessayera à la prochaine modification
        }
      }
    }
  }

  /**
   * Recharge un fichier modifié extérieurement
   */
  async refreshFile(path) {
    const tab = this.tabs.find((t) => t.path === path && t.mode === "edit");
    if (!tab) return;

    let newContent;
    try {
      newContent = await invoke("read_file_content", { path });
    } catch (_) {
      return; // fichier supprimé ?
    }

    const currentContent = getContent(tab.view);
    if (tab.dirty) {
      // Issue #20 : si le disque correspond exactement à notre dernière
      // sauvegarde (savedContent), la modification détectée provient de notre
      // propre écriture (auto-save ou Ctrl+S) que le poller a remontée comme
      // événement « modify ». Ce n'est PAS un conflit : l'utilisateur garde ses
      // modifications locales non sauvegardées par-dessus notre sauvegarde.
      if (newContent === tab.savedContent) return;
      // Conflit réel : l'utilisateur a des modifications locales non
      // sauvegardées ET le disque a été modifié par un processus externe.
      this._showConflictTab(tab);
    } else if (currentContent === newContent) {
      // Contenu identique (ex: après Ctrl+S) → pas besoin de recharger
      return;
    } else {
      // Pas de modifications locales → rechargement silencieux (curseur préservé)
      setContent(tab.view, newContent);
      tab.savedContent = newContent;
    }
  }

  _markConflictTab(tab) {
    const btn = this.tabBar.querySelector(`[data-tab-id="${tab.id}"]`);
    if (btn) {
      btn.classList.add("tab-conflict");
      btn.title = "⚠️ Ce fichier a été modifié extérieurement — cliquez pour résoudre";
    }
  }

  _clearConflictTab(tab) {
    const btn = this.tabBar.querySelector(`[data-tab-id="${tab.id}"]`);
    if (btn) {
      btn.classList.remove("tab-conflict");
      btn.title = tab.path;
    }
  }

  /**
   * Conflit de fichier : un fichier ouvert avec des modifications locales non
   * sauvegardées (dirty) a été modifié extérieurement. Affiche un dialogue à
   * 3 choix : Recharger (écrase le local) / Garder ma version (ignore le disque)
   * / Voir le diff (avant/après, read-only).
   */
  _showConflictTab(tab) {
    const localContent = getContent(tab.view);
    this._markConflictTab(tab);

    // Nettoyer une éventuelle modale précédente.
    const prev = document.getElementById("conflict-overlay");
    if (prev) prev.remove();

    const overlay = document.createElement("div");
    overlay.id = "conflict-overlay";
    overlay.className = "git-diff-overlay";

    const dialog = document.createElement("div");
    dialog.className = "git-diff-dialog conflict-dialog";

    const bar = document.createElement("div");
    bar.className = "git-diff-bar";
    bar.innerHTML =
      `<span class="git-diff-title">⚠️ Conflit de fichier</span>` +
      `<span class="git-diff-sub">${esc(tab.name)} a été modifié extérieurement.</span>`;
    dialog.appendChild(bar);

    const body = document.createElement("div");
    body.className = "git-diff-body";
    body.innerHTML =
      `<p class="conflict-expl">Ce fichier a été modifié sur le disque alors que vous avez des ` +
      `modifications locales non sauvegardées. Que voulez-vous faire ?</p>` +
      `<p class="conflict-warn">⚠️ Recharger écrase vos modifications locales non sauvegardées.</p>`;
    dialog.appendChild(body);

    const actions = document.createElement("div");
    actions.className = "conflict-actions";
    const btnReload = document.createElement("button");
    btnReload.className = "conflict-btn conflict-btn-danger";
    btnReload.textContent = "🔄 Recharger (disque)";
    const btnKeep = document.createElement("button");
    btnKeep.className = "conflict-btn";
    btnKeep.textContent = "💾 Garder ma version";
    const btnDiff = document.createElement("button");
    btnDiff.className = "conflict-btn conflict-btn-primary";
    btnDiff.textContent = "👁️ Voir le diff";
    actions.appendChild(btnKeep);
    actions.appendChild(btnDiff);
    actions.appendChild(btnReload);
    dialog.appendChild(actions);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const close = (keepDirty) => {
      overlay.remove();
      if (keepDirty) {
        // Garder ma version : retirer l'indicateur mais garder dirty (modifs locales)
        this._clearConflictTab(tab);
      }
    };

    btnKeep.addEventListener("click", () => {
      close(true);
    });

    btnDiff.addEventListener("click", async () => {
      let diskContent;
      try {
        diskContent = await invoke("read_file_content", { path: tab.path });
      } catch (_) {
        diskContent = "";
      }
      // Diff read-only : avant = version locale, après = version disque
      openGitDiffModal({
        before: localContent,
        after: diskContent,
        title: tab.name,
        subtitle: "Votre version (avant) ↔ disque (après)",
      });
    });

    btnReload.addEventListener("click", async () => {
      try {
        const newContent = await invoke("read_file_content", { path: tab.path });
        setContent(tab.view, newContent);
        tab.savedContent = newContent;
        tab.dirty = false;
        this._clearConflictTab(tab);
        this._updateTabButton(tab);
        close(false);
      } catch (_) {}
    });

    const onKey = (e) => {
      if (e.key === "Escape") {
        close(true);
        document.removeEventListener("keydown", onKey);
      }
    };
    document.addEventListener("keydown", onKey);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        close(true);
        document.removeEventListener("keydown", onKey);
      }
    });
  }

  /**
   * Obtient le tab actif
   */
  getActiveTab() {
    return this.tabs.find((t) => t.id === this.activeTabId) || null;
  }

  /**
   * Délègue la sauvegarde de session (debounce)
   */
  _scheduleSave() {
    scheduleSave(this, window._pilotProjectPath);
  }

  /**
   * Vérifie si un fichier est déjà ouvert
   */
  isOpen(path) {
    return this.tabs.some((t) => t.path === path);
  }

  // ── Split View (Édition + Prévisualisation côte à côte) ──

  /**
   * Bascule le mode split pour l'onglet actif (uniquement fichiers .md en mode edit)
   */
  async toggleSplitMode() {
    const tab = this.getActiveTab();
    if (!tab || tab.mode !== "edit" || (!tab.path.endsWith(".md") && !tab.isScratchpad)) return;

    if (tab.splitMode) {
      this._exitSplitMode(tab);
    } else {
      await this._enterSplitMode(tab);
    }
  }

  /**
   * Entre en mode split : éditeur à gauche, prévisualisation à droite
   */
  async _enterSplitMode(tab) {
    if (tab.splitMode) return;
    tab.splitMode = true;
    tab.wrapper.classList.add("split-mode");

    // Créer le séparateur
    const divider = document.createElement("div");
    divider.className = "split-divider";
    tab.wrapper.appendChild(divider);
    tab.splitDivider = divider;

    // Créer le panneau de prévisualisation
    const previewPane = document.createElement("div");
    previewPane.className = "split-pane-preview";
    tab.wrapper.appendChild(previewPane);
    tab.splitPreviewPane = previewPane;

    // Rendre le markdown dans la prévisualisation
    const content = getContent(tab.view);
    const previewWrapper = await createPreview(previewPane, content, window._pilotProjectPath || null);
    tab.splitPreviewWrapper = previewWrapper;
    // Issue #22 : chemin source pour résoudre les liens relatifs de la prévisualisation
    previewWrapper.dataset.sourcePath = tab.path;
    bindMermaidFunctions(previewPane);

    // Configurer le drag du séparateur
    this._setupSplitDividerDrag(tab);

    // Configurer la synchronisation du scroll
    this._setupSplitScrollSync(tab);

    // Mettre à jour la barre de statut
    this._updateStatusBar(tab);

    // Forcer le redimensionnement de l'éditeur
    if (tab.view) {
      requestAnimationFrame(() => {
        tab.view.requestMeasure();
      });
    }
  }

  /**
   * Sort du mode split : supprime la prévisualisation et le séparateur
   */
  _exitSplitMode(tab) {
    if (!tab.splitMode) return;
    tab.splitMode = false;
    tab.wrapper.classList.remove("split-mode");

    // Nettoyer les listeners de scroll
    this._cleanupSplitScrollSync(tab);

    // Nettoyer le drag du séparateur
    this._cleanupSplitDividerDrag(tab);

    // Supprimer le panneau de prévisualisation et le séparateur
    if (tab.splitPreviewPane) {
      tab.splitPreviewPane.remove();
      tab.splitPreviewPane = null;
    }
    if (tab.splitDivider) {
      tab.splitDivider.remove();
      tab.splitDivider = null;
    }
    tab.splitPreviewWrapper = null;

    // Annuler le timer de mise à jour
    if (tab.splitUpdateTimer) {
      clearTimeout(tab.splitUpdateTimer);
      tab.splitUpdateTimer = null;
    }

    // Réinitialiser les styles inline potentiels du drag
    const cmEditor = tab.wrapper.querySelector(".cm-editor");
    if (cmEditor) {
      cmEditor.style.flex = "";
      cmEditor.style.width = "";
    }

    // Mettre à jour la barre de statut
    this._updateStatusBar(tab);

    // Forcer le redimensionnement de l'éditeur
    if (tab.view) {
      requestAnimationFrame(() => {
        tab.view.requestMeasure();
      });
    }
  }

  /**
   * Met à jour la prévisualisation en mode split (debounce)
   */
  _updateSplitPreview(tab) {
    if (!tab.splitMode || !tab.splitPreviewWrapper) return;
    if (tab.splitUpdateTimer) clearTimeout(tab.splitUpdateTimer);
    tab.splitUpdateTimer = setTimeout(async () => {
      if (!tab.splitMode || !tab.splitPreviewWrapper) return;
      try {
        // Issue #24 : préserver la position de scroll de la prévisualisation
        // pendant le re-rendu, sinon le panneau saute en haut à chaque frappe
        // et casse la synchro de scroll.
        const pane = tab.splitPreviewPane;
        const prevScrollTop = pane ? pane.scrollTop : 0;
        const content = getContent(tab.view);
        await updatePreview(tab.splitPreviewWrapper, content, window._pilotProjectPath || null);
    // Issue #22 : chemin source pour résoudre les liens relatifs de la prévisualisation
    tab.splitPreviewWrapper.dataset.sourcePath = tab.path;
        bindMermaidFunctions(tab.splitPreviewPane);
        if (pane) pane.scrollTop = prevScrollTop;
      } catch (e) {
        console.error("Erreur mise à jour split preview:", e);
      }
    }, 300);
  }

  /**
   * Configure la synchronisation du scroll entre éditeur et prévisualisation
   */
  _setupSplitScrollSync(tab) {
    const cmScroller = tab.view?.scrollDOM;
    if (!cmScroller || !tab.splitPreviewPane) return;

    let scrollingFrom = null;

    // Éditeur → Prévisualisation
    tab.splitEditorScrollHandler = () => {
      if (scrollingFrom === "preview") return;
      scrollingFrom = "editor";
      this._syncScrollEditorToPreview(tab);
      setTimeout(() => { scrollingFrom = null; }, 50);
    };
    cmScroller.addEventListener("scroll", tab.splitEditorScrollHandler);

    // Prévisualisation → Éditeur
    tab.splitPreviewScrollHandler = () => {
      if (scrollingFrom === "editor") return;
      scrollingFrom = "preview";
      this._syncScrollPreviewToEditor(tab);
      setTimeout(() => { scrollingFrom = null; }, 50);
    };
    tab.splitPreviewPane.addEventListener("scroll", tab.splitPreviewScrollHandler);

    // Clic sur un heading dans la prévisualisation → scroll éditeur
    tab.splitClickHandler = (e) => {
      const heading = e.target.closest("h1, h2, h3, h4, h5, h6");
      if (!heading || !tab.view) return;
      const headingText = heading.textContent.trim();
      // Chercher la ligne correspondante dans le markdown source
      const content = getContent(tab.view);
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/^#{1,6}\s+(.+)/);
        if (match && match[1].trim().replace(/[*`]/g, "") === headingText.replace(/[*`]/g, "")) {
          const line = tab.view.state.doc.line(i + 1);
          tab.view.dispatch({
            selection: { anchor: line.from },
            scrollIntoView: true,
          });
          break;
        }
      }
    };
    tab.splitPreviewPane.addEventListener("click", tab.splitClickHandler);
  }

  /**
   * Nettoie les listeners de synchronisation du scroll
   */
  _cleanupSplitScrollSync(tab) {
    const cmScroller = tab.view?.scrollDOM;
    if (cmScroller && tab.splitEditorScrollHandler) {
      cmScroller.removeEventListener("scroll", tab.splitEditorScrollHandler);
    }
    if (tab.splitPreviewPane && tab.splitPreviewScrollHandler) {
      tab.splitPreviewPane.removeEventListener("scroll", tab.splitPreviewScrollHandler);
    }
    if (tab.splitPreviewPane && tab.splitClickHandler) {
      tab.splitPreviewPane.removeEventListener("click", tab.splitClickHandler);
    }
    tab.splitEditorScrollHandler = null;
    tab.splitPreviewScrollHandler = null;
    tab.splitClickHandler = null;
  }

  /**
   * Synchronise le scroll de l'éditeur vers la prévisualisation (proportionnel)
   */
  _syncScrollEditorToPreview(tab) {
    if (!tab.splitPreviewPane || !tab.view) return;
    const cmScroller = tab.view.scrollDOM;
    if (!cmScroller) return;

    const editorMaxScroll = cmScroller.scrollHeight - cmScroller.clientHeight;
    const previewMaxScroll = tab.splitPreviewPane.scrollHeight - tab.splitPreviewPane.clientHeight;

    if (editorMaxScroll <= 0 || previewMaxScroll <= 0) return;

    const ratio = cmScroller.scrollTop / editorMaxScroll;
    tab.splitPreviewPane.scrollTop = ratio * previewMaxScroll;
  }

  /**
   * Synchronise le scroll de la prévisualisation vers l'éditeur (proportionnel)
   */
  _syncScrollPreviewToEditor(tab) {
    if (!tab.view) return;
    const cmScroller = tab.view.scrollDOM;
    if (!cmScroller || !tab.splitPreviewPane) return;

    const editorMaxScroll = cmScroller.scrollHeight - cmScroller.clientHeight;
    const previewMaxScroll = tab.splitPreviewPane.scrollHeight - tab.splitPreviewPane.clientHeight;

    if (editorMaxScroll <= 0 || previewMaxScroll <= 0) return;

    const ratio = tab.splitPreviewPane.scrollTop / previewMaxScroll;
    cmScroller.scrollTop = ratio * editorMaxScroll;
  }

  /**
   * Configure le drag du séparateur pour redimensionner les panneaux
   */
  _setupSplitDividerDrag(tab) {
    const divider = tab.splitDivider;
    if (!divider) return;

    let isDragging = false;
    let startX = 0;
    let startEditorWidth = 0;

    const onMouseDown = (e) => {
      isDragging = true;
      startX = e.clientX;
      const cmEditor = tab.wrapper.querySelector(".cm-editor");
      startEditorWidth = cmEditor ? cmEditor.getBoundingClientRect().width : 0;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      e.preventDefault();
    };

    const onMouseMove = (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const wrapperWidth = tab.wrapper.getBoundingClientRect().width;
      const dividerWidth = tab.splitDivider.getBoundingClientRect().width;
      const newEditorWidth = startEditorWidth + dx;
      const ratio = newEditorWidth / (wrapperWidth - dividerWidth);
      const clampedRatio = Math.max(0.2, Math.min(0.8, ratio));

      const cmEditor = tab.wrapper.querySelector(".cm-editor");
      if (cmEditor) {
        cmEditor.style.flex = `0 0 ${clampedRatio * 100}%`;
      }
      if (tab.splitPreviewPane) {
        tab.splitPreviewPane.style.flex = `0 0 ${(1 - clampedRatio) * 100}%`;
      }
    };

    const onMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // Forcer le redimensionnement de l'éditeur CodeMirror
      if (tab.view) {
        requestAnimationFrame(() => {
          tab.view.requestMeasure();
        });
      }
    };

    divider.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);

    tab.splitDragHandlers = { onMouseDown, onMouseMove, onMouseUp };
  }

  /**
   * Nettoie les listeners du drag du séparateur
   */
  _cleanupSplitDividerDrag(tab) {
    if (tab.splitDragHandlers) {
      const { onMouseMove, onMouseUp } = tab.splitDragHandlers;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      // onMouseDown est sur le divider, qui sera supprimé
      tab.splitDragHandlers = null;
    }
  }

  // ── Méthodes privées ──

  _renderTabButton(tab) {
    const btn = document.createElement("div");
    const special = ["agent", "terminal", "help", "review", "history", "feedback", "agents", "prompt-builder", "superagent", "dashboard"].includes(tab.mode);
    btn.className = `tab${tab.mode === "preview" || tab.mode === "pdf" ? " preview" : ""}${special ? " tab-special" : ""}${tab.mode === "superagent" ? " tab-superagent" : ""}${tab.mode === "dashboard" ? " tab-dashboard" : ""}`;
    btn.dataset.tabId = tab.id;

    const icon = tab.mode === "preview" ? "👁️ " : tab.mode === "pdf" ? "📕 " : tab.mode === "image" ? "🖼️ " : tab.mode === "csv" ? "📊 " : tab.mode === "terminal" ? (tab.isAgentTerminal ? "π " : (tab.projectCommandId ? "▶ " : "🖥️ ")) : tab.mode === "agent" ? "π " : tab.mode === "superagent" ? "🧭 " : tab.mode === "history" ? "📜 " : tab.isScratchpad ? "" : tab.mode === "prompt-builder" ? "🧩 " : "";
    const suffix = tab.isScratchpad ? " (Brouillon)" : tab.mode === "preview" ? " (aperçu)" : tab.mode === "pdf" ? " (PDF)" : tab.mode === "image" ? " (image)" : tab.mode === "csv" ? " (CSV)" : tab.mode === "agent" ? " (RPC)" : tab.mode === "superagent" ? " (Suivi)" : tab.mode === "history" ? " (Sessions)" : tab.mode === "prompt-builder" ? " (Prompt)" : "";

    btn.innerHTML = `
      <span class="tab-name">${icon}${tab.name}${suffix}</span>
      ${tab.dirty ? '<span class="tab-dirty">●</span>' : ""}
      <span class="tab-close" data-close="${tab.id}">×</span>
    `;

    btn.addEventListener("click", (e) => {
      if (e.target.dataset.close) {
        e.stopPropagation();
        this.closeTab(tab.id);
      } else {
        this.switchTab(tab.id);
      }
    });

    // Clic milieu pour fermer
    btn.addEventListener("auxclick", (e) => {
      if (e.button === 1) {
        e.preventDefault();
        this.closeTab(tab.id);
      }
    });

    // Double-clic sur le nom → renommer le fichier (onglets liés à un fichier
    // uniquement) OU renommer un onglet agent (multi-onglets agents).
    const nameSpan = btn.querySelector(".tab-name");
    const canRename = (tab.path && !tab.isScratchpad) || (tab.mode === "agent" && this._multiAgentEnabled);
    if (nameSpan && canRename) {
      nameSpan.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        this._startTabRename(btn, tab, nameSpan);
      });
    }

    // L'onglet Super-agent (🧭) doit TOUJOURS rester le plus à gauche, avant
    // même le bouton « + » d'ajout d'agents. On l'insère donc avant ce bouton
    // (`.tab-add-agent`) s'il existe, sinon en tête de barre.
    if (tab.mode === "superagent") {
      const addBtn = this.tabBar.querySelector(".tab-add-agent");
      if (addBtn) this.tabBar.insertBefore(btn, addBtn);
      else this.tabBar.prepend(btn);
    } else if (tab.mode === "dashboard" && this._dashboardAutoOpen) {
      // Évolution « Tableau de bord systématique » : quand l'option est activée,
      // l'onglet 📊 est verrouillé juste après l'onglet 🧭 Assistant (`.tab-superagent`)
      // et avant le bouton « + » (`.tab-add-agent`). Ordre visé : 🧭 → 📊 → ＋ → π.
      const superBtn = this.tabBar.querySelector(".tab-superagent");
      const addBtn = this.tabBar.querySelector(".tab-add-agent");
      if (superBtn && superBtn.nextSibling) this.tabBar.insertBefore(btn, superBtn.nextSibling);
      else if (addBtn) this.tabBar.insertBefore(btn, addBtn);
      else this.tabBar.appendChild(btn);
    } else {
      this.tabBar.appendChild(btn);
    }

    // Drag & drop pour réorganiser les onglets (sauf le Super-agent, qui doit
    // rester TOUJOURS le plus à gauche, et le Tableau de bord quand l'option
    // « Tableau de bord systématique » est activée, qui est verrouillé en position).
    if (tab.mode !== "superagent" && !(tab.mode === "dashboard" && this._dashboardAutoOpen)) {
      this._initTabDragHandlers(btn, tab);
    }
  }

  /**
   * Évolution « Tableau de bord systématique » : re-positionne l'onglet 📊 dans
   * la barre d'onglets quand l'option `dashboard_auto_open` change. Quand elle
   * est activée, l'onglet est inséré après l'onglet 🧭 Assistant et avant le
   * bouton « + » ; quand elle est désactivée, il redevient un onglet normal
   * (déplaçable, en fin de barre).
   */
  _repositionDashboardTab() {
    const tab = this.tabs.find((t) => t.mode === "dashboard");
    if (!tab) return;
    const btn = this.tabBar.querySelector(`[data-tab-id="${tab.id}"]`);
    if (!btn) return;
    // Retirer le bouton puis le re-rendre pour appliquer la nouvelle position
    // et le nouveau comportement de drag.
    btn.remove();
    this._renderTabButton(tab);
  }

  /**
   * Configure le drag manuel sur un bouton d'onglet pour réorganiser les onglets.
   * L'ordre est persisté via _scheduleSave -> saveTabSession (tableau tabs.tabs).
   * Drag manuel (mousedown/mousemove/mouseup) car l'API HTML5 dragstart/drop est
   * neutralisée par Tauri dragDropEnabled=true (réservée aux fichiers externes).
   */
  _initTabDragHandlers(btn, tab) {
    btn.addEventListener("mousedown", (e) => {
      // Bouton gauche uniquement, pas sur le bouton close, pas pendant un renommage.
      if (e.button !== 0) return;
      if (e.target.closest(".tab-close")) return;
      if (btn.dataset.renaming === "1") return;
      e.preventDefault(); // empêcher la sélection de texte native pendant le drag manuel
      this._dragState = {
        tab, btn,
        startX: e.clientX, startY: e.clientY,
        dragging: false,
        indicatorBtn: null,
      };
    });
  }

  /** Installe une fois les listeners globaux de drag (mousemove/mouseup sur document). */
  _bindDragGlobalListeners() {
    document.addEventListener("mousemove", (e) => this._onDragMouseMove(e));
    document.addEventListener("mouseup", (e) => this._onDragMouseUp(e));
  }

  _onDragMouseMove(e) {
    const ds = this._dragState;
    if (!ds) return;
    if (!ds.dragging) {
      const dx = e.clientX - ds.startX;
      const dy = e.clientY - ds.startY;
      if (Math.abs(dx) < this._dragThreshold && Math.abs(dy) < this._dragThreshold) return;
      ds.dragging = true;
      ds.btn.classList.add("dragging");
    }
    // Empêcher la sélection de texte pendant le drag.
    e.preventDefault();
    const target = this._tabBtnAtPoint(e.clientX, e.clientY);
    this._setManualDropIndicator(target, e.clientX, ds.tab.id);
  }

  _onDragMouseUp(e) {
    const ds = this._dragState;
    if (!ds) return;
    if (ds.dragging) {
      const target = this._tabBtnAtPoint(e.clientX, e.clientY);
      if (target && target.dataset.tabId !== String(ds.tab.id)) {
        const rect = target.getBoundingClientRect();
        const isAfter = (e.clientX - rect.left) > rect.width / 2;
        this._reorderTab(String(ds.tab.id), target.dataset.tabId, isAfter);
      }
      this._clearAllDragIndicators();
      ds.btn.classList.remove("dragging");
    }
    this._dragState = null;
  }

  /** Trouve le bouton d'onglet sous un point (x,y), ou null si hors barre d'onglets. */
  _tabBtnAtPoint(x, y) {
    const barRect = this.tabBar.getBoundingClientRect();
    if (y < barRect.top - 4 || y > barRect.bottom + 4) return null;
    const btns = [...this.tabBar.querySelectorAll("[data-tab-id]")];
    if (!btns.length) return null;
    const firstR = btns[0].getBoundingClientRect();
    if (x < firstR.left) return btns[0];
    const lastR = btns[btns.length - 1].getBoundingClientRect();
    if (x > lastR.right) return btns[btns.length - 1];
    for (const b of btns) {
      const r = b.getBoundingClientRect();
      if (x >= r.left && x <= r.right) return b;
    }
    return null;
  }

  /** Affiche l'indicateur de drop manuel (avant/après la cible), sauf sur la source. */
  _setManualDropIndicator(btn, x, sourceId) {
    this._clearAllDragIndicators();
    if (!btn || btn.dataset.tabId === String(sourceId)) return;
    const rect = btn.getBoundingClientRect();
    const isAfter = (x - rect.left) > rect.width / 2;
    btn.classList.add(isAfter ? "tab-drop-after" : "tab-drop-before");
  }

  /** Retire tous les indicateurs de drop dans la barre d'onglets */
  _clearAllDragIndicators() {
    this.tabBar.querySelectorAll(".tab-drop-before, .tab-drop-after")
      .forEach((el) => {
        el.classList.remove("tab-drop-before", "tab-drop-after");
      });
    this._dropIndicatorBtn = null;
  }

  /**
   * Réorganise this.tabs et le DOM : déplace sourceId juste avant/après targetId.
   * Déclenche la persistance de la session pour garder l'ordre entre les sessions.
   */
  /**
   * Déplace un onglet à un index précis dans `tabs.tabs` + la barre d'onglets
   * (utilisé par restoreTabs pour rétablir la position persistée de l'onglet
   * agent).
   */
  _moveTabToIndex(tabId, targetIndex) {
    const sourceIdx = this.tabs.findIndex((t) => String(t.id) === String(tabId));
    if (sourceIdx === -1) return;
    // Le Super-agent (🧭) doit rester en première position : on ne peut pas
    // déplacer un autre onglet à l'index 0 s'il est occupé par le super-agent.
    const superAgentIdx = this.tabs.findIndex((t) => t.mode === "superagent");
    if (superAgentIdx === 0 && targetIndex === 0 && String(this.tabs[0].id) !== String(tabId)) {
      targetIndex = 1;
    }
    const [movedTab] = this.tabs.splice(sourceIdx, 1);
    const btn = this.tabBar.querySelector(`[data-tab-id="${tabId}"]`);
    if (btn) btn.remove();
    // Après retrait, `this.tabs` et la tabBar ont N-1 éléments en correspondance.
    const clamped = Math.max(0, Math.min(targetIndex, this.tabs.length));
    this.tabs.splice(clamped, 0, movedTab);
    if (btn) {
      // Le bouton « + » (`.tab-add-agent`) est le premier enfant de la barre
      // d'onglets quand le multi-onglets agents est actif. Il n'a pas de
      // `data-tab-id` et n'apparaît donc pas dans `this.tabs` : il faut décaler
      // l'index DOM de +1 pour retomber sur le bon onglet.
      const addBtn = this.tabBar.querySelector(".tab-add-agent");
      const domIdx = addBtn ? clamped + 1 : clamped;
      const ref = this.tabBar.children[domIdx];
      if (ref) this.tabBar.insertBefore(btn, ref);
      else this.tabBar.appendChild(btn);
    }
  }

  _reorderTab(sourceId, targetId, insertAfter) {
    if (String(sourceId) === String(targetId)) return;
    // Le Super-agent (🧭) doit rester TOUJOURS le plus à gauche : on ne peut
    // pas placer un onglet avant lui (le drop sur sa moitié gauche est forcé
    // « après »).
    const targetTab = this.tabs.find((t) => String(t.id) === String(targetId));
    if (targetTab && targetTab.mode === "superagent" && !insertAfter) {
      insertAfter = true;
    }
    const sourceIdx = this.tabs.findIndex((t) => String(t.id) === String(sourceId));
    const targetIdx = this.tabs.findIndex((t) => String(t.id) === String(targetId));
    if (sourceIdx === -1 || targetIdx === -1) return;

    const [movedTab] = this.tabs.splice(sourceIdx, 1);
    const sourceBtn = this.tabBar.querySelector(`[data-tab-id="${sourceId}"]`);
    const targetBtn = this.tabBar.querySelector(`[data-tab-id="${targetId}"]`);

    // Index cible après retrait de la source
    const newTargetIdx = this.tabs.findIndex((t) => String(t.id) === String(targetId));
    const insertIdx = insertAfter ? newTargetIdx + 1 : newTargetIdx;
    this.tabs.splice(insertIdx, 0, movedTab);

    if (sourceBtn && targetBtn) {
      if (insertAfter) {
        targetBtn.after(sourceBtn);
      } else {
        targetBtn.before(sourceBtn);
      }
    }

    this._scheduleSave();
  }

  /**
   * Passe le nom de l'onglet en mode édition inline pour renommer le fichier lié.
   * Entrée = valider, Échap = annuler, blur = valider.
   * Uniquement pour les onglets liés à un fichier (pas agent/terminal/brouillon).
   */
  _startTabRename(btn, tab, nameSpan) {
    // Les onglets sans fichier (aide, review, terminal, prompt-builder) ne sont
    // pas renommables : pas de path sur disque → rename_file_or_dir échouerait.
    // Exception : les onglets agent (multi-onglets agents) sont renommables en
    // simple libellé (pas de fichier sur disque).
    if (["help", "review", "terminal", "prompt-builder"].includes(tab.mode)) return;
    const oldName = tab.name;
    const oldPath = tab.path;
    const originalHTML = nameSpan.innerHTML;

    btn.dataset.renaming = "1"; // empêcher le drag pendant l'édition
    const input = document.createElement("input");
    input.type = "text";
    input.className = "tab-rename-input";
    input.value = oldName;
    input.draggable = false;
    input.addEventListener("click", (e) => e.stopPropagation());

    nameSpan.innerHTML = "";
    nameSpan.appendChild(input);
    input.focus();
    // Sélectionner le nom sans l'extension
    const dotIdx = oldName.lastIndexOf(".");
    if (dotIdx > 0) {
      input.setSelectionRange(0, dotIdx);
    } else {
      input.select();
    }

    let done = false;
    const finish = async (commit) => {
      if (done) return;
      done = true;
      input.remove();
      btn.dataset.renaming = "0";
      const newName = input.value.trim();
      if (!commit || !newName || newName === oldName) {
        nameSpan.innerHTML = originalHTML;
        return;
      }
      // Onglet agent (multi-onglets) : simple renommage du libellé, pas de
      // fichier sur disque.
      if (tab.mode === "agent") {
        tab.name = newName;
        nameSpan.innerHTML = originalHTML;
        const icon = "π ";
        nameSpan.textContent = `${icon}${newName} (RPC)`;
        this._scheduleSave();
        return;
      }
      try {
        const newPath = await invoke("rename_file_or_dir", { sourcePath: oldPath, newName });
        this.renameTabPath(oldPath, newPath);
        const { getSidebar } = await import("./sidebar.js");
        const sidebar = getSidebar();
        if (sidebar) await sidebar._rebuildTree();
        const { toastSuccess } = await import("./toast.js");
        toastSuccess("Renommé en " + newName);
      } catch (err) {
        nameSpan.innerHTML = originalHTML;
        const { toastError } = await import("./toast.js");
        toastError("Erreur renommage : " + err);
      }
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
  }

  _updateTabButton(tab) {
    const btn = this.tabBar.querySelector(`[data-tab-id="${tab.id}"]`);
    if (!btn) return;
    const dirtySpan = btn.querySelector(".tab-dirty");
    if (tab.dirty && !dirtySpan) {
      const span = document.createElement("span");
      span.className = "tab-dirty";
      span.textContent = "●";
      const closeBtn = btn.querySelector(".tab-close");
      btn.insertBefore(span, closeBtn);
    } else if (!tab.dirty && dirtySpan) {
      dirtySpan.remove();
    }
  }

  _showEmpty() {
    const el = document.getElementById("empty-logo");
    if (el) el.classList.remove("hidden");
  }

  _hideEmpty() {
    const el = document.getElementById("empty-logo");
    if (el) el.classList.add("hidden");
  }

  /**
   * Onglets dans l'ORDRE VISUEL de la barre d'onglets (issue #58).
   * L'ordre de `this.tabs` (tableau) peut diverger de l'ordre affiché : le
   * bouton « ＋ » (`.tab-add-agent`) est toujours prepend en tête de la barre
   * et n'a pas de `data-tab-id`, et certains onglets (ex: 🧭 Assistant) sont
   * insérés en tête visuellement. On interroge donc le DOM (ordre réel) et on
   * exclut le bouton « ＋ » pour que Ctrl+1..9 suive l'ordre visuel réel.
   * @returns {Array<object>} onglets dans l'ordre visuel (bouton « ＋ » exclu).
   */
  getTabsInVisualOrder() {
    const byId = new Map(this.tabs.map((t) => [t.id, t]));
    const order = [];
    const buttons = this.tabBar.querySelectorAll("[data-tab-id]");
    for (const btn of buttons) {
      const tab = byId.get(btn.dataset.tabId);
      if (tab) order.push(tab);
    }
    return order;
  }
}

let instance = null;

export function initTabs() {
  instance = new TabsManager();
  return instance;
}

export function getTabsManager() {
  return instance;
}
