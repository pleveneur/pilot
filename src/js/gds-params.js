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
//   L5.2 « Serveurs GDS »      → PARAMS_SECTIONS[0]  (IMPLÉMENTÉ)
//   L5.3 « Mon identité »      → PARAMS_SECTIONS[1]  (IMPLÉMENTÉ)
//   L5.4 « Mes clés »          → PARAMS_SECTIONS[2]  (IMPLÉMENTÉ)
//   L5.5 « Mes projets GDS »   → PARAMS_SECTIONS[3]  (IMPLÉMENTÉ)
//
// Règle secrets : aucun mot de passe, aucune clé privée n'est renvoyé à
// l'interface ni injecté dans le HTML. Les rendus ci-dessous sont purs et ne
// reçoivent que des identifiants non sensibles (hôte, port, email). Les champs
// mot de passe sont TOUJOURS rendus vides (jamais de `value`).

import { invoke } from "@tauri-apps/api/core";
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

/** Échappe le HTML pour injection sûre dans innerHTML. */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ─────────────────────────────────────────────────────────────────────────────
// L5.2 — « Serveurs GDS » : rendus purs (jamais de secret) et câblage
// ─────────────────────────────────────────────────────────────────────────────

/** État initial du formulaire d'ajout/édition d'un serveur (pure). */
export function initialServerForm() {
  return {
    mode: "add", // "add" | "edit"
    oldHost: "",
    oldUser: "",
    name: "",
    description: "",
    host: "",
    port: "5432",
    user: "",
    dbPassword: "",
    adminPassword: "",
  };
}

/** État initial de la section « Serveurs GDS » (pure). */
export function initialServersState() {
  return {
    loading: true,
    servers: [],
    error: "",
    busy: false,
    status: null, // { kind: "loading"|"ok"|"error", text }
    form: initialServerForm(),
    pendingDelete: null, // { host, user }
    hasProject: false,
    // Choix du projet cible pour « Appliquer » : projets connus du poste.
    projectChoices: [], // [{ path, label }]
    applyProject: "",
    canApply: null, // null = repli sur hasProject (compatibilité)
  };
}

/** Libellé d'affichage d'un serveur mémorisé (hôte/port/utilisateur seulement). */
export function serverLabel(s) {
  const sv = s || {};
  const host = String(sv.host || "").trim();
  const user = String(sv.user || "").trim();
  const port = String(sv.port || "").trim() || "5432";
  return `${user}@${host}:${port}`;
}

/**
 * Titre d'une fiche serveur : le NOM s'il est renseigné, sinon l'ancienne
 * identification `user@host:port` (rétrocompatibilité des fiches sans nom).
 * Pure — testable.
 */
export function serverTitle(s) {
  const name = String((s || {}).name || "").trim();
  return name || serverLabel(s);
}

/**
 * Formate la date ISO du dernier test en `JJ/MM/AAAA HH:MM` local. Valeur
 * absente ou illisible → chaîne vide (jamais une date inventée). Pure.
 */
