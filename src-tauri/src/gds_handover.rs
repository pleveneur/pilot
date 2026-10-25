// gds_handover.rs — PORTAGE d'un projet, côté POSTE (mode réseau multi-postes,
// ÉTAPE 4a).
//
// Le serveur porte déjà les règles et les routes (étapes 2 et 3, livrées) :
// `POST /api/gds/handover/{take,heartbeat,return,force}` et
// `GET /api/gds/handover/state` (`gds_core/src/http.rs`). Ce module est le
// pendant **poste** : il n'invente aucune règle, aucun code de statut, aucune
// forme d'échange. Il
//   1. fournit l'identifiant **de machine** (`poste_id`, voir `gds::poste_id`) ;
//   2. appelle les 5 routes avec la session du **compte GDS** de l'utilisateur,
//      exactement comme le reste du poste (`gds_service`) ;
//   3. traduit chaque réponse : un **refus métier** (400/403/404/409) remonte
//      comme un refus LISIBLE (`{ ok:false, refused:true, status, error }`),
//      jamais comme un plantage ; une panne technique (réseau, 5xx, session
//      refusée) remonte comme une erreur.
//
// Portée de cette étape (écrite pour ne pas déborder) : le poste sait prendre en
// main, consulter l'état et rendre un projet. Le client des 5 routes est complet
// (`heartbeat` et `force` inclus) mais la PRÉSENCE PÉRIODIQUE AUTOMATIQUE, la
// séquence de restitution complète (publier le code → pousser l'avancement →
// rendre) et le blocage des écritures hors portage relèvent de l'étape 4b : rien
// de tout cela n'est déclenché ici.
//
// Aucun secret ne sort de ce module : ni mot de passe, ni jeton dans les
// messages d'erreur ou les valeurs renvoyées à l'interface.

use crate::gds;
use crate::gds_admin::admin_error_message;
use crate::gds_service::{self, ServiceIdentity};
use gds_core::config::project_name;
use serde_json::{json, Value};
use tauri::State;

use crate::AppState;

// ─────────────────────────────────────────────────────────────────────────────
// Chemins des routes du socle (source unique côté poste)
// ─────────────────────────────────────────────────────────────────────────────

pub(crate) const TAKE_PATH: &str = "/api/gds/handover/take";
pub(crate) const HEARTBEAT_PATH: &str = "/api/gds/handover/heartbeat";
pub(crate) const RETURN_PATH: &str = "/api/gds/handover/return";
pub(crate) const FORCE_PATH: &str = "/api/gds/handover/force";

// ─────────────────────────────────────────────────────────────────────────────
// Formes d'échange — recopiées de `gds_core/src/http.rs`, jamais inventées
// ─────────────────────────────────────────────────────────────────────────────

/// Corps commun aux trois routes d'écriture du portage : c'est exactement la
/// forme de `HandoverPortageBody` côté serveur (`project_id` + `poste_id`).
/// `poste_id` est rogné : le serveur refuse un identifiant vide après `trim`.
pub(crate) fn portage_body(project_id: i64, poste_id: &str) -> Value {
    json!({
        "project_id": project_id,
        "poste_id": poste_id.trim(),
    })
}

/// Corps de la libération forcée (`HandoverForceBody` : `project_id` + `reason`).
pub(crate) fn force_body(project_id: i64, reason: &str) -> Value {
    json!({
        "project_id": project_id,
        "reason": reason.trim(),
    })
}

/// Chemin de `GET /api/gds/handover/state` : la route attend le projet en
/// **paramètre de requête** (`HandoverStateQuery { project_id: Option<i64> }`),
/// pas dans un corps.
pub(crate) fn state_path(project_id: i64) -> String {
    format!("/api/gds/handover/state?project_id={}", project_id)
}

// ─────────────────────────────────────────────────────────────────────────────
// Traduction des réponses du serveur (pur, testable sans réseau ni base)
// ─────────────────────────────────────────────────────────────────────────────

