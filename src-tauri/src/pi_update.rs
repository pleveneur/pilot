// pi_update.rs — Détection et mise à jour de l'agent Pi (issue #26)
//
// À l'ouverture de l'onglet agent, Pilot vérifie si une nouvelle version de Pi
// est disponible (endpoint officiel https://pi.dev/api/latest-version) et
// propose à l'utilisateur de la mettre à jour via la commande intégrée
// `pi update --self`. Uniquement pour le backend `pi` (pas `plh`, qui est une
// réimplémentation Rust non mise à jour via `pi update`). L'utilisateur peut
// choisir « Ne plus demander » (flag `pi_skip_update_check` dans la config).

use serde::Serialize;
use std::time::Duration;
use tauri::{AppHandle, State};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use crate::{kind_from_version_output, run_captured, AppState};

/// Résultat de la vérification de mise à jour de Pi.
#[derive(Serialize)]
pub struct PiUpdateCheck {
    pub update_available: bool,
    pub current: String,
    pub latest: String,
    /// Raison si aucune mise à jour proposée : "", "no_path", "not_pi",
    /// "fetch_failed", "up_to_date".
    pub reason: String,
}

/// Résultat de la mise à jour de Pi.
#[derive(Serialize)]
pub struct PiUpdateResult {
    pub ok: bool,
    pub output: String,
    pub error: String,
}

/// Compare deux versions semver "X.Y.Z" → -1, 0, 1. Retourne 0 si non parsable.
fn compare_versions(a: &str, b: &str) -> i32 {
    fn parse(v: &str) -> Option<(u32, u32, u32)> {
        let s = v.trim().trim_start_matches('v');
        let mut it = s.split('.');
        let major = it.next()?.parse().ok()?;
        let minor = it.next()?.parse().ok()?;
        let patch = it.next()?.parse().ok()?;
        Some((major, minor, patch))
    }
    let (pa, pb) = match (parse(a), parse(b)) {
        (Some(x), Some(y)) => (x, y),
        _ => return 0,
    };
    if pa.0 != pb.0 {
        return if pa.0 < pb.0 { -1 } else { 1 };
    }
    if pa.1 != pb.1 {
        return if pa.1 < pb.1 { -1 } else { 1 };
    }
    if pa.2 != pb.2 {
        return if pa.2 < pb.2 { -1 } else { 1 };
    }
    0
}

/// Récupère la dernière version de Pi depuis l'endpoint officiel.
fn fetch_latest_version() -> Option<String> {
    let resp = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .ok()?
        .get("https://pi.dev/api/latest-version")
        .send()
        .ok()?;
    let json: serde_json::Value = resp.json().ok()?;
    json.get("version")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// Vérifie si une mise à jour de Pi est disponible. Ne propose que pour le
/// backend `pi` (pas `plh`). Retourne `update_available=false` si le chemin est
/// vide, si le backend n'est pas pi, si la récupération échoue, ou si à jour.
#[tauri::command]
pub fn check_pi_update(state: State<AppState>) -> PiUpdateCheck {
    let config = state.config.lock().unwrap();
    let pi_path = config.rpc_pi_path.clone();
    drop(config);
    if pi_path.is_empty() {
        return PiUpdateCheck {
            update_available: false,
            current: String::new(),
            latest: String::new(),
            reason: "no_path".into(),
        };
    }
    let out = run_captured(&pi_path, &["--version"], Duration::from_secs(10));
    let current = out.trim().to_string();
    if kind_from_version_output(&out) != "pi" {
        return PiUpdateCheck {
            update_available: false,
            current,
            latest: String::new(),
            reason: "not_pi".into(),
        };
    }
    let latest = match fetch_latest_version() {
        Some(v) => v,
        None => {
            return PiUpdateCheck {
                update_available: false,
                current,
                latest: String::new(),
                reason: "fetch_failed".into(),
            }
        }
    };
    if compare_versions(&current, &latest) < 0 {
        PiUpdateCheck {
            update_available: true,
            current,
            latest,
            reason: String::new(),
        }
    } else {
        PiUpdateCheck {
            update_available: false,
            current,
            latest,
            reason: "up_to_date".into(),
        }
    }
}

/// Exécute `pi update --self` en redirigeant la sortie vers un fichier
/// temporaire (évite tout deadlock de pipe si la sortie est volumineuse).
/// Retourne `(succès, sortie)`.
fn run_update_captured(exe: &str, base_args: &[String], deadline_dur: Duration) -> (bool, String) {
    use std::process::{Command, Stdio};
    use std::time::Instant;
    let tmp = std::env::temp_dir().join(format!("pilot-pi-update-{}.log", std::process::id()));
    let file = match std::fs::File::create(&tmp) {
        Ok(f) => f,
        Err(_) => return (false, String::new()),
    };
    let file2 = match file.try_clone() {
        Ok(f) => f,
        Err(_) => return (false, String::new()),
    };
    let mut cmd = Command::new(exe);
    cmd.args(base_args)
        .args(["update", "--self"])
        .stdout(Stdio::from(file))
        .stderr(Stdio::from(file2));
    #[cfg(windows)]
    cmd.creation_flags(crate::CREATE_NO_WINDOW);
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(_) => {
            let _ = std::fs::remove_file(&tmp);
            return (false, String::new());
        }
    };
    let deadline = Instant::now() + deadline_dur;
    let ok = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.success(),
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    break false;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => break false,
        }
    };
    let out = std::fs::read_to_string(&tmp).unwrap_or_default();
    let _ = std::fs::remove_file(&tmp);
    (ok, out)
}

