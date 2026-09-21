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

// ─────────────────────────────────────────────────────────────────────────────
// L4.3 — « Comptes » : rendus purs (jamais de secret) et charges utiles
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rôles du vocabulaire du socle (`gds-core::db::USER_ROLES`). Sert seulement à
 * l'affichage : le serveur reste l'autorité qui valide (un rôle hors vocabulaire
 * est refusé côté serveur).
 */
export const ACCOUNT_ROLES = [
  { value: "admin", label: "Administrateur" },
  { value: "dev", label: "Développeur" },
  { value: "standard", label: "Standard" },
];

/** Statuts du vocabulaire du socle (`gds-core::db::USER_STATUSES`). */
export const ACCOUNT_STATUSES = [
  { value: "pending", label: "En attente" },
  { value: "active", label: "Actif" },
  { value: "disabled", label: "Désactivé" },
];

/** Description affichée de la section « Comptes ». */
export const ACCOUNTS_DESC =
  "Liste des comptes du serveur (adresse, nom, rôle, statut, date de création) et gestion : créer un compte (adresse + rôle + mot de passe initial), changer son rôle, le désactiver/réactiver, réinitialiser son mot de passe. Le serveur interdit de désactiver le dernier administrateur actif ; son message est relayé tel quel.";

/** Libellé français d'un statut (repli : la valeur brute). */
function statusLabel(status) {
  const s = ACCOUNT_STATUSES.find((x) => x.value === status);
  return s ? s.label : String(status || "—");
}

/**
 * Formate une date ISO 8601 (celle renvoyée par `list_users`) en `JJ/MM/AAAA`.
 * Valeur absente ou illisible → « — » (jamais une date inventée). Pure.
 */
