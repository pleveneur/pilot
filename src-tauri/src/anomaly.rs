// anomaly.rs — Détection d'anomalies des agents (tâche 8).
//
// Surveillance arrière-plan, SANS LLM : suit l'activité RPC de chaque agent
// (dernier événement, dernière action) et signale comme « bloqué » un agent
// actif (busy) mais sans progression depuis plus de `anomaly_timeout_minutes`
// (défaut 30 min). Aucune action automatique : l'utilisateur est notifié et
// peut lancer un agent de diagnostic qui PROPOSE des évolutions (validation
// utilisateur requise).
//
// Architecture :
// - `make_observer` : observateur d'événements RPC combiné, branché sur chaque
//   session (spawn_session, spawn_agent_process, reviewer, super-agent). Met à
//   jour la map d'activité par projet (issue #13) ET la map de surveillance
//   d'anomalie par agent (clé composite `project\u{1f}agent`).
// - `start_monitor` : thread arrière-plan qui vérifie périodiquement la map et
//   émet l'événement `agent-anomaly` (Rust → JS) quand un agent est bloqué.
// - `start_diagnostic_agent` : commande Tauri qui lance un agent dédié
//   (`diagnostic`) avec un prompt d'analyse, pour PROPOSER des évolutions.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::rpc_manager::EventObserver;
use crate::{AppState, SessionActivity};

/// État de surveillance d'anomalie d'un agent (clé composite `project\u{1f}agent`).
pub struct AgentAnomalyState {
    /// Dernier événement RPC d'activité (base du calcul d'inactivité).
    pub last_activity: Instant,
    /// Horodatage wall-clock (SystemTime) du dernier événement RPC d'activité.
    /// `Instant` est monotone (pas un horodatage réel) : ce champ permet de
    /// produire un timestamp ISO lisible pour l'assistant (list_agent_sessions).
    pub last_activity_wall: Option<SystemTime>,
    /// Type du dernier événement RPC (ex: "tool_execution_end").
    pub last_event: String,
    /// L'agent est-il en cours d'exécution (agent_start → true, agent_settled
    /// ou agent_end → false). `agent_end` marque la fin d'un tour : on repasse
    /// busy=false dès cet événement pour être robuste si `agent_settled` est perdu.
    pub busy: bool,
    /// Une alerte de blocage a-t-elle déjà été émise pour cette exécution ?
    /// Réarmé à false au prochain `agent_start`/`agent_settled` (nouvelle exécution).
    pub blocked_reported: bool,
    /// T2 : l'agent a-t-il déjà été arrêté AUTOMATIQUEMENT (bloqué sans
    /// progression depuis `agent_auto_stop_minutes`) pour cette exécution ?
    /// Réarmé à false au prochain `agent_start`/`agent_settled`. Empêche de
    /// ré-arrêter un agent déjà arrêté dans la même exécution.
    pub auto_stopped_reported: bool,
}

/// Événements RPC considérés comme une activité de l'agent (rafraîchissent
/// `last_activity`). Même liste que `rpc.rs::ACTIVITY_EVENTS`.
const ACTIVITY_EVENTS: &[&str] = &[
    "agent_start",
    "agent_end",
    "agent_settled",
    "turn_start",
    "message_start",
    "message_update",
    "message_end",
    "tool_execution_start",
    "tool_execution_update",
    "tool_execution_end",
    "compaction_start",
    "compaction_end",
    "auto_retry_start",
    "auto_retry_end",
];

/// Événements de cycle de vie du PROCESSUS (pas une activité de génération).
/// Quand le processus agent meurt (exit, erreur), il ne peut plus être
/// « occupé » : ces événements effacent `busy` dans les deux maps même sans
/// `agent_settled`/`agent_end`. Évite l'indicateur « Réfléchit » bloqué à
/// jamais si le process meurt en pleine génération (issue #141).
const RESET_EVENTS: &[&str] = &["process_exit", "process_error"];

