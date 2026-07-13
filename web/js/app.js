// app.js — UI web distante Pilot (mode remote)
// Module ES unique (servi par axum, sans build Vite).
// Spécification : spec_web_remote.md (§5, §9, §13.7).
//
// Fonctionnalités :
//   - Login (mot de passe → token opaque), token persisté en localStorage.
//   - WebSocket /ws/agent avec reconnexion auto (backoff exponentiel).
//   - Resync au onopen : GET /api/agent/state, /api/models, /api/project (décision 13.7).
//   - Chat : streaming texte/pensées/outils, sélecteur de modèle, abort/new/compact.
//   - Fichiers : arborescence (lecture) + visionneuse.
//   - Projets : récents + browse racines (whitelist backend).

const TOKEN_KEY = 'pilot_web_token';

// ──État global ──
const state = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  ws: null,
  wsConnected: false,
  reconnectAttempt: 0,
  reconnectTimer: null,
  // Chat
  isStreaming: false,
  currentAssistantBlock: null,
  currentTextBlock: null,
  currentThinkingBlock: null,
  pendingText: '',
  pendingToolCalls: new Map(), // toolCallId → { name, args }
  models: [], // [{provider, modelId, label}]
  currentModel: '',
  readonly: false,
  // Pagination historique : on ne charge que les 200 messages les plus récents,
  // puis « Charger plus » prepend les plus anciens par pages (spec §6.4 pagination).
  historyOffset: 0,        // nb de messages récents déjà skipés
  allLoadedMessages: [],   // historique cumulé (ordre chronologique ancien → récent)
  historyFullyLoaded: false, // true quand tous les messages ont été chargés
  // Édition web v2 : fichier actuellement ouvert dans la visionneuse.
  currentFilePath: '',
  currentFileContent: '',
  currentFileIsNew: false, // true pendant la création d'un nouveau fichier (POST au lieu de PUT)
  browseRoots: [], // racines autorisées (pour créer un projet)
};

// ── Helpers HTTP ──

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
  if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) {
    // Token invalide/expiré → retour écran de login.
    logout();
    throw new Error('Non authentifié');
  }
  return res;
}

async function apiJson(path, opts) {
  const res = await api(path, opts);
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = j.error || msg; } catch (_) {}
    throw new Error(msg);
  }
  return res.json();
}

// ── Login / logout ──

function logout() {
  state.token = '';
  state.historyOffset = 0;
  state.allLoadedMessages = [];
  state.historyFullyLoaded = false;
  localStorage.removeItem(TOKEN_KEY);
  show('#login-screen');
  hide('#app-screen');
  if (state.ws) { try { state.ws.close(); } catch (_) {} }
}

function show(sel) { document.querySelector(sel).hidden = false; }
function hide(sel) { document.querySelector(sel).hidden = true; }

function setConnBadge(cls, text) {
  const b = document.getElementById('conn-badge');
  if (!b) return; // badge retiré de l'UI (topbar remplacée par un titre statique)
  b.className = 'badge ' + cls;
  b.textContent = text;
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.hidden = true;
  try {
    const data = await apiJson('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password: pw }),
    });
    state.token = data.token;
    localStorage.setItem(TOKEN_KEY, state.token);
    enterApp();
  } catch (err) {
    // 401 → « Mot de passe incorrect » ; 429 (rate limit) → message serveur.
    errEl.textContent = (err.message && err.message !== 'Non authentifié')
      ? err.message
      : 'Mot de passe incorrect';
    errEl.hidden = false;
  }
});

function enterApp() {
  hide('#login-screen');
  show('#app-screen');
  connectWs();
  resyncAll();
  loadFiles();
  loadProjects();
}

// ── WebSocket ──

