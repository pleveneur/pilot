//! Service Laya — Pilot démarre et surveille le service de classification local
//! (`laya-service.mjs`, HTTP `127.0.0.1:3017`) **une seule fois pour toute
//! l'application**, et l'arrête s'il l'a lancé lui-même.
//!
//! Pourquoi un service unique : le modèle (≈ 1,6 Gio une fois chargé) doit être
//! gardé en mémoire **entre** les appels. Un processus par session d'agent
//! coûterait 1,6 Gio par session — d'où un seul service, lancé au démarrage.
//!
//! Ce module ne classe rien : il ne fait que **piloter le service** (patron
//! `plface.rs`, adapté aux différences réelles du service Laya) :
//! - **configuration** : chemin du fichier `laya-service.mjs` + dossier du
//!   modèle (réglages `laya_autostart_enabled`, `laya_service_path`,
//!   `laya_model_dir`) ; rien de configuré, chemin inexistant ou ressemblant à
//!   une URL → **aucun lancement, aucune erreur, aucun message** ;
//! - **lancement** : détaché (`node <service> <dossier-modèle>`), sans console
//!   sous Windows, jamais bloquant pour l'interface ; un service qui répond
//!   déjà (lancé à la main par le propriétaire) n'est **jamais** doublé ;
//! - **attente** : au plus 3 s après le lancement, on sait si le service répond ;
//! - **arrêt** : uniquement le processus tracé (`laya.pid`) — donc uniquement
//!   celui que Pilot a lancé ;
//! - **trace** : `<app_data_dir>/laya.pid` (identifiant + nom de programme).
//!
//! Limites assumées : le nom de programme tracé est celui de l'interpréteur
//! (`node.exe`), pas du script — la garde de nom seule ne distingue donc pas
//! deux processus `node` ; c'est le couple trace/pid qui garantit qu'on ne
//! referme pas le service du propriétaire (lancé à la main, jamais tracé).

use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;

/// Hôte du service Laya (boucle locale uniquement).
pub(crate) const LAYA_API_HOST: &str = "127.0.0.1";
/// Port du service Laya.
pub(crate) const LAYA_API_PORT: u16 = 3017;
/// Fichier de trace du service lancé par Pilot (dossier de données de l'app).
pub(crate) const PID_FILE_NAME: &str = "laya.pid";
/// Timeout de sonde réseau : strictement inférieur à 1 seconde.
pub(crate) const PROBE_TIMEOUT: Duration = Duration::from_millis(400);
/// Délai maximal accordé au service pour répondre après le lancement.
pub(crate) const READY_DEADLINE: Duration = Duration::from_secs(3);
/// Intervalle entre deux sondes pendant l'attente.
const PROBE_INTERVAL: Duration = Duration::from_millis(200);
/// Route d'état du service (`{"ready":bool,"model":...}`).
const STATUS_ROUTE: &str = "/status";

/// Résultat d'une sonde : le service répond-il, et a-t-il chargé son modèle ?
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LayaProbe {
    /// Une réponse HTTP a été reçue sur `/status`.
    pub reachable: bool,
    /// Le service a chargé le modèle (`"ready":true`).
    pub ready: bool,
}

impl LayaProbe {
    const DOWN: LayaProbe = LayaProbe {
        reachable: false,
        ready: false,
    };
}

/// Issue d'un contrôle de lancement (état lisible, renvoyé à l'interface).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum LayaOutcome {
    /// Rien de configuré (ou désactivé) : aucun lancement, en silence.
    Disabled,
    /// Chemin refusé : URL déguisée, fichier de service ou dossier de modèle absent.
    InvalidPath,
    /// Un service répond déjà : Pilot n'en lance pas un second.
    AlreadyRunning,
    /// Lancé et joignable dans le délai imparti.
    Launched,
    /// Lancé mais muet au bout du délai (il chargera peut-être plus tard).
    LaunchedNotReady,
    /// Le lancement a échoué (erreur système) : silence.
    LaunchFailed,
}

/// Décision PURE de lancement, séparée des entrées/sorties pour être testable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LayaDecision {
    Disabled,
    InvalidPath,
    AlreadyRunning,
    Launch,
}

