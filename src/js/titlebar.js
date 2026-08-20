// titlebar.js — Barre de titres personnalisée (issue #74).
//
// Remplace la barre de titres native (tauri.conf.json : decorations: false).
// Gère les contrôles fenêtre (réduire / agrandir-restaurer / fermer), la
// bascule de l'icône agrandir↔restaurer selon l'état de maximisation, et
// l'affichage du nom du projet actif dans la barre.
//
// Le glissement de la fenêtre est assuré par l'attribut data-tauri-drag-region
// présent sur la barre (permission core:window:allow-start-dragging, incluse
// dans core:default).

import { getCurrentWindow } from "@tauri-apps/api/window";

export function initTitlebar() {
  const win = getCurrentWindow();
  const btnMin = document.getElementById("tb-minimize");
  const btnMax = document.getElementById("tb-maximize");
  const btnClose = document.getElementById("tb-close");
  const maxIcon = document.getElementById("tb-max-icon");
  const restoreIcon = document.getElementById("tb-restore-icon");

  // Bascule l'icône agrandir (carré) ↔ restaurer (deux carrés) selon l'état.
  const updateMaxIcon = async () => {
    try {
      const maximized = await win.isMaximized();
      if (maxIcon) maxIcon.classList.toggle("hidden", maximized);
      if (restoreIcon) restoreIcon.classList.toggle("hidden", !maximized);
      if (btnMax) btnMax.title = maximized ? "Restaurer" : "Agrandir";
    } catch (_) {
      // Fenêtre indisponible (ex: web) → ignorer
    }
  };

  if (btnMin) btnMin.addEventListener("click", () => win.minimize());
  if (btnMax) btnMax.addEventListener("click", async () => {
    try {
      const maximized = await win.isMaximized();
      if (maximized) await win.unmaximize();
      else await win.maximize();
    } catch (_) {}
  });
  if (btnClose) btnClose.addEventListener("click", () => win.close());

  // Mettre à jour l'icône quand la fenêtre est agrandie/restaurée.
  win.onResized(updateMaxIcon);
  updateMaxIcon();

  // Afficher le nom du projet actif dans la barre de titres. Le backend met
  // aussi à jour le titre natif (set_window_title) pour la barre des tâches.
  const projectEl = document.getElementById("tb-project");
  const updateProject = () => {
    if (!projectEl) return;
    const path = window._pilotProjectPath;
    if (path) {
      projectEl.textContent = path.replace(/\\/g, "/").split("/").pop() || path;
      projectEl.classList.remove("hidden");
    } else {
      projectEl.classList.add("hidden");
    }
  };
  updateProject();
  // L'événement pilot-project-sensitivity est émis à l'ouverture/fermeture d'un
  // projet (sidebar.js) — on s'en sert comme signal de changement de projet.
  document.addEventListener("pilot-project-sensitivity", updateProject);
}
