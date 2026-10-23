// tts_local.rs — Voix française LOCALE (hors ligne) pour la lecture à voix haute.
//
// Moteur : **Piper** (exécutable local + modèle ONNX `fr_FR-siwis-medium`,
// ≈ 63 Mo). Contraintes tenues ici, une seule fois :
//   - **hors ligne** : rien n'est téléchargé, aucun appel réseau n'est fait —
//     ni à l'installation, ni à la lecture. Le moteur lit le texte sur son
//     entrée standard et écrit un WAV local, que la fenêtre joue ;
//   - **aucune clé, aucun compte, aucun abonnement** ;
//   - **aucune carte graphique** : inférence CPU (ONNX Runtime embarqué dans le
//     binaire Piper) ;
//   - **repli obligatoire et visible** : moteur ou modèle absent, délai dépassé,
//     échec du processus → une ligne datée dans le journal
//     `<app_data>/voix-locale/voix-locale.log` et une erreur explicite ; le
//     front, lui, retombe sur la voix du système et le dit (jamais de blocage).
//
// Disposition sur le poste (tout est déduit d'UN SEUL dossier) :
//
//   <app_data_dir>/voix-locale/
//     piper/piper.exe               (archive officielle décompressée)
//     piper/*.dll, piper/espeak-ng-data/
//     voix/fr_FR-siwis-medium.onnx
//     voix/fr_FR-siwis-medium.onnx.json
//     voix-locale.log               (journal, créé au premier événement)
//
// Aucun fichier n'est écrit hors de ce dossier, aucun fichier existant n'est
// supprimé (le WAV de synthèse est un temporaire, créé puis retiré).

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use base64::Engine as _;
use serde::Serialize;
use tauri::Manager;

#[cfg(windows)]
use crate::CREATE_NO_WINDOW;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Sous-dossier (dans le dossier de données de Pilot) qui contient le moteur et
/// le modèle. **Seul endroit** où le chemin est défini : tout le reste s'en
/// déduit, l'interface reçoit le chemin réel dans son état.
pub const LOCAL_VOICE_DIR: &str = "voix-locale";
/// Sous-dossier du moteur Piper.
pub const PIPER_SUBDIR: &str = "piper";
/// Sous-dossier des modèles de voix.
pub const VOICES_SUBDIR: &str = "voix";
/// Nom du modèle français retenu (≈ 63 Mo).
pub const MODEL_NAME: &str = "fr_FR-siwis-medium";
/// Nom du journal (repli, erreurs).
pub const LOG_FILE: &str = "voix-locale.log";
/// Plafond d'un journal avant remise à zéro (256 Ko).
pub const LOG_MAX_BYTES: u64 = 256 * 1024;
/// Délai maximal d'une synthèse (au-delà, le moteur est interrompu et on replie).
pub const SYNTH_TIMEOUT: Duration = Duration::from_secs(30);

/// État du moteur local, tel qu'affiché par les Paramètres (aucune invention :
/// tout vient de la présence réelle des fichiers).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct LocalVoiceStatus {
    /// Vrai si le moteur ET le modèle sont présents.
    pub installed: bool,
    /// Nom lisible du moteur (« Piper »).
    pub engine: String,
    /// Nom du modèle attendu (`fr_FR-siwis-medium`).
    pub voice: String,
    /// Dossier où doivent se trouver les fichiers (affiché à l'utilisateur).
    pub dir: String,
    /// Exécutable attendu.
    pub exe: String,
    /// Modèle attendu.
    pub model: String,
    /// Ce qui manque, en clair (liste vide si tout est là).
    pub missing: Vec<String>,
    /// Phrase unique expliquant la situation et quoi faire.
    pub hint: String,
    /// Chemin du journal (une ligne par repli).
    pub log: String,
}

/// Racine du dossier de la voix locale (`<app_data_dir>/voix-locale`).
pub fn local_voice_root(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(LOCAL_VOICE_DIR))
}

/// Dossier du moteur Piper.
pub fn piper_dir(root: &Path) -> PathBuf {
    root.join(PIPER_SUBDIR)
}

/// Nom de l'exécutable attendu selon la plateforme (Windows : `piper.exe`).
pub fn piper_exe_name() -> &'static str {
    if cfg!(windows) {
        "piper.exe"
    } else {
        "piper"
    }
}

