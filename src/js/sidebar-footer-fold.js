// sidebar-footer-fold.js — REPLI AU SURVOL des menus du bas de la colonne.
//
// LOT 1 du document `RAPPORT-conception-repli-menus-bas.md` (§ 2.2 a § 2.5). Le
// bloc accentue `#project-footer` est la MEME chose vue par une fente d'une ligne
// quand il est replie : aucun noeud n'est cree, aucun n'est detruit, aucun libelle
// ne change, aucun bouton et aucun reglage ne s'ajoutent.
//
// Regles tenues ICI, et nulle part ailleurs :
//   - l'ANCRE est le bas du cadre (`justify-content: flex-end` dans `style.css`) :
//     la ligne du bas ne bouge jamais, les autres sont decouvertes ou recouvertes
//     par la fente qui s'ouvre et se ferme VERS LE HAUT ;
//   - OUVERTURE : `pointerenter` deploye apres OUVERTURE_MS (100 ms) ; `focusin`
//     deploye tout de suite, SANS animation (l'anneau de focus doit etre peint
//     immediatement, sinon il est rogne) ;
//   - REPLI : seulement si les TROIS conditions sont reunies — la souris n'est plus
//     dessus, le focus n'est plus dedans, le menu « Autres outils » est ferme — et
//     apres GRACE_MS (300 ms) de sursis. Sortir de l'une des trois conditions
//     annule le sursis en cours ;
//   - ECHAP : le menu a la PRIORITE (aucun double emploi) ; menu ferme et focus
//     dans le bloc, le repli est immediat et le focus revient a la ligne visible ;
//   - MOUVEMENT REDUIT : convention EXISTANTE du projet (`modal-anim.js`), coupee
//     uniquement si le systeme demande une reduction ET que le reglage
//     `window._pilotModalAnimations` est explicitement a `false`. La decision est
//     AUSSI portee par la feuille de style (classe `no-motion` sur le cadre).
//     Les DELAIS sont conserves : ce sont des absorbeurs de gestes, pas du
//     mouvement ;
//   - TOUCHER (LOT 3, decision Q1) : le premier appui sur le bloc replie deploie
//     et ne fait rien d'autre (appui consomme) ; un appui hors du bloc deploye le
//     replie tout de suite. Le doigt ne SURVOLE pas : les deux evenements de survol
//     d'un pointeur tactile sont ignores, donc un bloc ouvert au doigt RESTE ouvert
//     (sinon il se refermerait 300 ms apres le premier appui, et le second appui —
//     celui qui doit agir — retomberait sur un bloc replie).
//
// Aucune dependance Tauri ni DOM au chargement : le module s'importe dans les
// tests (`environment: node`) sans navigateur.

/** Delai d'ouverture au survol : le jeton existant `--transition-fast` (0.1s). */
export const OUVERTURE_MS = 100;

/** Sursis avant repli : le jeton existant `--transition-smooth` (0.3s). */
export const GRACE_MS = 300;

/** Classe d'etat du cadre replie (`style.css` : `height: 50px; overflow: clip`). */
export const CLASSE_REPLIE = "pj-replie";

/**
 * Classe d'etat du MOUVEMENT REDUIT (`style.css` : `transition: none`).
 *
 * LOT 4 du document de conception (§ 4.3 et decision Q3 du proprietaire du
 * 2026-10-26). La decision reste prise en JS par `mouvementCoupe()` — c'est la
 * convention EXISTANTE du projet (`modal-anim.js`) — et la classe ne fait que
 * la rendre tenue par la feuille de style : si un chemin oubliait la decision,
 * l'animation ne pourrait pas demarrer malgre tout.
 */
export const CLASSE_SANS_MOUVEMENT = "no-motion";

/** Type d'appui qui declenche le deploiement au doigt (LOT 3, decision Q1). */
export const TYPE_APPUI_TACTILE = "touch";

/** Selecteur du cadre des menus du bas de la colonne. */
const SELECTEUR_CADRE = "#project-footer";

/** Selecteur du panneau qui porte les sept lignes. */
const SELECTEUR_PANNEAU = ".pj-panel";

