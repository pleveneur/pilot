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
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
#[cfg(test)]
use std::sync::MutexGuard;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::agent::{Agent, AgentProcessState, AgentView};
use crate::anomaly;
use crate::db;
use crate::rpc::{agent_event_channel, probe_backend, probe_extension_support};
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

/// Pseudo-projet réservé pour les « agents d'assistant » (tâche #140) :
/// délégués par le super-agent à des agents SANS les rattacher à un projet.
/// Jeton réservé distinct du `""` du super-agent et ne pouvant jamais être un
/// vrai chemin de projet (aucune collision de clé possible). Les sessions de
/// ces agents sont stockées dans le registre unique sous la clé composite
/// `ASSISTANT_SPACE\u{1f}<agent_id>`, mais le processus pi tourne dans
/// l'espace de travail assistant `~/.pilot/assistant/...`.
pub const ASSISTANT_SPACE: &str = "__assistant__";

/// Canal d'événements dédié au super-agent (isolé des canaux projet/agents).
const SUPERAGENT_CHANNEL: &str = "rpc-event-superagent";

/// Id d'agent dédié de l'assistant de groupe (GDS Phase C2) dans le registre
/// unique. Session RPC dédiée (canal `rpc-event-group`, extension
/// pilot-group-assistant), globale (multi-projets) : stockée sous un projet
/// pseudo-global "". Lecture seule stricte : répond aux questions sur les
/// projets du groupe en lisant le suivi fusionné (clients, projets, tâches,
/// décisions) sans jamais modifier le code.
pub const GROUP_ASSISTANT_ID: &str = "groupassistant";

/// Canal d'événements dédié à l'assistant de groupe (isolé des canaux
/// projet/agents et du super-agent).
const GROUP_ASSISTANT_CHANNEL: &str = "rpc-event-group";

/// Fenêtre (s) dans laquelle la mort du processus super-agent après son
/// démarrage est considérée comme un CRASH (mort anormale) plutôt qu'un arrêt
/// volontaire ou une mort tardive. Anti-boucle de démarrage (bug onglet
/// Assistant) : un processus qui meurt vite après son lancement signale un
/// crash à répétition qu'on ne doit pas relancer en boucle.
const SUPERAGENT_CRASH_WINDOW: Duration = Duration::from_secs(20);
/// Nombre de crashs rapides consécutifs tolérés avant de BLOQUER le redémarrage
/// automatique. Après ce seuil, le super-agent reste arrêté (cooldown) au lieu
/// de relancer le processus indéfiniment.
const SUPERAGENT_MAX_CRASHES: u32 = 3;
/// Durée (s) de blocage du redémarrage automatique après trop de crashs
/// consécutifs. Pendant ce délai, `start_superagent` renvoie une erreur claire
/// (état d'erreur) au lieu de relancer le processus.
const SUPERAGENT_RESTART_COOLDOWN: Duration = Duration::from_secs(30);

/// Statut du chargement des extensions du super-agent (source des outils de
/// l'assistant), enregistré au spawn de la session (tâche #136). Permet au
/// frontend de détecter une ABSENCE d'outils (anomalie) : si la porte
/// `probe_extension_support` échoue ou qu'aucune extension assistant n'est
/// construite, l'assistant n'a AUCUN outil et ne peut que réfléchir.
/// `probe_failed` distingue « sonde échouée (statut indéterminé) » de
/// « sonde OK mais 0 extension » : sur un statut indéterminé, le frontend
/// n'affiche PAS la bannière d'anomalie (évite le faux positif).
#[derive(Clone, Copy, Debug)]
pub struct SuperAgentExtStatus {
    pub ext_supported: bool,
    pub extensions_built: usize,
    pub probe_failed: bool,
}

/// Politique anti-boucle de redémarrage du super-agent. Logique PURE et
/// testable : ne dépend d'aucun processus, uniquement des horodatages.
/// - `crash_count` : crashs rapides consécutifs observés.
/// - `blocked_until` : instant jusqu'auquel le redémarrage est bloqué (après
///   avoir dépassé `SUPERAGENT_MAX_CRASHES`).
#[derive(Clone, Copy, Debug)]
struct SuperAgentCrashPolicy {
    crash_count: u32,
    blocked_until: Option<Instant>,
}

impl SuperAgentCrashPolicy {
    /// Enregistre la mort du processus. `last_start` est l'instant du dernier
    /// démarrage (None si jamais démarré). Une mort rapide après le démarrage =
    /// crash → incrémente le compteur ; au-delà du seuil, bloque le redémarrage
    /// pendant le cooldown. Une mort tardive (ou sans démarrage connu)
    /// réinitialise le compteur (arrêt propre / volontaire).
    fn record_death(&mut self, last_start: Option<Instant>, now: Instant) {
        let crashed_quickly = match last_start {
            Some(t) => now.duration_since(t) <= SUPERAGENT_CRASH_WINDOW,
            None => false,
        };
        if !crashed_quickly {
            self.crash_count = 0;
            return;
        }
        self.crash_count += 1;
        if self.crash_count >= SUPERAGENT_MAX_CRASHES {
            self.blocked_until = Some(now + SUPERAGENT_RESTART_COOLDOWN);
            self.crash_count = 0; // remet à zéro pour une future fenêtre propre
        }
    }

    /// Secondes restantes avant la levée du blocage de redémarrage. Retourne
    /// None si non bloqué (ou si le cooldown est expiré → lève le blocage).
    fn blocked_remaining(&mut self, now: Instant) -> Option<u64> {
        if let Some(t) = self.blocked_until {
            if now < t {
                return Some(t.duration_since(now).as_secs());
            }
            self.blocked_until = None; // cooldown expiré → autorise à nouveau
        }
        None
    }
}

/// Mode de démarrage d'une session : session principale (chat Agent Pi /
/// multi-onglets, canal projet) ou agent multi-rôles H2 V2 (canal
/// rpc-event-agents).
#[derive(Clone, Copy, PartialEq)]
pub enum SpawnMode {
    /// Session principale (chat Agent Pi / multi-onglets) — canal projet.
    MainSession,
    /// Agent multi-rôles H2 V2 — canal rpc-event-agents.
    AgentProcess,
    /// Agent d'assistant (tâche #140) : délégué par le super-agent sans
    /// rattachement à un projet. Stocké sous la clé `ASSISTANT_SPACE`, tourne
    /// dans `~/.pilot/assistant/`. Canal rpc-event-agents, extensions assistant
    /// lecture seule (pas de porte pré-écriture ni d'injection de contexte projet).
    AssistantAgent,
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
    // Anti-boucle de redémarrage (bug démarrage Assistant) : instant du dernier
    // démarrage du processus super-agent + politique de crash (compteur de
    // crashs rapides consécutifs + cooldown de blocage). Empêche de relancer
    // indéfiniment une session qui crashé en boucle au démarrage.
    superagent_last_start: Mutex<Option<Instant>>,
    superagent_policy: Mutex<SuperAgentCrashPolicy>,
    // Anti-course (bug onglet Assistant) : sérialise `start_superagent`. Le
    // spawn (écriture des extensions + lancement du process pi) se fait hors du
    // verrou `sessions` ; sans ce mutex, deux commandes concurrentes
    // (start_super_agent_session + get_super_agent_state à l'ouverture de
    // l'onglet) passent toutes les deux le check « aucun processus vivant »,
    // spawnent chacune un processus, et le second écrasait le premier → le
    // RpcSession orphelin ferme ses pipes → `process_exit` fantôme
    // (« Connexion au super-agent perdue ») et relance en boucle.
    superagent_start_lock: Mutex<()>,
    // 5.1 : handle d'application posé au setup, nécessaire pour émettre les
    // événements `agent-state-changed` depuis les transitions de session
    // (start/pause/stop) qui ne reçoivent pas `app` en paramètre.
    app: Mutex<Option<AppHandle>>,
    // Tâche #136 : statut des extensions du super-agent au dernier spawn
    // (source des outils de l'assistant). None tant que la session n'a jamais
    // été lancée. Lu par le frontend pour détecter une absence d'outils.
    superagent_ext: Mutex<Option<SuperAgentExtStatus>>,
    // Défaut B : map d'état du moniteur d'anomalies partagée avec l'AppState
    // (clé composite `project\u{1f}agent`). Posée au setup par
    // `set_anomaly_map`. Sert à purger la marque d'occupation `busy` À L'ARRÊT
    // d'une session : sans cette purge, une session arrêtée (volontairement ou
    // automatiquement) reste comptée « travailleuse » (busy=true + lastActivity
    // récent), ce qui met les demandes suivantes en file d'attente au lieu de
    // les démarrer et maintient le faux verrou « Une run est déjà en cours ».
    anomaly_map: Mutex<Option<Arc<Mutex<HashMap<String, anomaly::AgentAnomalyState>>>>>,
    // Mission en cours (affichage) : DERNIER prompt réellement envoyé à chaque
    // session, clé composite identique à `sessions`, texte déjà tronqué
    // (`PROMPT_SNAPSHOT_MAX_CHARS`). Alimenté au passage OBLIGÉ de l'envoi
    // (`send` / `send_sync` / `send_sync_timeout`), lu par `list_agent_sessions`.
    // Purement informatif : n'influence aucune décision du service.
    last_prompts: Mutex<HashMap<String, String>>,
    // RÉSUMÉ COURT de la mission en cours (affichage) : phrase fournie AVEC la
    // demande (champ `pilotResume`, ≤ `MISSION_RESUME_MAX_CHARS`), clé composite
    // identique à `sessions`. Il n'est jamais déduit du prompt : absent → entrée
    // absente (le panneau retombe alors sur l'extraction de l'objectif). Un
    // prompt SANS résumé efface l'entrée : aucun résumé périmé n'est attribué à
    // une autre mission. Purement informatif, comme `last_prompts`.
    last_resumes: Mutex<HashMap<String, String>>,
    // Identité de session (uid) : compteur monotone attribué à chaque NOUVEAU
    // spawn, clé composite identique à `sessions`. Sert aux commandes d'ARRÊT et
    // d'ABANDON : l'appelant fournit l'uid de la session qu'il a lui-même
    // lancée ; si la session en place porte un autre uid (relance du même
    // couple (projet, agent) par un autre chemin), la commande est REFUSÉE.
    // Sans cette garde, un minuteur ou un moniteur périmé d'une run précédente
    // pouvait avorter la session flambant neuve du même agent — symptôme
    // « l'agent commence et s'arrête aussitôt ».
    session_uids: Mutex<HashMap<String, u64>>,
    // AGENT JETABLE (agent éphémère) : définitions d'agents fournies À LA VOLÉE
    // (rôle écrit dans la demande de l'assistant), gardées **en mémoire seule**.
    // Aucune ligne n'est écrite dans la table `agents` : l'agent n'entre donc
    // jamais dans le registre que l'utilisateur voit (`list_agents` lit la base)
    // et cesse d'exister dès sa purge (fin de tâche).
    //
    // Consommateur unique : `get_agent`, qui RETOMBE sur cette map quand la base
    // ne connaît pas l'identifiant. C'est ce repli qui empêche `start` de
    // « seeder » une ligne en base pour un agent non persistant.
    ephemeral_agents: Mutex<HashMap<String, Agent>>,
}

/// Séquence des identités de session (uid). Monotone sur toute la vie du
/// processus : un uid n'est jamais réutilisé, même après des milliers de spawns.
static SESSION_UID_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

/// Attribue un nouvel uid de session.
fn next_session_uid() -> u64 {
    use std::sync::atomic::Ordering;
    SESSION_UID_SEQ.fetch_add(1, Ordering::SeqCst)
}

/// Décision PURE de propriété de session (testable sans AppHandle).
///
/// - `expected = None` : aucun contrôle (comportement historique : UI « arrêter »,
///   fermeture de projet, arrêt de l'application).
/// - session ABSENTE (`current = None`) : toujours accepté — il n'y a rien à
///   arrêter, et refuser rendrait les commandes d'arrêt fragiles.
/// - session PRÉSENTE : acceptée seulement si son uid est exactement celui
///   attendu ; sinon une autre exécution a relancé le couple (projet, agent) et
///   la commande doit être refusée (ne jamais tuer le travail d'un autre).
pub fn session_ownership_allows(expected: Option<u64>, current: Option<u64>) -> bool {
    match expected {
        None => true,
        Some(uid) => current.is_none() || current == Some(uid),
    }
}

/// P0 (issue #84) diagnostic d'échec rapide du super-agent : si `.pi/extensions/`
/// contient au moins une extension projet, celle-ci (Pilot ne la charge PAS —
/// pi la découvre) peut faire crasher le process pi à l'import si des
/// dépendances npm manquent. Retourne un court avertissement, ou None. Fail-open :
/// purement un indicateur de diagnostic, ne bloque jamais le lancement.
fn project_extension_diag_hint(cwd: &str) -> Option<String> {
    let ext_dir = std::path::Path::new(cwd).join(".pi").join("extensions");
    if !ext_dir.is_dir() {
        return None;
    }
    let has_ext = std::fs::read_dir(&ext_dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| e.path().is_dir())
                .count()
                > 0
        })
        .unwrap_or(false);
    if !has_ext {
        return None;
    }
    Some(
        "Une ou plusieurs extensions projet (.pi/extensions) sont présentes. \
         Si une extension déclare des dépendances npm manquantes, pi peut crasher \
         à l'import (la cause est visible dans le stderr ci-dessus).".to_string(),
    )
}

/// Longueur maximale (en CARACTÈRES, jamais en octets) du texte de mission
/// conservé par session pour l'affichage « missions en cours ».
///
/// 600 (et non 80) : un prompt de délégation commence par le RÔLE, puis par les
/// blocs `=== SPÉCIALITÉ ===` / `=== RÔLE ===` / `=== CONTEXTE PROJET ===` — la
/// mission réelle n'apparaît qu'ensuite (souvent après 600 à 1 500 caractères).
/// Une coupe à 80 ne contenait donc JAMAIS la mission (panneau affichant un
/// repli inutile). On ne stocke pas le prompt entier pour autant.
const PROMPT_SNAPSHOT_MAX_CHARS: usize = 600;

/// Marqueurs de début de la MISSION dans un prompt de délégation, du plus
/// précis au plus général. La fenêtre conservée est ANCRÉE sur le premier de ces
/// marqueurs présent après le préambule de rôle : la mission est ainsi toujours
/// dans le champ transmis au panneau, sans conserver le prompt entier.
///
/// ⚠️ Un marqueur ne compte QUE s'il **commence une ligne** (cf.
/// `find_anchor_at_line_start`) : c'est un titre de section, pas une citation.
/// Le prompt système de l'assistant CITE « ## Objectif » au milieu d'une phrase
/// de règle ; ancrer sur cette citation faisait démarrer la fenêtre au beau
/// milieu des règles et le panneau affichait « Si une tâche déléguée ou une
/// action échoue… » au lieu d'une tâche (défaut corrigé).
const MISSION_ANCHORS: [&str; 4] = ["## Objectif", "Objectif :", "=== MISSION ===", "Tâche :"];

/// Position (en CARACTÈRES) de la première occurrence de `anchor` qui **commence
/// une ligne** — début du texte, ou précédée d'un retour à la ligne (espaces et
/// tabulations d'indentation tolérés).
///
/// Toute autre occurrence (citation d'un titre à l'intérieur d'une phrase, par
/// exemple « l'enveloppe « ## Objectif/## Consignes » est ajoutée par Pilot »)
/// est IGNORÉE : un marqueur de structure ne structure rien au milieu d'une
/// phrase. C'est ce qui empêche l'extraction de mission de tomber dans un bloc
/// de RÈGLES (cas du prompt de l'assistant).
fn find_anchor_at_line_start(text: &str, anchor: &str) -> Option<usize> {
    if anchor.is_empty() {
        return None;
    }
    let mut from = 0usize;
    while from < text.len() {
        let idx = from + text[from..].find(anchor)?;
        // Début de la ligne contenant `idx` : uniquement des espaces/tabulations
        // entre les deux → l'ancre EST un début de ligne (indentation tolérée).
        let line_start = text[..idx].rfind('\n').map(|p| p + 1).unwrap_or(0);
        if text[line_start..idx]
            .chars()
            .all(|c| c == ' ' || c == '\t')
        {
            return Some(text[..idx].chars().count());
        }
        from = idx + anchor.len();
    }
    None
}

/// Nom du champ ADDITIF par lequel l'appelant joint un **RÉSUMÉ COURT** à une
/// demande (une phrase qui dit la tâche réelle, ≤ `MISSION_RESUME_MAX_CHARS`).
///
/// Ce champ est PROPRE À PILOT : il n'appartient pas au protocole RPC de pi et
/// est donc **retiré de la commande** avant son écriture vers le moteur (voir
/// `prompt_resume` / `strip_resume_field`). Il est conservé par session pour que
/// le panneau des tâches l'affiche EN PREMIER, sans avoir à le déduire du prompt.
pub const MISSION_RESUME_FIELD: &str = "pilotResume";

/// Longueur maximale (en CARACTÈRES) du résumé court fourni avec une demande.
/// Même plafond que l'affichage (JS `MISSION_MAX_CHARS` = 120) : une phrase.
pub const MISSION_RESUME_MAX_CHARS: usize = 120;

/// Construit une commande de prompt à partir du message et du RÉSUMÉ COURT
/// facultatif fourni avec la demande.
///
/// Le résumé est normalisé (`normalize_mission_resume`) : espaces et retours à
/// la ligne réduits à une espace, plafonné à `MISSION_RESUME_MAX_CHARS` et coupé
/// proprement sur un mot. Un résumé **absent ou inutilisable** n'ajoute AUCUN
/// champ : la commande est alors exactement celle d'avant (compatibilité
/// totale des appels existants).
pub fn prompt_command_with_resume(message: &str, resume: Option<&str>) -> Value {
    let mut cmd = serde_json::json!({ "type": "prompt", "message": message });
    if let Some(text) = resume.and_then(normalize_mission_resume) {
        cmd[MISSION_RESUME_FIELD] = Value::String(text);
    }
    cmd
}

/// Normalise le résumé court FOURNI par l'appelant. `None` quand rien
/// d'utilisable n'est fourni : on n'invente jamais de résumé.
pub fn normalize_mission_resume(raw: &str) -> Option<String> {
    let flat = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.is_empty() {
        return None;
    }
    let chars: Vec<char> = flat.chars().collect();
    if chars.len() <= MISSION_RESUME_MAX_CHARS {
        return Some(flat);
    }
    // Coupe PROPRE : on recule jusqu'à une frontière de mot (jamais au milieu
    // d'un mot), sauf si cela amputait plus de la moitié du texte.
    let min_keep = MISSION_RESUME_MAX_CHARS / 2;
    let mut end = MISSION_RESUME_MAX_CHARS;
    for i in (min_keep..MISSION_RESUME_MAX_CHARS).rev() {
        if chars[i].is_whitespace() {
            end = i;
            break;
        }
    }
    let kept: String = chars[..end].iter().collect();
    let kept = kept.trim().trim_end_matches([' ', ',', ';', ':', '.', '!', '?', '-']).trim();
    if kept.is_empty() {
        let fallback: String = chars[..MISSION_RESUME_MAX_CHARS].iter().collect();
        return Some(format!("{}…", fallback.trim()));
    }
    Some(format!("{}…", kept))
}

/// Résumé court porté par une commande de prompt.
///
/// - `None` : la commande n'est **pas** un prompt (`get_state`, `set_model`, …) →
///   on ne touche à rien (le résumé conservé n'est pas écrasé) ;
/// - `Some(None)` : c'est un prompt **sans** résumé → l'ancien résumé de la
///   session est **effacé** (jamais un résumé périmé attribué à une autre
///   mission) ;
/// - `Some(Some(r))` : résumé fourni, nettoyé et plafonné.
fn prompt_resume(command: &Value) -> Option<Option<String>> {
    if command.get("type").and_then(|t| t.as_str()) != Some("prompt") {
        return None;
    }
    let raw = command
        .get(MISSION_RESUME_FIELD)
        .and_then(|r| r.as_str())
        .unwrap_or("");
    Some(normalize_mission_resume(raw))
}

/// Retire le champ résumé de la commande AVANT son écriture vers pi : c'est un
/// champ de PILOT, pas du protocole RPC. Sans cela, un moteur strict pourrait
/// refuser une commande contenant un champ inconnu.
fn strip_resume_field(command: &mut Value) {
    if let Some(obj) = command.as_object_mut() {
        obj.remove(MISSION_RESUME_FIELD);
    }
}

/// Extrait de quoi afficher la mission en cours d'un envoi vers une session.
/// Retourne `None` pour toute commande qui n'est PAS un prompt (`get_state`,
/// `set_model`, …) : le dernier prompt connu n'est alors jamais écrasé.
/// Un prompt à texte vide reste un prompt (chaîne vide) : l'affichage applique
/// alors son repli explicite — jamais une ancienne mission conservée à tort.
///
/// Un prompt plus long que `PROMPT_SNAPSHOT_MAX_CHARS` est réduit à une fenêtre
/// de cette taille qui DÉMARRE sur la mission (cf. `MISSION_ANCHORS`) ; à défaut
/// de marqueur, la fenêtre démarre au début du prompt. La coupe est signalée
/// par « … ».
fn prompt_snapshot(command: &Value) -> Option<String> {
    if command.get("type").and_then(|t| t.as_str()) != Some("prompt") {
        return None;
    }
    // Formats acceptés : `message` (format pi RPC) ou `prompt` (repli).
    let text = command
        .get("message")
        .and_then(|m| m.as_str())
        .or_else(|| command.get("prompt").and_then(|m| m.as_str()))
        .unwrap_or("")
        .trim();
    let total = text.chars().count();
    if total <= PROMPT_SNAPSHOT_MAX_CHARS {
        return Some(text.to_string());
    }
    // Ancrage sur la mission : position (en caractères) du marqueur le plus
    // précis présent EN DÉBUT DE LIGNE (un titre de section, jamais une citation
    // dans une phrase de règle), sinon 0 (début du prompt).
    let start = MISSION_ANCHORS
        .iter()
        .find_map(|anchor| find_anchor_at_line_start(text, anchor))
        .unwrap_or(0);
    let mut out: String = text.chars().skip(start).take(PROMPT_SNAPSHOT_MAX_CHARS).collect();
    out.push('…');
    Some(out)
}

/// Longueur maximale (en CARACTÈRES) du NOM D'AFFICHAGE d'un agent publié par
/// la supervision (`get_agent_supervision`, champ ADDITIF `name`).
///
/// Le nom sert UNIQUEMENT à l'affichage (liste d'activité, panneau des tâches,
/// onglet de l'agent) : l'identité technique reste le champ `agent` (pour un
/// agent jetable, `eph-<base36>-<hex>`), employée par toutes les actions
/// (arrêt ciblé, ouverture d'onglet, horodatage d'activité).
///
/// C'est la SEULE source de vérité de cette limite : le « … » de coupe est
/// COMPRIS dedans, donc un nom publié ne dépasse jamais 40 caractères.
pub const AGENT_DISPLAY_NAME_MAX_CHARS: usize = 40;

/// Borne un nom d'affichage à `max_chars` caractères AU TOTAL (jamais en
/// octets), marque de coupe « … » COMPRISE.
///
/// Coupe PROPRE : on recule jusqu'à une frontière de mot (espace) sauf si cela
/// amputait plus de la moitié du texte ; la coupe est signalée par « … », qui
/// occupe la dernière place du budget. Un nom plus long que la limite tient
/// donc dans `max_chars` caractères exactement (`max_chars + 1` avant ce
/// correctif : la limite annoncée par la documentation était dépassée de 1).
/// Un nom déjà assez court est renvoyé tel quel (espaces de bord retirés).
pub fn clip_agent_display_name(name: &str, max_chars: usize) -> String {
    let text = name.trim();
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= max_chars {
        return text.to_string();
    }
    if max_chars == 0 {
        return String::new();
    }
    // Le « … » de coupe est DANS le budget : le texte gardé laisse une place.
    let budget = max_chars - 1;
    let min_keep = budget / 2;
    let mut end = budget;
    for i in (min_keep..budget).rev() {
        if chars[i] == ' ' {
            end = i;
            break;
        }
    }
    let kept: String = chars[..end].iter().collect();
    let kept = kept.trim();
    if kept.is_empty() {
        // Budget d'un seul caractère (ou coupe impossible) : le marqueur seul.
        return "…".to_string();
    }
    format!("{}…", kept)
}

/// Préfixe RÉSERVÉ des identifiants d'**agents jetables** (éphémères).
///
/// Un agent jetable ne peut PAS s'en passer (il prendrait sinon l'identifiant
/// d'un agent du registre, que le repli mémoire de `get_agent` masquerait), et
/// un agent du registre ne peut PAS le porter : les deux espaces d'identifiants
/// restent ainsi disjoints. Miroir JS : `EPHEMERAL_AGENT_PREFIX`
/// (`src/js/ephemeral-agents.js`).
pub const EPHEMERAL_AGENT_PREFIX: &str = "eph-";

/// Vrai si `agent_id` porte le préfixe réservé des agents jetables. PURE.
pub fn is_ephemeral_agent_id(agent_id: &str) -> bool {
    agent_id.trim().starts_with(EPHEMERAL_AGENT_PREFIX)
}

/// Ajoute (si pertinent) l'avertissement d'extensions projet au message d'erreur.
/// Fail-open : sans `.pi/extensions`, renvoie le message tel quel.
fn append_ext_diag_hint(cwd: &str, msg: String) -> String {
    match project_extension_diag_hint(cwd) {
        Some(hint) => format!("{} — {}", msg, hint),
        None => msg,
    }
}

impl AgentService {
    pub fn new() -> Self {
        AgentService {
            sessions: Mutex::new(HashMap::new()),
            active: Mutex::new(None),
            app: Mutex::new(None),
            superagent_last_start: Mutex::new(None),
            superagent_policy: Mutex::new(SuperAgentCrashPolicy {
                crash_count: 0,
                blocked_until: None,
            }),
            superagent_start_lock: Mutex::new(()),
            superagent_ext: Mutex::new(None),
            anomaly_map: Mutex::new(None),
            last_prompts: Mutex::new(HashMap::new()),
            last_resumes: Mutex::new(HashMap::new()),
            session_uids: Mutex::new(HashMap::new()),
            ephemeral_agents: Mutex::new(HashMap::new()),
        }
    }

    // ── Agents jetables (éphémères, en mémoire seule) ──

    /// Enregistre un **agent jetable** : la définition vit en MÉMOIRE seule,
    /// aucune écriture en base. Elle est consultable par `get_agent` (repli) et
    /// n'apparaît jamais dans `list_agents` (qui lit la table `agents`).
    ///
    /// Le PREFIXE RÉSERVÉ (`EPHEMERAL_AGENT_PREFIX`) est vérifié ICI, à
    /// l'écriture : un agent jetable ne peut pas prendre l'identifiant d'un
    /// agent du registre (il le masquerait par le repli mémoire de `get_agent`).
    ///
    /// La durée de vie est celle de la tâche : l'appelant la purge à la fin
    /// (`clear_ephemeral_agent`), et l'arrêt de sa session la purge aussi.
    pub fn register_ephemeral_agent(&self, agent: Agent) -> Result<Agent, String> {
        let id = agent.id.trim().to_string();
        if id.is_empty() {
            return Err("Agent jetable : identifiant requis".to_string());
        }
        if !is_ephemeral_agent_id(&id) {
            return Err(format!(
                "Agent jetable : l'identifiant doit porter le préfixe réservé « {} » (reçu : {})",
                EPHEMERAL_AGENT_PREFIX, id
            ));
        }
        // Un agent éphémère n'est jamais « visible » : il n'est pas un onglet du
        // registre. (Il reste listé comme SESSION pendant qu'il travaille.)
        let mut stored = agent;
        stored.id = id;
        stored.visible = false;
        stored.loaded = false;
        stored.busy = false;
        self.ephemeral_agents
            .lock()
            .unwrap()
            .insert(stored.id.clone(), stored.clone());
        Ok(stored)
    }

    /// Vrai si l'identifiant désigne un agent jetable en mémoire.
    pub fn is_ephemeral_agent(&self, agent_id: &str) -> bool {
        self.ephemeral_agents.lock().unwrap().contains_key(agent_id)
    }

    /// NOM LISIBLE d'un agent jetable, pour l'AFFICHAGE seulement (champ
    /// ADDITIF `name` de `get_agent_supervision`), borné à
    /// `AGENT_DISPLAY_NAME_MAX_CHARS` caractères.
    ///
    /// Lecture **mémoire seule** (aucun accès base) : la supervision est pollée
    /// toutes les 2 s. `None` — et donc repli de l'affichage sur l'identifiant
    /// technique, comportement inchangé — dès que l'identifiant n'est pas un
    /// agent jetable en mémoire ou que son nom est vide.
    pub fn ephemeral_agent_name(&self, agent_id: &str) -> Option<String> {
        let name = {
            let map = self.ephemeral_agents.lock().unwrap();
            map.get(agent_id).map(|a| a.name.trim().to_string())
        }?;
        if name.is_empty() {
            return None;
        }
        Some(clip_agent_display_name(&name, AGENT_DISPLAY_NAME_MAX_CHARS))
    }

    /// Purge UN agent jetable (fin de tâche). Retourne `true` s'il existait.
    pub fn clear_ephemeral_agent(&self, agent_id: &str) -> bool {
        self.ephemeral_agents.lock().unwrap().remove(agent_id).is_some()
    }

    /// Purge TOUS les agents jetables. Retourne le nombre d'entrées retirées.
    pub fn clear_ephemeral_agents(&self) -> usize {
        let mut map = self.ephemeral_agents.lock().unwrap();
        let n = map.len();
        map.clear();
        n
    }

    /// Liste les agents jetables en mémoire (diagnostic / tests).
    pub fn list_ephemeral_agents(&self) -> Vec<Agent> {
        let mut out: Vec<Agent> = self.ephemeral_agents.lock().unwrap().values().cloned().collect();
        out.sort_by(|a, b| a.id.cmp(&b.id));
        out
    }

    /// Met à jour l'ENTRÉE MÉMOIRE d'un agent jetable (jamais la base) : état
    /// logique (`loaded`/`busy`/`proc_state`) et visibilité. No-op pour un agent
    /// du registre (retourne `false`).
    fn update_ephemeral(
        &self,
        agent_id: &str,
        apply: impl FnOnce(&mut Agent),
    ) -> bool {
        let mut map = self.ephemeral_agents.lock().unwrap();
        match map.get_mut(agent_id) {
            Some(a) => {
                apply(a);
                true
            }
            None => false,
        }
    }

    /// uid de la session courante d'un couple (projet, agent), s'il y en a une.
    pub fn session_uid(&self, project: &str, agent_id: &str) -> Option<u64> {
        self.session_uids
            .lock()
            .unwrap()
            .get(&Self::session_key(project, agent_id))
            .copied()
    }

    /// Garde de PROPRIÉTÉ (contrôle SEUL) : un appelant ne peut arrêter (ou
    /// avorter) que la session qu'il a lui-même lancée, identifiée par son uid.
    ///
    /// Conservée comme garde de LECTURE indépendante (diagnostic, tests) ; les
    /// chemins d'arrêt réels utilisent la version ATOMIQUE (contrôle + retrait /
    /// écriture dans la même section critique : `stop_owned`, `send_owned`), car
    /// un contrôle séparé de l'action laisse une fenêtre où la session a pu être
    /// remplacée entre-temps.
    ///
    /// `expected` à `None` conserve le comportement historique (aucun contrôle),
    /// pour les chemins qui ne connaissent pas d'uid (UI « arrêter », arrêt de
    /// projet, fermeture de l'application).
    ///
    /// Une session ABSENTE n'est jamais un conflit (il n'y a rien à arrêter).
    #[allow(dead_code)]
    pub fn check_session_ownership(
        &self,
        project: &str,
        agent_id: &str,
        expected: Option<u64>,
    ) -> Result<Option<u64>, String> {
        let current = self.session_uid(project, agent_id);
        let accepted = session_ownership_allows(expected, current);
        self.trace_session_op(
            if accepted { "propriete-ok" } else { "propriete-refusee" },
            project,
            agent_id,
            expected,
            current,
        );
        if !accepted {
            return Err(format!(
                "Session remplacée depuis le lancement (uid attendu {:?}, session en place {:?}) : commande refusée pour ne pas arrêter la session d'une autre exécution.",
                expected, current
            ));
        }
        Ok(current)
    }

    /// Trace (append) des opérations d'arrêt/abandon dans
    /// `<app_data_dir>/agent-ops.log` : sans cette trace, une interruption
    /// d'agent restait invisible (ni journal, ni événement). Rotation simple :
    /// le fichier est supprimé au-delà de 512 Ko. Fail-open silencieux.
    pub fn trace_session_op(
        &self,
        op: &str,
        project: &str,
        agent_id: &str,
        expected: Option<u64>,
        current: Option<u64>,
    ) {
        let app = self.app.lock().unwrap().clone();
        let Some(app) = app else { return };
        let Ok(dir) = app.path().app_data_dir() else { return };
        let path = dir.join("agent-ops.log");
        if let Ok(md) = std::fs::metadata(&path) {
            if md.len() > 512 * 1024 {
                let _ = std::fs::remove_file(&path);
            }
        }
        let line = format!(
            "{} op={} project={} agent={} expected={:?} current={:?}\n",
            chrono::Utc::now().to_rfc3339(),
            op,
            project,
            agent_id,
            expected,
            current
        );
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
        {
            use std::io::Write;
            let _ = f.write_all(line.as_bytes());
        }
    }

