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
//   5. Bloc Phase B/C (sync, verrous, tickets) — texte statique uniquement.
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
  function renderProvision() {
    const panel = document.createElement("div");
    panel.className = "gds-panel";
    panel.innerHTML = `
      <div class="gds-panel-title"><i data-lucide="server" class="icon-sm"></i> 1. Provisionner le serveur GDS</div>
      <div class="gds-panel-desc">
        Crée la base PostgreSQL <code>pilot_gds</code> + les tables + le premier
        compte admin, puis active le GDS pour ce projet (écrit <code>.pilot/gds.json</code>).
      </div>
      <label class="gds-label">Adresse PostgreSQL (ex: postgres://postgres:pass@192.168.1.10:5432/postgres)</label>
      <input id="gds-db-addr" class="gds-input" placeholder="postgres://user:pass@host:5432/postgres" autocomplete="off">
      <div class="gds-grid2">
        <div>
          <label class="gds-label">Utilisateur dédié</label>
          <input id="gds-db-user" class="gds-input" placeholder="pilot" autocomplete="off">
        </div>
        <div>
          <label class="gds-label">Mot de passe dédié</label>
          <input id="gds-db-password" type="password" class="gds-input" placeholder="••••••••" autocomplete="new-password">
        </div>
      </div>
      <div class="gds-grid2">
        <div>
          <label class="gds-label">Email admin</label>
          <input id="gds-admin-email" class="gds-input" placeholder="dev@kalico" autocomplete="off">
        </div>
        <div>
          <label class="gds-label">Mot de passe admin</label>
          <input id="gds-admin-password" type="password" class="gds-input" placeholder="••••••••" autocomplete="new-password">
        </div>
      </div>
      <div id="gds-provision-err" class="gds-error"></div>
      <div class="gds-actions">
        <button id="gds-provision-btn" class="web-btn"><i data-lucide="rocket" class="icon-sm"></i> Provisionner</button>
      </div>
    `;
    bodyEl.appendChild(panel);
    refreshIcons(container);

    const btn = panel.querySelector("#gds-provision-btn");
    const err = panel.querySelector("#gds-provision-err");
    btn.addEventListener("click", async () => {
      const project = currentProjectPath();
      if (!project) { err.textContent = "Aucun projet ouvert."; return; }
      const dbAddr = panel.querySelector("#gds-db-addr").value.trim();
      const dbUser = panel.querySelector("#gds-db-user").value.trim();
      const dbPassword = panel.querySelector("#gds-db-password").value;
      const adminEmail = panel.querySelector("#gds-admin-email").value.trim();
      const adminPassword = panel.querySelector("#gds-admin-password").value;
      if (!dbAddr || !dbUser || !dbPassword) {
        err.textContent = "Adresse, utilisateur et mot de passe PostgreSQL sont requis.";
        return;
      }
      err.textContent = "";
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader" class="icon-sm"></i> Provisionnement…';
      refreshIcons(container);
      try {
        await invoke("gds_provision", {
          project, dbAddr, dbUser, dbPassword, adminEmail, adminPassword,
        });
        err.textContent = "";
        await refresh();
      } catch (e) {
        err.textContent = String(e);
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
    panel.innerHTML = `
      <div class="gds-panel-title"><i data-lucide="settings-2" class="icon-sm"></i> 2. Configuration du projet (.pilot/gds.json)</div>
      <div class="gds-panel-desc">
        ${enabled
          ? 'Le GDS est <strong class="gds-ok">activé</strong> pour ce projet.'
          : 'Le GDS n\'est <strong>pas encore activé</strong> pour ce projet. Provisionnez le serveur (section 1) ou enregistrez une config ci-dessous.'}
      </div>
      <label class="gds-label">Activé</label>
      <label class="gds-check"><input type="checkbox" id="gds-cfg-enabled" ${enabled ? "checked" : ""}> Activer le GDS pour ce projet</label>
      <label class="gds-label">URL du serveur</label>
      <input id="gds-cfg-server" class="gds-input" value="${esc(cfg ? cfg.server_url : "")}" placeholder="postgres://user:pass@host:5432/postgres" autocomplete="off">
      <label class="gds-label">Email d'identité</label>
      <input id="gds-cfg-email" class="gds-input" value="${esc(cfg ? cfg.identity_email : "")}" placeholder="dev@kalico" autocomplete="off">
      <label class="gds-label">Dossier local de clonage (optionnel)</label>
      <input id="gds-cfg-localdir" class="gds-input" value="${esc(cfg && cfg.gds_local_dir ? cfg.gds_local_dir : "")}" placeholder="~/Pilot/GDS" autocomplete="off">
      <label class="gds-label">Hôte SSH (host:22, optionnel)</label>
      <input id="gds-cfg-ssh" class="gds-input" value="${esc(cfg ? cfg.ssh_host : "")}" placeholder="192.168.1.10:22" autocomplete="off">
      <div id="gds-config-err" class="gds-error"></div>
      <div class="gds-actions">
        <button id="gds-config-save" class="web-btn"><i data-lucide="check" class="icon-sm"></i> Enregistrer</button>
      </div>
    `;
    bodyEl.appendChild(panel);
    refreshIcons(container);

    const err = panel.querySelector("#gds-config-err");
    panel.querySelector("#gds-config-save").addEventListener("click", async () => {
      const project = currentProjectPath();
      if (!project) { err.textContent = "Aucun projet ouvert."; return; }
      const cfgPayload = {
        enabled: panel.querySelector("#gds-cfg-enabled").checked,
        server_url: panel.querySelector("#gds-cfg-server").value.trim(),
        identity_email: panel.querySelector("#gds-cfg-email").value.trim(),
        gds_local_dir: panel.querySelector("#gds-cfg-localdir").value.trim() || null,
        ssh_host: panel.querySelector("#gds-cfg-ssh").value.trim(),
      };
      err.textContent = "";
      try {
        await invoke("gds_save_config", { project, cfg: cfgPayload });
        await refresh();
      } catch (e) {
        err.textContent = String(e);
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
        remote <code>origin</code> et pousse la branche courante.
      </div>
      <label class="gds-label">Email (membre du projet)</label>
      <input id="gds-add-email" class="gds-input" placeholder="dev@kalico" autocomplete="off">
      <div id="gds-add-err" class="gds-error"></div>
      <div class="gds-actions">
        <button id="gds-add-btn" class="web-btn"><i data-lucide="plus" class="icon-sm"></i> Ajouter le projet au GDS</button>
      </div>
    `;
    bodyEl.appendChild(panel);
    refreshIcons(container);

    const btn = panel.querySelector("#gds-add-btn");
    const err = panel.querySelector("#gds-add-err");
    btn.addEventListener("click", async () => {
      const project = currentProjectPath();
      if (!project) { err.textContent = "Aucun projet ouvert."; return; }
      const email = panel.querySelector("#gds-add-email").value.trim();
      if (!email) { err.textContent = "L'email est requis."; return; }
      err.textContent = "";
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader" class="icon-sm"></i> Ajout…';
      refreshIcons(container);
      try {
        const res = await invoke("gds_add_project", { project, email });
        err.textContent = "";
        await refresh();
        return res;
      } catch (e) {
        err.textContent = String(e);
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

  // ── Section 5 : bloc Phase B/C (texte statique) ──
  function renderPhaseBC() {
    const panel = document.createElement("div");
    panel.className = "gds-panel gds-phase";
    panel.innerHTML = `
      <div class="gds-panel-title"><i data-lucide="hourglass" class="icon-sm"></i> 5. Phase B / C — à venir</div>
      <div class="gds-panel-desc">
        Les fonctionnalités suivantes sont <strong>disponibles à la Phase B/C</strong>
        (non implémentées dans cette version) :
      </div>
      <ul class="gds-phase-list">
        <li><strong>Synchronisation</strong> (sync des sources entre postes) — Phase B</li>
        <li><strong>Verrous</strong> (verrouillage de fichiers / projets) — Phase B</li>
        <li><strong>Tickets</strong> (suivi des demandes clients) — Phase C</li>
        <li><strong>Suivi fusionné</strong> (contexte projet partagé) — Phase C</li>
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

    // Config projet.
    let cfg = null;
    try {
      cfg = await invoke("gds_get_config", { project });
    } catch (e) {
      bodyEl.innerHTML = `<div class="gds-error">${e}</div>`;
      return;
    }

    renderProvision();
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

    renderPhaseBC();
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
