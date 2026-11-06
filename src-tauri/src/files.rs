// files.rs — Opérations fichiers pures (I/O), sans état applicatif propre.
//
// Domaine extrait de `lib.rs` (2026-08) : lecture/écriture de fichiers,
// métadonnées (encodage, EOL, mtime), existence, ouverture navigateur.
//
// EXCEPTION ASSUMÉE (mode réseau multi-postes, étape 5) : les commandes qui
// ÉCRIVENT reçoivent désormais l'état de l'application pour consulter la garde
// du socle (`gds_write_guard::ensure_path_writable`) : un projet tenu par un
// autre poste refuse l'écriture dans le socle, pas seulement à l'écran. La
// garde est fail-open (GDS absent/désactivé, serveur muet, projet libre ou tenu
// par ce poste → l'écriture se fait exactement comme avant). Les lectures, elles,
// restent purement fonctionnelles.

use crate::AppState;
use std::fs;
use tauri::State;

/// Lit un fichier binaire (octets bruts).
#[tauri::command]
pub fn read_file_binary(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| format!("Erreur lecture: {}", e))
}

/// Lit un fichier texte (UTF-8).
#[tauri::command]
pub fn read_file_content(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Erreur lecture: {}", e))
}

#[derive(serde::Serialize)]
pub struct FileInfo {
    encoding: String,
    eol: String,
}

/// Détecte l'encodage (BOM) et la fin de ligne (CRLF/LF) d'un fichier.
#[tauri::command]
pub fn get_file_info(path: String) -> Result<FileInfo, String> {
    let bytes = fs::read(&path).map_err(|e| format!("Erreur lecture: {}", e))?;

    // Détection de l'encodage (BOM)
    let encoding = if bytes.starts_with(b"\xef\xbb\xbf") {
        "UTF-8 BOM"
    } else if bytes.starts_with(b"\xff\xfe") {
        "UTF-16 LE"
    } else if bytes.starts_with(b"\xfe\xff") {
        "UTF-16 BE"
    } else {
        "UTF-8"
    };

    // Détection de la fin de ligne
    let mut crlf_count = 0usize;
    let mut lf_count = 0usize;
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\r' {
            if i + 1 < bytes.len() && bytes[i + 1] == b'\n' {
                crlf_count += 1;
                i += 2;
                continue;
            }
        } else if bytes[i] == b'\n' {
            lf_count += 1;
        }
        i += 1;
    }

    let eol = if crlf_count == 0 && lf_count == 0 {
        "—" // Fichier binaire ou vide
    } else if crlf_count > lf_count {
        "CRLF"
    } else if lf_count > 0 {
        "LF"
    } else {
        "—"
    };

    Ok(FileInfo { encoding: encoding.to_string(), eol: eol.to_string() })
}

/// Écrit un fichier texte.
#[tauri::command]
pub async fn write_file_content(
    state: State<'_, AppState>,
    path: String,
    content: String,
) -> Result<(), String> {
    crate::gds_write_guard::ensure_path_writable(state.inner(), &path).await?;
    fs::write(&path, &content).map_err(|e| format!("Erreur écriture: {}", e))
}

/// Avertissement de fraîcheur ajouté en tête du handoff de contexte.
/// Le contenu injecté (contexte RAG, mémoire projet, graphe) est un instantané
/// pris au moment de l'écriture : il est ensuite réinjecté tel quel à CHAQUE tour
/// et peut donc être périmé. Une seule ligne, pour ne pas gonfler le system prompt.
pub const CONTEXT_HANDOFF_STALENESS_WARNING: &str =
    "⚠️ Instantané pris maintenant : des fichiers ont pu changer depuis — vérifie le disque avant d'agir.\n\n";

/// Prépare le contenu final du handoff : avertissement de fraîcheur + contenu.
/// Fonction pure (testable). Un contenu vide reste vide : l'extension
/// `pilot-context` n'injecte rien pour un fichier vide, on n'ajoute donc pas
/// l'avertissement seul (il enverrait du contexte sans contexte).
pub fn context_handoff_content(content: &str) -> String {
    if content.trim().is_empty() {
        return String::new();
    }
    format!("{}{}", CONTEXT_HANDOFF_STALENESS_WARNING, content)
}

