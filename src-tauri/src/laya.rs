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
//! - **arrêt** : uniquement le processus tracé (`laya.pid`) **et uniquement
//!   celui que CETTE copie a lancé** (la trace porte le propriétaire) ;
//! - **trace** : `<app_data_dir>/laya.pid` (service : identifiant + nom de
//!   programme ; propriétaire : identifiant + nom de programme de Pilot) ;
//! - **journal** : `<app_data_dir>/laya.log` (sortie standard ET d'erreur du
//!   service, pour que « pourquoi il n'a pas démarré » soit lisible).
//!
//! Deux copies de Pilot ouvertes en même temps partagent la trace : le nettoyage
//! du démarrage ne referme donc un service restant que si son propriétaire n'est
//! PLUS vivant ; une copie vivante garde le sien, et la nouvelle la réutilise.
//!
//! Limites assumées : le nom de programme tracé est celui de l'interpréteur
//! (`node.exe`), pas du script — la garde de nom seule ne distingue donc pas
//! deux processus `node` ; c'est le couple trace/pid qui garantit qu'on ne
//! referme pas le service du propriétaire (lancé à la main, jamais tracé).
//!
//! **Version livrée** : le service, l'interpréteur et le moteur d'inférence sont
//! embarqués dans les ressources de l'application (`$RESOURCE/laya/…`).
//! L'interpréteur se choisit dans cet ordre : chemin réglé à la main, puis
//! interpréteur embarqué, puis `node` du système. Le dossier du modèle par
//! défaut bascule vers le dossier de **données** de l'application (inscriptible)
//! quand le service est celui des ressources : la version livrée ne s'écrit
//! jamais dans elle-même.

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
/// Journal du service (sortie standard ET d'erreur), à côté de la trace.
pub(crate) const LOG_FILE_NAME: &str = "laya.log";
/// Sous-dossier des ressources embarquées dans la version livrée
/// (`$RESOURCE/laya/…`, cf. `bundle.resources` et `scripts/prepare-laya.js`).
pub(crate) const RESOURCE_DIR: &str = "laya";
/// Nom du service embarqué, dans le sous-dossier de ressources.
pub(crate) const DEFAULT_SERVICE_FILE: &str = "laya-service.mjs";
/// Sous-dossier de l'interpréteur embarqué, dans le sous-dossier de ressources.
pub(crate) const NODE_DIR: &str = "node";
/// Timeout de sonde réseau : strictement inférieur à 1 seconde.
pub(crate) const PROBE_TIMEOUT: Duration = Duration::from_millis(400);
/// Délai maximal accordé au service pour répondre après le lancement.
pub(crate) const READY_DEADLINE: Duration = Duration::from_secs(3);
/// Intervalle entre deux sondes pendant l'attente.
const PROBE_INTERVAL: Duration = Duration::from_millis(200);
/// Route d'état du service (`{"ready":bool,"model":...}`).
const STATUS_ROUTE: &str = "/status";
/// Route de classification du service (`{"ok":bool,"answers":{...},"ms":int}`).
const CLASSIFY_ROUTE: &str = "/classify";
/// Délai maximal d'un appel de classification : le PREMIER appel charge le
/// modèle (≈ 2,5 s mesurés), les suivants répondent en ≈ 0,1 s. Large à dessein
/// pour ne jamais couper un chargement légitime, borné pour ne jamais bloquer
/// l'appelant indéfiniment.
pub(crate) const CLASSIFY_TIMEOUT: Duration = Duration::from_secs(30);
/// Taille maximale d'une réponse HTTP courte lue sur le service (garde-fou :
/// aucune lecture non bornée).
const MAX_HTTP_BODY: usize = 64 * 1024;
/// Message de panne du service (jamais un nom technique nu).
pub(crate) const SERVICE_DOWN_MESSAGE: &str =
    "Le service Laya ne répond pas (service éteint ou injoignable sur la boucle locale).";

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

/// Nom de l'interpréteur installé avec le système d'exploitation (utilisé quand
/// aucun interpréteur embarqué ni réglé à la main n'est disponible), tel qu'il
/// apparaît dans la table des processus.
pub(crate) fn node_exe_name() -> &'static str {
    if cfg!(windows) {
        "node.exe"
    } else {
        "node"
    }
}

/// Chemin effectif du service. PURE : un chemin réglé à la main gagne sur la
/// ressource embarquée (`None` = paquet sans Laya). Un chemin vide désactive le
/// lancement (comportement inchangé) ; l'existence réelle du fichier est vérifiée
/// au moment du lancement.
pub(crate) fn resolve_service_path(configured: &str, embedded: Option<&str>) -> String {
    let trimmed = configured.trim();
    if !trimmed.is_empty() {
        return trimmed.to_string();
    }
    embedded.unwrap_or("").to_string()
}

/// Chemin effectif de l'INTERPRÉTEUR qui exécute le service. PURE, par ordre de
/// priorité : 1. chemin réglé à la main ; 2. interpréteur embarqué dans les
/// ressources ; 3. `None` → `node` du système (résolu par le système via `PATH`).
pub(crate) fn resolve_node_path(configured: &str, embedded: Option<&str>) -> Option<String> {
    let trimmed = configured.trim();
    if !trimmed.is_empty() {
        return Some(trimmed.to_string());
    }
    embedded.map(|p| p.to_string())
}

/// Nom de programme attendu par la garde d'arrêt, déduit de l'interpréteur
/// utilisé : nom de fichier de l'interpréteur réglé à la main, sinon le nom de
/// l'interpréteur (`node.exe`). Un nom sans extension (interpréteur lancé via
/// `PATH`) prend l'extension du système : sous Windows le processus s'appelle
/// `node.exe`, un nom tracé « node » ne serait pas reconnu à l'arrêt. PURE.
pub(crate) fn process_name_for(node_path: Option<&str>) -> String {
    let name = node_path
        .and_then(|p| Path::new(p.trim()).file_name())
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    if name.is_empty() {
        return node_exe_name().to_string();
    }
    if cfg!(windows) && !name.contains('.') {
        return format!("{name}.exe");
    }
    name
}

/// Découpe une réponse HTTP/1.1 courte et renvoie son corps, **dé-encodé** si le
/// serveur répond en morceaux (`Transfer-Encoding: chunked`, ce que fait le
/// service Laya sur `/classify`). PURE : `None` si la réponse n'est pas du HTTP
/// ou si les en-têtes ne sont pas complets.
fn json_body(text: &str) -> Option<String> {
    if !text.starts_with("HTTP/") {
        return None;
    }
    let head = text.find("\r\n\r\n")?;
    let (headers, body) = text.split_at(head);
    let body = &body[4..];
    if headers.to_ascii_lowercase().contains("transfer-encoding: chunked") {
        return Some(dechunk(body));
    }
    Some(body.to_string())
}

