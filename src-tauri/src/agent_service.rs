// agent_service.rs — Service propriétaire des agents (refonte, cahier §4.4).
//
// Phase 1 : registre persistant (table `agents`) — list/get/upsert/set_visible/
// set_state/replace. Phase 2 : propriétaire unique des sessions RPC (start/
// pause/stop/send/session_of/shutdown_all) sur un registre unique indexé par
// clé composite (project, agent). La session de l'agent standard (chat Agent
// Pi / multi-onglets) vit dans ce registre ; le pointeur `active` est la source
// de vérité de l'agent affiché. Le parking multi-projets / multi-onglets agents
// vit aussi dans ce registre (sessions marquées Parked, clé composite).

use rusqlite::params;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;
#[cfg(test)]
use std::sync::MutexGuard;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::agent::{Agent, AgentProcessState, AgentView};
use crate::db;
use crate::rpc::{agent_event_channel, make_project_activity_observer, probe_extension_support};
use crate::rpc_manager;
use crate::session_history;
use crate::{config_path, resolve_agent_home, AppState};

/// Id d'agent dédié du reviewer d'orchestration (H2 V1) dans le registre unique.
/// Distinct de l'agent `reviewer` H2 V2 (multi-rôles) pour éviter toute collision
/// de session dans la map.
pub const ORCH_REVIEWER_ID: &str = "orch-reviewer";

/// Id d'agent dédié du super-agent (Assistant 🧭) dans le registre unique.
/// Session RPC dédiée (canal `rpc-event-superagent`, extension assistant),
/// globale (multi-projets) : stockée sous un projet pseudo-global "".
/// Distinct des agents multi-rôles H2 V2.
pub const SUPERAGENT_ID: &str = "superagent";

/// Canal d'événements dédié au super-agent (isolé des canaux projet/agents).
const SUPERAGENT_CHANNEL: &str = "rpc-event-superagent";

/// Mode de démarrage d'une session : session principale (chat Agent Pi /
/// multi-onglets, canal projet) ou agent multi-rôles H2 V2 (canal
/// rpc-event-agents).
#[derive(Clone, Copy, PartialEq)]
pub enum SpawnMode {
    /// Session principale (chat Agent Pi / multi-onglets) — canal projet.
    MainSession,
    /// Agent multi-rôles H2 V2 — canal rpc-event-agents.
    AgentProcess,
}

/// État d'une session dans le registre unique de l'AgentService.
struct SessionEntry {
    session: rpc_manager::RpcSession,
    project: String,
    state: SessionState,
    mode: SpawnMode,
}

/// État logique d'une session : Active (affichée) ou Parked (en arrière-plan,
/// processus vivant). Le parking est la mécanique multi-projets/multi-onglets.
#[derive(Clone, Copy, PartialEq)]
enum SessionState {
    Active,
    Parked,
}

/// Service propriétaire des agents. Phase 1 : registre persistant (table
/// `agents`). Phase 2 : registre unique de sessions RPC, clé composite
/// `(project, agent)` — seule source de vérité des sessions (cahier §3.2, §4.4).
pub struct AgentService {
    // Phase 2 : registre unique de sessions RPC, clé composite (project, agent).
    sessions: Mutex<HashMap<String, SessionEntry>>,
    // Pointeur actif : agent_id actuellement affiché (chat Agent Pi).
    active: Mutex<Option<String>>,
    // 5.1 : handle d'application posé au setup, nécessaire pour émettre les
    // événements `agent-state-changed` depuis les transitions de session
    // (start/pause/stop) qui ne reçoivent pas `app` en paramètre.
    app: Mutex<Option<AppHandle>>,
}

impl AgentService {
    pub fn new() -> Self {
        AgentService {
            sessions: Mutex::new(HashMap::new()),
            active: Mutex::new(None),
            app: Mutex::new(None),
        }
    }

    /// 5.1 : pose le handle d'application (appelé au setup) pour permettre
    /// l'émission des événements `agent-state-changed` depuis les transitions
    /// de session (start/pause/stop).
    pub fn set_app_handle(&self, app: AppHandle) {
        *self.app.lock().unwrap() = Some(app);
    }

    /// 5.2 (cahier) : remet l'état d'exécution de TOUS les agents à « non
    /// chargé » au démarrage. `loaded`/`busy`/`proc_state` sont des états
    /// RUNTIME : les processus pi sont morts après `shutdown_all` de la session
    /// précédente, mais `loaded=true` est persisté en base. Sans ce reset, un
    /// agent `loaded=true` ne relancerait pas son processus à l'ouverture de
    /// son onglet (lazy start, `_openAgent` → `shouldStart = !agentLoaded`).
    /// Appelé au setup, avant toute restauration d'onglets.
    pub fn reset_runtime_state(&self, app: &AppHandle) -> Result<(), String> {
        let conn = db::open_conn(app)?;
        conn.execute(
            "UPDATE agents SET loaded = 0, busy = 0, proc_state = 'Unloaded'",
            [],
        )
        .map_err(|e| format!("Erreur reset_runtime_state: {}", e))?;
        Ok(())
    }

    // ── Registre (Phase 1) ──

