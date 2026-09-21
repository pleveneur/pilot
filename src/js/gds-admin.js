// gds-admin.js — Onglet transverse « 🖥️ GDS Serveur » (refonte GDS, lot L4)
//
// Écran d'ADMINISTRATION du serveur GDS, NON LIÉ À UN PROJET : il est distinct
// de l'onglet « 🌐 GDS » (gds.js), qui est PAR PROJET (machine à états liée au
// projet actif). Celui-ci vit dans un fichier dédié pour ne pas alourdir gds.js.
//
// Sections remplies au fil des micro-tâches du LOT 4 :
//   L4.2 « Connexion serveur »  → ADMIN_SECTIONS[0]  (implémenté)
//   L4.3 « Comptes »            → ADMIN_SECTIONS[1]
//   L4.4 « Dépôts / projets »   → ADMIN_SECTIONS[2]
//   L4.5 « Espace + journal »   → ADMIN_SECTIONS[3]
//   L4.6 « Contrôle du service »→ ADMIN_SECTIONS[4]
//
// La coquille (`renderAdminShellHtml`) et le rendu de section
// (`renderAdminSectionHtml`) sont PURS et exportés : l'écran de paramétrage
// utilisateur (L5.1, gds-params.js) RÉUTILISE la même mécanique, sans la
// dupliquer. Ils sont couverts par `gds-admin.test.js`.
//
// Règle secrets (L4.2) : le mot de passe administrateur est saisi dans le
// formulaire, transmis au serveur pour ouvrir une session, puis mémorisé par le
// poste (fichier de secrets 0600). Il n'est JAMAIS renvoyé à l'interface et
// JAMAIS réinjecté dans le HTML (les rendus ci-dessous sont purs et ne reçoivent
// ni mot de passe ni jeton : les réponses des commandes n'en contiennent pas).

import { invoke } from "@tauri-apps/api/core";
import { refreshIcons } from "./icons.js";

/** Port HTTP par défaut de l'API GDS (spec §2.5). */
export const DEFAULT_HTTP_PORT = "8080";

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
 *
 * `sectionHtml` (optionnel) : table `{ [id]: html }` permettant d'afficher une
 * section REMPLIE à la place du squelette « À venir ». Absent → toutes les
 * sections sont des squelettes (comportement L4.1 inchangé).
 * @param {{title:string, subtitle:string, sections:Array, sectionHtml?:Object}} opts
 */
