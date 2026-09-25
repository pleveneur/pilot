// git.rs — Dépôts git serveur GDS (spec_gds.md §4)
//
// Déplacé de `src-tauri/src/gds_git.rs` (refonte GDS, L1.5) : un repo bare par
// projet (`<gds_repos_dir>/<projet>.git`), transport SSH par clef liée à
// l'email. Réutilise `git_init_bare` de `git_cmd` (le desk ne s'en sert plus
// que dans ses tests). Valide les chemins (anti path traversal).
//
// L2.6 — conteneur : `ensure_project_bares` matérialise les dépôts annoncés en
// base dans la **racine du serveur** (`<racine>/<projet>.git`, spec §2.3/§2.4 :
// `/srv/git/repos`), en réutilisant le MÊME code de création que `add_project`
// (`git_init_bare`, via `ensure_bare`). Le poste écrit dans la base sans pouvoir
// exécuter quoi que ce soit sur le serveur (décision 11) : la matérialisation
// automatique remplace le `git init --bare` manuel de
// `docs/gds-server-setup.md`.

use crate::db;
use crate::git_cmd::git_init_bare;
use crate::proc::run_captured_full;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::path::PathBuf;
use std::time::Duration;

/// Dossier des repos serveur (`<gds_local_dir>/repos`).
pub fn repos_dir(gds_local_dir: &str) -> PathBuf {
    PathBuf::from(gds_local_dir).join("repos")
}

/// Chemin du repo bare d'un projet (`<gds_repos_dir>/<projet>.git`).
pub fn repo_bare_path(gds_local_dir: &str, project_name: &str) -> PathBuf {
    repos_dir(gds_local_dir).join(format!("{}.git", project_name))
}

/// Vrai si le repo bare d'un projet existe déjà sur le serveur GDS local
/// (`<gds_local_dir>/repos/<projet>.git`). V1 = serveur local, le dossier des
/// repos est sous `gds_local_dir` partagé (chantier UX GDS, Etape 5).
pub fn bare_repo_exists(gds_local_dir: &str, project_name: &str) -> bool {
    repo_bare_path(gds_local_dir, project_name).exists()
}

/// Valide un nom de projet (anti path traversal) : pas de séparateur, pas de `..`.
pub fn validate_project_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Nom de projet vide".to_string());
    }
    let has_sep = name.contains('/') || name.contains('\\') || name.contains("..") || name.contains(' ');
    if has_sep {
        return Err("Nom de projet invalide".to_string());
    }
    Ok(name.to_string())
}

/// Nom du dépôt bare (`<nom>.git`) — nom validé (anti path traversal).
/// Partagé par les deux modes : LOCAL (`add_project`) et DISTANT
/// (`add_project_remote`), pour garantir le MÊME contrat de nommage.
pub fn repo_name_for(project_name: &str) -> Result<String, String> {
    Ok(format!("{}.git", validate_project_name(project_name)?))
}

/// Supprime le repo bare d'un projet du serveur GDS (Évolution 2). Chemin
/// validé via `validate_project_name` (anti path traversal) et verrouillé sur
/// le dossier `repos` GDS : on ne supprime JAMAIS hors du dossier repos.
pub fn remove_bare(gds_local_dir: &str, project_name: &str) -> Result<(), String> {
    let name = validate_project_name(project_name)?;
    let bare = repo_bare_path(gds_local_dir, &name);
    // Ceinture + bretelles : le chemin doit rester sous le dossier repos GDS.
    let repos = repos_dir(gds_local_dir);
    if !bare.starts_with(&repos) {
        return Err(format!("Chemin bare invalide (hors repos GDS): {}", bare.display()));
    }
    if bare.exists() {
        std::fs::remove_dir_all(&bare)
            .map_err(|e| format!("Suppression du dépôt bare {}: {}", bare.display(), e))?;
    }
    Ok(())
}

/// Refonte GDS **L3.4** — l'appartenance à un projet est un **droit** : aucune
/// inscription automatique pour un compte qui n'y est pas autorisé.
///
/// À la création d'un projet **neuf**, son créateur est rattaché d'office : sans
/// ce rattachement, un **développeur** n'est pas membre de son propre projet et
/// se bloque lui-même à l'opération suivante (la garde de publication exige
/// d'être attribué au projet, cf. `db::ensure_project_publisher`). Un créateur
/// **administrateur** reste rattaché même quand le projet existe déjà
/// (responsable de ses projets) ; un rôle non autorisé à ajouter un projet
/// (`standard`, `root`) n'est jamais rattaché.
async fn enroll_creator(pool: &PgPool, project_id: i64, email: &str, created: bool) {
    if let Ok(Some(user)) = db::get_user_by_email(pool, email).await {
        if should_enroll_creator(created, &user.role) {
            let _ = db::assign_project(pool, project_id, user.id, "dev").await;
        }
    }
}

