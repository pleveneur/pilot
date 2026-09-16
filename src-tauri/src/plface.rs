//! PLface autostart — Pilot lance l'avatar assistant PLface (exécutable local)
//! au démarrage si son API HTTP locale ne répond pas déjà.
//!
//! PLface expose une API locale sur `http://127.0.0.1:3000` ; la route `/status`
//! répond quand la fenêtre de l'avatar tourne. Pilot ne lance l'exécutable que
//! si l'indicateur d'activation est actif, qu'un chemin est renseigné et que
//! l'API ne répond pas déjà.
//!
//! Pilot peut aussi **choisir le modèle** affiché : si un chemin de modèle
//! (`.vrm`) est renseigné dans les réglages, il est transmis à l'exécutable via
//! `--avatar <chemin>`. Si le réglage est vide, le **modèle par défaut livré
//! avec Pilot** (`PilotBase.vrm`, ressource embarquée) est utilisé ; s'il est
//! absent ou illisible, aucun argument n'est ajouté et le visage se rabat sur
//! son modèle intégré (aucune erreur bloquante).
//!
//! Pilot peut enfin demander un **arrêt propre** du visage (`GET /close`) quand
//! l'utilisateur le désactive — jamais à la fermeture de Pilot.
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

/// Nom du fichier de ressource du **modèle d'avatar par défaut livré avec
/// Pilot** (`PilotBase.vrm`). Une seule copie physique, embarquée via
/// `bundle.resources` dans `tauri.conf.json` et résolue dynamiquement par
/// `AppHandle::path().resolve(.., BaseDirectory::Resource)` : même nom de
/// ressource en développement (`target/<profil>/PilotBase.vrm`) et en version
/// installée (dossier de ressources du bundle).
pub(crate) const DEFAULT_AVATAR_RESOURCE: &str = "PilotBase.vrm";

/// Nom de la ressource du **programme du visage livré avec Pilot**
/// (`plface.exe`). Même mécanisme que le modèle d'avatar : une seule copie
/// physique (`src-tauri/assets/plface.exe`) embarquée via `bundle.resources`
/// dans `tauri.conf.json`, résolue dynamiquement par
/// `AppHandle::path().resolve(.., BaseDirectory::Resource)` — même nom de
/// ressource en développement (`target/<profil>/plface.exe`) et en version
/// installée (dossier de ressources du bundle). Le programme est un binaire
/// Windows (WebView2) : sa résolution n'est tentée que sous Windows.
pub(crate) const DEFAULT_EXE_RESOURCE: &str = "plface.exe";

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

/// État lisible renvoyé à l'interface par la commande `stop_plface`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PlfaceStopOutcome {
    /// Le visage tournait et a reçu la demande de fermeture propre.
    Closed,
    /// L'API ne répond pas : le visage n'est pas lancé, rien à faire.
    NotRunning,
    /// Le visage répond mais la demande de fermeture n'a pas abouti.
    Failed,
}

