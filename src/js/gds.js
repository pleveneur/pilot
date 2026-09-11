// gds.js — Onglet « 🌐 GDS » (Gestionnaire de Sources, spec_gds.md)
//
// Écran-état-machine (redessin R1-R5) : UI claire pour un non-spécialiste.
//  - En-tête d'état : badge « Connecté » / « En attente » / « À configurer ».
//  - Bloc « Identité » GLOBAL (email + nom git) en haut, saisi UNE SEULE FOIS,
//    pré-remplit tous les champs email (aucun champ email dans l'interface
//    simple) — R2.
//  - Étape « Connecter un serveur GDS » (réutiliser un serveur mémorisé OU
//    nouveau serveur) avec bouton « Activer GDS » — R1/R4.
//  - Bloc « ▶ Avancé » replié par défaut (SSH, listes serveurs/projets, purge,
//    Phase B/C), SANS aucun champ email — tout pré-rempli.
//  - État connecté compact (statut, synchroniser, verrou/relâcher, retirer du
//    GDS avec confirmation).
//  - Masquages conditionnels : rien de provisionné → SSH/PhaseB/PhaseC/listes
//    masqués ; déjà sur le serveur → bouton d'ajout masqué ; connecté →
//    provision + ajout masqués — R3.
//  - R5 : pleine largeur + disposition multi-colonnes.
//
// Règle secrets : les mots de passe ne remontent JAMAIS à l'UI (booleans
// seulement) ; identité email/nom dans ~/.pilot/gds_secrets.json (0600), jamais
// dans .pilot/gds.json.

import { invoke } from "@tauri-apps/api/core";
import { refreshIcons } from "./icons.js";

/** Chemin du projet actif (l'onglet GDS est PAR PROJET). */
function currentProjectPath() {
  return window._pilotProjectPath || null;
}

/** Échappe le HTML pour injection sûre dans innerHTML. */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

/** Traduit les erreurs git résiduelles en message compréhensible. */
function friendlyGdsError(e) {
  const msg = String(e == null ? "" : e);
  const lower = msg.toLowerCase();
  if (lower.includes("identité git") || lower.includes("identity unknown") ||
      lower.includes("user.name") || lower.includes("user.email")) {
    return "⚠️ Identité git incomplète : définissez votre nom git dans le bloc « Identité » en haut (demandé une seule fois).";
  }
  if (lower.includes("nom git requis")) {
    return "⚠️ Ajout annulé : le nom git est requis. Définissez-le dans le bloc « Identité » en haut (pré-rempli ensuite).";
  }
  if (lower.includes("remote add a échoué") && lower.includes("not a git repository")) {
    return "⚠️ Le dossier ne contenait pas encore de dépôt Git valide pendant l'attache. Réessayez après l'initialisation automatique.";
  }
  return msg;
}