function connectWs() {
  if (state.ws) { try { state.ws.close(); } catch (_) {} }
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${location.host}/ws/agent?token=${encodeURIComponent(state.token)}`;
  let ws;
  try {
    ws = new WebSocket(url);
  } catch (e) {
    scheduleReconnect();
    return;
  }
  state.ws = ws;

  ws.onopen = () => {
    state.wsConnected = true;
    state.reconnectAttempt = 0;
    setConnBadge('badge-on', 'WS✓');
    // Resync après (re)connexion (décision 13.7).
    resyncAll();
  };
  ws.onclose = () => {
    state.wsConnected = false;
    setConnBadge('badge-off', 'WS✗');
    scheduleReconnect();
  };
  ws.onerror = () => {
    setConnBadge('badge-err', 'WS!');
  };
  ws.onmessage = (ev) => {
    let data;
    try { data = JSON.parse(ev.data); } catch (_) { return; }
    handleWsEvent(data);
  };
}

function scheduleReconnect() {
  if (state.reconnectTimer) return;
  const delay = Math.min(1000 * 2 ** state.reconnectAttempt, 30000);
  state.reconnectAttempt++;
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    connectWs();
  }, delay);
}

// ── Resync (3 fetch au onopen) ──

async function resyncAll() {
  try {
    const st = await apiJson('/api/agent/state');
    applyAgentState(st);
  } catch (_) {}
  try {
    const models = await apiJson('/api/models');
    applyModels(models);
  } catch (_) {}
  try {
    const proj = await apiJson('/api/project');
    applyProject(proj);
  } catch (_) {}
}

function applyAgentState(st) {
  // Format réel de pi : enveloppe { data: { model: {provider, id}, streaming, ... } }.
  // Fallback best-effort sur anciens formats plats.
  if (st && typeof st === 'object') {
    const d = (st.data && typeof st.data === 'object') ? st.data : st;
    state.isStreaming = !!(d.streaming || d.isStreaming || d.busy || st.isStreaming || st.streaming || st.busy);
    // Modèle courant : data.model = {provider, id} -> "provider/id".
    if (d.model && (d.model.provider || d.model.id)) {
      state.currentModel = `${d.model.provider || ""}/${d.model.id || ""}`;
    } else if (d.currentModel || d.modelId) {
      state.currentModel = d.currentModel || d.modelId || '';
    } else if (st.currentModel || st.model || st.modelId) {
      state.currentModel = st.currentModel || st.model || st.modelId || '';
    }
  }
  updateStatusUi();
}

function applyModels(models) {
  state.models = [];
  // Format réel de pi : enveloppe { data: { models: [{provider, id, label}] } }.
  // Fallbacks défensifs (anciens formats plats / tableau racine).
  let list = [];
  try {
    const d = (models && models.data && typeof models.data === 'object') ? models.data : models;
    if (d && Array.isArray(d.models)) {
      list = d.models;
    } else if (Array.isArray(d)) {
      list = d;
    } else if (d && d.providers) {
      // Ancien format hypothétique : { providers: { name: { models: [{id}] } } }
      for (const [prov, cfg] of Object.entries(d.providers)) {
        if (cfg && Array.isArray(cfg.models)) {
          for (const m of cfg.models) {
            if (m.id) list.push({ provider: prov, id: m.id, label: m.label || `${prov}/${m.id}` });
          }
        }
      }
    }
    for (const m of list) {
      const provider = m.provider || m.providerId || '';
      const id = m.id || m.modelId || '';
      if (!id && !provider) continue;
      const label = m.label || `${provider}/${id}`;
      state.models.push({ provider, modelId: id, label });
    }
  } catch (_) {}
  const sel = document.getElementById('model-select');
  sel.innerHTML = '';
  for (const m of state.models) {
    const opt = document.createElement('option');
    opt.value = JSON.stringify({ provider: m.provider, modelId: m.modelId });
    opt.textContent = m.label;
    if (state.currentModel === m.label) opt.selected = true;
    sel.appendChild(opt);
  }
}

function applyProject(proj) {
  state.readonly = !!proj.readonly;
  updateMicState();
  state.browseRoots = Array.isArray(proj.roots) ? proj.roots.slice() : [];
  const cur = document.getElementById('current-project');
  cur.textContent = proj.current || '(aucun)';
  // Récents
  const rec = document.getElementById('recent-projects');
  rec.innerHTML = '';
  (proj.recent || []).forEach((p) => {
    const el = document.createElement('div');
    el.className = 'proj-item' + (p === proj.current ? ' active' : '');
    el.textContent = p;
    el.onclick = () => openProject(p);
    rec.appendChild(el);
  });
  // Roots (browse)
  const rb = document.getElementById('browse-roots');
  rb.innerHTML = '';
  (proj.roots || []).forEach((r) => {
    const el = document.createElement('span');
    el.className = 'browse-root';
    el.textContent = shortPath(r);
    el.onclick = () => browseRoot(r);
    rb.appendChild(el);
  });
}

function shortPath(p) {
  if (!p) return '';
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.slice(-2).join('/');
}

// ── Traitement des événements WebSocket (rendu chat) ──

const messagesEl = () => document.getElementById('chat-messages');

function handleWsEvent(payload) {
  const type = payload.type;
  switch (type) {
    case 'agent_start':
      state.isStreaming = true;
      state.currentAssistantBlock = createAssistantBlock();
      state.currentTextBlock = null;
      state.currentThinkingBlock = null;
      state.pendingText = '';
      state.pendingToolCalls.clear();
      updateStatusUi();
      break;

    case 'agent_end':
      finalizeText();
      state.isStreaming = false;
      state.currentAssistantBlock = null;
      state.currentTextBlock = null;
      state.currentThinkingBlock = null;
      updateStatusUi();
      break;

    case 'message_start': {
      const msg = payload.message;
      if (msg && msg.role === 'assistant') {
        if (!state.currentAssistantBlock) state.currentAssistantBlock = createAssistantBlock();
        state.currentTextBlock = null;
        state.currentThinkingBlock = null;
        state.pendingText = '';
      }
      break;
    }

    case 'message': {
      const msg = payload.message;
      if (!msg) break;
      if (msg.role === 'assistant') {
        if (!state.currentAssistantBlock) state.currentAssistantBlock = createAssistantBlock();
        if (msg.stopReason === 'error' && msg.errorMessage) {
          appendText('❌ **Erreur** : ' + msg.errorMessage);
        } else if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part.type === 'text' && part.text) appendText(part.text);
            else if (part.type === 'thinking' && part.thinking) appendThinking(part.thinking);
            else if ((part.type === 'toolCall' || part.type === 'tool_call') && part.name) {
              appendTool(part.name, part.arguments || part.args || {});
            }
          }
        } else if (typeof msg.content === 'string' && msg.content) {
          appendText(msg.content);
        }
      } else if (msg.role === 'toolResult') {
        const out = extractToolResultText(msg);
        if (out) appendToolResult(msg.toolName || 'tool', out);
      }
      break;
    }

    case 'message_update': {
      const delta = payload.assistantMessageEvent;
      if (!delta) break;
      handleDelta(delta);
      break;
    }

    case 'model_change': {
      const m = payload.model || payload.modelId;
      if (m) {
        state.currentModel = m;
        updateStatusUi();
      }
      break;
    }

    case 'user_message': {
      // Message utilisateur (prompt) — pi n'émet pas cet event en streaming, le
      // backend le signale explicitement (desktop ou remote). On n'affiche que les
      // prompts venant du desktop (source !== "remote") : les prompts tapés sur
      // le remote sont déjà affichés localement avant l'envoi (sinon doublon).
      if (payload.source !== 'remote' && typeof payload.text === 'string' && payload.text) {
        appendUserMessage(payload.text);
      }
      break;
    }

    case 'process_exit':
      state.isStreaming = false;
      updateStatusUi();
      appendSystem('⚠️ Processus agent arrêté');
      break;

    case 'process_error':
      appendSystem('⚠️ ' + (payload.text || 'Erreur processus'));
      break;

    // Changement de projet (depuis le desktop ou un autre client distant). On
    // resync projet + fichiers + état agent (le pi a pu être redémarré sur le
    // nouveau cwd côté backend).
    case 'project_changed':
      resyncProject();
      loadFiles();
      apiJson('/api/agent/state').then(applyAgentState).catch(() => {});
      if (payload.path) appendSystem('📁 Projet changé : ' + payload.path);
      break;

    default:
      break;
  }
  scrollToBottom();
}

function handleDelta(delta) {
  switch (delta.type) {
    case 'text_start':
      state.currentTextBlock = appendTextSection('');
      state.pendingText = '';
      break;
    case 'text_delta':
      state.pendingText += delta.delta || '';
      if (!state.currentTextBlock) state.currentTextBlock = appendTextSection('');
      if (state.currentTextBlock) {
        state.currentTextBlock.innerHTML = mdRender(state.pendingText);
      }
      break;
    case 'text_end':
      if (state.currentTextBlock && state.pendingText) {
        state.currentTextBlock.innerHTML = mdRender(state.pendingText);
      }
      state.pendingText = '';
      break;
    case 'thinking_start':
      state.currentThinkingBlock = appendThinkingBlock();
      break;
    case 'thinking_delta':
      if (state.currentThinkingBlock) {
        state.currentThinkingBlock.textContent += delta.delta || '';
      }
      break;
    case 'thinking_end':
      // Garder le bloc tel quel.
      break;
    case 'toolcall_start':
      state.pendingToolCalls.set(delta.toolCallId || 'unknown', {
        name: delta.toolName || '',
        args: delta.args || {},
      });
      appendTool(delta.toolName || 'tool', delta.args || {});
      break;
    case 'done':
      state.isStreaming = false;
      updateStatusUi();
      break;
    case 'error':
      state.isStreaming = false;
      appendText('❌ **Erreur** : ' + (delta.error || delta.message || 'erreur'));
      updateStatusUi();
      break;
    default:
      break;
  }
}

// ── Construction des blocs chat ──

function createAssistantBlock() {
  const el = document.createElement('div');
  el.className = 'msg assistant';
  el.innerHTML = '<div class="role">Assistant</div><div class="bubble"></div>';
  messagesEl().appendChild(el);
  return el.querySelector('.bubble');
}

function appendTextSection(text) {
  const blk = state.currentAssistantBlock || (state.currentAssistantBlock = createAssistantBlock());
  const div = document.createElement('div');
  div.className = 'text-section';
  div.innerHTML = mdRender(text);
  blk.appendChild(div);
  return div;
}

function appendText(text) {
  const div = document.createElement('div');
  div.className = 'text-section';
  div.innerHTML = mdRender(text);
  (state.currentAssistantBlock || (state.currentAssistantBlock = createAssistantBlock())).appendChild(div);
}

function appendThinking(text) {
  const blk = state.currentAssistantBlock || (state.currentAssistantBlock = createAssistantBlock());
  const div = document.createElement('div');
  div.className = 'thinking';
  div.textContent = text;
  blk.appendChild(div);
}

function appendThinkingBlock() {
  const blk = state.currentAssistantBlock || (state.currentAssistantBlock = createAssistantBlock());
  const div = document.createElement('div');
  div.className = 'thinking';
  blk.appendChild(div);
  return div;
}

function appendTool(name, args) {
  const blk = state.currentAssistantBlock || (state.currentAssistantBlock = createAssistantBlock());
  const div = document.createElement('div');
  div.className = 'tool';
  const head = document.createElement('strong');
  head.textContent = '🔧 ' + name;
  div.appendChild(head);
  if (args && Object.keys(args).length) {
    const code = document.createElement('code');
    code.textContent = '\n' + safeJson(args);
    div.appendChild(code);
  }
  blk.appendChild(div);
}

function appendToolResult(name, output) {
  const blk = state.currentAssistantBlock || (state.currentAssistantBlock = createAssistantBlock());
  const div = document.createElement('div');
  div.className = 'tool';
  const head = document.createElement('strong');
  head.textContent = '↩️ ' + name + ' (résultat)';
  div.appendChild(head);
  const pre = document.createElement('pre');
  pre.textContent = output;
  div.appendChild(pre);
  blk.appendChild(div);
}

function appendSystem(text) {
  const el = document.createElement('div');
  el.className = 'msg system';
  el.innerHTML = '<div class="bubble" style="background:#3a3a1e;color:#d4a017">' + escapeHtml(text) + '</div>';
  messagesEl().appendChild(el);
  scrollToBottom();
}

function appendUserMessage(text) {
  const el = document.createElement('div');
  el.className = 'msg user';
  el.innerHTML = '<div class="role">Vous</div><div class="bubble"></div>';
  el.querySelector('.bubble').textContent = text;
  messagesEl().appendChild(el);
  scrollToBottom();
}

function finalizeText() {
  if (state.currentTextBlock && state.pendingText) {
    state.currentTextBlock.innerHTML = mdRender(state.pendingText);
  }
  state.pendingText = '';
  // Retirer bulle vide
  if (state.currentAssistantBlock && state.currentAssistantBlock.children.length === 0 && state.currentAssistantBlock.parentElement) {
    state.currentAssistantBlock.parentElement.remove();
  }
}

function extractToolResultText(msg) {
  if (Array.isArray(msg.content)) {
    return msg.content.map((c) => (typeof c === 'string' ? c : c.text || '')).join('\n');
  }
  if (typeof msg.content === 'string') return msg.content;
  if (msg.output) return String(msg.output);
  return '';
}

function safeJson(o) {
  try { return JSON.stringify(o, null, 2); } catch (_) { return String(o); }
}

function scrollToBottom() {
  const el = messagesEl();
  el.scrollTop = el.scrollHeight;
}

function updateStatusUi() {
  const s = document.getElementById('agent-status');
  if (state.isStreaming) {
    s.textContent = 'busy';
    s.className = 'status busy';
  } else {
    s.textContent = 'idle';
    s.className = 'status idle';
  }
  document.getElementById('btn-abort').disabled = !state.isStreaming;
  document.getElementById('prompt-send').disabled = state.isStreaming;
  updateMicState();
}

// ── Mini-rendu Markdown sécurisé (HTML échappé d'abord) ──

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function mdRender(text) {
  if (!text) return '';
  let s = escapeHtml(text);
  // Fenced code blocks ```
  const blocks = [];
  s = s.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const idx = blocks.length;
    blocks.push('<pre><code>' + code.replace(/^\n/, '') + '</code></pre>');
    return `\u0000BLOCK${idx}\u0000`;
  });
  // Titres
  s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  s = s.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  s = s.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  // Gras / italique
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
  // Inline code
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Listes
  s = s.replace(/^(?:- |\* )(.+)$/gm, '<li>$1</li>');
  s = s.replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, '<ul>$1</ul>');
  // Paragraphes / retours ligne
  s = s.replace(/\n/g, '<br>');
  // Restaurer blocs de code
  s = s.replace(/\u0000BLOCK(\d+)\u0000/g, (_, i) => blocks[+i]);
  return s;
}

