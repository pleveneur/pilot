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
//! l'utilisateur le désactive — et, puisque c'est Pilot qui l'a lancé, Pilot le
//! **referme aussi à sa propre fermeture** (un visage lancé à la main par la
//! personne n'est jamais refermé par Pilot).
//!
//! Garanties :
//! - jamais bloquant (sonde avec timeout court < 1 s, lancement en tâche de fond
//!   détachée) ;
//! - jamais d'erreur visible au démarrage si l'exécutable est absent ou si le
//!   lancement échoue (l'utilisateur sans PLface ne voit aucune différence) ;
//! - le visage lancé par Pilot ne lui survit pas : il est refermé à la fermeture
//!   de Pilot, et un reste après une fermeture brutale est nettoyé au démarrage
//!   suivant (sinon il verrouillerait sa propre copie dans le dossier de
//!   compilation et bloquerait toute préparation du paquet) ;
//! - aucune dépendance externe (bibliothèque standard uniquement).

use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::Serialize;

/// Hôte de l'API locale PLface.
pub(crate) const PLFACE_API_HOST: &str = "127.0.0.1";
/// Port de l'API locale PLface.
pub(crate) const PLFACE_API_PORT: u16 = 3000;
/// Nom du fichier de trace du visage lancé par Pilot, écrit dans le dossier de
/// données de l'application. Il retient l'identifiant **et** le nom du programme
/// lancés par Pilot : c'est ce qui permet de ne refermer **que** le visage
/// démarré par Pilot (jamais celui ouvert à la main par la personne) et de le
/// nettoyer au démarrage suivant si Pilot a été fermé brutalement — sinon le
/// visage resterait en vie et verrouillerait sa propre copie, empêchant la
/// préparation du paquet en développement.
pub(crate) const PID_FILE_NAME: &str = "plface.pid";

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

/// Contenu du fichier de trace pour un lancement donné : identifiant puis nom
/// du programme, sur deux lignes. PURE.
pub(crate) fn format_pid_file(pid: u32, exe_name: &str) -> String {
    format!("{pid}\n{exe_name}\n")
}

/// Lit le fichier de trace : `(identifiant, nom du programme)`. PURE.
/// `None` si l'un des deux manque ou si l'identifiant n'est pas un nombre
/// strictement positif : dans le doute, on n'arrête **rien**.
pub(crate) fn parse_pid_file(raw: &str) -> Option<(u32, String)> {
    let mut lines = raw.lines().map(str::trim).filter(|l| !l.is_empty());
    let pid = lines.next()?.parse::<u32>().ok().filter(|p| *p > 0)?;
    let name = lines.next()?;
    Some((pid, name.to_string()))
}

/// Dernier segment d'un chemin (nom du fichier). PURE.
pub(crate) fn exe_file_name(exe_path: &str) -> String {
    exe_path
        .trim()
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .to_string()
}

/// Vrai si le nom de processus observé est bien celui attendu : comparaison sur
/// le dernier segment de chemin, insensible à la casse. PURE.
pub(crate) fn name_matches(observed: &str, expected: &str) -> bool {
    let base = exe_file_name(observed);
    !base.is_empty() && base.eq_ignore_ascii_case(expected.trim())
}

/// Lit la trace disque. Toute erreur (fichier absent, illisible) = `None`.
pub(crate) fn read_pid_file(path: &Path) -> Option<(u32, String)> {
    parse_pid_file(&std::fs::read_to_string(path).ok()?)
}

/// Écrit la trace disque (crée le dossier au besoin). Fail-open : toute erreur
/// d'écriture est ignorée (au pire, pas de nettoyage au démarrage suivant).
pub(crate) fn write_pid_file(path: &Path, pid: u32, exe_name: &str) {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(path, format_pid_file(pid, exe_name));
}

/// Efface la trace disque. Fail-open.
pub(crate) fn clear_pid_file(path: &Path) {
    let _ = std::fs::remove_file(path);
}

