// gds.js — Onglet « 🌐 GDS » (Gestionnaire de Sources, spec_gds.md)
//
// Écran-état-machine (redessin R1-R5) : UI claire pour un non-spécialiste.
//  - En-tête d'état : badge « Connecté » / « En attente » / « À configurer ».
//  - Bloc « Identité » GLOBAL (email + nom git) en haut, saisi UNE SEULE FOIS,
//    pré-remplit tous les champs email (aucun champ email dans l'interface
//    simple) — R2.
//  - Étape « Connecter un serveur GDS » (réutiliser un serveur mémorisé OU
//    nouveau serveur) avec bouton « Activer GDS » — R1/R4.
//  - Projet DÉJÀ rattaché à un serveur (config `.pilot/gds.json` présente) :
//    écran MINIMAL — le serveur choisi (nom de la fiche mémorisée), l'état de
//    la liaison (deux faits distincts : « enregistré sur le serveur » / « liaison
//    de ce poste à vérifier »), « Vérifier la liaison », « Ajouter le projet au
//    GDS » si nécessaire, et « Retirer du GDS ». Aucun champ technique (hôte de
//    base, port SSH, racine des dépôts, dossier de clonage) : ces valeurs
//    restent dans `.pilot/gds.json`, lues par le backend au moment d'agir.
//  - Masquages conditionnels : projet non rattaché → formulaire d'activation ;
//    déjà sur le serveur → bouton d'ajout masqué ; connecté → état compact
//    (synchro + retrait) — R3.
//  - R5 : pleine largeur + disposition multi-colonnes.
//
// Règle secrets : les mots de passe ne remontent JAMAIS à l'UI (booleans
// seulement) ; identité email/nom dans ~/.pilot/gds_secrets.json (0600), jamais
// dans .pilot/gds.json.

import { invoke } from "@tauri-apps/api/core";
import { refreshIcons } from "./icons.js";

/**
 * Durée maximale d'attente de l'état de connexion GDS (ms). L'état repose
 * désormais sur un fait vérifiable (interrogation du dépôt réellement servi),
 * qui peut coûter un aller-retour réseau : borne portée à 9 s pour ne pas
 * annoncer « la base ne répond pas » pendant une vérification honnête.
 */
export const GDS_CONNECTION_TIMEOUT_MS = 9000;

/** Surface d'attente peinte AVANT toute commande : jamais d'écran vide. */
const GDS_LOADING_HTML =
  `<div class="gds-empty">⏳ Vérification de la connexion…</div>`;

/** Message actionnable quand la vérification de connexion dépasse la borne. */
const GDS_TIMEOUT_HTML =
  `<div class="gds-panel">` +
  `<div class="gds-empty">⚠️ La base GDS ne répond pas (aucune réponse en ${Math.round(GDS_CONNECTION_TIMEOUT_MS / 1000)} s).</div>` +
  `<div class="gds-panel-desc">Vérifiez que le serveur GDS est démarré et que le port de la base est le bon, puis réessayez.</div>` +
  `<button id="gds-retry" class="web-btn"><i data-lucide="rotate-cw" class="icon-sm"></i> Réessayer</button>` +
  `</div>`;

/**
 * Interroge `gds_connection_status` avec une BORNE de temps : une commande qui
 * ne se règle jamais (base injoignable, migration bloquée sur un verrou
 * PostgreSQL) ne doit jamais laisser l'onglet sans réponse. Fail-open : un rejet
 * ou un délai dépassé renvoie un état `error` exploitable par l'appelant.
 * @returns {Promise<{status: string, on_server: boolean, timedOut: boolean, error?: string}>}
 */
