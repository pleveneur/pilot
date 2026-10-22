// pi-update.js — Détection et mise à jour de l'agent Pi (issue #26)
//
// Au lancement de Pilot (main.js) ET à l'ouverture de l'onglet agent (tabs.js),
// si le backend est `pi` (pas `plh`) et que l'utilisateur n'a pas choisi « Ne
// plus demander », on vérifie si une nouvelle version de Pi est disponible
// (endpoint officiel pi.dev). Si oui, on affiche une modale proposant de la
// mettre à jour via la commande intégrée `pi update --self`. L'utilisateur peut
// choisir « Ne plus demander » (flag `pi_skip_update_check` persisté dans la
// config). Les deux points d'appel sont idempotents.
//
// Ce fichier porte aussi la SÉQUENCE DE DÉMARRAGE (`runPiStartupCheck`) : elle
// arme le garde de démarrage (`pi-startup-gate.js`, seul propriétaire de l'état)
// AVANT toute attente, puis rend TOUJOURS le terrain — jamais de blocage
// définitif (message explicite si la vérification échoue ou traîne).

import { invoke } from "@tauri-apps/api/core";
import { animateModalOpen } from "./modal-anim.js";
import { toastSuccess, toastError, toastInfo, toastWarning } from "./toast.js";
import { refreshBackendInfo, getBackendInfoSync } from "./backend-info.js";
import { beginPiStartupCheck, beginPiStartupUpdate, endPiStartupGate } from "./pi-startup-gate.js";

/**
 * Durée maximale de la vérification au démarrage. Au-delà, le terrain est rendu
 * et l'utilisateur est informé : la vérification ne peut pas bloquer son travail.
 */
export const PI_STARTUP_CHECK_TIMEOUT_MS = 20_000;

/** Message affiché quand la vérification échoue (il dit QUOI FAIRE). */
export const PI_CHECK_FAILED_MESSAGE =
  "⚠️ La version de l'agent Pi n'a pas pu être vérifiée — le travail démarre " +
  "normalement. Pour mettre Pi à jour à la main : lancez « pi update --self » " +
  "dans un terminal (vérifiez aussi votre connexion), ou relancez Pilot.";

/** Message affiché quand la vérification traîne trop longtemps. */
export const PI_CHECK_SLOW_MESSAGE =
  "⏳ La vérification de la version de l'agent Pi prend trop de temps — le " +
  "travail démarre sans attendre. Vérifiez votre connexion, ou mettez Pi à jour " +
  "à la main avec « pi update --self ».";

/** Vérification en vol (une seule à la fois : les appelants attendent la même). */
let _inflight = null;
/** Dernière version publiée connue (informatif : nommée dans l'attente d'installation). */
let _latest = "";
let _modalEl, _versionEl, _statusEl, _updateBtn, _laterBtn, _skipBtn, _closeBtn;
let _listenersBound = false;

function ensureModal() {
  if (_listenersBound) return _modalEl;
  _modalEl = document.getElementById("pi-update-modal");
  if (!_modalEl) return null;
  _versionEl = document.getElementById("pi-update-version");
  _statusEl = document.getElementById("pi-update-status");
  _updateBtn = document.getElementById("btn-pi-update-install");
  _laterBtn = document.getElementById("btn-pi-update-later");
  _skipBtn = document.getElementById("btn-pi-update-skip");
  _closeBtn = document.getElementById("pi-update-close");
  _updateBtn?.addEventListener("click", doUpdate);
  _laterBtn?.addEventListener("click", closeModal);
  _skipBtn?.addEventListener("click", skipForever);
  _closeBtn?.addEventListener("click", closeModal);
  _listenersBound = true;
  return _modalEl;
}

function closeModal() {
  if (_modalEl) _modalEl.classList.add("hidden");
}

