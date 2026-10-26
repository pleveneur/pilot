// tts_local.rs — Voix française LOCALE (hors ligne) pour la lecture à voix haute.
//
// Moteur : **Piper** (exécutable local + un modèle ONNX de la table [`VOICES`],
// ≈ 28 à 64 Mo selon la voix choisie). Contraintes tenues ici, une seule fois :
//   - **hors ligne à la lecture** : ce module ne télécharge RIEN et ne fait
//     AUCUN appel réseau — le moteur lit le texte sur son entrée standard et
//     écrit un WAV local, que la fenêtre joue. Le téléchargement d'un modèle
//     (geste explicite de l'utilisateur) vit dans un module distinct,
//     `tts_local_download.rs` ;
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

/// Un modèle de voix française locale proposé au choix.
///
/// **Table de référence** des voix locales (une seule, dans tout le dépôt) :
/// noms techniques, genre et tailles EXACTES relevées dans le dépôt officiel des
/// modèles Piper (`rhasspy/piper-voices`, `fr/fr_FR/`, fichier `voices.json`).
/// Une voix qui n'y figure pas n'est pas proposée : on n'invente aucun nom.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LocalVoice {
    /// Nom technique du modèle (`fr_FR-<voix>-<qualité>`).
    pub model: &'static str,
    /// Genre de la voix, tel qu'annoncé à l'utilisateur (`femme` / `homme`).
    pub gender: &'static str,
    /// Qualité du modèle (`low` / `medium`).
    pub quality: &'static str,
    /// Taille exacte du fichier `.onnx` (octets).
    pub onnx_bytes: u64,
    /// Taille exacte du fichier `.onnx.json` (octets).
    pub config_bytes: u64,
}

/// Voix françaises locales retenues. Mono-locuteur uniquement (les modèles
/// multi-locuteurs demanderaient un choix de locuteur supplémentaire).
pub const VOICES: &[LocalVoice] = &[
    LocalVoice {
        model: "fr_FR-siwis-medium",
        gender: "femme",
        quality: "medium",
        onnx_bytes: 63_201_294,
        config_bytes: 4_875,
    },
    LocalVoice {
        model: "fr_FR-siwis-low",
        gender: "femme",
        quality: "low",
        onnx_bytes: 28_130_791,
        config_bytes: 4_157,
    },
    LocalVoice {
        model: "fr_FR-tom-medium",
        gender: "homme",
        quality: "medium",
        onnx_bytes: 63_511_038,
        config_bytes: 4_959,
    },
    LocalVoice {
        model: "fr_FR-gilles-low",
        gender: "homme",
        quality: "low",
        onnx_bytes: 63_104_526,
        config_bytes: 4_158,
    },
];

/// Modèle par DÉFAUT (≈ 63 Mo) : c'est la voix que désigne la valeur historique
/// de la configuration (« voix locale », sans nom de modèle) — une
/// configuration déjà enregistrée ne casse donc jamais.
pub const DEFAULT_MODEL_NAME: &str = "fr_FR-siwis-medium";
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
    /// Nom du modèle attendu (`fr_FR-<voix>-<qualité>`).
    pub voice: String,
    /// Genre de la voix (`femme` / `homme`).
    pub gender: String,
    /// Qualité du modèle (`low` / `medium`).
    pub quality: String,
    /// Taille exacte attendue du fichier `.onnx` (octets).
    pub model_bytes: u64,
    /// Vrai si le binaire du moteur est présent.
    pub engine_present: bool,
    /// Dossier du moteur réellement utilisé (vide s'il est introuvable).
    pub engine_dir: String,
    /// Vrai si le moteur vient d'une AUTRE version de Pilot du même ordinateur.
    pub engine_shared: bool,
    /// Vrai si le modèle ET sa configuration sont présents.
    pub model_present: bool,
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

/// Vrai si Pilot sait installer LUI-MÊME le moteur de lecture sur ce système.
///
/// Le moteur fourni est le binaire Windows (archive officielle Piper). Sur
/// macOS et Linux, Pilot ne télécharge donc **rien** pour le moteur : le
/// message le dit, indique le dossier, et la lecture reste proprement sur la
/// voix du système (aucune erreur, aucun plantage, aucun succès mensonger).
pub fn engine_install_supported() -> bool {
    cfg!(windows)
}