export function formatAccountDate(iso) {
  if (!iso) return "—";
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/**
 * Prochaine action de statut pour le bouton d'une ligne : désactivation d'un
 * compte actif (ou en attente), réactivation d'un compte désactivé. Pure.
 */
export function nextStatusToggle(status) {
  if (status === "disabled") {
    return { target: "active", label: "Réactiver", icon: "user-check" };
  }
  return { target: "disabled", label: "Désactiver", icon: "user-x" };
}

/** État initial de la section « Comptes » (pure). */
export function initialAccountsState() {
  return {
    accounts: null, // null = liste jamais chargée
    loading: false,
    error: "",
    notice: "",
    busy: "", // email de la ligne en cours d'opération (boutons neutralisés)
    form: { email: "", name: "", role: "dev" },
    reset: { email: "", password: "" },
  };
}

/**
 * Charge utile commune à toutes les commandes « comptes » : l'identité
 * administrateur connectée. Le mot de passe est **toujours vide** : le poste
 * réutilise celui mémorisé par « Se connecter » (il n'est jamais renvoyé à
 * l'interface, ni conservé ici). Pure — testable.
 */
export function buildAccountsConnArgs(conn) {
  const c = conn || {};
  return {
    host: String(c.host || ""),
    httpPort: String(c.httpPort || ""),
    email: String(c.email || ""),
    password: "",
  };
}

/** Charge utile : lister les comptes. Pure. */
export function buildAccountListArgs(conn) {
  return buildAccountsConnArgs(conn);
}

/** Charge utile : créer un compte. Pure. */
export function buildAccountCreateArgs(conn, form) {
  const f = form || {};
  return {
    ...buildAccountsConnArgs(conn),
    targetEmail: String(f.email || ""),
    targetName: String(f.name || ""),
    targetRole: String(f.role || ""),
    targetPassword: String(f.password || ""),
  };
}

/** Charge utile : changer le rôle d'un compte. Pure. */
export function buildAccountRoleArgs(conn, email, role) {
  return {
    ...buildAccountsConnArgs(conn),
    targetEmail: String(email || ""),
    targetRole: String(role || ""),
  };
}

/** Charge utile : activer/désactiver un compte. Pure. */
export function buildAccountStatusArgs(conn, email, status) {
  return {
    ...buildAccountsConnArgs(conn),
    targetEmail: String(email || ""),
    targetStatus: String(status || ""),
  };
}

/** Charge utile : réinitialiser le mot de passe d'un compte. Pure. */
export function buildAccountPasswordArgs(conn, email, password) {
  return {
    ...buildAccountsConnArgs(conn),
    targetEmail: String(email || ""),
    targetPassword: String(password || ""),
  };
}

/** Badge de statut (active = vert, pending = orange, disabled = gris). */
function renderStatusBadge(status) {
  const cls = status === "active" ? "ok" : status === "disabled" ? "off" : "warn";
  return `<span class="gds-admin-badge ${cls}">${esc(statusLabel(status))}</span>`;
}

/**
 * Rend la zone d'état de la section (pure). Ne reçoit QUE l'état : aucun champ
 * sensible n'existe côté commandes, donc aucun ne peut être affiché.
 */
export function renderAccountsStatusHtml(state = {}) {
  const base = initialAccountsState();
  const s = { ...base, ...state };
  if (s.loading) return `<div class="gds-admin-status loading">Chargement des comptes…</div>`;
  if (s.error) return `<div class="gds-admin-status error">⚠️ ${esc(s.error)}</div>`;
  if (s.notice) return `<div class="gds-admin-status ok">${esc(s.notice)}</div>`;
  if (s.accounts == null) {
    return `<div class="gds-admin-status idle">Connectez-vous au serveur pour afficher la liste des comptes.</div>`;
  }
  return `<div class="gds-admin-status idle">${s.accounts.length} compte(s) sur ce serveur.</div>`;
}

/** Rend une ligne du tableau des comptes (pure). */
function renderAccountRowHtml(a, state) {
  const email = String((a && a.email) || "");
  const role = String((a && a.role) || "");
  const status = String((a && a.status) || "");
  const busy = !!state && state.busy === email;
  const dis = busy ? " disabled" : "";
  const toggle = nextStatusToggle(status);
  const options = ACCOUNT_ROLES.map(
    (r) =>
      `<option value="${esc(r.value)}"${r.value === role ? " selected" : ""}>${esc(r.label)}</option>`
  ).join("");
  return `
      <tr data-email="${esc(email)}">
        <td class="gds-admin-cell-email">${esc(email)}</td>
        <td>${esc((a && a.name) || "—")}</td>
        <td><select class="gds-admin-acc-role" data-email="${esc(email)}"${dis}>${options}</select></td>
        <td>${renderStatusBadge(status)}</td>
        <td class="gds-admin-cell-date">${esc(formatAccountDate(a && a.created_at))}</td>
        <td class="gds-admin-cell-actions">
          <button class="gds-admin-btn small" data-acc-action="role" data-email="${esc(email)}"${dis}><i data-lucide="check" class="icon-sm"></i> Rôle</button>
          <button class="gds-admin-btn small" data-acc-action="toggle" data-email="${esc(email)}" data-target="${esc(toggle.target)}"${dis}><i data-lucide="${esc(toggle.icon)}" class="icon-sm"></i> ${esc(toggle.label)}</button>
          <button class="gds-admin-btn small" data-acc-action="reset" data-email="${esc(email)}"${dis}><i data-lucide="key-round" class="icon-sm"></i> Mot de passe</button>
        </td>
      </tr>`;
}

/** Rend le tableau des comptes (pure). */
export function renderAccountsTableHtml(state = {}) {
  const base = initialAccountsState();
  const s = { ...base, ...state };
  if (s.accounts == null) return "";
  if (s.accounts.length === 0) {
    return `<div class="gds-admin-section-placeholder">Aucun compte sur ce serveur pour le moment.</div>`;
  }
  const rows = s.accounts.map((a) => renderAccountRowHtml(a, s)).join("");
  return `
      <table class="gds-admin-table">
        <thead>
          <tr><th>Adresse</th><th>Nom</th><th>Rôle</th><th>Statut</th><th>Créé le</th><th>Actions</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
}

/** Rend le panneau de réinitialisation de mot de passe (pure). Le champ est
 *  TOUJOURS vide : le mot de passe n'est jamais réinjecté dans le HTML. */
function renderAccountsResetHtml(state) {
  const email = state && state.reset ? state.reset.email : "";
  if (!email) return "";
  return `
      <div class="gds-admin-reset">
        <div class="gds-admin-reset-title">Nouveau mot de passe pour <b>${esc(email)}</b></div>
        <label class="gds-admin-field"><span>Nouveau mot de passe</span>
          <input id="gds-admin-acc-reset-password" type="password" autocomplete="new-password" placeholder="nouveau mot de passe">
        </label>
        <div class="gds-admin-actions">
          <button class="gds-admin-btn primary small" data-acc-action="reset-save" data-email="${esc(email)}"><i data-lucide="check" class="icon-sm"></i> Enregistrer</button>
          <button class="gds-admin-btn small" data-acc-action="reset-cancel"><i data-lucide="x" class="icon-sm"></i> Annuler</button>
        </div>
      </div>`;
}

/**
 * Rend la section « Comptes » complète (pure, testable) : formulaire de
 * création, zone d'état, panneau de réinitialisation et tableau. Les mots de
 * passe ne sont JAMAIS rendus (aucun `value`) ni reçus dans l'état.
 */
export function renderAccountsSectionHtml(state = {}) {
  const base = initialAccountsState();
  const s = {
    ...base,
    ...state,
    form: { ...base.form, ...((state && state.form) || {}) },
    reset: { ...base.reset, ...((state && state.reset) || {}) },
  };
  const count =
    s.accounts == null ? "" : ` <span class="gds-admin-muted">(${s.accounts.length})</span>`;
  const roleOptions = ACCOUNT_ROLES.map(
    (r) =>
      `<option value="${esc(r.value)}"${r.value === s.form.role ? " selected" : ""}>${esc(r.label)}</option>`
  ).join("");
  return `
      <section class="gds-admin-section" data-section-id="accounts">
        <div class="gds-admin-section-head">
          <div class="gds-admin-section-title"><i data-lucide="users" class="icon-sm"></i> Comptes${count}</div>
          <button class="gds-admin-btn small" id="gds-admin-acc-refresh"><i data-lucide="refresh-cw" class="icon-sm"></i> Rafraîchir</button>
        </div>
        <div class="gds-admin-section-desc">${esc(ACCOUNTS_DESC)}</div>
        <div class="gds-admin-form gds-admin-form-create">
          <label class="gds-admin-field"><span>Adresse (email)</span>
            <input id="gds-admin-acc-new-email" type="text" autocomplete="off" placeholder="prenom.nom@exemple.com" value="${esc(s.form.email)}">
          </label>
          <label class="gds-admin-field"><span>Nom (facultatif)</span>
            <input id="gds-admin-acc-new-name" type="text" autocomplete="off" placeholder="Prénom Nom" value="${esc(s.form.name)}">
          </label>
          <label class="gds-admin-field"><span>Rôle</span>
            <select id="gds-admin-acc-new-role">${roleOptions}</select>
          </label>
          <label class="gds-admin-field"><span>Mot de passe initial</span>
            <input id="gds-admin-acc-new-password" type="password" autocomplete="new-password" placeholder="mot de passe initial">
          </label>
        </div>
        <div class="gds-admin-actions">
          <button class="gds-admin-btn primary" id="gds-admin-acc-create"><i data-lucide="user-plus" class="icon-sm"></i> Créer le compte</button>
        </div>
        <div id="gds-admin-accounts-status">${renderAccountsStatusHtml(s)}</div>
        ${renderAccountsResetHtml(s)}
        ${renderAccountsTableHtml(s)}
        <div class="gds-admin-hint">Le mot de passe initial n'est jamais renvoyé à l'interface ni affiché ; il sert seulement à créer le compte sur le serveur. La désactivation du dernier administrateur actif est refusée par le serveur : son message d'erreur est relayé tel quel.</div>
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
  /** État de la section « Comptes » (L4.3) — jamais de mot de passe conservé. */
  let accounts = initialAccountsState();
  /** Identité admin de la dernière connexion réussie (hôte + email bruts) : la
   *  clé des identifiants mémorisés côté poste (repli du mot de passe). */
  let adminConn = null;
  let disposed = false;

  const q = (sel) => container.querySelector(sel);

  /** Récupère la saisie courante AVANT tout redessin (hors mot de passe, qui
   *  n'est lu qu'au moment de l'envoi puis oublié). */
  function readFields() {
    const host = q("#gds-admin-host");
    const port = q("#gds-admin-port");
    const email = q("#gds-admin-email");
    if (host) state.host = host.value;
    if (port) state.port = port.value;
    if (email) state.email = email.value;
  }

  /** Récupère la saisie de création AVANT tout redessin (sans mot de passe). */
  function captureAccountForm() {
    const email = q("#gds-admin-acc-new-email");
    const name = q("#gds-admin-acc-new-name");
    const role = q("#gds-admin-acc-new-role");
    if (email || name || role) {
      accounts.form = {
        email: email ? email.value : accounts.form.email,
        name: name ? name.value : accounts.form.name,
        role: role ? role.value : accounts.form.role,
      };
    }
  }

  function draw() {
    readFields();
    captureAccountForm();
    container.innerHTML = renderAdminShellHtml({
      title: "🖥️ GDS Serveur — administration",
      subtitle:
        "Gestion du serveur GDS (comptes, dépôts, journal, service). Cet onglet est indépendant du projet ouvert.",
      sections: ADMIN_SECTIONS,
      sectionHtml: {
        connection: renderConnectionSectionHtml(state),
        accounts: renderAccountsSectionHtml(accounts),
      },
    });
    refreshIcons(container);
    bind();
  }

  function bind() {
    const t = q("#gds-admin-test");
    const c = q("#gds-admin-connect");
    if (t) t.addEventListener("click", () => runConnectionTest(false));
    if (c) c.addEventListener("click", () => runConnectionTest(true));
    const refresh = q("#gds-admin-acc-refresh");
    if (refresh) refresh.addEventListener("click", () => loadAccounts());
    const create = q("#gds-admin-acc-create");
    if (create) create.addEventListener("click", () => createAccount());
    for (const btn of container.querySelectorAll("[data-acc-action]")) {
      btn.addEventListener("click", () => onAccountAction(btn));
    }
  }

  // ── L4.3 : actions sur les comptes (toutes via l'API HTTP du serveur) ──

  /** Émet une commande « comptes » et normalise l'erreur en objet JSON. */
  async function invokeAccounts(command, args) {
    try {
      return await invoke(command, args);
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e || "Erreur inattendue") };
    }
  }

  /** Charge la liste des comptes (nécessite une connexion admin réussie). */
  async function loadAccounts({ silent = false } = {}) {
    if (!adminConn) {
      accounts.error = "Connectez-vous d'abord au serveur (bloc « Connexion serveur »).";
      return draw();
    }
    if (!silent) {
      accounts.loading = true;
      accounts.error = "";
      accounts.notice = "";
    }
    draw();
    const res = await invokeAccounts("gds_admin_accounts", buildAccountListArgs(adminConn));
    if (disposed) return;
    accounts.loading = false;
    if (res && res.ok) {
      accounts.accounts = Array.isArray(res.users) ? res.users : [];
    } else {
      accounts.error = (res && res.error) || "Chargement des comptes impossible.";
    }
    draw();
  }

  /**
   * Exécute une opération d'administration d'un compte puis recharge la liste.
   * `success` produit le message de réussite ; les erreurs du serveur (dont le
   * garde-fou « dernier administrateur ») sont relayées telles quelles.
   */
  async function runAccountOp({ email, command, args, success, after }) {
    if (!adminConn) {
      accounts.error = "Connectez-vous d'abord au serveur (bloc « Connexion serveur »).";
      return draw();
    }
    accounts.busy = email || "__all__";
    accounts.error = "";
    accounts.notice = "";
    draw();
    const res = await invokeAccounts(command, args);
    if (disposed) return;
    accounts.busy = "";
    if (res && res.ok) {
      accounts.notice = success || "Opération effectuée.";
      if (after) after();
    } else {
      accounts.error = (res && res.error) || "Opération refusée par le serveur.";
    }
    await loadAccounts({ silent: true });
  }

  /** Crée un compte à partir du formulaire de la section. */
  async function createAccount() {
    const emailEl = q("#gds-admin-acc-new-email");
    const nameEl = q("#gds-admin-acc-new-name");
    const roleEl = q("#gds-admin-acc-new-role");
    const pwEl = q("#gds-admin-acc-new-password");
    const form = {
      email: emailEl ? emailEl.value : "",
      name: nameEl ? nameEl.value : "",
      role: roleEl ? roleEl.value : "dev",
      password: pwEl ? pwEl.value : "",
    };
    // Le mot de passe n'est jamais conservé dans l'état ; le reste est conservé
    // pour ne pas perdre la saisie en cas d'erreur de validation.
    accounts.form = { email: form.email, name: form.name, role: form.role };
    if (!String(form.email).trim()) {
      accounts.error = "Adresse (email) du compte requise.";
      return draw();
    }
    if (!form.password) {
      accounts.error = "Mot de passe initial requis.";
      return draw();
    }
    await runAccountOp({
      email: "__create__",
      command: "gds_admin_account_create",
      args: buildAccountCreateArgs(adminConn, form),
      success: `Compte « ${String(form.email).trim()} » créé.`,
      after: () => {
        accounts.form = { email: "", name: "", role: form.role };
      },
    });
  }

  /** Traite un clic d'action d'une ligne / du panneau de réinitialisation. */
  async function onAccountAction(btn) {
    const action = btn.getAttribute("data-acc-action");
    const email = btn.getAttribute("data-email") || "";
    if (action === "reset") {
      accounts.reset = { email, password: "" };
      accounts.error = "";
      accounts.notice = "";
      return draw();
    }
    if (action === "reset-cancel") {
      accounts.reset = { email: "", password: "" };
      return draw();
    }
    if (action === "role") {
      const sel = [...container.querySelectorAll(".gds-admin-acc-role")].find(
        (el) => el.getAttribute("data-email") === email
      );
      const role = sel ? sel.value : "";
      return runAccountOp({
        email,
        command: "gds_admin_account_set_role",
        args: buildAccountRoleArgs(adminConn, email, role),
        success: `Rôle de « ${email} » mis à jour.`,
      });
    }
    if (action === "toggle") {
      const status = btn.getAttribute("data-target") || "active";
      return runAccountOp({
        email,
        command: "gds_admin_account_set_status",
        args: buildAccountStatusArgs(adminConn, email, status),
        success: `Statut de « ${email} » mis à jour.`,
      });
    }
    if (action === "reset-save") {
      const pwEl = q("#gds-admin-acc-reset-password");
      const password = pwEl ? pwEl.value : "";
      if (!password) {
        accounts.error = "Nouveau mot de passe requis.";
        return draw();
      }
      return runAccountOp({
        email,
        command: "gds_admin_account_set_password",
        args: buildAccountPasswordArgs(adminConn, email, password),
        success: `Mot de passe de « ${email} » réinitialisé.`,
        after: () => {
          accounts.reset = { email: "", password: "" };
        },
      });
    }
  }

  async function runConnectionTest(memorize) {
    readFields();
    const connPwEl = q("#gds-admin-password");
    state.password = connPwEl ? connPwEl.value : "";
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
        // Identité admin utilisable pour les opérations sur les comptes : les
        // commandes s'appuient sur le mot de passe mémorisé (jamais renvoyé ni
        // conservé ici).
        adminConn = {
          host: String(state.host).trim(),
          httpPort: String(state.port || "").trim(),
          email: String(state.email).trim(),
        };
        accounts.error = "";
        accounts.notice = "";
        draw();
        loadAccounts({ silent: true });
        return;
      }
      state.ok = false;
      state.server = null;
      state.error = (res && res.error) || "Échec du test de connexion.";
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
