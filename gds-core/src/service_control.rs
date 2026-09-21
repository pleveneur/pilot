//! service_control.rs — cycle de vie du SERVICE GDS depuis l'écran
//! d'administration (refonte GDS, micro-tâche L2.10).
//!
//! Décision figée (plan §L2.10, spec cible décision « contrôle du serveur ») :
//! « le serveur » désigne le **service**, pas le conteneur. Les deux routes
//! `POST /api/gds/admin/service/restart` et `POST /api/gds/admin/service/stop`
//! pilotent donc le **superviseur interne** du conteneur (`supervisord`) pour
//! relancer ou arrêter les deux processus qui le composent côté accès :
//!
//! * `gds-server` — l'API HTTP `/api/gds/*` ;
//! * `sshd` — l'accès aux dépôts git par clef (port 2222).
//!
//! PostgreSQL **n'est jamais touché** : la base reste vivante (le poste parle en
//! direct à elle, décision 11) et un redémarrage du service ne coupe donc ni les
//! données ni les synchronisations de suivi. L'arrêt du **conteneur** entier
//! reste une commande documentée à taper sur le poste (`docker compose stop`) :
//! l'exiger depuis l'intérieur obligerait à monter le socket du moteur Docker,
//! risque de sécurité explicitement écarté.
//!
//! Deux conséquences de méthode, qui expliquent la forme du code :
//!
//! 1. **Aucun socket Docker.** Le seul chemin de contrôle est le socket Unix du
//!    superviseur (`/run/supervisor.sock`, 0700, déjà déclaré dans
//!    `gds-server/supervisord.conf`) : le service s'adresse au superviseur par
//!    `supervisorctl` (`[supervisorctl] serverurl=unix:///run/supervisor.sock`).
//! 2. **Une action différée.** Un service ne peut pas se redémarrer lui-même
//!    « en direct » : s'il exécutait l'ordre avant de répondre, le client
//!    n'aurait jamais sa réponse. La route **vérifie d'abord** que le
//!    superviseur répond (`status`, lecture seule), puis **programme** l'ordre
//!    dans un processus détaché qui attend un court délai et l'exécute. La
//!    réponse HTTP part donc toujours avant l'arrêt du service.
//!
//! Le module ne dépend ni de Tauri ni d'une base : il est compilé par
//! `gds-server` et testable sans conteneur (analyse de `supervisorctl status`,
//! construction de la ligne de commande). Hors serveur (poste Windows), le
//! lancement de l'action renvoie une erreur explicite : la route n'est de toute
//! façon montée que par le serveur autonome.

use serde::Serialize;
use std::path::PathBuf;
use std::time::Duration;

/// Programmes internes pilotés par les actions de service. **PostgreSQL est
/// volontairement absent** : l'arrêt du service ne doit jamais couper la base
/// (décision « le poste parle en direct à la base »).
pub const SERVICE_PROGRAMS: [&str; 2] = ["gds-server", "sshd"];

/// Emplacement du fichier de configuration du superviseur dans l'image
/// (`gds-server/Dockerfile`, `GDS_SUPERVISORD_CONFIG`). Les deux commandes
/// (`status`, action différée) passent la **même** configuration à
/// `supervisorctl`, sinon elles ne viseraient pas le même socket.
pub const DEFAULT_SUPERVISORD_CONFIG: &str = "/etc/gds/supervisord.conf";

/// Nom du binaire de commande du superviseur (paquet `supervisor`).
pub const DEFAULT_SUPERVISORCTL_BIN: &str = "supervisorctl";

/// Délai par défaut entre la réponse HTTP et l'exécution de l'ordre (ms).
/// Assez court pour que l'utilisateur voie l'effet « tout de suite », assez long
/// pour que la réponse soit écrite et lue par le client avant la coupure.
pub const DEFAULT_ACTION_DELAY_MS: u64 = 750;

/// Action de service demandée depuis l'écran d'administration.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServiceAction {
    /// Redémarre `gds-server` et `sshd` (la base n'est pas touchée).
    Restart,
    /// Arrête `gds-server` et `sshd` (la base continue de répondre).
    Stop,
}

