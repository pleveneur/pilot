// models-config.js — Onglet « Fournisseurs » de la modale Paramètres
//
// Édition du registre de modèles IA (models.json) et des alias (model-switch.json)
// d'un backend donné (pi, plh, ...), sans éditer les JSON à la main. Toutes les
// écritures passent par les commandes Rust `write_models_config` / `write_model_
// aliases` (backup .bak automatique). Après sauvegarde, un évènement
// `pilot-models-changed` est émis pour que l'onglet agent et les selects de
// modèles (PDF→MD, orchestrateur, codeur, reviewer) se rafraîchissent.
//
// Round-trip JSON : on préserve les clés non gérées par l'UI (on charge l'objet
// Value tel quel et on ne modifie que les champs exposés : baseUrl, api, apiKey,
// compat.{supportsTools,supportsDeveloperRole,supportsReasoningEffort}, models[],
// et par modèle id/contextWindow/input/systemPrompt).

import { invoke } from "@tauri-apps/api/core";
import { refreshIcons } from "./icons.js";
import { showToast } from "./toast.js";

const TAB_KEY = "providers";
const COMPAT_KEYS = ["supportsTools", "supportsDeveloperRole", "supportsReasoningEffort"];
const INPUT_KINDS = ["text", "image"];

const state = {
  loaded: false,
  dirty: false,
  stem: "",
  backends: [],
  providersConfig: null, // { providers: {...}, ...autres clés racines }
  aliasesConfig: null, // { aliases: {alias: "provider/id"}, defaultModel: "..." }
  aliasByModel: {}, // map inverse "provider/id" -> alias (pour l'édition par modèle)
};

// Références DOM (résolues à l'init)
let elTab, elBackendSelect, elBackendPath, elProvidersList,
  elAliasesDefault, elStatus, btnAddProvider, btnReload,
  btnSave, btnCancel;

/** À appeler au démarrage (main.js). Branche les listeners et le chargement
 *  paresseux (au 1ᵉʳ activation de l'onglet). */
export function initModelsConfig() {
  elTab = document.querySelector(`.settings-tab[data-settings-tab="${TAB_KEY}"]`);
  elBackendSelect = document.getElementById("setting-providers-backend");
  elBackendPath = document.getElementById("setting-providers-backend-path");
  elProvidersList = document.getElementById("providers-list");
  elAliasesDefault = document.getElementById("setting-aliases-default");
  elStatus = document.getElementById("providers-status");
  btnAddProvider = document.getElementById("btn-providers-add");
  btnReload = document.getElementById("btn-providers-reload");
  btnSave = document.getElementById("btn-providers-save");
  btnCancel = document.getElementById("btn-providers-cancel");

  if (!elTab || !elBackendSelect) return;

  // Chargement paresseux au 1ᵉʳ clic sur l'onglet Fournisseurs.
  elTab.addEventListener("click", () => {
    if (!state.loaded) loadAll().catch((e) => {
      console.error("loadAll models-config:", e);
      showToast("Erreur chargement modèles: " + e, "error");
    });
  });

  elBackendSelect.addEventListener("change", () => {
    if (state.dirty && !confirm("Des modifications non sauvegardées seront perdues. Continuer ?")) {
      // Restaurer l'ancienne sélection
      elBackendSelect.value = state.stem;
      return;
    }
    state.stem = elBackendSelect.value;
    state.dirty = false;
    loadBackend().catch((e) => showToast("Erreur: " + e, "error"));
  });

  btnAddProvider.addEventListener("click", addProvider);
  // Modèle par défaut (listener unique, l'élément est persistant).
  elAliasesDefault.addEventListener("change", () => {
    if (!state.aliasesConfig) return;
    state.aliasesConfig.defaultModel = elAliasesDefault.value;
    markDirty();
  });
  btnReload.addEventListener("click", async () => {
    if (state.dirty && !confirm("Recharger annulera vos modifications. Continuer ?")) return;
    state.dirty = false;
    await loadBackend();
    showToast("Modèles rechargés", "info");
  });
  btnSave.addEventListener("click", saveAll);
  btnCancel.addEventListener("click", async () => {
    if (state.dirty && !confirm("Annuler les modifications non sauvegardées ?")) return;
    state.dirty = false;
    await loadBackend();
  });

  // Recharger quand la config RPC change (le backend actif peut changer).
  window.addEventListener("pilot-config-changed", () => {
    if (state.loaded) {
      state.loaded = false;
      // Si l'onglet est actif, recharger immédiatement.
      if (elTab.classList.contains("active")) {
        loadAll().catch(() => {});
      }
    }
  });
}