/// Vrai si le fichier existe **ET** fait exactement la taille attendue.
///
/// Un fichier tronqué (téléchargement coupé, copie interrompue, ancien défaut)
/// n'est **jamais** déclaré installé : sans cette règle, Pilot annonçait
/// « installé » un modèle incomplet et la lecture échouait à chaque fois sans
/// que rien ne l'explique. Une taille attendue inconnue (`0`) se contente de la
/// présence du fichier.
pub fn file_complete(path: &Path, expected: u64) -> bool {
    match std::fs::metadata(path) {
        Ok(meta) => meta.is_file() && (expected == 0 || meta.len() == expected),
        Err(_) => false,
    }
}

/// Racine « produit » d'un identifiant d'application.
///
/// La version installée et la version de développement de Pilot
/// (`com.pilot.editor` / `com.pilot.editor.dev`) sont le **même produit** : elles
/// partagent donc le même moteur local (un binaire identique sur le même
/// ordinateur). Sans cela, un moteur installé une fois restait invisible pour
/// l'autre version, et la lecture retombait **toujours** sur la voix du système
/// dans le dossier de données qui ne le contenait pas.
pub fn product_identifier(identifier: &str) -> String {
    let id = identifier.trim();
    match id.strip_suffix(".dev") {
        Some(base) if !base.is_empty() => base.to_string(),
        _ => id.to_string(),
    }
}

/// Vrai si un nom de dossier de données appartient au même produit Pilot
/// (`com.pilot.editor`, `com.pilot.editor.dev`, …).
pub fn is_product_data_dir(name: &str, product: &str) -> bool {
    if product.is_empty() || name.is_empty() {
        return false;
    }
    name == product || name.starts_with(&format!("{}.", product))
}

/// Dossiers candidats du MOTEUR, dans l'ordre :
///  1. le dossier de données de CETTE version de Pilot ;
///  2. ceux des autres versions de Pilot du même ordinateur (triés par nom),
///     pour réutiliser un moteur déjà installé une fois.
///
/// Lecture seule : aucun fichier n'est copié, déplacé ni supprimé.
pub fn engine_candidate_roots(own_root: &Path, product: &str) -> Vec<PathBuf> {
    let mut roots = vec![own_root.to_path_buf()];
    // `own_root` = `<dossier des identifiants>/<identifiant>/voix-locale` : on
    // regarde les dossiers de données frères, sous le même dossier parent.
    let Some(data_dir) = own_root.parent() else {
        return roots;
    };
    let own_name = data_dir
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    let Some(appdata) = data_dir.parent() else {
        return roots;
    };
    if let Ok(entries) = std::fs::read_dir(appdata) {
        let mut names: Vec<String> = entries
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.path().is_dir())
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .filter(|name| name != &own_name && is_product_data_dir(name, product))
            .collect();
        names.sort();
        for name in names {
            roots.push(appdata.join(name).join(LOCAL_VOICE_DIR));
        }
    }
    roots
}

/// Dossier du moteur réellement utilisable pour une instance de Pilot, et
/// l'information « trouvé ailleurs que dans le dossier courant ».
///
/// Le dossier courant est toujours essayé en premier ; à défaut, le moteur d'une
/// autre version de Pilot du même ordinateur est réutilisé (aucune copie).
pub fn resolve_engine_root(own_root: &Path, product: &str) -> (PathBuf, bool) {
    for candidate in engine_candidate_roots(own_root, product) {
        if piper_exe(&candidate).is_file() {
            let shared = candidate != own_root;
            return (candidate, shared);
        }
    }
    (own_root.to_path_buf(), false)
}

/// Voix demandée, ou voix par défaut si le nom est absent/inconnu (jamais
/// d'échec : une valeur de configuration inattendue retombe sur une voix qui
/// existe forcément).
pub fn voice_for(model: Option<&str>) -> &'static LocalVoice {
    let wanted = model.map(str::trim).filter(|m| !m.is_empty());
    match wanted {
        Some(name) => VOICES.iter().find(|v| v.model == name).unwrap_or(&VOICES[0]),
        None => &VOICES[0],
    }
}