impl ServiceAction {
    /// Verbe `supervisorctl` correspondant.
    pub fn verb(self) -> &'static str {
        match self {
            ServiceAction::Restart => "restart",
            ServiceAction::Stop => "stop",
        }
    }

    /// Code d'action journalisé dans l'audit (`gds-core::audit`).
    pub fn audit_code(self) -> &'static str {
        match self {
            ServiceAction::Restart => "service_restart",
            ServiceAction::Stop => "service_stop",
        }
    }

    /// Libellé court pour les messages d'erreur.
    pub fn label(self) -> &'static str {
        match self {
            ServiceAction::Restart => "redémarrage du service",
            ServiceAction::Stop => "arrêt du service",
        }
    }

    /// Analyse le nom d'action reçu de l'écran. Pure — testable.
    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_lowercase().as_str() {
            "restart" | "redemarrer" | "redémarrer" => Some(ServiceAction::Restart),
            "stop" | "arreter" | "arrêter" => Some(ServiceAction::Stop),
            _ => None,
        }
    }
}

/// Environnement d'exécution du pilotage du superviseur (binaire + configuration
/// + délai). Rassemblé dans une structure pour être construit une fois et passé
/// tel quel aux fonctions bloquantes (aucune lecture d'environnement dans un
/// thread détaché).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SupervisorEnv {
    /// Binaire `supervisorctl` (`GDS_SUPERVISORCTL_BIN`, défaut `supervisorctl`).
    pub ctl_bin: String,
    /// Fichier de configuration du superviseur (`GDS_SUPERVISORD_CONFIG`).
    pub config: PathBuf,
    /// Délai avant exécution de l'ordre (ms).
    pub delay_ms: u64,
}

impl Default for SupervisorEnv {
    fn default() -> Self {
        SupervisorEnv {
            ctl_bin: DEFAULT_SUPERVISORCTL_BIN.to_string(),
            config: PathBuf::from(DEFAULT_SUPERVISORD_CONFIG),
            delay_ms: DEFAULT_ACTION_DELAY_MS,
        }
    }
}

impl SupervisorEnv {
    /// Construit l'environnement depuis les variables du conteneur. Les variables
    /// absentes ou vides retombent sur les valeurs par défaut : le service
    /// fonctionne sans réglage supplémentaire dans l'image livrée.
    pub fn from_env() -> Self {
        let ctl_bin = std::env::var("GDS_SUPERVISORCTL_BIN")
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| DEFAULT_SUPERVISORCTL_BIN.to_string());
        let config = std::env::var("GDS_SUPERVISORD_CONFIG")
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(DEFAULT_SUPERVISORD_CONFIG));
        let delay_ms = clamp_delay_ms(
            std::env::var("GDS_SERVICE_ACTION_DELAY_MS")
                .ok()
                .and_then(|v| v.trim().parse::<u64>().ok()),
        );
        SupervisorEnv {
            ctl_bin,
            config,
            delay_ms,
        }
    }

    /// Arguments de `supervisorctl` pour une action (sans le binaire). Pure —
    /// testable.
    pub fn action_args(&self, action: ServiceAction) -> Vec<String> {
        let mut args = vec![
            "-c".to_string(),
            self.config.to_string_lossy().to_string(),
            action.verb().to_string(),
        ];
        args.extend(SERVICE_PROGRAMS.iter().map(|p| p.to_string()));
        args
    }

    /// Arguments de `supervisorctl status` pour les seuls programmes du service.
    /// Pure — testable.
    pub fn status_args(&self) -> Vec<String> {
        let mut args = vec![
            "-c".to_string(),
            self.config.to_string_lossy().to_string(),
            "status".to_string(),
        ];
        args.extend(SERVICE_PROGRAMS.iter().map(|p| p.to_string()));
        args
    }

    /// Script de coquille exécuté **détaché** : attend le délai, puis exécute
    /// l'ordre du superviseur. Pure — testable. Le délai est exprimé en secondes
    /// décimales (`sleep 0.75`), supporté par le `sleep` GNU de l'image.
    pub fn detached_script(&self, action: ServiceAction) -> String {
        let seconds = self.delay_ms as f64 / 1000.0;
        let args = self
            .action_args(action)
            .iter()
            .map(|a| sh_quote(a))
            .collect::<Vec<_>>()
            .join(" ");
        format!(
            "sleep {:.3}; exec {} {}",
            seconds,
            sh_quote(&self.ctl_bin),
            args
        )
    }
}

