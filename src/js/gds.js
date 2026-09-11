// gds.js — Onglet « 🌐 GDS » (Gestionnaire de Sources, spec_gds.md)
//
// Interface graphique du GDS, PAR PROJET. Sections :
//   1. Provisionnement du serveur (adresse/hôte, port, user, mot de passe
//      PostgreSQL, email admin) → gds_provision.
//   2. État de la config projet (.pilot/gds.json) → gds_get_config /
//      gds_save_config.
//   3. Ajout du projet au GDS (bare + remote + push) → gds_add_project.
//   4. Liste des projets et des dépôts git du serveur → gds_list_projects /
//      gds_list_git_repos.
//   5. Clefs SSH (Phase A3) → gds_ssh_key / gds_register_ssh_key.
//   6. Bloc Phase B (sync, verrous) — texte statique uniquement.
//   7. Bloc Phase C (tickets, suivi fusionné) — texte statique uniquement.
//
// Le GDS est activé projet par projet (aucun serveur par défaut, aucune config
// globale — décision 29/08/2026, spec_gds.md §0.4).

import { invoke } from "@tauri-apps/api/core";
import { refreshIcons } from "./icons.js";

/** Chemin du projet actif (l'onglet GDS est PAR PROJET). */
function currentProjectPath() {
  return window._pilotProjectPath || null;
}

/** Échappe le HTML pour injection sûre dans innerHTML. */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

/**
 * Traduit les erreurs git résiduelles (ex: identité git absente) en message
 * compréhensible plutôt que le texte brut de git. Les erreurs déjà claires
 * (messages Pilot) sont passées telles quelles.
 */
function friendlyGdsError(e) {
  const msg = String(e == null ? "" : e);
  const lower = msg.toLowerCase();
  if (lower.includes("identité git") || lower.includes("identity unknown") ||
      lower.includes("user.name") || lower.includes("user.email")) {
    return "⚠️ Identité git non configurée : définissez votre nom et email git " +
      "(`git config --global user.name` et `git config --global user.email`), puis réessayez.";
  }
  // git remote add / push brute → cause lisible.
  if (lower.includes("remote add a échoué") && lower.includes("not a git repository")) {
    return "⚠️ Le dossier ne contenait pas encore de dépôt Git valide pendant l'attache. Réessayez après l'initialisation automatique.";
  }
  return msg;
}

