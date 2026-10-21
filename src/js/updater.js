// updater.js — Vérification automatique des mises à jour (Tauri v2 updater plugin)
//
// Au démarrage de Pilot (puis PÉRIODIQUEMENT toutes les 6 h et au retour au
// premier plan), on interroge l'endpoint configuré dans
// tauri.conf.json (plugins.updater.endpoints). Si une mise à jour est
// disponible, on affiche une modale présentant le changelog et proposant de
// la télécharger et de l'installer. L'installation relance l'application
// automatiquement.
//
// Le changelog affiché est l'historique COMPLET des évolutions depuis la
// version installée jusqu'à la dernière (récupéré via l'API GitHub Releases).
// On affiche d'abord immédiatement les notes de la dernière version (champ
// `notes` de latest.json), puis on les remplace par l'historique concaténé
// dès qu'il arrive. En cas d'échec (offline / rate-limit), on retombe sur les
// notes de la dernière version seule (comportement d'origine).
//
// L'utilisateur peut aussi déclencher une vérification manuelle via la
// commande « check-update » de la palette (voir main.js).

import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { showToast, toastError } from "./toast.js";
import { renderMarkdown } from "./preview.js";

let _checking = false;
let _pendingUpdate = null; // objet Update en attente d'installation
let _installedVersion = null; // version courante de Pilot (ex: "0.2.17")
let _scheduled = false; // contrôles récurrents déjà programmés (idempotence)

// Version REPORTÉE par l'utilisateur (« Plus tard » / ✕). Mémorisée pour la
// version concernée : sans cela, le contrôle récurrent réaffichait la fenêtre à
// chaque retour de Pilot au premier plan. Le refus tient jusqu'au prochain
// démarrage (état en mémoire), et une version DIFFÉRENTE est toujours proposée.
let _dismissedVersion = null;

// Une seule installation à la fois : un contrôle de fond tombant pendant un
// téléchargement ne doit ni réactiver le bouton, ni masquer la progression, ni
// permettre une seconde installation en parallèle.
let _installing = false;

// Début du dernier contrôle (toutes origines) : borne les contrôles déclenchés
// par un retour au premier plan pour ne pas marteler le réseau sur des
// allers-retours de fenêtres répétés.
let _lastCheckStartedAt = 0;

// Dernier contrôle : QUAND il a eu lieu et COMMENT il s'est terminé. Sans cet
// état, « Pilot est à jour » et « le contrôle a échoué » étaient indiscernables
// (une erreur ne partait que dans la console, invisible pour l'utilisateur).
let _lastCheck = null; // { at: Date, outcome: "up-to-date"|"update-available"|"error", detail, lastSuccessAt }

// Délai du premier contrôle après le démarrage (ne pas ralentir l'ouverture).
const STARTUP_DELAY_MS = 10000;
// Reprise SILENCIEUSE du contrôle : une version publiée pendant que Pilot tourne
// doit être proposée sans redémarrage (avant, un seul contrôle ~10 s après le
// démarrage : une publication ultérieure n'était jamais vue).
export const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 h

// Intervalle minimal entre deux contrôles déclenchés par un retour de Pilot au
// premier plan (les autres déclencheurs — démarrage, 6 h, commande manuelle —
// ne sont pas concernés).
export const FOREGROUND_MIN_INTERVAL_MS = 5 * 60 * 1000; // 5 min

// Repo GitHub (même source que l'endpoint updater de tauri.conf.json).
const REPO = "pleveneur/pilot";

// ── Helpers de comparaison de versions (semver simple major.minor.patch) ──