/// Réponse classée d'un appel de portage.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum HandoverReply {
    /// 2xx : le serveur a accepté et renvoie son corps (`{ ok, action, state }`,
    /// `{ ok, state }`, `{ ok, id, state }`).
    Accepted(Value),
    /// Refus **métier** : le serveur a dit non pour une raison de la règle de
    /// portage. Ce n'est pas une panne — l'interface doit l'afficher.
    Refused {
        status: u16,
        message: String,
        body: Value,
    },
    /// Panne technique : réseau, 5xx, session refusée (401).
    Failed(String),
}

/// Codes que le socle emploie pour un **refus métier** de portage :
/// 400 entrée invalide (`poste_id` vide, `project_id` absent), 403 compte sans
/// identité ou non-administrateur, 404 projet inconnu, 409 projet tenu par un
/// autre poste / non-porteur / motif vide. Aucun autre code n'est ajouté ici :
/// cette liste vient de `gds-core/src/http.rs` § « handover ».
pub(crate) fn is_business_refusal(status: u16) -> bool {
    matches!(status, 400 | 403 | 404 | 409)
}

/// Classe une réponse du serveur à partir de son **statut** et de son **corps**.
/// Fonction pure : c'est elle qui garantit qu'un refus ne devient jamais une
/// erreur technique. Le message est celui que le serveur a écrit (champ `error`,
/// en français) ; à défaut, un libellé générique par code.
pub(crate) fn classify_reply(status: u16, body: &str) -> HandoverReply {
    let parsed = serde_json::from_str::<Value>(body).unwrap_or(Value::Null);
    if (200..300).contains(&status) {
        return HandoverReply::Accepted(parsed);
    }
    if is_business_refusal(status) {
        return HandoverReply::Refused {
            status,
            message: admin_error_message(status, body),
            body: parsed,
        };
    }
    // 401 : la session du compte a été refusée (serveur redémarré, session
    // expirée). Ce n'est pas un refus de portage : la session a déjà été
    // oubliée par l'appel, il suffit de relancer l'opération.
    if status == 401 {
        return HandoverReply::Failed(
            "Session GDS refusée (401) : relancez l'opération pour vous reconnecter.".to_string(),
        );
    }
    HandoverReply::Failed(admin_error_message(status, body))
}

/// Valeur rendue à l'interface pour une réponse **acceptée** : le corps du
/// serveur est conservé tel quel (`ok`, `action`, `state`, `id`), enrichi du type
/// d'opération et de l'identifiant de machine (utile à l'affichage, non secret).
pub(crate) fn accepted_value(kind: &str, poste_id: &str, body: Value) -> Value {
    match body {
        Value::Object(mut map) => {
            map.insert("handover".to_string(), json!(kind));
            map.insert("poste_id".to_string(), json!(poste_id));
            Value::Object(map)
        }
        _ => json!({ "ok": true, "handover": kind, "poste_id": poste_id }),
    }
}

/// Valeur rendue à l'interface pour un **refus métier** : un refus lisible, pas
/// une erreur. Les éléments de la règle renvoyés par le serveur (`holder`,
/// `until`, `project_id`) sont repris quand ils sont présents — c'est ce qui
/// permet à l'interface de dire QUI tient le projet et JUSQU'À QUAND.
pub(crate) fn refused_value(
    kind: &str,
    poste_id: &str,
    status: u16,
    message: &str,
    body: &Value,
) -> Value {
    let mut out = json!({
        "ok": false,
        "refused": true,
        "handover": kind,
        "status": status,
        "error": message,
        "poste_id": poste_id,
    });
    if let Value::Object(map) = &mut out {
        for field in ["project_id", "holder", "until"] {
            if let Some(v) = body.get(field) {
                if !v.is_null() {
                    map.insert(field.to_string(), v.clone());
                }
            }
        }
    }
    out
}