    /// Liste les agents. `project_path` : Some → agents de ce projet ; None →
    /// agents globaux (project_path IS NULL).
    pub fn list_agents(&self, app: &AppHandle, project_path: Option<&str>) -> Result<Vec<Agent>, String> {
        let conn = db::open_conn(app)?;
        let mut stmt = conn
            .prepare(
                "SELECT * FROM agents
                 WHERE (?1 IS NULL AND project_path IS NULL)
                    OR (?1 IS NOT NULL AND project_path = ?1)
                 ORDER BY id",
            )
            .map_err(|e| format!("Erreur préparation list_agents: {}", e))?;
        let rows = stmt
            .query_map(params![project_path], |row| Agent::from_row(row))
            .map_err(|e| format!("Erreur requête list_agents: {}", e))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| format!("Erreur lecture agent: {}", e))?);
        }
        Ok(out)
    }

    /// Récupère un agent par (id, project_path).
    pub fn get_agent(&self, app: &AppHandle, agent_id: &str, project_path: Option<&str>) -> Result<Option<Agent>, String> {
        let conn = db::open_conn(app)?;
        let mut stmt = conn
            .prepare(
                "SELECT * FROM agents
                 WHERE id = ?1
                   AND ((?2 IS NULL AND project_path IS NULL) OR (?2 IS NOT NULL AND project_path = ?2))",
            )
            .map_err(|e| format!("Erreur préparation get_agent: {}", e))?;
        let mut rows = stmt
            .query_map(params![agent_id, project_path], |row| Agent::from_row(row))
            .map_err(|e| format!("Erreur requête get_agent: {}", e))?;
        match rows.next() {
            Some(Ok(a)) => Ok(Some(a)),
            Some(Err(e)) => Err(format!("Erreur lecture agent: {}", e)),
            None => Ok(None),
        }
    }

    /// Insère ou met à jour un agent. Retourne l'agent persisté.
    pub fn upsert_agent(&self, app: &AppHandle, agent: &Agent) -> Result<Agent, String> {
        let conn = db::open_conn(app)?;
        upsert_agent_conn(&conn, agent)?;
        self.get_agent(app, &agent.id, agent.project_path.as_deref())?
            .ok_or_else(|| "Agent non retrouvé après upsert".to_string())
    }

    /// Remplace l'ensemble des agents d'un scope (global ou projet) — sémantique
    /// « sauvegarde du registre complet » (remplace `save_agent_registry`).
    pub fn replace_agents(&self, app: &AppHandle, project_path: Option<&str>, agents: &[Agent]) -> Result<(), String> {
        let conn = db::open_conn(app)?;
        // Supprime les agents du scope puis réinsère.
        conn.execute(
            "DELETE FROM agents WHERE (?1 IS NULL AND project_path IS NULL) OR (?1 IS NOT NULL AND project_path = ?1)",
            params![project_path],
        )
        .map_err(|e| format!("Erreur purge replace_agents: {}", e))?;
        for a in agents {
            let mut a = a.clone();
            a.project_path = project_path.map(|s| s.to_string());
            self.upsert_agent(app, &a)?;
        }
        Ok(())
    }

    /// Liste les vues d'onglets d'un projet (table `agent_views`) — reconstruit
    /// la barre d'onglets agents à l'identique (cahier §5.2).
    pub fn list_agent_views(&self, app: &AppHandle, project_path: &str) -> Result<Vec<AgentView>, String> {
        let conn = db::open_conn(app)?;
        let mut stmt = conn
            .prepare(
                "SELECT agent_id, project_path, order_index, name_override, active
                 FROM agent_views WHERE project_path = ?1 ORDER BY order_index",
            )
            .map_err(|e| format!("Erreur préparation list_agent_views: {}", e))?;
        let rows = stmt
            .query_map(params![project_path], |row| AgentView::from_row(row))
            .map_err(|e| format!("Erreur requête list_agent_views: {}", e))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| format!("Erreur lecture agent_view: {}", e))?);
        }
        Ok(out)
    }

    /// Remplace les vues d'onglets d'un projet (sémantique « sauvegarde de la
    /// barre d'onglets agents »).
    pub fn save_agent_views(&self, app: &AppHandle, project_path: &str, views: &[AgentView]) -> Result<(), String> {
        let conn = db::open_conn(app)?;
        conn.execute("DELETE FROM agent_views WHERE project_path = ?1", params![project_path])
            .map_err(|e| format!("Erreur purge save_agent_views: {}", e))?;
        for v in views {
            conn.execute(
                "INSERT INTO agent_views (agent_id, project_path, order_index, name_override, active)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![v.agent_id, v.project_path, v.order_index, v.name_override, v.active as i64],
            )
            .map_err(|e| format!("Erreur insert save_agent_views: {}", e))?;
        }
        Ok(())
    }

    /// Pose la visibilité d'un agent (0 = invisible, 1 = vue ouverte).
    pub fn set_visible(&self, app: &AppHandle, agent_id: &str, project_path: Option<&str>, visible: bool) -> Result<(), String> {
        let conn = db::open_conn(app)?;
        let changed = conn.execute(
            "UPDATE agents SET visible = ?1
             WHERE id = ?2 AND ((?3 IS NULL AND project_path IS NULL) OR (?3 IS NOT NULL AND project_path = ?3))",
            params![visible as i64, agent_id, project_path],
        )
        .map_err(|e| format!("Erreur set_visible: {}", e))?;
        // Bug 3 : un UPDATE qui ne matche aucune ligne = agent absent → erreur
        // explicite au lieu d'un échec silencieux.
        if changed == 0 {
            return Err(format!("Agent {} introuvable (set_visible)", agent_id));
        }
        // 4.3 : notifier le frontend (super-agent.js) de la transition d'état.
        self.emit_state_changed(app, agent_id, project_path);
        Ok(())
    }

    /// Pose l'état logique (loaded/busy/proc_state) d'un agent.
    pub fn set_state(
        &self,
        app: &AppHandle,
        agent_id: &str,
        project_path: Option<&str>,
        loaded: bool,
        busy: bool,
        state: &AgentProcessState,
    ) -> Result<(), String> {
        let conn = db::open_conn(app)?;
        let changed = conn.execute(
            "UPDATE agents SET loaded = ?1, busy = ?2, proc_state = ?3
             WHERE id = ?4 AND ((?5 IS NULL AND project_path IS NULL) OR (?5 IS NOT NULL AND project_path = ?5))",
            params![loaded as i64, busy as i64, state.as_str(), agent_id, project_path],
        )
        .map_err(|e| format!("Erreur set_state: {}", e))?;
        // Bug 3 : un UPDATE qui ne matche aucune ligne = agent absent → erreur
        // explicite au lieu d'un échec silencieux.
        if changed == 0 {
            return Err(format!("Agent {} introuvable (set_state)", agent_id));
        }
        // 4.3 : notifier le frontend (super-agent.js) de la transition d'état.
        self.emit_state_changed(app, agent_id, project_path);
        Ok(())
    }

    /// 4.3 : émet l'événement `agent-state-changed` (Rust → JS) pour un agent, à
    /// partir de son état persisté. Consommé par super-agent.js pour piloter le
    /// bandeau « Arrêter » et la notification de fin de l'agent invisible (sans
    /// état local transitoire non persisté).
    fn emit_state_changed(&self, app: &AppHandle, agent_id: &str, project_path: Option<&str>) {
        if let Ok(Some(a)) = self.get_agent(app, agent_id, project_path) {
            let _ = app.emit(
                "agent-state-changed",
                serde_json::json!({
                    "agentId": a.id,
                    "projectPath": a.project_path,
                    "loaded": a.loaded,
                    "busy": a.busy,
                    "procState": a.state.as_str(),
                    "visible": a.visible,
                }),
            );
        }
    }

    // ── Sessions (Phase 2) ──

    /// Clé composite (project, agent) du registre de sessions. Le séparateur
    /// U+001F (unit separator) ne peut pas apparaître dans un chemin de projet.
    fn session_key(project: &str, agent_id: &str) -> String {
        format!("{}\u{1f}{}", project, agent_id)
    }

    /// Démarre ou reprend la session d'un agent pour un projet donné. Reprend
    /// une session parkée vivante (processus pi toujours actif) ; sinon lance un
    /// nouveau processus pi. Pose le pointeur actif sur cet agent.
    /// `mode` détermine la logique de spawn (session principale vs agent H2 V2).
    /// Retourne `true` si la session a été reprise depuis un parking (processus
    /// vivant), `false` si un nouveau processus a été lancé.
    pub fn start(
        &self,
        app: &AppHandle,
        project: &str,
        agent_id: &str,
        pi_path: &str,
        no_session: bool,
        mode: SpawnMode,
    ) -> Result<bool, String> {
        let key = Self::session_key(project, agent_id);
        // Seed : si l'agent n'existe pas en base (ex: agent `default` du chat
        // principal jamais créé automatiquement), le créer AVANT de lancer la
        // session pour que `set_state`/`set_visible` (UPDATE) fonctionnent.
        // Valeurs par défaut : name dérivé de l'id, modèles depuis la config
        // (modèle codeur), visible=true. Porté par le projet courant (Some),
        // aligné sur la scope que ciblent `set_state`/`set_visible`.
        if self.get_agent(app, agent_id, Some(project))?.is_none() {
            let state = app.state::<AppState>();
            let coder_model = {
                let config = state.config.lock().unwrap();
                if !config.coder_provider.is_empty() && !config.coder_model_id.is_empty() {
                    format!("{}/{}", config.coder_provider, config.coder_model_id)
                } else {
                    String::new()
                }
            };
            let agent = Agent {
                id: agent_id.to_string(),
                name: default_agent_name(agent_id),
                icon: String::new(),
                description: String::new(),
                role: String::new(),
                models: crate::agent::AgentModels {
                    pi: coder_model.clone(),
                    plh: coder_model,
                },
                capabilities: Vec::new(),
                readonly: false,
                keep_context: false,
                max_calls_per_run: 0,
                call_depth: 0,
                project_path: Some(project.to_string()),
                loaded: false,
                busy: false,
                state: AgentProcessState::Unloaded,
                visible: true,
                last_active_at: None,
            };
            self.upsert_agent(app, &agent)?;
        }
        let resumed = {
            let mut sessions = self.sessions.lock().unwrap();
            if let Some(entry) = sessions.get_mut(&key) {
                let alive = entry
                    .session
                    .child
                    .try_wait()
                    .map(|s| s.is_none())
                    .unwrap_or(false);
                if alive {
                    entry.state = SessionState::Active;
                    // Bug 6 : à la reprise d'une session vivante, réappliquer le
                    // mode demandé (une session parkée du chat principal peut
                    // être reprise comme agent multi-rôles et inversement).
                    entry.mode = mode;
                    true
                } else {
                    // Session morte : la retirer et en relancer une.
                    sessions.remove(&key);
                    false
                }
            } else {
                false
            }
        };
        if resumed {
            // Seule la session principale (chat Agent Pi / multi-onglets) pose le
            // pointeur actif ; les agents multi-rôles H2 V2 restent en arrière-plan.
            if mode == SpawnMode::MainSession {
                *self.active.lock().unwrap() = Some(agent_id.to_string());
            }
            // 5.1 : notifier le frontend de la transition (session reprise).
            self.set_state(app, agent_id, Some(project), true, false, &AgentProcessState::Running).ok();
            return Ok(true);
        }
        let session = match mode {
            SpawnMode::MainSession => Self::spawn_session(app, project, agent_id)?,
            SpawnMode::AgentProcess => {
                Self::spawn_agent_process(app, project, agent_id, pi_path, no_session)?
            }
        };
        {
            let mut sessions = self.sessions.lock().unwrap();
            sessions.insert(
                key,
                SessionEntry {
                    session,
                    project: project.to_string(),
                    state: SessionState::Active,
                    mode,
                },
            );
        }
        if mode == SpawnMode::MainSession {
            *self.active.lock().unwrap() = Some(agent_id.to_string());
        }
        // 5.1 : notifier le frontend de la transition (session démarrée).
        self.set_state(app, agent_id, Some(project), true, false, &AgentProcessState::Running).ok();
        Ok(false)
    }

    /// Parke la session d'un agent (état Parked, processus vivant). No-op si la
    /// session n'existe pas ou est déjà parkée. Si l'agent parké était l'agent
    /// actif (chat Agent Pi / onglet affiché), le pointeur actif est remis à
    /// None : la session n'est plus affichée, elle reste vivante en arrière-plan.
    pub fn pause(&self, project: &str, agent_id: &str) -> Result<(), String> {
        let key = Self::session_key(project, agent_id);
        {
            let mut sessions = self.sessions.lock().unwrap();
            if let Some(entry) = sessions.get_mut(&key) {
                entry.state = SessionState::Parked;
            }
        }
        let mut active = self.active.lock().unwrap();
        if active.as_deref() == Some(agent_id) {
            *active = None;
        }
        // 5.1 : notifier le frontend de la transition (session parkée).
        if let Some(app) = self.app.lock().unwrap().clone() {
            self.set_state(&app, agent_id, Some(project), true, false, &AgentProcessState::Paused).ok();
        }
        Ok(())
    }

    /// Arrête la session d'un agent (état Stopped) et tue le processus pi.
    pub fn stop(&self, project: &str, agent_id: &str) -> Result<(), String> {
        let key = Self::session_key(project, agent_id);
        {
            let mut sessions = self.sessions.lock().unwrap();
            if let Some(mut entry) = sessions.remove(&key) {
                rpc_manager::stop_session(&mut entry.session);
            }
        }
        // Si l'agent arrêté était l'agent actif, réinitialiser le pointeur.
        let mut active = self.active.lock().unwrap();
        if active.as_deref() == Some(agent_id) {
            *active = None;
        }
        // 5.1 : notifier le frontend de la transition (session arrêtée).
        if let Some(app) = self.app.lock().unwrap().clone() {
            self.set_state(&app, agent_id, Some(project), false, false, &AgentProcessState::Stopped).ok();
        }
        Ok(())
    }

    /// Route une commande vers la session d'un agent (une seule indirection).
    pub fn send(&self, project: &str, agent_id: &str, command: Value) -> Result<(), String> {
        let key = Self::session_key(project, agent_id);
        let mut sessions = self.sessions.lock().unwrap();
        let entry = sessions
            .get_mut(&key)
            .ok_or_else(|| format!("Aucune session pour l'agent {} (projet {})", agent_id, project))?;
        rpc_manager::send_command(&mut entry.session, &command)
    }

    /// Route une commande synchrone (attend la réponse) vers la session d'un agent.
    pub fn send_sync(&self, project: &str, agent_id: &str, command: Value) -> Result<Value, String> {
        let key = Self::session_key(project, agent_id);
        let mut sessions = self.sessions.lock().unwrap();
        let entry = sessions
            .get_mut(&key)
            .ok_or_else(|| format!("Aucune session pour l'agent {} (projet {})", agent_id, project))?;
        rpc_manager::send_command_sync(&mut entry.session, command)
    }

    /// Route une commande synchrone avec timeout vers la session d'un agent.
    pub fn send_sync_timeout(
        &self,
        project: &str,
        agent_id: &str,
        command: Value,
        timeout_secs: u64,
    ) -> Result<Value, String> {
        let key = Self::session_key(project, agent_id);
        let mut sessions = self.sessions.lock().unwrap();
        let entry = sessions
            .get_mut(&key)
            .ok_or_else(|| format!("Aucune session pour l'agent {} (projet {})", agent_id, project))?;
        rpc_manager::send_command_sync_timeout(&mut entry.session, command, timeout_secs)
    }

    /// Accès (lecture) au registre de sessions pour un agent donné. Retourne le
    /// garde du registre si la session existe, pour permettre les commandes
    /// synchrones (get_state, set_model, ...) via `guard.get_mut(&key)`.
    #[cfg(test)]
    fn session_of(
        &self,
        project: &str,
        agent_id: &str,
    ) -> Result<MutexGuard<'_, HashMap<String, SessionEntry>>, String> {
        let key = Self::session_key(project, agent_id);
        let guard = self.sessions.lock().unwrap();
        if !guard.contains_key(&key) {
            return Err(format!("Aucune session pour l'agent {} (projet {})", agent_id, project));
        }
        Ok(guard)
    }

    // ── Session active (chat Agent Pi / multi-onglets) ──

    /// Id de l'agent actuellement affiché (source de vérité du pointeur actif).
    pub fn active_agent(&self) -> Option<String> {
        self.active.lock().unwrap().clone()
    }

    /// Exécute une closure sur la session active (agent affiché). Retourne
    /// `Err` si aucune session active n'existe pour le projet donné.
    pub fn with_active_session<R>(
        &self,
        project: &str,
        f: impl FnOnce(&mut rpc_manager::RpcSession) -> R,
    ) -> Result<R, String> {
        let agent_id = self
            .active
            .lock()
            .unwrap()
            .clone()
            .ok_or("Aucune session agent active")?;
        let key = Self::session_key(project, &agent_id);
        let mut guard = self.sessions.lock().unwrap();
        let entry = guard
            .get_mut(&key)
            .ok_or("Aucune session agent active")?;
        Ok(f(&mut entry.session))
    }

    /// Arrête toutes les sessions (actives et parkées) d'un projet donné.
    /// Utilisé à la fermeture d'un projet (`close_project`) : les sessions
    /// parkées de ce projet vivent dans le registre unique (clé composite
    /// (projet, agent)) et doivent être tuées pour éviter toute fuite
    /// de processus pi.
    pub fn stop_project_sessions(&self, project: &str) {
        let mut sessions = self.sessions.lock().unwrap();
        let keys: Vec<String> = sessions
            .iter()
            .filter(|(_, e)| e.project == project)
            .map(|(k, _)| k.clone())
            .collect();
        for k in keys {
            if let Some(mut entry) = sessions.remove(&k) {
                rpc_manager::stop_session(&mut entry.session);
            }
        }
    }

    /// Arrête toutes les sessions d'agents multi-rôles H2 V2 (tous projets).
    /// Utilisé par `stop_all_agent_processes` et à l'arrêt de l'app.
    pub fn stop_all_agent_processes(&self) {
        let mut sessions = self.sessions.lock().unwrap();
        let keys: Vec<String> = sessions
            .iter()
            .filter(|(_, e)| e.mode == SpawnMode::AgentProcess)
            .map(|(k, _)| k.clone())
            .collect();
        for k in keys {
            if let Some(mut entry) = sessions.remove(&k) {
                rpc_manager::stop_session(&mut entry.session);
            }
        }
    }

    /// Arrêt complet de toutes les sessions (issue #14). À la fermeture de Pilot.
    pub fn shutdown_all(&self) {
        {
            let mut sessions = self.sessions.lock().unwrap();
            for (_, mut entry) in sessions.drain() {
                rpc_manager::stop_session(&mut entry.session);
            }
        }
        *self.active.lock().unwrap() = None;
    }

    /// Vue d'ensemble de TOUTES les sessions d'agents du registre (P2).
    /// Retourne une liste JSON avec, pour chaque session : projet, agent, mode
    /// (main/agent_process), état (active/parked), vivacité du processus,
    /// visibilité (table agents) et pointeur actif (chat principal).
    /// Consommé par l'assistant (super-agent) via l'outil `list_agent_sessions`
    /// pour superviser l'état des agents.
    pub fn list_agent_sessions(&self, app: &AppHandle) -> Result<Value, String> {
        let active = self.active.lock().unwrap().clone();
        // Collecte sous le verrou, puis libération avant les accès DB (visible).
        let raw = {
            let mut sessions = self.sessions.lock().unwrap();
            collect_session_states(&mut sessions, &active)
        };
        let mut out = Vec::new();
        for (project, agent_id, state, mode, alive, is_active) in raw {
            // Visibilité depuis la table agents (projet porté par la session).
            let visible = self
                .get_agent(app, &agent_id, Some(&project))
                .ok()
                .flatten()
                .map(|a| a.visible)
                .unwrap_or(false);
            out.push(serde_json::json!({
                "project": project,
                "agent": agent_id,
                "mode": mode,
                "state": state,
                "alive": alive,
                "visible": visible,
                "active": is_active,
            }));
        }
        Ok(serde_json::json!({ "sessions": out }))
    }

    // ── Reviewer d'orchestration (H2 V1) ──
    // Session dédiée `pi --mode rpc --no-session` (contexte vierge, jetable),
    // canal séparé `rpc-event-reviewer`, pas de skill/extension (lecture seule).
    // Stockée dans le registre unique sous l'id `orch-reviewer` (conflit n°2).

    /// Démarre (ou reprend) la session reviewer pour un projet. Idempotent :
    /// ne relance pas si une session reviewer vivante existe déjà.
    pub fn start_reviewer(&self, app: &AppHandle, project: &str, pi_path: &str) -> Result<(), String> {
        let key = Self::session_key(project, ORCH_REVIEWER_ID);
        {
            let mut sessions = self.sessions.lock().unwrap();
            if let Some(entry) = sessions.get_mut(&key) {
                let alive = entry
                    .session
                    .child
                    .try_wait()
                    .map(|s| s.is_none())
                    .unwrap_or(false);
                if alive {
                    return Ok(()); // déjà lancé (idempotent)
                }
                sessions.remove(&key);
            }
        }
        let state = app.state::<AppState>();
        let session = rpc_manager::spawn_and_start(
            project,
            pi_path,
            true, // no_session : contexte vierge, jetable
            "",
            None,
            Vec::new(),
            app.clone(),
            state.event_tx.clone(),
            "rpc-event-reviewer",
            None,
            None,
            None,
        )
        .map_err(|e| format!("Erreur lancement du reviewer : {}", e))?;
        {
            let mut sessions = self.sessions.lock().unwrap();
            sessions.insert(
                key,
                SessionEntry {
                    session,
                    project: project.to_string(),
                    state: SessionState::Active,
                    mode: SpawnMode::MainSession,
                },
            );
        }
        // Démarrer une nouvelle session (contexte vierge).
        let cmd = serde_json::json!({ "type": "new_session" });
        self.send_sync(project, ORCH_REVIEWER_ID, cmd).ok();
        Ok(())
    }

    /// Arrête la session reviewer d'un projet (état Stopped, processus tué).
    pub fn stop_reviewer(&self, project: &str) {
        let _ = self.stop(project, ORCH_REVIEWER_ID);
    }

    /// Envoie une commande asynchrone à la session reviewer.
    pub fn send_reviewer(&self, project: &str, command: Value) -> Result<(), String> {
        self.send(project, ORCH_REVIEWER_ID, command)
    }

    /// Envoie une commande synchrone à la session reviewer.
    pub fn send_reviewer_sync(&self, project: &str, command: Value) -> Result<Value, String> {
        self.send_sync(project, ORCH_REVIEWER_ID, command)
    }

    /// Envoie une commande synchrone avec timeout à la session reviewer.
    pub fn send_reviewer_sync_timeout(
        &self,
        project: &str,
        command: Value,
        timeout_secs: u64,
    ) -> Result<Value, String> {
        self.send_sync_timeout(project, ORCH_REVIEWER_ID, command, timeout_secs)
    }

    // ── Super-agent (Assistant 🧭) ──
    // Session RPC dédiée (canal `rpc-event-superagent`, extension assistant),
    // globale (multi-projets), `--no-session` + modèle par défaut. Stockée dans
    // le registre unique sous l'id `superagent` avec un projet pseudo-global ""
    // (non lié à un projet → insensible à la fermeture de projet).

    /// Démarre (lazy) la session du super-agent. Idempotent : ne relance pas si
    /// une session vivante existe déjà. `cwd` = projet courant (context de la
    /// conversation), `pi_path` = backend actif, `default_model` = (provider,
    /// model_id) résolu depuis le registre global pour répondre au 1er prompt.
    pub fn start_superagent(
        &self,
        app: &AppHandle,
        cwd: &str,
        pi_path: &str,
        default_model: Option<(String, String)>,
    ) -> Result<(), String> {
        let key = Self::session_key("", SUPERAGENT_ID);
        {
            let mut sessions = self.sessions.lock().unwrap();
            if let Some(entry) = sessions.get_mut(&key) {
                let alive = entry
                    .session
                    .child
                    .try_wait()
                    .map(|s| s.is_none())
                    .unwrap_or(false);
                if alive {
                    return Ok(()); // déjà lancé (idempotent)
                }
                sessions.remove(&key);
            }
        }
        let session = Self::spawn_superagent_session(app, cwd, pi_path)?;
        {
            let mut sessions = self.sessions.lock().unwrap();
            sessions.insert(
                key,
                SessionEntry {
                    session,
                    project: String::new(),
                    state: SessionState::Active,
                    mode: SpawnMode::MainSession,
                },
            );
        }
        // Démarrer une nouvelle session (contexte vierge) puis appliquer le
        // modèle par défaut (registre global) pour répondre au 1er prompt.
        let cmd = serde_json::json!({ "type": "new_session" });
        self.send_superagent_sync(cmd).ok();
        if let Some((provider, model_id)) = default_model {
            let cmd = serde_json::json!({ "type": "set_model", "provider": provider, "modelId": model_id });
            self.send_superagent_sync(cmd).ok();
        }
        Ok(())
    }

    /// Arrête la session du super-agent (état Stopped, processus tué).
    pub fn stop_superagent(&self) -> Result<(), String> {
        self.stop("", SUPERAGENT_ID)
    }

    /// Indique si la session du super-agent est vivante (déjà lancée).
    pub fn superagent_alive(&self) -> bool {
        let key = Self::session_key("", SUPERAGENT_ID);
        let mut sessions = self.sessions.lock().unwrap();
        match sessions.get_mut(&key) {
            Some(e) => e
                .session
                .child
                .try_wait()
                .map(|s| s.is_none())
                .unwrap_or(false),
            None => false,
        }
    }

    /// Route une commande asynchrone vers la session du super-agent.
    pub fn send_superagent(&self, command: Value) -> Result<(), String> {
        self.send("", SUPERAGENT_ID, command)
    }

    /// Route une commande synchrone vers la session du super-agent.
    pub fn send_superagent_sync(&self, command: Value) -> Result<Value, String> {
        self.send_sync("", SUPERAGENT_ID, command)
    }

    /// Route une commande synchrone avec timeout vers la session du super-agent.
    pub fn send_superagent_sync_timeout(
        &self,
        command: Value,
        timeout_secs: u64,
    ) -> Result<Value, String> {
        self.send_sync_timeout("", SUPERAGENT_ID, command, timeout_secs)
    }

    /// Lance un nouveau processus pi --mode rpc pour le super-agent (Assistant
    /// 🧭). Canal dédié `rpc-event-superagent`, `--no-session`, pas de skill,
    /// extensions assistant (pilot-assistant-files lecture seule, pilot-choices,
    /// pilot-assistant-actions, pilot-assistant-db, pilot-assistant-prompt,
    /// pilot-assistant-sessions).
    /// Reproduit l'ancien `do_start_super_agent_session` (super_agent.rs).
    fn spawn_superagent_session(
        app: &AppHandle,
        cwd: &str,
        pi_path: &str,
    ) -> Result<rpc_manager::RpcSession, String> {
        let state = app.state::<AppState>();
        let mut extensions: Vec<String> = Vec::new();
        if probe_extension_support(&state, pi_path) {
            if let Ok(data_dir) = app.path().app_data_dir() {
                let dir = data_dir.join("extensions");
                if std::fs::create_dir_all(&dir).is_ok() {
                    let files = dir.join("pilot-assistant-files.ts");
                    if std::fs::write(&files, include_str!("../extensions/pilot-assistant-files.ts")).is_ok() {
                        extensions.push(files.to_string_lossy().to_string());
                    }
                    let choices = dir.join("pilot-choices.ts");
                    if std::fs::write(&choices, include_str!("../extensions/pilot-choices.ts")).is_ok() {
                        extensions.push(choices.to_string_lossy().to_string());
                    }
                    let actions = dir.join("pilot-assistant-actions.ts");
                    if std::fs::write(&actions, include_str!("../extensions/pilot-assistant-actions.ts")).is_ok() {
                        extensions.push(actions.to_string_lossy().to_string());
                    }
                    let db = dir.join("pilot-assistant-db.ts");
                    if std::fs::write(&db, include_str!("../extensions/pilot-assistant-db.ts")).is_ok() {
                        extensions.push(db.to_string_lossy().to_string());
                    }
                    let prompt = dir.join("pilot-assistant-prompt.ts");
                    if std::fs::write(&prompt, include_str!("../extensions/pilot-assistant-prompt.ts")).is_ok() {
                        extensions.push(prompt.to_string_lossy().to_string());
                    }
                    let sessions = dir.join("pilot-assistant-sessions.ts");
                    if std::fs::write(&sessions, include_str!("../extensions/pilot-assistant-sessions.ts")).is_ok() {
                        extensions.push(sessions.to_string_lossy().to_string());
                    }
                }
            }
        }
        let session = rpc_manager::spawn_and_start(
            cwd,
            pi_path,
            true, // no_session : contexte vierge, jetable
            "",
            None,
            extensions,
            app.clone(),
            state.event_tx.clone(),
            SUPERAGENT_CHANNEL,
            None,
            None,
            Some(SUPERAGENT_ID.to_string()),
        )
        .map_err(|e| format!("Erreur lancement du super-agent : {}", e))?;
        Ok(session)
    }

    /// Lance un nouveau processus pi --mode rpc pour un agent multi-rôles H2 V2.
    /// Reproduit la logique de `do_start_agent_process` (canal rpc-event-agents,
    /// pas d'extensions ni de skill, dossier de session dédié par agent).
    fn spawn_agent_process(
        app: &AppHandle,
        project: &str,
        agent_id: &str,
        pi_path: &str,
        no_session: bool,
    ) -> Result<rpc_manager::RpcSession, String> {
        let state = app.state::<AppState>();
        let session_dir_resolved = if let Ok(cfg_path) = config_path(app) {
            cfg_path
                .with_file_name("agent")
                .join("sessions")
                .join(agent_id.replace(|c: char| !c.is_alphanumeric(), "_"))
        } else {
            pilot_user_dir()?
                .join("agent")
                .join("sessions")
                .join(agent_id.replace(|c: char| !c.is_alphanumeric(), "_"))
        };
        let session_dir_str = session_dir_resolved.to_string_lossy().to_string();
        let session = rpc_manager::spawn_and_start(
            project,
            pi_path,
            no_session,
            &session_dir_str,
            None,
            Vec::new(),
            app.clone(),
            state.event_tx.clone(),
            "rpc-event-agents",
            Some(agent_id),
            None,
            None,
        )
        .map_err(|e| format!("Erreur lancement agent {} : {}", agent_id, e))?;
        Ok(session)
    }

    /// Lance un nouveau processus pi --mode rpc pour un agent d'un projet.
    /// Reproduit la logique de démarrage de la session principale (config,
    /// dossier de session, skill quality-gate, extensions pi, canal projet).
    fn spawn_session(app: &AppHandle, project: &str, agent_id: &str) -> Result<rpc_manager::RpcSession, String> {
        let state = app.state::<AppState>();
        let (pi_path, no_session, session_dir, qg_enabled, confirm_file_edits) = {
            let config = state.config.lock().unwrap();
            (
                config.rpc_pi_path.clone(),
                config.rpc_no_session,
                config.rpc_session_dir.clone(),
                config.quality_gate_enabled,
                config.confirm_file_edits,
            )
        };

        // Dossier de session : sous-dossier projet + sous-dossier agent.
        let mut session_dir_resolved = if session_dir.is_empty() {
            resolve_agent_home(&pi_path)?
                .join("agent")
                .join("sessions")
                .join(session_history::project_to_session_folder(project))
        } else {
            std::path::PathBuf::from(&session_dir)
                .join(session_history::project_to_session_folder(project))
        };
        if agent_id != crate::rpc::DEFAULT_AGENT_ID {
            session_dir_resolved = session_dir_resolved.join(agent_id);
        }
        let session_dir_str = session_dir_resolved.to_string_lossy().to_string();

        // Skill quality-gate (Évolution 7).
        let skill_path: Option<String> = if qg_enabled {
            if let Ok(data_dir) = app.path().app_data_dir() {
                let skill_file = data_dir.join("skills").join("quality-gate").join("SKILL.md");
                if std::fs::create_dir_all(skill_file.parent().unwrap_or(&data_dir)).is_ok() {
                    let content: &str = include_str!("../skills/quality-gate/SKILL.md");
                    if std::fs::write(&skill_file, content).is_ok() {
                        Some(skill_file.to_string_lossy().to_string())
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        };

        // Extensions pi (porte pré-écriture, contexte, choix).
        let ext_supported = probe_extension_support(&state, &pi_path);
        let mut extensions: Vec<String> = Vec::new();
        if ext_supported {
            if let Ok(data_dir) = app.path().app_data_dir() {
                let dir = data_dir.join("extensions");
                if std::fs::create_dir_all(&dir).is_ok() {
                    if confirm_file_edits {
                        let ext_file = dir.join("pilot-edit-gate.ts");
                        if std::fs::write(&ext_file, include_str!("../extensions/pilot-edit-gate.ts")).is_ok() {
                            extensions.push(ext_file.to_string_lossy().to_string());
                        }
                    }
                    let ctx_file = dir.join("pilot-context.ts");
                    if std::fs::write(&ctx_file, include_str!("../extensions/pilot-context.ts")).is_ok() {
                        extensions.push(ctx_file.to_string_lossy().to_string());
                    }
                    let choices_file = dir.join("pilot-choices.ts");
                    if std::fs::write(&choices_file, include_str!("../extensions/pilot-choices.ts")).is_ok() {
                        extensions.push(choices_file.to_string_lossy().to_string());
                    }
                }
            }
        }

        let channel = agent_event_channel(project, agent_id);
        let mut session = rpc_manager::spawn_and_start(
            project,
            &pi_path,
            no_session,
            &session_dir_str,
            skill_path.as_deref(),
            extensions,
            app.clone(),
            state.event_tx.clone(),
            &channel,
            None,
            // Issue #13 : observateur d'activité → map par projet (agent_start/settled).
            Some(make_project_activity_observer(&state.agent_activity, project)),
            None,
        )
        .map_err(|e| {
            if pi_path.is_empty() {
                format!("{}. Installez pi (https://pi.dev) ou configurez le chemin dans les paramètres.", e)
            } else {
                format!("{}. Vérifiez le chemin dans les paramètres (Gestion RPC).", e)
            }
        })?;

        // Démarrer une nouvelle session (contexte vierge).
        let cmd = serde_json::json!({"type": "new_session"});
        rpc_manager::send_command_sync(&mut session, cmd).ok();
        Ok(session)
    }
}

/// Dérive un nom d'agent lisible depuis son id (ex: "default" → "Default",
/// "orch-reviewer" → "Orch reviewer"). Utilisé au seed d'un agent absent en
/// base (Bug principal).
fn default_agent_name(id: &str) -> String {
    let human = id.replace(['-', '_'], " ");
    let mut chars = human.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::from("Agent"),
    }
}

/// Extrait l'état brut de toutes les sessions du registre (P2) — pur, sans
/// accès DB (testable). Retourne pour chaque session : (projet, agent, état,
/// mode, vivacité, actif). La clé composite est "project\u{1f}agent".
fn collect_session_states(
    sessions: &mut HashMap<String, SessionEntry>,
    active: &Option<String>,
) -> Vec<(String, String, String, String, bool, bool)> {
    sessions
        .iter_mut()
        .map(|(key, entry)| {
            let mut parts = key.splitn(2, '\u{1f}');
            let project = parts.next().unwrap_or("").to_string();
            let agent_id = parts.next().unwrap_or("").to_string();
            let alive = entry
                .session
                .child
                .try_wait()
                .map(|s| s.is_none())
                .unwrap_or(false);
            let state = match entry.state {
                SessionState::Active => "active",
                SessionState::Parked => "parked",
            };
            let mode = match entry.mode {
                SpawnMode::MainSession => "main",
                SpawnMode::AgentProcess => "agent_process",
            };
            let is_active = entry.mode == SpawnMode::MainSession
                && active.as_deref() == Some(agent_id.as_str());
            (project, agent_id, state.to_string(), mode.to_string(), alive, is_active)
        })
        .collect()
}

/// Insère ou met à jour un agent dans la connexion donnée (P4).
///
/// Bug de persistance : `UNIQUE(id, project_path)` traite les NULL comme
/// distincts en SQLite → pour un agent global (project_path = NULL), le
/// `ON CONFLICT(id, project_path)` ne se déclenche JAMAIS et on insérerait un
/// doublon à chaque upsert (écriture en mémoire mais pas de vraie mise à jour
/// sur disque). On gère donc le cas global explicitement (check-then-update/
/// insert) pour rendre l'upsert idempotent. Les agents de projet (project_path
/// non-NULL) gardent le `ON CONFLICT` natif.
fn upsert_agent_conn(conn: &rusqlite::Connection, agent: &Agent) -> Result<(), String> {
    let capabilities = serde_json::to_string(&agent.capabilities)
        .map_err(|e| format!("Erreur sérialisation capabilities: {}", e))?;
    if agent.project_path.is_none() {
        let exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM agents WHERE id = ?1 AND project_path IS NULL)",
                params![agent.id],
                |row| row.get(0),
            )
            .map_err(|e| format!("Erreur vérification upsert_agent: {}", e))?;
        if exists {
            conn.execute(
                "UPDATE agents SET name=?1, icon=?2, description=?3, role=?4,
                 models_pi=?5, models_plh=?6, capabilities=?7, readonly=?8,
                 keep_context=?9, max_calls_per_run=?10, call_depth=?11,
                 loaded=?12, busy=?13, proc_state=?14, visible=?15, last_active_at=?16
                 WHERE id=?17 AND project_path IS NULL",
                params![
                    agent.name, agent.icon, agent.description, agent.role,
                    agent.models.pi, agent.models.plh, capabilities,
                    agent.readonly as i64, agent.keep_context as i64,
                    agent.max_calls_per_run as i64, agent.call_depth as i64,
                    agent.loaded as i64, agent.busy as i64, agent.state.as_str(),
                    agent.visible as i64, agent.last_active_at, agent.id
                ],
            )
            .map_err(|e| format!("Erreur update upsert_agent: {}", e))?;
        } else {
            conn.execute(
                "INSERT INTO agents (
                    id, project_path, name, icon, description, role,
                    models_pi, models_plh, capabilities, readonly, keep_context,
                    max_calls_per_run, call_depth, loaded, busy, proc_state, visible, last_active_at
                 ) VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
                params![
                    agent.id, agent.name, agent.icon, agent.description, agent.role,
                    agent.models.pi, agent.models.plh, capabilities,
                    agent.readonly as i64, agent.keep_context as i64,
                    agent.max_calls_per_run as i64, agent.call_depth as i64,
                    agent.loaded as i64, agent.busy as i64, agent.state.as_str(),
                    agent.visible as i64, agent.last_active_at
                ],
            )
            .map_err(|e| format!("Erreur insert upsert_agent: {}", e))?;
        }
    } else {
        conn.execute(
            "INSERT INTO agents (
                id, project_path, name, icon, description, role,
                models_pi, models_plh, capabilities, readonly, keep_context,
                max_calls_per_run, call_depth, loaded, busy, proc_state, visible, last_active_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
             ON CONFLICT(id, project_path) DO UPDATE SET
                name=excluded.name, icon=excluded.icon, description=excluded.description,
                role=excluded.role, models_pi=excluded.models_pi, models_plh=excluded.models_plh,
                capabilities=excluded.capabilities, readonly=excluded.readonly,
                keep_context=excluded.keep_context, max_calls_per_run=excluded.max_calls_per_run,
                call_depth=excluded.call_depth, loaded=excluded.loaded, busy=excluded.busy,
                proc_state=excluded.proc_state, visible=excluded.visible, last_active_at=excluded.last_active_at",
            params![
                agent.id, agent.project_path, agent.name, agent.icon, agent.description, agent.role,
                agent.models.pi, agent.models.plh, capabilities,
                agent.readonly as i64, agent.keep_context as i64,
                agent.max_calls_per_run as i64, agent.call_depth as i64,
                agent.loaded as i64, agent.busy as i64, agent.state.as_str(),
                agent.visible as i64, agent.last_active_at
            ],
        )
        .map_err(|e| format!("Erreur upsert_agent: {}", e))?;
    }
    Ok(())
}