// Parse "0.2.17" ou "v0.2.17" → [major, minor, patch] ou null.
function parseVersion(v) {
  const m = String(v).trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

// compareVersions(a, b) → -1 si a < b, 0 si a == b, 1 si a > b.
function compareVersions(a, b) {
  const pa = parseVersion(a), pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

// Récupère l'historique des notes de version depuis la version installée
// (exclusive) jusqu'à la dernière version (inclusive), via l'API GitHub
// Releases. Retourne un Markdown concaténé (titres "## vX.Y.Z" + body de
// chaque release intermédiaire), ou null si indisponible (offline / rate-limit
// / erreur). En cas d'échec, l'appelant retombe sur le body de la dernière
// version (comportement d'origine).
async function fetchReleasesHistory(installedVersion, latestVersion) {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/releases?per_page=100`,
      { headers: { Accept: "application/vnd.github+json" } }
    );
    if (!res.ok) return null;
    const releases = await res.json();
    const seen = new Set();
    const relevant = [];
    for (const r of releases) {
      if (r.draft || r.prerelease) continue;
      const tag = (r.tag_name || "").replace(/^v/, "");
      if (!tag || seen.has(tag)) continue;
      // Strictement supérieure à la version installée, et <= dernière version.
      if (compareVersions(tag, installedVersion) <= 0) continue;
      if (compareVersions(tag, latestVersion) > 0) continue;
      seen.add(tag);
      relevant.push({ tag, body: r.body || "" });
    }
    // Tri croissant : de la version juste après l'installée jusqu'à la dernière.
    relevant.sort((a, b) => compareVersions(a.tag, b.tag));
    if (!relevant.length) return null;
    return relevant
      .map((r) => `## v${r.tag}\n\n${(r.body || "_(aucune note de version)_").trim()}`)
      .join("\n\n---\n\n");
  } catch (e) {
    console.warn("Historique des releases indisponible:", e);
    return null;
  }
}

// Enrichit la modale de mise à jour avec l'historique complet des évolutions
// depuis la version installée. Affichage immédiat du body de la dernière
// version, puis remplacement par l'historique concaténé quand il arrive.
async function enrichWithHistory(latestVersion) {
  const historyMd = await fetchReleasesHistory(_installedVersion, latestVersion);
  if (!historyMd) return; // fallback : on garde le body de la dernière version.
  // Ne pas écraser si la modale a été fermée entre-temps.
  if (!modalEl || modalEl.classList.contains("hidden")) return;
  notesEl.innerHTML = renderMarkdown(historyMd);
  notesEl.querySelectorAll("a").forEach((a) => {
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
  });
}

// ── Éléments DOM de la modale de mise à jour ──
let modalEl, versionEl, dateEl, notesEl;
let installBtn, laterBtn, closeBtn;
let progressEl, progressFillEl, progressLabelEl;
let _listenersBound = false;

/** Récupère (paresseusement) les éléments DOM et branche les handlers. */
function ensureModal() {
  if (_listenersBound) return modalEl;
  modalEl = document.getElementById("update-modal");
  if (!modalEl) return null;
  versionEl = document.getElementById("update-version");
  dateEl = document.getElementById("update-date");
  notesEl = document.getElementById("update-notes");
  installBtn = document.getElementById("btn-update-install");
  laterBtn = document.getElementById("btn-update-later");
  closeBtn = document.getElementById("update-close");
  progressEl = modalEl.querySelector(".update-progress");
  progressFillEl = document.getElementById("update-progress-fill");
  progressLabelEl = document.getElementById("update-progress-label");

  installBtn?.addEventListener("click", () => {
    // Une seule installation à la fois : un second clic n'en lance jamais une
    // deuxième, il le dit à l'utilisateur.
    if (_installing) {
      showToast("Installation déjà en cours : laisse-la se terminer.", "info", 5000);
      return;
    }
    if (_pendingUpdate) installUpdate(_pendingUpdate);
  });
  // « Plus tard » et ✕ reportent la proposition. Le refus est MÉMORISÉ pour
  // cette version (il tient jusqu'au prochain démarrage), sinon la fenêtre
  // reviendrait à chaque retour au premier plan. Une nouvelle version, elle,
  // est toujours proposée.
  laterBtn?.addEventListener("click", dismissModal);
  closeBtn?.addEventListener("click", dismissModal);
  modalEl.addEventListener("click", (e) => {
    if (e.target === modalEl) dismissModal();
  });
  _listenersBound = true;
  return modalEl;
}

/**
 * Mémorise le report (« Plus tard » / ✕) puis ferme la fenêtre.
 * Pendant une installation, la fermeture est refusée : la progression reste
 * visible et l'utilisateur ne peut pas croire l'opération interrompue.
 */
function dismissModal() {
  if (_installing) return;
  if (_pendingUpdate?.version) _dismissedVersion = _pendingUpdate.version;
  modalEl?.classList.add("hidden");
}

/** Affiche la modale de mise à jour avec le changelog de la nouvelle version. */
function showUpdateModal(update) {
  if (!ensureModal()) {
    // Fallback : pas de DOM dispo (ne devrait pas arriver), on installe direct.
    installUpdate(update);
    return;
  }
  // Un contrôle de fond peut tomber PENDANT une installation : ne jamais
  // réinitialiser la fenêtre (bouton réactivé, progression masquée), sans quoi
  // une seconde installation pourrait partir.
  if (_installing) return;
  // Version déjà reportée par l'utilisateur : on ne la repropose pas.
  if (_dismissedVersion && update?.version === _dismissedVersion) return;
  _pendingUpdate = update;

  versionEl.textContent = `v${update.version}`;
  const d = update.date ? new Date(update.date) : null;
  dateEl.textContent = d && !isNaN(d.getTime()) ? d.toLocaleDateString() : "";

  // Le champ `body` contient le `notes` de latest.json (Markdown GitHub).
  const body = update.body || update.notes || "";
  if (body.trim()) {
    notesEl.innerHTML = renderMarkdown(body);
    // Les liens du changelog pointent vers GitHub : on les ouvre dans le
    // navigateur externe (target=_blank) plutôt que dans la WebView.
    notesEl.querySelectorAll("a").forEach((a) => {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    });
  } else {
    notesEl.innerHTML = '<p class="muted">Aucune note de version fournie.</p>';
  }

  // Enrichissement : remplacer les notes de la seule dernière version par
  // l'historique complet des évolutions depuis la version installée (API
  // GitHub Releases). La modale s'affiche immédiatement avec les notes de la
  // dernière version, puis le contenu est remplacé par l'historique dès qu'il
  // arrive (ou reste tel quel si l'historique est indisponible).
  if (_installedVersion && compareVersions(_installedVersion, update.version) < 0) {
    enrichWithHistory(update.version);
  }

  // Reset de l'état progression / boutons.
  progressEl.classList.add("hidden");
  progressFillEl.style.width = "0%";
  progressLabelEl.textContent = "Téléchargement…";
  installBtn.disabled = false;
  laterBtn.disabled = false;
  installBtn.classList.remove("hidden");
  laterBtn.classList.remove("hidden");

  modalEl.classList.remove("hidden");
}

/** Télécharge, installe puis relance l'application. */
async function installUpdate(update) {
  if (!ensureModal()) return;
  if (_installing) {
    showToast("Installation déjà en cours : laisse-la se terminer.", "info", 5000);
    return;
  }
  _installing = true;
  installBtn.disabled = true;
  laterBtn.disabled = true;
  progressEl.classList.remove("hidden");

  try {
    let contentLength = 0;
    let downloaded = 0;
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started":
          contentLength = event.data.contentLength ?? 0;
          downloaded = 0;
          progressLabelEl.textContent = "Téléchargement…";
          break;
        case "Progress": {
          downloaded += event.data.chunkLength ?? 0;
          if (contentLength > 0) {
            const pct = Math.min(100, Math.round((downloaded / contentLength) * 100));
            progressFillEl.style.width = pct + "%";
            progressLabelEl.textContent = `Téléchargement… ${pct}%`;
          }
          break;
        }
        case "Finished":
          progressFillEl.style.width = "100%";
          progressLabelEl.textContent = "Installation…";
          break;
      }
    });
    showToast("Mise à jour téléchargée. Redémarrage…", "success", 5000);
    await relaunch();
  } catch (e) {
    console.error("Erreur installation MAJ:", e);
    toastError("Échec de l'installation de la mise à jour.");
    // On permet un nouvel essai.
    _installing = false;
    installBtn.disabled = false;
    laterBtn.disabled = false;
    progressEl.classList.add("hidden");
  }
}