/// Identifiant serveur (`projects.id`) d'un projet, à partir de la liste
/// `GET /api/gds/projects` (`{ projects: [{ id, name, repo_name, … }] }`).
///
/// Le socle ne propose aucune route « id par nom » : la liste est la seule
/// source, et elle est déjà utilisée par le poste. La correspondance se fait sur
/// le **nom du projet** (dossier local, même valeur qu'à la publication), puis
/// sur le `repo_name` ; une seconde passe insensible à la casse absorbe le cas
/// d'un dossier dont la casse diffère entre postes (Windows). `None` = projet
/// absent du GDS (message d'action côté appelant, jamais un identifiant deviné).
pub(crate) fn project_id_from_listing(listing: &Value, name: &str) -> Option<i64> {
    let wanted = name.trim();
    if wanted.is_empty() {
        return None;
    }
    let projects = listing.get("projects")?.as_array()?;
    let lookup = |field: &str, case_insensitive: bool| -> Option<i64> {
        projects
            .iter()
            .find(|p| {
                p.get(field)
                    .and_then(|v| v.as_str())
                    .map(|v| {
                        let v = v.trim();
                        if case_insensitive {
                            v.eq_ignore_ascii_case(wanted)
                        } else {
                            v == wanted
                        }
                    })
                    .unwrap_or(false)
            })
            .and_then(|p| p.get("id"))
            .and_then(|v| v.as_i64())
    };
    lookup("name", false)
        .or_else(|| lookup("repo_name", false))
        .or_else(|| lookup("name", true))
        .or_else(|| lookup("repo_name", true))
}

// ─────────────────────────────────────────────────────────────────────────────
// Résolution côté poste : compte GDS du projet + identifiant de machine
// ─────────────────────────────────────────────────────────────────────────────

/// Début commun à toutes les opérations : config GDS du projet, compte GDS
/// utilisable, identifiant de machine. Chaque manque produit un message
/// d'action, jamais un échec obscur. Aucun secret n'est révélé.
fn handover_context(project: &str) -> Result<(ServiceIdentity, String), String> {
    let cfg = gds::read_gds_config(project).map_err(|_| {
        "Ce dossier n'est pas encore connecté au GDS : connectez-le d'abord (menu « Ajouter un projet depuis le GDS »)."
            .to_string()
    })?;
    if !cfg.enabled {
        return Err("GDS non activé pour ce projet".to_string());
    }
    let ident = gds_service::resolve_service_identity(&cfg).ok_or_else(|| {
        "Aucun compte GDS enregistré pour ce serveur : ajoutez-le dans « GDS — paramétrage » → « Serveurs GDS », puis testez sa connexion."
            .to_string()
    })?;
    let poste_id = gds::poste_id()?;
    Ok((ident, poste_id))
}

/// Identifiant serveur du projet ouvert, via la liste des projets du serveur.
async fn server_project_id(ident: &ServiceIdentity, project: &str) -> Result<i64, String> {
    let name = project_name(project);
    let listing = gds_service::list_projects_on(ident).await?;
    project_id_from_listing(&listing, &name).ok_or_else(|| {
        format!(
            "Projet « {} » introuvable sur le serveur GDS : ajoutez-le d'abord au GDS.",
            name
        )
    })
}