export function formatServerTestDate(iso) {
  if (!iso) return "";
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * État affiché d'un serveur mémorisé : jamais testé / joignable / injoignable,
 * avec la date du dernier test quand elle est connue. Pure — testable. Seuls
 * des champs non sensibles entrent ici.
 */
export function serverStateBadge(s) {
  const sv = s || {};
  const date = formatServerTestDate(sv.last_test_at);
  if (sv.reachable === true) return { kind: "ok", text: date ? `Joignable (${date})` : "Joignable" };
  if (sv.reachable === false) return { kind: "warn", text: date ? `Injoignable (${date})` : "Injoignable" };
  return { kind: "off", text: "Jamais testé" };
}

/**
 * Valide le formulaire de serveur (pure, testable). Renvoie un message d'erreur
 * ou "" si valide. En mode « ajout », le mot de passe est requis pour tester la
 * connexion ; en mode « édition », un mot de passe vide CONSERVE l'existant.
 */
export function validateServerForm(f) {
  const form = { ...initialServerForm(), ...(f || {}) };
  if (!String(form.name || "").trim()) return "Le nom du serveur est requis (court, ex. « GDS maison »).";
  if (!String(form.host || "").trim()) return "L'hôte du serveur est requis.";
  if (!String(form.user || "").trim()) return "L'utilisateur PostgreSQL est requis.";
  if (String(form.user || "").includes("@")) {
    return "Utilisateur PostgreSQL : indiquez le compte de la base (en général « pilot »), pas votre adresse e-mail. Le compte GDS se renseigne plus bas, dans le mot de passe admin.";
  }
  if (form.mode === "add" && !String(form.dbPassword || "").trim()) {
    return "Le mot de passe PostgreSQL est requis pour tester la connexion.";
  }
  return "";
}

/**
 * Rend l'état (statut) d'une opération de la section. Pure — testable.
 * @param {{kind:string, text:string}|null} status
 */
export function renderParamsStatusHtml(status) {
  if (!status || !status.text) return "";
  const kind = status.kind === "error" ? "error" : status.kind === "loading" ? "loading" : "ok";
  const prefix = kind === "error" ? "⚠️ " : "";
  return `<div class="gds-admin-status ${kind}">${prefix}${esc(status.text)}</div>`;
}

/**
 * Rend la liste des serveurs mémorisés. Pure — testable. Ne reçoit QUE des
 * champs non sensibles (host/port/user) : les mots de passe ne sont jamais
 * présents côté interface.
 * @param {Object} state état de la section (voir `initialServersState`)
 */
export function renderServersListHtml(state = {}) {
  const s = { ...initialServersState(), ...state };
  if (s.loading) {
    return `<div class="gds-admin-status loading">Chargement des serveurs mémorisés…</div>`;
  }
  if (s.error) {
    return `<div class="gds-admin-status error">⚠️ ${esc(s.error)}</div>`;
  }
  const servers = Array.isArray(s.servers) ? s.servers : [];
  if (!servers.length) {
    return `<div class="gds-admin-status idle">Aucun serveur mémorisé sur ce poste. Ajoutez-en un ci-dessous — la connexion PostgreSQL est testée avant l'enregistrement.</div>`;
  }
  const pend = s.pendingDelete;
  const canApply = s.canApply != null ? !!s.canApply : !!s.hasProject;
  return servers
    .map((sv) => {
      const host = String(sv.host || "").trim();
      const user = String(sv.user || "").trim();
      const port = String(sv.port || "").trim() || "5432";
      const isPend = !!pend && pend.host === host && pend.user === user;
      const badge = serverStateBadge(sv);
      const desc = String(sv.description || "").trim();
      return `<div class="gds-params-srv-row" data-host="${esc(host)}" data-port="${esc(port)}" data-user="${esc(user)}">
        <div class="gds-params-srv-main">
          <div class="gds-params-srv-title">${esc(serverTitle(sv))} <span class="gds-badge gds-badge-${badge.kind}">${esc(badge.text)}</span></div>
          ${desc ? `<div class="gds-params-srv-desc">${esc(desc)}</div>` : ""}
          <div class="gds-params-srv-sub">${esc(serverLabel(sv))} — identifiants conservés hors projet</div>
        </div>
        <div class="gds-params-srv-actions">
          <button class="gds-admin-btn" data-srv-action="test">Tester</button>
          <button class="gds-admin-btn" data-srv-action="apply"${canApply ? "" : ` disabled title="Aucun projet connu"`}>Appliquer</button>
          <button class="gds-admin-btn" data-srv-action="edit">Modifier</button>
          ${
            isPend
              ? `<button class="gds-admin-btn danger" data-srv-action="delete-confirm">Confirmer la suppression</button>
                 <button class="gds-admin-btn" data-srv-action="delete-cancel">Annuler</button>`
              : `<button class="gds-admin-btn" data-srv-action="delete">Supprimer</button>`
          }
        </div>
      </div>`;
    })
    .join("");
}

/**
 * Rend le formulaire d'ajout/édition d'un serveur. Pure — testable. Les champs
 * mot de passe sont TOUJOURS rendus vides (placeholder seulement) : aucun
 * secret n'est réinjecté dans le HTML, même en édition.
 * @param {Object} form état du formulaire (voir `initialServerForm`)
 */
export function renderServerFormHtml(form = initialServerForm()) {
  const f = { ...initialServerForm(), ...(form || {}) };
  const editing = f.mode === "edit";
  const keepPw = editing ? "laisser vide pour conserver" : "mot de passe PostgreSQL";
  return `
        <div class="gds-admin-form">
          <label class="gds-admin-field"><span>Nom du serveur</span>
            <input id="gds-params-srv-name" type="text" autocomplete="off" placeholder="GDS maison" value="${esc(f.name)}">
          </label>
          <label class="gds-admin-field"><span>Description (facultatif)</span>
            <input id="gds-params-srv-desc" type="text" autocomplete="off" placeholder="À quoi sert ce serveur" value="${esc(f.description)}">
          </label>
          <label class="gds-admin-field"><span>Hôte</span>
            <input id="gds-params-srv-host" type="text" autocomplete="off" placeholder="192.168.1.50" value="${esc(f.host)}">
          </label>
          <label class="gds-admin-field gds-admin-field-narrow"><span>Port</span>
            <input id="gds-params-srv-port" type="text" inputmode="numeric" placeholder="5432" value="${esc(f.port)}">
          </label>
          <label class="gds-admin-field"><span>Utilisateur PostgreSQL (compte de la base, ex. pilot)</span>
            <input id="gds-params-srv-user" type="text" autocomplete="off" placeholder="pilot" value="${esc(f.user)}">
          </label>
          <label class="gds-admin-field"><span>Mot de passe dédié</span>
            <input id="gds-params-srv-dbpw" type="password" autocomplete="new-password" placeholder="${esc(keepPw)}">
          </label>
          <label class="gds-admin-field"><span>Mot de passe admin GDS (optionnel)</span>
            <input id="gds-params-srv-adminpw" type="password" autocomplete="new-password" placeholder="${esc(keepPw)}">
          </label>
        </div>`;
}

/** Rend les boutons d'action du formulaire serveur. Pure — testable. */
export function renderServerActionsHtml(form = initialServerForm()) {
  const editing = (form || {}).mode === "edit";
  return `
        <div class="gds-admin-actions">
          <button class="gds-admin-btn" id="gds-params-srv-test"><i data-lucide="plug-zap" class="icon-sm"></i> Tester la connexion</button>
          <button class="gds-admin-btn primary" id="gds-params-srv-save"><i data-lucide="${editing ? "save" : "plus"}" class="icon-sm"></i> ${editing ? "Enregistrer les modifications" : "Ajouter le serveur"}</button>
          ${editing ? `<button class="gds-admin-btn" id="gds-params-srv-cancel">Annuler</button>` : ""}
        </div>`;
}

/**
 * Rend la section « Serveurs GDS » complète (pure, testable). Remplace le
 * squelette « À venir — L5.2 » de la coquille transverse.
 * @param {Object} state état de la section (voir `initialServersState`)
 */
export function renderServersSectionHtml(state = {}) {
  const s = { ...initialServersState(), ...(state || {}) };
  const count = Array.isArray(s.servers) ? s.servers.length : 0;
  const badge = s.loading
    ? `<span class="gds-admin-todo">Chargement…</span>`
    : `<span class="gds-admin-badge ok">${count} serveur${count > 1 ? "s" : ""} mémorisé${count > 1 ? "s" : ""}</span>`;
  const editing = s.form && s.form.mode === "edit";
  const choices = Array.isArray(s.projectChoices) ? s.projectChoices : [];
  const canApply = s.canApply != null ? !!s.canApply : !!s.hasProject;
  const projectNote = canApply
    ? `<div class="gds-admin-hint">Projet cible de « Appliquer » :
         <select id="gds-params-apply-project" class="gds-admin-select">
           ${choices.map((c) => `<option value="${esc(c.path)}"${c.path === s.applyProject ? " selected" : ""}>${esc(c.label)}</option>`).join("")}
         </select>
         <span class="gds-admin-muted">(hôte, port, utilisateur et identité pré-remplis ; le port SSH et la racine des dépôts du projet sont conservés)</span></div>`
    : `<div class="gds-admin-hint">Aucun projet connu sur ce poste : ouvrez un projet pour pouvoir lui appliquer un serveur.</div>`;
  return `
      <section class="gds-admin-section" data-section-id="servers">
        <div class="gds-admin-section-head">
          <div class="gds-admin-section-title"><i data-lucide="server" class="icon-sm"></i> Serveurs GDS</div>
          ${badge}
        </div>
        <div class="gds-admin-section-desc">${esc(PARAMS_SECTIONS[0].desc)}</div>
        <div id="gds-params-srv-list" class="gds-params-srv-list">${renderServersListHtml(s)}</div>
        <div class="gds-admin-section-desc" style="margin-top:10px"><strong>${editing ? "Modifier un serveur" : "Ajouter un serveur"}</strong> — la connexion PostgreSQL est testée AVANT d'enregistrer les identifiants.</div>
        ${renderServerFormHtml(s.form)}
        ${renderServerActionsHtml(s.form)}
        ${projectNote}
        <div id="gds-params-srv-status" class="gds-admin-status-area">${renderParamsStatusHtml(s.status)}</div>
        <div class="gds-admin-hint">Les mots de passe ne sont jamais renvoyés à l'interface ; ils sont mémorisés hors projet (<code>~/.pilot/gds_secrets.json</code>, 0600) après un test réussi, et peuvent être modifiés/supprimés depuis cet écran.</div>
      </section>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// L5.3 — « Mon identité » : rendus purs et câblage
//
// DÉPLACEMENT du bloc identité de l'onglet PAR PROJET (gds.js) vers cet onglet
// transverse, SANS CHANGEMENT DE LOGIQUE : mêmes commandes
// (`gds_identity_prefs` / `gds_save_identity`), même stockage
// (`~/.pilot/gds_secrets.json`, 0600), même résolution côté Rust de l'email
// réellement utilisé (identité globale vs email par projet,
// `effective_identity_email`, gds.rs). Aucun nouveau traitement n'est introduit.
// ─────────────────────────────────────────────────────────────────────────────

/** État initial de la section « Mon identité » (pure). Aucun secret. */
export function initialIdentityState() {
  return { loading: true, email: "", gitName: "", status: null };
}

/**
 * Rend la section « Mon identité » (pure, testable). Remplace le squelette
 * « À venir — L5.3 ». Affiche l'email d'identité GLOBALE et le nom git ; jamais
 * de secret (l'identité n'est pas un secret, mais elle vit hors du HTML du
 * projet dans le stockage chiffré 0600).
 * @param {Object} state état de la section (voir `initialIdentityState`)
 */
export function renderIdentitySectionHtml(state = {}) {
  const s = { ...initialIdentityState(), ...(state || {}) };
  const body = s.loading
    ? `<div class="gds-admin-status loading">Chargement de l'identité…</div>`
    : `
        <div class="gds-admin-form">
          <label class="gds-admin-field"><span>Email (identité globale)</span>
            <input id="gds-params-id-email" type="text" autocomplete="off" placeholder="dev@exemple.com" value="${esc(s.email)}">
          </label>
          <label class="gds-admin-field"><span>Nom git</span>
            <input id="gds-params-id-name" type="text" autocomplete="off" placeholder="Prénom Nom" value="${esc(s.gitName)}">
          </label>
        </div>
        <div class="gds-admin-hint">Saisie <strong>une seule fois</strong> : cet email identifie votre compte GDS (clé SSH, membre de projets) et pré-remplit l'ajout d'un projet au GDS. Le nom git est réglé <strong>localement</strong> au projet (jamais en global). Stocké hors projet (<code>~/.pilot/gds_secrets.json</code>, 0600).</div>
        <div class="gds-admin-actions">
          <button class="gds-admin-btn primary" id="gds-params-id-save"><i data-lucide="save" class="icon-sm"></i> Enregistrer l'identité</button>
        </div>`;
  return `
      <section class="gds-admin-section" data-section-id="identity">
        <div class="gds-admin-section-head">
          <div class="gds-admin-section-title"><i data-lucide="user-round" class="icon-sm"></i> Mon identité</div>
        </div>
        <div class="gds-admin-section-desc">${esc(PARAMS_SECTIONS[1].desc)}</div>
        ${body}
        <div id="gds-params-id-status" class="gds-admin-status-area">${renderParamsStatusHtml(s.status)}</div>
      </section>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// L5.4 — « Mes clés » : clé PUBLIQUE du poste (affichage, copie, enregistrement)
//
// Le cas « clé ajoutée MANUELLEMENT » (coller une clé arbitraire) est SUPPRIMÉ :
// le serveur applique lui-même `authorized_keys` depuis la base (L2.5), donc le
// message « ajoutez la clé à la main » n'a plus lieu d'être. Seule la clé
// PUBLIQUE du poste est affichée (la clé privée ne quitte jamais le poste) et
// enregistrée via les commandes existantes `gds_ssh_key` /
// `gds_register_ssh_key` (RÉUTILISÉES telles quelles).
// ─────────────────────────────────────────────────────────────────────────────

/** État initial de la section « Mes clés » (pure). Aucun secret. */
export function initialKeysState() {
  return {
    loading: true,
    publicKey: "",
    keyPath: "",
    generated: false,
    status: null,
  };
}

/**
 * Explication permanente de la section « Mes clés » (pure). Une ligne, affichée
 * AVANT le clic : la clé du poste part toute seule à l'activation du GDS.
 */
export function keysRegisterHint() {
  return (
    "En général votre clé est enregistrée automatiquement à l'activation du GDS " +
    "sur un projet : ce bouton ne sert qu'en cas de serveur distant."
  );
}

/**
 * Erreur d'enregistrement de clé traduite en message actionnable (pure).
 * Le texte brut « GDS non provisionné » n'explique rien : on le remplace par
 * le chemin à suivre (l'activation du GDS sur le projet enregistre la clé).
 */
export function keysRegisterErrorMessage(e) {
  const s = String(e == null ? "" : e).replace(/^Error:\s*/, "");
  if (!/non provision/i.test(s)) return s;
  return (
    "Aucun projet n'est encore rattaché au GDS : votre clé sera enregistrée " +
    "automatiquement quand vous activerez le GDS sur votre projet (onglet « 🌐 GDS » " +
    "du projet → « Activer GDS »). Vous pouvez aussi la déposer vous-même sur un " +
    "serveur distant."
  );
}

/**
 * Rend la section « Mes clés » (pure, testable). Remplace le squelette
 * « À venir — L5.4 ». Clé PUBLIQUE uniquement — jamais la clé privée.
 * `email` (identité globale) : passée à l'affichage par le câblage, sans être
 * stockée dans l'état de la section (source unique = section identité).
 * @param {Object} state état de la section (voir `initialKeysState`)
 */
export function renderKeysSectionHtml(state = {}) {
  const s = { ...initialKeysState(), ...(state || {}) };
  const email = String(s.email || "").trim();
  let body;
  if (s.loading) {
    body = `<div class="gds-admin-status loading">Lecture de la clé SSH du poste…</div>`;
  } else if (!s.publicKey) {
    body = `<div class="gds-admin-hint">Clé publique indisponible sur ce poste.</div>`;
  } else {
    body = `
        <div class="gds-ssh-poste">
          <div class="gds-admin-hint">Clé <strong>publique</strong> du poste${s.keyPath ? ` (<code>${esc(s.keyPath)}</code>)` : ""}${s.generated ? " — générée à l'instant" : ""} :</div>
          <div class="gds-ssh-key">${esc(s.publicKey)}</div>
        </div>
        <div class="gds-admin-actions">
          <button class="gds-admin-btn" id="gds-params-key-copy"><i data-lucide="copy" class="icon-sm"></i> Copier la clé publique</button>
          <button class="gds-admin-btn primary" id="gds-params-key-register"${email ? "" : ` disabled title="Définissez d'abord votre identité"`}><i data-lucide="upload" class="icon-sm"></i> Enregistrer ma clé sur le serveur GDS</button>
        </div>
        <div class="gds-admin-hint">Enregistrement sur le serveur GDS, pour l'identité <strong>${esc(email || "—")}</strong>. La clé privée ne quitte jamais le poste.</div>`;
  }
  return `
      <section class="gds-admin-section" data-section-id="keys">
        <div class="gds-admin-section-head">
          <div class="gds-admin-section-title"><i data-lucide="key-round" class="icon-sm"></i> Mes clés</div>
        </div>
        <div class="gds-admin-section-desc">${esc(PARAMS_SECTIONS[2].desc)}</div>
        ${body}
        <div class="gds-admin-hint">${esc(keysRegisterHint())}</div>
        <div id="gds-params-key-status" class="gds-admin-status-area">${renderParamsStatusHtml(s.status)}</div>
      </section>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// L5.5 — « Mes projets GDS » : opérations courantes par projet
//
// Réutilise les commandes/procédures EXISTANTES (aucune logique réécrite) :
//   - `get_recent_projects`       → projets locaux connus de ce poste
//   - `gds_get_config`            → projet provisionné ? (`.pilot/gds.json`)
//   - `gds_connection_status`     → état de connexion + présent sur le serveur
//   - `gds_sync_project`          → synchroniser
//   - `gds_add_project`           → ajouter un projet local au serveur GDS
//   - `gds_remove_project`        → retirer (avec ou sans purge serveur)
//   - `sidebar.openProjectByPath` → ouvrir le projet local dans Pilot
// Aucun secret n'est affiché : seuls le nom, le chemin et l'état le sont.
// ─────────────────────────────────────────────────────────────────────────────

/** Nom de dossier d'un chemin (affichage). Pure — testable. */
export function projectBasename(path) {
  return (
    String(path == null ? "" : path)
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() || ""
  );
}

/** État initial de la section « Mes projets GDS » (pure). Aucun secret. */
export function initialProjectsState() {
  return {
    loading: true,
    projects: [],
    error: "",
    status: null,
    pendingRemove: null, // chemin du projet en attente de confirmation de retrait
  };
}

/**
 * Badge d'état d'un projet GDS (pure, testable).
 * `status` : « connected » | « error » | « not_configured » (valeurs renvoyées
 * par `gds_connection_status`) ; `provisioned` : `.pilot/gds.json` présent et
 * actif ; `onServer` : projet déjà enregistré sur le serveur GDS.
 */
export function projectStatusBadge(status, provisioned, onServer) {
  if (status === "connected") return { kind: "ok", text: "Connecté" };
  if (onServer) return { kind: "warn", text: "Sur le serveur — non connecté" };
  if (status === "error") return { kind: "warn", text: "Connexion en attente" };
  if (provisioned) return { kind: "warn", text: "Provisionné — non ajouté" };
  return { kind: "off", text: "Non configuré" };
}

/**
 * Rend la ligne d'un projet GDS (pure, testable) : nom + chemin + état, puis les
 * actions disponibles selon l'état (ouvrir, synchroniser, ajouter, retirer).
 * Le retrait exige une double confirmation avec case « purger le serveur ».
 * @param {Object} p entrée projet `{ path, name, provisioned, status, onServer }`
 * @param {string|null} pendingRemove chemin du projet en attente de confirmation
 */
export function renderProjectRowHtml(p = {}, pendingRemove = null) {
  const path = String(p.path || "");
  const name = String(p.name || projectBasename(path));
  const badge = projectStatusBadge(p.status, p.provisioned, p.onServer);
  const connected = p.status === "connected";
  const canAdd = !!p.provisioned && !p.onServer && !connected;
  const canRemove = connected || !!p.onServer;
  const isPend = !!pendingRemove && pendingRemove === path;
  return `<div class="gds-params-srv-row" data-path="${esc(path)}">
        <div class="gds-params-srv-main">
          <div class="gds-params-srv-title">${esc(name)} <span class="gds-badge gds-badge-${badge.kind}">${esc(badge.text)}</span></div>
          <div class="gds-params-srv-sub">${esc(path)}</div>
        </div>
        <div class="gds-params-srv-actions">
          <button class="gds-admin-btn" data-proj-action="open">Ouvrir</button>
          ${connected ? `<button class="gds-admin-btn" data-proj-action="sync">Synchroniser</button>` : ""}
          ${canAdd ? `<button class="gds-admin-btn" data-proj-action="add">Ajouter au GDS</button>` : ""}
          ${
            canRemove
              ? isPend
                ? `<button class="gds-admin-btn danger" data-proj-action="remove-confirm">Confirmer le détachement</button>
                   <button class="gds-admin-btn" data-proj-action="remove-cancel">Annuler</button>`
                : `<button class="gds-admin-btn" data-proj-action="remove">Détacher</button>`
              : ""
          }
        </div>
        ${isPend ? `<label class="gds-check"><input type="checkbox" data-proj-purge> Retirer aussi le travail côté serveur (dépôt bare et entrées en base) — <b>décoché</b> : le travail reste sur le serveur.</label>` : ""}
      </div>`;
}

/**
 * Rend la liste des projets GDS (pure, testable) : chargement / erreur / vide /
 * une ligne par projet.
 * @param {Object} state état de la section (voir `initialProjectsState`)
 */
export function renderProjectsListHtml(state = {}) {
  const s = { ...initialProjectsState(), ...(state || {}) };
  if (s.loading) {
    return `<div class="gds-admin-status loading">Chargement de vos projets…</div>`;
  }
  if (s.error) {
    return `<div class="gds-admin-status error">⚠️ ${esc(s.error)}</div>`;
  }
  const projects = Array.isArray(s.projects) ? s.projects : [];
  if (!projects.length) {
    return `<div class="gds-admin-status idle">Aucun projet local connu. Ouvrez un projet, activez le GDS dans son onglet « 🌐 GDS », puis revenez ici pour le synchroniser, l'ajouter ou le retirer.</div>`;
  }
  return projects.map((p) => renderProjectRowHtml(p, s.pendingRemove)).join("");
}