async function doUpdate() {
  if (!_updateBtn) return;
  _updateBtn.disabled = true;
  _statusEl.textContent = "Mise à jour de Pi en cours…";
  // TERRAIN RÉSERVÉ pendant l'installation du moteur : aucun agent, aucune
  // mission (même en file), aucune commande manuelle ne démarre tant que
  // `pi update --self` n'est pas terminé. Le motif et son texte sont portés par
  // le garde de démarrage (`pi-startup-gate.js`), consulté par le gardien
  // unique (`run-policy.js`).
  beginPiStartupUpdate({ version: _latest });
  let outcome = "update-failed";
  try {
    const r = await invoke("update_pi");
    // La mise à jour arrête les sessions RPC (verrou de fichiers) : relancer
    // l'agent à chaud pour restaurer la session courante. agent-pi.js écoute
    // l'événement `pilot-agent-restart-needed` (même mécanisme qu'un changement
    // de paramètres RPC).
    window.dispatchEvent(new CustomEvent("pilot-agent-restart-needed"));
    if (r.ok) {
      outcome = "updated";
      _statusEl.textContent = "Pi mis à jour avec succès.";
      toastSuccess("Pi mis à jour.");
      setTimeout(closeModal, 1500);
    } else {
      // 1. Diagnosité : afficher la cause réelle (ou un résumé court non
      // technique) renvoyée par le backend au lieu du libellé générique.
      const msg =
        (r && r.error) || "La mise à jour a échoué. Réessaie plus tard.";
      _statusEl.textContent = msg;
      toastError("Échec de la mise à jour de Pi.");
      _updateBtn.disabled = false;
    }
  } catch (e) {
    _statusEl.textContent = "Erreur lors de la mise à jour.";
    toastError("Erreur mise à jour Pi : " + e);
    _updateBtn.disabled = false;
  } finally {
    // Le terrain est rendu dans TOUS les cas : une installation en échec ne
    // laisse jamais Pilot bloqué.
    endPiStartupGate(outcome, { current: outcome === "updated" ? _latest : "" });
  }
}

async function skipForever() {
  try {
    const cfg = await invoke("get_config");
    cfg.pi_skip_update_check = true;
    await invoke("save_config", { config: cfg });
    toastInfo("Vérification des mises à jour de Pi désactivée.");
  } catch (e) {
    // Réserve R-B : la lecture a échoué → on ANNULE l'écriture (jamais de
    // valeurs par défaut persistées à la place de la vraie configuration).
    toastError("Configuration indisponible : préférence non enregistrée.");
    console.error("skipForever:", e);
  }
  closeModal();
}

/**
 * Vérifie si une mise à jour de Pi est disponible et, le cas échéant, affiche
 * la modale de proposition. Appelée **au lancement de Pilot** (main.js) ET à
 * l'ouverture de l'onglet agent (tabs.js) : les deux points d'appel sont donc
 * idempotents.
 * Ne fait rien si : backend non `pi`, « Ne plus demander » activé, vérification
 * déjà en cours, ou modale de proposition déjà affichée et non traitée.
 * @returns {Promise<{ok: boolean, reason?: string, update_available?: boolean,
 *   latest?: string, error?: string}>} verdict (ne rejette JAMAIS : l'appelant
 *   décide, et la séquence de démarrage y ajoute le compte rendu à l'utilisateur)
 */
export async function checkPiUpdate() {
  // Vérification DÉJÀ en vol : on ne relance pas un second aller-retour réseau,
  // on rend la MÊME promesse — l'appelant (séquence de démarrage) attend donc
  // la vraie fin de la vérification au lieu de croire qu'elle est terminée.
  if (_inflight) return _inflight;
  _inflight = checkPiUpdateOnce();
  try {
    return await _inflight;
  } finally {
    _inflight = null;
  }
}

/**
 * Vérification de la version du moteur, en une passe (idempotente côté modale :
 * si la proposition est déjà affichée, on ne relance rien).
 * @returns {Promise<{ok: boolean, reason?: string, update_available?: boolean,
 *   latest?: string, error?: string}>}
 */
