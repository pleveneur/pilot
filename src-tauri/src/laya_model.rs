//! Modèle Laya — logique **pure** des décisions et des codes de sortie.
//!
//! Aucune entrée/sortie réseau. Ce module répond à trois questions, séparées
//! des entrées/sorties pour être testables sans rien télécharger :
//! 1. **où** se trouve le dossier du modèle (réglage vide = `<dossier du
//!    service>/model-ml`, chemin relatif résolu depuis le dossier du service,
//!    exactement comme `laya.rs` qui lance `node <service> <dossier>` avec
//!    `current_dir` = dossier du service) ;
//! 2. **faut-il télécharger** (modèle absent + case cochée + aucun
//!    téléchargement déjà en cours) ;
//! 3. **ce que signifie** un code de sortie du téléchargeur
//!    (`OK=0 RESEAU=1 ADRESSE=2 DISQUE=3 INTEGRITE=4`, cf. `laya-fetch.mjs`).
//!
//! Le manifeste (`model-manifest.json`, à côté du téléchargeur) est la source de
//! vérité des tailles et empreintes ; il est lu **sans jamais échouer** : absent
//! ou illisible, on retombe sur les 4 noms de fichiers connus.

use std::path::{Path, PathBuf};

use serde::Serialize;

/// Sous-dossier du modèle par défaut, à côté du service (dest du manifeste).
pub(crate) const DEFAULT_MODEL_DIR: &str = "model-ml";
/// Nom du téléchargeur, cherché à côté du service si le réglage est vide.
pub(crate) const DEFAULT_FETCH_FILE: &str = "laya-fetch.mjs";
/// Nom du manifeste, à côté du téléchargeur.
pub(crate) const DEFAULT_MANIFEST_FILE: &str = "model-manifest.json";
/// Valeur d'attente du manifeste : tant qu'elle est là, l'adresse d'hébergement
/// n'a pas été choisie (le téléchargeur refuse alors de démarrer).
pub(crate) const PLACEHOLDER_BASE_URL: &str = "A_CHOISIR";

/// Les 4 fichiers du modèle, utilisés si le manifeste est illisible.
pub(crate) const EXPECTED_MODEL_FILES: [&str; 4] = [
    "encoder.onnx",
    "head.onnx",
    "tokenizer.json",
    "rl_agent_config.json",
];

/// Une entrée du manifeste (taille et empreinte **peuvent** être inconnues).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ManifestFile {
    pub name: String,
    pub size: Option<u64>,
    pub sha256: Option<String>,
}

/// Manifeste exploitable : adresse d'hébergement (si renseignée) + fichiers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Manifest {
    pub base_url: Option<String>,
    pub files: Vec<ManifestFile>,
}

impl Manifest {
    /// Repli quand le manifeste est absent/illisible : les 4 noms connus, sans
    /// taille ni empreinte (jamais un échec, jamais une invention de chiffres).
    fn fallback() -> Manifest {
        Manifest {
            base_url: None,
            files: EXPECTED_MODEL_FILES
                .iter()
                .map(|name| ManifestFile {
                    name: (*name).to_string(),
                    size: None,
                    sha256: None,
                })
                .collect(),
        }
    }
}

/// Décision de téléchargement du modèle (PURE).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ModelAction {
    /// Rien à faire : modèle déjà là, ou téléchargement automatique désactivé.
    Nothing,
    /// Modèle absent, case cochée, aucun téléchargement en cours.
    Download,
    /// Un téléchargement est déjà en cours : ne jamais en lancer un second.
    AlreadyRunning,
}

/// Raison d'un état du modèle, lisible par l'interface (camelCase). Aucun code
/// ni nom technique n'est exposé à l'utilisateur.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum FetchReason {
    Ok,
    NetworkOffline,
    InvalidAddress,
    DiskFull,
    IntegrityFailed,
    /// Adresse d'hébergement non renseignée (réglage vide + manifeste en attente).
    AddressMissing,
    /// Aucun fichier `laya-fetch.mjs` à l'emplacement indiqué.
    FetchMissing,
    /// `node` introuvable sur la machine.
    NodeMissing,
    /// Téléchargement interrompu par l'utilisateur (les `.part` sont conservés).
    Cancelled,
    /// Déjà en cours (un seul téléchargement à la fois).
    AlreadyRunning,
    Unknown,
}