/** Selecteur du panneau du menu « Autres outils ». */
const SELECTEUR_MENU = "#pj-more-menu";

/**
 * Hauteur DEPLIEE du cadre, en pixels, a partir de mesures deja lues.
 *
 * Le panneau n'est jamais comprime (`flex: 0 0 auto`) et le rognage n'existe que
 * dans la regle d'etat : sa hauteur mesuree est donc bien sa hauteur naturelle,
 * meme quand le cadre est replie. PURE (aucun acces au DOM) : elle est verifiee
 * directement par le test.
 *
 * @param {{panneau?: number, paddingTop?: number, paddingBottom?: number,
 *          borderTop?: number, borderBottom?: number}} mesures
 * @returns {number} hauteur du cadre deplie (0 si rien n'est mesurable)
 */
export function hauteurDeplieePx(mesures = {}) {
  const nombre = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  return (
    nombre(mesures.panneau) +
    nombre(mesures.paddingTop) +
    nombre(mesures.paddingBottom) +
    nombre(mesures.borderTop) +
    nombre(mesures.borderBottom)
  );
}

/**
 * Le cadre doit-il RESTER deplie ?
 *
 * Les trois conditions du § 2.3 : survol, focus dedans, menu ouvert. Tant qu'une
 * seule tient, le bloc ne se replie pas (et un sursis en cours est annule).
 *
 * @param {{survol?: boolean, focusDedans?: boolean, menuOuvert?: boolean}} etat
 * @returns {boolean}
 */
export function doitResterDeplie(etat) {
  if (!etat) return false;
  return Boolean(etat.survol || etat.focusDedans || etat.menuOuvert);
}

/**
 * Le mouvement doit-il etre coupe ?
 *
 * Convention EXISTANTE du projet (`modal-anim.js`) : la reduction de mouvement du
 * systeme ne suffit pas, il faut aussi que le reglage Pilot « Animer l'ouverture
 * des modales » soit explicitement desactive. Aucun second reglage n'est invente.
 *
 * @param {Window|Object} [win] fenetre (injectable dans les tests)
 * @returns {boolean}
 */
export function mouvementCoupe(win) {
  const w = win || {};
  const mm = w.matchMedia;
  if (typeof mm !== "function") return false;
  let requete = null;
  try {
    requete = mm.call(w, "(prefers-reduced-motion: reduce)");
  } catch (_) {
    return false;
  }
  const reduit = Boolean(requete && requete.matches);
  return reduit && w._pilotModalAnimations === false;
}

/**
 * Pose ou retire la classe de MOUVEMENT REDUIT sur le cadre.
 *
 * PURE au sens du module : aucune lecture du DOM, seulement la classe demandee.
 * Elle est posee SI ET SEULEMENT SI `mouvementCoupe()` est vrai (reduction
 * demandee par le systeme ET reglage « Animer l'ouverture des modales »
 * desactive). Les DELAIS du repli ne sont PAS touches : ce sont des absorbeurs
 * de gestes, pas du mouvement (§ 4.3).
 *
 * @param {HTMLElement} cadre
 * @param {boolean} coupe
 * @returns {boolean} etat pose
 */
export function appliquerSansMouvement(cadre, coupe) {
  if (!cadre || !cadre.classList) return false;
  if (coupe) cadre.classList.add(CLASSE_SANS_MOUVEMENT);
  else cadre.classList.remove(CLASSE_SANS_MOUVEMENT);
  return Boolean(coupe);
}

/**
 * L'evenement vient-il d'un pointeur TACTILE ? (LOT 3)
 *
 * On ne regarde que `pointerType` : un seul chemin, celui du reste de
 * l'application (§ 4.2), jamais `touchstart` en plus, jamais une media query
 * (qui decrirait la MACHINE et non le GESTE : un portable tactile a les deux).
 * Tous les evenements de pointeur portent `pointerType` : la reponse sert donc
 * aussi bien pour `pointerdown` (le seul chemin du doigt) que pour
 * `pointerenter` / `pointerleave` (qui, eux, ne concernent que la souris).
 *
 * @param {Object} evenement
 * @returns {boolean}
 */
export function estAppuiTactile(evenement) {
  return Boolean(evenement && evenement.pointerType === TYPE_APPUI_TACTILE);
}

