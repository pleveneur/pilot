// modal-anim.js — Animations d'ouverture « zoom depuis le point du clic »
//
// Méthode A : un panneau (modale ou contenu d'onglet) grandit depuis le point où
// l'utilisateur a cliqué jusqu'à sa taille finale, au lieu d'un simple pop-in.
// Implémentation via la Web Animations API (element.animate) : GPU-friendly
// (transform: scale + transform-origin au point du clic, pas de reflow) et fiable
// — la frame initiale minuscule est garantie d'être peinte.
//
// Accessibilité : le paramètre Pilot « modal_animations » force l'animation même
// sous prefers-reduced-motion. Par défaut (paramètre jamais configuré, ex. mise à
// jour d'une ancienne version), l'animation est ACTIVÉE. Elle n'est coupée que si
// l'utilisateur a explicitement désactivé le paramètre.

/**
 * Anime le `.modal-content` d'une modale depuis un point d'origine.
 * À appeler juste après avoir rendu la modale visible (retrait de `.hidden`).
 *
 * @param {HTMLElement} modalEl  L'élément `.modal` (overlay) contenant un `.modal-content`.
 * @param {number} [originX]     Coordonnée X du clic (viewport). Absent → centre.
 * @param {number} [originY]     Coordonnée Y du clic (viewport). Absent → centre.
 */
export function animateModalOpen(modalEl, originX, originY) {
  const content = modalEl && modalEl.querySelector(".modal-content");
  if (!content) return;
  // Neutralise le pop-in CSS par défaut (transform/opacity conflictuels).
  content.style.animation = "none";
  animatePanelOpen(content, originX, originY);
}

/**
 * Anime n'importe quel élément (panneau d'onglet, contenu…) depuis un point
 * d'origine. À appeler juste après avoir rendu l'élément visible.
 *
 * @param {HTMLElement} el       L'élément à animer.
 * @param {number} [originX]     Coordonnée X du clic (viewport). Absent → centre.
 * @param {number} [originY]     Coordonnée Y du clic (viewport). Absent → centre.
 */
export function animatePanelOpen(el, originX, originY) {
  if (!el) return;

  // Accessibilité : coupé uniquement si la réduction de mouvement est active ET
  // que l'utilisateur a explicitement désactivé le paramètre Pilot (défaut : ON).
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced && window._pilotModalAnimations === false) return;

  // Annule toute animation CSS résiduelle qui pourrait entrer en conflit.
  try { el.getAnimations().forEach((a) => a.cancel()); } catch (_) {}

  const rect = el.getBoundingClientRect();
  let ox, oy;
  if (typeof originX === "number" && typeof originY === "number") {
    // Clampe le point d'origine à l'intérieur de l'élément.
    ox = Math.max(0, Math.min(rect.width, originX - rect.left));
    oy = Math.max(0, Math.min(rect.height, originY - rect.top));
  } else {
    ox = rect.width / 2;
    oy = rect.height / 2;
  }

  const origin = `${ox}px ${oy}px`;
  const from = { transform: "scale(0.02)", opacity: 0, transformOrigin: origin };
  const to = { transform: "scale(1)", opacity: 1, transformOrigin: origin };

  if (typeof el.animate === "function") {
    const anim = el.animate([from, to], {
      duration: 420,
      easing: "cubic-bezier(0.18, 0.9, 0.28, 1.12)",
      fill: "forwards",
    });
    anim.onfinish = () => anim.cancel(); // rend le style naturel à la fin
  } else {
    // Fallback : transition inline si la Web Animations API est indisponible.
    el.style.transformOrigin = origin;
    el.style.transition =
      "transform 420ms cubic-bezier(0.18, 0.9, 0.28, 1.12), opacity 300ms ease";
    el.style.transform = from.transform;
    el.style.opacity = "0";
    void el.offsetWidth;
    requestAnimationFrame(() => {
      el.style.transform = "scale(1)";
      el.style.opacity = "1";
    });
  }
}