/// Extrait le nom du premier processus d'une sortie CSV de `tasklist`
/// (`"plface.exe","1234","Console",…`). `None` sur la ligne d'information
/// « aucun processus » (qui ne commence pas par un guillemet). PURE.
#[cfg(windows)]
fn parse_csv_process_name(output: &str) -> Option<String> {
    output
        .lines()
        .find_map(|line| line.trim().strip_prefix('"'))
        .and_then(|rest| rest.split('"').next())
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string)
}

/// Nom de l'image du processus `pid`, ou `None` s'il n'existe pas. Sert de
/// garde avant tout arrêt : on ne referme **jamais** un processus dont le nom
/// n'est pas celui du visage (un identifiant peut être réutilisé par une autre
/// application). Fail-open : toute erreur = `None`.
#[cfg(windows)]
fn observed_process_name(pid: u32) -> Option<String> {
    use std::os::windows::process::CommandExt;
    let mut cmd = Command::new("tasklist");
    cmd.args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"]);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    cmd.creation_flags(crate::CREATE_NO_WINDOW);
    let output = cmd.output().ok()?;
    parse_csv_process_name(&String::from_utf8_lossy(&output.stdout))
}

/// Sous Linux, l'identité ne peut pas venir de `ps -o comm=` (nom du **thread** :
/// node le renomme « MainThread ») — sinon le service Laya n'est jamais refermé.
#[cfg(target_os = "linux")]
fn observed_process_name(pid: u32) -> Option<String> {
    // `/proc/<pid>/stat` = "<pid> (<comm>) <état> …" : état ET `comm` en une
    // seule lecture. Le `comm` peut contenir espaces et parenthèses → on repart
    // de la DERNIÈRE parenthèse fermante. Fichier absent = processus disparu.
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let after = stat.rsplit(')').next().unwrap_or("").trim_start();
    let comm = stat
        .split_once('(')
        .and_then(|(_, rest)| rest.rsplit_once(')'))
        .map(|(c, _)| c.to_string())
        .unwrap_or_default();
    // `Z` (zombie) : processus mort, fichiers **fermés**, seul son code de sortie
    // reste à récolter — et `spawn_detached` n'attend jamais l'enfant, donc tout
    // service tué finit ainsi. Sans ce test, `wait_until_gone` attendait 2 s pour
    // rien et un arrêt RÉUSSI était rapporté comme un échec.
    if after.starts_with('Z') {
        return None;
    }
    // L'**image** réellement exécutée — et non `comm` (ce que rend
    // `ps -o comm=`), qui sur Linux est le nom du **thread** : node le renomme
    // (« MainThread »), le service Laya n'était alors jamais reconnu comme le
    // sien et n'était donc **jamais** refermé. `/proc/<pid>/exe` est aussi la
    // source de `current_exe()` : le nom observé et celui du propriétaire inscrit
    // dans la trace viennent du même endroit.
    let image = match std::fs::read_link(format!("/proc/{pid}/exe")) {
        Ok(path) => {
            let base = exe_file_name(&path.to_string_lossy());
            // Image remplacée sur le disque : le noyau suffixe le lien.
            base.strip_suffix(" (deleted)").unwrap_or(&base).to_string()
        }
        // Image déjà détachée mais processus encore en cours de sortie : surtout
        // ne pas le déclarer disparu (sa socket répond encore un instant).
        Err(_) => comm,
    };
    if image.is_empty() {
        None
    } else {
        Some(image)
    }
}