/// Chemin du modèle ONNX d'une voix donnée.
pub fn model_path(root: &Path, model: &str) -> PathBuf {
    root.join(VOICES_SUBDIR).join(format!("{}.onnx", model))
}

/// Chemin de la configuration du modèle (`<modèle>.onnx.json`).
pub fn model_config_path(root: &Path, model: &str) -> PathBuf {
    root.join(VOICES_SUBDIR)
        .join(format!("{}.onnx.json", model))
}

/// Chemin du journal de la voix locale.
pub fn log_path(root: &Path) -> PathBuf {
    root.join(LOG_FILE)
}

/// Libellé lisible du genre d'une voix (« voix de femme », « voix d'homme »).
pub fn gender_label(gender: &str) -> &'static str {
    if gender == "homme" {
        "voix d'homme"
    } else {
        "voix de femme"
    }
}

/// Phrase affichée quand tout est en place.
pub fn ready_hint(voice: &LocalVoice) -> String {
    format!(
        "Voix française locale prête : Piper et le modèle {}, une {}, qualité {}, sont installés — \
         lecture hors ligne, sans clé et sans carte graphique.",
        voice.model,
        gender_label(voice.gender),
        voice.quality
    )
}

/// Phrase affichée quand le moteur a été trouvé dans une AUTRE version de Pilot
/// du même ordinateur (aucune copie : le même binaire sert aux deux).
pub fn ready_hint_shared(voice: &LocalVoice, engine_root: &Path) -> String {
    format!(
        "{} Le moteur de lecture déjà installé pour Pilot sur cet ordinateur est réutilisé \
         (« {} ») : rien n'a été copié ni supprimé.",
        ready_hint(voice),
        engine_root.display()
    )
}

/// Phrase affichée quand il manque quelque chose.
///
/// Trois situations distinctes, dites en clair et **sans jargon** :
///  - le **moteur** manque sur un système que Pilot sait équiper (Windows) →
///    **un seul geste** (« Installer la voix locale ») télécharge le moteur ET
///    les deux voix françaises, une seule fois et sur demande explicite ;
///  - le **moteur** manque sur un système pour lequel Pilot ne fournit pas de
///    moteur (macOS, Linux) → on le dit, on donne le dossier, et la lecture
///    reste proprement sur la voix du système ;
///  - seul un **modèle** manque → le même geste le récupère.
/// Dans tous les cas, la lecture utilise la voix du système en attendant (repli
/// journalisé, jamais muet).
pub fn missing_hint(root: &Path, missing: &[String], engine_missing: bool) -> String {
    if engine_missing && !engine_install_supported() {
        return format!(
            "La voix française locale n'est pas encore installée sur cet ordinateur : Pilot ne \
             fournit pas le moteur de lecture pour ce système. Placez le moteur Piper de votre \
             système dans « {} », puis cliquez sur « Vérifier à nouveau » ; les voix, elles, se \
             téléchargent avec « Installer la voix locale ». En attendant, la lecture utilise la \
             voix du système.",
            piper_dir(root).display()
        );
    }
    if engine_missing {
        return format!(
            "La voix française locale n'est pas encore installée sur cet ordinateur : il manque le \
             moteur de lecture. Cliquez sur « Installer la voix locale » : tout est téléchargé une \
             seule fois, sur votre demande, dans « {} » (le moteur et les deux voix françaises, une \
             femme et un homme), puis la lecture se fait hors ligne. En attendant, la lecture \
             utilise la voix du système.",
            root.display()
        );
    }
    let mut what = String::new();
    for (index, item) in missing.iter().enumerate() {
        if index > 0 {
            what.push_str(", ");
        }
        what.push_str(item);
    }
    format!(
        "La voix française locale n'est pas encore installée sur cet ordinateur : il manque {}. \
         Cliquez sur « Télécharger » pour récupérer cette voix depuis Internet, une seule fois et sur \
         votre demande ; elle reste ensuite sur l'ordinateur et la lecture se fait hors ligne. \
         En attendant, la lecture utilise la voix du système.",
        what
    )
}