/// Dossier utilisateur Pilot (`~/.pilot`). Utilisé pour le dossier de session
/// des agents multi-rôles H2 V2 quand le chemin de config n'est pas résoluble.
fn pilot_user_dir() -> Result<std::path::PathBuf, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "Impossible de trouver le home dir".to_string())?;
    Ok(std::path::PathBuf::from(home).join(".pilot"))
}

// ── Conversion Value ↔ Agent (IPC) ──

/// Désérialise un Agent depuis une Value JSON (champs camelCase du frontend).
fn agent_from_value(v: &Value) -> Result<Agent, String> {
    serde_json::from_value::<Agent>(v.clone())
        .map_err(|e| format!("Agent invalide: {}", e))
}

/// Sérialise un Agent en Value JSON.
fn agent_to_value(a: &Agent) -> Value {
    serde_json::to_value(a).unwrap_or(Value::Null)
}

// ── Commandes IPC (Phase 1) ──

/// Liste les agents (globaux ou d'un projet). Retourne `{ agents: [...] }`.
#[tauri::command]
pub fn list_agents(state: State<AppState>, app: AppHandle, project_path: Option<String>) -> Result<Value, String> {
    let proj = project_path.filter(|p| !p.trim().is_empty());
    let agents = state
        .agent_service
        .list_agents(&app, proj.as_deref())?;
    let list: Vec<Value> = agents.iter().map(agent_to_value).collect();
    Ok(serde_json::json!({ "agents": list }))
}

