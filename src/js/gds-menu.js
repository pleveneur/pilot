// gds-menu.js — Modale « Ajouter un projet depuis le GDS » (menu projet).
//
// Ouverte depuis le dropdown des projets (sidebar.js, entrée
// « Ajouter un projet depuis le GDS »), chargée à la demande (import()
// dynamique). Affiche la liste des dépôts du GDS et propose pour chacun une
// action MUTUELLEMENT EXCLUSIVE selon `r.local_exists` + `r.work_exists`
// (refonte « un seul dossier local par projet ») :
//   a) un PROJET DE TRAVAIL existe (`work_exists`) → « Connecter ce dossier au
//      GDS » (gds_connect_existing sur work_path) : jamais de clone d'un doublon.
//      Si un clone GDS redondant existe en parallèle (`local_exists`), un second
//      bouton propose de le supprimer gds_remove_dup_worktree (confirmation +
//      simulation/dry-run d'abord).
//   b) sinon un clone GDS unique existe (`local_exists`, sans travail) →
//      « Synchroniser » ce clone (dossier unique, fetch/pull sans écrasement).
//   c) sinon → « Ramener en local » : clone le dépôt (gds_clone_repo), l'ouvre et
//      le connecte au GDS.
// Jamais de clone par-dessus un worktree existant, jamais d'écrasement, aucune
// suppression destructive automatique (toujours confirm=true pour supprimer).
// Réutilise `gds_sync_project` / `gds_clone_repo` / `gds_connect_existing` /
// `gds_remove_dup_worktree` existants.
// Réutilise le look de l'écran GDS (classes gds-panel / gds-*) et les helpers
// globaux (toastSuccess/toastError, showLoading/hideLoading, refreshIcons).
// Entrée par le CHOIX DU SERVEUR : les fiches GDS enregistrées sur le poste
// alimentent une liste déroulante (`gdsServerChoices`) — un projet déjà ouvert
// n'est plus exigé. Aucune fiche utilisable → message clair (`gdsNoServerHint`),
// jamais de crash. Quand un projet ouvert est connecté, sa liste de dépôts
// s'affiche comme avant ; sinon la fenêtre s'arrête au choix du serveur.
// Aucun champ sensible n'entre dans la liste ni dans l'affichage.

import { invoke } from "@tauri-apps/api/core";
import { refreshIcons } from "./icons.js";
import { refreshExplorerAfterGds } from "./gds.js";
import { showLoading, hideLoading } from "./loading.js";
import { toastSuccess, toastError } from "./toast.js";

/** Échappe le HTML pour injection sûre dans innerHTML. */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

/**
 * Explication affichée quand aucune fiche serveur utilisable n'est enregistrée
 * sur le poste (pure, testable). Mots simples, aucune erreur brute à l'écran.
 */
export function gdsNoServerHint() {
  return (
    "Aucun serveur GDS utilisable n'est enregistré sur ce poste. " +
    "Ajoutez votre compte GDS dans l'onglet « ⚙️ GDS — paramétrage » → " +
    "« Serveurs GDS », puis testez la connexion de la fiche."
  );
}

/**
 * Choix de serveur GDS de la fenêtre « Ajouter un projet depuis le GDS »,
 * calculés depuis les fiches mémorisées du poste (`gds_list_saved_servers`).
 * Pure — testable séparément.
 *
 * Ne retient que les fiches RÉELLEMENT utilisables : compte GDS reconnu
 * (`identity`), fiche validée par un test de connexion réussi, et les trois
 * valeurs que la lecture du serveur exige (hôte, port du service, e-mail).
 * Une fiche incomplète ne produirait qu'un échec : elle est écartée, jamais
 * proposée.
 *
 * Chaque choix est REBÂTI champ par champ, jamais recopié de la fiche : seuls
 * le nom, l'e-mail, l'hôte et le port sortent d'ici — aucun mot de passe, clef
 * ni champ sensible ne peut donc être affiché par mégarde.
 *
 * @param {Array} servers fiches de `gds_list_saved_servers`
 * @returns {Array<{value: string, label: string, name: string, email: string, host: string, httpPort: string}>}
 */
export function gdsServerChoices(servers) {
  const out = [];
  for (const s of Array.isArray(servers) ? servers : []) {
    if (!s || s.validated === false || s.identity !== true) continue;
    const host = String(s.host || "").trim();
    const email = String(s.gds_email || "").trim();
    const httpPort = String(s.http_port || "").trim();
    if (!host || !email || !httpPort) continue;
    const name = String(s.name || "").trim();
    out.push({
      value: `${host}|${httpPort}|${email}`,
      label: `${name ? name + " — " : ""}${email} (${host}:${httpPort})`,
      name: name || host,
      email,
      host,
      httpPort,
    });
  }
  return out;
}

