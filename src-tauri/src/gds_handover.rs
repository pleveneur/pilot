// gds_handover.rs — PORTAGE d'un projet, côté POSTE (mode réseau multi-postes,
// ÉTAPES 4a et 4b).
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
// Portée : le poste sait prendre en main, consulter l'état, envoyer sa présence,
// restituer un projet DANS L'ORDRE (code → avancement → return) et refuser les
// écritures d'un poste qui ne tient pas le projet. Aucune interface ici : les
// commandes sont posées, l'écran de l'étape 5 les branche.
//
// Aucun secret ne sort de ce module : ni mot de passe, ni jeton dans les
// messages d'erreur ou les valeurs renvoyées à l'interface.

use crate::gds;
use crate::gds_admin::admin_error_message;
use crate::gds_service::{self, ServiceIdentity};
use crate::gds_sync;
use gds_core::config::project_name;
use serde_json::{json, Value};
use sqlx::PgPool;
use tauri::{Manager, State};

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
///
/// Étape 4b : une prise en main ACCEPTÉE mémorise le repère de présence (même
/// table de synchro que le watermark du suivi). Un refus (409 projet tenu par un
/// autre poste, 403, 404, 400) efface le repère devenu faux : la présence
/// automatique ne partira pas pour un projet que ce poste ne tient pas. Le
/// résultat porte `presence: recorded|not_recorded` — jamais une perte
/// silencieuse : sans repère, aucun battement ne partirait.
pub(crate) async fn take(project: &str) -> Result<Value, String> {
    let (ident, poste_id, project_id) = resolve(project).await?;
    let reply = gds_service::post_reply(
        &ident,
        TAKE_PATH,
        portage_body(project_id, &poste_id),
    )
    .await?;
    let value = handover_value("take", &poste_id, classify_reply(reply.status, reply.body()))?;
    let recorded = if value.get("ok").and_then(|v| v.as_bool()) == Some(true) {
        remember_holder(project, &poste_id, project_id, &value)
    } else {
        // Refus lisible : ce poste ne tient pas le projet → plus de présence.
        let _ = gds_sync::write_sync_marker(&presence_marker_key(project), "");
        false
    };
    Ok(with_presence_flag(value, recorded))
}

/// `GET /api/gds/handover/state` : qui tient le projet, jusqu'à quand, expiré
/// ou non. **Lecteur seul** : rien n'est écrit côté serveur.
pub(crate) async fn state_of(project: &str) -> Result<Value, String> {
    let (ident, poste_id, project_id) = resolve(project).await?;
    let reply = gds_service::get_reply(&ident, &state_path(project_id)).await?;
    handover_value("state", &poste_id, classify_reply(reply.status, reply.body()))
}

/// `POST /api/gds/handover/return` : restitution volontaire par le porteur.
///
/// Appel **direct**, sans séquence. La restitution réelle passe par
/// `restitution()` (étape 4b), qui publie le code puis l'avancement AVANT de
/// rendre le projet ; ce point d'entrée reste pour une reprise ciblée.
#[allow(dead_code)]
pub(crate) async fn give_back(project: &str) -> Result<Value, String> {
    let (ident, poste_id, project_id) = resolve(project).await?;
    give_back_with(&ident, &poste_id, project_id).await
}

/// Restitution brute d'un projet (contexte déjà résolu) : une appelée, une
/// réponse classée. Aucun autre appel réseau n'est fait ici.
pub(crate) async fn give_back_with(
    ident: &ServiceIdentity,
    poste_id: &str,
    project_id: i64,
) -> Result<Value, String> {
    let reply = gds_service::post_reply(
        ident,
        RETURN_PATH,
        portage_body(project_id, poste_id),
    )
    .await?;
    handover_value("return", poste_id, classify_reply(reply.status, reply.body()))
}

/// `POST /api/gds/handover/heartbeat` : présence du porteur (un appel par cycle
/// de 3 minutes). La présence automatique passe par `heartbeat_with_ids` avec
/// l'identifiant serveur déjà mémorisé : **un seul appel par cycle**.
#[allow(dead_code)]
pub(crate) async fn heartbeat(project: &str) -> Result<Value, String> {
    let (ident, poste_id, project_id) = resolve(project).await?;
    let reply = heartbeat_reply(&ident, project_id, &poste_id).await?;
    handover_value(
        "heartbeat",
        &poste_id,
        classify_reply(reply.status, reply.body()),
    )
}

/// Présence brute (un seul appel réseau, contexte déjà résolu).
pub(crate) async fn heartbeat_reply(
    ident: &ServiceIdentity,
    project_id: i64,
    poste_id: &str,
) -> Result<crate::gds_admin::Reply, String> {
    gds_service::post_reply(
        ident,
        HEARTBEAT_PATH,
        portage_body(project_id, poste_id),
    )
    .await
}

/// Résout en UNE passe le compte GDS, l'identifiant de machine et l'identifiant
/// serveur du projet : les opérations qui enchaînent plusieurs appels (présence,
/// restitution, garde d'écriture) ne résolvent pas deux fois la même chose.
async fn resolve(project: &str) -> Result<(ServiceIdentity, String, i64), String> {
    let (ident, poste_id) = handover_context(project)?;
    let project_id = server_project_id(&ident, project).await?;
    Ok((ident, poste_id, project_id))
}

/// `POST /api/gds/handover/force` : libération forcée, **réservée au rôle
/// `admin`** par le serveur (`require_admin` sur la route) — le poste ne
/// re-décide pas le rôle, il traduit le refus (403) et le motif vide (409) comme
/// les autres refus métier.
///
/// ÉTAPE 5 : la route est désormais ATTEIGNABLE depuis un poste par la commande
/// `gds_handover_force` (`gds_admin`), qui ouvre une session d'administration (un
/// compte `dev` ou `standard` y est refusé par le serveur) et envoie cette charge
/// utile. Le motif est obligatoire, contrôlé AVANT l'appel (`force_payload`) : on
/// n'envoie pas au serveur une demande qu'il refusera.
///
/// Construit la charge utile de la libération forcée. **PURE.**
///
/// `project_id` doit être strictement positif (valeur rendue par le serveur) et
/// le motif ne peut pas être vide : le serveur répondrait 409, on refuse avant.
pub(crate) fn force_payload(project_id: i64, reason: &str) -> Result<Value, String> {
    if project_id <= 0 {
        return Err("Projet invalide".to_string());
    }
    if reason.trim().is_empty() {
        return Err(
            "Le motif de la libération est obligatoire : dites pourquoi vous libérez ce \
             projet."
                .to_string(),
        );
    }
    Ok(force_body(project_id, reason))
}

/// Clé du repère local de la libération forcée, dans la table de synchro
/// EXISTANTE (`gds_sync_state`) : une ligne par projet, la dernière tentative.
pub(crate) fn force_trace_key(project_id: i64) -> String {
    format!("handover.force.{}", project_id)
}

