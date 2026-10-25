// window-controls.js — Bande de fenetre Pilot : gestes et boutons systeme.
//
// La bande remplace la barre de titre systeme (Windows et Linux) : elle est une
// zone de glissement, son double-clic agrandit/restaure, et trois boutons
// collent au bord droit (reduire, agrandir/restaurer, fermer). Reference :
// docs/proposition-barre-fenetre.md (§3.3 pour les gestes, §4.1 et §4.2 pour
// les etats — c'est le LOT 0.2).
//
// Ce que porte ce fichier pour le lot 0.2 :
//   - les LIBELLES des trois boutons (title + aria-label) : chacun est nomme
//     pour la lecture d'ecran ;
//   - la SYNCHRONISATION de l'icone « Agrandir / Restaurer » dans les DEUX
//     sens : etat lu AU DEMARRAGE (la fenetre demarre agrandie) puis relu a
//     CHAQUE redimensionnement ;
//   - le cablage des gestes (glisser, double-clic, les trois clics).
//
// Le FOCUS CLAVIER ne demande aucun code : les trois boutons sont de vrais
// <button type="button">, donc atteignables par Tab dans l'ordre du DOM et
// actives par Entree ou Espace. Aucun `tabindex` n'est pose (il retirerait les
// boutons de l'ordre naturel). L'anneau de focus est dessine par
// `:focus-visible` dans src/css/style.css.
//
// Fermer appelle `close()`, JAMAIS `destroy()` : la confirmation et le
// keep-alive cote Rust jouent normalement.

import { getCurrentWindow } from "@tauri-apps/api/window";
import { setIcon } from "./icons.js";

// Libelles EXACTS des trois boutons (memes chaines que index.html : le test
// barre-fenetre-etats.test.js verifie qu'ils ne divergent pas).
export const WINDOW_LABELS = {
  minimize: "Réduire",
  maximize: "Agrandir la fenêtre",
  restore: "Restaurer la fenêtre",
  close: "Fermer Pilot",
};

// Nom de l'icone Lucide du bouton du milieu selon l'etat de la fenetre.
export function maxButtonIcon(maximized) {
  return maximized ? "copy" : "square";
}

// Libelle (title ET aria-label) du bouton du milieu selon l'etat.
export function maxButtonLabel(maximized) {
  return maximized ? WINDOW_LABELS.restore : WINDOW_LABELS.maximize;
}

/**
 * Applique l'etat « agrandie » au bouton du milieu : icone, `title` et
 * `aria-label` — les trois suivent la MEME valeur, donc l'annonce de la lecture
 * d'ecran ne peut pas contredire l'icone.
 * @param {HTMLElement|null} btn — bouton #win-max.
 * @param {boolean} maximized — true si la fenetre est agrandie.
 */
export function applyMaximizedState(btn, maximized) {
  if (!btn) return;
  const label = maxButtonLabel(maximized);
  setIcon(btn, maxButtonIcon(maximized), { size: "icon-sm" });
  btn.title = label;
  btn.setAttribute("aria-label", label);
}

/** Lit l'etat « agrandie » de la fenetre. Fail-open : false en cas d'echec. */
async function readMaximized(win) {
  try {
    return !!(await win.isMaximized());
  } catch (e) {
    console.warn("[window-controls] isMaximized indisponible :", e);
    return false;
  }
}

/** Relit l'etat de la fenetre et met le bouton du milieu en accord. */
async function syncMaxButton(win) {
  const btn = document.getElementById("win-max");
  if (!btn) return;
  applyMaximizedState(btn, await readMaximized(win));
}

/** Agrandit ou restaure, puis remet l'icone en accord dans les deux sens. */
async function toggleMaximize(win) {
  try {
    await win.toggleMaximize();
  } catch (e) {
    console.warn("[window-controls] toggleMaximize indisponible :", e);
    return;
  }
  // Relecture immediate : l'evenement de redimensionnement peut arriver apres
  // le clic, l'icone ne doit jamais attendre.
  await syncMaxButton(win);
}

let initialized = false;

/**
 * Cable la bande de fenetre. Idempotent. Sans effet si la bande n'est pas dans
 * le DOM (aucune exception : la fonction est sans danger hors application).
 */
export function initWindowControls() {
  if (initialized) return;
  const bar = document.getElementById("window-bar");
  if (!bar) return;
  initialized = true;

  const win = getCurrentWindow();

  // Etat lu AU DEMARRAGE : la fenetre demarre agrandie (tauri.conf.json), donc
  // sans cette lecture le bouton annoncerait « Agrandir » sur une fenetre deja
  // agrandie et le premier clic la reduirait.
  syncMaxButton(win);

  // Etat relu a chaque redimensionnement : agrandir puis restaurer remet
  // l'icone juste dans les deux sens, y compris si la fenetre est agrandie par
  // un autre chemin (double-clic sur la bande, agencement du systeme).
  try {
    const suivi = win.onResized(() => {
      syncMaxButton(win);
    });
    // L'abonnement rend une promesse : un echec ne doit pas remonter en
    // rejet non traite (l'icone reste alors simplement sur son dernier etat).
    if (suivi && typeof suivi.catch === "function") suivi.catch(() => {});
  } catch (e) {
    console.warn("[window-controls] onResized indisponible :", e);
  }

  // Glisser : toute la bande SAUF les boutons (garde-fou unique).
  bar.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest("button")) return;
    try {
      win.startDragging();
    } catch (err) {
      console.warn("[window-controls] startDragging indisponible :", err);
    }
  });

  // Double-clic sur la bande SAUF les boutons : agrandir / restaurer.
  bar.addEventListener("dblclick", (e) => {
    if (e.target.closest("button")) return;
    toggleMaximize(win);
  });

  const btnMin = document.getElementById("win-min");
  const btnMax = document.getElementById("win-max");
  const btnClose = document.getElementById("win-close");

  if (btnMin) {
    btnMin.addEventListener("click", () => {
      try {
        win.minimize();
      } catch (e) {
        console.warn("[window-controls] minimize indisponible :", e);
      }
    });
  }
  if (btnMax) {
    btnMax.addEventListener("click", () => toggleMaximize(win));
  }
  if (btnClose) {
    btnClose.addEventListener("click", () => {
      // close() et non destroy() : la confirmation et le keep-alive de
      // src-tauri/src/lib.rs restent maitres de la fermeture.
      try {
        win.close();
      } catch (e) {
        console.warn("[window-controls] close indisponible :", e);
      }
    });
  }
}