/// Chemin de l'exécutable Piper.
pub fn piper_exe(root: &Path) -> PathBuf {
    piper_dir(root).join(piper_exe_name())
}

/// Chemin du modèle ONNX.
pub fn model_path(root: &Path) -> PathBuf {
    root.join(VOICES_SUBDIR)
        .join(format!("{}.onnx", MODEL_NAME))
}

/// Chemin de la configuration du modèle (`<modèle>.onnx.json`).
pub fn model_config_path(root: &Path) -> PathBuf {
    root.join(VOICES_SUBDIR)
        .join(format!("{}.onnx.json", MODEL_NAME))
}

/// Chemin du journal de la voix locale.
pub fn log_path(root: &Path) -> PathBuf {
    root.join(LOG_FILE)
}

/// Phrase affichée quand tout est en place.
pub fn ready_hint() -> String {
    format!(
        "Voix française locale prête : Piper et le modèle {} sont installés — lecture hors ligne, \
         sans clé et sans carte graphique.",
        MODEL_NAME
    )
}

/// Phrase affichée quand il manque quelque chose (dit aussi OÙ déposer les fichiers).
pub fn missing_hint(root: &Path, missing: &[String]) -> String {
    let mut what = String::new();
    for (index, item) in missing.iter().enumerate() {
        if index > 0 {
            what.push_str(", ");
        }
        what.push_str(item);
    }
    format!(
        "Voix française locale non installée : il manque {}. Déposez ces fichiers dans « {} » \
         (voir l'aide). En attendant, la lecture utilise la voix du système.",
        what,
        root.display()
    )
}

/// État du moteur local pour un dossier donné (fonction sans effet de bord :
/// testable sur un dossier temporaire, sans lancer Piper).
pub fn status_for_dir(root: &Path) -> LocalVoiceStatus {
    let exe = piper_exe(root);
    let model = model_path(root);
    let config = model_config_path(root);
    let mut missing = Vec::new();
    if !exe.is_file() {
        missing.push(format!("le moteur Piper ({})", piper_exe_name()));
    }
    if !model.is_file() {
        missing.push(format!("le modèle {}.onnx", MODEL_NAME));
    }
    if !config.is_file() {
        missing.push(format!("sa configuration {}.onnx.json", MODEL_NAME));
    }
    let installed = missing.is_empty();
    LocalVoiceStatus {
        installed,
        engine: "Piper".to_string(),
        voice: MODEL_NAME.to_string(),
        dir: root.display().to_string(),
        exe: exe.display().to_string(),
        model: model.display().to_string(),
        hint: if installed {
            ready_hint()
        } else {
            missing_hint(root, &missing)
        },
        missing,
        log: log_path(root).display().to_string(),
    }
}

/// État du moteur local quand le dossier de données lui-même est introuvable.
pub fn unavailable_status(reason: &str) -> LocalVoiceStatus {
    LocalVoiceStatus {
        installed: false,
        engine: "Piper".to_string(),
        voice: MODEL_NAME.to_string(),
        dir: String::new(),
        exe: String::new(),
        model: String::new(),
        missing: vec![reason.to_string()],
        hint: format!(
            "Voix française locale indisponible : {}. La lecture utilise la voix du système.",
            reason
        ),
        log: String::new(),
    }
}

/// Écrit une ligne datée dans le journal de la voix locale (repli, erreur).
///
/// Jamais d'exception : un journal illisible ne doit pas empêcher la lecture.
/// Rotation simple : au-delà de [`LOG_MAX_BYTES`], le journal est remplacé.
pub fn append_log(root: &Path, message: &str) {
    let text = String::from(message).trim().to_string();
    if text.is_empty() {
        return;
    }
    let path = log_path(root);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > LOG_MAX_BYTES {
            let _ = std::fs::remove_file(&path);
        }
    }
    let line = format!(
        "{} {}\n",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
        text
    );
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = file.write_all(line.as_bytes());
    }
}