/// Décision **pure** du rattachement d'office du créateur (testable sans base).
/// Projet **neuf** : rattachement si le rôle autorise l'ajout d'un projet — le
/// développeur qui crée un projet devient donc membre de ce projet. Projet
/// **déjà enregistré** : seul un administrateur est rattaché (la garde reste
/// inchangée pour tout autre compte).
fn should_enroll_creator(created: bool, role: &str) -> bool {
    if created {
        crate::roles::can_add_project(role)
    } else {
        role == "admin"
    }
}

/// Enregistre le projet et son dépôt en **base** (idempotent) et rend le résumé
/// JSON commun aux deux modes de création serveur/poste. Partie partagée par
/// `add_project` (poste : `<gds_local_dir>/repos/<projet>.git`) et
/// `create_project_in_root` (service : `<repos_root>/<projet>.git`).
async fn register_project(
    pool: &PgPool,
    name: &str,
    path_on_server: &str,
    email: &str,
    description: &str,
) -> Result<Value, String> {
    let repo_name = repo_name_for(name)?;
    // Idempotent : si le projet existe déjà en base (ex: tentative précédente
    // ayant échoué plus tard sur le remote), on le réutilise au lieu d'échouer
    // sur la contrainte UNIQUE `projects.name`.
    let (project_id, created) = match db::get_project_by_name(pool, name).await? {
        Some(id) => (id, false),
        None => {
            let id = db::create_project(
                pool, name, &repo_name, "", path_on_server, "active", description,
            )
            .await?;
            (id, true)
        }
    };
    // git_repos.project_id est UNIQUE → idempotent aussi.
    if db::get_git_repo_by_project(pool, project_id).await?.is_none() {
        db::create_git_repo(pool, project_id, path_on_server, path_on_server).await?;
    }
    // Refonte GDS L3.4 : l'appartenance à un projet est un **droit**, plus une
    // inscription automatique. Le créateur d'un projet **neuf** est rattaché
    // d'office (sinon un développeur se bloque sur son propre projet) ; sur un
    // projet déjà enregistré, seul un administrateur est rattaché.
    enroll_creator(pool, project_id, email, created).await;
    Ok(json!({ "project_id": project_id, "name": name, "repo_name": repo_name, "bare_path": path_on_server }))
}

/// Crée le repo bare + enregistre le projet et le repo en base. `git_init_bare`
/// est bloquant → exécuté dans `spawn_blocking`. Retourne un résumé JSON.
pub async fn add_project(
    pool: &PgPool,
    gds_local_dir: &str,
    name: &str,
    email: &str,
    description: &str,
) -> Result<Value, String> {
    let name = validate_project_name(name)?;
    // Création du dépôt bare : code PARTAGÉ avec la matérialisation côté
    // conteneur (L2.6, `ensure_project_bares`) — une seule implémentation.
    let bare = repo_bare_path(gds_local_dir, &name);
    ensure_bare(bare.clone()).await?;
    register_project(pool, &name, &bare.to_string_lossy(), email, description).await
}

/// Lot 2 « compte utilisateur » — création du projet **et de son dépôt bare par
/// le service lui-même**, dans la racine de dépôts du conteneur
/// (`ServerCtx::repos_root`, `/srv/git/repos`) : le dépôt est
/// `<bare_root>/<projet>.git`, soit **exactement** le chemin que la
/// matérialisation de démarrage (`ensure_project_bares`) et la reprise de
/// propriété (`ensure_bares_for`) attendent. `add_project` ne peut pas servir
/// ici : il ajoute un sous-dossier `repos/` (racine locale du poste).
///
/// La signature de `add_project` reste inchangée (le poste l'appelle). Le nom est
/// validé (`validate_project_name`, anti `..`/chemin absolu) et l'opération est
/// **idempotente** : un second appel réutilise projet et dépôt existants et
/// retourne `bare_created: false`.
pub async fn create_project_in_root(
    pool: &PgPool,
    bare_root: &str,
    name: &str,
    email: &str,
    description: &str,
) -> Result<Value, String> {
    let name = validate_project_name(name)?;
    let bare = bare_path_in_root(bare_root, &name)?;
    let created = ensure_bare(bare.clone()).await?;
    let mut value = register_project(pool, &name, &bare.to_string_lossy(), email, description).await?;
    value["bare_created"] = json!(created);
    Ok(value)
}

