// gds_service.rs — Client du poste parlant au SERVICE GDS avec le COMPTE
// UTILISATEUR (refonte GDS, lot 3).
//
// Trois opérations du poste écrivaient DIRECTEMENT en PostgreSQL avec le compte
// technique de la base : « Ajouter ce projet au GDS » (`gds::add_project_to_gds`),
// « Synchroniser » (`gds_client::sync_project`) et « Publier le suivi »
// (`gds_sync::force_push_tracking`). Elles passent désormais par l'API HTTP du
// service, avec le **jeton de session du compte GDS** de l'utilisateur (fiche
// « identité utilisateur » du lot 1) : le poste n'a plus besoin du compte
// technique pour ces opérations, l'identité est **prouvée** par la session (plus
// d'e-mail déclaratif) et les gardes de rôle sont appliquées par le serveur,
// seule autorité.
//
// REPLI OBLIGATOIRE (non négociable) : si aucune identité de compte GDS n'est
// disponible pour l'hôte du projet (fiche héritée keyée sur le compte technique,
// mot de passe GDS absent, port de service absent, projet sans identité
// mémorisée), l'appelant garde le chemin HISTORIQUE (base directe) — les fiches
// héritées continuent de fonctionner exactement comme avant, aucun secret n'est
// perdu ni déplacé. Le repli n'a lieu que si l'identité est **absente** : une
// identité présente mais REFUSÉE (401 / 403 / injoignable) remonte son erreur,
// jamais un contournement silencieux par la base (sinon le garde-fou de rôle
// serait contournable en éteignant le service).
//
// Aucun secret ne sort de ce module : ni mot de passe, ni jeton dans les
// messages d'erreur ni dans les valeurs renvoyées aux commandes.

use crate::gds_admin::{
    admin_base_url, cached_token, drop_token, http_client, send_get, send_post_json, store_token,
    token_key, Reply,
};
use gds_core::config::GdsConfig;
use serde_json::{json, Value};
use std::collections::HashMap;

// ─────────────────────────────────────────────────────────────────────────────
// Identité du compte GDS d'un projet
// ─────────────────────────────────────────────────────────────────────────────

/// Identité du **compte GDS** d'un projet : de quoi ouvrir une session sur le
/// service (hôte + port de service + adresse + mot de passe). Le mot de passe
/// est un SECRET : il ne quitte pas ce module et n'apparaît dans aucun message.
#[derive(Clone)]
pub(crate) struct ServiceIdentity {
    pub(crate) host: String,
    pub(crate) http_port: String,
    pub(crate) email: String,
    pub(crate) password: String,
}

/// Vue réduite d'une fiche serveur mémorisée : la partie **pure** de la
/// résolution de l'identité (testable sans fichier de secrets).
pub(crate) struct SavedIdentity {
    pub(crate) host: String,
    pub(crate) http_port: String,
    pub(crate) email: String,
    pub(crate) password: String,
}

/// Hôte seul d'une adresse éventuellement `hôte:port` (ou `[::1]:port`),
/// normalisé (sans schéma, sans slash final, sans espaces, minuscules). Pure.
pub(crate) fn host_of(addr: &str) -> String {
    let raw = addr.trim().trim_end_matches('/');
    let raw = raw
        .strip_prefix("https://")
        .or_else(|| raw.strip_prefix("http://"))
        .unwrap_or(raw);
    match raw.rsplit_once(':') {
        // Port final numérique uniquement : `[::1]` (IPv6) reste intact.
        Some((h, p)) if !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()) => h.to_string(),
        _ => raw.to_string(),
    }
    .trim()
    .to_ascii_lowercase()
}

/// Vrai si deux adresses désignent le même hôte (schéma et port ignorés). Pure.
pub(crate) fn same_host(a: &str, b: &str) -> bool {
    let h = host_of(a);
    !h.is_empty() && h == host_of(b)
}

/// Vrai si deux adresses e-mail sont identiques (insensible à la casse). Pure.
fn same_email(a: &str, b: &str) -> bool {
    a.trim().eq_ignore_ascii_case(b.trim())
}

