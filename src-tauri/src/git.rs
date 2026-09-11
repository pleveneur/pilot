// git.rs — Intégration Git (C1) : statut, diff visuel, snapshots d'orchestration.
//
// Domaines extraits de `lib.rs` (2026-08) pour réduire la dette structurelle :
//   - `git_status` / `git_diff_file`  → badges de statut + diff visuel (C1).
//   - `git_create_snapshot` / `git_restore_snapshot` → A1 snapshots/annulation.
//
// Dépend de `crate::run_captured` (helper process partagé) et de
// `crate::AppState` (projet courant). Aucune logique métier agent ici.

use std::collections::HashMap;
use std::fs;
use std::time::Duration;

use serde_json::Value;
use tauri::State;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use crate::{run_captured, AppState};

// ── Helpers git génériques (GDS, spec_gds.md §4) ──
// Opérations git serveur/poste réutilisées par `gds.rs` (Phase A3) : init bare,
// clone, remote add, push, pull. Toutes passent par `run_captured` (helper
// process partagé) et retournent une erreur lisible en cas d'échec.

/// Initialise un dépôt bare (côté serveur GDS).
pub fn git_init_bare(path: &str) -> Result<(), String> {
    let out = run_captured("git", &["init", "--bare", path], Duration::from_secs(10));
    if out.trim().is_empty() {
        return Err("git init --bare a échoué (git absent ?)".to_string());
    }
    Ok(())
}

/// Clone un dépôt distant dans un dossier local. `git clone` écrit sa
/// progression ET ses erreurs sur stderr (stdout vide) → on vérifie le code de
/// sortie (pas stdout) et on remonte le stderr dans le message d'erreur pour
/// révéler la cause réelle (serveur SSH injoignable, utilisateur `git` absent,
/// clef non reconnue, port différent, etc.).
pub fn git_clone(url: &str, dest: &str) -> Result<(), String> {
    let (_, stderr, ok) =
        crate::run_captured_full("git", &["clone", url, dest], Duration::from_secs(60));
    if !ok {
        let detail = stderr.trim();
        if detail.is_empty() {
            return Err(format!("git clone a échoué: {}", url));
        }
        return Err(format!("git clone a échoué: {} — {}", url, detail));
    }
    Ok(())
}

/// Ajoute (ou met à jour) un remote à un dépôt local. `git remote add` réussit
/// SANS produire de sortie stdout → on vérifie le code de sortie (pas stdout)
/// via `run_captured_full` et on remonte le stderr dans le message d'erreur.
pub fn git_remote_add(cwd: &str, name: &str, url: &str) -> Result<(), String> {
    // Retirer un remote existant du même nom pour être idempotent.
    run_captured("git", &["-C", cwd, "remote", "remove", name], Duration::from_secs(5));
    let (_, stderr, ok) =
        crate::run_captured_full("git", &["-C", cwd, "remote", "add", name, url], Duration::from_secs(5));
    if !ok {
        let detail = stderr.trim();
        if detail.is_empty() {
            return Err(format!("git remote add a échoué: {}", name));
        }
        return Err(format!("git remote add a échoué: {} — {}", name, detail));
    }
    Ok(())
}

/// Retire un remote d'un dépôt local (Évolution 2, GDS). Idempotent : un
/// remote absent ne produit pas d'erreur.
pub fn git_remote_remove(cwd: &str, name: &str) -> Result<(), String> {
    run_captured("git", &["-C", cwd, "remote", "remove", name], Duration::from_secs(5));
    Ok(())
}

/// Pousse la branche courante (ou HEAD) vers un remote.
pub fn git_push(cwd: &str, remote: &str, branch: &str) -> Result<(), String> {
    let out = run_captured(
        "git",
        &["-C", cwd, "push", "-u", remote, branch],
        Duration::from_secs(60),
    );
    if out.trim().is_empty() {
        return Err(format!("git push a échoué (remote {}): {}", remote, out.trim()));
    }
    Ok(())
}

/// Tire les changements depuis un remote (branch courante).
pub fn git_pull(cwd: &str, remote: &str, branch: &str) -> Result<(), String> {
    let out = run_captured(
        "git",
        &["-C", cwd, "pull", remote, branch],
        Duration::from_secs(60),
    );
    if out.trim().is_empty() {
        return Err(format!("git pull a échoué (remote {}): {}", remote, out.trim()));
    }
    Ok(())
}