/** Récupère l'état du dernier contrôle des mises à jour (lecture seule). */
export function getLastCheckStatus() {
  return _lastCheck;
}

// Date + heure lisibles (« 21/10/2026 à 10:32 »), sans dépendre d'un format
// imposé : toLocaleString peut échouer selon les données ICU disponibles.
function formatDateTime(d) {
  try {
    const date = d.toLocaleDateString("fr-FR");
    const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    return `${date} à ${time}`;
  } catch {
    return d.toISOString();
  }
}

// Traduit une erreur de contrôle en cause en langage clair (jamais un code
// technique seul). Utilisé dans les messages affichés à l'utilisateur.
function describeCheckError(e) {
  const msg = String((e && (e.message || e)) || "").trim();
  if (/network|fetch|connect|offline|dns|timed? ?out|econn|enotfound|socket/i.test(msg)) {
    return "pas de connexion au serveur de mises à jour";
  }
  if (/40[13]|rate limit|forbidden|unauthori[sz]ed/i.test(msg)) {
    return "accès refusé par le serveur de mises à jour";
  }
  if (/signature|decrypt|verify/i.test(msg)) {
    return "mise à jour refusée : signature invalide";
  }
  return msg ? `erreur technique : ${msg.slice(0, 120)}` : "cause inconnue";
}