/// Ligne TRACÉE d'une libération forcée : elle nomme le poste qui a déclenché le
/// geste, le projet, le compte administrateur et le motif, et dit si la
/// libération a abouti. Jamais un geste anonyme. **PURE.**
///
/// Un seul séparateur `|` est utilisé entre les champs, et il est retiré des
/// textes libres (motif, compte) pour que la ligne reste relisible et
/// analysable même si quelqu'un tape un `|` dans le motif.
pub(crate) fn force_trace_line(
    poste_id: &str,
    project_id: i64,
    admin: &str,
    reason: &str,
    applied: bool,
    at_epoch: u64,
) -> String {
    let propre = |s: &str, defaut: &str| {
        let t = s.trim().replace('|', "/");
        if t.is_empty() {
            defaut.to_string()
        } else {
            t
        }
    };
    format!(
        "{} | poste={} | projet={} | compte={} | resultat={} | motif={}",
        at_epoch,
        propre(poste_id, "poste inconnu"),
        project_id,
        propre(admin, "compte inconnu"),
        if applied { "liberee" } else { "refusee" },
        propre(reason, "(motif vide)")
    )
}

/// Écrit la ligne de trace locale (best-effort : une trace qu'on ne peut pas
/// écrire ne fait JAMAIS échouer l'action — mais elle est rendue à l'écran dans
/// le champ `trace` de la réponse, donc jamais perdue en silence).
pub(crate) fn trace_force_release(project_id: i64, line: &str) -> Result<(), String> {
    gds_sync::write_sync_marker(&force_trace_key(project_id), line)
}

// ─────────────────────────────────────────────────────────────────────────────
// ÉTAPE 4b (1) — PRÉSENCE AUTOMATIQUE : un seul appel par cycle, et seulement
// pour un projet que CE poste tient
//
// Le plan (§3 réglage 1, §6 b) demande une présence toutes les 3 minutes, un
// seul appel par cycle, et JAMAIS d'appel pour un projet que ce poste ne tient
// pas. Le poste retient donc localement ce qu'il a obtenu (`take` accepté) dans
// la table de synchro EXISTANTE (`gds_sync_state`, via `read_sync_marker` /
// `write_sync_marker`) : c'est ce repère qui décide, sans appel réseau, si un
// battement doit partir. Le serveur reste seul juge de la règle — un refus
// métier (409) efface le repère : la présence s'arrête proprement.
// ─────────────────────────────────────────────────────────────────────────────

/// Cadence de la présence (plan §3 réglage 1) : un cycle toutes les 3 minutes.
pub(crate) const HEARTBEAT_INTERVAL_SECS: u64 = 180;

/// Préfixe du repère local « ce poste tient ce projet » (`gds_sync_state`).
pub(crate) const PRESENCE_MARKER_PREFIX: &str = "handover.holder.";

/// Repère du dernier échec de présence, lisible par l'interface (même table) :
/// un échec réseau ne boucle pas et ne se perd pas, il est SIGNALÉ.
pub(crate) const PRESENCE_ERROR_KEY: &str = "handover.presence.last_error";

/// Clé du repère de présence d'un projet (chemin de projet = la clé).
pub(crate) fn presence_marker_key(project: &str) -> String {
    format!("{}{}", PRESENCE_MARKER_PREFIX, project.trim())
}

/// Ce que le poste a mémorisé d'une prise en main qu'il a obtenue. Ce n'est pas
/// une autorité (le serveur reste seul juge) : c'est ce qui évite un appel
/// réseau inutile quand le projet n'est pas tenu par ce poste, et ce qui porte
/// l'identifiant serveur du projet pour ne pas le re-résoudre à chaque cycle.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct HeldProject {
    pub poste_id: String,
    pub project_id: i64,
    pub until: Option<String>,
}

/// Forme disque d'un repère de présence : `poste|project_id|expires_at`. Pure.
pub(crate) fn encode_holder(h: &HeldProject) -> String {
    format!(
        "{}|{}|{}",
        h.poste_id.trim(),
        h.project_id,
        h.until.clone().unwrap_or_default()
    )
}

/// Relit un repère de présence. `None` si absent ou illisible : un repère
/// illisible ne déclenche AUCUNE présence (jamais une supposition). Pure.
pub(crate) fn parse_holder(raw: &str) -> Option<HeldProject> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    let mut parts = raw.splitn(3, '|');
    let poste_id = parts.next()?.trim().to_string();
    if poste_id.is_empty() {
        return None;
    }
    let project_id = parts.next()?.trim().parse::<i64>().ok()?;
    let until = parts
        .next()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    Some(HeldProject {
        poste_id,
        project_id,
        until,
    })
}

/// Objet `state` d'une réponse du serveur : `GET /handover/state` rend
/// `{ ok, state }`, les routes d'écriture rendent `{ ok, action, state }`. Un
/// objet `state` seul est accepté tel quel. Pure.
pub(crate) fn state_object(value: &Value) -> &Value {
    match value.get("state") {
        Some(v) if !v.is_null() => v,
        _ => value,
    }
}