/// Résout le vrai script cli d'un paquet npm installé dans `node_modules` via
/// son champ `bin` (package.json). Gère à la fois `node_modules/pi` ET les
/// paquets scopés `node_modules/@scope/pkg` (ex. `@earendil-works/pi-coding-
/// agent`), sans coder en dur le chemin de build interne du paquet (qui change
/// entre versions : `dist/cli.js`, `dist/bundle/cli.js`, ...). Retourne le
/// chemin absolu vers le script cli si trouvé et existant.
fn package_bin_cli(pkg_dir: &std::path::Path) -> Option<String> {
    use std::fs;
    let pkg_json = pkg_dir.join("package.json");
    let text = fs::read_to_string(&pkg_json).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    let bin = v.get("bin")?;
    let rel = match bin {
        // bin sous forme de chaîne : "bin/cli.js"
        serde_json::Value::String(s) => s.clone(),
        // bin sous forme d'objet : { "pi": "dist/cli.js", ... }
        serde_json::Value::Object(map) => {
            // Préfère la clé "pi" (ou une clé contenant "pi"), sinon la première.
            if let Some(pi) = map.get("pi").and_then(|x| x.as_str()) {
                pi.to_string()
            } else if let Some((_, x)) = map.iter().find(|(k, _)| k.contains("pi")) {
                x.as_str()?.to_string()
            } else {
                map.iter().next().map(|(_, x)| x.as_str().unwrap_or("").to_string())?
            }
        }
        _ => return None,
    };
    let full = pkg_dir.join(rel);
    if full.exists() {
        Some(full.to_string_lossy().to_string())
    } else {
        None
    }
}