/// Borne le délai avant exécution d'un ordre : jamais immédiat (la réponse doit
/// être partie avant la coupure) et jamais interminable (l'écran ne doit pas
/// attendre indéfiniment). `None` = valeur par défaut. Pure — testable.
pub fn clamp_delay_ms(raw: Option<u64>) -> u64 {
    match raw {
        Some(v) => v.clamp(50, 30_000),
        None => DEFAULT_ACTION_DELAY_MS,
    }
}

/// Référence une chaîne pour `sh` (guillemets simples, échappement de `'`).
/// Pure — testable. Les valeurs viennent de l'environnement du conteneur
/// (chemin de configuration, nom du binaire) : elles sont de toute façon citées.
pub fn sh_quote(raw: &str) -> String {
    format!("'{}'", raw.replace('\'', "'\\''"))
}

/// État d'un programme surveillé, tel qu'affiché par `supervisorctl status`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProgramState {
    pub name: String,
    /// `RUNNING`, `STOPPED`, `FATAL`, `STARTING`… (vocabulaire du superviseur).
    pub state: String,
    /// Numéro de processus quand le programme tourne.
    pub pid: Option<u32>,
}

/// Lit une ligne de `supervisorctl status`. Format :
/// `gds-server    RUNNING   pid 123, uptime 0:00:12` (ou
/// `sshd    STOPPED   Not started`). Renvoie `None` si la ligne n'a pas au
/// moins un nom et un état. Pure — testable.
pub fn parse_status_line(line: &str) -> Option<ProgramState> {
    let tokens: Vec<&str> = line.split_whitespace().collect();
    let name = tokens.first()?.to_string();
    let state = tokens.get(1)?.to_string();
    let pid = tokens
        .iter()
        .position(|t| *t == "pid")
        .and_then(|i| tokens.get(i + 1))
        .and_then(|t| t.trim_end_matches(',').parse::<u32>().ok());
    Some(ProgramState { name, state, pid })
}

/// Filtre les lignes de `supervisorctl status` sur les programmes du service,
/// dans l'ordre de `SERVICE_PROGRAMS`. Pure — testable.
pub fn parse_status(text: &str) -> Vec<ProgramState> {
    let mut found: Vec<ProgramState> = text.lines().filter_map(parse_status_line).collect();
    found.retain(|s| SERVICE_PROGRAMS.contains(&s.name.as_str()));
    found.sort_by_key(|s| {
        SERVICE_PROGRAMS
            .iter()
            .position(|p| *p == s.name)
            .unwrap_or(usize::MAX)
    });
    found
}

/// Exécute `supervisorctl` et renvoie sa sortie brute, ou une erreur explicite
/// (binaire absent, superviseur injoignable).
fn run_ctl(env: &SupervisorEnv, args: &[String]) -> Result<std::process::Output, String> {
    std::process::Command::new(&env.ctl_bin)
        .args(args)
        .output()
        .map_err(|e| {
            format!(
                "superviseur interne injoignable ({} {} : {})",
                env.ctl_bin,
                env.config.to_string_lossy(),
                e
            )
        })
}