/// Construit l'observateur combiné : met à jour la map d'activité par projet
/// (issue #13, pastille « travaille en arrière-plan ») ET la map de surveillance
/// d'anomalie par agent (tâche 8). `project_key` = chemin normalisé du projet,
/// `agent_key` = clé composite `project\u{1f}agent`.
pub fn make_observer(
    activity_map: &Arc<Mutex<HashMap<String, SessionActivity>>>,
    anomaly_map: &Arc<Mutex<HashMap<String, AgentAnomalyState>>>,
    project_key: &str,
    agent_key: &str,
) -> EventObserver {
    let activity_map = activity_map.clone();
    let anomaly_map = anomaly_map.clone();
    let project_key = project_key.to_string();
    let agent_key = agent_key.to_string();
    Arc::new(move |value: &Value| {
        let t = value.get("type").and_then(|v| v.as_str()).unwrap_or("");
        // Événement de reset (mort du process) : même si ce n'est pas une
        // activité de génération, on efface `busy` pour ne pas bloquer
        // l'indicateur. Un reset ne CRÉE pas d'entrée (pas d'agent à suivre).
        let is_reset = RESET_EVENTS.contains(&t);
        if !is_reset && !ACTIVITY_EVENTS.contains(&t) {
            return;
        }
        let now = Instant::now();
        // Map d'activité par projet (issue #13) — comportement identique à
        // `rpc::make_project_activity_observer`.
        {
            let mut m = activity_map.lock().unwrap();
            if is_reset {
                // Process mort : l'agent ne peut plus être « occupé ».
                if let Some(entry) = m.get_mut(&project_key) {
                    entry.busy = false;
                    entry.updated = now;
                }
            } else {
                let entry = m.entry(project_key.clone()).or_insert(SessionActivity {
                    busy: false,
                    updated: now,
                });
                if t == "agent_start" {
                    entry.busy = true;
                } else if t == "agent_settled" || t == "agent_end" {
                    // `agent_end` marque la fin d'un tour (le frontend considère
                    // l'agent « au repos » dès cet événement). On repasse busy=false
                    // aussi sur `agent_end` pour être robuste si `agent_settled` est
                    // perdu : l'indicateur d'activité ne doit pas rester « occupé »
                    // alors que l'agent a fini de répondre.
                    entry.busy = false;
                }
                entry.updated = now;
            }
        }
        // Map de surveillance d'anomalie par agent (tâche 8).
        {
            let mut m = anomaly_map.lock().unwrap();
            if is_reset {
                // Process mort en pleine génération : effacer `busy` (et réarmer
                // la détection de blocage / l'arrêt auto) pour ne JAMAIS laisser
                // l'indicateur « Réfléchit » bloqué à true (issue #141).
                if let Some(entry) = m.get_mut(&agent_key) {
                    entry.busy = false;
                    entry.blocked_reported = false;
                    entry.auto_stopped_reported = false;
                    entry.last_activity = now;
                    entry.last_activity_wall = Some(SystemTime::now());
                    entry.last_event = t.to_string();
                }
            } else {
                let entry = m.entry(agent_key.clone()).or_insert(AgentAnomalyState {
                    last_activity: now,
                    last_activity_wall: Some(SystemTime::now()),
                    last_event: t.to_string(),
                    busy: false,
                    blocked_reported: false,
                    auto_stopped_reported: false,
                });
                if t == "agent_start" {
                    entry.busy = true;
                    // Nouvelle exécution : réarmer la détection de blocage ET l'arrêt auto.
                    entry.blocked_reported = false;
                    entry.auto_stopped_reported = false;
                } else if t == "agent_settled" || t == "agent_end" {
                    // `agent_end` marque la fin d'un tour (le frontend considère
                    // l'agent « au repos » dès cet événement). On repasse busy=false
                    // aussi sur `agent_end` pour être robuste si `agent_settled` est
                    // perdu : l'indicateur d'activité ne doit pas rester « occupé »
                    // alors que l'agent a fini de répondre. Réarme aussi la détection
                    // de blocage / l'arrêt auto (nouvelle exécution à venir).
                    entry.busy = false;
                    entry.blocked_reported = false;
                    entry.auto_stopped_reported = false;
                }
                entry.last_activity = now;
                entry.last_activity_wall = Some(SystemTime::now());
                entry.last_event = t.to_string();
            }
        }
    })
}

