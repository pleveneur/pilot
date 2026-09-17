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
    /// Bug #152 : dernier événement de PROGRESSION réelle (démarrage de run,
    /// sortie visible, fin de tour) — en EXCLUANT les réessais provider
    /// (`auto_retry_*`, cf. `NO_PROGRESS_EVENTS`). Base du calcul d'inactivité
    /// de l'arrêt automatique T2 : un agent qui boucle sur des réessais provider
    /// sans produire de sortie doit rester éligible à l'arrêt, alors que ces
    /// événements rafraîchissent `last_activity` (comportement conservé pour
    /// l'alerte lecture seule et la pastille d'activité).
    pub last_progress: Instant,
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
    /// Attente de réponse utilisateur (bug « question sans réponse > seuil »).
    /// Posé quand une `extension_ui_request` interactive est émise (choix,
    /// multi-choix, confirmation, saisie, éditeur/gate) ; levé dès le PREMIER
    /// événement d'activité suivant (la réponse a été traitée, le tour a repris)
    /// ou sur les événements de cycle de vie / mort du process. Tant qu'il est
    /// posé, l'arrêt automatique (T2), le plafond « réfléchit » de l'Assistant
    /// et la libération du créneau « run fantôme » sont SUSPENDUS : une attente
    /// d'utilisateur n'est pas un blocage, c'est un état légitime (nuit, réunion).
    pub awaiting_user: bool,
    /// Une opération d'OUTIL est-elle en cours d'exécution ? Posé sur
    /// `tool_execution_start`, levé sur `tool_execution_end` (et sur tout
    /// événement de fin de tour / de mort du process, anti-fuite). Distingue une
    /// OPÉRATION LONGUE EN COURS (build, série de tests, longue analyse) — aucun
    /// événement n'est émis entre le start et le end — d'un agent RÉELLEMENT
    /// FIGÉ (aucun travail en cours) : tant qu'un outil tourne, l'arrêt
    /// automatique T2 est suspendu (un long travail qui avance ne doit plus être
    /// coupé à tort).
    pub tool_in_progress: bool,
    /// Lot 3 (défaut A) : l'exécution EN COURS a-t-elle déjà produit un RÉSULTAT
    /// visible (`message_end`, `tool_execution_end`, `compaction_end`) ? Réarmé à
    /// false à chaque `agent_start`. Une session qui n'a RIEN produit ET qui est
    /// inactive est signalée comme muette ; une session qui a déjà livré quelque
    /// chose ne l'est JAMAIS (pas de faux positif « en échec après avoir livré »).
    pub produced_output: bool,
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

/// Événements d'interface interactive : l'agent attend une réponse de
/// l'utilisateur (choix, multi-choix, confirmation, saisie, éditeur/gate).
/// L'événement lui-même est une progression légitime (l'agent a posé une
/// question) mais la période d'attente qui suit ne produit AUCUN autre
/// événement : sans ce marqueur, elle serait prise à tort pour un blocage et
/// l'agent serait arrêté automatiquement (bug « question sans réponse > seuil »).
const USER_REQUEST_EVENTS: &[&str] = &["extension_ui_request"];

/// Événements d'activité qui NE SONT PAS une progression réelle de la tâche
/// (bug #152) : les réessais provider. pi peut boucler sur `auto_retry` quand
/// le fournisseur est indisponible : ces événements rafraîchissent
/// `last_activity` (alerte/pastille inchangées) mais PAS `last_progress`, pour
/// que l'arrêt automatique anti-inactivité (T2) reste déclenchable.
const NO_PROGRESS_EVENTS: &[&str] = &["auto_retry_start", "auto_retry_end"];

/// Événements qui PRODUISENT un résultat visible (lot 3, défaut A).
/// `message_end` : un message (réponse) est terminé ; `tool_execution_end` : un
/// outil a rendu son résultat ; `compaction_end` : la compaction a abouti.
/// `agent_end` n'est pas listé : il sort de l'état busy (session au repos).
/// Marque `AgentAnomalyState::produced_output` de façon COLLANTE jusqu'au
/// prochain `agent_start` : base de la distinction « session muette » (jamais
/// rien produit) vs « session qui a livré quelque chose ».
const OUTPUT_EVENTS: &[&str] = &["message_end", "tool_execution_end", "compaction_end"];

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
        let is_user_request = USER_REQUEST_EVENTS.contains(&t);
        if !is_reset && !is_user_request && !ACTIVITY_EVENTS.contains(&t) {
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
                    entry.last_progress = now;
                    entry.last_activity_wall = Some(SystemTime::now());
                    entry.last_event = t.to_string();
                    // Mort du process : aucune attente d'utilisateur ne subsiste.
                    entry.awaiting_user = false;
                    // Mort du process : aucun outil ne tourne plus.
                    entry.tool_in_progress = false;
                }
            } else {
                let entry = m.entry(agent_key.clone()).or_insert(AgentAnomalyState {
                    last_activity: now,
                    last_progress: now,
                    last_activity_wall: Some(SystemTime::now()),
                    last_event: t.to_string(),
                    busy: false,
                    blocked_reported: false,
                    auto_stopped_reported: false,
                    awaiting_user: is_user_request,
                    // Posé si cet événement fondateur est déjà un start d'outil.
                    tool_in_progress: t == "tool_execution_start",
                    // Un événement fondateur peut déjà être un résultat.
                    produced_output: OUTPUT_EVENTS.contains(&t),
                });
                if t == "agent_start" {
                    entry.busy = true;
                    // Nouvelle exécution : réarmer la détection de blocage ET l'arrêt auto.
                    entry.blocked_reported = false;
                    entry.auto_stopped_reported = false;
                    // Nouvelle exécution : aucun outil en cours (anti-fuite si un
                    // `tool_execution_end` de la run précédente a été perdu).
                    entry.tool_in_progress = false;
                    // Lot 3 (défaut A) : nouvelle exécution → rien n'a encore été
                    // produit. Le marqueur sera posé au premier `message_end` /
                    // `tool_execution_end` / `compaction_end`.
                    entry.produced_output = false;
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
                    // Fin de tour : plus aucun outil en cours (anti-fuite).
                    entry.tool_in_progress = false;
                }
                // Marqueur « en attente de réponse utilisateur » : posé par une
                // question interactive, levé par le premier événement d'activité
                // suivant (réponse traitée / tour repris) et par tout événement de
                // cycle de vie (agent_start/end/settled). Anti-fuite : un marqueur
                // coincé ne doit jamais empêcher à jamais l'arrêt automatique.
                entry.awaiting_user = is_user_request;
                entry.last_activity = now;
                // Bug #152 : les réessais provider ne sont pas une progression —
                // ils ne repoussent pas le plafond de l'arrêt automatique.
                if !NO_PROGRESS_EVENTS.contains(&t) {
                    entry.last_progress = now;
                }
                // Lot 3 (défaut A) : marqueur COLLANT « cette exécution a produit
                // un résultat ». Un `message_end`/`tool_execution_end` ne sera
                // jamais requalifié en session muette, même si le dernier
                // événement suivant est un simple `message_start` (faux positif
                // « déclarée en échec après avoir livré »).
                if OUTPUT_EVENTS.contains(&t) {
                    entry.produced_output = true;
                }
                entry.last_activity_wall = Some(SystemTime::now());
                entry.last_event = t.to_string();
                // Distinction « opération d'outil en cours » vs « agent figé » :
                // un `tool_execution_end` clôt l'opération ; SEUL un
                // `tool_execution_start` l'ouvre (`tool_execution_update` ne fait
                // que rafraîchir l'activité, il ne marque pas l'ouverture).
                // Les autres événements d'activité ne changent pas ce marqueur.
                if t == "tool_execution_end" {
                    entry.tool_in_progress = false;
                } else if t == "tool_execution_start" {
                    entry.tool_in_progress = true;
                }
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
    if !enabled || !entry.busy || entry.auto_stopped_reported || entry.awaiting_user {
        return false;
    }
    let idle_secs = now.duration_since(entry.last_activity).as_secs();
    idle_secs > (timeout_minutes.max(1) as u64) * 60
}