/// État du moteur local pour un dossier donné (fonction sans effet de bord :
/// testable sur un dossier temporaire, sans lancer Piper).
pub fn status_for_dir(root: &Path, model: Option<&str>) -> LocalVoiceStatus {
    status_for_dir_with_engine(root, root, model)
}

/// État du moteur local pour un dossier de données donné et un dossier de moteur
/// donné (le moteur peut être celui d'une autre version de Pilot du même
/// ordinateur : `engine_root != root`, aucun fichier copié).
pub fn status_for_dir_with_engine(
    root: &Path,
    engine_root: &Path,
    model: Option<&str>,
) -> LocalVoiceStatus {
    let voice = voice_for(model);
    let shared = engine_root != root;
    let exe = piper_exe(engine_root);
    let model_file = model_path(root, voice.model);
    let config = model_config_path(root, voice.model);
    let mut missing = Vec::new();
    let engine_present = exe.is_file();
    if !engine_present {
        missing.push(format!("le moteur Piper ({})", piper_exe_name()));
    }
    // Taille EXACTE attendue : un fichier tronqué compte comme manquant (il sera
    // réparé, jamais considéré comme installé).
    let model_ok = file_complete(&model_file, voice.onnx_bytes);
    let config_ok = file_complete(&config, voice.config_bytes);
    if !model_ok {
        missing.push(if model_file.exists() {
            format!("le modèle {}.onnx (incomplet)", voice.model)
        } else {
            format!("le modèle {}.onnx", voice.model)
        });
    }
    if !config_ok {
        missing.push(if config.exists() {
            format!("sa configuration {}.onnx.json (incomplète)", voice.model)
        } else {
            format!("sa configuration {}.onnx.json", voice.model)
        });
    }
    let installed = missing.is_empty();
    LocalVoiceStatus {
        installed,
        engine: "Piper".to_string(),
        voice: voice.model.to_string(),
        gender: voice.gender.to_string(),
        quality: voice.quality.to_string(),
        model_bytes: voice.onnx_bytes,
        engine_present,
        engine_dir: if engine_present {
            engine_root.display().to_string()
        } else {
            String::new()
        },
        engine_shared: installed && shared,
        model_present: model_ok && config_ok,
        dir: root.display().to_string(),
        exe: exe.display().to_string(),
        model: model_file.display().to_string(),
        hint: if installed {
            if shared {
                ready_hint_shared(voice, engine_root)
            } else {
                ready_hint(voice)
            }
        } else {
            missing_hint(root, &missing, !engine_present)
        },
        missing,
        log: log_path(root).display().to_string(),
    }
}