/// Formate la dernière activité d'un agent en (timestamp ISO 8601 UTC, relatif
/// « il y a X min »). `last_activity` (Instant, monotone) sert au relatif ;
/// `last_activity_wall` (SystemTime, wall-clock) sert à l'ISO. Retourne
/// `(None, None)` si aucune activité n'a été enregistrée (champ optionnel).
pub fn last_activity_info(state: &AgentAnomalyState) -> (Option<String>, Option<String>) {
    let iso = state.last_activity_wall.map(|t| {
        let dt: chrono::DateTime<chrono::Utc> = t.into();
        dt.to_rfc3339()
    });
    let relative = {
        let secs = state.last_activity.elapsed().as_secs();
        if secs < 60 {
            Some(format!("il y a {} s", secs))
        } else if secs < 3600 {
            Some(format!("il y a {} min", secs / 60))
        } else if secs < 86400 {
            Some(format!("il y a {} h", secs / 3600))
        } else {
            Some(format!("il y a {} j", secs / 86400))
        }
    };
    (iso, relative)
}

/// Décide si un agent doit être arrêté AUTOMATIQUEMENT (T2) : agent busy, sans
/// progression (aucune nouvelle activité) depuis `timeout_minutes` (seuil dédié),
/// et pas déjà arrêté pour cette exécution. Pure et testable. Le filtrage du
/// scope (uniquement les agents délégués `AgentProcess`) est appliqué après,
/// via `agent_service.agent_process_alive` (l'observateur de la map d'anomalie
/// couvre aussi la session principale, le reviewer et le super-agent).
fn should_auto_stop(entry: &AgentAnomalyState, enabled: bool, timeout_minutes: u32, now: Instant) -> bool {
    if !enabled || !entry.busy || entry.auto_stopped_reported {
        return false;
    }
    let idle_secs = now.duration_since(entry.last_activity).as_secs();
    idle_secs > (timeout_minutes.max(1) as u64) * 60
}

/// Identifie la clé d'anomalie du super-agent (projet pseudo-global `""`).
/// Le super-agent est géré par un plafond « réfléchit » dédié (tâche #141) et
/// NON par l'arrêt auto T2 (scope agents délégués). Pure et testable.
fn is_super_agent_key(project: &str, agent: &str) -> bool {
    project.is_empty() && agent == crate::agent_service::SUPERAGENT_ID
}