/// Ailleurs sous Unix (macOS/BSD), `ps -o comm=` donne bien le nom de l'image
/// (`node`) ; on écarte en plus les **zombies** (état `Z`), qu'un arrêt réussi
/// laisse listés tant que l'enfant n'est pas récolté : même raison que ci-dessus.
#[cfg(all(unix, not(target_os = "linux")))]
fn observed_process_name(pid: u32) -> Option<String> {
    if ps_field(pid, "stat=").starts_with('Z') {
        return None;
    }
    let name = ps_field(pid, "comm=");
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

/// Un champ de `ps -p <pid>` (chaîne vide si le processus n'existe pas).
#[cfg(all(unix, not(target_os = "linux")))]
fn ps_field(pid: u32, field: &str) -> String {
    Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", field])
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

/// Le processus `pid` est-il encore vivant **et** bien celui attendu ?
///
/// `false` quand le processus n'existe plus **ou** qu'un autre programme a
/// repris son identifiant (l'ancien processus a donc bel et bien disparu).
/// Sert de garde d'appartenance (service Laya) : on ne referme le service d'une
/// autre copie de Pilot que si cette copie a disparu. S'appuie sur les mêmes
/// outils système que `kill_process` (`tasklist` sous Windows, `ps` ailleurs),
/// déjà requis pour la garde de nom à l'arrêt.
pub(crate) fn owner_alive(pid: u32, expected_name: &str) -> bool {
    observed_process_name(pid).is_some_and(|name| name_matches(&name, expected_name))
}

/// Attend (borné à 2 s) que le processus `pid` disparaisse des tables du
/// système, puis dit s'il est bien parti.
///
/// `taskkill`/`kill` rendent la main **avant** que le système n'ait retiré le
/// processus : un service qui vient de charger 1,6 Gio de modèle reste listé
/// ~200 ms après un arrêt RÉUSSI (mesuré : présent à +100 ms, absent à +200 ms).
/// Sans cette attente, un arrêt réussi était rapporté comme un échec. Sous Unix,
/// un enfant tué que Pilot ne récolte pas reste listé comme **zombie** :
/// `observed_process_name` le déclare alors disparu (cf. sa note par plateforme).
fn wait_until_gone(pid: u32) -> bool {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
    loop {
        if observed_process_name(pid).is_none() {
            return true;
        }
        if std::time::Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
}

/// Arrête le processus `pid` **uniquement s'il s'agit bien du visage**
/// (`expected_name`). Renvoie `true` quand le processus visé n'existe plus
/// après la tentative (déjà terminé, nom différent, ou arrêté). Jamais bloquant
/// (au plus 2 s, le temps que le processus disparaisse des tables).
///
/// Réutilisé tel quel par `laya.rs` : la garde de nom (ne jamais arrêter une
/// autre application dont l'identifiant aurait été réutilisé) est la même pour
/// tout processus lancé par Pilot.
#[cfg(windows)]
pub(crate) fn kill_process(pid: u32, expected_name: &str) -> bool {
    use std::os::windows::process::CommandExt;
    match observed_process_name(pid) {
        Some(name) if name_matches(&name, expected_name) => {}
        // Rien à arrêter : le pid appartient à une autre application (réutilisé)
        // ou le visage est déjà terminé.
        _ => return true,
    }
    let mut cmd = Command::new("taskkill");
    cmd.args(["/PID", &pid.to_string(), "/T", "/F"]);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    cmd.creation_flags(crate::CREATE_NO_WINDOW);
    let _ = cmd.status();
    wait_until_gone(pid)
}

#[cfg(not(windows))]
pub(crate) fn kill_process(pid: u32, expected_name: &str) -> bool {
    match observed_process_name(pid) {
        Some(name) if name_matches(&name, expected_name) => {}
        _ => return true,
    }
    let _ = Command::new("kill")
        .args(["-9", &pid.to_string()])
        .status();
    wait_until_gone(pid)
}

/// Arrête le visage **que Pilot a lancé**, d'après le fichier de trace :
/// - aucune trace → Pilot n'a rien lancé → ne touche à rien (`NotRunning`) ; un
///   visage ouvert à la main par la personne n'est donc jamais refermé ;
/// - trace présente → arrêt propre (`GET /close`, best effort borné) puis arrêt
///   du processus (garde sur le nom : jamais une autre application), trace
///   effacée.
///
/// Appelé à la **fermeture de Pilot** (le visage ne doit pas lui survivre et
/// verrouiller un fichier du dossier de compilation) et **au démarrage
/// suivant** (nettoyage d'un visage resté en vie après une fermeture brutale).
/// Jamais bloquant au-delà de `PROBE_TIMEOUT`, jamais d'erreur remontée.
pub(crate) fn stop_owned(pid_path: &Path) -> PlfaceStopOutcome {
    let Some((pid, name)) = read_pid_file(pid_path) else {
        return PlfaceStopOutcome::NotRunning;
    };
    if probe_api(PLFACE_API_HOST, PLFACE_API_PORT, PROBE_TIMEOUT) {
        let _ = request_close(PLFACE_API_HOST, PLFACE_API_PORT, PROBE_TIMEOUT);
    }
    let stopped = kill_process(pid, &name);
    clear_pid_file(pid_path);
    if stopped {
        PlfaceStopOutcome::Closed
    } else {
        PlfaceStopOutcome::Failed
    }
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
/// - retourne l'identifiant du processus lancé, pour le tracer (`stop_owned`) ;
/// - `--avatar <chemin>` n'est ajouté que si un modèle est renseigné ;
/// - `--no-taskbar` est **toujours** transmis : un lancement par Pilot demande
///   au visage de ne pas figurer dans la barre des tâches Windows (mode discret).
///   Un visage lancé à la main par la personne reste visible comme avant ;
/// - sans fenêtre de console sous Windows (`CREATE_NO_WINDOW`) ;
/// - stdio redirigé vers `null` (aucune sortie parasite) ;
/// - l'enfant n'est jamais attendu : c'est Pilot qui le referme (`stop_owned`),
///   à sa fermeture comme au démarrage suivant.
///
/// Multiplateforme : seule la neutralisation de la console est spécifique à
/// Windows (`creation_flags`) ; macOS/Linux lancent l'exécutable normalement.
pub(crate) fn spawn_detached(exe_path: &str, avatar: Option<&str>) -> std::io::Result<u32> {
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

    // Le `Child` est abandonné (jamais `wait`), mais son identifiant est tracé
    // (`pid_path`) : le visage lancé par Pilot est refermé par Pilot.
    let child = cmd.spawn()?;
    Ok(child.id())
}

/// Orchestrateur non pur : sonde l'API puis lance si nécessaire.
/// `pid_path` (facultatif) : fichier de trace où inscrire le processus lancé,
/// afin que Pilot puisse le refermer plus tard. Jamais bloquant au-delà de
/// `PROBE_TIMEOUT`, jamais d'erreur remontée.
pub(crate) fn launch_if_needed(
    enabled: bool,
    exe_path: &str,
    avatar: Option<&str>,
    pid_path: Option<&Path>,
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
            Ok(pid) => {
                if let Some(path) = pid_path {
                    write_pid_file(path, pid, &exe_file_name(trimmed));
                }
                PlfaceLaunchOutcome::Launched
            }
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
            launch_if_needed(false, "", None, None),
            PlfaceLaunchOutcome::Disabled
        );
        assert_eq!(
            launch_if_needed(true, "   ", None, None),
            PlfaceLaunchOutcome::Disabled
        );
    }

    #[test]
    fn launch_if_needed_missing_exe_reports_not_found() {
        // Chemin renseigné mais introuvable, API muette → pas de lancement.
        let outcome = launch_if_needed(true, "/chemin/qui/n-existe-pas/plface-xyz", None, None);
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

    #[test]
    fn parse_pid_file_reads_pid_then_program_name() {
        assert_eq!(
            parse_pid_file("1234\nplface.exe\n"),
            Some((1234, "plface.exe".to_string()))
        );
        assert_eq!(
            parse_pid_file("  42 \n C:\\PLface\\PLface.exe \n"),
            Some((42, "C:\\PLface\\PLface.exe".to_string()))
        );
    }

    #[test]
    fn parse_pid_file_refuses_empty_or_incomplete() {
        // Sans identifiant exploitable ET nom de programme, on ne sait pas à
        // quoi l'identifiant correspond : on refuse d'arrêter quoi que ce soit.
        assert_eq!(parse_pid_file(""), None);
        assert_eq!(parse_pid_file("1234"), None);
        assert_eq!(parse_pid_file("abc\nplface.exe"), None);
        assert_eq!(parse_pid_file("0\nplface.exe"), None);
    }

    #[test]
    fn name_matches_compares_file_names_case_insensitively() {
        assert!(name_matches("plface.exe", "plface.exe"));
        assert!(name_matches("PLFACE.EXE", "plface.exe"));
        assert!(name_matches("C:\\PLface\\plface.exe", "plface.exe"));
        assert!(!name_matches("notepad.exe", "plface.exe"));
        assert!(!name_matches("", "plface.exe"));
    }

    #[test]
    fn exe_file_name_keeps_last_segment() {
        assert_eq!(exe_file_name("C:\\PLface\\plface.exe"), "plface.exe");
        assert_eq!(exe_file_name("/opt/plface/plface"), "plface");
    }

    #[test]
    fn pid_file_round_trip_and_clear() {
        let path = std::env::temp_dir().join(format!(
            "pilot-plface-test-{}-round-trip.pid",
            std::process::id()
        ));
        clear_pid_file(&path);
        assert_eq!(read_pid_file(&path), None);
        write_pid_file(&path, 4242, "plface.exe");
        assert_eq!(read_pid_file(&path), Some((4242, "plface.exe".to_string())));
        clear_pid_file(&path);
        assert_eq!(read_pid_file(&path), None);
    }

    #[test]
    fn stop_owned_does_nothing_without_trace() {
        // Aucune trace = aucun visage lancé par Pilot : Pilot ne referme jamais
        // un visage ouvert à la main par la personne.
        let path = std::env::temp_dir().join(format!(
            "pilot-plface-test-{}-absent.pid",
            std::process::id()
        ));
        clear_pid_file(&path);
        assert_eq!(stop_owned(&path), PlfaceStopOutcome::NotRunning);
    }

    // Sortie réelle de `tasklist /FI "PID eq <pid>" /FO CSV /NH` (Windows) :
    // la garde de nom s'appuie dessus pour ne jamais arrêter une autre
    // application dont l'identifiant aurait été réutilisé.
    #[cfg(windows)]
    #[test]
    fn parse_csv_process_name_reads_tasklist_output() {
        let real = "\"explorer.exe\",\"11824\",\"RDP-Tcp#5\",\"2\",\"200 876 Ko\"\r\n";
        assert_eq!(parse_csv_process_name(real), Some("explorer.exe".to_string()));
        // Ligne d'information (locale française sur ce poste) : aucun processus.
        let none = "Information : aucune tâche en service ne correspond aux critères spécifiés.";
        assert_eq!(parse_csv_process_name(none), None);
        assert_eq!(parse_csv_process_name(""), None);
    }

    // Preuve réelle de l'arrêt, sur un processus témoin lancé par le test
    // lui-même (jamais une application de la personne) : la garde de nom refuse
    // d'arrêter un processus qui n'est pas le visage, et l'arrêt aboutit quand le
    // nom correspond.
    #[cfg(windows)]
    #[test]
    fn kill_process_spares_other_names_and_stops_matching_process() {
        let mut witness = std::process::Command::new("cmd")
            .args(["/C", "ping -n 30 127.0.0.1 > NUL"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("processus témoin");
        let pid = witness.id();

        // Nom différent (identifiant réutilisé par une autre application) : la
        // garde refuse et le processus témoin survit.
        assert!(kill_process(pid, "pas-le-visage.exe"));
        assert!(witness.try_wait().unwrap().is_none(), "témoin survivant");

        // Nom attendu : le processus est bien arrêté.
        assert!(kill_process(pid, "cmd.exe"));
        assert!(kill_process(pid, "cmd.exe"));
        let _ = witness.wait();
    }
}
