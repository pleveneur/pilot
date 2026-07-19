// updater.js — Vérification automatique des mises à jour (Tauri v2 updater plugin)
//
// Au démarrage de Pilot, on interroge l'endpoint configuré dans
// tauri.conf.json (plugins.updater.endpoints). Si une mise à jour est
// disponible, on affiche une modale présentant le changelog (champ `notes`
// de latest.json, rendu en Markdown) et proposant de la télécharger et de
// l'installer. L'installation relance l'application automatiquement.
//
// L'utilisateur peut aussi déclencher une vérification manuelle via la
// commande « check-update » de la palette (voir main.js).

import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toastInfo, toastSuccess, toastError } from "./toast.js";
import { renderMarkdown } from "./preview.js";

let _checking = false;
let _pendingUpdate = null; // objet Update en attente d'installation

// ── Éléments DOM de la modale de mise à jour ──
let modalEl, versionEl, dateEl, notesEl;
let installBtn, laterBtn, closeBtn;
let progressEl, progressFillEl, progressLabelEl;
let _listenersBound = false;

/** Récupère (paresseusement) les éléments DOM et branche les handlers. */
function ensureModal() {
  if (_listenersBound) return modalEl;
  modalEl = document.getElementById("update-modal");
  if (!modalEl) return null;
  versionEl = document.getElementById("update-version");
  dateEl = document.getElementById("update-date");
  notesEl = document.getElementById("update-notes");
  installBtn = document.getElementById("btn-update-install");
  laterBtn = document.getElementById("btn-update-later");
  closeBtn = document.getElementById("update-close");
  progressEl = modalEl.querySelector(".update-progress");
  progressFillEl = document.getElementById("update-progress-fill");
  progressLabelEl = document.getElementById("update-progress-label");

  installBtn?.addEventListener("click", () => {
    if (_pendingUpdate) installUpdate(_pendingUpdate);
  });
  // « Plus tard » et ✕ ferment simplement la modale (la MAJ reste disponible
  // via la commande palette « check-update » jusqu'au prochain démarrage).
  laterBtn?.addEventListener("click", closeModal);
  closeBtn?.addEventListener("click", closeModal);
  modalEl.addEventListener("click", (e) => {
    if (e.target === modalEl) closeModal();
  });
  _listenersBound = true;
  return modalEl;
}

function closeModal() {
  modalEl?.classList.add("hidden");
}

/** Affiche la modale de mise à jour avec le changelog de la nouvelle version. */
function showUpdateModal(update) {
  if (!ensureModal()) {
    // Fallback : pas de DOM dispo (ne devrait pas arriver), on installe direct.
    installUpdate(update);
    return;
  }
  _pendingUpdate = update;

  versionEl.textContent = `v${update.version}`;
  const d = update.date ? new Date(update.date) : null;
  dateEl.textContent = d && !isNaN(d.getTime()) ? d.toLocaleDateString() : "";

  // Le champ `body` contient le `notes` de latest.json (Markdown GitHub).
  const body = update.body || update.notes || "";
  if (body.trim()) {
    notesEl.innerHTML = renderMarkdown(body);
    // Les liens du changelog pointent vers GitHub : on les ouvre dans le
    // navigateur externe (target=_blank) plutôt que dans la WebView.
    notesEl.querySelectorAll("a").forEach((a) => {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    });
  } else {
    notesEl.innerHTML = '<p class="muted">Aucune note de version fournie.</p>';
  }

  // Reset de l'état progression / boutons.
  progressEl.classList.add("hidden");
  progressFillEl.style.width = "0%";
  progressLabelEl.textContent = "Téléchargement…";
  installBtn.disabled = false;
  laterBtn.disabled = false;
  installBtn.classList.remove("hidden");
  laterBtn.classList.remove("hidden");

  modalEl.classList.remove("hidden");
}

/** Télécharge, installe puis relance l'application. */
async function installUpdate(update) {
  if (!ensureModal()) return;
  installBtn.disabled = true;
  laterBtn.disabled = true;
  progressEl.classList.remove("hidden");

  try {
    let contentLength = 0;
    let downloaded = 0;
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started":
          contentLength = event.data.contentLength ?? 0;
          downloaded = 0;
          progressLabelEl.textContent = "Téléchargement…";
          break;
        case "Progress": {
          downloaded += event.data.chunkLength ?? 0;
          if (contentLength > 0) {
            const pct = Math.min(100, Math.round((downloaded / contentLength) * 100));
            progressFillEl.style.width = pct + "%";
            progressLabelEl.textContent = `Téléchargement… ${pct}%`;
          }
          break;
        }
        case "Finished":
          progressFillEl.style.width = "100%";
          progressLabelEl.textContent = "Installation…";
          break;
      }
    });
    toastSuccess("Mise à jour téléchargée. Redémarrage…", 5000);
    await relaunch();
  } catch (e) {
    console.error("Erreur installation MAJ:", e);
    toastError("Échec de l'installation de la mise à jour.");
    // On permet un nouvel essai.
    installBtn.disabled = false;
    laterBtn.disabled = false;
    progressEl.classList.add("hidden");
  }
}

/**
 * Vérifie les mises à jour et, si disponible, affiche la modale de changelog.
 * @param {boolean} silent — si true, n'affiche rien quand aucune MAJ n'est disponible
 * @returns {Promise<void>}
 */
export async function checkForUpdate(silent = true) {
  if (_checking) return;
  _checking = true;
  try {
    const update = await check();
    if (update?.available) {
      showUpdateModal(update);
    } else if (!silent) {
      toastInfo("Pilot est à jour.", 4000);
    }
  } catch (e) {
    console.error("Erreur vérification MAJ:", e);
    if (!silent) {
      toastError("Impossible de vérifier les mises à jour.");
    }
  } finally {
    _checking = false;
  }
}

/**
 * Initialise la vérification automatique au démarrage.
 * Attend quelques secondes pour ne pas bloquer le démarrage de l'app.
 */
export function initUpdater() {
  // Vérification différée (10s) pour ne pas ralentir le démarrage.
  setTimeout(() => {
    checkForUpdate(true).catch(() => {});
  }, 10000);
}