// ── Envoi prompt ──

document.getElementById('prompt-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('prompt-input');
  const msg = input.value.trim();
  if (!msg || state.isStreaming) return;
  if (voiceActive) stopVoiceInput();
  appendUserMessage(msg);
  input.value = '';
  try {
    await apiJson('/api/agent/prompt', {
      method: 'POST',
      body: JSON.stringify({ message: msg, images: null }),
    });
  } catch (err) {
    appendSystem('❌ ' + err.message);
  }
});

document.getElementById('btn-abort').addEventListener('click', async () => {
  try { await apiJson('/api/agent/abort', { method: 'POST' }); } catch (e) { appendSystem('❌ ' + e.message); }
});
document.getElementById('btn-new').addEventListener('click', async () => {
  if (!confirm('Nouvelle session ? L\'historique sera effacé chez l\'agent.')) return;
  try {
    await apiJson('/api/agent/new', { method: 'POST' });
    messagesEl().innerHTML = '';
    state.historyOffset = 0;
    state.allLoadedMessages = [];
    state.historyFullyLoaded = false;
    document.getElementById('btn-load-history').hidden = true;
  } catch (e) { appendSystem('❌ ' + e.message); }
});
document.getElementById('btn-compact').addEventListener('click', async () => {
  try { await apiJson('/api/agent/compact', { method: 'POST' }); appendSystem('🗜️ Contexte compacté'); } catch (e) { appendSystem('❌ ' + e.message); }
});
document.getElementById('btn-load-history').addEventListener('click', loadHistory);
document.getElementById('btn-new-project').addEventListener('click', createProject);

