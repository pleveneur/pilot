//! PLface autostart — Pilot lance l'avatar assistant PLface (exécutable local)
//! au démarrage si son API HTTP locale ne répond pas déjà.
//!
//! PLface expose une API locale sur `http://127.0.0.1:3000` ; la route `/status`
//! répond quand la fenêtre de l'avatar tourne. Pilot ne lance l'exécutable que
//! si l'indicateur d'activation est actif, qu'un chemin est renseigné et que
//! l'API ne répond pas déjà.
//!
//! Garanties :
//! - jamais bloquant (sonde avec timeout court < 1 s, lancement en tâche de fond
//!   détachée) ;
//! - jamais d'erreur visible au démarrage si l'exécutable est absent ou si le
//!   lancement échoue (l'utilisateur sans PLface ne voit aucune différence) ;
//! - PLface n'est PAS refermé à la fermeture de Pilot (processus non suivi) ;
//! - aucune dépendance externe (bibliothèque standard uniquement).

use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::Serialize;

/// Hôte de l'API locale PLface.
pub(crate) const PLFACE_API_HOST: &str = "127.0.0.1";
/// Port de l'API locale PLface.
pub(crate) const PLFACE_API_PORT: u16 = 3000;
/// Timeout de la sonde réseau : strictement inférieur à 1 seconde.
pub(crate) const PROBE_TIMEOUT: Duration = Duration::from_millis(400);

/// État lisible renvoyé à l'interface (commande `check_and_launch_plface`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PlfaceLaunchOutcome {
    /// L'API répond déjà : PLface tourne, rien à faire.
    AlreadyRunning,
    /// PLface n'était pas lancé et a été démarré en tâche de fond.
    Launched,
    /// Chemin d'exécutable vide ou introuvable : on ne lance pas.
    ExecutableNotFound,
    /// Fonctionnalité désactivée (ou chemin vide) : on ne lance pas.
    Disabled,
    /// Le lancement a échoué (erreur OS) : on ne lance pas, silencieusement.
    LaunchFailed,
}

/// Décision PURE de lancement, séparée des entrées/sorties pour être testable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PlfaceDecision {
    /// L'API répond déjà : ne rien faire.
    AlreadyRunning,
    /// Toutes les conditions sont réunies : lancer.
    Launch,
    /// Réglage désactivé ou chemin vide : ne rien faire.
    Disabled,
    /// Chemin renseigné mais exécutable introuvable : ne rien faire.
    ExecutableNotFound,
}

/// Logique de décision PURE.
///
/// Priorité des règles :
/// 1. fonctionnalité désactivée (ou chemin vide) → `Disabled` ;
/// 2. API qui répond déjà → `AlreadyRunning` ;
/// 3. exécutable absent → `ExecutableNotFound` ;
/// 4. sinon → `Launch`.
pub(crate) fn decide_launch(
    enabled: bool,
    exe_path: &str,
    exe_exists: bool,
    api_up: bool,
) -> PlfaceDecision {
    if !enabled || exe_path.trim().is_empty() {
        return PlfaceDecision::Disabled;
    }
    if api_up {
        return PlfaceDecision::AlreadyRunning;
    }
    if !exe_exists {
        return PlfaceDecision::ExecutableNotFound;
    }
    PlfaceDecision::Launch
}

/// Sonde l'API locale PLface en émettant une requête HTTP/1.1 `GET /status`
/// avec un timeout très court. Retourne `true` dès qu'une réponse HTTP (toute
/// ligne de statut `HTTP/…`) est reçue. Toute erreur réseau = `false`
/// (fail-open : on suppose que PLface n'est pas lancé, sans jamais bloquer).
pub(crate) fn probe_api(host: &str, port: u16, timeout: Duration) -> bool {
    use std::io::{Read, Write};
    use std::net::{TcpStream, ToSocketAddrs};

    // `host` est une IP littérale : pas de résolution DNS bloquante.
    let addr = match (host, port).to_socket_addrs() {
        Ok(mut it) => match it.next() {
            Some(a) => a,
            None => return false,
        },
        Err(_) => return false,
    };

    let mut stream = match TcpStream::connect_timeout(&addr, timeout) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));

    let request = format!(
        "GET /status HTTP/1.1\r\nHost: {}:{}\r\nConnection: close\r\n\r\n",
        host, port
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    let mut buf = [0u8; 32];
    match stream.read(&mut buf) {
        Ok(n) if n > 0 => buf[..n].starts_with(b"HTTP/"),
        _ => false,
    }
}

