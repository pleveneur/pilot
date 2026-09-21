// db.rs — Accès PostgreSQL du GDS (spec_gds.md §2)
//
// Couche base du crate partagé `gds-core` (refonte GDS, lot L1) : extraite à
// l'identique de `src-tauri/src/gds_db.rs`, elle est consommée par le desk
// (`src-tauri`, via `gds_db`) et par le serveur `gds-server`.
//
// Pool sqlx async (tokio) construit depuis une adresse locale OU distante
// (IP publique / URL). `provision` crée la base `pilot_gds` + un utilisateur
// dédié (pas `postgres` superuser), de façon idempotente. `migrate` applique
// les migrations embarquées de ce crate (`gds-core/migrations/`). Helpers CRUD
// users/projects/git_repos.
//
// Règles : jamais de `.await` en tenant un Mutex std ; secrets hors code
// (env/.env) — les mots de passe sont passés en paramètre, jamais codés.

use chrono::{DateTime, Utc};
use sha2::{Digest, Sha384};
use sqlx::migrate::{MigrateError, Migrator};
use sqlx::postgres::{PgPool, PgPoolOptions};
use sqlx::Row;
use std::collections::HashMap;
use std::time::Duration;

/// Nom de la base applicative GDS.
pub const GDS_DB_NAME: &str = "pilot_gds";

/// Construit un pool sqlx depuis une adresse de connexion PostgreSQL
/// (locale : `localhost`/socket, ou distante : IP publique / URL).
pub async fn connect(addr: &str) -> Result<PgPool, String> {
    PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(10))
        .connect(addr)
        .await
        .map_err(|e| format!("Connexion PostgreSQL: {}", e))
}

/// Issue d'une préparation de base (refonte GDS, L2.3) : ce que CET appel a
/// réellement créé. Sert aux journaux d'initialisation du service
/// (« base créée » / « base déjà présente ») sans jamais exposer de secret.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProvisionOutcome {
    /// La base applicative a été créée par cet appel.
    pub database_created: bool,
    /// Le rôle applicatif a été créé par cet appel.
    pub role_created: bool,
}

/// Prépare la base GDS sur un pool d'ADMINISTRATION **déjà ouvert** : crée
/// `db_name` + l'utilisateur dédié (idempotent) et attribue la PROPRIÉTÉ de la
/// base au rôle applicatif. Le mot de passe du rôle dédié est passé en
/// paramètre (jamais codé, jamais journalisé).
///
/// Corps extrait à l'identique de `provision` (refonte GDS, L2.3) : le service
/// autonome ouvre son pool d'administration depuis l'environnement et n'a donc
/// aucune URL à construire (aucun mot de passe ne transite par une chaîne).
///
/// Idempotent : une base ou un rôle déjà présent n'est jamais recréé ni vidé
/// (les données restent en place) ; `ProvisionOutcome` indique seulement ce qui
/// a été créé par CET appel.
///
/// **Propriété de la base** : PostgreSQL 15+ a retiré le droit `CREATE` sur le
/// schéma `public` à `PUBLIC` ; sans cette propriété, le rôle applicatif ne
/// pourrait pas appliquer les migrations (`permission denied for schema
/// public`, constaté sur PostgreSQL 16.15). Le rôle reste **non-superuser** :
/// il n'agit que dans SA base.
pub async fn provision_with(
    admin: &PgPool,
    db_name: &str,
    user: &str,
    password: &str,
) -> Result<ProvisionOutcome, String> {
    // Base : CREATE DATABASE ne peut pas être paramétré ni transactionnel.
    let db_exists: bool = sqlx::query("SELECT 1 FROM pg_database WHERE datname = $1")
        .bind(db_name)
        .fetch_optional(admin)
        .await
        .map_err(|e| format!("Vérif base: {}", e))?
        .is_some();
    if !db_exists {
        let sql = format!("CREATE DATABASE \"{}\"", db_name);
        sqlx::query(&sql)
            .execute(admin)
            .await
            .map_err(|e| format!("Création base: {}", e))?;
    }
    // Utilisateur dédié (droits limités au schéma applicatif).
    let user_exists: bool = sqlx::query("SELECT 1 FROM pg_roles WHERE rolname = $1")
        .bind(user)
        .fetch_optional(admin)
        .await
        .map_err(|e| format!("Vérif user: {}", e))?
        .is_some();
    if !user_exists {
        let pwd = password.replace('\'', "''");
        let sql = format!("CREATE USER \"{}\" WITH PASSWORD '{}'", user, pwd);
        sqlx::query(&sql)
            .execute(admin)
            .await
            .map_err(|e| format!("Création user: {}", e))?;
    }
    // Droits sur la base.
    let sql = format!("GRANT ALL PRIVILEGES ON DATABASE \"{}\" TO \"{}\"", db_name, user);
    sqlx::query(&sql)
        .execute(admin)
        .await
        .map_err(|e| format!("Grant: {}", e))?;
    // Propriété de la base au rôle applicatif (voir la doc ci-dessus) : requise
    // pour que `migrate` puisse créer ses tables dans le schéma `public`.
    let sql = format!("ALTER DATABASE \"{}\" OWNER TO \"{}\"", db_name, user);
    sqlx::query(&sql)
        .execute(admin)
        .await
        .map_err(|e| format!("Propriété de la base: {}", e))?;
    Ok(ProvisionOutcome {
        database_created: !db_exists,
        role_created: !user_exists,
    })
}

/// Provisionne la base GDS depuis une URL d'administration : ouvre le pool
/// (compte superuser, ex: `postgres://postgres:pass@host:5432/postgres`) puis
/// délègue à `provision_with`. Signature et comportement conservés pour les
/// appelants existants (desk, routes web).
pub async fn provision(
    admin_url: &str,
    db_name: &str,
    user: &str,
    password: &str,
) -> Result<(), String> {
    let admin = connect(admin_url).await?;
    provision_with(&admin, db_name, user, password).await?;
    Ok(())
}

/// Nom de la table du registre des migrations appliquées. Valeur par défaut de
/// sqlx 0.8 (`_sqlx_migrations`) ; on la nomme explicitement car la
/// auto-réparation EOL y écrit directement une colonne.
const MIGRATIONS_TABLE: &str = "_sqlx_migrations";

/// Nature de la divergence entre l'empreinte d'une migration embarquée et celle
/// enregistrée dans `_sqlx_migrations`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum ChecksumDivergence {
    /// Empreintes identiques (cas normal).
    Identical,
    /// Même SQL, seules les fins de ligne diffèrent (LF ↔ CRLF).
    EolOnly,
    /// Le SQL a réellement changé : la réparation est interdite.
    ContentChanged,
}

/// SHA-384 d'un contenu (algorithme d'empreinte des migrations sqlx).
pub fn sha384_bytes(data: &[u8]) -> Vec<u8> {
    Sha384::digest(data).to_vec()
}

/// Versions des migrations embarquées (`0001`, `0002`, …), ordre croissant —
/// tel que le migrateur sqlx les applique. Pure (aucune base requise) : sert aux
/// journaux d'initialisation du service (L2.3), qui doivent montrer QUELLES
/// migrations sont appliquées, et aux tests d'invariant du registre.
pub fn embedded_migration_versions() -> Vec<i64> {
    sqlx::migrate!().iter().map(|m| m.version).collect()
}

/// Rend une liste de versions de migration sous la forme lisible
/// « 0001, 0002, 0003 » (journaux d'initialisation du service). Une liste vide
/// rend `(aucune)`. Pure — testable sans base.
pub fn format_migration_versions(versions: &[i64]) -> String {
    if versions.is_empty() {
        return "(aucune)".to_string();
    }
    versions
        .iter()
        .map(|v| format!("{:04}", v))
        .collect::<Vec<String>>()
        .join(", ")
}

/// Classe une divergence d'empreinte (pure, testable sans base).
///
/// `stored` est comparé à `embedded_checksum` puis aux empreintes du SQL
/// embarqué converti dans LES DEUX SENS (LF → CRLF et CRLF → LF) : une base
/// écrite par une build CRLF peut recevoir une build LF (et inversement).
pub fn classify_checksum_divergence(
    embedded_checksum: &[u8],
    embedded_sql: &str,
    stored: &[u8],
) -> ChecksumDivergence {
    if stored == embedded_checksum {
        return ChecksumDivergence::Identical;
    }
    let to_lf = embedded_sql.replace("\r\n", "\n");
    let to_crlf = to_lf.replace('\n', "\r\n");
    if stored == sha384_bytes(to_lf.as_bytes()) || stored == sha384_bytes(to_crlf.as_bytes()) {
        ChecksumDivergence::EolOnly
    } else {
        ChecksumDivergence::ContentChanged
    }
}

/// Applique les migrations embarquées (`migrations/0001_init.sql` …).
///
/// Auto-réparation ciblée (« self-heal ») : si sqlx détecte un
/// `VersionMismatch` (empreinte SHA-384 divergente) dont l'écart provient
/// UNIQUEMENT des fins de ligne (LF ↔ CRLF, cf. `.gitattributes`), les
/// empreintes enregistrées sont réalignées sur celles du binaire et la migration
/// est retentée UNE SEULE FOIS, **sans rejouer le moindre SQL**. Toute
/// divergence de contenu réel continue de remonter en erreur ;
/// `Dirty`/`VersionMissing` et les autres erreurs gardent leur comportement
/// d'origine.
pub async fn migrate(pool: &PgPool) -> Result<(), String> {
    // Migrations embarquées depuis `gds-core/migrations/` (chemin par défaut du
    // macro, résolu relativement à `CARGO_MANIFEST_DIR` = `gds-core`).
    let migrator = sqlx::migrate!();
    // Connexion dédiée : les deux tentatives doivent s'exécuter dans la MÊME
    // session. En effet, `run_direct` laisse le verrou consultatif PostgreSQL
    // (`pg_advisory_lock`, portée session) posé lorsqu'il échoue en
    // `VersionMismatch` (retour anticipé, sans `unlock`). Réutiliser le pool
    // pourrait prendre une AUTRE connexion et bloquer indéfiniment dessus.
    let mut conn = pool
        .acquire()
        .await
        .map_err(|e| format!("Migration GDS: acquisition connexion: {}", e))?;
    let result = match migrator.run_direct(&mut *conn).await {
        Ok(()) => Ok(()),
        Err(MigrateError::VersionMismatch(v)) => {
            // Ne PAS libérer ici le verrou consultatif laissé posé par la
            // tentative échouée (retour anticipé sans `unlock`) : le conserver
            // pendant la réparation SÉRIALISE la relecture puis la mise à jour
            // des empreintes de `_sqlx_migrations` vis-à-vis des autres
            // instances. Sans cela, deux instances pourraient réparer en
            // parallèle entre le `unlock` et le re-`lock` de la retentative.
            repair_eol_only_mismatch(&mut *conn, &migrator, v).await
        }
        Err(e) => Err(format!("Migration GDS: {}", e)),
    };
    // Balayage défensif : aucun verrou consultatif ne doit rester posé sur la
    // connexion rendue au pool (la retentative interne laisse le sien lorsqu'elle
    // échoue à son tour). No-op si aucun verrou n'est détenu ; sans effet en cas
    // de succès (le verrou a déjà été relâché).
    let _ = sqlx::query("SELECT pg_advisory_unlock_all()")
        .execute(&mut *conn)
        .await;
    result
}

/// Réaligne les empreintes de TOUTES les migrations dont l'écart est purement
/// dû aux fins de ligne, puis retente la migration **UNE SEULE FOIS**. Aucun SQL
/// de migration n'est rejoué : seule la colonne `checksum` est mise à jour
/// (valeur idempotente). Dès qu'une migration a réellement changé de contenu,
/// rien n'est réparé et l'erreur `VersionMismatch` remonte.
///
/// Une **passe unique** est nécessaire : une base écrite par une build CRLF a
/// enregistré l'empreinte CRLF de TOUTES les migrations (`_sqlx_migrations`),
/// donc le binaire LF doit toutes les réaligner d'un coup — sqlx ne signale que
/// la première divergence (v1), et il n'y a **pas** de boucle
/// réparation → retentative → réparation.
async fn repair_eol_only_mismatch(
    conn: &mut sqlx::postgres::PgConnection,
    migrator: &Migrator,
    reported_version: i64,
) -> Result<(), String> {
    // Empreintes enregistrées, indexées par version.
    let rows = sqlx::query(&format!("SELECT version, checksum FROM {}", MIGRATIONS_TABLE))
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| format!("Migration GDS: lecture registre des migrations: {}", e))?;
    let mut stored: HashMap<i64, Vec<u8>> = HashMap::with_capacity(rows.len());
    for row in &rows {
        let version: i64 = row
            .try_get("version")
            .map_err(|e| format!("Migration GDS: version du registre invalide: {}", e))?;
        let checksum: Vec<u8> = row
            .try_get("checksum")
            .map_err(|e| format!("Migration GDS: empreinte v{} invalide: {}", version, e))?;
        stored.insert(version, checksum);
    }

    // Passe unique : classe chaque migration déjà appliquée.
    let mut to_repair: Vec<(i64, Vec<u8>)> = Vec::new();
    for m in migrator.iter() {
        let Some(stored_checksum) = stored.get(&m.version) else {
            continue;
        };
        match classify_checksum_divergence(&m.checksum, &m.sql, stored_checksum) {
            ChecksumDivergence::EolOnly => to_repair.push((m.version, m.checksum.to_vec())),
            ChecksumDivergence::ContentChanged => {
                // Contenu réellement modifié : NE JAMAIS réparer. L'erreur doit
                // remonter (l'empreinte ne serait pas réalignable sans risque).
                return Err(format!(
                    "Migration GDS: {}",
                    MigrateError::VersionMismatch(m.version)
                ));
            }
            ChecksumDivergence::Identical => {}
        }
    }

    if to_repair.is_empty() {
        // Course au démarrage concurrent : une autre instance a pu réaligner le
        // registre ENTRE la tentative initiale et la classification ci-dessus.
        // La base est alors saine (toutes les empreintes sont identiques) → on
        // retente de façon AUTORITAIRE (`run_direct` relit le registre) au lieu
        // de renvoyer l'erreur d'origine. L'erreur n'est propagée que si la
        // divergence persiste réellement. `run_direct` ré-acquiert le verrou
        // consultatif (ré-entrant sur cette session) et le relâche en cas de
        // succès.
        return migrator
            .run_direct(&mut *conn)
            .await
            .map_err(|e| format!("Migration GDS: {}", e));
    }

    for (version, checksum) in &to_repair {
        sqlx::query(&format!(
            "UPDATE {} SET checksum = $1 WHERE version = $2",
            MIGRATIONS_TABLE
        ))
        .bind(checksum.as_slice())
        .bind(*version)
        .execute(&mut *conn)
        .await
        .map_err(|e| format!("Migration GDS: réparation empreinte v{}: {}", version, e))?;
        eprintln!(
            "GDS: migration {} — empreinte réalignée (divergence de fins de ligne \
             uniquement, AUCUN SQL rejoué)",
            version
        );
    }

    // UNE SEULE retentative après la passe de réparation (jamais de boucle).
    migrator.run_direct(&mut *conn).await.map_err(|e| {
        format!(
            "Migration GDS (après réparation {}): {}",
            reported_version, e
        )
    })
}