/// Récupère les changements depuis un remote (sans fusionner). `git fetch`
/// écrit sa sortie sur stderr → on vérifie le code de sortie, pas stdout.
/// Timeout généreux (60 s) pour les gros dépôts.
pub fn git_fetch(cwd: &str, remote: &str, branch: &str) -> Result<(), String> {
    use std::process::{Command, Stdio};
    let mut cmd = Command::new("git");
    cmd.args(["-C", cwd, "fetch", remote, branch])
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(crate::CREATE_NO_WINDOW);
    match cmd.status() {
        Ok(s) if s.success() => Ok(()),
        Ok(_) => Err(format!("git fetch a échoué (remote {}): {}", remote, branch)),
        Err(e) => Err(format!("git fetch a échoué: {}", e)),
    }
}

/// Nom de la branche courante d'un dépôt local (vide si détaché / pas de HEAD).
pub fn git_current_branch(cwd: &str) -> String {
    run_captured("git", &["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], Duration::from_secs(3))
        .trim()
        .to_string()
}

/// Vrai si `cwd` est un work tree Git (`rev-parse --is-inside-work-tree` == true).
/// Utilisé par le GDS pour détecter un dossier cible existant sans `.git` et
/// choisir entre fetch/pull et initialisation (chantier UX GDS, Etape 5).
pub fn git_is_repo(cwd: &str) -> bool {
    let out = run_captured("git", &["-C", cwd, "rev-parse", "--is-inside-work-tree"], Duration::from_secs(3));
    out.trim().eq_ignore_ascii_case("true")
}

/// Vrai si le remote `name` est déclaré dans `cwd` (`git remote`).
pub fn git_has_remote(cwd: &str, remote: &str) -> bool {
    let out = run_captured("git", &["-C", cwd, "remote"], Duration::from_secs(3));
    out.lines().any(|l| l.trim() == remote)
}

/// Initialise un dépôt local (work tree) dans `cwd` (`git init`).
pub fn git_init(cwd: &str) -> Result<(), String> {
    let out = run_captured("git", &["-C", cwd, "init"], Duration::from_secs(5));
    if out.trim().is_empty() {
        return Err("git init a échoué (git absent ?)".to_string());
    }
    Ok(())
}

/// Nom d'utilisateur git configuré (local ou global), vide si absent. Utilisé
/// par l'initialisation automatique GDS pour vérifier l'identité AVANT de
/// committer (message clair au lieu d'une erreur git brute).
pub fn git_config_user_name(cwd: &str) -> String {
    run_captured("git", &["-C", cwd, "config", "user.name"], Duration::from_secs(3))
        .trim()
        .to_string()
}

/// Email git configuré (local ou global), vide si absent.
pub fn git_config_user_email(cwd: &str) -> String {
    run_captured("git", &["-C", cwd, "config", "user.email"], Duration::from_secs(3))
        .trim()
        .to_string()
}

/// Écrit `user.name` dans la config git LOCALE du dépôt (`--local`, donc
/// `.git/config`), PAS `--global`. Non intrusif : ne touche jamais à la config
/// globale de l'utilisateur réel (`~/.gitconfig`). Utilisé par le GDS pour
/// régler l'identité git automatiquement à l'ajout d'un projet (email du compte
/// GDS + nom mémorisé). Échoue si le dossier n'est pas un work tree Git.
pub fn git_config_local_user_name(cwd: &str, name: &str) -> Result<(), String> {
    git_config_local(cwd, "user.name", name)
}

/// Écrit `user.email` dans la config git LOCALE du dépôt (`--local`). Même
/// convention que `git_config_local_user_name`.
pub fn git_config_local_user_email(cwd: &str, email: &str) -> Result<(), String> {
    git_config_local(cwd, "user.email", email)
}

/// Helper interne : `git config --local <key> <value>` dans `cwd`. `git config`
/// sans `--global`/`--system` écrit déjà dans `.git/config` (local) quand on est
/// dans un work tree ; on force `--local` pour être explicite et on vérifie le
/// code de sortie (set config ne produit pas de sortie stdout).
fn git_config_local(cwd: &str, key: &str, value: &str) -> Result<(), String> {
    let (_, stderr, ok) = crate::run_captured_full(
        "git",
        &["-C", cwd, "config", "--local", key, value],
        Duration::from_secs(5),
    );
    if !ok {
        let detail = stderr.trim();
        return Err(if detail.is_empty() {
            format!("git config {} a échoué", key)
        } else {
            format!("git config {} a échoué: {}", key, detail)
        });
    }
    Ok(())
}

/// Vérifie que l'identité git (user.name/email local ou global) est configurée.
/// Échoue avec un message CLAIR (guidant l'utilisateur) plutôt qu'une erreur
/// git brute `Committer identity unknown` si elle est absente ou incomplète.
pub fn check_git_identity(cwd: &str) -> Result<(), String> {
    let name = git_config_user_name(cwd);
    let email = git_config_user_email(cwd);
    match (name.is_empty(), email.is_empty()) {
        (true, true) => Err(
            "Identité git non configurée : définissez `git config user.name` et `git config user.email`, puis réessayez."
                .to_string(),
        ),
        (true, false) => Err("Identité git incomplète : `git config user.name` est manquant.".to_string()),
        (false, true) => Err("Identité git incomplète : `git config user.email` est manquant.".to_string()),
        (false, false) => Ok(()),
    }
}

/// Stage tous les changements (`git add -A`). `git add` ne produit aucune sortie
/// sur succès → on vérifie le code de sortie (et le stderr pour révéler la cause).
pub fn git_add_all(cwd: &str) -> Result<(), String> {
    let (_, stderr, ok) =
        crate::run_captured_full("git", &["-C", cwd, "add", "-A"], Duration::from_secs(60));
    if !ok {
        let detail = stderr.trim();
        return Err(if detail.is_empty() {
            "git add a échoué".to_string()
        } else {
            format!("git add a échoué: {}", detail)
        });
    }
    Ok(())
}

/// Crée un commit (`git commit -m <msg>`). Retourne `true` si un commit a été
/// créé, `false` s'il n'y avait rien à committer (dépôt vide / arbre identique
/// à HEAD) — pas une erreur. `git commit` sans changement se termine avec un
/// code non-nul mais n'est pas un échec : on ne le traite comme erreur que si
/// le stderr contient une cause réelle (ex: identité manquante).
pub fn git_commit(cwd: &str, msg: &str) -> Result<bool, String> {
    let (out, stderr, ok) =
        crate::run_captured_full("git", &["-C", cwd, "commit", "-m", msg], Duration::from_secs(60));
    let combined = format!("{} {}", out, stderr);
    // Rien à committer (dépôt vide ou working tree propre) : pas une erreur.
    if !ok {
        if combined.contains("nothing to commit") || combined.contains("no changes added to commit") {
            return Ok(false);
        }
        let detail = stderr.trim();
        return Err(if detail.is_empty() {
            "git commit a échoué".to_string()
        } else {
            format!("git commit a échoué: {}", detail)
        });
    }
    Ok(true)
}

/// Ensure qu'un dossier est un dépôt Git local avec un premier commit.
///
/// - Si `cwd` est DÉJÀ un work tree Git (`git_is_repo`), ne fait rien et
///   retourne `false` (idempotent).
/// - Sinon : `git init`, vérifie l'identité git (message CLAIR si absente,
///   plutôt qu'une erreur git brute), `git add -A`, `git commit -m
///   "initial commit"`. Un dépôt vide (aucun fichier) est géré (le commit
///   renvoie `false`, pas une erreur).
///
/// Retourne `true` si l'initialisation + premier commit ont eu lieu, `false`
/// s'il s'agissait déjà d'un dépôt.
pub fn ensure_git_repo_with_initial_commit(cwd: &str) -> Result<bool, String> {
    if git_is_repo(cwd) {
        return Ok(false);
    }
    git_init(cwd)?;
    check_git_identity(cwd)?;
    git_add_all(cwd)?;
    git_commit(cwd, "initial commit")?;
    Ok(true)
}

/// Ensure qu'un dossier est un dépôt Git local avec un premier commit, en
/// configurant d'abord l'identité git LOCALE (nom + email) si elle est absente
/// de la config effective (local ou global). Variante GDS : permet de
/// configurer automatiquement l'identité à l'ajout d'un projet — `email` = email
/// du compte GDS connecté, `name` = nom mémorisé/demandé une seule fois.
///
/// Règles :
/// - `user.name`/`user.email` manquants (local ET global) → réglés en LOCAL
///   (`.git/config`), JAMAIS `--global` (non intrusif, ne touche pas à la config
///   utilisateur réelle). Une valeur déjà présente (local ou global) est
///   respectée (on ne l'écrase pas).
/// - Dépôt déjà existant → identité comblée si besoin, retourne `false` (pas de
///   commit ajouté).
/// - Dépôt absent → `git init` + identité + `git add -A` + premier commit,
///   retourne `true`.
///
/// Retourne `true` si l'initialisation + premier commit ont eu lieu.
pub fn ensure_git_repo_with_identity(cwd: &str, email: &str, name: &str) -> Result<bool, String> {
    let is_repo = git_is_repo(cwd);
    if !is_repo {
        git_init(cwd)?;
    }
    // Combler uniquement les champs absents de la config effective (local+global).
    if git_config_user_name(cwd).is_empty() && !name.trim().is_empty() {
        git_config_local_user_name(cwd, name)?;
    }
    if git_config_user_email(cwd).is_empty() && !email.trim().is_empty() {
        git_config_local_user_email(cwd, email)?;
    }
    if is_repo {
        return Ok(false);
    }
    git_add_all(cwd)?;
    git_commit(cwd, "initial commit")?;
    Ok(true)
}

#[cfg(test)]
pub(crate) mod test_helpers {
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Mutex, MutexGuard};

    // L'environnement git est process-wide : on SÉRIE les tests qui isolent la
    // config git globale via un mutex pour éviter les courses entre tests
    // parallèles. Les seuls tests exécutant des sous-processus git du crate
    // acquièrent ce verrou (aucun autre module ne lance git dans ses tests).
    static GIT_ENV_LOCK: Mutex<()> = Mutex::new(());
    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    /// Guard posé au début des tests git : pointe la config git GLOBALE vers un
    /// fichier temporaire jetable (retiré au Drop, même en cas de panique) pour
    /// isoler l'identité git des TESTS sans jamais toucher à la configuration
    /// utilisateur réelle (`~/.gitconfig` / `/etc/gitconfig`). `GIT_CONFIG_NOSYSTEM`
    /// désactive la config système. Réutilisable depuis gds.rs (pub(crate)).
    pub(crate) struct IsolatedGitConfig {
        _lock: MutexGuard<'static, ()>,
        marker: PathBuf,
    }

    impl IsolatedGitConfig {
        /// `global_config` : contenu de la config git globale temporaire.
        /// Avec identité → `"[user]\n name = Test\n email = test@example.com\n"`.
        /// Vide (`""`) → AUCUNE identité (test d'échec clair).
        pub(crate) fn new(global_config: &str) -> Self {
            let _lock = GIT_ENV_LOCK.lock().unwrap();
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let marker = std::env::temp_dir().join(format!(
                "pilot-git-iso-{}-{}",
                std::process::id(),
                n
            ));
            let _ = std::fs::write(&marker, global_config.as_bytes());
            std::env::set_var("GIT_CONFIG_GLOBAL", &marker);
            std::env::set_var("GIT_CONFIG_NOSYSTEM", "1");
            IsolatedGitConfig { _lock, marker }
        }
    }

    impl Drop for IsolatedGitConfig {
        fn drop(&mut self) {
            std::env::remove_var("GIT_CONFIG_NOSYSTEM");
            std::env::remove_var("GIT_CONFIG_GLOBAL");
            let _ = std::fs::remove_file(&self.marker);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::test_helpers::IsolatedGitConfig;
    use super::*;

    /// Config git globale temporaire qui fournit une identité (déterministe,
    /// indépendante de la config utilisateur).
    fn identity_iso() -> IsolatedGitConfig {
        IsolatedGitConfig::new("[user]\n name = Pilot Test\n email = pilot-test@example.com\n")
    }

    fn temp_work(label: &str) -> (std::path::PathBuf, String) {
        let dir = std::env::temp_dir().join(format!("pilot-git-{}-{}", label, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        (dir.clone(), dir.to_string_lossy().to_string())
    }

    fn commit_count(cwd: &str) -> usize {
        run_captured("git", &["-C", cwd, "rev-list", "--count", "HEAD"], Duration::from_secs(3))
            .trim()
            .parse()
            .unwrap_or(0)
    }

    #[test]
    fn ensure_git_repo_with_initial_commit_initializes_a_non_repo() {
        let _iso = identity_iso();
        let (dir, d) = temp_work("init");
        std::fs::write(std::path::Path::new(&d).join("a.txt"), "hello").unwrap();
        assert!(!git_is_repo(&d));
        let res = ensure_git_repo_with_initial_commit(&d).unwrap();
        assert!(res, "un dossier non-repo doit être initialisé");
        assert!(git_is_repo(&d));
        // Premier commit + fichier suivi (git add -A + commit).
        assert_eq!(commit_count(&d), 1);
        let ls = run_captured("git", &["-C", &d, "ls-files"], Duration::from_secs(3));
        assert!(ls.trim().contains("a.txt"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ensure_git_repo_with_initial_commit_is_idempotent() {
        let _iso = identity_iso();
        let (dir, d) = temp_work("idem");
        std::fs::write(std::path::Path::new(&d).join("f.txt"), "x").unwrap();
        assert!(ensure_git_repo_with_initial_commit(&d).unwrap());
        assert_eq!(commit_count(&d), 1);
        // Rejouer sans nouveau fichier : déjà repo → false, AUCUN 2e commit.
        assert!(!ensure_git_repo_with_initial_commit(&d).unwrap());
        assert_eq!(commit_count(&d), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn non_repo_becomes_work_tree_and_attaches_to_bare() {
        // Task 1 : invariant — dossier non-repo → work tree + premier commit,
        // puis attaché (remote add + push) sur un bare de TEST sans erreur.
        let _iso = identity_iso();
        let (wd, work) = temp_work("attach");
        std::fs::write(std::path::Path::new(&work).join("app.txt"), "code").unwrap();
        assert!(ensure_git_repo_with_initial_commit(&work).unwrap());

        let bare = std::env::temp_dir().join(format!("pilot-git-bare-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&bare);
        git_init_bare(&bare.to_string_lossy()).unwrap();
        let branch = git_current_branch(&work);
        assert!(!branch.is_empty() && branch != "HEAD");
        git_remote_add(&work, "gds", &bare.to_string_lossy()).unwrap();
        git_push(&work, "gds", &branch).unwrap();
        // Le bare de test contient bien le commit initial.
        let log = run_captured("git", &["-C", &bare.to_string_lossy(), "log", "--oneline", "--all"], Duration::from_secs(3));
        assert!(log.contains("initial commit"));
        let _ = std::fs::remove_dir_all(&bare);
        let _ = std::fs::remove_dir_all(&wd);
    }

    #[test]
    fn ensure_git_repo_fails_with_clear_message_when_identity_missing() {
        // Task 4 : identité git absente → échec avec message CLAIR (pas une
        // erreur git brute) et AUCUN état cassé.
        let _iso = IsolatedGitConfig::new(""); // config globale vide → aucune identité
        let (dir, d) = temp_work("identity");
        std::fs::write(std::path::Path::new(&d).join("f.txt"), "x").unwrap();
        let res = ensure_git_repo_with_initial_commit(&d);
        assert!(res.is_err());
        let err = res.unwrap_err();
        assert!(err.contains("Identité git non configurée"), "message clair attendu, obtenu: {}", err);
        assert!(!err.contains("Committer identity unknown"), "pas d'erreur git brute: {}", err);
        // Pas d'état cassé : git init a eu lieu, le dossier reste un work tree valide.
        assert!(git_is_repo(&d));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn git_config_local_writes_only_local_config() {
        // L'identification est écrite en LOCAL (`--local`, .git/config) et jamais
        // dans la config globale (isolée par GIT_CONFIG_GLOBAL + fichier temp).
        let _iso = IsolatedGitConfig::new("");
        let (dir, d) = temp_work("conf-local");
        crate::git::git_init(&d).unwrap();
        git_config_local_user_name(&d, "Alice").unwrap();
        git_config_local_user_email(&d, "alice@example.com").unwrap();
        // La lecture effective renvoie ce qui est en locale.
        assert_eq!(git_config_user_name(&d), "Alice");
        assert_eq!(git_config_user_email(&d), "alice@example.com");
        // Et c'est bien de la config LOCALE (présente dans .git/config).
        let local = std::path::Path::new(&d).join(".git").join("config");
        let content = std::fs::read_to_string(&local).unwrap();
        assert!(content.contains("Alice") && content.contains("alice@example.com"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn configure_local_identity_does_not_override_global() {
        // Une identité GLOBALE déjà présente est respectée (non intrusif) : elle
        // n'est pas écrasée par l'identité GDS locale.
        let _iso = identity_iso(); // config globale : Pilot Test <pilot-test@example.com>
        let (dir, d) = temp_work("conf-keep");
        crate::git::git_init(&d).unwrap();
        // Tenter de régler l'identité GDS (autre nom/email) : la globale reste.
        ensure_git_repo_with_identity(&d, "gds@example.com", "GDS User").unwrap();
        assert_eq!(git_config_user_name(&d), "Pilot Test");
        assert_eq!(git_config_user_email(&d), "pilot-test@example.com");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ensure_git_repo_with_identity_configures_and_commits() {
        // Sans identité globale (config vide) : l'identité GDS est réglée en LOCAL
        // et le premier commit réussit — aucune config utilisateur réelle touchée.
        let _iso = IsolatedGitConfig::new("");
        let (dir, d) = temp_work("ident-commit");
        std::fs::write(std::path::Path::new(&d).join("a.txt"), "hello").unwrap();
        assert!(!git_is_repo(&d));
        let ok = ensure_git_repo_with_identity(&d, "gds@example.com", "Alice").unwrap();
        assert!(ok);
        assert!(git_is_repo(&d));
        assert_eq!(git_config_user_name(&d), "Alice");
        assert_eq!(git_config_user_email(&d), "gds@example.com");
        assert_eq!(commit_count(&d), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ensure_git_repo_with_identity_is_idempotent_on_repo() {
        // Dépôt déjà existant : identité comblée (si absente), retourne false,
        // AUCUN commit supplémentaire.
        let _iso = IsolatedGitConfig::new("");
        let (dir, d) = temp_work("ident-idem");
        std::fs::write(std::path::Path::new(&d).join("f.txt"), "x").unwrap();
        assert!(ensure_git_repo_with_identity(&d, "gds@example.com", "Bob").unwrap());
        assert_eq!(commit_count(&d), 1);
        // Rejouer sur le repo existant : identité déjà en place, false, pas de 2e commit.
        assert!(!ensure_git_repo_with_identity(&d, "gds@example.com", "Bob").unwrap());
        assert_eq!(commit_count(&d), 1);
        assert_eq!(git_config_user_name(&d), "Bob");
        assert_eq!(git_config_user_email(&d), "gds@example.com");
        let _ = std::fs::remove_dir_all(&dir);
    }
}

/// Résultat de `git_status` : `is_repo` (faux → pas un work tree Git), et la map
/// path → code porcelain v1 (`M`, `A`, `D`, `??`, …) pour les badges explorateur.
#[derive(serde::Serialize)]
pub(crate) struct GitStatus {
    is_repo: bool,
    entries: HashMap<String, String>,
}

#[tauri::command]
pub fn git_status(state: State<AppState>) -> Result<GitStatus, String> {
    use std::time::Duration;
    let project = state.project_path.lock().unwrap();
    let cwd = match project.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Aucun projet ouvert".to_string()),
    };
    drop(project);
    // Vérifier qu'on est dans un work tree Git.
    let check = run_captured("git", &["-C", &cwd, "rev-parse", "--is-inside-work-tree"], Duration::from_secs(3));
    if !check.trim().eq_ignore_ascii_case("true") {
        return Ok(GitStatus { is_repo: false, entries: HashMap::new() });
    }
    let out = run_captured(
        "git",
        &["-C", &cwd, "status", "--porcelain", "-uall", "--no-renames"],
        Duration::from_secs(8),
    );
    let mut entries = HashMap::new();
    for line in out.lines() {
        // Format porcelain v1 : `XY <path>` (path quoté si espaces/unicode).
        if line.len() < 4 {
            continue;
        }
        let code = line[..2].to_string();
        let mut path = line[3..].to_string();
        // Déquote porcelain v1 : entoure de "..." si le path contient des espaces.
        if path.starts_with('"') && path.ends_with('"') && path.len() >= 2 {
            path = path[1..path.len() - 1].to_string();
            // Échappement C-style minimal : \" → " et \\ → \
            path = path.replace("\\\"", "\"").replace("\\\\", "\\");
        }
        if !path.is_empty() {
            entries.insert(path, code);
        }
    }
    Ok(GitStatus { is_repo: true, entries })
}

/// Résultat de `git_diff_file` : `before` = version commitée (`HEAD:<relpath>`,
/// vide si non tracked ou jamais commité), `after` = contenu courant sur disque.
/// Sert au diff visuel (`diff-view.js`) en mode lecture seule.
#[derive(serde::Serialize)]
pub(crate) struct GitFileDiff {
    is_repo: bool,
    tracked: bool,
    before: String,
    after: String,
}

#[tauri::command]
pub fn git_diff_file(state: State<AppState>, path: String) -> Result<GitFileDiff, String> {
    use std::time::Duration;
    let project = state.project_path.lock().unwrap();
    let cwd = match project.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Aucun projet ouvert".to_string()),
    };
    drop(project);
    let after = fs::read_to_string(&path).unwrap_or_default();
    let check = run_captured("git", &["-C", &cwd, "rev-parse", "--is-inside-work-tree"], Duration::from_secs(3));
    if !check.trim().eq_ignore_ascii_case("true") {
        return Ok(GitFileDiff { is_repo: false, tracked: false, before: String::new(), after });
    }
    // Chemin tracked relatif au repo root (vide si fichier non suivi).
    let rel = run_captured("git", &["-C", &cwd, "ls-files", "--full-name", "--", &path], Duration::from_secs(3));
    let rel = rel.trim().to_string();
    if rel.is_empty() {
        return Ok(GitFileDiff { is_repo: true, tracked: false, before: String::new(), after });
    }
    // Version commitée. Échoue (stdout vide) si staged-new jamais commité → before "".
    let before = run_captured("git", &["-C", &cwd, "show", &format!("HEAD:{}", rel)], Duration::from_secs(5));
    Ok(GitFileDiff { is_repo: true, tracked: true, before, after })
}

/// État Git d'un projet (outil assistant, lecture seule). `project` = chemin
/// absolu. Retourne la branche, les fichiers modifiés/ajoutés/supprimés et le
/// nombre d'éléments en attente (staged). Réutilise `run_captured` (helper
/// process partagé) et le format porcelain v1 de `git status`.
#[tauri::command]
pub fn git_status_project(project: String) -> Result<Value, String> {
    use std::time::Duration;
    let project = project.trim().to_string();
    if project.is_empty() {
        return Err("Chemin de projet vide".to_string());
    }
    let check = run_captured("git", &["-C", &project, "rev-parse", "--is-inside-work-tree"], Duration::from_secs(3));
    if !check.trim().eq_ignore_ascii_case("true") {
        return Ok(serde_json::json!({ "is_repo": false }));
    }
    let branch = run_captured("git", &["-C", &project, "rev-parse", "--abbrev-ref", "HEAD"], Duration::from_secs(3));
    let branch = branch.trim().to_string();
    let out = run_captured(
        "git",
        &["-C", &project, "status", "--porcelain", "-uall", "--no-renames"],
        Duration::from_secs(8),
    );
    let mut modified = Vec::new();
    let mut added = Vec::new();
    let mut deleted = Vec::new();
    let mut untracked = Vec::new();
    let mut staged = Vec::new();
    for line in out.lines() {
        if line.len() < 4 {
            continue;
        }
        let code = line[..2].to_string();
        let mut path = line[3..].to_string();
        if path.starts_with('"') && path.ends_with('"') && path.len() >= 2 {
            path = path[1..path.len() - 1].to_string();
            path = path.replace("\\\"", "\"").replace("\\\\", "\\");
        }
        let x = code.chars().next().unwrap_or(' ');
        let y = code.chars().nth(1).unwrap_or(' ');
        if x == '?' && y == '?' {
            untracked.push(path);
        } else if x != ' ' {
            staged.push(path.clone());
            if y == 'D' || x == 'D' {
                deleted.push(path);
            } else if x == 'A' {
                added.push(path);
            } else {
                modified.push(path);
            }
        } else if y != ' ' {
            if y == 'D' {
                deleted.push(path);
            } else if y == 'A' {
                added.push(path);
            } else {
                modified.push(path);
            }
        }
    }
    Ok(serde_json::json!({
        "is_repo": true,
        "branch": branch,
        "modified": modified,
        "added": added,
        "deleted": deleted,
        "untracked": untracked,
        "staged": staged,
        "pending": modified.len() + added.len() + deleted.len() + untracked.len() + staged.len(),
    }))
}

/// Historique des commits d'un projet (outil assistant, lecture seule).
/// `project` = chemin absolu. Retourne les N derniers commits (N=20) avec
/// hash court, message, auteur et date. Réutilise `run_captured`.
#[tauri::command]
pub fn git_log_project(project: String) -> Result<Value, String> {
    use std::time::Duration;
    let project = project.trim().to_string();
    if project.is_empty() {
        return Err("Chemin de projet vide".to_string());
    }
    let check = run_captured("git", &["-C", &project, "rev-parse", "--is-inside-work-tree"], Duration::from_secs(3));
    if !check.trim().eq_ignore_ascii_case("true") {
        return Ok(serde_json::json!({ "is_repo": false, "commits": [] }));
    }
    let out = run_captured(
        "git",
        &["-C", &project, "log", "-n", "20", "--format=%h|%an|%ad|%s", "--date=short"],
        Duration::from_secs(5),
    );
    let commits: Vec<Value> = out
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| {
            let mut parts = l.splitn(4, '|');
            let hash = parts.next().unwrap_or("").to_string();
            let author = parts.next().unwrap_or("").to_string();
            let date = parts.next().unwrap_or("").to_string();
            let subject = parts.next().unwrap_or("").to_string();
            serde_json::json!({ "hash": hash, "author": author, "date": date, "subject": subject })
        })
        .collect();
    Ok(serde_json::json!({ "is_repo": true, "commits": commits }))
}

/// Résultat de `git_create_snapshot` :
/// - `ok: true, sha` = snapshot créé (SHA d'un commit non-référencé via `git stash create -u`,
///   ou `HEAD` si le working tree était propre).
/// - `ok: false, reason` = "not_a_repo" | "git_missing" | "error".
#[derive(serde::Serialize)]
pub(crate) struct SnapshotResult {
    ok: bool,
    sha: String,
    reason: String,
}

/// Résultat de `git_restore_snapshot` : fichiers restaurés (modifiés) et
/// fichiers supprimés (créés par la tâche et absents du snapshot).
#[derive(serde::Serialize)]
pub(crate) struct RestoreResult {
    restored: Vec<String>,
    deleted: Vec<String>,
}

/// Crée un snapshot Git avant une tâche d'orchestration. `git stash create -u`
/// capture tracked + untracked dans un commit non-référencé (le working tree et
/// l'index ne sont **pas** modifiés). Si le working tree est propre, sha = HEAD.
/// Voir spec_orchestration_snapshots.md §3.1.
#[tauri::command]
pub fn git_create_snapshot(state: State<AppState>) -> Result<SnapshotResult, String> {
    use std::time::Duration;
    let project = state.project_path.lock().unwrap();
    let cwd = match project.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Aucun projet ouvert".to_string()),
    };
    drop(project);
    let check = run_captured("git", &["-C", &cwd, "rev-parse", "--is-inside-work-tree"], Duration::from_secs(3));
    if !check.trim().eq_ignore_ascii_case("true") {
        // Distinguer « pas un repo » de « git absent » : si rev-parse renvoie
        // vide (git manquant ou erreur), on l'indique aussi.
        let probe = run_captured("git", &["--version"], Duration::from_secs(2));
        let reason = if probe.trim().is_empty() { "git_missing" } else { "not_a_repo" };
        return Ok(SnapshotResult { ok: false, sha: String::new(), reason: reason.to_string() });
    }
    // `git stash create -u` : capture tracked + untracked dans un commit
    // non-référencé. stdout = SHA, ou vide si rien à stasher (working tree propre).
    let sha = run_captured("git", &["-C", &cwd, "stash", "create", "-u"], Duration::from_secs(8));
    let sha_trim = sha.trim().to_string();
    if !sha_trim.is_empty() {
        return Ok(SnapshotResult { ok: true, sha: sha_trim, reason: String::new() });
    }
    // Working tree propre par rapport à HEAD : snapshot = HEAD.
    let head = run_captured("git", &["-C", &cwd, "rev-parse", "HEAD"], Duration::from_secs(3));
    let head_trim = head.trim().to_string();
    if !head_trim.is_empty() {
        return Ok(SnapshotResult { ok: true, sha: head_trim, reason: String::new() });
    }
    // Cas extrême : pas de commit (repo vide sans HEAD). Pas de snapshot possible.
    Ok(SnapshotResult { ok: false, sha: String::new(), reason: "no_head".to_string() })
}

/// Restaure les fichiers modifiés par une tâche à leur état d'avant (snapshot).
/// Pour chaque fichier : si présent dans l'arbre du snapshot → `git checkout
/// <sha> -- <file>` (restaure le contenu pré-tâche) ; sinon → suppression du
/// disque (fichier créé par la tâche). Unstage final pour ne pas polluer l'index.
/// Voir spec_orchestration_snapshots.md §3.3.
#[tauri::command]
pub fn git_restore_snapshot(state: State<AppState>, sha: String, files: Vec<String>) -> Result<RestoreResult, String> {
    use std::time::Duration;
    if sha.trim().is_empty() {
        return Err("SHA de snapshot vide".to_string());
    }
    let project = state.project_path.lock().unwrap();
    let cwd = match project.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Aucun projet ouvert".to_string()),
    };
    drop(project);
    let mut restored = Vec::new();
    let mut deleted = Vec::new();
    let mut to_unstage: Vec<String> = Vec::new();
    for rel in &files {
        let rel = rel.trim();
        if rel.is_empty() { continue; }
        // Le fichier existe-t-il dans l'arbre du snapshot ?
        let probe = run_captured("git", &["-C", &cwd, "ls-tree", "--full-name", &sha, "--", rel], Duration::from_secs(3));
        if !probe.trim().is_empty() {
            // Présent : restaurer le contenu pré-tâche.
            run_captured("git", &["-C", &cwd, "checkout", &sha, "--", rel], Duration::from_secs(8));
            restored.push(rel.to_string());
            to_unstage.push(rel.to_string());
        } else {
            // Absent du snapshot : créé par la tâche → supprimer du disque.
            let abs = std::path::Path::new(&cwd).join(rel);
            match fs::remove_file(&abs) {
                Ok(_) => { deleted.push(rel.to_string()); to_unstage.push(rel.to_string()); }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    // Déjà absent — rien à faire (peut-être supprimé manuellement).
                    to_unstage.push(rel.to_string());
                }
                Err(_) => { /* permission/autre — on ignore, non fatal */ }
            }
        }
    }
    // Unstage les fichiers restaurés/supprimés pour ne pas polluer l'index
    // (`git checkout <sha> -- <file>` stage la version restaurée).
    if !to_unstage.is_empty() {
        let mut args: Vec<&str> = vec!["-C", &cwd, "reset", "HEAD", "--"];
        let owned: Vec<String> = to_unstage.iter().map(|s| s.to_string()).collect();
        for r in &owned { args.push(r); }
        let _ = run_captured("git", &args, Duration::from_secs(5));
    }
    Ok(RestoreResult { restored, deleted })
}