// ── Chargement ───────────────────────────────────────────────────────────

async function loadAll() {
  const backends = await invoke("list_agent_backends");
  state.backends = Array.isArray(backends) && backends.length ? backends : ["pi"];
  // Pré-sélectionner le backend actif (détecté côté frontend si possible).
  let preferred = state.backends[0];
  try {
    const info = await invoke("get_backend_info");
    if (info && info.kind && state.backends.includes(info.kind)) preferred = info.kind;
  } catch (_) { /* fallback première entrée */ }
  state.stem = preferred;
  populateBackendSelect();
  await loadBackend();
  state.loaded = true;
}

function populateBackendSelect() {
  elBackendSelect.innerHTML = "";
  for (const s of state.backends) {
    const o = document.createElement("option");
    o.value = s; o.textContent = s;
    elBackendSelect.appendChild(o);
  }
  elBackendSelect.value = state.stem;
}

async function loadBackend() {
  const [pcfg, acfg] = await Promise.all([
    invoke("read_models_config", { stem: state.stem }),
    invoke("read_model_aliases", { stem: state.stem }),
  ]);
  // Normaliser
  state.providersConfig = pcfg && typeof pcfg === "object" ? pcfg : { providers: {} };
  if (!state.providersConfig.providers || typeof state.providersConfig.providers !== "object") {
    state.providersConfig.providers = {};
  }
  state.aliasesConfig = acfg && typeof acfg === "object" ? acfg : {};
  if (!state.aliasesConfig.aliases || typeof state.aliasesConfig.aliases !== "object") {
    state.aliasesConfig.aliases = {};
  }
  if (typeof state.aliasesConfig.defaultModel !== "string") state.aliasesConfig.defaultModel = "";
  // Construire la map inverse provider/id -> alias pour l'édition par modèle.
  state.aliasByModel = {};
  for (const [alias, ref] of Object.entries(state.aliasesConfig.aliases)) {
    if (typeof ref === "string") state.aliasByModel[ref] = alias;
  }
  // Attacher l'alias à chaque modèle (champ temporaire _alias, non écrit dans
  // models.json). Suit le modèle lors des ajouts/suppressions/renommages.
  for (const [provName, prov] of Object.entries(state.providersConfig.providers)) {
    const models = Array.isArray(prov.models) ? prov.models : [];
    for (const m of models) {
      const ref = m.id ? `${provName}/${m.id}` : "";
      m._alias = (ref && state.aliasByModel[ref]) || "";
    }
  }

  elBackendPath.textContent = `~/.${state.stem}/agent/`;
  renderProviders();
}

// ── Rendu : providers & modèles ──────────────────────────────────────────

function renderProviders() {
  const providers = state.providersConfig.providers;
  const names = Object.keys(providers);
  if (names.length === 0) {
    elProvidersList.innerHTML = '<p class="muted">Aucun fournisseur. Cliquez sur « Ajouter un fournisseur ».</p>';
    refreshIcons(elProvidersList);
    return;
  }
  let html = "";
  for (const name of names) {
    html += renderProviderCard(name, providers[name]);
  }
  elProvidersList.innerHTML = html;
  bindProviderEvents();
  refreshIcons(elProvidersList);
  // Le sélecteur de modèle par défaut dépend des modèles présents.
  populateDefaultModelSelect();
}