/// Construit l'URL applicative depuis l'URL admin (même hôte/port, base + user
/// dédiés). `postgres://user:pass@host:port/db` → `postgres://<user>:<pwd>@<host:port>/<db>`.
pub fn app_url_from_admin(
    admin_url: &str,
    db_name: &str,
    user: &str,
    password: &str,
) -> Result<String, String> {
    let at = admin_url.rfind('@').ok_or("URL admin invalide (pas de @)")?;
    let host_part = &admin_url[at + 1..];
    let host = host_part.split('/').next().unwrap_or(host_part);
    Ok(format!("postgres://{}:{}@{}/{}", user, password, host, db_name))
}

// ── Helpers CRUD ──

/// Ligne utilisateur (lecture).
#[derive(Debug, Clone)]
pub struct UserRow {
    pub id: i64,
    pub email: String,
    #[allow(dead_code)]
    pub name: String,
    pub password_hash: String,
    pub role: String,
    pub status: String,
}

/// Crée un utilisateur, retourne son id.
pub async fn create_user(
    pool: &PgPool,
    email: &str,
    name: &str,
    password_hash: &str,
    role: &str,
    status: &str,
) -> Result<i64, String> {
    let row = sqlx::query(
        "INSERT INTO users (email, name, password_hash, role, status) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    )
    .bind(email)
    .bind(name)
    .bind(password_hash)
    .bind(role)
    .bind(status)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Création user: {}", e))?;
    Ok(row.get::<i64, _>("id"))
}

/// Retourne un utilisateur par email (None si absent).
pub async fn get_user_by_email(pool: &PgPool, email: &str) -> Result<Option<UserRow>, String> {
    let row = sqlx::query(
        "SELECT id, email, name, password_hash, role, status FROM users WHERE email = $1",
    )
    .bind(email)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Lecture user: {}", e))?;
    Ok(row.map(|r| UserRow {
        id: r.get::<i64, _>("id"),
        email: r.get::<String, _>("email"),
        name: r.get::<String, _>("name"),
        password_hash: r.get::<String, _>("password_hash"),
        role: r.get::<String, _>("role"),
        status: r.get::<String, _>("status"),
    }))
}

/// Nombre de comptes de rôle `admin` présents en base (L2.4).
///
/// Sert de **verrou d'initialisation** : le compte administrateur n'est créé
/// que s'il n'en existe encore aucun (cf. `create_initial_admin`).
pub async fn count_admins(pool: &PgPool) -> Result<i64, String> {
    sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE role = 'admin'")
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Comptage des administrateurs: {}", e))
}

/// Crée le compte administrateur **initial** avec le mot de passe **choisi**
/// par le propriétaire (L2.4).
///
/// Contrat :
/// - opération à **usage unique** : retourne `false` sans rien modifier dès
///   qu'un administrateur existe déjà (aucune promotion implicite) ;
/// - **aucun** mot de passe n'est fabriqué par le programme : un email ou un
///   mot de passe vide est refusé (erreur), il n'y a pas de valeur de repli ;
/// - le mot de passe est haché (Argon2id, `WebAuth::hash_password`) et n'est
///   jamais journalisé, stocké en clair, ni retourné.
pub async fn create_initial_admin(
    pool: &PgPool,
    email: &str,
    password: &str,
) -> Result<bool, String> {
    let email = email.trim().to_string();
    if email.is_empty() {
        return Err("Email administrateur vide".to_string());
    }
    if password.is_empty() {
        return Err("Mot de passe administrateur vide".to_string());
    }
    if count_admins(pool).await? > 0 {
        return Ok(false);
    }
    let hash = crate::auth::WebAuth::hash_password(password)?;
    create_user(pool, &email, "admin", &hash, "admin", "active").await?;
    Ok(true)
}

/// Passe un utilisateur à `status` (ex: 'active' après validation superadmin).
pub async fn set_user_status(pool: &PgPool, email: &str, status: &str) -> Result<(), String> {
    sqlx::query("UPDATE users SET status = $1, updated_at = now() WHERE email = $2")
        .bind(status)
        .bind(email)
        .execute(pool)
        .await
        .map_err(|e| format!("Mise à jour user: {}", e))?;
    Ok(())
}

// ── Gestion des comptes (L3.2) ──

/// Vocabulaire des rôles (L3.1) — source unique côté socle.
pub const USER_ROLES: [&str; 3] = ["admin", "dev", "standard"];

/// Vocabulaire des statuts (L3.1) — source unique côté socle.
pub const USER_STATUSES: [&str; 3] = ["pending", "active", "disabled"];

/// `true` si `role` appartient au vocabulaire contraint en base (L3.1).
pub fn is_known_role(role: &str) -> bool {
    USER_ROLES.contains(&role)
}

/// `true` si `status` appartient au vocabulaire contraint en base (L3.1).
pub fn is_known_status(status: &str) -> bool {
    USER_STATUSES.contains(&status)
}

/// Liste les comptes utilisateurs (L3.2), triés par email.
///
/// Ne renvoie **jamais** `password_hash` : l'empreinte ne quitte pas la couche
/// base (elle n'est lue que par `get_user_by_email`, pour la connexion).
pub async fn list_users(pool: &PgPool) -> Result<Vec<serde_json::Value>, String> {
    let rows = sqlx::query("SELECT id, email, name, role, status FROM users ORDER BY email")
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Liste users: {}", e))?;
    Ok(rows
        .iter()
        .map(|r| {
            serde_json::json!({
                "id": r.get::<i64, _>("id"),
                "email": r.get::<String, _>("email"),
                "name": r.get::<String, _>("name"),
                "role": r.get::<String, _>("role"),
                "status": r.get::<String, _>("status"),
            })
        })
        .collect())
}

/// Change le rôle d'un utilisateur (L3.2).
///
/// Refuse un rôle hors vocabulaire (le `CHECK` de `0006_roles.sql` le refuserait
/// de toute façon en base, mais l'erreur est ici en français et sans détour par
/// PostgreSQL). Échoue si l'email est inconnu (`rows_affected == 0`).
pub async fn set_user_role(pool: &PgPool, email: &str, role: &str) -> Result<(), String> {
    let role = role.trim();
    if !is_known_role(role) {
        return Err(format!("Rôle inconnu: {}", role));
    }
    let res = sqlx::query("UPDATE users SET role = $1, updated_at = now() WHERE email = $2")
        .bind(role)
        .bind(email)
        .execute(pool)
        .await
        .map_err(|e| format!("Mise à jour rôle: {}", e))?;
    if res.rows_affected() == 0 {
        return Err("Utilisateur introuvable".to_string());
    }
    Ok(())
}

/// Remplace l'empreinte du mot de passe d'un utilisateur (L3.2).
///
/// L'appelant fournit l'**empreinte** (Argon2id, `WebAuth::hash_password`) :
/// aucun mot de passe en clair n'entre dans cette couche. Échoue si l'email est
/// inconnu (`rows_affected == 0`).
pub async fn reset_user_password(
    pool: &PgPool,
    email: &str,
    password_hash: &str,
) -> Result<(), String> {
    let res =
        sqlx::query("UPDATE users SET password_hash = $1, updated_at = now() WHERE email = $2")
            .bind(password_hash)
            .bind(email)
            .execute(pool)
            .await
            .map_err(|e| format!("Réinitialisation du mot de passe: {}", e))?;
    if res.rows_affected() == 0 {
        return Err("Utilisateur introuvable".to_string());
    }
    Ok(())
}

/// Nombre d'administrateurs **actifs** (L3.2).
///
/// Sert de garde-fou « dernier administrateur » : désactiver le dernier
/// administrateur actif laisserait l'installation sans personne pour gérer les
/// comptes. Distinct de `count_admins` (L2.4), qui compte les administrateurs
/// **quel que soit leur statut** et sert de verrou d'initialisation.
pub async fn count_active_admins(pool: &PgPool) -> Result<i64, String> {
    sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE role = 'admin' AND status = 'active'")
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Comptage des administrateurs actifs: {}", e))
}

/// Retourne l'id d'un projet par nom (None si absent).
pub async fn get_project_by_name(pool: &PgPool, name: &str) -> Result<Option<i64>, String> {
    let row = sqlx::query("SELECT id FROM projects WHERE name = $1")
        .bind(name)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Lecture projet: {}", e))?;
    Ok(row.map(|r| r.get::<i64, _>("id")))
}

/// Crée un projet, retourne son id.
pub async fn create_project(
    pool: &PgPool,
    name: &str,
    repo_name: &str,
    repo_url: &str,
    path_on_server: &str,
    status: &str,
    description: &str,
) -> Result<i64, String> {
    let row = sqlx::query(
        "INSERT INTO projects (name, repo_name, repo_url, path_on_server, status, description) \
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
    )
    .bind(name)
    .bind(repo_name)
    .bind(repo_url)
    .bind(path_on_server)
    .bind(status)
    .bind(description)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Création projet: {}", e))?;
    Ok(row.get::<i64, _>("id"))
}

/// Retourne l'id d'un dépôt git par projet (None si absent).
pub async fn get_git_repo_by_project(pool: &PgPool, project_id: i64) -> Result<Option<i64>, String> {
    let row = sqlx::query("SELECT id FROM git_repos WHERE project_id = $1")
        .bind(project_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Lecture git_repo: {}", e))?;
    Ok(row.map(|r| r.get::<i64, _>("id")))
}

/// Vrai si un dépôt git (bare) est enregistré pour un projet donné par NOM.
/// Utilisé pour les serveurs GDS DISTANTS : la base fait foi (on ne teste pas
/// le disque distant). Fail-open côté appelant (erreur → false).
pub async fn project_has_git_repo(pool: &PgPool, name: &str) -> Result<bool, String> {
    let row = sqlx::query(
        "SELECT 1 FROM git_repos g JOIN projects p ON p.id = g.project_id \
         WHERE p.name = $1 LIMIT 1",
    )
    .bind(name)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Lecture git_repo: {}", e))?;
    Ok(row.is_some())
}

/// Enregistre un dépôt git (bare) pour un projet.
pub async fn create_git_repo(
    pool: &PgPool,
    project_id: i64,
    path_on_server: &str,
    bare_path: &str,
) -> Result<i64, String> {
    let row = sqlx::query(
        "INSERT INTO git_repos (project_id, path_on_server, bare_path) VALUES ($1, $2, $3) RETURNING id",
    )
    .bind(project_id)
    .bind(path_on_server)
    .bind(bare_path)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Création git_repo: {}", e))?;
    Ok(row.get::<i64, _>("id"))
}

/// Associe un utilisateur à un projet (project_members).
///
/// Délègue à [`assign_project`] : conservée pour la compatibilité du socle
/// (l'appartenance est désormais un **droit** attribué explicitement, L3.4).
pub async fn create_project_member(
    pool: &PgPool,
    project_id: i64,
    user_id: i64,
    role: &str,
) -> Result<(), String> {
    assign_project(pool, project_id, user_id, role)
        .await
        .map(|_| ())
}

/// Attribue un utilisateur à un projet (refonte GDS, **L3.4**).
///
/// L'appartenance est un **droit** (§2.7) : ce n'est plus une inscription
/// automatique mais une décision explicite de l'administrateur. Idempotent :
/// ré-attribuer un membre déjà rattaché ne fait rien et retourne `false`.
/// Retourne `true` si l'association vient d'être créée.
pub async fn assign_project(
    pool: &PgPool,
    project_id: i64,
    user_id: i64,
    role: &str,
) -> Result<bool, String> {
    let res = sqlx::query(
        "INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3) \
         ON CONFLICT (project_id, user_id) DO NOTHING",
    )
    .bind(project_id)
    .bind(user_id)
    .bind(role)
    .execute(pool)
    .await
    .map_err(|e| format!("Attribution projet: {}", e))?;
    Ok(res.rows_affected() > 0)
}

/// Retire l'attribution d'un utilisateur à un projet (refonte GDS, **L3.4**).
///
/// Retourne `true` si une association a effectivement été supprimée. Les droits
/// d'écriture de l'utilisateur sur ce projet tombent immédiatement
/// (`is_project_member` redevient faux).
pub async fn unassign_project(
    pool: &PgPool,
    project_id: i64,
    user_id: i64,
) -> Result<bool, String> {
    let res = sqlx::query("DELETE FROM project_members WHERE project_id = $1 AND user_id = $2")
        .bind(project_id)
        .bind(user_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Retrait attribution projet: {}", e))?;
    Ok(res.rows_affected() > 0)
}

/// Liste les membres d'un projet (refonte GDS, **L3.4**) : `user_id`, `email`,
/// `name`, `role` (rôle **dans le projet**) et `created_at` (ISO).
pub async fn list_project_members(
    pool: &PgPool,
    project_id: i64,
) -> Result<Vec<serde_json::Value>, String> {
    let rows = sqlx::query(
        "SELECT pm.user_id, u.email, u.name, pm.role, pm.created_at \
           FROM project_members pm \
           JOIN users u ON u.id = pm.user_id \
          WHERE pm.project_id = $1 \
          ORDER BY pm.created_at, u.email",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Liste membres projet: {}", e))?;
    Ok(rows
        .iter()
        .map(|r| {
            let created_at: chrono::DateTime<Utc> = r.get("created_at");
            serde_json::json!({
                "user_id": r.get::<i64, _>("user_id"),
                "email": r.get::<String, _>("email"),
                "name": r.get::<String, _>("name"),
                "role": r.get::<String, _>("role"),
                "created_at": created_at.to_rfc3339(),
            })
        })
        .collect())
}

/// Liste les projets **attribués** à un utilisateur (refonte GDS, **L3.4**).
///
/// Même forme que [`list_projects`] (compatibilité du rendu), mais filtrée par
/// `project_members` : c'est la lecture restreinte d'un développeur non
/// administrateur (un projet non attribué n'apparaît jamais).
pub async fn list_projects_for_user(
    pool: &PgPool,
    user_id: i64,
) -> Result<Vec<serde_json::Value>, String> {
    let rows = sqlx::query(
        "SELECT p.id, p.name, p.repo_name, p.repo_url, p.path_on_server, p.status, \
                p.description \
           FROM projects p \
           JOIN project_members pm ON pm.project_id = p.id \
          WHERE pm.user_id = $1 \
          ORDER BY p.name",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Liste projets attribués: {}", e))?;
    Ok(rows
        .iter()
        .map(|r| {
            serde_json::json!({
                "id": r.get::<i64, _>("id"),
                "name": r.get::<String, _>("name"),
                "repo_name": r.get::<String, _>("repo_name"),
                "repo_url": r.get::<String, _>("repo_url"),
                "path_on_server": r.get::<String, _>("path_on_server"),
                "status": r.get::<String, _>("status"),
                "description": r.get::<String, _>("description"),
            })
        })
        .collect())
}

/// Indique si un utilisateur est membre d'un projet (project_members).
/// Utilisé par la garde de forçage de publication du suivi après la suppression
/// du verrou projet (refonte GDS, L6).
pub async fn is_project_member(
    pool: &PgPool,
    project_id: i64,
    user_id: i64,
) -> Result<bool, String> {
    let row = sqlx::query("SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2")
        .bind(project_id)
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Vérification membre projet: {}", e))?;
    Ok(row.is_some())
}

/// Liste les projets (id, name, repo_name, repo_url, path_on_server, status).
pub async fn list_projects(pool: &PgPool) -> Result<Vec<serde_json::Value>, String> {
    let rows = sqlx::query(
        "SELECT id, name, repo_name, repo_url, path_on_server, status, description FROM projects ORDER BY name",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Liste projets: {}", e))?;
    Ok(rows
        .iter()
        .map(|r| {
            serde_json::json!({
                "id": r.get::<i64, _>("id"),
                "name": r.get::<String, _>("name"),
                "repo_name": r.get::<String, _>("repo_name"),
                "repo_url": r.get::<String, _>("repo_url"),
                "path_on_server": r.get::<String, _>("path_on_server"),
                "status": r.get::<String, _>("status"),
                "description": r.get::<String, _>("description"),
            })
        })
        .collect())
}

/// Liste les dépôts git (id, project_id, path_on_server, bare_path, name,
/// email). Jointe la table `projects` pour remonter le nom LISIBLE du projet
/// (affiché dans la modale « Ajouter un projet depuis le GDS ») et l'email
/// d'identité de son membre (réutilisé par gds_clone_repo / gds_add_project).
/// Les champs initiaux (id, project_id, path_on_server, bare_path) sont
/// conservés ADDITIF pour ne pas casser le rendu existant de `src/js/gds.js`.
pub async fn list_git_repos(pool: &PgPool) -> Result<Vec<serde_json::Value>, String> {
    let rows = sqlx::query(
        "SELECT g.id, g.project_id, g.path_on_server, g.bare_path, p.name, \
            (SELECT u.email FROM project_members pm \
               JOIN users u ON u.id = pm.user_id \
              WHERE pm.project_id = g.project_id \
              ORDER BY pm.created_at LIMIT 1) AS email \
         FROM git_repos g \
         JOIN projects p ON p.id = g.project_id \
         ORDER BY g.id",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Liste git_repos: {}", e))?;
    Ok(rows
        .iter()
        .map(|r| {
            let email: Option<String> = r.get("email");
            serde_json::json!({
                "id": r.get::<i64, _>("id"),
                "project_id": r.get::<i64, _>("project_id"),
                "path_on_server": r.get::<String, _>("path_on_server"),
                "bare_path": r.get::<String, _>("bare_path"),
                "name": r.get::<String, _>("name"),
                "email": email.unwrap_or_default(),
            })
        })
        .collect())
}

/// Supprime un projet GDS par nom (Évolution 2). Les dépendances
/// (git_repos, project_members, tasks, decisions, tickets) sont
/// purgées en cascade (tables au `ON DELETE CASCADE`). On cible uniquement le
/// projet GDS (path IS NULL) pour ne jamais toucher aux projets de suivi.
/// Retourne le nombre de lignes supprimées (0 si absent).
pub async fn delete_project_by_name(pool: &PgPool, name: &str) -> Result<u64, String> {
    if name.trim().is_empty() {
        return Err("Nom de projet vide".to_string());
    }
    let res = sqlx::query("DELETE FROM projects WHERE name = $1 AND path IS NULL")
        .bind(name)
        .execute(pool)
        .await
        .map_err(|e| format!("Suppression projet GDS: {}", e))?;
    Ok(res.rows_affected())
}

/// Instant courant en epoch millis (utilisé par le suivi fusionné).
pub fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ── Clefs SSH serveur (Phase A3, spec_gds.md §4) ──
// Clefs publiques des devs, associées à un utilisateur (email) de la base.
// public_key UNIQUE (une clef = un dev).

/// Enregistre une clef publique pour un utilisateur (idempotent : ON CONFLICT
/// DO NOTHING sur public_key UNIQUE). Retourne l'id de la clef (0 si déjà
/// présente).
pub async fn create_ssh_key(pool: &PgPool, user_id: i64, public_key: &str) -> Result<i64, String> {
    let row = sqlx::query(
        "INSERT INTO ssh_keys (user_id, public_key) VALUES ($1, $2) \
         ON CONFLICT (public_key) DO NOTHING RETURNING id",
    )
    .bind(user_id)
    .bind(public_key)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Création clef SSH: {}", e))?;
    Ok(row.map(|r| r.get::<i64, _>("id")).unwrap_or(0))
}

/// Retourne les clefs publiques d'un utilisateur (par id).
#[allow(dead_code)] // API CRUD clefs SSH (Phase A3) — exposée pour l'UI/API.
pub async fn get_ssh_keys_by_user(pool: &PgPool, user_id: i64) -> Result<Vec<String>, String> {
    let rows = sqlx::query("SELECT public_key FROM ssh_keys WHERE user_id = $1 ORDER BY id")
        .bind(user_id)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Lecture clefs SSH: {}", e))?;
    Ok(rows.iter().map(|r| r.get::<String, _>("public_key")).collect())
}

/// Retourne l'id d'une clef publique exacte (None si absente).
pub async fn get_ssh_key_by_key(pool: &PgPool, public_key: &str) -> Result<Option<i64>, String> {
    let row = sqlx::query("SELECT id FROM ssh_keys WHERE public_key = $1")
        .bind(public_key)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Lecture clef SSH: {}", e))?;
    Ok(row.map(|r| r.get::<i64, _>("id")))
}

/// Retourne l'id d'une clef publique par empreinte SHA256 (None si absente).
/// L'empreinte est calculée sur la partie base64 de la clef (même convention
/// que `ssh-keygen -lf`).
#[allow(dead_code)] // API CRUD clefs SSH (Phase A3) — exposée pour l'UI/API.
pub async fn get_ssh_key_by_fingerprint(pool: &PgPool, fingerprint: &str) -> Result<Option<i64>, String> {
    let rows = sqlx::query("SELECT id, public_key FROM ssh_keys")
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Lecture clefs SSH: {}", e))?;
    for r in rows {
        let key: String = r.get("public_key");
        if crate::ssh::public_key_fingerprint(&key) == fingerprint {
            return Ok(Some(r.get::<i64, _>("id")));
        }
    }
    Ok(None)
}

/// Supprime une clef publique par id.
#[allow(dead_code)] // API CRUD clefs SSH (Phase A3) — exposée pour l'UI/API.
pub async fn delete_ssh_key(pool: &PgPool, id: i64) -> Result<(), String> {
    sqlx::query("DELETE FROM ssh_keys WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| format!("Suppression clef SSH: {}", e))?;
    Ok(())
}

/// Journalise une action GDS dans `audit_gds` (Phase B : verrous, sync).
pub async fn audit_gds(
    pool: &PgPool,
    ip: &str,
    subject: &str,
    action: &str,
    detail: &str,
    ok: bool,
) -> Result<(), String> {
    sqlx::query("INSERT INTO audit_gds (ip, subject, action, detail, ok) VALUES ($1, $2, $3, $4, $5)")
        .bind(ip)
        .bind(subject)
        .bind(action)
        .bind(detail)
        .bind(ok)
        .execute(pool)
        .await
        .map_err(|e| format!("Audit GDS: {}", e))?;
    Ok(())
}

// ── Suivi fusionné (Phase C1.1, spec_gds.md §6) ──
// Tables clients/projects/tasks/decisions alignées sur le schéma SQLite du
// super-agent (~/.pilot/super-agent.db). `updated_at` = clé de résolution de
// divergence (Option A : « dernier écrit gagne » + log des conflits, §6.1).
// CRUD par updated_at : upsert, select modifiés depuis une date, delete.
//
// Clés d'upsert :
//  - clients  → name (clé naturelle SQLite, UNIQUE)
//  - projects → path (clé naturelle SQLite, UNIQUE ; la table GDS existante
//    est étendue, les projets git ont path NULL)
//  - tasks / decisions → id (pas de clé naturelle en SQLite ; le pont C1.2
//    maintient la correspondance id SQLite ↔ id Postgres).
//
// API CRUD (Phase C1.1) — branchée par le pont bidirectionnel (C1.2).

/// Ligne client (suivi).
#[derive(Debug, Clone, serde::Serialize)]
pub struct ClientRow {
    pub id: i64,
    pub name: String,
    pub notes: String,
    pub updated_at: DateTime<Utc>,
}

/// Upsert un client par `name` (clé naturelle). Retourne l'id.
pub async fn upsert_client(
    pool: &PgPool,
    name: &str,
    notes: &str,
    updated_at: DateTime<Utc>,
) -> Result<i64, String> {
    let row = sqlx::query(
        "INSERT INTO clients (name, notes, updated_at) VALUES ($1, $2, $3) \
         ON CONFLICT (name) DO UPDATE SET notes = EXCLUDED.notes, updated_at = EXCLUDED.updated_at \
         RETURNING id",
    )
    .bind(name)
    .bind(notes)
    .bind(updated_at)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Upsert client: {}", e))?;
    Ok(row.get::<i64, _>("id"))
}

/// Retourne les clients modifiés depuis `since` (résolution de divergence).
pub async fn get_clients_modified_since(
    pool: &PgPool,
    since: DateTime<Utc>,
) -> Result<Vec<ClientRow>, String> {
    let rows = sqlx::query(
        "SELECT id, name, notes, updated_at FROM clients WHERE updated_at > $1 ORDER BY id",
    )
    .bind(since)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Lecture clients modifiés: {}", e))?;
    Ok(rows
        .iter()
        .map(|r| ClientRow {
            id: r.get::<i64, _>("id"),
            name: r.get::<String, _>("name"),
            notes: r.get::<String, _>("notes"),
            updated_at: r.get::<DateTime<Utc>, _>("updated_at"),
        })
        .collect())
}

/// Supprime un client par `name`.
#[allow(dead_code)] // API CRUD suivi (Phase C1.1) — branchée par le pont C1.2.
pub async fn delete_client(pool: &PgPool, name: &str) -> Result<(), String> {
    sqlx::query("DELETE FROM clients WHERE name = $1")
        .bind(name)
        .execute(pool)
        .await
        .map_err(|e| format!("Suppression client: {}", e))?;
    Ok(())
}

/// Liste tous les clients (API suivi fusionné, Phase C1.5).
pub async fn list_clients(pool: &PgPool) -> Result<Vec<ClientRow>, String> {
    let rows = sqlx::query("SELECT id, name, notes, updated_at FROM clients ORDER BY name")
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Liste clients: {}", e))?;
    Ok(rows
        .iter()
        .map(|r| ClientRow {
            id: r.get::<i64, _>("id"),
            name: r.get::<String, _>("name"),
            notes: r.get::<String, _>("notes"),
            updated_at: r.get::<DateTime<Utc>, _>("updated_at"),
        })
        .collect())
}

/// Ligne projet de suivi (path non NULL).
#[derive(Debug, Clone, serde::Serialize)]
pub struct ProjectRow {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub client_id: Option<i64>,
    pub status: String,
    pub updated_at: DateTime<Utc>,
}

/// Upsert un projet de suivi par `path` (clé naturelle). Retourne l'id.
/// `client_id` = id du client (None si non rattaché).
pub async fn upsert_project(
    pool: &PgPool,
    path: &str,
    name: &str,
    client_id: Option<i64>,
    status: &str,
    updated_at: DateTime<Utc>,
) -> Result<i64, String> {
    let row = sqlx::query(
        "INSERT INTO projects (path, name, client_id, status, updated_at) VALUES ($1, $2, $3, $4, $5) \
         ON CONFLICT (path) DO UPDATE SET name = EXCLUDED.name, client_id = EXCLUDED.client_id, \
             status = EXCLUDED.status, updated_at = EXCLUDED.updated_at \
         RETURNING id",
    )
    .bind(path)
    .bind(name)
    .bind(client_id)
    .bind(status)
    .bind(updated_at)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Upsert projet: {}", e))?;
    Ok(row.get::<i64, _>("id"))
}

/// Retourne les projets de suivi (path non NULL) modifiés depuis `since`.
pub async fn get_projects_modified_since(
    pool: &PgPool,
    since: DateTime<Utc>,
) -> Result<Vec<ProjectRow>, String> {
    let rows = sqlx::query(
        "SELECT id, path, name, client_id, status, updated_at FROM projects \
         WHERE path IS NOT NULL AND updated_at > $1 ORDER BY id",
    )
    .bind(since)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Lecture projets modifiés: {}", e))?;
    Ok(rows
        .iter()
        .map(|r| ProjectRow {
            id: r.get::<i64, _>("id"),
            path: r.get::<String, _>("path"),
            name: r.get::<String, _>("name"),
            client_id: r.get::<Option<i64>, _>("client_id"),
            status: r.get::<String, _>("status"),
            updated_at: r.get::<DateTime<Utc>, _>("updated_at"),
        })
        .collect())
}

/// Supprime un projet de suivi par `path`.
#[allow(dead_code)] // API CRUD suivi (Phase C1.1) — branchée par le pont C1.2.
pub async fn delete_project(pool: &PgPool, path: &str) -> Result<(), String> {
    sqlx::query("DELETE FROM projects WHERE path = $1")
        .bind(path)
        .execute(pool)
        .await
        .map_err(|e| format!("Suppression projet: {}", e))?;
    Ok(())
}

/// Liste tous les projets de suivi (path non NULL) — API suivi fusionné, Phase C1.5.
pub async fn list_tracking_projects(pool: &PgPool) -> Result<Vec<ProjectRow>, String> {
    let rows = sqlx::query(
        "SELECT id, path, name, client_id, status, updated_at FROM projects \
         WHERE path IS NOT NULL ORDER BY name",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Liste projets suivi: {}", e))?;
    Ok(rows
        .iter()
        .map(|r| ProjectRow {
            id: r.get::<i64, _>("id"),
            path: r.get::<String, _>("path"),
            name: r.get::<String, _>("name"),
            client_id: r.get::<Option<i64>, _>("client_id"),
            status: r.get::<String, _>("status"),
            updated_at: r.get::<DateTime<Utc>, _>("updated_at"),
        })
        .collect())
}

/// Ligne tâche (suivi).
#[derive(Debug, Clone, serde::Serialize)]
pub struct TaskRow {
    pub id: i64,
    pub project_id: i64,
    pub title: String,
    pub description: String,
    pub status: String,
    pub deadline: String,
    pub blocker_reason: String,
    pub source_task_id: Option<i64>,
    pub updated_at: DateTime<Utc>,
}

/// Upsert une tâche par `id` (pas de clé naturelle en SQLite). Retourne l'id.
pub async fn upsert_task(
    pool: &PgPool,
    id: i64,
    project_id: i64,
    title: &str,
    description: &str,
    status: &str,
    deadline: &str,
    blocker_reason: &str,
    source_task_id: Option<i64>,
    updated_at: DateTime<Utc>,
) -> Result<i64, String> {
    let row = sqlx::query(
        "INSERT INTO tasks (id, project_id, title, description, status, deadline, blocker_reason, source_task_id, updated_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) \
         ON CONFLICT (id) DO UPDATE SET project_id = EXCLUDED.project_id, title = EXCLUDED.title, \
             description = EXCLUDED.description, status = EXCLUDED.status, deadline = EXCLUDED.deadline, \
             blocker_reason = EXCLUDED.blocker_reason, source_task_id = EXCLUDED.source_task_id, \
             updated_at = EXCLUDED.updated_at \
         RETURNING id",
    )
    .bind(id)
    .bind(project_id)
    .bind(title)
    .bind(description)
    .bind(status)
    .bind(deadline)
    .bind(blocker_reason)
    .bind(source_task_id)
    .bind(updated_at)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Upsert tâche: {}", e))?;
    Ok(row.get::<i64, _>("id"))
}

/// Retourne les tâches modifiées depuis `since`.
pub async fn get_tasks_modified_since(
    pool: &PgPool,
    since: DateTime<Utc>,
) -> Result<Vec<TaskRow>, String> {
    let rows = sqlx::query(
        "SELECT id, project_id, title, description, status, deadline, blocker_reason, source_task_id, updated_at \
         FROM tasks WHERE updated_at > $1 ORDER BY id",
    )
    .bind(since)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Lecture tâches modifiées: {}", e))?;
    Ok(rows
        .iter()
        .map(|r| TaskRow {
            id: r.get::<i64, _>("id"),
            project_id: r.get::<i64, _>("project_id"),
            title: r.get::<String, _>("title"),
            description: r.get::<String, _>("description"),
            status: r.get::<String, _>("status"),
            deadline: r.get::<String, _>("deadline"),
            blocker_reason: r.get::<String, _>("blocker_reason"),
            source_task_id: r.get::<Option<i64>, _>("source_task_id"),
            updated_at: r.get::<DateTime<Utc>, _>("updated_at"),
        })
        .collect())
}

/// Supprime une tâche par `id`.
#[allow(dead_code)] // API CRUD suivi (Phase C1.1) — branchée par le pont C1.2.
pub async fn delete_task(pool: &PgPool, id: i64) -> Result<(), String> {
    sqlx::query("DELETE FROM tasks WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| format!("Suppression tâche: {}", e))?;
    Ok(())
}

/// Liste toutes les tâches — API suivi fusionné, Phase C1.5.
pub async fn list_tasks(pool: &PgPool) -> Result<Vec<TaskRow>, String> {
    let rows = sqlx::query(
        "SELECT id, project_id, title, description, status, deadline, blocker_reason, source_task_id, updated_at \
         FROM tasks ORDER BY id",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Liste tâches: {}", e))?;
    Ok(rows
        .iter()
        .map(|r| TaskRow {
            id: r.get::<i64, _>("id"),
            project_id: r.get::<i64, _>("project_id"),
            title: r.get::<String, _>("title"),
            description: r.get::<String, _>("description"),
            status: r.get::<String, _>("status"),
            deadline: r.get::<String, _>("deadline"),
            blocker_reason: r.get::<String, _>("blocker_reason"),
            source_task_id: r.get::<Option<i64>, _>("source_task_id"),
            updated_at: r.get::<DateTime<Utc>, _>("updated_at"),
        })
        .collect())
}

/// Ligne décision (suivi).
#[derive(Debug, Clone, serde::Serialize)]
pub struct DecisionRow {
    pub id: i64,
    pub project_id: Option<i64>,
    pub task_id: Option<i64>,
    pub summary: String,
    pub source_session: String,
    pub updated_at: DateTime<Utc>,
}

/// Upsert une décision par `id` (pas de clé naturelle en SQLite). Retourne l'id.
pub async fn upsert_decision(
    pool: &PgPool,
    id: i64,
    project_id: Option<i64>,
    task_id: Option<i64>,
    summary: &str,
    source_session: &str,
    updated_at: DateTime<Utc>,
) -> Result<i64, String> {
    let row = sqlx::query(
        "INSERT INTO decisions (id, project_id, task_id, summary, source_session, updated_at) \
         VALUES ($1, $2, $3, $4, $5, $6) \
         ON CONFLICT (id) DO UPDATE SET project_id = EXCLUDED.project_id, task_id = EXCLUDED.task_id, \
             summary = EXCLUDED.summary, source_session = EXCLUDED.source_session, \
             updated_at = EXCLUDED.updated_at \
         RETURNING id",
    )
    .bind(id)
    .bind(project_id)
    .bind(task_id)
    .bind(summary)
    .bind(source_session)
    .bind(updated_at)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Upsert décision: {}", e))?;
    Ok(row.get::<i64, _>("id"))
}

/// Retourne les décisions modifiées depuis `since`.
pub async fn get_decisions_modified_since(
    pool: &PgPool,
    since: DateTime<Utc>,
) -> Result<Vec<DecisionRow>, String> {
    let rows = sqlx::query(
        "SELECT id, project_id, task_id, summary, source_session, updated_at \
         FROM decisions WHERE updated_at > $1 ORDER BY id",
    )
    .bind(since)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Lecture décisions modifiées: {}", e))?;
    Ok(rows
        .iter()
        .map(|r| DecisionRow {
            id: r.get::<i64, _>("id"),
            project_id: r.get::<Option<i64>, _>("project_id"),
            task_id: r.get::<Option<i64>, _>("task_id"),
            summary: r.get::<String, _>("summary"),
            source_session: r.get::<String, _>("source_session"),
            updated_at: r.get::<DateTime<Utc>, _>("updated_at"),
        })
        .collect())
}

/// `updated_at` d'un client par `name` (None si absent) — résolution de
/// divergence « dernier écrit gagne » du pont C1.2.
pub async fn get_client_updated_at(
    pool: &PgPool,
    name: &str,
) -> Result<Option<DateTime<Utc>>, String> {
    let row = sqlx::query("SELECT updated_at FROM clients WHERE name = $1")
        .bind(name)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Lecture updated_at client: {}", e))?;
    Ok(row.map(|r| r.get::<DateTime<Utc>, _>("updated_at")))
}

/// `updated_at` d'un projet de suivi par `path` (None si absent).
pub async fn get_project_updated_at(
    pool: &PgPool,
    path: &str,
) -> Result<Option<DateTime<Utc>>, String> {
    let row = sqlx::query("SELECT updated_at FROM projects WHERE path = $1")
        .bind(path)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Lecture updated_at projet: {}", e))?;
    Ok(row.map(|r| r.get::<DateTime<Utc>, _>("updated_at")))
}

/// `updated_at` d'une tâche par `id` (None si absente).
pub async fn get_task_updated_at(
    pool: &PgPool,
    id: i64,
) -> Result<Option<DateTime<Utc>>, String> {
    let row = sqlx::query("SELECT updated_at FROM tasks WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Lecture updated_at tâche: {}", e))?;
    Ok(row.map(|r| r.get::<DateTime<Utc>, _>("updated_at")))
}

/// `updated_at` d'une décision par `id` (None si absente).
pub async fn get_decision_updated_at(
    pool: &PgPool,
    id: i64,
) -> Result<Option<DateTime<Utc>>, String> {
    let row = sqlx::query("SELECT updated_at FROM decisions WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Lecture updated_at décision: {}", e))?;
    Ok(row.map(|r| r.get::<DateTime<Utc>, _>("updated_at")))
}

/// Id d'un client par `name` (None si absent) — mapping client_id du pont C1.2.
pub async fn get_client_by_name(pool: &PgPool, name: &str) -> Result<Option<i64>, String> {
    let row = sqlx::query("SELECT id FROM clients WHERE name = $1")
        .bind(name)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Lecture client par nom: {}", e))?;
    Ok(row.map(|r| r.get::<i64, _>("id")))
}

/// Nom d'un client par `id` (None si absent) — mapping client_id du pont C1.2.
pub async fn get_client_by_id(pool: &PgPool, id: i64) -> Result<Option<String>, String> {
    let row = sqlx::query("SELECT name FROM clients WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Lecture client par id: {}", e))?;
    Ok(row.map(|r| r.get::<String, _>("name")))
}

/// Supprime une décision par `id`.
#[allow(dead_code)] // API CRUD suivi (Phase C1.1) — branchée par le pont C1.2.
pub async fn delete_decision(pool: &PgPool, id: i64) -> Result<(), String> {
    sqlx::query("DELETE FROM decisions WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| format!("Suppression décision: {}", e))?;
    Ok(())
}

/// Liste toutes les décisions — API suivi fusionné, Phase C1.5.
pub async fn list_decisions(pool: &PgPool) -> Result<Vec<DecisionRow>, String> {
    let rows = sqlx::query(
        "SELECT id, project_id, task_id, summary, source_session, updated_at \
         FROM decisions ORDER BY id",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Liste décisions: {}", e))?;
    Ok(rows
        .iter()
        .map(|r| DecisionRow {
            id: r.get::<i64, _>("id"),
            project_id: r.get::<Option<i64>, _>("project_id"),
            task_id: r.get::<Option<i64>, _>("task_id"),
            summary: r.get::<String, _>("summary"),
            source_session: r.get::<String, _>("source_session"),
            updated_at: r.get::<DateTime<Utc>, _>("updated_at"),
        })
        .collect())
}

// ── Tickets (Phase C2.3, spec_gds.md §2.2) ──
// Modèle de demandes/tickets : tickets + commentaires + événements (audit de
// visibilité). `source` distingue l'origine ('web' | 'interne' | 'assistant').
// `status` ∈ 'ouvert' | 'en cours' | 'en correction' | 'fermé' ; `priority` ∈
// 'low' | 'medium' | 'high'. Respecte `gds_enabled` (les commandes/appels
// refusent toute opération si le GDS est désactivé globalement).

/// Ligne ticket (lecture).
#[derive(Debug, Clone, serde::Serialize)]
pub struct TicketRow {
    pub id: i64,
    pub project_id: Option<i64>,
    pub client_id: Option<i64>,
    pub reporter_user_id: Option<i64>,
    pub title: String,
    pub description: String,
    pub status: String,
    pub priority: String,
    pub source: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub resolved_at: Option<DateTime<Utc>>,
}

/// Crée un ticket. Retourne l'id. `source` ∈ 'web' | 'interne' | 'assistant'.
pub async fn ticket_create(
    pool: &PgPool,
    project_id: Option<i64>,
    client_id: Option<i64>,
    reporter_user_id: Option<i64>,
    title: &str,
    description: &str,
    priority: &str,
    source: &str,
) -> Result<i64, String> {
    let row = sqlx::query(
        "INSERT INTO tickets (project_id, client_id, reporter_user_id, title, description, priority, source) \
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
    )
    .bind(project_id)
    .bind(client_id)
    .bind(reporter_user_id)
    .bind(title)
    .bind(description)
    .bind(priority)
    .bind(source)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Création ticket: {}", e))?;
    Ok(row.get::<i64, _>("id"))
}

/// Retourne un ticket par id (None si absent).
#[allow(dead_code)] // API CRUD tickets (Phase C2.3) — exposée pour l'UI/API.
pub async fn get_ticket_by_id(pool: &PgPool, id: i64) -> Result<Option<TicketRow>, String> {
    let row = sqlx::query(
        "SELECT id, project_id, client_id, reporter_user_id, title, description, status, priority, source, \
                created_at, updated_at, resolved_at \
         FROM tickets WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Lecture ticket: {}", e))?;
    Ok(row.map(|r| TicketRow {
        id: r.get::<i64, _>("id"),
        project_id: r.get::<Option<i64>, _>("project_id"),
        client_id: r.get::<Option<i64>, _>("client_id"),
        reporter_user_id: r.get::<Option<i64>, _>("reporter_user_id"),
        title: r.get::<String, _>("title"),
        description: r.get::<String, _>("description"),
        status: r.get::<String, _>("status"),
        priority: r.get::<String, _>("priority"),
        source: r.get::<String, _>("source"),
        created_at: r.get::<DateTime<Utc>, _>("created_at"),
        updated_at: r.get::<DateTime<Utc>, _>("updated_at"),
        resolved_at: r.get::<Option<DateTime<Utc>>, _>("resolved_at"),
    }))
}

/// Recherche des tickets par filtres (texte libre, statut, projet, client).
/// Tous les filtres sont optionnels (chaîne vide = non filtré). Retourne les
/// tickets correspondants triés par `updated_at` décroissant (les plus récents
/// d'abord).
pub async fn ticket_search(
    pool: &PgPool,
    query: &str,
    status: &str,
    project_id: Option<i64>,
    client_id: Option<i64>,
) -> Result<Vec<TicketRow>, String> {
    // Construit la clause WHERE avec des placeholders séquentiels $1..$n puis
    // bind les valeurs dans l'ordre. `query`/`status` vides = non filtrés.
    let mut sql = String::from(
        "SELECT id, project_id, client_id, reporter_user_id, title, description, status, priority, source, \
                created_at, updated_at, resolved_at \
         FROM tickets WHERE 1=1",
    );
    let mut n = 0usize;
    let mut binds: Vec<String> = Vec::new();
    if !query.trim().is_empty() {
        n += 1;
        sql.push_str(&format!(" AND (title ILIKE ${} OR description ILIKE ${})", n, n + 1));
        let like = format!("%{}%", query.trim());
        binds.push(like.clone());
        binds.push(like);
        n += 1;
    }
    if !status.trim().is_empty() {
        n += 1;
        sql.push_str(&format!(" AND status = ${}", n));
        binds.push(status.trim().to_string());
    }
    if let Some(pid) = project_id {
        n += 1;
        sql.push_str(&format!(" AND project_id = ${}", n));
        binds.push(pid.to_string());
    }
    if let Some(cid) = client_id {
        n += 1;
        sql.push_str(&format!(" AND client_id = ${}", n));
        binds.push(cid.to_string());
    }
    sql.push_str(" ORDER BY updated_at DESC");
    let mut q = sqlx::query(&sql);
    for b in &binds {
        q = q.bind(b);
    }
    let rows = q
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Recherche tickets: {}", e))?;
    Ok(rows
        .iter()
        .map(|r| TicketRow {
            id: r.get::<i64, _>("id"),
            project_id: r.get::<Option<i64>, _>("project_id"),
            client_id: r.get::<Option<i64>, _>("client_id"),
            reporter_user_id: r.get::<Option<i64>, _>("reporter_user_id"),
            title: r.get::<String, _>("title"),
            description: r.get::<String, _>("description"),
            status: r.get::<String, _>("status"),
            priority: r.get::<String, _>("priority"),
            source: r.get::<String, _>("source"),
            created_at: r.get::<DateTime<Utc>, _>("created_at"),
            updated_at: r.get::<DateTime<Utc>, _>("updated_at"),
            resolved_at: r.get::<Option<DateTime<Utc>>, _>("resolved_at"),
        })
        .collect())
}

/// Liste tous les tickets (API suivi fusionné, Phase C2.3).
pub async fn list_tickets(pool: &PgPool) -> Result<Vec<TicketRow>, String> {
    let rows = sqlx::query(
        "SELECT id, project_id, client_id, reporter_user_id, title, description, status, priority, source, \
                created_at, updated_at, resolved_at \
         FROM tickets ORDER BY updated_at DESC",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Liste tickets: {}", e))?;
    Ok(rows
        .iter()
        .map(|r| TicketRow {
            id: r.get::<i64, _>("id"),
            project_id: r.get::<Option<i64>, _>("project_id"),
            client_id: r.get::<Option<i64>, _>("client_id"),
            reporter_user_id: r.get::<Option<i64>, _>("reporter_user_id"),
            title: r.get::<String, _>("title"),
            description: r.get::<String, _>("description"),
            status: r.get::<String, _>("status"),
            priority: r.get::<String, _>("priority"),
            source: r.get::<String, _>("source"),
            created_at: r.get::<DateTime<Utc>, _>("created_at"),
            updated_at: r.get::<DateTime<Utc>, _>("updated_at"),
            resolved_at: r.get::<Option<DateTime<Utc>>, _>("resolved_at"),
        })
        .collect())
}

/// Ajoute un commentaire à un ticket. Retourne l'id du commentaire.
pub async fn ticket_comment_add(
    pool: &PgPool,
    ticket_id: i64,
    user_id: Option<i64>,
    body: &str,
    author_label: &str,
) -> Result<i64, String> {
    let row = sqlx::query(
        "INSERT INTO ticket_comments (ticket_id, user_id, body, author_label) VALUES ($1, $2, $3, $4) RETURNING id",
    )
    .bind(ticket_id)
    .bind(user_id)
    .bind(body)
    .bind(author_label)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Ajout commentaire ticket: {}", e))?;
    // Touche le ticket (updated_at) pour refléter l'activité.
    sqlx::query("UPDATE tickets SET updated_at = now() WHERE id = $1")
        .bind(ticket_id)
        .execute(pool)
        .await
        .ok();
    Ok(row.get::<i64, _>("id"))
}

/// Met à jour le statut d'un ticket. `status` ∈ 'ouvert' | 'en cours' |
/// 'en correction' | 'fermé'. Quand le statut passe à 'fermé', `resolved_at`
/// est posé à now() (sinon conservé).
pub async fn ticket_status_update(pool: &PgPool, ticket_id: i64, status: &str) -> Result<(), String> {
    let status = status.trim().to_string();
    if status.is_empty() {
        return Err("Statut ticket vide".to_string());
    }
    let resolved = if status == "fermé" {
        "now()"
    } else {
        "NULL"
    };
    let sql = format!(
        "UPDATE tickets SET status = $1, updated_at = now(), resolved_at = {} WHERE id = $2",
        resolved
    );
    sqlx::query(&sql)
        .bind(&status)
        .bind(ticket_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Mise à jour statut ticket: {}", e))?;
    Ok(())
}

/// Journalise un événement de ticket (audit visibilité).
pub async fn ticket_event_add(
    pool: &PgPool,
    ticket_id: i64,
    actor: &str,
    action: &str,
    detail: &str,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO ticket_events (ticket_id, actor, action, detail) VALUES ($1, $2, $3, $4)",
    )
    .bind(ticket_id)
    .bind(actor)
    .bind(action)
    .bind(detail)
    .execute(pool)
    .await
    .map_err(|e| format!("Journalisation événement ticket: {}", e))?;
    Ok(())
}

/// Provisionne la base GDS (test connexion → provision → migrate → admin) et
/// retourne le pool applicatif. Partagé entre la commande Tauri et la route web.
///
/// Déplacé depuis `src-tauri/src/gds.rs` (refonte GDS, L1.8b) : le serveur
/// autonome (`gds-server`) doit pouvoir provisionner la base sans le desk.
/// Seules adaptations : `gds_db::` → appels directs (même module) et
/// `pub(crate)` → `pub`.
pub async fn provision_db(
    db_addr: &str,
    db_user: &str,
    db_password: &str,
    admin_email: &str,
    admin_password: &str,
) -> Result<PgPool, String> {
    // 1. Test connexion PostgreSQL AVANT activation.
    let _test = connect(db_addr).await?;
    // 2. Provision base + user dédié.
    provision(db_addr, GDS_DB_NAME, db_user, db_password).await?;
    // 3. Pool applicatif + migrations.
    let app_url = app_url_from_admin(db_addr, GDS_DB_NAME, db_user, db_password)?;
    let pool = connect(&app_url).await?;
    migrate(&pool).await?;
    // 4. Provision du compte administrateur INITIAL (L2.4) : la création n'est
    //    plus systématique (cf. `provision_initial_admin`).
    provision_initial_admin(&pool, admin_email, admin_password).await?;
    Ok(pool)
}

/// Étape « compte administrateur » de `provision_db` (L2.4), isolée pour être
/// vérifiable sur une base jetable.
///
/// Ne crée **rien** si l'email ou le mot de passe est vide : le poste peut
/// provisionner une base sans secret d'administration (champs vides), c'est
/// alors l'initialisation (`POST /api/gds/setup`) qui définit le compte — aucun
/// mot de passe n'est jamais fabriqué. Ne crée rien non plus si un
/// administrateur existe déjà (usage unique, cf. `create_initial_admin`).
pub async fn provision_initial_admin(
    pool: &PgPool,
    admin_email: &str,
    admin_password: &str,
) -> Result<bool, String> {
    if admin_email.trim().is_empty() || admin_password.is_empty() {
        return Ok(false);
    }
    create_initial_admin(pool, admin_email, admin_password).await
}

/// Garde de publication **forcée** du suivi (refonte GDS, **L3.6**) : vérifie
/// que `email` a le droit de publier le suivi du projet `project_name` et
/// retourne l'identifiant interne du projet.
///
/// Règle resserrée (spec cible §8.2) : le verrou de projet ayant été supprimé
/// (L6), l'appartenance ne suffit plus — il faut être **administrateur**, ou
/// **développeur attribué** au projet (rôle `dev` ET membre). Un compte
/// `standard`, inconnu ou non attribué est refusé, avec la **trace d'audit**
/// `tracking.force.denied` conservée (sujet + rôle + appartenance).
///
/// Extrait de `gds_sync::force_push_tracking` (refonte GDS, L1.8b) vers le
/// socle : c'est la partie dont le serveur autonome a besoin (données déjà en
/// base, aucune dépendance au poste). `source` est la provenance à journaliser
/// dans l'audit (`"desktop"` côté desk, `"server"` côté serveur).
pub async fn ensure_project_publisher(
    pool: &PgPool,
    project_name: &str,
    email: &str,
    source: &str,
) -> Result<i64, String> {
    let project_id = get_project_by_name(pool, project_name)
        .await?
        .ok_or("Projet non enregistré sur le serveur GDS")?;
    // Un compte inconnu (email non enregistré) n'est JAMAIS autorisé : la
    // session historique du poste n'emprunte pas ce chemin (le compte est relu
    // en base par email), donc aucun « fail-open » n'est nécessaire ici.
    let user = get_user_by_email(pool, email).await?;
    let (role, is_member) = match user {
        Some(u) => {
            let member = is_project_member(pool, project_id, u.id).await?;
            (u.role, member)
        }
        None => (crate::roles::Role::Unknown.as_str().to_string(), false),
    };
    if !crate::roles::can_force_publish(&role, is_member) {
        audit_gds(
            pool,
            source,
            email,
            "tracking.force.denied",
            &format!("role={} member={}", role, is_member),
            false,
        )
        .await?;
        return Err(
            "Publication forcée réservée à l'administrateur ou à un développeur attribué au projet"
                .to_string(),
        );
    }
    Ok(project_id)
}

/// Garde d'**ajout d'un projet** GDS côté poste (refonte GDS, **L3.5**).
///
/// L'ajout d'un projet au serveur et sa publication initiale sont réservés à un
/// administrateur ou à un développeur (matrice §5.2). Pour un projet **déjà
/// enregistré**, un développeur doit en outre y être **attribué** : on retombe
/// alors sur la règle de publication ([`crate::roles::can_publish_project`]).
///
/// Compatibilité : si l'email d'identité du poste n'est pas un compte GDS
/// (installation historique, `identity_email` non rattaché à un utilisateur),
/// la garde laisse passer — aucun comportement existant n'est cassé, exactement
/// comme la lecture restreinte des projets en L3.4. Un compte `standard` connu,
/// lui, est refusé.
pub async fn ensure_can_add_project(
    pool: &PgPool,
    project_name: &str,
    email: &str,
) -> Result<(), String> {
    use crate::roles;
    let Some(user) = get_user_by_email(pool, email).await? else {
        return Ok(());
    };
    let existing = get_project_by_name(pool, project_name).await?;
    let (allowed, message) = match existing {
        Some(project_id) => {
            let is_member = is_project_member(pool, project_id, user.id).await?;
            (
                roles::can_publish_project(&user.role, is_member),
                "Publication d'un projet existant réservée à l'administrateur ou à un \
                 développeur attribué au projet",
            )
        }
        None => (
            roles::can_add_project(&user.role),
            "Ajout d'un projet réservé à l'administrateur ou à un développeur",
        ),
    };
    if allowed {
        Ok(())
    } else {
        Err(message.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::postgres::PgConnectOptions;
    use std::str::FromStr;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn app_url_from_admin_replaces_user_and_db() {
        let url = app_url_from_admin(
            "postgres://postgres:secret@192.168.1.10:5432/postgres",
            "pilot_gds",
            "pilot",
            "pwd",
        )
        .unwrap();
        assert_eq!(url, "postgres://pilot:pwd@192.168.1.10:5432/pilot_gds");
    }

    // ── T3(a) — invariant : les migrations embarquées sont figées en LF ──
    // Gratuit en CI, casse le build si une machine de build réintroduit du CRLF
    // (ce qui invaliderait l'empreinte SHA-384 du registre `_sqlx_migrations`).
    #[test]
    fn embedded_migrations_are_lf() {
        let migrator = sqlx::migrate!();
        let mut versions: Vec<i64> = Vec::new();
        for m in migrator.iter() {
            assert!(
                !m.sql.contains('\r'),
                "migration {} contient un CR (fins de ligne non figées en LF) — \
                 vérifier .gitattributes puis `git add --renormalize .`",
                m.version
            );
            versions.push(m.version);
        }
        assert!(!versions.is_empty(), "aucune migration embarquée trouvée");
        let mut sorted = versions.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(
            versions, sorted,
            "versions de migration non triées ou dupliquées"
        );
    }

    // ── L2.3 — versions embarquées et leur rendu (journaux d'init) ──
    #[test]
    fn embedded_migration_versions_are_sorted_from_one() {
        let versions = embedded_migration_versions();
        assert!(!versions.is_empty(), "aucune migration embarquée trouvée");
        assert_eq!(versions[0], 1, "la première migration embarquée doit être 0001");
        let mut sorted = versions.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(
            versions, sorted,
            "versions embarquées non triées ou dupliquées"
        );
    }

    #[test]
    fn format_migration_versions_pads_and_handles_empty() {
        assert_eq!(format_migration_versions(&[1, 2, 7]), "0001, 0002, 0007");
        assert_eq!(format_migration_versions(&[12]), "0012");
        assert_eq!(format_migration_versions(&[]), "(aucune)");
    }

    // ── T3(c) — classification pure des divergences d'empreinte ──
    #[test]
    fn classify_checksum_identical() {
        let sql = "CREATE TABLE t (id INT);\nSELECT 1;\n";
        let checksum = sha384_bytes(sql.as_bytes());
        assert_eq!(
            classify_checksum_divergence(&checksum, sql, &checksum),
            ChecksumDivergence::Identical
        );
    }

    #[test]
    fn classify_checksum_eol_only_both_directions() {
        let lf = "CREATE TABLE t (id INT);\nSELECT 1;\n";
        let crlf = lf.replace('\n', "\r\n");
        // Base écrite par une build CRLF, binaire LF qui la relit.
        assert_eq!(
            classify_checksum_divergence(
                &sha384_bytes(lf.as_bytes()),
                lf,
                &sha384_bytes(crlf.as_bytes())
            ),
            ChecksumDivergence::EolOnly
        );
        // Base écrite par une build LF, binaire CRLF qui la relit.
        assert_eq!(
            classify_checksum_divergence(
                &sha384_bytes(crlf.as_bytes()),
                &crlf,
                &sha384_bytes(lf.as_bytes())
            ),
            ChecksumDivergence::EolOnly
        );
    }

    #[test]
    fn classify_checksum_content_changed() {
        let sql = "CREATE TABLE t (id INT);\n";
        let changed = "CREATE TABLE t (id BIGINT);\n";
        assert_eq!(
            classify_checksum_divergence(
                &sha384_bytes(sql.as_bytes()),
                sql,
                &sha384_bytes(changed.as_bytes())
            ),
            ChecksumDivergence::ContentChanged
        );
    }

    // ── T5 — réparation EOL de bout en bout (Postgres, facultatif/isolé) ──
    //
    // Ne s'exécute QUE si `PILOT_GDS_TEST_URL` est fournie par l'environnement
    // (jamais `.pilot/gds.json`, jamais `~/.pilot/gds_secrets.json`). Sans elle,
    // la CI reste verte. L'URL doit viser une base `pilot_gds_test_*` : la base
    // réelle `pilot_gds` ne peut JAMAIS être ciblée.
    //
    // Isolation : ce test n'appelle AUCUNE fonction de config/secrets GDS (ni
    // `read_gds_secrets` ni `write_gds_secrets`) — l'URL vient exclusivement de
    // l'environnement. Le `TestGdsSecretsGuard` de `gds.rs` est privé à son
    // module et non référençable ici sans modifier `gds.rs` (hors périmètre).

    /// Nom de base de test unique (`pilot_gds_test_<pid>_<n>`).
    fn unique_test_db_name() -> String {
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        format!("pilot_gds_test_{}_{}", std::process::id(), n)
    }

    /// Base jetable : `DROP DATABASE` garanti au Drop, même en cas de panique.
    /// La suppression passe par un thread dédié (un `Drop` ne peut pas `.await`)
    /// qui ouvre son propre runtime tokio.
    struct GdsTestDbGuard {
        admin_options: PgConnectOptions,
        db_name: String,
    }

    impl Drop for GdsTestDbGuard {
        fn drop(&mut self) {
            let opts = self.admin_options.clone();
            let name = self.db_name.clone();
            let _ = std::thread::spawn(move || {
                if let Ok(rt) = tokio::runtime::Runtime::new() {
                    let _ = rt.block_on(async move {
                        if let Ok(pool) = PgPoolOptions::new().connect_with(opts).await {
                            // Coupe les connexions résiduelles avant le DROP
                            // (portable, y compris PostgreSQL < 13).
                            let _ = sqlx::query(
                                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity \
                                 WHERE datname = $1 AND pid <> pg_backend_pid()",
                            )
                            .bind(&name)
                            .execute(&pool)
                            .await;
                            let _ = sqlx::query(&format!(
                                "DROP DATABASE IF EXISTS \"{}\"",
                                name
                            ))
                            .execute(&pool)
                            .await;
                            pool.close().await;
                        }
                    });
                }
            })
            .join();
        }
    }

    /// Base **vierge jetable** migrée (lot L3) : `None` si
    /// `PILOT_GDS_TEST_URL` est absente/invalide ou ne vise pas
    /// `pilot_gds_test_*` (le test sort alors proprement — CI verte).
    ///
    /// Le pool est déclaré **avant** le garde dans le tuple : il est donc fermé
    /// avant le `DROP DATABASE` du garde (ordre de destruction des tuples).
    async fn fresh_migrated_test_db() -> Option<(PgPool, GdsTestDbGuard)> {
        let url = match std::env::var("PILOT_GDS_TEST_URL") {
            Ok(v) if !v.trim().is_empty() => v,
            _ => {
                eprintln!("PILOT_GDS_TEST_URL absente — test ignoré");
                return None;
            }
        };
        let base_opts = match PgConnectOptions::from_str(&url) {
            Ok(o) => o,
            Err(e) => {
                eprintln!("PILOT_GDS_TEST_URL invalide ({}) — test ignoré", e);
                return None;
            }
        };
        let env_db = base_opts.get_database().unwrap_or("").to_string();
        if !env_db.starts_with("pilot_gds_test_") {
            eprintln!(
                "REFUS: PILOT_GDS_TEST_URL doit viser une base de test `pilot_gds_test_*` \
                 (base visée: {:?}) — test ignoré",
                env_db
            );
            return None;
        }
        assert_ne!(
            env_db, GDS_DB_NAME,
            "la base réelle ne doit jamais être ciblée"
        );

        let test_db = unique_test_db_name();
        let admin_pool = PgPoolOptions::new()
            .max_connections(2)
            .connect_with(base_opts.clone())
            .await
            .expect("connexion admin de test");
        let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS \"{}\"", test_db))
            .execute(&admin_pool)
            .await;
        sqlx::query(&format!("CREATE DATABASE \"{}\"", test_db))
            .execute(&admin_pool)
            .await
            .expect("création base de test");
        let guard = GdsTestDbGuard {
            admin_options: base_opts.clone(),
            db_name: test_db.clone(),
        };
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect_with(base_opts.clone().database(&test_db))
            .await
            .expect("connexion base de test");
        migrate(&pool).await.expect("migration sur base vierge");
        admin_pool.close().await;
        Some((pool, guard))
    }

    #[tokio::test]
    async fn migrate_repairs_eol_checksum_mismatch() {
        // Test d'intégration facultatif : sans serveur Postgres de test fourni
        // par l'environnement, on sort proprement.
        let url = match std::env::var("PILOT_GDS_TEST_URL") {
            Ok(v) if !v.trim().is_empty() => v,
            _ => {
                eprintln!(
                    "migrate_repairs_eol_checksum_mismatch: PILOT_GDS_TEST_URL absente \
                     — test ignoré"
                );
                return;
            }
        };
        // Garde-fou : l'URL NE DOIT JAMAIS viser la base réelle `pilot_gds`.
        let base_opts = match PgConnectOptions::from_str(&url) {
            Ok(o) => o,
            Err(e) => {
                eprintln!("PILOT_GDS_TEST_URL invalide ({}) — test ignoré", e);
                return;
            }
        };
        let env_db = base_opts.get_database().unwrap_or("").to_string();
        if !env_db.starts_with("pilot_gds_test_") {
            eprintln!(
                "REFUS: PILOT_GDS_TEST_URL doit viser une base de test `pilot_gds_test_*` \
                 (base visée: {:?}) — test ignoré",
                env_db
            );
            return;
        }
        assert_ne!(env_db, GDS_DB_NAME, "la base réelle ne doit jamais être ciblée");

        let test_db = unique_test_db_name();
        assert!(test_db.starts_with("pilot_gds_test_"));

        // Connexion admin (base de l'URL env) : sert à CREATE/DROP la base jetable.
        let admin_pool = PgPoolOptions::new()
            .max_connections(2)
            .connect_with(base_opts.clone())
            .await
            .expect("connexion admin de test");
        let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS \"{}\"", test_db))
            .execute(&admin_pool)
            .await;
        sqlx::query(&format!("CREATE DATABASE \"{}\"", test_db))
            .execute(&admin_pool)
            .await
            .expect("création base de test");
        // Teardown garanti (Drop) même en cas de panique.
        let _guard = GdsTestDbGuard {
            admin_options: base_opts.clone(),
            db_name: test_db.clone(),
        };

        let app_options = base_opts.clone().database(&test_db);
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect_with(app_options)
            .await
            .expect("connexion base de test");

        // 1) Migration initiale : base vierge → toutes les migrations appliquées.
        migrate(&pool).await.expect("migration initiale");

        let migrator = sqlx::migrate!();
        let v1 = migrator
            .iter()
            .find(|m| m.version == 1)
            .expect("migration 1 embarquée");
        let embedded_checksum = v1.checksum.to_vec();

        // 2) Simule une empreinte écrite par une build aux fins de ligne
        //    opposées (test valable en build LF comme CRLF).
        let opposite_sql = if v1.sql.contains("\r\n") {
            v1.sql.replace("\r\n", "\n")
        } else {
            v1.sql.replace('\n', "\r\n")
        };
        let opposite_checksum = sha384_bytes(opposite_sql.as_bytes());
        assert_ne!(
            opposite_checksum, embedded_checksum,
            "le contenu opposé doit produire une empreinte différente"
        );
        sqlx::query(&format!(
            "UPDATE {} SET checksum = $1 WHERE version = $2",
            MIGRATIONS_TABLE
        ))
        .bind(opposite_checksum.as_slice())
        .bind(1_i64)
        .execute(&pool)
        .await
        .expect("écriture empreinte divergente");

        // 3) La migration suivante doit auto-réparer (aucun SQL rejoué).
        migrate(&pool).await.expect("migration après réparation");

        let repaired: Vec<u8> = sqlx::query(&format!(
            "SELECT checksum FROM {} WHERE version = $1",
            MIGRATIONS_TABLE
        ))
        .bind(1_i64)
        .fetch_one(&pool)
        .await
        .expect("lecture empreinte réparée")
        .try_get("checksum")
        .expect("checksum bytea");
        assert_eq!(repaired, embedded_checksum, "empreinte non réalignée");

        // 4) Les tables attendues existent (aucun SQL n'a été rejoué/modifié).
        let users_exists: bool =
            sqlx::query_scalar("SELECT to_regclass('users') IS NOT NULL")
                .fetch_one(&pool)
                .await
                .expect("to_regclass users");
        let tickets_exists: bool =
            sqlx::query_scalar("SELECT to_regclass('tickets') IS NOT NULL")
                .fetch_one(&pool)
                .await
                .expect("to_regclass tickets");
        assert!(users_exists, "table `users` absente");
        assert!(tickets_exists, "table `tickets` absente");

        // 5) Toutes les migrations sont enregistrées.
        let count: i64 =
            sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {}", MIGRATIONS_TABLE))
                .fetch_one(&pool)
                .await
                .expect("comptage migrations");
        assert_eq!(count as usize, migrator.iter().count());

        pool.close().await;
    }

    // ── T5(b) — « to_repair vide » : relecture autoritaire sous verrou ──
    //
    // Course au démarrage : si le registre a déjà été réaligné par une autre
    // instance (ou l'est entre-temps), la classification ne trouve PLUS aucune
    // divergence de fins de ligne (`to_repair` vide). Le code doit alors
    // RETENTER `run_direct` (autoritaire) et réussir au lieu de renvoyer
    // l'erreur `VersionMismatch` d'origine. Test de bout en bout facultatif :
    // même isolation que `migrate_repairs_eol_checksum_mismatch` (base jetable
    // `pilot_gds_test_*`, URL exclusivement issue de `PILOT_GDS_TEST_URL`).
    #[tokio::test]
    async fn repair_with_empty_to_repair_retries_run_direct() {
        let url = match std::env::var("PILOT_GDS_TEST_URL") {
            Ok(v) if !v.trim().is_empty() => v,
            _ => {
                eprintln!(
                    "repair_with_empty_to_repair_retries_run_direct: \
                     PILOT_GDS_TEST_URL absente — test ignoré"
                );
                return;
            }
        };
        let base_opts = match PgConnectOptions::from_str(&url) {
            Ok(o) => o,
            Err(e) => {
                eprintln!("PILOT_GDS_TEST_URL invalide ({}) — test ignoré", e);
                return;
            }
        };
        let env_db = base_opts.get_database().unwrap_or("").to_string();
        if !env_db.starts_with("pilot_gds_test_") {
            eprintln!(
                "REFUS: PILOT_GDS_TEST_URL doit viser une base de test \
                 `pilot_gds_test_*` (base visée: {:?}) — test ignoré",
                env_db
            );
            return;
        }
        assert_ne!(env_db, GDS_DB_NAME);

        let test_db = unique_test_db_name();
        let admin_pool = PgPoolOptions::new()
            .max_connections(2)
            .connect_with(base_opts.clone())
            .await
            .expect("connexion admin de test");
        let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS \"{}\"", test_db))
            .execute(&admin_pool)
            .await;
        sqlx::query(&format!("CREATE DATABASE \"{}\"", test_db))
            .execute(&admin_pool)
            .await
            .expect("création base de test");
        let _guard = GdsTestDbGuard {
            admin_options: base_opts.clone(),
            db_name: test_db.clone(),
        };

        let app_options = base_opts.clone().database(&test_db);
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect_with(app_options)
            .await
            .expect("connexion base de test");

        // Registre sain : migration initiale complète.
        migrate(&pool).await.expect("migration initiale");
        let migrator = sqlx::migrate!();

        let read_checksums = |pool: PgPool| async move {
            sqlx::query(&format!(
                "SELECT version, checksum FROM {} ORDER BY version",
                MIGRATIONS_TABLE
            ))
            .fetch_all(&pool)
            .await
            .expect("lecture empreintes")
            .iter()
            .map(|r| (r.get::<i64, _>("version"), r.get::<Vec<u8>, _>("checksum")))
            .collect::<Vec<(i64, Vec<u8>)>>()
        };
        let before = read_checksums(pool.clone()).await;

        // Appel direct avec un `reported_version` alors que le registre est déjà
        // aligné → `to_repair` vide → doit retenter et réussir.
        let mut conn = pool.acquire().await.expect("acquisition connexion");
        repair_eol_only_mismatch(&mut *conn, &migrator, 1)
            .await
            .expect("registre aligné → la retentative doit réussir");
        drop(conn);

        let after = read_checksums(pool.clone()).await;
        assert_eq!(before, after, "le registre ne doit pas être modifié");

        pool.close().await;
    }

    // ── L2.3 — préparation d'une base VIDE, puis conservation des données ──
    //
    // Test d'intégration facultatif, même isolation que les tests T5 : sans
    // `PILOT_GDS_TEST_URL`, il ne s'exécute pas (la CI reste verte). L'URL sert
    // de base d'ADMINISTRATION (base de maintenance, ex. `postgres`) ; la base
    // et le rôle créés par le test portent le préfixe jetable `pilot_gds_test_`
    // et sont supprimés à la fin (garde `Drop`), y compris en cas de panique.
    // La base réelle `pilot_gds` ne peut JAMAIS être ciblée.

    /// Mot de passe du rôle jetable du test L2.3 (aucune valeur de production).
    const L23_TEST_ROLE_PASSWORD: &str = "l23-test-password";

    /// Base + rôle jetables du test L2.3 : `DROP DATABASE` puis `DROP ROLE`
    /// garantis au `Drop` (thread dédié : un `Drop` ne peut pas `.await`).
    struct L23TestGuard {
        admin_options: PgConnectOptions,
        db_name: String,
        role: String,
    }

    impl Drop for L23TestGuard {
        fn drop(&mut self) {
            let opts = self.admin_options.clone();
            let name = self.db_name.clone();
            let role = self.role.clone();
            let _ = std::thread::spawn(move || {
                if let Ok(rt) = tokio::runtime::Runtime::new() {
                    let _ = rt.block_on(async move {
                        if let Ok(pool) = PgPoolOptions::new().connect_with(opts).await {
                            let _ = sqlx::query(
                                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity \
                                 WHERE datname = $1 AND pid <> pg_backend_pid()",
                            )
                            .bind(&name)
                            .execute(&pool)
                            .await;
                            let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS \"{}\"", name))
                                .execute(&pool)
                                .await;
                            let _ = sqlx::query(&format!("DROP OWNED BY \"{}\"", role))
                                .execute(&pool)
                                .await;
                            let _ = sqlx::query(&format!("DROP ROLE IF EXISTS \"{}\"", role))
                                .execute(&pool)
                                .await;
                            pool.close().await;
                        }
                    });
                }
            })
            .join();
        }
    }

    #[tokio::test]
    async fn provision_with_creates_then_preserves_the_database() {
        let url = match std::env::var("PILOT_GDS_TEST_URL") {
            Ok(v) if !v.trim().is_empty() => v,
            _ => {
                eprintln!(
                    "provision_with_creates_then_preserves_the_database: \
                     PILOT_GDS_TEST_URL absente — test ignoré"
                );
                return;
            }
        };
        let base_opts = match PgConnectOptions::from_str(&url) {
            Ok(o) => o,
            Err(e) => {
                eprintln!("PILOT_GDS_TEST_URL invalide ({}) — test ignoré", e);
                return;
            }
        };
        let env_db = base_opts.get_database().unwrap_or("").to_string();
        assert!(
            !env_db.is_empty(),
            "PILOT_GDS_TEST_URL doit désigner une base d'administration"
        );
        assert_ne!(
            env_db, GDS_DB_NAME,
            "la base réelle ne doit jamais être ciblée"
        );

        // Base + rôle jetables (préfixe réservé aux tests).
        let base_name = unique_test_db_name();
        let test_db = base_name.clone();
        let test_role = format!("{}_role", base_name);

        let admin_pool = PgPoolOptions::new()
            .max_connections(2)
            .connect_with(base_opts.clone())
            .await
            .expect("connexion admin de test");
        // Reliquats éventuels d'un run interrompu.
        let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS \"{}\"", test_db))
            .execute(&admin_pool)
            .await;
        let _ = sqlx::query(&format!("DROP ROLE IF EXISTS \"{}\"", test_role))
            .execute(&admin_pool)
            .await;
        let _guard = L23TestGuard {
            admin_options: base_opts.clone(),
            db_name: test_db.clone(),
            role: test_role.clone(),
        };

        // 1) Base VIDE : la préparation crée le rôle puis la base.
        let first = provision_with(
            &admin_pool,
            test_db.as_str(),
            test_role.as_str(),
            L23_TEST_ROLE_PASSWORD,
        )
        .await
        .expect("préparation initiale d'une base vide");
        assert!(first.database_created, "la base devait être créée");
        assert!(first.role_created, "le rôle devait être créé");

        // La base appartient au rôle applicatif : sans cela, PostgreSQL 15+
        // refuserait les migrations dans le schéma `public`.
        let owner: String = sqlx::query_scalar(
            "SELECT r.rolname FROM pg_database d JOIN pg_roles r ON r.oid = d.datdba \
             WHERE d.datname = $1",
        )
        .bind(test_db.as_str())
        .fetch_one(&admin_pool)
        .await
        .expect("propriétaire de la base de test");
        assert_eq!(owner, test_role, "la base doit appartenir au rôle applicatif");

        // 2) Le rôle APPLICATIF (non-superuser) applique les migrations.
        let app_opts = base_opts
            .clone()
            .username(test_role.as_str())
            .password(L23_TEST_ROLE_PASSWORD)
            .database(test_db.as_str());
        let app_pool = PgPoolOptions::new()
            .max_connections(5)
            .connect_with(app_opts.clone())
            .await
            .expect("connexion à la base de test avec le rôle applicatif");
        migrate(&app_pool).await.expect("migrations sur base vierge");
        let expected_version = embedded_migration_versions()
            .iter()
            .copied()
            .max()
            .unwrap_or(0);
        assert_eq!(
            crate::server_status::applied_migration(&app_pool)
                .await
                .expect("version de migration appliquée"),
            expected_version,
            "toutes les migrations embarquées doivent être appliquées"
        );
        let users_table: bool = sqlx::query_scalar("SELECT to_regclass('users') IS NOT NULL")
            .fetch_one(&app_pool)
            .await
            .expect("to_regclass users");
        assert!(users_table, "la table `users` doit exister après migration");

        // Marqueur de données : il DOIT survivre à la seconde préparation.
        create_user(
            &app_pool,
            "l23-marker@gds.test",
            "l23",
            "hash-de-test",
            "dev",
            "active",
        )
        .await
        .expect("création du marqueur de données");
        app_pool.close().await;

        // 3) « Redémarrage » sur la MÊME base : rien n'est recréé…
        let second = provision_with(
            &admin_pool,
            test_db.as_str(),
            test_role.as_str(),
            L23_TEST_ROLE_PASSWORD,
        )
        .await
        .expect("préparation idempotente");
        assert!(
            !second.database_created,
            "une base existante ne doit JAMAIS être recréée"
        );
        assert!(!second.role_created, "un rôle existant ne doit pas être recréé");

        // …et les migrations sont rejouées sans effet (aucune réinitialisation).
        let app_pool = PgPoolOptions::new()
            .max_connections(5)
            .connect_with(app_opts)
            .await
            .expect("reconnexion au second démarrage");
        migrate(&app_pool).await.expect("migrations rejouées");
        let users: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
            .fetch_one(&app_pool)
            .await
            .expect("comptage des utilisateurs");
        assert_eq!(
            users, 1,
            "les données existantes doivent être CONSERVÉES (aucune remise à zéro)"
        );
        let migrations: i64 =
            sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {}", MIGRATIONS_TABLE))
                .fetch_one(&app_pool)
                .await
                .expect("comptage des migrations");
        assert_eq!(
            migrations as usize,
            embedded_migration_versions().len(),
            "aucune migration supplémentaire ne doit être appliquée"
        );
        app_pool.close().await;
    }

    // ── L2.4 — compte administrateur défini, jamais généré ──
    //
    // Test d'intégration facultatif, même isolation que les tests L2.3 : sans
    // `PILOT_GDS_TEST_URL` il ne s'exécute pas (la CI reste verte). L'URL sert de
    // base d'ADMINISTRATION ; la base visée est jetable (`pilot_gds_test_*`) et
    // supprimée à la fin par la garde `Drop`, y compris en cas de panique.
    #[tokio::test]
    async fn initial_admin_is_created_once_with_the_chosen_password() {
        let url = match std::env::var("PILOT_GDS_TEST_URL") {
            Ok(v) if !v.trim().is_empty() => v,
            _ => {
                eprintln!(
                    "initial_admin_is_created_once_with_the_chosen_password: \
                     PILOT_GDS_TEST_URL absente — test ignoré"
                );
                return;
            }
        };
        let base_opts = match PgConnectOptions::from_str(&url) {
            Ok(o) => o,
            Err(e) => {
                eprintln!("PILOT_GDS_TEST_URL invalide ({}) — test ignoré", e);
                return;
            }
        };
        let env_db = base_opts.get_database().unwrap_or("").to_string();
        if !env_db.starts_with("pilot_gds_test_") {
            eprintln!(
                "REFUS: PILOT_GDS_TEST_URL doit viser une base de test \
                 `pilot_gds_test_*` (base visée: {:?}) — test ignoré",
                env_db
            );
            return;
        }

        let test_db = unique_test_db_name();
        let admin_pool = PgPoolOptions::new()
            .max_connections(2)
            .connect_with(base_opts.clone())
            .await
            .expect("connexion admin de test");
        let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS \"{}\"", test_db))
            .execute(&admin_pool)
            .await;
        sqlx::query(&format!("CREATE DATABASE \"{}\"", test_db))
            .execute(&admin_pool)
            .await
            .expect("création base de test");
        let _guard = GdsTestDbGuard {
            admin_options: base_opts.clone(),
            db_name: test_db.clone(),
        };

        let app_opts = base_opts.clone().database(&test_db);
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect_with(app_opts)
            .await
            .expect("connexion base de test");
        migrate(&pool).await.expect("migration initiale");

        // 1) Base fraîche : AUCUN administrateur (la migration ne fabrique
        //    aucun compte, aucun mot de passe par défaut).
        assert_eq!(count_admins(&pool).await.unwrap(), 0);

        // 2) Un mot de passe (ou un email) vide est REFUSÉ : le programme ne
        //    fabrique jamais de mot de passe, il n'y a pas de repli.
        assert!(create_initial_admin(&pool, "owner@gds.test", "").await.is_err());
        assert!(create_initial_admin(&pool, "   ", "choisi-par-le-proprietaire").await.is_err());
        assert_eq!(count_admins(&pool).await.unwrap(), 0, "rien ne doit être créé");

        // 3) Chemin du POSTE (`provision_db` → `provision_initial_admin`) :
        //    sans mot de passe d'administration, RIEN n'est créé — c'est la
        //    disparition de la création automatique et systématique.
        assert!(!provision_initial_admin(&pool, "owner-desk@gds.test", "")
            .await
            .expect("provision sans mot de passe"));
        assert!(!provision_initial_admin(&pool, "   ", "mot-de-passe-choisi")
            .await
            .expect("provision sans email"));
        assert_eq!(
            count_admins(&pool).await.unwrap(),
            0,
            "aucun administrateur ne doit être créé par un provisionnement sans secret"
        );

        // 4) Premier appel d'initialisation : le compte est créé avec le mot de
        //    passe CHOISI.
        let chosen = "mot-de-passe-choisi-l24";
        assert!(create_initial_admin(&pool, "owner@gds.test", chosen)
            .await
            .expect("création de l'administrateur initial"));
        assert_eq!(count_admins(&pool).await.unwrap(), 1);
        let admin = get_user_by_email(&pool, "owner@gds.test")
            .await
            .expect("lecture de l'administrateur")
            .expect("l'administrateur doit exister");
        assert_eq!(admin.role, "admin");
        assert_eq!(admin.status, "active");
        assert_ne!(admin.password_hash, chosen, "jamais de mot de passe en clair");
        assert!(
            crate::auth::WebAuth::verify_password(chosen, &admin.password_hash),
            "le mot de passe saisi doit être celui qui a été enregistré"
        );
        assert!(
            !crate::auth::WebAuth::verify_password("autre-mot-de-passe", &admin.password_hash),
            "un autre mot de passe ne doit pas ouvrir le compte"
        );

        // 5) Appels suivants : usage UNIQUE, refusés, aucune promotion implicite
        //    (ni par l'initialisation, ni par le chemin du poste).
        assert!(!create_initial_admin(&pool, "second@gds.test", "autre-mot-de-passe")
            .await
            .expect("second appel"));
        assert!(!provision_initial_admin(&pool, "second@gds.test", "autre-mot-de-passe")
            .await
            .expect("provision sur base déjà initialisée"));
        assert_eq!(count_admins(&pool).await.unwrap(), 1);
        assert!(get_user_by_email(&pool, "second@gds.test")
            .await
            .unwrap()
            .is_none());

        pool.close().await;
    }

    // ── L3.1 — contraintes de vocabulaire des rôles et des statuts ──
    //
    // Base **vierge jetable** (même isolation que les tests T5) : sur une base
    // neuve, les contraintes `users_role_check` / `users_status_check` doivent
    // exister et être validées ; un rôle (ou un statut) hors vocabulaire doit
    // être REFUSÉ par la base ; les valeurs admises doivent passer. Test
    // facultatif : sans `PILOT_GDS_TEST_URL`, il ne s'exécute pas (CI verte).
    #[tokio::test]
    async fn role_and_status_constraints_are_enforced_on_a_fresh_db() {
        let url = match std::env::var("PILOT_GDS_TEST_URL") {
            Ok(v) if !v.trim().is_empty() => v,
            _ => {
                eprintln!(
                    "role_and_status_constraints_are_enforced_on_a_fresh_db: \
                     PILOT_GDS_TEST_URL absente — test ignoré"
                );
                return;
            }
        };
        let base_opts = match PgConnectOptions::from_str(&url) {
            Ok(o) => o,
            Err(e) => {
                eprintln!("PILOT_GDS_TEST_URL invalide ({}) — test ignoré", e);
                return;
            }
        };
        let env_db = base_opts.get_database().unwrap_or("").to_string();
        if !env_db.starts_with("pilot_gds_test_") {
            eprintln!(
                "REFUS: PILOT_GDS_TEST_URL doit viser une base de test `pilot_gds_test_*` \
                 (base visée: {:?}) — test ignoré",
                env_db
            );
            return;
        }
        assert_ne!(env_db, GDS_DB_NAME, "la base réelle ne doit jamais être ciblée");

        let test_db = unique_test_db_name();
        let admin_pool = PgPoolOptions::new()
            .max_connections(2)
            .connect_with(base_opts.clone())
            .await
            .expect("connexion admin de test");
        let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS \"{}\"", test_db))
            .execute(&admin_pool)
            .await;
        sqlx::query(&format!("CREATE DATABASE \"{}\"", test_db))
            .execute(&admin_pool)
            .await
            .expect("création base de test");
        let _guard = GdsTestDbGuard {
            admin_options: base_opts.clone(),
            db_name: test_db.clone(),
        };

        let app_options = base_opts.clone().database(&test_db);
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect_with(app_options)
            .await
            .expect("connexion base de test");

        // 1) Base vierge : toutes les migrations s'appliquent (dont 0006).
        migrate(&pool).await.expect("migration sur base vierge");

        // 2) Les deux contraintes sont présentes ET validées.
        for name in ["users_role_check", "users_status_check"] {
            let convalidated: Option<bool> = sqlx::query_scalar(
                "SELECT convalidated FROM pg_constraint \
                 WHERE conrelid = 'users'::regclass AND contype = 'c' AND conname = $1",
            )
            .bind(name)
            .fetch_optional(&pool)
            .await
            .expect("lecture de pg_constraint");
            assert_eq!(
                convalidated,
                Some(true),
                "contrainte {} absente ou non validée",
                name
            );
        }

        // 3) Un rôle inconnu est REFUSÉ, avec le nom de contrainte attendu.
        let err = create_user(&pool, "bad-role@gds.test", "", "", "root", "active")
            .await
            .expect_err("un rôle inconnu doit être refusé par la base");
        assert!(
            err.contains("users_role_check"),
            "le refus doit nommer la contrainte de rôle, obtenu : {}",
            err
        );

        // 4) Un statut inconnu est REFUSÉ, avec le nom de contrainte attendu.
        let err = create_user(&pool, "bad-status@gds.test", "", "", "dev", "zzz")
            .await
            .expect_err("un statut inconnu doit être refusé par la base");
        assert!(
            err.contains("users_status_check"),
            "le refus doit nommer la contrainte de statut, obtenu : {}",
            err
        );

        // 5) Les valeurs admises passent (dont 'standard' / 'disabled').
        let id = create_user(&pool, "standard@gds.test", "", "", "standard", "disabled")
            .await
            .expect("un rôle et un statut admis doivent être acceptés");
        let user = get_user_by_email(&pool, "standard@gds.test")
            .await
            .expect("lecture")
            .expect("le compte doit exister");
        assert_eq!(user.id, id);
        assert_eq!(user.role, "standard");
        assert_eq!(user.status, "disabled");

        // 6) Aucune ligne interdite n'a été écrite (échecs transactionnels).
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
            .fetch_one(&pool)
            .await
            .expect("comptage des utilisateurs");
        assert_eq!(count, 1, "seul le compte admis doit exister");

        pool.close().await;
    }

    // ── L3.2 — comptage des administrateurs ACTIFS (garde-fou « dernier admin ») ──
    //
    // Base vierge jetable : seuls les comptes `role = 'admin'` ET
    // `status = 'active'` comptent. `count_admins` (L2.4), lui, compte tous les
    // administrateurs quel que soit leur statut (verrou d'initialisation).
    #[tokio::test]
    async fn count_active_admins_ignores_disabled_and_non_admin_accounts() {
        let (pool, _guard) = match fresh_migrated_test_db().await {
            Some(v) => v,
            None => return,
        };

        // 1) Un admin actif, un admin désactivé, un dev actif.
        create_user(&pool, "a1@gds.test", "", "", "admin", "active")
            .await
            .expect("admin actif");
        create_user(&pool, "a2@gds.test", "", "", "admin", "disabled")
            .await
            .expect("admin désactivé");
        create_user(&pool, "d1@gds.test", "", "", "dev", "active")
            .await
            .expect("dev actif");
        assert_eq!(count_active_admins(&pool).await.unwrap(), 1);
        assert_eq!(
            count_admins(&pool).await.unwrap(),
            2,
            "count_admins compte les admins quel que soit leur statut"
        );

        // 2) Un admin `pending` ne compte pas non plus.
        create_user(&pool, "a3@gds.test", "", "", "admin", "pending")
            .await
            .expect("admin en attente");
        assert_eq!(count_active_admins(&pool).await.unwrap(), 1);

        // 3) Désactiver le seul admin actif (réutilise `set_user_status`) → 0.
        set_user_status(&pool, "a1@gds.test", "disabled")
            .await
            .expect("désactivation");
        assert_eq!(count_active_admins(&pool).await.unwrap(), 0);

        // 4) Réactivation → 1.
        set_user_status(&pool, "a1@gds.test", "active")
            .await
            .expect("réactivation");
        assert_eq!(count_active_admins(&pool).await.unwrap(), 1);

        // 5) Le vocabulaire exposé est bien celui contraint en base (L3.1).
        for r in USER_ROLES {
            assert!(is_known_role(r), "rôle admis rejeté: {}", r);
        }
        for s in USER_STATUSES {
            assert!(is_known_status(s), "statut admis rejeté: {}", s);
        }
        assert!(!is_known_role("root"));
        assert!(!is_known_status("zzz"));

        pool.close().await;
    }

    // ── L3.5 / L3.6 — la matrice des droits appliquée aux gardes de publication ──
    //
    // Base vierge jetable. Vérifie la règle resserrée (spec cible §8.2) :
    //  - publication FORCÉE du suivi (`ensure_project_publisher`, L3.6) : admin
    //    autorisé ; `dev` **attribué** autorisé ; `dev` NON attribué REFUSÉ avec
    //    la trace d'audit `tracking.force.denied` ; `standard` REFUSÉ ; compte
    //    inconnu REFUSÉ ;
    //  - ajout / publication initiale (`ensure_can_add_project`, L3.5) : admin et
    //    `dev` autorisés sur un projet NEUF ; `standard` REFUSÉ ; `dev` non
    //    attribué REFUSÉ sur un projet EXISTANT ; email sans compte GDS toléré
    //    (compatibilité des installations historiques).
    #[tokio::test]
    async fn publication_guards_apply_role_matrix() {
        let (pool, _guard) = match fresh_migrated_test_db().await {
            Some(v) => v,
            None => return,
        };

        // Comptes : un admin, un dev, un standard.
        create_user(&pool, "admin@gds.test", "", "", "admin", "active")
            .await
            .expect("admin");
        create_user(&pool, "dev@gds.test", "", "", "dev", "active")
            .await
            .expect("dev");
        create_user(&pool, "std@gds.test", "", "", "standard", "active")
            .await
            .expect("standard");

        // Un projet EXISTANT, auquel SEUL le dev est attribué.
        let project_id = create_project(
            &pool,
            "proj-l35",
            "proj-l35.git",
            "",
            "/tmp/proj-l35.git",
            "active",
            "",
        )
        .await
        .expect("projet");
        let dev = get_user_by_email(&pool, "dev@gds.test")
            .await
            .unwrap()
            .expect("dev existant");
        assign_project(&pool, project_id, dev.id, "dev")
            .await
            .expect("attribution dev");

        // 1) Publication forcée : admin et dev attribué autorisés.
        assert!(
            ensure_project_publisher(&pool, "proj-l35", "admin@gds.test", "server")
                .await
                .is_ok(),
            "un administrateur publie sans attribution"
        );
        assert!(
            ensure_project_publisher(&pool, "proj-l35", "dev@gds.test", "server")
                .await
                .is_ok(),
            "un développeur attribué publie"
        );

        // 2) Un SECOND dev, non attribué à ce projet : REFUSÉ.
        create_user(&pool, "dev2@gds.test", "", "", "dev", "active")
            .await
            .expect("dev2");
        let err = ensure_project_publisher(&pool, "proj-l35", "dev2@gds.test", "server")
            .await
            .expect_err("un dev non attribué doit être refusé");
        assert!(
            err.contains("administrateur"),
            "message de refus explicite, obtenu: {}",
            err
        );

        // 3) Standard et compte inconnu : REFUSÉS.
        assert!(
            ensure_project_publisher(&pool, "proj-l35", "std@gds.test", "server")
                .await
                .is_err(),
            "le rôle standard ne publie jamais"
        );
        assert!(
            ensure_project_publisher(&pool, "proj-l35", "inconnu@gds.test", "server")
                .await
                .is_err(),
            "un email sans compte GDS ne publie pas"
        );

        // 4) La TRACE D'AUDIT du refus est bien conservée.
        let denied: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM audit_gds \
             WHERE action = 'tracking.force.denied' AND ok = false AND subject = $1",
        )
        .bind("dev2@gds.test")
        .fetch_one(&pool)
        .await
        .expect("lecture audit");
        assert_eq!(denied, 1, "le refus du dev non attribué doit être audité");

        // 5) Ajout d'un projet NEUF : admin et dev autorisés, standard refusé.
        assert!(ensure_can_add_project(&pool, "neuf-admin", "admin@gds.test")
            .await
            .is_ok());
        assert!(ensure_can_add_project(&pool, "neuf-dev", "dev@gds.test")
            .await
            .is_ok());
        assert!(
            ensure_can_add_project(&pool, "neuf-std", "std@gds.test")
                .await
                .is_err(),
            "le rôle standard ne peut pas ajouter de projet"
        );

        // 6) Projet EXISTANT : dev non attribué refusé, dev attribué/admin OK.
        assert!(
            ensure_can_add_project(&pool, "proj-l35", "dev2@gds.test")
                .await
                .is_err(),
            "un dev non attribué ne republie pas un projet existant"
        );
        assert!(ensure_can_add_project(&pool, "proj-l35", "dev@gds.test")
            .await
            .is_ok());
        assert!(ensure_can_add_project(&pool, "proj-l35", "admin@gds.test")
            .await
            .is_ok());

        // 7) Compatibilité : un email sans compte GDS n'est pas bloqué.
        assert!(
            ensure_can_add_project(&pool, "neuf-legacy", "pas-de-compte@gds.test")
                .await
                .is_ok(),
            "installation historique : identité non rattachée à un compte"
        );

        pool.close().await;
    }
}