/// Choisit le compte GDS à employer pour un projet parmi les fiches mémorisées.
///
/// Une fiche ne sert que si elle porte une **identité utilisable** (adresse GDS,
/// mot de passe GDS et port de service renseignés) et si elle désigne l'hôte du
/// projet (`db_host`, à défaut l'hôte SSH). Si le projet déclare une identité
/// (`identity_email`), la fiche doit porter CETTE adresse : on n'ouvre jamais une
/// session avec le compte d'un autre. `None` = aucune identité → repli sur le
/// chemin historique. Pure.
pub(crate) fn pick_identity(fiches: &[SavedIdentity], cfg: &GdsConfig) -> Option<ServiceIdentity> {
    let declared = cfg.identity_email.trim();
    let mut candidates: Vec<&SavedIdentity> = fiches
        .iter()
        .filter(|f| {
            !f.password.trim().is_empty()
                && !f.http_port.trim().is_empty()
                && !f.email.trim().is_empty()
                && (same_host(&f.host, &cfg.db_host) || same_host(&f.host, &cfg.ssh_host))
                && (declared.is_empty() || same_email(&f.email, declared))
        })
        .collect();
    // Ordre déterministe (plusieurs comptes sur le même serveur) : le premier par
    // adresse. Un « mauvais » choix reste sans danger — le service refuse
    // l'opération selon le rôle réel du compte, il ne l'exécute pas à sa place.
    candidates.sort_by(|a, b| a.email.cmp(&b.email));
    candidates.first().map(|f| ServiceIdentity {
        host: f.host.trim().to_string(),
        http_port: f.http_port.trim().to_string(),
        email: f.email.trim().to_string(),
        password: f.password.clone(),
    })
}

/// Fiches serveur mémorisées, vues comme identités candidates. Lit
/// `~/.pilot/gds_secrets.json` ; aucun secret ne sort d'ici (le mot de passe GDS
/// ne quitte pas le module).
fn saved_identities() -> Vec<SavedIdentity> {
    match crate::gds::read_gds_secrets() {
        Ok(secrets) => secrets
            .servers
            .values()
            .map(|c| SavedIdentity {
                host: c.host.clone(),
                http_port: c.http_port.clone(),
                email: c.gds_email.clone(),
                password: c.gds_password.clone().unwrap_or_default(),
            })
            .collect(),
        Err(_) => Vec::new(),
    }
}

/// Résout l'identité du compte GDS d'un projet depuis les fiches serveur
/// mémorisées (`~/.pilot/gds_secrets.json`, map `servers`). Aucune autre source :
/// une fiche **héritée** (compte technique, sans identité) ne fournit rien, donc
/// le chemin historique reste utilisé. Ne révèle aucun secret.
pub(crate) fn resolve_service_identity(cfg: &GdsConfig) -> Option<ServiceIdentity> {
    pick_identity(&saved_identities(), cfg)
}

/// Configuration minimale ne portant que l'**hôte** (et, s'il est connu,
/// l'e-mail d'identité) : c'est tout ce dont on dispose avant que le projet ait
/// un `.pilot/gds.json`. Pure — la règle de choix reste celle de `pick_identity`.
pub(crate) fn host_only_cfg(host: &str, email: &str) -> GdsConfig {
    GdsConfig {
        enabled: true,
        db_host: host.trim().to_string(),
        db_port: String::new(),
        db_user: String::new(),
        identity_email: email.trim().to_string(),
        server_url: String::new(),
        gds_local_dir: None,
        ssh_port: 0,
        gds_server_repos: None,
        ssh_host: String::new(),
    }
}

/// Même résolution, **sans configuration de projet** : au moment de l'activation
/// (« Activer GDS »), `.pilot/gds.json` n'existe pas encore — seul l'hôte est
/// connu. Même règle de choix que pour un projet ouvert. `None` = aucune fiche
/// de **compte GDS** pour cet hôte → la voie héritée (compte technique) reste
/// seule possible. Ne révèle aucun secret.
pub(crate) fn resolve_identity_for_host(host: &str, email: &str) -> Option<ServiceIdentity> {
    pick_identity(&saved_identities(), &host_only_cfg(host, email))
}

// ─────────────────────────────────────────────────────────────────────────────
// Session de service (jeton du compte)
// ─────────────────────────────────────────────────────────────────────────────