/// Dossier effectif du modèle. PURE : aucun accès disque.
///
/// - réglage vide → `<dossier du service>/model-ml` (défaut du manifeste et du
///   téléchargeur) ;
/// - chemin absolu → tel quel ;
/// - chemin relatif → résolu depuis le dossier du service (comme `laya.rs`).
pub(crate) fn resolve_model_dir(model_dir: &str, service_dir: &str) -> PathBuf {
    resolve_model_dir_with_default(
        model_dir,
        service_dir,
        &Path::new(service_dir).join(DEFAULT_MODEL_DIR),
    )
}

/// Même règle que `resolve_model_dir`, mais avec un dossier par défaut EXPLICITE.
/// PURE : aucun accès disque.
///
/// Sert au service **embarqué** dans les ressources de l'application : celles-ci
/// sont en LECTURE SEULE (une version installée dans `Program Files` ne se
/// laisse pas écrire), le modèle — 1,26 Go téléchargé — doit donc aller dans un
/// dossier inscriptible fourni par l'appelant (dossier de données de
/// l'application), jamais à côté du service livré. Un chemin réglé à la main
/// garde la priorité, donc un service externe ne change pas de comportement.
pub(crate) fn resolve_model_dir_with_default(
    model_dir: &str,
    service_dir: &str,
    default_dir: &Path,
) -> PathBuf {
    let trimmed = model_dir.trim();
    if trimmed.is_empty() {
        return default_dir.to_path_buf();
    }
    let path = Path::new(trimmed);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        Path::new(service_dir).join(path)
    }
}

/// Chemin effectif du téléchargeur. PURE : réglage vide → à côté du service.
pub(crate) fn resolve_fetch_path(fetch_path: &str, service_dir: &str) -> PathBuf {
    let trimmed = fetch_path.trim();
    if trimmed.is_empty() {
        return Path::new(service_dir).join(DEFAULT_FETCH_FILE);
    }
    let path = Path::new(trimmed);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        Path::new(service_dir).join(path)
    }
}

/// Manifeste à côté du téléchargeur. PURE.
pub(crate) fn manifest_path(fetch_path: &Path) -> PathBuf {
    fetch_path
        .parent()
        .unwrap_or_else(|| Path::new(""))
        .join(DEFAULT_MANIFEST_FILE)
}

/// Décision PURE de téléchargement. Priorité :
/// 1. un téléchargement en cours → `AlreadyRunning` (jamais deux à la fois) ;
/// 2. modèle présent → `Nothing` ;
/// 3. case décochée → `Nothing` (aucun téléchargement implicite) ;
/// 4. sinon → `Download`.
pub(crate) fn decide_model_action(present: bool, enabled: bool, downloading: bool) -> ModelAction {
    if downloading {
        return ModelAction::AlreadyRunning;
    }
    if present || !enabled {
        return ModelAction::Nothing;
    }
    ModelAction::Download
}

/// Traduit le code de sortie du téléchargeur (`laya-fetch.mjs`) en raison
/// lisible. PURE. Tout code hors plage est `Unknown` (jamais un panic).
pub(crate) fn fetch_exit_reason(code: i32) -> FetchReason {
    match code {
        0 => FetchReason::Ok,
        1 => FetchReason::NetworkOffline,
        2 => FetchReason::InvalidAddress,
        3 => FetchReason::DiskFull,
        4 => FetchReason::IntegrityFailed,
        _ => FetchReason::Unknown,
    }
}

/// Pourcentage borné 0..100 ; `None` si le total est inconnu (0). PURE.
pub(crate) fn percent(current: u64, total: u64) -> Option<u32> {
    if total == 0 {
        return None;
    }
    let p = (current as u128 * 100 / total as u128) as u32;
    Some(p.min(100))
}

/// Adresse d'hébergement effective : le réglage explicite gagne, sinon celle du
/// manifeste. PURE.
pub(crate) fn effective_base_url(cli: &str, manifest_base: Option<&str>) -> String {
    let cli = cli.trim();
    if !cli.is_empty() {
        return cli.to_string();
    }
    manifest_base.unwrap_or("").trim().to_string()
}