/// Reprend un dépôt tout juste créé au nom du **propriétaire de son dossier
/// parent** (la racine des dépôts).
///
/// Le service tourne en **root** dans le conteneur, alors que les dépôts sont
/// servis par SSH à l'utilisateur `git`. Sans cette reprise, un dépôt créé par
/// `git init --bare` appartiendrait à root : git refuserait alors de le servir
/// (« detected dubious ownership ») et **tout `git push` échouerait**. Sur le
/// poste dev, la racine des dépôts appartient à l'utilisateur courant qui
/// exécute `git init` : l'appel est donc sans effet (idempotent).
///
/// Toujours silencieux et jamais bloquant (Windows, droits insuffisants, dossier
/// parent inaccessible) : l'échec d'un `chown` ne doit jamais faire échouer la
/// création d'un dépôt.
fn adopt_parent_owner(bare: &std::path::Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let Some(parent) = bare.parent() else { return };
        let Ok(meta) = std::fs::metadata(parent) else { return };
        let owner = format!("{}:{}", meta.uid(), meta.gid());
        let _ = std::process::Command::new("chown")
            .arg("-R")
            .arg(owner)
            .arg(bare)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
    #[cfg(not(unix))]
    {
        let _ = bare;
    }
}

/// Crée le dépôt bare s'il est absent (idempotent). `git_init_bare` est
/// bloquant (sous-processus git) → `spawn_blocking`. Le dossier parent est créé
/// au besoin. Retourne `true` si le dépôt a été créé par cet appel.
async fn ensure_bare(bare: PathBuf) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        if bare.exists() {
            return Ok(false);
        }
        if let Some(parent) = bare.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Création dossier des dépôts {}: {}", parent.display(), e))?;
        }
        git_init_bare(&bare.to_string_lossy())?;
        // Le dépôt doit appartenir à qui sert les dépôts (cf. `adopt_parent_owner`).
        adopt_parent_owner(&bare);
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Confiance Git du compte de service (`safe.directory`) ──

/// Entrée de confiance `safe.directory` déclarée dans un contenu de config git
/// (pure — testable). Ne lit que la section `[safe]` : aucun autre réglage n'est
/// interprété. Les guillemets git sont retirés, les échappements `\x` résolus.
pub fn parse_safe_directories(content: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut in_safe = false;
    for raw in content.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        if let Some(rest) = line.strip_prefix('[') {
            let name = rest.split(']').next().unwrap_or("").trim().to_ascii_lowercase();
            in_safe = name == "safe";
            continue;
        }
        if !in_safe {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        if key.trim().eq_ignore_ascii_case("directory") {
            out.push(unquote_git_config_value(value.trim()));
        }
    }
    out
}

/// Retire les guillemets git d'une valeur (`"…"`) et résout `\"` / `\\`. Pure.
fn unquote_git_config_value(value: &str) -> String {
    if value.len() >= 2 && value.starts_with('"') && value.ends_with('"') {
        let mut out = String::new();
        let mut chars = value[1..value.len() - 1].chars();
        while let Some(c) = chars.next() {
            if c == '\\' {
                if let Some(next) = chars.next() {
                    out.push(next);
                }
            } else {
                out.push(c);
            }
        }
        out
    } else {
        value.to_string()
    }
}

/// Rapport de préparation de la confiance Git du compte de service.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ServiceTrustReport {
    /// Chemin du fichier de configuration visé (`<home git>/.gitconfig`).
    pub config_path: String,
    /// Entrée **étroite** attendue (`<racine>/*`).
    pub wanted: String,
    /// `true` si cet appel a écrit dans le fichier (ajout ou nettoyage).
    pub modified: bool,
    /// `true` si une entrée trop large (`*` seul) a été trouvée.
    pub broad_found: bool,
    /// Entrées `safe.directory` présentes **après** l'appel (relues).
    pub final_values: Vec<String>,
    /// Échec éventuel. Jamais bloquant : l'appelant poursuit.
    pub error: Option<String>,
}