/// `poste_id` du porteur selon l'état du serveur. Pure.
pub(crate) fn holder_poste_id(state: &Value) -> Option<String> {
    state
        .get("holder")
        .and_then(|h| h.get("poste_id"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Échéance de la prise en main (`expires_at`) selon l'état du serveur. Pure.
pub(crate) fn holder_until(state: &Value) -> Option<String> {
    state
        .get("expires_at")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
}

/// La prise en main est-elle expirée ? (évaluation PARESSEUSE du serveur). Pure.
pub(crate) fn holder_expired(state: &Value) -> bool {
    state
        .get("expired")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

/// Mémorise la prise en main obtenue. `false` = repère non écrit (donc aucune
/// présence ne partira) — signalé à l'appelant, jamais silencieux.
fn remember_holder(project: &str, poste_id: &str, project_id: i64, value: &Value) -> bool {
    let held = HeldProject {
        poste_id: poste_id.to_string(),
        project_id,
        until: holder_until(state_object(value)),
    };
    gds_sync::write_sync_marker(&presence_marker_key(project), &encode_holder(&held)).is_ok()
}

/// Ajoute à la valeur rendue à l'interface l'état du repère de présence.
fn with_presence_flag(mut value: Value, recorded: bool) -> Value {
    if let Value::Object(map) = &mut value {
        map.insert(
            "presence".to_string(),
            json!(if recorded { "recorded" } else { "not_recorded" }),
        );
    }
    value
}

/// Projet à qui envoyer une présence pendant un cycle.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct PresenceTarget {
    pub project: String,
    pub project_id: i64,
}

/// Résultat d'un cycle de présence. Aucune erreur n'y est fatale : un échec est
/// conservé et le cycle continue (il ne boucle pas et ne perd pas l'état).
#[derive(Debug, Default, PartialEq)]
pub(crate) struct PresenceReport {
    /// Projets non tenus par ce poste : **aucun appel** n'est parti.
    pub skipped: usize,
    /// Projets dont la présence a été acceptée (et l'échéance relue).
    pub kept: Vec<(PresenceTarget, Option<String>)>,
    /// Projets dont la prise en main est PERDUE (refus métier du serveur).
    pub lost: Vec<(PresenceTarget, String)>,
    /// Projets dont l'envoi a été une panne (réseau, session, 5xx).
    pub failed: Vec<(PresenceTarget, String)>,
}

/// Effet classé d'un envoi de présence.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum PresenceOutcome {
    /// Accepté : la prise en main tient (échéance éventuellement repoussée).
    Kept(Option<String>),
    /// Refus métier : ce poste ne tient plus le projet → la présence s'arrête.
    Lost(String),
    /// Panne technique : rien n'est décidé, le cycle suivant réessaie.
    Failed(String),
}

/// Décide, sans réseau, quels projets doivent recevoir une présence :
/// uniquement ceux dont le repère dit que CE poste les tient. Rend aussi le
/// nombre de projets écartés (compteur des tests et du diagnostic). Pure.
pub(crate) fn presence_targets(
    markers: &[(String, String)],
    poste_id: &str,
) -> (Vec<PresenceTarget>, usize) {
    let mut targets = Vec::new();
    let mut skipped = 0usize;
    for (project, raw) in markers {
        match parse_holder(raw) {
            Some(h) if h.poste_id.eq_ignore_ascii_case(poste_id.trim()) => {
                targets.push(PresenceTarget {
                    project: project.clone(),
                    project_id: h.project_id,
                });
            }
            _ => skipped += 1,
        }
    }
    (targets, skipped)
}

/// Classe la réponse d'un envoi de présence : accepté / perdu / panne. Aucun
/// code de statut nouveau n'est introduit — `classify_reply` décide (400/403/404/
/// 409 = refus métier → perdu ; 401/5xx/réseau = panne). Pure.
pub(crate) fn classify_presence(reply: HandoverReply) -> PresenceOutcome {
    match reply {
        HandoverReply::Accepted(body) => PresenceOutcome::Kept(holder_until(state_object(&body))),
        HandoverReply::Refused { message, .. } => PresenceOutcome::Lost(message),
        HandoverReply::Failed(message) => PresenceOutcome::Failed(message),
    }
}

/// Cœur du cycle de présence, sans réseau : pour chaque projet tenu, un seul
/// envoi (fourni par l'appelant). Une panne n'interrompt pas la boucle.
pub(crate) async fn presence_cycle_with<F, Fut>(
    markers: Vec<(String, String)>,
    poste_id: &str,
    mut send: F,
) -> PresenceReport
where
    F: FnMut(&PresenceTarget) -> Fut,
    Fut: std::future::Future<Output = Result<HandoverReply, String>>,
{
    let (targets, skipped) = presence_targets(&markers, poste_id);
    let mut report = PresenceReport {
        skipped,
        ..Default::default()
    };
    for target in targets {
        match send(&target).await {
            Ok(reply) => match classify_presence(reply) {
                PresenceOutcome::Kept(until) => report.kept.push((target, until)),
                PresenceOutcome::Lost(message) => report.lost.push((target, message)),
                PresenceOutcome::Failed(message) => report.failed.push((target, message)),
            },
            // Panne réseau : le cycle CONTINUE et l'état est conservé.
            Err(message) => report.failed.push((target, message)),
        }
    }
    report
}

/// Cycle de présence réel : un seul appel par projet tenu, aucune boucle serrée,
/// aucun appel pour un projet non tenu. Fail-open : une panne est journalisée dans
/// le repère d'erreur et rejouée au cycle suivant.
pub(crate) async fn presence_cycle(projects: &[String]) -> PresenceReport {
    let poste_id = match gds::poste_id() {
        Ok(id) => id,
        Err(e) => {
            let _ = gds_sync::write_sync_marker(PRESENCE_ERROR_KEY, &e);
            return PresenceReport {
                skipped: projects.len(),
                ..Default::default()
            };
        }
    };
    let markers: Vec<(String, String)> = projects
        .iter()
        .map(|p| {
            let raw = gds_sync::read_sync_marker(&presence_marker_key(p)).unwrap_or_default();
            (p.clone(), raw)
        })
        .collect();
    let poste_for_send = poste_id.clone();
    let report = presence_cycle_with(markers, &poste_id, |target| {
        let poste = poste_for_send.clone();
        let project = target.project.clone();
        let project_id = target.project_id;
        async move {
            let (ident, _same_poste) = handover_context(&project)?;
            let reply = heartbeat_reply(&ident, project_id, &poste).await?;
            Ok(classify_reply(reply.status, reply.body()))
        }
    })
    .await;
    apply_presence_report(&report);
    report
}

/// Applique les effets d'un cycle aux repères locaux : garde (et réactualise
/// l'échéance), efface si la prise en main est perdue, signale la panne sans
/// effacer le repère (le cycle suivant réessaie).
fn apply_presence_report(report: &PresenceReport) {
    for (target, until) in &report.kept {
        let key = presence_marker_key(&target.project);
        let raw = gds_sync::read_sync_marker(&key).unwrap_or_default();
        if let Some(mut held) = parse_holder(&raw) {
            if until.is_some() {
                held.until = until.clone();
            }
            let _ = gds_sync::write_sync_marker(&key, &encode_holder(&held));
        }
    }
    for (target, message) in &report.lost {
        let _ = gds_sync::write_sync_marker(&presence_marker_key(&target.project), "");
        let _ = gds_sync::write_sync_marker(
            PRESENCE_ERROR_KEY,
            &format!("{} : {}", target.project, message),
        );
    }
    for (target, message) in &report.failed {
        let _ = gds_sync::write_sync_marker(
            PRESENCE_ERROR_KEY,
            &format!("{} : {}", target.project, message),
        );
    }
}

/// Projets ouverts du poste (projet actif inclus), instantané de configuration.
fn open_projects_snapshot(state: &AppState) -> Vec<String> {
    let cfg = match state.config.lock() {
        Ok(c) => c.clone(),
        Err(_) => return Vec::new(),
    };
    let mut paths = cfg.open_projects.clone();
    if let Some(p) = &cfg.active_open_project {
        if !paths.contains(p) {
            paths.push(p.clone());
        }
    }
    paths
}

/// Tâche de fond : la présence automatique. Thread autonome, un cycle par
/// 3 minutes, fail-open (une panne ne bloque jamais l'interface ni ne boucle).
pub(crate) fn start_gds_handover_presence_monitor(handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(HEARTBEAT_INTERVAL_SECS)).await;
            let state = handle.state::<AppState>();
            if !crate::gds_globally_enabled(&state) {
                continue;
            }
            let projects = open_projects_snapshot(&state);
            if projects.is_empty() {
                continue;
            }
            let _ = presence_cycle(&projects).await;
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// ÉTAPE 4b (2) — RESTITUTION ORDONNÉE : code → avancement → return
//
// Le plan (§6 b) n'admet qu'un ordre : publier le code, pousser l'avancement,
// et SEULEMENT ENSUITE rendre le projet. Si une étape échoue, la restitution
// n'est pas faite : le poste reste porteur, et l'opération est rejouable (l'étape
// atteinte est mémorisée dans la table de synchro existante, jamais dans un
// second journal).
// ─────────────────────────────────────────────────────────────────────────────

/// Préfixe du repère d'avancement de la restitution (`gds_sync_state`).
pub(crate) const RESTITUTION_MARKER_PREFIX: &str = "handover.restitution.";

/// Clé du repère de restitution d'un projet.
pub(crate) fn restitution_marker_key(project: &str) -> String {
    format!("{}{}", RESTITUTION_MARKER_PREFIX, project.trim())
}

/// Les trois étapes de la restitution, dans l'ordre IMPOSÉ par le plan §6 b.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RestitutionStep {
    PublishCode,
    PushTracking,
    Return,
}

/// Ordre unique de la restitution (source unique côté poste).
pub(crate) const RESTITUTION_ORDER: [RestitutionStep; 3] = [
    RestitutionStep::PublishCode,
    RestitutionStep::PushTracking,
    RestitutionStep::Return,
];

/// Libellé d'une étape (messages lisibles, journal). Pure.
pub(crate) fn step_label(step: RestitutionStep) -> &'static str {
    match step {
        RestitutionStep::PublishCode => "publication du code",
        RestitutionStep::PushTracking => "poussée de l'avancement",
        RestitutionStep::Return => "restitution au serveur",
    }
}