// Modale « Nouveau projet » : Annuler / Créer / Entrée / Échap / clic overlay.
document.getElementById('newproj-cancel').addEventListener('click', closeCreateProject);
document.getElementById('newproj-create').addEventListener('click', confirmCreateProject);
document.getElementById('newproj-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); confirmCreateProject(); }
});
const newProjModal = document.getElementById('modal-new-project');
newProjModal.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeCreateProject();
});
newProjModal.addEventListener('click', (e) => {
  // Clic sur l'overlay (hors carte) → fermer.
  if (e.target === newProjModal) closeCreateProject();
});

// Édition web v2 : boutons de la visionneuse de fichiers.
document.getElementById('btn-file-edit').addEventListener('click', () => {
  const editor = document.getElementById('file-editor');
  editor.value = state.currentFileContent || '';
  document.getElementById('file-content').hidden = true;
  editor.hidden = false;
  setEditorMode(true);
  editor.focus();
});
document.getElementById('btn-file-save').addEventListener('click', saveFile);
document.getElementById('btn-file-new').addEventListener('click', createFile);
document.getElementById('btn-file-cancel').addEventListener('click', () => {
  if (state.currentFileIsNew) {
    // Annulation de la création : revenir à l'état « aucun fichier courant ».
    state.currentFileIsNew = false;
    state.currentFilePath = '';
    state.currentFileContent = '';
    document.getElementById('file-path').textContent = '(création annulée)';
    document.getElementById('file-content').textContent = '';
  }
  document.getElementById('file-editor').hidden = true;
  document.getElementById('file-content').hidden = false;
  setEditorMode(false);
});

