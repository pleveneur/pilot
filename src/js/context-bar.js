/**
 * Bande de contexte de la zone de travail (LOT 4 de la presentation).
 *
 * Reference : docs/proposition-presentation-ui.md §3.4 et lot 4 du §6.
 *
 * Une bande de 26 px, en haut de la zone de travail, affiche le fil d'Ariane
 * « Projet > <projet> > <onglet actif> » a gauche, et l'entree « Travail »
 * nommee a droite (voir agent-activity.js : elle est dans index.html).
 *
 * Ce module ne fait QUE du texte : il ne cree aucun onglet, ne change aucun
 * `mode` d'onglet, ne touche ni a l'ordre de la barre d'onglets, ni au panneau
 * du travail, ni a sa memoire d'onglet. Il lit l'etat reel de l'interface :
 *   - le projet actif : `window._pilotProjectPath` (source unique, deja utilisee
 *     par la barre laterale) ;
 *   - l'onglet actif : le libelle VISIBLE de l'onglet actif dans `#tab-bar`
 *     (donc exactement ce que l'utilisateur voit, sans dupliquer la logique de
 *     nommage de tabs.js).
 *
 * Aucune exception ne remonte : une bande illisible ne doit jamais casser le
 * demarrage.
 */

/** Texte du segment « onglet » quand aucun onglet n'est actif. */
export const CONTEXT_BAR_DEFAULT_TAB_LABEL = "Aucun onglet";
/** Texte du segment « projet » quand aucun projet n'est ouvert. */
export const CONTEXT_BAR_DEFAULT_PROJECT_LABEL = "Aucun projet";

/**
 * Prefixes d'icone utilises par la barre d'onglets (tabs.js, `_renderTabButton`).
 * Ils sont retires du fil d'Ariane : le fil est du texte, pas une barre
 * d'onglets, et deux canaux pour une seule information sont proscrits.
 * ATTENTION : si tabs.js change un prefixe, il faut le changer ici aussi.
 */
export const CONTEXT_BAR_TAB_ICONS = ["👁️", "📕", "🖼️", "📊", "🖥️", "π", "🧭", "📜", "🧩", "▶"];

/**
 * Nom de projet lisible a partir de son chemin (dernier segment), sans
 * distinction de separateur (Windows ou POSIX).
 * @param {string|null|undefined} path
 * @returns {string}
 */
export function projectLabelFromPath(path) {
  if (!path) return CONTEXT_BAR_DEFAULT_PROJECT_LABEL;
  const clean = String(path).replace(/\\/g, "/").replace(/\/+$/, "");
  const name = (clean.split("/").pop() || "").trim();
  return name || CONTEXT_BAR_DEFAULT_PROJECT_LABEL;
}

/**
 * Libelle d'onglet lisible a partir du texte affiche dans la barre d'onglets :
 * espaces normalises, prefixe d'icone retire (un seul, celui du debut).
 * @param {string|null|undefined} raw
 * @returns {string}
 */
export function tabLabelFromText(raw) {
  let label = String(raw == null ? "" : raw).replace(/\s+/g, " ").trim();
  for (const icon of CONTEXT_BAR_TAB_ICONS) {
    if (label.startsWith(icon)) {
      label = label.slice(icon.length).trim();
      break;
    }
  }
  return label || CONTEXT_BAR_DEFAULT_TAB_LABEL;
}

/**
 * Contenu de la bande (fonction pure : aucune lecture du DOM).
 * @param {{projectPath?: string|null, activeTabText?: string|null}} etat
 * @returns {{project: string, tab: string}}
 */
export function contextBarModel(etat) {
  const source = etat || {};
  return {
    project: projectLabelFromPath(source.projectPath),
    tab: tabLabelFromText(source.activeTabText),
  };
}

/** Ecrit un texte seulement s'il change (aucune mutation inutile du DOM). */
function setText(el, value) {
  if (el && el.textContent !== value) el.textContent = value;
}

/**
 * Recalcule la bande de contexte depuis l'etat reel de l'interface.
 * @returns {{project: string, tab: string}|null} le contenu affiche, ou null si
 *   la bande n'existe pas (page sans bande : mode web, test, etc.).
 */
export function refreshContextBar() {
  const nav = document.getElementById("context-breadcrumb");
  if (!nav) return null;
  const activeName = document.querySelector("#tab-bar .tab.active .tab-name");
  const model = contextBarModel({
    projectPath: (typeof window !== "undefined" && window._pilotProjectPath) || "",
    activeTabText: activeName ? activeName.textContent : "",
  });
  setText(document.getElementById("context-breadcrumb-name"), model.project);
  setText(document.getElementById("context-breadcrumb-tab"), model.tab);
  // Etat du menu « Projets » : le 1er segment ouvre CE menu, il doit donc
  // annoncer son etat comme lui (meme source : la classe du menu).
  const dropdown = document.getElementById("projects-dropdown");
  const projectBtn = document.getElementById("context-breadcrumb-project");
  if (projectBtn && dropdown) {
    projectBtn.setAttribute(
      "aria-expanded",
      dropdown.classList.contains("hidden") ? "false" : "true"
    );
  }
  return model;
}

/**
 * Branche la bande de contexte. Idempotent : un seul observateur par page.
 * L'observation couvre TOUS les cas sans dependre de tabs.js ni de sidebar.js :
 * ouverture/fermeture/activation/renommage d'onglet (mutations de `#tab-bar`) et
 * changement de projet (`#open-projects-bar` est re-rendu a chaque bascule).
 * @returns {boolean} true si la bande a ete branchee.
 */
export function initContextBar() {
  const bar = document.getElementById("context-bar");
  if (!bar) return false;

  // 1er segment cliquable : il ouvre le menu « Projets », comme le bouton
  // « Projets » du bandeau de la colonne de gauche (aucune duplication : on
  // declenche le meme bouton, donc le meme comportement et le meme etat).
  const projectBtn = document.getElementById("context-breadcrumb-project");
  if (projectBtn) {
    projectBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const opener = document.getElementById("btn-open-project");
      if (opener) opener.click();
    });
  }

  refreshContextBar();

  if (typeof MutationObserver !== "function") return true;
  const observateur = new MutationObserver(() => {
    refreshContextBar();
  });
  const options = {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
    characterData: true,
  };
  for (const id of ["tab-bar", "open-projects-bar", "projects-dropdown"]) {
    const el = document.getElementById(id);
    if (el) observateur.observe(el, options);
  }
  window._pilotContextBarObserver = observateur;
  return true;
}