export async function fetchGdsConnectionStatus(
  invokeFn,
  project,
  timeoutMs = GDS_CONNECTION_TIMEOUT_MS
) {
  let timer = null;
  const expired = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ __timeout: true }), timeoutMs);
  });
  try {
    const conn = await Promise.race([
      Promise.resolve(invokeFn("gds_connection_status", { project })).then((c) => c || {}),
      expired,
    ]);
    if (conn.__timeout) {
      return { status: "error", on_server: false, timedOut: true };
    }
    return { ...conn, timedOut: false };
  } catch (e) {
    console.error("[gds] gds_connection_status a échoué :", e);
    return { status: "error", on_server: false, timedOut: false, error: String(e) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Rendre la panne visible : une promesse non rattrapée (commande Tauri sans
// réponse, exception de rendu) ne doit plus être totalement silencieuse.
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("unhandledrejection", (e) => {
    console.error("[gds] erreur asynchrone non rattrapée :", (e && (e.reason || e.detail)) || e);
  });
}

/** Chemin du projet actif (l'onglet GDS est PAR PROJET). */
function currentProjectPath() {
  return window._pilotProjectPath || null;
}

/**
 * Signale qu'un état GDS d'un projet a changé : la barre « Projets en cours »
 * (suffixe GDS du nom) se redessine sans attendre une bascule de projet.
 * Événement seul — aucun état mémorisé (le suffixe est recalculé à l'affichage).
 */
function notifyGdsChanged() {
  document.dispatchEvent(new CustomEvent("pilot-gds-changed"));
}

/** Échappe le HTML pour injection sûre dans innerHTML. */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

/** Phrase simple affichée quand Git refuse la confiance du dossier des dépôts. */
export const TRUST_REFUSAL_MESSAGE =
  "🔒 Le serveur local n'a pas encore autorisé ce projet. Pilot peut corriger cela tout seul, en un clic.";

/**
 * Vrai si l'échec est le refus de confiance Git du dossier des dépôts
 * (`fatal: detected dubious ownership in repository at '…'`).
 * @param {*} e message d'échec brut (chaîne ou Error)
 * @returns {boolean}
 */
export function isTrustRefusal(e) {
  const lower = String(e == null ? "" : (e && e.message) || e).toLowerCase();
  return lower.includes("dubious ownership") || lower.includes("safe.directory");
}

/** Traduit les erreurs git résiduelles en message compréhensible. */
export function friendlyGdsError(e) {
  const msg = String(e == null ? "" : e);
  const lower = msg.toLowerCase();
  if (isTrustRefusal(msg)) {
    return TRUST_REFUSAL_MESSAGE;
  }
  if (lower.includes("identité git") || lower.includes("identity unknown") ||
      lower.includes("user.name") || lower.includes("user.email")) {
    return "⚠️ Identité git incomplète : définissez votre nom git dans l'onglet « ⚙️ GDS — paramétrage » → Mon identité (demandé une seule fois).";
  }
  if (lower.includes("nom git requis")) {
    return "⚠️ Ajout annulé : le nom git est requis. Définissez-le dans l'onglet « ⚙️ GDS — paramétrage » → Mon identité (pré-rempli ensuite).";
  }
  if (lower.includes("remote add a échoué") && lower.includes("not a git repository")) {
    return "⚠️ Le dossier ne contenait pas encore de dépôt Git valide pendant l'attache. Réessayez après l'initialisation automatique.";
  }
  return msg;
}

/**
 * Affiche l'échec d'un geste GDS. Si c'est le refus de confiance Git du dossier
 * des dépôts, un bandeau court propose un bouton qui déclenche la correction
 * automatique (`gds_service_trust` — autorisation Windows si nécessaire) puis
 * relance le geste ; sinon, le message habituel est affiché (inchangé).
 * @param {HTMLElement} errEl emplacement d'erreur de la page (`.gds-error`)
 * @param {*} e message d'échec brut
 * @param {Function} [retry] geste à relancer après la correction
 */
export function showGdsError(errEl, e, retry) {
  if (!errEl) return;
  if (!isTrustRefusal(e)) {
    errEl.textContent = friendlyGdsError(e);
    return;
  }
  const project = currentProjectPath();
  errEl.innerHTML =
    `${esc(TRUST_REFUSAL_MESSAGE)} ` +
    `<button id="gds-trust-fix" class="web-btn" type="button">` +
    `<i data-lucide="shield-check" class="icon-sm"></i> Autoriser ce projet automatiquement</button>`;
  refreshIcons(errEl);
  const fix = errEl.querySelector("#gds-trust-fix");
  if (!fix) return;
  fix.addEventListener("click", async () => {
    fix.disabled = true;
    fix.textContent = "Autorisation en cours… si Windows demande une confirmation, acceptez-la.";
    try {
      await invoke("gds_service_trust", { project });
    } catch (err) {
      // Refus ou échec de l'autorisation : on relance quand même le geste, qui
      // redira l'état réel (aucun mensonge à l'écran).
      console.error("[gds] correction de la confiance Git échouée :", err);
    }
    fix.disabled = false;
    if (typeof retry === "function") retry();
  });
}

/**
 * Libellé lisible du serveur d'un projet : le **nom de la fiche mémorisée**
 * quand elle correspond (même hôte + même utilisateur), sinon `utilisateur@hôte`.
 * Ne remonte JAMAIS de secret (la liste des fiches n'en contient aucun).
 * @returns {Promise<string>}
 */
async function savedServerLabel(cfg) {
  const host = String((cfg && cfg.db_host) || "").trim();
  const user = String((cfg && cfg.db_user) || "").trim();
  const fallback = user && host ? `${user}@${host}` : host || "—";
  try {
    const fiches = await invoke("gds_list_saved_servers");
    const f = (fiches || []).find(
      (s) =>
        String(s.host || "").trim().toLowerCase() === host.toLowerCase() &&
        String(s.user || "").trim().toLowerCase() === user.toLowerCase()
    );
    return f && f.name ? String(f.name) : fallback;
  } catch (_) {
    return fallback;
  }
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
  // Message affiché au rendu suivant (ex: clé du poste à enregistrer sur un
  // serveur GDS). Jamais de secret.
  let pendingNotice = "";

  // Bascule d'édition des valeurs techniques d'un projet DÉJÀ rattaché : le
  // formulaire d'activation est rouvert pré-rempli (sans lui, un projet mal
  // configuré n'a plus aucun chemin de correction). Remis à false au retour ou
  // au changement de projet.
  let editRegistered = false;

  // ── Badge d'état global (Connecté / En attente / À configurer) ──
  function setStateBadge(status, onServer) {
    if (status === "connected") {
      badgeEl.textContent = "● Connecté";
      badgeEl.className = "gds-badge gds-badge-ok";
    } else if (status === "not_published") {
      // Dépôt du serveur VIDE : la branche attendue n'a jamais été publiée.
      // Jamais « Connecté » : la synchronisation ne peut pas fonctionner.
      badgeEl.textContent = "● Enregistré sur le serveur — dépôt vide, à publier";
      badgeEl.className = "gds-badge gds-badge-warn";
    } else if (status === "error") {
      // Même vocabulaire que le panneau (deux faits distincts) : l'inscription
      // sur le serveur d'un côté, la liaison de ce poste de l'autre.
      badgeEl.textContent = onServer
        ? "● Enregistré sur le serveur — liaison à vérifier"
        : "● Liaison à vérifier";
      badgeEl.className = "gds-badge gds-badge-warn";
    } else {
      badgeEl.textContent = "○ À configurer";
      badgeEl.className = "gds-badge gds-badge-off";
    }
    badgeEl.title = onServer
      ? "Projet enregistré sur le serveur GDS — la liaison de ce poste au dépôt reste à vérifier."
      : "La liaison de ce poste vers la base et le dépôt GDS reste à vérifier.";
  }

  // NB (refonte GDS, L5.3) : le bloc « Identité » a été DÉPLACÉ vers l'onglet
  // transverse « ⚙️ GDS — paramétrage » → Mon identité (mêmes commandes
  // `gds_identity_prefs` / `gds_save_identity`, mêmes règles, même stockage).
  // Il n'est donc plus affiché ici : l'identité reste globale (hors projet) et
  // pré-remplit ce formulaire via la variable `identity`.

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
    // Renvoie la promesse : l'appelant peut enchaîner `.then(...)` (présélection
    // du serveur du projet). Sans ce `return`, `.then` s'appliquait à `undefined`
    // et interrompait le branchement des boutons suivants (Activer GDS, Retour).
    return run();
  }

  // ── Étape : Connecter un serveur GDS (server mémorisé OU nouveau) ──
  function renderConnect(cfg, secrets, identity, provisioned) {
    const panel = document.createElement("div");
    panel.className = "gds-panel gds-panel-main";
    const localDir = (cfg && cfg.gds_local_dir) || "";
    const emailOk = !!(identity.email);
    // Mot de passe manquant (projet déjà provisionné) : l'écran ne ressaisit plus
    // ces secrets — ils sont recopiés depuis la FICHE du serveur par « Enregistrer
    // la configuration ». On signale seulement où intervenir.
    const missingPwNotice =
      provisioned && !(secrets && (secrets.db_password || secrets.admin_password))
        ? `<div class="gds-warn">⚠️ Mot de passe serveur non mémorisé pour ce projet : cliquez « Enregistrer la configuration » (il est recopié depuis la fiche du serveur) — pour le corriger, utilisez l'onglet « ⚙️ GDS — paramétrage » → Serveurs GDS.</div>`
        : "";

    panel.innerHTML = `
      <div class="gds-panel-title"><i data-lucide="server" class="icon-sm"></i> ${provisioned ? "Corriger la configuration du serveur GDS" : "Connecter un serveur GDS"}</div>
      <div class="gds-panel-desc">
        ${provisioned
          ? `Ce projet est <strong>déjà activé</strong> : choisissez un autre serveur dans la liste, ajustez le dossier local de clonage, puis cliquez sur <strong>« Enregistrer la configuration »</strong>. Les valeurs techniques du serveur (adresse, port du service, port SSH, racine des dépôts) viennent de sa fiche — onglet « ⚙️ GDS — paramétrage » → Serveurs GDS. « Activer GDS » reste disponible et sans risque (l'activation est répétable).`
          : `Active le GDS pour ce projet : crée la base <code>pilot_gds</code> + les tables + votre compte admin, et prépare le dossier de repos centralisé (<code>.pilot/gds.json</code>). Les mots de passe restent hors projet. L'email admin est votre <strong>identité globale</strong> (onglet « ⚙️ GDS — paramétrage » → Mon identité) — aucun champ à resaisir.`}
      </div>
      ${!emailOk ? `<div class="gds-warn">⚠️ Définissez d'abord votre <strong>email d'identité</strong> dans l'onglet « ⚙️ GDS — paramétrage » → Mon identité.</div>` : ""}
      <div class="gds-panel-desc" style="margin-top:8px"><strong>Serveur GDS de ce projet</strong> : choisissez-le dans la liste. La fiche porte les valeurs techniques du serveur (adresse, port du service, port SSH, racine des dépôts) ; pour ajouter ou corriger une fiche, utilisez l'onglet « ⚙️ GDS — paramétrage » → Serveurs GDS.</div>
      <div class="gds-grid2">
        <div>
          <label class="gds-label">Serveur mémorisé</label>
          <select id="gds-server-select" class="gds-input"></select>
        </div>
        <div class="gds-actions" style="align-self:flex-end; margin-top:0">
          <button id="gds-server-apply" class="web-btn"><i data-lucide="rotate-ccw" class="icon-sm"></i> Appliquer ce serveur</button>
        </div>
      </div>
      <div id="gds-provision-err" class="gds-error"></div>
      <div id="gds-provision-ok" class="gds-ok"></div>
      <div class="gds-grid2">
        <div>
          <label class="gds-label">Dossier local de clonage</label>
          <input id="gds-local-dir" class="gds-input" value="${esc(localDir)}" placeholder="(défaut : ~/Pilot/GDS)" autocomplete="off">
        </div>
        <div class="gds-note-box">
          <em>Ce dossier est <strong>local à ce poste</strong> (où le dépôt sera cloné). Les valeurs du serveur viennent de sa fiche.</em>
        </div>
      </div>
      ${missingPwNotice}
      <div class="gds-actions">
        <button id="gds-save-cfg-btn" class="web-btn"><i data-lucide="save" class="icon-sm"></i> Enregistrer la configuration</button>
        <button id="gds-activate-btn" class="web-btn"><i data-lucide="rocket" class="icon-sm"></i> Activer GDS</button>
        ${provisioned ? `<button id="gds-edit-back-btn" class="web-btn"><i data-lucide="arrow-left" class="icon-sm"></i> Retour</button>` : ""}
      </div>
    `;
    bodyEl.appendChild(panel);
    refreshIcons(container);

    // Toggle afficher/masquer des mots de passe (inerte depuis que l'écran du
    // projet n'affiche plus de champ mot de passe : conservé pour les autres écrans).
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

    // ── Serveur choisi / dossier local ──
    // L'écran ne demande PLUS aucune valeur technique du serveur : `gds_apply_server`
    // recopie de la FICHE l'hôte, le port, l'utilisateur, l'e-mail, le port SSH
    // et la racine des dépôts. Le poste n'apporte que son dossier local de clonage.
    function selectedFiche() {
      const opt = serverSelect && serverSelect.options[serverSelect.selectedIndex];
      if (!opt || !opt.dataset.host) return null;
      return {
        host: opt.dataset.host,
        port: opt.dataset.port,
        user: opt.dataset.user,
        email: String(opt.dataset.email || "").trim(),
        label: opt.textContent,
      };
    }

    /**
     * Applique au projet la fiche serveur choisie (config `.pilot/gds.json` +
     * mots de passe recopiés hors projet par le backend) puis enregistre le
     * dossier local de clonage. Renvoie la fiche effectivement appliquée.
     */
    async function applyFiche() {
      const project = currentProjectPath();
      if (!project) throw new Error("Aucun projet ouvert.");
      const f = selectedFiche();
      if (!f) {
        throw new Error(
          "Choisissez d'abord un serveur dans la liste — pour en ajouter ou en corriger un, " +
            "utilisez l'onglet « ⚙️ GDS — paramétrage » → Serveurs GDS."
        );
      }
      await invoke("gds_apply_server", {
        project, host: f.host, port: f.port, user: f.user, email: f.email || email,
      });
      const localDir = panel.querySelector("#gds-local-dir").value.trim();
      const cfg = await invoke("gds_get_config", { project });
      if (cfg && cfg.enabled) {
        cfg.gds_local_dir = localDir || null;
        await invoke("gds_save_config", { project, cfg });
      }
      return f;
    }

    // « Enregistrer la configuration » (serveur choisi + dossier local).
    const saveCfgBtn = panel.querySelector("#gds-save-cfg-btn");
    saveCfgBtn.addEventListener("click", async () => {
      const errEl = panel.querySelector("#gds-provision-err");
      const okEl = panel.querySelector("#gds-provision-ok");
      errEl.textContent = ""; okEl.textContent = "";
      saveCfgBtn.disabled = true;
      try {
        const f = await applyFiche();
        okEl.textContent = `✅ Configuration enregistrée (serveur « ${f.label} », dossier local).`;
        notifyGdsChanged();
      } catch (e) {
        errEl.textContent = friendlyGdsError(e);
      } finally {
        saveCfgBtn.disabled = false;
      }
    });

    // « Appliquer ce serveur » : même écriture, sans changer de serveur ensuite.
    serverApply.addEventListener("click", async () => {
      const errEl = panel.querySelector("#gds-provision-err");
      const okEl = panel.querySelector("#gds-provision-ok");
      errEl.textContent = ""; okEl.textContent = "";
      try {
        const f = await applyFiche();
        okEl.textContent = `✅ Serveur « ${f.label} » appliqué — cliquez « Activer GDS ».`;
        notifyGdsChanged();
      } catch (e) {
        if (errEl) errEl.textContent = String(e);
      }
    });
    loadSavedServers(serverSelect).then(() => {
      // Présélection : la fiche du serveur déjà configuré pour ce projet.
      const want = String((cfg && cfg.db_host) || "").trim().toLowerCase();
      if (!want) return;
      const i = Array.from(serverSelect.options).findIndex(
        (o) => String(o.dataset.host || "").trim().toLowerCase() === want
      );
      if (i >= 0) serverSelect.selectedIndex = i;
    });

    // « Retour » (mode correction) : referme le formulaire, revient à l'écran minimal.
    const backBtn = panel.querySelector("#gds-edit-back-btn");
    if (backBtn) {
      backBtn.addEventListener("click", async () => {
        editRegistered = false;
        await refresh();
      });
    }

    const btn = panel.querySelector("#gds-activate-btn");
    const err = panel.querySelector("#gds-provision-err");
    const ok = panel.querySelector("#gds-provision-ok");
    btn.addEventListener("click", async () => {
      const project = currentProjectPath();
      if (!project) { err.textContent = "Aucun projet ouvert."; return; }
      if (!email) { err.textContent = "Définissez d'abord votre email d'identité (onglet « ⚙️ GDS — paramétrage » → Mon identité)."; return; }
      err.textContent = "";
      ok.textContent = "";
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader" class="icon-sm"></i> Activation…';
      refreshIcons(container);
      try {
        // `applyFiche` écrit la config depuis la FICHE choisie (valeurs
        // techniques du serveur + dossier local) et recopie les mots de passe
        // hors projet ; `gds_provision` PRÉSERVE ces valeurs (idempotent).
        const fiche = await applyFiche();
        // E-mail admin : le sélecteur ne porte que hôte / port / utilisateur
        // (`dataset.email` n'est jamais renseigné par `loadSavedServers`), donc
        // c'est l'identité GLOBALE du poste qui est utilisée. Le repli ci-dessous
        // restera juste le jour où la fiche portera un e-mail propre.
        const adminEmail = (fiche.email || email).trim();
        if (!adminEmail) {
          throw new Error("Renseignez votre e-mail GDS dans la fiche du serveur (onglet « ⚙️ GDS — paramétrage » → Serveurs GDS).");
        }
        const res = await invoke("gds_provision", {
          project,
          dbHost: fiche.host,
          dbPort: fiche.port,
          dbUser: fiche.user,
          dbPassword: "",
          adminEmail,
          adminPassword: "",
        });
        if (res && res.manual_setup) {
          // Serveur DISTANT : la clé du poste s'enregistre depuis l'onglet
          // transverse « ⚙️ GDS — paramétrage » → Mes clés (le serveur applique
          // lui-même authorized_keys depuis la base).
          pendingNotice =
            "✅ Base provisionnée. Enregistrez la clé du poste sur le serveur " +
            "depuis l'onglet « ⚙️ GDS — paramétrage » → Mes clés.";
        }
        notifyGdsChanged();
        await refresh();
        const okEl = bodyEl.querySelector("#gds-provision-ok");
        if (okEl && !(res && res.manual_setup)) {
          okEl.textContent = "✅ Serveur provisionné et GDS activé pour ce projet.";
        }
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
      if (!email) { err.textContent = "Définissez d'abord votre email d'identité (onglet « ⚙️ GDS — paramétrage » → Mon identité)."; return; }
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
        notifyGdsChanged();
        if (okEl) {
          okEl.textContent = res && res.initialized
            ? "✅ Projet ajouté au GDS (dossier initialisé en dépôt Git + identité réglée localement)."
            : "✅ Projet ajouté au GDS.";
        }
      } catch (e) {
        showGdsError(err, e, () => btn.click());
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

  // ── Projet DÉJÀ rattaché à un serveur, liaison non vérifiée (constat 1) ──
  // Écran minimal : le serveur choisi, les DEUX faits distincts (inscription sur
  // le serveur / liaison de ce poste), la vérification, et le retrait. AUCUNE
  // ressaisie technique et AUCUNE écriture de configuration : les valeurs
  // (hôte de base, port, port SSH, racine des dépôts, dossier de clonage)
  // restent dans `.pilot/gds.json` et sont lues par le backend au moment d'agir.
  function renderRegistered(cfg, identity, onServer, serverName) {
    const wrap = document.createElement("div");
    wrap.className = "gds-cols";
    wrap.innerHTML = `
      <div class="gds-panel">
        <div class="gds-panel-title"><i data-lucide="server" class="icon-sm"></i> Serveur GDS de ce projet</div>
        <div class="gds-panel-desc">Serveur choisi : <strong>${esc(serverName)}</strong>.</div>
        <div class="gds-panel-desc" style="margin-top:8px">
          ${onServer
            ? `<span class="gds-badge gds-badge-ok">✅ Enregistré sur le serveur</span>`
            : `<span class="gds-badge gds-badge-warn">Pas encore enregistré sur le serveur</span>`}
          <span class="gds-badge gds-badge-warn">⚠️ Liaison de ce poste : à vérifier</span>
        </div>
        <div class="gds-panel-desc" style="margin-top:6px">
          Ce sont <strong>deux choses différentes</strong> : l'inscription du projet
          sur le serveur d'un côté, la liaison de <em>ce poste</em> vers le dépôt
          (accès à la base, dépôt du projet) de l'autre.
        </div>
        <div id="gds-relink-err" class="gds-error"></div>
        <div id="gds-relink-ok" class="gds-ok"></div>
        <div class="gds-actions">
          <button id="gds-verify-btn" class="web-btn"><i data-lucide="refresh-cw" class="icon-sm"></i> Vérifier la liaison</button>
          <button id="gds-relink-btn" class="web-btn"><i data-lucide="link" class="icon-sm"></i> (Re)créer le raccourci vers le dépôt</button>
          <button id="gds-edit-cfg-btn" class="web-btn"><i data-lucide="wrench" class="icon-sm"></i> Changer de serveur</button>
        </div>
        <div class="gds-panel-desc" style="margin-top:8px">
          La liaison ne fonctionne pas ? Essayez <strong>« (Re)créer le raccourci vers le dépôt »</strong>
          (aucune suppression, aucune perte : le raccourci <code>gds</code> du dépôt local est
          simplement refait vers le dépôt du serveur), puis <strong>« Vérifier la liaison »</strong>.
          Pour changer de serveur (ou corriger la fiche : adresse, port du service, port SSH,
          racine des dépôts), utilisez <strong>« Changer de serveur »</strong> — les valeurs
          techniques viennent de la fiche du serveur (onglet « ⚙️ GDS — paramétrage » → Serveurs GDS).
        </div>
      </div>
      <div class="gds-panel">${renderRemoveHtml("gds-registered-remove")}</div>
    `;
    bodyEl.appendChild(wrap);
    refreshIcons(container);

    const btn = wrap.querySelector("#gds-verify-btn");
    btn.addEventListener("click", async () => {
      const project = currentProjectPath();
      if (!project) return;
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader" class="icon-sm"></i> Vérification…';
      refreshIcons(container);
      const conn = await fetchGdsConnectionStatus(invoke, project);
      notifyGdsChanged();
      pendingNotice = conn.status === "connected"
        ? "✅ Liaison vérifiée : ce poste joint la base et le dépôt de ce projet."
        : conn.status === "not_published"
          ? "⚠️ Le dépôt de ce projet existe sur le serveur, mais il est VIDE : aucun travail n'y a encore été publié. Publiez-le une première fois (« Publier ce projet sur le GDS »), puis vérifiez à nouveau."
          : "⚠️ La liaison n'est pas encore utilisable (accès à la base ou dépôt du projet). " +
            "Rien n'a été effacé sur ce poste : cliquez sur « (Re)créer le raccourci vers le dépôt » " +
            "(il est refait vers le dépôt du serveur), puis « Vérifier la liaison » à nouveau. " +
            "Aucune suppression ni réajout du projet n'est nécessaire.";
      await refresh();
    });

    // « (Re)créer le raccourci vers le dépôt » : rejoue l'association du dépôt
    // local au dépôt du serveur (même geste que « Ajouter ce projet au GDS »).
    // Idempotent : le raccourci `gds` est retiré puis recréé, `origin` est
    // TOUJOURS préservé, et un projet déjà connu du serveur n'est jamais
    // défait (aucune perte de données).
    const relink = wrap.querySelector("#gds-relink-btn");
    relink.addEventListener("click", async () => {
      const project = currentProjectPath();
      if (!project) return;
      const errEl = wrap.querySelector("#gds-relink-err");
      const okEl = wrap.querySelector("#gds-relink-ok");
      const email = String((identity && identity.email) || "").trim();
      errEl.textContent = "";
      okEl.textContent = "";
      if (!email) {
        errEl.textContent = "Définissez d'abord votre email d'identité (onglet « ⚙️ GDS — paramétrage » → Mon identité).";
        return;
      }
      relink.disabled = true;
      relink.innerHTML = '<i data-lucide="loader" class="icon-sm"></i> Raccourci…';
      refreshIcons(container);
      try {
        await invoke("gds_add_project", {
          project,
          email,
          gitName: String((identity && identity.git_name) || "").trim() || null,
        });
        notifyGdsChanged();
        okEl.textContent = "✅ Raccourci recréé vers le dépôt du serveur — cliquez « Vérifier la liaison ».";
      } catch (e) {
        showGdsError(errEl, e, () => relink.click());
      } finally {
        relink.disabled = false;
        relink.innerHTML = '<i data-lucide="link" class="icon-sm"></i> (Re)créer le raccourci vers le dépôt';
        refreshIcons(container);
      }
    });

    // « Corriger la configuration » : rouvre le formulaire d'activation
    // pré-rempli avec les valeurs actuelles (seul chemin d'édition des valeurs
    // techniques d'un projet déjà rattaché).
    wrap.querySelector("#gds-edit-cfg-btn").addEventListener("click", async () => {
      editRegistered = true;
      await refresh();
    });

    wireRemove(wrap, "gds-registered-remove");
  }

  // ── État connecté compact (statut, synchro, retirer) ──
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
          Serveur : <code>${esc(host || "—")}</code>. Synchronisation opérationnelle.
        </div>
        <div id="gds-sync-err" class="gds-error"></div>
        <div id="gds-sync-ok" class="gds-ok"></div>
        <div id="gds-sync-status" class="gds-sync-state"></div>
        <div class="gds-actions">
          <button id="gds-sync-btn" class="web-btn"><i data-lucide="refresh-cw" class="icon-sm"></i> Synchroniser</button>
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
        ok.textContent = `✅ Synchronisé (${res.action}).`;
        await refreshSyncStatus();
      } catch (e) {
        err.textContent = String(e);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="refresh-cw" class="icon-sm"></i> Synchroniser';
        refreshIcons(container);
      }
    });

    wireRemove(panel, "gds-connected-remove");
    refreshSyncStatus();
  }

  // ── Dépôt du serveur VIDE : branche jamais publiée (défaut de terrain) ──
  // Le projet est inscrit et son dépôt existe, mais la branche n'y est jamais
  // arrivée : « connecté » serait faux, la synchronisation ne peut pas marcher.
  // Le premier envoi réutilise EXACTEMENT le geste de « Ajouter ce projet au
  // GDS » (remote add + push, idempotent, sans rien supprimer).
  function renderNotPublished(identity, serverName) {
    const wrap = document.createElement("div");
    wrap.className = "gds-cols";
    wrap.innerHTML = `
      <div class="gds-panel">
        <div class="gds-panel-title"><i data-lucide="git-branch" class="icon-sm"></i> Projet pas encore publié</div>
        <div class="gds-panel-desc">
          <span class="gds-badge gds-badge-warn">Dépôt du serveur vide</span>
          Le dépôt de ce projet existe bien sur le serveur, mais il est <strong>vide</strong> :
          la branche de votre travail n'y a jamais été publiée. La synchronisation ne peut
          donc pas fonctionner pour l'instant.
        </div>
        <div class="gds-panel-desc" style="margin-top:6px">
          Cliquez sur <strong>« Publier ce projet sur le GDS »</strong> pour faire ce premier
          envoi : la branche est créée sur le serveur, puis la synchronisation devient opérationnelle.
        </div>
        <div id="gds-publish-err" class="gds-error"></div>
        <div id="gds-publish-ok" class="gds-ok"></div>
        <div class="gds-actions">
          <button id="gds-publish-btn" class="web-btn"><i data-lucide="upload" class="icon-sm"></i> Publier ce projet sur le GDS</button>
        </div>
        <div class="gds-panel-desc" style="margin-top:8px">Serveur : <strong>${esc(serverName)}</strong>.</div>
      </div>
      <div class="gds-panel">${renderRemoveHtml("gds-notpublished-remove")}</div>
    `;
    bodyEl.appendChild(wrap);
    refreshIcons(container);

    const err = wrap.querySelector("#gds-publish-err");
    const ok = wrap.querySelector("#gds-publish-ok");
    const btn = wrap.querySelector("#gds-publish-btn");
    btn.addEventListener("click", async () => {
      const project = currentProjectPath();
      if (!project) { err.textContent = "Aucun projet ouvert."; return; }
      const email = String((identity && identity.email) || "").trim();
      if (!email) {
        err.textContent =
          "Définissez d'abord votre email d'identité (onglet « ⚙️ GDS — paramétrage » → Mon identité).";
        return;
      }
      err.textContent = ""; ok.textContent = "";
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader" class="icon-sm"></i> Publication…';
      refreshIcons(container);
      try {
        await invoke("gds_add_project", {
          project,
          email,
          gitName: String((identity && identity.git_name) || "").trim() || null,
        });
        notifyGdsChanged();
        ok.textContent = "✅ Premier envoi effectué — vérification de la liaison…";
        await refresh();
      } catch (e) {
        showGdsError(err, e, () => btn.click());
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="upload" class="icon-sm"></i> Publier ce projet sur le GDS';
        refreshIcons(container);
      }
    });

    wireRemove(wrap, "gds-notpublished-remove");
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
        notifyGdsChanged();
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

    // Surface d'attente peinte IMMÉDIATEMENT : quelle que soit la panne (commande
    // qui ne répond jamais, erreur avalée), l'utilisateur voit une surface et
    // jamais un écran vide.
    bodyEl.innerHTML = GDS_LOADING_HTML;

    // Identité globale (email + nom git) — R2.
    let identity = { email: "", git_name: "" };
    try { identity = await invoke("gds_identity_prefs") || identity; } catch (_) {}

    // État de connexion (status + présence sur serveur) — R3, borné dans le
    // temps (~4 s) : au-delà, message actionnable + bouton « Réessayer ».
    const conn = await fetchGdsConnectionStatus(invoke, project);
    if (conn.timedOut) {
      setStateBadge("error", false);
      bodyEl.innerHTML = GDS_TIMEOUT_HTML;
      const retry = bodyEl.querySelector("#gds-retry");
      if (retry) retry.addEventListener("click", () => refresh());
      refreshIcons(container);
      return;
    }
    const status = conn.status || "not_configured";
    const onServer = !!(conn.on_server);

    // Config projet.
    let cfg = null;
    try { cfg = await invoke("gds_get_config", { project }); } catch (_) { cfg = null; }
    let secrets = null;
    try { secrets = await invoke("gds_secrets_status", { project }); } catch (_) { secrets = null; }

    const provisioned = !!(cfg && cfg.enabled);

    bodyEl.innerHTML = "";
    setStateBadge(status, onServer);

    if (pendingNotice) {
      const notice = document.createElement("div");
      notice.className = "gds-ok";
      notice.style.margin = "0 0 10px 0";
      notice.textContent = pendingNotice;
      bodyEl.appendChild(notice);
      pendingNotice = "";
    }

    if (status === "connected") {
      renderConnected(cfg, identity);
    } else if (status === "not_published") {
      // Projet inscrit ET dépôt présent, mais dépôt VIDE : l'écran le dit
      // clairement et propose le premier envoi (jamais « Connecté »).
      renderNotPublished(identity, await savedServerLabel(cfg));
    } else if (provisioned && editRegistered) {
      // Correction des valeurs techniques d'un projet DÉJÀ rattaché : le
      // formulaire d'activation est rouvert pré-rempli (aucun champ permanent
      // sur l'écran normal), et « Retour » ramène à l'écran minimal.
      renderConnect(cfg, secrets, identity, true);
    } else if (provisioned) {
      // Projet DÉJÀ rattaché à un serveur : écran minimal, sans aucun champ
      // technique (constat 1). Le formulaire complet est réservé à l'ACTIVATION
      // d'un projet qui n'est pas encore rattaché — ou au bouton « Corriger la
      // configuration ».
      renderRegistered(cfg, identity, onServer, await savedServerLabel(cfg));
      if (!onServer) renderAdd(identity);
    } else {
      renderConnect(cfg, secrets, identity, provisioned);
      if (onServer) renderAlreadyAdded();
    }
    refreshIcons(container);
  }

  // Recharge quand le projet actif change (bascule de projet).
  let lastProjectPath = currentProjectPath();
  function refreshIfProjectChanged() {
    const cur = currentProjectPath();
    if (cur !== lastProjectPath) {
      lastProjectPath = cur;
      editRegistered = false;
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