function renderProviderCard(name, prov) {
  const models = Array.isArray(prov.models) ? prov.models : [];
  const compat = prov.compat && typeof prov.compat === "object" ? prov.compat : {};
  const api = prov.api || "openai-completions";
  const baseUrl = prov.baseUrl || "";
  const apiKey = prov.apiKey && prov.apiKey !== "none" ? prov.apiKey : "";
  const esc = escapeAttr;

  let modelsHtml = "";
  for (let i = 0; i < models.length; i++) {
    modelsHtml += renderModelRow(name, i, models[i]);
  }

  // compat : cochée par défaut si la clé est absente (=== true ou undefined).
  const compatCheckboxes = COMPAT_KEYS.map((k) => {
    const checked = compat[k] !== false ? "checked" : "";
    const label = {
      supportsTools: "Tools",
      supportsDeveloperRole: "Developer role",
      supportsReasoningEffort: "Reasoning effort",
    }[k];
    return `<label class="chip"><input type="checkbox" data-prov="${esc(name)}" data-compat="${k}" ${checked}/> ${label}</label>`;
  }).join("");

  return `<div class="provider-card" data-provider="${esc(name)}">
    <div class="provider-card-head">
      <span class="provider-badge">Fournisseur</span>
      <input type="text" class="provider-name-input" data-prov="${esc(name)}" data-field="name" value="${esc(name)}" placeholder="nom du provider"/>
      <button type="button" class="pc-btn-icon" data-action="test-provider" data-prov="${esc(name)}" title="Tester la connexion"><i data-lucide="plug-zap" class="icon-sm"></i></button>
      <button type="button" class="pc-btn-icon" data-action="del-provider" data-prov="${esc(name)}" title="Supprimer"><i data-lucide="trash-2" class="icon-sm"></i></button>
    </div>
    <div class="provider-card-body">
      <div class="field-row"><label>baseUrl :</label><input type="text" data-prov="${esc(name)}" data-field="baseUrl" value="${esc(baseUrl)}" placeholder="http://localhost:11434/v1"/></div>
      <div class="field-row"><label>api :</label>
        <select data-prov="${esc(name)}" data-field="api">
          ${["openai-completions","openai-responses","anthropic","gemini","bedrock"].map(a=>`<option value="${a}" ${a===api?"selected":""}>${a}</option>`).join("")}
        </select>
      </div>
      <div class="field-row"><label>apiKey :</label><input type="password" data-prov="${esc(name)}" data-field="apiKey" value="${esc(apiKey)}" placeholder="none"/></div>
      <div class="compat-row"><span class="compat-label">compat :</span> ${compatCheckboxes}</div>
      <div class="provider-models-head">
        <span class="models-title">Modèles (${models.length})</span>
        <button type="button" class="pc-btn pc-btn-sm" data-action="add-model" data-prov="${esc(name)}"><i data-lucide="plus" class="icon-sm"></i> Modèle</button>
      </div>
      <div class="provider-models" data-models-for="${esc(name)}">${modelsHtml}</div>
    </div>
    <div class="provider-test-result muted" data-test-for="${esc(name)}"></div>
  </div>`;
}

function renderModelRow(provName, idx, model) {
  const id = model.id || "";
  const ctx = model.contextWindow != null ? model.contextWindow : "";
  const input = Array.isArray(model.input) ? model.input : [];
  const sp = model.systemPrompt || "";
  const alias = model._alias || "";
  const esc = escapeAttr;
  const inputChecks = INPUT_KINDS.map((k) => {
    const checked = input.includes(k) ? "checked" : "";
    return `<label class="chip"><input type="checkbox" data-prov="${esc(provName)}" data-midx="${idx}" data-input="${k}" ${checked}/> ${k}</label>`;
  }).join("");
  const hasSp = sp ? "expanded" : "";
  return `<div class="model-row" data-prov="${esc(provName)}" data-midx="${idx}">
    <div class="model-row-head">
      <span class="model-badge">Modèle</span>
      <input type="text" class="model-id-input" data-prov="${esc(provName)}" data-midx="${idx}" data-field="id" value="${esc(id)}" placeholder="model id"/>
      <button type="button" class="pc-btn-icon" data-action="test-model" data-prov="${esc(provName)}" data-midx="${idx}" title="Tester ce modèle"><i data-lucide="check-circle" class="icon-sm"></i></button>
      <button type="button" class="pc-btn-icon" data-action="del-model" data-prov="${esc(provName)}" data-midx="${idx}" title="Supprimer"><i data-lucide="trash-2" class="icon-sm"></i></button>
    </div>
    <div class="model-row-opts">
      <div class="field-row field-row-sm"><label>alias :</label><input type="text" data-prov="${esc(provName)}" data-midx="${idx}" data-field="alias" value="${esc(alias)}" placeholder="(optionnel) ex: mm-gema"/></div>
      <div class="field-row field-row-sm"><label>contextWindow :</label><input type="number" min="0" step="1000" data-prov="${esc(provName)}" data-midx="${idx}" data-field="contextWindow" value="${esc(String(ctx))}" placeholder="auto"/></div>
      <div class="model-inputs"><span class="compat-label">input :</span> ${inputChecks}</div>
    </div>
    <details class="model-sp ${hasSp}">
      <summary>systemPrompt</summary>
      <textarea rows="6" data-prov="${esc(provName)}" data-midx="${idx}" data-field="systemPrompt" placeholder="system prompt optionnel...">${escapeHtml(sp)}</textarea>
    </details>
    <div class="model-test-result muted" data-mtest-for="${esc(provName)}" data-mtest-idx="${idx}"></div>
  </div>`;
}

