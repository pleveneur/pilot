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

/** Clé d'affichage d'un serveur d'administration mémorisé (`host|email`). Pure. */
export function adminServerOptionValue(s) {
  const sv = s || {};
  return `${String(sv.host || "").trim()}|${String(sv.email || "").trim()}`;
}

/**
 * Rend le SÉLECTEUR de serveur mémorisé de l'écran d'administration (lot 4) :
 * choisir explicitement parmi les serveurs mémorisés au lieu d'un
 * pré-remplissage silencieux par le premier de la liste. Chaîne vide si aucune
 * entrée : aucun sélecteur inutile. Pure — testable, aucun secret.
 */
export function renderAdminServerSelectorHtml(savedServers, current = {}) {
  const list = (Array.isArray(savedServers) ? savedServers : []).filter(
    (s) => s && String(s.host || "").trim(),
  );
  if (!list.length) return "";
  const cur = adminServerOptionValue(current);
  return `
          <label class="gds-admin-field"><span>Serveur mémorisé</span>
            <select id="gds-admin-server-select" class="gds-admin-select">
              <option value="">— saisie manuelle —</option>
              ${list
                .map((s) => {
                  const v = adminServerOptionValue(s);
                  const label = `${String(s.host || "").trim()} — ${String(s.email || "").trim()}`;
                  return `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(label)}</option>`;
                })
                .join("")}
            </select>
          </label>`;
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
        <div class="gds-admin-form">${renderAdminServerSelectorHtml(s.savedServers, s)}
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

// ─────────────────────────────────────────────────────────────────────────────
// L4.4 — « Dépôts / projets » : rendus purs (jamais de secret) et câblage
// ─────────────────────────────────────────────────────────────────────────────

/** Description affichée de la section « Dépôts / projets ». */
export const PROJECTS_DESC =
  "Projets enregistrés sur le serveur, dépôt bare associé et développeurs qui y sont attribués. Un développeur non administrateur ne voit QUE les projets qui lui sont attribués : l'attribution est la seule voie d'accès. Le retrait d'un projet est confirmé explicitement ; la purge du dépôt bare ne se fait que si vous la cochez.";

/** État initial de la section « Dépôts / projets » (pure). */
export function initialProjectsState() {
  return {
    projects: null, // null = liste jamais chargée
    repos: null, // dépôts git (bare_path par projet)
    loading: false,
    error: "",
    notice: "",
    selected: null, // id du projet déplié (membres)
    members: null, // membres du projet déplié (null = pas chargés)
    membersLoading: false,
    memberForm: { email: "", role: "dev" },
    removing: null, // { project_id, name, purge } : panneau de confirmation ouvert
    busy: "", // id du projet en cours d'opération
  };
}

/** Charge utile : lister les projets (identité admin, mot de passe mémorisé). Pure. */
export function buildProjectListArgs(conn) {
  return buildAccountsConnArgs(conn);
}

/** Charge utile : lister les dépôts git. Pure. */
export function buildGitReposArgs(conn) {
  return buildAccountsConnArgs(conn);
}

/** Charge utile : lister les membres attribués à un projet. Pure. */
export function buildProjectMembersArgs(conn, projectId) {
  return { ...buildAccountsConnArgs(conn), projectId: Number(projectId) };
}

/** Charge utile : attribuer un compte (email) à un projet. Pure. */
export function buildProjectAssignArgs(conn, projectId, email, role) {
  return {
    ...buildAccountsConnArgs(conn),
    projectId: Number(projectId),
    targetEmail: String(email || ""),
    targetRole: String(role || ""),
  };
}

/** Charge utile : retirer un compte d'un projet. Pure. */
export function buildProjectUnassignArgs(conn, projectId, email) {
  return {
    ...buildAccountsConnArgs(conn),
    projectId: Number(projectId),
    targetEmail: String(email || ""),
  };
}

/**
 * Charge utile : retirer un projet du serveur. `purge` est un drapeau EXPLICITE :
 * par défaut faux, le retrait ne détruit rien sur le disque. Pure — testable.
 */
export function buildProjectRemoveArgs(conn, projectId, purge) {
  return {
    ...buildAccountsConnArgs(conn),
    projectId: Number(projectId),
    purge: !!purge,
  };
}

/**
 * Texte de confirmation du retrait d'un projet (pure, testable). Dit
 * EXACTEMENT ce qui est détruit, et distingue clairement le retrait (entrées en
 * base) de la purge (dépôt bare sur le disque, irréversible).
 */
export function formatProjectRemoveConfirmation(project, purge) {
  const p = project || {};
  const name = String(p.name || p.project_id || "");
  const lines = [
    `Retirer le projet « ${name} » du serveur GDS.`,
    "Ses entrées en base seront supprimées : le projet, son dépôt associé, ses membres attribués et son suivi fusionné.",
  ];
  if (purge) {
    lines.push(
      "La purge est ACTIVÉE : le dépôt bare sera AUSSI supprimé du disque du serveur. Cette suppression est IRRÉVERSIBLE — le contenu du dépôt ne sera plus récupérable depuis le serveur."
    );
  } else {
    lines.push(
      "La purge est désactivée : le dépôt bare reste sur le disque du serveur (il n'est pas supprimé)."
    );
  }
  return lines.join(" ");
}

/** Trouve le dépôt associé à un projet (par `project_id`). Pure. */
export function findRepoForProject(repos, projectId) {
  for (const r of repos || []) {
    if (r && Number(r.project_id) === Number(projectId)) return r;
  }
  return null;
}

/** Rend la zone d'état de la section projets (pure, sans secret). */
export function renderProjectsStatusHtml(state = {}) {
  const s = { ...initialProjectsState(), ...state };
  if (s.loading) return `<div class="gds-admin-status loading">Chargement des projets…</div>`;
  if (s.error) return `<div class="gds-admin-status error">⚠️ ${esc(s.error)}</div>`;
  if (s.notice) return `<div class="gds-admin-status ok">${esc(s.notice)}</div>`;
  if (s.projects == null) {
    return `<div class="gds-admin-status idle">Connectez-vous au serveur pour afficher les projets.</div>`;
  }
  return `<div class="gds-admin-status idle">${s.projects.length} projet(s) sur ce serveur.</div>`;
}