export function renderAdminShellHtml({ title, subtitle, sections, sectionHtml = {} }) {
  const body = (sections || [])
    .map((s) => (sectionHtml && sectionHtml[s.id] != null ? sectionHtml[s.id] : renderAdminSectionHtml(s)))
    .join("\n");
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

// ─────────────────────────────────────────────────────────────────────────────
// L4.2 — « Connexion serveur » : rendus purs (jamais de secret) et câblage
// ─────────────────────────────────────────────────────────────────────────────

/** Description affichée de la section « Connexion serveur ». */
export const CONNECTION_DESC =
  "Adresse et port de l'API du serveur GDS, puis identifiant administrateur. « Tester la connexion » vérifie la joignabilité et le rôle du compte sans rien enregistrer ; « Se connecter » mémorise l'identifiant après un test réussi (le mot de passe n'est jamais renvoyé à l'interface).";

/** État initial du formulaire de connexion (pure). */
export function initialConnectionState() {
  return {
    host: "",
    port: DEFAULT_HTTP_PORT,
    email: "",
    hasPassword: false,
    loading: false,
    ok: false,
    error: "",
    server: null,
  };
}

/**
 * Choisit le serveur à pré-remplir depuis la liste des serveurs mémorisés
 * (`gds_admin_saved_servers`). Renvoie `null` si aucune entrée exploitable.
 * Pure — testable. Aucun mot de passe ne circule ici : la liste n'en contient
 * pas (seulement un booléen `has_password`).
 */
export function pickPrefill(savedServers) {
  for (const s of savedServers || []) {
    if (s && String(s.host || "").trim() && String(s.email || "").trim()) {
      return {
        host: String(s.host).trim(),
        port: String(s.http_port || "").trim() || DEFAULT_HTTP_PORT,
        email: String(s.email).trim(),
        hasPassword: !!s.has_password,
      };
    }
  }
  return null;
}

/**
 * Formate un nombre d'octets en unité lisible. `null`/absurde → « — » (valeur
 * inconnue : on ne ment pas avec un 0). Pure — testable.
 */
export function formatBytes(n) {
  if (n == null || typeof n !== "number" || Number.isNaN(n) || n < 0) return "—";
  if (n < 1024) return `${n} o`;
  const units = ["Ko", "Mo", "Go", "To"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** Affiche une valeur numérique éventuellement `null` (compteur inconnu). */
function numOrDash(v) {
  return v == null || v === "" ? "—" : String(v);
}

/**
 * Rend la zone d'état de la connexion (pure, testable). Ne reçoit QUE l'état
 * renvoyé par les commandes : `{ loading, ok, error, server }`. Aucun champ
 * sensible n'existe côté commandes, donc aucun ne peut être affiché.
 */
export function renderConnectionStatusHtml(state = {}) {
  const s = { loading: false, ok: false, error: "", server: null, ...state };
  if (s.loading) {
    return `<div class="gds-admin-status loading">Test de connexion en cours…</div>`;
  }
  if (s.ok && s.server) {
    const sv = s.server;
    return `<div class="gds-admin-status ok">
          <div class="gds-admin-status-line"><b>Connecté</b> — ${esc(sv.base_url || "")} <span class="gds-admin-muted">(${esc(sv.role || "?")} · ${esc(sv.email || "")})</span></div>
          <div class="gds-admin-metrics">
            <span><b>Version</b> ${esc(numOrDash(sv.version))}</span>
            <span><b>Migrations</b> ${esc(numOrDash(sv.migration_version))}</span>
            <span><b>Comptes</b> ${esc(numOrDash(sv.users))}</span>
            <span><b>Projets</b> ${esc(numOrDash(sv.projects))}</span>
            <span><b>Dépôts</b> ${esc(numOrDash(sv.git_repos))}</span>
            <span><b>Espace dépôts</b> ${esc(formatBytes(sv.repos_bytes))}</span>
            <span><b>Espace base</b> ${esc(formatBytes(sv.db_bytes))}</span>
          </div>
        </div>`;
  }
  if (s.error) {
    return `<div class="gds-admin-status error">⚠️ ${esc(s.error)}</div>`;
  }
  return `<div class="gds-admin-status idle">Renseignez l'adresse du serveur et l'identifiant administrateur, puis lancez un test.</div>`;
}

/**
 * Rend la section « Connexion serveur » complète (pure, testable).
 * Le champ mot de passe est TOUJOURS rendu vide (aucun `value`) : le mot de
 * passe n'est jamais réinjecté dans le HTML, même après un test réussi.
 * @param {Object} state état du formulaire (voir `initialConnectionState`)
 */
export function renderConnectionSectionHtml(state = {}) {
  const s = { ...initialConnectionState(), ...state };
  const badge = s.ok
    ? `<span class="gds-admin-badge ok">● Connecté</span>`
    : `<span class="gds-admin-todo">À connecter — L4.2</span>`;
  const pwPlaceholder = s.hasPassword ? "•••••••• (mémorisé)" : "mot de passe administrateur";
  return `
      <section class="gds-admin-section" data-section-id="connection">
        <div class="gds-admin-section-head">
          <div class="gds-admin-section-title"><i data-lucide="plug-zap" class="icon-sm"></i> Connexion serveur</div>
          ${badge}
        </div>
        <div class="gds-admin-section-desc">${esc(CONNECTION_DESC)}</div>
        <div class="gds-admin-form">
          <label class="gds-admin-field"><span>Adresse du serveur</span>
            <input id="gds-admin-host" type="text" placeholder="192.168.1.10 ou https://gds.exemple.com" value="${esc(s.host)}">
          </label>
          <label class="gds-admin-field gds-admin-field-narrow"><span>Port HTTP</span>
            <input id="gds-admin-port" type="text" inputmode="numeric" placeholder="${esc(DEFAULT_HTTP_PORT)}" value="${esc(s.port)}">
          </label>
          <label class="gds-admin-field"><span>Email administrateur</span>
            <input id="gds-admin-email" type="text" autocomplete="off" placeholder="admin@exemple.com" value="${esc(s.email)}">
          </label>
          <label class="gds-admin-field"><span>Mot de passe administrateur</span>
            <input id="gds-admin-password" type="password" autocomplete="new-password" placeholder="${esc(pwPlaceholder)}">
          </label>
        </div>
        <div class="gds-admin-actions">
          <button class="gds-admin-btn" id="gds-admin-test"><i data-lucide="plug-zap" class="icon-sm"></i> Tester la connexion</button>
          <button class="gds-admin-btn primary" id="gds-admin-connect"><i data-lucide="log-in" class="icon-sm"></i> Se connecter</button>
        </div>
        <div id="gds-admin-connection-status" class="gds-admin-status-area">${renderConnectionStatusHtml(s)}</div>
        <div class="gds-admin-hint">Le mot de passe n'est jamais renvoyé à l'interface : il sert seulement à ouvrir une session sur le serveur, puis est mémorisé par le poste (fichier de secrets en lecture seule, 0600) après un test réussi. L'identifiant d'administration est mémorisé à part de l'identité utilisée pour les projets.</div>
      </section>`;
}

/**
 * Crée l'onglet « GDS Serveur » (transverse) dans `container`.
 * Ne dépend d'AUCUN projet ouvert : aucune lecture de `window._pilotProjectPath`.
 * @param {HTMLElement} container
 * @returns {{wrapper: HTMLElement, unlisten: Function}}
 */
export function createGdsAdmin(container) {
  container.classList.add("gds-admin-view");

  /** État local du formulaire de connexion (le mot de passe n'y est jamais rendu). */
  let state = initialConnectionState();
  let disposed = false;

  const q = (sel) => container.querySelector(sel);

  /** Récupère la saisie courante AVANT tout redessin (le rendu ne la conserve pas). */
  function readFields() {
    const host = q("#gds-admin-host");
    const port = q("#gds-admin-port");
    const email = q("#gds-admin-email");
    const password = q("#gds-admin-password");
    if (host) state.host = host.value;
    if (port) state.port = port.value;
    if (email) state.email = email.value;
    if (password) state.password = password.value;
  }

  function draw() {
    container.innerHTML = renderAdminShellHtml({
      title: "🖥️ GDS Serveur — administration",
      subtitle:
        "Gestion du serveur GDS (comptes, dépôts, journal, service). Cet onglet est indépendant du projet ouvert.",
      sections: ADMIN_SECTIONS,
      sectionHtml: { connection: renderConnectionSectionHtml(state) },
    });
    refreshIcons(container);
    bind();
  }

  function bind() {
    const t = q("#gds-admin-test");
    const c = q("#gds-admin-connect");
    if (t) t.addEventListener("click", () => runConnectionTest(false));
    if (c) c.addEventListener("click", () => runConnectionTest(true));
  }

  async function runConnectionTest(memorize) {
    readFields();
    if (!String(state.host).trim()) {
      state.loading = false;
      state.ok = false;
      state.error = "Adresse du serveur requise.";
      state.server = null;
      return draw();
    }
    if (!String(state.email).trim()) {
      state.loading = false;
      state.ok = false;
      state.error = "Email administrateur requis.";
      state.server = null;
      return draw();
    }
    state.loading = true;
    state.ok = false;
    state.error = "";
    state.server = null;
    draw();
    try {
      const res = await invoke(memorize ? "gds_admin_connect" : "gds_admin_test_connection", {
        host: String(state.host).trim(),
        httpPort: String(state.port || "").trim(),
        email: String(state.email).trim(),
        password: String(state.password || ""),
      });
      if (disposed) return;
      state.loading = false;
      // Le mot de passe saisi est oublié dès que la requête est terminée : il
      // n'est ni conservé en mémoire pour un redessin, ni réinjecté au HTML.
      const hadPassword = !!String(state.password || "");
      state.password = "";
      if (res && res.ok) {
        state.ok = true;
        state.server = res;
        state.error = "";
        if (memorize && hadPassword) state.hasPassword = true;
      } else {
        state.ok = false;
        state.server = null;
        state.error = (res && res.error) || "Échec du test de connexion.";
      }
    } catch (e) {
      if (disposed) return;
      state.loading = false;
      state.ok = false;
      state.server = null;
      state.error = String((e && e.message) || e || "Erreur inattendue");
    }
    draw();
  }

  /** Pré-remplit le formulaire depuis un serveur d'administration mémorisé. */
  async function prefillSaved() {
    try {
      const list = await invoke("gds_admin_saved_servers");
      if (disposed) return;
      const p = pickPrefill(list);
      if (!p) return;
      state.host = p.host;
      state.port = p.port;
      state.email = p.email;
      state.hasPassword = p.hasPassword;
      draw();
    } catch {
      // Silencieux : sans liste (ou hors Tauri), le formulaire reste vide.
    }
  }

  draw();
  prefillSaved();

  // Aucune ressource système à libérer ; on renvoie néanmoins le contrat commun
  // des écrans (wrapper + unlisten) pour l'homogénéité de tabs.js.
  return {
    wrapper: container,
    unlisten: () => {
      disposed = true;
    },
  };
}