/// Récupère un agent par (id, project_path).
#[tauri::command]
pub fn get_agent(state: State<AppState>, app: AppHandle, agent_id: String, project_path: Option<String>) -> Result<Value, String> {
    let proj = project_path.filter(|p| !p.trim().is_empty());
    match state.agent_service.get_agent(&app, &agent_id, proj.as_deref())? {
        Some(a) => Ok(agent_to_value(&a)),
        None => Err(format!("Agent {} introuvable", agent_id)),
    }
}

/// Insère ou met à jour un agent. Retourne l'agent persisté.
#[tauri::command]
pub fn upsert_agent(state: State<AppState>, app: AppHandle, agent: Value) -> Result<Value, String> {
    let a = agent_from_value(&agent)?;
    let saved = state.agent_service.upsert_agent(&app, &a)?;
    Ok(agent_to_value(&saved))
}

/// Remplace l'ensemble des agents d'un scope (sémantique « sauvegarde registre »).
#[tauri::command]
pub fn replace_agents(state: State<AppState>, app: AppHandle, project_path: Option<String>, agents: Vec<Value>) -> Result<(), String> {
    let proj = project_path.filter(|p| !p.trim().is_empty());
    let mut list = Vec::new();
    for v in agents {
        list.push(agent_from_value(&v)?);
    }
    state.agent_service.replace_agents(&app, proj.as_deref(), &list)
}