document.getElementById('model-select').addEventListener('change', async (e) => {
  try {
    const m = JSON.parse(e.target.value);
    await apiJson('/api/agent/model', { method: 'POST', body: JSON.stringify(m) });
  } catch (err) { appendSystem('❌ ' + err.message); }
});

async function loadHistory() {
  const btn = document.getElementById('btn-load-history');
  const offset = state.historyOffset;
  try {
    const data = await apiJson('/api/agent/messages?offset=' + offset + '&limit=200');
    // Format défensif : tableau (ancien) ou {messages:[...], has_more, total}.
    const list = Array.isArray(data) ? data : (data.messages || []);
    if (!list.length) {
      // Session vide ou tout est déjà chargé.
      state.historyFullyLoaded = true;
      btn.hidden = true;
      if (offset === 0) appendSystem('Aucun message dans la session.');
      return;
    }
    state.historyOffset = offset + list.length;
    state.historyFullyLoaded = !data.has_more;
    // Prepend les plus anciens récupérés devant l'historique déjà chargé
    // (ordre chronologique ancien → récent conservé).
    state.allLoadedMessages = [...list, ...state.allLoadedMessages];
    renderHistory(state.allLoadedMessages);
    // Bouton « Charger plus » : masqué si tout est chargé, sinon nb restants.
    if (state.historyFullyLoaded) {
      btn.hidden = true;
    } else {
      btn.hidden = false;
      const restants = Math.max(0, (data.total || 0) - state.historyOffset);
      btn.textContent = '⏫ Charger plus (' + restants + ' restants)';
    }
  } catch (e) { appendSystem('❌ ' + e.message); }
}

// Re-render complet du chat depuis une liste de messages (ordre chronologique).
// Utilisé par loadHistory (pagination) : on vide puis on réinsère tous les
// messages déjà chargés, en replaçant le scroll en bas (le plus récent).
function renderHistory(list) {
  const el = messagesEl();
  el.innerHTML = '';
  state.currentAssistantBlock = null;
  for (const m of list) {
    if (m.role === 'user' && m.content != null) {
      const c = typeof m.content === 'string'
        ? m.content
        : (Array.isArray(m.content) ? m.content.map(p => p.text || '').join('') : '');
      if (c) appendUserMessage(c);
    } else if (m.role === 'assistant' && m.content) {
      const c = typeof m.content === 'string'
        ? m.content
        : (Array.isArray(m.content) ? m.content.map(p => p.text || '').join('') : '');
      if (c) { state.currentAssistantBlock = createAssistantBlock(); appendText(c); state.currentAssistantBlock = null; }
    } else if (m.role === 'toolResult' && m.content) {
      const c = Array.isArray(m.content)
        ? m.content.map(p => p.text || '').join('\n')
        : (typeof m.content === 'string' ? m.content : '');
      if (c) appendToolResult(m.toolName || 'tool', c);
    }
  }
  scrollToBottom();
}