/// Assemble les morceaux d'un corps `chunked` : « taille hexa CRLF données
/// CRLF », terminé par un morceau de taille 0. Un morceau incomplet (ou une
/// taille illisible) arrête l'assemblage : le texte obtenu est alors tronqué et
/// la lecture reprend (`read_http_body`). Les prolongations éventuelles sont
/// ignorées.
fn dechunk(body: &str) -> String {
    let mut out = String::new();
    let mut rest = body;
    loop {
        let Some((size, tail)) = rest.split_once("\r\n") else {
            break;
        };
        let Ok(n) = usize::from_str_radix(size.trim(), 16) else {
            break;
        };
        if n == 0 {
            break;
        }
        if tail.len() < n {
            out.push_str(tail);
            break;
        }
        out.push_str(&tail[..n]);
        rest = tail[n..].strip_prefix("\r\n").unwrap_or(&tail[n..]);
    }
    out
}

/// Lit une réponse HTTP courte : on s'arrête dès que le corps est un JSON
/// COMPLET (`serde_json` accepte le corps entier, accolades imbriquées
/// comprises) — le service peut garder la connexion ouverte après sa réponse.
/// Lecture bornée à `max` octets ; toute erreur de flux termine la lecture.
fn read_http_body(stream: &mut std::net::TcpStream, max: usize) -> Vec<u8> {
    use std::io::Read;

    let mut raw: Vec<u8> = Vec::new();
    let mut buf = [0u8; 1024];
    loop {
        match stream.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => raw.extend_from_slice(&buf[..n]),
        }
        let text = String::from_utf8_lossy(&raw);
        if let Some(body) = json_body(&text) {
            if serde_json::from_str::<serde_json::Value>(&body).is_ok() {
                break;
            }
        }
        if raw.len() >= max {
            break;
        }
    }
    raw
}

/// Classe un texte auprès d'un service Laya (fonction non pure, testable) :
/// `POST /classify {"text","questions"}`. Renvoie le corps JSON COMPLET du
/// service (`{"ok":true,"answers":{...},"ms":N}`).
///
/// Toute panne (service éteint, modèle non prêt, réponse illisible, HTTP 4xx/5xx)
/// est une `Err` au message clair : jamais de panique, jamais de blocage au-delà
/// du délai, aucune écriture (ni sur le service, ni sur le disque).
pub(crate) fn classify_at(
    host: &str,
    port: u16,
    text: &str,
    questions: &serde_json::Value,
    timeout: Duration,
) -> Result<serde_json::Value, String> {
    use std::io::Write;
    use std::net::{TcpStream, ToSocketAddrs};

    if questions.is_null() {
        return Err("Question manquante : 'questions' est obligatoire.".to_string());
    }
    let body = serde_json::json!({ "text": text, "questions": questions }).to_string();
    let Some(addr) = (host, port).to_socket_addrs().ok().and_then(|mut a| a.next()) else {
        return Err(SERVICE_DOWN_MESSAGE.to_string());
    };
    // Le CONNECT est borné court (comme la sonde) : sur certaines plateformes un
    // port fermé ne refuse pas la connexion, il laisse expirer le délai — sans
    // cette borne, « service éteint » se paierait au prix du délai de RÉPONSE.
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, timeout.min(PROBE_TIMEOUT)) else {
        return Err(SERVICE_DOWN_MESSAGE.to_string());
    };
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));

    let request = format!(
        "POST {CLASSIFY_ROUTE} HTTP/1.1\r\nHost: {host}:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return Err(SERVICE_DOWN_MESSAGE.to_string());
    }

    let raw = read_http_body(&mut stream, MAX_HTTP_BODY);
    let text = String::from_utf8_lossy(&raw);
    let Some(body) = json_body(&text) else {
        return Err(SERVICE_DOWN_MESSAGE.to_string());
    };
    let status: u16 = text
        .get(9..12)
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&body) else {
        return Err("Réponse illisible du service Laya.".to_string());
    };
    if status >= 400 || parsed.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        let detail = parsed
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("erreur inconnue");
        return Err(format!(
            "Le service Laya n'a pas pu classer (HTTP {status}) : {detail}"
        ));
    }
    Ok(parsed)
}

/// Classe un texte auprès du service Laya réel (`127.0.0.1:3017`).
pub(crate) fn classify(
    text: &str,
    questions: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    classify_at(LAYA_API_HOST, LAYA_API_PORT, text, questions, CLASSIFY_TIMEOUT)
}