/** Crée l'onglet GDS dans `container`. */
export function createGds(container) {
  container.classList.add("gds-view");
  container.innerHTML = `
    <div class="gds-scroll">
      <div class="gds-header">
        <div class="gds-title">🌐 GDS — Gestionnaire de Sources</div>
        <div class="gds-subtitle" id="gds-subtitle">Chargement…</div>
      </div>
      <div id="gds-body" class="gds-body">
        <div class="gds-loading">Chargement…</div>
      </div>
    </div>
  `;
  refreshIcons(container);

  const bodyEl = container.querySelector("#gds-body");
  const subtitleEl = container.querySelector("#gds-subtitle");

  // ── Section 1 : provisionnement du serveur ──
  // Champs séparés (hôte/port/utilisateur dédié/mdp dédié/email admin/mdp admin)
  // au lieu d'une URL `postgres://user:pass@host`. Mots de passe masqués
  // (type=password) avec toggle afficher/masquer ; pré-remplis depuis la config
  // + les secrets connus ; ressaisie seulement si config/secret manque. Les mdp
  // ne sont jamais écrits dans gds.json (stockés hors projet côté backend).
  function renderProvision(cfg, secrets) {
    const panel = document.createElement("div");
    panel.className = "gds-panel";
    const host = (cfg && cfg.db_host) || "";
    const port = (cfg && cfg.db_port) || "5432";
    const user = (cfg && cfg.db_user) || "";
    const adminEmail = (cfg && cfg.identity_email) || "";
    const hasDbPw = !!(secrets && secrets.db_password);
    const hasAdminPw = !!(secrets && secrets.admin_password);
    panel.innerHTML = `
      <div class="gds-panel-title"><i data-lucide="server" class="icon-sm"></i> 1. Provisionner le serveur GDS</div>
      <div class="gds-panel-desc">
        Crée la base PostgreSQL <code>pilot_gds</code> + les tables + le premier
        compte admin, puis active le GDS pour ce projet (écrit <code>.pilot/gds.json</code>).
        Les mots de passe sont stockés hors projet (<code>~/.pilot/gds_secrets.json</code>, 0600)
        et ne sont demandés qu'à la première configuration.
      </div>
      <div class="gds-panel-desc" style="margin-top:8px"><strong>Réutiliser un serveur déjà mémorisé</strong> (les mots de passe restent hors projet, jamais affichés en clair) :</div>
      <div class="gds-grid2">
        <div>
          <label class="gds-label">Serveur sauvegardé</label>
          <select id="gds-server-select" class="gds-input">
            <option value="">— Choisir un serveur —</option>
          </select>
        </div>
        <div class="gds-actions" style="align-self:flex-end">
          <button id="gds-server-apply" class="web-btn"><i data-lucide="rotate-ccw" class="icon-sm"></i> Réutiliser ce serveur</button>
        </div>
      </div>
      <div class="gds-grid2">
        <div>
          <label class="gds-label">Hôte PostgreSQL</label>
          <input id="gds-db-host" class="gds-input" value="${esc(host)}" placeholder="192.168.1.10" autocomplete="off">
        </div>
        <div>
          <label class="gds-label">Port</label>
          <input id="gds-db-port" class="gds-input" value="${esc(port)}" placeholder="5432" autocomplete="off">
        </div>
      </div>
      <div class="gds-grid2">
        <div>
          <label class="gds-label">Utilisateur dédié</label>
          <input id="gds-db-user" class="gds-input" value="${esc(user)}" placeholder="pilot" autocomplete="off">
        </div>
        <div>
          <label class="gds-label">Mot de passe dédié ${hasDbPw ? "<em style='color:#aaa'>(enregistré)</em>" : ""}</label>
          <div class="gds-pw">
            <input id="gds-db-password" type="password" class="gds-input" placeholder="••••••••" autocomplete="new-password">
            <button type="button" class="gds-eye" data-target="gds-db-password" title="Afficher/masquer"><i data-lucide="eye" class="icon-sm"></i></button>
          </div>
        </div>
      </div>
      <div class="gds-grid2">
        <div>
          <label class="gds-label">Email admin</label>
          <input id="gds-admin-email" class="gds-input" value="${esc(adminEmail)}" placeholder="dev@kalico" autocomplete="off">
        </div>
        <div>
          <label class="gds-label">Mot de passe admin ${hasAdminPw ? "<em style='color:#aaa'>(enregistré)</em>" : ""}</label>
          <div class="gds-pw">
            <input id="gds-admin-password" type="password" class="gds-input" placeholder="••••••••" autocomplete="new-password">
            <button type="button" class="gds-eye" data-target="gds-admin-password" title="Afficher/masquer"><i data-lucide="eye" class="icon-sm"></i></button>
          </div>
        </div>
      </div>
      <div id="gds-provision-err" class="gds-error"></div>
      <div id="gds-provision-ok" class="gds-ok"></div>
      <div class="gds-actions">
        <button id="gds-provision-btn" class="web-btn"><i data-lucide="rocket" class="icon-sm"></i> Provisionner</button>
      </div>
    `;
    bodyEl.appendChild(panel);
    refreshIcons(container);

    // Toggle afficher/masquer des mots de passe (jamais persistés en clair).
    panel.querySelectorAll(".gds-eye").forEach((eye) => {
      eye.addEventListener("click", () => {
        const input = panel.querySelector("#" + eye.dataset.target);
        if (!input) return;
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        eye.innerHTML = `<i data-lucide="${show ? "eye-off" : "eye"}" class="icon-sm"></i>`;
        refreshIcons(container);
      });
    });

    // ── Évolution 1 : liste des serveurs mémorisés (hôte/port/user uniquement).
    // Fail-open : échec de chargement → liste vide, jamais bloquant. La
    // SÉLECTION applique automatiquement la connexion au projet (action
    // principale) — aucun mot de passe n'est affiché ni ressaisi.
    const serverSelect = panel.querySelector("#gds-server-select");
    const serverApply = panel.querySelector("#gds-server-apply");
    async function loadSavedServers() {
      try {
        const servers = await invoke("gds_list_saved_servers");
        for (const s of servers || []) {
          const opt = document.createElement("option");
          opt.value = `${s.user}@${s.host}`;
          opt.dataset.host = s.host;
          opt.dataset.port = s.port || "5432";
          opt.dataset.user = s.user;
          opt.textContent = `${s.user}@${s.host}:${s.port || "5432"}`;
          serverSelect.appendChild(opt);
        }
      } catch (_) {
        /* fail-open */
      }
    }
    // Applique le serveur sélectionné au projet : le backend copie les mots de
    // passe depuis les secrets (jamais remontés) et pré-remplit `.pilot/gds.json`.
    async function applySelectedServer() {
      const project = currentProjectPath();
      if (!project) return;
      const opt = serverSelect.options[serverSelect.selectedIndex];
      if (!opt || !opt.dataset.host) return;
      const emailEl = panel.querySelector("#gds-admin-email");
      const email = (emailEl && emailEl.value.trim()) || (cfg && cfg.identity_email) || "";
      const errEl = panel.querySelector("#gds-provision-err");
      const okEl = panel.querySelector("#gds-provision-ok");
      if (errEl) errEl.textContent = "";
      if (okEl) okEl.textContent = "";
      try {
        const res = await invoke("gds_apply_server", {
          project,
          host: opt.dataset.host,
          port: opt.dataset.port,
          user: opt.dataset.user,
          email,
        });
        // Pré-remplir la connexion dans le formulaire (hôte/port/user/email).
        panel.querySelector("#gds-db-host").value = res.db_host || opt.dataset.host;
        panel.querySelector("#gds-db-port").value = res.db_port || opt.dataset.port;
        panel.querySelector("#gds-db-user").value = res.db_user || opt.dataset.user;
        if (emailEl && email && emailEl.value.trim() !== email) emailEl.value = email;
        if (okEl) okEl.textContent = `✅ Serveur « ${opt.textContent} » appliqué à ce projet.`;
      } catch (e) {
        if (errEl) errEl.textContent = String(e);
      }
    }
    // Sélection directe : applique automatiquement (action principale).
    serverSelect.addEventListener("change", () => {
      if (serverSelect.selectedIndex > 0) applySelectedServer();
    });
    // Bouton fallback (re-appliquer manuellement quand un serveur est choisi).
    serverApply.addEventListener("click", applySelectedServer);
    loadSavedServers();

    const btn = panel.querySelector("#gds-provision-btn");
    const err = panel.querySelector("#gds-provision-err");
    const ok = panel.querySelector("#gds-provision-ok");
    btn.addEventListener("click", async () => {
      const project = currentProjectPath();
      if (!project) { err.textContent = "Aucun projet ouvert."; return; }
      const dbHost = panel.querySelector("#gds-db-host").value.trim();
      const dbPort = panel.querySelector("#gds-db-port").value.trim();
      const dbUser = panel.querySelector("#gds-db-user").value.trim();
      const dbPassword = panel.querySelector("#gds-db-password").value;
      const adminEmail = panel.querySelector("#gds-admin-email").value.trim();
      const adminPassword = panel.querySelector("#gds-admin-password").value;
      if (!dbHost || !dbUser) {
        err.textContent = "Hôte et utilisateur PostgreSQL sont requis.";
        return;
      }
      if (!dbPassword && !hasDbPw) {
        err.textContent = "Le mot de passe dédié est requis (ou déjà enregistré).";
        return;
      }
      if (adminEmail && !adminPassword && !hasAdminPw) {
        err.textContent = "Un mot de passe admin est requis pour l'email admin.";
        return;
      }
      err.textContent = "";
      ok.textContent = "";
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader" class="icon-sm"></i> Provisionnement…';
      refreshIcons(container);
      try {
        await invoke("gds_provision", {
          project, dbHost, dbPort, dbUser, dbPassword, adminEmail, adminPassword,
        });
        err.textContent = "";
        await refresh();
        const okEl = bodyEl.querySelector("#gds-provision-ok");
        if (okEl) okEl.textContent = "✅ Serveur provisionné et GDS activé pour ce projet.";
      } catch (e) {
        err.textContent = String(e);
        ok.textContent = "";
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="rocket" class="icon-sm"></i> Provisionner';
        refreshIcons(container);
      }
    });
  }

  // ── Section 2 : état de la config projet ──
  function renderConfig(cfg) {
    const panel = document.createElement("div");
    panel.className = "gds-panel";
    const enabled = cfg && cfg.enabled;
    const host = (cfg && cfg.db_host) || "";
    const port = (cfg && cfg.db_port) || "";
    const user = (cfg && cfg.db_user) || "";
    panel.innerHTML = `
      <div class="gds-panel-title"><i data-lucide="settings-2" class="icon-sm"></i> 2. Configuration du projet (.pilot/gds.json)</div>
      <div class="gds-panel-desc">
        ${enabled
          ? 'Le GDS est <strong class="gds-ok">activé</strong> pour ce projet.'
          : 'Le GDS n\'est <strong>pas encore activé</strong> pour ce projet. Provisionnez le serveur (section 1) ou enregistrez une config ci-dessous.'}
      </div>
      <label class="gds-label">Activé</label>
      <label class="gds-check"><input type="checkbox" id="gds-cfg-enabled" ${enabled ? "checked" : ""}> Activer le GDS pour ce projet</label>
      <div class="gds-grid3">
        <div>
          <label class="gds-label">Hôte PostgreSQL</label>
          <input class="gds-input" value="${esc(host)}" readonly title="Géré lors du provisionnement (section 1)">
        </div>
        <div>
          <label class="gds-label">Port</label>
          <input class="gds-input" value="${esc(port)}" readonly title="Géré lors du provisionnement (section 1)">
        </div>
        <div>
          <label class="gds-label">Utilisateur dédié</label>
          <input class="gds-input" value="${esc(user)}" readonly title="Géré lors du provisionnement (section 1)">
        </div>
      </div>
      <label class="gds-label">Email d'identité</label>
      <input id="gds-cfg-email" class="gds-input" value="${esc(cfg ? cfg.identity_email : "")}" placeholder="dev@kalico" autocomplete="off">
      <div class="gds-panel-desc" style="margin-top:8px">
        L'hôte SSH (<code>host:22</code>) est dérivé automatiquement de l'hôte
        PostgreSQL et le dossier local de clonage utilise le défaut
        (<code>C:\GDS</code> sur Windows, <code>~/Pilot/GDS</code> ailleurs).
        Les mots de passe ne sont jamais affichés ici ; ils restent dans
        <code>~/.pilot/gds_secrets.json</code>.
      </div>
      <div id="gds-config-err" class="gds-error"></div>
      <div id="gds-config-ok" class="gds-ok"></div>
      <div class="gds-actions">
        <button id="gds-config-save" class="web-btn"><i data-lucide="check" class="icon-sm"></i> Enregistrer</button>
      </div>
      <div class="gds-remove-block" style="margin-top:18px; border-top:1px solid var(--border,#333); padding-top:12px">
        <div class="gds-panel-desc" style="margin-bottom:6px">
          <strong>Retirer ce projet du GDS</strong> — retire le remote <code>gds</code>
          local et supprime <code>.pilot/gds.json</code>. Vous pouvez aussi purger
          le serveur (suppression du dépôt bare + entrées en base) en cochant la
          case ci-dessous (jamais par défaut).
        </div>
        <div id="gds-remove-confirm" class="gds-panel" style="display:none; margin-top:8px">
          <div class="gds-panel-desc">
            Confirmez le retrait de ce projet du GDS. Cette action est <strong>destructive</strong>.
          </div>
          <label class="gds-check"><input type="checkbox" id="gds-purge-check"> Purger aussi le serveur (suppression du dépôt bare + entrées en base)</label>
          <div id="gds-remove-err" class="gds-error"></div>
          <div id="gds-remove-ok" class="gds-ok"></div>
          <div class="gds-actions">
            <button id="gds-remove-confirm-btn" class="web-btn danger"><i data-lucide="trash-2" class="icon-sm"></i> Confirmer le retrait</button>
            <button id="gds-remove-cancel" class="web-btn">Annuler</button>
          </div>
        </div>
        <button id="gds-remove-btn" class="web-btn"><i data-lucide="log-out" class="icon-sm"></i> Retirer du GDS</button>
      </div>
    `;
    bodyEl.appendChild(panel);
    refreshIcons(container);

    const err = panel.querySelector("#gds-config-err");
    const ok = panel.querySelector("#gds-config-ok");
    panel.querySelector("#gds-config-save").addEventListener("click", async () => {
      const project = currentProjectPath();
      if (!project) { err.textContent = "Aucun projet ouvert."; return; }
      // Payload minimal : l'UI n'envoie plus d'URL à mot de passe. Le backend
      // préserve db_host/db_port/db_user, gds_local_dir, urgent_email et
      // ssh_host (normalize) quand le payload ne les inclut pas.
      const cfgPayload = {
        enabled: panel.querySelector("#gds-cfg-enabled").checked,
        identity_email: panel.querySelector("#gds-cfg-email").value.trim(),
      };
      err.textContent = "";
      ok.textContent = "";
      try {
        await invoke("gds_save_config", { project, cfg: cfgPayload });
        await refresh();
        const okEl = bodyEl.querySelector("#gds-config-ok");
        if (okEl) okEl.textContent = "✅ Configuration enregistrée.";
      } catch (e) {
        err.textContent = String(e);
        ok.textContent = "";
      }
    });

    // ── Évolution 2 : bouton « Retirer du GDS » ──
    const removeBtn = panel.querySelector("#gds-remove-btn");
    const confirmBox = panel.querySelector("#gds-remove-confirm");
    const purgeCheck = panel.querySelector("#gds-purge-check");
    const removeErr = panel.querySelector("#gds-remove-err");
    const removeOk = panel.querySelector("#gds-remove-ok");
    // Jamais activé par défaut (purge destructive exigée par case explicite).
    purgeCheck.checked = false;
    removeBtn.addEventListener("click", () => {
      removeOk.textContent = ""; removeErr.textContent = "";
      confirmBox.style.display = confirmBox.style.display === "none" ? "block" : "none";
    });
    panel.querySelector("#gds-remove-cancel").addEventListener("click", () => {
      confirmBox.style.display = "none";
    });
    panel.querySelector("#gds-remove-confirm-btn").addEventListener("click", async () => {
      const project = currentProjectPath();
      if (!project) { removeErr.textContent = "Aucun projet ouvert."; return; }
      // La purge serveur n'est jamais par défaut : uniquement si la case est cochée.
      const purgeServer = purgeCheck.checked;
      removeErr.textContent = ""; removeOk.textContent = "";
      const btn = panel.querySelector("#gds-remove-confirm-btn");
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader" class="icon-sm"></i> Retrait…';
      refreshIcons(container);
      try {
        const res = await invoke("gds_remove_project", { project, purgeServer });
        removeOk.textContent = res.purged_server
          ? "✅ Projet retiré du GDS (purge serveur effectuée)."
          : "✅ Projet retiré du GDS (sans purge serveur).";
        confirmBox.style.display = "none";
        await refresh();
      } catch (e) {
        removeErr.textContent = String(e);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="trash-2" class="icon-sm"></i> Confirmer le retrait';
        refreshIcons(container);
      }
    });
  }

  // ── Section 3 : ajout du projet au GDS ──
  function renderAddProject() {
    const panel = document.createElement("div");
    panel.className = "gds-panel";
    panel.innerHTML = `
      <div class="gds-panel-title"><i data-lucide="git-branch" class="icon-sm"></i> 3. Ajouter le projet au GDS</div>
      <div class="gds-panel-desc">
        Crée un dépôt git bare sur le serveur, enregistre le projet, ajoute le
        remote <code>gds</code> (sans toucher à un éventuel <code>origin</code>
        existant) et pousse la branche courante.
      </div>
      <label class="gds-label">Email (membre du projet)</label>
      <input id="gds-add-email" class="gds-input" placeholder="dev@kalico" autocomplete="off">
      <div id="gds-add-err" class="gds-error"></div>
      <div id="gds-add-ok" class="gds-ok"></div>
      <div class="gds-actions">
        <button id="gds-add-btn" class="web-btn"><i data-lucide="plus" class="icon-sm"></i> Ajouter le projet au GDS</button>
      </div>
    `;
    bodyEl.appendChild(panel);
    refreshIcons(container);

    const btn = panel.querySelector("#gds-add-btn");
    const err = panel.querySelector("#gds-add-err");
    const ok = panel.querySelector("#gds-add-ok");
    btn.addEventListener("click", async () => {
      const project = currentProjectPath();
      if (!project) { err.textContent = "Aucun projet ouvert."; return; }
      const email = panel.querySelector("#gds-add-email").value.trim();
      if (!email) { err.textContent = "L'email est requis."; return; }
      err.textContent = "";
      ok.textContent = "";
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader" class="icon-sm"></i> Ajout…';
      refreshIcons(container);
      try {
        const res = await invoke("gds_add_project", { project, email });
        err.textContent = "";
        await refresh();
        const okEl = bodyEl.querySelector("#gds-add-ok");
        if (okEl) {
          if (res && res.initialized) {
            okEl.textContent = "✅ Projet ajouté au GDS. Le dossier a été initialisé en dépôt Git automatiquement (premier commit effectué).";
          } else {
            okEl.textContent = "✅ Projet ajouté au GDS.";
          }
        }
        return res;
      } catch (e) {
        err.textContent = friendlyGdsError(e);
        ok.textContent = "";
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="plus" class="icon-sm"></i> Ajouter le projet au GDS';
        refreshIcons(container);
      }
    });
  }

  // ── Section 4 : liste des projets et des dépôts git ──
  function renderLists(projects, repos) {
    const panel = document.createElement("div");
    panel.className = "gds-panel";
    panel.innerHTML = `
      <div class="gds-panel-title"><i data-lucide="database" class="icon-sm"></i> 4. Projets & dépôts git du serveur</div>
      <div class="gds-panel-desc">Projets enregistrés sur le serveur GDS (base <code>pilot_gds</code>).</div>
      <div id="gds-projects" class="gds-list"></div>
      <div class="gds-panel-desc" style="margin-top:12px">Dépôts git (bare) centralisés.</div>
      <div id="gds-repos" class="gds-list"></div>
    `;
    bodyEl.appendChild(panel);
    refreshIcons(container);

    const projEl = panel.querySelector("#gds-projects");
    const repoEl = panel.querySelector("#gds-repos");

    if (!projects || projects.length === 0) {
      projEl.innerHTML = `<div class="gds-empty">Aucun projet enregistré sur le serveur.</div>`;
    } else {
      for (const p of projects) {
        const row = document.createElement("div");
        row.className = "gds-row";
        row.innerHTML = `
          <div class="gds-row-info">
            <div class="gds-row-title">${esc(p.name)}</div>
            <div class="gds-row-sub">${esc(p.repo_url || "")}</div>
          </div>
          <span class="gds-chip">${esc(p.status || "")}</span>
        `;
        projEl.appendChild(row);
      }
    }

    if (!repos || repos.length === 0) {
      repoEl.innerHTML = `<div class="gds-empty">Aucun dépôt git enregistré.</div>`;
    } else {
      for (const r of repos) {
        const row = document.createElement("div");
        row.className = "gds-row";
        row.innerHTML = `
          <div class="gds-row-info">
            <div class="gds-row-title">${esc(r.bare_path || "")}</div>
            <div class="gds-row-sub">projet #${esc(r.project_id)}</div>
          </div>
        `;
        repoEl.appendChild(row);
      }
    }
    refreshIcons(container);
  }

  // ── Section 5 : clefs SSH (Phase A3) ──
  function renderSshKeys() {
    const panel = document.createElement("div");
    panel.className = "gds-panel";
    panel.innerHTML = `
      <div class="gds-panel-title"><i data-lucide="key-round" class="icon-sm"></i> 5. Clefs SSH (Phase A3)</div>
      <div class="gds-panel-desc">
        Le GDS synchronise les projets via SSH (<code>ssh://git@&lt;host&gt;:22/&lt;projet&gt;.git</code>).
        Pilot gère automatiquement l'utilisateur <code>git</code> et les clefs publiques liées aux emails.
      </div>
      <div class="gds-panel-desc" style="margin-top:8px"><strong>Clef du poste</strong> (générée automatiquement si absente) :</div>
      <div id="gds-ssh-poste" class="gds-ssh-poste"></div>
      <div class="gds-actions">
        <button id="gds-ssh-key-btn" class="web-btn"><i data-lucide="key-round" class="icon-sm"></i> Générer / afficher la clef du poste</button>
      </div>
      <div class="gds-panel-desc" style="margin-top:12px"><strong>Enregistrer une clef de dev</strong> (liée à un email) :</div>
      <label class="gds-label">Email</label>
      <input id="gds-ssh-email" class="gds-input" placeholder="dev@kalico" autocomplete="off">
      <label class="gds-label">Clef publique</label>
      <textarea id="gds-ssh-pubkey" class="gds-input gds-textarea" rows="2" placeholder="ssh-ed25519 AAAA..." autocomplete="off"></textarea>
      <div id="gds-ssh-err" class="gds-error"></div>
      <div id="gds-ssh-ok" class="gds-ok"></div>
      <div class="gds-actions">
        <button id="gds-ssh-register-btn" class="web-btn"><i data-lucide="plus" class="icon-sm"></i> Enregistrer la clef</button>
      </div>
    `;
    bodyEl.appendChild(panel);
    refreshIcons(container);

    const err = panel.querySelector("#gds-ssh-err");
    const ok = panel.querySelector("#gds-ssh-ok");
    const posteEl = panel.querySelector("#gds-ssh-poste");

    async function showPosteKey() {
      try {
        const res = await invoke("gds_ssh_key");
        posteEl.innerHTML = `
          <div class="gds-row">
            <div class="gds-row-info">
              <div class="gds-row-title">${res.generated ? "Clef générée" : "Clef existante"}</div>
              <div class="gds-row-sub">${esc(res.path)}</div>
              <div class="gds-ssh-key">${esc(res.public_key)}</div>
            </div>
          </div>
        `;
      } catch (e) {
        posteEl.innerHTML = `<div class="gds-error">${esc(String(e))}</div>`;
      }
    }

    panel.querySelector("#gds-ssh-key-btn").addEventListener("click", showPosteKey);

    panel.querySelector("#gds-ssh-register-btn").addEventListener("click", async () => {
      const email = panel.querySelector("#gds-ssh-email").value.trim();
      const publicKey = panel.querySelector("#gds-ssh-pubkey").value.trim();
      if (!email) { err.textContent = "L'email est requis."; return; }
      if (!publicKey) { err.textContent = "La clef publique est requise."; return; }
      err.textContent = ""; ok.textContent = "";
      try {
        await invoke("gds_register_ssh_key", { email, publicKey });
        ok.textContent = "✅ Clef enregistrée et authorized_keys à jour.";
      } catch (e) {
        err.textContent = String(e);
      }
    });

    showPosteKey();
  }

  // ── Section 6 : synchronisation & verrous (Phase B) ──
  function renderPhaseB() {
    const panel = document.createElement("div");
    panel.className = "gds-panel";
    panel.innerHTML = `
      <div class="gds-panel-title"><i data-lucide="refresh-cw" class="icon-sm"></i> 6. Synchronisation & verrous (Phase B)</div>
      <div class="gds-panel-desc">
        Synchronise les sources depuis le remote <code>gds</code> (clone si absent,
        sinon fetch/pull) et acquiert le verrou global projet (exclusif, TTL 30 min).
      </div>
      <div id="gds-sync-err" class="gds-error"></div>
      <div id="gds-sync-ok" class="gds-ok"></div>
      <div id="gds-sync-status" class="gds-lock-state"></div>
      <div id="gds-lock-state" class="gds-lock-state"></div>
      <div class="gds-actions">
        <button id="gds-sync-btn" class="web-btn"><i data-lucide="refresh-cw" class="icon-sm"></i> Synchroniser</button>
        <button id="gds-release-btn" class="web-btn"><i data-lucide="unlock" class="icon-sm"></i> Relâcher le verrou</button>
      </div>
      <label class="gds-label">Raison du verrou urgent</label>
      <input id="gds-urgent-reason" class="gds-input" placeholder="Motif du passage en urgent" autocomplete="off">
      <div class="gds-actions">
        <button id="gds-urgent-btn" class="web-btn"><i data-lucide="alert-triangle" class="icon-sm"></i> Verrou urgent</button>
      </div>
    `;
    bodyEl.appendChild(panel);
    refreshIcons(container);

    const err = panel.querySelector("#gds-sync-err");
    const ok = panel.querySelector("#gds-sync-ok");
    const syncStatus = panel.querySelector("#gds-sync-status");
    const lockState = panel.querySelector("#gds-lock-state");

    // Résumé visuel de l'état de synchro du suivi (Phase C1.4) : dernière
    // synchro, éléments en attente, conflits, mode hors-ligne.
    async function refreshSyncStatus() {
      try {
        const s = await invoke("gds_sync_status");
        if (!s.enabled) {
          syncStatus.innerHTML = `<div class="gds-empty">GDS désactivé globalement — suivi fusionné inactif.</div>`;
          return;
        }
        const pending = s.pending || 0;
        const conflicts = s.last_conflicts || 0;
        const pushed = s.last_pushed || 0;
        const pulled = s.last_pulled || 0;
        const lastAt = s.last_sync_at ? new Date(s.last_sync_at).toLocaleString() : "jamais";
        let badge;
        if (s.offline) {
          badge = `<span class="gds-badge gds-badge-off">Hors-ligne</span>`;
        } else if (s.last_sync_ok) {
          badge = `<span class="gds-badge gds-badge-ok">Synchronisé</span>`;
        } else {
          badge = `<span class="gds-badge gds-badge-warn">En attente</span>`;
        }
        const pendingTxt = pending > 0
          ? `<span class="gds-badge gds-badge-warn">${pending} en attente</span>`
          : `<span class="gds-badge gds-badge-ok">À jour</span>`;
        const conflictTxt = conflicts > 0
          ? `<span class="gds-badge gds-badge-off">${conflicts} conflit(s)</span>`
          : "";
        syncStatus.innerHTML = `
          <div class="gds-row">
            <div class="gds-row-info">
              <div class="gds-row-title">Suivi fusionné — ${badge} ${pendingTxt} ${conflictTxt}</div>
              <div class="gds-row-sub">Dernière synchro : ${lastAt} — poussés ${pushed}, rapatriés ${pulled}${s.last_sync_error ? ` — ${esc(s.last_sync_error)}` : ""}</div>
            </div>
          </div>
        `;
      } catch (_) {
        syncStatus.innerHTML = `<div class="gds-empty">État de synchro indisponible.</div>`;
      }
    }

    async function refreshLock() {
      const project = currentProjectPath();
      if (!project) return;
      try {
        const lock = await invoke("gds_get_lock", { project });
        if (!lock) {
          lockState.innerHTML = `<div class="gds-empty">Aucun verrou actif sur ce projet.</div>`;
        } else {
          const held = lock.urgent ? " (urgent)" : "";
          lockState.innerHTML = `
            <div class="gds-row">
              <div class="gds-row-info">
                <div class="gds-row-title">Verrou détenu par ${esc(lock.email)}${held}</div>
                <div class="gds-row-sub">Expire : ${new Date(lock.expires_at).toLocaleString()} — ${esc(lock.reason || "—")}</div>
              </div>
            </div>
          `;
        }
      } catch (_) {
        lockState.innerHTML = `<div class="gds-empty">GDS non provisionné — verrou indisponible.</div>`;
      }
    }

    panel.querySelector("#gds-sync-btn").addEventListener("click", async () => {
      const project = currentProjectPath();
      if (!project) { err.textContent = "Aucun projet ouvert."; return; }
      err.textContent = ""; ok.textContent = "";
      const btn = panel.querySelector("#gds-sync-btn");
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader" class="icon-sm"></i> Synchronisation…';
      refreshIcons(container);
      try {
        const res = await invoke("gds_sync_project", { project });
        const lock = res.lock || {};
        if (lock.acquired) {
          ok.textContent = `✅ Synchronisé (${res.action}) et verrou acquis.`;
        } else {
          ok.textContent = `⚠️ Synchronisé (${res.action}) mais verrou détenu par ${lock.held_by || "un autre"} — conflit potentiel.`;
        }
        await refreshLock();
        await refreshSyncStatus();
      } catch (e) {
        err.textContent = String(e);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="refresh-cw" class="icon-sm"></i> Synchroniser';
        refreshIcons(container);
      }
    });

    panel.querySelector("#gds-release-btn").addEventListener("click", async () => {
      const project = currentProjectPath();
      if (!project) { err.textContent = "Aucun projet ouvert."; return; }
      err.textContent = ""; ok.textContent = "";
      try {
        await invoke("gds_release_lock", { project });
        ok.textContent = "✅ Verrou relâché.";
        await refreshLock();
      } catch (e) {
        err.textContent = String(e);
      }
    });

    panel.querySelector("#gds-urgent-btn").addEventListener("click", async () => {
      const project = currentProjectPath();
      if (!project) { err.textContent = "Aucun projet ouvert."; return; }
      const reason = panel.querySelector("#gds-urgent-reason").value.trim();
      err.textContent = ""; ok.textContent = "";
      try {
        const res = await invoke("gds_urgent_lock", { project, reason });
        ok.textContent = res.replaced
          ? `✅ Verrou urgent acquis (remplace ${res.replaced}).`
          : "✅ Verrou urgent acquis.";
        await refreshLock();
      } catch (e) {
        err.textContent = String(e);
      }
    });

    refreshLock();
    refreshSyncStatus();
  }

  // ── Section 7 : bloc Phase C (texte statique) ──
  function renderPhaseC() {
    const panel = document.createElement("div");
    panel.className = "gds-panel gds-phase";
    panel.innerHTML = `
      <div class="gds-panel-title"><i data-lucide="hourglass" class="icon-sm"></i> 7. Phase C — à venir</div>
      <div class="gds-panel-desc">
        Les fonctionnalités suivantes sont <strong>disponibles à la Phase C</strong>
        (non implémentées dans cette version) :
      </div>
      <ul class="gds-phase-list">
        <li><strong>Tickets</strong> (suivi des demandes clients)</li>
        <li><strong>Suivi fusionné</strong> (contexte projet partagé)</li>
      </ul>
    `;
    bodyEl.appendChild(panel);
    refreshIcons(container);
  }

  // ── Rendu complet ──
  async function refresh() {
    const project = currentProjectPath();
    subtitleEl.textContent = project
      ? `Projet : ${project}`
      : "Aucun projet ouvert — ouvrez un projet pour configurer le GDS.";

    bodyEl.innerHTML = "";
    if (!project) {
      bodyEl.innerHTML = `<div class="gds-empty">Ouvrez un projet pour configurer le GDS (activé projet par projet).</div>`;
      return;
    }

    // Config projet (absente → champs vides, sans erreur).
    let cfg = null;
    try {
      cfg = await invoke("gds_get_config", { project });
    } catch (_) { cfg = null; }

    // État des secrets (booleans uniquement — les valeurs ne remontent jamais).
    let secrets = null;
    try {
      secrets = await invoke("gds_secrets_status", { project });
    } catch (_) { secrets = null; }

    renderProvision(cfg, secrets);
    renderConfig(cfg);
    renderAddProject();

    // Listes serveur (tolérées : GDS non provisionné → message).
    let projects = [];
    let repos = [];
    try {
      projects = await invoke("gds_list_projects");
    } catch (_) { projects = null; }
    try {
      repos = await invoke("gds_list_git_repos");
    } catch (_) { repos = null; }
    renderLists(projects, repos);

    renderSshKeys();
    renderPhaseB();
    renderPhaseC();
    refreshIcons(container);
  }

  // Recharge quand le projet actif change (bascule de projet).
  let lastProjectPath = currentProjectPath();
  function refreshIfProjectChanged() {
    const cur = currentProjectPath();
    if (cur !== lastProjectPath) {
      lastProjectPath = cur;
      refresh();
    }
  }
  const onProjectSensitivity = () => refreshIfProjectChanged();
  document.addEventListener("pilot-project-sensitivity", onProjectSensitivity);

  function setActive(active) {
    if (active) refreshIfProjectChanged();
  }

  refresh();

  return {
    wrapper: container,
    unlisten: () => {
      document.removeEventListener("pilot-project-sensitivity", onProjectSensitivity);
    },
    refresh: refreshIfProjectChanged,
    setActive,
  };
}
