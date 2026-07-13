// toast.js — Système de notifications non-bloquantes (toasts)

const TOAST_ICONS = {
  success: "✅",
  error: "❌",
  warning: "⚠️",
  info: "ℹ️",
};

const TOAST_DURATIONS = {
  success: 3000,
  error: 6000,
  warning: 4000,
  info: 3000,
};

let toastContainer = null;

/**
 * Initialise le conteneur de toasts (appelé une seule fois)
 */
export function initToasts() {
  toastContainer = document.getElementById("toast-container");
  if (!toastContainer) {
    toastContainer = document.createElement("div");
    toastContainer.id = "toast-container";
    document.body.appendChild(toastContainer);
  }
}

/**
 * Affiche un toast
 * @param {string} message - Texte du toast
 * @param {"success"|"error"|"warning"|"info"} type - Type de toast
 * @param {number} [duration] - Durée en ms (défaut selon le type)
 */
export function showToast(message, type = "info", duration) {
  if (!toastContainer) initToasts();

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  const icon = TOAST_ICONS[type] || TOAST_ICONS.info;
  const ms = duration ?? TOAST_DURATIONS[type] ?? 3000;

  toast.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-message">${escHtml(message)}</span><button class="toast-close" title="Fermer">✕</button>`;

  // Bouton fermer
  toast.querySelector(".toast-close").addEventListener("click", () => {
    dismissToast(toast);
  });

  toastContainer.appendChild(toast);

  // Animer l'apparition
  requestAnimationFrame(() => {
    toast.classList.add("toast-visible");
  });

  // Auto-dismiss
  const timer = setTimeout(() => {
    dismissToast(toast);
  }, ms);

  // Pause le timer au survol
  toast.addEventListener("mouseenter", () => clearTimeout(timer));
  toast.addEventListener("mouseleave", () => {
    setTimeout(() => dismissToast(toast), 1000);
  });

  return toast;
}

/**
 * Raccourcis pratiques
 */
export function toastSuccess(message) { return showToast(message, "success"); }
export function toastError(message) { return showToast(message, "error"); }
export function toastWarning(message) { return showToast(message, "warning"); }
export function toastInfo(message) { return showToast(message, "info"); }

/**
 * Affiche un toast persistant (pas d'auto-dismiss)
 */
export function toastPersistent(message, type = "error") {
  return showToast(message, type, null);
}

/** Ferme un toast avec animation */
function dismissToast(toast) {
  if (!toast || !toast.parentNode) return;
  toast.classList.remove("toast-visible");
  toast.classList.add("toast-dismiss");
  setTimeout(() => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 300);
}

/** Échapper le HTML */
function escHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}