/// État du moteur local quand le dossier de données lui-même est introuvable.
pub fn unavailable_status(reason: &str, model: Option<&str>) -> LocalVoiceStatus {
    let voice = voice_for(model);
    LocalVoiceStatus {
        installed: false,
        engine: "Piper".to_string(),
        voice: voice.model.to_string(),
        gender: voice.gender.to_string(),
        quality: voice.quality.to_string(),
        model_bytes: voice.onnx_bytes,
        engine_present: false,
        engine_dir: String::new(),
        engine_shared: false,
        model_present: false,
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
fn run_piper(root: &Path, engine_root: &Path, model_name: &str, text: &str, out: &Path) -> Result<(), String> {
    let exe = piper_exe(engine_root);
    let model = model_path(root, model_name);
    let config = model_config_path(root, model_name);
    let mut cmd = Command::new(&exe);
    cmd.current_dir(piper_dir(engine_root))
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
pub fn synthesize_base64(root: &Path, model: Option<&str>, text: &str) -> Result<String, String> {
    synthesize_base64_with_engine(root, root, model, text)
}

/// Comme [`synthesize_base64`], avec un dossier de moteur distinct du dossier de
/// données (moteur installé pour une autre version de Pilot du même ordinateur :
/// le binaire est réutilisé, les modèles restent dans le dossier courant).
pub fn synthesize_base64_with_engine(
    root: &Path,
    engine_root: &Path,
    model: Option<&str>,
    text: &str,
) -> Result<String, String> {
    let payload = text.trim();
    if payload.is_empty() {
        return Err("texte vide : rien à synthétiser".to_string());
    }
    let status = status_for_dir_with_engine(root, engine_root, model);
    if !status.installed {
        append_log(root, &format!("Repli sur la voix du système — {}", status.hint));
        return Err(status.hint);
    }
    let tmp_dir = root.join("tmp");
    std::fs::create_dir_all(&tmp_dir)
        .map_err(|e| format!("Impossible de créer le dossier temporaire de la voix locale : {}", e))?;
    let out = tmp_dir.join(format!("{}.wav", uuid::Uuid::new_v4()));
    let result = run_piper(root, engine_root, &status.voice, payload, &out);
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
///
/// `model` désigne la voix choisie (`fr_FR-<voix>-<qualité>`) ; absent, on rend
/// l'état de la voix par défaut (compatibilité avec la valeur historique).
#[tauri::command]
pub fn tts_local_status(app: tauri::AppHandle, model: Option<String>) -> LocalVoiceStatus {
    let wanted = model.as_deref();
    match roots_for(&app) {
        Some((root, engine_root)) => status_for_dir_with_engine(&root, &engine_root, wanted),
        None => unavailable_status("dossier de données de Pilot introuvable", wanted),
    }
}

/// Dossiers de CETTE instance de Pilot : (dossier de données, dossier du moteur).
///
/// Le moteur peut être celui déjà installé pour une autre version de Pilot du
/// même ordinateur (`com.pilot.editor` ↔ `com.pilot.editor.dev`) : le binaire est
/// alors réutilisé tel quel — rien n'est copié, déplacé ni supprimé.
fn roots_for(app: &tauri::AppHandle) -> Option<(PathBuf, PathBuf)> {
    let own = local_voice_root(app)?;
    let product = product_identifier(&app.config().identifier);
    let (engine, _shared) = resolve_engine_root(&own, &product);
    Some((own, engine))
}

/// Synthétise un morceau de texte avec la voix française locale (WAV en base64).
///
/// Commande **async** : la synthèse dure jusqu'à quelques secondes → exécutée
/// hors du thread de la fenêtre (jamais de gel de l'interface).
#[tauri::command]
pub async fn tts_local_synthesize(
    app: tauri::AppHandle,
    text: String,
    model: Option<String>,
) -> Result<String, String> {
    let (root, engine_root) = roots_for(&app)
        .ok_or_else(|| "dossier de données de Pilot introuvable".to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        synthesize_base64_with_engine(&root, &engine_root, model.as_deref(), &text)
    })
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

    /// Écrit un fichier de la taille EXACTE attendue, sans écrire les octets
    /// (`set_len` réserve la taille) : l'installation exige la taille exacte, un
    /// fichier de 4 octets n'est plus « installé ».
    fn write_sized(path: &Path, len: u64) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        let file = std::fs::File::create(path).expect("fichier de test");
        file.set_len(len).expect("taille du fichier de test");
    }

    /// Pose un modèle COMPLET (binaire + configuration, tailles exactes).
    fn write_voice(root: &Path, model: &str) {
        let voice = voice_for(Some(model));
        write_sized(&model_path(root, voice.model), voice.onnx_bytes);
        write_sized(&model_config_path(root, voice.model), voice.config_bytes);
    }

    #[test]
    fn les_chemins_derivent_d_un_seul_dossier() {
        let root = PathBuf::from("/tmp/pilot-voix");
        assert_eq!(piper_dir(&root), root.join(PIPER_SUBDIR));
        assert!(piper_exe(&root).ends_with(piper_exe_name()));
        assert!(model_path(&root, DEFAULT_MODEL_NAME)
            .ends_with(format!("{}.onnx", DEFAULT_MODEL_NAME)));
        assert!(model_config_path(&root, DEFAULT_MODEL_NAME)
            .ends_with(format!("{}.onnx.json", DEFAULT_MODEL_NAME)));
        assert!(log_path(&root).ends_with(LOG_FILE));
        if cfg!(windows) {
            assert_eq!(piper_exe_name(), "piper.exe");
        }
    }

    #[test]
    fn la_table_des_voix_est_complete_et_sans_doublon() {
        // Au moins une voix de femme ET une voix d'homme (exigence utilisateur).
        assert!(VOICES.iter().any(|v| v.gender == "femme"));
        assert!(VOICES.iter().any(|v| v.gender == "homme"));
        // La voix par défaut désignée par la valeur historique est bien dans la
        // table (compatibilité : une configuration sans nom de modèle continue
        // de fonctionner).
        assert_eq!(VOICES[0].model, DEFAULT_MODEL_NAME);
        assert_eq!(voice_for(None).model, DEFAULT_MODEL_NAME);
        assert_eq!(voice_for(Some("")).model, DEFAULT_MODEL_NAME);
        // Nom inconnu : repli sur la voix par défaut, jamais d'échec.
        assert_eq!(voice_for(Some("fr_FR-inconnue-medium")).model, DEFAULT_MODEL_NAME);
        let mut noms: Vec<&str> = VOICES.iter().map(|v| v.model).collect();
        noms.sort_unstable();
        noms.dedup();
        assert_eq!(noms.len(), VOICES.len(), "aucun modèle en double");
        // Tailles cohérentes (aucune valeur nulle, ordre de grandeur attendu).
        for v in VOICES {
            assert!(v.onnx_bytes > 10_000_000, "{} : taille .onnx", v.model);
            assert!(v.config_bytes > 1_000, "{} : taille .onnx.json", v.model);
            assert!(v.model.starts_with("fr_FR-"), "{} : préfixe", v.model);
        }
    }

    #[test]
    fn chaque_voix_a_un_chemin_de_modele_propre() {
        let root = PathBuf::from("/tmp/pilot-voix");
        let mut chemins: Vec<String> = Vec::new();
        for v in VOICES {
            let chemin = model_path(&root, v.model).display().to_string();
            assert!(!chemins.contains(&chemin), "{} partage un chemin", v.model);
            chemins.push(chemin);
        }
    }

    #[test]
    fn dossier_vide_moteur_non_installe_et_le_dit() {
        let root = temp_root("vide");
        let status = status_for_dir(&root, None);
        assert!(!status.installed);
        assert_eq!(status.missing.len(), 3);
        assert!(!status.engine_present);
        assert!(status.engine_dir.is_empty());
        assert!(!status.engine_shared);
        // Phrase claire et non technique : « pas encore installée » + où + quoi faire.
        assert!(status.hint.contains("pas encore installée"));
        assert!(status.hint.contains(&root.display().to_string()));
        assert!(status.hint.contains("voix du système"));
        // Le geste unique est nommé, et rien ne se télécharge sans lui : la
        // phrase le dit (plus de « déposez le dossier »).
        assert!(status.hint.contains("Installer la voix locale"));
        // Le MOTEUR, lui, ne se télécharge que là où Pilot sait l'installer
        // (Windows). Ailleurs (macOS, Linux), la phrase doit dire la limite et
        // le geste qui reste à faire — jamais promettre une installation que
        // Pilot ne sait pas faire.
        if engine_install_supported() {
            assert!(
                status.hint.contains("sur votre demande"),
                "le téléchargement doit être dit « sur votre demande » : {}",
                status.hint
            );
        } else {
            assert!(
                status.hint.contains("ne fournit pas le moteur"),
                "la limite de la plateforme doit être dite : {}",
                status.hint
            );
            assert!(
                status.hint.contains(&piper_dir(&root).display().to_string()),
                "le dossier attendu du moteur doit être donné : {}",
                status.hint
            );
            assert!(
                status.hint.contains("Vérifier à nouveau"),
                "le geste à faire doit être nommé : {}",
                status.hint
            );
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Prépare un « ordinateur » avec deux versions de Pilot (installée + dev) :
    /// renvoie (parent, dossier installé, dossier dev).
    fn deux_versions_de_pilot(tag: &str) -> (PathBuf, PathBuf, PathBuf) {
        let parent = temp_root(tag);
        let installed = parent.join("com.pilot.editor").join(LOCAL_VOICE_DIR);
        let dev = parent.join("com.pilot.editor.dev").join(LOCAL_VOICE_DIR);
        std::fs::create_dir_all(piper_dir(&installed)).unwrap();
        std::fs::create_dir_all(dev.join(VOICES_SUBDIR)).unwrap();
        std::fs::write(piper_exe(&installed), b"fake").unwrap();
        (parent, installed, dev)
    }

    #[test]
    fn le_moteur_de_l_autre_version_de_pilot_est_reutilise() {
        // Cas réel du poste : le moteur a été installé une seule fois (version
        // installée), le mode test utilise un AUTRE dossier de données. Sans
        // réutilisation, la lecture retombait toujours sur la voix du système.
        let (parent, installed, dev) = deux_versions_de_pilot("partage");
        write_voice(&dev, "fr_FR-tom-medium");

        let (engine_root, shared) = resolve_engine_root(&dev, "com.pilot.editor");
        assert_eq!(engine_root, installed);
        assert!(shared, "le moteur vient de l'autre version : c'est dit");

        // La voix d'homme choisie devient réellement utilisable…
        let status = status_for_dir_with_engine(&dev, &engine_root, Some("fr_FR-tom-medium"));
        assert!(status.installed);
        assert!(status.engine_present);
        assert!(status.engine_shared);
        assert_eq!(status.voice, "fr_FR-tom-medium");
        assert_eq!(status.gender, "homme");
        assert!(status.missing.is_empty());
        // …et le partage est VISIBLE, jamais muet.
        assert!(status.hint.contains("réutilisé"));
        assert!(status.hint.contains(&installed.display().to_string()));
        // Les modèles, eux, restent dans le dossier de données courant.
        assert_eq!(status.dir, dev.display().to_string());
        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn un_dossier_voisin_etranger_n_est_jamais_utilise() {
        // Garde-fou : on ne prend pas le premier venu sur l'ordinateur.
        let parent = temp_root("etranger");
        let etranger = parent.join("com.autre.appli").join(LOCAL_VOICE_DIR);
        let dev = parent.join("com.pilot.editor.dev").join(LOCAL_VOICE_DIR);
        std::fs::create_dir_all(piper_dir(&etranger)).unwrap();
        std::fs::write(piper_exe(&etranger), b"fake").unwrap();
        std::fs::create_dir_all(&dev).unwrap();
        let (engine_root, shared) = resolve_engine_root(&dev, "com.pilot.editor");
        assert_eq!(engine_root, dev, "dossier courant quand aucun moteur n'est trouvé");
        assert!(!shared);
        assert!(!status_for_dir(&dev, None).engine_present);
        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn le_produit_regroupe_les_identifiants_de_pilot() {
        assert_eq!(product_identifier("com.pilot.editor.dev"), "com.pilot.editor");
        assert_eq!(product_identifier("com.pilot.editor"), "com.pilot.editor");
        assert_eq!(product_identifier("  com.pilot.editor.dev  "), "com.pilot.editor");
        assert_eq!(product_identifier(".dev"), ".dev", "aucune racine vide");
        assert!(is_product_data_dir("com.pilot.editor", "com.pilot.editor"));
        assert!(is_product_data_dir("com.pilot.editor.dev", "com.pilot.editor"));
        assert!(!is_product_data_dir("com.pilot.editorial", "com.pilot.editor"));
        assert!(!is_product_data_dir("com.autre.appli", "com.pilot.editor"));
        assert!(!is_product_data_dir("com.pilot.editor", ""));
    }

    #[test]
    fn moteur_et_modele_presents_moteur_installe() {
        let root = temp_root("equipe");
        std::fs::create_dir_all(piper_dir(&root)).unwrap();
        std::fs::create_dir_all(root.join(VOICES_SUBDIR)).unwrap();
        std::fs::write(piper_exe(&root), b"fake").unwrap();
        write_voice(&root, DEFAULT_MODEL_NAME);
        let status = status_for_dir(&root, None);
        assert!(status.installed);
        assert!(status.missing.is_empty());
        assert_eq!(status.engine, "Piper");
        assert_eq!(status.voice, DEFAULT_MODEL_NAME);
        assert_eq!(status.gender, "femme");
        assert!(status.engine_present);
        assert!(status.model_present);
        assert!(status.hint.contains("hors ligne"));
        // La synthèse refuse proprement un texte vide (aucun processus lancé).
        assert!(synthesize_base64(&root, None, "   ").is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn une_voix_masculine_a_ses_propres_fichiers_et_son_propre_etat() {
        let root = temp_root("homme");
        std::fs::create_dir_all(piper_dir(&root)).unwrap();
        std::fs::create_dir_all(root.join(VOICES_SUBDIR)).unwrap();
        std::fs::write(piper_exe(&root), b"fake").unwrap();
        // Seul le modèle par DÉFAUT est installé.
        write_voice(&root, DEFAULT_MODEL_NAME);
        // La voix d'homme (tom) : le moteur est là, mais SON modèle manque.
        let tom = status_for_dir(&root, Some("fr_FR-tom-medium"));
        assert!(!tom.installed);
        assert!(!tom.model_present);
        assert!(tom.engine_present);
        assert_eq!(tom.voice, "fr_FR-tom-medium");
        assert_eq!(tom.gender, "homme");
        assert_eq!(tom.missing.len(), 2);
        // Et la voix par défaut reste, elle, installée : aucun état mélangé.
        assert!(status_for_dir(&root, None).installed);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn un_modele_tronque_n_est_jamais_declare_installe() {
        // Défaut corrigé : un fichier incomplet (téléchargement coupé, copie
        // interrompue) était compté comme présent, Pilot annonçait « installé »
        // et la lecture échouait à chaque fois.
        let root = temp_root("tronque");
        std::fs::create_dir_all(piper_dir(&root)).unwrap();
        std::fs::write(piper_exe(&root), b"fake").unwrap();
        write_voice(&root, DEFAULT_MODEL_NAME);
        assert!(status_for_dir(&root, None).installed);

        // Modèle tronqué (10 Mo de moins) : plus installé, et le manque est DIT.
        let voice = voice_for(None);
        write_sized(&model_path(&root, voice.model), voice.onnx_bytes - 10_000_000);
        let status = status_for_dir(&root, None);
        assert!(!status.installed, "un modèle tronqué n'est pas installé");
        assert!(!status.model_present);
        assert_eq!(status.missing.len(), 1);
        assert!(status.missing[0].contains("incomplet"));

        // Configuration tronquée : même règle, mêmes conséquences.
        write_voice(&root, DEFAULT_MODEL_NAME);
        write_sized(&model_config_path(&root, voice.model), 10);
        let status = status_for_dir(&root, None);
        assert!(!status.installed);
        assert_eq!(status.missing.len(), 1);
        assert!(status.missing[0].contains("incomplète"));

        // Fichier complet : de nouveau installé (aucune autre règle cachée).
        write_voice(&root, DEFAULT_MODEL_NAME);
        assert!(status_for_dir(&root, None).installed);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn le_moteur_n_est_propose_au_telechargement_que_la_ou_pilot_sait_l_installer() {
        // Windows : Pilot installe le moteur lui-même. macOS / Linux : il ne
        // fournit rien pour le moteur, et le dit sans erreur.
        assert_eq!(engine_install_supported(), cfg!(windows));
        let root = PathBuf::from("/tmp/pilot-voix");
        let hint = missing_hint(&root, &[], true);
        assert!(hint.contains("voix du système"), "le repli est toujours dit");
        if engine_install_supported() {
            assert!(hint.contains("Installer la voix locale"));
            assert!(!hint.contains("Déposez"));
        } else {
            assert!(hint.contains("ne fournit pas le moteur"));
            assert!(hint.contains("Vérifier à nouveau"));
        }
    }

    #[test]
    fn synthese_sans_moteur_journalise_le_repli() {
        let root = temp_root("journal");
        let erreur = synthesize_base64(&root, None, "Bonjour.").expect_err("doit échouer");
        assert!(erreur.contains("pas encore installée"));
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
