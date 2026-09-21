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
//   L5.4 « Mes clés »          → PARAMS_SECTIONS[2]
//   L5.5 « Mes projets GDS »   → PARAMS_SECTIONS[3]
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
 * Valide le formulaire de serveur (pure, testable). Renvoie un message d'erreur
 * ou "" si valide. En mode « ajout », le mot de passe est requis pour tester la
 * connexion ; en mode « édition », un mot de passe vide CONSERVE l'existant.
 */
export function validateServerForm(f) {
  const form = { ...initialServerForm(), ...(f || {}) };
  if (!String(form.host || "").trim()) return "L'hôte du serveur est requis.";
  if (!String(form.user || "").trim()) return "L'utilisateur PostgreSQL est requis.";
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
  return servers
    .map((sv) => {
      const host = String(sv.host || "").trim();
      const user = String(sv.user || "").trim();
      const port = String(sv.port || "").trim() || "5432";
      const isPend = !!pend && pend.host === host && pend.user === user;
      return `<div class="gds-params-srv-row" data-host="${esc(host)}" data-port="${esc(port)}" data-user="${esc(user)}">
        <div class="gds-params-srv-main">
          <div class="gds-params-srv-title">${esc(serverLabel(sv))}</div>
          <div class="gds-params-srv-sub">Connexion testée — identifiants conservés hors projet</div>
        </div>
        <div class="gds-params-srv-actions">
          <button class="gds-admin-btn" data-srv-action="test">Tester</button>
          <button class="gds-admin-btn" data-srv-action="apply"${s.hasProject ? "" : ` disabled title="Aucun projet ouvert"`}>Appliquer</button>
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
          <label class="gds-admin-field"><span>Hôte</span>
            <input id="gds-params-srv-host" type="text" autocomplete="off" placeholder="192.168.1.50" value="${esc(f.host)}">
          </label>
          <label class="gds-admin-field gds-admin-field-narrow"><span>Port</span>
            <input id="gds-params-srv-port" type="text" inputmode="numeric" placeholder="5432" value="${esc(f.port)}">
          </label>
          <label class="gds-admin-field"><span>Utilisateur PostgreSQL</span>
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
  const projectNote = s.hasProject
    ? `<div class="gds-admin-hint">« Appliquer » pré-remplit la configuration GDS du <b>projet actif ouvert</b> (hôte, port, utilisateur et identité globale).</div>`
    : `<div class="gds-admin-hint">Ouvrez un projet pour pouvoir « appliquer » un serveur à celui-ci.</div>`;
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
    captureIdentity();
    container.innerHTML = renderParamsShellHtml({
      sectionHtml: {
        servers: renderServersSectionHtml(state),
        identity: renderIdentitySectionHtml(identityState),
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
        });
      } else {
        await invoke("gds_add_saved_server", {
          host: state.form.host.trim(),
          port: state.form.port.trim(),
          user: state.form.user.trim(),
          dbPassword: state.form.dbPassword,
          adminPassword: state.form.adminPassword,
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
      state.form = { mode: "edit", oldHost: host, oldUser: user, host, port, user, dbPassword: "", adminPassword: "" };
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
      draw();
      return;
    }
    if (action === "apply") {
      const project = activeProject();
      if (!project) {
        state.status = { kind: "error", text: "Ouvrez un projet pour lui appliquer un serveur." };
        draw();
        return;
      }
      state.status = { kind: "loading", text: `Application à « ${project} »…` };
      draw();
      try {
        await invoke("gds_apply_server", { project, host, port, user, email: identityState.email.trim() });
        state.status = { kind: "ok", text: `✅ Serveur appliqué au projet actif (hôte, port, utilisateur, identité pré-remplis).` };
      } catch (e) {
        state.status = { kind: "error", text: friendlyGdsError(e) };
      }
      draw();
    }
  }

  function bind() {
    const test = q("#gds-params-srv-test");
    if (test) test.addEventListener("click", () => testForm());
    const save = q("#gds-params-srv-save");
    if (save) save.addEventListener("click", () => saveForm());
    const cancel = q("#gds-params-srv-cancel");
    if (cancel) cancel.addEventListener("click", () => resetForm());
    for (const btn of container.querySelectorAll("[data-srv-action]")) {
      btn.addEventListener("click", () => rowAction(btn));
    }
    // ── L5.3 : identité globale ──
    const idSave = q("#gds-params-id-save");
    if (idSave) idSave.addEventListener("click", () => saveIdentity());
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

  /** Message d'erreur lisible (les commandes renvoient déjà des messages). */
  function friendlyGdsError(e) {
    const s = String(e == null ? "" : e);
    return s.replace(/^Error:\s*/, "");
  }

  // Premier rendu (chargement) puis rafraîchissement des listes/états.
  draw();
  refreshServers();
  // L5.3 (identité globale) : chargement indépendant, fail-open — jamais
  // bloquant pour les autres sections.
  loadIdentity();

  // Aucune ressource système à libérer ; on renvoie néanmoins le contrat commun
  // des écrans (wrapper + unlisten) pour l'homogénéité de tabs.js.
  return {
    wrapper: container,
    unlisten: () => {
      disposed = true;
    },
  };
}