/// Vrai si la chaîne ressemble à une URL (`http://…`, `https://…`, `hf://…`) :
/// ces chemins sont refusés (le service les refuse aussi, pour ne jamais
/// déclencher de téléchargement réseau). PURE.
pub(crate) fn looks_like_url(path: &str) -> bool {
    let lower = path.trim().to_ascii_lowercase();
    let Some((scheme, _)) = lower.split_once("://") else {
        return false;
    };
    !scheme.is_empty()
        && scheme.starts_with(|c: char| c.is_ascii_alphabetic())
        && scheme
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '-'))
}

/// Décision PURE de lancement. Priorité des règles :
/// 1. désactivé ou chemin vide → `Disabled` (aucune sonde réseau) ;
/// 2. chemin ressemblant à une URL → `InvalidPath` ;
/// 3. service déjà joignable → `AlreadyRunning` ;
/// 4. fichier de service ou dossier de modèle absent → `InvalidPath` ;
/// 5. sinon → `Launch`.
pub(crate) fn decide_launch(
    enabled: bool,
    service_path: &str,
    service_exists: bool,
    model_ok: bool,
    api_up: bool,
) -> LayaDecision {
    let trimmed = service_path.trim();
    if !enabled || trimmed.is_empty() {
        return LayaDecision::Disabled;
    }
    if looks_like_url(trimmed) {
        return LayaDecision::InvalidPath;
    }
    if api_up {
        return LayaDecision::AlreadyRunning;
    }
    if !service_exists || !model_ok {
        return LayaDecision::InvalidPath;
    }
    LayaDecision::Launch
}

/// Vrai si la configuration du service est exploitable (réglage actif, fichier
/// de service présent, dossier de modèle présent, aucun chemin en forme d'URL).
/// PURE (les entrées sont les tests d'existence faits par l'appelant).
pub(crate) fn is_configured(
    enabled: bool,
    service_path: &str,
    service_is_file: bool,
    model_is_dir: bool,
) -> bool {
    if !enabled {
        return false;
    }
    let trimmed = service_path.trim();
    !trimmed.is_empty()
        && !looks_like_url(trimmed)
        && service_is_file
        && model_is_dir
}

/// Vrai si le corps de `/status` annonce un modèle chargé. PURE. Tolère les
/// espaces (`"ready": true`), le service écrit `{"ready":false,…}`.
pub(crate) fn status_ready(body: &str) -> bool {
    body.chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .contains("\"ready\":true")
}

/// Nom du programme interpréteur tel qu'il apparaît dans la table des
/// processus : c'est lui qui est tracé pour pouvoir refermer le service.
fn node_process_name() -> &'static str {
    if cfg!(windows) {
        "node.exe"
    } else {
        "node"
    }
}

/// Sonde `/status` du service (HTTP/1.1, timeout court) : `reachable` dès qu'une
/// réponse HTTP est reçue, `ready` si le corps annonce le modèle chargé. Toute
/// erreur réseau = muet (jamais bloquant au-delà du timeout).
pub(crate) fn probe_status(host: &str, port: u16, timeout: Duration) -> LayaProbe {
    use std::io::{Read, Write};
    use std::net::{TcpStream, ToSocketAddrs};

    // `host` est une IP littérale : pas de résolution DNS bloquante.
    let Ok(mut addrs) = (host, port).to_socket_addrs() else {
        return LayaProbe::DOWN;
    };
    let Some(addr) = addrs.next() else {
        return LayaProbe::DOWN;
    };
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, timeout) else {
        return LayaProbe::DOWN;
    };
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));

    let request = format!(
        "GET {STATUS_ROUTE} HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return LayaProbe::DOWN;
    }

    // Le service garde la connexion ouverte : on s'arrête dès que le corps JSON
    // est complet (accolade fermante) au lieu d'attendre la fermeture.
    let mut raw: Vec<u8> = Vec::new();
    loop {
        let mut buf = [0u8; 256];
        match stream.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                raw.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&raw);
                if let Some(head) = text.find("\r\n\r\n") {
                    if text[head + 4..].contains('}') {
                        break;
                    }
                }
                if raw.len() > 4096 {
                    break;
                }
            }
        }
    }

    let text = String::from_utf8_lossy(&raw);
    if !text.starts_with("HTTP/") {
        return LayaProbe::DOWN;
    }
    let Some(head) = text.find("\r\n\r\n") else {
        return LayaProbe::DOWN;
    };
    LayaProbe {
        reachable: true,
        ready: status_ready(&text[head + 4..]),
    }
}