/// Démarre la surveillance arrière-plan des anomalies d'agents (tâche 8) ET
/// l'arrêt AUTOMATIQUE des agents délégués bloqués (T2).
/// Thread autonome : toutes les 30 s, vérifie si un agent actif (busy) n'a pas
/// eu d'activité depuis le seuil. Deux comportements :
///  1. Anomalie (lecture seule, `anomaly_timeout_minutes`, défaut 30) : émet
///     l'événement `agent-anomaly` (une fois par blocage, réarmé au prochain
///     `agent_start`/`agent_settled`).
///  2. Arrêt auto (T2, `agent_auto_stop_minutes`, défaut 10) : si `busy` sans
///     progression depuis ce seuil DÉDIÉ, et que l'agent est un agent délégué
///     (`AgentProcess`, scope restreint), arrête le processus pi, émet
///     l'événement `agent-auto-stopped` (UI + libération du créneau
///     d'exclusivité par agents-bus.js) puis PROPOSE automatiquement le
///     diagnostic (`do_start_diagnostic_agent`).
/// Ne bloque jamais l'interface (thread dédié). Respecte les réglages
/// `anomaly_detection_enabled` et `agent_auto_stop_enabled` (défauts activés).
pub fn start_monitor(app: AppHandle, anomaly_map: Arc<Mutex<HashMap<String, AgentAnomalyState>>>) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_secs(30));
            let state = app.state::<AppState>();
            let (anomaly_enabled, timeout_minutes, auto_stop_enabled, auto_stop_minutes, super_stop_enabled, super_stop_minutes) = {
                let cfg = state.config.lock().unwrap();
                (
                    cfg.anomaly_detection_enabled,
                    cfg.anomaly_timeout_minutes,
                    cfg.agent_auto_stop_enabled,
                    cfg.agent_auto_stop_minutes,
                    cfg.super_agent_auto_stop_enabled,
                    cfg.super_agent_auto_stop_minutes,
                )
            };
            let anomaly_timeout_secs = (timeout_minutes.max(1) as u64) * 60;
            let now = Instant::now();
            let mut alerts: Vec<(String, String, String, u64)> = Vec::new();
            let mut auto_stops: Vec<(String, String, u64)> = Vec::new();
            let mut super_stops: Vec<(String, u64)> = Vec::new();
            {
                let mut m = anomaly_map.lock().unwrap();
                for (key, entry) in m.iter_mut() {
                    let mut parts = key.splitn(2, '\u{1f}');
                    let project = parts.next().unwrap_or("").to_string();
                    let agent = parts.next().unwrap_or("").to_string();
                    let idle_secs = now.duration_since(entry.last_activity).as_secs();
                    // Le super-agent (Assistant 🧭) est géré par un plafond dédié
                    // (tâche #141) et NON par l'arrêt auto T2 (scope agents délégués).
                    let is_super = is_super_agent_key(&project, &agent);
                    // 1. Anomalie (lecture seule, tâche 8) : agent busy sans progression.
                    if anomaly_enabled
                        && entry.busy
                        && !entry.blocked_reported
                        && idle_secs > anomaly_timeout_secs
                    {
                        entry.blocked_reported = true;
                        alerts.push((project.clone(), agent.clone(), entry.last_event.clone(), idle_secs / 60));
                    }
                    // 2. Arrêt auto (T2) : agents délégués uniquement (le super-agent
                    //    est exclu, cf. `is_super`). Le scope (AgentProcess) est filtré
                    //    après (agent_process_alive).
                    if !is_super
                        && should_auto_stop(entry, auto_stop_enabled, auto_stop_minutes, Instant::now())
                    {
                        entry.auto_stopped_reported = true;
                        // Pas de double alerte (anomalie) pour un agent déjà arrêté.
                        entry.blocked_reported = true;
                        auto_stops.push((project.clone(), agent.clone(), idle_secs / 60));
                    }
                    // 3. Plafond « réfléchit » du super-agent (tâche #141) : filet de
                    //    sécurité si le super-agent reste busy sans progression depuis
                    //    `super_agent_auto_stop_minutes` (défaut 10 min). Coupe le
                    //    process + alerte, sans toucher aux agents de projets.
                    if is_super
                        && should_auto_stop(entry, super_stop_enabled, super_stop_minutes, Instant::now())
                    {
                        entry.auto_stopped_reported = true;
                        entry.blocked_reported = true;
                        super_stops.push((agent, idle_secs / 60));
                    }
                }
            }
            for (project, agent, last_event, idle_min) in alerts {
                let _ = app.emit(
                    "agent-anomaly",
                    serde_json::json!({
                        "project": project,
                        "agent": agent,
                        "lastEvent": last_event,
                        "idleMinutes": idle_min,
                    }),
                );
            }
            for (project, agent, idle_min) in auto_stops {
                // Scope restreint : ne viser QUE les agents délégués (AgentProcess).
                // Ne touche jamais le chat principal, le reviewer ni le super-agent.
                if !state.agent_service.agent_process_alive(&project, &agent) {
                    continue;
                }
                // L'agent ne tourne plus : marquer busy=false pour ne pas re-détecter.
                {
                    let mut m = anomaly_map.lock().unwrap();
                    if let Some(e) = m.get_mut(&format!("{}\u{1f}{}", project, agent)) {
                        e.busy = false;
                    }
                }
                // Arrêt réel du processus pi (libère aussi le registre + la session).
                let _ = state.agent_service.stop(&project, &agent);
                // Événement Rust → JS : l'UI informe l'utilisateur (bandeau) et le
                // bus d'agents libère le créneau d'exclusivité (la file d'attente).
                let _ = app.emit(
                    "agent-auto-stopped",
                    serde_json::json!({
                        "project": project,
                        "agent": agent,
                        "reason": "Agent délégué arrêté automatiquement : bloqué (actif sans progression).",
                        "idleMinutes": idle_min,
                    }),
                );
                // PROPOSE automatiquement le diagnostic (réutilise l'existant).
                let anomaly_val =
                    serde_json::json!({ "lastEvent": "arrêt automatique (bloqué)", "idleMinutes": idle_min });
                let _ = do_start_diagnostic_agent(state.inner(), &app, &project, &agent, &anomaly_val);
            }
            // 3. Plafond « réfléchit » du super-agent (tâche #141) : couper le
            //    process du super-agent bloqué (busy sans progression) + alerter.
            //    Ne touche jamais aux agents de projets (clé dédiée `\u{1f}superagent`).
            for (agent, idle_min) in super_stops {
                // Couper le processus du super-agent (libère aussi la session).
                let _ = state.agent_service.stop_superagent();
                // Marquer busy=false pour ne pas re-détecter (le kill volontaire
                // n'émet pas process_exit : running passé à false avant le kill).
                {
                    let mut m = anomaly_map.lock().unwrap();
                    if let Some(e) = m.get_mut(&format!("\u{1f}{}", agent)) {
                        e.busy = false;
                        e.blocked_reported = false;
                        e.auto_stopped_reported = false;
                    }
                }
                // Événement Rust → JS : l'UI informe l'utilisateur.
                let _ = app.emit(
                    "super-agent-auto-stopped",
                    serde_json::json!({
                        "reason": "Assistant arrêté automatiquement : bloqué (actif sans progression).",
                        "idleMinutes": idle_min,
                    }),
                );
            }
        }
    });
}

