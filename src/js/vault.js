// vault.js — Onglet « 🔐 Coffre » (issue #52)
//
// Coffre fort de mots de passe, chiffré AES-256-GCM (clé dérivée du mot de
// passe maître via Argon2id). Fichier `~/.pilot/vault.json` (hors projet).
// États : non initialisé → création du mot de passe maître ; verrouillé →
// saisie du mot de passe maître ; déverrouillé → liste des entrées.
// Portée double : entrée globale à Pilot OU spécifique au projet actif.
// Les mots de passe sont masqués par défaut (bouton « œil » pour révéler).

import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { refreshIcons } from "./icons.js";

/** Chemin du projet actif (pour la portée « projet »). */
function currentProjectPath() {
  return window._pilotProjectPath || null;
}

/** Crée l'onglet Coffre dans `container`. */
export function createVault(container) {
  container.classList.add("vault-view");
  container.innerHTML = `
    <div class="vault-scroll">
      <div class="vault-header">
        <div class="vault-title">🔐 Coffre fort</div>
        <div class="vault-subtitle">Mots de passe chiffrés (AES-256-GCM) — stockés hors du projet</div>
      </div>
      <div id="vault-body" class="vault-body">
        <div class="vault-loading">Chargement…</div>
      </div>
    </div>
  `;
  refreshIcons(container);

  const bodyEl = container.querySelector("#vault-body");

  // ── État : non initialisé (création du mot de passe maître) ──
  function renderInit() {
    bodyEl.innerHTML = `
      <div class="vault-panel">
        <div class="vault-panel-title">Créer le mot de passe maître</div>
        <div class="vault-panel-desc">
          Ce mot de passe protège l'ensemble du coffre. Il n'est jamais stocké en
          clair : une clé AES-256 est dérivée via Argon2id. Si vous l'oubliez, les
          données ne pourront pas être récupérées.
        </div>
        <input id="vault-master" type="password" class="vault-input" placeholder="Mot de passe maître (min. 4 caractères)" autocomplete="new-password">
        <input id="vault-master2" type="password" class="vault-input" placeholder="Confirmer le mot de passe maître" autocomplete="new-password">
        <div id="vault-init-err" class="vault-error"></div>
        <div class="vault-actions">
          <button id="vault-init-btn" class="web-btn"><i data-lucide="lock" class="icon-sm"></i> Créer le coffre</button>
        </div>
      </div>
    `;
    refreshIcons(container);
    const btn = container.querySelector("#vault-init-btn");
    const err = container.querySelector("#vault-init-err");
    btn.addEventListener("click", async () => {
      const p1 = container.querySelector("#vault-master").value;
      const p2 = container.querySelector("#vault-master2").value;
      if (p1 !== p2) {
        err.textContent = "Les deux mots de passe ne correspondent pas.";
        return;
      }
      err.textContent = "";
      try {
        await invoke("vault_set_master_password", { masterPassword: p1 });
        await loadUnlocked();
      } catch (e) {
        err.textContent = String(e);
      }
    });
  }

  // ── État : verrouillé (saisie du mot de passe maître) ──
  function renderLocked() {
    bodyEl.innerHTML = `
      <div class="vault-panel">
        <div class="vault-panel-title">Déverrouiller le coffre</div>
        <div class="vault-panel-desc">Saisissez le mot de passe maître pour accéder à vos mots de passe.</div>
        <input id="vault-unlock-pw" type="password" class="vault-input" placeholder="Mot de passe maître" autocomplete="current-password">
        <div id="vault-unlock-err" class="vault-error"></div>
        <div class="vault-actions">
          <button id="vault-unlock-btn" class="web-btn"><i data-lucide="unlock" class="icon-sm"></i> Déverrouiller</button>
        </div>
      </div>
    `;
    refreshIcons(container);
    const btn = container.querySelector("#vault-unlock-btn");
    const err = container.querySelector("#vault-unlock-err");
    const input = container.querySelector("#vault-unlock-pw");
    const doUnlock = async () => {
      err.textContent = "";
      try {
        await invoke("vault_unlock", { masterPassword: input.value });
        await loadUnlocked();
      } catch (e) {
        err.textContent = String(e);
      }
    };
    btn.addEventListener("click", doUnlock);
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") doUnlock();
    });
  }

  // ── État : déverrouillé (liste des entrées) ──
  async function loadUnlocked() {
    let entries = [];
    try {
      entries = await invoke("vault_list");
    } catch (e) {
      bodyEl.innerHTML = `<div class="vault-error">${e}</div>`;
      return;
    }
    renderUnlocked(entries);
  }

  function renderUnlocked(entries) {
    const projectPath = currentProjectPath();
    const projectName = projectPath ? projectPath.split(/[\\/]/).pop() : "projet actif";

    // Filtres : global / projet / tout
    const globals = entries.filter((e) => e.scope === "global");
    const projects = entries.filter((e) => e.scope === "project");

    bodyEl.innerHTML = `
      <div class="vault-toolbar">
        <div class="vault-toolbar-left">
          <button id="vault-add-btn" class="web-btn"><i data-lucide="plus" class="icon-sm"></i> Ajouter</button>
          <button id="vault-lock-btn" class="web-btn"><i data-lucide="lock" class="icon-sm"></i> Verrouiller</button>
          <button id="vault-change-pw-btn" class="web-btn" title="Changer le mot de passe maître"><i data-lucide="key-round" class="icon-sm"></i> Mot de passe maître</button>
        </div>
        <div class="vault-count">${entries.length} entrée(s)</div>
      </div>
      <div id="vault-entries" class="vault-entries"></div>
    `;
    refreshIcons(container);

    container.querySelector("#vault-add-btn").addEventListener("click", () => {
      openEditor(null, projectPath);
    });
    container.querySelector("#vault-lock-btn").addEventListener("click", async () => {
      await invoke("vault_lock");
      renderLocked();
    });
    container.querySelector("#vault-change-pw-btn").addEventListener("click", () => {
      openChangeMaster();
    });

    const entriesEl = container.querySelector("#vault-entries");

    if (entries.length === 0) {
      entriesEl.innerHTML = `<div class="vault-empty">Aucune entrée. Cliquez sur « Ajouter » pour enregistrer un premier mot de passe.</div>`;
      return;
    }

    // Section globale
    if (globals.length) {
      entriesEl.appendChild(section("🌐 Global (tous les projets)", globals, projectPath));
    }
    // Section projet
    if (projects.length) {
      entriesEl.appendChild(section(`📁 Projet : ${projectName}`, projects, projectPath));
    }
    refreshIcons(container);
  }

  function section(title, list, projectPath) {
    const wrap = document.createElement("div");
    wrap.className = "vault-section";
    const h = document.createElement("div");
    h.className = "vault-section-title";
    h.textContent = title;
    wrap.appendChild(h);

    for (const e of list) {
      const row = document.createElement("div");
      row.className = "vault-row";
      row.dataset.id = e.id;

      const info = document.createElement("div");
      info.className = "vault-row-info";
      const desc = document.createElement("div");
      desc.className = "vault-row-desc";
      desc.textContent = e.description || "(sans description)";
      const login = document.createElement("div");
      login.className = "vault-row-login";
      login.textContent = e.login || "";
      info.appendChild(desc);
      info.appendChild(login);

      const pw = document.createElement("div");
      pw.className = "vault-row-pw";
      pw.textContent = "••••••••";
      pw.dataset.revealed = "false";
      pw.dataset.value = e.password || "";

      const actions = document.createElement("div");
      actions.className = "vault-row-actions";

      // Copier login
      const copyLogin = iconBtn("copy", "Copier le login");
      copyLogin.addEventListener("click", async () => {
        await navigator.clipboard.writeText(e.login || "");
        flash(copyLogin, "✓");
      });
      // Copier mot de passe
      const copyPw = iconBtn("copy", "Copier le mot de passe");
      copyPw.addEventListener("click", async () => {
        await navigator.clipboard.writeText(e.password || "");
        flash(copyPw, "✓");
      });
      // Œil (révéler/masquer)
      const eye = iconBtn("eye", "Afficher / masquer le mot de passe");
      eye.addEventListener("click", () => {
        const revealed = pw.dataset.revealed === "true";
        pw.dataset.revealed = revealed ? "false" : "true";
        pw.textContent = revealed ? "••••••••" : (e.password || "");
        eye.innerHTML = `<i data-lucide="${revealed ? "eye" : "eye-off"}" class="icon-sm"></i>`;
        refreshIcons(eye);
      });
      // Éditer
      const edit = iconBtn("pencil", "Modifier");
      edit.addEventListener("click", () => openEditor(e, projectPath));
      // Supprimer
      const del = iconBtn("trash-2", "Supprimer");
      del.addEventListener("click", async () => {
        const ok = await confirm(`Supprimer « ${e.description || "cette entrée"} » ?`, {
          title: "Pilot",
          kind: "warning",
        });
        if (!ok) return;
        try {
          const updated = await invoke("vault_delete", { id: e.id });
          renderUnlocked(updated);
        } catch (err) {
          const errEl = container.querySelector("#vault-entries");
          errEl.insertAdjacentHTML("afterbegin", `<div class="vault-error">${err}</div>`);
        }
      });

      actions.appendChild(copyLogin);
      actions.appendChild(copyPw);
      actions.appendChild(eye);
      actions.appendChild(edit);
      actions.appendChild(del);

      row.appendChild(info);
      row.appendChild(pw);
      row.appendChild(actions);
      wrap.appendChild(row);
    }
    return wrap;
  }

  function iconBtn(icon, title) {
    const b = document.createElement("button");
    b.className = "vault-icon-btn";
    b.title = title;
    b.innerHTML = `<i data-lucide="${icon}" class="icon-sm"></i>`;
    return b;
  }

  function flash(btn, text) {
    const old = btn.innerHTML;
    btn.innerHTML = text;
    refreshIcons(btn);
    setTimeout(() => {
      btn.innerHTML = old;
      refreshIcons(btn);
    }, 1200);
  }

  // ── Éditeur d'entrée (création / modification) ──
  function openEditor(entry, projectPath) {
    const isEdit = !!entry;
    const e = entry || { description: "", login: "", password: "", scope: "global", project_path: null };
    const projectName = projectPath ? projectPath.split(/[\\/]/).pop() : "projet actif";

    bodyEl.innerHTML = `
      <div class="vault-panel">
        <div class="vault-panel-title">${isEdit ? "Modifier l'entrée" : "Nouvelle entrée"}</div>
        <label class="vault-label">Description</label>
        <input id="vault-f-desc" class="vault-input" placeholder="Ex: Serveur OVH" value="${escAttr(e.description)}">
        <label class="vault-label">Login</label>
        <input id="vault-f-login" class="vault-input" placeholder="Ex: root" value="${escAttr(e.login)}">
        <label class="vault-label">Mot de passe</label>
        <div class="vault-pw-field">
          <input id="vault-f-pw" type="password" class="vault-input" placeholder="Mot de passe" value="${escAttr(e.password)}">
          <button id="vault-f-eye" class="vault-icon-btn" title="Afficher / masquer"><i data-lucide="eye" class="icon-sm"></i></button>
        </div>
        <label class="vault-label">Portée</label>
        <div class="vault-scope-row">
          <label class="vault-radio"><input type="radio" name="vault-scope" value="global" ${e.scope === "global" ? "checked" : ""}> 🌐 Global (tous les projets)</label>
          <label class="vault-radio"><input type="radio" name="vault-scope" value="project" ${e.scope === "project" ? "checked" : ""}> 📁 Projet : ${projectName}</label>
        </div>
        <div id="vault-edit-err" class="vault-error"></div>
        <div class="vault-actions">
          <button id="vault-save-btn" class="web-btn"><i data-lucide="check" class="icon-sm"></i> Enregistrer</button>
          <button id="vault-cancel-btn" class="web-btn">Annuler</button>
        </div>
      </div>
    `;
    refreshIcons(container);

    const eyeBtn = container.querySelector("#vault-f-eye");
    const pwInput = container.querySelector("#vault-f-pw");
    let revealed = false;
    eyeBtn.addEventListener("click", () => {
      revealed = !revealed;
      pwInput.type = revealed ? "text" : "password";
      eyeBtn.innerHTML = `<i data-lucide="${revealed ? "eye-off" : "eye"}" class="icon-sm"></i>`;
      refreshIcons(eyeBtn);
    });

    container.querySelector("#vault-cancel-btn").addEventListener("click", () => loadUnlocked());

    container.querySelector("#vault-save-btn").addEventListener("click", async () => {
      const err = container.querySelector("#vault-edit-err");
      const description = container.querySelector("#vault-f-desc").value.trim();
      const login = container.querySelector("#vault-f-login").value;
      const password = container.querySelector("#vault-f-pw").value;
      const scope = container.querySelector('input[name="vault-scope"]:checked').value;
      if (!description) {
        err.textContent = "La description est requise.";
        return;
      }
      err.textContent = "";
      const payload = {
        id: isEdit ? e.id : "",
        description,
        login,
        password,
        scope,
        projectPath: scope === "project" ? projectPath : null,
        createdAt: isEdit ? e.created_at : 0,
        updatedAt: isEdit ? e.updated_at : 0,
      };
      try {
        const updated = isEdit
          ? await invoke("vault_update", { entry: payload })
          : await invoke("vault_add", { entry: payload });
        renderUnlocked(updated);
      } catch (err2) {
        err.textContent = String(err2);
      }
    });
  }

  // ── Changer le mot de passe maître ──
  function openChangeMaster() {
    bodyEl.innerHTML = `
      <div class="vault-panel">
        <div class="vault-panel-title">Changer le mot de passe maître</div>
        <div class="vault-panel-desc">Les entrées existantes seront ré-chiffrées avec la nouvelle clé.</div>
        <input id="vault-cm1" type="password" class="vault-input" placeholder="Nouveau mot de passe maître (min. 4 caractères)" autocomplete="new-password">
        <input id="vault-cm2" type="password" class="vault-input" placeholder="Confirmer le nouveau mot de passe maître" autocomplete="new-password">
        <div id="vault-cm-err" class="vault-error"></div>
        <div class="vault-actions">
          <button id="vault-cm-save" class="web-btn"><i data-lucide="check" class="icon-sm"></i> Changer</button>
          <button id="vault-cm-cancel" class="web-btn">Annuler</button>
        </div>
      </div>
    `;
    refreshIcons(container);
    container.querySelector("#vault-cm-cancel").addEventListener("click", () => loadUnlocked());
    container.querySelector("#vault-cm-save").addEventListener("click", async () => {
      const err = container.querySelector("#vault-cm-err");
      const p1 = container.querySelector("#vault-cm1").value;
      const p2 = container.querySelector("#vault-cm2").value;
      if (p1 !== p2) {
        err.textContent = "Les deux mots de passe ne correspondent pas.";
        return;
      }
      err.textContent = "";
      try {
        await invoke("vault_set_master_password", { masterPassword: p1 });
        await loadUnlocked();
      } catch (e) {
        err.textContent = String(e);
      }
    });
  }

  // ── Initialisation ──
  (async function init() {
    try {
      const status = await invoke("vault_status");
      if (!status.initialized) {
        renderInit();
      } else if (!status.unlocked) {
        renderLocked();
      } else {
        await loadUnlocked();
      }
    } catch (e) {
      bodyEl.innerHTML = `<div class="vault-error">${e}</div>`;
    }
  })();

  return { wrapper: container, unlisten: null };
}

function escAttr(s) {
  return String(s ?? "").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
