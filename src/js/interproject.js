// interproject.js — Discussion inter-projets (issue #15).
// Modal permettant de lier le projet courant à d'autres projets ouverts, puis de
// déposer une tâche/analyse vers un projet lié (dont l'agent est lancé pour la traiter).

import { invoke } from "@tauri-apps/api/core";
import { refreshIcons } from "./icons.js";
import { toastSuccess, toastError } from "./toast.js";
import { animateModalOpen } from "./modal-anim.js";

let modal, linksEl, openListEl, targetSel, contentEl, resultEl;

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function nameOf(p) {
  return p.replace(/\\/g, "/").split("/").pop() || p;
}

export function initInterproject() {
  modal = document.getElementById("interproject-modal");
  linksEl = document.getElementById("interproject-links");
  openListEl = document.getElementById("interproject-open-list");
  targetSel = document.getElementById("interproject-target");
  contentEl = document.getElementById("interproject-content");
  resultEl = document.getElementById("interproject-result");

  document.getElementById("btn-interproject").addEventListener("click", (e) => openModal(e.clientX, e.clientY));
  document.getElementById("interproject-close").addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
  document.getElementById("btn-interproject-send").addEventListener("click", sendHandoff);
}

function currentProject() {
  return window._pilotProjectPath || "";
}

async function openModal(clickX, clickY) {
  resultEl.textContent = "";
  contentEl.value = "";
  modal.classList.remove("hidden");
  animateModalOpen(modal, clickX, clickY);
  await render();
}

function closeModal() {
  modal.classList.add("hidden");
}

async function render() {
  const current = currentProject();
  let open = [];
  try {
    open = (await invoke("list_open_projects")) || [];
  } catch (_) {}
  let links = [];
  try {
    links = (await invoke("get_project_links", { project: current })) || [];
  } catch (_) {}
  const linkSet = new Set(links);

  // Projets liés
  linksEl.innerHTML = "";
  if (links.length === 0) {
    linksEl.innerHTML =
      '<div class="muted" style="font-size:12px">Aucun projet lié. Sélectionne des projets ci-dessous pour les lier.</div>';
  } else {
    for (const l of links) {
      const row = document.createElement("div");
      row.className = "interproject-link-row";
      row.innerHTML =
        `<span class="interproject-link-name" title="${esc(l)}">${esc(nameOf(l))}</span>` +
        `<button class="interproject-unlink" data-path="${esc(l)}" title="Retirer ce lien">✕</button>`;
      row.querySelector(".interproject-unlink").addEventListener("click", () => unlink(l));
      linksEl.appendChild(row);
    }
  }

  // Projets ouverts liables (tous sauf le courant et déjà liés)
  openListEl.innerHTML = "";
  const candidates = open.filter((p) => p !== current && !linkSet.has(p));
  if (candidates.length === 0) {
    openListEl.innerHTML =
      '<div class="muted" style="font-size:12px">Aucun autre projet ouvert à lier.</div>';
  } else {
    for (const p of candidates) {
      const row = document.createElement("div");
      row.className = "interproject-open-row";
      row.innerHTML =
        `<span class="interproject-link-name" title="${esc(p)}">${esc(nameOf(p))}</span>` +
        `<button class="interproject-link-btn" data-path="${esc(p)}">Lier</button>`;
      row.querySelector(".interproject-link-btn").addEventListener("click", () => link(p));
      openListEl.appendChild(row);
    }
  }

  // Selecteur de cible pour l'envoi de tâche
  targetSel.innerHTML = "";
  if (links.length === 0) {
    targetSel.innerHTML = "<option value=''>Aucun projet lié — lie d'abord un projet</option>";
  } else {
    for (const l of links) {
      const opt = document.createElement("option");
      opt.value = l;
      opt.textContent = nameOf(l);
      targetSel.appendChild(opt);
    }
  }
  refreshIcons(linksEl);
}

async function link(path) {
  const current = currentProject();
  try {
    const links = (await invoke("get_project_links", { project: current })) || [];
    if (!links.includes(path)) links.push(path);
    await invoke("set_project_links", { project: current, links });
    toastSuccess("Projet lié : " + nameOf(path));
    await render();
  } catch (e) {
    toastError("Liaison impossible : " + e);
  }
}

async function unlink(path) {
  const current = currentProject();
  try {
    await invoke("remove_project_link", { project: current, linked: path });
    toastSuccess("Lien retiré : " + nameOf(path));
    await render();
  } catch (e) {
    toastError("Retrait du lien impossible : " + e);
  }
}

async function sendHandoff() {
  const current = currentProject();
  const target = targetSel.value;
  const content = contentEl.value.trim();
  if (!target) {
    toastError("Choisis d'abord un projet cible lié.");
    return;
  }
  if (!content) {
    toastError("La tâche/analyse est vide.");
    return;
  }
  resultEl.textContent = "Dépôt en cours…";
  try {
    const res = await invoke("interproject_handoff", {
      source: current,
      target,
      content,
    });
    toastSuccess("Tâche déposée dans " + res.target_name + " — son agent a été lancé pour la traiter.");
    resultEl.textContent =
      "Tâche déposée dans « " +
      res.target_name +
      " » et son agent a été lancé. Fichier : " +
      res.handoff_path;
    contentEl.value = "";
  } catch (e) {
    toastError("Échec du dépôt : " + e);
    resultEl.textContent = "Échec : " + e;
  }
}