/// Prépare une fois pour toutes la confiance **étroite** du compte de service
/// `git` sur la racine des dépôts (`safe.directory = <racine>/*`), pour que git
/// serve les dépôts créés par le poste sans refus « detected dubious ownership ».
///
/// **Windows uniquement** : sur Unix, la confiance est déjà assurée par le
/// changement de propriétaire des dépôts (`adopt_parent_owner`,
/// `repair_repos_ownership`) — rien n'est écrit, comportement inchangé.
///
/// Idempotent : le fichier est **lu une fois** ; rien n'est réécrit si l'entrée
/// étroite est déjà la seule. Une entrée trop large (`*` seul) est retirée. Seul
/// le réglage `safe.directory` est touché : aucun autre réglage, aucun dépôt,
/// aucun propriétaire. Jamais bloquant : un échec est remonté dans `error` et ne
/// fait jamais échouer l'appelant.
pub fn ensure_service_trust(repos_root: &str) -> ServiceTrustReport {
    const SAFE_KEY: &str = "safe.directory";
    let wanted = crate::ssh::narrow_safe_directory(repos_root);
    let mut report = ServiceTrustReport {
        wanted: wanted.clone(),
        ..Default::default()
    };
    if wanted.is_empty() {
        report.error = Some("racine des dépôts vide : aucune confiance posée".to_string());
        return report;
    }
    // Sur Unix, la confiance est assurée par le `chown` des dépôts : ne rien écrire.
    if !cfg!(windows) {
        return report;
    }
    let config_path = crate::ssh::git_config_path();
    report.config_path = config_path.clone();

    // Une seule lecture du fichier : décide s'il y a lieu d'écrire.
    let existing =
        parse_safe_directories(&std::fs::read_to_string(&config_path).unwrap_or_default());
    report.broad_found = existing.iter().any(|v| v == "*");
    if existing.len() == 1 && existing[0] == wanted {
        report.final_values = existing;
        return report; // déjà la seule entrée : aucune réécriture.
    }

    // Retirer l'entrée trop large (`*` seul). `--fixed-value` = correspondance
    // littérale (le motif n'est pas une expression régulière).
    if report.broad_found {
        let (_, stderr, ok) = run_captured_full(
            "git",
            &[
                "config",
                "--file",
                &config_path,
                "--fixed-value",
                "--unset-all",
                SAFE_KEY,
                "*",
            ],
            Duration::from_secs(10),
        );
        if !ok {
            report.error = Some(format!(
                "retrait de l'entrée large refusé : {}",
                stderr.trim()
            ));
            return report;
        }
    }

    // Poser l'entrée étroite si elle est absente.
    if !existing.iter().any(|v| v == &wanted) {
        let (_, stderr, ok) = run_captured_full(
            "git",
            &["config", "--file", &config_path, "--add", SAFE_KEY, &wanted],
            Duration::from_secs(10),
        );
        if !ok {
            report.error = Some(format!(
                "écriture de l'entrée étroite refusée : {}",
                stderr.trim()
            ));
            return report;
        }
    }

    report.modified = true;
    // Relecture : l'entrée finale est constatée, jamais supposée.
    report.final_values =
        parse_safe_directories(&std::fs::read_to_string(&config_path).unwrap_or_default());
    report
}

// ── Conteneur (L2.6) : racine des dépôts et matérialisation depuis la base ──

/// Chemin du dépôt bare d'un projet **dans la racine du serveur** : la racine
/// fournie EST le dossier parent des dépôts (`<racine>/<projet>.git`), à la
/// différence du poste où `gds_local_dir` contient un sous-dossier `repos`
/// (`repos_dir`). Nom validé (anti path traversal) et chemin verrouillé sous la
/// racine.
pub fn bare_path_in_root(bare_root: &str, project_name: &str) -> Result<PathBuf, String> {
    let repo_name = repo_name_for(project_name)?;
    let root = PathBuf::from(bare_root);
    let bare = root.join(&repo_name);
    // Ceinture + bretelles : le nom est déjà validé, le chemin reste sous la racine.
    if !bare.starts_with(&root) {
        return Err(format!(
            "Chemin bare invalide (hors racine des dépôts): {}",
            bare.display()
        ));
    }
    Ok(bare)
}

/// Chemin retenu pour le dépôt d'un projet (pure — testable sans base) :
///
/// * le `path_on_server` **enregistré** est respecté s'il désigne un chemin
///   **sous la racine** des dépôts (cas normal : le poste calcule ce chemin à
///   partir de la racine du serveur, champ « Racine des dépôts serveur ») ;
/// * sinon le chemin canonique `<racine>/<projet>.git` est utilisé — un chemin
///   hors racine n'est JAMAIS suivi (anti path traversal), et un poste ancien
///   peut avoir enregistré un chemin local à lui-même.
///
/// Un nom de projet invalide est refusé (même validation que `add_project`).
pub fn resolve_repo_path(
    bare_root: &str,
    project_name: &str,
    path_on_server: &str,
) -> Result<PathBuf, String> {
    let canonical = bare_path_in_root(bare_root, project_name)?;
    let stored = path_on_server.trim();
    if stored.is_empty() {
        return Ok(canonical);
    }
    let stored_path = PathBuf::from(stored);
    if stored_path.starts_with(PathBuf::from(bare_root)) {
        Ok(stored_path)
    } else {
        Ok(canonical)
    }
}