/// Interroge l'état des programmes du service. Renvoie la liste des états et,
/// le cas échéant, un message d'erreur (superviseur injoignable ou sortie
/// illisible). Fonction **bloquante** : appelée via `spawn_blocking`.
pub fn query_status(env: &SupervisorEnv) -> (Vec<ProgramState>, Option<String>) {
    match run_ctl(env, &env.status_args()) {
        Ok(out) => {
            let text = String::from_utf8_lossy(&out.stdout);
            let states = parse_status(&text);
            if states.is_empty() {
                let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
                let error = if stderr.is_empty() {
                    format!(
                        "état du superviseur illisible (code de sortie {})",
                        out.status.code().unwrap_or(-1)
                    )
                } else {
                    stderr
                };
                (states, Some(error))
            } else {
                (states, None)
            }
        }
        Err(e) => (Vec::new(), Some(e)),
    }
}

/// Programme l'action (détachée) auprès du superviseur interne.
///
/// Le processus détaché appartient à un **nouveau groupe de processus** : la
/// coupure du service par le superviseur ne l'emporte pas, l'ordre est donc
/// toujours exécuté. Ce choix est indispensable pour `restart`/`stop` de
/// `gds-server` (le processus qui a lancé l'ordre est celui qui va mourir).
pub fn schedule_action(env: &SupervisorEnv, action: ServiceAction) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        use std::process::Stdio;
        let script = env.detached_script(action);
        let mut cmd = std::process::Command::new("/bin/sh");
        cmd.arg("-c")
            .arg(&script)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0);
        cmd.spawn().map(|_| ()).map_err(|e| {
            format!(
                "{} : ordre non transmis au superviseur ({})",
                action.label(),
                e
            )
        })
    }
    #[cfg(not(unix))]
    {
        let _ = (env, action);
        Err(format!(
            "{} : supervision interne disponible uniquement sur le serveur GDS (Linux)",
            action.label()
        ))
    }
}

/// État affiché par l'écran d'administration (`GET /api/gds/admin/service`).
#[derive(Debug, Clone, Serialize)]
pub struct ServiceReport {
    /// PID du processus qui répond : il **change** à chaque redémarrage du
    /// service, ce qui permet à l'écran de constater le redémarrage réel.
    pub pid: u32,
    /// Délai appliqué avant exécution d'un ordre (ms), tel que configuré.
    pub action_delay_ms: u64,
    /// Programmes pilotables (ordre figé).
    pub programs: Vec<String>,
    /// État courant de chaque programme.
    pub states: Vec<ProgramState>,
    /// Renseigné si le superviseur interne n'a pas pu être interrogé.
    pub error: Option<String>,
}

impl ServiceReport {
    /// Construit l'état courant. Fonction **bloquante** (voir `query_status`).
    pub fn collect(env: &SupervisorEnv, pid: u32) -> Self {
        let (states, error) = query_status(env);
        ServiceReport {
            pid,
            action_delay_ms: env.delay_ms,
            programs: SERVICE_PROGRAMS.iter().map(|p| p.to_string()).collect(),
            states,
            error,
        }
    }
}