/// T2 + bug #152 : variante de `should_auto_stop` INSENSIBLE aux réessais
/// provider : l'inactivité est mesurée depuis le dernier événement de
/// PROGRESSION réelle (`last_progress`, cf. `NO_PROGRESS_EVENTS`) et non
/// depuis n'importe quel événement d'activité. Un agent délégué qui boucle sur
/// des `auto_retry` sans produire de sortie est donc bien arrêté après le
/// seuil, au lieu de rafraîchir indéfiniment son horodatage d'activité.
/// `should_auto_stop` (toute activité) reste utilisée pour le super-agent
/// (comportement inchangé). Pure et testable.
fn should_auto_stop_on_progress(
    entry: &AgentAnomalyState,
    enabled: bool,
    timeout_minutes: u32,
    now: Instant,
) -> bool {
    if !enabled || !entry.busy || entry.auto_stopped_reported || entry.awaiting_user {
        return false;
    }
    // Une opération d'outil EN COURS est un travail qui avance : un long build,
    // une longue série de tests ou une longue analyse n'émet aucun événement
    // entre `tool_execution_start` et `tool_execution_end`. Ne jamais couper
    // tant que l'outil tourne ; l'agent RÉELLEMENT figé (aucun outil en cours)
    // reste arrêté comme avant.
    if entry.tool_in_progress {
        return false;
    }
    let idle_secs = now.duration_since(entry.last_progress).as_secs();
    idle_secs > (timeout_minutes.max(1) as u64) * 60
}

/// Lot 3 (défaut A) : décide si une session d'agent doit être signalée comme
/// MUETTE ET INACTIVE (« elle démarre, ne produit rien et reste silencieuse »).
///
/// Critère fondé sur la DERNIÈRE ACTIVITÉ réelle (`last_activity`), jamais sur la
/// durée totale : l'appelant compare l'inactivité au seuil. Ne signale JAMAIS :
///  - une session non busy (terminée ou au repos) ;
///  - une session qui a déjà produit un résultat (`produced_output`) — le faux
///    positif « en échec après avoir livré » est ainsi impossible ;
///  - une session avec une activité récente (inactivité sous le seuil) :
///    « longue mais qui travaille » n'est pas muette ;
///  - une session en attente de l'utilisateur ou avec une opération d'outil en
///    cours (silence légitime) ;
///  - une session déjà signalée pour cette exécution (`blocked_reported` sert de
///    verrou « un seul signalement » : aucune répétition en boucle).
/// Pure et testable.
fn should_report_silent_session(
    entry: &AgentAnomalyState,
    enabled: bool,
    silent_minutes: u32,
    now: Instant,
) -> bool {
    if !enabled || !entry.busy || entry.blocked_reported || entry.awaiting_user || entry.tool_in_progress {
        return false;
    }
    if entry.produced_output {
        return false;
    }
    let idle_secs = now.duration_since(entry.last_activity).as_secs();
    idle_secs > (silent_minutes.max(1) as u64) * 60
}

/// Identifie la clé d'anomalie du super-agent (projet pseudo-global `""`).
/// Le super-agent est géré par un plafond « réfléchit » dédié (tâche #141) et
/// NON par l'arrêt auto T2 (scope agents délégués). Pure et testable.
fn is_super_agent_key(project: &str, agent: &str) -> bool {
    project.is_empty() && agent == crate::agent_service::SUPERAGENT_ID
}

/// Verrou de run fantôme (busy-stale) : décide si une entrée busy doit être
/// repassée à false par le filet AUTORITAIRE, indépendant de l'arrêt auto (T2)
/// et de la mort du process. Un process pi FIGÉ (vivant, ni settled ni exit)
/// laisse `busy` à true sans jamais l'effacer : dès que la dernière activité est
/// plus ancienne que `grace_minutes` (STALE_BUSY_GRACE, défaut 25), la session
/// n'est plus un travail en cours → on libère la marque busy SANS tuer le
/// process (le kill relève de l'arrêt auto T2). Pure et testable.
pub(crate) fn should_release_stale_busy(entry: &AgentAnomalyState, grace_minutes: u32, now: Instant) -> bool {
    if !entry.busy || entry.awaiting_user {
        return false;
    }
    let idle_secs = now.duration_since(entry.last_activity).as_secs();
    idle_secs > (grace_minutes.max(1) as u64) * 60
}

/// Décision pure (garde d'exclusivité MOTEUR) : une entrée d'anomalie rend-elle
/// la session exclusive ? Un agent n'est exclusif que s'il TRAVAILLE RÉELLEMENT :
/// `busy=true` ET non périmé (`should_release_stale_busy`). Un `busy` fantôme
/// (process pi figé, ni settled ni exit) ne doit pas bloquer la relance — même
/// politique que le frontend (`isSessionWorking`/`isBusyStale`).
pub(crate) fn busy_entry_is_exclusive(
    entry: &AgentAnomalyState,
    grace_minutes: u32,
    now: Instant,
) -> bool {
    entry.busy && !should_release_stale_busy(entry, grace_minutes, now)
}

/// Bug #81 : route l'arrêt auto d'une entrée non-super busy sans progression
/// vers la bonne cible. Retourne :
///  - `"agent_process"` : agent délégué (run_agents, mode `AgentProcess`) vivant ;
///  - `"main_session"` : agent standard (chat principal, mode `MainSession`) vivant ;
///  - `"none"` : session absente ou morte (rien à arrêter).
/// Pure et testable — le moniteur l'utilise pour router l'arrêt automatique
/// (scope run_agents préservé, arrêt auto étendu à l'agent standard).
fn auto_stop_target(agent_process_alive: bool, main_session_alive: bool) -> &'static str {
    if agent_process_alive {
        "agent_process"
    } else if main_session_alive {
        "main_session"
    } else {
        "none"
    }
}