/// Rôles reconnus des sessions de compte, gardés en mémoire à côté des jetons
/// (même clé de cache que `gds_admin`) : le poste doit vérifier AVANT d'écrire ce
/// que le serveur vérifiera de son côté (aucune autorité n'est réimplémentée : on
/// applique la même règle `gds_core::roles` sur le rôle renvoyé par le serveur).
/// Une session expirée (401) purge son entrée : la reconnexion suivante la
/// rafraîchit.
static IDENTITY_ROLES: std::sync::Mutex<Vec<(String, String)>> = std::sync::Mutex::new(Vec::new());

fn lock_roles() -> std::sync::MutexGuard<'static, Vec<(String, String)>> {
    IDENTITY_ROLES.lock().unwrap_or_else(|e| e.into_inner())
}

fn cached_role(key: &str) -> Option<String> {
    lock_roles()
        .iter()
        .find(|(k, _)| k == key)
        .map(|(_, r)| r.clone())
}

fn store_role(key: &str, role: &str) {
    let mut guard = lock_roles();
    guard.retain(|(k, _)| k != key);
    guard.push((key.to_string(), role.to_string()));
}

/// Session ouverte sur le service pour un compte GDS. Le jeton vit dans le cache
/// mémoire partagé avec l'écran d'administration (jamais renvoyé à l'UI).
struct ServiceSession {
    base: String,
    key: String,
    /// Rôle porté par le jeton (`admin` / `dev` / `standard`), tel que le serveur
    /// l'a renvoyé à la connexion.
    role: String,
}

impl ServiceSession {
    /// Ouvre (ou réutilise) la session du compte : `POST /api/gds/users/login`.
    /// **Tout rôle est accepté** ici (l'écran d'administration garde son
    /// exigence d'administrateur) ; les opérations sont refusées par le serveur
    /// selon le rôle. `Err` = message lisible, jamais un secret.
    fn open(ident: &ServiceIdentity) -> Result<Self, String> {
        let base = admin_base_url(&ident.host, &ident.http_port)?;
        let key = token_key(&base, &ident.email);
        let mut role = cached_role(&key).unwrap_or_default();
        if cached_token(&key).is_none() || role.is_empty() {
            let client = http_client()?;
            let login = send_post_json(
                &client,
                &format!("{}/api/gds/users/login", base),
                None,
                &json!({ "email": ident.email, "password": ident.password }),
            )
            .map_err(|e| format!("Connexion au serveur GDS impossible ({})", e))?;
            if !login.ok() {
                // Message sans secret : le mot de passe n'est jamais repris.
                return Err(if login.status == 401 {
                    "Connexion refusée par le serveur GDS : vérifiez l'adresse et le mot de passe de votre compte (« GDS — paramétrage » → Serveurs GDS)."
                        .to_string()
                } else {
                    format!("Connexion au serveur GDS refusée ({})", login.error())
                });
            }
            let body = login.json();
            let token = body
                .get("token")
                .and_then(|t| t.as_str())
                .filter(|t| !t.is_empty())
                .ok_or_else(|| "Le serveur GDS n'a pas délivré de session".to_string())?;
            store_token(&key, token);
            role = body
                .get("role")
                .and_then(|r| r.as_str())
                .unwrap_or_default()
                .to_string();
            store_role(&key, &role);
        }
        Ok(Self { base, key, role })
    }

    /// Jeton en cours de session. Jamais renvoyé hors de ce module.
    fn token(&self) -> Result<String, String> {
        cached_token(&self.key).ok_or_else(|| {
            "Session GDS perdue : relancez l'opération pour vous reconnecter.".to_string()
        })
    }

    /// Réponse du service → valeur JSON, ou message lisible. Sur 401 (session
    /// expirée ou service redémarré), la session est oubliée pour que l'appel
    /// suivant se reconnecte. Le corps d'erreur du serveur est repris tel quel :
    /// il est déjà en français et ne contient aucun secret.
    fn value(&self, reply: Reply) -> Result<Value, String> {
        if reply.ok() {
            return Ok(reply.json());
        }
        if reply.status == 401 {
            drop_token(&self.key);
        }
        Err(format!("Le serveur GDS a refusé l'opération ({})", reply.error()))
    }