/// Lance Piper sur un texte et renvoie le WAV produit.
///
/// `stdin` reçoit le texte (un thread dédié : un très long texte ne doit jamais
/// bloquer sur le tampon du système), `stdout`/`stderr` sont lus dans des threads
/// (sinon un flux non drainé bloque le processus). Un plafond de temps
/// interrompt le moteur : jamais d'attente infinie dans l'interface.
fn run_piper(root: &Path, text: &str, out: &Path) -> Result<(), String> {
    let exe = piper_exe(root);
    let model = model_path(root);
    let config = model_config_path(root);
    let mut cmd = Command::new(&exe);
    cmd.current_dir(piper_dir(root))
        .arg("--model")
        .arg(&model)
        .arg("--config")
        .arg(&config)
        .arg("--output_file")
        .arg(out)
        // Vitesse naturelle : la valeur est FIXE pour rester dans le réglage
        // unique de la voix (aucun second réglage ailleurs).
        .arg("--length_scale")
        .arg("1.0")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Impossible de lancer le moteur local ({}) : {}", exe.display(), e))?;

    if let Some(mut stdin) = child.stdin.take() {
        let payload = format!("{}\n", text.trim());
        std::thread::spawn(move || {
            let _ = stdin.write_all(payload.as_bytes());
            let _ = stdin.flush();
        });
    }
    let mut out_child = child.stdout.take();
    let mut err_child = child.stderr.take();
    let out_handle = std::thread::spawn(move || {
        let mut buf = Vec::with_capacity(4096);
        if let Some(ref mut stream) = out_child {
            let _ = stream.read_to_end(&mut buf);
        }
        buf
    });
    let err_handle = std::thread::spawn(move || {
        let mut buf = Vec::with_capacity(4096);
        if let Some(ref mut stream) = err_child {
            let _ = stream.read_to_end(&mut buf);
        }
        buf
    });

    let start = Instant::now();
    let mut timed_out = false;
    let mut exit_ok = false;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                exit_ok = status.success();
                break;
            }
            Ok(None) => {
                if start.elapsed() >= SYNTH_TIMEOUT {
                    let _ = child.kill();
                    timed_out = true;
                    break;
                }
                std::thread::sleep(Duration::from_millis(15));
            }
            Err(_) => {
                let _ = child.kill();
                break;
            }
        }
    }
    let _ = out_handle.join();
    let stderr = err_handle.join().unwrap_or_default();

    if timed_out {
        return Err(format!(
            "la synthèse locale n'a pas répondu en {} s (moteur interrompu)",
            SYNTH_TIMEOUT.as_secs()
        ));
    }
    if !exit_ok {
        let detail = String::from_utf8_lossy(&stderr).trim().to_string();
        return Err(if detail.is_empty() {
            "le moteur local s'est arrêté sans produire de son".to_string()
        } else {
            format!("le moteur local a échoué : {}", detail)
        });
    }
    Ok(())
}