/// Réglages consommés par la boucle du moniteur (anomalie, arrêt auto T2,
/// plafond de l'assistant, verrou busy-stale). Extrait de `AppConfig` pour être
/// relu à CHAQUE tour : un réglage modifié dans les Paramètres s'applique sans
/// redémarrer Pilot (issue #89). `Copy` : la boucle en garde la dernière valeur
/// connue, qui sert de repli si la config est momentanément illisible.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct MonitorConfig {
    anomaly_enabled: bool,
    timeout_minutes: u32,
    auto_stop_enabled: bool,
    auto_stop_minutes: u32,
    super_stop_enabled: bool,
    super_stop_minutes: u32,
    stale_busy_grace: u32,
}

impl MonitorConfig {
    /// Valeurs par défaut (identiques à celles d'`AppConfig`). Utilisées
    /// uniquement si la toute première lecture de la config échoue.
    fn defaults() -> Self {
        Self {
            anomaly_enabled: true,
            timeout_minutes: crate::default_anomaly_timeout_minutes(),
            auto_stop_enabled: true,
            auto_stop_minutes: crate::default_agent_auto_stop_minutes(),
            super_stop_enabled: true,
            super_stop_minutes: crate::default_agent_auto_stop_minutes(),
            stale_busy_grace: crate::default_stale_busy_grace_minutes(),
        }
    }

    fn from_app_config(cfg: &crate::AppConfig) -> Self {
        Self {
            anomaly_enabled: cfg.anomaly_detection_enabled,
            timeout_minutes: cfg.anomaly_timeout_minutes,
            auto_stop_enabled: cfg.agent_auto_stop_enabled,
            auto_stop_minutes: cfg.agent_auto_stop_minutes,
            super_stop_enabled: cfg.super_agent_auto_stop_enabled,
            super_stop_minutes: cfg.super_agent_auto_stop_minutes,
            stale_busy_grace: cfg.stale_busy_grace_minutes,
        }
    }
}

/// Sélection du repli quand la config est illisible : `None` (lecture
/// impossible ce tour-ci) → dernière valeur connue ; `Some` → valeur fraîche.
/// Pure et testable.
fn monitor_config_or_last(current: Option<MonitorConfig>, last: MonitorConfig) -> MonitorConfig {
    current.unwrap_or(last)
}