/// Étapes déjà franchies lors d'une restitution (reprise sans perte).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct RestitutionProgress {
    pub code: bool,
    pub tracking: bool,
    pub returned: bool,
}

/// Relit l'avancement d'une restitution. Illisible = rien de fait (on rejoue
/// l'ordre complet, jamais un saut d'étape). Pure.
pub(crate) fn parse_restitution_progress(raw: &str) -> RestitutionProgress {
    let mut p = RestitutionProgress::default();
    for part in raw.trim().split(';') {
        match part.trim() {
            "code=1" => p.code = true,
            "tracking=1" => p.tracking = true,
            "returned=1" => p.returned = true,
            _ => {}
        }
    }
    p
}

/// Forme disque de l'avancement d'une restitution. Pure.
pub(crate) fn restitution_progress_line(p: &RestitutionProgress) -> String {
    format!(
        "code={};tracking={};returned={}",
        u8::from(p.code),
        u8::from(p.tracking),
        u8::from(p.returned)
    )
}

/// Marque une étape franchie. Pure.
pub(crate) fn mark_step_done(p: &RestitutionProgress, step: RestitutionStep) -> RestitutionProgress {
    let mut next = *p;
    match step {
        RestitutionStep::PublishCode => next.code = true,
        RestitutionStep::PushTracking => next.tracking = true,
        RestitutionStep::Return => next.returned = true,
    }
    next
}

/// Étapes restant à faire, TOUJOURS dans l'ordre imposé (une étape n'est jamais
/// proposée avant celles qui la précèdent). Pure.
pub(crate) fn steps_to_run(p: &RestitutionProgress) -> Vec<RestitutionStep> {
    RESTITUTION_ORDER
        .iter()
        .copied()
        .filter(|step| match step {
            RestitutionStep::PublishCode => !p.code,
            RestitutionStep::PushTracking => !p.tracking,
            RestitutionStep::Return => !p.returned,
        })
        .collect()
}

/// Exécute les étapes restantes dans l'ordre, et s'arrête à la PREMIÈRE qui
/// échoue : l'étape en échec n'est pas marquée faite, `returned` reste faux, et
/// rien de ce qui suit n'est tenté. Rend l'avancement réel + l'échec éventuel.
pub(crate) async fn run_restitution_steps<F, Fut>(
    progress: RestitutionProgress,
    mut run: F,
) -> (RestitutionProgress, Option<(RestitutionStep, String)>)
where
    F: FnMut(RestitutionStep) -> Fut,
    Fut: std::future::Future<Output = Result<(), String>>,
{
    let mut progress = progress;
    for step in steps_to_run(&progress) {
        match run(step).await {
            Ok(()) => progress = mark_step_done(&progress, step),
            Err(error) => return (progress, Some((step, error))),
        }
    }
    (progress, None)
}

/// Publie le code du projet sur le GDS : `git add` + `git commit` + `git push`
/// sur le remote dédié `gds` (helpers git existants, aucune nouvelle mécanique).
/// Un dépôt déjà propre n'est pas une erreur (rien à committer → on pousse).
fn publish_code(project: &str) -> Result<(), String> {
    crate::git::git_add_all(project)?;
    crate::git::git_commit(project, "Pilot — restitution du portage")?;
    let branch = crate::git::git_current_branch(project);
    if branch.trim().is_empty() || branch.trim() == "HEAD" {
        return Err("branche git courante introuvable".to_string());
    }
    crate::git::git_push(project, crate::gds_client::GDS_REMOTE, branch.trim())
}

/// Pousse l'avancement (suivi du projet) par la fonction EXISTANTE du pont GDS.
/// Le serveur doit avoir confirmé (`ok:true`) : sinon l'étape est un échec.
async fn push_tracking(pool: Option<&PgPool>, project: &str) -> Result<(), String> {
    let value = gds_sync::force_push_tracking(pool, project).await?;
    if value.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        return Err("le serveur n'a pas confirmé la poussée de l'avancement".to_string());
    }
    Ok(())
}