/// Écrit le fichier de handoff d'injection de contexte (`.pilot/context-inject.md`)
/// consommé par l'extension pi `pilot-context` (avant_agent_start → systemPrompt).
/// Crée le dossier `.pilot` s'il n'existe pas. Le contenu (contexte + mémoire projet)
/// est injecté dans le system prompt, hors de la discussion stockée (message user).
#[tauri::command]
pub fn write_context_handoff(project_path: String, content: String) -> Result<(), String> {
    if project_path.trim().is_empty() {
        return Ok(());
    }
    let dir = std::path::Path::new(&project_path).join(".pilot");
    fs::create_dir_all(&dir).map_err(|e| format!("Erreur création .pilot: {}", e))?;
    let file = dir.join("context-inject.md");
    let body = context_handoff_content(&content);
    fs::write(&file, &body).map_err(|e| format!("Erreur écriture handoff: {}", e))
}

/// Écrit un fichier binaire.
#[tauri::command]
pub async fn write_file_binary(
    state: State<'_, AppState>,
    path: String,
    data: Vec<u8>,
) -> Result<(), String> {
    crate::gds_write_guard::ensure_path_writable(state.inner(), &path).await?;
    fs::write(&path, &data).map_err(|e| format!("Erreur écriture: {}", e))
}

/// Lit la liste des commandes du projet depuis `.pilot/commands.json` (#17).
/// Retourne un tableau JSON vide si le fichier n'existe pas encore.
#[tauri::command]
pub fn read_project_commands(project_path: String) -> Result<serde_json::Value, String> {
    let file = std::path::Path::new(&project_path)
        .join(".pilot")
        .join("commands.json");
    match std::fs::read_to_string(&file) {
        Ok(s) => serde_json::from_str(&s)
            .map_err(|e| format!("commandes projet invalides : {}", e)),
        Err(_) => Ok(serde_json::json!([])),
    }
}

/// Écrit la liste des commandes du projet dans `.pilot/commands.json` (#17),
/// en créant le dossier `.pilot` si nécessaire.
#[tauri::command]
pub fn save_project_commands(
    project_path: String,
    commands: serde_json::Value,
) -> Result<(), String> {
    if project_path.trim().is_empty() {
        return Ok(());
    }
    let dir = std::path::Path::new(&project_path).join(".pilot");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Erreur création .pilot: {}", e))?;
    let file = dir.join("commands.json");
    let s = serde_json::to_string_pretty(&commands)
        .map_err(|e| format!("sérialisation commandes : {}", e))?;
    std::fs::write(&file, s).map_err(|e| format!("Erreur écriture commandes : {}", e))
}

/// Vérifie qu'un fichier existe.
#[tauri::command]
pub fn file_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

/// Renvoie la taille d'un fichier en octets (0 si absent/illisible).
/// Utilisé par le Context Engine pour ignorer les gros fichiers (anti-gel).
#[tauri::command]
pub fn get_file_size(path: String) -> u64 {
    fs::metadata(&path)
        .map(|m| m.len())
        .unwrap_or(0)
}

/// Renvoie la date de dernière modification d'un fichier (mtime) en millisecondes
/// depuis l'epoch UNIX. Utilisé par le Mode Orchestration pour détecter qu'un
/// fichier a été créé/modifié par le codeur après une tâche.
#[tauri::command]
pub fn file_mtime(path: String) -> Result<f64, String> {
    let meta = fs::metadata(&path).map_err(|e| format!("Erreur metadata: {}", e))?;
    let mtime = meta.modified().map_err(|e| format!("Erreur mtime: {}", e))?;
    let dur = mtime
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("Erreur epoch: {}", e))?;
    Ok(dur.as_secs_f64() * 1000.0)
}

/// Ouvre une URL/un fichier dans le navigateur par défaut du système.
#[tauri::command]
pub fn open_in_browser(path: String) -> Result<(), String> {
    open::that(&path).map_err(|e| format!("Erreur ouverture navigateur: {}", e))
}

/// État d'un chemin AVANT de l'ouvrir (tâche 394 : l'Assistant ouvre un fichier).
///
/// Cette commande N'OUVRE RIEN : elle constate seulement ce qu'il y a sur le
/// disque, pour que la fenêtre puisse REFUSER proprement (fichier absent, vide,
/// dossier) au lieu d'ouvrir quelque chose qui n'existe pas. La décision
/// (onglet de Pilot ou programme par défaut, et quand refuser) est PURE et vit
/// dans `src/js/ouvrir-fichier.js`.
#[derive(serde::Serialize)]
pub struct OpenPathInfo {
    /// Chemin tel qu'il sera réellement ouvert (inchangé par cette commande).
    pub path: String,
    pub exists: bool,
    pub is_file: bool,
    pub is_dir: bool,
    /// Taille en octets (0 si absent/illisible).
    pub size: u64,
    /// Racine de l'espace de travail de l'Assistant (`~/.pilot/assistant`) :
    /// l'un des deux périmètres autorisés (l'autre étant les projets connus).
    /// La fenêtre ne devine jamais le dossier personnel.
    pub assistant_root: String,
}