// ── Navigation vues ──

document.querySelectorAll('#tabbar button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#tabbar button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + btn.dataset.view).classList.add('active');
    // Le sélecteur de modèle n'a de sens qu'en onglet Chat : on le masque ailleurs.
    const modelBar = document.getElementById('chat-model-bar');
    if (modelBar) modelBar.hidden = (btn.dataset.view !== 'chat');
    // Rafraîchir les boutons d'édition fichiers (notamment « Nouveau » selon readonly).
    if (btn.dataset.view === 'files') setEditorMode(false);
  });
});

// ── Fichiers (arborescence + visionneuse) ──

async function loadFiles() {
  try {
    const tree = await apiJson('/api/tree');
    renderTree(document.getElementById('file-tree'), tree);
  } catch (e) { /* pas de projet */ }
}

function renderTree(container, node) {
  container.innerHTML = '';
  if (!node) return;
  const root = document.createElement('div');
  root.className = 'tree-item dir';
  root.textContent = '📂 ' + (node.name || 'Projet');
  root.onclick = () => toggleDir(root, node);
  container.appendChild(root);
  // Expand par défaut au premier niveau
  toggleDir(root, node, true);
}

function toggleDir(el, node, forceOpen) {
  let child = el.nextElementSibling;
  if (child && child.dataset.child === '1') {
    if (forceOpen) { child.style.display = 'block'; return; }
    child.style.display = child.style.display === 'none' ? 'block' : 'none';
    return;
  }
  child = document.createElement('div');
  child.dataset.child = '1';
  child.style.paddingLeft = '16px';
  for (const c of (node.children || [])) {
    const item = document.createElement('div');
    item.className = 'tree-item' + (c.is_dir ? ' dir' : '');
    item.textContent = (c.is_dir ? '📁 ' : '📄 ') + c.name;
    if (c.is_dir) {
      item.onclick = () => toggleDir(item, c);
    } else {
      item.onclick = () => openFile(c.path, c.name);
    }
    child.appendChild(item);
  }
  el.after(child);
}

async function openFile(path, name) {
  state.currentFilePath = path;
  state.currentFileIsNew = false;
  document.getElementById('file-path').textContent = name;
  const code = document.getElementById('file-content');
  const editor = document.getElementById('file-editor');
  code.textContent = 'Chargement…';
  code.hidden = false;
  editor.hidden = true;
  try {
    const data = await apiJson('/api/file?' + new URLSearchParams({ path }));
    state.currentFileContent = data.content || '';
    code.textContent = state.currentFileContent || '(vide)';
  } catch (e) {
    // Échec de chargement : pas de fichier courant, on cache les actions d'édition.
    state.currentFilePath = '';
    state.currentFileContent = '';
    code.textContent = '❌ ' + e.message;
  }
  setEditorMode(false);
}

// Bascule l'affichage des boutons d'édition (mode édition on/off). Lit l'état
// courant (readonly, currentFilePath, currentFileIsNew) pour décider quels boutons
// sont visibles : « Éditer » + « Nouveau » en lecture, « Enregistrer » + « Annuler »
// en édition. « Nouveau » est masqué en readonly et pendant l'édition.
function setEditorMode(on) {
  const canEdit = !state.readonly && !!state.currentFilePath && !state.currentFileIsNew;
  document.getElementById('btn-file-edit').hidden = on || !canEdit;
  document.getElementById('btn-file-save').hidden = !on;
  document.getElementById('btn-file-cancel').hidden = !on;
  document.getElementById('btn-file-new').hidden = on || !!state.readonly;
}