function bindProviderEvents() {
  // Champs provider (name, baseUrl, api, apiKey) — exclut les champs modèle
  // (qui portent aussi data-midx).
  elProvidersList.querySelectorAll("input[data-prov][data-field]:not([data-midx]), select[data-prov][data-field]").forEach((el) => {
    // Le champ « name » (renommage de clé) se déclenche au change (blur/Enter)
    // pour éviter un re-render à chaque frappe qui ferait perdre le focus.
    const field = el.getAttribute("data-field");
    const ev = (field === "name" || el.tagName === "SELECT") ? "change" : "input";
    el.addEventListener(ev, () => onProviderFieldChange(el));
  });
  // compat checkboxes
  elProvidersList.querySelectorAll("input[data-compat]").forEach((el) => {
    el.addEventListener("change", () => onCompatChange(el));
  });
  // input checkboxes (text/image) des modèles
  elProvidersList.querySelectorAll("input[data-input]").forEach((el) => {
    el.addEventListener("change", () => onModelInputChange(el));
  });
  // champs modèles (id, contextWindow, systemPrompt)
  elProvidersList.querySelectorAll("input[data-midx][data-field], textarea[data-midx][data-field]").forEach((el) => {
    const ev = el.tagName === "TEXTAREA" ? "input" : "input";
    el.addEventListener(ev, () => onModelFieldChange(el));
  });
  // boutons (delegation)
  elProvidersList.querySelectorAll("button[data-action]").forEach((el) => {
    el.addEventListener("click", () => onActionButton(el));
  });
}

// ── Handlers édition ─────────────────────────────────────────────────────

function markDirty() { state.dirty = true; }

function onProviderFieldChange(el) {
  const name = el.getAttribute("data-prov");
  const field = el.getAttribute("data-field");
  const prov = state.providersConfig.providers[name];
  if (!prov) return;
  if (field === "name") {
    const newName = el.value.trim();
    if (newName && newName !== name) {
      // Renommer la clé (préserver l'ordre : recréer l'objet)
      const providers = state.providersConfig.providers;
      const rebuilt = {};
      for (const k of Object.keys(providers)) {
        if (k === name) rebuilt[newName] = prov;
        else rebuilt[k] = providers[k];
      }
      delete providers[name];
      for (const k of Object.keys(rebuilt)) providers[k] = rebuilt[k];
      // Mettre à jour les data-prov de la carte — re-render nécessaire
      markDirty();
      renderProviders();
      return;
    }
    return;
  }
  let val = el.value;
  if (field === "apiKey") {
    val = val.trim() || "none";
  }
  prov[field] = val;
  markDirty();
}

function onCompatChange(el) {
  const name = el.getAttribute("data-prov");
  const key = el.getAttribute("data-compat");
  const prov = state.providersConfig.providers[name];
  if (!prov) return;
  if (!prov.compat || typeof prov.compat !== "object") prov.compat = {};
  prov.compat[key] = el.checked;
  markDirty();
}

function onModelFieldChange(el) {
  const name = el.getAttribute("data-prov");
  const idx = Number(el.getAttribute("data-midx"));
  const field = el.getAttribute("data-field");
  const model = getModel(name, idx);
  if (!model) return;
  const raw = el.value;
  if (field === "contextWindow") {
    const n = parseInt(raw, 10);
    if (raw === "" || isNaN(n)) delete model.contextWindow;
    else model.contextWindow = n;
  } else if (field === "systemPrompt") {
    if (raw.trim() === "") delete model.systemPrompt;
    else model.systemPrompt = raw;
  } else if (field === "id") {
    model.id = raw.trim();
  } else if (field === "alias") {
    model._alias = raw.trim();
  }
  markDirty();
}

