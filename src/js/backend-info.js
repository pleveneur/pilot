// ── Backend info (pi vs plh) — affichage dynamique du nom de l'agent ──
//
// Pilot supporte plusieurs backends RPC compatibles pi : `pi` (officiel, Node)
// et `plh` (réimplémentation Rust). La sonde côté Rust (`get_backend_info`)
// exécute `<rpc_pi_path> --version` (genre) + `--help` (support --extension) une
// seule fois, puis met en cache le résultat (re-sondé si `rpc_pi_path` change).
//
// Ce module expose une API synchrone (`agentDisplayLabel`, `getBackendInfoSync`)
// alimentée par un cache mis à jour via `refreshBackendInfo()`. L'UI doit
// appeler `refreshBackendInfo()` au démarrage et sur `pilot-config-changed`, et
// écouter `pilot-backend-changed` pour renommer les onglets/labels déjà ouverts.

import { invoke } from "@tauri-apps/api/core";

/** @type {{kind: string, ext_supported: boolean} | null} */
let cached = null;

/** @type {{ok: boolean, kind: string, version: string, error: string, path: string} | null} */
let healthCache = null;

/** Rafraîchit le cache en interrogeant Rust. Émet `pilot-backend-changed`. */
export async function refreshBackendInfo() {
  try {
    cached = await invoke("get_backend_info");
  } catch (_) {
    cached = { kind: "unknown", ext_supported: false };
  }
  window.dispatchEvent(new CustomEvent("pilot-backend-changed", { detail: cached }));
  return cached;
}

/** Renvoie le cache courant (sync) — `null` tant que la 1ʳᵉ sonde n'est pas faite. */
export function getBackendInfoSync() {
  return cached;
}

/**
 * Health check de l'agent (E4) : interroge Rust (`pi_health_check`) qui lance
 * `<rpc_pi_path> --version`. `ok` = l'exécutable configuré répond. Met à jour un
 * cache sync et émet `pilot-pi-health-changed`. À appeler au démarrage et sur
 * `pilot-config-changed` (chemin pi changé).
 */
export async function checkPiHealth() {
  try {
    healthCache = await invoke("pi_health_check");
  } catch (_) {
    healthCache = { ok: false, kind: "unknown", version: "", error: "probe_failed", path: "" };
  }
  window.dispatchEvent(new CustomEvent("pilot-pi-health-changed", { detail: healthCache }));
  return healthCache;
}

/** Renvoie le dernier résultat de health check (sync) — `null` avant la 1ʳᵉ sonde. */
export function getPiHealthSync() {
  return healthCache;
}

/** Genre détecté : "pi", "plh" ou "unknown". */
export function backendKind() {
  return cached ? cached.kind : "unknown";
}

/** True si le backend supporte `--extension` (gate pré-écriture). */
export function backendExtSupported() {
  return cached ? cached.ext_supported : false;
}

/** Libellé affichable de l'agent : "Agent PLh" si plh, sinon "Agent Pi". */
export function agentDisplayLabel() {
  return backendKind() === "plh" ? "Agent PLh" : "Agent Pi";
}

/** Désigne l'agent dans une phrase : "l'agent PLh" / "l'agent Pi". */
export function agentDisplayPhrase() {
  return backendKind() === "plh" ? "l'agent PLh" : "l'agent Pi";
}