/**
 * Mesure la hauteur DEPLIEE du cadre sur le document (paddings et bordures lus
 * par `getComputedStyle`, jamais ecrits en dur).
 *
 * @param {HTMLElement} cadre
 * @param {HTMLElement} panneau
 * @param {Window|Object} [win]
 * @returns {number} pixels, 0 si non mesurable
 */
export function mesurerHauteurDepliee(cadre, panneau, win) {
  if (!cadre || !panneau) return 0;
  const w = win || {};
  let styles = null;
  try {
    styles = typeof w.getComputedStyle === "function" ? w.getComputedStyle(cadre) : null;
  } catch (_) {
    styles = null;
  }
  const lire = (nom) => {
    const v = styles ? styles[nom] : undefined;
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  return hauteurDeplieePx({
    panneau: panneau.offsetHeight || 0,
    paddingTop: lire("paddingTop"),
    paddingBottom: lire("paddingBottom"),
    borderTop: lire("borderTopWidth"),
    borderBottom: lire("borderBottomWidth"),
  });
}

/**
 * Branche le repli et le deploiement du bloc du bas.
 *
 * @param {Object} [options]
 * @param {Document} [options.document] document (injectable)
 * @param {Window} [options.window] fenetre (injectable)
 * @param {Function} [options.fermerMenuAutresEcrans] fermeture du menu « Autres
 *   ecrans » fournie par `Sidebar._initProjectFooterMenu` (§ 5.4) : elle est
 *   appelee AVANT de rogner, par precaution ; l'etat du bloc interdit deja le
 *   repli tant que le menu est ouvert.
 * @returns {{detruire: Function, etat: Function}} poignee de demontage + lecture
 *   de l'etat courant (survol, focus, menu, replie)
 */
export function initRepliMenusBas(options = {}) {
  const doc = options.document || (typeof document !== "undefined" ? document : null);
  const win = options.window || (typeof window !== "undefined" ? window : null);
  const rien = { detruire() {}, etat: () => ({ replie: true }) };
  if (!doc || !win) return rien;

  const cadre = doc.querySelector(SELECTEUR_CADRE);
  const panneau = cadre ? cadre.querySelector(SELECTEUR_PANNEAU) : null;
  const menu = doc.querySelector(SELECTEUR_MENU);
  if (!cadre || !panneau) return rien;

  const fermerMenu =
    typeof options.fermerMenuAutresEcrans === "function"
      ? options.fermerMenuAutresEcrans
      : null;

  // Etat de DECISION. `replie` reflete la classe reellement posee sur le cadre.
  const etat = {
    survol: false,
    focusDedans: false,
    menuOuvert: false,
    replie: cadre.classList.contains(CLASSE_REPLIE),
  };

  let minuteurOuverture = null;
  let minuteurFermeture = null;
  let minuteurSecurite = null;
  // Un repli au clavier deplace le focus sur la ligne visible : ce `focusin` est
  // une CONSEQUENCE du repli, il ne doit donc pas le rouvrir.
  let focusImpose = false;

  const sansMouvement = () => mouvementCoupe(win);

  // MOUVEMENT REDUIT (LOT 4) : la classe du cadre suit la MEME decision que le
  // JS (`mouvementCoupe`). Elle est (re)posee a chaque decision et au changement
  // de preference du systeme, pour qu'un reglage bascule sans rechargement.
  const synchroniserMouvement = () => appliquerSansMouvement(cadre, sansMouvement());
  synchroniserMouvement();

  const menuEstOuvert = () => Boolean(menu && !menu.classList.contains("hidden"));

  const annulerOuverture = () => {
    if (minuteurOuverture !== null) {
      win.clearTimeout(minuteurOuverture);
      minuteurOuverture = null;
    }
  };
  const annulerFermeture = () => {
    if (minuteurFermeture !== null) {
      win.clearTimeout(minuteurFermeture);
      minuteurFermeture = null;
    }
  };
  const annulerSecurite = () => {
    if (minuteurSecurite !== null) {
      win.clearTimeout(minuteurSecurite);
      minuteurSecurite = null;
    }
  };

  /** Etat d'arrivee du deploiement : valeur en pixels retiree, classe retiree. */
  const finirDeploiement = () => {
    annulerSecurite();
    cadre.style.height = "";
    cadre.classList.remove(CLASSE_REPLIE);
    etat.replie = false;
  };

  /** Etat d'arrivee du repli : la regle d'etat impose la hauteur de 50 px. */
  const finirRepli = () => {
    annulerSecurite();
    cadre.style.height = "";
    cadre.classList.add(CLASSE_REPLIE);
    etat.replie = true;
    // Repli de securite du § 5.3 : `overflow: clip` n'est pas un conteneur de
    // defilement, mais si un moteur ajustait malgre tout le defilement, la ligne
    // d'ancrage disparaitrait. On force donc le haut du contenu.
    if (typeof cadre.scrollTop === "number") cadre.scrollTop = 0;
  };

  /**
   * Deploie le bloc.
   * @param {{immediat?: boolean}} [opt] `immediat` : sans animation (clavier,
   *   mouvement reduit, redimensionnement)
   */
  const deplier = (opt = {}) => {
    annulerOuverture();
    annulerFermeture();
    annulerSecurite();
    synchroniserMouvement();
    if (!etat.replie) {
      // Deja deplie : on s'assure seulement que la valeur en pixels ne traine pas.
      finirDeploiement();
      return;
    }
    const cible = mesurerHauteurDepliee(cadre, panneau, win);
    if (opt.immediat || sansMouvement() || !cible) {
      finirDeploiement();
      return;
    }
    // On part de la hauteur de la fente (50 px, portee par la classe) : `height`
    // est explicite des deux cotes, donc animable. La classe reste posee pendant
    // tout le mouvement (`overflow: clip`) : les lignes apparaissent au fur et a
    // mesure que la fente monte, elles ne sont pas montrees d'un coup.
    cadre.style.height = `${cible}px`;
    etat.replie = false;
    minuteurSecurite = win.setTimeout(finirDeploiement, GRACE_MS);
  };

  /**
   * Replie le bloc.
   * @param {{immediat?: boolean}} [opt] `immediat` : sans animation (Echap,
   *   mouvement reduit, redimensionnement)
   */
  const replier = (opt = {}) => {
    annulerOuverture();
    annulerFermeture();
    annulerSecurite();
    synchroniserMouvement();
    if (etat.replie) {
      finirRepli();
      return;
    }
    // Precaution du § 5.4 : jamais de rognage avec le menu ouvert (il serait
    // coupe). L'etat interdit deja ce cas ; on ferme donc par securite.
    if (menuEstOuvert() && fermerMenu) {
      try {
        fermerMenu();
      } catch (_) {
        /* la fermeture du menu ne doit jamais empecher le repli */
      }
      etat.menuOuvert = menuEstOuvert();
    }
    const depart = cadre.offsetHeight || 0;
    if (opt.immediat || sansMouvement() || !depart) {
      finirRepli();
      return;
    }
    cadre.style.height = `${depart}px`;
    // Force le calcul avant de changer la cible : la transition part de la
    // hauteur reelle, pas d'une valeur que le moteur n'a pas encore lue.
    void cadre.offsetHeight;
    cadre.classList.add(CLASSE_REPLIE);
    cadre.style.height = "";
    etat.replie = true;
    minuteurSecurite = win.setTimeout(finirRepli, GRACE_MS);
  };

  /** Arme le sursis de GRACE_MS, si rien ne retient le bloc deplie. */
  const planifierFermeture = () => {
    annulerFermeture();
    etat.menuOuvert = menuEstOuvert();
    if (doitResterDeplie(etat)) return;
    minuteurFermeture = win.setTimeout(() => {
      minuteurFermeture = null;
      etat.menuOuvert = menuEstOuvert();
      if (doitResterDeplie(etat)) return;
      replier();
    }, GRACE_MS);
  };

  /** Ligne visible du bloc replie : la derniere ligne non masquee. */
  const ligneVisible = () => {
    const lignes = [];
    const boutons = panneau.querySelectorAll("button");
    for (let i = 0; i < boutons.length; i += 1) {
      const b = boutons[i];
      if (!b.classList.contains("hidden") && !b.closest(".hidden")) lignes.push(b);
    }
    return lignes.length ? lignes[lignes.length - 1] : null;
  };

  // ── Souris ──────────────────────────────────────────────────────────────────
  // `pointerenter` / `pointerleave` ne bouillonnent pas : ecoute directe sur le
  // cadre, sans capture.
  //
  // Un DOIGT ne survole pas : ses deux evenements de survol sont ignores ici, le
  // seul chemin tactile etant `pointerdown` (§ surAppui). Sans cette porte, un
  // appui LONG ouvrirait par le survol apres OUVERTURE_MS, l'appui arriverait sur
  // un bloc deja deploye (donc non consomme) et le bouton sous le doigt agirait —
  // ce que la decision Q1 interdit.
  const surEntree = (e) => {
    if (estAppuiTactile(e)) return;
    etat.survol = true;
    annulerFermeture();
    if (!etat.replie) return;
    annulerOuverture();
    minuteurOuverture = win.setTimeout(() => {
      minuteurOuverture = null;
      // Un simple PASSAGE de souris (moins de 100 ms) n'ouvre donc pas le bloc.
      if (etat.survol || doitResterDeplie(etat)) deplier();
    }, OUVERTURE_MS);
  };

  const surSortie = (e) => {
    // Le doigt se LEVE : ce `pointerleave` suit immediatement le premier appui.
    // Armer ici le sursis refermerait le panneau GRACE_MS apres le deploiement au
    // doigt, et le second appui (celui qui doit agir, Q1) retomberait sur un bloc
    // replie. On ne fait donc que retirer un survol qui n'existe pas : le panneau
    // ouvert au doigt reste ouvert jusqu'a un appui HORS du bloc (§ surAppui).
    if (estAppuiTactile(e)) {
      etat.survol = false;
      annulerOuverture();
      return;
    }
    etat.survol = false;
    annulerOuverture();
    planifierFermeture();
  };

  // ── Clavier ─────────────────────────────────────────────────────────────────
  const surFocus = () => {
    etat.focusDedans = true;
    if (focusImpose) {
      // Le focus a ete pose par le repli lui-meme (Echap) : on ne rouvre pas.
      focusImpose = false;
      return;
    }
    // Deploiement IMMEDIAT et SANS animation : l'anneau de focus doit etre peint
    // tout de suite, sinon il est rogne par la fente.
    deplier({ immediat: true });
    if (typeof cadre.scrollTop === "number") cadre.scrollTop = 0;
  };

  const surPerteFocus = (e) => {
    const dedans = e && e.relatedTarget && cadre.contains(e.relatedTarget);
    etat.focusDedans = Boolean(dedans);
    planifierFermeture();
  };

  // Phase de CAPTURE : notre ecouteur voit le menu encore OUVERT et ne fait donc
  // rien, ce qui laisse `sidebar.js` fermer le menu (Echap ne se double jamais).
  const surTouche = (e) => {
    if (!e || e.key !== "Escape") return;
    etat.menuOuvert = menuEstOuvert();
    if (etat.menuOuvert) return;
    const actif = doc.activeElement;
    if (!actif || !cadre.contains(actif)) return;
    if (etat.replie) return;
    replier({ immediat: true });
    const ligne = ligneVisible();
    if (ligne && typeof ligne.focus === "function") {
      if (doc.activeElement === ligne) {
        // Focus deja sur la ligne visible : aucun `focusin` ne suivra, le
        // drapeau ne doit donc pas rester arme (il avalerait le `Tab` suivant).
        focusImpose = false;
      } else {
        focusImpose = true;
        ligne.focus();
      }
    }
  };

  // ── Toucher (LOT 3, decision Q1 du proprietaire du 2026-10-26) ──────────────
  // Le PREMIER appui sur le bloc replie DEPLOIE et ne fait rien d'autre : l'appui
  // est consomme, aucun clic ne part, donc la ligne sous le doigt n'agit pas. Un
  // SECOND appui agit normalement. Un appui HORS du bloc deploye le replie tout
  // de suite : il n'y a pas de « sortie de survol » a absorber au doigt.
  const surAppui = (e) => {
    if (!estAppuiTactile(e)) return;
    const cible = e.target || null;
    const dedans =
      cible && typeof cadre.contains === "function" ? cadre.contains(cible) : false;
    if (!dedans) {
      etat.survol = false;
      if (!etat.replie) replier({ immediat: true });
      return;
    }
    if (!etat.replie) return;
    deplier();
    if (typeof e.preventDefault === "function") e.preventDefault();
    if (typeof e.stopPropagation === "function") e.stopPropagation();
  };

  // ── Redimensionnement / etat du menu ────────────────────────────────────────
  // Une fenetre redimensionnee pendant l'animation rend la valeur en pixels
  // fausse (§ 5.5) : on termine l'etat logique, la valeur est remesuree ensuite.
  const surRedimensionnement = () => {
    if (etat.replie) finirRepli();
    else finirDeploiement();
  };

  // Le menu ouvert RETIENT le deploiement et son ouverture annule un sursis ; sa
  // fermeture relance la decision (aucune copie de l'etat du menu dans ce module).
  let observateur = null;
  const surMenuChange = () => {
    const ouvert = menuEstOuvert();
    if (ouvert === etat.menuOuvert) return;
    etat.menuOuvert = ouvert;
    if (ouvert) {
      annulerFermeture();
      // Un menu ne doit JAMAIS etre rogne : si le declencheur vient d'etre clique
      // alors que la fente monte encore, le deploiement est termine tout de
      // suite (`overflow: clip` tombe avec la classe).
      if (!etat.replie) finirDeploiement();
    } else {
      planifierFermeture();
    }
  };

  const surTransition = (e) => {
    if (!e || e.target !== cadre || e.propertyName !== "height") return;
    if (etat.replie) finirRepli();
    else finirDeploiement();
  };

  // Changement de preference d'animation du systeme : la classe suit, et un
  // deploiement en cours est termine proprement (plus d'animation a attendre).
  let requeteMouvement = null;
  const surChangementMouvement = () => {
    synchroniserMouvement();
    if (etat.replie) finirRepli();
    else finirDeploiement();
  };
  if (typeof win.matchMedia === "function") {
    try {
      requeteMouvement = win.matchMedia("(prefers-reduced-motion: reduce)");
    } catch (_) {
      requeteMouvement = null;
    }
  }
  if (requeteMouvement && typeof requeteMouvement.addEventListener === "function") {
    requeteMouvement.addEventListener("change", surChangementMouvement);
  }

  cadre.addEventListener("pointerenter", surEntree);
  cadre.addEventListener("pointerleave", surSortie);
  cadre.addEventListener("focusin", surFocus);
  cadre.addEventListener("focusout", surPerteFocus);
  cadre.addEventListener("transitionend", surTransition);
  // Capture : l'appui est vu avant le bouton sous le doigt, ce qui permet de le
  // consommer (Q1) sans dependre de l'ordre des ecouteurs des lignes.
  doc.addEventListener("pointerdown", surAppui, true);
  doc.addEventListener("keydown", surTouche, true);
  win.addEventListener("resize", surRedimensionnement);
  if (menu && typeof win.MutationObserver === "function") {
    observateur = new win.MutationObserver(surMenuChange);
    observateur.observe(menu, { attributes: true, attributeFilter: ["class"] });
  }

  return {
    detruire() {
      annulerOuverture();
      annulerFermeture();
      annulerSecurite();
      cadre.removeEventListener("pointerenter", surEntree);
      cadre.removeEventListener("pointerleave", surSortie);
      cadre.removeEventListener("focusin", surFocus);
      cadre.removeEventListener("focusout", surPerteFocus);
      cadre.removeEventListener("transitionend", surTransition);
      doc.removeEventListener("pointerdown", surAppui, true);
      doc.removeEventListener("keydown", surTouche, true);
      win.removeEventListener("resize", surRedimensionnement);
      if (requeteMouvement && typeof requeteMouvement.removeEventListener === "function") {
        requeteMouvement.removeEventListener("change", surChangementMouvement);
      }
      if (observateur) observateur.disconnect();
    },
    etat: () => ({ ...etat }),
  };
}