    /// 5.1 : pose le handle d'application (appelé au setup) pour permettre
    /// l'émission des événements `agent-state-changed` depuis les transitions
    /// de session (start/pause/stop).
    pub fn set_app_handle(&self, app: AppHandle) {
        *self.app.lock().unwrap() = Some(app);
    }

    /// Défaut B : partage la map d'état du moniteur d'anomalies avec
    /// l'`AppState` (appelé au setup), pour pouvoir purger la marque
    /// d'occupation `busy` à l'arrêt d'une session.
    pub fn set_anomaly_map(
        &self,
        map: Arc<Mutex<HashMap<String, anomaly::AgentAnomalyState>>>,
    ) {
        *self.anomaly_map.lock().unwrap() = Some(map);
    }

    /// Défaut B : remet à zéro la marque d'occupation `busy` du couple
    /// `(projet, agent)` dans la map d'anomalie (clé `project\u{1f}agent`).
    /// Appelé à l'arrêt d'une session (volontaire ou automatique) : une session
    /// arrêtée n'est plus un travail en cours, donc elle ne doit plus être
    /// comptée comme exclusive par la file d'attente ni maintenir le verrou de
    /// run. Ne crée AUCUNE entrée (idempotent si le couple est inconnu) et ne
    /// touche PAS aux seuils d'anomalie (25 min / 2 min).
    ///
    /// `tool_started_at` est remis à `None` en même temps que
    /// `tool_in_progress = false` : session arrêtée = aucun outil ouvert, donc
    /// aucune référence de départ ne doit subsister. La promesse « remis à None
    /// à TOUS les cas de fin » (borne dure de 60 min, cf. `anomaly.rs`) est ainsi
    /// vraie sur ce chemin d'arrêt comme sur les autres (fin de tour, `agent_start`,
    /// mort du process, libération pour outil perdu).
    pub fn clear_anomaly_busy(
        map: &Arc<Mutex<HashMap<String, anomaly::AgentAnomalyState>>>,
        project: &str,
        agent_id: &str,
    ) {
        let now = Instant::now();
        let wall = std::time::SystemTime::now();
        let mut m = map.lock().unwrap();
        if let Some(e) = m.get_mut(&format!("{}\u{1f}{}", project, agent_id)) {
            e.busy = false;
            e.blocked_reported = false;
            e.auto_stopped_reported = false;
            e.last_activity = now;
            e.last_progress = now;
            e.last_activity_wall = Some(wall);
            // Session arrêtée : plus aucune attente d'utilisateur ni outil en
            // cours ne subsiste (anti-fuite des marqueurs).
            e.awaiting_user = false;
            e.tool_in_progress = false;
            // Aucun outil ouvert ⇒ aucune référence de départ d'outil : sans cette
            // remise à `None`, la promesse « remis à None à tous les cas de fin »
            // serait fausse (l'ancien instant survivrait à l'arrêt de la session).
            e.tool_started_at = None;
        }
    }

    /// Défaut B (réserve R2) : purge la marque d'occupation `busy` du couple
    /// encodé dans une clé de session `project\u{1f}agent`. Factorise l'accès à
    /// la map d'anomalie partagée (via `self.anomaly_map`) et le découpage de
    /// clé, pour que TOUS les chemins d'arrêt — arrêt d'une session (`stop`),
    /// arrêt des sessions d'un projet (`stop_project_sessions`), arrêt des
    /// processus d'agents (`stop_all_agent_processes`), arrêt complet
    /// (`shutdown_all`) — passent par la MÊME remise à zéro
    /// (`clear_anomaly_busy`), sans logique dupliquée. Ne crée aucune entrée.
    fn purge_anomaly_busy_for_key(&self, key: &str) {
        let map = match self.anomaly_map.lock().unwrap().clone() {
            Some(m) => m,
            None => return,
        };
        let (project, agent_id) = match key.split_once('\u{1f}') {
            Some(pair) => pair,
            None => return,
        };
        Self::clear_anomaly_busy(&map, project, agent_id);
    }

    /// Retourne le statut d'extensions du dernier spawn de la session
    /// super-agent (None si jamais lancée). Lecture seule pour le frontend
    /// (tâche #136 : détection d'absence d'outils de l'assistant).
    pub fn superagent_ext_status(&self) -> Option<SuperAgentExtStatus> {
        *self.superagent_ext.lock().unwrap()
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

    /// Issue #87 : purge des ÉTATS D'EXÉCUTION FANTÔMES d'un projet.
    ///
    /// Défaut visé : une ligne `agents` dont `proc_state = 'Running'` (posé au
    /// démarrage de la session) reste dans cet état alors que le processus pi
    /// est MORT et que `busy` est retombé à 0 (process tué/crashé sans
    /// `agent_settled`/`process_exit` traité, événements perdus). Rien ne
    /// remettait jamais la ligne à un état sain : le verrou d'exécution du
    /// projet restait posé, les lancements suivants étaient refusés ou mis en
    /// file sans jamais démarrer, et il fallait redémarrer Pilot (voire changer
    /// la casse du chemin du projet, qui contournait le verrou).
    ///
    /// Détection : lignes `proc_state = 'Running'` (projet réel OU agent GLOBAL
    /// `project_path` NULL — espace assistant) dont AUCUNE session vivante
    /// n'existe pour (projet, agent) — `agent_alive`, c'est-à-dire `try_wait`
    /// sur le processus enfant. Les agents globaux n'ont pas de verrou de
    /// projet mais leur ligne `Running`/`loaded=1` fantôme bloquait tout autant
    /// leur redémarrage (état d'exécution incohérent, sans erreur renvoyée).
    /// Remise à un état sain :
    /// `loaded=0, busy=0, proc_state='Unloaded'`, marque `busy` de la map
    /// d'anomalie libérée (c'est elle qui porte l'exclusivité des spécialités
    /// côté moteur), session morte retirée du registre, et UNE LIGNE DE JOURNAL
    /// par purge (traçabilité). Les sessions VIVANTES (parkées, en cours de
    /// démarrage, en attente d'utilisateur) ne sont JAMAIS touchées.
    ///
    /// Sans redémarrage : appelée par le moniteur d'anomalies (30 s).
    ///
    /// @param conn connexion `pilot.db` ouverte (permet le test unitaire).
    /// @param anomaly_map map d'état du moniteur (clé `project\u{1f}agent`).
    /// @returns la liste `(projet, agent)` purgée (pour l'événement frontend).
    pub fn purge_ghost_running_states(
        &self,
        conn: &rusqlite::Connection,
        anomaly_map: &Arc<Mutex<HashMap<String, anomaly::AgentAnomalyState>>>,
    ) -> Result<Vec<(String, String)>, String> {
        // 1. Candidats : état d'exécution « en cours », projet réel ET global.
        //    Les agents GLOBAUX (project_path NULL/'' — espace assistant) ne
        //    portent pas de verrou de projet, mais leur ligne `Running`/`loaded=1`
        //    fantôme est tout aussi incohérente : elle bloquait silencieusement
        //    leur redémarrage (aucune erreur renvoyée). Ils vivent sous la clé de
        //    session réservée `ASSISTANT_SPACE` (et non sous "").
        let mut rows: Vec<(String, String)> = Vec::new();
        {
            let mut stmt = conn
                .prepare(
                    "SELECT id, COALESCE(project_path, '') FROM agents
                     WHERE proc_state = 'Running'",
                )
                .map_err(|e| format!("Erreur purge_ghost_running_states (prepare): {}", e))?;
            let mapped = stmt
                .query_map([], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                })
                .map_err(|e| format!("Erreur purge_ghost_running_states (query): {}", e))?;
            for row in mapped {
                rows.push(row.map_err(|e| format!("Erreur purge_ghost_running_states (row): {}", e))?);
            }
        }
        // 2. Filtrage par VIVACITÉ réelle du processus (hors verrou de base).
        let mut purged: Vec<(String, String)> = Vec::new();
        for (agent_id, raw_project) in rows {
            // Agent global (project_path NULL/'' : espace assistant) → clé de
            // session/map réservée `ASSISTANT_SPACE`.
            let is_global = raw_project.is_empty();
            let project = if is_global {
                ASSISTANT_SPACE.to_string()
            } else {
                raw_project
            };
            if self.session_alive_normalized(&project, &agent_id) {
                // Exécution légitime : rien à faire (session parkée ou en cours).
                continue;
            }
            // La ligne globale a `project_path` NULL : l'égalité de chemin ne
            // peut pas la cibler (NULL = NULL est faux en SQL) → clause dédiée.
            if is_global {
                conn.execute(
                    "UPDATE agents SET loaded = 0, busy = 0, proc_state = 'Unloaded'
                     WHERE id = ?1 AND (project_path IS NULL OR project_path = '')",
                    params![agent_id],
                )
                .map_err(|e| format!("Erreur purge_ghost_running_states (update global): {}", e))?;
            } else {
                conn.execute(
                    "UPDATE agents SET loaded = 0, busy = 0, proc_state = 'Unloaded'
                     WHERE id = ?1 AND project_path = ?2",
                    params![agent_id, project],
                )
                .map_err(|e| format!("Erreur purge_ghost_running_states (update): {}", e))?;
            }
            // Verrou d'exclusivité moteur : libérer la marque `busy` résiduelle
            // (sinon la file JS attend un agent qui n'existe plus).
            Self::clear_anomaly_busy_normalized(anomaly_map, &project, &agent_id);
            // Session morte retirée du registre : sans cela, la sonde
            // `list_agent_sessions` listait encore l'entrée (présente mais non
            // vivante) et les gardes d'exclusivité frontend conservaient un
            // créneau fantôme.
            self.drop_dead_session_normalized(&project, &agent_id);
            // Journal : une ligne par purge (diagnostic sans redémarrage).
            eprintln!(
                "[agent-service] issue #87 : état d'exécution fantôme purgé — agent={} projet={} ({}) proc_state=Running sans processus vivant → Unloaded (loaded=0, busy=0, verrou libéré)",
                agent_id,
                project,
                if is_global { "agent global" } else { "projet" }
            );
            purged.push((project, agent_id));
        }
        Ok(purged)
    }

    /// Variante applicative de `purge_ghost_running_states` : ouvre `pilot.db`
    /// depuis l'`AppHandle`. Utilisée par le moniteur d'anomalies (30 s).
    pub fn purge_ghost_running_states_app(
        &self,
        app: &AppHandle,
        anomaly_map: &Arc<Mutex<HashMap<String, anomaly::AgentAnomalyState>>>,
    ) -> Result<Vec<(String, String)>, String> {
        let conn = db::open_conn(app)?;
        self.purge_ghost_running_states(&conn, anomaly_map)
    }

    /// Libère la marque `busy` des entrées d'anomalie du couple (projet, agent),
    /// à la forme NORMALISÉE du chemin près. La map est alimentée par `rpc.rs`
    /// avec le chemin BRUT de l'appelant, alors que la purge lit le chemin
    /// CANONIQUE en base (tâche #345) : comparer les seules clés exactes laisserait
    /// un `busy` résiduel et bloquerait le prochain démarrage. Ne crée aucune entrée.
    ///
    /// Même remise à zéro COMPLÈTE que `clear_anomaly_busy` (relecture d'`adfb20b`) :
    /// session fantôme purgée = plus aucun outil ouvert, donc `tool_in_progress`
    /// retombe à `false` et `tool_started_at` à `None`. Sans cela, `busy` seul était
    /// effacé et le marqueur d'outil survivait : `session_is_working`
    /// (`list_agent_sessions`) et la sonde d'activité du projet pouvaient rester
    /// « au travail » sur une session qui ne travaillait plus.
    fn clear_anomaly_busy_normalized(
        map: &Arc<Mutex<HashMap<String, anomaly::AgentAnomalyState>>>,
        project: &str,
        agent_id: &str,
    ) {
        let norm = crate::normalize_project_path(project);
        let mut guard = map.lock().unwrap();
        for (key, entry) in guard.iter_mut() {
            let matches = key
                .split_once('\u{1f}')
                .map(|(p, a)| a == agent_id && crate::normalize_project_path(p) == norm)
                .unwrap_or(false);
            if matches {
                entry.busy = false;
                entry.blocked_reported = false;
                entry.auto_stopped_reported = false;
                entry.awaiting_user = false;
                entry.tool_in_progress = false;
                entry.tool_started_at = None;
            }
        }
    }

    /// Vrai si au moins une session VIVANTE existe pour ce projet, à la forme
    /// NORMALISÉE du chemin près (`\` vs `/`, casse, slash final).
    ///
    /// Mission 380 : garde de VIVACITÉ des sondes d'admission
    /// (`get_project_agent_states`). Une session vivante (active ou parkée)
    /// conserve l'occupation du projet ; sans aucune session vivante, l'activité
    /// marquée « busy » est un ORPHELIN (agent mort silencieusement) et ne doit
    /// plus bloquer les commandes manuelles ni la file des missions.
    pub fn project_has_alive_session(&self, project: &str) -> bool {
        let norm = crate::normalize_project_path(project);
        let mut sessions = self.sessions.lock().unwrap();
        sessions.iter_mut().any(|(_, entry)| {
            crate::normalize_project_path(&entry.project) == norm
                && entry
                    .session
                    .child
                    .try_wait()
                    .map(|s| s.is_none())
                    .unwrap_or(false)
        })
    }

    /// Vrai si une session (projet, agent) VIVANTE existe, à la forme NORMALISÉE
    /// du chemin près (`\` vs `/`, casse, slash final).
    ///
    /// Tâche #345 : le registre `agents` est indexé par `chemin_normalise` alors
    /// que le registre de sessions garde le chemin brut de l'appelant ; sans cette
    /// correspondance tolérante, la purge d'états fantômes croirait la session
    /// morte et remettrait l'état d'un agent bien vivant à zéro.
    fn session_alive_normalized(&self, project: &str, agent_id: &str) -> bool {
        let norm = crate::normalize_project_path(project);
        let mut sessions = self.sessions.lock().unwrap();
        sessions.iter_mut().any(|(key, entry)| {
            key.split_once('\u{1f}')
                .map(|(_, a)| a == agent_id)
                .unwrap_or(false)
                && crate::normalize_project_path(&entry.project) == norm
                && entry
                    .session
                    .child
                    .try_wait()
                    .map(|s| s.is_none())
                    .unwrap_or(false)
        })
    }

    /// Retire du registre les sessions MORTES de (projet, agent), à la forme
    /// normalisée du chemin près (idempotent). Complément de
    /// `session_alive_normalized` pour la purge des états fantômes (issue #87).
    fn drop_dead_session_normalized(&self, project: &str, agent_id: &str) {
        let norm = crate::normalize_project_path(project);
        let mut sessions = self.sessions.lock().unwrap();
        let mut dead: Vec<String> = Vec::new();
        for (key, entry) in sessions.iter_mut() {
            let same_scope = key
                .split_once('\u{1f}')
                .map(|(_, a)| a == agent_id)
                .unwrap_or(false)
                && crate::normalize_project_path(&entry.project) == norm;
            if !same_scope {
                continue;
            }
            let is_dead = entry
                .session
                .child
                .try_wait()
                .map(|s| s.is_some())
                .unwrap_or(true);
            if is_dead {
                dead.push(key.clone());
            }
        }
        for k in dead {
            sessions.remove(&k);
        }
    }

    /// Retire du registre la session de (projet, agent) si son processus est
    /// MORT (idempotent, sans effet si absente ou vivante). Utilisé par la
    /// purge des états fantômes (issue #87).
    #[allow(dead_code)]
    fn drop_dead_session(&self, project: &str, agent_id: &str) {
        let key = Self::session_key(project, agent_id);
        let mut sessions = self.sessions.lock().unwrap();
        let dead = match sessions.get_mut(&key) {
            Some(e) => e
                .session
                .child
                .try_wait()
                .map(|s| s.is_some())
                .unwrap_or(true),
            None => false,
        };
        if dead {
            sessions.remove(&key);
        }
    }

    // ── Registre (Phase 1) ──

    /// Liste les agents. `project_path` : Some → agents de ce projet ; None →
    /// agents globaux (project_path IS NULL).
    pub fn list_agents(&self, app: &AppHandle, project_path: Option<&str>) -> Result<Vec<Agent>, String> {
        let conn = db::open_conn(app)?;
        // Tâche #345 : lecture par clé CANONIQUE de projet (l'index UNIQUE
        // `(id, chemin_normalise)` est la source de vérité du périmètre).
        let scope = normalize_scope(project_path);
        let mut stmt = conn
            .prepare(
                "SELECT * FROM agents
                 WHERE (?1 IS NULL AND project_path IS NULL)
                    OR (?1 IS NOT NULL AND chemin_normalise = ?1)
                 ORDER BY id",
            )
            .map_err(|e| format!("Erreur préparation list_agents: {}", e))?;
        let rows = stmt
            .query_map(params![scope], |row| Agent::from_row(row))
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
        // Tâche #345 : lecture par clé canonique (cf. `list_agents`).
        let scope = normalize_scope(project_path);
        let mut stmt = conn
            .prepare(
                "SELECT * FROM agents
                 WHERE id = ?1
                   AND ((?2 IS NULL AND project_path IS NULL) OR (?2 IS NOT NULL AND chemin_normalise = ?2))",
            )
            .map_err(|e| format!("Erreur préparation get_agent: {}", e))?;
        let mut rows = stmt
            .query_map(params![agent_id, scope], |row| Agent::from_row(row))
            .map_err(|e| format!("Erreur requête get_agent: {}", e))?;
        match rows.next() {
            Some(Ok(a)) => Ok(Some(a)),
            Some(Err(e)) => Err(format!("Erreur lecture agent: {}", e)),
            // AGENT JETABLE : la base ne connaît pas cet identifiant — on
            // RETOMBE sur le magasin mémoire. Ce repli est la seule raison pour
            // laquelle `start` ne crée pas de ligne : son seed n'a lieu que si
            // `get_agent` répond `None`.
            None => Ok(self.ephemeral_agent(agent_id, scope.as_deref())),
        }
    }

    /// Agent jetable correspondant à (id, portée), s'il existe en mémoire.
    ///
    /// La portée est comparée sous forme CANONIQUE (même convention que la base) :
    /// `None` = global. Un agent jetable de portée GLOBALE est résolu par toute
    /// portée (il est propre à une mission, jamais partagé), et une requête
    /// GLOBALE le résout aussi : c'est ce qui garantit qu'aucune variante de
    /// chemin (`G:\x` vs `G:/x/`, projet vide `"."`) ne peut faire retomber
    /// `get_agent` sur `None` — donc provoquer un « seed » en base.
    fn ephemeral_agent(&self, agent_id: &str, scope: Option<&str>) -> Option<Agent> {
        let map = self.ephemeral_agents.lock().unwrap();
        let a = map.get(agent_id)?;
        let stored_scope = normalize_scope(a.project_path.as_deref());
        let wanted = scope.map(|s| s.to_string());
        let matches = stored_scope == wanted || stored_scope.is_none() || wanted.is_none();
        if matches {
            Some(a.clone())
        } else {
            None
        }
    }

    /// Insère ou met à jour un agent. Retourne l'agent persisté.
    ///
    /// AGENT JETABLE : un agent éphémère n'est JAMAIS écrit en base — l'appel
    /// met simplement à jour son entrée mémoire et la retourne.
    pub fn upsert_agent(&self, app: &AppHandle, agent: &Agent) -> Result<Agent, String> {
        if self.is_ephemeral_agent(&agent.id) {
            self.update_ephemeral(&agent.id, |a| {
                a.name = agent.name.clone();
                a.icon = agent.icon.clone();
                a.description = agent.description.clone();
                a.role = agent.role.clone();
                a.models = agent.models.clone();
                a.thinking = agent.thinking.clone();
                a.capabilities = agent.capabilities.clone();
                a.skills = agent.skills.clone();
                a.readonly = agent.readonly;
                a.keep_context = agent.keep_context;
                a.max_calls_per_run = agent.max_calls_per_run;
                a.call_depth = agent.call_depth;
            });
            return self
                .ephemeral_agent(&agent.id, normalize_scope(agent.project_path.as_deref()).as_deref())
                .ok_or_else(|| "Agent jetable non retrouvé après mise à jour".to_string());
        }
        let conn = db::open_conn(app)?;
        upsert_agent_conn(&conn, agent)?;
        self.get_agent(app, &agent.id, agent.project_path.as_deref())?
            .ok_or_else(|| "Agent non retrouvé après upsert".to_string())
    }

    /// Remplace l'ensemble des agents d'un scope (global ou projet) — sémantique
    /// « sauvegarde du registre complet » (remplace `save_agent_registry`).
    pub fn replace_agents(&self, app: &AppHandle, project_path: Option<&str>, agents: &[Agent]) -> Result<(), String> {
        let conn = db::open_conn(app)?;
        // Supprime les agents du scope (clé canonique, tâche #345) puis réinsère.
        let scope = normalize_scope(project_path);
        conn.execute(
            "DELETE FROM agents WHERE (?1 IS NULL AND project_path IS NULL) OR (?1 IS NOT NULL AND chemin_normalise = ?1)",
            params![scope],
        )
        .map_err(|e| format!("Erreur purge replace_agents: {}", e))?;
        for a in agents {
            let mut a = a.clone();
            a.project_path = scope.clone();
            self.upsert_agent(app, &a)?;
        }
        Ok(())
    }

    /// Supprime UN SEUL agent d'un scope (global par défaut). Remplace le
    /// `DELETE` de tout le scope de `replace_agents` : une édition ou une
    /// suppression unitaire ne doit plus réécrire les 50 lignes globales (ce qui
    /// ressuscitait les agents masqués et perdait `last_active_at`/`proc_state`).
    pub fn delete_agent(&self, app: &AppHandle, agent_id: &str, project_path: Option<&str>) -> Result<(), String> {
        let conn = db::open_conn(app)?;
        delete_agent_conn(&conn, agent_id, project_path)
    }

    /// Liste les vues d'onglets d'un projet (table `agent_views`) — reconstruit
    /// la barre d'onglets agents à l'identique (cahier §5.2).
    pub fn list_agent_views(&self, app: &AppHandle, project_path: &str) -> Result<Vec<AgentView>, String> {
        let conn = db::open_conn(app)?;
        // Tâche #345 : la table suit la clé canonique du registre `agents`
        // (clé étrangère sur `(id, project_path)`).
        let scope = crate::normalize_project_path(project_path);
        let mut stmt = conn
            .prepare(
                "SELECT agent_id, project_path, order_index, name_override, active
                 FROM agent_views WHERE project_path = ?1 ORDER BY order_index",
            )
            .map_err(|e| format!("Erreur préparation list_agent_views: {}", e))?;
        let rows = stmt
            .query_map(params![scope], |row| AgentView::from_row(row))
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
        // Tâche #345 : clé canonique côté écriture (cf. `list_agent_views`).
        let scope = crate::normalize_project_path(project_path);
        conn.execute("DELETE FROM agent_views WHERE project_path = ?1", params![scope])
            .map_err(|e| format!("Erreur purge save_agent_views: {}", e))?;
        for v in views {
            conn.execute(
                "INSERT INTO agent_views (agent_id, project_path, order_index, name_override, active)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![v.agent_id, scope, v.order_index, v.name_override, v.active as i64],
            )
            .map_err(|e| format!("Erreur insert save_agent_views: {}", e))?;
        }
        Ok(())
    }