/// Recherche le vrai script cli de pi dans `node_modules` (1 niveau de scope
/// `@scope/pkg`). Préfère un paquet dont le nom évoque pi pour éviter de
/// ramasser un cli sans rapport. Retourne le chemin absolu du cli, ou None.
fn find_pi_cli_in_node_modules(node_modules: &std::path::Path) -> Option<String> {
    // D'abord le paquet non scopé `node_modules/pi` (ancienne structure).
    if let Some(cli) = package_bin_cli(&node_modules.join("pi")) {
        return Some(cli);
    }
    let rd = std::fs::read_dir(node_modules).ok()?;
    let mut best: Option<(usize, String)> = None;
    let mut consider = |pkg_dir: &std::path::Path, score: usize| {
        if best.as_ref().map_or(true, |(s, _)| score < *s) {
            if let Some(cli) = package_bin_cli(pkg_dir) {
                best = Some((score, cli));
            }
        }
    };
    for e in rd.flatten() {
        let p = e.path();
        if !p.is_dir() {
            continue;
        }
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('@') {
            // Scope : node_modules/@scope/<pkg>
            if let Ok(rd2) = std::fs::read_dir(&p) {
                for e2 in rd2.flatten() {
                    let p2 = e2.path();
                    if !p2.is_dir() {
                        continue;
                    }
                    let n2 = e2.file_name().to_string_lossy().to_string();
                    let score = if name.to_lowercase().contains("pi") || n2.to_lowercase().contains("pi") {
                        0
                    } else {
                        1
                    };
                    consider(&p2, score);
                }
            }
        } else {
            let score = if name.to_lowercase().contains("pi") { 0 } else { 1 };
            consider(&p, score);
        }
    }
    best.map(|(_, p)| p)
}

/// Normalise le chemin d'exécution de pi. Sur Windows le chemin configuré peut
/// être un shim npm global (`pi.cmd` / `pi.ps1` / `pi.bat`) que `Command::new`
/// ne sait pas exécuter directement. Si c'est un shim, on tente de résoudre le
/// vrai script cli (paquet `pi` OU paquet scopé `@scope/...`, via le champ
/// `bin` du package.json — jamais un chemin de build codé en dur) exécuté via
/// `node`. Si aucun cli n'est trouvé, on lance le shim via `cmd.exe /c` sous
/// Windows (sait nativement exécuter un `.cmd`/`.bat` npm, quel que soit le
/// nom/scope du paquet derrière). Comportement inchangé hors Windows : repli
/// sur le chemin d'origine. Retourne `(exécutable, arguments de base)`. Repli :
/// le chemin d'origine (ou "pi" si vide, pour laisser le PATH résoudre). Utilisé
/// par la mise à jour et par `rpc_manager::spawn_and_start` (sessions RPC).
pub(crate) fn resolve_pi_executable(pi_path: &str) -> (String, Vec<String>) {
    let trimmed = pi_path.trim();
    if trimmed.is_empty() {
        return ("pi".to_string(), Vec::new());
    }
    let lower = trimmed.to_lowercase();
    let is_shim =
        lower.ends_with(".cmd") || lower.ends_with(".bat") || lower.ends_with(".ps1");
    if !is_shim {
        // Pas un shim explicite : on garde le chemin tel quel (exe direct,
        // "pi", chemin vers node, etc.).
        return (trimmed.to_string(), Vec::new());
    }
    // Shim npm global : le script réel vit dans `node_modules` adjacent au shim
    // (ex. C:\Users\x\AppData\Roaming\npm\pi.cmd → ...\npm\node_modules\...).
    if let Some(parent) = std::path::Path::new(trimmed).parent() {
        let nm = parent.join("node_modules");
        if let Some(cli) = find_pi_cli_in_node_modules(&nm) {
            return ("node".to_string(), vec![cli]);
        }
        // Paquet non résolu (nom/scope non standard ou node_modules absent) :
        // lancer le shim via cmd.exe /c (portable, sous Windows uniquement).
        #[cfg(windows)]
        {
            return ("cmd".to_string(), vec!["/c".to_string(), trimmed.to_string()]);
        }
    }
    (trimmed.to_string(), Vec::new())
}