/**
 * Rend la liste déroulante des serveurs GDS de la fenêtre « Ajouter un projet
 * depuis le GDS ». Chaîne vide si aucun choix : la fenêtre affiche alors
 * `gdsNoServerHint()`. Pure — testable, aucun secret (mêmes libellés que ceux
 * validés par le propriétaire sur la fiche du serveur).
 */
export function gdsServerSelectorHtml(choices, selected = "") {
  const list = (Array.isArray(choices) ? choices : []).filter((c) => c && c.value);
  if (!list.length) return "";
  const current = list.some((c) => c.value === selected) ? selected : list[0].value;
  return `
    <div class="gds-menu-sub">Serveur GDS :
      <select id="gds-menu-server" class="gds-admin-select">
        ${list
          .map((c) => `<option value="${esc(c.value)}"${c.value === current ? " selected" : ""}>${esc(c.label)}</option>`)
          .join("")}
      </select>
    </div>`;
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

  const renderState = (html) => {
    dlg.innerHTML = `
      <div class="gds-menu-title"><i data-lucide="git-branch" class="icon-sm"></i> Ajouter un projet depuis le GDS</div>
      <div class="gds-menu-state">${html}</div>
      <div class="gds-menu-actions"><button class="web-btn" data-act="close">Fermer</button></div>`;
    refreshIcons(overlay);
    dlg.querySelector('[data-act="close"]').addEventListener("click", close);
  };
  const closeOnBackground = () =>
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  // Entrée de la fenêtre : le CHOIX DU SERVEUR, à partir des fiches GDS
  // enregistrées sur le poste — un projet déjà ouvert n'est plus exigé. Les
  // fiches inutilisables sont écartées et aucun champ sensible n'en sort (voir
  // `gdsServerChoices`).
  let servers = [];
  try {
    servers = await invoke("gds_list_saved_servers");
  } catch (_e) {
    servers = [];
  }
  const choices = gdsServerChoices(servers);
  if (!choices.length) {
    renderState(esc(gdsNoServerHint()));
    closeOnBackground();
    return;
  }
  const selectorHtml = gdsServerSelectorHtml(choices);

  // État GDS du projet ouvert, s'il y en a un : lui seul fournit encore la
  // liste des dépôts (un GDS non provisionné / non connecté ne peut pas la
  // lister : pool absent). Un GDS non connecté ne bloque plus la fenêtre, qui
  // sert désormais au choix du serveur.
  let status = "";
  if (project) {
    try {
      status = (await invoke("gds_connection_status", { project })).status || "";
    } catch (_e) {
      status = "";
    }
  }

  if (!project || status !== "connected") {
    // Aucun projet ouvert (ou projet non connecté au GDS) : la fenêtre reste
    // utile — on y choisit le serveur.
    dlg.innerHTML = `
      <div class="gds-menu-title"><i data-lucide="git-branch" class="icon-sm"></i> Ajouter un projet depuis le GDS</div>
      ${selectorHtml}
      <div class="gds-menu-state">Serveur GDS choisi. La liste des projets de ce serveur n'est pas encore affichée dans cette fenêtre.</div>
      <div class="gds-menu-actions"><button class="web-btn" data-act="close">Fermer</button></div>`;
    refreshIcons(overlay);
    dlg.querySelector('[data-act="close"]').addEventListener("click", close);
    closeOnBackground();
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
    ${selectorHtml}
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
    // Refonte « un seul dossier local par projet » : on regarde indépendamment
    // la présence du projet de travail (work_exists) et du clone GDS (local_exists).
    const hasLocal = !!r.local_exists;
    const hasWork = !!r.work_exists;
    const workPath = r.work_path || "";
    const localPath = r.local_path || "";

    // Actions MUTUELLEMENT EXCLUSIVES (refonte dossier-unique) :
    //  a) un PROJET DE TRAVAIL existe (`work_exists`) → « Connecter ce dossier au
    //     GDS » (gds_connect_existing sur workPath) : jamais de clone d'un doublon.
    //     Si un clone GDS REDONDANT existe en parallèle (`local_exists`), un second
    //     bouton propose de le supprimer avec confirmation (dry-run d'abord).
    //  b) sinon un clone GDS unique existe (`local_exists`, sans travail) →
    //     « Synchroniser » ce clone (dossier unique, fetch/pull sans écrasement).
    //  c) sinon → « Ramener en local » (clone = dossier unique, jamais par-dessus
    //     un dossier de travail).
    const actions = [
      {
        act: hasWork ? "connect" : hasLocal ? "sync" : "clone",
        label: hasWork ? "Connecter ce dossier au GDS" : hasLocal ? "Synchroniser" : "Ramener en local",
        icon: hasWork ? "link" : hasLocal ? "refresh-cw" : "download",
        title: hasWork
          ? "Le projet existe déjà comme projet de travail : connecter CE dossier au GDS (dossier unique, jamais de clone d'un doublon)."
          : hasLocal
            ? "Ouvrir le clonage local puis synchroniser depuis le remote gds (fetch/pull, sans écrasement)."
            : "Cloner le dépôt du GDS en local puis l'ouvrir comme projet (dossier unique).",
      },
    ];
    if (hasWork && hasLocal) {
      actions.push({
        act: "rmdup",
        label: "Supprimer la copie redondante",
        icon: "trash-2",
        title: "Un clone GDS redondant existe à côté du projet de travail : le supprimer (avec confirmation, jamais le dossier connecté ni le bare serveur).",
      });
    }
    const chip = hasWork
      ? ' <span class="gds-chip">projet de travail existant</span>'
      : hasLocal
        ? ' <span class="gds-chip">déjà en local</span>'
        : "";
    const item = document.createElement("div");
    item.className = "gds-menu-item";
    item.innerHTML = `
      <div class="gds-menu-item-name">${name}${chip}</div>
      <div class="gds-menu-item-actions">
        ${actions.map((a) => `<button class="web-btn" data-act="${a.act}" title="${esc(a.title)}"><i data-lucide="${a.icon}" class="icon-sm"></i> ${a.label}</button>`).join("")}
      </div>`;
    listEl.appendChild(item);
    refreshIcons(item);

    const btn = (act) => item.querySelector(`[data-act="${act}"]`);

    // Action CONNECT — connecter au GDS un dossier de travail existant (dossier
    // unique, jamais de clone), puis l'ouvrir.
    const connBtn = btn("connect");
    if (connBtn) {
      connBtn.addEventListener("click", async () => {
        if (!workPath) return;
        close();
        showLoading("Connexion du dossier au GDS…");
        try {
          const res = await invoke("gds_connect_existing", { project, targetDir: workPath });
          hideLoading();
          await sidebar.openProjectByPath(res.path || workPath);
          toastSuccess("Dossier connecté au GDS : " + r.name);
        } catch (e) {
          hideLoading();
          toastError("Échec de la connexion du dossier au GDS : " + String(e));
        }
      });
    }

    // Action SYNC — ouvrir le worktree local existant (le clone GDS unique) PUIS
    // synchroniser sans écrasement (fetch/pull depuis le remote `gds`).
    const syncBtn = btn("sync");
    if (syncBtn) {
      syncBtn.addEventListener("click", async () => {
        if (!localPath) return;
        close();
        try {
          await sidebar.openProjectByPath(localPath);
        } catch (e) {
          toastError("Erreur à l'ouverture du projet local : " + String(e));
          return;
        }
        try {
          await invoke("gds_sync_project", { project: localPath });
          // Le guetteur de fichiers ignore `.git` : sans ce rappel explicite,
          // l'explorateur (arborescence + marqueurs Git) reste figé après la
          // synchro. Même chemin que les autres gestes GDS, après succès seul.
          refreshExplorerAfterGds();
          toastSuccess("Projet synchronisé avec le GDS : " + r.name);
        } catch (e) {
          toastError("Projet ouvert. Synchronisation GDS : " + String(e));
        }
      });
    }

    // Action CLONE — ramener le dépôt en local (dossier unique), l'ouvrir, le connecter.
    const cloneBtn = btn("clone");
    if (cloneBtn) {
      cloneBtn.addEventListener("click", async () => {
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
    }

    // Action RMDUP — nettoyage du doublon (clone redondant) : on présente d'abord
    // la simulation (dry-run, confirm=false), puis sur confirmation de l'utilisateur
    // la suppression réelle (confirm=true). Ne touche JAMAIS au dossier connecté
    // (workPath) ni au bare serveur (le backend protège `<local_dir>/repos/`).
    const rmdupBtn = btn("rmdup");
    if (rmdupBtn) {
      rmdupBtn.addEventListener("click", async () => {
        const dupDir = localPath;
        const connectedDir = workPath;
        if (!dupDir || !connectedDir) return;
        showLoading("Vérification de la copie redondante…");
        let dry;
        try {
          dry = await invoke("gds_remove_dup_worktree", {
            project, dupDir, connectedDir, confirm: false,
          });
        } catch (e) {
          hideLoading();
          toastError("Impossible de vérifier : " + String(e));
          return;
        }
        hideLoading();
        const planned = (dry && dry.path) || dupDir;
        const ok = await window.confirm(
          "Supprimer la copie redondante « " + planned + " » ?\n\nLe dossier connecté et le dépôt serveur (bare) ne seront pas touchés."
        );
        if (!ok) return;
        showLoading("Suppression de la copie redondante…");
        try {
          const res = await invoke("gds_remove_dup_worktree", {
            project, dupDir, connectedDir, confirm: true,
          });
          hideLoading();
          if (res && res.removed) {
            toastSuccess("Copie redondante supprimée : " + r.name);
          } else {
            toastError("Aucune copie à supprimer (absente ou protégée).");
          }
        } catch (e) {
          hideLoading();
          toastError("Suppression impossible : " + String(e));
        }
      });
    }
  }
}
