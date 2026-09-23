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
use serde_json::{json, Value};
use sqlx::PgPool;
use std::path::PathBuf;

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

    /// Correctif « rattachement du créateur » : un développeur qui crée un
    /// projet **neuf** est rattaché d'office à ce projet (donc **membre**) et la
    /// garde de publication l'accepte ensuite (`can_publish_project("dev", true)`).
    /// La garde reste entière partout ailleurs : un développeur **non** rattaché
    /// ne publie pas le projet d'un autre, et un projet **déjà enregistré** ne
    /// rattache que son administrateur.
    #[test]
    fn creator_of_a_new_project_is_enrolled_and_the_publish_guard_holds() {
        // 1) Le cas corrigé : développeur créateur → rattaché → publication OK.
        assert!(
            should_enroll_creator(true, "dev"),
            "un développeur qui crée un projet doit être rattaché à son projet"
        );
        assert!(
            crate::roles::can_publish_project("dev", true),
            "un développeur rattaché doit pouvoir publier son projet"
        );
        // 2) La garde tient : développeur NON rattaché → publication refusée.
        assert!(
            !crate::roles::can_publish_project("dev", false),
            "un développeur non rattaché ne doit PAS publier le projet d'un autre"
        );
        // 3) Projet EXISTANT : comportement d'origine préservé (admin seul).
        assert!(should_enroll_creator(false, "admin"));
        assert!(!should_enroll_creator(false, "dev"));
        // 4) Rôle sans droit d'ajout : jamais rattaché, même créateur.
        assert!(!should_enroll_creator(true, "standard"));
        assert!(!should_enroll_creator(true, "root"));
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
}