/// Pose la visibilité d'un agent (0 = invisible, 1 = vue ouverte).
#[tauri::command]
pub fn set_agent_visible(state: State<AppState>, app: AppHandle, agent_id: String, project_path: Option<String>, visible: bool) -> Result<(), String> {
    let proj = project_path.filter(|p| !p.trim().is_empty());
    state.agent_service.set_visible(&app, &agent_id, proj.as_deref(), visible)
}

/// Pose l'état logique (loaded/busy/proc_state) d'un agent.
#[tauri::command]
pub fn set_agent_state(
    state: State<AppState>,
    app: AppHandle,
    agent_id: String,
    project_path: Option<String>,
    loaded: bool,
    busy: bool,
    proc_state: String,
) -> Result<(), String> {
    let proj = project_path.filter(|p| !p.trim().is_empty());
    let st = AgentProcessState::from_str(&proc_state);
    state.agent_service.set_state(&app, &agent_id, proj.as_deref(), loaded, busy, &st)
}

/// Liste les vues d'onglets d'un projet (reconstruit la barre d'onglets agents).
#[tauri::command]
pub fn list_agent_views(state: State<AppState>, app: AppHandle, project_path: String) -> Result<Vec<AgentView>, String> {
    state.agent_service.list_agent_views(&app, &project_path)
}