    fn get(&self, path: &str) -> Result<Value, String> {
        let client = http_client()?;
        let reply = send_get(
            &client,
            &format!("{}{}", self.base, path),
            Some(&self.token()?),
        )?;
        self.value(reply)
    }

    fn post(&self, path: &str, body: &Value) -> Result<Value, String> {
        let client = http_client()?;
        let reply = send_post_json(
            &client,
            &format!("{}{}", self.base, path),
            Some(&self.token()?),
            body,
        )?;
        self.value(reply)
    }
}

/// Exécute une opération du service hors du thread principal (appels HTTP
/// bloquants), comme le fait déjà l'écran d'administration.
async fn blocking<F, T>(task: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(task)
        .await
        .map_err(|e| format!("Opération GDS: {}", e))?
}

// ─────────────────────────────────────────────────────────────────────────────
// Opération 1 — « Ajouter ce projet au GDS »
// ─────────────────────────────────────────────────────────────────────────────

/// Crée le projet **et son dépôt bare** côté service
/// (`POST /api/gds/projects/create`), rattaché au compte de la session : le
/// serveur relit l'identité depuis le jeton, le poste ne fournit JAMAIS
/// d'e-mail. Idempotent (un second appel réutilise projet et dépôt).
/// Renvoie `{ created, service }` — `created` = dépôt créé par CET appel.
pub(crate) async fn create_project(ident: &ServiceIdentity, name: &str) -> Result<Value, String> {
    let ident = ident.clone();
    let name = name.to_string();
    blocking(move || {
        let session = ServiceSession::open(&ident)?;
        let v = session.post("/api/gds/projects/create", &json!({ "name": name }))?;
        Ok(json!({
            "created": v.get("bare_created").and_then(|b| b.as_bool()).unwrap_or(false),
            "service": v,
        }))
    })
    .await
}

// ─────────────────────────────────────────────────────────────────────────────
// Opération 2 — « Synchroniser / récupérer sa copie »
// ─────────────────────────────────────────────────────────────────────────────

/// Vérifie que le **service** répond (`GET /api/gds/health`, route PUBLIQUE :
/// aucun jeton, aucun compte). C'est la preuve, côté poste, que le serveur est
/// en place — donc que SA base est préparée (le serveur la provisionne à son
/// démarrage). Remplace, sur la voie « compte GDS », la connexion PostgreSQL du
/// poste : aucun compte technique, aucun port de base ouvert n'est requis.
/// Renvoie les compteurs de santé (aucune donnée personnelle, aucun secret).
pub(crate) async fn service_health(host: &str, http_port: &str) -> Result<Value, String> {
    let base = admin_base_url(host, http_port)?;
    blocking(move || {
        let client = http_client()?;
        let reply = send_get(&client, &format!("{}/api/gds/health", base), None)?;
        if !reply.ok() {
            return Err(format!("Service GDS injoignable: {}", reply.error()));
        }
        Ok(reply.json())
    })
    .await
}

/// Enregistre la clef publique du poste pour le compte de la session
/// (`POST /api/gds/ssh-keys`) : le serveur la rattache au compte prouvé par le
/// jeton et régénère ses clefs autorisées. Idempotent. Tout rôle avec identité
/// est accepté — récupérer sa copie est un droit de tout compte actif.
pub(crate) async fn register_poste_key(ident: &ServiceIdentity) -> Result<Value, String> {
    // Clef du poste : générée si absente (idempotent), jamais écrasée.
    let public_key = crate::gds_ssh::ensure_ssh_key()?.public_key;
    let ident = ident.clone();
    blocking(move || {
        let session = ServiceSession::open(&ident)?;
        session.post("/api/gds/ssh-keys", &json!({ "public_key": public_key }))
    })
    .await
}