function onModelInputChange(el) {
  const name = el.getAttribute("data-prov");
  const idx = Number(el.getAttribute("data-midx"));
  const kind = el.getAttribute("data-input");
  const model = getModel(name, idx);
  if (!model) return;
  let arr = Array.isArray(model.input) ? model.input.slice() : [];
  if (el.checked && !arr.includes(kind)) arr.push(kind);
  if (!el.checked) arr = arr.filter((v) => v !== kind);
  if (arr.length === 0) delete model.input;
  else model.input = arr;
  markDirty();
}

function getModel(name, idx) {
  const prov = state.providersConfig.providers[name];
  if (!prov || !Array.isArray(prov.models)) return null;
  return prov.models[idx] || null;
}

function onActionButton(el) {
  const action = el.getAttribute("data-action");
  const name = el.getAttribute("data-prov");
  if (action === "del-provider") return delProvider(name);
  if (action === "add-model") return addModel(name);
  if (action === "del-model") return delModel(name, Number(el.getAttribute("data-midx")));
  if (action === "test-provider") return testProvider(name);
  if (action === "test-model") return testModel(name, Number(el.getAttribute("data-midx")));
}

// ── Ajout / suppression ───────────────────────────────────────────────────

function addProvider() {
  const base = "nouveau-provider";
  let name = base;
  let n = 2;
  while (state.providersConfig.providers[name]) { name = `${base}-${n++}`; }
  state.providersConfig.providers[name] = {
    baseUrl: "http://localhost:PORT/v1",
    api: "openai-completions",
    apiKey: "none",
    models: [],
  };
  markDirty();
  renderProviders();
  // Focus sur le nouveau nom
  const inp = elProvidersList.querySelector(`input[data-prov="${escapeAttr(name)}"][data-field="name"]`);
  if (inp) { inp.focus(); inp.select(); }
}

function delProvider(name) {
  if (!confirm(`Supprimer le fournisseur « ${name} » et tous ses modèles ?`)) return;
  delete state.providersConfig.providers[name];
  markDirty();
  renderProviders();
}

function addModel(name) {
  const prov = state.providersConfig.providers[name];
  if (!prov) return;
  if (!Array.isArray(prov.models)) prov.models = [];
  prov.models.push({ id: "nouveau-modele" });
  markDirty();
  renderProviders();
}

function delModel(name, idx) {
  const prov = state.providersConfig.providers[name];
  if (!prov || !Array.isArray(prov.models)) return;
  if (idx < 0 || idx >= prov.models.length) return;
  if (!confirm(`Supprimer le modèle « ${prov.models[idx].id || idx} » ?`)) return;
  prov.models.splice(idx, 1);
  markDirty();
  renderProviders();
}

// ── Test de connexion / de modèle ────────────────────────────────────────

async function testProvider(name) {
  const prov = state.providersConfig.providers[name];
  const out = elProvidersList.querySelector(`[data-test-for="${escapeAttr(name)}"]`);
  if (!prov || !out) return;
  out.textContent = "Test en cours…";
  out.classList.remove("ok", "fail");
  try {
    const res = await invoke("test_provider_models", {
      baseUrl: prov.baseUrl || "",
      apiKey: prov.apiKey || "none",
    });
    if (res && res.ok) {
      const list = Array.isArray(res.models) ? res.models : [];
      out.classList.add("ok");
      out.textContent = `✓ ${list.length} modèle(s) disponibles` + (list.length ? " : " + list.join(", ") : "");
    } else {
      out.classList.add("fail");
      out.textContent = "✗ " + ((res && res.error) || "échec");
    }
  } catch (e) {
    out.classList.add("fail");
    out.textContent = "✗ " + e;
  }
}

async function testModel(name, idx) {
  const prov = state.providersConfig.providers[name];
  const model = getModel(name, idx);
  const out = elProvidersList.querySelector(`[data-mtest-for="${escapeAttr(name)}"][data-mtest-idx="${idx}"]`);
  if (!prov || !model || !out) return;
  const id = (model.id || "").trim();
  out.textContent = "Test en cours…";
  out.classList.remove("ok", "fail");
  try {
    const res = await invoke("test_provider_models", {
      baseUrl: prov.baseUrl || "",
      apiKey: prov.apiKey || "none",
    });
    if (res && res.ok) {
      const list = Array.isArray(res.models) ? res.models : [];
      const found = list.some((m) => m === id || m.startsWith(id + ":") || id.startsWith(m + ":"));
      out.classList.add(found ? "ok" : "fail");
      out.textContent = found ? `✓ « ${id} » présent côté serveur` : `✗ « ${id} » absent (serveur: ${list.length} modèle(s))`;
    } else {
      out.classList.add("fail");
      out.textContent = "✗ " + ((res && res.error) || "serveur injoignable");
    }
  } catch (e) {
    out.classList.add("fail");
    out.textContent = "✗ " + e;
  }
}

