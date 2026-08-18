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
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::rpc_manager::EventObserver;
use crate::{AppState, SessionActivity};

/// État de surveillance d'anomalie d'un agent (clé composite `project\u{1f}agent`).
pub struct AgentAnomalyState {
    /// Dernier événement RPC d'activité (base du calcul d'inactivité).
    pub last_activity: Instant,
    /// Type du dernier événement RPC (ex: "tool_execution_end").
    pub last_event: String,
    /// L'agent est-il en cours d'exécution (agent_start → true, agent_settled → false).
    pub busy: bool,
    /// Une alerte de blocage a-t-elle déjà été émise pour cette exécution ?
    /// Réarmé à false au prochain `agent_start`/`agent_settled` (nouvelle exécution).
    pub blocked_reported: bool,
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
        if !ACTIVITY_EVENTS.contains(&t) {
            return;
        }
        let now = Instant::now();
        // Map d'activité par projet (issue #13) — comportement identique à
        // `rpc::make_project_activity_observer`.
        {
            let mut m = activity_map.lock().unwrap();
            let entry = m.entry(project_key.clone()).or_insert(SessionActivity {
                busy: false,
                updated: now,
            });
            if t == "agent_start" {
                entry.busy = true;
            } else if t == "agent_settled" {
                entry.busy = false;
            }
            entry.updated = now;
        }
        // Map de surveillance d'anomalie par agent (tâche 8).
        {
            let mut m = anomaly_map.lock().unwrap();
            let entry = m.entry(agent_key.clone()).or_insert(AgentAnomalyState {
                last_activity: now,
                last_event: t.to_string(),
                busy: false,
                blocked_reported: false,
            });
            if t == "agent_start" {
                entry.busy = true;
                // Nouvelle exécution : réarmer la détection de blocage.
                entry.blocked_reported = false;
            } else if t == "agent_settled" {
                entry.busy = false;
                entry.blocked_reported = false;
            }
            entry.last_activity = now;
            entry.last_event = t.to_string();
        }
    })
}

/// Démarre la surveillance arrière-plan des anomalies d'agents (tâche 8).
/// Thread autonome : toutes les 30 s, vérifie si un agent actif (busy) n'a pas
/// eu d'activité depuis `anomaly_timeout_minutes` (défaut 30). Si oui, émet
/// l'événement `agent-anomaly` (une seule fois par blocage, réarmé au prochain
/// `agent_start`/`agent_settled`). Ne bloque jamais l'interface (thread dédié).
/// Respecte le réglage `anomaly_detection_enabled` (défaut activé).
pub fn start_monitor(app: AppHandle, anomaly_map: Arc<Mutex<HashMap<String, AgentAnomalyState>>>) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_secs(30));
            let state = app.state::<AppState>();
            let (enabled, timeout_minutes) = {
                let cfg = state.config.lock().unwrap();
                (cfg.anomaly_detection_enabled, cfg.anomaly_timeout_minutes)
            };
            if !enabled {
                continue;
            }
            let timeout = Duration::from_secs((timeout_minutes.max(1) as u64) * 60);
            let now = Instant::now();
            let mut alerts: Vec<(String, String, String, u64)> = Vec::new();
            {
                let mut m = anomaly_map.lock().unwrap();
                for (key, entry) in m.iter_mut() {
                    if entry.busy
                        && !entry.blocked_reported
                        && now.duration_since(entry.last_activity) > timeout
                    {
                        entry.blocked_reported = true;
                        let mut parts = key.splitn(2, '\u{1f}');
                        let project = parts.next().unwrap_or("").to_string();
                        let agent = parts.next().unwrap_or("").to_string();
                        let idle_min = now.duration_since(entry.last_activity).as_secs() / 60;
                        alerts.push((project, agent, entry.last_event.clone(), idle_min));
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
#[tauri::command]
pub fn start_diagnostic_agent(
    state: State<AppState>,
    app: AppHandle,
    project: String,
    agent: String,
    anomaly: Value,
) -> Result<(), String> {
    let (pi_path, no_session) = {
        let cfg = state.config.lock().unwrap();
        (cfg.rpc_pi_path.clone(), cfg.rpc_no_session)
    };
    let prompt = build_diagnostic_prompt(&project, &agent, &anomaly);
    // Démarre (ou reprend) le processus agent dédié `diagnostic`.
    crate::agents::do_start_agent_process(
        state.inner(),
        &app,
        "diagnostic".to_string(),
        project.clone(),
        pi_path,
        no_session,
    )?;
    // Envoie le prompt d'analyse.
    crate::agents::do_send_agent_process_prompt(
        state.inner(),
        "diagnostic".to_string(),
        prompt,
        Some(project),
    )?;
    Ok(())
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
}
