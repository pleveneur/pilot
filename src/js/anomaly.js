// anomaly.js — Détection d'anomalies des agents (tâche 8).
//
// Côté frontend : écoute l'événement `agent-anomaly` (émis par le moniteur Rust
// quand un agent est actif mais sans progression depuis le seuil), affiche un
// bandeau d'alerte persistant, envoie une notification desktop + son, et permet
// de lancer l'agent de diagnostic dédié (`diagnostic`) qui PROPOSE des évolutions
// (validation utilisateur requise — aucune action automatique).
//
// La sortie de l'agent de diagnostic arrive sur le canal `rpc-event-agents`
// (agent_id "diagnostic") et est affichée dans une modale.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { notifyAnomaly } from "./desktop-notify.js";

let _unlisten = null;
let _autoStopUnlisten = null;
let _diagUnlisten = null;
let _diagBuffer = "";
let _banner = null;
let _modal = null;

/**
 * Initialise la détection d'anomalies côté frontend (écouteurs d'événements).
 * Appelé une seule fois au démarrage de Pilot.
 */
export async function initAnomalyDetection() {
  if (_unlisten) return;
  _unlisten = await listen("agent-anomaly", (event) => {
    handleAnomaly(event.payload || {});
  });
  // T2 : arrêt automatique d'un agent délégué bloqué (émis par le moniteur Rust).
  _autoStopUnlisten = await listen("agent-auto-stopped", (event) => {
    handleAutoStopped(event.payload || {});
  });
  // Sortie de l'agent de diagnostic (canal unifié des agents, agent_id "diagnostic").
  _diagUnlisten = await listen("rpc-event-agents", (ev) => {
    const payload = ev.payload || {};
    if (payload.agent_id !== "diagnostic") return;
    const event = payload.event || {};
    if (event.type === "text_delta") {
      _diagBuffer += event.delta || "";
    } else if (event.type === "agent_end") {
      showDiagnosticResult(_diagBuffer);
      _diagBuffer = "";
    }
  });
}

/** Traite une anomalie détectée : notification + bandeau d'alerte. */
function handleAnomaly(a) {
  const agent = a.agent || "agent";
  const project = a.project || "";
  const idle = a.idleMinutes || 0;
  const lastEvent = a.lastEvent || "inconnu";
  const msg = `L'agent « ${agent} » est actif mais sans progression depuis ${idle} min (dernier événement : ${lastEvent}).`;
  // Notification desktop native.
  notifyAnomaly({ title: "Pilot — Anomalie détectée", body: msg }).catch(() => {});
  // Bandeau d'alerte persistant avec bouton de lancement de l'agent de diagnostic.
  showAnomalyBanner({ agent, project, idle, lastEvent, msg });
}

/**
 * T2 : traite un arrêt AUTOMATIQUE d'un agent délégué bloqué (émis par le
 * moniteur Rust). Informe l'utilisateur (notification + bandeau) et PROPOSE
 * automatiquement le diagnostic (déjà lancé par le moniteur via
 * `do_start_diagnostic_agent` ; la sortie arrive sur `rpc-event-agents`).
 */
function handleAutoStopped(a) {
  const agent = a.agent || "agent";
  const project = a.project || "";
  const idle = a.idleMinutes || 0;
  const reason = a.reason || "Agent bloqué (actif sans progression)";
  const msg = `L'agent délégué « ${agent} » a été arrêté automatiquement : ${reason} (${idle} min sans progression).`;
  // Notification desktop native.
  notifyAnomaly({ title: "Pilot — Agent arrêté automatiquement", body: msg }).catch(() => {});
  // Bandeau d'alerte avec bouton « 🔍 Diagnostiquer » (relance manuelle possible).
  showAnomalyBanner({ agent, project, idle, lastEvent: "arrêt automatique", msg });
  // PROPOSE automatiquement le diagnostic (moniteur Rust : déjà lancé).
  showDiagnosticModal("🔍 Agent arrêté pour blocage.\n\nAgent de diagnostic lancé automatiquement — analyse en cours. Les évolutions proposées seront à valider par vous (aucune action automatique).");
}

/** Affiche (ou met à jour) le bandeau d'alerte d'anomalie. */
function showAnomalyBanner(a) {
  if (_banner && _banner.parentNode) {
    _banner.remove();
  }
  _banner = document.createElement("div");
  _banner.className = "anomaly-banner";
  _banner.innerHTML = `
    <div class="anomaly-banner-icon">⚠️</div>
    <div class="anomaly-banner-body">
      <div class="anomaly-banner-title">Agent bloqué détecté</div>
      <div class="anomaly-banner-text"></div>
    </div>
    <div class="anomaly-banner-actions">
      <button class="anomaly-btn anomaly-btn-primary" title="Lancer l'agent de diagnostic">🔍 Diagnostiquer</button>
      <button class="anomaly-btn anomaly-btn-close" title="Fermer">✕</button>
    </div>`;
  _banner.querySelector(".anomaly-banner-text").textContent = a.msg;
  _banner.querySelector(".anomaly-btn-primary").addEventListener("click", () => {
    launchDiagnosticAgent(a);
  });
  _banner.querySelector(".anomaly-btn-close").addEventListener("click", () => {
    if (_banner) { _banner.remove(); _banner = null; }
  });
  document.body.appendChild(_banner);
}

/** Lance l'agent de diagnostic dédié pour une anomalie. */
async function launchDiagnosticAgent(a) {
  try {
    await invoke("start_diagnostic_agent", {
      project: a.project || "",
      agent: a.agent || "",
      anomaly: {
        lastEvent: a.lastEvent || "",
        idleMinutes: a.idleMinutes || 0,
      },
    });
    showDiagnosticModal("🔍 Agent de diagnostic lancé…\n\nAnalyse en cours. Les évolutions proposées seront à valider par vous (aucune action automatique).");
  } catch (e) {
    console.error("[anomaly] échec lancement agent de diagnostic:", e);
    showDiagnosticModal("❌ Échec du lancement de l'agent de diagnostic :\n" + String(e));
  }
}

/** Affiche la modale de résultat de l'agent de diagnostic. */
function showDiagnosticModal(text) {
  if (_modal && _modal.parentNode) {
    _modal.remove();
  }
  _modal = document.createElement("div");
  _modal.className = "modal";
  _modal.innerHTML = `
    <div class="modal-content anomaly-modal-content">
      <div class="modal-header">
        <h3>🔍 Agent de diagnostic</h3>
        <button class="modal-close" title="Fermer">✕</button>
      </div>
      <div class="anomaly-modal-body"></div>
      <div class="modal-actions">
        <button class="anomaly-btn anomaly-btn-primary anomaly-modal-ok">OK</button>
      </div>
    </div>`;
  _modal.querySelector(".modal-close").addEventListener("click", () => closeDiagnosticModal());
  _modal.querySelector(".anomaly-modal-ok").addEventListener("click", () => closeDiagnosticModal());
  _modal.querySelector(".anomaly-modal-body").textContent = text;
  document.body.appendChild(_modal);
}

/** Affiche le résultat final de l'agent de diagnostic dans la modale. */
function showDiagnosticResult(text) {
  const body = _modal && _modal.querySelector(".anomaly-modal-body");
  if (body) {
    body.textContent = text || "(aucune analyse produite)";
  } else {
    showDiagnosticModal(text || "(aucune analyse produite)");
  }
}

/** Ferme la modale de diagnostic. */
function closeDiagnosticModal() {
  if (_modal) { _modal.remove(); _modal = null; }
}
