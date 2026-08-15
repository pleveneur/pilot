// agent.rs — Objet Agent (refonte système d'agents, cahier §4.1).
//
// Source de vérité de l'identité et de l'état logique d'un agent. Persisté en
// base (`agents`), indépendant de toute vue (onglet). L'onglet n'est qu'une vue
// optionnelle (`agent_views`).

use serde::{Deserialize, Serialize};

/// Modèles par backend (pi / plh).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct AgentModels {
    pub pi: String,
    pub plh: String,
}

/// Machine à états du processus agent (cahier §4.5).
///
/// - `Compacting` : distingue la compaction de l'arrêt (issue #54).
/// - `Paused`     : processus vivant rangé proprement (remplace le « parking » ad hoc).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AgentProcessState {
    Unloaded,
    Running,
    Compacting,
    Paused,
    Stopping,
    Stopped,
    Error(String),
}

impl AgentProcessState {
    /// Représentation texte persistée en base (`proc_state`).
    pub fn as_str(&self) -> &str {
        match self {
            AgentProcessState::Unloaded => "Unloaded",
            AgentProcessState::Running => "Running",
            AgentProcessState::Compacting => "Compacting",
            AgentProcessState::Paused => "Paused",
            AgentProcessState::Stopping => "Stopping",
            AgentProcessState::Stopped => "Stopped",
            AgentProcessState::Error(_) => "Error",
        }
    }

    /// Parse une représentation texte depuis la base.
    pub fn from_str(s: &str) -> Self {
        match s {
            "Running" => AgentProcessState::Running,
            "Compacting" => AgentProcessState::Compacting,
            "Paused" => AgentProcessState::Paused,
            "Stopping" => AgentProcessState::Stopping,
            "Stopped" => AgentProcessState::Stopped,
            "Error" => AgentProcessState::Error("".to_string()),
            _ => AgentProcessState::Unloaded,
        }
    }
}

impl Default for AgentProcessState {
    fn default() -> Self {
        AgentProcessState::Unloaded
    }
}

/// Objet Agent — identité + configuration + état d'exécution persisté.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Agent {
    // ── Identité (persistée, stable) ──
    pub id: String,
    pub name: String,
    pub icon: String,
    pub description: String,
    pub role: String,

    // ── Configuration ──
    pub models: AgentModels,
    pub capabilities: Vec<String>,
    pub readonly: bool,
    pub keep_context: bool,
    pub max_calls_per_run: u32,
    pub call_depth: u32,

    // ── État d'exécution (persisté) ──
    #[serde(default)]
    pub project_path: Option<String>,
    #[serde(default)]
    pub loaded: bool,
    #[serde(default)]
    pub busy: bool,
    #[serde(default)]
    pub state: AgentProcessState,
    #[serde(default = "default_visible")]
    pub visible: bool,
    #[serde(default)]
    pub last_active_at: Option<String>,
}

fn default_visible() -> bool { true }

/// Vue d'onglet d'un agent (table `agent_views`) — dissocie la vue (Tab) de
/// l'objet Agent. Reconstruit la barre d'onglets agents à l'identique au
/// redémarrage / retour sur un projet (cahier §5.2).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentView {
    pub agent_id: String,
    pub project_path: String,
    pub order_index: i64,
    #[serde(default)]
    pub name_override: Option<String>,
    #[serde(default)]
    pub active: bool,
}

impl AgentView {
    /// Construit une AgentView depuis une ligne SQLite (`agent_views`).
    pub fn from_row(row: &rusqlite::Row) -> rusqlite::Result<AgentView> {
        Ok(AgentView {
            agent_id: row.get("agent_id")?,
            project_path: row.get("project_path")?,
            order_index: row.get("order_index")?,
            name_override: row.get("name_override")?,
            active: row.get::<_, i64>("active")? != 0,
        })
    }
}

impl Agent {
    /// Construit un Agent depuis une ligne SQLite (`agents`).
    pub fn from_row(row: &rusqlite::Row) -> rusqlite::Result<Agent> {
        let capabilities: String = row.get("capabilities")?;
        let proc_state: String = row.get("proc_state")?;
        Ok(Agent {
            id: row.get("id")?,
            name: row.get("name")?,
            icon: row.get("icon")?,
            description: row.get("description")?,
            role: row.get("role")?,
            models: AgentModels {
                pi: row.get("models_pi")?,
                plh: row.get("models_plh")?,
            },
            capabilities: serde_json::from_str(&capabilities).unwrap_or_default(),
            readonly: row.get::<_, i64>("readonly")? != 0,
            keep_context: row.get::<_, i64>("keep_context")? != 0,
            max_calls_per_run: row.get::<_, i64>("max_calls_per_run")? as u32,
            call_depth: row.get::<_, i64>("call_depth")? as u32,
            project_path: row.get("project_path")?,
            loaded: row.get::<_, i64>("loaded")? != 0,
            busy: row.get::<_, i64>("busy")? != 0,
            state: AgentProcessState::from_str(&proc_state),
            visible: row.get::<_, i64>("visible")? != 0,
            last_active_at: row.get("last_active_at")?,
        })
    }
}