    /// Pose la visibilité d'un agent (0 = invisible, 1 = vue ouverte).
    pub fn set_visible(&self, app: &AppHandle, agent_id: &str, project_path: Option<&str>, visible: bool) -> Result<(), String> {
        // AGENT JETABLE : jamais en base — on met à jour l'entrée mémoire et on
        // émet la transition (même contrat d'événement que pour un agent du
        // registre), sans aucune écriture dans la table `agents`.
        if self.update_ephemeral(agent_id, |a| a.visible = visible) {
            self.emit_state_changed(app, agent_id, project_path);
            return Ok(());
        }
        let conn = db::open_conn(app)?;
        // Tâche #345 : cible par clé canonique (cf. `get_agent`).
        let scope = normalize_scope(project_path);
        let changed = conn.execute(
            "UPDATE agents SET visible = ?1
             WHERE id = ?2 AND ((?3 IS NULL AND project_path IS NULL) OR (?3 IS NOT NULL AND chemin_normalise = ?3))",
            params![visible as i64, agent_id, scope],
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
        // AGENT JETABLE : état logique gardé en MÉMOIRE (aucune ligne en base).
        if self.update_ephemeral(agent_id, |a| {
            a.loaded = loaded;
            a.busy = busy;
            a.state = state.clone();
        }) {
            self.emit_state_changed(app, agent_id, project_path);
            return Ok(());
        }
        let conn = db::open_conn(app)?;
        // Tâche #345 : cible par clé canonique (cf. `get_agent`).
        let scope = normalize_scope(project_path);
        let changed = conn.execute(
            "UPDATE agents SET loaded = ?1, busy = ?2, proc_state = ?3
             WHERE id = ?4 AND ((?5 IS NULL AND project_path IS NULL) OR (?5 IS NOT NULL AND chemin_normalise = ?5))",
            params![loaded as i64, busy as i64, state.as_str(), agent_id, scope],
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
            // Tâche #345 : le registre stocke la clé CANONIQUE du projet, mais le
            // frontend indexe ses agents invisibles par le chemin BRUT qu'il a
            // fourni (clé `agentId::projectPath`, cf. `handleAgentStateChanged`).
            // On émet donc la portée de l'appelant, pas la valeur normalisée, tout
            // en gardant la valeur en base pour un agent global (`None`).
            let emitted: Option<String> = match project_path {
                Some(p) => Some(p.to_string()),
                None => a.project_path.clone(),
            };
            let _ = app.emit(
                "agent-state-changed",
                serde_json::json!({
                    "agentId": a.id,
                    "projectPath": emitted,
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
    ///
    /// Tâche #345 : la clé conserve le chemin BRUT fourni par l'appelant (et non
    /// sa forme canonique) : c'est la convention attendue par la map d'anomalie
    /// (clé `project\u{1f}agent`, alimentée par `rpc.rs` avec le chemin brut) et par
    /// `collect_session_states` (qui relit le projet depuis la clé). Le registre
    /// `agents`, lui, est indexé par la forme canonique (`chemin_normalise`) : la
    /// purge d'états fantômes fait donc la correspondance à la forme normalisée
    /// près (`session_alive_normalized`), sans changer la clé de session.
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
        mcp_server: Option<String>,
    ) -> Result<bool, String> {
        let key = Self::session_key(project, agent_id);
        // T4 : exclusivité des spécialités par projet. Un seul agent de chaque
        // spécialité (agent_id) par projet à la fois. Ne s'applique qu'aux
        // agents multi-rôles H2 V2 (mode AgentProcess) : la session principale,
        // le reviewer d'orchestration et le super-agent ne sont pas concernés.
        // Le frontend met la demande en file d'attente (T5) ; ce garde-fou Rust
        // garantit l'invariant en cas de course (refus explicite au lieu d'un
        // double démarrage concurrent).
        if mode == SpawnMode::AgentProcess {
            let anomaly_map = app.state::<AppState>().agent_anomaly.clone();
            if self.agent_process_busy(&anomaly_map, project, agent_id) {
                return Err(format!(
                    "Un agent « {} » est déjà actif sur ce projet (exclusivité des spécialités).",
                    agent_id
                ));
            }
        }
        // Seed : si l'agent n'existe pas en base (ex: agent `default` du chat
        // principal jamais créé automatiquement), le créer AVANT de lancer la
        // session pour que `set_state`/`set_visible` (UPDATE) fonctionnent.
        // Valeurs par défaut : name dérivé de l'id, modèles depuis la config
        // (modèle codeur), visible=true. Porté par le projet courant (Some),
        // aligné sur la scope que ciblent `set_state`/`set_visible`.
        //
        // AGENT JETABLE : jamais de seed. Un agent éphémère est déjà résolu par
        // `get_agent` (repli mémoire) et ne doit produire AUCUNE ligne en base —
        // le garde explicite ci-dessous empêche qu'une évolution future du repli
        // le fasse réapparaître dans le registre persistant.
        if !self.is_ephemeral_agent(agent_id) && self.get_agent(app, agent_id, Some(project))?.is_none() {
            let state = app.state::<AppState>();
            let coder_model = {
                let config = state.config_snapshot();
                if !config.coder_provider.is_empty() && !config.coder_model_id.is_empty() {
                    format!("{}/{}", config.coder_provider, config.coder_model_id)
                } else {
                    String::new()
                }
            };
            // Bug connu : hériter les modèles de la row GLOBALE (si elle existe)
            // au lieu de coder_model — sinon le modèle configuré de l'agent est
            // écrasé par le modèle par défaut du codeur (doublon projet-scopé
            // sans modèles). Fallback coder_model si aucun agent global.
            let (models_pi, models_plh, inherited_skills, inherited_thinking) =
                match self.get_agent(app, agent_id, None)? {
                    Some(g) => (
                        g.models.pi.clone(),
                        g.models.plh.clone(),
                        g.skills.clone(),
                        g.thinking.clone(),
                    ),
                    None => (coder_model.clone(), coder_model, Vec::new(), Default::default()),
                };
            let agent = Agent {
                id: agent_id.to_string(),
                name: default_agent_name(agent_id),
                icon: String::new(),
                description: String::new(),
                role: String::new(),
                models: crate::agent::AgentModels {
                    pi: models_pi,
                    plh: models_plh,
                },
                thinking: inherited_thinking,
                capabilities: Vec::new(),
                skills: inherited_skills,
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
                Self::spawn_agent_process(app, project, agent_id, pi_path, no_session, mcp_server)?
            }
            // Les agents d'assistant (tâche #140) sont démarrés via
            // `start_assistant_agent` (clé réservée ASSISTANT_SPACE, espace de
            // travail ~/.pilot/assistant), jamais via `start` (lié à un projet).
            SpawnMode::AssistantAgent => unreachable!("AssistantAgent doit passer par start_assistant_agent"),
        };
        {
            let mut sessions = self.sessions.lock().unwrap();
            sessions.insert(
                key.clone(),
                SessionEntry {
                    session,
                    project: project.to_string(),
                    state: SessionState::Active,
                    mode,
                },
            );
        }
        // Identité de la session qui vient de naître : tout arrêt/abandon
        // ultérieur devra la nommer par cet uid (voir `stop_owned` / `send_owned`).
        let uid = next_session_uid();
        self.session_uids.lock().unwrap().insert(key, uid);
        self.trace_session_op("spawn", project, agent_id, None, Some(uid));
        if mode == SpawnMode::MainSession {
            *self.active.lock().unwrap() = Some(agent_id.to_string());
        }
        // 5.1 : notifier le frontend de la transition (session démarrée).
        self.set_state(app, agent_id, Some(project), true, false, &AgentProcessState::Running).ok();
        // Tâche #167 : après un NOUVEAU spawn, appliquer mécaniquement le modèle
        // (registre de l'agent → defaultModel du backend actif). JAMAIS sur
        // reprise (retour anticipé plus haut) : un set_model tardif écraserait
        // un modèle posé explicitement (UI / bus JS) sur la session parkée.
        self.apply_initial_model(app, project, agent_id, pi_path);
        // T4 : puis le niveau de réflexion (séquence stricte : set_model →
        // get_available_thinking_levels → clamp → set_thinking_level).
        self.apply_initial_thinking(app, project, agent_id, pi_path);
        Ok(false)
    }

    /// T4 : applique mécaniquement le **niveau de réflexion** à une session
    /// fraîchement spawnée, APRÈS `set_model` (séquence stricte du plan :
    /// set_model → get_available_thinking_levels → ramenage → set_thinking_level).
    ///
    /// Priorité (§3 du plan), chaque étage étant ramené aux capacités du modèle :
    ///   1. niveau explicite de **session** : inexistant sur un processus neuf —
    ///      on n'agit QUE sur un spawn neuf, jamais sur une session parkée
    ///      reprise, exactement comme `apply_initial_model` ;
    ///   2. niveau du **registre de l'agent** pour le backend actif (repli croisé
    ///      pi ↔ plh, comme `resolve_initial_model`) ;
    ///   3. **réglage général de Pilot** (`AppConfig::default_thinking_level`) :
    ///      la chaîne l'accepte déjà, son branchement arrive en T6 ;
    ///   4. défaut par modèle / défaut moteur de pi : on n'y touche pas. Faute
    ///      d'étage renseigné, RIEN n'est envoyé et pi garde son propre défaut
    ///      (comportement actuel : zéro régression).
    ///
    /// Fail-open : toute erreur (commande inconnue d'un pi ancien ou du backend
    /// plh, timeout, refus) se traduit par une simple trace ; la session démarre
    /// quand même avec le niveau par défaut du moteur.
    fn apply_initial_thinking(
        &self,
        app: &AppHandle,
        project: &str,
        agent_id: &str,
        pi_path: &str,
    ) {
        let stem = backend_stem(pi_path);
        let (thinking_pi, thinking_plh) = match self.get_agent(app, agent_id, Some(project)) {
            Ok(Some(a)) => (a.thinking.pi.clone(), a.thinking.plh.clone()),
            _ => match self.get_agent(app, agent_id, None) {
                Ok(Some(g)) => (g.thinking.pi.clone(), g.thinking.plh.clone()),
                _ => (String::new(), String::new()),
            },
        };
        let agent_level =
            crate::thinking::resolve_agent_thinking(&thinking_pi, &thinking_plh, &stem);
        // T6 : réglage général de Pilot (⚙️ Paramètres → Agent Pi). Lecture par
        // `config_snapshot` (try_lock) : jamais de blocage si un autre thread
        // tient le verrou de configuration pendant le démarrage d'un agent.
        let general_level = app
            .state::<AppState>()
            .config_snapshot()
            .default_thinking_level;
        if agent_level.is_empty() && general_level.is_empty() {
            // Aucun réglage : ne rien envoyer (pi garde son défaut).
            return;
        }
        // La session vivante est l'autorité sur les niveaux réellement supportés
        // par le modèle effectivement chargé (alias compris).
        let available = match self.send_sync_timeout(
            project,
            agent_id,
            serde_json::json!({ "type": "get_available_thinking_levels" }),
            12,
        ) {
            Ok(resp) => crate::thinking::levels_from_rpc_response(&resp),
            Err(e) => {
                eprintln!(
                    "[agent-service] niveaux de réflexion indisponibles pour l'agent {} : {}",
                    agent_id, e
                );
                return;
            }
        };
        let candidates = [agent_level.as_str(), general_level.as_str()];
        let Some(level) = crate::thinking::resolve_thinking_level(&candidates, &available) else {
            return;
        };
        eprintln!(
            "[agent-service] niveau de réflexion résolu pour l'agent {} : {} (voulu : {})",
            agent_id, level, agent_level
        );
        let cmd = serde_json::json!({ "type": "set_thinking_level", "level": level });
        if let Err(e) = self.send_sync_timeout(project, agent_id, cmd, 12) {
            eprintln!(
                "[agent-service] set_thinking_level initial non appliqué pour l'agent {} : {}",
                agent_id, e
            );
        }
    }

    /// Tâche #167 : applique mécaniquement le modèle initial à une session
    /// fraîchement spawnée (agents lancés en Rust direct — ex: agent de
    /// diagnostic auto — qui, sans set_model, retombaient sur le modèle interne
    /// de pi, potentiellement muet, ex: 402 credits).
    /// Priorité des modèles (identique au bus JS, `resolveAgentModel` +
    /// fallback defaultModel) :
    ///   1. modèle explicite de session : n'existe PAS encore sur un processus
    ///      neuf — la priorité « ne jamais écraser un modèle explicite » est
    ///      respectée structurellement car on n'agit QUE sur un spawn neuf ;
    ///   2. modèle du registre de l'agent pour le backend actif (fallback
    ///      croisé pi/plh, comme `resolveAgentModel`) ;
    ///   3. `defaultModel` du model-switch.json du backend actif
    ///      (`default_model_from_config`).
    /// Fail-open : tout échec (agent absent, lecture disque, set_model refusé
    /// par pi) n'empêche JAMAIS le démarrage — l'agent retombe sur le modèle
    /// interne de pi, comme avant ce correctif. Le set_model du bus JS reste
    /// en place (idempotent) : il repositionne la même valeur après le spawn.
    fn apply_initial_model(&self, app: &AppHandle, project: &str, agent_id: &str, pi_path: &str) {
        let stem = backend_stem(pi_path);
        // Modèle du registre de l'agent (porté par le projet, comme le seed
        // de `start`). Lecture tolérante : agent absent → pas de modèle registre.
        // Bug connu : si l'agent projet-scopé n'existe pas (ou n'a pas de
        // modèles), retomber sur l'agent GLOBAL (get_agent(agent_id, None))
        // pour lire ses modèles — évite le doublon projet-scopé sans modèles et
        // le defaultModel erroné qui écrasait le modèle configuré de l'agent.
        let (models_pi, models_plh) = match self.get_agent(app, agent_id, Some(project)) {
            Ok(Some(a)) => (a.models.pi.clone(), a.models.plh.clone()),
            _ => match self.get_agent(app, agent_id, None) {
                Ok(Some(g)) => (g.models.pi.clone(), g.models.plh.clone()),
                _ => (String::new(), String::new()),
            },
        };
        // defaultModel lu UNIQUEMENT si le registre ne fournit rien (une
        // lecture disque de moins dans le cas nominal).
        let default_model = crate::super_agent::default_model_from_config(pi_path);
        if let Some((provider, model_id)) =
            resolve_initial_model(&models_pi, &models_plh, &stem, default_model)
        {
            // Observabilité : log du modèle résolu pour rendre le diagnostic
            // trivial (le modèle effectif d'un agent au lancement).
            eprintln!(
                "[agent-service] modèle initial résolu pour l'agent {} : {}/{}",
                agent_id, provider, model_id
            );
            let cmd = serde_json::json!({
                "type": "set_model",
                "provider": provider,
                "modelId": model_id
            });
            if let Err(e) = self.send_sync(project, agent_id, cmd) {
                eprintln!(
                    "[agent-service] set_model initial non appliqué pour l'agent {} : {}",
                    agent_id, e
                );
            }
        }
    }

    /// Parke la session d'un agent (état Parked, processus vivant). No-op si la
    /// session n'existe pas ou est déjà parkée. Si l'agent parké était l'agent
    /// actif (chat Agent Pi / onglet affiché), le pointeur actif est remis à
    /// None : la session n'est plus affichée, elle reste vivante en arrière-plan.
    pub fn pause(&self, project: &str, agent_id: &str) -> Result<(), String> {
        let key = Self::session_key(project, agent_id);
        let mut paused_mode: Option<SpawnMode> = None;
        {
            let mut sessions = self.sessions.lock().unwrap();
            if let Some(entry) = sessions.get_mut(&key) {
                entry.state = SessionState::Parked;
                paused_mode = Some(entry.mode);
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
        // Indexation auto (fire-and-forget) de l'index `.pilot/sessions.jsonl`
        // du projet après le parking d'un agent délégué (run_agents), pour que
        // l'onglet 📜 soit à jour sans action manuelle.
        if let Some(mode) = paused_mode {
            self.maybe_index_agent_sessions(project, mode);
        }
        Ok(())
    }

    /// Arrête la session d'un agent (état Stopped) et tue le processus pi.
    ///
    /// Sans uid : aucun contrôle de propriété (comportement historique — UI
    /// « arrêter », fermeture de projet, arrêt de l'application).
    pub fn stop(&self, project: &str, agent_id: &str) -> Result<(), String> {
        self.stop_owned(project, agent_id, None)
    }

    /// Arrête la session d'un agent **si elle est bien celle attendue**.
    ///
    /// `expected_uid` protège les arrêts AUTOMATIQUES (minuteur de run, boucle,
    /// moniteur, relance) d'une session remplacée entre-temps : sans cette
    /// garde, un minuteur périmé tuait la session neuve du même couple
    /// (projet, agent), ce qui se voyait comme « l'agent commence et s'arrête ».
    ///
    /// ATOMICITÉ (trou du diagnostic 2026-10-21) : le contrôle de propriété et
    /// le RETRAIT (uid + session) se font dans la MÊME section critique. Sans
    /// cela, une session relancée entre le contrôle et le retrait pouvait être
    /// enlevée par un arrêt visant l'ancienne — un arrêt périmé tuait une autre
    /// exécution. Ordre de verrous : `session_uids` puis `sessions` (aucun
    /// chemin existant ne prend `sessions` avant `session_uids`).
    pub fn stop_owned(
        &self,
        project: &str,
        agent_id: &str,
        expected_uid: Option<u64>,
    ) -> Result<(), String> {
        let key = Self::session_key(project, agent_id);
        // ── Réservation atomique de la session à arrêter ──
        let taken = {
            let mut uids = self.session_uids.lock().unwrap();
            let current = uids.get(&key).copied();
            let accepted = session_ownership_allows(expected_uid, current);
            self.trace_session_op(
                if accepted { "propriete-ok" } else { "propriete-refusee" },
                project,
                agent_id,
                expected_uid,
                current,
            );
            if !accepted {
                return Err(format!(
                    "Session remplacée depuis le lancement (uid attendu {:?}, session en place {:?}) : commande refusée pour ne pas arrêter la session d'une autre exécution.",
                    expected_uid, current
                ));
            }
            uids.remove(&key);
            self.sessions.lock().unwrap().remove(&key)
        };
        let mut stopped_mode: Option<SpawnMode> = None;
        if let Some(mut entry) = taken {
            stopped_mode = Some(entry.mode);
            rpc_manager::stop_session(&mut entry.session);
        }
        // Défaut B : purger la marque d'occupation du couple (projet, agent)
        // dans la map d'anomalie AVANT de toucher au pointeur actif. Une
        // session arrêtée (volontairement ou automatiquement) n'est plus un
        // travail en cours : sans cette purge, `busy` reste à true avec un
        // `lastActivity` récent, ce qui bloque les gardes d'exclusivité
        // (« Une run est déjà en cours ») et met les demandes suivantes en file
        // au lieu de les démarrer. Même remise à zéro que les autres chemins
        // d'arrêt (réserve R2), via le helper unique.
        self.purge_anomaly_busy_for_key(&key);
        // Si l'agent arrêté était l'agent actif, réinitialiser le pointeur.
        let mut active = self.active.lock().unwrap();
        if active.as_deref() == Some(agent_id) {
            *active = None;
        }
        // 5.1 : notifier le frontend de la transition (session arrêtée).
        if let Some(app) = self.app.lock().unwrap().clone() {
            self.set_state(&app, agent_id, Some(project), false, false, &AgentProcessState::Stopped).ok();
        }
        // Indexation auto (fire-and-forget) de l'index `.pilot/sessions.jsonl`
        // du projet après l'arrêt d'un agent délégué (run_agents), pour que
        // l'onglet 📜 reflète la session terminée sans action manuelle.
        if let Some(mode) = stopped_mode {
            self.maybe_index_agent_sessions(project, mode);
        }
        // AGENT JETABLE : sa durée de vie est SA TÂCHE. La session arrêtée, la
        // définition mémoire disparaît (son travail reste visible : messages de
        // session, rapport de fin de run, journal d'arrêts automatiques).
        self.clear_ephemeral_agent(agent_id);
        Ok(())
    }

    /// Indexe (fire-and-forget) l'index des sessions du projet concerné après la
    /// fin d'une session d'agent délégué (mode `AgentProcess`, lancé via
    /// `run_agents`). Tolère les erreurs : n'échoue jamais et ne bloque pas
    /// l'appelant (thread détaché). Ne s'applique qu'aux agents délégués :
    ///   - la session principale du chat est indexée par le frontend
    ///     (`captureSessionHistory` à l'`agent_end`),
    ///   - le reviewer d'orchestration et le super-agent utilisent `--no-session`
    ///     (aucun JSONL à indexer),
    ///   - le super-agent vit sous un projet pseudo-global `""` (ignoré).
    /// Évite la sur-indexation et les boucles (déclenché uniquement sur stop/pause).
    fn maybe_index_agent_sessions(&self, project: &str, mode: SpawnMode) {
        if mode != SpawnMode::AgentProcess || project.is_empty() {
            return;
        }
        let app = match self.app.lock().unwrap().clone() {
            Some(a) => a,
            None => return,
        };
        let project = project.to_string();
        std::thread::Builder::new()
            .name("pilot-agent-session-index".into())
            .spawn(move || {
                let state = app.state::<AppState>();
                let config = state.config_snapshot();
                if let Err(e) = session_history::index_project_sessions(&project, &config) {
                    eprintln!(
                        "[sessions] Indexation auto après fin d'agent délégué échouée pour {} : {}",
                        project, e
                    );
                }
            })
            .ok();
    }

    /// Enregistre (si c'en est un) le prompt envoyé comme mission en cours de
    /// la session. Purge volontairement absente : une session arrêtée n'est
    /// jamais listée, l'entrée résiduelle coûte ~80 octets et son nombre est
    /// borné par les couples (projet, agent) — `ponytail: pas de purge, à
    /// reprendre seulement si la carte grossit anormalement`.
    fn record_prompt(&self, key: String, snapshot: Option<String>) {
        if let Some(s) = snapshot {
            self.last_prompts.lock().unwrap().insert(key, s);
        }
    }

    /// Enregistre (ou efface) le RÉSUMÉ COURT de la mission en cours d'une
    /// session. `None` = la commande n'est pas un prompt → rien n'est touché
    /// (une consultation `get_state` ne détruit pas le résumé de la mission en
    /// cours). `Some(None)` = prompt SANS résumé → l'entrée est EFFACÉE, pour
    /// qu'un résumé d'une mission précédente ne soit jamais affiché pour la
    /// suivante. `Some(Some(r))` = résumé fourni (déjà nettoyé et plafonné).
    fn record_resume(&self, key: String, resume: Option<Option<String>>) {
        match resume {
            None => {}
            Some(Some(r)) => {
                self.last_resumes.lock().unwrap().insert(key, r);
            }
            Some(None) => {
                self.last_resumes.lock().unwrap().remove(&key);
            }
        }
    }

    /// Résumé court conservé pour une session (`None` s'il n'y en a pas).
    fn resume_of(&self, key: &str) -> Option<String> {
        self.last_resumes.lock().unwrap().get(key).cloned()
    }

    /// Résumé court de la mission EN COURS d'un couple (projet, agent), pour
    /// les chemins qui RENVOIENT le MÊME prompt (reprise après blocage,
    /// correction) : le résumé de la mission est alors reporté tel quel au lieu
    /// d'être effacé par un envoi qui n'en porte pas.
    pub fn mission_resume(&self, project: &str, agent_id: &str) -> Option<String> {
        self.resume_of(&Self::session_key(project, agent_id))
    }

    /// Route une commande vers la session d'un agent (une seule indirection).
    pub fn send(&self, project: &str, agent_id: &str, mut command: Value) -> Result<(), String> {
        let key = Self::session_key(project, agent_id);
        let snapshot = prompt_snapshot(&command);
        // RÉSUMÉ COURT : lu AVANT le retrait du champ, puis le champ est retiré
        // de la commande (il appartient à Pilot, pas au protocole de pi).
        let resume = prompt_resume(&command);
        strip_resume_field(&mut command);
        let res = {
            let mut sessions = self.sessions.lock().unwrap();
            let entry = sessions.get_mut(&key).ok_or_else(|| {
                format!("Aucune session pour l'agent {} (projet {})", agent_id, project)
            })?;
            rpc_manager::send_command(&mut entry.session, &command)
        };
        if res.is_ok() {
            self.record_prompt(key.clone(), snapshot);
            self.record_resume(key, resume);
        }
        res
    }

    /// Envoie une commande à une session **sous garde de PROPRIÉTÉ** :
    /// le contrôle de l'uid attendu et l'ÉCRITURE de la commande se font dans la
    /// MÊME section critique. Un abandon (`abort`) visant une session remplacée
    /// entre-temps ne peut donc plus atteindre la session NEUVE du même couple
    /// (projet, agent) — trou constaté dans la trace disque du 2026-10-20
    /// (`propriete-ok expected=None` immédiatement suivi de `abort`).
    ///
    /// `expected_uid` à `None` conserve le comportement historique (aucun
    /// contrôle) pour les chemins qui ne connaissent pas d'uid.
    /// Ordre de verrous : `session_uids` puis `sessions` (voir `stop_owned`).
    pub fn send_owned(
        &self,
        project: &str,
        agent_id: &str,
        expected_uid: Option<u64>,
        mut command: Value,
    ) -> Result<(), String> {
        let key = Self::session_key(project, agent_id);
        let snapshot = prompt_snapshot(&command);
        // RÉSUMÉ COURT : même traitement que `send` (lu puis retiré avant écriture).
        let resume = prompt_resume(&command);
        strip_resume_field(&mut command);
        let res = {
            let uids = self.session_uids.lock().unwrap();
            let current = uids.get(&key).copied();
            let accepted = session_ownership_allows(expected_uid, current);
            let res = if !accepted {
                Err(format!(
                    "Session remplacée depuis le lancement (uid attendu {:?}, session en place {:?}) : commande refusée pour ne pas toucher la session d'une autre exécution.",
                    expected_uid, current
                ))
            } else {
                let mut sessions = self.sessions.lock().unwrap();
                match sessions.get_mut(&key) {
                    Some(entry) => rpc_manager::send_command(&mut entry.session, &command),
                    None => Err(format!(
                        "Aucune session pour l'agent {} (projet {})",
                        agent_id, project
                    )),
                }
            };
            drop(uids);
            self.trace_session_op(
                if accepted { "propriete-ok" } else { "propriete-refusee" },
                project,
                agent_id,
                expected_uid,
                current,
            );
            res
        };
        if res.is_ok() {
            self.record_prompt(key.clone(), snapshot);
            self.record_resume(key, resume);
        }
        res
    }

    /// Route une commande synchrone (attend la réponse) vers la session d'un agent.
    pub fn send_sync(&self, project: &str, agent_id: &str, command: Value) -> Result<Value, String> {
        self.send_sync_timeout(project, agent_id, command, 30)
    }

    /// Route une commande synchrone avec timeout vers la session d'un agent.
    ///
    /// Le verrou du registre de sessions n'est tenu que pendant l'ÉCRITURE de la
    /// commande : il est relâché avant l'attente de la réponse. Un `pi` mort
    /// (ou muet) ne doit jamais geler le registre entier — donc les autres
    /// consommateurs du registre, dont les commandes synchrones du thread
    /// principal (incident v0.4.30 : UI figée sur un timeout de 30 s en boucle).
    pub fn send_sync_timeout(
        &self,
        project: &str,
        agent_id: &str,
        command: Value,
        timeout_secs: u64,
    ) -> Result<Value, String> {
        let key = Self::session_key(project, agent_id);
        let snapshot = prompt_snapshot(&command);
        // RÉSUMÉ COURT : lu puis retiré avant écriture (même contrat que `send`).
        let resume = prompt_resume(&command);
        let mut command = command;
        strip_resume_field(&mut command);
        let rx = {
            let mut sessions = self.sessions.lock().unwrap();
            let entry = sessions.get_mut(&key).ok_or_else(|| {
                format!("Aucune session pour l'agent {} (projet {})", agent_id, project)
            })?;
            rpc_manager::send_command_register(&mut entry.session, command)?
        };
        let res = rpc_manager::wait_response(rx, timeout_secs);
        if res.is_ok() {
            self.record_prompt(key.clone(), snapshot);
            self.record_resume(key, resume);
        }
        res
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

    /// Indique si la session d'un agent (projet, agent) est vivante : présente
    /// dans le registre ET processus enfant non terminé (`try_wait` → None).
    /// Utilisé par le garde-fou de `do_start_agent_session` pour distinguer un
    /// pointeur `active` légitime (session vivante) d'un pointeur orphelin
    /// (session morte ou absente du registre).
    pub fn agent_alive(&self, project: &str, agent_id: &str) -> bool {
        let key = Self::session_key(project, agent_id);
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

    /// Indique si un agent multi-rôles H2 V2 (mode `AgentProcess`) est déjà
    /// vivant pour (project, agent_id). Base de l'exclusivité des spécialités
    /// par projet (T4) : un seul agent de chaque spécialité (agent_id) par
    /// projet à la fois. Ne concerne QUE les agents multi-rôles H2 V2 : la
    /// session principale, le reviewer d'orchestration et le super-agent ne
    /// sont pas concernés (une session `MainSession` du même agent_id n'est
    /// pas comptée).
    pub fn agent_process_alive(&self, project: &str, agent_id: &str) -> bool {
        let key = Self::session_key(project, agent_id);
        let mut sessions = self.sessions.lock().unwrap();
        match sessions.get_mut(&key) {
            Some(e) if e.mode == SpawnMode::AgentProcess => e
                .session
                .child
                .try_wait()
                .map(|s| s.is_none())
                .unwrap_or(false),
            _ => false,
        }
    }

    /// Bug #81 : indique si la session principale (mode `MainSession`, agent
    /// standard du chat) est présente dans le registre ET que son processus
    /// enfant est vivant (try_wait → None). Base de l'arrêt automatique de
    /// l'agent standard figé (un process pi standard vivant ne doit plus
    /// bloquer Pilot). Ne concerne QUE les sessions `MainSession` : une session
    /// `AgentProcess` (run_agents) du même agent_id n'est PAS comptée (scope
    /// run_agents inchangé), ni une session absente ou morte.
    pub fn main_session_alive(&self, project: &str, agent_id: &str) -> bool {
        let key = Self::session_key(project, agent_id);
        let mut sessions = self.sessions.lock().unwrap();
        match sessions.get_mut(&key) {
            Some(e) if e.mode == SpawnMode::MainSession => e
                .session
                .child
                .try_wait()
                .map(|s| s.is_none())
                .unwrap_or(false),
            _ => false,
        }
    }

    /// Exclusivité des spécialités par projet (T4) : un agent multi-rôles H2 V2
    /// est considéré « actif » (exclusif) s'il est vivant ET en train d'exécuter
    /// une tâche (busy=true dans la map d'anomalie, posé à `agent_start` et
    /// retiré à `agent_settled`). Une session vivante mais INACTIVE (settled,
    /// run précédente terminée) n'est PAS exclusive : elle doit pouvoir être
    /// réutilisée/redémarrée pour une nouvelle run (bug : run_agents sur un
    /// agent déjà ouvert mais inactif ne démarrait pas).
    pub fn agent_process_busy(
        &self,
        anomaly_map: &Arc<Mutex<HashMap<String, anomaly::AgentAnomalyState>>>,
        project: &str,
        agent_id: &str,
    ) -> bool {
        if !self.agent_process_alive(project, agent_id) {
            return false;
        }
        // Verrou de run fantôme : un `busy` PÉRIMÉ (process pi figé, ni settled
        // ni exit, dernière activité au-delà de la fenêtre de grâce) n'est plus
        // un travail en cours. Sans cette vérification, la garde moteur refusait
        // la relance (« Un agent … est déjà actif ») alors que le frontend, lui,
        // considère la session périmée et tente de lancer — d'où un faux
        // « lancé » suivi d'un échec. Même politique que le filet autoritaire du
        // moniteur d'anomalies (`should_release_stale_busy`, `awaiting_user`
        // respecté) et que le frontend (`isSessionWorking`/`isBusyStale`).
        let grace = crate::default_stale_busy_grace_minutes();
        let m = anomaly_map.lock().unwrap();
        match m.get(&format!("{}\u{1f}{}", project, agent_id)) {
            Some(a) => anomaly::busy_entry_is_exclusive(a, grace, Instant::now()),
            None => false,
        }
    }

    /// Bug #152 : indique si un agent délégué (mode `AgentProcess`) a une
    /// session ENCORE ENREGISTRÉE pour (project, agent_id) mais dont le
    /// processus est DÉJÀ MORT (aucun événement de fin traité). Utilisée par le
    /// moniteur d'anomalies pour purger le flag `busy` résiduel (busy ∧ process
    /// mort) et libérer l'exclusivité des spécialités / la file d'attente côté
    /// frontend. Ne concerne QUE les sessions `AgentProcess` : la session
    /// principale, le reviewer et le super-agent (autres modes) retournent
    /// toujours false, ainsi qu'une session vivante ou absente du registre.
    pub fn has_dead_agent_process(&self, project: &str, agent_id: &str) -> bool {
        let key = Self::session_key(project, agent_id);
        let mut sessions = self.sessions.lock().unwrap();
        match sessions.get_mut(&key) {
            Some(e) if e.mode == SpawnMode::AgentProcess => e
                .session
                .child
                .try_wait()
                .map(|s| s.is_some())
                .unwrap_or(false),
            _ => false,
        }
    }

    /// Réinitialise explicitement le pointeur actif (nettoyage d'orphelin).
    /// Utilisé par `do_start_agent_session` quand la session pointée est morte :
    /// on libère le pointeur pour débloquer les délégations suivantes au lieu
    /// d'errer silencieusement « Une session agent est déjà active ».
    pub fn clear_active(&self) {
        *self.active.lock().unwrap() = None;
    }

    /// Garde-fou anti-orphan : si le pointeur actif pointe vers une session
    /// morte (ou absente) pour le projet donné, le réinitialise. Retourne
    /// `true` si un orphelin a été nettoyé. Utilisé défensivement avant un
    /// démarrage pour ne jamais laisser un pointeur `active` bloquer les
    /// délégations quand la session sous-jacente a disparu.
    #[allow(dead_code)]
    pub fn clear_active_if_dead(&self, project: &str) -> bool {
        let active_id = self.active.lock().unwrap().clone();
        if let Some(id) = active_id {
            if !self.agent_alive(project, &id) {
                self.clear_active();
                return true;
            }
        }
        false
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
        let keys: Vec<String> = {
            let mut sessions = self.sessions.lock().unwrap();
            let keys: Vec<String> = sessions
                .iter()
                .filter(|(_, e)| e.project == project)
                .map(|(k, _)| k.clone())
                .collect();
            for k in &keys {
                if let Some(mut entry) = sessions.remove(k) {
                    rpc_manager::stop_session(&mut entry.session);
                }
            }
            keys
        };
        {
            let mut uids = self.session_uids.lock().unwrap();
            for k in &keys {
                uids.remove(k);
            }
        }
        // Réserve R2 : même remise à zéro que `stop` pour chaque couple arrêté.
        // Une session fermée avec son projet n'est plus un travail en cours :
        // sans cette purge, `busy` resterait vrai et un redémarrage de l'agent
        // au retour sur le projet serait mis en file d'attente à tort.
        for k in &keys {
            self.purge_anomaly_busy_for_key(k);
        }
    }

    /// Fermeture d'un projet (`close_project`) : libère les sessions du projet
    /// qui NE TRAVAILLENT PAS, et LAISSE VIVANTES celles qui travaillent.
    ///
    /// Règle propriétaire (2026-10-21) : fermer un projet n'arrête plus un agent
    /// EN COURS — son travail continue en arrière-plan et reprend à la
    /// réouverture. `working(agent_id)` répond « travaille-t-il maintenant ? »
    /// (même règle que `isWorking` : processus vivant ET [tâche/outil en cours
    /// ou activité < 2 min]). Une session OISIVE est quand même libérée : aucun
    /// travail n'est perdu et aucun `pi` oisif ne traîne en mémoire.
    /// Retourne les clés effectivement arrêtées.
    pub fn stop_idle_project_sessions<F>(&self, project: &str, working: F) -> Vec<String>
    where
        F: Fn(&str) -> bool,
    {
        // 1. Instantané SOUS verrou, puis libération : le prédicat `working` peut
        //    consulter la map d'anomalie (verrou distinct, pris ailleurs AVANT un
        //    arrêt par le moniteur) — on ne l'appelle jamais en tenant le registre,
        //    pour ne pas créer un ordre de verrous nouveau (risque d'interblocage).
        let candidates: Vec<(String, String)> = {
            let sessions = self.sessions.lock().unwrap();
            sessions
                .iter()
                .filter(|(_, e)| e.project == project)
                // Clé composite `project\u{1f}agent` : l'agent est le suffixe.
                .map(|(k, _)| (k.clone(), k.rsplit('\u{1f}').next().unwrap_or("").to_string()))
                .collect()
        };
        let idle: Vec<String> = candidates
            .into_iter()
            .filter(|(_, agent_id)| !working(agent_id))
            .map(|(k, _)| k)
            .collect();
        // 2. Retrait effectif (verrou tenu uniquement pour le retrait).
        let keys: Vec<String> = {
            let mut sessions = self.sessions.lock().unwrap();
            let mut keys: Vec<String> = Vec::new();
            for k in idle {
                if let Some(mut entry) = sessions.remove(&k) {
                    rpc_manager::stop_session(&mut entry.session);
                    keys.push(k);
                }
            }
            keys
        };
        {
            let mut uids = self.session_uids.lock().unwrap();
            for k in &keys {
                uids.remove(k);
            }
        }
        for k in &keys {
            self.purge_anomaly_busy_for_key(k);
        }
        keys
    }

    /// Arrête toutes les sessions d'agents multi-rôles H2 V2 (tous projets).
    /// Utilisé par `stop_all_agent_processes` et à l'arrêt de l'app.
    pub fn stop_all_agent_processes(&self) {
        let keys: Vec<String> = {
            let mut sessions = self.sessions.lock().unwrap();
            let keys: Vec<String> = sessions
                .iter()
                .filter(|(_, e)| e.mode == SpawnMode::AgentProcess)
                .map(|(k, _)| k.clone())
                .collect();
            for k in &keys {
                if let Some(mut entry) = sessions.remove(k) {
                    rpc_manager::stop_session(&mut entry.session);
                }
            }
            keys
        };
        {
            let mut uids = self.session_uids.lock().unwrap();
            for k in &keys {
                uids.remove(k);
            }
        }
        // Réserve R2 : même remise à zéro que `stop` (le projet reste ouvert et
        // les autres agents continuent de tourner → un faux `busy` maintiendrait
        // le verrou d'exclusivité de ce couple).
        for k in &keys {
            self.purge_anomaly_busy_for_key(k);
        }
        // AGENT JETABLE : « arrêter tous les agents » met aussi fin à leur durée
        // de vie (aucune tâche en cours → plus aucune définition éphémère).
        self.clear_ephemeral_agents();
    }

    /// Arrêt complet de toutes les sessions (issue #14). À la fermeture de Pilot.
    /// Appelé aussi par `update_pi` (mise à jour du binaire) SANS quitter
    /// l'application : la purge de la marque `busy` (réserve R2) a donc un
    /// intérêt réel — après la mise à jour, les sessions redémarrent et doivent
    /// repartir d'un état non occupé. (Sur le seul chemin de fermeture complète,
    /// la purge serait sans effet observable puisque le processus s'arrête, mais
    /// elle est inoffensive et garantit un contrat unique pour tous les arrêts.)
    pub fn shutdown_all(&self) {
        let keys: Vec<String> = {
            let mut sessions = self.sessions.lock().unwrap();
            let keys: Vec<String> = sessions.keys().cloned().collect();
            for (_, mut entry) in sessions.drain() {
                rpc_manager::stop_session(&mut entry.session);
            }
            keys
        };
        self.session_uids.lock().unwrap().clear();
        *self.active.lock().unwrap() = None;
        // Réserve R2 : même remise à zéro que `stop` pour chaque couple arrêté.
        for k in &keys {
            self.purge_anomaly_busy_for_key(k);
        }
        // AGENT JETABLE : fermeture de Pilot = plus aucun agent jetable vivant.
        self.clear_ephemeral_agents();
    }

    /// Vue d'ensemble de TOUTES les sessions d'agents du registre (P2).
    /// Retourne une liste JSON avec, pour chaque session : projet, agent, mode
    /// (main/agent_process), état (active/parked), vivacité du processus,
    /// visibilité (table agents), pointeur actif (chat principal) et, si une
    /// activité a été enregistrée, la dernière activité (lastActivity ISO,
    /// lastActivityRelative « il y a X min » et lastEvent).
    /// Consommé par l'assistant (super-agent) via l'outil `list_agent_sessions`
    /// pour superviser l'état des agents et juger leur progression.
    pub fn list_agent_sessions(&self, app: &AppHandle) -> Result<Value, String> {
        let active = self.active.lock().unwrap().clone();
        // Collecte sous le verrou, puis libération avant les accès DB (visible).
        let raw = {
            let mut sessions = self.sessions.lock().unwrap();
            collect_session_states(&mut sessions, &active)
        };
        // Source de vérité de la dernière activité : map d'anomalie (tâche 8),
        // clé composite `project\u{1f}agent`. Alimentée par l'observateur RPC.
        let anomaly_map = app.state::<AppState>().agent_anomaly.clone();
        let mut out = Vec::new();
        for (project, agent_id, state, mode, alive, is_active) in raw {
            // Visibilité depuis la table agents (projet porté par la session).
            // Tâche #140 : pour les agents d'assistant (projet réservé
            // `ASSISTANT_SPACE`), l'agent est GLOBAL (project_path NULL) → on
            // résout la visibilité via `get_agent(None, agent_id)`.
            let visible = if project == ASSISTANT_SPACE {
                self.get_agent(app, &agent_id, None)
                    .ok()
                    .flatten()
                    .map(|a| a.visible)
                    .unwrap_or(false)
            } else {
                self.get_agent(app, &agent_id, Some(&project))
                    .ok()
                    .flatten()
                    .map(|a| a.visible)
                    .unwrap_or(false)
            };
            // Dernière activité depuis la map d'anomalie (champs optionnels).
            let (last_activity, last_activity_relative, last_event, busy, tool_in_progress, is_working) = {
                let m = anomaly_map.lock().unwrap();
                match m.get(&format!("{}\u{1f}{}", project, agent_id)) {
                    Some(a) => {
                        let (iso, rel) = anomaly::last_activity_info(a);
                        // isWorking (chantier « l'assistant relance des agents qui
                        // travaillent ») : réponse SANS ambiguïté à la seule question
                        // qui compte pour le LLM — « travaille-t-il maintenant ? ».
                        // Même règle que la sonde de vivacité du frontend
                        // (exclusivity-queue.js `isSessionWorking`) : processus vivant
                        // ET (tâche en cours, outil en cours, ou activité depuis moins
                        // de 2 min). `state`/`active` restent exposés (ils décrivent
                        // l'ONGLET, pas le travail) mais ne doivent plus servir à
                        // conclure « au repos ».
                        let working = session_is_working(
                            alive,
                            a.busy,
                            a.tool_in_progress,
                            a.last_activity.elapsed().as_secs(),
                        );
                        (
                            iso,
                            rel,
                            Some(a.last_event.clone()),
                            Some(a.busy),
                            Some(a.tool_in_progress),
                            Some(working),
                        )
                    }
                    None => (None, None, None, None, None, None),
                }
            };
            let mut entry = session_entry_json(
                &project,
                &agent_id,
                mode.as_str(),
                state.as_str(),
                alive,
                visible,
                is_active,
                busy,
                tool_in_progress,
                is_working,
            );
            // Champs optionnels : absents si aucune activité enregistrée.
            if let Some(la) = last_activity {
                entry["lastActivity"] = serde_json::Value::String(la);
            }
            if let Some(lar) = last_activity_relative {
                entry["lastActivityRelative"] = serde_json::Value::String(lar);
            }
            if let Some(le) = last_event {
                entry["lastEvent"] = serde_json::Value::String(le);
            }
            // sessionUid (trou d'arrêt ciblé, diagnostic 2026-10-21) : identifiant
            // INTERNE de la session dans le registre du service. Un arrêt CIBLÉ doit
            // le transmettre (`expectedUid`) : sans lui, un arrêt qui arrive après
            // la relance du même couple (projet, agent) tue la session NEUVE d'une
            // autre exécution. Champ ADDITIF (absent si aucune session).
            if let Some(uid) = self.session_uid(&project, &agent_id) {
                entry["sessionUid"] = serde_json::json!(uid);
            }
            // prompt : DERNIER prompt réellement envoyé à cette session, déjà
            // tronqué (`record_prompt`). Sert à afficher les missions en cours
            // (panneau de la cloche). Champ ADDITIF : absent tant qu'aucun prompt
            // n'a été envoyé à la session.
            if let Some(p) = self
                .last_prompts
                .lock()
                .unwrap()
                .get(&format!("{}\u{1f}{}", project, agent_id))
            {
                entry["prompt"] = serde_json::Value::String(p.clone());
            }
            // resume : RÉSUMÉ COURT fourni AVEC la demande (une phrase). Champ
            // ADDITIF : absent quand la demande n'en portait pas — le panneau
            // retombe alors sur l'extraction de l'objectif. Sert à afficher, en
            // PREMIER, ce que fait réellement la tâche, sans le déduire du prompt.
            if let Some(r) = self.resume_of(&format!("{}\u{1f}{}", project, agent_id)) {
                entry["resume"] = serde_json::Value::String(r);
            }
            // sessionId (chantier restitution fin-de-run) : identifiant de session
            // pi, exposé pour que l'assistant puisse cibler get_delegation_result
            // (résultat d'une délégation) ou arrêter précisément une session.
            // Uniquement pour les sessions VIVANTES ; get_state répond même en
            // cours de streaming (lecture seule, timeout court, échec toléré :
            // le champ reste simplement absent).
            if alive {
                let probe = self.send_sync_timeout(
                    &project,
                    &agent_id,
                    serde_json::json!({ "type": "get_state" }),
                    2,
                );
                if let Ok(state_val) = probe {
                    // Fallbacks défensifs selon les versions de pi : data.* puis racine.
                    let data = state_val.get("data").unwrap_or(&state_val);
                    let sid = data
                        .get("sessionId")
                        .and_then(|v| v.as_str())
                        .or_else(|| state_val.get("sessionId").and_then(|v| v.as_str()))
                        .unwrap_or("");
                    if !sid.is_empty() {
                        entry["sessionId"] = serde_json::Value::String(sid.to_string());
                    }
                }
            }
            out.push(entry);
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
            &[],
            Vec::new(),
            app.clone(),
            state.event_tx.clone(),
            "rpc-event-reviewer",
            None,
            // Tâche 8 : observateur combiné → surveillance d'anomalie par agent.
            Some(anomaly::make_observer(
                &state.agent_activity,
                &state.agent_anomaly,
                project,
                &format!("{}\u{1f}{}", project, ORCH_REVIEWER_ID),
            )),
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
        thinking_level: &str,
    ) -> Result<(), String> {
        // Anti-course : sérialise le démarrage. Plusieurs commandes concurrentes
        // (start_super_agent_session, get_super_agent_state, send_super_agent_prompt)
        // peuvent appeler ce lazy-start au même moment à l'ouverture de l'onglet.
        // Le spawn se fait hors du verrou `sessions` (il est lent : écriture des
        // extensions + lancement de node) → sans sérialisation, deux appels
        // concurrents spawnaient chacun un processus et le second orphelinait le
        // premier (process_exit fantôme + boucle). Le garde (y compris en cas
        // d'erreur `?`) est relâché à la fin de la fonction.
        let _start_guard = self.superagent_start_lock.lock().unwrap();
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
                // Processus mort : enregistrer un crash éventuel (anti-boucle de
                // redémarrage) avant de retirer l'entrée. La politique est
                // logique pure (pas d'accès session) → pas de verrou croisé.
                let last_start = *self.superagent_last_start.lock().unwrap();
                let now = Instant::now();
                let mut policy = self.superagent_policy.lock().unwrap();
                policy.record_death(last_start, now);
                drop(policy);
                sessions.remove(&key);
            }
        }
        // Garde anti-boucle : si trop de crashs rapides consécutifs ont bloqué
        // le redémarrage (cooldown), NE PAS relancer le processus → erreur claire
        // (l'utilisateur sait quoi faire) au lieu de tourner en boucle.
        let blocked_secs = {
            let mut policy = self.superagent_policy.lock().unwrap();
            policy.blocked_remaining(Instant::now())
        };
        if let Some(secs) = blocked_secs {
            let base = format!(
                "Le super-agent (Assistant) a crashé plusieurs fois de suite. Redémarrage automatique bloqué pendant encore {} s pour éviter une boucle. Réessayez plus tard ou fermez/réouvrez l'onglet.",
                secs
            );
            return Err(append_ext_diag_hint(cwd, base));
        }
        // (Re)création de la session : réinitialiser l'entrée de surveillance
        // d'anomalie du super-agent (issue #141). Ne jamais laisser le flag
        // `busy` bloqué à true entre deux lancements (process mort en pleine
        // génération) : le reset efface busy/blocked/auto_stopped/last_activity.
        {
            let state = app.state::<AppState>();
            state
                .agent_anomaly
                .lock()
                .unwrap()
                .remove(&format!("\u{1f}{}", SUPERAGENT_ID));
        }
        // P0 (issue #84) : sur échec de spawn, enrichir le diagnostic avec
        // l'hypothèse d'extensions projet (.pi/extensions) si présentes.
        let session = match Self::spawn_superagent_session(app, cwd, pi_path) {
            Ok(s) => s,
            Err(e) => return Err(append_ext_diag_hint(cwd, e)),
        };
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
        // Enregistrer l'instant de démarrage pour la détection de crash rapide.
        *self.superagent_last_start.lock().unwrap() = Some(Instant::now());
        // Démarrer une nouvelle session (contexte vierge) puis appliquer le
        // modèle par défaut (registre global) pour répondre au 1er prompt.
        let cmd = serde_json::json!({ "type": "new_session" });
        self.send_superagent_sync(cmd).ok();
        if let Some((provider, model_id)) = default_model {
            let cmd = serde_json::json!({ "type": "set_model", "provider": provider, "modelId": model_id });
            self.send_superagent_sync(cmd).ok();
        }
        // T6 : niveau de réflexion de l'Assistant (même séquence que les agents :
        // après le set_model ci-dessus → interroger → ramener → poser).
        self.apply_superagent_thinking(thinking_level);
        Ok(())
    }

    /// T6 : applique le **niveau de réflexion** à la session fraîchement amorcée
    /// de l'Assistant (🧭), après son `set_model` (séquence stricte du plan :
    /// set_model → get_available_thinking_levels → ramenage → set_thinking_level).
    ///
    /// `wanted` est le niveau voulu, déjà résolu par
    /// `super_agent::resolve_super_agent_thinking_level`. Chaîne vide = aucun
    /// réglage → rien n'est envoyé (le moteur garde son défaut : zéro régression).
    ///
    /// Fail-open : toute erreur (commande inconnue d'un pi ancien, timeout, refus)
    /// se traduit par une simple trace ; la session de l'Assistant démarre quand
    /// même. Le réglage enregistré n'est jamais modifié par le ramenage : seule la
    /// session applique le niveau *effectif* maximum supporté par le modèle.
    fn apply_superagent_thinking(&self, wanted: &str) {
        if wanted.is_empty() {
            return;
        }
        // La session vivante est l'autorité sur les niveaux réellement supportés.
        let available = match self
            .send_superagent_sync_timeout(serde_json::json!({ "type": "get_available_thinking_levels" }), 12)
        {
            Ok(resp) => crate::thinking::levels_from_rpc_response(&resp),
            Err(e) => {
                eprintln!(
                    "[agent-service] niveaux de réflexion indisponibles pour l'Assistant : {}",
                    e
                );
                return;
            }
        };
        let Some(level) = crate::thinking::resolve_thinking_level(&[wanted], &available) else {
            eprintln!(
                "[agent-service] aucun niveau de réflexion applicable pour l'Assistant (voulu : {}) — le moteur garde son défaut.",
                wanted
            );
            return;
        };
        eprintln!(
            "[agent-service] niveau de réflexion résolu pour l'Assistant : {} (voulu : {})",
            level, wanted
        );
        let cmd = serde_json::json!({ "type": "set_thinking_level", "level": level });
        if let Err(e) = self.send_superagent_sync_timeout(cmd, 12) {
            eprintln!(
                "[agent-service] set_thinking_level initial non appliqué pour l'Assistant : {}",
                e
            );
        }
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

    // ── Assistant de groupe (GDS Phase C2) ──
    // Session RPC dédiée (canal `rpc-event-group`, extension
    // pilot-group-assistant), globale (multi-projets) : stockée sous un projet
    // pseudo-global "". Lecture seule stricte : répond aux questions sur les
    // projets du groupe en lisant le suivi fusionné (clients, projets, tâches,
    // décisions) sans jamais modifier le code. Respecte `gds_enabled` (le
    // démarrage est refusé si le GDS est désactivé globalement).

    /// Démarre (ou reprend) la session de l'assistant de groupe. Idempotent :
    /// si un processus vivant existe déjà, ne fait rien. Sinon lance un nouveau
    /// processus pi `--no-session` avec l'extension pilot-group-assistant.
    pub fn start_group_assistant(
        &self,
        app: &AppHandle,
        cwd: &str,
        pi_path: &str,
        default_model: Option<(String, String)>,
    ) -> Result<(), String> {
        let key = Self::session_key("", GROUP_ASSISTANT_ID);
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
        let session = match Self::spawn_group_assistant_session(app, cwd, pi_path) {
            Ok(s) => s,
            Err(e) => return Err(e),
        };
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
        // modèle par défaut pour répondre au 1er prompt.
        let cmd = serde_json::json!({ "type": "new_session" });
        self.send_group_assistant_sync(cmd).ok();
        if let Some((provider, model_id)) = default_model {
            let cmd = serde_json::json!({ "type": "set_model", "provider": provider, "modelId": model_id });
            self.send_group_assistant_sync(cmd).ok();
        }
        Ok(())
    }

    /// Arrête la session de l'assistant de groupe (état Stopped, processus tué).
    pub fn stop_group_assistant(&self) -> Result<(), String> {
        self.stop("", GROUP_ASSISTANT_ID)
    }

    /// Indique si la session de l'assistant de groupe est vivante (déjà lancée).
    pub fn group_assistant_alive(&self) -> bool {
        let key = Self::session_key("", GROUP_ASSISTANT_ID);
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

    /// Route une commande asynchrone vers la session de l'assistant de groupe.
    pub fn send_group_assistant(&self, command: Value) -> Result<(), String> {
        self.send("", GROUP_ASSISTANT_ID, command)
    }

    /// Route une commande synchrone vers la session de l'assistant de groupe.
    pub fn send_group_assistant_sync(&self, command: Value) -> Result<Value, String> {
        self.send_sync("", GROUP_ASSISTANT_ID, command)
    }

    /// Lance un nouveau processus pi --mode rpc pour l'assistant de groupe.
    /// Reproduit la logique de `spawn_superagent_session` (canal
    /// `rpc-event-group`, extension pilot-group-assistant, `--no-session`).
    fn spawn_group_assistant_session(
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
                    // Écriture FIABLE (tâche 361) : jamais de fichier périmé passé
                    // en --extension, échec journalisé.
                    let report = crate::extension_write::write_embedded_batch(
                        &dir,
                        &[(
                            "pilot-group-assistant.ts",
                            include_str!("../extensions/pilot-group-assistant.ts"),
                        )],
                    );
                    Self::log_extension_failures("assistant de groupe", &report);
                    extensions = report.paths;
                } else {
                    // Tâche 361 : un dossier d'extensions inutilisable laissait la
                    // session démarrer SANS aucune extension, en silence. L'échec est
                    // désormais visible dans les journaux (même famille de défaut que
                    // l'écriture avalée).
                    eprintln!(
                        "[extensions] assistant de groupe : dossier d'extensions inutilisable ({}) — session lancée SANS extensions",
                        dir.display()
                    );
                }
            }
        }
        let session = rpc_manager::spawn_and_start(
            cwd,
            pi_path,
            true, // no_session : contexte vierge, jetable
            "",
            &[],
            extensions,
            app.clone(),
            state.event_tx.clone(),
            GROUP_ASSISTANT_CHANNEL,
            None,
            None,
            Some(GROUP_ASSISTANT_ID.to_string()),
            None,
        )
        .map_err(|e| format!("Erreur lancement de l'assistant de groupe : {}", e))?;
        Ok(session)
    }

    // ── Agents d'assistant (tâche #140) ──
    // Sessions déléguées par le super-agent à des agents SANS les rattacher à
    // un projet. Stockées dans le registre unique sous la clé composite
    // `ASSISTANT_SPACE\u{1f}<agent_id>` (projet pseudo-réservé "__assistant__",
    // jamais un vrai chemin de projet). Le processus pi tourne dans l'espace de
    // travail assistant `~/.pilot/assistant/...`. Ces agents sont des agents
    // GLOBAUX (project_path = NULL dans la table agents) : leur visibilité est
    // donc résolue via `get_agent(None, agent_id)`.

    /// Dossier de travail réservé des agents d'assistant (`~/.pilot/assistant`).
    /// Créé à l'usage (pas de pré-génération) ; sert de `cwd` aux processus pi
    /// des agents d'assistant (découplé de tout projet réel).
    pub fn assistant_workspace() -> Result<std::path::PathBuf, String> {
        let dir = pilot_user_dir()?.join("assistant");
        std::fs::create_dir_all(&dir).map_err(|e| format!("Création espace assistant: {}", e))?;
        Ok(dir)
    }

    /// Démarre (ou reprend) la session d'un agent d'assistant. Stockée sous la
    /// clé `ASSISTANT_SPACE\u{1f}<agent_id>`, processus lancé dans `space_cwd`
    /// (défaut `~/.pilot/assistant`). Reprend une session vivante ; sinon lance
    /// un nouveau processus. Retourne `true` si la session a été reprise
    /// (processus vivant), `false` si un nouveau processus a été lancé.
    pub fn start_assistant_agent(
        &self,
        app: &AppHandle,
        agent_id: &str,
        pi_path: &str,
        no_session: bool,
        space_cwd: &str,
        mcp_server: Option<String>,
    ) -> Result<bool, String> {
        let key = Self::session_key(ASSISTANT_SPACE, agent_id);
        // Le frontend passe le token réservé ASSISTANT_SPACE comme `space_cwd`
        // (jamais un vrai chemin) : on ne doit JAMAIS l'utiliser tel quel comme
        // répertoire de travail du processus pi. On le résout vers l'espace
        // assistant réel `~/.pilot/assistant` (idem si vide). Tout autre chemin
        // explicite est conservé tel quel.
        let cwd = if space_cwd.trim().is_empty() || space_cwd.trim() == ASSISTANT_SPACE {
            Self::assistant_workspace()?.to_string_lossy().to_string()
        } else {
            space_cwd.to_string()
        };
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
                    true
                } else {
                    sessions.remove(&key);
                    false
                }
            } else {
                false
            }
        };
        if resumed {
            // Agent global (scope NULL) : visibilité/état par project_path None.
            self.set_state(app, agent_id, None, true, false, &AgentProcessState::Running).ok();
            return Ok(true);
        }
        let session = Self::spawn_assistant_session(app, agent_id, pi_path, no_session, &cwd, mcp_server)?;
        {
            let mut sessions = self.sessions.lock().unwrap();
            sessions.insert(
                key,
                SessionEntry {
                    session,
                    project: ASSISTANT_SPACE.to_string(),
                    state: SessionState::Active,
                    mode: SpawnMode::AssistantAgent,
                },
            );
        }
        self.set_state(app, agent_id, None, true, false, &AgentProcessState::Running).ok();
        Ok(false)
    }

    /// Issue #87 (défaut résiduel n°1) : remet à zéro l'état persistant d'un
    /// agent GLOBAL (`project_path` NULL, espace assistant) après son arrêt
    /// explicite. Sans cela, la ligne `agents` restait `proc_state='Running'` et
    /// `loaded=1` alors que le processus venait d'être tué (seule la purge
    /// périodique des fantômes rattrapait l'incohérence, avec un délai).
    /// Prend la connexion en paramètre pour rester testable de façon
    /// déterministe. Tolérante : renvoie le nombre de lignes mises à jour
    /// (0 si l'agent n'a aucune ligne persistée).
    pub(crate) fn reset_global_agent_state(
        &self,
        conn: &rusqlite::Connection,
        agent_id: &str,
    ) -> Result<usize, String> {
        conn.execute(
            "UPDATE agents SET loaded = 0, busy = 0, proc_state = 'Stopped'
             WHERE id = ?1 AND project_path IS NULL",
            params![agent_id],
        )
        .map_err(|e| format!("Erreur reset_global_agent_state: {}", e))
    }

    /// Arrête la session d'un agent d'assistant (processus tué, session retirée).
    pub fn stop_assistant_agent(&self, agent_id: &str) -> Result<(), String> {
        let key = Self::session_key(ASSISTANT_SPACE, agent_id);
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(mut entry) = sessions.remove(&key) {
            rpc_manager::stop_session(&mut entry.session);
        }
        drop(sessions);
        // Issue #87 (défaut résiduel n°1) : garantir l'état final
        // `Stopped`/`loaded=0`/`busy=0` de la ligne persistée (agent global,
        // `project_path` NULL). Tolérant : l'agent peut n'avoir aucune ligne.
        if let Some(app) = self.app.lock().unwrap().clone() {
            if let Ok(conn) = db::open_conn(&app) {
                self.reset_global_agent_state(&conn, agent_id).ok();
            }
        }
        Ok(())
    }

    /// Arrête TOUTES les sessions des agents d'assistant. Appelé à la fermeture
    /// de l'onglet Assistant (le super-agent ne doit pas laisser de processus
    /// d'assistant orphelins). N'affecte ni les agents de projets ni le
    /// super-agent (mode distinct).
    pub fn stop_assistant_agents(&self) {
        let mut sessions = self.sessions.lock().unwrap();
        let keys: Vec<String> = sessions
            .iter()
            .filter(|(_, e)| e.mode == SpawnMode::AssistantAgent)
            .map(|(k, _)| k.clone())
            .collect();
        for k in keys {
            if let Some(mut entry) = sessions.remove(&k) {
                rpc_manager::stop_session(&mut entry.session);
            }
        }
    }

    /// Indique si la session d'un agent d'assistant est vivante (déjà lancée).
    #[allow(dead_code)]
    pub fn assistant_agent_alive(&self, agent_id: &str) -> bool {
        let key = Self::session_key(ASSISTANT_SPACE, agent_id);
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

    /// Route une commande asynchrone vers la session d'un agent d'assistant.
    pub fn send_assistant_agent(&self, agent_id: &str, command: Value) -> Result<(), String> {
        self.send(ASSISTANT_SPACE, agent_id, command)
    }

    /// Route une commande synchrone vers la session d'un agent d'assistant.
    #[allow(dead_code)]
    pub fn send_assistant_agent_sync(&self, agent_id: &str, command: Value) -> Result<Value, String> {
        self.send_sync(ASSISTANT_SPACE, agent_id, command)
    }

    /// Écrit les extensions assistant LECTURE SEULE sur disque et retourne leurs
    /// chemins. Réutilisé par `spawn_assistant_session` (les agents d'assistant
    /// tournent dans `~/.pilot/assistant/`, pas dans un projet). Retourne la
    /// liste des chemins d'extensions construits (vide si non supporté).
    ///
    /// Tâche 361 : l'échec d'écriture n'est plus avalé. Le rapport contient les
    /// chemins RÉELLEMENT à jour et la liste des échecs (journalisés) ; un
    /// fichier périmé n'est jamais retourné comme chemin d'extension.
    fn write_assistant_extensions(
        app: &AppHandle,
        pi_path: &str,
        want_mcp: bool,
    ) -> crate::extension_write::BatchReport {
        let state = app.state::<AppState>();
        let mut report = crate::extension_write::BatchReport::default();
        if !probe_extension_support(&state, pi_path) {
            return report;
        }
        let Ok(data_dir) = app.path().app_data_dir() else {
            return report;
        };
        let dir = data_dir.join("extensions");
        if std::fs::create_dir_all(&dir).is_err() {
            // Un dossier inutilisable n'est pas un succès : l'échec est remonté.
            report.failures.push(format!(
                "dossier d'extensions inutilisable : {}",
                dir.display()
            ));
            return report;
        }
        let mut files: Vec<(&str, &str)> = vec![
            ("pilot-assistant-files.ts", include_str!("../extensions/pilot-assistant-files.ts")),
            ("pilot-choices.ts", include_str!("../extensions/pilot-choices.ts")),
            ("pilot-assistant-actions.ts", include_str!("../extensions/pilot-assistant-actions.ts")),
            ("pilot-assistant-db.ts", include_str!("../extensions/pilot-assistant-db.ts")),
            ("pilot-assistant-prompt.ts", include_str!("../extensions/pilot-assistant-prompt.ts")),
            ("pilot-assistant-sessions.ts", include_str!("../extensions/pilot-assistant-sessions.ts")),
            ("pilot-assistant-delegation.ts", include_str!("../extensions/pilot-assistant-delegation.ts")),
            ("pilot-assistant-schedule.ts", include_str!("../extensions/pilot-assistant-schedule.ts")),
            ("pilot-assistant-tools.ts", include_str!("../extensions/pilot-assistant-tools.ts")),
            ("pilot-assistant-session-memory.ts", include_str!("../extensions/pilot-assistant-session-memory.ts")),
            // Documentation intégrée : l'assistant répond au mode d'emploi de
            // Pilot (outil `answer_from_documentation`, 1 appel par tour) via la
            // commande du socle `ask_help_doc`. Lecture seule, sans projet.
            ("pilot-assistant-doc.ts", include_str!("../extensions/pilot-assistant-doc.ts")),
            // Passerelle du visage : outils set_expression/get_status/set_position/
            // reset fournis par Pilot (aucun processus externe, ni Node ni MCP).
            ("pilot-face.ts", include_str!("../extensions/pilot-face.ts")),
        ];
        // Assistant piloté MCP (brique B) : extension client MCP ajoutée à la
        // demande uniquement (serveur cible désigné + MCP activé).
        if want_mcp {
            files.push((
                "pilot-mcp-client.ts",
                include_str!("../extensions/pilot-mcp-client.ts"),
            ));
        }
        // Écriture FIABLE (tâche 361) : un fichier resté en lecture seule est
        // remplacé, un contenu déjà à jour n'est pas réécrit, et un échec est
        // remonté (rapport + journal) au lieu d'être avalé.
        report = crate::extension_write::write_embedded_batch(&dir, &files);
        // Cœur de la passerelle du visage : module importé par pilot-face.ts
        // (`./face-gateway.js`). Écrit à côté MAIS pas passé en --extension
        // (ce n'est pas une extension, seulement un module résolu par import).
        if let Err(e) = crate::extension_write::write_embedded(
            &dir.join("face-gateway.js"),
            include_str!("../../src/js/face-gateway.js"),
        ) {
            eprintln!("[extensions] face-gateway.js non écrit : {}", e);
        }
        // Service Laya : l'outil `laya_classify` doit aussi être disponible pour
        // les agents d'assistant (tâche #140), qui tournent dans
        // `~/.pilot/assistant/` et non dans un projet.
        match Self::write_laya_extension(&dir) {
            Ok(laya_file) => report.paths.push(laya_file),
            Err(e) => report.failures.push(e),
        }
        report
    }

    /// Journalise les échecs d'écriture d'un lot d'extensions SANS interrompre le
    /// lancement (chemins autres que les agents d'assistant : la session peut
    /// démarrer avec MOINS d'outils, mais jamais avec un fichier périmé, et
    /// l'échec reste visible dans les journaux — jamais avalé). Tâche 361.
    fn log_extension_failures(context: &str, report: &crate::extension_write::BatchReport) {
        if !report.is_complete() {
            eprintln!(
                "[extensions] {} : écriture incomplète, session lancée SANS les fichiers périmés — {}",
                context,
                report.failure_summary()
            );
        }
    }

    /// Chaîne du secret (E2) : complète les variables d'environnement MCP d'une
    /// session avec la clé du serveur de la session (`PILOT_MCP_SECRET`), lue dans
    /// le coffre chiffré (`~/.pilot/vault.json`). Ne bloque jamais — coffre
    /// verrouillé ou référence inconnue → session lancée sans ce serveur — et ne
    /// journalise JAMAIS la clé : le diagnostic est masqué (`redact_token`,
    /// réutilisé via `mcp_config`).
    fn attach_mcp_secret_env(
        app: &AppHandle,
        vars: &mut Vec<(String, String)>,
        target: Option<&str>,
    ) {
        let Some(dir) = app.path().app_data_dir().ok() else {
            return;
        };
        let Ok(vault_file) = crate::vault::vault_file_path() else {
            return;
        };
        let vault_key = app.state::<AppState>().vault_key.lock().unwrap().clone();
        // Mode strict de la clé du coffre (défaut ON) : une clé n'est posée que
        // pour le serveur qui la déclare ; le mode non strict conserve le
        // comportement antérieur.
        let strict = app.state::<AppState>().config_snapshot().mcp_secret_strict;
        let attachment = crate::mcp_config::attach_mcp_secret(
            vars,
            &dir.join("mcp.json"),
            vault_key.as_deref(),
            &vault_file,
            target,
            strict,
        );
        eprintln!("[mcp-secret] {}", attachment.message);
    }

    /// Lance un nouveau processus pi --mode rpc pour un agent d'assistant.
    /// Canal rpc-event-agents (comme les agents multi-rôles), extensions
    /// assistant LECTURE SEULE (comme le super-agent), SANS porte pré-écriture
    /// `pilot-reserve-gate` ni injection de contexte projet `pilot-context`
    /// (ces agents tournent dans `~/.pilot/assistant/`, pas dans un projet).
    fn spawn_assistant_session(
        app: &AppHandle,
        agent_id: &str,
        pi_path: &str,
        no_session: bool,
        cwd: &str,
        mcp_server: Option<String>,
    ) -> Result<rpc_manager::RpcSession, String> {
        let state = app.state::<AppState>();
        let mcp_enabled = state.config_snapshot().mcp_enabled;
        // Agent d'assistant piloté MCP (brique B) : si MCP est activé ET qu'un
        // serveur cible est désigné, on écrit l'extension client MCP en plus des
        // extensions assistant standards. Jamais au démarrage (à la demande).
        let want_mcp = mcp_enabled && mcp_server.as_deref().map(str::trim).unwrap_or("") != "";
        let ext_report = Self::write_assistant_extensions(app, pi_path, want_mcp);
        // Tâche 361 : ne JAMAIS lancer une session avec des outils périmés ou
        // incomplets. Un échec d'écriture est remonté à l'appelant (l'assistant
        // voit une erreur explicite qui nomme les fichiers) au lieu d'être avalé.
        if !ext_report.is_complete() {
            return Err(format!(
                "Extensions de l'assistant non écrites — session NON lancée pour éviter \
                 des outils périmés : {}",
                ext_report.failure_summary()
            ));
        }
        let extensions = ext_report.paths;
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
        // Agent d'assistant piloté MCP (brique B) : expose le mcp.json
        // (PILOT_MCP_CONFIG) et le serveur cible (PILOT_MCP_SERVER) au process pi.
        // Uniquement si l'extension MCP est chargée (serveur désigné + MCP activé).
        let mcp_env_vars: Option<Vec<(String, String)>> = if extensions
            .iter()
            .any(|e| e.contains("pilot-mcp-client.ts"))
        {
            app.path().app_data_dir().ok().map(|d| {
                let mut vars = vec![(
                    "PILOT_MCP_CONFIG".to_string(),
                    d.join("mcp.json").to_string_lossy().into_owned(),
                )];
                if let Some(srv) = mcp_server.as_deref() {
                    if !srv.trim().is_empty() {
                        vars.push(("PILOT_MCP_SERVER".to_string(), srv.trim().to_string()));
                    }
                }
                Self::attach_mcp_secret_env(app, &mut vars, mcp_server.as_deref());
                vars
            })
        } else {
            None
        };
        let session = rpc_manager::spawn_and_start(
            cwd,
            pi_path,
            no_session,
            &session_dir_str,
            &[],
            extensions,
            app.clone(),
            state.event_tx.clone(),
            "rpc-event-agents",
            Some(agent_id),
            // Observateur d'anomalie par agent (clé réservée ASSISTANT_SPACE).
            Some(anomaly::make_observer(
                &state.agent_activity,
                &state.agent_anomaly,
                ASSISTANT_SPACE,
                &format!("{}\u{1f}{}", ASSISTANT_SPACE, agent_id),
            )),
            None,
            mcp_env_vars,
        )
        .map_err(|e| format!("Erreur lancement agent d'assistant {} : {}", agent_id, e))?;
        Ok(session)
    }

    /// Lance un nouveau processus pi --mode rpc pour le super-agent (Assistant
    /// 🧭). Canal dédié `rpc-event-superagent`, `--no-session`, pas de skill,
    /// extensions assistant (pilot-assistant-files lecture seule, pilot-choices,
    /// pilot-assistant-actions, pilot-assistant-db, pilot-assistant-prompt,
    /// pilot-assistant-sessions, pilot-assistant-session-memory).
    /// Reproduit l'ancien `do_start_super_agent_session` (super_agent.rs).
    fn spawn_superagent_session(
        app: &AppHandle,
        cwd: &str,
        pi_path: &str,
    ) -> Result<rpc_manager::RpcSession, String> {
        let state = app.state::<AppState>();
        let mcp_enabled = state.config_snapshot().mcp_enabled;
        let mut extensions: Vec<String> = Vec::new();
        let mut probe = probe_backend(&state, pi_path);
        // Correctif démarrage lent : si la sonde échoue (timeout transitoire
        // pendant le boot), re-sonder une fois avant de conclure
        // `ext_supported=false`. `probe_backend` ne met pas en cache une sonde
        // échouée, donc ce second appel relance réellement la sonde.
        if probe.probe_failed {
            probe = probe_backend(&state, pi_path);
        }
        let ext_supported = probe.ext_supported;
        // Tâche #136 : diagnostic — confirmer pourquoi la liste d'outils du
        // super-agent est vide sur certains backends (ex: plh). Journalise la
        // porte, le nombre d'extensions construites et le dossier utilisé.
        if ext_supported {
            if let Ok(data_dir) = app.path().app_data_dir() {
                let dir = data_dir.join("extensions");
                if std::fs::create_dir_all(&dir).is_ok() {
                    let mut files: Vec<(&str, &str)> = vec![
                        ("pilot-assistant-files.ts", include_str!("../extensions/pilot-assistant-files.ts")),
                        ("pilot-choices.ts", include_str!("../extensions/pilot-choices.ts")),
                        ("pilot-assistant-actions.ts", include_str!("../extensions/pilot-assistant-actions.ts")),
                        ("pilot-assistant-db.ts", include_str!("../extensions/pilot-assistant-db.ts")),
                        ("pilot-assistant-prompt.ts", include_str!("../extensions/pilot-assistant-prompt.ts")),
                        ("pilot-assistant-sessions.ts", include_str!("../extensions/pilot-assistant-sessions.ts")),
                        ("pilot-assistant-delegation.ts", include_str!("../extensions/pilot-assistant-delegation.ts")),
                        ("pilot-assistant-schedule.ts", include_str!("../extensions/pilot-assistant-schedule.ts")),
                        ("pilot-assistant-tools.ts", include_str!("../extensions/pilot-assistant-tools.ts")),
                        ("pilot-assistant-session-memory.ts", include_str!("../extensions/pilot-assistant-session-memory.ts")),
                        // Documentation intégrée : l'assistant répond au mode
                        // d'emploi de Pilot (outil `answer_from_documentation`,
                        // 1 appel par tour) via la commande du socle
                        // `ask_help_doc`. Lecture seule, sans projet.
                        ("pilot-assistant-doc.ts", include_str!("../extensions/pilot-assistant-doc.ts")),
                        // Passerelle du visage : outils de pilotage de PLface fournis
                        // par Pilot (aucun processus externe, ni Node ni MCP).
                        ("pilot-face.ts", include_str!("../extensions/pilot-face.ts")),
                    ];
                    // Assistant piloté MCP (brique A) : si MCP est activé, l'assistant
                    // charge l'extension client MCP (comme l'agent standard) pour
                    // découvrir les serveurs avec ses outils mcp_<serveur>_<outil>.
                    if mcp_enabled {
                        files.push((
                            "pilot-mcp-client.ts",
                            include_str!("../extensions/pilot-mcp-client.ts"),
                        ));
                    }
                    // Écriture FIABLE (tâche 361) : un fichier resté en lecture seule
                    // est remplacé, un contenu déjà à jour n'est pas réécrit, un échec
                    // est journalisé et le fichier concerné n'est PAS transmis.
                    let mut report = crate::extension_write::write_embedded_batch(&dir, &files);
                    // Le module `face-gateway.js` (cœur pur) est écrit à côté mais
                    // n'est PAS passé en --extension (ce n'est pas une extension).
                    if let Err(e) = crate::extension_write::write_embedded(
                        &dir.join("face-gateway.js"),
                        include_str!("../../src/js/face-gateway.js"),
                    ) {
                        eprintln!("[extensions] face-gateway.js non écrit : {}", e);
                    }
                    // Service Laya : l'outil `laya_classify` doit être disponible
                    // pour la session de l'assistant comme pour tout autre agent.
                    match Self::write_laya_extension(&dir) {
                        Ok(laya_file) => report.paths.push(laya_file),
                        Err(e) => report.failures.push(e),
                    }
                    Self::log_extension_failures("super-agent", &report);
                    extensions = report.paths;
                } else {
                    // Tâche 361 : dossier inutilisable ⇒ plus aucun échec silencieux.
                    eprintln!(
                        "[extensions] super-agent : dossier d'extensions inutilisable ({}) — session lancée SANS extensions",
                        dir.display()
                    );
                }
            }
        }
        // Tâche #136 : diagnostic — journalise pi_path, le résultat de la porte,
        // le nombre d'extensions construites et le dossier d'extensions utilisé.
        {
            let ext_dir = app
                .path()
                .app_data_dir()
                .map(|d| d.join("extensions"))
                .ok();
            eprintln!(
                "[superagent-ext] spawn_superagent_session: pi_path={:?} ext_supported={} extensions_built={} ext_dir={:?}",
                pi_path,
                ext_supported,
                extensions.len(),
                ext_dir
            );
        }
        // Tâche #136 : enregistrer le statut d'extensions du super-agent (source
        // de ses outils) pour que le frontend puisse détecter une absence
        // d'outils et l'afficher comme une anomalie.
        *state.agent_service.superagent_ext.lock().unwrap() =
            Some(SuperAgentExtStatus { ext_supported, extensions_built: extensions.len(), probe_failed: probe.probe_failed });
        // Assistant piloté MCP (brique A) : expose le chemin du mcp.json au process
        // pi de l'assistant via PILOT_MCP_CONFIG (uniquement si l'extension MCP est
        // bien chargée). L'extension lit cette env au démarrage. E2 : la clé du
        // serveur de la session (premier activé, faute de cible) est ajoutée à part.
        let mcp_env_vars: Option<Vec<(String, String)>> = if mcp_enabled
            && extensions.iter().any(|e| e.contains("pilot-mcp-client.ts"))
        {
            app.path().app_data_dir().ok().map(|d| {
                let mut vars = vec![(
                    "PILOT_MCP_CONFIG".to_string(),
                    d.join("mcp.json").to_string_lossy().into_owned(),
                )];
                Self::attach_mcp_secret_env(app, &mut vars, None);
                vars
            })
        } else {
            None
        };
        let session = rpc_manager::spawn_and_start(
            cwd,
            pi_path,
            true, // no_session : contexte vierge, jetable
            "",
            &[],
            extensions,
            app.clone(),
            state.event_tx.clone(),
            SUPERAGENT_CHANNEL,
            None,
            // Tâche 8 : observateur combiné → surveillance d'anomalie par agent.
            // Restitution fiable : cet observateur déclenche aussi le rejeu des
            // résumés en attente quand la session se libère (agent_settled /
            // agent_end) — super_agent::make_superagent_session_observer compose
            // `anomaly::make_observer` (inchangé) + le déclencheur.
            Some(crate::super_agent::make_superagent_session_observer(app)),
            Some(SUPERAGENT_ID.to_string()),
            mcp_env_vars,
        )
        .map_err(|e| format!("Erreur lancement du super-agent : {}", e))?;
        Ok(session)
    }

    /// Lance un nouveau processus pi --mode rpc pour un agent multi-rôles H2 V2
    /// (et pour les agents lancés par l'assistant via `run_agents`).
    /// Reproduit la logique de `do_start_agent_process` (canal rpc-event-agents,
    /// dossier de session dédié par agent) + compétences : les skills de la
    /// bibliothèque commune listés par l'agent (`--skill`) et le filtrage strict
    /// `PILOT_AGENT_SKILLS` (extension toujours chargée `pilot-skills.ts`, D6).
    fn spawn_agent_process(
        app: &AppHandle,
        project: &str,
        agent_id: &str,
        pi_path: &str,
        no_session: bool,
        mcp_server: Option<String>,
    ) -> Result<rpc_manager::RpcSession, String> {
        let state = app.state::<AppState>();
        // #21 : quand l'assistant active l'héritage de contexte, les agents
        // spécifiques qu'il utilise (run_agents) chargent l'extension
        // pilot-context.ts (comme l'agent standard) pour hériter du contexte
        // projet (RAG/Context Engine + mémoire + Code Graph) en plus de leur rôle.
        let (inherit_context, mcp_enabled) = {
            let config = state.config_snapshot();
            (config.super_agent_inherit_context, config.mcp_enabled)
        };
        let mut extensions: Vec<String> = Vec::new();
        if probe_extension_support(&state, pi_path) {
            if let Ok(data_dir) = app.path().app_data_dir() {
                let dir = data_dir.join("extensions");
                if std::fs::create_dir_all(&dir).is_ok() {
                    // Porte pré-écriture (Phase 0 orchestration multi-agents) :
                    // bloque les écritures sur les fichiers réservés au codeur pour
                    // les autres spécialistes (pilot-reserve-gate). Le codeur n'est
                    // pas bloqué (l'extension compare l'agent_id via PILOT_AGENT_ID).
                    // Outils navigateur (pi-chrome) : autorise les outils chrome_*
                    // pour cette session d'agent (cf. extensions/pilot-chrome.ts).
                    let mut files: Vec<(&str, &str)> = vec![
                        ("pilot-reserve-gate.ts", include_str!("../extensions/pilot-reserve-gate.ts")),
                        ("pilot-chrome.ts", include_str!("../extensions/pilot-chrome.ts")),
                        // Filtrage STRICT des compétences (D6) : TOUJOURS chargé (jamais
                        // conditionné à `inherit_context`, sinon les compétences
                        // auto-découvertes fuiteraient dans les agents sans héritage).
                        ("pilot-skills.ts", include_str!("../extensions/pilot-skills.ts")),
                    ];
                    // #21 : quand l'assistant active l'héritage de contexte, les
                    // agents spécifiques chargent aussi pilot-context.ts (comme
                    // l'agent standard) pour hériter du contexte projet.
                    if inherit_context {
                        files.push(("pilot-context.ts", include_str!("../extensions/pilot-context.ts")));
                    }
                    // Agent piloté MCP (brique B) : si l'assistant a désigné un
                    // serveur MCP cible via run_agents (mcp_server) ET que MCP est
                    // activé, on charge l'extension client MCP à la volée pour CET
                    // agent. Jamais au démarrage (MCP ne s'ajoute qu'à la demande).
                    if mcp_enabled && mcp_server.as_deref().map(str::trim).unwrap_or("") != "" {
                        files.push((
                            "pilot-mcp-client.ts",
                            include_str!("../extensions/pilot-mcp-client.ts"),
                        ));
                    }
                    // Écriture FIABLE (tâche 361) : jamais de fichier périmé passé
                    // en --extension ; un échec est journalisé, jamais avalé.
                    let mut report = crate::extension_write::write_embedded_batch(&dir, &files);
                    // Service Laya : l'outil `laya_classify` doit être disponible
                    // pour TOUTE session d'agent, y compris celles lancées par
                    // l'assistant (`run_agents`) et les agents multi-rôles — qui
                    // passent par ce chemin, pas par `spawn_session`.
                    match Self::write_laya_extension(&dir) {
                        Ok(laya_file) => report.paths.push(laya_file),
                        Err(e) => report.failures.push(e),
                    }
                    Self::log_extension_failures("agent multi-rôles", &report);
                    extensions = report.paths;
                } else {
                    // Tâche 361 : dossier inutilisable ⇒ plus aucun échec silencieux.
                    eprintln!(
                        "[extensions] agent multi-rôles : dossier d'extensions inutilisable ({}) — session lancée SANS extensions",
                        dir.display()
                    );
                }
            }
        }
        // Agent piloté MCP (brique B) : expose le mcp.json (PILOT_MCP_CONFIG) et le
        // serveur cible (PILOT_MCP_SERVER) au process pi. Uniquement si l'extension
        // MCP est chargée. PILOT_MCP_SERVER fait choisir à l'extension le serveur
        // désigné (sinon fail-back le 1er activé).
        let mcp_env_vars: Option<Vec<(String, String)>> = if mcp_enabled
            && extensions.iter().any(|e| e.contains("pilot-mcp-client.ts"))
        {
            app.path().app_data_dir().ok().map(|d| {
                let mut vars = vec![(
                    "PILOT_MCP_CONFIG".to_string(),
                    d.join("mcp.json").to_string_lossy().into_owned(),
                )];
                if let Some(srv) = mcp_server.as_deref() {
                    if !srv.trim().is_empty() {
                        vars.push(("PILOT_MCP_SERVER".to_string(), srv.trim().to_string()));
                    }
                }
                Self::attach_mcp_secret_env(app, &mut vars, mcp_server.as_deref());
                vars
            })
        } else {
            None
        };
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
        // Compétences de CET agent (bibliothèque commune `~/.pilot/skills`) :
        // `--skill` additif + `PILOT_AGENT_SKILLS` (filtrage strict côté pi, lu
        // par pilot-skills.ts). Les agents multi-rôles / délégations de
        // l'assistant sont enregistrés au périmètre GLOBAL (project_path NULL).
        // Les deux lignes candidates sont résolues par la MÊME fonction pure que
        // `spawn_session` : sans elle, une ligne projet vide (« husk ») écrasait
        // silencieusement la ligne globale et toute compétence cochée restait
        // sans effet.
        let project_row = state.agent_service.get_agent(app, agent_id, Some(project)).ok().flatten();
        let global_row = state.agent_service.get_agent(app, agent_id, None).ok().flatten();
        let agent = resolve_agent_for_skills(project_row.as_ref(), global_row.as_ref());
        let skill_paths = agent_skill_paths(agent.as_ref());
        let env_vars = merge_env_vars(mcp_env_vars, agent_skills_env(agent.as_ref()));
        let session = rpc_manager::spawn_and_start(
            project,
            pi_path,
            no_session,
            &session_dir_str,
            &skill_paths,
            extensions,
            app.clone(),
            state.event_tx.clone(),
            "rpc-event-agents",
            Some(agent_id),
            // Tâche 8 : observateur combiné → surveillance d'anomalie par agent.
            Some(anomaly::make_observer(
                &state.agent_activity,
                &state.agent_anomaly,
                project,
                &format!("{}\u{1f}{}", project, agent_id),
            )),
            None,
            env_vars,
        )
        .map_err(|e| format!("Erreur lancement agent {} : {}", agent_id, e))?;
        Ok(session)
    }

    /// Lance un nouveau processus pi --mode rpc pour un agent d'un projet.
    /// Reproduit la logique de démarrage de la session principale (config,
    /// dossier de session, skill quality-gate, extensions pi, canal projet).
    /// Écrit le couple Laya dans le dossier d'extensions : l'extension
    /// `pilot-laya.ts` (l'outil `laya_classify`) et son cœur `laya-gateway.js`,
    /// importé par `./laya-gateway.js`. Partagé par les DEUX chemins d'agent
    /// (`spawn_session` pour le chat principal, `spawn_agent_process` pour les
    /// agents lancés par l'assistant et les agents multi-rôles) : sans cela, un
    /// agent ne reçoit pas l'outil. Retourne le chemin du `.ts` si tout est écrit.
    ///
    /// Tâche 361 : l'écriture passe par l'écriture fiabilisée
    /// ([`crate::extension_write`]) et un échec est REMONTÉ. Avant, `?.ok()`
    /// avalait l'échec : la session tournait sans `laya_classify`, sans que rien
    /// ne le signale, et un fichier périmé restait sur disque.
    fn write_laya_extension(dir: &std::path::Path) -> Result<String, String> {
        let gateway_file = dir.join("laya-gateway.js");
        crate::extension_write::write_embedded(
            &gateway_file,
            include_str!("../../src/js/laya-gateway.js"),
        )
        .map_err(|e| format!("laya-gateway.js : {}", e))?;
        let laya_file = dir.join("pilot-laya.ts");
        crate::extension_write::write_embedded(&laya_file, include_str!("../extensions/pilot-laya.ts"))
            .map_err(|e| format!("pilot-laya.ts : {}", e))?;
        Ok(laya_file.to_string_lossy().to_string())
    }

    fn spawn_session(app: &AppHandle, project: &str, agent_id: &str) -> Result<rpc_manager::RpcSession, String> {
        let state = app.state::<AppState>();
        let (pi_path, no_session, session_dir, qg_enabled, confirm_file_edits, mcp_enabled) = {
            let config = state.config_snapshot();
            (
                config.rpc_pi_path.clone(),
                config.rpc_no_session,
                config.rpc_session_dir.clone(),
                config.quality_gate_enabled,
                config.confirm_file_edits,
                config.mcp_enabled,
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
                    // Écriture fiabilisée (tâche 361) : un fichier resté en lecture
                    // seule est remplacé, un contenu déjà à jour n'est pas réécrit,
                    // et un échec est journalisé au lieu d'être avalé.
                    match crate::extension_write::write_embedded(&skill_file, content) {
                        Ok(_) => Some(skill_file.to_string_lossy().to_string()),
                        Err(e) => {
                            eprintln!("[quality-gate] SKILL.md non écrit : {}", e);
                            None
                        }
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

        // Extensions pi (porte pré-écriture, contexte, choix, navigateur).
        let ext_supported = probe_extension_support(&state, &pi_path);
        let mut extensions: Vec<String> = Vec::new();
        if ext_supported {
            if let Ok(data_dir) = app.path().app_data_dir() {
                let dir = data_dir.join("extensions");
                if std::fs::create_dir_all(&dir).is_ok() {
                    // Extensions pi (porte pré-écriture, contexte, choix, navigateur).
                    let mut files: Vec<(&str, &str)> = vec![
                        ("pilot-context.ts", include_str!("../extensions/pilot-context.ts")),
                        // Filtrage STRICT des compétences (D6) : TOUJOURS chargé, quel
                        // que soit `inherit_context` — sans lui, un agent verrait les
                        // compétences auto-découvertes de toutes les autres sessions.
                        ("pilot-skills.ts", include_str!("../extensions/pilot-skills.ts")),
                        ("pilot-choices.ts", include_str!("../extensions/pilot-choices.ts")),
                        // Outils navigateur (pi-chrome) : autorise les outils chrome_*
                        // dans la session principale de l'agent (cf. extensions/pilot-chrome.ts).
                        ("pilot-chrome.ts", include_str!("../extensions/pilot-chrome.ts")),
                    ];
                    if confirm_file_edits {
                        files.push((
                            "pilot-edit-gate.ts",
                            include_str!("../extensions/pilot-edit-gate.ts"),
                        ));
                    }
                    // POC MCP : extension client MCP (SDK bundlé) si activé.
                    if mcp_enabled {
                        files.push((
                            "pilot-mcp-client.ts",
                            include_str!("../extensions/pilot-mcp-client.ts"),
                        ));
                    }
                    // Écriture FIABLE (tâche 361) : un fichier resté en lecture seule
                    // est remplacé, un contenu déjà à jour n'est pas réécrit, un échec
                    // est journalisé et le fichier concerné n'est PAS transmis.
                    let mut report = crate::extension_write::write_embedded_batch(&dir, &files);
                    // Service Laya : classement local (choix parmi des libellés,
                    // note sur une échelle, oui/non) par le service UNIQUE lancé et
                    // surveillé par Pilot — aucun modèle chargé par la session.
                    match Self::write_laya_extension(&dir) {
                        Ok(laya_file) => report.paths.push(laya_file),
                        Err(e) => report.failures.push(e),
                    }
                    Self::log_extension_failures("session d'agent", &report);
                    extensions = report.paths;
                } else {
                    // Tâche 361 : dossier inutilisable ⇒ plus aucun échec silencieux.
                    eprintln!(
                        "[extensions] session d'agent : dossier d'extensions inutilisable ({}) — session lancée SANS extensions",
                        dir.display()
                    );
                }
            }
        }

        // POC MCP : on expose le chemin du mcp.json au process pi via la variable
        // d'environnement PILOT_MCP_CONFIG (uniquement si l'extension MCP est bien
        // chargée). L'extension lit cette env au démarrage, jamais via AppConfig.
        // E2 : la clé du serveur de la session (premier activé) est ajoutée à part.
        let mcp_env_vars: Option<Vec<(String, String)>> = if mcp_enabled
            && extensions.iter().any(|e| e.contains("pilot-mcp-client.ts"))
        {
            app.path().app_data_dir().ok().map(|d| {
                let mut vars = vec![(
                    "PILOT_MCP_CONFIG".to_string(),
                    d.join("mcp.json").to_string_lossy().into_owned(),
                )];
                Self::attach_mcp_secret_env(app, &mut vars, None);
                vars
            })
        } else {
            None
        };

        let channel = agent_event_channel(project, agent_id);
        // Compétences de cet agent (bibliothèque commune) + filtrage strict.
        // Même résolution que `spawn_agent_process` : la ligne projet gagne
        // quand elle est renseignée, sinon la ligne globale (agents H2 V2
        // enregistrés au périmètre global). Une husk projet ne gagne jamais.
        let project_row = state.agent_service.get_agent(app, agent_id, Some(project)).ok().flatten();
        let global_row = state.agent_service.get_agent(app, agent_id, None).ok().flatten();
        let agent = resolve_agent_for_skills(project_row.as_ref(), global_row.as_ref());
        let mut skill_paths: Vec<String> = Vec::new();
        if let Some(sp) = skill_path {
            skill_paths.push(sp);
        }
        skill_paths.extend(agent_skill_paths(agent.as_ref()));
        let env_vars = merge_env_vars(mcp_env_vars, agent_skills_env(agent.as_ref()));
        let mut session = rpc_manager::spawn_and_start(
            project,
            &pi_path,
            no_session,
            &session_dir_str,
            &skill_paths,
            extensions,
            app.clone(),
            state.event_tx.clone(),
            &channel,
            None,
            // Issue #13 : observateur d'activité → map par projet (agent_start/settled).
            // Tâche 8 : observateur combiné → map d'activité par projet + surveillance
            // d'anomalie par agent (bloqué sans progression).
            Some(anomaly::make_observer(
                &state.agent_activity,
                &state.agent_anomaly,
                project,
                &format!("{}\u{1f}{}", project, agent_id),
            )),
            None,
            env_vars,
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
/// Découpe un modèle "provider/modelId" au premier '/' (le modelId peut
/// contenir des '/' ex: openrouter). Retourne None si vide/malformé.
fn split_model(s: &str) -> Option<(String, String)> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    let (provider, model_id) = s.split_once('/')?;
    let provider = provider.trim();
    let model_id = model_id.trim();
    if provider.is_empty() || model_id.is_empty() {
        return None;
    }
    Some((provider.to_string(), model_id.to_string()))
}

/// Backend du moteur (`pi` ou `plh`) d'après le chemin du binaire. C'est lui qui
/// choisit la colonne du registre (`models_pi`/`models_plh`,
/// `thinking_pi`/`thinking_plh`) et la configuration à lire.
pub(crate) fn backend_stem(pi_path: &str) -> String {
    if pi_path.is_empty() {
        "pi".to_string()
    } else {
        std::path::Path::new(pi_path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("pi")
            .to_string()
    }
}

/// Tâche #167 : résout le modèle initial à poser sur une session spawnée
/// (fonction PURE, testable). Priorité identique au bus JS :
///   1. modèle du registre pour le backend actif (`models.{stem}`),
///   2. fallback croisé sur l'autre backend (`resolveAgentModel`),
///   3. `defaultModel` du model-switch.json (`default_model`, déjà découpé).
/// Retourne None si aucun modèle disponible (pi garde son modèle interne).
pub(crate) fn resolve_initial_model(
    models_pi: &str,
    models_plh: &str,
    stem: &str,
    default_model: Option<(String, String)>,
) -> Option<(String, String)> {
    let (primary, secondary) = if stem == "plh" {
        (models_plh, models_pi)
    } else {
        (models_pi, models_plh)
    };
    split_model(primary)
        .or_else(|| split_model(secondary))
        .or(default_model)
}

fn default_agent_name(id: &str) -> String {
    let human = id.replace(['-', '_'], " ");
    let mut chars = human.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::from("Agent"),
    }
}

/// Fenêtre de « travail récent » (secondes) du champ `isWorking` : alignée sur
/// celle du frontend (`RECENT_ACTIVITY_WINDOW_MS` = 2 min,
/// exclusivity-queue.js) — un agent qui vient de produire un événement est
/// considéré en travail, même entre deux tours.
pub(crate) const WORKING_RECENT_WINDOW_SECS: u64 = 120;

/// Sonde PURE de travail réel d'une session, exposée au LLM par le champ
/// `isWorking` de `list_agent_sessions` (chantier « l'assistant relance des
/// agents qui travaillent »). Même règle que `isSessionWorking` du frontend :
/// le processus doit être VIVANT et, soit une tâche est en cours (`busy`), soit
/// un OUTIL tourne (build/tests silencieux), soit l'activité est récente. Un
/// processus vivant mais au repos (session parkée après `agent_settled`) n'est
/// PAS au travail — `state: "parked"` ne dit rien du travail, seulement de
/// l'onglet.
fn session_is_working(alive: bool, busy: bool, tool_in_progress: bool, idle_secs: u64) -> bool {
    alive && (busy || tool_in_progress || idle_secs < WORKING_RECENT_WINDOW_SECS)
}

/// Construit l'entrée JSON de BASE d'une session pour `list_agent_sessions`.
///
/// CONTRAT DE FORME avec le frontend : ces noms de champs sont lus tels quels par
/// `agents-bus.js` / `exclusivity-queue.js` / `dashboard.js` pour décider si un
/// agent VIVANT travaille (sonde d'exclusivité, file d'attente, libération de
/// run). La lecture JS est fail-open : un renommage Rust ferait conclure
/// « personne ne travaille » et libérerait un agent vivant **en silence**. Le test
/// `session_entry_json_keeps_frontend_contract_keys` verrouille donc ces clés.
///
/// `busy` / `toolInProgress` / `isWorking` sont ADDITIFS et optionnels : absents
/// tant qu'aucune activité n'a été enregistrée pour la session.
fn session_entry_json(
    project: &str,
    agent: &str,
    mode: &str,
    state: &str,
    alive: bool,
    visible: bool,
    active: bool,
    busy: Option<bool>,
    tool_in_progress: Option<bool>,
    is_working: Option<bool>,
) -> Value {
    let mut entry = serde_json::json!({
        "project": project,
        "agent": agent,
        "mode": mode,
        "state": state,
        "alive": alive,
        "visible": visible,
        "active": active,
    });
    // busy : l'agent est-il en train d'exécuter une tâche (agent_start → true,
    // agent_settled → false) ? Distingue « en cours de tâche » d'une session
    // vivante mais inactive (settled) — utilisé par le frontend pour
    // l'exclusivité des spécialités (run_agents).
    if let Some(b) = busy {
        entry["busy"] = Value::Bool(b);
    }
    // toolInProgress : un OUTIL est en cours d'exécution (tool_execution_start →
    // true, tool_execution_end/settled → false). Distinct de `busy` : pendant un
    // outil long et SILENCIEUX (build, tests, installation) aucun événement n'est
    // émis, et `busy` peut être faux (fin de tour pi, relance en attente) alors
    // que l'agent travaille réellement. Sans ce champ, la sonde de vivacité du
    // frontend (isSessionWorking) concluait « plus aucun agent ne travaille » et
    // libérait la run en ÉCHEC au milieu du travail.
    if let Some(t) = tool_in_progress {
        entry["toolInProgress"] = Value::Bool(t);
    }
    // isWorking : l'agent TRAVAILLE-t-il réellement à cet instant ? Champ
    // ADDITIF, explicite, destiné au LLM : évite l'intoxication sémantique de
    // `state`/`active` (qui décrivent l'ONGLET).
    if let Some(w) = is_working {
        entry["isWorking"] = Value::Bool(w);
    }
    entry
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
                SpawnMode::AssistantAgent => "assistant_agent",
            };
            let is_active = entry.mode == SpawnMode::MainSession
                && active.as_deref() == Some(agent_id.as_str());
            (project, agent_id, state.to_string(), mode.to_string(), alive, is_active)
        })
        .collect()
}

/// Tâche #345 — clé canonique de portée d'un agent (`None` = agent global).
///
/// Le registre `agents` était interrogé avec le chemin BRUT du projet : deux
/// écritures du même projet sous une forme de chemin différente (`G:/p` puis
/// `G:\p\`) créaient deux fiches (« fiches d'agent en double »). Toutes les
/// lectures et écritures passent désormais par `crate::normalize_project_path`
/// (déjà utilisé par GDS), la même clé que `agents.chemin_normalise`
/// (index UNIQUE `(id, chemin_normalise)`).
fn normalize_scope(project_path: Option<&str>) -> Option<String> {
    project_path.map(crate::normalize_project_path)
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
    // PRÉFIXE RÉSERVÉ (symétrique de `register_ephemeral_agent`) : ceinture ET
    // bretelles au seul point d'écriture en base du registre. Sans elle, une
    // ligne du registre pourrait porter le préfixe des agents jetables et
    // partager l'espace d'identifiants réservé — et le repli mémoire de
    // `get_agent` masquerait alors l'agent du registre.
    if is_ephemeral_agent_id(&agent.id) {
        return Err(format!(
            "Agent du registre : l'identifiant « {} » porte le préfixe réservé des agents jetables (« {} »)",
            agent.id.trim(),
            EPHEMERAL_AGENT_PREFIX
        ));
    }
    let capabilities = serde_json::to_string(&agent.capabilities)
        .map_err(|e| format!("Erreur sérialisation capabilities: {}", e))?;
    let skills = serde_json::to_string(&agent.skills)
        .map_err(|e| format!("Erreur sérialisation skills: {}", e))?;
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
                 models_pi=?5, models_plh=?6, thinking_pi=?7, thinking_plh=?8,
                 capabilities=?9, skills=?10, readonly=?11,
                 keep_context=?12, max_calls_per_run=?13, call_depth=?14,
                 loaded=?15, busy=?16, proc_state=?17, visible=?18, last_active_at=?19
                 WHERE id=?20 AND project_path IS NULL",
                params![
                    agent.name, agent.icon, agent.description, agent.role,
                    agent.models.pi, agent.models.plh, agent.thinking.pi, agent.thinking.plh,
                    capabilities, skills,
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
                    models_pi, models_plh, thinking_pi, thinking_plh, capabilities, skills,
                    readonly, keep_context,
                    max_calls_per_run, call_depth, loaded, busy, proc_state, visible, last_active_at
                 ) VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)",
                params![
                    agent.id, agent.name, agent.icon, agent.description, agent.role,
                    agent.models.pi, agent.models.plh, agent.thinking.pi, agent.thinking.plh,
                    capabilities, skills,
                    agent.readonly as i64, agent.keep_context as i64,
                    agent.max_calls_per_run as i64, agent.call_depth as i64,
                    agent.loaded as i64, agent.busy as i64, agent.state.as_str(),
                    agent.visible as i64, agent.last_active_at
                ],
            )
            .map_err(|e| format!("Erreur insert upsert_agent: {}", e))?;
        }
    } else {
        // Tâche #345 : écriture sous la clé CANONIQUE (déjà normalisée par
        // `normalize_scope` pour les lectures). `project_path` et
        // `chemin_normalise` sont alignés ; l'unicité est portée par l'index
        // `(id, chemin_normalise)`, insensible à la forme du chemin fourni.
        let canonical = crate::normalize_project_path(
            agent.project_path.as_deref().unwrap_or_default(),
        );
        conn.execute(
            "INSERT INTO agents (
                id, project_path, chemin_normalise, name, icon, description, role,
                models_pi, models_plh, thinking_pi, thinking_plh, capabilities, skills,
                readonly, keep_context,
                max_calls_per_run, call_depth, loaded, busy, proc_state, visible, last_active_at
             ) VALUES (?1, ?2, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)
             ON CONFLICT(id, chemin_normalise) DO UPDATE SET
                name=excluded.name, icon=excluded.icon, description=excluded.description,
                role=excluded.role, models_pi=excluded.models_pi, models_plh=excluded.models_plh,
                thinking_pi=excluded.thinking_pi, thinking_plh=excluded.thinking_plh,
                capabilities=excluded.capabilities, skills=excluded.skills, readonly=excluded.readonly,
                keep_context=excluded.keep_context, max_calls_per_run=excluded.max_calls_per_run,
                call_depth=excluded.call_depth, loaded=excluded.loaded, busy=excluded.busy,
                proc_state=excluded.proc_state, visible=excluded.visible, last_active_at=excluded.last_active_at",
            params![
                agent.id, canonical, agent.name, agent.icon, agent.description, agent.role,
                agent.models.pi, agent.models.plh, agent.thinking.pi, agent.thinking.plh,
                capabilities, skills,
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

/// Supprime une ligne `agents` précise (id + scope). Retourne une erreur
/// explicite si aucune ligne n'a été supprimée (agent absent), comme
/// `set_visible`/`set_state` : un échec silencieux laisserait une ligne fantôme.
fn delete_agent_conn(conn: &rusqlite::Connection, agent_id: &str, project_path: Option<&str>) -> Result<(), String> {
    // Tâche #345 : suppression par clé canonique (cf. `upsert_agent_conn`).
    let scope = normalize_scope(project_path);
    let changed = conn
        .execute(
            "DELETE FROM agents
             WHERE id = ?1 AND ((?2 IS NULL AND project_path IS NULL) OR (?2 IS NOT NULL AND chemin_normalise = ?2))",
            params![agent_id, scope],
        )
        .map_err(|e| format!("Erreur suppression agent: {}", e))?;
    if changed == 0 {
        return Err(format!("Agent {} introuvable (delete_agent)", agent_id));
    }
    Ok(())
}

/// Dossier utilisateur Pilot (`~/.pilot`). Utilisé pour le dossier de session
/// des agents multi-rôles H2 V2 quand le chemin de config n'est pas résoluble.
pub(crate) fn pilot_user_dir() -> Result<std::path::PathBuf, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "Impossible de trouver le home dir".to_string())?;
    Ok(std::path::PathBuf::from(home).join(".pilot"))
}

// ── Compétences (skills) de la bibliothèque commune ──

/// Répertoire de la bibliothèque commune de compétences : `~/.pilot/skills`.
/// ⚠️ Volontairement DISTINCT de `~/.pi/agent/skills` et `<projet>/.pi/skills`
/// (que pi découvre nativement et annoncerait à TOUS les agents) : une
/// compétence de la bibliothèque n'est visible que par les agents dont la
/// liste la référence, via un `--skill <chemin>` explicite.
pub(crate) fn common_skills_dir() -> Result<std::path::PathBuf, String> {
    Ok(pilot_user_dir()?.join("skills"))
}

/// Chemin absolu du `SKILL.md` d'une compétence de la bibliothèque commune.
/// `None` si le nom est vide/relatif ou si le fichier n'existe pas (compétence
/// supprimée ou nom erroné) — tolérant, jamais d'erreur bloquante.
fn common_skill_path(name: &str) -> Option<String> {
    let name = name.trim();
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
        return None;
    }
    let file = common_skills_dir().ok()?.join(name).join("SKILL.md");
    if file.is_file() {
        Some(file.to_string_lossy().to_string())
    } else {
        None
    }
}

/// Chemins `--skill` à injecter pour un agent : compétences de sa liste
/// présentes dans la bibliothèque commune. (Le quality-gate est ajouté à part
/// par l'appelant, selon l'option de configuration.)
/// Résout la ligne d'agent à utiliser pour les compétences, à partir des deux
/// lignes candidates (projet et globale). Fonction **pure**, partagée par les
/// DEUX points de spawn.
///
/// Le seed crée, au premier spawn, une copie **projet** vide de chaque agent
/// (`role` vide, `skills` vide). Cette « husk » gagnait la résolution et la
/// ligne globale était ignorée : toute compétence cochée sur un agent global
/// restait sans effet dans le projet. Une husk ne gagne donc jamais ; on retombe
/// alors sur la ligne globale (agent H2 V2 / agent lancé par l'assistant).
fn resolve_agent_for_skills(project_row: Option<&Agent>, global_row: Option<&Agent>) -> Option<Agent> {
    fn is_husk(a: &Agent) -> bool {
        a.role.trim().is_empty() && a.skills.is_empty()
    }
    match project_row {
        Some(p) if !is_husk(p) => Some(p.clone()),
        _ => global_row.cloned(),
    }
}

fn agent_skill_paths(agent: Option<&Agent>) -> Vec<String> {
    agent
        .map(|a| a.skills.iter().filter_map(|n| common_skill_path(n)).collect())
        .unwrap_or_default()
}

/// Variable d'environnement `PILOT_AGENT_SKILLS` (liste JSON des compétences
/// autorisées pour CET agent). TOUJOURS passée pour une session d'agent, même
/// vide : l'extension `pilot-skills.ts` en déduit qu'elle doit filtrer
/// strictement les compétences annoncées par pi.
fn agent_skills_env(agent: Option<&Agent>) -> Vec<(String, String)> {
    let skills = agent.map(|a| a.skills.clone()).unwrap_or_default();
    vec![(
        "PILOT_AGENT_SKILLS".to_string(),
        serde_json::to_string(&skills).unwrap_or_else(|_| "[]".to_string()),
    )]
}

/// Fusionne des variables d'environnement supplémentaires dans une liste
/// optionnelle existante (MCP) sans écraser les précédentes.
fn merge_env_vars(
    base: Option<Vec<(String, String)>>,
    extra: Vec<(String, String)>,
) -> Option<Vec<(String, String)>> {
    let mut vars = base.unwrap_or_default();
    vars.extend(extra);
    if vars.is_empty() {
        None
    } else {
        Some(vars)
    }
}

// ── Conversion Value ↔ Agent (IPC) ──

/// Désérialise un Agent depuis une Value JSON (champs camelCase du frontend).
pub(crate) fn agent_from_value(v: &Value) -> Result<Agent, String> {
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
///
/// D4 — garde-fou cœur : refuse la **création** d'un agent GLOBAL portant
/// l'identifiant d'un agent fourni (la remise à zéro l'écraserait). Sans lui, un
/// appel IPC direct contournait la règle appliquée par l'interface. La mise à jour
/// d'un agent fourni existant et les agents de projet restent autorisés. La remise
/// à zéro ne passe pas par cette commande (elle utilise le service directement),
/// donc elle peut réinsérer un agent fourni supprimé.
#[tauri::command]
pub fn upsert_agent(state: State<AppState>, app: AppHandle, agent: Value) -> Result<Value, String> {
    let a = agent_from_value(&agent)?;
    let exists = state
        .agent_service
        .get_agent(&app, &a.id, a.project_path.as_deref())?
        .is_some();
    if crate::agents::creating_provided_agent_is_forbidden(
        &a.id,
        a.project_path.is_some(),
        exists,
        &crate::agents::default_agent_ids_from_config(&state.config_snapshot()),
    ) {
        return Err(format!(
            "« {} » est un identifiant fourni par Pilot : un agent ne peut pas être créé avec cet identifiant (D4).",
            a.id
        ));
    }
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

/// Supprime un agent (global par défaut, ou d'un projet si `project_path` est fourni).
///
/// Édition unitaire du registre : ne remplace pas le scope comme `replace_agents`.
#[tauri::command]
pub fn delete_agent(state: State<AppState>, app: AppHandle, agent_id: String, project_path: Option<String>) -> Result<(), String> {
    let proj = project_path.filter(|p| !p.trim().is_empty());
    state.agent_service.delete_agent(&app, &agent_id, proj.as_deref())
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

// ── Bibliothèque commune : inventaire pour l'UI de configuration ──

/// Compétence de la bibliothèque commune, telle qu'affichée dans l'éditeur
/// d'agent : nom = nom du dossier, description = `description:` du frontmatter.
#[derive(Debug, serde::Serialize)]
pub struct CommonSkillInfo {
    pub name: String,
    pub description: String,
}

/// Extrait la valeur de `description:` du frontmatter YAML d'un `SKILL.md`.
/// Tolérant (le frontmatter est écrit à la main) : retourne "" si absente,
/// gère les guillemets simples/doubles, s'arrête au `---` de fermeture.
fn skill_description(content: &str) -> String {
    let mut inside = false;
    for (i, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        if i == 0 && trimmed != "---" {
            return String::new(); // pas de frontmatter
        }
        if trimmed == "---" {
            if inside {
                break; // frontmatter terminé
            }
            inside = true;
            continue;
        }
        if !inside {
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("description:") {
            return rest.trim().trim_matches(['"', '\'']).to_string();
        }
    }
    String::new()
}

/// Inclut les compétences de `dir` (dossiers contenant un `SKILL.md`), triées par
/// nom. Ne crée rien, ne renvoie jamais d'erreur : un dossier sans SKILL.md
/// lisible est simplement ignoré.
fn scan_skills_dir(dir: &std::path::Path) -> Vec<CommonSkillInfo> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(path.join("SKILL.md")) else {
            continue;
        };
        out.push(CommonSkillInfo {
            name: entry.file_name().to_string_lossy().to_string(),
            description: skill_description(&content),
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Compétences disponibles dans la bibliothèque commune `~/.pilot/skills`, pour
/// le sélecteur de l'éditeur d'agent. Lecture seule.
#[tauri::command]
pub fn list_common_skills() -> Vec<CommonSkillInfo> {
    common_skills_dir()
        .map(|d| scan_skills_dir(&d))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Garde de propriété de session : un arrêt/abandon automatique ne peut
    /// viser QUE la session lancée par l'appelant. Sans elle, un minuteur ou un
    /// moniteur périmé tuait la session neuve du même couple (projet, agent) :
    /// symptôme « l'agent commence et s'arrête aussitôt ».
    #[test]
    fn session_ownership_allows_protege_la_session_relancee() {
        // Aucune attente : comportement historique, toujours accepté.
        assert!(session_ownership_allows(None, Some(7)));
        assert!(session_ownership_allows(None, None));
        // Session absente : rien à arrêter, on accepte.
        assert!(session_ownership_allows(Some(7), None));
        // Même session : accepté.
        assert!(session_ownership_allows(Some(7), Some(7)));
        // Session RELANCÉE (autre uid) : refusé.
        assert!(!session_ownership_allows(Some(7), Some(8)));
    }

    #[test]
    fn next_session_uid_est_monotone_et_unique() {
        let a = next_session_uid();
        let b = next_session_uid();
        assert!(b > a, "les uid de session doivent être strictement croissants");
    }

    /// Agent minimal pour les tests de compétences.
    fn sample_agent(id: &str) -> Agent {
        Agent {
            id: id.to_string(),
            name: id.to_string(),
            icon: "🤖".to_string(),
            description: String::new(),
            role: String::new(),
            models: crate::agent::AgentModels { pi: String::new(), plh: String::new() },
            thinking: crate::agent::AgentThinking::default(),
            capabilities: Vec::new(),
            skills: Vec::new(),
            readonly: false,
            keep_context: false,
            max_calls_per_run: 5,
            call_depth: 1,
            project_path: None,
            loaded: false,
            busy: false,
            state: AgentProcessState::Unloaded,
            visible: true,
            last_active_at: None,
        }
    }

    /// Connexion en mémoire avec le schéma réel (`init_db`) pour les tests de
    /// persistance du registre (tâche #345).
    fn persistence_conn() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("db mémoire");
        crate::db::init_db(&conn).expect("schéma pilot.db");
        conn
    }

    // ── AGENT JETABLE : magasin MÉMOIRE seule (aucune ligne en base) ──

    /// Le PRÉFIXE RÉSERVÉ est vérifié à l'écriture, côté Rust : un agent
    /// jetable qui ne le porte pas est REFUSÉ (il prendrait l'identifiant d'un
    /// agent du registre, masqué ensuite par le repli mémoire de `get_agent`),
    /// et un agent du registre ne peut pas le porter non plus.
    #[test]
    fn prefixe_reserve_verifie_a_l_ecriture() {
        // Prédicat pur : miroir de `EPHEMERAL_AGENT_PREFIX` côté JS.
        assert_eq!(EPHEMERAL_AGENT_PREFIX, "eph-");
        assert!(is_ephemeral_agent_id("eph-1-abc"));
        assert!(!is_ephemeral_agent_id("auditeur"));
        assert!(!is_ephemeral_agent_id("eph"));
        assert!(!is_ephemeral_agent_id(""));

        let svc = AgentService::new();
        // Sans le préfixe : refusé, rien n'est enregistré.
        let sans = sample_agent("auditeur");
        let err = svc
            .register_ephemeral_agent(sans)
            .expect_err("agent jetable sans préfixe réservé");
        assert!(err.contains(EPHEMERAL_AGENT_PREFIX), "message : {err}");
        assert!(!svc.is_ephemeral_agent("auditeur"));
        assert!(svc.list_ephemeral_agents().is_empty());

        // Avec le préfixe : accepté (espaces de bord retirés de l'identifiant).
        let avec = sample_agent(" eph-1-abc ");
        let stored = svc
            .register_ephemeral_agent(avec)
            .expect("agent jetable préfixé");
        assert_eq!(stored.id, "eph-1-abc");

        // Symétrie : le préfixe réservé ne peut pas entrer dans le REGISTRE.
        let conn = persistence_conn();
        let mut registre = sample_agent("eph-2-def");
        registre.project_path = Some("G:/IA_PL/pilot".to_string());
        assert!(
            upsert_agent_conn(&conn, &registre).is_err(),
            "le registre ne doit pas accepter le préfixe réservé"
        );
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM agents WHERE id = 'eph-2-def'", [], |r| {
                r.get(0)
            })
            .expect("compte des fiches");
        assert_eq!(count, 0, "aucune ligne écrite pour un identifiant réservé");
    }

    /// Un agent jetable vit uniquement en mémoire : enregistré, résolu par la
    /// portée, et purgé sans laisser de trace. C'est la condition (a)/(b) de la
    /// mission côté Rust : aucun `upsert` n'est impliqué nulle part.
    #[test]
    fn agent_jetable_vit_en_memoire_et_disparait_a_la_purge() {
        let svc = AgentService::new();
        let mut a = sample_agent("eph-test-1");
        a.role = "Tu es un agent jetable.".to_string();
        a.project_path = Some("G:/IA_PL/pilot".to_string());
        // `visible` demandé explicitement : un agent jetable reste INVISIBLE
        // (il n'est pas un onglet du registre, même s'il travaille).
        a.visible = true;

        let stored = svc.register_ephemeral_agent(a).expect("enregistrement mémoire");
        assert!(!stored.visible, "un agent jetable n'est jamais visible");
        assert!(svc.is_ephemeral_agent("eph-test-1"));
        assert_eq!(svc.list_ephemeral_agents().len(), 1);

        // Le rôle est bien conservé en mémoire (rôle fourni à la volée).
        let resolved = svc
            .ephemeral_agent("eph-test-1", normalize_scope(Some("G:\\IA_PL\\pilot")).as_deref())
            .expect("agent jetable résolu pour son projet");
        assert_eq!(resolved.role, "Tu es un agent jetable.");
        assert_eq!(resolved.name, "eph-test-1");

        // Portée différente : jamais rendu (pas de fuite entre projets).
        assert!(
            svc.ephemeral_agent("eph-test-1", normalize_scope(Some("G:/autre/projet")).as_deref())
                .is_none(),
            "un agent jetable d'un autre projet ne doit jamais être résolu"
        );
        // Requête GLOBALE (`None`) : résolue aussi — aucune variante de chemin ne
        // doit pouvoir retomber sur `None` et déclencher un « seed » en base.
        assert!(
            svc.ephemeral_agent("eph-test-1", None).is_some(),
            "une requête globale doit résoudre l'agent jetable (anti-seed)"
        );

        // Fin de tâche : la définition n'existe plus.
        assert!(svc.clear_ephemeral_agent("eph-test-1"));
        assert!(!svc.is_ephemeral_agent("eph-test-1"));
        assert!(svc.list_ephemeral_agents().is_empty());
        assert!(
            svc.ephemeral_agent("eph-test-1", normalize_scope(Some("G:/IA_PL/pilot")).as_deref())
                .is_none(),
            "après purge, l'agent jetable ne doit plus être résolu"
        );
        // Purge d'un identifiant inconnu : sans effet, jamais d'erreur.
        assert!(!svc.clear_ephemeral_agent("eph-test-1"));
    }

    /// L'état logique d'un agent jetable est gardé EN MÉMOIRE (jamais en base) :
    /// `set_state`/`set_visible` passent par `update_ephemeral`, qui n'écrit
    /// rien et renvoie true (donc pas d'erreur « agent introuvable »).
    #[test]
    fn etat_d_un_agent_jetable_reste_en_memoire() {
        let svc = AgentService::new();
        let mut a = sample_agent("eph-test-2");
        a.project_path = Some("G:/IA_PL/pilot".to_string());
        svc.register_ephemeral_agent(a).expect("enregistrement mémoire");

        assert!(svc.update_ephemeral("eph-test-2", |a| {
            a.busy = true;
            a.loaded = true;
            a.state = AgentProcessState::Running;
        }));
        let got = svc.list_ephemeral_agents();
        assert_eq!(got.len(), 1);
        assert!(got[0].busy && got[0].loaded);
        assert_eq!(got[0].state, AgentProcessState::Running);

        // Identifiant du registre persistant : `update_ephemeral` ne le touche pas.
        assert!(!svc.update_ephemeral("codeur", |a| a.busy = true));

        // Purge globale (fin de run, changement de projet…).
        assert_eq!(svc.clear_ephemeral_agents(), 1);
        assert!(svc.list_ephemeral_agents().is_empty());
    }

    /// Le NOM d'affichage d'un agent jetable est publié (mémoire seule) et
    /// borné : c'est lui que la supervision expose dans son champ ADDITIF
    /// `name`, jamais à la place de l'identifiant technique (`eph-…`).
    /// Échoue si le nom cesse d'être exposé (régression d'affichage).
    #[test]
    fn nom_d_affichage_d_un_agent_jetable_est_expose_et_borne() {
        let svc = AgentService::new();
        // Identifiant inconnu : aucun nom inventé (l'affichage retombe sur l'id).
        assert_eq!(svc.ephemeral_agent_name("eph-inconnu-1"), None);
        // Agent du registre : jamais de nom publié (affichage inchangé).
        assert_eq!(svc.ephemeral_agent_name("codeur"), None);

        let mut a = sample_agent("eph-test-1");
        a.name = "  auditeur-cohérence  ".to_string();
        a.project_path = Some("G:/IA_PL/pilot".to_string());
        svc.register_ephemeral_agent(a).expect("enregistrement mémoire");

        // Nom lisible, espaces de bord retirés.
        assert_eq!(
            svc.ephemeral_agent_name("eph-test-1").as_deref(),
            Some("auditeur-cohérence")
        );
        // L'identité technique reste intacte et distincte du nom.
        let stored = svc.list_ephemeral_agents();
        assert_eq!(stored[0].id, "eph-test-1");

        // Nom vide : None (repli explicite sur l'identifiant à l'affichage).
        assert!(svc.update_ephemeral("eph-test-1", |a| a.name = "   ".to_string()));
        assert_eq!(svc.ephemeral_agent_name("eph-test-1"), None);

        // Purge : plus aucun nom (fin de tâche).
        svc.clear_ephemeral_agent("eph-test-1");
        assert_eq!(svc.ephemeral_agent_name("eph-test-1"), None);
    }

    /// Le bornage du nom d'affichage est PUR : jamais plus de
    /// `AGENT_DISPLAY_NAME_MAX_CHARS` caractères (« … » COMPRIS), coupe sur un mot.
    #[test]
    fn nom_d_affichage_borne_a_40_caracteres() {
        // Court : inchangé (espaces de bord retirés).
        assert_eq!(clip_agent_display_name("  auditeur  ", 40), "auditeur");
        // Exactement au plafond : inchangé.
        let exact = "a".repeat(AGENT_DISPLAY_NAME_MAX_CHARS);
        assert_eq!(clip_agent_display_name(&exact, 40), exact);
        // Trop long : coupé sur une frontière de mot, « … » annoncé.
        let long = "auditeur de sécurité et de cohérence des données du projet";
        let got = clip_agent_display_name(long, AGENT_DISPLAY_NAME_MAX_CHARS);
        // La limite ANNONCÉE est la limite RÉELLE : « … » compte dedans, donc
        // jamais 41 caractères (le défaut corrigé : doc 40, fonction 41).
        assert!(
            got.chars().count() <= AGENT_DISPLAY_NAME_MAX_CHARS,
            "nom publié de {} caractères pour une limite de {}",
            got.chars().count(),
            AGENT_DISPLAY_NAME_MAX_CHARS
        );
        assert!(got.ends_with('…'));
        assert!(got.starts_with("auditeur"));
        // Coupe sur un mot : le texte gardé est un PRÉFIXE de l'original.
        assert!(long.starts_with(got.trim_end_matches('…')));
        // Chaîne de 200 caractères SANS espace (aucune frontière de mot) : le
        // budget est utilisé jusqu'au dernier caractère, « … » compris.
        let dense = "x".repeat(200);
        let cut = clip_agent_display_name(&dense, AGENT_DISPLAY_NAME_MAX_CHARS);
        assert_eq!(cut.chars().count(), AGENT_DISPLAY_NAME_MAX_CHARS);
        assert!(cut.ends_with('…'));
        // Tout le reste de la plage : jamais un caractère de trop.
        for max in 1..=AGENT_DISPLAY_NAME_MAX_CHARS {
            let out = clip_agent_display_name(&dense, max);
            assert!(
                out.chars().count() <= max,
                "borne {max} dépassée : {} caractères",
                out.chars().count()
            );
        }
    }

    // ── Tâche #345 : clé de projet canonique (fiches d'agent en double) ──

    /// `normalize_scope` ramène les deux formes d'un même chemin à UNE clé
    /// (séparateur `\` vs `/`, slash final), et laisse `None` (agent global) tel quel.
    #[test]
    fn normalize_scope_maps_path_spellings_to_one_key() {
        assert_eq!(
            normalize_scope(Some("G:/IA_PL/pilot/")),
            normalize_scope(Some("G:\\IA_PL\\pilot")),
            "les deux formes du même chemin doivent donner la même clé"
        );
        assert_eq!(normalize_scope(None), None);
    }

    /// Cœur du bug #345 : deux écritures du MÊME projet sous deux formes de
    /// chemin ne créent qu'UNE fiche, et la seconde met bien à jour la première.
    #[test]
    fn upsert_project_agent_dedups_path_spellings() {
        let conn = persistence_conn();

        let mut first = sample_agent("git-point");
        first.project_path = Some("G:/IA_PL/pilot".to_string());
        upsert_agent_conn(&conn, &first).expect("premier upsert");

        let mut second = first.clone();
        second.project_path = Some("G:\\IA_PL\\pilot\\".to_string());
        second.name = "Git point (maj)".to_string();
        upsert_agent_conn(&conn, &second).expect("second upsert, autre forme");

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM agents WHERE id = 'git-point' AND chemin_normalise IS NOT NULL",
                [],
                |r| r.get(0),
            )
            .expect("compte des fiches");
        assert_eq!(count, 1, "une seule fiche malgré deux formes de chemin");

        let name: String = conn
            .query_row(
                "SELECT name FROM agents WHERE id = 'git-point' AND chemin_normalise = ?1",
                rusqlite::params![crate::normalize_project_path("G:\\IA_PL\\pilot\\")],
                |r| r.get(0),
            )
            .expect("relecture par la forme normalisée");
        assert_eq!(name, "Git point (maj)", "la seconde écriture a mis à jour la fiche");
    }

    /// La lecture et la suppression acceptent n'importe quelle forme du chemin
    /// (elles passent par la clé canonique) sans toucher un projet distinct.
    #[test]
    fn read_and_delete_accept_any_path_spelling() {
        let conn = persistence_conn();

        let mut a = sample_agent("codeur");
        a.project_path = Some("G:/IA_PL/pilot".to_string());
        upsert_agent_conn(&conn, &a).expect("upsert projet 1");

        let mut b = sample_agent("codeur");
        b.project_path = Some("G:/IA_PL/pilot - Analyseur".to_string());
        upsert_agent_conn(&conn, &b).expect("upsert projet 2 (distinct)");

        let read: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM agents WHERE id = 'codeur' AND chemin_normalise = ?1",
                rusqlite::params![crate::normalize_project_path("G:\\IA_PL\\pilot")],
                |r| r.get(0),
            )
            .expect("lecture par forme à backslashes");
        assert_eq!(read, 1, "la fiche est retrouvée quelle que soit la forme");

        // Suppression avec encore une autre forme : la fiche canonique part.
        delete_agent_conn(&conn, "codeur", Some("G:\\IA_PL\\pilot\\")).expect("suppression");
        let remaining: i64 = conn
            .query_row("SELECT COUNT(*) FROM agents WHERE id = 'codeur'", [], |r| r.get(0))
            .expect("compte après suppression");
        assert_eq!(remaining, 1, "seul le projet supprimé disparaît, pas l'autre");
    }

    // ── Compétences (lot 2 : injection + filtrage strict) ──

    /// Un nom de compétence invalide (chemin, `..`, séparateur Windows) ne
    /// produit JAMAIS de `--skill` — garde-fou anti-traversée de
    /// `common_skill_path`. Sans compétence, aucune injection.
    #[test]
    fn agent_skill_paths_rejects_relative_and_traversal_names() {
        let mut agent = sample_agent("codeur");
        agent.skills = vec![
            "../secret".to_string(),
            "a/b".to_string(),
            "a\\b".to_string(),
            String::new(),
        ];
        assert!(agent_skill_paths(Some(&agent)).is_empty());
        assert!(agent_skill_paths(None).is_empty());
    }

    /// T1 : la ligne projet gagne quand elle est renseignée ; une ligne projet
    /// vide (« husk ») ne doit JAMAIS écraser la ligne globale, sinon toute
    /// compétence cochée sur un agent global resterait sans effet dans le projet.
    #[test]
    fn resolve_agent_for_skills_prefers_global_when_project_row_is_empty_husk() {
        let mut project_husk = sample_agent("codeur");
        project_husk.role = String::new();
        project_husk.skills = Vec::new();
        project_husk.description = "husk projet".to_string();

        let mut global = sample_agent("codeur");
        global.role = "Tu codes.".to_string();
        global.skills = vec!["rust".to_string()];

        // 1. husk projet + ligne globale renseignée → la globale gagne.
        let resolved = resolve_agent_for_skills(Some(&project_husk), Some(&global)).expect("agent résolu");
        assert_eq!(resolved.skills, vec!["rust".to_string()]);

        // 2. ligne projet renseignée → elle gagne (comportement inchangé).
        let mut project_full = sample_agent("codeur");
        project_full.role = "Tu codes ici.".to_string();
        project_full.skills = vec!["tests".to_string()];
        let resolved = resolve_agent_for_skills(Some(&project_full), Some(&global)).expect("agent résolu");
        assert_eq!(resolved.skills, vec!["tests".to_string()]);

        // 3. husk projet + globale absente → None (aucune compétence, pas de panique).
        assert!(resolve_agent_for_skills(Some(&project_husk), None).is_none());
        // 4. projet absent → la globale.
        let resolved = resolve_agent_for_skills(None, Some(&global)).expect("agent résolu");
        assert_eq!(resolved.skills, vec!["rust".to_string()]);
    }

    /// `PILOT_AGENT_SKILLS` est TOUJOURS posée pour une session d'agent, même
    /// vide : c'est le signal de filtrage strict lu par `pilot-skills.ts`.
    #[test]
    fn agent_skills_env_always_emitted() {
        assert_eq!(
            agent_skills_env(None),
            vec![("PILOT_AGENT_SKILLS".to_string(), "[]".to_string())]
        );
        let mut agent = sample_agent("codeur");
        agent.skills = vec!["rust".to_string(), "tests".to_string()];
        assert_eq!(agent_skills_env(Some(&agent))[0].1, "[\"rust\",\"tests\"]");
    }

    /// `merge_env_vars` n'écrase aucune variable existante (MCP) et retourne
    /// `None` quand il n'y a rien à passer.
    #[test]
    fn merge_env_vars_appends_and_keeps_none() {
        assert!(merge_env_vars(None, vec![]).is_none());
        let merged = merge_env_vars(
            Some(vec![("MCP_X".to_string(), "1".to_string())]),
            vec![("PILOT_AGENT_SKILLS".to_string(), "[]".to_string())],
        )
        .expect("env fusionnée");
        assert_eq!(
            merged,
            vec![
                ("MCP_X".to_string(), "1".to_string()),
                ("PILOT_AGENT_SKILLS".to_string(), "[]".to_string()),
            ]
        );
    }

    /// `skill_description` lit le frontmatter sans se laisser déborder sur le
    /// corps du document.
    #[test]
    fn skill_description_reads_frontmatter() {
        assert_eq!(
            skill_description("---\nname: rust\ndescription: \"Consignes Rust\"\n---\n\nCorps.\n"),
            "Consignes Rust"
        );
        assert_eq!(skill_description("---\ndescription: sans guillemets\n---\n"), "sans guillemets");
        assert_eq!(skill_description("Pas de frontmatter"), "");
        assert_eq!(skill_description("---\nname: x\n---\n"), "");
        assert_eq!(skill_description("---\ndescription: hors bloc\n"), "hors bloc");
        assert_eq!(skill_description("---\nname: x\n---\ndescription: dans le corps\n"), "");
    }

    /// `scan_skills_dir` : seuls les dossiers contenant un `SKILL.md` lisible
    /// sont listés, triés par nom ; un dossier absent ne fait pas échouer.
    #[test]
    fn scan_skills_dir_lists_only_skills() {
        let dir = crate::test_util::TempDir::new("pilot-skills-test");
        std::fs::create_dir_all(dir.join("zeta")).expect("mkdir zeta");
        std::fs::write(dir.join("zeta").join("SKILL.md"), "---\ndescription: Zêta\n---\n").expect("write zeta");
        std::fs::create_dir_all(dir.join("alpha")).expect("mkdir alpha");
        std::fs::write(dir.join("alpha").join("SKILL.md"), "---\nname: a\ndescription: Alpha\n---\n").expect("write alpha");
        std::fs::create_dir_all(dir.join("sans-skill")).expect("mkdir sans-skill");
        std::fs::write(dir.join("fichier.txt"), "x").expect("write fichier");

        let skills = scan_skills_dir(&dir);
        assert_eq!(
            skills.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(),
            vec!["alpha", "zeta"]
        );
        assert_eq!(skills[0].description, "Alpha");
        assert_eq!(skills[1].description, "Zêta");
        assert!(scan_skills_dir(&dir.join("inexistant")).is_empty());
    }

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

    // ── Mission 380 : vivacité des sessions d'un projet ──
    //
    // `project_has_alive_session` est la garde de VIVACITÉ des sondes
    // d'admission (`get_project_agent_states`) : une activité marquée « busy »
    // sans aucune session vivante est un ORPHELIN (agent mort silencieusement)
    // et ne doit plus bloquer le projet. Les tests ci-dessous couvrent les trois
    // états qui décident réellement : aucune session, session morte, session
    // vivante.

    /// Session RPC minimale adossée à un VRAI processus enfant (aucun `pi`
    /// requis) : `project_has_alive_session` n'observe que la vivacité du
    /// processus. `stdin` doit être pris AVANT tout `wait()` (un `Child` déjà
    /// récolté n'a plus de stdin).
    fn session_avec_processus(
        child: std::process::Child,
        stdin: std::process::ChildStdin,
    ) -> rpc_manager::RpcSession {
        rpc_manager::RpcSession {
            child,
            stdin,
            running: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true)),
            pending: std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
            last_stderr: std::sync::Arc::new(std::sync::Mutex::new(String::new())),
        }
    }

    /// Extrait le stdin d'un processus de test (conservé vivant côté test).
    fn stdin_du_processus(child: &mut std::process::Child) -> std::process::ChildStdin {
        child.stdin.take().expect("stdin du processus de test")
    }

    /// Lance un processus enfant qui reste vivant bien au-delà du test (aucune
    /// dépendance externe, fenêtre masquée sous Windows).
    fn processus_long() -> std::process::Child {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            std::process::Command::new("cmd")
                .args(["/C", "ping -n 30 127.0.0.1"])
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .spawn()
                .expect("processus enfant de test")
        }
        #[cfg(not(windows))]
        {
            std::process::Command::new("sh")
                .args(["-c", "sleep 30"])
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
                .expect("processus enfant de test")
        }
    }

    /// Enregistre une session dans le registre unique du service (clé composite).
    fn enregistrer_session(
        service: &AgentService,
        project: &str,
        agent_id: &str,
        session: rpc_manager::RpcSession,
    ) {
        service.sessions.lock().unwrap().insert(
            AgentService::session_key(project, agent_id),
            SessionEntry {
                session,
                project: project.to_string(),
                state: SessionState::Active,
                mode: SpawnMode::AgentProcess,
            },
        );
    }

    /// Retire la session du registre et récolte son processus (aucun orphelin).
    fn nettoyer_session(service: &AgentService, project: &str, agent_id: &str) {
        let entry = service
            .sessions
            .lock()
            .unwrap()
            .remove(&AgentService::session_key(project, agent_id));
        if let Some(mut entry) = entry {
            let _ = entry.session.child.kill();
            let _ = entry.session.child.wait();
        }
    }

    #[test]
    fn project_has_alive_session_false_sans_session() {
        let service = AgentService::new();
        assert!(
            !service.project_has_alive_session("/proj/sans-session"),
            "un service sans session ne doit jamais déclarer le projet occupé"
        );
    }

    #[test]
    fn project_has_alive_session_false_pour_session_morte() {
        let service = AgentService::new();
        let mut child = processus_long();
        let stdin = stdin_du_processus(&mut child);
        child.kill().expect("arrêt du processus de test");
        child.wait().expect("récolte du processus de test");
        enregistrer_session(
            &service,
            "/proj/mort",
            "codeur",
            session_avec_processus(child, stdin),
        );

        // Cœur de la mission 380 : une session ENREGISTRÉE mais MORTE (agent tué
        // ou mort silencieusement) ne doit plus maintenir l'occupation du projet
        // — sinon la file des missions et la commande manuelle restaient bloquées.
        assert!(
            !service.project_has_alive_session("/proj/mort"),
            "une session dont le processus est terminé ne doit pas occuper le projet"
        );
    }

    #[test]
    fn project_has_alive_session_vraie_pour_session_vivante() {
        let service = AgentService::new();
        let mut child = processus_long();
        let stdin = stdin_du_processus(&mut child);
        enregistrer_session(
            &service,
            "/proj/vivant",
            "codeur",
            session_avec_processus(child, stdin),
        );

        // Non-régression : un agent réellement vivant conserve l'occupation.
        assert!(service.project_has_alive_session("/proj/vivant"));
        // Forme de chemin tolérante (slash final) : même projet.
        assert!(service.project_has_alive_session("/proj/vivant/"));
        // Un autre projet n'hérite pas de la session.
        assert!(!service.project_has_alive_session("/proj/autre"));
        // Sous Windows, la casse et le séparateur `\` désignent le même projet.
        #[cfg(target_os = "windows")]
        assert!(service.project_has_alive_session("\\PROJ\\Vivant\\"));

        nettoyer_session(&service, "/proj/vivant", "codeur");
    }

    /// Tâche #167 : priorité de résolution du modèle initial (registre →
    /// fallback croisé → defaultModel), alignée sur le bus JS.
    #[test]
    fn resolve_initial_model_priority_registry_then_cross_then_default() {
        // Priorité 1 : modèle du registre pour le backend actif (pi).
        assert_eq!(
            resolve_initial_model(
                "prov/a-model",
                "other/b-model",
                "pi",
                Some(("d".to_string(), "m".to_string()))
            ),
            Some(("prov".to_string(), "a-model".to_string()))
        );
        // Priorité 1 bis : backend plh → champ plh d'abord.
        assert_eq!(
            resolve_initial_model("prov/a-model", "other/b-model", "plh", None),
            Some(("other".to_string(), "b-model".to_string()))
        );
        // Priorité 2 : registre vide pour le backend actif → fallback croisé.
        assert_eq!(
            resolve_initial_model("prov/a-model", "", "plh", None),
            Some(("prov".to_string(), "a-model".to_string()))
        );
        // Backend inconnu → essaie pi puis plh (comme le bus JS).
        assert_eq!(
            resolve_initial_model("", "plh/x", "mystem", None),
            Some(("plh".to_string(), "x".to_string()))
        );
        // Priorité 3 : registre vide → defaultModel du model-switch.json.
        assert_eq!(
            resolve_initial_model("", "", "pi", Some(("d".to_string(), "m".to_string()))),
            Some(("d".to_string(), "m".to_string()))
        );
        // Aucun modèle disponible → None (pi garde son modèle interne).
        assert_eq!(resolve_initial_model("", "", "pi", None), None);
        // Modèle de registre malformé (sans '/') → ignoré.
        assert_eq!(resolve_initial_model("nomodel", "", "pi", None), None);
        // modelId contenant un '/' : provider = 1er segment, le reste entier.
        assert_eq!(
            resolve_initial_model("openrouter/meta/llama", "", "pi", None),
            Some(("openrouter".to_string(), "meta/llama".to_string()))
        );
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
            last_stderr: Arc::new(std::sync::Mutex::new(String::new())),
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

    /// Règle propriétaire (2026-10-21) — FERMER UN PROJET N'ARRÊTE PLUS UN AGENT
    /// EN COURS. `stop_idle_project_sessions` (utilisé par `close_project`)
    /// libère les sessions OISIVES du projet et LAISSE VIVANTES celles qui
    /// travaillent (elles reprennent à la réouverture), sans jamais toucher un
    /// autre projet. ÉCHOUE sur le code d'avant, qui appelait
    /// `stop_project_sessions` et tuait TOUTES les sessions du projet.
    #[test]
    fn close_project_keeps_working_agents_alive() {
        let svc = AgentService::new();
        let proj_a = "/p/A";
        let proj_b = "/p/B";
        for (proj, agent) in [(proj_a, "codeur"), (proj_a, "veilleur"), (proj_b, "codeur")] {
            let mut sessions = svc.sessions.lock().unwrap();
            sessions.insert(
                AgentService::session_key(proj, agent),
                SessionEntry {
                    session: fake_session(),
                    project: proj.to_string(),
                    state: SessionState::Parked,
                    mode: SpawnMode::AgentProcess,
                },
            );
        }
        // « codeur » travaille (tâche/outil en cours) ; « veilleur » est au repos.
        let stopped = svc.stop_idle_project_sessions(proj_a, |agent| agent == "codeur");
        assert_eq!(
            stopped,
            vec![AgentService::session_key(proj_a, "veilleur")],
            "seule la session OISIVE du projet fermé est libérée"
        );
        assert!(
            svc.session_of(proj_a, "codeur").is_ok(),
            "l'agent qui TRAVAILLE du projet fermé reste vivant (il reprend au retour)"
        );
        assert!(svc.session_of(proj_a, "veilleur").is_err(), "session oisive libérée");
        assert!(
            svc.session_of(proj_b, "codeur").is_ok(),
            "aucun agent d'un autre projet n'est touché par la fermeture"
        );
        svc.shutdown_all();
    }

    /// Trou du diagnostic 2026-10-21 — un arrêt CIBLÉ doit être protégé par
    /// l'IDENTIFIANT DE SESSION : un arrêt/abandon visant une session remplacée
    /// entre-temps (uid périmé) est REFUSÉ et ne peut jamais emporter la session
    /// neuve du même couple (projet, agent).
    #[test]
    fn targeted_stop_is_protected_by_session_uid() {
        let svc = AgentService::new();
        let proj = "/p/A";
        let agent = "codeur";
        let key = AgentService::session_key(proj, agent);
        {
            let mut sessions = svc.sessions.lock().unwrap();
            sessions.insert(
                key.clone(),
                SessionEntry {
                    session: fake_session(),
                    project: proj.to_string(),
                    state: SessionState::Parked,
                    mode: SpawnMode::AgentProcess,
                },
            );
        }
        // Session née avec l'uid 1 (comme après `start_agent_process`).
        svc.session_uids.lock().unwrap().insert(key.clone(), 1);
        // Arrêt PÉRIMÉ (uid 2) : refusé, la session en place survit.
        assert!(
            svc.stop_owned(proj, agent, Some(2)).is_err(),
            "un arrêt visant une autre session est refusé"
        );
        assert!(
            svc.session_of(proj, agent).is_ok(),
            "la session en place survit à un arrêt périmé"
        );
        assert_eq!(
            svc.session_uid(proj, agent),
            Some(1),
            "un refus ne modifie pas l'uid en place"
        );
        // Abandon PÉRIMÉ : refusé de la même façon (aucune écriture dans la session).
        assert!(
            svc.send_owned(proj, agent, Some(2), serde_json::json!({"type": "abort"}))
                .is_err()
        );
        assert!(
            svc.session_of(proj, agent).is_ok(),
            "l'abandon périmé ne touche pas la session"
        );
        // Arrêt du BON uid : accepté, uid purgé avec la session.
        assert!(svc.stop_owned(proj, agent, Some(1)).is_ok());
        assert!(svc.session_of(proj, agent).is_err());
        assert_eq!(svc.session_uid(proj, agent), None, "uid purgé avec la session");
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

    /// La session d'un agent d'assistant (tâche #140) vit dans le registre
    /// unique sous la clé `ASSISTANT_SPACE\u{1f}<agent_id>` (projet réservé
    /// "__assistant__"). Elle doit être insensible à la fermeture de projet et
    /// au `stop_all_agent_processes` (mode distinct), tout en étant arrêtée par
    /// `stop_assistant_agent` / `stop_assistant_agents` et l'arrêt complet.
    #[test]
    fn assistant_agent_session_is_isolated() {
        let svc = AgentService::new();
        let key = AgentService::session_key(ASSISTANT_SPACE, "analyseur");
        {
            let mut sessions = svc.sessions.lock().unwrap();
            sessions.insert(
                key.clone(),
                SessionEntry {
                    session: fake_session(),
                    project: ASSISTANT_SPACE.to_string(),
                    state: SessionState::Active,
                    mode: SpawnMode::AssistantAgent,
                },
            );
        }
        assert!(svc.assistant_agent_alive("analyseur"), "session assistant vivante détectée");
        // La fermeture d'un projet ne la tue pas.
        svc.stop_project_sessions("/p/A");
        assert!(svc.assistant_agent_alive("analyseur"), "fermeture de projet → session assistant intacte");
        // stop_all_agent_processes (mode AgentProcess) ne la tue pas non plus.
        svc.stop_all_agent_processes();
        assert!(svc.assistant_agent_alive("analyseur"), "stop_all_agent_processes → session assistant intacte");
        // stop_assistant_agent l'arrête précisément.
        svc.stop_assistant_agent("analyseur").unwrap();
        assert!(!svc.assistant_agent_alive("analyseur"), "stop_assistant_agent → session arrêtée");

        // Réinsérer deux sessions puis stop_assistant_agents (fermeture onglet).
        {
            let mut sessions = svc.sessions.lock().unwrap();
            sessions.insert(
                key.clone(),
                SessionEntry {
                    session: fake_session(),
                    project: ASSISTANT_SPACE.to_string(),
                    state: SessionState::Active,
                    mode: SpawnMode::AssistantAgent,
                },
            );
            sessions.insert(
                AgentService::session_key(ASSISTANT_SPACE, "codeur"),
                SessionEntry {
                    session: fake_session(),
                    project: ASSISTANT_SPACE.to_string(),
                    state: SessionState::Active,
                    mode: SpawnMode::AssistantAgent,
                },
            );
        }
        svc.stop_assistant_agents();
        assert!(!svc.assistant_agent_alive("analyseur"));
        assert!(!svc.assistant_agent_alive("codeur"), "stop_assistant_agents → toutes arrêtées");

        // Réinsérer puis arrêt complet (fermeture app) : purgé.
        {
            let mut sessions = svc.sessions.lock().unwrap();
            sessions.insert(
                key.clone(),
                SessionEntry {
                    session: fake_session(),
                    project: ASSISTANT_SPACE.to_string(),
                    state: SessionState::Active,
                    mode: SpawnMode::AssistantAgent,
                },
            );
        }
        assert!(svc.assistant_agent_alive("analyseur"));
        svc.shutdown_all();
        assert!(!svc.assistant_agent_alive("analyseur"), "arrêt complet → session assistant purgée");
    }

    /// Sonde `isWorking` exposée au LLM (chantier « l'assistant relance des
    /// agents qui travaillent ») : elle ne doit JAMAIS exiger que l'onglet soit
    /// visible, ni confondre « repos » et « mort ». Un agent dont un OUTIL tourne
    /// (build/tests silencieux) ou dont l'activité est récente TRAVAILLE, et un
    /// processus mort ne travaille jamais (même si `busy` est resté vrai).
    #[test]
    fn session_is_working_ignores_tab_state_and_recent_tool_activity() {
        // Processus mort : jamais « au travail », même avec busy périmé.
        assert!(!session_is_working(false, true, true, 0));
        // Tâche en cours (agent_start reçu) → travail.
        assert!(session_is_working(true, true, false, 10_000));
        // Outil long SILENCIEUX (build, tests) : busy faux mais outil en cours.
        assert!(session_is_working(true, false, true, 10_000));
        // Entre deux tours : activité récente (< 2 min) → encore au travail.
        assert!(session_is_working(true, false, false, 30));
        // Session parkée au repos (aucun drapeau, activité ancienne) → repos.
        assert!(!session_is_working(true, false, false, WORKING_RECENT_WINDOW_SECS));
        assert!(!session_is_working(true, false, false, 3600));
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

    /// Règle 5 (audit indépendant) : verrou de CONTRAT DE FORME avec le frontend.
    /// `list_agent_sessions` est lu tel quel par `agents-bus.js` /
    /// `exclusivity-queue.js` / `dashboard.js` pour décider si un agent VIVANT
    /// travaille. Une lecture JS est fail-open : un renommage de champ côté Rust
    /// ferait silencieusement conclure « personne ne travaille » et libérerait un
    /// agent vivant (verrou de run, file d'attente). Ce test doit donc échouer sur
    /// tout renommage, sans lancer de processus.
    #[test]
    fn session_entry_json_keeps_frontend_contract_keys() {
        // Entrée « pleine » : une session vivante et active avec activité connue.
        let entry = session_entry_json(
            "/p/A",
            "codeur",
            "main",
            "active",
            true,
            true,
            false,
            Some(true),
            Some(true),
            Some(true),
        );
        for key in [
            "project",
            "agent",
            "mode",
            "state",
            "alive",
            "visible",
            "active",
            "busy",
            "toolInProgress",
            "isWorking",
        ] {
            assert!(
                entry.get(key).is_some(),
                "champ `{}` consommé par le frontend (sonde d'exclusivité / file d'attente) : \
                 le renommer libérerait un agent vivant en silence",
                key
            );
        }
        // Les valeurs doivent rester exploitables telles quelles (booléens / textes).
        assert_eq!(entry["project"], serde_json::json!("/p/A"));
        assert_eq!(entry["agent"], serde_json::json!("codeur"));
        assert_eq!(entry["alive"], serde_json::json!(true));
        assert_eq!(entry["busy"], serde_json::json!(true));
        assert_eq!(entry["toolInProgress"], serde_json::json!(true));

        // Entrée minimale (aucune activité enregistrée) : les clés de BASE restent
        // présentes, les champs d'activité sont simplement absents (fail-open JS).
        let minimal = session_entry_json("/p/B", "default", "main", "parked", false, false, false, None, None, None);
        for key in ["project", "agent", "mode", "state", "alive", "visible", "active"] {
            assert!(minimal.get(key).is_some(), "clé de base `{}` toujours présente", key);
        }
        assert!(minimal.get("busy").is_none(), "activité inconnue → `busy` absent");
        assert!(
            minimal.get("toolInProgress").is_none(),
            "activité inconnue → `toolInProgress` absent"
        );
    }

    /// Mission en cours (affichage) : un envoi de prompt est mémorisé comme
    /// dernier prompt de la session, tronqué ; une commande qui n'est PAS un
    /// prompt ne l'écrase jamais.
    #[test]
    fn send_records_last_prompt_only_for_prompt_commands() {
        let svc = AgentService::new();
        let key = AgentService::session_key("/p/A", "default");
        {
            let mut sessions = svc.sessions.lock().unwrap();
            sessions.insert(
                key.clone(),
                SessionEntry {
                    session: fake_session(),
                    project: "/p/A".to_string(),
                    state: SessionState::Active,
                    mode: SpawnMode::MainSession,
                },
            );
        }
        let last = |svc: &AgentService| svc.last_prompts.lock().unwrap().get(&key).cloned();

        // Prompt court : conservé tel quel.
        svc.send(
            "/p/A",
            "default",
            serde_json::json!({ "type": "prompt", "message": "Corriger la recherche globale" }),
        )
        .unwrap();
        assert_eq!(last(&svc).as_deref(), Some("Corriger la recherche globale"));

        // Commande non-prompt : le dernier prompt connu est INCHANGÉ.
        svc.send("/p/A", "default", serde_json::json!({ "type": "get_state" }))
            .unwrap();
        assert_eq!(last(&svc).as_deref(), Some("Corriger la recherche globale"));

        // Prompt très long : réduit à une fenêtre de 600 caractères + « … »
        // (par caractères). 600 et non 80 : la mission d'un prompt de
        // délégation commence après le préambule de rôle.
        let long = "é".repeat(2000);
        svc.send(
            "/p/A",
            "default",
            serde_json::json!({ "type": "prompt", "message": long }),
        )
        .unwrap();
        let got = last(&svc).expect("prompt long mémorisé");
        assert_eq!(got.chars().count(), PROMPT_SNAPSHOT_MAX_CHARS + 1);
        assert!(got.ends_with('…'), "troncature signalée par …");

        // Prompt vide : reste un prompt (chaîne vide) — l'affichage applique son
        // repli, jamais une ancienne mission conservée à tort.
        svc.send(
            "/p/A",
            "default",
            serde_json::json!({ "type": "prompt", "message": "   " }),
        )
        .unwrap();
        assert_eq!(last(&svc).as_deref(), Some(""));
    }

    /// `prompt_command_with_resume` : le RÉSUMÉ COURT facultatif est joint à la
    /// commande de prompt sous un champ PROPRE À PILOT, et rien n'est ajouté
    /// quand il est absent ou vide (commandes strictement identiques à avant).
    #[test]
    fn prompt_command_with_resume_is_additive_only() {
        // Sans résumé : commande EXACTEMENT celle d'avant (rétrocompatibilité).
        let plain = prompt_command_with_resume("Faire X", None);
        assert_eq!(plain, serde_json::json!({ "type": "prompt", "message": "Faire X" }));
        // Résumé vide / blancs seuls : aucune valeur inventée, aucun champ.
        for empty in ["", "   ", "\n\t "] {
            let cmd = prompt_command_with_resume("Faire X", Some(empty));
            assert!(
                cmd.get(MISSION_RESUME_FIELD).is_none(),
                "un résumé inutilisable ne doit ajouter aucun champ"
            );
            assert_eq!(cmd["message"], serde_json::json!("Faire X"));
        }
        // Résumé fourni : nettoyé (espaces / retours à la ligne) et joint.
        let cmd = prompt_command_with_resume("Faire X", Some("  Corriger\n la  cloche "));
        assert_eq!(cmd[MISSION_RESUME_FIELD], serde_json::json!("Corriger la cloche"));
        assert_eq!(cmd["type"], serde_json::json!("prompt"));
        assert_eq!(cmd["message"], serde_json::json!("Faire X"));
    }

    /// Le résumé est PLAFONNÉ à `MISSION_RESUME_MAX_CHARS`, coupé proprement sur
    /// un mot (jamais au milieu), comme l'affichage côté JS.
    #[test]
    fn normalize_mission_resume_caps_at_120_chars_on_a_word_boundary() {
        let long = "Mot ".repeat(60);
        let got = normalize_mission_resume(long.trim()).expect("résumé utilisable");
        assert!(
            got.chars().count() <= MISSION_RESUME_MAX_CHARS + 1,
            "plafond 120 caractères (+ …) : {} caractères",
            got.chars().count()
        );
        assert!(got.ends_with('…'), "troncature signalée par …");
        assert!(got.starts_with("Mot Mot"), "le début du résumé est conservé");
        // La coupe ne tombe jamais au milieu d'un mot (« Mo… »).
        let before = got.trim_end_matches('…');
        assert!(
            before.ends_with("Mot"),
            "coupe sur une frontière de mot, pas au milieu : {:?}",
            before
        );
        // Un texte pile à la limite n'est pas coupé.
        let exact = "a".repeat(MISSION_RESUME_MAX_CHARS);
        assert_eq!(normalize_mission_resume(&exact), Some(exact.clone()));
    }

    /// `prompt_resume` : seule une commande `prompt` porte un résumé. Un prompt
    /// SANS résumé est signalé (`Some(None)`) pour que l'ancien résumé soit
    /// effacé ; une commande non-prompt (`get_state`, `set_model`) ne dit RIEN
    /// (`None`) et ne doit pas toucher au résumé de la mission en cours.
    #[test]
    fn prompt_resume_distinguishes_absent_prompt_and_other_commands() {
        assert_eq!(prompt_resume(&serde_json::json!({ "type": "get_state" })), None);
        assert_eq!(prompt_resume(&serde_json::json!({ "type": "set_model" })), None);
        assert_eq!(
            prompt_resume(&serde_json::json!({ "type": "prompt", "message": "x" })),
            Some(None)
        );
        assert_eq!(
            prompt_resume(&serde_json::json!({
                "type": "prompt",
                "message": "x",
                MISSION_RESUME_FIELD: "  Réparer   la file "
            })),
            Some(Some("Réparer la file".to_string()))
        );
    }

    /// Le champ résumé est RETIRÉ de la commande avant l'écriture vers pi : il
    /// appartient à Pilot, pas au protocole RPC (aucun octet inconnu envoyé au
    /// moteur). La commande envoyée est alors exactement celle d'avant.
    #[test]
    fn strip_resume_field_leaves_the_rpc_command_untouched() {
        let mut cmd = prompt_command_with_resume("Faire X", Some("Corriger la cloche"));
        assert!(cmd.get(MISSION_RESUME_FIELD).is_some(), "champ présent avant retrait");
        strip_resume_field(&mut cmd);
        assert!(cmd.get(MISSION_RESUME_FIELD).is_none(), "champ retiré avant écriture");
        assert_eq!(cmd, serde_json::json!({ "type": "prompt", "message": "Faire X" }));
    }

    /// Le résumé est conservé AVEC la mission de la session (`resume` du panneau
    /// des tâches) : fourni → mémorisé nettoyé ; prompt sans résumé → EFFACÉ ;
    /// commande non-prompt → inchangé (une consultation ne détruit rien).
    #[test]
    fn send_records_and_clears_the_mission_resume() {
        let svc = AgentService::new();
        let key = AgentService::session_key("/p/A", "default");
        {
            let mut sessions = svc.sessions.lock().unwrap();
            sessions.insert(
                key.clone(),
                SessionEntry {
                    session: fake_session(),
                    project: "/p/A".to_string(),
                    state: SessionState::Active,
                    mode: SpawnMode::MainSession,
                },
            );
        }
        let resume = |svc: &AgentService| svc.last_resumes.lock().unwrap().get(&key).cloned();

        // Résumé fourni : conservé, nettoyé.
        svc.send(
            "/p/A",
            "default",
            prompt_command_with_resume("Faire X", Some("  Corriger\n la cloche ")),
        )
        .unwrap();
        assert_eq!(resume(&svc).as_deref(), Some("Corriger la cloche"));

        // Commande non-prompt : le résumé de la mission EN COURS reste lisible.
        svc.send("/p/A", "default", serde_json::json!({ "type": "get_state" }))
            .unwrap();
        assert_eq!(resume(&svc).as_deref(), Some("Corriger la cloche"));

        // Prompt SANS résumé : l'ancien résumé est EFFACÉ (jamais attribué à une
        // autre mission que la sienne).
        svc.send(
            "/p/A",
            "default",
            serde_json::json!({ "type": "prompt", "message": "Autre tâche" }),
        )
        .unwrap();
        assert_eq!(resume(&svc), None, "un prompt sans résumé efface le précédent");
    }

    /// `prompt_snapshot` : extraction PURE du texte de mission d'une commande.
    #[test]
    fn prompt_snapshot_extracts_prompt_text() {
        assert_eq!(prompt_snapshot(&serde_json::json!({ "type": "get_state" })), None);
        assert_eq!(prompt_snapshot(&serde_json::json!({ "type": "set_model" })), None);
        assert_eq!(
            prompt_snapshot(&serde_json::json!({ "type": "prompt", "message": "  ok  " })),
            Some("ok".to_string())
        );
        assert_eq!(
            prompt_snapshot(&serde_json::json!({ "type": "prompt", "message": "" })),
            Some(String::new())
        );
    }

    /// Panneau (bas à droite) : la fenêtre conservée du prompt doit CONTENIR la
    /// mission, même quand celle-ci commence loin après le préambule de rôle.
    /// Régression corrigée : une coupe aux 80 premiers caractères ne gardait que
    /// le rôle (« Tu es un développeur… ») et le panneau affichait un repli faux.
    #[test]
    fn prompt_snapshot_keeps_the_mission_even_far_after_the_role() {
        // Prompt de la MÊME FORME que `buildAgentPrompt` : rôle, spécialité,
        // rôle du codeur, contexte projet, puis `=== MISSION ===`.
        let role = "Tu es un développeur. Tu exécutes la micro-tâche reçue. \
                    Tu lis les fichiers avec les outils à ta disposition. \
                    Tu modifies UNIQUEMENT les fichiers nécessaires.";
        let prompt = format!(
            "{role}\n\n=== SPÉCIALITÉ ===\nRôle : {role}\nCapacités : write, edit\n\n\
             === RÔLE ===\nTu es le CODEUR (agent principal) de ce projet : tu es autorisé à \
             MODIFIER les fichiers de code.\n\n\
             === CONTEXTE PROJET (RAG auto-injecté par Pilot) ===\n\
             ### src/js/agent-activity.js\n\
             Module de l'indicateur d'activité des agents et du volet des missions du panneau.\n\
             ### src-tauri/src/agent_service.rs\n\
             Propriétaire unique des sessions d'agents, de leur état et de leur dernier prompt.\n\
             === FIN CONTEXTE ===\n\n\
             === MISSION ===\n## Contexte\nPilot est un éditeur de texte pour agents IA.\n\n\
             ## Objectif\nObjectif : afficher la tâche réelle des agents dans le panneau.\n\n\
             ## Consignes\nNe rien casser."
        );
        assert!(
            prompt.chars().count() > PROMPT_SNAPSHOT_MAX_CHARS + 80,
            "le prompt de test doit dépasser largement la fenêtre conservée"
        );
        let snap = prompt_snapshot(&serde_json::json!({ "type": "prompt", "message": prompt }))
            .expect("prompt mémorisé");
        // Borné (jamais le prompt entier)…
        assert!(snap.chars().count() <= PROMPT_SNAPSHOT_MAX_CHARS + 1);
        // …mais la MISSION est dedans : section Objectif ET sa phrase.
        assert!(snap.contains("## Objectif"), "la section Objectif est conservée : {snap}");
        assert!(
            snap.contains("afficher la tâche réelle des agents dans le panneau"),
            "la phrase de l'objectif est conservée : {snap}"
        );
        assert!(
            !snap.starts_with("Tu es un développeur"),
            "la fenêtre démarre sur la mission, pas sur le préambule de rôle : {snap}"
        );
    }

    /// L'ancre de mission est un DÉBUT DE LIGNE : une mention « ## Objectif »
    /// CITÉE au milieu d'une phrase (règle, exemple, documentation) n'ancre rien.
    #[test]
    fn mission_anchor_must_start_a_line() {
        // Citation dans une phrase : ignorée (défaut du panneau de l'assistant).
        assert_eq!(
            find_anchor_at_line_start(
                "L'enveloppe « ## Contexte/## Objectif/## Consignes » est ajoutée par Pilot.",
                "## Objectif"
            ),
            None
        );
        // Vrai titre de section : retenu, avec sa position en CARACTÈRES.
        let text = "préambule é\n\n## Objectif\nCorriger le panneau";
        assert_eq!(
            find_anchor_at_line_start(text, "## Objectif"),
            Some("préambule é\n\n".chars().count())
        );
        // Indentation tolérée (titre de liste indenté), ancre vide ignorée.
        assert!(find_anchor_at_line_start("  ## Objectif\nX", "## Objectif").is_some());
        assert_eq!(find_anchor_at_line_start("## Objectif", ""), None);
        // Une 1re occurrence en pleine phrase n'empêche pas la bonne, plus loin.
        assert_eq!(
            find_anchor_at_line_start("voir ## Objectif\n## Objectif\nX", "## Objectif"),
            Some("voir ## Objectif\n".chars().count())
        );
    }

    /// RÉGRESSION du panneau des tâches : le prompt envoyé à l'assistant contient
    /// TOUT son prompt système (rôle + règles) PUIS la demande. La fenêtre
    /// conservée ne doit jamais démarrer au milieu des règles à cause d'un
    /// « ## Objectif » cité dans une phrase de règle — sinon le panneau affichait
    /// « Si une tâche déléguée ou une action échoue… » à la place d'une tâche.
    #[test]
    fn prompt_snapshot_never_anchors_inside_the_assistant_rules() {
        // Prompt SYSTÈME de la même forme que celui de l'assistant : rôle, puis
        // blocs de règles, dont la règle de résilience qui CITE « ## Objectif ».
        let system = format!(
            "Tu es « Magnus », l'assistant de suivi multi-projets de Pilot. Tu es strictement \
             en lecture seule : tu ne modifies jamais les fichiers des projets. {}{}{}",
            "\n\n## Outils d'agents\nTu disposes de `run_agents` et `run_agents_shared`. ".repeat(3),
            "\n\n## Résilience et anti-boucle — `run_agents`\nConstruis toujours une demande \
             STRUCTURÉE et COMPLÈTE. L'enveloppe « ## Contexte/## Objectif/## Consignes/## Ce \
             qu'il ne faut PAS faire » est ajoutée MÉCANIQUEMENT par Pilot : n'insère que le \
             contenu de la tâche.",
            "\n\nSi une tâche déléguée ou une action échoue (échec EXPLICITE : compte-rendu reçu), \
             relance AU MOINS UNE FOIS en changeant d'approche."
        );
        let demande = "Peux-tu me faire le point sur les tâches en cours du projet GDS ?";
        let message = format!("{}\n\n{}", system, demande);
        assert!(
            message.chars().count() > PROMPT_SNAPSHOT_MAX_CHARS + 200,
            "le message de test doit dépasser largement la fenêtre conservée"
        );
        let snap = prompt_snapshot(&serde_json::json!({ "type": "prompt", "message": message }))
            .expect("prompt mémorisé");
        // La fenêtre ne tombe JAMAIS dans le bloc de règles.
        assert!(
            !snap.contains("Si une tâche déléguée ou une action échoue"),
            "la fenêtre ne doit pas reprendre une règle de l'assistant : {snap}"
        );
        assert!(
            !snap.contains("relance AU MOINS UNE FOIS"),
            "aucun fragment de règle dans la fenêtre : {snap}"
        );
        // Repli documenté quand AUCUNE ancre n'est en début de ligne : la fenêtre
        // démarre au début du message ; c'est l'appelant (l'assistant) qui joint
        // sa mission courte, et l'affichage qui applique son repli neutre.
        assert!(
            snap.starts_with("Tu es « Magnus »"),
            "sans ancre en début de ligne, la fenêtre démarre au début : {snap}"
        );
    }

    /// P4 : `upsert_agent_conn` est idempotent pour un agent GLOBAL
    /// (project_path = NULL). En SQLite, `UNIQUE(id, project_path)` traite les
    /// NULL comme distincts → le `ON CONFLICT` ne se déclencherait jamais et on
    /// insérerait un doublon. Le check-then-update/insert doit garantir qu'un
    /// second upsert met à jour la ligne existante au lieu d'en créer une autre.
    #[test]
    fn upsert_global_agent_is_idempotent() {
        // Tâche #345 : schéma RÉEL de `pilot.db` (porte `chemin_normalise` et
        // l'index UNIQUE `(id, chemin_normalise)` exigés par `upsert_agent_conn`).
        let conn = persistence_conn();

        let agent = Agent {
            id: "analyseur".to_string(),
            name: "Analyseur".to_string(),
            icon: "🔍".to_string(),
            description: "Analyse".to_string(),
            role: "Tu analyses.".to_string(),
            models: crate::agent::AgentModels { pi: String::new(), plh: String::new() },
            thinking: crate::agent::AgentThinking::default(),
            capabilities: Vec::new(),
            skills: Vec::new(),
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

    /// T2 : `delete_agent_conn` ne supprime QUE la ligne visée (même id dans un
    /// autre scope, ou même scope avec un autre id, conservés). Sans erreur
    /// silencieuse : un agent absent est signalé.
    #[test]
    fn delete_agent_removes_only_target_row() {
        // Tâche #345 : schéma RÉEL de `pilot.db` (porte `chemin_normalise` et
        // l'index UNIQUE `(id, chemin_normalise)` exigés par `upsert_agent_conn`).
        let conn = persistence_conn();

        let mut global = sample_agent("diag-1");
        global.visible = false;
        upsert_agent_conn(&conn, &global).expect("global");
        let mut kept = sample_agent("analyseur");
        upsert_agent_conn(&conn, &kept).expect("global conservé");
        kept.project_path = Some("G:/IA_PL/pilot".to_string());
        upsert_agent_conn(&conn, &kept).expect("ligne projet même id");

        delete_agent_conn(&conn, "diag-1", None).expect("suppression ciblée");

        let global_kept: i64 = conn
            .query_row("SELECT COUNT(*) FROM agents WHERE id = ?1 AND project_path IS NULL", params!["analyseur"], |r| r.get(0))
            .expect("count global");
        let project_kept: i64 = conn
            .query_row("SELECT COUNT(*) FROM agents WHERE id = ?1 AND project_path IS NOT NULL", params!["analyseur"], |r| r.get(0))
            .expect("count projet");
        let gone: i64 = conn
            .query_row("SELECT COUNT(*) FROM agents WHERE id = ?1", params!["diag-1"], |r| r.get(0))
            .expect("count supprimé");
        assert_eq!(global_kept, 1, "l'autre agent global est conservé");
        assert_eq!(project_kept, 1, "la ligne projet du même id est conservée");
        assert_eq!(gone, 0, "la ligne visée est supprimée");
        // Agent absent → erreur explicite (pas de fantôme silencieux).
        assert!(delete_agent_conn(&conn, "diag-1", None).is_err());
    }

    /// `agent_alive` distingue une session vivante d'une session absente ou
    /// morte. Base du garde-fou anti-orphan de `do_start_agent_session`.
    #[test]
    fn agent_alive_detects_live_dead_and_missing_sessions() {
        let svc = AgentService::new();
        let proj = "/p/A";
        // Aucune session en registre → pas vivante.
        assert!(!svc.agent_alive(proj, "default"), "session absente → pas vivante");
        // Session vivante → vivante.
        {
            let mut sessions = svc.sessions.lock().unwrap();
            sessions.insert(
                AgentService::session_key(proj, "default"),
                SessionEntry {
                    session: fake_session(),
                    project: proj.to_string(),
                    state: SessionState::Active,
                    mode: SpawnMode::MainSession,
                },
            );
        }
        assert!(svc.agent_alive(proj, "default"), "session vivante détectée");
        // Tuer le processus enfant → session morte → pas vivante.
        {
            let mut sessions = svc.sessions.lock().unwrap();
            if let Some(entry) = sessions.get_mut(&AgentService::session_key(proj, "default")) {
                let _ = entry.session.child.kill();
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
        assert!(!svc.agent_alive(proj, "default"), "session tuée → pas vivante");
    }

    /// T4 : `agent_process_alive` détecte une session d'agent multi-rôles H2 V2
    /// (mode AgentProcess) vivante pour (project, agent_id). Base de
    /// l'exclusivité des spécialités par projet : un seul agent de chaque
    /// spécialité (agent_id) par projet à la fois. Une session `MainSession` du
    /// même agent_id n'est PAS comptée (l'exclusivité ne concerne que les
    /// agents multi-rôles H2 V2).
    #[test]
    fn agent_process_alive_detects_exclusivity() {
        let svc = AgentService::new();
        let proj = "/p/A";
        // Aucune session → pas vivante.
        assert!(!svc.agent_process_alive(proj, "codeur"), "session absente → pas vivante");
        // Session AgentProcess vivante → vivante.
        {
            let mut sessions = svc.sessions.lock().unwrap();
            sessions.insert(
                AgentService::session_key(proj, "codeur"),
                SessionEntry {
                    session: fake_session(),
                    project: proj.to_string(),
                    state: SessionState::Active,
                    mode: SpawnMode::AgentProcess,
                },
            );
        }
        assert!(svc.agent_process_alive(proj, "codeur"), "agent_process vivant détecté");
        // Une session MainSession du même agent_id n'est PAS comptée (exclusivité
        // réservée aux agents multi-rôles H2 V2).
        {
            let mut sessions = svc.sessions.lock().unwrap();
            sessions.insert(
                AgentService::session_key(proj, "default"),
                SessionEntry {
                    session: fake_session(),
                    project: proj.to_string(),
                    state: SessionState::Active,
                    mode: SpawnMode::MainSession,
                },
            );
        }
        assert!(!svc.agent_process_alive(proj, "default"), "session main non concernée");
        // Tuer le processus → plus vivante.
        {
            let mut sessions = svc.sessions.lock().unwrap();
            if let Some(entry) = sessions.get_mut(&AgentService::session_key(proj, "codeur")) {
                let _ = entry.session.child.kill();
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
        assert!(!svc.agent_process_alive(proj, "codeur"), "processus tué → plus vivante");
    }

    /// Bug #81 : `main_session_alive` détecte une session principale (mode
    /// MainSession, agent standard du chat) vivante pour (project, agent_id).
    /// Base de l'arrêt automatique de l'agent standard figé. Une session
    /// `AgentProcess` (run_agents) du même agent_id n'est PAS comptée (scope
    /// run_agents inchangé).
    #[test]
    fn main_session_alive_detects_standard_agent() {
        let svc = AgentService::new();
        let proj = "/p/A";
        // Aucune session → pas vivante.
        assert!(!svc.main_session_alive(proj, "default"), "session absente → pas vivante");
        // Session MainSession vivante → vivante.
        {
            let mut sessions = svc.sessions.lock().unwrap();
            sessions.insert(
                AgentService::session_key(proj, "default"),
                SessionEntry {
                    session: fake_session(),
                    project: proj.to_string(),
                    state: SessionState::Active,
                    mode: SpawnMode::MainSession,
                },
            );
        }
        assert!(svc.main_session_alive(proj, "default"), "session main vivante détectée");
        // Une session AgentProcess du même agent_id n'est PAS comptée (scope
        // run_agents inchangé : main_session_alive ne concerne que MainSession).
        {
            let mut sessions = svc.sessions.lock().unwrap();
            sessions.insert(
                AgentService::session_key(proj, "codeur"),
                SessionEntry {
                    session: fake_session(),
                    project: proj.to_string(),
                    state: SessionState::Active,
                    mode: SpawnMode::AgentProcess,
                },
            );
        }
        assert!(!svc.main_session_alive(proj, "codeur"), "session agent_process non concernée");
        // Tuer le processus → plus vivante.
        {
            let mut sessions = svc.sessions.lock().unwrap();
            if let Some(entry) = sessions.get_mut(&AgentService::session_key(proj, "default")) {
                let _ = entry.session.child.kill();
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
        assert!(!svc.main_session_alive(proj, "default"), "processus tué → plus vivante");
    }

    /// `agent_process_busy` distingue une session vivante mais INACTIVE (settled,
    /// run précédente terminée) d'une session réellement en train d'exécuter une
    /// tâche (busy=true). C'est le cœur du fix : une session vivante mais inactive
    /// doit être réutilisable pour une nouvelle run (run_agents), pas bloquée.
    #[test]
    fn agent_process_busy_distinguishes_running_from_idle() {
        let svc = AgentService::new();
        let proj = "/p/A";
        let anomaly_map: Arc<Mutex<HashMap<String, anomaly::AgentAnomalyState>>> =
            Arc::new(Mutex::new(HashMap::new()));
        // Session AgentProcess vivante, aucune entrée d'anomalie → pas busy.
        {
            let mut sessions = svc.sessions.lock().unwrap();
            sessions.insert(
                AgentService::session_key(proj, "codeur"),
                SessionEntry {
                    session: fake_session(),
                    project: proj.to_string(),
                    state: SessionState::Active,
                    mode: SpawnMode::AgentProcess,
                },
            );
        }
        assert!(
            !svc.agent_process_busy(&anomaly_map, proj, "codeur"),
            "vivant mais sans activité → pas busy (réutilisable)"
        );
        // busy=true (agent_start) → exclusif.
        anomaly_map.lock().unwrap().insert(
            format!("{}\u{1f}{}", proj, "codeur"),
            anomaly::AgentAnomalyState {
                last_activity: Instant::now(),
                last_progress: Instant::now(),
                last_activity_wall: Some(std::time::SystemTime::now()),
                last_event: "agent_start".to_string(),
                busy: true,
                blocked_reported: false,
                auto_stopped_reported: false,
                awaiting_user: false,
                tool_in_progress: false,
                tool_started_at: None,
                produced_output: false,
            },
        );
        assert!(
            svc.agent_process_busy(&anomaly_map, proj, "codeur"),
            "busy=true → exclusif"
        );
        // busy=false (agent_settled) → réutilisable.
        anomaly_map
            .lock()
            .unwrap()
            .get_mut(&format!("{}\u{1f}{}", proj, "codeur"))
            .unwrap()
            .busy = false;
        assert!(
            !svc.agent_process_busy(&anomaly_map, proj, "codeur"),
            "settled (busy=false) → réutilisable"
        );
        // Session morte → pas busy.
        {
            let mut sessions = svc.sessions.lock().unwrap();
            if let Some(entry) = sessions.get_mut(&AgentService::session_key(proj, "codeur")) {
                let _ = entry.session.child.kill();
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
        assert!(
            !svc.agent_process_busy(&anomaly_map, proj, "codeur"),
            "processus tué → pas busy"
        );
    }

    /// Porte Rust du verrou par projet (mission « portes du verrou ») :
    /// `agents::ensure_agent_not_busy` refuse un prompt DIRECT vers une session
    /// AgentProcess vivante ET busy (deux exécutions concurrentes sur le même
    /// couple (projet, agent) interdites) et l'autorise dès que la session est
    /// idle/settled, absente, ou son process mort — les relances légitimes du
    /// bus (après agent_end) ne sont donc jamais bloquées.
    #[test]
    fn prompt_gate_refuses_while_agent_process_is_busy() {
        let svc = AgentService::new();
        let proj = "/p/gate";
        let anomaly_map: Arc<Mutex<HashMap<String, anomaly::AgentAnomalyState>>> =
            Arc::new(Mutex::new(HashMap::new()));
        // Session absente → autorisé.
        assert!(
            crate::agents::ensure_agent_not_busy(&svc, &anomaly_map, proj, "codeur").is_ok(),
            "session absente → prompt autorisé"
        );
        // Session AgentProcess vivante + busy=true (agent_start) → refus explicite.
        {
            let mut sessions = svc.sessions.lock().unwrap();
            sessions.insert(
                AgentService::session_key(proj, "codeur"),
                SessionEntry {
                    session: fake_session(),
                    project: proj.to_string(),
                    state: SessionState::Active,
                    mode: SpawnMode::AgentProcess,
                },
            );
        }
        anomaly_map.lock().unwrap().insert(
            format!("{}\u{1f}{}", proj, "codeur"),
            anomaly::AgentAnomalyState {
                last_activity: Instant::now(),
                last_progress: Instant::now(),
                last_activity_wall: Some(std::time::SystemTime::now()),
                last_event: "agent_start".to_string(),
                busy: true,
                blocked_reported: false,
                auto_stopped_reported: false,
                awaiting_user: false,
                tool_in_progress: false,
                tool_started_at: None,
                produced_output: false,
            },
        );
        let err = crate::agents::ensure_agent_not_busy(&svc, &anomaly_map, proj, "codeur")
            .expect_err("un agent qui travaille doit être refusé");
        assert!(
            err.contains("codeur") && err.contains("déjà"),
            "refus honnête et nommé : {err}"
        );
        // busy=false (agent_settled) → autorisé (relance légitime du bus).
        anomaly_map
            .lock()
            .unwrap()
            .get_mut(&format!("{}\u{1f}{}", proj, "codeur"))
            .unwrap()
            .busy = false;
        assert!(
            crate::agents::ensure_agent_not_busy(&svc, &anomaly_map, proj, "codeur").is_ok(),
            "settled → prompt autorisé"
        );
    }

    /// Bug #152 : `has_dead_agent_process` détecte une session d'agent délégué
    /// ENCORE ENREGISTRÉE dont le processus est mort (busy résiduel à purger).
    /// Une session vivante, une session morte déjà retirée du registre ou une
    /// session d'un autre mode (main) retournent toujours false — la purge du
    /// moniteur ne doit jamais viser la session principale, le reviewer ou le
    /// super-agent.
    #[test]
    fn has_dead_agent_process_detects_dead_registered_process() {
        let svc = AgentService::new();
        let proj = "/p/A";
        // Session absente → false.
        assert!(!svc.has_dead_agent_process(proj, "codeur"), "session absente → false");
        // Session AgentProcess vivante → false (rien à purger).
        {
            let mut sessions = svc.sessions.lock().unwrap();
            sessions.insert(
                AgentService::session_key(proj, "codeur"),
                SessionEntry {
                    session: fake_session(),
                    project: proj.to_string(),
                    state: SessionState::Active,
                    mode: SpawnMode::AgentProcess,
                },
            );
            sessions.insert(
                AgentService::session_key(proj, "default"),
                SessionEntry {
                    session: fake_session(),
                    project: proj.to_string(),
                    state: SessionState::Active,
                    mode: SpawnMode::MainSession,
                },
            );
        }
        assert!(!svc.has_dead_agent_process(proj, "codeur"), "process vivant → false");
        assert!(!svc.has_dead_agent_process(proj, "default"), "mode main → jamais détecté");
        // Tuer le processus → session enregistrée + morte → true (à purger).
        {
            let mut sessions = svc.sessions.lock().unwrap();
            if let Some(entry) = sessions.get_mut(&AgentService::session_key(proj, "codeur")) {
                let _ = entry.session.child.kill();
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
        assert!(
            svc.has_dead_agent_process(proj, "codeur"),
            "processus mort + session enregistrée → true (purge)"
        );
        assert!(!svc.has_dead_agent_process(proj, "inconnu"), "agent inconnu → false");
    }

    /// `clear_active_if_dead` réinitialise un pointeur `active` orphelin
    /// (session pointée morte/absente) mais conserve un pointeur légitime
    /// (session vivante). C'est le cœur du fix anti-orphan : il débloque les
    /// délégations sans jamais tuer une session réellement active.
    #[test]
    fn clear_active_if_dead_clears_orphan_keeps_alive() {
        let svc = AgentService::new();
        let proj = "/p/A";
        // Pointeur actif orphelin : aucune session pour (proj, "default").
        *svc.active.lock().unwrap() = Some("default".to_string());
        assert!(svc.clear_active_if_dead(proj), "orphelin détecté et nettoyé");
        assert_eq!(svc.active_agent(), None, "pointeur orphelin réinitialisé");
        // Session vivante → pointeur conservé (pas nettoyé).
        {
            let mut sessions = svc.sessions.lock().unwrap();
            sessions.insert(
                AgentService::session_key(proj, "default"),
                SessionEntry {
                    session: fake_session(),
                    project: proj.to_string(),
                    state: SessionState::Active,
                    mode: SpawnMode::MainSession,
                },
            );
        }
        *svc.active.lock().unwrap() = Some("default".to_string());
        assert!(!svc.clear_active_if_dead(proj), "session vivante → pas nettoyé");
        assert_eq!(
            svc.active_agent(),
            Some("default".to_string()),
            "pointeur conservé (session vivante)"
        );
    }

    /// `stop` réinitialise toujours le pointeur `active` quand l'agent arrêté
    /// est l'agent actif, même si la session est introuvable dans le registre
    /// (pointeur orphelin). Évite qu'un arrêt laisse un pointeur orphelin qui
    /// bloquerait ensuite toutes les délégations via le garde-fou de
    /// `do_start_agent_session`.
    #[test]
    fn stop_clears_active_even_if_session_missing() {
        let svc = AgentService::new();
        let proj = "/p/A";
        // Pointeur actif mais AUCUNE session en registre (orphelin pur).
        *svc.active.lock().unwrap() = Some("default".to_string());
        svc.stop(proj, "default").unwrap();
        assert_eq!(svc.active_agent(), None, "stop nettoie le pointeur même sans session");
    }

    /// Défaut B — GARDE ANTI-RÉGRESSION : l'ARRÊT d'une session doit purger la
    /// marque d'occupation `busy` du couple (projet, agent) dans la map
    /// d'anomalie. Sans cette purge, une session arrêtée (volontairement ou
    /// automatiquement) reste comptée « travailleuse » (busy=true avec un
    /// `lastActivity` récent car un arrêt volontaire n'émet PAS de
    /// `process_exit`) : la garde d'exclusivité met alors la demande suivante
    /// EN FILE au lieu de la démarrer et le faux verrou « Une run est déjà en
    /// cours sur ce projet » ne se libère jamais.
    /// Ce test ÉCHOUE sur le code d'avant correctif (busy retenu) et PASSE
    /// après.
    #[test]
    fn stop_clears_anomaly_busy_for_couple() {
        let svc = AgentService::new();
        let proj = "/p/A";
        let agent = "codeur";
        let anomaly_map: Arc<Mutex<HashMap<String, anomaly::AgentAnomalyState>>> =
            Arc::new(Mutex::new(HashMap::new()));
        // État posé par un `agent_start` jamais suivi d'`agent_settled` : le
        // couple est « busy » avec une activité toute récente au moment de
        // l'arrêt (cas exact du défaut B).
        {
            let mut m = anomaly_map.lock().unwrap();
            m.insert(
                format!("{}\u{1f}{}", proj, agent),
                anomaly::AgentAnomalyState {
                    last_activity: Instant::now(),
                    last_progress: Instant::now(),
                    last_activity_wall: Some(std::time::SystemTime::now()),
                    last_event: "agent_start".to_string(),
                    busy: true,
                    blocked_reported: false,
                    auto_stopped_reported: false,
                    awaiting_user: false,
                    tool_in_progress: true,
                    tool_started_at: Some(Instant::now()),
                    produced_output: false,
                },
            );
        }
        // Le service partage la map (comme au setup réel).
        svc.set_anomaly_map(anomaly_map.clone());
        svc.stop(proj, agent).unwrap();
        // Après arrêt : plus « busy » → la session n'est plus exclusive, donc
        // plus aucune demande n'est mise en file pour cette raison.
        {
            let m = anomaly_map.lock().unwrap();
            let e = m
                .get(&format!("{}\u{1f}{}", proj, agent))
                .expect("entrée d'anomalie conservée (mise à zéro, pas suppression)");
            assert!(!e.busy, "après arrêt, le couple ne doit plus être « busy »");
            assert!(!e.tool_in_progress, "plus d'outil en cours après arrêt");
            assert!(
                e.tool_started_at.is_none(),
                "plus d'instant de départ d'outil après arrêt (la borne dure de\n                 60 min ne doit jamais repartir d'un start mort)"
            );
            assert!(!e.awaiting_user, "plus d'attente utilisateur après arrêt");
            assert!(!e.auto_stopped_reported, "marqueur d'arrêt auto réarmé");
        }
        // Contre-épreuve : un couple DIFFÉRENT n'est pas touché.
        {
            let mut m = anomaly_map.lock().unwrap();
            m.insert(
                format!("{}\u{1f}{}", proj, "reviewer"),
                anomaly::AgentAnomalyState {
                    last_activity: Instant::now(),
                    last_progress: Instant::now(),
                    last_activity_wall: Some(std::time::SystemTime::now()),
                    last_event: "agent_start".to_string(),
                    busy: true,
                    blocked_reported: false,
                    auto_stopped_reported: false,
                    awaiting_user: false,
                    tool_in_progress: true,
                    tool_started_at: Some(Instant::now()),
                    produced_output: false,
                },
            );
        }
        svc.stop(proj, agent).unwrap();
        let m = anomaly_map.lock().unwrap();
        assert!(
            m.get(&format!("{}\u{1f}{}", proj, "reviewer")).unwrap().busy,
            "la purge cible le couple arrêté, pas les autres agents"
        );
    }

    /// Réserve R2 (lot C2) — helpers de test : pose une session parkée + une
    /// entrée d'anomalie `busy=true` pour un couple (projet, agent), afin de
    /// vérifier que CHAQUE chemin d'arrêt remet la marque d'occupation à zéro.
    fn seed_busy_couple(svc: &AgentService, proj: &str, agent: &str, mode: SpawnMode) {
        {
            let mut sessions = svc.sessions.lock().unwrap();
            sessions.insert(
                AgentService::session_key(proj, agent),
                SessionEntry {
                    session: fake_session(),
                    project: proj.to_string(),
                    state: SessionState::Parked,
                    mode,
                },
            );
        }
        let map = svc
            .anomaly_map
            .lock()
            .unwrap()
            .clone()
            .expect("map d'anomalie partagée (set_anomaly_map)");
        map.lock().unwrap().insert(
            AgentService::session_key(proj, agent),
            anomaly::AgentAnomalyState {
                last_activity: Instant::now(),
                last_progress: Instant::now(),
                last_activity_wall: Some(std::time::SystemTime::now()),
                last_event: "agent_start".to_string(),
                busy: true,
                blocked_reported: false,
                auto_stopped_reported: false,
                awaiting_user: false,
                tool_in_progress: true,
                tool_started_at: Some(Instant::now()),
                produced_output: false,
            },
        );
    }

    /// Réserve R2 (lot C2) : lit la marque d'occupation d'un couple.
    fn is_couple_busy(svc: &AgentService, proj: &str, agent: &str) -> bool {
        let map = svc
            .anomaly_map
            .lock()
            .unwrap()
            .clone()
            .expect("map d'anomalie partagée (set_anomaly_map)");
        let m = map.lock().unwrap();
        m.get(&AgentService::session_key(proj, agent))
            .map(|e| e.busy)
            .unwrap_or(false)
    }

    /// Réserve R2 (lot C2) — GARDE ANTI-RÉGRESSION : `stop_project_sessions`
    /// (fermeture/switch de projet) doit purger la marque d'occupation des
    /// couples arrêtés, et SEULEMENT de ceux-ci. Avant ce correctif, l'arrêt des
    /// sessions d'un projet laissait `busy=true` : au retour sur le projet,
    /// l'agent redémarré était compté « déjà actif » et sa demande mise en file
    /// sans jamais démarrer.
    /// Ce test ÉCHOUE sur le code d'avant correctif et PASSE après.
    #[test]
    fn stop_project_sessions_clears_anomaly_busy() {
        let svc = AgentService::new();
        svc.set_anomaly_map(Arc::new(Mutex::new(HashMap::new())));
        seed_busy_couple(&svc, "/p/A", "codeur", SpawnMode::AgentProcess);
        seed_busy_couple(&svc, "/p/A", "default", SpawnMode::MainSession);
        seed_busy_couple(&svc, "/p/B", "reviewer", SpawnMode::AgentProcess);

        svc.stop_project_sessions("/p/A");

        assert!(!is_couple_busy(&svc, "/p/A", "codeur"), "couple du projet fermé purgé");
        assert!(!is_couple_busy(&svc, "/p/A", "default"), "toutes les sessions du projet purgées");
        assert!(is_couple_busy(&svc, "/p/B", "reviewer"), "purge scopée : autre projet intact");
    }

    /// Réserve R2 (lot C2) — GARDE ANTI-RÉGRESSION : `stop_all_agent_processes`
    /// (arrêt des processus d'agents, l'app continue) doit purger la marque des
    /// processus `AgentProcess` arrêtés, sans toucher aux autres modes.
    /// Ce test ÉCHOUE sur le code d'avant correctif et PASSE après.
    #[test]
    fn stop_all_agent_processes_clears_anomaly_busy() {
        let svc = AgentService::new();
        svc.set_anomaly_map(Arc::new(Mutex::new(HashMap::new())));
        seed_busy_couple(&svc, "/p/A", "codeur", SpawnMode::AgentProcess);
        seed_busy_couple(&svc, "/p/A", "default", SpawnMode::MainSession);

        svc.stop_all_agent_processes();

        assert!(!is_couple_busy(&svc, "/p/A", "codeur"), "processus AgentProcess purgé");
        assert!(is_couple_busy(&svc, "/p/A", "default"), "autre mode non arrêté → marque conservée");
    }

    /// Réserve R2 (lot C2) — GARDE ANTI-RÉGRESSION : `shutdown_all` (arrêt
    /// complet, réutilisé par la mise à jour de pi SANS quitter l'app) doit
    /// purger la marque de TOUS les couples arrêtés. Après une mise à jour de
    /// pi, les sessions redémarrent et doivent repartir d'un état non occupé.
    /// Ce test ÉCHOUE sur le code d'avant correctif et PASSE après.
    #[test]
    fn shutdown_all_clears_anomaly_busy() {
        let svc = AgentService::new();
        svc.set_anomaly_map(Arc::new(Mutex::new(HashMap::new())));
        seed_busy_couple(&svc, "/p/A", "codeur", SpawnMode::AgentProcess);
        seed_busy_couple(&svc, "/p/B", "reviewer", SpawnMode::MainSession);

        svc.shutdown_all();

        assert!(!is_couple_busy(&svc, "/p/A", "codeur"), "arrêt complet : couple A purgé");
        assert!(!is_couple_busy(&svc, "/p/B", "reviewer"), "arrêt complet : couple B purgé");
    }

    /// Anti-boucle de redémarrage du super-agent (bug onglet Assistant) : une
    /// mort rapide après le démarrage est un CRASH qui incrémente le compteur ;
    /// au-delà du seuil, le redémarrage est BLOQUÉ (cooldown). Une mort tardive
    /// réinitialise le compteur. Vérifie le comportement en temps simulé.
    #[test]
    fn superagent_crash_policy_blocks_after_repeated_crashes() {
        let t0 = Instant::now();
        let mut policy = SuperAgentCrashPolicy {
            crash_count: 0,
            blocked_until: None,
        };
        // Crash 1 : mort 2 s après démarrage → crash_count = 1, pas de blocage.
        policy.record_death(Some(t0), t0 + Duration::from_secs(2));
        assert_eq!(policy.crash_count, 1);
        assert!(policy.blocked_remaining(t0 + Duration::from_secs(2)).is_none());

        // Crash 2 : redémarrage à t+5, mort à t+7 → crash_count = 2.
        let t1 = t0 + Duration::from_secs(5);
        policy.record_death(Some(t1), t1 + Duration::from_secs(2));
        assert_eq!(policy.crash_count, 2);

        // Crash 3 : redémarrage à t+10, mort à t+12 → dépasse le seuil → blocage.
        let t2 = t0 + Duration::from_secs(10);
        policy.record_death(Some(t2), t2 + Duration::from_secs(2));
        assert_eq!(policy.crash_count, 0, "compteur remis à zéro après blocage");
        assert!(
            policy.blocked_remaining(t2 + Duration::from_secs(2)).is_some(),
            "redémarrage bloqué après {} crashs rapides consécutifs",
            SUPERAGENT_MAX_CRASHES
        );

        // Cooldown expiré (≥ SUPERAGENT_RESTART_COOLDOWN après le crash) → levé.
        // blocked_until = temps du crash (t2+2s) + cooldown → t_after > t2+2s+cooldown.
        let t_after = t2 + Duration::from_secs(2) + SUPERAGENT_RESTART_COOLDOWN + Duration::from_secs(1);
        assert!(
            policy.blocked_remaining(t_after).is_none(),
            "blocage levé après le cooldown"
        );
    }

    /// Une mort TARDIVE (hors fenêtre de crash) après un démarrage n'est pas un
    /// crash : elle réinitialise le compteur, donc ne bloque jamais le
    /// redémarrage (arrêt propre / volontaire).
    #[test]
    fn superagent_crash_policy_late_death_resets_counter() {
        let t0 = Instant::now();
        let mut policy = SuperAgentCrashPolicy {
            crash_count: 2,
            blocked_until: None,
        };
        // Démarrage à t0, mort 60 s plus tard (largement hors fenêtre de crash).
        policy.record_death(Some(t0), t0 + Duration::from_secs(60));
        assert_eq!(policy.crash_count, 0, "mort tardive → compteur réinitialisé");
        assert!(
            policy.blocked_remaining(t0 + Duration::from_secs(60)).is_none(),
            "aucun blocage pour une mort tardive"
        );
    }

    /// Mort sans démarrage connu (None) : pas un crash (aucune boucle possible)
    /// → compteur réinitialisé, jamais de blocage.
    #[test]
    fn superagent_crash_policy_no_last_start_resets_counter() {
        let now = Instant::now();
        let mut policy = SuperAgentCrashPolicy {
            crash_count: 2,
            blocked_until: None,
        };
        policy.record_death(None, now);
        assert_eq!(policy.crash_count, 0, "mort sans démarrage connu → compteur remis à zéro");
        assert!(policy.blocked_remaining(now).is_none());
    }

    /// Construit une entrée d'anomalie « agent en cours de tâche » (busy=true)
    /// pour la clé composite `project\u{1f}agent`.
    fn busy_anomaly_entry() -> anomaly::AgentAnomalyState {
        anomaly::AgentAnomalyState {
            last_activity: Instant::now(),
            last_progress: Instant::now(),
            last_activity_wall: Some(std::time::SystemTime::now()),
            last_event: "agent_start".to_string(),
            busy: true,
            blocked_reported: false,
            auto_stopped_reported: false,
            awaiting_user: false,
            tool_in_progress: false,
            tool_started_at: None,
            produced_output: false,
        }
    }

    /// Issue #87 : état d'exécution FANTÔME purgé. Une ligne `agents` restée
    /// `proc_state='Running'` (busy déjà retombé à 0) alors qu'AUCUN processus
    /// n'est vivant porte le verrou d'exécution du projet : elle doit être
    /// remise à un état sain (`Unloaded`, loaded=0, busy=0), sa session morte
    /// retirée du registre et sa marque `busy` (map d'anomalie, verrou moteur)
    /// libérée — sans redémarrer Pilot. Une exécution RÉELLEMENT vivante (même
    /// projet, même état persisté) ne doit JAMAIS être touchée.
    #[test]
    fn purge_ghost_running_states_resets_orphan_rows_and_keeps_live_ones() {
        let svc = AgentService::new();
        let proj = "/p/ghost";
        let conn = rusqlite::Connection::open_in_memory().expect("base en mémoire");
        db::init_db(&conn).expect("schéma pilot.db");
        // Deux agents du même projet, tous deux persistés « Running » :
        //  - `fantome` : aucun processus vivant (le cas de l'issue #87) ;
        //  - `vivant`  : session parkée dont le processus est VIVANT.
        for (id, busy) in [("fantome", 0), ("vivant", 1)] {
            conn.execute(
                "INSERT INTO agents (id, project_path, name, role, proc_state, loaded, busy)
                 VALUES (?1, ?2, ?1, 'coder', 'Running', 1, ?3)",
                params![id, proj, busy],
            )
            .expect("insert agent");
        }
        // Session morte laissée dans le registre (le process pi est mort sans
        // événement de fin) + session vivante.
        {
            let mut sessions = svc.sessions.lock().unwrap();
            let dead = fake_session();
            // kill() : le processus enfant meurt → try_wait() renvoie Some.
            sessions.insert(
                AgentService::session_key(proj, "fantome"),
                SessionEntry {
                    session: dead,
                    project: proj.to_string(),
                    state: SessionState::Active,
                    mode: SpawnMode::AgentProcess,
                },
            );
            sessions.insert(
                AgentService::session_key(proj, "vivant"),
                SessionEntry {
                    session: fake_session(),
                    project: proj.to_string(),
                    state: SessionState::Parked,
                    mode: SpawnMode::AgentProcess,
                },
            );
            let _ = sessions
                .get_mut(&AgentService::session_key(proj, "fantome"))
                .unwrap()
                .session
                .child
                .kill();
        }
        std::thread::sleep(std::time::Duration::from_millis(150));
        // Marque busy résiduelle sur le fantôme (verrou moteur) et sur le vivant.
        let anomaly_map: Arc<Mutex<HashMap<String, anomaly::AgentAnomalyState>>> =
            Arc::new(Mutex::new(HashMap::new()));
        {
            let mut m = anomaly_map.lock().unwrap();
            m.insert(format!("{}\u{1f}{}", proj, "fantome"), busy_anomaly_entry());
            m.insert(format!("{}\u{1f}{}", proj, "vivant"), busy_anomaly_entry());
        }
        // Purge : seul le fantôme est détecté (proc_state Running sans process).
        let purged = svc
            .purge_ghost_running_states(&conn, &anomaly_map)
            .expect("purge");
        assert_eq!(
            purged,
            vec![(proj.to_string(), "fantome".to_string())],
            "un seul fantôme purgé"
        );
        // État remis à sain : verrou du projet libéré.
        let (loaded, busy, state): (i64, i64, String) = conn
            .query_row(
                "SELECT loaded, busy, proc_state FROM agents WHERE id = 'fantome'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .expect("ligne fantome");
        assert_eq!((loaded, busy, state.as_str()), (0, 0, "Unloaded"));
        // Marque busy de la map d'anomalie (verrou d'exclusivité moteur) libérée.
        assert!(
            !anomaly_map
                .lock()
                .unwrap()
                .get(&format!("{}\u{1f}{}", proj, "fantome"))
                .expect("entrée fantome")
                .busy,
            "verrou d'exclusivité libéré pour le fantôme"
        );
        // Session morte retirée du registre (plus de créneau fantôme listé).
        assert!(
            !svc.sessions
                .lock()
                .unwrap()
                .contains_key(&AgentService::session_key(proj, "fantome")),
            "session morte retirée du registre"
        );
        // Le vivant est INTACT : exécution légitime, jamais touchée.
        let (l_loaded, l_busy, l_state): (i64, i64, String) = conn
            .query_row(
                "SELECT loaded, busy, proc_state FROM agents WHERE id = 'vivant'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .expect("ligne vivant");
        assert_eq!((l_loaded, l_busy, l_state.as_str()), (1, 1, "Running"));
        assert!(svc.agent_alive(proj, "vivant"), "session vivante conservée");
        assert!(
            anomaly_map
                .lock()
                .unwrap()
                .get(&format!("{}\u{1f}{}", proj, "vivant"))
                .expect("entrée vivant")
                .busy,
            "verrou conservé pour l'agent qui travaille"
        );
        // Idempotence : une seconde purge ne fait plus rien.
        assert!(
            svc.purge_ghost_running_states(&conn, &anomaly_map)
                .expect("purge 2")
                .is_empty(),
            "plus rien à purger"
        );
    }

    /// Issue #87 : un agent GLOBAL (`project_path` NULL) resté « Running » sans
    /// processus vivant est un fantôme comme un autre — il est purgé sous la clé
    /// réservée `ASSISTANT_SPACE` ; les états non « en cours »
    /// (Paused/Stopped/Unloaded) restent, eux, hors périmètre.
    #[test]
    fn purge_ghost_running_states_handles_global_rows_and_ignores_non_running() {
        let svc = AgentService::new();
        let conn = rusqlite::Connection::open_in_memory().expect("base en mémoire");
        db::init_db(&conn).expect("schéma pilot.db");
        conn.execute(
            "INSERT INTO agents (id, project_path, name, role, proc_state, loaded, busy)
             VALUES ('assistant-global', NULL, 'Assistant', 'assistant', 'Running', 1, 0)",
            [],
        )
        .expect("insert global");
        conn.execute(
            "INSERT INTO agents (id, project_path, name, role, proc_state, loaded, busy)
             VALUES ('pause', '/p/A', 'Pause', 'coder', 'Paused', 1, 0)",
            [],
        )
        .expect("insert pause");
        let anomaly_map: Arc<Mutex<HashMap<String, anomaly::AgentAnomalyState>>> =
            Arc::new(Mutex::new(HashMap::new()));
        {
            let mut m = anomaly_map.lock().unwrap();
            m.insert(
                format!("{}\u{1f}assistant-global", ASSISTANT_SPACE),
                busy_anomaly_entry(),
            );
        }
        let purged = svc
            .purge_ghost_running_states(&conn, &anomaly_map)
            .expect("purge");
        assert_eq!(
            purged,
            vec![(ASSISTANT_SPACE.to_string(), "assistant-global".to_string())],
            "le fantôme global est purgé sous la clé ASSISTANT_SPACE"
        );
        let (loaded, busy, state): (i64, i64, String) = conn
            .query_row(
                "SELECT loaded, busy, proc_state FROM agents WHERE id = 'assistant-global'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .expect("ligne assistant-global");
        assert_eq!((loaded, busy, state.as_str()), (0, 0, "Unloaded"));
        assert!(
            !anomaly_map
                .lock()
                .unwrap()
                .get(&format!("{}\u{1f}assistant-global", ASSISTANT_SPACE))
                .expect("entrée anomalie globale")
                .busy,
            "verrou d'exclusivité global libéré"
        );
        // État non « en cours » : jamais touché.
        let p_state: String = conn
            .query_row(
                "SELECT proc_state FROM agents WHERE id = 'pause'",
                [],
                |r| r.get(0),
            )
            .expect("ligne pause");
        assert_eq!(p_state, "Paused", "état Paused hors périmètre");
    }

    /// Issue #87 (défaut résiduel n°1) : l'arrêt d'un agent GLOBAL doit aboutir
    /// à un état final sain (`Stopped`, loaded=0, busy=0). Auparavant la ligne
    /// restait `Running`/`loaded=1` après l'arrêt (seule la purge périodique
    /// rattrapait l'incohérence, avec un délai). Une ligne de PROJET portant le
    /// même id ne doit jamais être touchée par cette remise à zéro globale.
    #[test]
    fn reset_global_agent_state_stops_only_null_project_rows() {
        let svc = AgentService::new();
        let conn = rusqlite::Connection::open_in_memory().expect("base en mémoire");
        db::init_db(&conn).expect("schéma pilot.db");
        conn.execute(
            "INSERT INTO agents (id, project_path, name, role, proc_state, loaded, busy)
             VALUES ('global-1', NULL, 'Global', 'assistant', 'Running', 1, 0)",
            [],
        )
        .expect("insert global");
        conn.execute(
            "INSERT INTO agents (id, project_path, name, role, proc_state, loaded, busy)
             VALUES ('global-1', '/p/A', 'Projet', 'coder', 'Running', 1, 0)",
            [],
        )
        .expect("insert projet");
        let changed = svc
            .reset_global_agent_state(&conn, "global-1")
            .expect("reset global");
        assert_eq!(changed, 1, "seule la ligne globale est remise à zéro");
        let (loaded, busy, state): (i64, i64, String) = conn
            .query_row(
                "SELECT loaded, busy, proc_state FROM agents
                 WHERE id = 'global-1' AND project_path IS NULL",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .expect("ligne globale");
        assert_eq!((loaded, busy, state.as_str()), (0, 0, "Stopped"));
        // La ligne de projet du même id reste intacte (son arrêt passe par `stop`).
        let p_state: String = conn
            .query_row(
                "SELECT proc_state FROM agents WHERE id = 'global-1' AND project_path = '/p/A'",
                [],
                |r| r.get(0),
            )
            .expect("ligne projet");
        assert_eq!(p_state, "Running", "la ligne de projet n'est pas touchée");
        // Tolérance : un agent sans ligne persistée ne fait pas échouer l'arrêt.
        assert_eq!(
            svc.reset_global_agent_state(&conn, "inconnu")
                .expect("reset inconnu"),
            0
        );
    }

    /// L'outil `laya_classify` doit être écrit AVEC son cœur dans le dossier
    /// d'extensions, pour que les agents le reçoivent en `--extension`
    /// (défaut : les agents lancés par l'assistant ne l'avaient pas).
    #[test]
    fn write_laya_extension_ecrit_extension_et_coeur() {
        let dir = crate::test_util::TempDir::new("pilot-laya-ext");

        let ext = AgentService::write_laya_extension(&dir).expect("extension Laya écrite");
        assert!(ext.ends_with("pilot-laya.ts"), "chemin attendu : {ext}");
        assert!(
            std::fs::read_to_string(&ext).expect("extension lisible").contains("laya_classify")
        );
        assert!(
            std::fs::read_to_string(dir.join("laya-gateway.js"))
                .expect("cœur lisible")
                .contains("askLaya")
        );
    }
}