#[tauri::command]
pub fn inspect_open_path(path: String) -> OpenPathInfo {
    // Dossier de travail de l'Assistant : le dossier lui-même, sans le créer
    // (une lecture ne doit rien créer sur le disque).
    let assistant_root = crate::agent_service::pilot_user_dir()
        .map(|dir| dir.join("assistant").to_string_lossy().to_string())
        .unwrap_or_default();
    match fs::metadata(&path) {
        Ok(meta) => OpenPathInfo {
            path: path.clone(),
            exists: true,
            is_file: meta.is_file(),
            is_dir: meta.is_dir(),
            size: if meta.is_file() { meta.len() } else { 0 },
            assistant_root,
        },
        Err(_) => OpenPathInfo {
            path,
            exists: false,
            is_file: false,
            is_dir: false,
            size: 0,
            assistant_root,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handoff_content_prefixes_staleness_warning() {
        let out = context_handoff_content("=== MÉMOIRE DU PROJET ===\nfaits");
        assert!(out.starts_with(CONTEXT_HANDOFF_STALENESS_WARNING));
        assert!(out.contains("=== MÉMOIRE DU PROJET ==="));
        // Le contenu d'origine est préservé intégralement après l'avertissement.
        assert!(out.ends_with("faits"));
    }

    #[test]
    fn handoff_content_empty_stays_empty() {
        assert_eq!(context_handoff_content(""), "");
        assert_eq!(context_handoff_content("  \n  "), "");
    }

    #[test]
    fn write_context_handoff_writes_warning_to_disk() {
        let base = crate::test_util::TempDir::new("pilot-handoff-test");
        let project = base.str();
        write_context_handoff(project.clone(), "BLOC-CONTEXTE".to_string())
            .expect("écriture handoff");
        let written = fs::read_to_string(base.join(".pilot").join("context-inject.md"))
            .expect("lecture handoff");
        assert!(written.starts_with(CONTEXT_HANDOFF_STALENESS_WARNING));
        assert!(written.ends_with("BLOC-CONTEXTE"));
    }

    #[test]
    fn write_context_handoff_ignores_empty_project_path() {
        assert!(write_context_handoff("  ".to_string(), "x".to_string()).is_ok());
    }

    #[test]
    fn inspect_open_path_reports_a_real_file_and_its_size() {
        let base = crate::test_util::TempDir::new("pilot-open-file");
        let file = base.join("rapport.md");
        fs::write(&file, "bonjour").expect("écriture");
        let info = inspect_open_path(file.to_string_lossy().to_string());
        assert!(info.exists, "le fichier existe");
        assert!(info.is_file, "c'est un fichier");
        assert!(!info.is_dir, "ce n'est pas un dossier");
        assert_eq!(info.size, 7, "taille réelle en octets");
    }

    #[test]
    fn inspect_open_path_sees_a_directory_as_a_directory() {
        let base = crate::test_util::TempDir::new("pilot-open-dir");
        let info = inspect_open_path(base.str());
        assert!(info.exists, "le dossier existe");
        assert!(!info.is_file, "un dossier n'est pas un fichier");
        assert!(info.is_dir, "c'est bien un dossier");
    }

    #[test]
    fn inspect_open_path_reports_a_missing_file_without_error() {
        let base = crate::test_util::TempDir::new("pilot-open-missing");
        let missing = base.join("absent.txt");
        let info = inspect_open_path(missing.to_string_lossy().to_string());
        assert!(!info.exists, "le fichier est absent");
        assert!(!info.is_file, "aucun fichier");
        assert!(!info.is_dir, "aucun dossier");
        assert_eq!(info.size, 0);
    }

    #[test]
    fn inspect_open_path_announces_the_assistant_workspace() {
        // Le périmètre autorisé de l'Assistant ne doit jamais être deviné par la
        // fenêtre : la commande l'annonce (dossier `assistant` sous `~/.pilot`).
        let info = inspect_open_path(String::new());
        if !info.assistant_root.is_empty() {
            assert!(
                info.assistant_root.replace('\\', "/").ends_with("/.pilot/assistant"),
                "racine assistant inattendue : {}",
                info.assistant_root
            );
        }
        assert!(!info.exists, "un chemin vide n'existe pas");
    }
}