/// Convertit un échec de mise à jour en message orienté utilisateur (français),
/// en détectant la cause probable depuis la sortie capturée. Retourne une chaîne
/// vide si la mise à jour a réussi.
fn update_error_hint(ok: bool, out: &str) -> String {
    if ok {
        return String::new();
    }
    let lower = out.to_lowercase();
    if lower.contains("not writable")
        || lower.contains("eperm")
        || lower.contains("eacces")
        || lower.contains("access denied")
        || lower.contains("permission denied")
    {
        "L'installation de Pi est protégée en écriture. Lance la mise à jour en administrateur, ou réinstalle Pi manuellement.".to_string()
    } else if lower.contains("command not found")
        || lower.contains("not recognized")
        || lower.contains("no such file")
    {
        "La commande de mise à jour de Pi est introuvable. Vérifie que Pi est installé et accessible dans le PATH.".to_string()
    } else if lower.contains("ebusy")
        || lower.contains("being used by another process")
        || lower.contains("text file busy")
    {
        "Un processus Pi utilise encore les fichiers. Ferme les autres agents Pi puis réessaie.".to_string()
    } else if !out.trim().is_empty() {
        // Pas de cause connue : remonter un court extrait de la sortie réelle
        // pour aider au diagnostic (jamais technique, jamais de stack complète).
        let short = out
            .trim()
            .lines()
            .take(5)
            .collect::<Vec<_>>()
            .join(" | ");
        format!("Échec de la mise à jour de Pi : {}", short)
    } else {
        "Échec de la mise à jour de Pi (aucune sortie).".to_string()
    }
}

/// Met à jour Pi via sa commande intégrée `pi update --self`.
///
/// 3. Avant de lancer la mise à jour, arrête TOUTES les sessions RPC de pi pour
///    libérer les verrous de fichiers (Windows : le processus pi en cours
///    verrouille son propre exécutable/scripts, ce qui fait échouer
///    `pi update --self`). La session principale est relancée par le frontend
///    après la mise à jour (événement `pilot-agent-restart-needed`).
/// 4. Normalise le chemin d'exécution si c'est un shim `.cmd`/`.ps1` (node +
///    cli.js), car `Command::new` ne sait pas exécuter un `.cmd`/`.bat`.
#[tauri::command]
pub fn update_pi(state: State<AppState>, _app: AppHandle) -> PiUpdateResult {
    let config = state.config.lock().unwrap();
    let pi_path = config.rpc_pi_path.clone();
    drop(config);
    if pi_path.is_empty() {
        return PiUpdateResult {
            ok: false,
            output: String::new(),
            error: "no_path".into(),
        };
    }
    // 3. Verrou process : arrêter toutes les sessions RPC de pi (sessions
    // actives, parkées, agents délégués, reviewer, super-agent) pour libérer
    // les verrous de fichiers avant de remplacer le binaire.
    state.agent_service.shutdown_all();

    // 4. Robustesse shim : résoudre le vrai exécutable avant le spawn.
    let (exe, base_args) = resolve_pi_executable(&pi_path);
    let (ok, out) = run_update_captured(&exe, &base_args, Duration::from_secs(180));

    // 1. Diagnosité : remonter un message clair (ou un extrait de la sortie
    // réelle) à l'UI au lieu d'un échec muet générique.
    let error = update_error_hint(ok, &out);
    if !ok {
        return PiUpdateResult {
            ok: false,
            output: out,
            error,
        };
    }
    PiUpdateResult {
        ok: true,
        output: out,
        error,
    }
}

#[cfg(test)]
mod tests {
    use super::{find_pi_cli_in_node_modules, resolve_pi_executable};
    use std::fs;
    use std::path::PathBuf;