/// Sonde l'état courant du service (timeout court).
pub(crate) fn probe() -> LayaProbe {
    probe_status(LAYA_API_HOST, LAYA_API_PORT, PROBE_TIMEOUT)
}

/// Attend que le service réponde, sans jamais dépasser `deadline`. Renvoie le
/// dernier état observé (muet au bout du délai si rien ne répond).
pub(crate) fn wait_until_reachable(deadline: Duration, interval: Duration) -> LayaProbe {
    let started = Instant::now();
    loop {
        let probe = probe();
        if probe.reachable || started.elapsed() >= deadline {
            return probe;
        }
        std::thread::sleep(interval);
    }
}

/// Dernière issue connue du contrôle de lancement (renseignée par le contrôle
/// de démarrage, dans son thread : c'est ce qui permet à Pilot de « savoir » au
/// bout de 3 s au plus, sans bloquer l'ouverture).
static LAST_OUTCOME: Mutex<Option<LayaOutcome>> = Mutex::new(None);

/// Mémorise la dernière issue connue (fail-open : un verrou empoisonné est ignoré).
pub(crate) fn set_outcome(outcome: LayaOutcome) {
    if let Ok(mut slot) = LAST_OUTCOME.lock() {
        *slot = Some(outcome);
    }
}

/// Dernière issue connue (`None` tant que le contrôle de démarrage n'a pas fini).
pub(crate) fn last_outcome() -> Option<LayaOutcome> {
    LAST_OUTCOME.lock().ok().and_then(|slot| *slot)
}

/// Lance le service en tâche de fond, détaché de Pilot :
/// `node <service_path> <model_dir>`, sans fenêtre de console sous Windows,
/// stdio redirigé vers `null`. Le répertoire courant est celui du service (le
/// dossier de modèle configuré peut ainsi être relatif, comme à la main).
/// Renvoie l'identifiant du processus lancé, pour la trace.
pub(crate) fn spawn_detached(service_path: &str, model_dir: &str) -> std::io::Result<u32> {
    let mut cmd = Command::new("node");
    cmd.arg(service_path).arg(model_dir);
    if let Some(dir) = Path::new(service_path).parent() {
        cmd.current_dir(dir);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(crate::CREATE_NO_WINDOW);
    }

    // Le `Child` est abandonné (jamais `wait`), mais son identifiant est tracé
    // (`laya.pid`) : le service lancé par Pilot est refermé par Pilot.
    Ok(cmd.spawn()?.id())
}

/// Orchestrateur non pur : sonde, décide, lance, puis attend (≤ 3 s) que le
/// service réponde. Jamais bloquant au-delà du délai d'attente, jamais d'erreur
/// remontée : un utilisateur sans service Laya ne voit aucune différence.
pub(crate) fn launch_if_needed(
    enabled: bool,
    service_path: &str,
    model_dir: &str,
    pid_path: Option<&Path>,
) -> LayaOutcome {
    let trimmed = service_path.trim();

    // Court-circuit : aucune sonde réseau si la fonctionnalité est désactivée.
    if !enabled || trimmed.is_empty() {
        return LayaOutcome::Disabled;
    }

    let api_up = probe().reachable;
    let service_exists = Path::new(trimmed).is_file();
    let model_ok = Path::new(model_dir.trim()).is_dir();

    match decide_launch(enabled, trimmed, service_exists, model_ok, api_up) {
        LayaDecision::Disabled => LayaOutcome::Disabled,
        LayaDecision::InvalidPath => LayaOutcome::InvalidPath,
        LayaDecision::AlreadyRunning => LayaOutcome::AlreadyRunning,
        LayaDecision::Launch => match spawn_detached(trimmed, model_dir.trim()) {
            Ok(pid) => {
                if let Some(path) = pid_path {
                    crate::plface::write_pid_file(path, pid, node_process_name());
                }
                // Attente bornée : au plus tard à `READY_DEADLINE`, Pilot sait
                // si le service répond (l'interface, elle, n'a jamais attendu).
                if wait_until_reachable(READY_DEADLINE, PROBE_INTERVAL).reachable {
                    LayaOutcome::Launched
                } else {
                    LayaOutcome::LaunchedNotReady
                }
            }
            Err(_) => LayaOutcome::LaunchFailed,
        },
    }
}