/// Sonde `/status` du service (HTTP/1.1, timeout court) : `reachable` dès qu'une
/// réponse HTTP est reçue, `ready` si le corps annonce le modèle chargé. Toute
/// erreur réseau = muet (jamais bloquant au-delà du timeout).
pub(crate) fn probe_status(host: &str, port: u16, timeout: Duration) -> LayaProbe {
    use std::io::Write;
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

    // Le service peut garder la connexion ouverte : on s'arrête dès que le corps
    // JSON est COMPLET (accolades imbriquées comprises), pas à la fermeture.
    let raw = read_http_body(&mut stream, MAX_HTTP_BODY);

    let text = String::from_utf8_lossy(&raw);
    let Some(body) = json_body(&text) else {
        return LayaProbe::DOWN;
    };
    LayaProbe {
        reachable: true,
        ready: status_ready(&body),
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
/// `<interpréteur> <service_path> <model_dir>`, sans fenêtre de console sous
/// Windows. Le répertoire courant est celui du service (le dossier de modèle
/// configuré peut ainsi être relatif, comme à la main). Renvoie l'identifiant du
/// processus lancé, pour la trace.
///
/// La sortie standard ET la sortie d'erreur vont dans `log_path` (fichier
/// journal, ouvert en ajout) : sans lui, l'échec de démarrage du service restait
/// invisible. Si le journal ne peut pas être ouvert, on retombe sur `null`
/// (jamais bloquant, jamais de panne remontée).
///
/// `node` : interpréteur effectif (`laya_node_path` → embarqué → `node` du
/// système, cf. `resolve_node_path`).
pub(crate) fn spawn_detached(
    node: &str,
    service_path: &str,
    model_dir: &str,
    log_path: Option<&Path>,
) -> std::io::Result<u32> {
    let mut cmd = Command::new(node);
    cmd.arg(service_path).arg(model_dir);
    if let Some(dir) = Path::new(service_path).parent() {
        cmd.current_dir(dir);
    }
    cmd.stdin(Stdio::null());
    match log_path.and_then(open_log) {
        Some(log) => match log.try_clone() {
            Ok(err) => {
                cmd.stdout(Stdio::from(log)).stderr(Stdio::from(err));
            }
            Err(_) => {
                cmd.stdout(Stdio::null()).stderr(Stdio::null());
            }
        },
        None => {
            cmd.stdout(Stdio::null()).stderr(Stdio::null());
        }
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(crate::CREATE_NO_WINDOW);
    }

    // Le `Child` est abandonné (jamais `wait`), mais son identifiant est tracé
    // (`laya.pid`) : le service lancé par Pilot est refermé par Pilot.
    write_log_header(log_path, node, service_path, model_dir);
    Ok(cmd.spawn()?.id())
}

/// Ouvre le journal en AJOUT (le crée au besoin). `None` si le dossier ou le
/// fichier est inaccessible : fail-open, jamais bloquant.
fn open_log(path: &Path) -> Option<std::fs::File> {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    std::fs::OpenOptions::new().create(true).append(true).open(path).ok()
}

/// Écrit un repère de tentative de démarrage en tête du journal (pour qu'un
/// journal contenant plusieurs essais reste lisible). Fail-open : toute erreur
/// d'écriture est ignorée.
fn write_log_header(log_path: Option<&Path>, node: &str, service_path: &str, model_dir: &str) {
    use std::io::Write;

    let Some(path) = log_path else { return };
    let Some(mut file) = open_log(path) else { return };
    let _ = writeln!(file, "\n=== démarrage : {node} {service_path} {model_dir} ===");
}

/// Orchestrateur non pur : sonde, décide, lance, puis attend (≤ 3 s) que le
/// service réponde. Jamais bloquant au-delà du délai d'attente, jamais d'erreur
/// remontée : un utilisateur sans service Laya ne voit aucune différence.
pub(crate) fn launch_if_needed(
    enabled: bool,
    service_path: &str,
    node_path: Option<&str>,
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
        LayaDecision::Launch => {
            // Interpréteur : réglé à la main, sinon embarqué, sinon celui du
            // système (nom nu, résolu par le système d'exploitation via PATH).
            let node = resolve_node_path(node_path.unwrap_or(""), None)
                .unwrap_or_else(|| node_exe_name().to_string());
            // Le journal vit à côté de la trace (même dossier de données).
            let log_path = pid_path.map(|p| p.with_file_name(LOG_FILE_NAME));
            match spawn_detached(&node, trimmed, model_dir.trim(), log_path.as_deref()) {
                Ok(pid) => {
                    if let Some(path) = pid_path {
                        // La trace dit AUSSI à qui appartient ce service : c'est
                        // ce qui permet de ne jamais refermer celui d'une autre
                        // copie de Pilot encore ouverte (cf. `stop_owned` /
                        // `cleanup_stale`).
                        write_trace(
                            path,
                            &LayaTrace {
                                pid,
                                name: process_name_for(Some(&node)),
                                owner_pid: std::process::id(),
                                owner_name: owner_process_name(),
                            },
                        );
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
            }
        }
    }
}

/// Propriétaire d'un service lancé par Pilot, tel qu'inscrit dans la trace.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LayaTrace {
    /// Identifiant du processus du SERVICE lancé par Pilot.
    pub pid: u32,
    /// Nom de programme attendu du service (garde d'arrêt).
    pub name: String,
    /// Identifiant du processus de l'application Pilot qui a lancé le service.
    pub owner_pid: u32,
    /// Nom de programme de l'application propriétaire (contre la réutilisation
    /// d'un identifiant par une autre application).
    pub owner_name: String,
}

/// Contenu de la trace disque, quatre lignes. PURE.
pub(crate) fn format_trace(trace: &LayaTrace) -> String {
    format!(
        "{}\n{}\n{}\n{}\n",
        trace.pid, trace.name, trace.owner_pid, trace.owner_name
    )
}

/// Lit la trace disque : `None` si l'identifiant du service manque/est illisible
/// **ou si le propriétaire n'est pas inscrit** (trace d'une ancienne version :
/// dans le doute, on ne referme RIEN — jamais le service d'une autre copie de
/// Pilot encore ouverte). PURE.
pub(crate) fn parse_trace(raw: &str) -> Option<LayaTrace> {
    let lines: Vec<&str> = raw
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    let pid = lines.first()?.parse::<u32>().ok().filter(|p| *p > 0)?;
    let name = lines.get(1)?.to_string();
    let owner_pid = lines
        .get(2)?
        .parse::<u32>()
        .ok()
        .filter(|p| *p > 0)?;
    let owner_name = lines.get(3).unwrap_or(&"").to_string();
    Some(LayaTrace {
        pid,
        name,
        owner_pid,
        owner_name,
    })
}

/// Lit la trace disque. Toute erreur (fichier absent, illisible) = `None`.
pub(crate) fn read_trace(path: &Path) -> Option<LayaTrace> {
    parse_trace(&std::fs::read_to_string(path).ok()?)
}

/// Écrit la trace disque (crée le dossier au besoin). Fail-open : toute erreur
/// d'écriture est ignorée (au pire, pas de nettoyage au démarrage suivant).
pub(crate) fn write_trace(path: &Path, trace: &LayaTrace) {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(path, format_trace(trace));
}

/// Nom de programme de l'application Pilot en cours (propriétaire inscrit dans
/// la trace). PURE vis-à-vis du processus : lit seulement son propre chemin.
pub(crate) fn owner_process_name() -> String {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_string()))
        .unwrap_or_default()
}

/// Décision PURE de **nettoyage au démarrage** : faut-il refermer le service
/// restant ?
///
/// - trace absente/illisible (`owner = None`) → non, on ne touche à rien ;
/// - trace qui nous appartient (relance interne) → oui ;
/// - propriétaire encore VIVANT (autre copie de Pilot ouverte) → non, sa trace
///   reste : c'est LUI qui le refermera, et la nouvelle copie le réutilise ;
/// - propriétaire mort → oui : service orphelin d'une fermeture brutale.
pub(crate) fn decide_startup_cleanup(
    owner: Option<u32>,
    owner_alive: bool,
    self_pid: u32,
) -> bool {
    match owner {
        None => false,
        Some(pid) if pid == self_pid => true,
        Some(_) => !owner_alive,
    }
}

/// Décision PURE d'**arrêt à la fermeture** : on ne referme QUE le service que
/// CETTE copie de Pilot a lancé (trace portant son identifiant). PURE.
pub(crate) fn decide_shutdown_stop(owner: Option<u32>, self_pid: u32) -> bool {
    owner == Some(self_pid)
}

/// Referme le service décrit par la trace (garde de nom : jamais une autre
/// application) et efface la trace. Jamais bloquant au-delà de l'arrêt borné.
fn kill_traced(trace: &LayaTrace, pid_path: &Path) -> bool {
    let stopped = crate::plface::kill_process(trace.pid, &trace.name);
    crate::plface::clear_pid_file(pid_path);
    stopped
}