async function checkPiUpdateOnce() {
  // Déjà proposée et pas encore traitée : ne pas relancer un aller-retour réseau
  // ni rejouer l'animation d'ouverture (second point d'appel : lancement →
  // ouverture de l'onglet agent, ou l'inverse).
  const shown = typeof document !== "undefined" ? document.getElementById("pi-update-modal") : null;
  if (shown && !shown.classList.contains("hidden")) return { ok: true, reason: "already-shown" };
  // Uniquement pour le backend `pi` (pas `plh`).
  const info = getBackendInfoSync();
  if (!info || info.kind !== "pi") return { ok: true, reason: "not-pi" };
  // Ne pas demander si l'utilisateur a choisi « Ne plus demander ».
  try {
    const cfg = await invoke("get_config");
    if (cfg.pi_skip_update_check) return { ok: true, reason: "skipped-by-user" };
  } catch (_) { /* silencieux */ }
  try {
    const r = await invoke("check_pi_update");
    if (r && typeof r.latest === "string" && r.latest) _latest = r.latest;
    if (r && r.update_available) {
      const modal = ensureModal();
      if (!modal) return { ok: true, update_available: true, latest: _latest };
      _versionEl.textContent = `${r.current} → ${r.latest}`;
      _statusEl.textContent = "";
      _updateBtn.disabled = false;
      modal.classList.remove("hidden");
      animateModalOpen(modal); // origine = centre (ouverture non liée à un clic)
    }
    return { ok: true, update_available: !!(r && r.update_available), latest: _latest };
  } catch (e) {
    console.warn("check_pi_update:", e);
    // L'ÉCHEC est rendu à l'appelant : la séquence de démarrage le dit à
    // l'utilisateur au lieu de le taire.
    return { ok: false, reason: "check-failed", error: String(e) };
  }
}

/**
 * SÉQUENCE DE DÉMARRAGE — vérification de la version du moteur AVANT tout
 * travail (règle du propriétaire).
 *
 *   1. le terrain est réservé SYNCHRONÉMENT au premier instant de l'appel :
 *      aucun agent, aucune mission (même en file), aucune commande manuelle ne
 *      peut démarrer pendant la vérification — la décision reste celle du
 *      gardien unique (`run-policy.js`), qui consulte `pi-startup-gate.js` ;
 *   2. la vérification est BORNÉE (`timeoutMs`) : si elle échoue ou traîne, le
 *      terrain est rendu, le travail reprend normalement et l'utilisateur est
 *      informé avec la marche à suivre — jamais de blocage définitif ;
 *   3. en cas d'installation (`update_pi`), le terrain reste réservé jusqu'à la
 *      fin de l'installation (`doUpdate`), puis il est rendu.
 *
 * @param {{probe?: function(): Promise<unknown>, check?: function(): Promise<unknown>,
 *   notify?: function(string, string): void, timeoutMs?: number}} [deps]
 *   dépendances injectables (contrôles déterministes, sans réseau ni Tauri)
 * @returns {Promise<{ok: boolean, outcome: string}>}
 */
export async function runPiStartupCheck(deps = {}) {
  const probe = typeof deps.probe === "function" ? deps.probe : refreshBackendInfo;
  const check = typeof deps.check === "function" ? deps.check : checkPiUpdate;
  const notify =
    typeof deps.notify === "function"
      ? deps.notify
      : (message, kind) => (kind === "error" ? toastError(message) : toastWarning(message));
  const timeoutMs =
    Number.isFinite(deps.timeoutMs) && deps.timeoutMs > 0 ? deps.timeoutMs : PI_STARTUP_CHECK_TIMEOUT_MS;
  // RÉSERVATION DU TERRAIN : posée AVANT toute attente (aucun `await` avant).
  beginPiStartupCheck({ maxMs: timeoutMs });
  let timer = null;
  try {
    const verdict = await Promise.race([
      (async () => {
        await probe();
        return await check();
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("pi-startup-check-timeout")), timeoutMs);
      }),
    ]);
    const failed = !!(verdict && verdict.ok === false);
    // Le terrain est rendu AVANT l'information : le travail peut reprendre tout
    // de suite, y compris si la vérification a échoué.
    endPiStartupGate(failed ? "check-failed" : "checked", {
      current: (verdict && verdict.latest) || "",
    });
    if (failed) {
      notify(PI_CHECK_FAILED_MESSAGE, "error");
      return { ok: false, outcome: "check-failed" };
    }
    return { ok: true, outcome: "checked" };
  } catch (e) {
    const timedOut = !!(e && e.message === "pi-startup-check-timeout");
    endPiStartupGate(timedOut ? "check-timeout" : "check-failed");
    notify(timedOut ? PI_CHECK_SLOW_MESSAGE : PI_CHECK_FAILED_MESSAGE, timedOut ? "warning" : "error");
    return { ok: false, outcome: timedOut ? "check-timeout" : "check-failed" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