// Enregistre le contenu de l'éditeur : POST /api/file (création) si le fichier
// est nouveau, PUT /api/file (édition) sinon. Après création, le backend renvoie
// le chemin canonique absolu, utilisé pour les PUT ultérieurs.
async function saveFile() {
  const path = state.currentFilePath;
  const content = document.getElementById('file-editor').value;
  if (!path) return;
  const btn = document.getElementById('btn-file-save');
  btn.disabled = true;
  btn.textContent = '💾 …';
  try {
    const method = state.currentFileIsNew ? 'POST' : 'PUT';
    const data = await apiJson('/api/file', { method, body: JSON.stringify({ path, content }) });
    if (state.currentFileIsNew && data && data.path) {
      state.currentFilePath = data.path; // chemin canonique pour les PUT ultérieurs
    }
    state.currentFileIsNew = false;
    state.currentFileContent = content;
    const code = document.getElementById('file-content');
    code.textContent = content || '(vide)';
    code.hidden = false;
    document.getElementById('file-editor').hidden = true;
    document.getElementById('file-path').textContent = state.currentFilePath;
    setEditorMode(false);
    appendSystem('💾 Enregistré : ' + state.currentFilePath);
    loadFiles(); // rafraîchir l'arborescence (le nouveau fichier apparaît)
  } catch (e) {
    appendSystem('❌ ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Enregistrer';
  }
}

// Démarre la création d'un nouveau fichier : on demande un chemin relatif au
// project root (ex: notes.md ou sub/notes.md), on ouvre l'éditeur vide, et le
// prochain « Enregistrer » fera un POST /api/file (création).
function createFile() {
  if (state.readonly) return;
  const name = prompt('Chemin du nouveau fichier (relatif au projet, ex: notes.md ou sub/notes.md) :', 'nouveau.md');
  if (!name || !name.trim()) return;
  const clean = name.trim();
  if (clean.includes('..')) { appendSystem('❌ Chemin invalide (pas de ..).'); return; }
  state.currentFilePath = clean;
  state.currentFileIsNew = true;
  state.currentFileContent = '';
  document.getElementById('file-path').textContent = clean;
  const code = document.getElementById('file-content');
  code.textContent = '';
  code.hidden = true;
  const editor = document.getElementById('file-editor');
  editor.value = '';
  editor.hidden = false;
  setEditorMode(true);
  editor.focus();
}

// ── Projets ──

function loadProjects() {
  resyncProject();
}
async function resyncProject() {
  try { const proj = await apiJson('/api/project'); applyProject(proj); } catch (e) {}
}

async function openProject(path) {
  if (!confirm('Ouvrir le projet distant ?\n' + path)) return;
  try {
    await apiJson('/api/project/open', { method: 'POST', body: JSON.stringify({ path }) });
    appendSystem('📁 Projet changé : ' + path);
    // Le backend a redémarré pi sur le nouveau cwd (new_session reset le modèle) :
    // on resync agent state + models + projet, puis l'arborescence.
    resyncAll();
    loadFiles();
  } catch (e) { appendSystem('❌ ' + e.message); }
}

// Ouvre la modale de création de projet (choix racine + nom). Remplace l'ancien
// prompt() numéroté, peu pratique sur mobile.
function createProject() {
  const roots = state.browseRoots || [];
  if (!roots.length) {
    appendSystem('❌ Aucune racine autorisée pour créer un projet (configurez web_browse_roots).');
    return;
  }
  const sel = document.getElementById('newproj-root');
  sel.innerHTML = '';
  roots.forEach((r) => {
    const opt = document.createElement('option');
    opt.value = r;
    opt.textContent = shortPath(r) + '  (' + r + ')';
    sel.appendChild(opt);
  });
  const nameInput = document.getElementById('newproj-name');
  nameInput.value = '';
  const err = document.getElementById('newproj-error');
  err.hidden = true; err.textContent = '';
  document.getElementById('modal-new-project').hidden = false;
  // Focus : le nom si une seule racine, sinon le select pour choisir d'abord.
  if (roots.length > 1) sel.focus(); else nameInput.focus();
}

// Ferme la modale de création de projet.
function closeCreateProject() {
  document.getElementById('modal-new-project').hidden = true;
}

// Valide et soumet la création de projet depuis la modale.
async function confirmCreateProject() {
  const root = document.getElementById('newproj-root').value;
  const raw = document.getElementById('newproj-name').value;
  const err = document.getElementById('newproj-error');
  err.hidden = true; err.textContent = '';
  if (!root) { err.textContent = 'Aucune racine sélectionnée.'; err.hidden = false; return; }
  if (!raw || !raw.trim()) { err.textContent = 'Veuillez saisir un nom.'; err.hidden = false; return; }
  const cleanName = raw.trim().replace(/\s+/g, '-');
  if (/[\\/]/.test(cleanName) || cleanName === '.' || cleanName === '..') {
    err.textContent = 'Nom invalide (pas de séparateur).'; err.hidden = false; return;
  }
  const base = root.replace(/[\\/]+$/, '');
  const path = base + '/' + cleanName;
  const btn = document.getElementById('newproj-create');
  btn.disabled = true; btn.textContent = 'Création…';
  try {
    await apiJson('/api/project/create', { method: 'POST', body: JSON.stringify({ path }) });
    appendSystem('📁 Projet créé et ouvert : ' + path);
    closeCreateProject();
    resyncAll();
    loadFiles();
  } catch (e) {
    err.textContent = e.message; err.hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = 'Créer';
  }
}

async function browseRoot(root) {
  try {
    const data = await apiJson('/api/project/browse?' + new URLSearchParams({ root }));
    const list = document.getElementById('browse-list');
    list.innerHTML = '';
    (data.dirs || []).forEach((d) => {
      const el = document.createElement('div');
      el.className = 'proj-item';
      el.textContent = '📁 ' + d.split(/[/\\]/).pop();
      el.onclick = () => openProject(d);
      list.appendChild(el);
    });
    if (!(data.dirs || []).length) list.innerHTML = '<div class="muted">Aucun sous-dossier</div>';
  } catch (e) { document.getElementById('browse-list').innerHTML = '❌ ' + escapeHtml(e.message); }
}

// ── Dictée vocale (Web Speech API) — Évolution 8 ──
// Transcription navigateur (SpeechRecognition). Sur Chrome/WebView2, l'audio
// passe par le cloud du moteur (pas 100% local). Exige un secure context (HTTPS
// ou localhost) — sur le web remote, nécessite Tailscale Serve (HTTPS).
const VOICE_LANG = 'fr-FR';
let voiceSupported = false;
let voiceActive = false;
let voiceRec = null;

function updateMicState() {
  const mic = document.getElementById('prompt-mic');
  if (!mic) return;
  if (!voiceSupported) { mic.style.display = 'none'; return; }
  mic.style.display = '';
  if (!window.isSecureContext) {
    mic.disabled = true;
    mic.classList.remove('rec');
    mic.title = 'Dictée vocale : requiert un accès HTTPS (activez Tailscale Serve).';
    return;
  }
  mic.disabled = state.isStreaming || state.readonly;
  mic.title = voiceActive ? 'Arrêter la dictée' : 'Dictée vocale (transcription cloud)';
  if (!voiceActive) mic.classList.remove('rec');
}

function stopVoiceInput() {
  // Empêche onresult/onend de réécrire le textarea après l'envoi.
  voiceActive = false;
  if (voiceRec) { try { voiceRec.stop(); } catch (_) {} }
}

function toggleVoiceInput() {
  if (!voiceSupported) return;
  const mic = document.getElementById('prompt-mic');
  const input = document.getElementById('prompt-input');
  if (voiceActive) { stopVoiceInput(); return; }
  if (state.isStreaming || state.readonly) return;
  if (!window.isSecureContext) {
    appendSystem('🎙️ La dictée vocale requiert un accès HTTPS (activez Tailscale Serve).');
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SR();
  rec.lang = VOICE_LANG;
  rec.interimResults = true;
  rec.continuous = true;
  const preText = input.value;
  let finalText = '';
  const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  rec.onresult = (e) => {
    if (!voiceActive) return;
    // Sur Chrome Android (continuous=true), le moteur peut finaliser des résultats
    // cumulatifs (chaque résultat contient les précédents : « salut », puis « salut
    // comment », puis « salut comment ça va »). Les concaténer duplique le texte
    // (« salutsalut comment... »). On distingue donc deux modes :
    //   - cumulatif (Android) : on garde le résultat le plus complet ;
    //   - incrémental (Chrome desktop) : on concatène les segments.
    const finals = [];
    let interim = '';
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finals.push(r[0].transcript);
      else interim = r[0].transcript;
    }
    if (finals.length >= 2 && norm(finals[finals.length - 1]).startsWith(norm(finals[finals.length - 2]))) {
      finalText = finals[finals.length - 1];
    } else {
      finalText = finals.join(' ');
    }
    let transcript;
    if (interim) {
      if (finalText && norm(interim).startsWith(norm(finalText))) transcript = interim;
      else transcript = (finalText ? finalText + ' ' : '') + interim;
    } else {
      transcript = finalText;
    }
    const sep = preText && !preText.endsWith(' ') ? ' ' : '';
    input.value = preText + sep + transcript;
    input.scrollTop = input.scrollHeight;
  };
  rec.onerror = (ev) => {
    voiceActive = false;
    if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
      appendSystem('🎙️ Micro refusé. Autorise l\'accès au micro dans le navigateur.');
    } else if (ev.error !== 'no-speech' && ev.error !== 'aborted') {
      appendSystem('🎙️ Erreur de dictée : ' + ev.error);
    }
    if (mic) mic.classList.remove('rec');
    updateMicState();
  };
  rec.onend = () => {
    const wasActive = voiceActive;
    voiceActive = false; voiceRec = null;
    if (wasActive) {
      const sep = preText && !preText.endsWith(' ') ? ' ' : '';
      input.value = preText + sep + finalText;
    }
    if (mic) mic.classList.remove('rec');
    updateMicState();
  };
  try {
    rec.start();
    voiceRec = rec; voiceActive = true;
    if (mic) { mic.classList.add('rec'); mic.title = 'Arrêter la dictée'; }
  } catch (err) {
    appendSystem('🎙️ Impossible de démarrer la dictée : ' + err.message);
  }
}

(function initVoiceInput() {
  voiceSupported = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const mic = document.getElementById('prompt-mic');
  if (!mic) return;
  if (!voiceSupported) { mic.style.display = 'none'; return; }
  mic.addEventListener('click', (e) => { e.preventDefault(); toggleVoiceInput(); });
  updateMicState();
})();

// ── Démarrage ──

if (state.token) {
  // Vérifier le token en tentant un fetch protégé.
  api('/api/agent/state').then((r) => {
    if (r.ok) enterApp();
    else logout();
  }).catch(() => logout());
}