/// Sauvegarde les vues d'onglets d'un projet (remplace).
#[tauri::command]
pub fn save_agent_views(state: State<AppState>, app: AppHandle, project_path: String, views: Vec<AgentView>) -> Result<(), String> {
    state.agent_service.save_agent_views(&app, &project_path, &views)
}

/// Vue d'ensemble de toutes les sessions d'agents (P2). Retourne la liste des
/// sessions avec projet, agent, mode, état, vivacité, visibilité et pointeur
/// actif. Exposé comme outil pour l'assistant (super-agent) via l'extension
/// pilot-assistant-sessions.
#[tauri::command]
pub fn list_agent_sessions(state: State<AppState>, app: AppHandle) -> Result<Value, String> {
    state.agent_service.list_agent_sessions(&app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_key_is_composite_and_unique() {
        // Deux projets différents avec le même agent → clés différentes.
        let a = AgentService::session_key("/proj/A", "codeur");
        let b = AgentService::session_key("/proj/B", "codeur");
        assert_ne!(a, b);
        // Même (projet, agent) → même clé (déterministe).
        let a2 = AgentService::session_key("/proj/A", "codeur");
        assert_eq!(a, a2);
        // Deux agents du même projet → clés différentes.
        let c = AgentService::session_key("/proj/A", "reviewer");
        assert_ne!(a, c);
        // Le séparateur U+001F (unit separator) ne peut pas apparaître dans un
        // chemin de projet : il garantit l'absence de collision entre projets.
        assert!(a.contains('\u{1f}'));
        assert!(!a.contains("\\u{1f}"));
    }

    /// Construit une fausse session RPC vivante (processus enfant inoffensif qui
    /// reste en vie le temps du test) pour exercer la sémantique du registre sans
    /// lancer un vrai pi.
    fn fake_session() -> rpc_manager::RpcSession {
        use std::process::{Command, Stdio};
        use std::sync::atomic::AtomicBool;
        use std::sync::Arc;
        let mut cmd = Command::new(if cfg!(windows) { "cmd" } else { "sleep" });
        if cfg!(windows) {
            cmd.args(["/c", "ping 127.0.0.1 -n 20 >nul"]);
        } else {
            cmd.arg("20");
        }
        let mut child = cmd
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn fake session child");
        let stdin = child.stdin.take().expect("fake stdin");
        rpc_manager::RpcSession {
            child,
            stdin,
            running: Arc::new(AtomicBool::new(true)),
            pending: Arc::new(std::sync::Mutex::new(HashMap::new())),
        }
    }

    /// Scénario multi-projets A→B→A. Le parking vit dans le registre unique de
    /// l'AgentService (clé composite (projet, agent)). On vérifie que `pause`
    /// garde la session parkée dans le registre, que fermer un projet ne tue que
    /// ses propres sessions (pas de fuite croisée A/B) et que l'arrêt complet
    /// purgera tout.
    #[test]
    fn parking_multi_projects_lives_in_register_and_is_project_scoped() {
        let svc = AgentService::new();
        let proj_a = "/p/A";
        let proj_b = "/p/B";
        let key_a = AgentService::session_key(proj_a, "default");
        let key_b = AgentService::session_key(proj_b, "default");

        // Deux sessions parkées : une par projet (simule A→B, où la session de A
        // a été parkée dans le registre unique).
        {
            let mut sessions = svc.sessions.lock().unwrap();
            sessions.insert(
                key_a.clone(),
                SessionEntry {
                    session: fake_session(),
                    project: proj_a.to_string(),
                    state: SessionState::Parked,
                    mode: SpawnMode::MainSession,
                },
            );
            sessions.insert(
                key_b.clone(),
                SessionEntry {
                    session: fake_session(),
                    project: proj_b.to_string(),
                    state: SessionState::Parked,
                    mode: SpawnMode::MainSession,
                },
            );
        }
        // L'agent de A est affiché → on le parke : il reste dans le registre
        // (récupérable) et le pointeur actif est remis à None (plus rien affiché).
        *svc.active.lock().unwrap() = Some("default".to_string());
        svc.pause(proj_a, "default").unwrap();
        assert!(svc.session_of(proj_a, "default").is_ok(), "session A doit rester parkée dans le registre");
        assert_eq!(svc.active_agent(), None, "parking de l'agent affiché → pointeur actif à None");

        // Fermer le projet A : seules ses sessions sont tuées/retirées ; celle de
        // B (autre projet) reste vivante → aucun orphelin croisé.
        svc.stop_project_sessions(proj_a);
        assert!(svc.session_of(proj_a, "default").is_err(), "session A retirée à la fermeture du projet A");
        assert!(svc.session_of(proj_b, "default").is_ok(), "session B intacte (autre projet)");

        // Arrêt complet (fermeture app, issue #14) : tout est purgé.
        svc.shutdown_all();
        assert!(svc.session_of(proj_b, "default").is_err(), "tout est purgé à l'arrêt complet");
        assert_eq!(svc.active_agent(), None);
    }

    /// La session du super-agent (Assistant 🧭) vit dans le registre
    /// unique sous l'id `superagent` avec un projet pseudo-global "". Elle doit
    /// être insensible à la fermeture de projet (pas liée à un projet) et au
    /// `stop_all_agent_processes` (pas un agent multi-rôles H2 V2), tout en étant
    /// arrêtée par `stop_superagent` et l'arrêt complet `shutdown_all`.
    #[test]
    fn superagent_session_is_global_and_isolated() {
        let svc = AgentService::new();
        let key = AgentService::session_key("", SUPERAGENT_ID);
        {
            let mut sessions = svc.sessions.lock().unwrap();
            sessions.insert(
                key.clone(),
                SessionEntry {
                    session: fake_session(),
                    project: String::new(),
                    state: SessionState::Active,
                    mode: SpawnMode::MainSession,
                },
            );
        }
        // Session vivante détectée par `superagent_alive`.
        assert!(svc.superagent_alive(), "session super-agent vivante détectée");
        // La fermeture d'un projet (projet "") ne tue PAS la session globale.
        svc.stop_project_sessions("/p/A");
        assert!(svc.superagent_alive(), "fermeture de projet → session globale intacte");
        // `stop_all_agent_processes` (mode AgentProcess) ne la tue pas non plus.
        svc.stop_all_agent_processes();
        assert!(svc.superagent_alive(), "stop_all_agent_processes → session super-agent intacte");
        // `stop_superagent` l'arrête explicitement.
        svc.stop_superagent().unwrap();
        assert!(!svc.superagent_alive(), "stop_superagent → session arrêtée");

        // Réinsérer puis arrêt complet (fermeture app, issue #14) : purgé.
        {
            let mut sessions = svc.sessions.lock().unwrap();
            sessions.insert(
                key.clone(),
                SessionEntry {
                    session: fake_session(),
                    project: String::new(),
                    state: SessionState::Active,
                    mode: SpawnMode::MainSession,
                },
            );
        }
        assert!(svc.superagent_alive());
        svc.shutdown_all();
        assert!(!svc.superagent_alive(), "arrêt complet → session super-agent purgée");
    }

    /// P2 : `collect_session_states` extrait l'état de toutes les sessions du
    /// registre (projet, agent, état, mode, vivacité, actif) sans accès DB.
    #[test]
    fn collect_session_states_lists_all_sessions() {
        let svc = AgentService::new();
        // Session main active (agent affiché) + session agent_process parkée.
        {
            let mut sessions = svc.sessions.lock().unwrap();
            sessions.insert(
                AgentService::session_key("/p/A", "default"),
                SessionEntry {
                    session: fake_session(),
                    project: "/p/A".to_string(),
                    state: SessionState::Active,
                    mode: SpawnMode::MainSession,
                },
            );
            sessions.insert(
                AgentService::session_key("/p/B", "codeur"),
                SessionEntry {
                    session: fake_session(),
                    project: "/p/B".to_string(),
                    state: SessionState::Parked,
                    mode: SpawnMode::AgentProcess,
                },
            );
        }
        *svc.active.lock().unwrap() = Some("default".to_string());

        let raw = {
            let mut sessions = svc.sessions.lock().unwrap();
            collect_session_states(&mut sessions, &svc.active.lock().unwrap().clone())
        };
        assert_eq!(raw.len(), 2, "deux sessions listées");

        // Session main active : état active, mode main, actif=true.
        let main = raw.iter().find(|(_, a, _, _, _, _)| a == "default").expect("session default");
        assert_eq!(main.0, "/p/A");
        assert_eq!(main.2, "active");
        assert_eq!(main.3, "main");
        assert!(main.4, "processus vivant");
        assert!(main.5, "agent affiché → actif");

        // Session agent_process parkée : état parked, mode agent_process, actif=false.
        let proc = raw.iter().find(|(_, a, _, _, _, _)| a == "codeur").expect("session codeur");
        assert_eq!(proc.0, "/p/B");
        assert_eq!(proc.2, "parked");
        assert_eq!(proc.3, "agent_process");
        assert!(proc.4, "processus vivant");
        assert!(!proc.5, "agent multi-rôles → jamais actif");
    }

    /// P4 : `upsert_agent_conn` est idempotent pour un agent GLOBAL
    /// (project_path = NULL). En SQLite, `UNIQUE(id, project_path)` traite les
    /// NULL comme distincts → le `ON CONFLICT` ne se déclencherait jamais et on
    /// insérerait un doublon. Le check-then-update/insert doit garantir qu'un
    /// second upsert met à jour la ligne existante au lieu d'en créer une autre.
    #[test]
    fn upsert_global_agent_is_idempotent() {
        let conn = rusqlite::Connection::open_in_memory().expect("db mémoire");
        conn.execute_batch(
            "CREATE TABLE agents (
                id TEXT NOT NULL, project_path TEXT, name TEXT NOT NULL,
                icon TEXT DEFAULT '🤖', description TEXT DEFAULT '', role TEXT NOT NULL,
                models_pi TEXT DEFAULT '', models_plh TEXT DEFAULT '',
                capabilities TEXT DEFAULT '[]', readonly INTEGER DEFAULT 0,
                keep_context INTEGER DEFAULT 0, max_calls_per_run INTEGER DEFAULT 5,
                call_depth INTEGER DEFAULT 1, loaded INTEGER DEFAULT 0, busy INTEGER DEFAULT 0,
                proc_state TEXT DEFAULT 'Unloaded', visible INTEGER DEFAULT 1, last_active_at TEXT,
                UNIQUE (id, project_path)
            );",
        )
        .expect("création table");

        let agent = Agent {
            id: "analyseur".to_string(),
            name: "Analyseur".to_string(),
            icon: "🔍".to_string(),
            description: "Analyse".to_string(),
            role: "Tu analyses.".to_string(),
            models: crate::agent::AgentModels { pi: String::new(), plh: String::new() },
            capabilities: Vec::new(),
            readonly: true,
            keep_context: false,
            max_calls_per_run: 5,
            call_depth: 1,
            project_path: None,
            loaded: false,
            busy: false,
            state: AgentProcessState::Unloaded,
            visible: true,
            last_active_at: None,
        };

        // Premier upsert : insertion.
        upsert_agent_conn(&conn, &agent).expect("premier upsert");
        // Second upsert (même id global) : mise à jour, pas de doublon.
        let mut updated = agent.clone();
        updated.name = "Analyseur v2".to_string();
        upsert_agent_conn(&conn, &updated).expect("second upsert");

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM agents WHERE id = ?1 AND project_path IS NULL",
                params!["analyseur"],
                |r| r.get(0),
            )
            .expect("count");
        assert_eq!(count, 1, "un seul agent global, pas de doublon");
        let name: String = conn
            .query_row(
                "SELECT name FROM agents WHERE id = ?1 AND project_path IS NULL",
                params!["analyseur"],
                |r| r.get(0),
            )
            .expect("name");
        assert_eq!(name, "Analyseur v2", "le second upsert a bien mis à jour la ligne");
    }
}