    /// Crée une arborescence npm temporaire et retourne son dossier racine.
    /// `dir` : répertoire de travail temporaire (unique par test).
    fn tmp_root(tag: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!("pilot-resolve-pi-{}-{}", tag, std::process::id()));
        if base.exists() {
            let _ = fs::remove_dir_all(&base);
        }
        fs::create_dir_all(&base).unwrap();
        base
    }

    /// Écrit un package.json avec un champ `bin` donné.
    fn write_pkg(pkg_dir: &PathBuf, bin: serde_json::Value) {
        fs::create_dir_all(pkg_dir).unwrap();
        let json = serde_json::json!({ "name": "pkg", "version": "1.0.0", "bin": bin });
        fs::write(pkg_dir.join("package.json"), json.to_string()).unwrap();
    }

    #[test]
    fn empty_path_returns_pi() {
        let (exe, args) = resolve_pi_executable("");
        assert_eq!(exe, "pi");
        assert!(args.is_empty());
        let (exe, args) = resolve_pi_executable("   ");
        assert_eq!(exe, "pi");
        assert!(args.is_empty());
    }

    #[test]
    fn non_shim_passthrough() {
        let (exe, args) = resolve_pi_executable("/usr/local/bin/pi");
        assert_eq!(exe, "/usr/local/bin/pi");
        assert!(args.is_empty());
        let (exe, args) = resolve_pi_executable("pi");
        assert_eq!(exe, "pi");
        assert!(args.is_empty());
    }

    #[test]
    fn scoped_package_resolves_via_bin() {
        let root = tmp_root("scoped");
        // shim adjacent
        let npm = root.join("npm");
        fs::create_dir_all(&npm).unwrap();
        let shim = npm.join("pi.cmd");
        fs::write(&shim, "@echo off").unwrap();
        // paquet scopé
        let pkg = npm.join("node_modules").join("@earendil-works").join("pi-coding-agent");
        write_pkg(&pkg, serde_json::json!({ "pi": "dist/bundle/cli.js" }));
        let cli = pkg.join("dist").join("bundle").join("cli.js");
        fs::create_dir_all(cli.parent().unwrap()).unwrap();
        fs::write(&cli, "#!/usr/bin/env node").unwrap();

        let exe = resolve_pi_executable(shim.to_str().unwrap());
        assert_eq!(exe.0, "node", "paquet scopé doit se résoudre via node");
        assert_eq!(exe.1.len(), 1, "un seul argument (chemin cli)");
        assert!(
            exe.1[0].ends_with("cli.js"),
            "chemin cli résolu inattendu: {}",
            exe.1[0]
        );
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn unscoped_package_resolves_via_bin() {
        let root = tmp_root("unscoped");
        let npm = root.join("npm");
        fs::create_dir_all(&npm).unwrap();
        let shim = npm.join("pi.cmd");
        fs::write(&shim, "@echo off").unwrap();
        let pkg = npm.join("node_modules").join("pi");
        write_pkg(&pkg, serde_json::json!({ "pi": "cli.js" }));
        let cli = pkg.join("cli.js");
        fs::write(&cli, "#!/usr/bin/env node").unwrap();

        let exe = resolve_pi_executable(shim.to_str().unwrap());
        assert_eq!(exe.0, "node");
        assert_eq!(exe.1.len(), 1);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn find_cli_prefers_pi_named_package() {
        let root = tmp_root("prefer");
        let npm = root.join("nm");
        let non_pi = npm.join("other-tool");
        write_pkg(&non_pi, serde_json::json!({ "other-tool": "cli.js" }));
        fs::write(non_pi.join("cli.js"), "#").unwrap();
        // paquet nommé pi : doit être préféré (score 0)
        let pi_pkg = npm.join("pi-tool");
        write_pkg(&pi_pkg, serde_json::json!({ "pi": "dist/cli.js" }));
        let pi_cli = pi_pkg.join("dist").join("cli.js");
        fs::create_dir_all(pi_cli.parent().unwrap()).unwrap();
        fs::write(&pi_cli, "#").unwrap();

        let found = find_pi_cli_in_node_modules(&npm);
        assert!(found.is_some(), "un cli doit être trouvé");
        assert!(found.unwrap().contains("pi-tool"), "le paquet nommé pi doit être préféré");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    #[cfg(windows)]
    fn unresolved_shim_falls_back_to_cmd() {
        let root = tmp_root("cmdfallback");
        let npm = root.join("npm");
        fs::create_dir_all(&npm).unwrap();
        let shim = npm.join("pi.cmd");
        fs::write(&shim, "@echo off").unwrap();
        // aucun node_modules avec cli : doit tomber sur cmd /c
        let exe = resolve_pi_executable(shim.to_str().unwrap());
        assert_eq!(exe.0, "cmd");
        assert_eq!(exe.1, vec!["/c".to_string(), shim.to_str().unwrap().to_string()]);
        fs::remove_dir_all(&root).ok();
    }
}