/// Restitution complète, dans l'ordre : code → avancement → return.
/// Une étape en échec arrête tout, l'avancement reste lisible et rejouable, le
/// poste reste porteur (le repère de présence n'est PAS effacé).
pub(crate) async fn restitution(pool: Option<PgPool>, project: &str) -> Result<Value, String> {
    let (ident, poste_id, project_id) = resolve(project).await?;
    let key = restitution_marker_key(project);
    let mut progress =
        parse_restitution_progress(&gds_sync::read_sync_marker(&key).unwrap_or_default());
    if progress.returned {
        // Restitution déjà aboutie : le geste volontaire la rejoue de zéro.
        progress = RestitutionProgress::default();
    }
    let planned = steps_to_run(&progress);
    let ident_for_step = ident.clone();
    let poste_for_step = poste_id.clone();
    let project_for_step = project.to_string();
    let mut run = move |step: RestitutionStep| {
        let ident = ident_for_step.clone();
        let poste = poste_for_step.clone();
        let project = project_for_step.clone();
        let pool = pool.clone();
        async move {
            match step {
                RestitutionStep::PublishCode => publish_code(&project),
                RestitutionStep::PushTracking => push_tracking(pool.as_ref(), &project).await,
                RestitutionStep::Return => {
                    let value = give_back_with(&ident, &poste, project_id).await?;
                    // Un refus métier du serveur n'est PAS une restitution faite.
                    if value.get("ok").and_then(|v| v.as_bool()) != Some(true) {
                        return Err(value
                            .get("error")
                            .and_then(|v| v.as_str())
                            .unwrap_or("restitution refusée par le serveur")
                            .to_string());
                    }
                    Ok(())
                }
            }
        }
    };
    let (after, failure) = run_restitution_steps(progress, &mut run).await;
    // L'avancement réel est TOUJOURS persisté (aucune perte silencieuse).
    let _ = gds_sync::write_sync_marker(&key, &restitution_progress_line(&after));
    match failure {
        Some((step, error)) => {
            let _ = gds_sync::write_sync_marker(
                PRESENCE_ERROR_KEY,
                &format!("restitution {} : {}", project, error),
            );
            Err(format!(
                "Restitution interrompue à l'étape « {} » : {}. Le projet reste tenu par ce poste, \
                 rien n'est perdu : l'opération est rejouable.",
                step_label(step),
                error
            ))
        }
        None => {
            // Restitution faite : la présence automatique s'arrête proprement.
            let _ = gds_sync::write_sync_marker(&presence_marker_key(project), "");
            Ok(json!({
                "ok": true,
                "handover": "restitution",
                "poste_id": poste_id,
                "project_id": project_id,
                "steps": planned.iter().map(|s| step_label(*s)).collect::<Vec<_>>(),
                "progress": restitution_progress_line(&after),
            }))
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ÉTAPE 4b (3) — ÉCRITURES REFUSÉES HORS PORTAGE
//
// Un projet tenu par un autre poste s'ouvre en LECTURE SEULE (plan §1, §6 d) :
// aucune écriture n'est appliquée. Le verdict est calculé à partir de l'état du
// serveur (`GET /handover/state`) — le serveur reste seul juge — et le refus est
// LISIBLE : jamais un plantage, jamais un conflit silencieux entre deux postes.
// ─────────────────────────────────────────────────────────────────────────────

/// Ce que l'état de portage autorise pour une écriture depuis ce poste.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum WriteVerdict {
    Allowed,
    Refused(String),
}

/// Verdict d'écriture à partir de l'état du serveur. Pure — c'est elle qui
/// garantit qu'un refus porte toujours un message lisible :
/// - aucun porteur → il faut prendre le projet en main ;
/// - porteur = un AUTRE poste → lecture seule, avec le porteur et l'échéance ;
/// - prise en main expirée → il faut la reprendre.
pub(crate) fn write_verdict(value: &Value, poste_id: &str) -> WriteVerdict {
    let state = state_object(value);
    match holder_poste_id(state) {
        None => WriteVerdict::Refused(
            "Écriture refusée : ce projet n'est tenu par aucun poste. Prenez-le en main \
             (« Prendre le projet ») avant de le modifier."
                .to_string(),
        ),
        Some(holder) if !holder.eq_ignore_ascii_case(poste_id.trim()) => {
            let until = holder_until(state)
                .map(|u| format!(", jusqu'à {}", u))
                .unwrap_or_default();
            WriteVerdict::Refused(format!(
                "Écriture refusée : projet tenu par un autre poste{} — ce poste est en lecture \
                 seule, aucune modification n'est publiée.",
                until
            ))
        }
        Some(_) if holder_expired(state) => WriteVerdict::Refused(
            "Écriture refusée : la prise en main de ce projet a expiré. Reprenez le projet en \
             main avant de le modifier."
                .to_string(),
        ),
        Some(_) => WriteVerdict::Allowed,
    }
}

/// Ce poste doit-il PRENDRE la main avant d'écrire (projet libre, ou prise en
/// main de ce poste déjà expirée) ? Pure. Un projet tenu par un AUTRE poste n'est
/// jamais réclamé : il est refusé.
pub(crate) fn needs_claim(value: &Value, poste_id: &str) -> bool {
    let state = state_object(value);
    match holder_poste_id(state) {
        None => true,
        Some(holder) if holder.eq_ignore_ascii_case(poste_id.trim()) => holder_expired(state),
        Some(_) => false,
    }
}

/// Interroge le serveur et rend le verdict d'écriture, sous forme de valeur
/// lisible (`{ ok:true, allowed:true }` ou `{ ok:false, refused:true, error }`).
///
/// Un projet LIBRE (aucun porteur) ou dont la prise en main de ce poste a expiré
/// n'est pas écrit « hors portage » : ce poste **prend la main une fois** (le
/// `take` est idempotent, il ne vole rien — un refus 409 signifie qu'un autre
/// poste l'a pris et devient un refus lisible). C'est le « moment de la prise en
/// main » du plan (§6 b) au premier écrit, en attendant que l'étape d'interface
/// le branche à l'ouverture du projet.
///
/// Une panne technique remonte une erreur (et l'écriture est refusée : on
/// n'écrit jamais sans avoir pu vérifier le portage).
/// Message (lisible) du cas « le projet est libre ou la prise en main de ce poste
/// a expiré » : le chemin d'écriture prend la main, le chemin de LECTURE dit
/// qu'il faut la prendre. Une seule formulation, jamais dupliquée.
pub(crate) const CLAIM_REQUIRED_MESSAGE: &str =
    "Projet libre (ou prise en main expirée) : prenez le projet en main pour publier.";

/// Garde d'écriture **générale** : `claim = true` (chemin d'écriture réel) prend
/// la main une seule fois si le projet est libre, `claim = false` ne fait que
/// LIRE l'état (bandeau de l'interface, aucun appel qui écrit).
async fn gate(project: &str, claim: bool) -> Result<Value, String> {
    let (ident, poste_id, project_id) = resolve(project).await?;
    let reply = gds_service::get_reply(&ident, &state_path(project_id)).await?;
    let mut classified = classify_reply(reply.status, reply.body());
    // Prise en main d'un projet libre (ou renouvellement d'une prise expirée).
    if matches!(&classified, HandoverReply::Accepted(body) if needs_claim(body, &poste_id)) {
        if !claim {
            // Lecture seule : on ne prend pas la main, on dit qu'elle est à
            // prendre. Aucune écriture, même indirecte.
            if let HandoverReply::Accepted(body) = &classified {
                return Ok(json!({
                    "ok": true,
                    "allowed": false,
                    "claim_required": true,
                    "poste_id": poste_id,
                    "message": CLAIM_REQUIRED_MESSAGE,
                    "state": state_object(body).clone(),
                }));
            }
        }
        let taken = gds_service::post_reply(
            &ident,
            TAKE_PATH,
            portage_body(project_id, &poste_id),
        )
        .await?;
        let value = handover_value("take", &poste_id, classify_reply(taken.status, taken.body()))?;
        if value.get("ok").and_then(|v| v.as_bool()) != Some(true) {
            // Un autre poste a pris la main entre-temps : refus lisible, jamais
            // un écrasement silencieux.
            let mut out = value;
            if let Value::Object(map) = &mut out {
                map.insert("handover".to_string(), json!("write"));
                map.insert("allowed".to_string(), json!(false));
            }
            return Ok(out);
        }
        remember_holder(project, &poste_id, project_id, &value);
        classified = HandoverReply::Accepted(value);
    }
    match classified {
        HandoverReply::Accepted(body) => match write_verdict(&body, &poste_id) {
            WriteVerdict::Allowed => Ok(json!({
                "ok": true,
                "allowed": true,
                "claim_required": false,
                "poste_id": poste_id,
                "state": state_object(&body).clone(),
            })),
            WriteVerdict::Refused(message) => Ok(json!({
                "ok": false,
                "refused": true,
                "allowed": false,
                "claim_required": false,
                "handover": "write",
                "error": message,
                "poste_id": poste_id,
                "state": state_object(&body).clone(),
            })),
        },
        HandoverReply::Refused {
            status,
            message,
            body,
        } => {
            let mut out = refused_value("write", &poste_id, status, &message, &body);
            if let Value::Object(map) = &mut out {
                map.insert("allowed".to_string(), json!(false));
            }
            Ok(out)
        }
        HandoverReply::Failed(message) => Err(format!(
            "Portage — écriture refusée : la vérification du portage est impossible ({})",
            message
        )),
    }
}

/// Garde d'écriture réelle : prend la main si le projet est libre, puis autorise
/// ou refuse. C'est elle qu'utilisent les commandes qui écrivent.
pub(crate) async fn write_gate(project: &str) -> Result<Value, String> {
    gate(project, true).await
}

/// Verdict d'écriture **en lecture seule** (aucune écriture, même indirecte) :
/// sert au bandeau de l'interface. `claim_required:true` = ce poste pourra
/// écrire après avoir pris le projet en main.
pub(crate) async fn peek_write_gate(project: &str) -> Result<Value, String> {
    gate(project, false).await
}

/// Garde d'écriture utilisable par les commandes qui publient un projet :
/// `Ok(())` seulement si CE poste tient le projet, sinon une erreur LISIBLE.
pub(crate) async fn ensure_write_allowed(project: &str) -> Result<(), String> {
    let value = write_gate(project).await?;
    if value.get("allowed").and_then(|v| v.as_bool()) == Some(true) {
        return Ok(());
    }
    Err(value
        .get("error")
        .and_then(|v| v.as_str())
        .unwrap_or("Écriture refusée : ce poste ne tient pas le projet")
        .to_string())
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

/// Commande : restituer le projet, DANS L'ORDRE (code → avancement → return).
/// Si une étape échoue, rien n'est annoncé comme réussi et l'opération est
/// rejouable (le poste reste porteur).
#[tauri::command]
pub async fn gds_handover_return(
    state: State<'_, AppState>,
    project: String,
) -> Result<Value, String> {
    if !crate::gds_globally_enabled(&state) {
        return Err("GDS désactivé globalement (Paramètres → GDS)".to_string());
    }
    let pool = gds::optional_pool(&state, &project, None).await;
    restitution(pool, &project).await
}

/// Commande : ce poste peut-il écrire sur ce projet ? **Lecture seule**, sans
/// aucune écriture même indirecte (la prise de main n'est PAS faite ici). Rend
/// `{ allowed:true }`, `{ allowed:false, claim_required:true }` (projet libre ou
/// prise expirée : prendre le projet en main) ou un refus lisible
/// `{ ok:false, refused:true, error }`. L'interface de l'étape 5 s'en sert pour
/// le bandeau et la lecture seule ; les commandes qui écrivent utilisent la même
/// règle via `ensure_write_allowed` (qui, elle, peut prendre la main).
#[tauri::command]
pub async fn gds_handover_can_write(
    state: State<'_, AppState>,
    project: String,
) -> Result<Value, String> {
    if !crate::gds_globally_enabled(&state) {
        return Err("GDS désactivé globalement (Paramètres → GDS)".to_string());
    }
    peek_write_gate(&project).await
}

/// Commande : jouer UN cycle de présence maintenant (diagnostic et départ
/// immédiat après une prise en main). Rend le rapport du cycle, jamais une
/// erreur : un échec est un état, pas un plantage.
#[tauri::command]
pub async fn gds_handover_presence_now(state: State<'_, AppState>) -> Result<Value, String> {
    if !crate::gds_globally_enabled(&state) {
        return Err("GDS désactivé globalement (Paramètres → GDS)".to_string());
    }
    let projects = open_projects_snapshot(&state);
    let report = presence_cycle(&projects).await;
    Ok(json!({
        "ok": true,
        "skipped": report.skipped,
        "kept": report.kept.iter().map(|(t, _)| t.project.clone()).collect::<Vec<_>>(),
        "lost": report.lost.iter().map(|(t, m)| json!({ "project": t.project, "error": m })).collect::<Vec<_>>(),
        "failed": report.failed.iter().map(|(t, m)| json!({ "project": t.project, "error": m })).collect::<Vec<_>>(),
    }))
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

    // ─────────────────────────────────────────────────────────────────────────
    // ÉTAPE 4b (1) — PRÉSENCE AUTOMATIQUE
    // ─────────────────────────────────────────────────────────────────────────

    fn held(poste: &str, project_id: i64) -> String {
        encode_holder(&HeldProject {
            poste_id: poste.to_string(),
            project_id,
            until: Some("2026-01-01T00:03:00Z".to_string()),
        })
    }

    /// Ce poste tient-il le projet d'après le repère local ? (le serveur reste
    /// seul juge de la prise en main). Vérifié via la décision de présence.
    fn held_by(raw: &str, poste_id: &str) -> bool {
        let (targets, _skipped) =
            presence_targets(&[("C:/p/x".to_string(), raw.to_string())], poste_id);
        targets.len() == 1
    }

    #[test]
    fn presence_marker_roundtrips_and_is_never_guessed() {
        let raw = held("poste-A", 12);
        assert_eq!(
            parse_holder(&raw),
            Some(HeldProject {
                poste_id: "poste-A".to_string(),
                project_id: 12,
                until: Some("2026-01-01T00:03:00Z".to_string()),
            })
        );
        // Repère absent, vide ou illisible : aucune présence ne doit partir.
        assert_eq!(parse_holder(""), None);
        assert_eq!(parse_holder("   "), None);
        assert_eq!(parse_holder("poste-A"), None, "project_id manquant");
        assert_eq!(parse_holder("|12|"), None, "porteur vide");
        assert_eq!(parse_holder("poste-A|pas-un-id|"), None);
        assert!(!held_by("", "poste-A"));
        assert!(!held_by("n'importe quoi", "poste-A"));
    }

    /// Le plan exige une présence toutes les 3 minutes (un seul appel par cycle).
    #[test]
    fn presence_cadence_is_three_minutes() {
        assert_eq!(HEARTBEAT_INTERVAL_SECS, 180);
    }

    /// Règle 1 de la présence : **aucun appel** pour un projet que ce poste ne
    /// tient pas. Le compteur `skipped` le prouve, et le faux envoi ne doit
    /// jamais être appelé.
    #[tokio::test]
    async fn presence_is_never_sent_for_a_project_this_poste_does_not_hold() {
        let markers = vec![
            ("C:/p/autre".to_string(), held("poste-B", 12)),
            ("C:/p/jamais".to_string(), String::new()),
            ("C:/p/illisible".to_string(), "n'importe quoi".to_string()),
        ];
        let mut sent = 0usize;
        let report = presence_cycle_with(markers, "poste-A", |_t| {
            sent += 1;
            async { Ok(HandoverReply::Accepted(json!({ "ok": true }))) }
        })
        .await;
        assert_eq!(sent, 0, "presence envoyée pour un projet non tenu");
        assert_eq!(report.skipped, 3);
        assert!(report.kept.is_empty() && report.lost.is_empty() && report.failed.is_empty());
    }

    /// Règle 1 bis : un seul appel par projet tenu, dans le même cycle.
    #[tokio::test]
    async fn presence_sends_exactly_one_call_per_held_project() {
        let markers = vec![
            ("C:/p/a".to_string(), held("poste-A", 1)),
            ("C:/p/b".to_string(), held("poste-A", 2)),
            ("C:/p/c".to_string(), held("poste-B", 3)),
        ];
        let mut calls: Vec<(String, i64)> = Vec::new();
        let report = presence_cycle_with(markers, "poste-A", |t| {
            calls.push((t.project.clone(), t.project_id));
            async {
                Ok(HandoverReply::Accepted(json!({
                    "ok": true,
                    "state": { "expires_at": "2026-01-01T00:06:00Z" }
                })))
            }
        })
        .await;
        assert_eq!(calls.len(), 2, "un appel par projet tenu: {:?}", calls);
        assert_eq!(report.skipped, 1);
        assert_eq!(report.kept.len(), 2);
        assert_eq!(
            report.kept[0].1.as_deref(),
            Some("2026-01-01T00:06:00Z"),
            "l'échéance renvoyée par le serveur est relue"
        );
    }

    /// Règle 2 de la présence : un échec réseau ne plante pas, ne boucle pas, et
    /// n'empêche pas les autres projets du même cycle d'être servis.
    #[tokio::test]
    async fn a_network_failure_does_not_break_the_presence_cycle() {
        let markers = vec![
            ("C:/p/a".to_string(), held("poste-A", 1)),
            ("C:/p/b".to_string(), held("poste-A", 2)),
        ];
        let report = presence_cycle_with(markers, "poste-A", |t| {
            let failing = t.project.ends_with('a');
            async move {
                if failing {
                    Err("connexion refusée".to_string())
                } else {
                    Ok(HandoverReply::Accepted(json!({ "ok": true })))
                }
            }
        })
        .await;
        assert_eq!(report.failed.len(), 1, "la panne est conservée, pas perdue");
        assert!(report.failed[0].1.contains("connexion refusée"));
        assert_eq!(report.kept.len(), 1, "le cycle continue après la panne");
        assert!(report.lost.is_empty());
    }

    /// Un refus métier (409 : projet repris ailleurs) est LOSS, pas une panne :
    /// la présence s'arrête proprement pour ce projet.
    #[tokio::test]
    async fn a_409_refusal_stops_the_presence_instead_of_retrying_forever() {
        let reply = classify_reply(
            409,
            "{\"error\":\"projet tenu par un autre poste\",\"holder\":{\"poste_id\":\"poste-B\"}}",
        );
        match classify_presence(reply) {
            PresenceOutcome::Lost(message) => assert!(message.contains("autre poste")),
            other => panic!("un 409 doit arrêter la présence, obtenu: {:?}", other),
        }
        // Une panne technique, elle, n'arrête rien (le cycle suivant réessaie).
        match classify_presence(classify_reply(503, "{}")) {
            PresenceOutcome::Failed(_) => {}
            other => panic!("un 503 est une panne, obtenu: {:?}", other),
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ÉTAPE 4b (2) — RESTITUTION ORDONNÉE : code → avancement → return
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn restitution_order_is_code_then_tracking_then_return() {
        let empty = RestitutionProgress::default();
        assert_eq!(
            steps_to_run(&empty),
            vec![
                RestitutionStep::PublishCode,
                RestitutionStep::PushTracking,
                RestitutionStep::Return,
            ]
        );
    }

    #[test]
    fn restitution_progress_roundtrips_and_resumes_without_skipping() {
        let p = RestitutionProgress {
            code: true,
            tracking: false,
            returned: false,
        };
        let relu = parse_restitution_progress(&restitution_progress_line(&p));
        assert_eq!(relu, p);
        // Reprise : on reprend là où on s'est arrêté, dans l'ordre.
        assert_eq!(
            steps_to_run(&relu),
            vec![RestitutionStep::PushTracking, RestitutionStep::Return]
        );
        // Avancement illisible : rien n'est sauté, on rejoue tout.
        assert_eq!(parse_restitution_progress("n'importe quoi"), RestitutionProgress::default());
    }

    /// L'ordre réel d'exécution est celui du plan : le code AVANT l'avancement,
    /// l'avancement AVANT la restitution au serveur.
    #[tokio::test]
    async fn restitution_runs_code_then_tracking_then_return() {
        let mut seen: Vec<RestitutionStep> = Vec::new();
        let (after, failure) = run_restitution_steps(RestitutionProgress::default(), |step| {
            seen.push(step);
            async { Ok(()) }
        })
        .await;
        assert!(failure.is_none(), "aucune étape ne doit échouer: {:?}", failure);
        assert_eq!(
            seen,
            vec![
                RestitutionStep::PublishCode,
                RestitutionStep::PushTracking,
                RestitutionStep::Return,
            ]
        );
        assert_eq!(
            after,
            RestitutionProgress {
                code: true,
                tracking: true,
                returned: true
            }
        );
    }

    /// Une étape en échec N'EST PAS annoncée comme réussie : `returned` reste
    /// faux et le projet n'est PAS rendu (aucune étape suivante n'est tentative).
    #[tokio::test]
    async fn a_failed_publication_never_gives_the_project_back() {
        let mut seen: Vec<RestitutionStep> = Vec::new();
        let (after, failure) = run_restitution_steps(RestitutionProgress::default(), |step| {
            seen.push(step);
            async move {
                if step == RestitutionStep::PublishCode {
                    Err("git push refusé".to_string())
                } else {
                    Ok(())
                }
            }
        })
        .await;
        assert_eq!(seen, vec![RestitutionStep::PublishCode], "return tenté après un échec");
        assert_eq!(
            after,
            RestitutionProgress::default(),
            "une étape échouée ne doit pas être marquée faite"
        );
        assert!(!after.returned, "le projet est resté tenu par ce poste");
        match failure {
            Some((step, error)) => {
                assert_eq!(step, RestitutionStep::PublishCode);
                assert!(error.contains("git push refusé"));
            }
            None => panic!("l'échec doit être remonté"),
        }
        // Le message de l'étape est lisible (pas un nom de fonction).
        assert_eq!(step_label(RestitutionStep::PublishCode), "publication du code");
    }

    /// Reprise : une restitution interrompue repart de l'étape en échec, sans
    /// refaire celles qui ont réussi.
    #[tokio::test]
    async fn restitution_resumes_at_the_step_that_failed() {
        let interrupted = RestitutionProgress {
            code: true,
            tracking: false,
            returned: false,
        };
        let mut seen: Vec<RestitutionStep> = Vec::new();
        let (after, failure) = run_restitution_steps(interrupted, |step| {
            seen.push(step);
            async { Ok(()) }
        })
        .await;
        assert!(failure.is_none());
        assert_eq!(
            seen,
            vec![RestitutionStep::PushTracking, RestitutionStep::Return]
        );
        assert!(after.returned);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ÉTAPE 4b (3) — ÉCRITURES REFUSÉES HORS PORTAGE
    // ─────────────────────────────────────────────────────────────────────────

    /// Hors portage, l'écriture est refusée avec un message LISIBLE (jamais un
    /// plantage) : autre poste, aucun porteur, prise en main expirée.
    #[test]
    fn writing_outside_the_portage_is_refused_with_a_readable_message() {
        // Tenu par un AUTRE poste : refus, en disant qui et jusqu'à quand.
        let other = json!({
            "ok": true,
            "state": {
                "holder": { "poste_id": "poste-B" },
                "expires_at": "2026-01-01T00:03:00Z",
                "expired": false
            }
        });
        match write_verdict(&other, "poste-A") {
            WriteVerdict::Refused(message) => {
                assert!(message.contains("autre poste"), "message: {}", message);
                assert!(message.contains("2026-01-01T00:03:00Z"), "échéance absente: {}", message);
                assert!(message.contains("lecture seule"), "message: {}", message);
            }
            WriteVerdict::Allowed => panic!("écriture autorisée alors que le projet est tenu ailleurs"),
        }
        // Aucun porteur : il faut prendre le projet en main.
        let free = json!({ "ok": true, "state": { "holder": null, "expired": false } });
        match write_verdict(&free, "poste-A") {
            WriteVerdict::Refused(message) => {
                assert!(message.contains("aucun poste"), "message: {}", message)
            }
            WriteVerdict::Allowed => panic!("écriture autorisée sans prise en main"),
        }
        // Prise en main expirée : on ne se croit pas porteur.
        let expired = json!({
            "ok": true,
            "state": {
                "holder": { "poste_id": "poste-A" },
                "expires_at": "2026-01-01T00:03:00Z",
                "expired": true
            }
        });
        match write_verdict(&expired, "poste-A") {
            WriteVerdict::Refused(message) => {
                assert!(message.contains("expiré"), "message: {}", message)
            }
            WriteVerdict::Allowed => panic!("écriture autorisée sur une prise en main expirée"),
        }
    }

    /// Porteur légitime : l'écriture est autorisée (et l'état peut être donné
    /// sous sa forme brute, sans enveloppe `state`).
    #[test]
    fn the_claim_required_message_is_actionable_and_not_technical() {
        assert!(CLAIM_REQUIRED_MESSAGE.contains("main"));
        for mot in ["unwrap", "null", "panic", "409", "500"] {
            assert!(!CLAIM_REQUIRED_MESSAGE.contains(mot), "message technique : {}", mot);
        }
    }

    #[test]
    fn the_holder_may_write_even_with_a_raw_state_object() {
        let mine = json!({ "holder": { "poste_id": "poste-A" }, "expired": false });
        assert_eq!(write_verdict(&mine, "poste-A"), WriteVerdict::Allowed);
        // La comparaison d'identifiant de machine ignore la casse (Windows/macOS).
        assert_eq!(write_verdict(&mine, "POSTE-a"), WriteVerdict::Allowed);
    }

    /// La prise en main se fait au premier écrit d'un projet LIBRE (ou expiré
    /// pour ce poste), jamais sur un projet tenu par un autre poste : c'est ce qui
    /// évite un « écrire hors portage » ET un blocage sans recours de l'utilisateur
    /// solo.
    #[test]
    fn a_free_or_expired_project_is_claimed_once_before_writing() {
        let free = json!({ "ok": true, "state": { "holder": null, "expired": false } });
        assert!(needs_claim(&free, "poste-A"), "un projet libre doit être pris en main");
        let mine_expired = json!({
            "ok": true,
            "state": {
                "holder": { "poste_id": "poste-A" },
                "expires_at": "2026-01-01T00:03:00Z",
                "expired": true
            }
        });
        assert!(needs_claim(&mine_expired, "poste-A"), "une prise expirée se renouvelle");
        let mine_ok = json!({
            "ok": true,
            "state": { "holder": { "poste_id": "poste-A" }, "expired": false }
        });
        assert!(!needs_claim(&mine_ok, "poste-A"), "un porteur actif ne réclame rien");
        let autre = json!({
            "ok": true,
            "state": { "holder": { "poste_id": "poste-B" }, "expired": false }
        });
        assert!(
            !needs_claim(&autre, "poste-A"),
            "la prise en main d'un AUTRE poste n'est jamais réclamée (409, refus lisible)"
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ÉTAPE 5 — LIBÉRATION FORCÉE : charge utile et trace nommée
    // ─────────────────────────────────────────────────────────────────────────

    /// Le motif est obligatoire : refusé AVANT l'appel (le serveur répondrait
    /// 409). Un projet valide et un motif réel donnent le corps exact du socle.
    #[test]
    fn force_payload_refuses_an_empty_reason_before_calling_the_server() {
        assert!(force_payload(7, "").is_err(), "motif vide accepté");
        assert!(force_payload(7, "   ").is_err(), "motif fait d'espaces accepté");
        assert!(force_payload(0, "panne").is_err(), "projet 0 accepté");
        assert!(force_payload(-1, "panne").is_err(), "projet négatif accepté");
        let payload = force_payload(7, "  poste en panne  ").expect("motif valide refusé");
        assert_eq!(payload, force_body(7, "poste en panne"));
        assert_eq!(payload["reason"], "poste en panne");
    }

    /// La trace nomme TOUJOURS le poste, le projet, le compte et le motif, et dit
    /// si la libération a abouti : jamais un geste anonyme, jamais un mensonge.
    #[test]
    fn force_trace_line_names_everything_and_never_lies() {
        let refusee = force_trace_line("poste-A", 7, "admin@exemple.com", "panne", false, 1_700_000_000);
        assert!(refusee.contains("poste=poste-A"));
        assert!(refusee.contains("projet=7"));
        assert!(refusee.contains("compte=admin@exemple.com"));
        assert!(refusee.contains("motif=panne"));
        assert!(refusee.contains("resultat=refusee"));
        assert!(!refusee.contains("resultat=liberee"));
        let liberee = force_trace_line("poste-A", 7, "admin@exemple.com", "panne", true, 1_700_000_000);
        assert!(liberee.contains("resultat=liberee"));
    }

    /// Champs absents ou porteurs du séparateur : la ligne reste lisible et
    /// analysable (aucun champ ne peut casser le format).
    #[test]
    fn force_trace_line_survives_empty_and_pipe_values() {
        let ligne = force_trace_line("  ", 3, "  ", "a | b", false, 0);
        assert!(ligne.contains("poste=poste inconnu"));
        assert!(ligne.contains("compte=compte inconnu"));
        assert!(ligne.contains("motif=a / b"));
        // Un seul niveau de séparateur : 6 champs, donc 5 séparateurs.
        assert_eq!(ligne.matches('|').count(), 5, "ligne : {}", ligne);
    }

    /// Le repère local est unique par projet : deux libérations du même projet
    /// se remplacent (une ligne par projet, pas une accumulation).
    #[test]
    fn force_trace_key_is_unique_per_project() {
        assert_eq!(force_trace_key(7), "handover.force.7");
        assert_ne!(force_trace_key(7), force_trace_key(8));
    }
}