/// Le service possède-t-il déjà le projet **et** son dépôt bare ?
/// (`POST /api/gds/projects/repo-exists`, lecture ouverte à tout compte
/// authentifié). Un échec remonte : on ne décide pas « absent » sur une panne.
pub(crate) async fn repo_exists(ident: &ServiceIdentity, name: &str) -> Result<bool, String> {
    let ident = ident.clone();
    let name = name.to_string();
    blocking(move || {
        let session = ServiceSession::open(&ident)?;
        let v = session.post("/api/gds/projects/repo-exists", &json!({ "name": name }))?;
        Ok(v.get("exists").and_then(|e| e.as_bool()).unwrap_or(false))
    })
    .await
}

// ─────────────────────────────────────────────────────────────────────────────
// Opération 3 — « Publier le suivi vers le serveur »
// ─────────────────────────────────────────────────────────────────────────────

/// Un projet du suivi local, prêt à publier (le client est désigné par son NOM :
/// les identifiants clients diffèrent entre le poste et le serveur).
pub(crate) struct LocalProject {
    pub(crate) path: String,
    pub(crate) name: String,
    pub(crate) client: Option<String>,
    pub(crate) status: String,
}

/// Suivi local à publier (extrait de la base SQLite du projet).
pub(crate) struct TrackingDump {
    pub(crate) clients: Vec<(String, String)>,
    pub(crate) projects: Vec<LocalProject>,
    pub(crate) tasks: Vec<(i64, i64, String, String, String)>,
    pub(crate) decisions: Vec<(i64, Option<i64>, Option<i64>, String, String)>,
}

/// Charge utile d'un projet du suivi pour le service, une fois connus les
/// identifiants **distants** des clients. Un client non retrouvé reste sans
/// rattachement (`null`) plutôt que de faire échouer la publication. Pure.
pub(crate) fn project_payloads(
    projects: &[LocalProject],
    client_ids: &HashMap<String, i64>,
) -> Vec<Value> {
    projects
        .iter()
        .map(|p| {
            json!({
                "path": p.path,
                "name": p.name,
                "client_id": p.client.as_ref().and_then(|n| client_ids.get(n).copied()),
                "status": p.status,
            })
        })
        .collect()
}