/** Rend le tableau des projets (pure). */
export function renderProjectsTableHtml(state = {}) {
  const s = { ...initialProjectsState(), ...state };
  if (s.projects == null) return "";
  if (s.projects.length === 0) {
    return `<div class="gds-admin-section-placeholder">Aucun projet enregistré sur ce serveur.</div>`;
  }
  const rows = s.projects
    .map((p) => {
      const id = Number(p && p.id);
      const repo = findRepoForProject(s.repos, id);
      const busy = String(s.busy) === String(id);
      const dis = busy ? " disabled" : "";
      const open = String(s.selected) === String(id);
      const bare = repo && repo.bare_path ? repo.bare_path : "—";
      return `
      <tr data-project-id="${esc(id)}">
        <td class="gds-admin-cell-email">${esc((p && p.name) || "—")}</td>
        <td class="gds-admin-cell-path" title="${esc(bare)}">${esc(bare)}</td>
        <td class="gds-admin-cell-actions">
          <button class="gds-admin-btn small" data-prj-action="members" data-id="${esc(id)}"${dis}><i data-lucide="users" class="icon-sm"></i> ${open ? "Masquer" : "Membres"}</button>
          <button class="gds-admin-btn small danger" data-prj-action="remove" data-id="${esc(id)}"${dis}><i data-lucide="trash-2" class="icon-sm"></i> Retirer</button>
        </td>
      </tr>`;
    })
    .join("");
  return `
      <table class="gds-admin-table">
        <thead>
          <tr><th>Projet</th><th>Dépôt bare</th><th>Actions</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
}

/** Rend la liste des membres du projet déplié (pure). */
export function renderProjectMembersHtml(state = {}) {
  const s = { ...initialProjectsState(), ...state };
  if (s.selected == null) return "";
  const project = (s.projects || []).find((p) => String(p && p.id) === String(s.selected));
  const name = project ? project.name : `#${s.selected}`;
  const roleOptions = ACCOUNT_ROLES.map(
    (r) =>
      `<option value="${esc(r.value)}"${r.value === s.memberForm.role ? " selected" : ""}>${esc(r.label)}</option>`
  ).join("");
  let body;
  if (s.membersLoading) {
    body = `<div class="gds-admin-status loading">Chargement des membres…</div>`;
  } else if (s.members == null) {
    body = `<div class="gds-admin-status idle">Membres non chargés.</div>`;
  } else if (s.members.length === 0) {
    body = `<div class="gds-admin-section-placeholder">Aucun membre attribué : seuls les administrateurs voient ce projet.</div>`;
  } else {
    const rows = s.members
      .map(
        (m) => `
        <tr>
          <td class="gds-admin-cell-email">${esc((m && m.email) || "—")}</td>
          <td>${esc((m && m.name) || "—")}</td>
          <td><span class="gds-admin-badge">${esc((m && m.role) || "dev")}</span></td>
          <td class="gds-admin-cell-actions"><button class="gds-admin-btn small danger" data-mem-action="unassign" data-id="${esc(s.selected)}" data-email="${esc((m && m.email) || "")}"><i data-lucide="user-minus" class="icon-sm"></i> Retirer</button></td>
        </tr>`
      )
      .join("");
    body = `<table class="gds-admin-table"><thead><tr><th>Adresse</th><th>Nom</th><th>Rôle projet</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  return `
      <div class="gds-admin-members">
        <div class="gds-admin-reset-title">Développeurs attribués au projet <b>${esc(name)}</b></div>
        <div class="gds-admin-form gds-admin-form-create">
          <label class="gds-admin-field"><span>Adresse (email)</span>
            <input id="gds-admin-prj-member-email" type="text" autocomplete="off" placeholder="prenom.nom@exemple.com" value="${esc(s.memberForm.email)}">
          </label>
          <label class="gds-admin-field"><span>Rôle projet</span>
            <select id="gds-admin-prj-member-role">${roleOptions}</select>
          </label>
        </div>
        <div class="gds-admin-actions">
          <button class="gds-admin-btn primary small" data-mem-action="assign" data-id="${esc(s.selected)}"><i data-lucide="user-plus" class="icon-sm"></i> Attribuer</button>
        </div>
        ${body}
      </div>`;
}

/**
 * Rend le panneau de confirmation du retrait d'un projet (pure). Le texte
 * décrit exactement ce qui est détruit ; la case « purger » est décochée par
 * défaut (le retrait seul ne détruit rien sur le disque).
 */
export function renderProjectRemoveConfirmHtml(state = {}) {
  const s = { ...initialProjectsState(), ...state };
  if (!s.removing) return "";
  const project = (s.projects || []).find(
    (p) => String(p && p.id) === String(s.removing.project_id)
  ) || { name: s.removing.name, id: s.removing.project_id };
  return `
      <div class="gds-admin-confirm danger">
        <div class="gds-admin-reset-title">Confirmation — retrait de <b>${esc(project.name || s.removing.name || s.removing.project_id)}</b></div>
        <div class="gds-admin-section-desc">${esc(formatProjectRemoveConfirmation(project, !!s.removing.purge))}</div>
        <label class="gds-admin-check"><input type="checkbox" id="gds-admin-prj-purge"${s.removing.purge ? " checked" : ""}> Purger aussi le dépôt bare sur le disque (irréversible)</label>
        <div class="gds-admin-actions">
          <button class="gds-admin-btn danger" data-prj-action="remove-confirm" data-id="${esc(s.removing.project_id)}"><i data-lucide="trash-2" class="icon-sm"></i> Confirmer le retrait</button>
          <button class="gds-admin-btn" data-prj-action="remove-cancel"><i data-lucide="x" class="icon-sm"></i> Annuler</button>
        </div>
      </div>`;
}

/** Rend la section « Dépôts / projets » complète (pure, testable). */
export function renderProjectsSectionHtml(state = {}) {
  const base = initialProjectsState();
  const s = {
    ...base,
    ...state,
    memberForm: { ...base.memberForm, ...((state && state.memberForm) || {}) },
    removing: (state && state.removing) || null,
  };
  const count =
    s.projects == null ? "" : ` <span class="gds-admin-muted">(${s.projects.length})</span>`;
  return `
      <section class="gds-admin-section" data-section-id="repos">
        <div class="gds-admin-section-head">
          <div class="gds-admin-section-title"><i data-lucide="folder-git-2" class="icon-sm"></i> Dépôts / projets${count}</div>
          <button class="gds-admin-btn small" id="gds-admin-prj-refresh"><i data-lucide="refresh-cw" class="icon-sm"></i> Rafraîchir</button>
        </div>
        <div class="gds-admin-section-desc">${esc(PROJECTS_DESC)}</div>
        <div id="gds-admin-projects-status">${renderProjectsStatusHtml(s)}</div>
        ${renderProjectsTableHtml(s)}
        ${renderProjectMembersHtml(s)}
        ${renderProjectRemoveConfirmHtml(s)}
        <div class="gds-admin-hint">Attribuer un développeur est la seule façon de lui donner accès au projet. Le retrait d'un projet demande une confirmation explicite ; la purge du dépôt bare (destructive) ne se fait que si vous la cochez, jamais par défaut.</div>
      </section>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// L4.5 — « Espace utilisé + journal » : rendus purs et charges utiles
// ─────────────────────────────────────────────────────────────────────────────

/** Description du bloc « Espace utilisé + journal » (L4.5). */
export const STORAGE_DESC =
  "Espace occupé par les dépôts et la base, journal des connexions et des actions " +
  "d'administration (paginé et filtrable), et clefs SSH autorisées (révocables).";

/**
 * Portées du journal. « admin » = connexions + actions d'administration (défaut) ;
 * « all » = tout le journal d'audit (utile pour enquêter). Pure — testable.
 */
export const AUDIT_SCOPES = [
  { id: "admin", label: "Connexions & administration" },
  { id: "all", label: "Tout le journal" },
];

/** Taille de page du journal (le serveur borne à 200). */
export const AUDIT_PAGE_SIZE = 50;

/** État initial du bloc « Espace + journal » (L4.5). Aucun secret n'y figure. */
export function initialStorageState() {
  return {
    server: null,
    audit: null,
    auditTotal: 0,
    auditOffset: 0,
    auditScope: "admin",
    auditSearch: "",
    keys: null,
    loading: false,
    error: "",
    notice: "",
    busy: "",
    revoking: null,
  };
}

/** Charge utile de lecture de l'état serveur (espace occupé) — sans mot de passe. */
export function buildServerStatusArgs(conn) {
  return buildAccountsConnArgs(conn);
}

/**
 * Charge utile du journal d'audit (pure, testable). `offset` et `limit` sont des
 * nombres, `scope` vaut « admin » par défaut, `search` est la recherche libre.
 */
export function buildAuditArgs(
  conn,
  { offset = 0, limit = AUDIT_PAGE_SIZE, scope = "admin", search = "" } = {}
) {
  return {
    ...buildAccountsConnArgs(conn),
    offset: Math.max(0, Number(offset) || 0),
    limit: Math.min(200, Math.max(1, Number(limit) || AUDIT_PAGE_SIZE)),
    scope: scope === "all" ? "all" : "admin",
    search: String(search == null ? "" : search),
  };
}

/** Charge utile de lecture des clefs SSH — sans mot de passe. */
export function buildSshKeysArgs(conn) {
  return buildAccountsConnArgs(conn);
}

/** Charge utile de révocation d'une clef SSH (identifiant strictement positif). */
export function buildSshKeyRevokeArgs(conn, keyId) {
  return { ...buildAccountsConnArgs(conn), keyId: Number(keyId) };
}

/**
 * Formate un horodatage d'audit (millisecondes epoch) en chaîne locale lisible.
 * `null`/absurde → « — ». Pure — testable.
 */
export function formatAuditTime(ts) {
  if (ts == null || typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) return "—";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "—";
  }
}

/**
 * Raccourcit une clef publique pour l'affichage (la valeur complète reste dans
 * l'attribut `title`). Pure — testable.
 */
export function shortPublicKey(key, max = 46) {
  const s = String(key == null ? "" : key);
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

/** Une ligne du journal d'audit (pure). */
function auditRowHtml(e) {
  const ok = !e || e.ok !== false;
  const detail = (e && e.detail) || "";
  return `
        <tr>
          <td class="gds-admin-cell-date">${esc(formatAuditTime(e && e.ts))}</td>
          <td><span class="gds-admin-badge ${ok ? "ok" : "warn"}">${esc((e && e.action) || "—")}</span></td>
          <td class="gds-admin-cell-path" title="${esc(detail)}">${esc(detail)}</td>
          <td class="gds-admin-cell-date">${esc((e && e.ip) || "")}</td>
          <td>${ok ? "✓" : "✗"}</td>
        </tr>`;
}

/**
 * Rend l'état du bloc « Espace + journal » (pure, testable). Ne reçoit que
 * l'état local : aucun secret.
 */
export function renderStorageStatusHtml(state = {}) {
  const s = { ...initialStorageState(), ...state };
  if (s.loading) return `<div class="gds-admin-status loading">Chargement de l'état du serveur…</div>`;
  if (s.error) return `<div class="gds-admin-status error">⚠️ ${esc(s.error)}</div>`;
  if (s.notice) return `<div class="gds-admin-status ok">${esc(s.notice)}</div>`;
  if (s.server == null) {
    return `<div class="gds-admin-status idle">Connectez-vous au serveur pour afficher l'espace utilisé et le journal.</div>`;
  }
  return `<div class="gds-admin-status idle">État du serveur chargé.</div>`;
}

/** Rend l'espace occupé (dépôts + base + total) (pure). */
export function renderSpaceHtml(state = {}) {
  const s = { ...initialStorageState(), ...state };
  const sv = s.server;
  if (!sv) return "";
  const repos = typeof sv.repos_bytes === "number" ? sv.repos_bytes : null;
  const db = typeof sv.db_bytes === "number" ? sv.db_bytes : null;
  const total = repos != null && db != null ? repos + db : null;
  return `
      <div class="gds-admin-metrics gds-admin-space">
        <span><b>Espace dépôts</b> ${esc(formatBytes(repos))}</span>
        <span><b>Espace base</b> ${esc(formatBytes(db))}</span>
        <span><b>Total</b> ${esc(formatBytes(total))}</span>
      </div>`;
}

/** Rend le tableau du journal d'audit + sa pagination (pure). */
export function renderAuditTableHtml(state = {}) {
  const s = { ...initialStorageState(), ...state };
  const scopes = AUDIT_SCOPES.map(
    (sc) =>
      `<button class="gds-admin-btn small${s.auditScope === sc.id ? " primary" : ""}" data-audit-scope="${esc(sc.id)}">${esc(sc.label)}</button>`
  ).join("");
  const entries = Array.isArray(s.audit) ? s.audit : null;
  let rows;
  if (entries == null) {
    rows = `<tr><td colspan="5" class="gds-admin-muted">Journal non chargé.</td></tr>`;
  } else if (entries.length === 0) {
    rows = `<tr><td colspan="5" class="gds-admin-muted">Aucune entrée pour ce filtre.</td></tr>`;
  } else {
    rows = entries.map(auditRowHtml).join("");
  }
  const total = Number(s.auditTotal) || 0;
  const start = total === 0 ? 0 : s.auditOffset + 1;
  const end = Math.min(s.auditOffset + AUDIT_PAGE_SIZE, total);
  const prev = s.auditOffset <= 0 ? " disabled" : "";
  const next = s.auditOffset + AUDIT_PAGE_SIZE >= total ? " disabled" : "";
  return `
      <div class="gds-admin-block">
        <div class="gds-admin-reset-title"><i data-lucide="scroll-text" class="icon-sm"></i> Journal des connexions & actions</div>
        <div class="gds-admin-actions gds-admin-audit-bar">
          ${scopes}
          <input id="gds-admin-audit-search" class="gds-admin-acc-role" type="text" placeholder="Rechercher (action, IP, détail)…" value="${esc(s.auditSearch)}">
          <button class="gds-admin-btn small" data-audit-action="search"><i data-lucide="search" class="icon-sm"></i> Filtrer</button>
        </div>
        <table class="gds-admin-table">
          <thead><tr><th>Date</th><th>Action</th><th>Détail</th><th>IP</th><th>Résultat</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="gds-admin-pager">
          <button class="gds-admin-btn small" data-audit-page="prev"${prev}><i data-lucide="chevron-left" class="icon-sm"></i> Précédent</button>
          <span class="gds-admin-muted">${esc(String(start))}–${esc(String(end))} sur ${esc(String(total))}</span>
          <button class="gds-admin-btn small" data-audit-page="next"${next}>Suivant <i data-lucide="chevron-right" class="icon-sm"></i></button>
        </div>
      </div>`;
}

/** Une ligne de clef SSH (pure). */
function sshKeyRowHtml(k) {
  const id = Number(k && k.id);
  const key = (k && k.public_key) || "";
  return `
        <tr data-key-id="${esc(id)}">
          <td class="gds-admin-cell-date">${esc(String(id))}</td>
          <td class="gds-admin-cell-email">${esc((k && k.email) || "—")}</td>
          <td class="gds-admin-cell-path" title="${esc(key)}">${esc(shortPublicKey(key))}</td>
          <td class="gds-admin-cell-date">${esc((k && k.created_at) || "—")}</td>
          <td class="gds-admin-cell-actions"><button class="gds-admin-btn small danger" data-ssh-action="revoke" data-id="${esc(id)}" data-email="${esc((k && k.email) || "")}"><i data-lucide="key-round" class="icon-sm"></i> Révoquer</button></td>
        </tr>`;
}

/** Rend la liste des clefs SSH autorisées (pure). */
export function renderSshKeysTableHtml(state = {}) {
  const s = { ...initialStorageState(), ...state };
  const keys = Array.isArray(s.keys) ? s.keys : null;
  let rows;
  if (keys == null) {
    rows = `<tr><td colspan="5" class="gds-admin-muted">Clefs non chargées.</td></tr>`;
  } else if (keys.length === 0) {
    rows = `<tr><td colspan="5" class="gds-admin-muted">Aucune clef SSH enregistrée.</td></tr>`;
  } else {
    rows = keys.map(sshKeyRowHtml).join("");
  }
  const count = keys == null ? "—" : String(keys.length);
  return `
      <div class="gds-admin-block">
        <div class="gds-admin-reset-title"><i data-lucide="key-round" class="icon-sm"></i> Clefs SSH autorisées <span class="gds-admin-muted">(${esc(count)})</span></div>
        <table class="gds-admin-table">
          <thead><tr><th>#</th><th>Propriétaire</th><th>Clef publique</th><th>Ajoutée</th><th>Action</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
}

/**
 * Rend le panneau de confirmation de la révocation d'une clef SSH (pure). Le
 * texte décrit exactement l'effet (suppression + `authorized_keys` régénéré) et
 * rappelle que l'action est irréversible.
 */
export function renderSshKeyRevokeConfirmHtml(state = {}) {
  const s = { ...initialStorageState(), ...state };
  if (!s.revoking) return "";
  const k = s.revoking;
  return `
      <div class="gds-admin-confirm danger">
        <div class="gds-admin-reset-title">Confirmation — révocation de la clef de <b>${esc(k.email || "—")}</b></div>
        <div class="gds-admin-section-desc">La clef publique sera supprimée de la base du serveur et le fichier <b>authorized_keys</b> régénéré immédiatement : l'accès SSH par cette clef est refusé dès maintenant. Cette action est irréversible ; le propriétaire devra enregistrer une nouvelle clef.</div>
        <div class="gds-admin-actions">
          <button class="gds-admin-btn danger" data-ssh-action="revoke-confirm" data-id="${esc(String(k.id))}"><i data-lucide="key-round" class="icon-sm"></i> Révoquer définitivement</button>
          <button class="gds-admin-btn" data-ssh-action="revoke-cancel"><i data-lucide="x" class="icon-sm"></i> Annuler</button>
        </div>
      </div>`;
}

/** Rend la section « Espace utilisé + journal » complète (pure, testable). */
export function renderStorageSectionHtml(state = {}) {
  const base = initialStorageState();
  const s = { ...base, ...state };
  return `
      <section class="gds-admin-section" data-section-id="storage">
        <div class="gds-admin-section-head">
          <div class="gds-admin-section-title"><i data-lucide="hard-drive" class="icon-sm"></i> Espace utilisé + journal</div>
          <button class="gds-admin-btn small" id="gds-admin-sto-refresh"><i data-lucide="refresh-cw" class="icon-sm"></i> Rafraîchir</button>
        </div>
        <div class="gds-admin-section-desc">${esc(STORAGE_DESC)}</div>
        <div id="gds-admin-storage-status">${renderStorageStatusHtml(s)}</div>
        ${renderSpaceHtml(s)}
        ${renderAuditTableHtml(s)}
        ${renderSshKeysTableHtml(s)}
        ${renderSshKeyRevokeConfirmHtml(s)}
        <div class="gds-admin-hint">Le journal provient de l'audit du serveur (connexions, révocations, actions d'administration) ; les entrées les plus récentes sont en tête. Révoquer une clef régénère le fichier des clefs autorisées du serveur : l'accès SSH est coupé immédiatement, sans attendre.</div>
      </section>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// L4.6 — « Contrôle du service » : rendus purs, garde de rôle et charges utiles
// ─────────────────────────────────────────────────────────────────────────────
//
// Les actions de service (redémarrer / arrêter) appellent les routes L2.10 du
// serveur, réservées au rôle `admin`. Elles ne partent JAMAIS d'un seul clic :
// le premier clic ouvre un panneau de **double confirmation** qui décrit
// exactement ce qui va se passer ; l'action n'est envoyée qu'après une case
// d'acquittement cochée puis un second clic (« Confirmer »).
//
// Après l'action, l'écran suit la santé **publique** (`/api/gds/health`, sans
// jeton) : un redémarrage invalide les sessions en mémoire du serveur, donc une
// sonde authentifiée conclurait à tort que le serveur ne répond pas.

/** Description de la section « Contrôle du service » (L4.6). */
export const SERVICE_DESC =
  "Redémarrer ou arrêter le service GDS (gds-server et sshd) — la base PostgreSQL " +
  "n'est jamais arrêtée. Chaque action exige une double confirmation explicite, puis " +
  "l'écran re-teste automatiquement la santé du service.";

/** Intervalle entre deux sondes de santé (ms) — re-test après une action. */
export const SERVICE_HEALTH_INTERVAL_MS = 1500;
/** Nombre maximal de sondes avant d'abandonner le suivi de santé (L4.6). */
export const SERVICE_HEALTH_MAX_ATTEMPTS = 20;
/** Sondes injoignables consécutives confirmant un arrêt effectif (L4.6). */
export const SERVICE_STOP_CONFIRM_ATTEMPTS = 2;

/**
 * État initial du bloc « Contrôle du service » (L4.6). Aucun secret n'y figure :
 * ni mot de passe, ni jeton — les commandes n'en renvoient jamais.
 */
export function initialServiceState() {
  return {
    role: "",
    status: null,
    loading: false,
    error: "",
    notice: "",
    confirm: null,
    busy: "",
    waiting: null,
    health: null,
    attempts: 0,
    stopped: false,
  };
}

/**
 * L'écran peut-il piloter le service ? Réservé au rôle `admin` (connu depuis la
 * connexion L4.2). Hors administrateur, les boutons sont masqués. Pure.
 */
export function canControlService(role) {
  return String(role == null ? "" : role).trim().toLowerCase() === "admin";
}

/** Charge utile de lecture de l'état du service — connexion admin, sans mot de passe. */
export function buildServiceStatusArgs(conn) {
  return buildAccountsConnArgs(conn);
}

/**
 * Texte de double confirmation d'une action de service (pure). Il dit clairement
 * ce qui va se passer, notamment que l'arrêt interrompt l'accès des autres
 * utilisateurs et les synchronisations, et que les comptes, projets et dépôts
 * sont CONSERVÉS (la base PostgreSQL n'est jamais arrêtée).
 */
export function serviceConfirmText(action) {
  if (action === "stop") {
    return (
      "Arrêter le service : gds-server et sshd sont arrêtés jusqu'à un redémarrage manuel. " +
      "L'accès des autres utilisateurs et les synchronisations des projets sont interrompus. " +
      "Les comptes, les projets et les dépôts sont CONSERVÉS — la base PostgreSQL n'est jamais arrêtée."
    );
  }
  return (
    "Redémarrer le service : gds-server et sshd sont redémarrés. " +
    "L'accès des autres utilisateurs et les synchronisations des projets sont brièvement interrompus. " +
    "Les comptes, les projets et les dépôts sont CONSERVÉS — la base PostgreSQL n'est jamais arrêtée."
  );
}

/** Classe de badge d'un état de programme `supervisorctl` (pure). */
function programStateClass(state) {
  const v = String(state == null ? "" : state).toUpperCase();
  if (v === "RUNNING") return "ok";
  if (v === "STOPPED" || v === "FATAL" || v === "EXITED") return "warn";
  return "";
}

/**
 * Rend l'état du bloc « Contrôle du service » (pure, testable). Distingue le
 * suivi d'un redémarrage (`waiting = "up"`), d'un arrêt (`waiting = "down"`),
 * l'arrêt confirmé (`stopped`), l'erreur et la notice.
 */
export function renderServiceStatusHtml(state = {}) {
  const s = { ...initialServiceState(), ...state };
  if (s.loading) return `<div class="gds-admin-status loading">Interrogation du service…</div>`;
  if (s.waiting === "up") {
    return `<div class="gds-admin-status loading">Redémarrage en cours — re-test de la santé… (tentative ${esc(String(s.attempts))}/${esc(String(SERVICE_HEALTH_MAX_ATTEMPTS))})</div>`;
  }
  if (s.waiting === "down") {
    return `<div class="gds-admin-status loading">Arrêt demandé — vérification que le service ne répond plus… (${esc(String(s.attempts))})</div>`;
  }
  if (s.error) return `<div class="gds-admin-status error">⚠️ ${esc(s.error)}</div>`;
  if (s.stopped) {
    return `<div class="gds-admin-status error">⛔ Serveur arrêté — la sonde de santé ne répond plus. La base PostgreSQL, elle, n'est pas arrêtée.</div>`;
  }
  if (s.notice) return `<div class="gds-admin-status ok">${esc(s.notice)}</div>`;
  if (s.status) {
    return `<div class="gds-admin-status ok">Service joignable — processus ${esc(numOrDash(s.status.pid))}.</div>`;
  }
  return `<div class="gds-admin-status idle">Connectez-vous au serveur pour afficher l'état du service.</div>`;
}

/**
 * Rend la liste des programmes pilotés et leur état (pure). Aucun programme
 * PostgreSQL : le service ne le pilote jamais.
 */
export function renderServiceProgramsHtml(state = {}) {
  const s = { ...initialServiceState(), ...state };
  const st = s.status;
  if (!st) return "";
  if (st.error) {
    return `<div class="gds-admin-status error">⚠️ ${esc(st.error)}</div>`;
  }
  const states = Array.isArray(st.states) ? st.states : [];
  if (states.length === 0) return "";
  const rows = states
    .map(
      (p) => `
        <tr>
          <td>${esc((p && p.name) || "—")}</td>
          <td><span class="gds-admin-badge ${programStateClass(p && p.state)}">${esc((p && p.state) || "—")}</span></td>
          <td class="gds-admin-cell-date">${esc(p && p.pid != null ? String(p.pid) : "—")}</td>
        </tr>`
    )
    .join("");
  return `
      <div class="gds-admin-block">
        <div class="gds-admin-reset-title"><i data-lucide="activity" class="icon-sm"></i> Programmes pilotés <span class="gds-admin-muted">(processus ${esc(numOrDash(st.pid))})</span></div>
        <table class="gds-admin-table">
          <thead><tr><th>Programme</th><th>État</th><th>PID</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
}

/**
 * Rend le panneau de double confirmation (pure). Aucune action n'est proposée
 * sans passer par lui ; le bouton « Confirmer » reste désactivé tant que la case
 * d'acquittement n'est pas cochée (second geste explicite).
 */
export function renderServiceConfirmHtml(state = {}) {
  const s = { ...initialServiceState(), ...state };
  if (!s.confirm) return "";
  const action = s.confirm.action === "stop" ? "stop" : "restart";
  const label = action === "stop" ? "Arrêter le service" : "Redémarrer le service";
  const noun = action === "stop" ? "l'arrêt" : "le redémarrage";
  const disabled = s.confirm.ack ? "" : " disabled";
  return `
      <div class="gds-admin-confirm danger">
        <div class="gds-admin-reset-title">Double confirmation — ${esc(label)}</div>
        <div class="gds-admin-section-desc">${esc(serviceConfirmText(action))}</div>
        <label class="gds-admin-check"><input type="checkbox" id="gds-admin-svc-ack"${s.confirm.ack ? " checked" : ""}> Je comprends que ${esc(noun)} du service interrompt l'accès des autres utilisateurs et les synchronisations.</label>
        <div class="gds-admin-actions">
          <button class="gds-admin-btn danger" data-svc-action="${esc(action)}-confirm"${disabled}><i data-lucide="power" class="icon-sm"></i> Confirmer — ${esc(label)}</button>
          <button class="gds-admin-btn" data-svc-action="cancel"><i data-lucide="x" class="icon-sm"></i> Annuler</button>
        </div>
      </div>`;
}

/**
 * Rend la section « Contrôle du service » complète (pure, testable). `role` est
 * le rôle du compte connecté : hors `admin`, les boutons et le panneau de
 * confirmation sont MASQUÉS et un message explique pourquoi.
 */
export function renderServiceSectionHtml(state = {}, role = "") {
  const roleValue = String(role || (state && state.role) || "");
  const s = { ...initialServiceState(), ...state, role: roleValue };
  const allowed = canControlService(roleValue);
  const reserved = allowed
    ? ""
    : `<div class="gds-admin-status idle">Actions masquées : elles sont réservées au rôle administrateur.${s.role ? ` Rôle connecté : ${esc(s.role)}.` : " Connectez-vous avec un compte administrateur."}</div>`;
  const actions = allowed
    ? `
        ${renderServiceProgramsHtml(s)}
        ${renderServiceConfirmHtml(s)}
        <div class="gds-admin-actions">
          <button class="gds-admin-btn" data-svc-action="restart"><i data-lucide="rotate-cw" class="icon-sm"></i> Redémarrer le service</button>
          <button class="gds-admin-btn danger" data-svc-action="stop"><i data-lucide="power" class="icon-sm"></i> Arrêter le service</button>
        </div>
        <div class="gds-admin-hint">Rien ne part au premier clic : la double confirmation décrit exactement ce qui va se passer. L'arrêt interrompt l'accès des autres utilisateurs et les synchronisations ; les comptes, les projets et les dépôts sont conservés et la base PostgreSQL n'est jamais arrêtée.</div>`
    : "";
  return `
      <section class="gds-admin-section" data-section-id="service">
        <div class="gds-admin-section-head">
          <div class="gds-admin-section-title"><i data-lucide="power" class="icon-sm"></i> Contrôle du service</div>
          ${allowed ? `<button class="gds-admin-btn small" id="gds-admin-svc-refresh"><i data-lucide="refresh-cw" class="icon-sm"></i> Rafraîchir</button>` : ""}
        </div>
        <div class="gds-admin-section-desc">${esc(SERVICE_DESC)}</div>
        <div id="gds-admin-service-status">${renderServiceStatusHtml(s)}</div>
        ${reserved}
        ${actions}
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
  /** État de la section « Dépôts / projets » (L4.4) — jamais de secret. */
  let projects = initialProjectsState();
  /** État de la section « Espace utilisé + journal » (L4.5) — jamais de secret. */
  let storage = initialStorageState();
  /** État de la section « Contrôle du service » (L4.6) — jamais de secret. */
  let service = initialServiceState();
  /** Identité admin de la dernière connexion réussie (hôte + email bruts) : la
   *  clé des identifiants mémorisés côté poste (repli du mot de passe). */
  let adminConn = null;
  let disposed = false;

  const q = (sel) => container.querySelector(sel);

  /** Récupère la saisie AVANT tout redessin (hors mot de passe, qui n'est lu
   *  qu'au moment de l'envoi puis oublié). */
  function readFields() {
    const host = q("#gds-admin-host");
    const port = q("#gds-admin-port");
    const email = q("#gds-admin-email");
    if (host) state.host = host.value;
    if (port) state.port = port.value;
    if (email) state.email = email.value;
  }

  /** Récupère la saisie du bloc « Dépôts / projets » AVANT tout redessin. */
  function readProjectFields() {
    const email = q("#gds-admin-prj-member-email");
    const role = q("#gds-admin-prj-member-role");
    if (email || role) {
      projects.memberForm = {
        email: email ? email.value : projects.memberForm.email,
        role: role ? role.value : projects.memberForm.role,
      };
    }
    const purge = q("#gds-admin-prj-purge");
    if (purge && projects.removing) {
      projects.removing = { ...projects.removing, purge: !!purge.checked };
    }
  }

  /** Récupère la saisie du bloc « Espace + journal » AVANT tout redessin. */
  function readStorageFields() {
    const search = q("#gds-admin-audit-search");
    if (search) storage.auditSearch = search.value;
  }

  /** Récupère la case d'acquittement de la double confirmation (L4.6) AVANT redessin. */
  function readServiceFields() {
    const ack = q("#gds-admin-svc-ack");
    if (ack && service.confirm) {
      service.confirm = { ...service.confirm, ack: !!ack.checked };
    }
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
    readProjectFields();
    readStorageFields();
    readServiceFields();
    // Rôle connu du compte connecté (L4.6 : pilote le masquage des actions).
    service.role = String((state.server && state.server.role) || adminConn?.role || "");
    container.innerHTML = renderAdminShellHtml({
      title: "🖥️ GDS Serveur — administration",
      subtitle:
        "Gestion du serveur GDS (comptes, dépôts, journal, service). Cet onglet est indépendant du projet ouvert.",
      sections: ADMIN_SECTIONS,
      sectionHtml: {
        connection: renderConnectionSectionHtml(state),
        accounts: renderAccountsSectionHtml(accounts),
        repos: renderProjectsSectionHtml(projects),
        storage: renderStorageSectionHtml(storage),
        service: renderServiceSectionHtml(service),
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
    const srvSel = q("#gds-admin-server-select");
    if (srvSel) srvSel.addEventListener("change", () => onServerSelectChange(srvSel));
    if (refresh) refresh.addEventListener("click", () => loadAccounts());
    const create = q("#gds-admin-acc-create");
    if (create) create.addEventListener("click", () => createAccount());
    for (const btn of container.querySelectorAll("[data-acc-action]")) {
      btn.addEventListener("click", () => onAccountAction(btn));
    }
    const prjRefresh = q("#gds-admin-prj-refresh");
    if (prjRefresh) prjRefresh.addEventListener("click", () => loadProjects());
    for (const btn of container.querySelectorAll("[data-prj-action]")) {
      btn.addEventListener("click", () => onProjectAction(btn));
    }
    for (const btn of container.querySelectorAll("[data-mem-action]")) {
      btn.addEventListener("click", () => onMemberAction(btn));
    }
    const purge = q("#gds-admin-prj-purge");
    if (purge) purge.addEventListener("change", () => draw());
    // ── L4.5 : espace + journal + clefs SSH ──
    const stoRefresh = q("#gds-admin-sto-refresh");
    if (stoRefresh) stoRefresh.addEventListener("click", () => loadStorage());
    for (const btn of container.querySelectorAll("[data-audit-scope]")) {
      btn.addEventListener("click", () => onAuditScope(btn));
    }
    const auditSearch = q("#gds-admin-audit-search");
    if (auditSearch) {
      auditSearch.addEventListener("keydown", (e) => {
        if (e.key === "Enter") runAuditSearch();
      });
    }
    for (const btn of container.querySelectorAll("[data-audit-action]")) {
      btn.addEventListener("click", () => runAuditSearch());
    }
    for (const btn of container.querySelectorAll("[data-audit-page]")) {
      btn.addEventListener("click", () => onAuditPage(btn));
    }
    for (const btn of container.querySelectorAll("[data-ssh-action]")) {
      btn.addEventListener("click", () => onSshKeyAction(btn));
    }
    // ── L4.6 : contrôle du service (double confirmation) ──
    const svcRefresh = q("#gds-admin-svc-refresh");
    if (svcRefresh) svcRefresh.addEventListener("click", () => loadServiceStatus());
    for (const btn of container.querySelectorAll("[data-svc-action]")) {
      btn.addEventListener("click", () => onServiceAction(btn));
    }
    const svcAck = q("#gds-admin-svc-ack");
    if (svcAck) svcAck.addEventListener("change", () => draw());
  }

  // ── L4.4 : projets & dépôts (toutes via l'API HTTP du serveur) ──

  /** Charge les projets et leurs dépôts (nécessite une connexion admin). */
  async function loadProjects({ silent = false } = {}) {
    if (!adminConn) {
      projects.error = "Connectez-vous d'abord au serveur (bloc « Connexion serveur »).";
      return draw();
    }
    if (!silent) {
      projects.loading = true;
      projects.error = "";
      projects.notice = "";
    }
    draw();
    const [pr, rr] = await Promise.all([
      invokeAccounts("gds_admin_projects", buildProjectListArgs(adminConn)),
      invokeAccounts("gds_admin_git_repos", buildGitReposArgs(adminConn)),
    ]);
    if (disposed) return;
    projects.loading = false;
    if (pr && pr.ok) {
      projects.projects = Array.isArray(pr.projects) ? pr.projects : [];
    } else {
      projects.error = (pr && pr.error) || "Chargement des projets impossible.";
    }
    projects.repos = rr && rr.ok && Array.isArray(rr.git_repos) ? rr.git_repos : [];
    draw();
  }

  /** Charge les membres du projet déplié. */
  async function loadMembers(projectId, { silent = false } = {}) {
    if (!adminConn) return;
    if (!silent) projects.membersLoading = true;
    draw();
    const res = await invokeAccounts(
      "gds_admin_project_members",
      buildProjectMembersArgs(adminConn, projectId)
    );
    if (disposed) return;
    projects.membersLoading = false;
    if (res && res.ok) {
      projects.members = Array.isArray(res.members) ? res.members : [];
    } else {
      projects.members = [];
      projects.error = (res && res.error) || "Chargement des membres impossible.";
    }
    draw();
  }

  /** Exécute une opération sur un projet puis recharge la liste. */
  async function runProjectOp({ id, command, args, success, after }) {
    if (!adminConn) {
      projects.error = "Connectez-vous d'abord au serveur (bloc « Connexion serveur »).";
      return draw();
    }
    projects.busy = id != null ? String(id) : "__all__";
    projects.error = "";
    projects.notice = "";
    draw();
    const res = await invokeAccounts(command, args);
    if (disposed) return;
    projects.busy = "";
    if (res && res.ok) {
      projects.notice = success || "Opération effectuée.";
      if (after) after();
    } else {
      projects.error = (res && res.error) || "Opération refusée par le serveur.";
    }
    await loadProjects({ silent: true });
    if (projects.selected != null) await loadMembers(projects.selected, { silent: true });
  }

  /** Traite un clic du bloc « Dépôts / projets ». */
  async function onProjectAction(btn) {
    const action = btn.getAttribute("data-prj-action");
    const id = btn.getAttribute("data-id");
    if (action === "members") {
      if (String(projects.selected) === String(id)) {
        projects.selected = null;
        projects.members = null;
        return draw();
      }
      projects.selected = Number(id);
      projects.members = null;
      projects.memberForm = { email: "", role: "dev" };
      projects.error = "";
      projects.notice = "";
      draw();
      return loadMembers(projects.selected);
    }
    if (action === "remove") {
      const project = (projects.projects || []).find((p) => String(p && p.id) === String(id));
      projects.removing = {
        project_id: Number(id),
        name: project ? project.name : "",
        purge: false,
      };
      projects.error = "";
      projects.notice = "";
      return draw();
    }
    if (action === "remove-cancel") {
      projects.removing = null;
      return draw();
    }
    if (action === "remove-confirm") {
      const removing = projects.removing || { project_id: Number(id), purge: false };
      const purge = !!removing.purge;
      return runProjectOp({
        id: removing.project_id,
        command: "gds_admin_project_remove",
        args: buildProjectRemoveArgs(adminConn, removing.project_id, purge),
        success: purge
          ? `Projet retiré du serveur (dépôt bare purgé).`
          : `Projet retiré du serveur (dépôt bare conservé sur le disque).`,
        after: () => {
          projects.removing = null;
          if (String(projects.selected) === String(removing.project_id)) {
            projects.selected = null;
            projects.members = null;
          }
        },
      });
    }
  }

  /** Traite un clic du panneau des membres (attribution / retrait). */
  async function onMemberAction(btn) {
    const action = btn.getAttribute("data-mem-action");
    const id = Number(btn.getAttribute("data-id"));
    if (action === "assign") {
      const emailEl = q("#gds-admin-prj-member-email");
      const roleEl = q("#gds-admin-prj-member-role");
      const email = emailEl ? emailEl.value.trim() : "";
      const role = roleEl ? roleEl.value : "dev";
      if (!email) {
        projects.error = "Adresse (email) du développeur requise.";
        return draw();
      }
      return runProjectOp({
        id,
        command: "gds_admin_project_assign",
        args: buildProjectAssignArgs(adminConn, id, email, role),
        success: `« ${email} » attribué au projet.`,
        after: () => {
          projects.memberForm = { email: "", role };
        },
      });
    }
    if (action === "unassign") {
      const email = btn.getAttribute("data-email") || "";
      return runProjectOp({
        id,
        command: "gds_admin_project_unassign",
        args: buildProjectUnassignArgs(adminConn, id, email),
        success: `« ${email} » retiré du projet.`,
      });
    }
  }

  // ── L4.5 : espace utilisé, journal d'audit, clefs SSH (via l'API HTTP) ──

  /** Charge l'état serveur (espace), le journal et les clefs SSH. */
  async function loadStorage({ silent = false } = {}) {
    if (!adminConn) {
      storage.error = "Connectez-vous d'abord au serveur (bloc « Connexion serveur »).";
      return draw();
    }
    if (!silent) {
      storage.loading = true;
      storage.error = "";
      storage.notice = "";
    }
    draw();
    const [sr, ar, kr] = await Promise.all([
      invokeAccounts("gds_admin_server", buildServerStatusArgs(adminConn)),
      invokeAccounts(
        "gds_admin_audit",
        buildAuditArgs(adminConn, {
          offset: storage.auditOffset,
          limit: AUDIT_PAGE_SIZE,
          scope: storage.auditScope,
          search: storage.auditSearch,
        })
      ),
      invokeAccounts("gds_admin_ssh_keys", buildSshKeysArgs(adminConn)),
    ]);
    if (disposed) return;
    storage.loading = false;
    if (sr && sr.ok) {
      storage.server = sr;
    } else {
      storage.error = (sr && sr.error) || "État du serveur indisponible.";
    }
    if (ar && ar.ok) {
      storage.audit = Array.isArray(ar.entries) ? ar.entries : [];
      storage.auditTotal = Number(ar.total) || 0;
    } else {
      storage.error = storage.error || (ar && ar.error) || "Journal indisponible.";
    }
    if (kr && kr.ok && Array.isArray(kr.keys)) {
      storage.keys = kr.keys;
    } else if (kr && !kr.ok) {
      storage.error = storage.error || kr.error || "Liste des clefs indisponible.";
    }
    draw();
  }

  /** Recharge seulement le journal (après filtre ou changement de page). */
  async function loadAudit({ silent = false } = {}) {
    if (!adminConn) return;
    if (!silent) {
      storage.loading = true;
      storage.error = "";
      storage.notice = "";
    }
    draw();
    const ar = await invokeAccounts(
      "gds_admin_audit",
      buildAuditArgs(adminConn, {
        offset: storage.auditOffset,
        limit: AUDIT_PAGE_SIZE,
        scope: storage.auditScope,
        search: storage.auditSearch,
      })
    );
    if (disposed) return;
    storage.loading = false;
    if (ar && ar.ok) {
      storage.audit = Array.isArray(ar.entries) ? ar.entries : [];
      storage.auditTotal = Number(ar.total) || 0;
    } else {
      storage.error = (ar && ar.error) || "Journal indisponible.";
    }
    draw();
  }

  /** Applique le filtre de recherche saisi (retour à la première page). */
  function runAuditSearch() {
    const el = q("#gds-admin-audit-search");
    storage.auditSearch = el ? el.value : storage.auditSearch;
    storage.auditOffset = 0;
    return loadAudit();
  }

  /** Bascule la portée du journal (« admin » / « all »). */
  function onAuditScope(btn) {
    const scope = btn.getAttribute("data-audit-scope");
    if (scope === storage.auditScope) return;
    storage.auditScope = scope === "all" ? "all" : "admin";
    storage.auditOffset = 0;
    return loadAudit();
  }

  /** Pagination du journal (bornée : jamais avant 0 ni après le total). */
  function onAuditPage(btn) {
    const dir = btn.getAttribute("data-audit-page");
    const step = dir === "prev" ? -AUDIT_PAGE_SIZE : AUDIT_PAGE_SIZE;
    const next = storage.auditOffset + step;
    const maxStart = Math.max(0, storage.auditTotal - 1);
    storage.auditOffset = Math.min(maxStart, Math.max(0, next));
    return loadAudit();
  }

  /** Traite un clic du bloc des clefs SSH (révocation avec confirmation). */
  async function onSshKeyAction(btn) {
    const action = btn.getAttribute("data-ssh-action");
    if (action === "revoke") {
      storage.revoking = {
        id: Number(btn.getAttribute("data-id")),
        email: btn.getAttribute("data-email") || "",
      };
      storage.error = "";
      storage.notice = "";
      return draw();
    }
    if (action === "revoke-cancel") {
      storage.revoking = null;
      return draw();
    }
    if (action === "revoke-confirm") {
      const target = storage.revoking || { id: Number(btn.getAttribute("data-id")), email: "" };
      if (!adminConn) {
        storage.error = "Connectez-vous d'abord au serveur (bloc « Connexion serveur »).";
        return draw();
      }
      storage.busy = String(target.id);
      storage.error = "";
      storage.notice = "";
      draw();
      const res = await invokeAccounts(
        "gds_admin_ssh_key_revoke",
        buildSshKeyRevokeArgs(adminConn, target.id)
      );
      if (disposed) return;
      storage.busy = "";
      if (res && res.ok) {
        storage.revoking = null;
        storage.notice =
          `Clef de « ${target.email} » révoquée : authorized_keys régénéré ` +
          `(${numOrDash(res.keys)} clef(s) restante(s)).`;
        return loadStorage({ silent: true });
      }
      storage.error = (res && res.error) || "Révocation refusée par le serveur.";
      return draw();
    }
  }

  // ── L4.6 : contrôle du service (double confirmation, santé publique) ──

  /** Charge l'état du service (PID + programmes pilotés). Réservé à l'admin. */
  async function loadServiceStatus({ silent = false } = {}) {
    if (!adminConn) {
      service.error = "Connectez-vous d'abord au serveur (bloc « Connexion serveur »).";
      return draw();
    }
    if (!silent) {
      service.loading = true;
      service.error = "";
      service.notice = "";
      service.stopped = false;
      service.waiting = null;
    }
    draw();
    const res = await invokeAccounts("gds_admin_service_status", buildServiceStatusArgs(adminConn));
    if (disposed) return;
    service.loading = false;
    if (res && res.ok) {
      service.status = res;
      service.error = "";
    } else {
      service.error = (res && res.error) || "État du service indisponible.";
    }
    draw();
  }

  /** Ouvre la double confirmation d'une action de service (AUCUN appel réseau). */
  function askServiceAction(action) {
    service.confirm = { action: action === "stop" ? "stop" : "restart", ack: false };
    service.error = "";
    service.notice = "";
    service.stopped = false;
    return draw();
  }

  /** Traite un clic de la section « Contrôle du service ». */
  function onServiceAction(btn) {
    const action = btn.getAttribute("data-svc-action");
    if (action === "restart" || action === "stop") return askServiceAction(action);
    if (action === "cancel") {
      service.confirm = null;
      return draw();
    }
    if (action === "restart-confirm" || action === "stop-confirm") {
      return runServiceAction(action === "stop-confirm" ? "stop" : "restart");
    }
  }

  /** Exécute l'action confirmée puis suit la santé jusqu'à l'état attendu. */
  async function runServiceAction(action) {
    if (!adminConn) {
      service.error = "Connectez-vous d'abord au serveur (bloc « Connexion serveur »).";
      return draw();
    }
    const command =
      action === "stop" ? "gds_admin_service_stop" : "gds_admin_service_restart";
    service.busy = action;
    service.confirm = null;
    service.error = "";
    service.notice = "";
    service.stopped = false;
    service.waiting = action === "stop" ? "down" : "up";
    service.attempts = 0;
    draw();
    const res = await invokeAccounts(command, buildServiceStatusArgs(adminConn));
    if (disposed) return;
    service.busy = "";
    if (!(res && res.ok)) {
      service.waiting = null;
      service.error = (res && res.error) || "Action refusée par le serveur.";
      return draw();
    }
    // L'ordre est différé côté serveur : on suit la santé publique jusqu'à l'état attendu.
    service.notice = action === "stop" ? "Arrêt demandé…" : "Redémarrage demandé…";
    draw();
    return followHealth(action === "stop" ? "down" : "up");
  }

  /**
   * Interroge la santé PUBLIQUE (`/api/gds/health`, sans jeton) jusqu'à l'état
   * attendu : « up » = le service répond de nouveau (redémarrage effectif) ;
   * « down » = le service ne répond plus (arrêt effectif).
   */
  async function followHealth(expected) {
    service.waiting = expected;
    service.attempts = 0;
    let downStreak = 0;
    const step = async () => {
      if (disposed) return;
      service.attempts += 1;
      const res = await invokeAccounts("gds_admin_health", {
        host: adminConn.host,
        httpPort: adminConn.httpPort,
      });
      if (disposed) return;
      service.health = res;
      const up = !!(res && res.ok);
      if (expected === "up" && up) {
        service.waiting = null;
        service.stopped = false;
        const version = String((res && res.version) || "").trim() || "?";
        service.notice = `Service redémarré — santé rétablie (version ${version}).`;
        draw();
        return recoverAfterRestart();
      }
      if (expected === "down") {
        downStreak = up ? 0 : downStreak + 1;
        if (downStreak >= SERVICE_STOP_CONFIRM_ATTEMPTS) {
          service.waiting = null;
          service.stopped = true;
          service.notice = "";
          service.status = null;
          draw();
          return;
        }
      }
      if (service.attempts >= SERVICE_HEALTH_MAX_ATTEMPTS) {
        service.waiting = null;
        service.error =
          expected === "up"
            ? "Le service n'a pas répondu après le redémarrage. Vérifiez le serveur, puis cliquez sur Rafraîchir."
            : "Le service répond encore alors que l'arrêt a été demandé. Vérifiez le serveur.";
        draw();
        return;
      }
      draw();
      setTimeout(step, SERVICE_HEALTH_INTERVAL_MS);
    };
    return step();
  }

  /**
   * Après un redémarrage, la session d'administration en mémoire du serveur est
   * invalidée. La commande d'état tente alors une reconnexion automatique avec le
   * mot de passe mémorisé ; si elle échoue (mot de passe non mémorisé), l'écran
   * invite à se reconnecter. L'état de la connexion est rafraîchi dans tous les cas.
   */
  async function recoverAfterRestart() {
    const st = await invokeAccounts("gds_admin_service_status", buildServiceStatusArgs(adminConn));
    if (disposed) return;
    if (st && st.ok) {
      service.status = st;
      service.error = "";
    } else {
      service.error =
        `${(st && st.error) || "État du service indisponible."} ` +
        "La session a peut-être expiré avec le redémarrage — reconnectez-vous (bloc « Connexion serveur ») si nécessaire.";
    }
    await refreshConnectionState();
    await loadStorage({ silent: true });
    draw();
  }

  /** Rafraîchit l'état de la connexion (version, migrations, espace) — silencieux. */
  async function refreshConnectionState() {
    if (!adminConn) return;
    const res = await invokeAccounts("gds_admin_test_connection", {
      host: adminConn.host,
      httpPort: adminConn.httpPort,
      email: adminConn.email,
      password: "",
    });
    if (disposed) return;
    if (res && res.ok) {
      state.ok = true;
      state.server = res;
      state.error = "";
      service.role = String((res && res.role) || service.role || "");
    } else {
      // Session expirée et reconnexion impossible (mot de passe non mémorisé) :
      // on redemande explicitement la connexion.
      state.ok = false;
      state.server = null;
      state.error =
        (res && res.error) || "Session expirée après le redémarrage — reconnectez-vous.";
      adminConn = null;
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
        // Nouvelle connexion : l'état du service repart de zéro.
        service = initialServiceState();
        service.role = String((res && res.role) || "");
        draw();
        loadAccounts({ silent: true });
        loadProjects({ silent: true });
        loadStorage({ silent: true });
        loadServiceStatus({ silent: true });
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
      // Lot 4 : la liste alimente le SÉLECTEUR (choix explicite) ; le premier
      // serveur exploitable reste le pré-remplissage initial par défaut.
      state.savedServers = Array.isArray(list) ? list : [];
      const p = pickPrefill(state.savedServers);
      if (p) {
        state.host = p.host;
        state.port = p.port;
        state.email = p.email;
        state.hasPassword = p.hasPassword;
      }
      draw();
    } catch {
      // Silencieux : sans liste (ou hors Tauri), le formulaire reste vide.
    }
  }

  /**
   * Sélection explicite d'un serveur mémorisé (lot 4) : pré-remplit les trois
   * champs non sensibles. Le mot de passe reste vide (jamais réinjecté) ; il est
   * réutilisé depuis le fichier de secrets si `hasPassword` est vrai.
   */
  function onServerSelectChange(sel) {
    const value = String((sel && sel.value) || "");
    if (!value) {
      state.host = "";
      state.port = DEFAULT_HTTP_PORT;
      state.email = "";
      state.hasPassword = false;
      draw();
      return;
    }
    const found = (state.savedServers || []).find((s) => adminServerOptionValue(s) === value);
    if (!found) return;
    state.host = String(found.host || "").trim();
    state.port = String(found.http_port || "").trim() || DEFAULT_HTTP_PORT;
    state.email = String(found.email || "").trim();
    state.hasPassword = !!found.has_password;
    draw();
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