/// Normalise le chemin de modèle d'avatar : `None` si vide/espaces seulement.
/// Séparé des I/O pour être testable et pour n'ajouter `--avatar` que si utile.
pub(crate) fn avatar_arg(avatar_path: &str) -> Option<&str> {
    let trimmed = avatar_path.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

/// Résout le modèle d'avatar **effectif** transmis au visage :
/// - champ renseigné → chemin utilisateur tel quel (comportement inchangé) ;
/// - champ vide → chemin du modèle par défaut livré par Pilot (`default_path`,
///   déjà validé comme fichier existant par l'appelant) ;
/// - les deux absents → `None` : le visage garde son modèle intégré.
///
/// Fonction pure : les entrées/sorties (existence du fichier livré) sont faites
/// par l'appelant, ce qui la rend testable sans système de fichiers.
pub(crate) fn resolve_avatar(configured: &str, default_path: Option<&str>) -> Option<String> {
    if let Some(user) = avatar_arg(configured) {
        return Some(user.to_string());
    }
    default_path.map(str::to_string)
}

/// Résout l'exécutable du visage **effectif** :
/// - champ renseigné → chemin utilisateur tel quel (comportement inchangé, même
///   s'il est introuvable : `launch_if_needed` le signale alors) ;
/// - champ vide → chemin du **programme livré par Pilot** (`default_path`, déjà
///   validé comme fichier existant par l'appelant) ;
/// - les deux absents → `None` : aucun lancement, en silence.
///
/// Fonction pure : l'existence du fichier livré est vérifiée par l'appelant, ce
/// qui la rend testable sans système de fichiers.
pub(crate) fn resolve_exe(configured: &str, default_path: Option<&str>) -> Option<String> {
    let trimmed = configured.trim();
    if !trimmed.is_empty() {
        return Some(trimmed.to_string());
    }
    default_path.map(str::to_string)
}

/// Décision PURE de l'état d'arrêt, séparée des entrées/sorties.
pub(crate) fn decide_stop(api_up: bool, close_acknowledged: bool) -> PlfaceStopOutcome {
    if !api_up {
        return PlfaceStopOutcome::NotRunning;
    }
    if close_acknowledged {
        PlfaceStopOutcome::Closed
    } else {
        PlfaceStopOutcome::Failed
    }
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
/// - `--avatar <chemin>` n'est ajouté que si un modèle est renseigné ;
/// - `--no-taskbar` est **toujours** transmis : un lancement par Pilot demande
///   au visage de ne pas figurer dans la barre des tâches Windows (mode discret).
///   Un visage lancé à la main par la personne reste visible comme avant ;
/// - sans fenêtre de console sous Windows (`CREATE_NO_WINDOW`) ;
/// - stdio redirigé vers `null` (aucune sortie parasite) ;
/// - l'enfant n'est jamais attendu ni suivi → il survit à la fermeture de Pilot.
///
/// Multiplateforme : seule la neutralisation de la console est spécifique à
/// Windows (`creation_flags`) ; macOS/Linux lancent l'exécutable normalement.
pub(crate) fn spawn_detached(exe_path: &str, avatar: Option<&str>) -> std::io::Result<()> {
    let mut cmd = Command::new(exe_path);
    // Modèle choisi : transmis tel quel. `Command` passe les arguments sans
    // shell → un chemin avec espaces reste un argument unique (pas d'échappement).
    if let Some(model) = avatar {
        cmd.arg("--avatar").arg(model);
    }
    // Mode discret : Pilot seul demande au visage de ne pas apparaître dans la
    // barre des tâches Windows. Option ignorée par les autres plateformes.
    cmd.arg("--no-taskbar");
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
pub(crate) fn launch_if_needed(
    enabled: bool,
    exe_path: &str,
    avatar: Option<&str>,
) -> PlfaceLaunchOutcome {
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
        PlfaceDecision::Launch => match spawn_detached(trimmed, avatar) {
            Ok(()) => PlfaceLaunchOutcome::Launched,
            Err(_) => PlfaceLaunchOutcome::LaunchFailed,
        },
    }
}

/// Émet une requête HTTP/1.1 `GET /close` vers l'API locale du visage et
/// retourne `true` si une réponse HTTP est reçue (le visage confirme sa
/// fermeture). Toute erreur réseau = `false` (fail-open, jamais bloquant).
pub(crate) fn request_close(host: &str, port: u16, timeout: Duration) -> bool {
    use std::io::{Read, Write};
    use std::net::{TcpStream, ToSocketAddrs};

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
        "GET /close HTTP/1.1\r\nHost: {}:{}\r\nConnection: close\r\n\r\n",
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

/// Orchestrateur d'arrêt non pur : ne fait rien si le visage ne tourne pas,
/// sinon lui demande de se fermer proprement (`GET /close`). Jamais bloquant
/// au-delà de `PROBE_TIMEOUT`, jamais d'erreur remontée.
pub(crate) fn stop_if_running() -> PlfaceStopOutcome {
    let api_up = probe_api(PLFACE_API_HOST, PLFACE_API_PORT, PROBE_TIMEOUT);
    if !api_up {
        return PlfaceStopOutcome::NotRunning;
    }
    let acknowledged = request_close(PLFACE_API_HOST, PLFACE_API_PORT, PROBE_TIMEOUT);
    decide_stop(true, acknowledged)
}

/// Indique si le visage tourne (sonde `/status`, timeout court). Commande
/// `plface_status` pour l'indicateur d'état de l'onglet Avatar.
pub(crate) fn is_running() -> bool {
    probe_api(PLFACE_API_HOST, PLFACE_API_PORT, PROBE_TIMEOUT)
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
        assert_eq!(
            launch_if_needed(false, "", None),
            PlfaceLaunchOutcome::Disabled
        );
        assert_eq!(
            launch_if_needed(true, "   ", None),
            PlfaceLaunchOutcome::Disabled
        );
    }

    #[test]
    fn launch_if_needed_missing_exe_reports_not_found() {
        // Chemin renseigné mais introuvable, API muette → pas de lancement.
        let outcome = launch_if_needed(true, "/chemin/qui/n-existe-pas/plface-xyz", None);
        assert!(matches!(
            outcome,
            PlfaceLaunchOutcome::ExecutableNotFound | PlfaceLaunchOutcome::AlreadyRunning
        ));
    }

    #[test]
    fn avatar_arg_ignores_empty_or_blank() {
        assert_eq!(avatar_arg(""), None);
        assert_eq!(avatar_arg("   "), None);
    }

    #[test]
    fn avatar_arg_keeps_trimmed_path() {
        assert_eq!(avatar_arg("  C:\\models\\Alice.VRM  "), Some("C:\\models\\Alice.VRM"));
    }

    #[test]
    fn resolve_avatar_user_path_takes_priority() {
        // Champ renseigné : le chemin de l'utilisateur l'emporte, même si un
        // modèle livré est disponible (comportement inchangé).
        assert_eq!(
            resolve_avatar("  C:\\models\\Alice.VRM ", Some("/res/PilotBase.vrm")),
            Some("C:\\models\\Alice.VRM".to_string())
        );
    }

    #[test]
    fn resolve_avatar_falls_back_to_bundled_default() {
        // Champ vide : le modèle livré avec Pilot est utilisé.
        assert_eq!(
            resolve_avatar("   ", Some("/res/PilotBase.vrm")),
            Some("/res/PilotBase.vrm".to_string())
        );
    }

    #[test]
    fn resolve_avatar_none_when_both_missing() {
        // Champ vide + modèle livré absent : aucun chemin → le visage garde son
        // modèle intégré (aucun `--avatar` transmis), sans erreur.
        assert_eq!(resolve_avatar("", None), None);
        assert_eq!(resolve_avatar("   ", None), None);
    }

    #[test]
    fn resolve_exe_user_path_takes_priority() {
        // Champ renseigné : le chemin de l'utilisateur l'emporte, même si le
        // programme livré est disponible (comportement inchangé).
        assert_eq!(
            resolve_exe("  C:\\PLface\\PLface.exe ", Some("/res/plface.exe")),
            Some("C:\\PLface\\PLface.exe".to_string())
        );
    }

    #[test]
    fn resolve_exe_falls_back_to_bundled_program() {
        // Champ vide : le programme livré avec Pilot est utilisé (clé en main).
        assert_eq!(
            resolve_exe("   ", Some("/res/plface.exe")),
            Some("/res/plface.exe".to_string())
        );
    }

    #[test]
    fn resolve_exe_none_when_both_missing() {
        // Champ vide + programme livré absent : aucun exécutable → aucun
        // lancement, en silence.
        assert_eq!(resolve_exe("", None), None);
        assert_eq!(resolve_exe("   ", None), None);
    }

    #[test]
    fn stop_not_running_when_api_down() {
        assert_eq!(decide_stop(false, false), PlfaceStopOutcome::NotRunning);
        // Même si un « close » aurait été envoyé, une API muette = non lancé.
        assert_eq!(decide_stop(false, true), PlfaceStopOutcome::NotRunning);
    }

    #[test]
    fn stop_closed_when_api_up_and_acknowledged() {
        assert_eq!(decide_stop(true, true), PlfaceStopOutcome::Closed);
    }

    #[test]
    fn stop_failed_when_api_up_but_no_ack() {
        assert_eq!(decide_stop(true, false), PlfaceStopOutcome::Failed);
    }
}