/// Construit le prompt d'analyse envoyé à l'agent de diagnostic. L'agent ne fait
/// QUE PROPOSER des évolutions — aucune action automatique (validation utilisateur).
fn build_diagnostic_prompt(project: &str, agent: &str, anomaly: &Value) -> String {
    let last_event = anomaly
        .get("lastEvent")
        .and_then(|v| v.as_str())
        .unwrap_or("inconnu");
    let idle_min = anomaly
        .get("idleMinutes")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    format!(
        "Tu es l'agent de diagnostic de Pilot. Un agent est détecté comme bloqué.\n\n\
         === ANOMALIE DÉTECTÉE ===\n\
         Projet : {project}\n\
         Agent : {agent}\n\
         Dernier événement : {last_event}\n\
         Inactif depuis : {idle_min} minutes\n\
         === FIN ANOMALIE ===\n\n\
         Analyse la situation (lis les fichiers concernés si besoin) et propose des \
         évolutions pour débloquer ou prévenir ce type de blocage.\n\n\
         ⚠️ IMPORTANT : tu ne fais AUCUNE action automatique. Tu PROPOSES uniquement \
         des évolutions, qui seront validées par l'utilisateur.\n\n\
         Termine ta réponse par DONE: <résumé concis>."
    )
}

/// Lance l'agent de diagnostic dédié (`diagnostic`) pour une anomalie détectée.
/// Démarre un processus agent dédié (canal `rpc-event-agents`, agent_id
/// `diagnostic`) et lui envoie un prompt d'analyse. L'agent PROPOSE des
/// évolutions — l'utilisateur valide (aucune action automatique).
/// Variante sans `State`/commande (appelable depuis le moniteur d'arrêt auto T2).
pub(crate) fn do_start_diagnostic_agent(
    state: &AppState,
    app: &AppHandle,
    project: &str,
    agent: &str,
    anomaly: &Value,
) -> Result<(), String> {
    let (pi_path, no_session) = {
        let cfg = state.config.lock().unwrap();
        (cfg.rpc_pi_path.clone(), cfg.rpc_no_session)
    };
    let prompt = build_diagnostic_prompt(project, agent, anomaly);
    // Démarre (ou reprend) le processus agent dédié `diagnostic`.
    crate::agents::do_start_agent_process(
        state,
        app,
        "diagnostic".to_string(),
        project.to_string(),
        pi_path,
        no_session,
    )?;
    // Envoie le prompt d'analyse.
    crate::agents::do_send_agent_process_prompt(
        state,
        "diagnostic".to_string(),
        prompt,
        Some(project.to_string()),
    )?;
    Ok(())
}

