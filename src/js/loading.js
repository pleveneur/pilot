// loading.js — Indicateur de chargement global (spinner + curseur sablier)
// Usage: import { showLoading, hideLoading } from "./loading.js";
//        showLoading("Chargement du projet…");
//        // ... opération async ...
//        hideLoading();

let loadingCount = 0;
let loadingOverlay = null;

/**
 * Affiche l'indicateur de chargement.
 * Peut être appelé plusieurs fois (pile compteur) ; hideLoading() décrémente.
 * @param {string} [message] - Message optionnel à afficher sous le spinner
 */
export function showLoading(message = "") {
  loadingCount++;
  if (loadingCount === 1) {
    // Premier appel : afficher l'overlay et changer le curseur
    document.body.classList.add("pilot-loading");
    loadingOverlay = document.getElementById("loading-overlay");
    if (loadingOverlay) {
      const msgEl = loadingOverlay.querySelector(".loading-message");
      if (msgEl) msgEl.textContent = message;
      loadingOverlay.classList.remove("hidden");
    }
  } else if (loadingOverlay) {
    // Appels suivants : mettre à jour le message si fourni
    const msgEl = loadingOverlay.querySelector(".loading-message");
    if (msgEl && message) msgEl.textContent = message;
  }
}

/**
 * Masque l'indicateur de chargement (si compteur revient à 0).
 */
export function hideLoading() {
  if (loadingCount > 0) loadingCount--;
  if (loadingCount === 0) {
    document.body.classList.remove("pilot-loading");
    loadingOverlay = document.getElementById("loading-overlay");
    if (loadingOverlay) {
      loadingOverlay.classList.add("hidden");
      const msgEl = loadingOverlay.querySelector(".loading-message");
      if (msgEl) msgEl.textContent = "";
    }
  }
}

/**
 * Force la fermeture de l'indicateur (réinitialise le compteur).
 * À utiliser en cas d'erreur ou de nettoyage.
 */
export function resetLoading() {
  loadingCount = 0;
  document.body.classList.remove("pilot-loading");
  loadingOverlay = document.getElementById("loading-overlay");
  if (loadingOverlay) {
    loadingOverlay.classList.add("hidden");
    const msgEl = loadingOverlay.querySelector(".loading-message");
    if (msgEl) msgEl.textContent = "";
  }
}