/// Arrête **le service que Pilot a lancé**, d'après la trace disque :
/// - aucune trace → Pilot n'a rien lancé → ne touche à rien (`true`) ; un
///   service ouvert à la main par le propriétaire n'est donc jamais refermé ;
/// - trace présente → arrêt du processus (avec garde de nom : jamais une autre
///   application), trace effacée.
///
/// Appelé à la **fermeture de Pilot** et **au démarrage suivant** (nettoyage
/// d'un service resté en vie après une fermeture brutale). Jamais bloquant
/// au-delà du timeout de sonde, jamais d'erreur remontée.
pub(crate) fn stop_owned(pid_path: &Path) -> bool {
    let Some((pid, name)) = crate::plface::read_pid_file(pid_path) else {
        return true;
    };
    let stopped = crate::plface::kill_process(pid, &name);
    crate::plface::clear_pid_file(pid_path);
    stopped
}

/// État du service, tel que rendu à l'interface (commande `laya_status`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LayaStatus {
    /// Configuration exploitable (réglage actif + chemins valides).
    pub configured: bool,
    /// Le service répond sur `/status`.
    pub reachable: bool,
    /// Le service a chargé son modèle (`"ready":true`).
    pub ready: bool,
    /// Dernière issue connue du contrôle de démarrage (`null` avant la fin).
    pub outcome: Option<LayaOutcome>,
}