/// Commande Tauri : lance l'agent de diagnostic dédié (`diagnostic`) pour une
/// anomalie détectée (bouton manuel « 🔍 Diagnostiquer » du bandeau).
#[tauri::command]
pub fn start_diagnostic_agent(
    state: State<AppState>,
    app: AppHandle,
    project: String,
    agent: String,
    anomaly: Value,
) -> Result<(), String> {
    do_start_diagnostic_agent(&state, &app, &project, &agent, &anomaly)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(t: &str) -> Value {
        serde_json::json!({ "type": t })
    }

    /// L'observateur combiné met à jour la map d'activité par projet ET la map
    /// de surveillance d'anomalie par agent (busy + last_activity + last_event).
    #[test]
    fn observer_tracks_busy_and_activity() {
        let activity: Arc<Mutex<HashMap<String, SessionActivity>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let anomaly: Arc<Mutex<HashMap<String, AgentAnomalyState>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let obs = make_observer(&activity, &anomaly, "/proj", "/proj\u{1f}codeur");

        // agent_start → busy=true, last_event=agent_start.
        obs(&ev("agent_start"));
        {
            let a = anomaly.lock().unwrap();
            let s = a.get("/proj\u{1f}codeur").unwrap();
            assert!(s.busy);
            assert_eq!(s.last_event, "agent_start");
            assert!(!s.blocked_reported);
        }
        {
            let act = activity.lock().unwrap();
            assert!(act.get("/proj").unwrap().busy);
        }

        // Une activité (tool_execution_end) rafraîchit last_activity/last_event.
        obs(&ev("tool_execution_end"));
        {
            let a = anomaly.lock().unwrap();
            let s = a.get("/proj\u{1f}codeur").unwrap();
            assert!(s.busy);
            assert_eq!(s.last_event, "tool_execution_end");
        }

        // agent_settled → busy=false, réarme blocked_reported.
        obs(&ev("agent_settled"));
        {
            let a = anomaly.lock().unwrap();
            let s = a.get("/proj\u{1f}codeur").unwrap();
            assert!(!s.busy);
        }
        {
            let act = activity.lock().unwrap();
            assert!(!act.get("/proj").unwrap().busy);
        }
    }

    /// `agent_end` (fin d'un tour) repasse busy=false, même sans `agent_settled`
    /// (robustesse : l'indicateur d'activité ne doit pas rester « occupé » si
    /// l'événement `agent_settled` est manquant ou perdu).
    #[test]
    fn observer_clears_busy_on_agent_end() {
        let activity: Arc<Mutex<HashMap<String, SessionActivity>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let anomaly: Arc<Mutex<HashMap<String, AgentAnomalyState>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let obs = make_observer(&activity, &anomaly, "/proj", "/proj\u{1f}codeur");

        // agent_start → busy=true.
        obs(&ev("agent_start"));
        {
            let a = anomaly.lock().unwrap();
            assert!(a.get("/proj\u{1f}codeur").unwrap().busy);
        }
        {
            let act = activity.lock().unwrap();
            assert!(act.get("/proj").unwrap().busy);
        }

        // agent_end (sans agent_settled) → busy=false dans les deux maps.
        obs(&ev("agent_end"));
        {
            let a = anomaly.lock().unwrap();
            let s = a.get("/proj\u{1f}codeur").unwrap();
            assert!(!s.busy);
            assert_eq!(s.last_event, "agent_end");
        }
        {
            let act = activity.lock().unwrap();
            assert!(!act.get("/proj").unwrap().busy);
        }
    }

    /// `process_exit`/`process_error` (mort du process) effacent `busy` même
    /// sans `agent_settled`/`agent_end` (issue #141 : indicateur « Réfléchit »
    /// bloqué si le process meurt en pleine génération). Un reset ne crée pas
    /// d'entrée si aucune activité n'a eu lieu avant.
    #[test]
    fn observer_clears_busy_on_process_exit_and_error() {
        let activity: Arc<Mutex<HashMap<String, SessionActivity>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let anomaly: Arc<Mutex<HashMap<String, AgentAnomalyState>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let obs = make_observer(&activity, &anomaly, "/proj", "/proj\u{1f}codeur");

        // Pas d'entrée avant : un reset ne crée rien (aucun agent à suivre).
        obs(&ev("process_exit"));
        assert!(anomaly.lock().unwrap().is_empty());
        assert!(activity.lock().unwrap().is_empty());

        // agent_start → busy=true dans les deux maps.
        obs(&ev("agent_start"));
        {
            let a = anomaly.lock().unwrap();
            assert!(a.get("/proj\u{1f}codeur").unwrap().busy);
        }
        {
            let act = activity.lock().unwrap();
            assert!(act.get("/proj").unwrap().busy);
        }

        // process_exit → busy=false dans les deux maps (process mort).
        obs(&ev("process_exit"));
        {
            let a = anomaly.lock().unwrap();
            let s = a.get("/proj\u{1f}codeur").unwrap();
            assert!(!s.busy);
            assert_eq!(s.last_event, "process_exit");
        }
        {
            let act = activity.lock().unwrap();
            assert!(!act.get("/proj").unwrap().busy);
        }

        // process_error → busy=false aussi.
        obs(&ev("agent_start"));
        obs(&ev("process_error"));
        {
            let a = anomaly.lock().unwrap();
            assert!(!a.get("/proj\u{1f}codeur").unwrap().busy);
        }
    }

    /// Un événement non-pertinent (ex: "unknown") ne crée pas d'entrée.
    #[test]
    fn observer_ignores_irrelevant_events() {
        let activity: Arc<Mutex<HashMap<String, SessionActivity>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let anomaly: Arc<Mutex<HashMap<String, AgentAnomalyState>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let obs = make_observer(&activity, &anomaly, "/proj", "/proj\u{1f}codeur");
        obs(&ev("some_other_event"));
        assert!(anomaly.lock().unwrap().is_empty());
        assert!(activity.lock().unwrap().is_empty());
    }

    /// Le prompt de diagnostic mentionne l'anomalie et interdit l'action auto.
    #[test]
    fn diagnostic_prompt_mentions_anomaly_and_no_auto_action() {
        let anomaly = serde_json::json!({ "lastEvent": "tool_execution_end", "idleMinutes": 42 });
        let p = build_diagnostic_prompt("/proj", "codeur", &anomaly);
        assert!(p.contains("/proj"));
        assert!(p.contains("codeur"));
        assert!(p.contains("tool_execution_end"));
        assert!(p.contains("42"));
        assert!(p.contains("AUCUNE action automatique"));
        assert!(p.contains("DONE:"));
    }

    /// `last_activity_info` produit un timestamp ISO (wall-clock) et un relatif
    /// « il y a X min » à partir de l'état d'anomalie. Sans activité wall-clock
    /// enregistrée, l'ISO est absent (champ optionnel).
    #[test]
    fn last_activity_info_formats_iso_and_relative() {
        let state = AgentAnomalyState {
            last_activity: Instant::now(),
            last_activity_wall: Some(SystemTime::now()),
            last_event: "tool_execution_end".to_string(),
            busy: true,
            blocked_reported: false,
            auto_stopped_reported: false,
        };
        let (iso, relative) = last_activity_info(&state);
        // ISO présent et au format RFC3339 (ex: 2024-01-15T10:30:00+00:00).
        let iso = iso.expect("ISO présent quand une activité wall-clock est enregistrée");
        assert!(iso.contains('T'), "ISO 8601 contient un séparateur T");
        // Relatif présent et commence par « il y a ».
        let relative = relative.expect("relatif toujours présent");
        assert!(relative.starts_with("il y a "), "relatif commence par 'il y a'");

        // Sans activité wall-clock → ISO absent, relatif toujours présent.
        let no_wall = AgentAnomalyState {
            last_activity: Instant::now(),
            last_activity_wall: None,
            last_event: "agent_start".to_string(),
            busy: true,
            blocked_reported: false,
            auto_stopped_reported: false,
        };
        let (iso2, relative2) = last_activity_info(&no_wall);
        assert!(iso2.is_none(), "ISO absent sans activité wall-clock");
        assert!(relative2.is_some(), "relatif présent même sans wall-clock");
    }

    /// T2 : `should_auto_stop` décide l'arrêt automatique d'un agent busy sans
    /// progression depuis le seuil dédié, non déjà arrêté. Respecte le réglage
    /// `enabled`, l'état `busy` et le drapeau `auto_stopped_reported`.
    #[test]
    fn should_auto_stop_guards_enabled_busy_and_reported() {
        // `now` synthétique (futur lointain) : on maîtrise totalement l'ancienneté
        // des activités, sans dépendre de l'heure de boot de la machine (un simple
        // `Instant::now() - 6000s` déborde si la machine a booté il y a < 100 min).
        let now = Instant::now() + Duration::from_secs(100_000);
        // Helper : construit un état avec une dernière activité il y a `idle_secs`.
        let state_at = |idle_secs: u64, busy: bool, reported: bool| AgentAnomalyState {
            last_activity: now - Duration::from_secs(idle_secs),
            last_activity_wall: Some(SystemTime::now()),
            last_event: "tool_execution_start".to_string(),
            busy,
            blocked_reported: false,
            auto_stopped_reported: reported,
        };

        // Désactivé → jamais arrêté, même très inactif.
        let e = state_at(6000, true, false); // 100 min inactif
        assert!(!should_auto_stop(&e, false, 10, now));

        // Actif non busy → pas d'arrêt.
        let e = state_at(6000, false, false);
        assert!(!should_auto_stop(&e, true, 10, now));

        // Déjà arrêté pour cette exécution → pas de re-arrêt.
        let e = state_at(6000, true, true);
        assert!(!should_auto_stop(&e, true, 10, now));

        // Inactivité < seuil → pas d'arrêt (outil long légitime).
        let e = state_at(300, true, false); // 5 min < 10 min
        assert!(!should_auto_stop(&e, true, 10, now));

        // Inactivité > seuil, busy, non arrêté → arrêt.
        let e = state_at(700, true, false); // ~11 min > 10 min
        assert!(should_auto_stop(&e, true, 10, now));

        // Seuil min 1 min : une inactivité > 1 min suffit.
        let e = state_at(90, true, false);
        assert!(should_auto_stop(&e, true, 1, now));
    }

    /// Le super-agent (projet pseudo-global `""`) est identifié par sa clé
    /// dédiée et n'est PAS confondu avec un agent de projet (tâche #141).
    #[test]
    fn is_super_agent_key_identifies_superagent_only() {
        assert!(is_super_agent_key("", "superagent"));
        // Un agent de projet (projet non vide) n'est jamais le super-agent.
        assert!(!is_super_agent_key("/proj", "superagent"));
        assert!(!is_super_agent_key("", "codeur"));
        assert!(!is_super_agent_key("/proj", "codeur"));
    }
}