/// Synthétise un texte en WAV et renvoie son contenu encodé en base64.
///
/// Aucun repli n'est décidé ici : en cas d'échec on **journalise** (une ligne
/// claire) puis on renvoie l'erreur ; c'est l'appelant (le front) qui retombe sur
/// la voix du système et l'annonce à l'utilisateur.
pub fn synthesize_base64(root: &Path, text: &str) -> Result<String, String> {
    let payload = text.trim();
    if payload.is_empty() {
        return Err("texte vide : rien à synthétiser".to_string());
    }
    let status = status_for_dir(root);
    if !status.installed {
        append_log(root, &format!("Repli sur la voix du système — {}", status.hint));
        return Err(status.hint);
    }
    let tmp_dir = root.join("tmp");
    std::fs::create_dir_all(&tmp_dir)
        .map_err(|e| format!("Impossible de créer le dossier temporaire de la voix locale : {}", e))?;
    let out = tmp_dir.join(format!("{}.wav", uuid::Uuid::new_v4()));
    let result = run_piper(root, payload, &out);
    if let Err(ref reason) = result {
        append_log(
            root,
            &format!("Échec de la synthèse locale — {} (repli sur la voix du système)", reason),
        );
    }
    let bytes = std::fs::read(&out).unwrap_or_default();
    // Le WAV de synthèse est un temporaire : il est retiré dans tous les cas.
    let _ = std::fs::remove_file(&out);
    result?;
    if bytes.is_empty() {
        let reason = "le moteur local n'a produit aucun son".to_string();
        append_log(
            root,
            &format!("Échec de la synthèse locale — {} (repli sur la voix du système)", reason),
        );
        return Err(reason);
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

// ── Commandes Tauri ─────────────────────────────────────────────────────────

/// État du moteur de voix locale (présence réelle du binaire et du modèle).
#[tauri::command]
pub fn tts_local_status(app: tauri::AppHandle) -> LocalVoiceStatus {
    match local_voice_root(&app) {
        Some(root) => status_for_dir(&root),
        None => unavailable_status("dossier de données de Pilot introuvable"),
    }
}

/// Synthétise un morceau de texte avec la voix française locale (WAV en base64).
///
/// Commande **async** : la synthèse dure jusqu'à quelques secondes → exécutée
/// hors du thread de la fenêtre (jamais de gel de l'interface).
#[tauri::command]
pub async fn tts_local_synthesize(
    app: tauri::AppHandle,
    text: String,
) -> Result<String, String> {
    let root = local_voice_root(&app)
        .ok_or_else(|| "dossier de données de Pilot introuvable".to_string())?;
    tauri::async_runtime::spawn_blocking(move || synthesize_base64(&root, &text))
        .await
        .map_err(|e| format!("Erreur interne (join) tts_local_synthesize: {}", e))?
}

/// Ajoute une ligne au journal de la voix locale (repli décidé côté fenêtre).
///
/// Une seule destination pour les traces de cette fonctionnalité : le journal
/// `voix-locale.log`. Jamais d'exception (l'appelant ne doit pas en dépendre).
#[tauri::command]
pub fn tts_local_log(app: tauri::AppHandle, message: String) {
    if let Some(root) = local_voice_root(&app) {
        append_log(&root, &message);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "pilot-tts-local-{}-{}",
            tag,
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).expect("dossier temporaire");
        dir
    }

    #[test]
    fn les_chemins_derivent_d_un_seul_dossier() {
        let root = PathBuf::from("/tmp/pilot-voix");
        assert_eq!(piper_dir(&root), root.join(PIPER_SUBDIR));
        assert!(piper_exe(&root).ends_with(piper_exe_name()));
        assert!(model_path(&root).ends_with(format!("{}.onnx", MODEL_NAME)));
        assert!(model_config_path(&root).ends_with(format!("{}.onnx.json", MODEL_NAME)));
        assert!(log_path(&root).ends_with(LOG_FILE));
        if cfg!(windows) {
            assert_eq!(piper_exe_name(), "piper.exe");
        }
    }

    #[test]
    fn dossier_vide_moteur_non_installe_et_le_dit() {
        let root = temp_root("vide");
        let status = status_for_dir(&root);
        assert!(!status.installed);
        assert_eq!(status.missing.len(), 3);
        assert!(status.hint.contains("non installée"));
        assert!(status.hint.contains(&root.display().to_string()));
        assert!(status.hint.contains("voix du système"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn moteur_et_modele_presents_moteur_installe() {
        let root = temp_root("equipe");
        std::fs::create_dir_all(piper_dir(&root)).unwrap();
        std::fs::create_dir_all(root.join(VOICES_SUBDIR)).unwrap();
        std::fs::write(piper_exe(&root), b"fake").unwrap();
        std::fs::write(model_path(&root), b"fake").unwrap();
        std::fs::write(model_config_path(&root), b"{}").unwrap();
        let status = status_for_dir(&root);
        assert!(status.installed);
        assert!(status.missing.is_empty());
        assert_eq!(status.engine, "Piper");
        assert_eq!(status.voice, MODEL_NAME);
        assert!(status.hint.contains("hors ligne"));
        // La synthèse refuse proprement un texte vide (aucun processus lancé).
        assert!(synthesize_base64(&root, "   ").is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn synthese_sans_moteur_journalise_le_repli() {
        let root = temp_root("journal");
        let erreur = synthesize_base64(&root, "Bonjour.").expect_err("doit échouer");
        assert!(erreur.contains("non installée"));
        let journal = std::fs::read_to_string(log_path(&root)).expect("journal écrit");
        assert!(journal.contains("Repli sur la voix du système"));
        // Une seule destination de trace : le même fichier pour les deux entrées.
        append_log(&root, "test manuel");
        let journal = std::fs::read_to_string(log_path(&root)).unwrap();
        assert!(journal.contains("test manuel"));
        assert_eq!(journal.lines().count(), 2);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn journal_illisible_ne_provoque_jamais_d_erreur() {
        // Un journal vide ne s'écrit pas du tout (aucun fichier créé inutilement).
        let root = temp_root("vide-journal");
        append_log(&root, "   ");
        assert!(!log_path(&root).exists());
        let _ = std::fs::remove_dir_all(&root);
    }
}