/// Résultat de la matérialisation des dépôts bare (L2.6).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BareReposSync {
    /// Noms des projets dont le dépôt a été **créé** par cet appel.
    pub created: Vec<String>,
    /// Nombre de dépôts **déjà présents** (aucune écriture).
    pub present: usize,
    /// Projets ignorés : nom non exploitable (le dépôt ne peut pas être nommé).
    pub skipped: Vec<String>,
}

impl BareReposSync {
    /// Lignes lisibles (journalisation côté service).
    pub fn summary_lines(&self) -> Vec<String> {
        let mut lines = vec![format!(
            "dépôts bare : {} créé(s), {} déjà présent(s)",
            self.created.len(),
            self.present
        )];
        if !self.created.is_empty() {
            lines.push(format!("dépôts créés : {}", self.created.join(", ")));
        }
        if !self.skipped.is_empty() {
            lines.push(format!(
                "projets ignorés (nom inexploitable) : {}",
                self.skipped.join(", ")
            ));
        }
        lines
    }
}

/// Matérialise les dépôts bare d'une liste `(projet, path_on_server)` donnée
/// (pure vis-à-vis de la base : testable avec un dossier temporaire). Chaque
/// dépôt manquant est créé par le code PARTAGÉ `ensure_bare` ; un dépôt existant
/// n'est jamais touché (idempotence).
pub async fn ensure_bares_for(
    bare_root: &str,
    entries: &[(String, String)],
) -> Result<BareReposSync, String> {
    let mut sync = BareReposSync::default();
    for (name, path_on_server) in entries {
        let bare = match resolve_repo_path(bare_root, name, path_on_server) {
            Ok(path) => path,
            Err(_) => {
                sync.skipped.push(name.clone());
                continue;
            }
        };
        if ensure_bare(bare).await? {
            sync.created.push(name.clone());
        } else {
            sync.present += 1;
        }
    }
    Ok(sync)
}

/// Matérialise côté **serveur** les dépôts bare annoncés en base (L2.6) : pour
/// chaque ligne de `git_repos`, le dépôt correspondant est créé s'il manque.
///
/// C'est l'équivalent **automatique** de `git init --bare` sur un serveur
/// distant : le poste écrit le projet et son dépôt directement en base (décision
/// 11, aucune notification possible), donc le service découvre les dépôts à
/// matérialiser en relisant la base — au démarrage puis périodiquement.
///
/// Idempotent : un dépôt existant n'est jamais modifié ni supprimé.
pub async fn ensure_project_bares(
    pool: &PgPool,
    bare_root: &str,
) -> Result<BareReposSync, String> {
    let repos = db::list_git_repos(pool).await?;
    let entries: Vec<(String, String)> = repos
        .iter()
        .map(|repo| {
            let name = repo
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let path = repo
                .get("path_on_server")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            (name, path)
        })
        .collect();
    ensure_bares_for(bare_root, &entries).await
}