/**
 * Rend la section « Mes projets GDS » complète (pure, testable). Remplace le
 * squelette « À venir — L5.5 » de la coquille transverse.
 * @param {Object} state état de la section (voir `initialProjectsState`)
 */
export function renderProjectsSectionHtml(state = {}) {
  const s = { ...initialProjectsState(), ...(state || {}) };
  const count = Array.isArray(s.projects) ? s.projects.length : 0;
  const badge = s.loading
    ? `<span class="gds-admin-todo">Chargement…</span>`
    : `<span class="gds-admin-badge ok">${count} projet${count > 1 ? "s" : ""}</span>`;
  return `
      <section class="gds-admin-section" data-section-id="projects">
        <div class="gds-admin-section-head">
          <div class="gds-admin-section-title"><i data-lucide="folder-git-2" class="icon-sm"></i> Mes projets GDS</div>
          ${badge}
        </div>
        <div class="gds-admin-section-desc">${esc(PARAMS_SECTIONS[3].desc)}</div>
        <div id="gds-params-proj-list" class="gds-params-srv-list">${renderProjectsListHtml(s)}</div>
        <div id="gds-params-proj-status" class="gds-admin-status-area">${renderParamsStatusHtml(s.status)}</div>
        <div class="gds-admin-hint">« Ouvrir » active le projet dans Pilot. « Synchroniser », « Ajouter au GDS » et « Détacher » opèrent sur le projet choisi, même s'il n'est pas le projet actif. Par défaut, « Détacher » <b>conserve</b> le travail côté serveur ; cochez la case pour le retirer aussi. Ajouter exige votre identité globale (section « Mon identité »).</div>
      </section>`;
}

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
 * Cet écran n'utilise AUCUNE variable de projet pour S'OUVRIR : il s'ouvre sans
 * projet ouvert. La seule action liée au projet est « Appliquer un serveur »,
 * qui cible le projet ACTIF s'il y en a un (sinon le bouton est désactivé).
 */