/// Lance l'exécutable PLface en tâche de fond, détaché de Pilot :
/// - sans fenêtre de console sous Windows (`CREATE_NO_WINDOW`) ;
/// - stdio redirigé vers `null` (aucune sortie parasite) ;
/// - l'enfant n'est jamais attendu ni suivi → il survit à la fermeture de Pilot.
///
/// Multiplateforme : seule la neutralisation de la console est spécifique à
/// Windows (`creation_flags`) ; macOS/Linux lancent l'exécutable normalement.
pub(crate) fn spawn_detached(exe_path: &str) -> std::io::Result<()> {
    let mut cmd = Command::new(exe_path);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(crate::CREATE_NO_WINDOW);
    }

    // Le `Child` est abandonné (jamais `wait`) : le processus PLface continue
    // indépendamment de Pilot. On ne le tue jamais à la fermeture.
    let _child = cmd.spawn()?;
    Ok(())
}

/// Orchestrateur non pur : sonde l'API puis lance si nécessaire.
/// Jamais bloquant au-delà de `PROBE_TIMEOUT`, jamais d'erreur remontée.
pub(crate) fn launch_if_needed(enabled: bool, exe_path: &str) -> PlfaceLaunchOutcome {
    let trimmed = exe_path.trim();

    // Court-circuit : aucune sonde réseau si la fonctionnalité est désactivée.
    if !enabled || trimmed.is_empty() {
        return PlfaceLaunchOutcome::Disabled;
    }

    let api_up = probe_api(PLFACE_API_HOST, PLFACE_API_PORT, PROBE_TIMEOUT);
    let exe_exists = Path::new(trimmed).is_file();

    match decide_launch(enabled, exe_path, exe_exists, api_up) {
        PlfaceDecision::AlreadyRunning => PlfaceLaunchOutcome::AlreadyRunning,
        PlfaceDecision::Disabled => PlfaceLaunchOutcome::Disabled,
        PlfaceDecision::ExecutableNotFound => PlfaceLaunchOutcome::ExecutableNotFound,
        PlfaceDecision::Launch => match spawn_detached(trimmed) {
            Ok(()) => PlfaceLaunchOutcome::Launched,
            Err(_) => PlfaceLaunchOutcome::LaunchFailed,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_when_enabled_api_down_and_exe_exists() {
        assert_eq!(
            decide_launch(true, "/opt/plface/plface", true, false),
            PlfaceDecision::Launch
        );
    }

    #[test]
    fn no_launch_when_api_already_responds() {
        assert_eq!(
            decide_launch(true, "/opt/plface/plface", true, true),
            PlfaceDecision::AlreadyRunning
        );
        // Même avec un exécutable absent, une API qui répond = ne rien faire.
        assert_eq!(
            decide_launch(true, "/whatever/plface", false, true),
            PlfaceDecision::AlreadyRunning
        );
    }

    #[test]
    fn no_launch_when_disabled() {
        assert_eq!(
            decide_launch(false, "/opt/plface/plface", true, false),
            PlfaceDecision::Disabled
        );
    }

    #[test]
    fn no_launch_when_path_empty_or_blank() {
        assert_eq!(
            decide_launch(true, "", true, false),
            PlfaceDecision::Disabled
        );
        assert_eq!(
            decide_launch(true, "   ", true, false),
            PlfaceDecision::Disabled
        );
    }

    #[test]
    fn no_launch_when_executable_missing() {
        assert_eq!(
            decide_launch(true, "/opt/plface/plface", false, false),
            PlfaceDecision::ExecutableNotFound
        );
    }

    #[test]
    fn disabled_takes_priority_over_api_state() {
        // Désactivé doit court-circuiter même si l'API est joignable.
        assert_eq!(
            decide_launch(false, "", false, true),
            PlfaceDecision::Disabled
        );
    }

    #[test]
    fn launch_if_needed_disabled_never_touches_network() {
        // Chemin vide + désactivé : renvoie Disabled sans sonde (donc immédiat).
        assert_eq!(launch_if_needed(false, ""), PlfaceLaunchOutcome::Disabled);
        assert_eq!(
            launch_if_needed(true, "   "),
            PlfaceLaunchOutcome::Disabled
        );
    }

    #[test]
    fn launch_if_needed_missing_exe_reports_not_found() {
        // Chemin renseigné mais introuvable, API muette → pas de lancement.
        let outcome = launch_if_needed(true, "/chemin/qui/n-existe-pas/plface-xyz");
        assert!(matches!(
            outcome,
            PlfaceLaunchOutcome::ExecutableNotFound | PlfaceLaunchOutcome::AlreadyRunning
        ));
    }
}