/// Traduit une réponse classée en valeur rendue à l'interface (ou en erreur pour
/// une panne technique seulement).
fn handover_value(
    kind: &str,
    poste_id: &str,
    reply: HandoverReply,
) -> Result<Value, String> {
    match reply {
        HandoverReply::Accepted(body) => Ok(accepted_value(kind, poste_id, body)),
        HandoverReply::Refused {
            status,
            message,
            body,
        } => Ok(refused_value(kind, poste_id, status, &message, &body)),
        HandoverReply::Failed(message) => Err(format!("Portage — {} : {}", kind, message)),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Client des 5 routes (statut HTTP conservé, donc refus distinguable)
// ─────────────────────────────────────────────────────────────────────────────

/// `POST /api/gds/handover/take` : prendre, renouveler ou reprendre la main.
pub(crate) async fn take(project: &str) -> Result<Value, String> {
    let (ident, poste_id) = handover_context(project)?;
    let project_id = server_project_id(&ident, project).await?;
    let reply = gds_service::post_reply(
        &ident,
        TAKE_PATH,
        portage_body(project_id, &poste_id),
    )
    .await?;
    handover_value("take", &poste_id, classify_reply(reply.status, reply.body()))
}

/// `GET /api/gds/handover/state` : qui tient le projet, jusqu'à quand, expiré
/// ou non. **Lecteur seul** : rien n'est écrit côté serveur.
pub(crate) async fn state_of(project: &str) -> Result<Value, String> {
    let (ident, poste_id) = handover_context(project)?;
    let project_id = server_project_id(&ident, project).await?;
    let reply = gds_service::get_reply(&ident, &state_path(project_id)).await?;
    handover_value("state", &poste_id, classify_reply(reply.status, reply.body()))
}

/// `POST /api/gds/handover/return` : restitution volontaire par le porteur.
///
/// Ordre du plan §6 b : le poste pousse son avancement **avant** d'appeler
/// `return` (le socle ne publie jamais de code). Cette étape 4a n'exécute PAS la
/// séquence complète (publier → pousser → rendre) : l'appel direct est fourni
/// pour l'étape 4b, qui l'enchaînera.
pub(crate) async fn give_back(project: &str) -> Result<Value, String> {
    let (ident, poste_id) = handover_context(project)?;
    let project_id = server_project_id(&ident, project).await?;
    let reply = gds_service::post_reply(
        &ident,
        RETURN_PATH,
        portage_body(project_id, &poste_id),
    )
    .await?;
    handover_value("return", &poste_id, classify_reply(reply.status, reply.body()))
}

/// `POST /api/gds/handover/heartbeat` : présence du porteur (un appel par cycle
/// de 3 minutes). **Non déclenché dans cette étape** — la présence périodique
/// automatique est l'étape 4b ; le client est posé pour qu'elle n'ait qu'à
/// l'appeler.
#[allow(dead_code)]
pub(crate) async fn heartbeat(project: &str) -> Result<Value, String> {
    let (ident, poste_id) = handover_context(project)?;
    let project_id = server_project_id(&ident, project).await?;
    let reply = gds_service::post_reply(
        &ident,
        HEARTBEAT_PATH,
        portage_body(project_id, &poste_id),
    )
    .await?;
    handover_value(
        "heartbeat",
        &poste_id,
        classify_reply(reply.status, reply.body()),
    )
}

/// `POST /api/gds/handover/force` : libération forcée, **réservée au rôle
/// `admin`** par le serveur (le poste ne re-décide pas le rôle, le refus 403 est
/// traduit comme les autres). Motif obligatoire — refus 409 s'il est vide.
/// Aucune commande de cette étape ne l'expose : c'est une action
/// d'administration, hors périmètre du portage d'un poste.
#[allow(dead_code)]
pub(crate) async fn force(project: &str, reason: &str) -> Result<Value, String> {
    let (ident, poste_id) = handover_context(project)?;
    let project_id = server_project_id(&ident, project).await?;
    let reply =
        gds_service::post_reply(&ident, FORCE_PATH, force_body(project_id, reason)).await?;
    handover_value(
        "force",
        &poste_id,
        classify_reply(reply.status, reply.body()),
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Commandes Tauri exposées à l'interface (étape 5 les branchera)
// ─────────────────────────────────────────────────────────────────────────────

/// Commande : prendre en main le projet ouvert. Réponse `{ ok, handover, action,
/// state, poste_id }` (succès) ou `{ ok:false, refused:true, status, error, … }`
/// (refus métier).
#[tauri::command]
pub async fn gds_handover_take(state: State<'_, AppState>, project: String) -> Result<Value, String> {
    if !crate::gds_globally_enabled(&state) {
        return Err("GDS désactivé globalement (Paramètres → GDS)".to_string());
    }
    take(&project).await
}

/// Commande : état du portage du projet ouvert. Lecture seule.
#[tauri::command]
pub async fn gds_handover_state(
    state: State<'_, AppState>,
    project: String,
) -> Result<Value, String> {
    if !crate::gds_globally_enabled(&state) {
        return Err("GDS désactivé globalement (Paramètres → GDS)".to_string());
    }
    state_of(&project).await
}

/// Commande : rendre le projet (restitution volontaire). L'appel direct ne
/// publie ni ne pousse rien : l'enchaînement complet est l'étape 4b.
#[tauri::command]
pub async fn gds_handover_return(
    state: State<'_, AppState>,
    project: String,
) -> Result<Value, String> {
    if !crate::gds_globally_enabled(&state) {
        return Err("GDS désactivé globalement (Paramètres → GDS)".to_string());
    }
    give_back(&project).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gds::TestGdsSecretsGuard;

    // ── poste_id : identifiant de MACHINE, stable ──

    #[test]
    fn poste_id_is_generated_once_then_never_regenerated() {
        let _guard = TestGdsSecretsGuard::new();
        // Premier appel : génération + écriture disque.
        let first = gds::poste_id().expect("poste_id");
        assert!(!first.trim().is_empty(), "un identifiant non vide est exigé");
        assert_eq!(first.len(), 36, "format UUID attendu : {}", first);
        assert!(first.contains('-'), "format UUID attendu : {}", first);
        // Deuxième lecture : la MÊME valeur, jamais une nouvelle.
        let second = gds::poste_id().expect("poste_id");
        assert_eq!(first, second, "l'identifiant de machine ne doit jamais changer");
        // Elle est bien écrite dans la config GDS locale de la machine.
        let secrets = gds::read_gds_secrets().expect("secrets");
        assert_eq!(secrets.poste_id, first);
    }

    #[test]
    fn poste_id_is_the_same_for_every_project_of_the_machine() {
        let _guard = TestGdsSecretsGuard::new();
        // Deux « projets » distincts : l'identifiant ne dépend d'aucun d'eux (la
        // fonction ne reçoit aucun chemin de projet). On prouve en plus qu'ouvrir
        // la config GDS d'un projet ne touche pas l'identifiant de machine.
        let dir_a = std::env::temp_dir().join(format!("pilot-4a-a-{}", std::process::id()));
        let dir_b = std::env::temp_dir().join(format!("pilot-4a-b-{}", std::process::id()));
        for d in [&dir_a, &dir_b] {
            let cfg = gds_core::config::GdsConfig {
                enabled: true,
                db_host: "127.0.0.1".to_string(),
                db_port: String::new(),
                db_user: String::new(),
                identity_email: "dev@example.org".to_string(),
                server_url: String::new(),
                gds_local_dir: None,
                ssh_port: 0,
                gds_server_repos: None,
                ssh_host: String::new(),
            };
            gds::write_gds_config(&d.to_string_lossy(), &cfg).expect("gds.json du projet");
        }
        let from_a = gds::poste_id().expect("poste_id");
        let _ = gds::read_gds_config(&dir_a.to_string_lossy()).expect("lecture A");
        let from_b = gds::poste_id().expect("poste_id");
        let _ = gds::read_gds_config(&dir_b.to_string_lossy()).expect("lecture B");
        let from_b_again = gds::poste_id().expect("poste_id");
        assert_eq!(from_a, from_b);
        assert_eq!(from_a, from_b_again);
        let _ = std::fs::remove_dir_all(&dir_a);
        let _ = std::fs::remove_dir_all(&dir_b);
    }

    #[test]
    fn poste_id_from_keeps_an_existing_value_and_only_writes_when_created() {
        let mut secrets = gds::GdsSecrets::default();
        let (created, w1) = gds::poste_id_from(&mut secrets, || "uuid-genere".to_string());
        assert_eq!(created, "uuid-genere");
        assert!(w1, "un identifiant créé doit être enregistré");
        // Une valeur déjà mémorisée est reprise TELLE QUELLE (rognée) : aucun
        // appel au générateur, aucune écriture.
        let (kept, w2) = gds::poste_id_from(&mut secrets, || {
            panic!("le générateur ne doit pas être appelé sur un identifiant mémorisé")
        });
        assert_eq!(kept, "uuid-genere");
        assert!(!w2);
        secrets.poste_id = "  deja-la  ".to_string();
        let (trimmed, w3) = gds::poste_id_from(&mut secrets, || "autre".to_string());
        assert_eq!(trimmed, "deja-la");
        assert!(!w3);
    }

    // ── Formes des requêtes : conformes à ce que le serveur attend ──

    #[test]
    fn portage_body_matches_server_shape() {
        // `HandoverPortageBody` côté serveur : { project_id: i64, poste_id: String }.
        let body = portage_body(42, "  b3f1c9d2-0000-4000-8000-000000000000  ");
        assert_eq!(body["project_id"], json!(42));
        assert_eq!(body["poste_id"], json!("b3f1c9d2-0000-4000-8000-000000000000"));
        let obj = body.as_object().expect("objet JSON");
        assert_eq!(obj.len(), 2, "aucun champ inventé : {:?}", obj.keys());
    }

    #[test]
    fn force_body_carries_project_and_trimmed_reason() {
        let body = force_body(7, "  maintenance  ");
        assert_eq!(body["project_id"], json!(7));
        assert_eq!(body["reason"], json!("maintenance"));
        assert_eq!(body.as_object().expect("objet").len(), 2);
    }

    #[test]
    fn state_path_uses_the_query_parameter_the_route_expects() {
        // `HandoverStateQuery` côté serveur : project_id en paramètre de requête.
        assert_eq!(state_path(42), "/api/gds/handover/state?project_id=42");
        assert_eq!(TAKE_PATH, "/api/gds/handover/take");
        assert_eq!(HEARTBEAT_PATH, "/api/gds/handover/heartbeat");
        assert_eq!(RETURN_PATH, "/api/gds/handover/return");
        assert_eq!(FORCE_PATH, "/api/gds/handover/force");
    }

    // ── Refus métier ≠ erreur technique ──

    #[test]
    fn business_refusals_are_recognised_as_refusals() {
        for status in [400u16, 403, 404, 409] {
            assert!(is_business_refusal(status), "{} est un refus métier", status);
            assert!(
                matches!(
                    classify_reply(status, "{}"),
                    HandoverReply::Refused { status: s, .. } if s == status
                ),
                "{} ne doit jamais devenir une erreur technique",
                status
            );
        }
        assert!(!is_business_refusal(401));
        assert!(!is_business_refusal(500));
        assert!(!is_business_refusal(200));
    }

    #[test]
    fn refusal_409_keeps_the_server_message_and_the_holder() {
        // Corps EXACT de `POST /handover/take` en refus (gds-core/src/http.rs).
        let body = json!({
            "error": "Projet déjà tenu par un autre poste",
            "project_id": 12,
            "holder": { "user_id": 3, "poste_id": "autre-poste" },
            "until": "2026-10-25T10:00:00Z",
        })
        .to_string();
        let reply = classify_reply(409, &body);
        match &reply {
            HandoverReply::Refused {
                status,
                message,
                body,
            } => {
                assert_eq!(*status, 409);
                assert_eq!(message, "Projet déjà tenu par un autre poste");
                assert_eq!(body["holder"]["poste_id"], json!("autre-poste"));
            }
            other => panic!("un 409 doit être un refus, pas {:?}", other),
        }
        let value = handover_value("take", "mon-poste", reply).expect("un refus n'est pas une Err");
        assert_eq!(value["ok"], json!(false));
        assert_eq!(value["refused"], json!(true));
        assert_eq!(value["status"], json!(409));
        assert_eq!(value["error"], json!("Projet déjà tenu par un autre poste"));
        assert_eq!(value["holder"]["poste_id"], json!("autre-poste"));
        assert_eq!(value["until"], json!("2026-10-25T10:00:00Z"));
        assert_eq!(value["project_id"], json!(12));
        assert_eq!(value["poste_id"], json!("mon-poste"));
    }

    #[test]
    fn refusal_403_and_404_are_readable_and_never_technical() {
        let value = handover_value(
            "return",
            "p1",
            classify_reply(403, r#"{"error":"Compte GDS requis pour le portage d'un projet"}"#),
        )
        .expect("refus lisible");
        assert_eq!(value["refused"], json!(true));
        assert_eq!(value["status"], json!(403));
        assert_eq!(
            value["error"],
            json!("Compte GDS requis pour le portage d'un projet")
        );

        let value = handover_value(
            "take",
            "p1",
            classify_reply(404, r#"{"error":"Projet introuvable: 12"}"#),
        )
        .expect("refus lisible");
        assert_eq!(value["refused"], json!(true));
        assert_eq!(value["error"], json!("Projet introuvable: 12"));
    }

    #[test]
    fn refusal_without_error_field_falls_back_to_a_generic_libelle() {
        let reply = classify_reply(409, "");
        match reply {
            HandoverReply::Refused { message, .. } => {
                assert_eq!(message, "Opération refusée par le serveur GDS")
            }
            other => panic!("409 attendu, reçu {:?}", other),
        }
        let reply = classify_reply(403, "pas du json");
        match reply {
            HandoverReply::Refused { message, .. } => {
                assert_eq!(message, "Accès réservé à l'administrateur")
            }
            other => panic!("403 attendu, reçu {:?}", other),
        }
    }

    #[test]
    fn technical_failures_stay_errors() {
        assert!(matches!(
            classify_reply(500, r#"{"error":"base injoignable"}"#),
            HandoverReply::Failed(_)
        ));
        assert!(matches!(
            classify_reply(401, "{}"),
            HandoverReply::Failed(_)
        ));
        let err = handover_value("state", "p1", classify_reply(500, "boom"))
            .expect_err("une panne technique doit remonter une erreur");
        assert!(err.contains("Portage — state"), "message lisible : {}", err);
    }

    #[test]
    fn accepted_reply_keeps_server_fields_and_adds_context() {
        // Corps EXACT de `POST /handover/take` en succès.
        let body = json!({
            "ok": true,
            "action": "renew",
            "state": { "project_id": 12, "open_row_id": 5, "holder": { "user_id": 3, "poste_id": "p1" } }
        })
        .to_string();
        let value = handover_value("take", "p1", classify_reply(200, &body)).expect("succès");
        assert_eq!(value["ok"], json!(true));
        assert_eq!(value["action"], json!("renew"));
        assert_eq!(value["handover"], json!("take"));
        assert_eq!(value["poste_id"], json!("p1"));
        assert_eq!(value["state"]["open_row_id"], json!(5));
        // Un corps vide/inattendu reste un succès lisible, jamais une panique.
        let empty = accepted_value("state", "p1", Value::Null);
        assert_eq!(empty["ok"], json!(true));
        assert_eq!(empty["handover"], json!("state"));
    }

    // ── Résolution de l'identifiant serveur du projet (liste des projets) ──

    #[test]
    fn project_id_is_found_by_name_then_by_repo_name() {
        // Forme renvoyée par `GET /api/gds/projects` (gds_core::db::list_projects).
        let listing = json!({
            "projects": [
                { "id": 3, "name": "alpha", "repo_name": "alpha", "status": "active" },
                { "id": 9, "name": "Beta-projet", "repo_name": "beta.git", "status": "active" }
            ]
        });
        assert_eq!(project_id_from_listing(&listing, "alpha"), Some(3));
        assert_eq!(project_id_from_listing(&listing, "  alpha  "), Some(3));
        // Casse différente (dossier Windows) : retrouvé quand même.
        assert_eq!(project_id_from_listing(&listing, "beta-PROJET"), Some(9));
        // Par `repo_name` quand le nom lisible diffère.
        let repo_only = json!({ "projects": [ { "id": 11, "name": "autre", "repo_name": "monrepo" } ] });
        assert_eq!(project_id_from_listing(&repo_only, "monrepo"), Some(11));
        // Absent, vide, ou forme inattendue : None (jamais un id deviné).
        assert_eq!(project_id_from_listing(&listing, "inconnu"), None);
        assert_eq!(project_id_from_listing(&listing, "   "), None);
        assert_eq!(project_id_from_listing(&json!({}), "alpha"), None);
        assert_eq!(project_id_from_listing(&json!({ "projects": [] }), "alpha"), None);
    }
}