/// Vrai si aucune adresse exploitable n'est renseignée (vide ou valeur d'attente
/// du manifeste). PURE.
pub(crate) fn is_placeholder_base(base: &str) -> bool {
    let base = base.trim();
    base.is_empty() || base.eq_ignore_ascii_case(PLACEHOLDER_BASE_URL)
}

/// Analyse PURE du manifeste. `None` si le JSON est illisible, sans `files`, ou
/// si la liste est vide (jamais un panic, jamais un manifeste inventé).
pub(crate) fn parse_manifest(json: &str) -> Option<Manifest> {
    let value: serde_json::Value = serde_json::from_str(json).ok()?;
    let raw = value.get("files")?.as_array()?;
    let mut files = Vec::new();
    for entry in raw {
        let name = entry.get("name")?.as_str()?.to_string();
        if name.is_empty() {
            return None;
        }
        files.push(ManifestFile {
            name,
            size: entry.get("size").and_then(|v| v.as_u64()),
            sha256: entry
                .get("sha256")
                .and_then(|v| v.as_str())
                .map(str::to_string),
        });
    }
    if files.is_empty() {
        return None;
    }
    Some(Manifest {
        base_url: value
            .get("baseUrl")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        files,
    })
}

/// Lit le manifeste sur disque, **sans jamais échouer** : illisible → repli sur
/// les 4 noms connus (progression sans taille, donc pourcentage inconnu).
pub(crate) fn read_manifest(path: &Path) -> Manifest {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| parse_manifest(&raw))
        .unwrap_or_else(Manifest::fallback)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_dir_empty_means_default_next_to_service() {
        assert_eq!(
            resolve_model_dir("", "G:\\IA_PL\\LayaPL"),
            PathBuf::from("G:\\IA_PL\\LayaPL").join(DEFAULT_MODEL_DIR)
        );
        assert_eq!(
            resolve_model_dir("   ", "/opt/laya"),
            PathBuf::from("/opt/laya").join(DEFAULT_MODEL_DIR)
        );
    }

    // Service EMBARQUÉ : les ressources livrées sont en lecture seule, le modèle
    // (téléchargé) doit donc aller dans le dossier inscriptible fourni par
    // l'appelant — jamais dans le dossier livré. Un réglage explicite garde la
    // priorité, donc un service externe ne change pas de comportement.
    #[test]
    fn embedded_service_sends_default_model_dir_to_writable_dir() {
        let res = if cfg!(windows) {
            Path::new("C:\\Program Files\\Pilot\\laya")
        } else {
            Path::new("/usr/lib/pilot/laya")
        };
        let data = Path::new("/donnees-application/laya/model-ml");
        // Réglage vide : dossier de données, PAS le dossier livré.
        assert_eq!(
            resolve_model_dir_with_default("", &res.to_string_lossy(), data),
            data.to_path_buf()
        );
        // Réglage explicite : il gagne (service externe inchangé).
        assert_eq!(
            resolve_model_dir_with_default("mes-poids", &res.to_string_lossy(), data),
            res.join("mes-poids")
        );
        let abs = if cfg!(windows) { "C:\\poids\\ml" } else { "/poids/ml" };
        assert_eq!(
            resolve_model_dir_with_default(abs, "ignoré", data),
            PathBuf::from(abs)
        );
    }

    #[test]
    fn model_dir_relative_is_resolved_from_service_dir() {
        assert_eq!(
            resolve_model_dir("mes-poids", "/opt/laya"),
            PathBuf::from("/opt/laya").join("mes-poids")
        );
    }

    #[test]
    fn model_dir_absolute_is_kept() {
        let abs = if cfg!(windows) { "C:\\poids\\ml" } else { "/poids/ml" };
        assert_eq!(resolve_model_dir(abs, "/opt/laya"), PathBuf::from(abs));
        assert_eq!(resolve_model_dir(abs, ""), PathBuf::from(abs));
    }

    #[test]
    fn fetch_path_defaults_next_to_service() {
        assert_eq!(
            resolve_fetch_path("", "/opt/laya"),
            PathBuf::from("/opt/laya").join(DEFAULT_FETCH_FILE)
        );
        assert_eq!(
            resolve_fetch_path("outils/fetch.mjs", "/opt/laya"),
            PathBuf::from("/opt/laya").join("outils/fetch.mjs")
        );
        assert_eq!(
            manifest_path(Path::new("/opt/laya/laya-fetch.mjs")),
            PathBuf::from("/opt/laya").join(DEFAULT_MANIFEST_FILE)
        );
    }

    #[test]
    fn decision_never_downloads_twice_or_implicitly() {
        assert_eq!(
            decide_model_action(false, true, true),
            ModelAction::AlreadyRunning
        );
        assert_eq!(decide_model_action(true, true, false), ModelAction::Nothing);
        assert_eq!(decide_model_action(true, false, false), ModelAction::Nothing);
        assert_eq!(decide_model_action(false, false, false), ModelAction::Nothing);
        assert_eq!(decide_model_action(false, true, false), ModelAction::Download);
    }

    #[test]
    fn exit_codes_map_to_readable_reasons() {
        assert_eq!(fetch_exit_reason(0), FetchReason::Ok);
        assert_eq!(fetch_exit_reason(1), FetchReason::NetworkOffline);
        assert_eq!(fetch_exit_reason(2), FetchReason::InvalidAddress);
        assert_eq!(fetch_exit_reason(3), FetchReason::DiskFull);
        assert_eq!(fetch_exit_reason(4), FetchReason::IntegrityFailed);
        assert_eq!(fetch_exit_reason(5), FetchReason::Unknown);
        assert_eq!(fetch_exit_reason(-1), FetchReason::Unknown);
    }

    #[test]
    fn percent_is_bounded_and_unknown_without_total() {
        assert_eq!(percent(0, 100), Some(0));
        assert_eq!(percent(50, 100), Some(50));
        assert_eq!(percent(100, 100), Some(100));
        assert_eq!(percent(200, 100), Some(100));
        assert_eq!(percent(0, 0), None);
        assert_eq!(percent(10, 0), None);
    }

    #[test]
    fn base_url_prefers_explicit_setting_over_manifest() {
        assert_eq!(effective_base_url("https://a.test/x", Some("https://b")), "https://a.test/x");
        assert_eq!(effective_base_url("  ", Some("https://b")), "https://b");
        assert_eq!(effective_base_url("", None), "");
    }

    #[test]
    fn placeholder_base_is_reported_as_missing() {
        assert!(is_placeholder_base(""));
        assert!(is_placeholder_base("   "));
        assert!(is_placeholder_base("A_CHOISIR"));
        assert!(is_placeholder_base("a_choisir"));
        assert!(!is_placeholder_base("https://exemple.test/modele"));
    }

    #[test]
    fn manifest_parsing_reads_sizes_and_hashes() {
        let json = r#"{
            "baseUrl": "https://exemple.test/ml",
            "files": [
                {"name": "encoder.onnx", "size": 1230200269, "sha256": "aa"},
                {"name": "head.onnx", "size": 60129263, "sha256": "bb"}
            ]
        }"#;
        let m = parse_manifest(json).expect("manifeste valide");
        assert_eq!(m.base_url.as_deref(), Some("https://exemple.test/ml"));
        assert_eq!(m.files.len(), 2);
        assert_eq!(m.files[0].name, "encoder.onnx");
        assert_eq!(m.files[0].size, Some(1230200269));
        assert_eq!(m.files[0].sha256.as_deref(), Some("aa"));
    }

    #[test]
    fn manifest_parsing_tolerates_unknown_sizes_and_bad_input() {
        let partial = r#"{"baseUrl":"A_CHOISIR","files":[{"name":"x.onnx","size":null,"sha256":null}]}"#;
        let m = parse_manifest(partial).expect("taille inconnue acceptée");
        assert_eq!(m.files[0].size, None);
        assert_eq!(m.files[0].sha256, None);

        assert!(parse_manifest("pas du json").is_none());
        assert!(parse_manifest("{}").is_none());
        assert!(parse_manifest(r#"{"files":[]}"#).is_none());
    }

    #[test]
    fn missing_manifest_falls_back_to_known_names() {
        let missing = std::env::temp_dir().join("pilot-laya-manifeste-absent.json");
        let _ = std::fs::remove_file(&missing);
        let m = read_manifest(&missing);
        assert_eq!(m.base_url, None);
        assert_eq!(m.files.len(), EXPECTED_MODEL_FILES.len());
        assert_eq!(m.files[0].name, EXPECTED_MODEL_FILES[0]);
        assert_eq!(m.files[0].size, None);
    }
}