/// Délai entre la réponse HTTP et l'ordre (documentation/tests).
pub fn action_delay(env: &SupervisorEnv) -> Duration {
    Duration::from_millis(env.delay_ms)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env() -> SupervisorEnv {
        SupervisorEnv {
            ctl_bin: "supervisorctl".to_string(),
            config: PathBuf::from("/etc/gds/supervisord.conf"),
            delay_ms: 750,
        }
    }

    #[test]
    fn action_parse_accepts_the_ui_vocabulary_only() {
        assert_eq!(ServiceAction::parse(" restart "), Some(ServiceAction::Restart));
        assert_eq!(ServiceAction::parse("STOP"), Some(ServiceAction::Stop));
        assert_eq!(ServiceAction::parse("delete"), None);
        assert_eq!(ServiceAction::parse(""), None);
    }

    #[test]
    fn action_verbs_and_audit_codes_are_stable() {
        assert_eq!(ServiceAction::Restart.verb(), "restart");
        assert_eq!(ServiceAction::Restart.audit_code(), "service_restart");
        assert_eq!(ServiceAction::Stop.verb(), "stop");
        assert_eq!(ServiceAction::Stop.audit_code(), "service_stop");
    }

    /// PostgreSQL ne doit JAMAIS être piloté par ces actions : le superviseur
    /// gère trois programmes, les actions de service n'en visent que deux.
    #[test]
    fn service_programs_never_include_postgres() {
        assert_eq!(SERVICE_PROGRAMS, ["gds-server", "sshd"]);
        assert!(!SERVICE_PROGRAMS.contains(&"postgres"));
        for args in [env().action_args(ServiceAction::Restart), env().status_args()] {
            assert!(!args.iter().any(|a| a == "postgres"), "{:?}", args);
        }
    }

    #[test]
    fn action_args_target_the_supervisor_config_and_both_programs() {
        assert_eq!(
            env().action_args(ServiceAction::Restart),
            vec![
                "-c",
                "/etc/gds/supervisord.conf",
                "restart",
                "gds-server",
                "sshd"
            ]
        );
        assert_eq!(
            env().action_args(ServiceAction::Stop),
            vec!["-c", "/etc/gds/supervisord.conf", "stop", "gds-server", "sshd"]
        );
        assert_eq!(
            env().status_args(),
            vec![
                "-c",
                "/etc/gds/supervisord.conf",
                "status",
                "gds-server",
                "sshd"
            ]
        );
    }

    /// L'ordre est **différé** : le service doit répondre avant d'être coupé.
    #[test]
    fn detached_script_waits_then_runs_the_order() {
        let script = env().detached_script(ServiceAction::Restart);
        assert_eq!(
            script,
            "sleep 0.750; exec 'supervisorctl' '-c' '/etc/gds/supervisord.conf' 'restart' 'gds-server' 'sshd'"
        );
        assert!(script.starts_with("sleep "), "{}", script);
    }

    #[test]
    fn shell_quoting_neutralizes_single_quotes() {
        assert_eq!(sh_quote("/etc/gds/supervisord.conf"), "'/etc/gds/supervisord.conf'");
        assert_eq!(sh_quote("a'b"), "'a'\\''b'");
    }

    #[test]
    fn status_lines_are_parsed_with_and_without_pid() {
        assert_eq!(
            parse_status_line("gds-server                       RUNNING   pid 123, uptime 0:00:12"),
            Some(ProgramState {
                name: "gds-server".to_string(),
                state: "RUNNING".to_string(),
                pid: Some(123),
            })
        );
        assert_eq!(
            parse_status_line("sshd                             STOPPED   Not started"),
            Some(ProgramState {
                name: "sshd".to_string(),
                state: "STOPPED".to_string(),
                pid: None,
            })
        );
        assert_eq!(parse_status_line(""), None);
        assert_eq!(parse_status_line("RUNNING"), None);
    }

    #[test]
    fn status_filtering_keeps_service_programs_in_order() {
        let text = "postgres    RUNNING   pid 9, uptime 0:10:00\n\
                    sshd        RUNNING   pid 42, uptime 0:00:03\n\
                    gds-server  RUNNING   pid 77, uptime 0:00:03\n";
        let states = parse_status(text);
        assert_eq!(
            states.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(),
            vec!["gds-server", "sshd"]
        );
        assert_eq!(states[0].pid, Some(77));
        assert_eq!(states[1].pid, Some(42));
    }

    /// Le délai est borné : jamais immédiat (la réponse doit partir avant la
    /// coupure), jamais interminable, et la valeur par défaut s'applique quand
    /// la variable est absente ou illisible.
    #[test]
    fn delay_is_clamped_and_defaulted() {
        assert_eq!(action_delay(&env()), Duration::from_millis(750));
        assert_eq!(clamp_delay_ms(None), DEFAULT_ACTION_DELAY_MS);
        assert_eq!(clamp_delay_ms(Some(0)), 50);
        assert_eq!(clamp_delay_ms(Some(1)), 50);
        assert_eq!(clamp_delay_ms(Some(750)), 750);
        assert_eq!(clamp_delay_ms(Some(600_000)), 30_000);
    }
}