/// Publie le suivi local vers le serveur en ÉCRASANT les données distantes
/// (routes `POST /api/gds/tracking/*` de la phase C1.5). Renvoie le nombre de
/// lignes poussées.
///
/// La garde de publication forcée (administrateur, ou développeur **attribué**
/// au projet) est vérifiée ici avec la MÊME règle que le serveur
/// (`gds_core::roles::can_force_publish`) : l'appartenance se lit dans la liste
/// des projets du compte — un administrateur voit tout, un développeur ne voit
/// que les projets qui lui sont attribués. La garde est appliquée AVANT toute
/// écriture, comme sur le chemin historique.
pub(crate) async fn force_push_tracking(
    ident: &ServiceIdentity,
    project: &str,
    dump: TrackingDump,
) -> Result<i64, String> {
    let ident = ident.clone();
    let name = project.to_string();
    blocking(move || {
        let session = ServiceSession::open(&ident)?;
        let listed = session.get("/api/gds/projects")?;
        let is_member = listed
            .get("projects")
            .and_then(|p| p.as_array())
            .map(|list| {
                list.iter()
                    .any(|p| p.get("name").and_then(|n| n.as_str()) == Some(name.as_str()))
            })
            .unwrap_or(false);
        if !gds_core::roles::can_force_publish(&session.role, is_member) {
            return Err(
                "Publication forcée réservée à l'administrateur ou à un développeur attribué au projet."
                    .to_string(),
            );
        }
        let mut pushed: i64 = 0;
        // Clients d'abord : les projets du suivi les référencent par identifiant.
        let mut client_ids: HashMap<String, i64> = HashMap::new();
        for (cname, notes) in &dump.clients {
            let v = session.post(
                "/api/gds/tracking/clients",
                &json!({ "name": cname, "notes": notes }),
            )?;
            if let Some(id) = v.get("id").and_then(|i| i.as_i64()) {
                client_ids.insert(cname.clone(), id);
            }
            pushed += 1;
        }
        for payload in project_payloads(&dump.projects, &client_ids) {
            session.post("/api/gds/tracking/projects", &payload)?;
            pushed += 1;
        }
        for (id, project_id, title, description, status) in &dump.tasks {
            session.post(
                "/api/gds/tracking/tasks",
                &json!({
                    "id": id,
                    "project_id": project_id,
                    "title": title,
                    "description": description,
                    "status": status,
                }),
            )?;
            pushed += 1;
        }
        for (id, project_id, task_id, summary, source_session) in &dump.decisions {
            session.post(
                "/api/gds/tracking/decisions",
                &json!({
                    "id": id,
                    "project_id": project_id,
                    "task_id": task_id,
                    "summary": summary,
                    "source_session": source_session,
                }),
            )?;
            pushed += 1;
        }
        Ok(pushed)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    fn fiche(host: &str, port: &str, email: &str, pw: &str) -> SavedIdentity {
        SavedIdentity {
            host: host.to_string(),
            http_port: port.to_string(),
            email: email.to_string(),
            password: pw.to_string(),
        }
    }

    fn cfg_of(db_host: &str, ssh_host: &str, identity_email: &str) -> GdsConfig {
        GdsConfig {
            enabled: true,
            db_host: db_host.to_string(),
            db_port: "5432".to_string(),
            db_user: "pilot".to_string(),
            identity_email: identity_email.to_string(),
            server_url: String::new(),
            gds_local_dir: None,
            ssh_port: 22,
            gds_server_repos: None,
            ssh_host: ssh_host.to_string(),
        }
    }

    #[test]
    fn host_of_ignores_scheme_and_port() {
        assert_eq!(host_of("http://127.0.0.1:8080"), "127.0.0.1");
        assert_eq!(host_of(" GDS.local "), "gds.local");
        assert_eq!(host_of("gds.local:22"), "gds.local");
        assert_eq!(host_of("[::1]:8080"), "[::1]");
        assert_eq!(host_of("[::1]"), "[::1]");
    }

    #[test]
    fn pick_identity_requires_a_usable_identity_on_the_projects_host() {
        let cfg = cfg_of("127.0.0.1", "127.0.0.1:22", "dev@x");
        // Fiche héritée du compte technique : aucune identité → repli historique.
        assert!(pick_identity(&[fiche("127.0.0.1", "", "", "")], &cfg).is_none());
        // Identité sans port de service, ou sans mot de passe : inutilisable.
        assert!(pick_identity(&[fiche("127.0.0.1", "8080", "dev@x", "")], &cfg).is_none());
        assert!(pick_identity(&[fiche("127.0.0.1", "", "dev@x", "pw")], &cfg).is_none());
        // Identité d'un AUTRE serveur : jamais employée pour ce projet.
        assert!(pick_identity(&[fiche("10.0.0.9", "8080", "dev@x", "pw")], &cfg).is_none());
        // Identité complète sur l'hôte du projet → utilisée.
        let picked = pick_identity(&[fiche("127.0.0.1", "8080", "dev@x", "pw")], &cfg)
            .expect("identité complète attendue");
        assert_eq!(picked.email, "dev@x");
        assert_eq!(picked.http_port, "8080");
    }

    #[test]
    fn pick_identity_never_borrows_another_accounts_identity() {
        // Le projet déclare `dev@x` : la fiche d'un autre compte du même serveur
        // ne doit pas être employée (mot de passe d'un autre).
        let cfg = cfg_of("gds.local", "gds.local:22", "dev@x");
        let autre = fiche("gds.local", "8080", "autre@x", "pw-autre");
        assert!(pick_identity(&[autre], &cfg).is_none());
        let mine = fiche("gds.local", "8080", "Dev@X", "pw");
        assert_eq!(
            pick_identity(&[mine], &cfg).map(|i| i.email).unwrap_or_default(),
            "Dev@X"
        );
    }

    #[test]
    fn identity_is_found_from_the_host_alone_before_any_project_config() {
        // Activation : le projet n'a pas encore de `.pilot/gds.json` — ni compte
        // technique, ni mot de passe PostgreSQL. La fiche doit être reconnue au
        // SEUL nom de l'hôte (et l'e-mail du compte qui l'ouvre).
        let fiches = [fiche("127.0.0.1", "8080", "dev@x", "pw")];
        let picked = pick_identity(&fiches, &host_only_cfg("127.0.0.1", "dev@x"))
            .expect("identité du compte GDS attendue");
        assert_eq!(picked.http_port, "8080");
        assert_eq!(picked.email, "dev@x");
        // Jamais la session d'un autre compte, ni celle d'un autre serveur.
        assert!(pick_identity(&fiches, &host_only_cfg("127.0.0.1", "autre@x")).is_none());
        assert!(pick_identity(&fiches, &host_only_cfg("10.0.0.9", "dev@x")).is_none());
    }

    #[test]
    fn project_payloads_resolve_the_client_id_by_name() {
        let projects = vec![
            LocalProject {
                path: "C:/p/a".to_string(),
                name: "a".to_string(),
                client: Some("Client A".to_string()),
                status: "active".to_string(),
            },
            LocalProject {
                path: "C:/p/b".to_string(),
                name: "b".to_string(),
                client: Some("Inconnu".to_string()),
                status: "paused".to_string(),
            },
        ];
        let mut ids = HashMap::new();
        ids.insert("Client A".to_string(), 7i64);
        let payloads = project_payloads(&projects, &ids);
        assert_eq!(payloads[0]["client_id"], json!(7));
        assert_eq!(payloads[0]["name"], json!("a"));
        // Client non retrouvé : non rattaché, jamais une erreur.
        assert_eq!(payloads[1]["client_id"], json!(null));
    }

    /// Faux service GDS : répond `200` avec le corps enregistré pour le chemin
    /// demandé (`404` sinon) et journalise chaque requête reçue.
    fn fake_service(routes: Vec<(&'static str, &'static str)>) -> (String, Arc<Mutex<Vec<String>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("écoute locale");
        let addr = listener.local_addr().expect("adresse");
        let log = Arc::new(Mutex::new(Vec::new()));
        let shared = log.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { break };
                let mut reader = BufReader::new(stream.try_clone().expect("clone"));
                let mut first = String::new();
                if reader.read_line(&mut first).is_err() {
                    continue;
                }
                let mut content_length = 0usize;
                let mut auth = String::new();
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 {
                        break;
                    }
                    let trimmed = line.trim_end().to_lowercase();
                    if trimmed.is_empty() {
                        break;
                    }
                    if let Some(v) = trimmed.strip_prefix("content-length:") {
                        content_length = v.trim().parse().unwrap_or(0);
                    }
                    if let Some(v) = trimmed.strip_prefix("authorization:") {
                        auth = v.trim().to_string();
                    }
                }
                let mut body = vec![0u8; content_length];
                if content_length > 0 {
                    let _ = reader.read_exact(&mut body);
                }
                let path = first.split_whitespace().nth(1).unwrap_or("/").to_string();
                shared.lock().unwrap().push(format!(
                    "{} auth={} body={}",
                    path,
                    auth,
                    String::from_utf8_lossy(&body)
                ));
                let (status, payload) = routes
                    .iter()
                    .find(|(p, _)| *p == path)
                    .map(|(_, b)| (200u16, b.to_string()))
                    .unwrap_or((404, "{\"error\":\"route inconnue\"}".to_string()));
                let reason = if status == 200 { "OK" } else { "Not Found" };
                let resp = format!(
                    "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    status,
                    reason,
                    payload.len(),
                    payload
                );
                let _ = stream.write_all(resp.as_bytes());
                let _ = stream.flush();
            }
        });
        (format!("http://{}", addr), log)
    }

    /// Identité de test pointant sur un faux service (l'hôte porte l'URL
    /// complète, ce que `admin_base_url` accepte).
    fn ident_of(base: &str, email: &str, password: &str) -> ServiceIdentity {
        ServiceIdentity {
            host: base.to_string(),
            http_port: String::new(),
            email: email.to_string(),
            password: password.to_string(),
        }
    }

    #[tokio::test]
    async fn create_project_uses_the_account_token_and_never_leaks_it() {
        let (base, log) = fake_service(vec![
            (
                "/api/gds/users/login",
                "{\"ok\":true,\"role\":\"dev\",\"token\":\"tok-abc\"}",
            ),
            (
                "/api/gds/projects/create",
                "{\"ok\":true,\"project_id\":3,\"name\":\"p\",\"bare_created\":true}",
            ),
        ]);
        let ident = ident_of(&base, "dev@x", "pw-secret");
        let v = create_project(&ident, "p").await.expect("création via service");
        assert_eq!(v["created"], json!(true));
        let text = v.to_string();
        assert!(!text.contains("pw-secret"), "mot de passe exposé: {}", text);
        assert!(!text.contains("tok-abc"), "jeton exposé: {}", text);
        let calls = log.lock().unwrap().join("\n");
        assert!(calls.contains("auth=bearer tok-abc"), "jeton non employé: {}", calls);
        assert!(calls.contains("/api/gds/projects/create"), "route: {}", calls);
        // La CRÉATION ne porte aucun e-mail : l'identité vient du jeton (seule
        // la connexion, évidemment, porte l'adresse du compte).
        let create = calls
            .lines()
            .find(|l| l.contains("/api/gds/projects/create"))
            .unwrap_or_default();
        assert!(!create.contains("dev@x"), "e-mail déclaratif envoyé: {}", create);
    }

    #[tokio::test]
    async fn repo_exists_reads_the_service_instead_of_the_database() {
        let (base, _log) = fake_service(vec![
            (
                "/api/gds/users/login",
                "{\"ok\":true,\"role\":\"standard\",\"token\":\"tok-std\"}",
            ),
            ("/api/gds/projects/repo-exists", "{\"name\":\"p\",\"exists\":true}"),
        ]);
        let ident = ident_of(&base, "std@x", "pw");
        assert!(repo_exists(&ident, "p").await.expect("existence lue"));
    }

    #[tokio::test]
    async fn force_push_refuses_a_role_without_rights_before_any_write() {
        let (base, log) = fake_service(vec![
            (
                "/api/gds/users/login",
                "{\"ok\":true,\"role\":\"standard\",\"token\":\"tok-std\"}",
            ),
            ("/api/gds/projects", "{\"projects\":[{\"name\":\"p\"}]}"),
        ]);
        let ident = ident_of(&base, "std@x", "pw");
        let dump = TrackingDump {
            clients: vec![("Client A".to_string(), String::new())],
            projects: vec![],
            tasks: vec![],
            decisions: vec![],
        };
        let err = force_push_tracking(&ident, "p", dump)
            .await
            .expect_err("un compte standard ne publie pas");
        assert!(err.contains("administrateur"), "message: {}", err);
        let calls = log.lock().unwrap().join("\n");
        assert!(!calls.contains("/api/gds/tracking"), "écriture tentée: {}", calls);
    }

    #[tokio::test]
    async fn force_push_publishes_the_local_tracking_through_the_service() {
        let (base, log) = fake_service(vec![
            (
                "/api/gds/users/login",
                "{\"ok\":true,\"role\":\"admin\",\"token\":\"tok-adm\"}",
            ),
            ("/api/gds/projects", "{\"projects\":[]}"),
            ("/api/gds/tracking/clients", "{\"ok\":true,\"id\":7}"),
            ("/api/gds/tracking/projects", "{\"ok\":true,\"id\":1}"),
            ("/api/gds/tracking/tasks", "{\"ok\":true,\"id\":2}"),
            ("/api/gds/tracking/decisions", "{\"ok\":true,\"id\":3}"),
        ]);
        let ident = ident_of(&base, "adm@x", "pw");
        let dump = TrackingDump {
            clients: vec![("Client A".to_string(), "notes".to_string())],
            projects: vec![LocalProject {
                path: "C:/p".to_string(),
                name: "p".to_string(),
                client: Some("Client A".to_string()),
                status: "active".to_string(),
            }],
            tasks: vec![(2, 1, "T".to_string(), "D".to_string(), "open".to_string())],
            decisions: vec![(3, Some(1), Some(2), "R".to_string(), "s".to_string())],
        };
        let pushed = force_push_tracking(&ident, "p", dump)
            .await
            .expect("publication via service");
        assert_eq!(pushed, 4);
        let calls = log.lock().unwrap().join("\n");
        // Le projet publie l'identifiant client DISTANT (7), pas l'identifiant local.
        assert!(calls.contains("\"client_id\":7"), "client non résolu: {}", calls);
        assert!(calls.contains("auth=bearer tok-adm"), "jeton: {}", calls);
    }
}