/// Compose l'état courant : configuration déclarée + sonde live + dernière
/// issue de démarrage. Aucune écriture, aucune modification du service.
pub(crate) fn status(enabled: bool, service_path: &str, model_dir: &str) -> LayaStatus {
    let configured = is_configured(
        enabled,
        service_path,
        Path::new(service_path.trim()).is_file(),
        Path::new(model_dir.trim()).is_dir(),
    );
    let probe = probe();
    LayaStatus {
        configured,
        reachable: probe.reachable,
        ready: probe.ready,
        outcome: last_outcome(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_like_paths_are_detected() {
        assert!(looks_like_url("http://127.0.0.1/x"));
        assert!(looks_like_url("https://huggingface.co/x"));
        assert!(looks_like_url("  hf://org/model  "));
        assert!(!looks_like_url("G:\\IA_PL\\LayaPL\\laya-service.mjs"));
        assert!(!looks_like_url("./model-ml"));
        assert!(!looks_like_url("C:\\a\\b:\\c"));
        assert!(!looks_like_url(""));
    }

    #[test]
    fn decide_refuses_url_and_missing_paths() {
        // URL déguisée : refus, même si le service répond déjà.
        assert_eq!(
            decide_launch(true, "https://exemple.test/svc.mjs", true, true, true),
            LayaDecision::InvalidPath
        );
        // Chemins absents : aucun lancement.
        assert_eq!(
            decide_launch(true, "G:\\absent\\laya-service.mjs", false, true, false),
            LayaDecision::InvalidPath
        );
        assert_eq!(
            decide_launch(true, "G:\\IA_PL\\LayaPL\\laya-service.mjs", true, false, false),
            LayaDecision::InvalidPath
        );
    }

    #[test]
    fn decide_disabled_without_configuration() {
        assert_eq!(decide_launch(false, "", false, false, false), LayaDecision::Disabled);
        assert_eq!(
            decide_launch(true, "   ", false, false, false),
            LayaDecision::Disabled
        );
    }

    #[test]
    fn decide_never_duplicates_a_running_service() {
        assert_eq!(
            decide_launch(true, "G:\\IA_PL\\LayaPL\\laya-service.mjs", true, true, true),
            LayaDecision::AlreadyRunning
        );
        assert_eq!(
            decide_launch(true, "G:\\IA_PL\\LayaPL\\laya-service.mjs", true, true, false),
            LayaDecision::Launch
        );
    }

    #[test]
    fn launch_if_needed_disabled_never_touches_network() {
        // Chemin vide + désactivé : issu immédiat, sans sonde réseau.
        assert_eq!(
            launch_if_needed(false, "", "", None),
            LayaOutcome::Disabled
        );
        assert_eq!(
            launch_if_needed(true, "  ", "G:\\IA_PL\\LayaPL\\model-ml", None),
            LayaOutcome::Disabled
        );
    }

    #[test]
    fn launch_if_needed_url_reports_invalid_path() {
        assert_eq!(
            launch_if_needed(true, "https://exemple.test/laya-service.mjs", ".", None),
            LayaOutcome::InvalidPath
        );
    }

    #[test]
    fn launch_if_needed_missing_service_never_launches() {
        let outcome = launch_if_needed(
            true,
            "/chemin/qui/n-existe-pas/laya-service.mjs",
            "/chemin/qui/n-existe-pas/model-ml",
            None,
        );
        assert!(matches!(
            outcome,
            LayaOutcome::InvalidPath | LayaOutcome::AlreadyRunning
        ));
    }

    #[test]
    fn is_configured_requires_enabled_and_valid_paths() {
        assert!(is_configured(true, "/svc/laya-service.mjs", true, true));
        assert!(!is_configured(false, "/svc/laya-service.mjs", true, true));
        assert!(!is_configured(true, "", true, true));
        assert!(!is_configured(true, "https://x/y.mjs", true, true));
        assert!(!is_configured(true, "/svc/laya-service.mjs", false, true));
        assert!(!is_configured(true, "/svc/laya-service.mjs", true, false));
    }

    #[test]
    fn status_body_detects_loaded_model() {
        // Sortie réelle du service (`JSON.stringify({ready:…,model:dir})`).
        assert!(status_ready("{\"ready\":true,\"model\":\"./model-ml\"}"));
        assert!(status_ready("{\"ready\": true, \"model\":\"./model-ml\"}"));
        assert!(!status_ready("{\"ready\":false,\"model\":\"./model-ml\"}"));
        assert!(!status_ready(""));
    }

    #[test]
    fn status_reports_unconfigured_without_touching_service() {
        // Rien de configuré : `configured=false` (la sonde, elle, ne fait que
        // lire — service absent sur la machine de test).
        let st = status(false, "", "");
        assert!(!st.configured);
    }

    #[test]
    fn absent_configuration_defaults_to_disabled() {
        // Configuration absente (ancien config.json) : service désactivé, aucun
        // chemin — donc aucun lancement, en silence.
        let cfg: crate::AppConfig = serde_json::from_str("{}").expect("config par défaut");
        assert!(!cfg.laya_autostart_enabled);
        assert!(cfg.laya_service_path.is_empty());
        assert!(cfg.laya_model_dir.is_empty());
        assert!(!is_configured(
            cfg.laya_autostart_enabled,
            &cfg.laya_service_path,
            false,
            false
        ));
    }

    #[test]
    fn pid_file_round_trip_uses_node_process_name() {
        let path = std::env::temp_dir().join(format!(
            "pilot-laya-test-{}-round-trip.pid",
            std::process::id()
        ));
        crate::plface::clear_pid_file(&path);
        crate::plface::write_pid_file(&path, 4242, node_process_name());
        assert_eq!(
            crate::plface::read_pid_file(&path),
            Some((4242, node_process_name().to_string()))
        );
        crate::plface::clear_pid_file(&path);
        assert_eq!(crate::plface::read_pid_file(&path), None);
    }

    #[test]
    fn stop_owned_does_nothing_without_trace() {
        // Aucune trace = aucun service lancé par Pilot : le service du
        // propriétaire (lancé à la main) n'est jamais refermé.
        let path = std::env::temp_dir().join(format!(
            "pilot-laya-test-{}-absent.pid",
            std::process::id()
        ));
        crate::plface::clear_pid_file(&path);
        assert!(stop_owned(&path));
    }
}