/** Crée l'onglet GDS dans `container`. */
export function createGds(container) {
  container.classList.add("gds-view");
  container.innerHTML = `
    <div class="gds-scroll">
      <div class="gds-header">
        <div class="gds-title-row">
          <div class="gds-title">🌐 GDS — Gestionnaire de Sources</div>
          <div id="gds-state-badge" class="gds-badge"></div>
        </div>
        <div class="gds-subtitle" id="gds-subtitle">Chargement…</div>
      </div>
      <div id="gds-body" class="gds-body"></div>
    </div>
  `;
  refreshIcons(container);

  const bodyEl = container.querySelector("#gds-body");
  const subtitleEl = container.querySelector("#gds-subtitle");
  const badgeEl = container.querySelector("#gds-state-badge");

  // ── Badge d'état global (Connecté / En attente / À configurer) ──
  function setStateBadge(status, onServer) {
    if (status === "connected") {
      badgeEl.textContent = "● Connecté";
      badgeEl.className = "gds-badge gds-badge-ok";
    } else if (status === "error") {
      badgeEl.textContent = "● En attente";
      badgeEl.className = "gds-badge gds-badge-warn";
    } else {
      badgeEl.textContent = "○ À configurer";
      badgeEl.className = "gds-badge gds-badge-off";
    }
    badgeEl.title = onServer
      ? "Ce projet est déjà enregistré sur le serveur GDS."
      : "État de la connexion GDS de ce projet.";
  }

  // ── Bloc Identité GLOBAL (email + nom git, saisi une seule fois) ──
  function renderIdentity(identity) {
    const panel = document.createElement("div");
    panel.className = "gds-panel gds-panel-identity";
    panel.innerHTML = `
      <div class="gds-panel-title"><i data-lucide="user" class="icon-sm"></i> Identité (une seule saisie globale)</div>
      <div class="gds-panel-desc">
        Saisie <strong>une seule fois</strong>, pré-remplie partout ensuite. Votre
        email identifie votre compte GDS (clé SSH, membre de projets) ; votre nom
        git est réglé automatiquement (localement, jamais en global). Stockée hors
        projet (<code>~/.pilot/gds_secrets.json</code>, 0600).
      </div>
      <div class="gds-grid2">
        <div>
          <label class="gds-label">Email (identité globale)</label>
          <input id="gds-id-email" class="gds-input" value="${esc(identity.email)}" placeholder="dev@exemple.com" autocomplete="off">
        </div>
        <div>
          <label class="gds-label">Nom git</label>
          <input id="gds-id-name" class="gds-input" value="${esc(identity.git_name)}" placeholder="Prénom Nom" autocomplete="off">
        </div>
      </div>
      <div id="gds-id-err" class="gds-error"></div>
      <div id="gds-id-ok" class="gds-ok"></div>
      <div class="gds-actions">
        <button id="gds-id-save" class="web-btn"><i data-lucide="check" class="icon-sm"></i> Enregistrer l'identité</button>
      </div>
    `;
    bodyEl.appendChild(panel);
    refreshIcons(container);

    const err = panel.querySelector("#gds-id-err");
    const ok = panel.querySelector("#gds-id-ok");
    panel.querySelector("#gds-id-save").addEventListener("click", async () => {
      const email = panel.querySelector("#gds-id-email").value.trim();
      const name = panel.querySelector("#gds-id-name").value.trim();
      err.textContent = ""; ok.textContent = "";
      if (!email) { err.textContent = "L'email est requis (il identifie votre compte GDS)."; return; }
      try {
        await invoke("gds_save_identity", { email, gitName: name });
        ok.textContent = "✅ Identité globale enregistrée.";
      } catch (e) {
        err.textContent = String(e);
      }
    });
  }

  // ── Charge la liste des serveurs mémorisés validés (hôte/user seulement) ──
  function loadSavedServers(select, onLoaded) {
    async function run() {
      try {
        const servers = await invoke("gds_list_saved_servers");
        select.innerHTML = "";
        const empty = document.createElement("option");
        empty.value = "";
        empty.textContent = "— Choisir un serveur mémorisé —";
        select.appendChild(empty);
        for (const s of servers || []) {
          const opt = document.createElement("option");
          opt.value = `${s.user}@${s.host}`;
          opt.dataset.host = s.host;
          opt.dataset.port = s.port || "5432";
          opt.dataset.user = s.user;
          opt.textContent = `${s.user}@${s.host}:${s.port || "5432"}`;
          select.appendChild(opt);
        }
        if (onLoaded) onLoaded(servers || []);
      } catch (_) {
        if (onLoaded) onLoaded([]);
      }
    }
    run();
  }

  // ── Étape : Connecter un serveur GDS (server mémorisé OU nouveau) ──
  function renderConnect(cfg, secrets, identity, provisioned) {
    const panel = document.createElement("div");
    panel.className = "gds-panel gds-panel-main";
    const host = (cfg && cfg.db_host) || "";
    const port = (cfg && cfg.db_port) || "5432";
    const user = (cfg && cfg.db_user) || "";
    const hasDbPw = !!(secrets && secrets.db_password);
    const hasAdminPw = !!(secrets && secrets.admin_password);
    const emailOk = !!(identity.email);

    panel.innerHTML = `
      <div class="gds-panel-title"><i data-lucide="server" class="icon-sm"></i> Connecter un serveur GDS</div>
      <div class="gds-panel-desc">
        Active le GDS pour ce projet : crée la base <code>pilot_gds</code> + les
        tables + votre compte admin, et prépare le dossier de repos centralisé
        (<code>.pilot/gds.json</code>). Les mots de passe restent hors projet.
        L'email admin est votre <strong>identité globale</strong> (ci-dessus) — aucun champ à resaisir.
      </div>
      ${!emailOk ? `<div class="gds-warn">⚠️ Définissez d'abord votre <strong>email d'identité</strong> dans le bloc « Identité » en haut.</div>` : ""}
      <div class="gds-panel-desc" style="margin-top:8px"><strong>Réutiliser un serveur déjà mémorisé</strong> (mots de passe jamais affichés) :</div>
      <div class="gds-grid2">
        <div>
          <label class="gds-label">Serveur mémorisé</label>
          <select id="gds-server-select" class="gds-input"></select>
        </div>
        <div class="gds-actions" style="align-self:flex-end; margin-top:0">
          <button id="gds-server-apply" class="web-btn"><i data-lucide="rotate-ccw" class="icon-sm"></i> Réutiliser ce serveur</button>
        </div>
      </div>
      <div class="gds-panel-desc" style="margin-top:8px"><strong>Ou nouveau serveur</strong> (ou compléter) :</div>
      <div class="gds-grid2">
        <div>
          <label class="gds-label">Hôte PostgreSQL</label>
          <input id="gds-db-host" class="gds-input" value="${esc(host)}" placeholder="192.168.1.10" autocomplete="off">
        </div>
        <div>
          <label class="gds-label">Port</label>
          <input id="gds-db-port" class="gds-input" value="${esc(port)}" placeholder="5432" autocomplete="off">
        </div>
      </div>
      <div class="gds-grid2">
        <div>
          <label class="gds-label">Utilisateur dédié</label>
          <input id="gds-db-user" class="gds-input" value="${esc(user)}" placeholder="pilot" autocomplete="off">
        </div>
        <div>
          <label class="gds-label">Mot de passe dédié ${hasDbPw ? "<em style='color:#aaa'>(enregistré)</em>" : ""}</label>
          <div class="gds-pw">
            <input id="gds-db-password" type="password" class="gds-input" placeholder="••••••••" autocomplete="new-password">
            <button type="button" class="gds-eye" data-target="gds-db-password" title="Afficher/masquer"><i data-lucide="eye" class="icon-sm"></i></button>
          </div>
        </div>
      </div>
      <div class="gds-grid2">
        <div>
          <label class="gds-label">Mot de passe admin ${hasAdminPw ? "<em style='color:#aaa'>(enregistré)</em>" : ""}</label>
          <div class="gds-pw">
            <input id="gds-admin-password" type="password" class="gds-input" placeholder="••••••••" autocomplete="new-password">
            <button type="button" class="gds-eye" data-target="gds-admin-password" title="Afficher/masquer"><i data-lucide="eye" class="icon-sm"></i></button>
          </div>
        </div>
        <div class="gds-note-box">
          <em>L'email admin est votre identité globale (ci-dessus).</em>
        </div>
      </div>
      <div id="gds-provision-err" class="gds-error"></div>
      <div id="gds-provision-ok" class="gds-ok"></div>
      <div class="gds-actions">
        <button id="gds-activate-btn" class="web-btn"><i data-lucide="rocket" class="icon-sm"></i> Activer GDS</button>
      </div>
    `;
    bodyEl.appendChild(panel);
    refreshIcons(container);

    // Toggle afficher/masquer des mots de passe.
    panel.querySelectorAll(".gds-eye").forEach((eye) => {
      eye.addEventListener("click", () => {
        const input = panel.querySelector("#" + eye.dataset.target);
        if (!input) return;
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        eye.innerHTML = `<i data-lucide="${show ? "eye-off" : "eye"}" class="icon-sm"></i>`;
        refreshIcons(container);
      });
    });

    const serverSelect = panel.querySelector("#gds-server-select");
    const serverApply = panel.querySelector("#gds-server-apply");
    const email = (identity.email || "").trim();

    // Applique le serveur mémorisé au projet (pré-remplit le formulaire).
    async function applySelectedServer() {
      const project = currentProjectPath();
      if (!project) return;
      const opt = serverSelect.options[serverSelect.selectedIndex];
      if (!opt || !opt.dataset.host) return;
      const errEl = panel.querySelector("#gds-provision-err");
      const okEl = panel.querySelector("#gds-provision-ok");
      if (errEl) errEl.textContent = "";
      if (okEl) okEl.textContent = "";
      try {
        const res = await invoke("gds_apply_server", {
          project, host: opt.dataset.host, port: opt.dataset.port,
          user: opt.dataset.user, email,
        });
        panel.querySelector("#gds-db-host").value = res.db_host || opt.dataset.host;
        panel.querySelector("#gds-db-port").value = res.db_port || opt.dataset.port;
        panel.querySelector("#gds-db-user").value = res.db_user || opt.dataset.user;
        if (okEl) okEl.textContent = `✅ Serveur « ${opt.textContent} » sélectionné — cliquez « Activer GDS ».`;
      } catch (e) {
        if (errEl) errEl.textContent = String(e);
      }
    }
    serverSelect.addEventListener("change", () => {
      if (serverSelect.selectedIndex > 0) applySelectedServer();
    });
    serverApply.addEventListener("click", applySelectedServer);
    loadSavedServers(serverSelect);

    const btn = panel.querySelector("#gds-activate-btn");
    const err = panel.querySelector("#gds-provision-err");
    const ok = panel.querySelector("#gds-provision-ok");
    btn.addEventListener("click", async () => {
      const project = currentProjectPath();
      if (!project) { err.textContent = "Aucun projet ouvert."; return; }
      if (!email) { err.textContent = "Définissez d'abord votre email d'identité (bloc « Identité » en haut)."; return; }
      const dbHost = panel.querySelector("#gds-db-host").value.trim();
      const dbPort = panel.querySelector("#gds-db-port").value.trim();
      const dbUser = panel.querySelector("#gds-db-user").value.trim();
      const dbPassword = panel.querySelector("#gds-db-password").value;
      const adminPassword = panel.querySelector("#gds-admin-password").value;
      if (!dbHost || !dbUser) {
        err.textContent = "Hôte et utilisateur PostgreSQL sont requis.";
        return;
      }
      if (!dbPassword && !hasDbPw) {
        err.textContent = "Le mot de passe dédié est requis (ou déjà enregistré).";
        return;
      }
      if (!adminPassword && !hasAdminPw) {
        err.textContent = "Un mot de passe admin est requis (ou déjà enregistré).";
        return;
      }
      err.textContent = "";
      ok.textContent = "";
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader" class="icon-sm"></i> Activation…';
      refreshIcons(container);
      try {
        await invoke("gds_provision", {
          project, dbHost, dbPort, dbUser, dbPassword,
          adminEmail: email, adminPassword,
        });
        await refresh();
        const okEl = bodyEl.querySelector("#gds-provision-ok");
        if (okEl) okEl.textContent = "✅ Serveur provisionné et GDS activé pour ce projet.";
      } catch (e) {
        err.textContent = String(e);
        ok.textContent = "";
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="rocket" class="icon-sm"></i> Activer GDS';
        refreshIcons(container);
      }
    });
  }

  // ── Ajouter ce projet au GDS (déjà provisionné mais pas encore ajouté) ──
  function renderAdd(identity) {
    const panel = document.createElement("div");
    panel.className = "gds-panel gds-panel-main";
    panel.innerHTML = `
      <div class="gds-panel-title"><i data-lucide="git-branch" class="icon-sm"></i> Ajouter ce projet au GDS</div>
      <div class="gds-panel-desc">
        Crée le dépôt git bare sur le serveur, ajoute le remote <code>gds</code>
        et pousse la branche courante. L'identité git (email + nom) est réglée
        automatiquement depuis votre <strong>identité globale</strong> — aucune
        saisie ici.
      </div>
      <div id="gds-add-err" class="gds-error"></div>
      <div id="gds-add-ok" class="gds-ok"></div>
      <div class="gds-actions">
        <button id="gds-add-btn" class="web-btn"><i data-lucide="plus" class="icon-sm"></i> Ajouter le projet au GDS</button>
      </div>
    `;
    bodyEl.appendChild(panel);
    refreshIcons(container);

    const btn = panel.querySelector("#gds-add-btn");
    const err = panel.querySelector("#gds-add-err");
    const ok = panel.querySelector("#gds-add-ok");
    btn.addEventListener("click", async () => {
      const project = currentProjectPath();
      if (!project) { err.textContent = "Aucun projet ouvert."; return; }
      const email = (identity.email || "").trim();
      if (!email) { err.textContent = "Définissez d'abord votre email d'identité (bloc « Identité » en haut)."; return; }
      err.textContent = ""; ok.textContent = "";
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader" class="icon-sm"></i> Ajout…';
      refreshIcons(container);
      try {
        const res = await invoke("gds_add_project", {
          project, email,
          // Nom git pris depuis l'identité globale (backend effective_git_name).
          gitName: (identity.git_name || "").trim() || null,
        });
        await refresh();
        const okEl = bodyEl.querySelector("#gds-add-ok");
        if (okEl) {
          okEl.textContent = res && res.initialized
            ? "✅ Projet ajouté au GDS (dossier initialisé en dépôt Git + identité réglée localement)."
            : "✅ Projet ajouté au GDS.";
        }
      } catch (e) {
        err.textContent = friendlyGdsError(e);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="plus" class="icon-sm"></i> Ajouter le projet au GDS';
        refreshIcons(container);
      }
    });
  }

  // ── Badge « ✅ Déjà ajouté » ──
  function renderAlreadyAdded() {
    const panel = document.createElement("div");
    panel.className = "gds-panel";
    panel.innerHTML = `
      <div class="gds-panel-title"><i data-lucide="check-circle-2" class="icon-sm"></i> Projet sur le serveur</div>
      <div class="gds-panel-desc">
        <span class="gds-badge gds-badge-ok">✅ Déjà ajouté</span>
        Ce projet est déjà enregistré sur le serveur GDS — aucune action requise.
      </div>
    `;
    bodyEl.appendChild(panel);
    refreshIcons(container);
  }

  // ── État connecté compact (statut, synchro, verrou/relâcher, retirer) ──
  // R5 : multi-colonnes (plusieurs blocs côte à côte pour le confort).
  function renderConnected(cfg, identity) {
    const host = (cfg && cfg.db_host) || "";
    const wrap = document.createElement("div");
    wrap.className = "gds-cols";
    wrap.innerHTML = `
      <div class="gds-panel">
        <div class="gds-panel-title"><i data-lucide="check-circle-2" class="icon-sm"></i> GDS connecté</div>
        <div class="gds-panel-desc">
          <span class="gds-badge gds-badge-ok">Connecté</span>
          Serveur : <code>${esc(host || "—")}</code>. Synchronisation et verrous opérationnels.
        </div>
        <div id="gds-sync-err" class="gds-error"></div>
        <div id="gds-sync-ok" class="gds-ok"></div>
        <div id="gds-sync-status" class="gds-lock-state"></div>
        <div id="gds-lock-state" class="gds-lock-state"></div>
        <div class="gds-actions">
          <button id="gds-sync-btn" class="web-btn"><i data-lucide="refresh-cw" class="icon-sm"></i> Synchroniser</button>
          <button id="gds-release-btn" class="web-btn"><i data-lucide="unlock" class="icon-sm"></i> Relâcher le verrou</button>
        </div>
        <label class="gds-label">Raison du verrou urgent</label>
        <input id="gds-urgent-reason" class="gds-input" placeholder="Motif du passage en urgent" autocomplete="off">
        <div class="gds-actions">
          <button id="gds-urgent-btn" class="web-btn"><i data-lucide="alert-triangle" class="icon-sm"></i> Verrou urgent</button>
        </div>
      </div>
      <div class="gds-panel">${renderRemoveHtml("gds-connected-remove")}</div>
    `;
    bodyEl.appendChild(wrap);
    refreshIcons(container);

    const panel = wrap;
    const err = panel.querySelector("#gds-sync-err");
    const ok = panel.querySelector("#gds-sync-ok");
    const syncStatus = panel.querySelector("#gds-sync-status");
    const lockState = panel.querySelector("#gds-lock-state");

    async function refreshSyncStatus() {
      try {
        const s = await invoke("gds_sync_status");
        if (!s.enabled) {
          syncStatus.innerHTML = `<div class="gds-empty">GDS désactivé globalement — suivi fusionné inactif.</div>`;
          return;
        }
        const pending = s.pending || 0;
        const conflicts = s.last_conflicts || 0;
        const pushed = s.last_pushed || 0;
        const pulled = s.last_pulled || 0;
        const lastAt = s.last_sync_at ? new Date(s.last_sync_at).toLocaleString() : "jamais";
        let badge;
        if (s.offline) {
          badge = `<span class="gds-badge gds-badge-off">Hors-ligne</span>`;
        } else if (s.last_sync_ok) {
          badge = `<span class="gds-badge gds-badge-ok">Synchronisé</span>`;
        } else {
          badge = `<span class="gds-badge gds-badge-warn">En attente</span>`;
        }
        const conflictTxt = conflicts > 0 ? `<span class="gds-badge gds-badge-off">${conflicts} conflit(s)</span>` : "";
        syncStatus.innerHTML = `
          <div class="gds-row">
            <div class="gds-row-info">
              <div class="gds-row-title">Suivi fusionné — ${badge}</div>
              <div class="gds-row-sub">Dernière synchro : ${lastAt} — poussés ${pushed}, rapatriés ${pulled}${s.last_sync_error ? ` — ${esc(s.last_sync_error)}` : ""}</div>
            </div>
          </div>
        `;
      } catch (_) {
        syncStatus.innerHTML = `<div class="gds-empty">État de synchro indisponible.</div>`;
      }
    }

    async function refreshLock() {
      const project = currentProjectPath();
      if (!project) return;
      try {
        const lock = await invoke("gds_get_lock", { project });
        if (!lock) {
          lockState.innerHTML = `<div class="gds-empty">Aucun verrou actif sur ce projet.</div>`;
        } else {
          const held = lock.urgent ? " (urgent)" : "";
          lockState.innerHTML = `
            <div class="gds-row">
              <div class="gds-row-info">
                <div class="gds-row-title">Verrou détenu par ${esc(lock.email)}${held}</div>
                <div class="gds-row-sub">Expire : ${new Date(lock.expires_at).toLocaleString()} — ${esc(lock.reason || "—")}</div>
              </div>
            </div>
          `;
        }
      } catch (_) {
        lockState.innerHTML = `<div class="gds-empty">GDS non provisionné — verrou indisponible.</div>`;
      }
    }

    panel.querySelector("#gds-sync-btn").addEventListener("click", async () => {
      const project = currentProjectPath();
      if (!project) { err.textContent = "Aucun projet ouvert."; return; }
      err.textContent = ""; ok.textContent = "";
      const btn = panel.querySelector("#gds-sync-btn");
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader" class="icon-sm"></i> Synchronisation…';
      refreshIcons(container);
      try {
        const res = await invoke("gds_sync_project", { project });
        const lock = res.lock || {};
        ok.textContent = lock.acquired
          ? `✅ Synchronisé (${res.action}) et verrou acquis.`
          : `⚠️ Synchronisé (${res.action}) mais verrou détenu par ${lock.held_by || "un autre"} — conflit potentiel.`;
        await refreshLock();
        await refreshSyncStatus();
      } catch (e) {
        err.textContent = String(e);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="refresh-cw" class="icon-sm"></i> Synchroniser';
        refreshIcons(container);
      }
    });

    panel.querySelector("#gds-release-btn").addEventListener("click", async () => {
      const project = currentProjectPath();
      if (!project) { err.textContent = "Aucun projet ouvert."; return; }
      err.textContent = ""; ok.textContent = "";
      try {
        await invoke("gds_release_lock", { project });
        ok.textContent = "✅ Verrou relâché.";
        await refreshLock();
      } catch (e) {
        err.textContent = String(e);
      }
    });

    panel.querySelector("#gds-urgent-btn").addEventListener("click", async () => {
      const project = currentProjectPath();
      if (!project) { err.textContent = "Aucun projet ouvert."; return; }
      const reason = panel.querySelector("#gds-urgent-reason").value.trim();
      err.textContent = ""; ok.textContent = "";
      try {
        const res = await invoke("gds_urgent_lock", { project, reason });
        ok.textContent = res.replaced ? `✅ Verrou urgent acquis (remplace ${res.replaced}).` : "✅ Verrou urgent acquis.";
        await refreshLock();
      } catch (e) {
        err.textContent = String(e);
      }
    });

    wireRemove(panel, "gds-connected-remove");
    refreshLock();
    refreshSyncStatus();
  }

  // ── Bloc HTML de « Retirer du GDS » (avec confirmation) ──
  function renderRemoveHtml(idPrefix) {
    return `
      <div class="gds-remove-block" style="margin-top:18px; border-top:1px solid var(--border,#333); padding-top:12px">
        <div class="gds-panel-desc" style="margin-bottom:6px">
          <strong>Retirer ce projet du GDS</strong> — retire le remote <code>gds</code>
          local et supprime <code>.pilot/gds.json</code>. La purge serveur
          (suppression du dépôt bare + entrées en base) n'a lieu QUE si vous la
          cochez (jamais par défaut).
        </div>
        <div id="${idPrefix}-confirm" class="gds-panel" style="display:none; margin-top:8px">
          <div class="gds-panel-desc">Confirmez le retrait de ce projet du GDS. Action <strong>destructive</strong>.</div>
          <label class="gds-check"><input type="checkbox" id="${idPrefix}-purge"> Purger aussi le serveur (dépôt bare + entrées en base)</label>
          <div id="${idPrefix}-err" class="gds-error"></div>
          <div id="${idPrefix}-ok" class="gds-ok"></div>
          <div class="gds-actions">
            <button id="${idPrefix}-confirm-btn" class="web-btn danger"><i data-lucide="trash-2" class="icon-sm"></i> Confirmer le retrait</button>
            <button id="${idPrefix}-cancel" class="web-btn">Annuler</button>
          </div>
        </div>
        <button id="${idPrefix}-btn" class="web-btn"><i data-lucide="log-out" class="icon-sm"></i> Retirer du GDS</button>
      </div>
    `;
  }

  // ── Branche le bouton « Retirer du GDS » ──
  function wireRemove(panel, idPrefix) {
    const removeBtn = panel.querySelector("#" + idPrefix + "-btn");
    if (!removeBtn) return;
    const confirmBox = panel.querySelector("#" + idPrefix + "-confirm");
    const purgeCheck = panel.querySelector("#" + idPrefix + "-purge");
    const removeErr = panel.querySelector("#" + idPrefix + "-err");
    const removeOk = panel.querySelector("#" + idPrefix + "-ok");
    purgeCheck.checked = false;
    removeBtn.addEventListener("click", () => {
      removeOk.textContent = ""; removeErr.textContent = "";
      confirmBox.style.display = confirmBox.style.display === "none" ? "block" : "none";
    });
    panel.querySelector("#" + idPrefix + "-cancel").addEventListener("click", () => {
      confirmBox.style.display = "none";
    });
    panel.querySelector("#" + idPrefix + "-confirm-btn").addEventListener("click", async () => {
      const project = currentProjectPath();
      if (!project) { removeErr.textContent = "Aucun projet ouvert."; return; }
      const purgeServer = purgeCheck.checked;
      removeErr.textContent = ""; removeOk.textContent = "";
      const btn = panel.querySelector("#" + idPrefix + "-confirm-btn");
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader" class="icon-sm"></i> Retrait…';
      refreshIcons(container);
      try {
        const res = await invoke("gds_remove_project", { project, purgeServer });
        removeOk.textContent = res.purged_server
          ? "✅ Projet retiré du GDS (purge serveur effectuée)."
          : "✅ Projet retiré du GDS (sans purge serveur).";
        confirmBox.style.display = "none";
        await refresh();
      } catch (e) {
        removeErr.textContent = String(e);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="trash-2" class="icon-sm"></i> Confirmer le retrait';
        refreshIcons(container);
      }
    });
  }

  // ── Listes serveur & projets (Avancé) ──
  function renderLists() {
    async function run(panel) {
      const projEl = panel.querySelector("#gds-adv-projects");
      const repoEl = panel.querySelector("#gds-adv-repos");
      let projects = [];
      let repos = [];
      try { projects = await invoke("gds_list_projects"); } catch (_) { projects = null; }
      try { repos = await invoke("gds_list_git_repos"); } catch (_) { repos = null; }
      if (projects == null) {
        projEl.innerHTML = `<div class="gds-empty">GDS non provisionné — liste indisponible.</div>`;
      } else if (!projects.length) {
        projEl.innerHTML = `<div class="gds-empty">Aucun projet enregistré sur le serveur.</div>`;
      } else {
        projEl.innerHTML = "";
        for (const p of projects) {
          const row = document.createElement("div");
          row.className = "gds-row";
          row.innerHTML = `
            <div class="gds-row-info">
              <div class="gds-row-title">${esc(p.name)}</div>
              <div class="gds-row-sub">${esc(p.repo_url || "")}</div>
            </div>
            <span class="gds-chip">${esc(p.status || "")}</span>`;
          projEl.appendChild(row);
        }
      }
      if (repos == null) {
        repoEl.innerHTML = `<div class="gds-empty">GDS non provisionné — liste indisponible.</div>`;
      } else if (!repos.length) {
        repoEl.innerHTML = `<div class="gds-empty">Aucun dépôt git enregistré.</div>`;
      } else {
        repoEl.innerHTML = "";
        for (const r of repos) {
          const row = document.createElement("div");
          row.className = "gds-row";
          row.innerHTML = `<div class="gds-row-info"><div class="gds-row-title">${esc(r.bare_path || "")}</div><div class="gds-row-sub">projet #${esc(r.project_id)}</div></div>`;
          repoEl.appendChild(row);
        }
      }
      refreshIcons(container);
    }
    return (panel) => { const _ = panel; run(panel); };
  }

  // ── Bloc « Avancé » replié par défaut ──
  function renderAdvanced(cfg, provisioned, connected, onServer) {
    const panel = document.createElement("div");
    panel.className = "gds-panel gds-panel-advanced";
    const host = (cfg && cfg.db_host) || "";
    const port = (cfg && cfg.db_port) || "";
    const user = (cfg && cfg.db_user) || "";
    panel.innerHTML = `
      <button id="gds-adv-toggle" class="gds-adv-title"><i data-lucide="chevron-down" class="icon-sm"></i> ▶ Avancé</button>
      <div id="gds-adv-body" style="display:none">
        ${provisioned ? `
        <div class="gds-panel-desc" style="margin-bottom:6px"><strong>Config projet</strong> (gérées automatiquement) :</div>
        <div class="gds-grid3">
          <div><label class="gds-label">Hôte</label><input class="gds-input" value="${esc(host)}" readonly></div>
          <div><label class="gds-label">Port</label><input class="gds-input" value="${esc(port)}" readonly></div>
          <div><label class="gds-label">Utilisateur</label><input class="gds-input" value="${esc(user)}" readonly></div>
        </div>
        ` : ""}
        <div class="gds-panel-desc" style="margin-top:12px; margin-bottom:6px"><strong>Serveurs GDS mémorisés</strong> (hôte/utilisateur uniquement — jamais les mots de passe) :</div>
        <div id="gds-adv-servers" class="gds-list"></div>
        ${provisioned ? `
        <div class="gds-panel-desc" style="margin-top:12px; margin-bottom:6px"><strong>Projets & dépôts du serveur</strong> :</div>
        <div id="gds-adv-projects" class="gds-list"></div>
        <div id="gds-adv-repos" class="gds-list"></div>
        ` : ""}
        ${provisioned ? renderSshHtml() : ""}
        ${provisioned && !connected ? renderRemoveHtml("gds-adv-remove") : ""}
      </div>
    `;
    bodyEl.appendChild(panel);
    refreshIcons(container);

    const toggle = panel.querySelector("#gds-adv-toggle");
    const advBody = panel.querySelector("#gds-adv-body");
    toggle.addEventListener("click", () => {
      const hidden = advBody.style.display === "none";
      advBody.style.display = hidden ? "block" : "none";
      toggle.querySelector("i").setAttribute("data-lucide", hidden ? "chevron-up" : "chevron-down");
      refreshIcons(container);
    });

    // Serveurs mémorisés.
    const serversEl = panel.querySelector("#gds-adv-servers");
    (async () => {
      let servers = [];
      try { servers = await invoke("gds_list_saved_servers"); } catch (_) { servers = []; }
      if (!servers.length) {
        serversEl.innerHTML = `<div class="gds-empty">Aucun serveur mémorisé.</div>`;
      } else {
        for (const s of servers) {
          const row = document.createElement("div");
          row.className = "gds-row";
          row.innerHTML = `<div class="gds-row-info"><div class="gds-row-title">${esc(s.user)}@${esc(s.host)}:${esc(s.port || "5432")}</div><div class="gds-row-sub">validé</div></div>`;
          serversEl.appendChild(row);
        }
      }
      refreshIcons(container);
    })();

    if (provisioned) {
      wireSsh(panel);
      if (!connected) wireRemove(panel, "gds-adv-remove");
      renderLists()(panel);
    }
  }

  // ── HTML des clefs SSH (phase A3) ──
  function renderSshHtml() {
    return `
      <div class="gds-panel-desc" style="margin-top:14px; margin-bottom:6px"><strong>Clefs SSH</strong> (gérées automatiquement ; utile pour une clef de dev externe) :</div>
      <div id="gds-ssh-poste" class="gds-ssh-poste"></div>
      <div class="gds-actions">
        <button id="gds-ssh-key-btn" class="web-btn"><i data-lucide="key-round" class="icon-sm"></i> Générer / afficher la clef du poste</button>
      </div>
      <div class="gds-panel-desc" style="margin-top:8px"><strong>Enregistrer une clef de dev</strong> (liée à un email) :</div>
      <label class="gds-label">Email</label>
      <input id="gds-ssh-email" class="gds-input" placeholder="dev@exemple.com" autocomplete="off">
      <label class="gds-label">Clef publique</label>
      <textarea id="gds-ssh-pubkey" class="gds-input gds-textarea" rows="2" placeholder="ssh-ed25519 AAAA..." autocomplete="off"></textarea>
      <div id="gds-ssh-err" class="gds-error"></div>
      <div id="gds-ssh-ok" class="gds-ok"></div>
      <div class="gds-actions">
        <button id="gds-ssh-register-btn" class="web-btn"><i data-lucide="plus" class="icon-sm"></i> Enregistrer la clef</button>
      </div>
    `;
  }

  function wireSsh(panel) {
    const err = panel.querySelector("#gds-ssh-err");
    const ok = panel.querySelector("#gds-ssh-ok");
    const posteEl = panel.querySelector("#gds-ssh-poste");
    async function showPosteKey() {
      try {
        const res = await invoke("gds_ssh_key");
        posteEl.innerHTML = `
          <div class="gds-row">
            <div class="gds-row-info">
              <div class="gds-row-title">${res.generated ? "Clef générée" : "Clef existante"}</div>
              <div class="gds-row-sub">${esc(res.path)}</div>
              <div class="gds-ssh-key">${esc(res.public_key)}</div>
            </div>
          </div>`;
      } catch (e) {
        posteEl.innerHTML = `<div class="gds-error">${esc(String(e))}</div>`;
      }
    }
    panel.querySelector("#gds-ssh-key-btn").addEventListener("click", showPosteKey);
    panel.querySelector("#gds-ssh-register-btn").addEventListener("click", async () => {
      const email = panel.querySelector("#gds-ssh-email").value.trim();
      const publicKey = panel.querySelector("#gds-ssh-pubkey").value.trim();
      if (!email) { err.textContent = "L'email est requis."; return; }
      if (!publicKey) { err.textContent = "La clef publique est requise."; return; }
      err.textContent = ""; ok.textContent = "";
      try {
        await invoke("gds_register_ssh_key", { email, publicKey });
        ok.textContent = "✅ Clef enregistrée et authorized_keys à jour.";
      } catch (e) {
        err.textContent = String(e);
      }
    });
    showPosteKey();
  }

  // ── Rendu complet (écran-état-machine) ──
  async function refresh() {
    const project = currentProjectPath();
    subtitleEl.textContent = project
      ? `Projet : ${project}`
      : "Aucun projet ouvert — ouvrez un projet pour configurer le GDS.";

    bodyEl.innerHTML = "";
    if (!project) {
      badgeEl.textContent = "○ À configurer";
      badgeEl.className = "gds-badge gds-badge-off";
      bodyEl.innerHTML = `<div class="gds-empty">Ouvrez un projet pour configurer le GDS (activé projet par projet).</div>`;
      return;
    }

    // Identité globale (email + nom git) — R2.
    let identity = { email: "", git_name: "" };
    try { identity = await invoke("gds_identity_prefs") || identity; } catch (_) {}

    // État de connexion (status + présence sur serveur) — R3.
    let conn = { status: "not_configured", on_server: false };
    try { conn = await invoke("gds_connection_status", { project }) || conn; } catch (_) {}
    const status = conn.status || "not_configured";
    const onServer = !!(conn.on_server);

    // Config projet.
    let cfg = null;
    try { cfg = await invoke("gds_get_config", { project }); } catch (_) { cfg = null; }
    let secrets = null;
    try { secrets = await invoke("gds_secrets_status", { project }); } catch (_) { secrets = null; }

    const provisioned = !!(cfg && cfg.enabled);

    setStateBadge(status, onServer);
    renderIdentity(identity);

    if (status === "connected") {
      renderConnected(cfg, identity);
    } else {
      renderConnect(cfg, secrets, identity, provisioned);
      if (provisioned && !onServer) {
        renderAdd(identity);
      }
      if (!provisioned && onServer) {
        renderAlreadyAdded();
      }
    }

    renderAdvanced(cfg, provisioned, status === "connected", onServer);
    refreshIcons(container);
  }

  // Recharge quand le projet actif change (bascule de projet).
  let lastProjectPath = currentProjectPath();
  function refreshIfProjectChanged() {
    const cur = currentProjectPath();
    if (cur !== lastProjectPath) {
      lastProjectPath = cur;
      refresh();
    }
  }
  const onProjectSensitivity = () => refreshIfProjectChanged();
  document.addEventListener("pilot-project-sensitivity", onProjectSensitivity);

  function setActive(active) {
    if (active) refreshIfProjectChanged();
  }

  refresh();

  return {
    wrapper: container,
    unlisten: () => {
      document.removeEventListener("pilot-project-sensitivity", onProjectSensitivity);
    },
    refresh: refreshIfProjectChanged,
    setActive,
  };
}
