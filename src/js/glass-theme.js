// glass-theme.js — Le rafraîchissement des panneaux translucides au changement
// de thème.
//
// LE DÉFAUT CORRIGÉ : un panneau qui floute l'arrière-plan (`backdrop-filter`)
// est composé à part, et le moteur garde un INSTANTANÉ de ce qu'il y a derrière
// pour pouvoir le flouter. Changer de thème repeint la page, mais pas cet
// instantané : le panneau continuait donc d'afficher la teinte du thème
// PRÉCÉDENT, jusqu'au redémarrage.
//
// LA CORRECTION : au moment exact où `theme.js` émet `theme-changed` (source
// unique de l'évènement, importée ici — jamais recopiée), on retire le flou de
// ces surfaces le temps d'une image (`body.glass-refresh`, style.css) : le
// compositeur est obligé de RECAPTURER son arrière-plan avec les nouvelles
// couleurs, puis le flou revient de lui-même.
//
// CE QUE CE MODULE NE FAIT PAS : aucune couleur (la teinte vient des jetons
// `--glass-*` du thème actif), aucun réglage, aucun stockage, aucune préférence.
// Il ne touche ni au disque, ni au halo, ni au micro, ni aux sorties de l'écran
// Vocal. Il est FAIL-OPEN : sans corps de document, sans surface à rafraîchir ou
// sans `requestAnimationFrame`, il ne fait rien et ne lève jamais.
//
// Verrou : src/js/panneaux-translucides-theme.test.js

import { THEME_CHANGED_EVENT } from "./theme.js";

/** Classe posée sur `body` le temps d'une image (règle dans style.css). */
export const GLASS_REFRESH_CLASS = "glass-refresh";

/** Nombre d'images pendant lesquelles le flou reste retiré (2 = une repeinte). */
export const GLASS_REFRESH_FRAMES = 2;

/**
 * Les surfaces composées dont l'arrière-plan doit être recapturé.
 * Même liste que la règle `body.glass-refresh …` de style.css : un seul
 * endroit à tenir à jour est vérifié par le test.
 */
export const GLASS_SURFACE_SELECTOR = [
  ".modal",
  ".gds-menu-overlay",
  ".projects-dropdown",
  ".context-menu",
  "#agent-activity-dropdown",
].join(", ");

// Un seul cablage par fenêtre : deux appels n'empilent pas deux écouteurs.
const installedWindows = new WeakSet();

/**
 * Retire le flou des surfaces translucides pendant une image, puis le rend.
 * @returns {number} le nombre de surfaces traitées (0 = rien à faire).
 */
export function refreshGlassSurfaces(win, doc) {
  const body = doc && doc.body;
  if (!body || !body.classList) return 0;
  const surfaces =
    typeof body.querySelectorAll === "function"
      ? body.querySelectorAll(GLASS_SURFACE_SELECTOR)
      : [];
  // Rien de translucide à l'écran : on ne pose pas de classe, on ne planifie
  // rien. Aucun effet de bord quand la modale est fermée ou le panneau replié.
  if (!surfaces || surfaces.length === 0) return 0;

  body.classList.add(GLASS_REFRESH_CLASS);

  const schedule =
    typeof win.requestAnimationFrame === "function"
      ? (cb) => win.requestAnimationFrame(cb)
      : (cb) => win.setTimeout(cb, 16);

  let frame = 0;
  const step = () => {
    frame += 1;
    if (frame < GLASS_REFRESH_FRAMES) {
      schedule(step);
      return;
    }
    body.classList.remove(GLASS_REFRESH_CLASS);
  };
  schedule(step);

  return surfaces.length;
}

/**
 * Branche le rafraîchissement sur l'évènement de thème EXISTANT.
 * @returns {boolean} true au premier cablage, false ensuite.
 */
export function installGlassThemeRefresh(win, doc) {
  if (!win || typeof win.addEventListener !== "function") return false;
  if (installedWindows.has(win)) return false;
  installedWindows.add(win);
  win.addEventListener(THEME_CHANGED_EVENT, () => {
    refreshGlassSurfaces(win, doc);
  });
  return true;
}