export function createGdsParams(container) {
  container.classList.add("gds-admin-view", "gds-params-view");

  let disposed = false;
  const state = initialServersState();
  /** L5.3 — état de la section « Mon identité » (source unique de l'email global). */
  const identityState = initialIdentityState();
  /** L5.4 — état de la section « Mes clés » (clé publique du poste). */
  const keysState = initialKeysState();
  /** L5.5 — état de la section « Mes projets GDS » (opérations courantes). */
  const projectsState = initialProjectsState();

  const q = (sel) => container.querySelector(sel);

  /** Projet actif (chaîne vide si aucun). */
  function activeProject() {
    return String(window._pilotProjectPath || "").trim();
  }

  /**
   * Récupère la saisie courante AVANT tout redessin. Les champs mot de passe
   * ne sont jamais réaffichés (règle secrets) : un champ vidé par le rendu est
   * donc IGNORÉ au profit de la valeur déjà en mémoire, pour ne pas perdre une
   * saisie en cours entre deux rafraîchissements.
   */
  function captureForm() {
    const host = q("#gds-params-srv-host");
    if (!host) return;
    const dbpw = q("#gds-params-srv-dbpw").value;
    const adminpw = q("#gds-params-srv-adminpw").value;
    state.form = {
      ...state.form,
      name: q("#gds-params-srv-name").value,
      description: q("#gds-params-srv-desc").value,
      host: host.value,
      port: q("#gds-params-srv-port").value,
      user: q("#gds-params-srv-user").value,
      dbPassword: dbpw || state.form.dbPassword,
      adminPassword: adminpw || state.form.adminPassword,
    };
  }

  /**
   * Récupère la saisie « Mon identité » AVANT tout redessin (L5.3) : évite de
   * perdre une saisie en cours si un autre bloc (ex. rafraîchissement des
   * serveurs) redessine l'écran. Sans champ à l'écran (chargement), no-op.
   */
  function captureIdentity() {
    const email = q("#gds-params-id-email");
    if (!email) return;
    identityState.email = email.value;
    const name = q("#gds-params-id-name");
    if (name) identityState.gitName = name.value;
  }

  function draw() {
    if (disposed) return;
    state.hasProject = !!activeProject();
    // Choix du projet cible de « Appliquer » : projets connus + projet actif.
    const choices = state.projectChoices.slice();
    const active = activeProject();
    if (active && !choices.some((c) => c.path === active)) {
      choices.unshift({ path: active, label: `${projectBasename(active)} (projet ouvert)` });
    }
    state.canApply = choices.length > 0;
    if (!state.applyProject || !choices.some((c) => c.path === state.applyProject)) {
      state.applyProject = active || (choices[0] ? choices[0].path : "");
    }
    captureIdentity();
    container.innerHTML = renderParamsShellHtml({
      sectionHtml: {
        servers: renderServersSectionHtml({ ...state, projectChoices: choices }),
        identity: renderIdentitySectionHtml(identityState),
        keys: renderKeysSectionHtml({ ...keysState, email: identityState.email }),
        projects: renderProjectsSectionHtml(projectsState),
      },
    });
    refreshIcons(container);
    bind();
  }

  async function refreshServers() {
    state.loading = true;
    draw();
    try {
      const servers = await invoke("gds_list_saved_servers");
      state.servers = Array.isArray(servers) ? servers : [];
      state.error = "";
    } catch (e) {
      state.servers = [];
      state.error = String(e);
    }
    state.loading = false;
    draw();
  }

  function resetForm() {
    state.form = initialServerForm();
    state.pendingDelete = null;
    draw();
  }

  /**
   * Charge la liste des projets connus du poste pour le sélecteur « Appliquer ».
   * Fail-open : sans liste, seuls le projet actif (s'il y en a un) est proposé.
   */
  function loadApplyProjects() {
    Promise.resolve()
      .then(() => invoke("get_recent_projects"))
      .then((paths) => {
        if (disposed) return;
        state.projectChoices = (Array.isArray(paths) ? paths : [])
          .map((p) => String(p || ""))
          .filter(Boolean)
          .map((path) => ({ path, label: projectBasename(path) }));
        draw();
      })
      .catch(() => {});
  }

  async function testForm() {
    captureForm();
    const err = validateServerForm(state.form);
    if (err) {
      state.status = { kind: "error", text: err };
      draw();
      return;
    }
    state.status = { kind: "loading", text: "Test de la connexion PostgreSQL…" };
    draw();
    try {
      await invoke("gds_test_saved_server", {
        host: state.form.host.trim(),
        port: state.form.port.trim(),
        user: state.form.user.trim(),
        dbPassword: state.form.dbPassword,
      });
      state.status = { kind: "ok", text: "✅ Connexion PostgreSQL réussie." };
    } catch (e) {
      state.status = { kind: "error", text: friendlyGdsError(e) };
    }
    draw();
  }

  async function saveForm() {
    captureForm();
    const err = validateServerForm(state.form);
    if (err) {
      state.status = { kind: "error", text: err };
      draw();
      return;
    }
    const editing = state.form.mode === "edit";
    state.status = { kind: "loading", text: editing ? "Enregistrement des modifications…" : "Ajout du serveur…" };
    draw();
    try {
      if (editing) {
        await invoke("gds_update_saved_server", {
          oldHost: state.form.oldHost.trim(),
          oldUser: state.form.oldUser.trim(),
          host: state.form.host.trim(),
          port: state.form.port.trim(),
          user: state.form.user.trim(),
          dbPassword: state.form.dbPassword,
          adminPassword: state.form.adminPassword,
          name: state.form.name.trim(),
          description: state.form.description.trim(),
        });
      } else {
        await invoke("gds_add_saved_server", {
          host: state.form.host.trim(),
          port: state.form.port.trim(),
          user: state.form.user.trim(),
          dbPassword: state.form.dbPassword,
          adminPassword: state.form.adminPassword,
          name: state.form.name.trim(),
          description: state.form.description.trim(),
        });
      }
      state.form = initialServerForm();
      state.status = { kind: "ok", text: editing ? "✅ Serveur modifié (connexion testée)." : "✅ Serveur ajouté (connexion testée)." };
      await refreshServers();
    } catch (e) {
      state.status = { kind: "error", text: friendlyGdsError(e) };
      draw();
    }
  }

  async function rowAction(btn) {
    const row = btn.closest("[data-host]");
    if (!row) return;
    const host = row.dataset.host || "";
    const port = row.dataset.port || "5432";
    const user = row.dataset.user || "";
    const action = btn.dataset.srvAction;

    if (action === "edit") {
      state.pendingDelete = null;
      state.form = { mode: "edit", oldHost: host, oldUser: user, name: String(cur.name || ""), description: String(cur.description || ""), host, port, user, dbPassword: "", adminPassword: "" };
      state.status = { kind: "ok", text: "Modifiez les champs puis enregistrez (mot de passe vide = conservé)." };
      draw();
      return;
    }
    if (action === "delete") {
      state.pendingDelete = { host, user };
      state.status = null;
      draw();
      return;
    }
    if (action === "delete-cancel") {
      state.pendingDelete = null;
      draw();
      return;
    }
    if (action === "delete-confirm") {
      state.pendingDelete = null;
      state.status = { kind: "loading", text: "Suppression…" };
      draw();
      try {
        await invoke("gds_delete_saved_server", { host, user });
        state.status = { kind: "ok", text: `✅ Serveur ${user}@${host} supprimé (identifiants oubliés).` };
        await refreshServers();
      } catch (e) {
        state.status = { kind: "error", text: friendlyGdsError(e) };
        draw();
      }
      return;
    }
    if (action === "test") {
      state.status = { kind: "loading", text: `Test de ${user}@${host}…` };
      draw();
      try {
        await invoke("gds_test_saved_server", { host, port, user, dbPassword: "" });
        state.status = { kind: "ok", text: `✅ Connexion réussie (${user}@${host}).` };
      } catch (e) {
        state.status = { kind: "error", text: friendlyGdsError(e) };
      }
      // Lot 5 : le test met à jour la date et l'état de la fiche — on relit la
      // liste pour afficher l'état réel (le mot de passe n'est jamais repris).
      await refreshServers();
      return;
    }
    if (action === "apply") {
      // Lot 2 : la cible est le projet CHOISI (repli sur le projet ouvert).
      const sel = q("#gds-params-apply-project");
      const project = (sel && sel.value) || state.applyProject || activeProject();
      if (!project) {
        state.status = { kind: "error", text: "Aucun projet connu : ouvrez un projet pour lui appliquer un serveur." };
        draw();
        return;
      }
      state.status = { kind: "loading", text: `Application à « ${projectBasename(project)} »…` };
      draw();
      try {
        await invoke("gds_apply_server", { project, host, port, user, email: identityState.email.trim() });
        state.status = {
          kind: "ok",
          text: `✅ Serveur appliqué à « ${projectBasename(project)} » (hôte, port, utilisateur, identité pré-remplis ; port SSH et racine des dépôts du projet conservés).`,
        };
      } catch (e) {
        state.status = { kind: "error", text: friendlyGdsError(e) };
      }
      draw();
    }
  }

  function bind() {
    const applySel = q("#gds-params-apply-project");
    if (applySel) {
      applySel.addEventListener("change", () => {
        state.applyProject = applySel.value || "";
      });
    }
    const test = q("#gds-params-srv-test");
    if (test) test.addEventListener("click", () => testForm());
    const save = q("#gds-params-srv-save");
    if (save) save.addEventListener("click", () => saveForm());
    const cancel = q("#gds-params-srv-cancel");
    if (cancel) cancel.addEventListener("click", () => resetForm());
    for (const btn of container.querySelectorAll("[data-srv-action]")) {
      btn.addEventListener("click", () => rowAction(btn));
    }
    // ── L5.5 : mes projets GDS ──
    for (const btn of container.querySelectorAll("[data-proj-action]")) {
      btn.addEventListener("click", () => projectRowAction(btn));
    }
    // ── L5.3 : identité globale ──
    const idSave = q("#gds-params-id-save");
    if (idSave) idSave.addEventListener("click", () => saveIdentity());
    // ── L5.4 : clé publique du poste ──
    const keyCopy = q("#gds-params-key-copy");
    if (keyCopy) keyCopy.addEventListener("click", () => copyKey());
    const keyReg = q("#gds-params-key-register");
    if (keyReg) keyReg.addEventListener("click", () => registerKey());
  }

  // ── L5.3 : chargement / enregistrement de l'identité globale ──

  function loadIdentity() {
    identityState.loading = true;
    draw();
    Promise.resolve()
      .then(() => invoke("gds_identity_prefs"))
      .then((prefs) => {
        identityState.email = String((prefs && prefs.email) || "");
        identityState.gitName = String((prefs && prefs.git_name) || "");
      })
      .catch(() => {})
      .finally(() => {
        identityState.loading = false;
        draw();
      });
  }

  async function saveIdentity() {
    captureIdentity();
    const email = identityState.email.trim();
    if (!email) {
      identityState.status = { kind: "error", text: "L'email est requis : il identifie votre compte GDS." };
      draw();
      return;
    }
    identityState.status = { kind: "loading", text: "Enregistrement de l'identité…" };
    draw();
    try {
      await invoke("gds_save_identity", { email, gitName: identityState.gitName.trim() });
      identityState.status = { kind: "ok", text: "✅ Identité globale enregistrée." };
    } catch (e) {
      identityState.status = { kind: "error", text: friendlyGdsError(e) };
    }
    draw();
  }

  // ── L5.4 : lecture / copie / enregistrement de la clé publique ──

  function loadKeys() {
    keysState.loading = true;
    draw();
    Promise.resolve()
      .then(() => invoke("gds_ssh_key"))
      .then((res) => {
        keysState.publicKey = String((res && res.public_key) || "");
        keysState.keyPath = String((res && res.path) || "");
        keysState.generated = !!(res && res.generated);
      })
      .catch((e) => {
        keysState.publicKey = "";
        keysState.status = { kind: "error", text: friendlyGdsError(e) };
      })
      .finally(() => {
        keysState.loading = false;
        draw();
      });
  }

  async function copyKey() {
    const key = keysState.publicKey;
    if (!key) return;
    let ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(key);
        ok = true;
      }
    } catch (_) {
      ok = false;
    }
    keysState.status = ok
      ? { kind: "ok", text: "✅ Clé publique copiée dans le presse-papiers." }
      : { kind: "error", text: "Copie automatique refusée — sélectionnez le texte de la clé pour la copier." };
    draw();
  }

  async function registerKey() {
    const email = identityState.email.trim();
    if (!email) {
      keysState.status = { kind: "error", text: "Définissez d'abord votre identité (section « Mon identité »)." };
      draw();
      return;
    }
    if (!keysState.publicKey) {
      keysState.status = { kind: "error", text: "Aucune clé publique à enregistrer sur ce poste." };
      draw();
      return;
    }
    keysState.status = { kind: "loading", text: "Enregistrement de la clé sur le serveur GDS…" };
    draw();
    try {
      await invoke("gds_register_ssh_key", { email, publicKey: keysState.publicKey });
      keysState.status = { kind: "ok", text: "✅ Clé publique enregistrée sur le serveur GDS." };
    } catch (e) {
      keysState.status = { kind: "error", text: keysRegisterErrorMessage(e) };
    }
    draw();
  }

  // ── L5.5 : chargement + opérations courantes par projet GDS ──

  function refreshProjects() {
    projectsState.loading = true;
    projectsState.error = "";
    draw();
    Promise.resolve()
      .then(() => invoke("get_recent_projects"))
      .then(async (paths) => {
        const list = Array.isArray(paths) ? paths : [];
        const rows = [];
        for (const raw of list) {
          const path = String(raw || "");
          if (!path) continue;
          let cfg = null;
          try {
            cfg = await invoke("gds_get_config", { project: path });
          } catch (_) {
            cfg = null;
          }
          const provisioned = !!(cfg && cfg.enabled);
          let status = "not_configured";
          let onServer = false;
          if (provisioned) {
            try {
              const conn = await invoke("gds_connection_status", { project: path });
              status = (conn && conn.status) || "not_configured";
              onServer = !!(conn && conn.on_server);
            } catch (_) {
              status = "error";
            }
          }
          rows.push({ path, name: projectBasename(path), provisioned, status, onServer });
        }
        projectsState.projects = rows;
      })
      .catch((e) => {
        projectsState.projects = [];
        projectsState.error = friendlyGdsError(e);
      })
      .finally(() => {
        projectsState.loading = false;
        draw();
      });
  }

  async function projectRowAction(btn) {
    const row = btn.closest("[data-path]");
    if (!row) return;
    const path = row.dataset.path || "";
    const entry = projectsState.projects.find((p) => p.path === path);
    if (!entry) return;
    const action = btn.dataset.projAction;

    if (action === "open") {
      const sb = window._pilotGetSidebar ? window._pilotGetSidebar() : null;
      if (!sb || typeof sb.openProjectByPath !== "function") {
        projectsState.status = { kind: "error", text: "Ouverture de projet indisponible." };
        draw();
        return;
      }
      try {
        await sb.openProjectByPath(path);
        projectsState.status = { kind: "ok", text: `✅ Projet ouvert : ${entry.name}` };
      } catch (e) {
        projectsState.status = { kind: "error", text: friendlyGdsError(e) };
      }
      draw();
      return;
    }

    if (action === "sync") {
      projectsState.status = { kind: "loading", text: `Synchronisation de « ${entry.name} »…` };
      draw();
      try {
        const res = await invoke("gds_sync_project", { project: path });
        projectsState.status = { kind: "ok", text: `✅ Synchronisé (${(res && res.action) || "ok"}).` };
        await refreshProjects();
      } catch (e) {
        projectsState.status = { kind: "error", text: friendlyGdsError(e) };
        draw();
      }
      return;
    }

    if (action === "add") {
      const email = identityState.email.trim();
      if (!email) {
        projectsState.status = { kind: "error", text: "Définissez d'abord votre identité (section « Mon identité »)." };
        draw();
        return;
      }
      projectsState.status = { kind: "loading", text: `Ajout de « ${entry.name} » au GDS…` };
      draw();
      try {
        await invoke("gds_add_project", { project: path, email, gitName: identityState.gitName.trim() || null });
        projectsState.status = { kind: "ok", text: `✅ Projet « ${entry.name} » ajouté au GDS.` };
        await refreshProjects();
      } catch (e) {
        projectsState.status = { kind: "error", text: friendlyGdsError(e) };
        draw();
      }
      return;
    }

    if (action === "remove") {
      projectsState.pendingRemove = path;
      projectsState.status = null;
      draw();
      return;
    }
    if (action === "remove-cancel") {
      projectsState.pendingRemove = null;
      draw();
      return;
    }
    if (action === "remove-confirm") {
      const purgeEl = row.querySelector("[data-proj-purge]");
      const purgeServer = !!(purgeEl && purgeEl.checked);
      projectsState.pendingRemove = null;
      projectsState.status = { kind: "loading", text: `Détachement de « ${entry.name} »…` };
      draw();
      try {
        const res = await invoke("gds_remove_project", { project: path, purgeServer });
        projectsState.status = res && res.purged_server
          ? { kind: "ok", text: `✅ Détaché du GDS (travail retiré du serveur) : ${entry.name}` }
          : { kind: "ok", text: `✅ Détaché du GDS (travail conservé sur le serveur) : ${entry.name}` };
        await refreshProjects();
      } catch (e) {
        projectsState.status = { kind: "error", text: friendlyGdsError(e) };
        draw();
      }
      return;
    }
  }

  /** Message d'erreur lisible (les commandes renvoient déjà des messages). */
  function friendlyGdsError(e) {
    const s = String(e == null ? "" : e);
    return s.replace(/^Error:\s*/, "");
  }

  // Premier rendu (chargement) puis rafraîchissement des listes/états.
  draw();
  refreshServers();
  // L5.3 (identité globale) et L5.4 (clé publique du poste) : chargements
  // indépendants, fail-open — jamais bloquants pour les autres sections.
  loadIdentity();
  loadKeys();
  // L5.5 (mes projets GDS) : liste + état, fail-open.
  refreshProjects();
  // Lot 2 : projets connus du poste, pour le sélecteur « Appliquer ».
  loadApplyProjects();

  // Aucune ressource système à libérer ; on renvoie néanmoins le contrat commun
  // des écrans (wrapper + unlisten) pour l'homogénéité de tabs.js.
  return {
    wrapper: container,
    unlisten: () => {
      disposed = true;
    },
  };
}
