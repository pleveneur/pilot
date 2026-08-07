// theme.js — Gestion du thème clair/sombre + sous-thèmes

const THEME_STORAGE_KEY = "pilot-theme";
const SUBTHEME_STORAGE_KEY = "pilot-subtheme";

// Liste des sous-thèmes disponibles (id → libellé). Le sous-thème "default"
// correspond à la palette Pilot de base (aucune classe supplémentaire).
export const SUBTHEMES = {
  dark: [
    { id: "default", label: "Pilot (défaut)" },
    { id: "one-dark", label: "One Dark" },
    { id: "dracula", label: "Dracula" },
    { id: "nord", label: "Nord" },
    { id: "tokyo-night", label: "Tokyo Night" },
  ],
  light: [
    { id: "default", label: "Pilot (défaut)" },
    { id: "github", label: "GitHub Light" },
    { id: "one-light", label: "One Light" },
    { id: "solarized", label: "Solarized Light" },
    { id: "tokyo-day", label: "Tokyo Night Day" },
  ],
};

export function initTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  const theme = saved || "dark";
  const subtheme = localStorage.getItem(SUBTHEME_STORAGE_KEY) || "default";
  applyTheme(theme, subtheme);
}

export function applyTheme(theme, subtheme = "default") {
  // Retire toutes les classes theme-* (dark/light + sous-thèmes)
  document.body.classList.forEach((cls) => {
    if (cls.startsWith("theme-")) document.body.classList.remove(cls);
  });
  document.body.classList.add(`theme-${theme}`);
  if (subtheme && subtheme !== "default") {
    document.body.classList.add(`theme-${subtheme}`);
  }
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  localStorage.setItem(SUBTHEME_STORAGE_KEY, subtheme || "default");

  // Notifie CodeMirror si des éditeurs existent
  window.dispatchEvent(
    new CustomEvent("theme-changed", { detail: { theme, subtheme } })
  );
}

export function getCurrentTheme() {
  if (document.body.classList.contains("theme-light")) return "light";
  return "dark";
}

export function getCurrentSubtheme() {
  const saved = localStorage.getItem(SUBTHEME_STORAGE_KEY);
  return saved || "default";
}