/// Arrête **le service que CETTE copie de Pilot a lancé** (fermeture de
/// l'application) :
/// - aucune trace → rien à faire (`true`) ; un service ouvert à la main par le
///   propriétaire n'est donc jamais refermé ;
/// - trace appartenant à une autre copie (encore ouverte ou non) → on n'y touche
///   pas : c'est son propriétaire qui la referme (règle unique, cf.
///   `decide_shutdown_stop`).
///
/// Jamais bloquant au-delà de l'arrêt borné, jamais d'erreur remontée.
pub(crate) fn stop_owned(pid_path: &Path) -> bool {
    let Some(trace) = read_trace(pid_path) else {
        return true;
    };
    if !decide_shutdown_stop(Some(trace.owner_pid), std::process::id()) {
        return true;
    }
    kill_traced(&trace, pid_path)
}

/// **Nettoyage au démarrage suivant** : referme un service resté en vie après
/// une fermeture brutale, mais JAMAIS celui d'une autre copie de Pilot encore
/// vivante (règle unique, cf. `decide_startup_cleanup`) : dans ce cas la trace
/// est laissée intacte et le service qui répond est réutilisé tel quel.
/// Jamais bloquant, jamais d'erreur remontée.
pub(crate) fn cleanup_stale(pid_path: &Path) -> bool {
    let Some(trace) = read_trace(pid_path) else {
        return true;
    };
    // Propriétaire sans nom inscrit : impossible de vérifier qu'il est mort →
    // on ne referme rien (règle de prudence).
    if trace.owner_name.trim().is_empty() {
        return true;
    }
    let alive = crate::plface::owner_alive(trace.owner_pid, &trace.owner_name);
    if !decide_startup_cleanup(Some(trace.owner_pid), alive, std::process::id()) {
        return true;
    }
    kill_traced(&trace, pid_path)
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
    /// Le service est EMBARQUÉ dans les ressources de ce paquet, indépendamment
    /// des réglages : `false` sur un paquet construit sans Laya (l'interface peut
    /// alors le DIRE au lieu de rester muette).
    pub embedded: bool,
    /// Dernière issue connue du contrôle de démarrage (`null` avant la fin).
    pub outcome: Option<LayaOutcome>,
}

