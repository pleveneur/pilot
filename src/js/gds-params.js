// gds-params.js — Onglet transverse « ⚙️ GDS — paramétrage » (refonte GDS, lot L5)
//
// Écran de PARAMÉTRAGE UTILISATEUR du GDS, NON LIÉ À UN PROJET : c'est le
// pendant « utilisateur » de l'écran d'ADMINISTRATION (gds-admin.js, lot L4).
// Il est distinct de l'onglet « 🌐 GDS » (gds.js), qui est PAR PROJET.
//
// La mécanique de coquille est RÉUTILISÉE telle quelle depuis gds-admin.js
// (`renderAdminShellHtml`) : aucune duplication d'affichage transverse.
//
// Sections remplies au fil des micro-tâches du LOT 5 :
//   L5.2 « Serveurs GDS »      → PARAMS_SECTIONS[0]
//   L5.3 « Mon identité »      → PARAMS_SECTIONS[1]
//   L5.4 « Mes clés »          → PARAMS_SECTIONS[2]
//   L5.5 « Mes projets GDS »   → PARAMS_SECTIONS[3]
//
// Règle secrets : aucun mot de passe, aucune clé privée n'est renvoyé à
// l'interface ni injecté dans le HTML. Les rendus ci-dessous sont purs et ne
// reçoivent que des identifiants non sensibles (hôte, port, email).

import { refreshIcons } from "./icons.js";
import { renderAdminShellHtml } from "./gds-admin.js";

/**
 * Sections de l'écran de paramétrage (squelette L5.1).
 * `todo` désigne la micro-tâche du LOT 5 qui remplira la section.
 * Exporté (donnée pure) pour les tests et la réutilisation.
 */
export const PARAMS_SECTIONS = [
  {
    id: "servers",
    icon: "server",
    title: "Serveurs GDS",
    desc: "Serveurs mémorisés sur ce poste (hôte et identifiant, jamais les mots de passe) : ajouter, modifier, supprimer, tester la connexion, et appliquer un serveur à un projet.",
    todo: "L5.2",
  },
  {
    id: "identity",
    icon: "user-round",
    title: "Mon identité",
    desc: "Email d'identité et nom git utilisés lors de l'ajout d'un projet au GDS (identité globale, avec possibilité d'un email propre à un projet).",
    todo: "L5.3",
  },
  {
    id: "keys",
    icon: "key-round",
    title: "Mes clés",
    desc: "Clé SSH publique du poste : l'afficher, la copier et l'enregistrer sur le serveur choisi pour l'accès git.",
    todo: "L5.4",
  },
  {
    id: "projects",
    icon: "folder-git-2",
    title: "Mes projets GDS",
    desc: "Projets GDS connus : état de la connexion, synchroniser, ajouter un projet local au GDS, ouvrir et retirer.",
    todo: "L5.5",
  },
];

/** Titre de l'onglet de paramétrage (transverse). */
export const PARAMS_TITLE = "⚙️ GDS — paramétrage";

/** Sous-titre affiché dans l'en-tête de l'écran. */
export const PARAMS_SUBTITLE =
  "Paramétrage GDS de ce poste (serveurs, identité, clés, projets). Cet onglet est indépendant du projet ouvert.";

/**
 * Rend le HTML de la coquille de l'écran de paramétrage (pure, testable).
 * RÉUTILISE `renderAdminShellHtml` (gds-admin.js) : la coquille et le rendu de
 * section sont mutualisés, seule la liste des sections change.
 *
 * `sectionHtml` (optionnel) : table `{ [id]: html }` permettant d'afficher une
 * section REMPLIE à la place du squelette « À venir ».
 * @param {{sectionHtml?:Object}} [opts]
 */
export function renderParamsShellHtml({ sectionHtml = {} } = {}) {
  return renderAdminShellHtml({
    title: PARAMS_TITLE,
    subtitle: PARAMS_SUBTITLE,
    sections: PARAMS_SECTIONS,
    sectionHtml,
  });
}

/**
 * Monte l'écran de paramétrage dans `container` (contrat commun des écrans :
 * `{ wrapper, unlisten }`).
 *
 * Cet écran n'utilise AUCUNE variable de projet : il s'ouvre sans projet ouvert
 * et ne modifie ni le projet actif ni les onglets déjà ouverts.
 */
export function createGdsParams(container) {
  container.classList.add("gds-admin-view", "gds-params-view");

  let disposed = false;

  function draw() {
    if (disposed) return;
    container.innerHTML = renderParamsShellHtml();
    refreshIcons(container);
  }

  draw();

  // Aucune ressource système à libérer ; on renvoie néanmoins le contrat commun
  // des écrans (wrapper + unlisten) pour l'homogénéité de tabs.js.
  return {
    wrapper: container,
    unlisten: () => {
      disposed = true;
    },
  };
}