/// Lit les réglages du moniteur SANS jamais bloquer le thread de surveillance ni
/// le faire mourir (issue #89). Avant ce correctif, la boucle faisait
/// `state.config.lock().unwrap()` : un verrou empoisonné (panic d'un autre
/// thread pendant qu'il détenait la config) faisait PANIQUER la boucle, tuait le
/// thread de surveillance — créé une seule fois au démarrage — et PLUS AUCUN
/// réglage n'était appliqué avant un redémarrage de Pilot.
/// Comportement :
///  - verrou libre → valeur courante (relecture à chaque tour) ;
///  - verrou momentanément pris (`WouldBlock`) → dernière valeur connue + trace,
///    aucun blocage, la surveillance continue ;
///  - verrou empoisonné (`Poisoned`) → les données sont intactes malgré le
///    poison : on les lit directement au lieu de renoncer, la surveillance
///    continue avec la valeur courante.
fn read_monitor_config(state: &AppState, last: MonitorConfig) -> MonitorConfig {
    match state.config.try_lock() {
        Ok(cfg) => monitor_config_or_last(Some(MonitorConfig::from_app_config(&cfg)), last),
        Err(std::sync::TryLockError::Poisoned(poisoned)) => {
            eprintln!(
                "[anomaly] config verrouillée par un panic antérieur (verrou empoisonné) : \
                 lecture directe, la surveillance continue (issue #89)."
            );
            MonitorConfig::from_app_config(&poisoned.into_inner())
        }
        Err(std::sync::TryLockError::WouldBlock) => {
            eprintln!(
                "[anomaly] config momentanément illisible (verrou pris) : repli sur la \
                 dernière valeur connue (seuil d'inactivité {} min), la surveillance continue \
                 (issue #89).",
                last.timeout_minutes
            );
            monitor_config_or_last(None, last)
        }
    }
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
///     (`AgentProcess`, scope restreint) OU l'agent standard (`MainSession`,
///     bug #81), arrête le processus pi, émet l'événement `agent-auto-stopped`
///     (UI + libération du créneau d'exclusivité par agents-bus.js / de la
///     délégation par super-agent.js) puis PROPOSE automatiquement le
///     diagnostic (`do_start_diagnostic_agent`).
/// Ne bloque jamais l'interface (thread dédié). Respecte les réglages
/// `anomaly_detection_enabled` et `agent_auto_stop_enabled` (défauts activés).
pub fn start_monitor(app: AppHandle, anomaly_map: Arc<Mutex<HashMap<String, AgentAnomalyState>>>) {
    std::thread::spawn(move || {
        // Issue #89 : dernière valeur connue des réglages, utilisée comme repli
        // si la config est momentanément illisible (jamais de blocage, jamais
        // d'arrêt de la surveillance sur une lecture de config).
        let mut last_cfg = MonitorConfig::defaults();
        loop {
            std::thread::sleep(Duration::from_secs(30));
            let state = app.state::<AppState>();
            // Relecture de la valeur COURANTE à chaque tour (issue #89) : un
            // changement dans les Paramètres s'applique sans redémarrer Pilot.
            last_cfg = read_monitor_config(state.inner(), last_cfg);
            let MonitorConfig {
                anomaly_enabled,
                timeout_minutes,
                auto_stop_enabled,
                auto_stop_minutes,
                super_stop_enabled,
                super_stop_minutes,
                stale_busy_grace,
            } = last_cfg;
            let anomaly_timeout_secs = (timeout_minutes.max(1) as u64) * 60;
            let now = Instant::now();
            let mut alerts: Vec<(String, String, String, u64)> = Vec::new();
            // Lot 3 (défaut A) : sessions muettes détectées dans ce passage.
            let mut silent_alerts: Vec<(String, String, String, u64)> = Vec::new();
            let mut auto_stops: Vec<(String, String, u64)> = Vec::new();
            let mut stale_releases: Vec<(String, String, u64)> = Vec::new();
            let mut super_stops: Vec<(String, u64)> = Vec::new();
            // Bug #152 : entrées busy dont la vivacité (process mort sans
            // événement de fin) sera vérifiée HORS verrou (try_wait sur le
            // registre de sessions).
            let mut stale_busy: Vec<(String, String)> = Vec::new();
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
                    // 0. Lot 3 (défaut A) : session MUETTE ET INACTIVE — elle tourne
                    //    (busy) mais n'a JAMAIS produit de résultat et n'a plus
                    //    aucune activité réelle depuis le seuil (seuil partagé avec
                    //    l'alerte d'anomalie : aucun réglage nouveau). Le verrou
                    //    `blocked_reported` assure UN SEUL signalement par exécution
                    //    et neutralise l'alerte d'anomalie générique (pas de double
                    //    message). Le super-agent est exclu (plafond dédié #141).
                    if !is_super
                        && should_report_silent_session(entry, anomaly_enabled, timeout_minutes, now)
                    {
                        entry.blocked_reported = true;
                        silent_alerts.push((
                            project.clone(),
                            agent.clone(),
                            entry.last_event.clone(),
                            idle_secs / 60,
                        ));
                    }
                    // 1. Anomalie (lecture seule, tâche 8) : agent busy sans progression.
                    if anomaly_enabled
                        && entry.busy
                        && !entry.blocked_reported
                        && !entry.awaiting_user
                        && idle_secs > anomaly_timeout_secs
                    {
                        entry.blocked_reported = true;
                        alerts.push((project.clone(), agent.clone(), entry.last_event.clone(), idle_secs / 60));
                    }
                    // 2. Arrêt auto (T2) : agents délégués ET agent standard (session
                    //    principale) ; seul le super-agent est exclu (cf. `is_super`). Le scope
                    //    (AgentProcess) est filtré après (agent_process_alive). Bug #152 : le
                    //    calcul d'inactivité ignore les réessais provider
                    //    (should_auto_stop_on_progress).
                    if !is_super
                        && should_auto_stop_on_progress(
                            entry,
                            auto_stop_enabled,
                            auto_stop_minutes,
                            Instant::now(),
                        )
                    {
                        entry.auto_stopped_reported = true;
                        // Pas de double alerte (anomalie) pour un agent déjà arrêté.
                        entry.blocked_reported = true;
                        auto_stops.push((project.clone(), agent.clone(), idle_secs / 60));
                    }
                    // 2b. Verrou de run fantôme (busy-stale) : filet AUTORITAIRE,
                    //    indépendant de l'arrêt auto (T2) et de la mort du process.
                    //    Un process pi FIGÉ laisse busy=true (agent_start posé, jamais
                    //    d'agent_settled/exit) : on repasse busy=false et on émet un
                    //    événement pour que JS libère le créneau + la file. NE tue
                    //    PAS le process (kill = T2). Correcte aussi quand
                    //    `agent_auto_stop_enabled=false` (sessions vivantes mais
                    //    inactives). Le super-agent est exclu (plafond #141) et la
                    //    session principale n'est PAS touchée sur simple inactivité
                    //    (on ne libère que la marque busy de la map d'anomalie).
                    //    `auto_stopped_reported` est déjà true si l'arrêt auto a
                    //    déclenché dans CE passage → pas de double traitement.
                    if !is_super
                        && entry.busy
                        && !entry.auto_stopped_reported
                        && should_release_stale_busy(entry, stale_busy_grace, now)
                    {
                        entry.busy = false;
                        entry.blocked_reported = false;
                        entry.auto_stopped_reported = false;
                        stale_releases.push((project.clone(), agent.clone(), idle_secs / 60));
                    }
                    // Bug #152 : candidat à la purge si l'entrée reste busy — la
                    // vivacité est vérifiée hors verrou (has_dead_agent_process).
                    // Placé AVANT le plafond super-agent qui déplace `agent`.
                    if entry.busy && !is_super {
                        stale_busy.push((project.clone(), agent.clone()));
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
            // Lot 3 (défaut A) : trace horodatée + alerte explicite en français
            // (même famille que les autres alertes d'agent), remontée à l'UI et à
            // l'assistant via l'événement `agent-silent`. AUCUN arrêt silencieux :
            // la session n'est pas tuée, elle est DITE.
            for (project, agent, last_event, idle_min) in silent_alerts {
                let detected_at = chrono::Utc::now().to_rfc3339();
                eprintln!(
                    "[anomaly] {} session muette : l'agent « {} » (projet {}) ne produit \
                     rien depuis {} min (dernier événement : {}) — signalée une seule fois.",
                    detected_at, agent, project, idle_min, last_event
                );
                let _ = app.emit(
                    "agent-silent",
                    serde_json::json!({
                        "project": project,
                        "agent": agent,
                        "lastEvent": last_event,
                        "idleMinutes": idle_min,
                        "detectedAt": detected_at,
                        "message": format!(
                            "⚠️ L'agent « {} » ne produit rien depuis {} min (projet : {}, dernier événement : {}).",
                            agent, idle_min, project, last_event
                        ),
                    }),
                );
            }
            for (project, agent, idle_min) in auto_stops {
                // Bug #81 : route l'arrêt auto vers l'agent délégué (AgentProcess,
                // scope run_agents préservé) OU l'agent standard (MainSession). Le
                // super-agent est exclu (is_super). Une session absente/morte → rien.
                let target = auto_stop_target(
                    state.agent_service.agent_process_alive(&project, &agent),
                    state.agent_service.main_session_alive(&project, &agent),
                );
                if target == "none" {
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
                // Bug #81 : reason dédié pour l'agent standard (le frontend s'en
                // sert pour distinguer l'arrêt auto de l'agent standard de celui
                // d'un agent délégué run_agents).
                let reason = if target == "agent_process" {
                    "Agent délégué arrêté automatiquement : bloqué (actif sans progression)."
                } else {
                    "Agent standard arrêté automatiquement : bloqué (actif sans progression)."
                };
                let _ = app.emit(
                    "agent-auto-stopped",
                    serde_json::json!({
                        "project": project,
                        "agent": agent,
                        "reason": reason,
                        "idleMinutes": idle_min,
                    }),
                );
                // PROPOSE automatiquement le diagnostic (réutilise l'existant).
                let anomaly_val =
                    serde_json::json!({ "lastEvent": "arrêt automatique (bloqué)", "idleMinutes": idle_min });
                let _ = do_start_diagnostic_agent(state.inner(), &app, &project, &agent, &anomaly_val);
            }
            // Verrou de run fantôme (busy-stale) : on a repassé busy=false sans
            // tuer le process (dans la boucle ci-dessus). Événement Rust → JS :
            // agents-bus libère le créneau d'exclusivité et lance les demandes en
            // file (failAgentTurn → launchNextQueued), même quand l'arrêt auto T2
            // est désactivé. Le process n'est PAS tué (le kill relève de T2).
            for (project, agent, idle_min) in stale_releases {
                let _ = app.emit(
                    "agent-stale-busy-released",
                    serde_json::json!({
                        "project": project,
                        "agent": agent,
                        "idleMinutes": idle_min,
                    }),
                );
            }
            // Bug #152 : purge des agents délégués marqués « busy » alors que
            // leur processus est DÉJÀ MORT (aucun agent_end/process_exit traité,
            // ex: événements perdus). Sans purge, l'exclusivité des spécialités
            // (agent_process_busy côté Rust, file d'attente côté JS) attend un
            // agent qui n'existe plus et la file d'attente se bloque. Scope
            // strictement restreint aux sessions enregistrées en mode
            // AgentProcess (has_dead_agent_process) : la session principale, le
            // reviewer, le super-agent et les agents d'assistant (autres modes)
            // ne sont JAMAIS touchés. La purge est indépendante du seuil
            // d'inactivité : dès que busy ∧ process mort → purge + événement.
            for (project, agent) in stale_busy {
                if !state.agent_service.has_dead_agent_process(&project, &agent) {
                    continue;
                }
                {
                    let mut m = anomaly_map.lock().unwrap();
                    if let Some(e) = m.get_mut(&format!("{}\u{1f}{}", project, agent)) {
                        e.busy = false;
                        e.blocked_reported = false;
                        e.auto_stopped_reported = false;
                    }
                }
                // Événement Rust → JS : le bus d'agents libère le créneau
                // d'exclusivité (failAgentTurn → launchNextQueued) pour qu'un
                // agent en file d'attente prenne le relais immédiatement.
                let _ = app.emit(
                    "agent-auto-stopped",
                    serde_json::json!({
                        "project": project,
                        "agent": agent,
                        "reason": "Agent délégué purgé automatiquement : processus terminé sans retour d'état.",
                        "idleMinutes": 0,
                    }),
                );
            }
            // Issue #87 : purge des ÉTATS D'EXÉCUTION FANTÔMES. Le filtre ci-
            // dessus (Bug #152) ne voit que les entrées encore `busy` dans la
            // map d'anomalie ET dont la session enregistrée est morte. Il
            // manquait le cas décrit par l'issue : la ligne `agents` reste
            // `proc_state='Running'` (et `busy` est déjà retombé à 0) alors
            // qu'AUCUN processus n'est vivant → le verrou d'exécution du projet
            // restait posé et TOUS les lancements suivants étaient refusés ou
            // mis en file en silence (jusqu'au redémarrage de Pilot, la variante
            // de casse du chemin contournant le verrou). La purge ci-dessous est
            // autoritaire : elle inspecte la base (proc_state='Running') et
            // vérifie la vivacité réelle du processus (`agent_alive`), remet la
            // ligne à `Unloaded` (loaded=0, busy=0), libère la marque `busy` de
            // la map d'anomalie, retire la session morte du registre et
            // journalise UNE LIGNE par purge. Les sessions vivantes (parkées, en
            // cours) ne sont jamais touchées.
            if let Ok(purged) = state
                .agent_service
                .purge_ghost_running_states_app(&app, &anomaly_map)
            {
                for (project, agent) in purged {
                    // Événement Rust → JS : le bus d'agents l'écoute pour
                    // terminer le tour d'un agent encore suivi dans
                    // `activeAgents` (cas busy-stale). Pour un fantôme sorti du
                    // suivi en mémoire, la libération du verrou de run est
                    // assurée côté JS par `releaseStuckRunLock` (détection
                    // « travail en file sans porteur »), appelée avant chaque
                    // nouveau lancement : plus besoin de redémarrer Pilot.
                    let _ = app.emit(
                        "agent-stale-busy-released",
                        serde_json::json!({
                            "project": project,
                            "agent": agent,
                            "idleMinutes": 0,
                            "reason": "État d'exécution fantôme purgé : marqué « en cours » sans processus vivant — verrou du projet libéré.",
                        }),
                    );
                }
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
        let cfg = state.config_snapshot();
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

    /// Issue #89 : les réglages consommés par la boucle du moniteur sont extraits
    /// de la config COURANTE (relue à chaque tour), donc une valeur modifiée dans
    /// les Paramètres se retrouve immédiatement dans `MonitorConfig` — sans
    /// redémarrer Pilot.
    #[test]
    fn monitor_config_reflects_current_settings() {
        let mut cfg = crate::AppConfig::default();
        cfg.anomaly_detection_enabled = false;
        cfg.anomaly_timeout_minutes = 7;
        cfg.agent_auto_stop_enabled = false;
        cfg.agent_auto_stop_minutes = 3;
        cfg.super_agent_auto_stop_enabled = false;
        cfg.super_agent_auto_stop_minutes = 4;
        cfg.stale_busy_grace_minutes = 5;

        let mc = MonitorConfig::from_app_config(&cfg);
        assert!(!mc.anomaly_enabled);
        assert_eq!(mc.timeout_minutes, 7);
        assert!(!mc.auto_stop_enabled);
        assert_eq!(mc.auto_stop_minutes, 3);
        assert!(!mc.super_stop_enabled);
        assert_eq!(mc.super_stop_minutes, 4);
        assert_eq!(mc.stale_busy_grace, 5);
    }

    /// Issue #89 : quand la config est momentanément illisible (verrou pris), le
    /// moniteur garde la DERNIÈRE valeur connue au lieu de bloquer ou de
    /// s'arrêter ; une lecture réussie prend la valeur fraîche.
    #[test]
    fn monitor_config_falls_back_to_last_known() {
        let last = MonitorConfig::defaults();
        assert_eq!(monitor_config_or_last(None, last), last);
        let fresh = MonitorConfig {
            timeout_minutes: 1,
            ..MonitorConfig::defaults()
        };
        assert_eq!(monitor_config_or_last(Some(fresh), last), fresh);
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

    /// Passage 3 du lot 1 : l'observateur distingue une OPÉRATION D'OUTIL EN
    /// COURS (`tool_execution_start` … `tool_execution_end`) d'un agent au repos.
    /// Le marqueur est levé par une fin de tour (`agent_end`/`agent_settled`) —
    /// anti-fuite si `tool_execution_end` est perdu — et par la mort du process.
    #[test]
    fn observer_tracks_tool_in_progress() {
        let activity: Arc<Mutex<HashMap<String, SessionActivity>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let anomaly: Arc<Mutex<HashMap<String, AgentAnomalyState>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let obs = make_observer(&activity, &anomaly, "/proj", "/proj\u{1f}codeur");

        // agent_start → aucun outil en cours.
        obs(&ev("agent_start"));
        assert!(
            !anomaly.lock().unwrap().get("/proj\u{1f}codeur").unwrap().tool_in_progress,
            "agent_start → aucun outil en cours"
        );

        // tool_execution_start → opération d'outil en cours.
        obs(&ev("tool_execution_start"));
        assert!(
            anomaly.lock().unwrap().get("/proj\u{1f}codeur").unwrap().tool_in_progress,
            "tool_execution_start → opération en cours"
        );

        // tool_execution_update (flux de l'outil) ne clôt pas l'opération.
        obs(&ev("tool_execution_update"));
        assert!(
            anomaly.lock().unwrap().get("/proj\u{1f}codeur").unwrap().tool_in_progress,
            "tool_execution_update → toujours en cours"
        );

        // tool_execution_end → opération terminée.
        obs(&ev("tool_execution_end"));
        assert!(
            !anomaly.lock().unwrap().get("/proj\u{1f}codeur").unwrap().tool_in_progress,
            "tool_execution_end → opération terminée"
        );

        // Un nouvel outil en cours puis agent_settled → marqueur levé (anti-fuite).
        obs(&ev("tool_execution_start"));
        obs(&ev("agent_settled"));
        assert!(
            !anomaly.lock().unwrap().get("/proj\u{1f}codeur").unwrap().tool_in_progress,
            "agent_settled → plus d'outil en cours (anti-fuite)"
        );

        // Nouvel outil puis process_exit → marqueur levé (mort du process).
        obs(&ev("agent_start"));
        obs(&ev("tool_execution_start"));
        obs(&ev("process_exit"));
        assert!(
            !anomaly.lock().unwrap().get("/proj\u{1f}codeur").unwrap().tool_in_progress,
            "process_exit → plus d'outil en cours"
        );
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
            last_progress: Instant::now(),
            last_activity_wall: Some(SystemTime::now()),
            last_event: "tool_execution_end".to_string(),
            busy: true,
            blocked_reported: false,
            auto_stopped_reported: false,
            awaiting_user: false,
            tool_in_progress: false,
            produced_output: false,
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
            last_progress: Instant::now(),
            last_activity_wall: None,
            last_event: "agent_start".to_string(),
            busy: true,
            blocked_reported: false,
            auto_stopped_reported: false,
            awaiting_user: false,
            tool_in_progress: false,
            produced_output: false,
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
            last_progress: now - Duration::from_secs(idle_secs),
            last_activity_wall: Some(SystemTime::now()),
            last_event: "tool_execution_start".to_string(),
            busy,
            blocked_reported: false,
            auto_stopped_reported: reported,
            awaiting_user: false,
            tool_in_progress: false,
            produced_output: false,
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

    /// Bug #81 : `auto_stop_target` route l'arrêt auto vers l'agent délégué
    /// (AgentProcess, scope run_agents préservé), l'agent standard (MainSession)
    /// ou rien (session absente/morte). Une session ne peut pas être à la fois
    /// AgentProcess et MainSession (même clé (projet, agent)) : le cas (true,
    /// true) ne se produit pas, mais on privilégie l'agent délégué (comportement
    /// historique).
    #[test]
    fn auto_stop_target_routes_to_agent_process_main_or_none() {
        assert_eq!(auto_stop_target(true, false), "agent_process");
        assert_eq!(auto_stop_target(false, true), "main_session");
        assert_eq!(auto_stop_target(false, false), "none");
        assert_eq!(auto_stop_target(true, true), "agent_process");
    }

    /// Bug #152 : l'observateur rafraîchit `last_progress` sur les événements
    /// de progression réelle, mais PAS sur les réessais provider (`auto_retry_*`)
    /// qui rafraîchissent uniquement `last_activity` (alerte/pastille inchangées).
    #[test]
    fn observer_refreshes_progress_but_not_on_auto_retry() {
        let activity: Arc<Mutex<HashMap<String, SessionActivity>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let anomaly: Arc<Mutex<HashMap<String, AgentAnomalyState>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let obs = make_observer(&activity, &anomaly, "/proj", "/proj\u{1f}codeur");

        // agent_start → busy=true, progression enregistrée.
        obs(&ev("agent_start"));
        let progress_at_start = {
            let a = anomaly.lock().unwrap();
            let s = a.get("/proj\u{1f}codeur").unwrap();
            assert!(s.busy);
            s.last_progress
        };
        let activity_at_start = {
            let a = anomaly.lock().unwrap();
            let s = a.get("/proj\u{1f}codeur").unwrap();
            s.last_activity
        };

        // auto_retry_end (réessai provider) : rafraîchit last_activity…
        obs(&ev("auto_retry_end"));
        {
            let a = anomaly.lock().unwrap();
            let s = a.get("/proj\u{1f}codeur").unwrap();
            assert!(s.last_activity > activity_at_start, "auto_retry rafraîchit l'activité");
            assert_eq!(
                s.last_progress, progress_at_start,
                "auto_retry ne doit PAS rafraîchir la progression"
            );
        }

        // tool_execution_end (progression réelle) → rafraîchit les deux.
        obs(&ev("tool_execution_end"));
        {
            let a = anomaly.lock().unwrap();
            let s = a.get("/proj\u{1f}codeur").unwrap();
            assert!(
                s.last_progress > progress_at_start,
                "une sortie visible rafraîchit la progression"
            );
        }
    }

    /// Bug #152 : `should_auto_stop_on_progress` ignore les réessais provider —
    /// un agent busy dont `last_activity` est frais (auto_retry) mais dont
    /// `last_progress` date de plus que le seuil est arrêté. À l'inverse, une
    /// progression récente protège l'agent (outil long légitime).
    #[test]
    fn should_auto_stop_on_progress_ignores_provider_retries() {
        let now = Instant::now() + Duration::from_secs(100_000);
        // Helper : last_activity frais (réessai), last_progress ancien.
        let state = |progress_age_secs: u64, retry_age_secs: u64| AgentAnomalyState {
            last_activity: now - Duration::from_secs(retry_age_secs),
            last_progress: now - Duration::from_secs(progress_age_secs),
            last_activity_wall: Some(SystemTime::now()),
            last_event: "auto_retry_end".to_string(),
            busy: true,
            blocked_reported: false,
            auto_stopped_reported: false,
            awaiting_user: false,
            tool_in_progress: false,
            produced_output: false,
        };

        // Boucle de réessais fraîche (il y a 30 s) mais AUCUNE progression depuis
        // 12 min (seuil 10 min) → arrêt (l'ancienne logique n'aurait JAMAIS coupé).
        let e = state(700, 30);
        assert!(should_auto_stop_on_progress(&e, true, 10, now));

        // Progression réelle récente (outil long légitime) → pas d'arrêt.
        let e = state(300, 30);
        assert!(!should_auto_stop_on_progress(&e, true, 10, now));

        // Mêmes gardes que should_auto_stop : désactivé / non busy / déjà arrêté.
        let e = state(700, 30);
        assert!(!should_auto_stop_on_progress(&e, false, 10, now));
        let e = AgentAnomalyState {
            busy: false,
            ..state(700, 30)
        };
        assert!(!should_auto_stop_on_progress(&e, true, 10, now));
        let e = AgentAnomalyState {
            auto_stopped_reported: true,
            ..state(700, 30)
        };
        assert!(!should_auto_stop_on_progress(&e, true, 10, now));
    }

    /// Passage 3 du lot 1 : une OPÉRATION LONGUE EN COURS (outil démarré qui
    /// tourne encore) n'est PAS arrêtée automatiquement, même si la dernière
    /// progression date de plus que le seuil — alors qu'un agent RÉELLEMENT FIGÉ
    /// (aucun outil en cours) reste arrêté comme avant. Le seuil et les autres
    /// gardes (enabled/busy/already-reported/awaiting_user) sont inchangés.
    #[test]
    fn should_auto_stop_on_progress_suspends_during_long_tool() {
        let now = Instant::now() + Duration::from_secs(100_000);
        // 12 min depuis la dernière progression (> seuil 10 min).
        let state = |tool_in_progress: bool| AgentAnomalyState {
            last_activity: now - Duration::from_secs(720),
            last_progress: now - Duration::from_secs(720),
            last_activity_wall: Some(SystemTime::now()),
            last_event: "tool_execution_start".to_string(),
            busy: true,
            blocked_reported: false,
            auto_stopped_reported: false,
            awaiting_user: false,
            tool_in_progress,
            produced_output: false,
        };

        // Outil en cours → pas d'arrêt (long build / longue série de tests).
        assert!(
            !should_auto_stop_on_progress(&state(true), true, 10, now),
            "opération longue en cours → pas d'arrêt automatique"
        );

        // Aucun outil en cours → agent figé → arrêt (comportement conservé).
        assert!(
            should_auto_stop_on_progress(&state(false), true, 10, now),
            "agent figé (aucun outil) → arrêt conservé"
        );

        // Le réglage d'activation reste respecté : désactivé → jamais d'arrêt.
        assert!(!should_auto_stop_on_progress(&state(false), false, 10, now));

        // Le seuil reste respecté : outil en cours ET progression < seuil.
        let fresh = AgentAnomalyState {
            last_activity: now - Duration::from_secs(300),
            last_progress: now - Duration::from_secs(300),
            ..state(true)
        };
        assert!(!should_auto_stop_on_progress(&fresh, true, 10, now));
    }

    /// Verrou fantôme (busy-stale) : `should_release_stale_busy` libère la marque
    /// busy d'un agent figé (busy sans activité depuis > grace) SANS dépendre de
    /// l'arrêt auto (T2). Gardes : non-busy → jamais, et inactivité < seuil → non.
    #[test]
    fn should_release_stale_busy_guards_busy_and_grace() {
        let now = Instant::now() + Duration::from_secs(100_000);
        let state_at = |idle_secs: u64, busy: bool| AgentAnomalyState {
            last_activity: now - Duration::from_secs(idle_secs),
            last_progress: now - Duration::from_secs(idle_secs),
            last_activity_wall: Some(SystemTime::now()),
            last_event: "tool_execution_start".to_string(),
            busy,
            blocked_reported: false,
            auto_stopped_reported: false,
            awaiting_user: false,
            tool_in_progress: false,
            produced_output: false,
        };

        // Non busy → jamais libéré.
        let e = state_at(6000, false);
        assert!(!should_release_stale_busy(&e, 25, now));

        // Inactivité < grace (ex: 5 min < 25) → pas de libération (outil long).
        let e = state_at(300, true);
        assert!(!should_release_stale_busy(&e, 25, now));

        // Inactivité > grace, busy → libéré (process pi figé).
        let e = state_at(26 * 60, true); // 26 min > 25 min
        assert!(should_release_stale_busy(&e, 25, now));

        // Seuil min 1 min : inactivité > 1 min suffit.
        let e = state_at(90, true);
        assert!(should_release_stale_busy(&e, 1, now));
    }

    /// Garde d'exclusivité moteur : `busy_entry_is_exclusive` n'accorde
    /// l'exclusivité qu'au TRAVAIL RÉEL (busy non périmé). Un busy fantôme
    /// (process figé) libère le verrou → la relance démarre réellement au lieu
    /// d'être refusée par la garde Rust (faux « lancé »). Une attente de réponse
    /// utilisateur reste exclusive (état légitime, pas un blocage).
    #[test]
    fn busy_entry_is_exclusive_requires_fresh_work() {
        let now = Instant::now() + Duration::from_secs(100_000);
        let state_at = |idle_secs: u64, busy: bool, awaiting_user: bool| AgentAnomalyState {
            last_activity: now - Duration::from_secs(idle_secs),
            last_progress: now - Duration::from_secs(idle_secs),
            last_activity_wall: Some(SystemTime::now()),
            last_event: "agent_start".to_string(),
            busy,
            blocked_reported: false,
            auto_stopped_reported: false,
            awaiting_user,
            tool_in_progress: false,
            produced_output: false,
        };

        // busy frais (< grace) → exclusif : une run réellement en cours.
        assert!(busy_entry_is_exclusive(&state_at(10, true, false), 25, now));
        // busy périmé (> grace) → non exclusif : verrou libéré, relance autorisée.
        assert!(!busy_entry_is_exclusive(&state_at(26 * 60, true, false), 25, now));
        // Attente de réponse utilisateur → jamais périmé (état légitime).
        assert!(busy_entry_is_exclusive(&state_at(26 * 60, true, true), 25, now));
        // settled (busy=false) → non exclusif, réutilisable.
        assert!(!busy_entry_is_exclusive(&state_at(10, false, false), 25, now));
    }

    /// Bug « question sans réponse > seuil » : une question interactive
    /// (`extension_ui_request`) pose le marqueur `awaiting_user`, qui SUSPEND
    /// l'arrêt automatique (T2), le plafond de l'Assistant (via should_auto_stop)
    /// et la libération du créneau « run fantôme ». Le marqueur est levé par le
    /// premier événement d'activité suivant (réponse traitée) ou par un
    /// événement de cycle de vie (agent_start/agent_end/agent_settled).
    #[test]
    fn observer_marks_and_clears_awaiting_user_on_ui_request() {
        let activity: Arc<Mutex<HashMap<String, SessionActivity>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let anomaly: Arc<Mutex<HashMap<String, AgentAnomalyState>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let obs = make_observer(&activity, &anomaly, "/proj", "/proj\u{1f}codeur");

        // agent_start puis question interactive → marqueur posé, agent toujours busy.
        obs(&ev("agent_start"));
        obs(&ev("extension_ui_request"));
        {
            let a = anomaly.lock().unwrap();
            let s = a.get("/proj\u{1f}codeur").unwrap();
            assert!(s.awaiting_user, "question posée → attente utilisateur marquée");
            assert!(s.busy, "l'agent reste actif pendant l'attente");
            assert_eq!(s.last_event, "extension_ui_request");
        }

        // Réponse traitée → le tour reprend : le prochain événement lève le marqueur.
        obs(&ev("tool_execution_end"));
        {
            let a = anomaly.lock().unwrap();
            assert!(
                !a.get("/proj\u{1f}codeur").unwrap().awaiting_user,
                "activité suivante → attente levée (réponse traitée)"
            );
        }

        // Fin de tour → marqueur levé même sans événement intermédiaire.
        obs(&ev("extension_ui_request"));
        obs(&ev("agent_settled"));
        {
            let a = anomaly.lock().unwrap();
            let s = a.get("/proj\u{1f}codeur").unwrap();
            assert!(!s.awaiting_user, "agent_settled → attente levée");
            assert!(!s.busy, "agent_settled → plus busy");
        }
    }

    /// Bug « question sans réponse > seuil » : tant que `awaiting_user` est posé,
    /// AUCUNE décision automatique (arrêt T2, plafond Assistant, libération du
    /// créneau fantôme) ne se déclenche, même après une inactivité très longue.
    /// Dès que le marqueur est levé, l'arrêt redevient déclenchable au-delà du
    /// seuil (aucune régression du filet de sécurité).
    #[test]
    fn awaiting_user_suspends_auto_stop_and_stale_release() {
        let now = Instant::now() + Duration::from_secs(100_000);
        // 100 min d'inactivité, busy, non arrêté, selon l'attente utilisateur.
        let state = |awaiting_user: bool| AgentAnomalyState {
            last_activity: now - Duration::from_secs(6000),
            last_progress: now - Duration::from_secs(6000),
            last_activity_wall: Some(SystemTime::now()),
            last_event: "extension_ui_request".to_string(),
            busy: true,
            blocked_reported: false,
            auto_stopped_reported: false,
            awaiting_user,
            tool_in_progress: false,
            produced_output: false,
        };

        // (a) En attente de réponse utilisateur → aucune décision automatique.
        let waiting = state(true);
        assert!(!should_auto_stop(&waiting, true, 10, now), "attente → pas d'arrêt T2");
        assert!(
            !should_auto_stop_on_progress(&waiting, true, 10, now),
            "attente → pas d'arrêt (progression)"
        );
        assert!(
            !should_release_stale_busy(&waiting, 25, now),
            "attente → créneau fantôme non libéré"
        );

        // (b) Après la réponse (marqueur levé) → arrêt redevient déclenchable.
        let answered = state(false);
        assert!(should_auto_stop(&answered, true, 10, now), "réponse puis blocage → arrêt");
        assert!(
            should_auto_stop_on_progress(&answered, true, 10, now),
            "réponse puis blocage → arrêt (progression)"
        );
        assert!(
            should_release_stale_busy(&answered, 25, now),
            "réponse puis blocage → créneau libéré"
        );

        // (c) Non-régression : une session bloquée SANS question en attente est
        // toujours traitée comme avant (filet de sécurité intact).
        let blocked = state(false);
        assert!(should_auto_stop(&blocked, true, 10, now));
    }

    /// Lot 3 (défaut A) : une session MUETTE ET INACTIVE (busy, aucun résultat
    /// produit, aucune activité réelle depuis le seuil) est SIGNALÉE — et une
    /// seule fois (le verrou `blocked_reported`, posé par le moniteur, empêche
    /// toute répétition en boucle). Déterministe : `now` synthétique, aucune
    /// horloge réelle.
    #[test]
    fn should_report_silent_session_flags_mute_inactive_session_once() {
        let now = Instant::now() + Duration::from_secs(100_000);
        let mute = AgentAnomalyState {
            last_activity: now - Duration::from_secs(3600), // 60 min sans activité
            last_progress: now - Duration::from_secs(3600),
            last_activity_wall: Some(SystemTime::now()),
            last_event: "agent_start".to_string(),
            busy: true,
            blocked_reported: false,
            auto_stopped_reported: false,
            awaiting_user: false,
            tool_in_progress: false,
            produced_output: false,
        };
        assert!(
            should_report_silent_session(&mute, true, 30, now),
            "busy + aucun résultat + 60 min sans activité → signalée (cas muet)"
        );
        // Une fois signalée (verrou posé par le moniteur) → plus jamais.
        let reported = AgentAnomalyState {
            blocked_reported: true,
            ..mute
        };
        assert!(
            !should_report_silent_session(&reported, true, 30, now),
            "un seul signalement par exécution : pas de répétition en boucle"
        );
        // Détection désactivée → jamais signalée.
        let mute = AgentAnomalyState {
            blocked_reported: false,
            ..reported
        };
        assert!(!should_report_silent_session(&mute, false, 30, now));
    }

    /// Lot 3 (défaut A) : AUCUN faux positif — une session qui a livré un résultat,
    /// qui travaille encore (activité récente), qui est au repos, qui attend
    /// l'utilisateur ou qui exécute un outil n'est JAMAIS signalée comme muette.
    #[test]
    fn should_report_silent_session_never_flags_productive_or_fresh_session() {
        let now = Instant::now() + Duration::from_secs(100_000);
        let state_at = |idle_secs: u64, busy: bool, produced: bool| AgentAnomalyState {
            last_activity: now - Duration::from_secs(idle_secs),
            last_progress: now - Duration::from_secs(idle_secs),
            last_activity_wall: Some(SystemTime::now()),
            last_event: "message_start".to_string(),
            busy,
            blocked_reported: false,
            auto_stopped_reported: false,
            awaiting_user: false,
            tool_in_progress: false,
            produced_output: produced,
        };
        // (a) a déjà livré un résultat → JAMAIS (faux positif « en échec après
        // avoir livré » rendu impossible, même si le dernier événement est un
        // simple `message_start`).
        assert!(
            !should_report_silent_session(&state_at(3600, true, true), true, 30, now),
            "session ayant livré un résultat → jamais signalée"
        );
        // (b) activité récente (5 min < seuil) → « longue mais qui travaille ».
        assert!(
            !should_report_silent_session(&state_at(300, true, false), true, 30, now),
            "activité récente → jamais signalée"
        );
        // (c) session terminée / au repos.
        assert!(
            !should_report_silent_session(&state_at(3600, false, false), true, 30, now),
            "session au repos → jamais signalée"
        );
        // (d) opération d'outil en cours (silence légitime).
        let working = AgentAnomalyState {
            tool_in_progress: true,
            ..state_at(3600, true, false)
        };
        assert!(
            !should_report_silent_session(&working, true, 30, now),
            "outil en cours → jamais signalée"
        );
        // (e) question posée à l'utilisateur, en attente de réponse.
        let waiting = AgentAnomalyState {
            awaiting_user: true,
            ..state_at(3600, true, false)
        };
        assert!(
            !should_report_silent_session(&waiting, true, 30, now),
            "attente utilisateur → jamais signalée"
        );
    }
}
