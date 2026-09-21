// gds-admin.js — Onglet transverse « 🖥️ GDS Serveur » (refonte GDS, lot L4.1)
//
// Écran d'ADMINISTRATION du serveur GDS, NON LIÉ À UN PROJET : il est distinct
// de l'onglet « 🌐 GDS » (gds.js), qui est PAR PROJET (machine à états liée au
// projet actif). Celui-ci vit dans un fichier dédié pour ne pas alourdir gds.js.
//
// L4.1 ne remplit AUCUNE section : ce module ne pose que le SQUELETTE (coquille
// + sections vides et lisibles). Les sections sont remplies par les micro-tâches
// suivantes du LOT 4 :
//   L4.2 « Connexion serveur »  → ADMIN_SECTIONS[0]
//   L4.3 « Comptes »            → ADMIN_SECTIONS[1]
//   L4.4 « Dépôts / projets »   → ADMIN_SECTIONS[2]
//   L4.5 « Espace + journal »   → ADMIN_SECTIONS[3]
//   L4.6 « Contrôle du service »→ ADMIN_SECTIONS[4]
//
// La coquille (`renderAdminShellHtml`) et le rendu de section
// (`renderAdminSectionHtml`) sont PURS et exportés : l'écran de paramétrage
// utilisateur (L5.1, gds-params.js) RÉUTILISE la même mécanique, sans la
// dupliquer. Ils sont couverts par `gds-admin.test.js`.

import { refreshIcons } from "./icons.js";

/**
 * Sections de l'écran d'administration (squelette L4.1).
 * `todo` désigne la micro-tâche du LOT 4 qui remplira la section.
 * Exporté (donnée pure) pour les tests et la réutilisation par L5.1.
 */
export const ADMIN_SECTIONS = [
  {
    id: "connection",
    icon: "plug-zap",
    title: "Connexion serveur",
    desc: "Hôte, port et identifiant administrateur ; test de connexion et état du serveur (version, migrations, espace).",
    todo: "L4.2",
  },
  {
    id: "accounts",
    icon: "users",
    title: "Comptes",
    desc: "Lister les comptes (email, rôle, statut, date) ; créer, désactiver/réactiver, changer le rôle, réinitialiser le mot de passe — avec le garde-fou du dernier administrateur.",
    todo: "L4.3",
  },
  {
    id: "repos",
    icon: "folder-git-2",
    title: "Dépôts / projets",
    desc: "Projets du serveur, dépôt bare associé et membres ; attribuer ou retirer un développeur, retirer un projet avec option de purge.",
    todo: "L4.4",
  },
  {
    id: "storage",
    icon: "hard-drive",
    title: "Espace utilisé + journal des connexions",
    desc: "Taille des volumes (dépôts + base) et journal des connexions / actions d'administration, avec pagination.",
    todo: "L4.5",
  },
  {
    id: "service",
    icon: "power",
    title: "Contrôle du service",
    desc: "Redémarrer le service GDS ; arrêter ou redémarrer le conteneur, avec double confirmation et re-test de santé.",
    todo: "L4.6",
  },
];

/** Échappe le HTML pour injection sûre dans innerHTML. */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/**
 * Rend le HTML d'UNE section du squelette (pure, testable).
 * @param {{id:string, icon:string, title:string, desc:string, todo:string}} section
 */
export function renderAdminSectionHtml(section) {
  return `
      <section class="gds-admin-section" data-section-id="${esc(section.id)}">
        <div class="gds-admin-section-head">
          <div class="gds-admin-section-title"><i data-lucide="${esc(section.icon)}" class="icon-sm"></i> ${esc(section.title)}</div>
          <span class="gds-admin-todo">À venir — ${esc(section.todo)}</span>
        </div>
        <div class="gds-admin-section-desc">${esc(section.desc)}</div>
        <div class="gds-admin-section-placeholder">Squelette : cette section sera remplie par la micro-tâche ${esc(section.todo)}.</div>
      </section>`;
}

/**
 * Rend le HTML de la coquille d'un écran d'administration (pure, testable).
 * Réutilisable telle quelle par l'écran de paramétrage utilisateur (L5.1).
 * @param {{title:string, subtitle:string, sections:Array}} opts
 */
export function renderAdminShellHtml({ title, subtitle, sections }) {
  const body = (sections || []).map(renderAdminSectionHtml).join("\n");
  return `
    <div class="gds-admin-scroll">
      <div class="gds-admin-header">
        <div class="gds-admin-title">${esc(title)}</div>
        <div class="gds-admin-subtitle">${esc(subtitle)}</div>
      </div>
      <div class="gds-admin-body">${body}
      </div>
    </div>`;
}

/**
 * Crée l'onglet « GDS Serveur » (transverse) dans `container`.
 * Ne dépend d'AUCUN projet ouvert : aucune lecture de `window._pilotProjectPath`.
 * @param {HTMLElement} container
 * @returns {{wrapper: HTMLElement, unlisten: Function}}
 */
export function createGdsAdmin(container) {
  container.classList.add("gds-admin-view");
  container.innerHTML = renderAdminShellHtml({
    title: "🖥️ GDS Serveur — administration",
    subtitle:
      "Gestion du serveur GDS (comptes, dépôts, journal, service). Cet onglet est indépendant du projet ouvert.",
    sections: ADMIN_SECTIONS,
  });
  refreshIcons(container);

  // Aucune ressource à libérer à ce stade (squelette) ; on renvoie néanmoins le
  // contrat commun des écrans (wrapper + unlisten) pour l'homogénéité de tabs.js.
  return { wrapper: container, unlisten: () => {} };
}
