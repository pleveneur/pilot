// theme.js — Gestion du thème clair/sombre

const THEME_STORAGE_KEY = "pilot-theme";

export function initTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  const theme = saved || "dark";
  applyTheme(theme);
}

export function applyTheme(theme) {
  document.body.classList.remove("theme-dark", "theme-light");
  document.body.classList.add(`theme-${theme}`);
  localStorage.setItem(THEME_STORAGE_KEY, theme);

  // Notifie CodeMirror si des éditeurs existent
  window.dispatchEvent(
    new CustomEvent("theme-changed", { detail: { theme } })
  );
}

export function getCurrentTheme() {
  if (document.body.classList.contains("theme-light")) return "light";
  return "dark";
}