// ── Modèle par défaut (select global en haut, anciennement dans le bloc alias) ─

/** Peuple le select « Modèle par défaut » avec tous les provider/modelId et
 *  positionne la valeur courante de `aliasesConfig.defaultModel`. Appelé après
 *  renderProviders (les refs proviennent de la config éditée en mémoire). */
function populateDefaultModelSelect() {
  if (!elAliasesDefault) return;
  const all = allModelRefs();
  elAliasesDefault.innerHTML = '<option value="">(aucun)</option>';
  for (const ref of all) {
    const o = document.createElement("option");
    o.value = ref; o.textContent = ref;
    elAliasesDefault.appendChild(o);
  }
  elAliasesDefault.value = (state.aliasesConfig && state.aliasesConfig.defaultModel) || "";
}

// ── Sauvegarde ────────────────────────────────────────────────────────────

async function saveAll() {
  // Validation des providers
  const providers = state.providersConfig.providers;
  const usedNames = new Set();
  for (const name of Object.keys(providers)) {
    if (!name || !name.trim()) { showToast("Un fournisseur n'a pas de nom", "error"); return; }
    if (usedNames.has(name)) { showToast(`Nom de fournisseur dupliqué: ${name}`, "error"); return; }
    usedNames.add(name);
    const models = Array.isArray(providers[name].models) ? providers[name].models : [];
    for (let i = 0; i < models.length; i++) {
      if (!models[i].id || !models[i].id.trim()) {
        showToast(`Modèle sans id dans « ${name} » (#${i + 1})`, "error");
        return;
      }
    }
  }
  // Reconstruire le dict aliases depuis les alias saisis sur chaque modèle
  // (champ temporaire _alias). Validation : alias non vide, unique, pointant
  // vers un modèle existant (ref construit depuis provider + id courant).
  const newAliases = {};
  const usedAlias = new Set();
  for (const [provName, prov] of Object.entries(providers)) {
    const models = Array.isArray(prov.models) ? prov.models : [];
    for (const m of models) {
      const alias = (m._alias || "").trim();
      if (!alias) continue;
      const ref = `${provName}/${m.id}`;
      if (usedAlias.has(alias)) {
        showToast(`Alias dupliqué: « ${alias} »`, "error");
        return;
      }
      usedAlias.add(alias);
      newAliases[alias] = ref;
    }
  }
  state.aliasesConfig.aliases = newAliases;

  // Nettoyer le champ temporaire _alias avant écriture de models.json
  // (deep copy pour ne pas muter l'état d'édition en mémoire).
  const cleanConfig = JSON.parse(JSON.stringify(state.providersConfig));
  for (const prov of Object.values(cleanConfig.providers || {})) {
    const models = Array.isArray(prov.models) ? prov.models : [];
    for (const m of models) { delete m._alias; }
  }

  try {
    await invoke("write_models_config", { stem: state.stem, config: cleanConfig });
    await invoke("write_model_aliases", { stem: state.stem, config: state.aliasesConfig });
    state.dirty = false;
    showToast("Modèles et alias sauvegardés", "success");
    // Notifier le reste de l'app pour rafraîchir les selects, l'onglet agent et
    // l'autocomplétion des commandes slash (loadModelAliases).
    window.dispatchEvent(new CustomEvent("pilot-models-changed", { detail: { stem: state.stem } }));
  } catch (e) {
    showToast("Erreur sauvegarde: " + e, "error");
  }
}

// ── Utilitaires ───────────────────────────────────────────────────────────

function allModelRefs() {
  const refs = [];
  const providers = state.providersConfig.providers;
  for (const name of Object.keys(providers)) {
    const models = Array.isArray(providers[name].models) ? providers[name].models : [];
    for (const m of models) {
      if (m && m.id) refs.push(`${name}/${m.id}`);
    }
  }
  refs.sort();
  return refs;
}

function escapeAttr(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}