/// Serveur DISTANT : enregistre le projet et le dépôt en base SANS RIEN créer
/// ni administrer sur le poste (aucun bare local). Le dépôt bare est créé
/// MANUELLEMENT sur le serveur (docs/gds-server-setup.md). `path_on_server` est
/// le chemin POSIX du bare côté serveur, `remote_url` l'URL git SSH.
/// Idempotent (projet/dépôt déjà en base → réutilisés).
pub async fn add_project_remote(
    pool: &PgPool,
    name: &str,
    path_on_server: &str,
    remote_url: &str,
    email: &str,
    description: &str,
) -> Result<Value, String> {
    let name = validate_project_name(name)?;
    let repo_name = repo_name_for(&name)?;
    let (project_id, created) = match db::get_project_by_name(pool, &name).await? {
        Some(id) => (id, false),
        None => {
            let id = db::create_project(
                pool,
                &name,
                &repo_name,
                remote_url,
                path_on_server,
                "active",
                description,
            )
            .await?;
            (id, true)
        }
    };
    if db::get_git_repo_by_project(pool, project_id).await?.is_none() {
        db::create_git_repo(pool, project_id, path_on_server, path_on_server).await?;
    }
    // Refonte GDS L3.4 : même règle qu'en local — le créateur d'un projet NEUF
    // est rattaché d'office, un administrateur l'est aussi sur un projet connu.
    enroll_creator(pool, project_id, email, created).await;
    Ok(json!({
        "project_id": project_id,
        "name": name,
        "bare_path": path_on_server,
        "remote_url": remote_url,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_project_name_ok() {
        assert_eq!(validate_project_name("  myproj  ").unwrap(), "myproj");
    }

    #[test]
    fn validate_project_name_rejects_traversal() {
        assert!(validate_project_name("../etc").is_err());
        assert!(validate_project_name("a/b").is_err());
        assert!(validate_project_name("a\\b").is_err());
        assert!(validate_project_name("a b").is_err());
        assert!(validate_project_name("").is_err());
    }

    #[test]
    fn repo_name_for_validates_and_appends_git() {
        // Contrat de nommage PARTAGÉ local/distant : nom validé + suffixe .git.
        assert_eq!(repo_name_for("  myproj  ").unwrap(), "myproj.git");
        assert!(repo_name_for("../evil").is_err());
        assert!(repo_name_for("a/b").is_err());
        assert!(repo_name_for("").is_err());
    }

    /// Rattachement du créateur (mécanisme **conservé**) : un développeur qui
    /// crée un projet **neuf** est rattaché d'office (`should_enroll_creator`).
    /// Depuis la décision 2026-09, l'attribution n'est plus une condition
    /// d'accès : tout compte serveur publie tous les projets du serveur.
    #[test]
    fn creator_of_a_new_project_is_enrolled_and_any_server_account_publishes() {
        // 1) Le mécanisme de rattachement est inchangé.
        assert!(
            should_enroll_creator(true, "dev"),
            "un développeur qui crée un projet doit être rattaché à son projet"
        );
        // 2) La règle décisive a changé : un compte `dev` publie, rattaché ou non.
        assert!(
            crate::roles::can_publish_project("dev"),
            "un compte serveur publie tous les projets du serveur"
        );
        // 3) Projet EXISTANT : comportement d'origine préservé (admin seul).
        assert!(should_enroll_creator(false, "admin"));
        assert!(!should_enroll_creator(false, "dev"));
        // 4) Rôle sans droit d'ajout : jamais rattaché, même créateur.
        assert!(!should_enroll_creator(true, "standard"));
        assert!(!should_enroll_creator(true, "root"));
    }

    /// Cas **héritage** : `should_enroll_creator` ne rattache jamais
    /// automatiquement un développeur à un projet **déjà enregistré** (aucune
    /// auto-attribution). Depuis la décision 2026-09, l'accès n'en dépend plus
    /// — le développeur publie de toute façon ; l'attribution reste la donnée
    /// qui documente qui travaille sur quoi.
    ///
    /// Contrôle **pur** (sans PostgreSQL, donc présent en CI) des règles
    /// partagées par la voie poste et la voie service.
    #[test]
    fn legacy_project_creator_is_not_self_enrolled_and_access_is_not_restricted() {
        // 1) Projet DÉJÀ enregistré : aucun rattachement automatique du créateur.
        assert!(
            !should_enroll_creator(false, "dev"),
            "un projet existant ne rattache jamais un développeur d'office"
        );
        // 2) L'accès ne dépend plus de l'appartenance : un `dev` publie.
        assert!(
            crate::roles::can_publish_project("dev"),
            "un compte dev publie, rattaché ou non"
        );
        // 3) La garde reste mordante pour le rôle lecture seule.
        assert!(
            !crate::roles::can_publish_project("standard"),
            "standard : lecture seule, jamais de publication"
        );
    }

    /// Contrôle **structurel** du branchement (exécutable sans PostgreSQL, donc
    /// présent en CI) : `register_project` doit déterminer si le projet est
    /// **neuf** avant sa création et transmettre ce fait à `enroll_creator`.
    /// Sans ce branchement, la décision testée ci-dessus n'est jamais appliquée
    /// et le développeur redevient non-membre de son propre projet.
    /// Extraction **CRLF-safe** (`find("\n}")`, jamais `"\n}\n"`) : les fins de
    /// ligne du dépôt sont Windows ; un motif LF-seul ferait courir le corps
    /// jusqu'à la fin du fichier et rendrait le contrôle complaisant.
    #[test]
    fn register_project_enrolls_creator_only_for_new_projects() {
        let src = include_str!("git.rs");
        let start = src
            .find("async fn register_project(")
            .expect("`register_project` absente");
        let body = &src[start..];
        let end = body.find("\n}").unwrap_or(body.len());
        let body = &body[..end];
        assert!(
            body.contains("(id, true)") && body.contains("(id, false)"),
            "`register_project` doit distinguer projet NEUF / projet EXISTANT"
        );
        assert!(
            body.contains("enroll_creator(pool, project_id, email, created)"),
            "`register_project` doit transmettre le fait « projet neuf » à \
             `enroll_creator` : sans ce branchement, un développeur créateur \
             reste non-membre de son propre projet"
        );
        assert!(
            !body.contains("user.role == \"admin\""),
            "le rattachement ne doit plus être codé en dur sur le rôle admin"
        );
    }

    #[test]
    fn bare_path_in_root_is_flat_and_validated() {
        let root = "/srv/git/repos";
        assert_eq!(
            bare_path_in_root(root, "  pilot  ").unwrap(),
            PathBuf::from("/srv/git/repos/pilot.git")
        );
        // Pas de sous-dossier `repos` ajouté (contrairement au poste) : c'est la
        // racine du serveur qui EST le dossier parent des dépôts.
        assert!(!bare_path_in_root(root, "pilot").unwrap().to_string_lossy().contains("repos/repos"));
        assert!(bare_path_in_root(root, "../evil").is_err());
        assert!(bare_path_in_root(root, "a/b").is_err());
        assert!(bare_path_in_root(root, "").is_err());
    }

    #[test]
    fn resolve_repo_path_prefers_stored_path_only_under_root() {
        let root = "/srv/git/repos";
        // Chemin enregistré sous la racine : respecté tel quel.
        assert_eq!(
            resolve_repo_path(root, "pilot", "/srv/git/repos/pilot.git").unwrap(),
            PathBuf::from("/srv/git/repos/pilot.git")
        );
        // Chemin vide : chemin canonique.
        assert_eq!(
            resolve_repo_path(root, "pilot", "   ").unwrap(),
            PathBuf::from("/srv/git/repos/pilot.git")
        );
        // Chemin HORS racine (poste local, ou tentative d'évasion) : jamais suivi.
        for outside in ["/etc/passwd", "/srv/git-elsewhere/pilot.git", "G:\\IA_PL\\pilot\\.pilot\\repos\\pilot.git"] {
            assert_eq!(
                resolve_repo_path(root, "pilot", outside).unwrap(),
                PathBuf::from("/srv/git/repos/pilot.git"),
                "chemin hors racine : {}",
                outside
            );
        }
    }

    /// Le dépôt créé doit appartenir au **propriétaire de la racine** des
    /// dépôts : c'est la condition pour que le compte qui les sert par SSH
    /// (`git` sur le serveur) puisse les lire et y écrire. Sinon git refuse le
    /// dépôt (« detected dubious ownership ») et **toute poussée échoue** —
    /// défaut constaté en L7.6 dans le conteneur, où le service tourne en root
    /// alors que les dépôts sont servis par `git`. Ce test verrouille
    /// l'invariant (il ne prouve pas le changement de propriétaire lui-même,
    /// qui exige les droits root).
    #[cfg(unix)]
    #[tokio::test]
    async fn created_bare_adopts_owner_of_repos_root() {
        use std::os::unix::fs::MetadataExt;
        let dir = std::env::temp_dir().join(format!("pilot-gds-owner-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let root = dir.to_string_lossy().to_string();
        let entries = vec![("monprojet".to_string(), format!("{}/monprojet.git", root))];
        ensure_bares_for(&root, &entries).await.unwrap();
        let root_meta = std::fs::metadata(&dir).unwrap();
        let repo_meta = std::fs::metadata(dir.join("monprojet.git")).unwrap();
        assert_eq!(repo_meta.uid(), root_meta.uid(), "propriétaire du dépôt ≠ celui de la racine");
        assert_eq!(repo_meta.gid(), root_meta.gid(), "groupe du dépôt ≠ celui de la racine");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// L2.6 — la matérialisation crée les dépôts MANQUANTS (même code que
    /// `add_project` : `git init --bare`) et n'écrit RIEN pour un dépôt existant.
    /// Le dossier `repos` n'est pas ajouté sous la racine.
    #[tokio::test]
    async fn ensure_bares_for_creates_missing_and_spares_existing() {
        let dir = std::env::temp_dir().join(format!("pilot-gds-bares-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let root = dir.to_string_lossy().to_string();
        // Dépôt préexistant (marqueur : on vérifie qu'il n'est pas retouché).
        let existing = dir.join("deja-la.git");
        std::fs::create_dir_all(&existing).unwrap();
        let marker = existing.join("marqueur.txt");
        std::fs::write(&marker, "intact").unwrap();
        // Projet ignoré : nom inexploitable (aucun dépôt créé pour lui).
        let entries = vec![
            ("nouveau".to_string(), format!("{}/nouveau.git", root)),
            ("deja-la".to_string(), format!("{}/deja-la.git", root)),
            ("../evil".to_string(), String::new()),
        ];
        let sync = ensure_bares_for(&root, &entries).await.unwrap();
        assert_eq!(sync.created, vec!["nouveau".to_string()]);
        assert_eq!(sync.present, 1);
        assert_eq!(sync.skipped, vec!["../evil".to_string()]);
        // Dépôt créé : un dépôt bare git (dossier HEAD/config présents).
        assert!(dir.join("nouveau.git").join("HEAD").exists());
        assert!(!dir.join("repos").exists(), "aucun sous-dossier repos sous la racine");
        // Dépôt préexistant : intact.
        assert!(marker.exists());
        // Idempotence : second passage → rien de créé.
        let again = ensure_bares_for(&root, &entries).await.unwrap();
        assert!(again.created.is_empty());
        assert_eq!(again.present, 2);
        assert!(again.summary_lines().iter().any(|l| l.contains("dépôts bare")));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn remove_bare_never_leaves_repos_dir_and_is_idempotent() {
        let dir = std::env::temp_dir().join(format!("pilot-gds-rembare-{}", std::process::id()));
        let gds = dir.to_string_lossy().to_string();
        let repos = repos_dir(&gds);
        std::fs::create_dir_all(&repos).unwrap();
        // 1. Chemin valide : supprime un dépôt existant, est idempotent.
        let bare = repo_bare_path(&gds, "proj");
        std::fs::create_dir_all(&bare).unwrap();
        assert!(bare.exists());
        remove_bare(&gds, "proj").unwrap();
        assert!(!bare.exists());
        remove_bare(&gds, "proj").unwrap(); // idempotent (absent → ok)
        // 2. Anti path traversal : refusé, ne supprime rien.
        let evil = repos.join("..").join("outside");
        std::fs::create_dir_all(&evil).unwrap();
        assert!(remove_bare(&gds, "../outside").is_err());
        assert!(evil.exists(), "le dossier externe ne doit JAMAIS être supprimé");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// Lit les entrées `safe.directory` d'un fichier **avec Git** (et non avec
    /// notre propre analyseur) : c'est la preuve indépendante attendue.
    fn git_safe_directories(config_path: &str) -> Vec<String> {
        crate::proc::run_captured(
            "git",
            &[
                "config",
                "--file",
                config_path,
                "--get-all",
                "safe.directory",
            ],
            Duration::from_secs(10),
        )
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect()
    }

    #[test]
    fn parse_safe_directories_reads_only_the_safe_section() {
        let content = "[user]\n\tname = alice\n[safe]\n\tdirectory = *\n\tdirectory = \"C:/GDS/repos/*\"\n[core]\n\tdirectory = /nope\n";
        assert_eq!(
            parse_safe_directories(content),
            vec!["*".to_string(), "C:/GDS/repos/*".to_string()]
        );
        assert!(parse_safe_directories("").is_empty());
        assert!(parse_safe_directories("[user]\n\tdirectory = x\n").is_empty());
    }

    /// Confiance du compte de service : l'entrée large `*` est remplacée par
    /// l'entrée **étroite** sous la racine, l'opération est idempotente, et la
    /// relecture **avec Git** le prouve. Windows uniquement (sur Unix, la
    /// fonction ne fait rien : c'est le `chown` qui assure la confiance).
    #[test]
    fn ensure_service_trust_is_narrow_idempotent_and_drops_the_wide_entry() {
        if !cfg!(windows) {
            return;
        }
        let dir = std::env::temp_dir().join(format!("pilot-trust-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("dossier de test");
        // Le home du compte `git` est redirigé par le hook de test existant :
        // aucun fichier réel de la machine n'est touché.
        std::env::set_var("PILOT_GIT_USER_HOME", &dir);
        let config = dir.join(".gitconfig");
        std::fs::write(&config, "[safe]\n\tdirectory = *\n").expect("config initiale");
        let config_str = config.to_string_lossy().to_string();

        // 1) Entrée large présente → corrigée en entrée ÉTROITE sous la racine.
        let report = ensure_service_trust("C:\\GDS\\repos");
        assert!(report.error.is_none(), "erreur inattendue : {:?}", report.error);
        assert!(report.broad_found, "l'entrée large `*` doit être constatée");
        assert!(report.modified, "le fichier doit avoir été corrigé");
        assert_eq!(report.wanted, "C:/GDS/repos/*");
        assert_eq!(
            git_safe_directories(&config_str),
            vec!["C:/GDS/repos/*".to_string()],
            "après passage : entrée étroite seule, l'entrée large a disparu"
        );

        // 2) Idempotent : second passage → aucune écriture, fichier inchangé.
        let before = std::fs::read_to_string(&config).unwrap();
        let again = ensure_service_trust("C:\\GDS\\repos");
        assert!(again.error.is_none());
        assert!(!again.modified, "rien à réécrire : {:?}", again);
        assert_eq!(again.final_values, vec!["C:/GDS/repos/*".to_string()]);
        assert_eq!(
            std::fs::read_to_string(&config).unwrap(),
            before,
            "fichier inchangé au second passage"
        );

        std::env::remove_var("PILOT_GIT_USER_HOME");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