/**
 * Résume le dernier contrôle en une phrase claire : quand il a eu lieu et
 * comment il s'est terminé (« Pilot est à jour » ≠ « échec du contrôle »).
 * @param {object|null} state état renvoyé par getLastCheckStatus()
 * @returns {string}
 */
export function formatLastCheckStatus(state = _lastCheck) {
  if (!state || !state.at) {
    return "Contrôle des mises à jour : aucun contrôle effectué depuis le démarrage de Pilot.";
  }
  const when = formatDateTime(state.at);
  if (state.outcome === "error") {
    const lastOk = state.lastSuccessAt
      ? ` Dernier contrôle réussi : le ${formatDateTime(state.lastSuccessAt)}.`
      : " Aucun contrôle n'a encore réussi depuis le démarrage.";
    return (
      `Contrôle des mises à jour : échec le ${when} (${state.detail || "cause inconnue"}) — ` +
      `Pilot n'a donc PAS pu savoir si une nouvelle version existe.${lastOk}`
    );
  }
  if (state.outcome === "update-available") {
    return `Contrôle des mises à jour : le ${when} — une mise à jour est disponible.`;
  }
  return `Contrôle des mises à jour : le ${when} — Pilot est à jour.`;
}

/**
 * Vérifie les mises à jour et, si disponible, affiche la modale de changelog.
 * @param {boolean} silent — si true, n'affiche rien quand aucune MAJ n'est disponible
 * @returns {Promise<void>}
 */
export async function checkForUpdate(silent = true) {
  if (_checking) {
    // Le dire au lieu de ne rien faire : la commande manuelle semblait cassée
    // quand un contrôle silencieux était déjà en cours.
    if (!silent) {
      showToast("Un contrôle des mises à jour est déjà en cours…", "info", 5000);
    }
    return;
  }
  _checking = true;
  _lastCheckStartedAt = Date.now();
  try {
    if (!_installedVersion) {
      try { _installedVersion = await getVersion(); } catch { /* ignore */ }
    }
    const update = await check();
    if (update?.available) {
      _lastCheck = {
        at: new Date(),
        outcome: "update-available",
        detail: "",
        lastSuccessAt: new Date(),
      };
      showUpdateModal(update);
    } else {
      _lastCheck = {
        at: new Date(),
        outcome: "up-to-date",
        detail: "",
        lastSuccessAt: new Date(),
      };
      if (!silent) {
        showToast(
          `Pilot est à jour (contrôle effectué le ${formatDateTime(_lastCheck.at)}).`,
          "info",
          8000
        );
      }
    }
  } catch (e) {
    const detail = describeCheckError(e);
    _lastCheck = {
      at: new Date(),
      outcome: "error",
      detail,
      lastSuccessAt: _lastCheck?.lastSuccessAt || null,
    };
    console.error("Erreur vérification MAJ:", e, "—", formatLastCheckStatus());
    if (!silent) {
      // Message explicite : on ne prétend jamais que Pilot est à jour quand le
      // contrôle a échoué, et on donne la date du dernier contrôle.
      showToast(
        `Impossible de vérifier les mises à jour : ${detail}. ${formatLastCheckStatus()}`,
        "error",
        12000
      );
    }
  } finally {
    _checking = false;
  }
}

/**
 * Initialise la vérification automatique : un premier contrôle différé au
 * démarrage, puis une reprise SILENCIEUSE dans le temps (toutes les 6 h) et au
 * retour de Pilot au premier plan. `_checking` sert d'anti-rebond : deux
 * contrôles ne peuvent jamais se chevaucher.
 */
export function initUpdater() {
  if (_scheduled) return; // idempotent : un seul jeu de contrôles programmé
  _scheduled = true;

  const checkSilently = () => {
    checkForUpdate(true).catch(() => {});
  };

  // Vérification différée (10 s) pour ne pas ralentir le démarrage.
  setTimeout(checkSilently, STARTUP_DELAY_MS);
  // Reprise périodique : couvre une version publiée APRÈS le démarrage.
  setInterval(checkSilently, REFRESH_INTERVAL_MS);

  // Retour au premier plan (fenêtre réactivée, onglet visible) : contrôle
  // opportuniste, silencieux lui aussi, mais au plus un par intervalle minimal
  // (des Alt+Tab répétés ne doivent pas produire N requêtes réseau).
  const refreshOnForeground = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    if (Date.now() - _lastCheckStartedAt < FOREGROUND_MIN_INTERVAL_MS) return;
    checkSilently();
  };
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("focus", refreshOnForeground);
  }
  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("visibilitychange", refreshOnForeground);
  }
}