/// Compose l'état courant : configuration déclarée + sonde live + dernière
/// issue de démarrage. Aucune écriture, aucune modification du service.
pub(crate) fn status(
    enabled: bool,
    service_path: &str,
    model_dir: &str,
    embedded: bool,
) -> LayaStatus {
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
        embedded,
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
            launch_if_needed(false, "", None, "", None),
            LayaOutcome::Disabled
        );
        assert_eq!(
            launch_if_needed(true, "  ", None, "G:\\IA_PL\\LayaPL\\model-ml", None),
            LayaOutcome::Disabled
        );
    }

    #[test]
    fn launch_if_needed_url_reports_invalid_path() {
        assert_eq!(
            launch_if_needed(true, "https://exemple.test/laya-service.mjs", None, ".", None),
            LayaOutcome::InvalidPath
        );
    }

    #[test]
    fn launch_if_needed_missing_service_never_launches() {
        let outcome = launch_if_needed(
            true,
            "/chemin/qui/n-existe-pas/laya-service.mjs",
            None,
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
        let st = status(false, "", "", false);
        assert!(!st.configured);
        assert!(!st.embedded);
    }

    #[test]
    fn status_exposes_whether_the_service_is_embedded() {
        // Paquet livré AVEC Laya : service embarqué mais service pas encore
        // lancé → `embedded=true` (l'interface peut expliquer l'attente).
        let st = status(true, "/ressources/laya/laya-service.mjs", "/donnees/model-ml", true);
        assert!(st.embedded);
    }

    #[test]
    fn absent_configuration_defaults_to_the_whole_chain_enabled() {
        // Configuration absente (ancien config.json) : sans rien régler, la
        // chaîne complète doit fonctionner — démarrage du service ET
        // téléchargement du modèle activés par défaut, chemins vides (= ceux du
        // paquet embarqué, calculés à l'exécution).
        let cfg: crate::AppConfig = serde_json::from_str("{}").expect("config par défaut");
        assert!(cfg.laya_autostart_enabled);
        assert!(cfg.laya_model_auto_download_enabled);
        assert!(cfg.laya_service_path.is_empty());
        assert!(cfg.laya_model_dir.is_empty());
        assert!(cfg.laya_node_path.is_empty());
        assert!(cfg.laya_model_base_url.is_empty());
    }

    #[test]
    fn an_explicitly_disabled_flag_stays_disabled() {
        // Un config.json qui stocke explicitement `false` n'est PAS écrasé par
        // le nouveau défaut (aucun réglage n'est remis en route contre l'avis de
        // son propriétaire).
        let cfg: crate::AppConfig =
            serde_json::from_str(r#"{"laya_autostart_enabled":false,"laya_model_auto_download_enabled":false}"#)
                .expect("config explicite");
        assert!(!cfg.laya_autostart_enabled);
        assert!(!cfg.laya_model_auto_download_enabled);
    }

    // Interpréteur : chemin réglé à la main → embarqué → `node` du système.
    #[test]
    fn interpreter_priority_is_manual_then_embedded_then_system() {
        assert_eq!(
            resolve_node_path("C:\\outils\\node.exe", Some("/ressources/laya/node/node")),
            Some("C:\\outils\\node.exe".to_string())
        );
        assert_eq!(
            resolve_node_path("  ", Some("/ressources/laya/node/node")),
            Some("/ressources/laya/node/node".to_string())
        );
        assert_eq!(resolve_node_path("", None), None);
    }

    #[test]
    fn service_path_priority_is_manual_then_embedded() {
        assert_eq!(
            resolve_service_path("/home/moi/laya-service.mjs", Some("/ressources/laya/laya-service.mjs")),
            "/home/moi/laya-service.mjs"
        );
        assert_eq!(
            resolve_service_path("", Some("/ressources/laya/laya-service.mjs")),
            "/ressources/laya/laya-service.mjs"
        );
        // Paquet sans Laya et rien de réglé : chemin vide → aucun lancement.
        assert_eq!(resolve_service_path("  ", None), "");
    }

    #[test]
    fn traced_process_name_follows_the_interpreter_used() {
        // Interpréteur embarqué/du système : le nom du fichier est celui tracé.
        assert_eq!(
            process_name_for(Some("/ressources/laya/node/node.exe")),
            "node.exe"
        );
        assert_eq!(process_name_for(Some("node")), node_exe_name());
        // Aucun interpréteur résolu : nom par défaut du système.
        assert_eq!(process_name_for(None), node_exe_name());
    }

    #[test]
    fn pid_file_round_trip_uses_node_process_name() {
        let path = std::env::temp_dir().join(format!(
            "pilot-laya-test-{}-round-trip.pid",
            std::process::id()
        ));
        crate::plface::clear_pid_file(&path);
        crate::plface::write_pid_file(&path, 4242, node_exe_name());
        assert_eq!(
            crate::plface::read_pid_file(&path),
            Some((4242, node_exe_name().to_string()))
        );
        crate::plface::clear_pid_file(&path);
        assert_eq!(crate::plface::read_pid_file(&path), None);
    }

    /// Service de test : un vrai serveur HTTP node sur le port du service, qui
    /// annonce son modèle chargé — même contrat que `laya-service.mjs` (arguments
    /// `[script, dossier-modèle]`, route `/status`).
    const FAKE_SERVICE_SOURCE: &str = r#"import http from "node:http";
http.createServer((req, res) => {
  if (req.url === "/status") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ready: true, model: process.argv[2] ?? "" }));
  } else { res.writeHead(404); res.end(); }
}).listen(3017, "127.0.0.1");
"#;

    /// Chaîne RÉELLE (vrai processus, vrai port, vraie trace) : état honnête
    /// quand le modèle manque, démarrage, trace du pid, service déjà vivant
    /// jamais doublé, arrêt propre. Sauté si `node` est absent ; réduit au seul
    /// « jamais doublé » si un service tourne déjà sur ce poste (le service réel
    /// du propriétaire n'est jamais perturbé par un test).
    /// Sérialise les deux tests qui utilisent le VRAI port du service
    /// (`127.0.0.1:3017`) : `cargo test` exécute les tests en parallèle et deux
    /// processus ne peuvent pas écouter sur le même port — sans ce verrou, un test
    /// lirait l'état du service de l'autre. Verrou empoisonné = réutilisé.
    static REAL_PORT_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn real_launch_trace_already_running_and_clean_stop() {
        let _port = REAL_PORT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let node_ok = Command::new("node")
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if !node_ok {
            eprintln!("SAUTÉ : `node` absent de la machine");
            return;
        }

        let root = std::env::temp_dir().join(format!(
            "pilot-laya-real-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&root).expect("dossier temporaire");
        let model_dir = root.join("model-ml");
        let pid_path = root.join(PID_FILE_NAME);
        let service = root.join("laya-service.mjs");
        std::fs::write(&service, FAKE_SERVICE_SOURCE).expect("service de test");
        let service = service.to_string_lossy().to_string();
        let model = model_dir.to_string_lossy().to_string();

        if probe().reachable {
            // Service réel déjà en place : jamais doublé (aucune sonde d'écriture).
            assert_eq!(
                launch_if_needed(true, &service, None, &model, Some(&pid_path)),
                LayaOutcome::AlreadyRunning
            );
            eprintln!("SAUTÉ (suite) : un service répond déjà sur {LAYA_API_HOST}:{LAYA_API_PORT}");
            let _ = std::fs::remove_dir_all(&root);
            return;
        }

        // 1) Modèle absent (fichier de service présent) : état honnête, aucune
        //    panique, aucun lancement.
        assert_eq!(
            launch_if_needed(true, &service, None, &model, Some(&pid_path)),
            LayaOutcome::InvalidPath
        );
        assert_eq!(crate::plface::read_pid_file(&pid_path), None);

        // 2) Démarrage réel : le service répond et son pid est tracé.
        std::fs::create_dir_all(&model_dir).expect("dossier de modèle");
        let outcome = launch_if_needed(true, &service, None, &model, Some(&pid_path));
        assert!(
            matches!(outcome, LayaOutcome::Launched | LayaOutcome::LaunchedNotReady),
            "issue inattendue : {outcome:?}"
        );
        assert!(
            wait_until_reachable(Duration::from_secs(10), PROBE_INTERVAL).reachable,
            "le service lancé devrait répondre sur /status"
        );
        let (pid, name) = crate::plface::read_pid_file(&pid_path).expect("trace laya.pid");
        assert!(pid > 0);
        assert_eq!(name, node_exe_name());

        // 3) État lu : configuré, joignable, modèle chargé.
        let st = status(true, &service, &model, true);
        assert!(st.configured && st.reachable && st.ready && st.embedded, "{st:?}");

        // 4) Service déjà vivant : jamais doublé, trace inchangée.
        assert_eq!(
            launch_if_needed(true, &service, None, &model, Some(&pid_path)),
            LayaOutcome::AlreadyRunning
        );
        assert_eq!(crate::plface::read_pid_file(&pid_path), Some((pid, name)));

        // 5) Arrêt propre : seul le processus tracé est refermé, trace effacée.
        assert!(stop_owned(&pid_path));
        assert_eq!(crate::plface::read_pid_file(&pid_path), None);
        assert!(
            !wait_until_reachable(Duration::from_secs(10), PROBE_INTERVAL).reachable,
            "le service arrêté ne devrait plus répondre"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Force le chargement du modèle : le service charge PARESSEUSEMENT, au
    /// premier `POST /classify`. C'est ce qui permet d'observer un `"ready":true`
    /// RÉEL (sans cet appel, `/status` dit toujours `ready:false`). Toute erreur
    /// renvoie `false`, jamais bloquant au-delà du délai.
    fn warm_up_model(timeout: Duration) -> bool {
        use std::io::Write;
        use std::net::{TcpStream, ToSocketAddrs};

        let body = concat!(
            "{\"text\":\"I will cancel my subscription today.\",",
            "\"questions\":{\"churn_risk\":{\"type\":\"noul\",",
            "\"instructions\":\"Does the user threaten to cancel?\"}}}"
        );
        let Ok(mut addrs) = (LAYA_API_HOST, LAYA_API_PORT).to_socket_addrs() else {
            return false;
        };
        let Some(addr) = addrs.next() else {
            return false;
        };
        let Ok(mut stream) = TcpStream::connect_timeout(&addr, timeout) else {
            return false;
        };
        let _ = stream.set_read_timeout(Some(timeout));
        let _ = stream.set_write_timeout(Some(timeout));
        let request = format!(
            "POST /classify HTTP/1.1\r\nHost: {LAYA_API_HOST}:{LAYA_API_PORT}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        if stream.write_all(request.as_bytes()).is_err() {
            return false;
        }

        // Le service garde la connexion ouverte : on s'arrête dès que le corps
        // JSON est complet, comme `probe_status` (même lecture bornée).
        let raw = read_http_body(&mut stream, 8192);
        String::from_utf8_lossy(&raw).contains("\"ok\":true")
    }

    /// Fin des en-têtes HTTP : CR LF CR LF, écrit en octets pour rester sans
    /// ambiguïé d'echappement.
    const HEADERS_END: [u8; 4] = [13, 10, 13, 10];

    /// Lit la requête du client (elle commence par la MÉTHODE, pas par
    /// « HTTP/ ») jusqu'aux en-têtes complets : l'écriture côté client est
    /// unique, l'en-tête suffit donc à tout recevoir.
    fn read_request(stream: &mut std::net::TcpStream) -> Vec<u8> {
        use std::io::Read;

        let mut raw: Vec<u8> = Vec::new();
        let mut buf = [0u8; 1024];
        loop {
            match stream.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => raw.extend_from_slice(&buf[..n]),
            }
            if raw.windows(HEADERS_END.len()).any(|w| w == HEADERS_END) {
                break;
            }
        }
        raw
    }

    /// Faux service Laya en RUST : écoute sur un port libre, lit la requête
    /// (transmise au test), répond `status_line` + `body`, puis s'arrête. Aucun
    /// modèle, aucun réseau hors boucle locale, aucun port du service réel.
    fn spawn_fake_laya(
        status_line: &str,
        body: String,
    ) -> (u16, std::sync::mpsc::Receiver<String>) {
        use std::io::Write;

        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("port libre");
        let port = listener.local_addr().expect("adresse locale").port();
        let (tx, rx) = std::sync::mpsc::channel();
        let status_line = status_line.to_string();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let request = read_request(&mut stream);
                let _ = tx.send(String::from_utf8_lossy(&request).to_string());
                let response = format!(
                    "HTTP/1.1 {status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(response.as_bytes());
            }
        });
        (port, rx)
    }

    /// Port libre garanti (aucun service n'y écoute) : pour prouver le cas
    /// « service éteint » sans jamais toucher au port du vrai service.
    fn free_port() -> u16 {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("port libre");
        let port = listener.local_addr().expect("adresse locale").port();
        drop(listener);
        port
    }

    #[test]
    fn json_body_reads_the_body_of_an_http_response() {
        assert_eq!(
            json_body("HTTP/1.1 200 OK\r\nX: 1\r\n\r\n{\"a\":1}"),
            Some("{\"a\":1}".to_string())
        );
        assert_eq!(json_body("HTTP/1.1 200 OK\r\n\r\n"), Some(String::new()));
        assert_eq!(json_body("pas du http"), None);
        assert_eq!(json_body("HTTP/1.1 200 OK"), None, "en-têtes incomplets");
    }

    /// Preuve du VRAI format de réponse du service Laya sur `/classify` :
    /// `Transfer-Encoding: chunked` (relevé sur le service réel). Sans
    /// dé-encodage, `classify` répondait « Réponse illisible ».
    #[test]
    fn json_body_decodes_a_chunked_response_like_the_real_service() {
        // Tailles calculees : aucun comptage manuel (source d'erreur).
        let one = "{\"ok\":true,\"answers\":{\"an";
        let two = "swer\":{\"type\":\"choice\"}},\"ms\":45}";
        let expected = format!("{one}{two}");
        let raw = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json; charset=utf-8\r\nTransfer-Encoding: chunked\r\n\r\n{:x}\r\n{one}\r\n{:x}\r\n{two}\r\n0\r\n\r\n",
            one.len(),
            two.len()
        );
        let body = json_body(&raw).expect("reponse HTTP");
        assert_eq!(body, expected);
        assert!(serde_json::from_str::<serde_json::Value>(&body).is_ok(), "corps recompose : {body}");
    }

    #[test]
    fn dechunk_stops_on_an_incomplete_or_broken_chunk() {
        assert_eq!(dechunk("5\r\nhello\r\n0\r\n\r\n"), "hello");
        assert_eq!(dechunk("5\r\nhel"), "hel", "morceau incomplet : ce qui est recu");
        assert_eq!(dechunk("zz\r\nnope"), "", "taille illisible");
        assert_eq!(dechunk("5\r\nhello\r\n"), "hello", "prolongation sans zero final");
    }

    #[test]
    fn classify_posts_the_text_and_questions_and_returns_the_answers() {
        // Corps IMBRIQUÉ (`answers` → `answer`) : l'ancien arrêt sur la première
        // accolade fermante aurait tronqué cette réponse.
        let body = concat!(
            "{\"ok\":true,\"answers\":{\"answer\":{\"type\":\"noul\",",
            "\"noul\":0.12,\"answer_confidence\":0.88}},\"ms\":96}"
        );
        let (port, request) = spawn_fake_laya("200 OK", body.to_string());
        let questions = serde_json::json!({
            "answer": { "type": "noul", "instructions": "`body` est-il urgent ?" }
        });
        let out = classify_at(
            "127.0.0.1",
            port,
            "Le serveur est tombé, toutes les tentatives échouent",
            &questions,
            Duration::from_secs(5),
        )
        .expect("le service de test doit répondre");
        assert_eq!(out["answers"]["answer"]["noul"], serde_json::json!(0.12));
        assert_eq!(out["answers"]["answer"]["answer_confidence"], serde_json::json!(0.88));
        assert_eq!(out["ms"], serde_json::json!(96));

        let sent = request.recv_timeout(Duration::from_secs(5)).expect("requête reçue");
        assert!(sent.starts_with("POST /classify HTTP/1.1"), "requête : {sent}");
        assert!(sent.contains("Le serveur est tombé"), "le texte est transmis : {sent}");
        assert!(sent.contains("`body` est-il urgent ?"), "la question est transmise : {sent}");
        assert!(sent.contains("\"type\":\"noul\""), "le type est transmis : {sent}");
    }

    #[test]
    fn classify_surfaces_the_service_error_without_panicking() {
        // Modèle refusé / non trouvé : le service répond 400 `ok:false`.
        let body = "{\"ok\":false,\"error\":\"'text' (chaîne) est requis\"}";
        let (port, _) = spawn_fake_laya("400 Bad Request", body.to_string());
        let err = classify_at(
            "127.0.0.1",
            port,
            "x",
            &serde_json::json!({"answer": {"type": "noul"}}),
            Duration::from_secs(5),
        )
        .expect_err("un refus du service est une erreur");
        assert!(err.contains("'text' (chaîne) est requis"), "message : {err}");
        assert!(err.contains("HTTP 400"), "message : {err}");
    }

    #[test]
    fn classify_fails_fast_when_no_service_listens() {
        let started = Instant::now();
        let err = classify_at(
            "127.0.0.1",
            free_port(),
            "x",
            &serde_json::json!({"answer": {"type": "noul"}}),
            Duration::from_secs(2),
        )
        .expect_err("service éteint = erreur");
        assert_eq!(err, SERVICE_DOWN_MESSAGE);
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "la panne doit être immédiate, pas un délai d'attente"
        );
    }

    #[test]
    fn classify_reports_an_unreadable_response() {
        // Connexion acceptée puis fermée sans rien dire : « illisible », pas « panique ».
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("port libre");
        let port = listener.local_addr().expect("adresse locale").port();
        std::thread::spawn(move || {
            let _ = listener.accept();
        });
        let err = classify_at(
            "127.0.0.1",
            port,
            "x",
            &serde_json::json!({"answer": {"type": "noul"}}),
            Duration::from_secs(2),
        )
        .expect_err("réponse vide = erreur");
        assert_eq!(err, SERVICE_DOWN_MESSAGE);
    }

    #[test]
    fn classify_refuses_a_missing_question_without_touching_the_network() {
        let err = classify_at(
            "127.0.0.1",
            free_port(),
            "x",
            &serde_json::Value::Null,
            Duration::from_secs(2),
        )
        .expect_err("question absente = erreur");
        assert!(err.contains("'questions' est obligatoire"), "message : {err}");
    }

    #[test]
    fn classify_surfaces_the_real_service_message_when_it_is_busy() {
        // Réponse 500 (prédiction en échec) : le message du service est remonté
        // tel quel et le service reste vivant pour l'appel suivant.
        let body = "{\"ok\":false,\"error\":\"dossier de modèle introuvable\"}";
        let (port, _) = spawn_fake_laya("500 Internal Server Error", body.to_string());
        let err = classify_at(
            "127.0.0.1",
            port,
            "x",
            &serde_json::json!({"answer": {"type": "choice"}}),
            Duration::from_secs(5),
        )
        .expect_err("500 = erreur");
        assert!(err.contains("dossier de modèle introuvable"), "message : {err}");
    }

    /// Chaîne RÉELLE avec la COPIE EMBARQUÉE (`src-tauri/laya/`) : c'est le
    /// code de Pilot (`launch_if_needed` → `spawn_detached` → trace → `stop_owned`)
    /// qui lance le service livré avec l'interpréteur livré. Sauté si la copie
    /// n'a pas été préparée (`npm run prepare:laya`) ou si un service répond déjà.
    ///
    /// `LAYA_REAL_MODEL_DIR` (dossier d'un modèle déjà présent sur la machine)
    /// pousse jusqu'à la prédiction RÉELLE et à `ready:true`. L'arrêt a lieu
    /// AVANT les assertions : un échec ne laisse jamais le service (≈ 1,6 Gio de
    /// modèle) en vie.
    #[test]
    fn real_embedded_service_launches_and_stops_through_pilot_code() {
        let _port = REAL_PORT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let base = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(RESOURCE_DIR);
        let node = base.join(NODE_DIR).join(node_exe_name());
        let service = base.join(DEFAULT_SERVICE_FILE);
        if !node.is_file() || !service.is_file() {
            eprintln!("SAUTÉ : copie embarquée absente ({})", base.display());
            return;
        }
        if probe().reachable {
            eprintln!("SAUTÉ : un service répond déjà sur {LAYA_API_HOST}:{LAYA_API_PORT}");
            return;
        }

        // Un dossier de modèle suffit au LANCEMENT (le modèle est chargé
        // paresseusement). `LAYA_REAL_MODEL_DIR` permet d'aller plus loin :
        // `ready:true` avec le vrai modèle, sans jamais rien télécharger.
        let real = std::env::var("LAYA_REAL_MODEL_DIR").unwrap_or_default();
        let (model_dir, real_ok) = if !real.trim().is_empty() && Path::new(real.trim()).is_dir() {
            (real.trim().to_string(), true)
        } else {
            let tmp = std::env::temp_dir().join(format!("pilot-laya-emb-{}", std::process::id()));
            std::fs::create_dir_all(&tmp).expect("dossier de modèle temporaire");
            (tmp.to_string_lossy().to_string(), false)
        };
        let pid_path = std::env::temp_dir().join(format!("pilot-laya-emb-{}.pid", std::process::id()));
        crate::plface::clear_pid_file(&pid_path);

        let node_str = node.to_string_lossy().to_string();
        let service_str = service.to_string_lossy().to_string();
        let outcome = launch_if_needed(true, &service_str, Some(&node_str), &model_dir, Some(&pid_path));
        let reachable = wait_until_reachable(Duration::from_secs(10), PROBE_INTERVAL).reachable;

        // La trace porte le nom de l'interpréteur RÉELLEMENT lancé : c'est ce qui
        // autorise l'arrêt (garde de nom).
        let trace = crate::plface::read_pid_file(&pid_path);

        // Le modèle n'est chargé qu'au premier `POST /classify` : on le demande
        // AVANT de lire l'état, sinon `ready` est faux par construction.
        let real_loaded = real_ok && warm_up_model(Duration::from_secs(300));
        // Aucun `expect`/`panic` AVANT `stop_owned` : un échec doit arrêter le
        // service (sinon un modèle de 1,6 Gio reste en vie et retient le tube).
        let mut real_answer: Result<(String, f64), String> = Ok((String::new(), 0.0));
        if real_loaded {
            let questions = serde_json::json!({
                "assistant_message_kind": {
                    "type": "choice",
                    "instructions": "Which kind of message is `body`? It is a message an AI assistant just wrote to its user.",
                    "criteria": {
                        "alert": "something went wrong and needs the user's attention now",
                        "report": "a result, a finished task, a delivered work"
                    }
                }
            });
            let text = "ERREUR : le build de la nuit a échoué, je m'arrête là.";
            real_answer = classify(text, &questions).map(|answers| {
                eprintln!("PREUVE RÉELLE classify : {answers}");
                (
                    answers
                        .pointer("/answers/assistant_message_kind/choice")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    answers
                        .pointer("/answers/assistant_message_kind/answer_confidence")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.0),
                )
            });
        }

        let state = status(true, &service_str, &model_dir, true);

        // Arrêt AVANT toute assertion : un échec ne doit jamais laisser le
        // service en vie (fuite de 1,6 Gio qui retient aussi le tube du test).
        let stopped = stop_owned(&pid_path);
        let trace_cleared = crate::plface::read_pid_file(&pid_path).is_none();
        let gone = !wait_until_reachable(Duration::from_secs(10), PROBE_INTERVAL).reachable;

        assert!(
            matches!(outcome, LayaOutcome::Launched | LayaOutcome::LaunchedNotReady),
            "issue inattendue avec la copie embarquée : {outcome:?}"
        );
        assert!(reachable, "le service embarqué devrait répondre sur /status");
        let (pid, name) = trace.expect("trace laya.pid");
        assert!(pid > 0);
        assert_eq!(name, node_exe_name());
        assert_eq!(name, process_name_for(Some(&node_str)));
        assert!(state.reachable, "état du service embarqué : {state:?}");
        if real_ok {
            assert!(real_loaded, "le vrai modèle devrait avoir répondu à /classify");
            assert!(state.ready, "le vrai modèle devrait être chargé : {state:?}");
            // Le service est déjà arrêté : un échec ici ne laisse rien en vie.
            let (kind, conf) = real_answer.expect("classify sur le vrai service");
            assert!(!kind.is_empty(), "le vrai service doit rendre un libellé");
            assert!(conf > 0.5, "confiance réelle attendue > 0,5");
        } else {
            eprintln!("NOTE : LAYA_REAL_MODEL_DIR absent → « ready » non vérifié (aucun téléchargement)");
        }
        assert!(stopped, "le service embarqué devrait être arrêté");
        assert!(trace_cleared, "la trace laya.pid devrait être effacée après l'arrêt");
        assert!(gone, "le service embarqué arrêté ne devrait plus répondre");
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

    // ── Appartenance : la trace dit à qui appartient le service ──

    #[test]
    fn trace_round_trip_keeps_the_owner() {
        let path = std::env::temp_dir().join(format!(
            "pilot-laya-test-{}-owner.pid",
            std::process::id()
        ));
        let trace = LayaTrace {
            pid: 4242,
            name: "node.exe".to_string(),
            owner_pid: 777,
            owner_name: "pilot.exe".to_string(),
        };
        write_trace(&path, &trace);
        assert_eq!(read_trace(&path), Some(trace));
        crate::plface::clear_pid_file(&path);
        assert_eq!(read_trace(&path), None);
    }

    #[test]
    fn an_unreadable_trace_is_never_used_to_close_anything() {
        // Trace d'une ancienne version (deux lignes, propriétaire absent),
        // trace vide, trace d'identifiant illisible : `None` → on ne referme
        // rien, jamais le service d'une autre copie de Pilot.
        assert_eq!(parse_trace("4242\nnode.exe\n"), None);
        assert_eq!(parse_trace(""), None);
        assert_eq!(parse_trace("pas-un-nombre\nnode.exe\n12\npilot.exe\n"), None);
        assert_eq!(parse_trace("0\nnode.exe\n12\npilot.exe\n"), None);
        assert_eq!(parse_trace("42\nnode.exe\n0\npilot.exe\n"), None);
        assert_eq!(
            parse_trace("42\nnode.exe\n12\npilot.exe\n"),
            Some(LayaTrace {
                pid: 42,
                name: "node.exe".to_string(),
                owner_pid: 12,
                owner_name: "pilot.exe".to_string(),
            })
        );
    }

    #[test]
    fn startup_cleanup_spares_a_live_owner_and_stops_an_orphan() {
        const SELF: u32 = 2;
        const OTHER: u32 = 1;
        // Copie de Pilot ENCORE VIVANTE : on ne touche pas à son service.
        assert!(!decide_startup_cleanup(Some(OTHER), true, SELF));
        // Copie de Pilot DISPARUE (fermeture brutale) : service orphelin.
        assert!(decide_startup_cleanup(Some(OTHER), false, SELF));
        // Trace absente ou illisible : rien à refermer.
        assert!(!decide_startup_cleanup(None, false, SELF));
        // Trace qui nous appartient (relance interne) : à nous.
        assert!(decide_startup_cleanup(Some(SELF), true, SELF));
    }

    #[test]
    fn shutdown_stops_only_its_own_service() {
        const SELF: u32 = 2;
        assert!(decide_shutdown_stop(Some(2), SELF));
        assert!(!decide_shutdown_stop(Some(1), SELF), "service d'une autre copie");
        assert!(!decide_shutdown_stop(None, SELF), "aucune trace");
    }

    #[test]
    fn stop_owned_leaves_the_trace_of_another_pilot_untouched() {
        // Trace d'une AUTRE copie : l'arrêt de la nôtre ne doit ni la refermer
        // ni l'effacer (le propriétaire réel s'en chargera à sa fermeture).
        let path = std::env::temp_dir().join(format!(
            "pilot-laya-test-{}-other-owner.pid",
            std::process::id()
        ));
        let trace = LayaTrace {
            pid: u32::MAX - 1,
            name: node_exe_name().to_string(),
            owner_pid: std::process::id().wrapping_add(1),
            owner_name: "pilot.exe".to_string(),
        };
        write_trace(&path, &trace);
        assert!(stop_owned(&path), "rien à refermer, et jamais celui d'autrui");
        assert_eq!(read_trace(&path), Some(trace), "la trace d'autrui reste intacte");
        crate::plface::clear_pid_file(&path);
    }

    /// Preuve par MESURE (vrais processus) : le nettoyage du démarrage ne
    /// referme pas le service d'une autre copie de Pilot encore vivante, et
    /// referme bien un orphelin dont le propriétaire a disparu. Sauté si `node`
    /// est absent de la machine.
    #[test]
    fn cleanup_spares_a_live_owner_and_stops_a_dead_owner_for_real() {
        let node_ok = Command::new("node")
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if !node_ok {
            eprintln!("SAUTÉ : `node` absent de la machine");
            return;
        }

        let sleep = |ms: &str| {
            let mut cmd = Command::new("node");
            cmd.args(["-e", &format!("setTimeout(()=>{{}}, {ms})")])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(crate::CREATE_NO_WINDOW);
            }
            cmd
        };

        let root = std::env::temp_dir().join(format!(
            "pilot-laya-owner-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&root).expect("dossier temporaire");
        let pid_path = root.join(PID_FILE_NAME);

        // « Autre copie de Pilot » et son « service » : deux vrais processus.
        let mut owner = sleep("20000").spawn().expect("processus propriétaire");
        let mut service = sleep("20000").spawn().expect("processus service");
        let trace = LayaTrace {
            pid: service.id(),
            name: node_exe_name().to_string(),
            owner_pid: owner.id(),
            owner_name: node_exe_name().to_string(),
        };
        write_trace(&pid_path, &trace);

        // 1) Propriétaire VIVANT : rien n'est refermé, la trace reste (la
        //    nouvelle copie réutilise le service qui répond).
        assert!(cleanup_stale(&pid_path));
        assert_eq!(read_trace(&pid_path), Some(trace.clone()), "trace laissée intacte");
        assert!(
            crate::plface::owner_alive(service.id(), node_exe_name()),
            "le service de l'autre copie doit survivre"
        );

        // 2) Propriétaire DISPARU : le service orphelin est refermé, trace effacée.
        let _ = owner.kill();
        let _ = owner.wait();
        let deadline = Instant::now() + Duration::from_secs(5);
        while crate::plface::owner_alive(trace.owner_pid, node_exe_name())
            && Instant::now() < deadline
        {
            std::thread::sleep(Duration::from_millis(100));
        }
        assert!(
            !crate::plface::owner_alive(trace.owner_pid, node_exe_name()),
            "le propriétaire doit avoir disparu"
        );
        assert!(cleanup_stale(&pid_path));
        assert_eq!(read_trace(&pid_path), None, "trace effacée après nettoyage");
        assert!(
            !crate::plface::owner_alive(service.id(), node_exe_name()),
            "le service orphelin doit être refermé"
        );

        let _ = service.kill();
        let _ = service.wait();
        let _ = std::fs::remove_dir_all(&root);
    }
}
