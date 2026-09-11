// gds-menu.js — Modale « Ajouter un projet depuis le GDS » (menu projet).
//
// Ouverte depuis le dropdown des projets (sidebar.js, entrée
// « Ajouter un projet depuis le GDS »), chargée à la demande (import()
// dynamique). Affiche la liste des dépôts du GDS et propose pour chacun :
//   a) Ouvrir un nouveau projet en local : clone le dépôt localement
//      (gds_clone_repo), l'ouvre comme projet et le connecte au GDS.
//   b) Ouvrir normalement un déjà en local : si un clonage local existe
//      (local_exists), l'ouvre et propose une synchronisation automatique
//      (gds_sync_project).
// Réutilise le look de l'écran GDS (classes gds-panel / gds-*) et les helpers
// globaux (toastSuccess/toastError, showLoading/hideLoading, refreshIcons).
// GDS non provisionné / non connecté → modale en lecture avec message clair,
// jamais de crash.

import { invoke } from "@tauri-apps/api/core";
import { refreshIcons } from "./icons.js";
import { showLoading, hideLoading } from "./loading.js";
import { toastSuccess, toastError } from "./toast.js";

/** Échappe le HTML pour injection sûre dans innerHTML. */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

/**
 * Ouvre la modale « Ajouter un projet depuis le GDS ».
 * @param {object} sidebar Instance Sidebar (fournit openProjectByPath).
 */
export async function openProjectFromGds(sidebar) {
  const project = window._pilotProjectPath || "";

  // Overlay + dialogue (pattern du reste de l'app).
  const overlay = document.createElement("div");
  overlay.className = "gds-menu-overlay";
  const dlg = document.createElement("div");
  dlg.className = "gds-menu-content";
  overlay.appendChild(dlg);
  document.body.appendChild(overlay);
  const close = () => overlay.remove();

  // Vérifier l'état GDS du projet courant avant d'afficher les dépôts : un GDS
  // non provisionné / non connecté ne peut pas lister les dépôts (pool absent).
  let status = "";
  try {
    status = (await invoke("gds_connection_status", { project })).status || "";
  } catch (_e) {
    status = "";
  }

  const renderState = (html) => {
    dlg.innerHTML = `
      <div class="gds-menu-title"><i data-lucide="git-branch" class="icon-sm"></i> Ajouter un projet depuis le GDS</div>
      <div class="gds-menu-state">${html}</div>
      <div class="gds-menu-actions"><button class="web-btn" data-act="close">Fermer</button></div>`;
    refreshIcons(overlay);
    dlg.querySelector('[data-act="close"]').addEventListener("click", close);
  };

  if (status !== "connected") {
    renderState(
      "Le GDS n'est pas connecté pour ce projet.<br><br>" +
      "Provisionnez / activez le GDS dans l'onglet <b>🌐 GDS</b> " +
      "(section « Connecter un serveur GDS ») avant d'ajouter un projet depuis le GDS."
    );
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    return;
  }

  // Charger la liste des dépôts du serveur GDS.
  let repos;
  try {
    repos = await invoke("gds_list_git_repos", { project });
  } catch (e) {
    renderState("⚠️ Impossible de lister les dépôts du GDS : " + esc(String(e)));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    return;
  }
  if (!repos || !repos.length) {
    renderState("Aucun dépôt enregistré sur le serveur GDS.");
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    return;
  }

  // Construire la liste des dépôts + deux actions par dépôt.
  dlg.innerHTML = `
    <div class="gds-menu-title"><i data-lucide="git-branch" class="icon-sm"></i> Ajouter un projet depuis le GDS</div>
    <div class="gds-menu-sub">Choisissez un dépôt du GDS à ouvrir localement (${esc(String(repos.length))} dépôt(s)).</div>
    <div class="gds-menu-list" id="gds-menu-list"></div>
    <div class="gds-menu-actions"><button class="web-btn" data-act="close">Fermer</button></div>`;
  refreshIcons(overlay);
  dlg.querySelector('[data-act="close"]').addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  const listEl = dlg.querySelector("#gds-menu-list");
  refreshIcons(listEl);

  for (const r of repos || []) {
    const name = esc(r.name || r.path_on_server || r.bare_path || "");
    const localExists = !!r.local_exists;
    const item = document.createElement("div");
    item.className = "gds-menu-item";
    item.innerHTML = `
      <div class="gds-menu-item-name">${name}
        ${localExists
          ? ' <span class="gds-chip">déjà en local</span>'
          : ""}
      </div>
      <div class="gds-menu-item-actions">
        <button class="web-btn" data-act="clone">
          <i data-lucide="copy-plus" class="icon-sm"></i> Ouvrir un nouveau projet en local
        </button>
        <button class="web-btn" data-act="open" ${localExists ? "" : "disabled"}
          title="${localExists ? "" : "Aucun clonage local : utilisez « Ouvrir un nouveau projet en local » pour cloner le dépôt."}">
          <i data-lucide="folder-open" class="icon-sm"></i> Ouvrir normalement un déjà en local
        </button>
      </div>`;
    listEl.appendChild(item);
    refreshIcons(item);

    // Action a) — cloner en local → ouvrir → connecter au GDS.
    item.querySelector('[data-act="clone"]').addEventListener("click", async () => {
      close();
      showLoading("Clonage du dépôt " + r.name + " depuis le GDS…");
      try {
        const res = await invoke("gds_clone_repo", { project, repoName: r.name });
        hideLoading();
        await sidebar.openProjectByPath(res.path);
        toastSuccess("Projet ajouté depuis le GDS : " + r.name);
      } catch (e) {
        hideLoading();
        toastError("Échec de l'ajout depuis le GDS : " + String(e));
      }
    });

    // Action b) — ouvrir le clonage local existant + proposer une synchro auto.
    item.querySelector('[data-act="open"]').addEventListener("click", async () => {
      if (!r.local_exists || !r.local_path) return;
      close();
      try {
        await sidebar.openProjectByPath(r.local_path);
      } catch (e) {
        toastError("Erreur à l'ouverture du projet local : " + String(e));
        return;
      }
      // Proposer une synchronisation automatique depuis le remote `gds`.
      try {
        await invoke("gds_sync_project", { project: r.local_path });
        toastSuccess("Projet local synchronisé avec le GDS : " + r.name);
      } catch (e) {
        toastError("Projet ouvert. Synchronisation GDS : " + String(e));
      }
    });
  }
}
