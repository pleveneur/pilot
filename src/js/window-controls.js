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
//
// LOT 0.5 (docs/proposition-barre-fenetre.md §8.2) : le CLIC DROIT sur le
// bouton « Agrandir » ouvre un menu « Disposer » a trois entrees — moitie
// gauche de l'ecran, moitie droite, plein ecran. C'est le remplacement du
// geste d'agencement de Windows 11, que WebView2 intercepte (Tauri #4531).
// Le clic GAUCHE sur ce bouton n'est pas touche : il agrandit / restaure
// exactement comme avant.

import { getCurrentWindow, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
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

// --- LOT 0.5 : menu « Disposer » -----------------------------------------

// Identifiant du menu (unique dans le document : il est cree a la demande et
// jamais duplique).
export const DISPOSE_MENU_ID = "dispose-menu";

// Les trois zones, dans l'ordre d'affichage du menu.
export const DISPOSE_ZONES = ["left", "right", "full"];

// Libelles EXACTS des trois entrees, tels qu'ils sont annonces et lus.
export const DISPOSE_LABELS = {
  left: "Moitié gauche de l'écran",
  right: "Moitié droite de l'écran",
  full: "Plein écran",
};

// Infobulle de chaque entree : elle dit le geste exact, sans ambiguite. Le
// plein ecran est un AGRANDISSEMENT de la fenetre sur toute la zone utile de
// son ecran (Pilot n'a aucun etat plein ecran : F11 est le mode Zen, voir
// §3.2 du document — le libelle du bouton du milieu ne dit jamais « Plein
// ecran », cette entree de menu, elle, repond a la demande du proprietaire).
export const DISPOSE_HINTS = {
  left: "Placer la fenêtre sur la moitié gauche de l'écran",
  right: "Placer la fenêtre sur la moitié droite de l'écran",
  full: "Agrandir la fenêtre sur tout l'écran",
};

/**
 * Position et taille visees pour une zone, a partir de la ZONE UTILE d'un
 * ecran (celle qui exclut la barre des taches). Fonction PURE : aucun acces au
 * DOM, aucun appel systeme — donc verifiable sans fenetre.
 *
 * Les deux moities partagent exactement la largeur : `floor` sur la moitie
 * gauche et le reste sur la droite, sans trou ni recouvrement, y compris sur
 * une largeur impaire. Le plein ecran n'a pas de rectangle ici : il passe par
 * l'agrandissement de la fenetre (voir applyDisposeZone).
 *
 * @param {"left"|"right"|"full"} zone
 * @param {{position:{x:number,y:number}, size:{width:number,height:number}}|null} area
 * @returns {{x:number,y:number,width:number,height:number}|null}
 */
export function computeDisposeTarget(zone, area) {
  if (!area || !area.position || !area.size) return null;
  const x = Math.round(area.position.x);
  const y = Math.round(area.position.y);
  const largeur = Math.floor(area.size.width);
  const hauteur = Math.floor(area.size.height);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (!(largeur > 0) || !(hauteur > 0)) return null;
  const moitie = Math.floor(largeur / 2);
  if (zone === "left") return { x, y, width: moitie, height: hauteur };
  if (zone === "right") return { x: x + moitie, y, width: largeur - moitie, height: hauteur };
  return null;
}

// Le menu n'est cree qu'une fois, au premier clic droit.
let disposeMenu = null;

/** true si le menu « Disposer » est ouvert. */
export function isDisposeMenuOpen() {
  return !!(disposeMenu && disposeMenu.isConnected && !disposeMenu.classList.contains("hidden"));
}

/** Hauteur reelle de la bande de fenetre (repli : sa valeur de reference). */
function bandHeight() {
  const bar = document.getElementById("window-bar");
  return (bar && bar.offsetHeight) || 32;
}

/**
 * Construit (une seule fois) le menu « Disposer » et l'ajoute au document.
 * Il reprend l'apparence des menus contextuels existants (`context-menu`), donc
 * il suit les jetons de surface : identique en theme sombre et en theme clair.
 * La seule regle propre au menu (vivre AU-DESSUS de la bande de fenetre) est
 * dans src/css/style.css.
 * @param {object} win — fenetre courante (getCurrentWindow())
 */
function ensureDisposeMenu(win) {
  if (disposeMenu && disposeMenu.isConnected) return disposeMenu;
  const menu = document.createElement("div");
  menu.id = DISPOSE_MENU_ID;
  menu.className = "context-menu hidden";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Disposer la fenêtre");
  for (const zone of DISPOSE_ZONES) {
    const entree = document.createElement("button");
    entree.type = "button";
    entree.className = "dispose-entry";
    entree.dataset.zone = zone;
    entree.setAttribute("role", "menuitem");
    entree.title = DISPOSE_HINTS[zone];
    entree.textContent = DISPOSE_LABELS[zone];
    entree.addEventListener("click", () => {
      // Fermer AVANT d'agir : le menu ne doit pas rester ouvert pendant que la
      // fenetre se deplace sous lui.
      closeDisposeMenu();
      applyDisposeZone(win, zone);
    });
    menu.appendChild(entree);
  }
  document.body.appendChild(menu);
  disposeMenu = menu;
  return menu;
}

/**
 * Ouvre le menu a la position du clic, en le gardant entierement visible et
 * SOUS la bande de fenetre (jamais derriere elle, jamais hors de l'ecran).
 * @param {object} win
 * @param {number} x — clientX du clic droit
 * @param {number} y — clientY du clic droit
 */
export function openDisposeMenu(win, x, y) {
  const menu = ensureDisposeMenu(win);
  // Affichage avant mesure : la taille du menu n'existe qu'une fois visible.
  menu.classList.remove("hidden");
  const largeur = menu.offsetWidth || 0;
  const hauteur = menu.offsetHeight || 0;
  const marge = 8;
  const hautMini = bandHeight() + marge;
  const maxX = Math.max(marge, window.innerWidth - largeur - marge);
  const maxY = Math.max(hautMini, window.innerHeight - hauteur - marge);
  menu.style.left = Math.min(Math.max(marge, x), maxX) + "px";
  menu.style.top = Math.min(Math.max(hautMini, y), maxY) + "px";
  return menu;
}

/** Ferme le menu « Disposer ». Sans effet s'il n'est pas ouvert. */
export function closeDisposeMenu() {
  if (disposeMenu) disposeMenu.classList.add("hidden");
}

/** Zone utile de l'ecran qui porte la fenetre. Fail-open : null si illisible. */
async function readWorkArea(win) {
  try {
    const moniteur = await win.currentMonitor();
    if (!moniteur) return null;
    const zone = moniteur.workArea || moniteur;
    if (!zone || !zone.position || !zone.size) return null;
    return { position: { x: zone.position.x, y: zone.position.y }, size: { width: zone.size.width, height: zone.size.height } };
  } catch (e) {
    console.warn("[window-controls] currentMonitor indisponible :", e);
    return null;
  }
}

/**
 * Place la fenetre dans la zone demandee.
 *
 * - « left » / « right » : la fenetre est d'abord RESTAUREE si elle est
 *   agrandie (une fenetre agrandie ignore position et taille), puis placee et
 *   dimensionnee sur la moitie de la ZONE UTILE de son ecran — donc au-dessus
 *   de la barre des taches, sur l'ecran ou elle se trouve deja.
 * - « full » : agrandissement sur toute la zone utile. Rien n'est force deux
 *   fois (si la fenetre est deja agrandie, on ne la restaure pas).
 *
 * Aucune exception ne remonte : un echec est journalise, jamais fatal.
 * @param {object} win
 * @param {"left"|"right"|"full"} zone
 * @returns {Promise<boolean>} true si la fenetre a ete placee
 */
export async function applyDisposeZone(win, zone) {
  if (zone === "full") {
    if (await readMaximized(win)) return true;
    await toggleMaximize(win);
    return true;
  }
  const cible = computeDisposeTarget(zone, await readWorkArea(win));
  if (!cible) {
    console.warn("[window-controls] zone utile de l'ecran illisible, disposition ignoree :", zone);
    return false;
  }
  try {
    if (await readMaximized(win)) await toggleMaximize(win);
    await win.setPosition(new PhysicalPosition(cible.x, cible.y));
    await win.setSize(new PhysicalSize(cible.width, cible.height));
    await syncMaxButton(win);
    return true;
  } catch (e) {
    console.warn("[window-controls] disposition de la fenetre impossible :", e);
    return false;
  }
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
    // Clic GAUCHE : inchange depuis le lot 0.1 (agrandir / restaurer).
    btnMax.addEventListener("click", () => toggleMaximize(win));
    // LOT 0.5 : le menu « Disposer » ne s'ouvre QU'AU CLIC DROIT, sur ce
    // bouton et nulle part ailleurs.
    btnMax.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openDisposeMenu(win, e.clientX, e.clientY);
    });
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

  // LOT 0.5 : fermeture du menu — Echap, ou appui hors du menu (la bande et le
  // reste de l'interface compris). Les deux ecoutes sont posees une seule fois
  // et ne font rien tant que le menu est ferme.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !isDisposeMenuOpen()) return;
    e.stopPropagation();
    closeDisposeMenu();
  });
  document.addEventListener(
    "mousedown",
    (e) => {
      if (!isDisposeMenuOpen()) return;
      if (disposeMenu && !disposeMenu.contains(e.target)) closeDisposeMenu();
    },
    true,
  );
}
