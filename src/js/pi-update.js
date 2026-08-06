// pi-update.js — Détection et mise à jour de l'agent Pi (issue #26)
//
// À l'ouverture de l'onglet agent, si le backend est `pi` (pas `plh`) et que
// l'utilisateur n'a pas choisi « Ne plus demander », on vérifie si une nouvelle
// version de Pi est disponible (endpoint officiel pi.dev). Si oui, on affiche
// une modale proposant de la mettre à jour via la commande intégrée
// `pi update --self`. L'utilisateur peut choisir « Ne plus demander » (flag
// `pi_skip_update_check` persisté dans la config).

import { invoke } from "@tauri-apps/api/core";
import { toastSuccess, toastError, toastInfo } from "./toast.js";
import { getBackendInfoSync } from "./backend-info.js";

let _checking = false;
let _modalEl, _versionEl, _statusEl, _updateBtn, _laterBtn, _skipBtn, _closeBtn;
let _listenersBound = false;

function ensureModal() {
  if (_listenersBound) return _modalEl;
  _modalEl = document.getElementById("pi-update-modal");
  if (!_modalEl) return null;
  _versionEl = document.getElementById("pi-update-version");
  _statusEl = document.getElementById("pi-update-status");
  _updateBtn = document.getElementById("btn-pi-update-install");
  _laterBtn = document.getElementById("btn-pi-update-later");
  _skipBtn = document.getElementById("btn-pi-update-skip");
  _closeBtn = document.getElementById("pi-update-close");
  _updateBtn?.addEventListener("click", doUpdate);
  _laterBtn?.addEventListener("click", closeModal);
  _skipBtn?.addEventListener("click", skipForever);
  _closeBtn?.addEventListener("click", closeModal);
  _listenersBound = true;
  return _modalEl;
}

function closeModal() {
  if (_modalEl) _modalEl.classList.add("hidden");
}

async function doUpdate() {
  if (!_updateBtn) return;
  _updateBtn.disabled = true;
  _statusEl.textContent = "Mise à jour de Pi en cours…";
  try {
    const r = await invoke("update_pi");
    if (r.ok) {
      _statusEl.textContent = "Pi mis à jour avec succès.";
      toastSuccess("Pi mis à jour.");
      setTimeout(closeModal, 1500);
    } else {
      _statusEl.textContent = "La mise à jour a échoué. Réessaie plus tard.";
      toastError("Échec de la mise à jour de Pi.");
      _updateBtn.disabled = false;
    }
  } catch (e) {
    _statusEl.textContent = "Erreur lors de la mise à jour.";
    toastError("Erreur mise à jour Pi : " + e);
    _updateBtn.disabled = false;
  }
}

async function skipForever() {
  try {
    const cfg = await invoke("get_config");
    cfg.pi_skip_update_check = true;
    await invoke("save_config", { config: cfg });
    toastInfo("Vérification des mises à jour de Pi désactivée.");
  } catch (_) { /* silencieux */ }
  closeModal();
}

/**
 * Vérifie si une mise à jour de Pi est disponible et, le cas échéant, affiche
 * la modale de proposition. À appeler à l'ouverture de l'onglet agent.
 * Ne fait rien si : backend non `pi`, « Ne plus demander » activé, ou déjà en
 * cours de vérification.
 */
export async function checkPiUpdate() {
  if (_checking) return;
  // Uniquement pour le backend `pi` (pas `plh`).
  const info = getBackendInfoSync();
  if (!info || info.kind !== "pi") return;
  // Ne pas demander si l'utilisateur a choisi « Ne plus demander ».
  try {
    const cfg = await invoke("get_config");
    if (cfg.pi_skip_update_check) return;
  } catch (_) { /* silencieux */ }
  _checking = true;
  try {
    const r = await invoke("check_pi_update");
    if (r.update_available) {
      const modal = ensureModal();
      if (!modal) return;
      _versionEl.textContent = `${r.current} → ${r.latest}`;
      _statusEl.textContent = "";
      _updateBtn.disabled = false;
      modal.classList.remove("hidden");
    }
  } catch (e) {
    console.warn("check_pi_update:", e);
  } finally {
    _checking = false;
  }
}
