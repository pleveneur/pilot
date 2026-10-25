// handover.rs — Règles PURES du portage (prise en main) d'un projet.
//
// Mode réseau multi-postes, étape 1 (PLAN-mode-reseau-multipostes.md §3, §6 a,
// §6 b). Ce module **ne fait QUE décider** : il n'écrit jamais en base, n'ouvre
// aucune connexion, n'appelle aucun service et **ne lit jamais l'horloge** (le
// « maintenant » est toujours un paramètre). Aucun job n'est planifié : rien
// ici ne tourne en tâche de fond.
//
// Répartition des responsabilités, à ne pas confondre :
//   - la **base** garantit l'exclusivité par son index unique partiel
//     `project_handovers_active_key … WHERE returned_at IS NULL` (migration
//     0008) : deux prises concurrentes ne peuvent pas réussir ;
//   - **ce module** dit ce qu'il faut écrire (insérer, renouveler, clôturer puis
//     insérer, ou refuser) et avec quelles valeurs exactes ;
//   - l'étape 2 exécute la transaction en recopiant ces valeurs, **sans
//     re-décider**.
//
// Règles du plan (§6 b), reproduites ici telles quelles :
//   - expiration **paresseuse** : `expires_at < now()` (aucun balayage) ;
//   - `take` répétable sans doublon : même `user_id` + même `poste_id` →
//     renouvellement ; autre porteur non expiré → refus (409) avec porteur et
//     échéance ; porteur expiré → reprise autorisée, la ligne expirée est
//     clôturée dans la même transaction ;
//   - `heartbeat` : seul le porteur actif signale sa présence (un appel par
//     cycle de 3 minutes) ; la présence repousse l'échéance de 15 minutes ;
//   - `return` (restitution) : seul le porteur actif rend le projet ; la
//     restitution clôture la ligne et pose `sync_at` ;
//   - `force_return` : réservée à `admin`, motif obligatoire et non vide,
//     `returned_by = 'admin'`.

use chrono::{DateTime, TimeDelta, Utc};
use serde::{Deserialize, Serialize};

use crate::roles;

/// Durée d'un portage **sans présence** avant expiration (réglage 1 du
/// propriétaire, plan §3) : 15 minutes.
pub const HANDOVER_TTL_MINUTES: i64 = 15;

/// Cycle de présence : un seul appel de `heartbeat` par 3 minutes
/// (réglage 2 du propriétaire, plan §3 / §6 b).
pub const HANDOVER_HEARTBEAT_MINUTES: i64 = 3;

/// Motif exact inscrit dans `return_reason` lors d'une clôture par expiration.
/// Il est **figé** : l'étape 2 doit écrire cette chaîne, mot pour mot.
pub const EXPIRATION_REASON: &str = "portage expiré après 15 minutes sans présence";

/// Code HTTP d'un refus de portage (porteur déjà en place).
pub const REFUSED_STATUS: u16 = 409;

/// Valeurs autorisées pour la colonne `returned_by` (alignées sur le `CHECK` de
/// la migration `0008_project_handover.sql`) : la clôture vient du porteur
/// lui-même, de l'expiration, ou d'un administrateur.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReturnedBy {
    /// Restitution volontaire par le porteur.
    #[serde(rename = "self")]
    SelfReturn,
    /// Clôture paresseuse : plus de présence depuis 15 minutes.
    #[serde(rename = "expiration")]
    Expiration,
    /// Libération forcée par un administrateur (motif obligatoire).
    #[serde(rename = "admin")]
    Admin,
}

impl ReturnedBy {
    /// Les trois valeurs acceptées par le `CHECK` SQL, dans l'ordre du plan.
    pub const ALL: [ReturnedBy; 3] = [
        ReturnedBy::SelfReturn,
        ReturnedBy::Expiration,
        ReturnedBy::Admin,
    ];

    /// Valeur telle qu'elle est stockée en base.
    pub fn as_str(self) -> &'static str {
        match self {
            ReturnedBy::SelfReturn => "self",
            ReturnedBy::Expiration => "expiration",
            ReturnedBy::Admin => "admin",
        }
    }

    /// Relecture d'une valeur de la base ; `None` si la valeur est hors
    /// vocabulaire (le `CHECK` SQL l'interdit, mais on ne « devine » jamais).
    pub fn parse(value: &str) -> Option<ReturnedBy> {
        match value {
            "self" => Some(ReturnedBy::SelfReturn),
            "expiration" => Some(ReturnedBy::Expiration),
            "admin" => Some(ReturnedBy::Admin),
            _ => None,
        }
    }
}

/// Une prise en main **telle qu'elle est en base** (une ligne de
/// `project_handovers`). Aucune conversion n'est faite ici : l'étape 2 remplit
/// cette structure à partir de la ligne relue.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HandoverRow {
    pub id: i64,
    pub project_id: i64,
    pub user_id: i64,
    /// Identifiant **de machine** (pas de projet) : même valeur sur tous les
    /// projets d'un même poste.
    pub poste_id: String,
    pub taken_at: DateTime<Utc>,
    pub heartbeat_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    /// `None` tant que le portage est actif.
    pub returned_at: Option<DateTime<Utc>>,
    pub returned_by: Option<ReturnedBy>,
    pub return_reason: Option<String>,
    /// `None` tant que la restitution volontaire n'a pas eu lieu.
    pub sync_at: Option<DateTime<Utc>>,
}

impl HandoverRow {
    /// La ligne est-elle encore **ouverte** (pas encore clôturée) ? Une ligne
    /// ouverte peut être expirée : voir [`is_expired`].
    pub fn is_open(&self) -> bool {
        self.returned_at.is_none()
    }
}

/// Le porteur d'un projet, tel qu'il est annoncé dans un refus.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Holder {
    pub user_id: i64,
    pub poste_id: String,
}

/// Clôture d'une ligne : les **valeurs exactes** à écrire en base. La fonction
/// pure les calcule, elle n'écrit rien.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Closure {
    pub returned_at: DateTime<Utc>,
    pub returned_by: ReturnedBy,
    /// Motif obligatoire pour `admin` ; motif d'expiration figé pour
    /// `expiration` ; `None` pour une restitution volontaire.
    pub return_reason: Option<String>,
    /// `Some(now)` seulement pour une restitution volontaire (le poste a poussé
    /// son état d'avancement avant d'appeler `return`).
    pub sync_at: Option<DateTime<Utc>>,
}

/// Ligne à **insérer** (aucune valeur calculée par la base : les horodatages
/// viennent tous du « maintenant » fourni).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewHandover {
    pub project_id: i64,
    pub user_id: i64,
    pub poste_id: String,
    pub taken_at: DateTime<Utc>,
    pub heartbeat_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

/// Mise à jour d'une ligne **déjà existante** (renouvellement de prise ou
/// présence) : `UPDATE … WHERE id = id`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Renewal {
    pub id: i64,
    pub heartbeat_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

/// Pourquoi un appel a été refusé.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RefusalReason {
    /// L'appelant n'est pas le porteur de ce projet (ou le projet est libre).
    NotHolder,
    /// L'appelant est bien le porteur, mais son portage a expiré.
    Expired,
}

impl RefusalReason {
    /// Libellé stable pour les messages et la journalisation.
    pub fn as_str(self) -> &'static str {
        match self {
            RefusalReason::NotHolder => "pas porteur du projet",
            RefusalReason::Expired => "portage expiré",
        }
    }
}

/// Décision de **prise en main** (`take`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum TakeDecision {
    /// Aucun porteur : insérer la ligne.
    Take { row: NewHandover },
    /// Même `user_id` + même `poste_id` : renouveler la ligne existante,
    /// **sans en créer une seconde**.
    Renew { renewal: Renewal },
    /// Porteur expiré : **clôturer la ligne expirée puis insérer** la nouvelle,
    /// dans la même transaction.
    Replace { close: Closure, row: NewHandover },
    /// Autre porteur non expiré : refus **409** avec le porteur et l'échéance.
    Refused {
        holder: Holder,
        until: DateTime<Utc>,
    },
}

impl TakeDecision {
    /// Code HTTP de la décision (200 pour une action, 409 pour un refus).
    pub fn http_status(&self) -> u16 {
        match self {
            TakeDecision::Refused { .. } => REFUSED_STATUS,
            _ => 200,
        }
    }

    /// Action à effectuer, en clair (journalisation / rapport).
    pub fn action(&self) -> &'static str {
        match self {
            TakeDecision::Take { .. } => "insert",
            TakeDecision::Renew { .. } => "renew",
            TakeDecision::Replace { .. } => "close_then_insert",
            TakeDecision::Refused { .. } => "refuse",
        }
    }
}

/// Décision de **présence** (`heartbeat`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum HeartbeatDecision {
    /// Porteur actif : écrire la nouvelle échéance.
    Accepted { renewal: Renewal },
    /// Refus, avec la raison. `close` porte les valeurs de clôture de la ligne
    /// expirée quand il y en a une (clôture paresseuse), sinon `None`.
    Refused {
        reason: RefusalReason,
        holder: Option<Holder>,
        close: Option<Closure>,
    },
}

impl HeartbeatDecision {
    /// Code HTTP de la décision.
    pub fn http_status(&self) -> u16 {
        match self {
            HeartbeatDecision::Refused { .. } => REFUSED_STATUS,
            HeartbeatDecision::Accepted { .. } => 200,
        }
    }
}

/// Décision de **restitution** (`return`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReturnDecision {
    /// Porteur actif : clôturer la ligne avec `sync_at`.
    Closed { id: i64, closure: Closure },
    /// Refus : non-porteur, portage expiré, ou restitution déjà faite (aucune
    /// ligne ouverte → jamais de double clôture).
    Refused {
        reason: RefusalReason,
        holder: Option<Holder>,
        close: Option<Closure>,
    },
}

impl ReturnDecision {
    /// Code HTTP de la décision.
    pub fn http_status(&self) -> u16 {
        match self {
            ReturnDecision::Refused { .. } => REFUSED_STATUS,
            ReturnDecision::Closed { .. } => 200,
        }
    }
}

/// Pourquoi une libération forcée est refusée.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ForceRefusalReason {
    /// Rôle non administrateur : la libération forcée est réservée à `admin`.
    NotAdmin,
    /// Motif absent ou vide : il est obligatoire (traçabilité).
    ReasonMissing,
    /// Aucune prise en main ouverte sur ce projet.
    NoActiveHolder,
}

impl ForceRefusalReason {
    /// Libellé stable pour les messages et le journal d'audit.
    pub fn as_str(self) -> &'static str {
        match self {
            ForceRefusalReason::NotAdmin => "libération forcée réservée à un administrateur",
            ForceRefusalReason::ReasonMissing => "motif de libération obligatoire",
            ForceRefusalReason::NoActiveHolder => "aucune prise en main en cours",
        }
    }
}

/// Décision de **libération forcée** (`force_return`, administrateur seul).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ForceReturnDecision {
    /// Clôture imposée : `returned_by = 'admin'`, motif recopié.
    Closed {
        id: i64,
        closure: Closure,
    },
    Refused {
        reason: ForceRefusalReason,
    },
}

impl ForceReturnDecision {
    /// Code HTTP de la décision (200 pour une clôture, 403 pour un non-admin,
    /// 409 sinon pour un dossier incohérent).
    pub fn http_status(&self) -> u16 {
        match self {
            ForceReturnDecision::Closed { .. } => 200,
            ForceReturnDecision::Refused { reason } => match reason {
                ForceRefusalReason::NotAdmin => 403,
                ForceRefusalReason::ReasonMissing | ForceRefusalReason::NoActiveHolder => {
                    REFUSED_STATUS
                }
            },
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Prédicats purs
// ─────────────────────────────────────────────────────────────────────────────

/// Expiration paresseuse : `expires_at < now()`. À la borne exacte
/// (`expires_at == now`) le portage n'est **pas** encore expiré — même
/// comparaison stricte que la requête d'écriture de l'étape 2.
pub fn is_expired(row: &HandoverRow, now: DateTime<Utc>) -> bool {
    row.expires_at < now
}

/// Le portage est-il **actif** : ligne ouverte et non expirée.
pub fn is_active(row: &HandoverRow, now: DateTime<Utc>) -> bool {
    row.is_open() && !is_expired(row, now)
}

/// L'appelant est-il le porteur inscrit sur la ligne (même `user_id` **et**
/// même `poste_id`) ? L'expiration n'est pas examinée ici.
pub fn is_holder(row: &HandoverRow, user_id: i64, poste_id: &str) -> bool {
    row.user_id == user_id && row.poste_id == poste_id
}

/// Porteur annoncé dans un refus.
pub fn holder_of(row: &HandoverRow) -> Holder {
    Holder {
        user_id: row.user_id,
        poste_id: row.poste_id.clone(),
    }
}

/// Valeurs exactes de la **clôture paresseuse** d'une ligne expirée :
/// `returned_at = now`, `returned_by = 'expiration'`, motif figé, `sync_at`
/// laissé à `NULL` (aucune restitution volontaire n'a eu lieu).
pub fn expiration_closure(now: DateTime<Utc>) -> Closure {
    Closure {
        returned_at: now,
        returned_by: ReturnedBy::Expiration,
        return_reason: Some(EXPIRATION_REASON.to_string()),
        sync_at: None,
    }
}

/// Échéance repoussée de 15 minutes **à partir du « maintenant » fourni**
/// (présence ou renouvellement de prise).
fn renewal_of(row: &HandoverRow, now: DateTime<Utc>) -> Renewal {
    Renewal {
        id: row.id,
        heartbeat_at: now,
        expires_at: now + TimeDelta::minutes(HANDOVER_TTL_MINUTES),
    }
}

/// Nouvelle ligne à insérer, échéance à `now + 15 minutes`.
fn fresh_row(project_id: i64, user_id: i64, poste_id: &str, now: DateTime<Utc>) -> NewHandover {
    NewHandover {
        project_id,
        user_id,
        poste_id: poste_id.to_string(),
        taken_at: now,
        heartbeat_at: now,
        expires_at: now + TimeDelta::minutes(HANDOVER_TTL_MINUTES),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Décisions
// ─────────────────────────────────────────────────────────────────────────────

/// **`take`** — prendre, renouveler ou reprendre la main sur un projet.
///
/// `active` est la ligne **ouverte** de ce projet (`returned_at IS NULL`), ou
/// `None` si le projet est libre. Le résultat nomme l'action à faire et porte
/// les valeurs à écrire ; aucun accès base n'est effectué.
pub fn take(
    project_id: i64,
    user_id: i64,
    poste_id: &str,
    active: Option<&HandoverRow>,
    now: DateTime<Utc>,
) -> TakeDecision {
    let row = match active.filter(|r| r.is_open()) {
        Some(row) => row,
        None => {
            return TakeDecision::Take {
                row: fresh_row(project_id, user_id, poste_id, now),
            }
        }
    };

    if is_holder(row, user_id, poste_id) {
        // Idempotence : même machine, même compte → renouvellement, jamais une
        // deuxième ligne (y compris si l'échéance est passée : c'est le même
        // porteur qui revient).
        TakeDecision::Renew {
            renewal: renewal_of(row, now),
        }
    } else if is_expired(row, now) {
        // Reprise : la ligne expirée est clôturée **puis** la nouvelle insérée.
        TakeDecision::Replace {
            close: expiration_closure(now),
            row: fresh_row(project_id, user_id, poste_id, now),
        }
    } else {
        TakeDecision::Refused {
            holder: holder_of(row),
            until: row.expires_at,
        }
    }
}

/// **`heartbeat`** — signal de présence du porteur (un appel par cycle de 3
/// minutes). Seul le porteur **actif** peut signaler sa présence.
pub fn heartbeat(
    active: Option<&HandoverRow>,
    user_id: i64,
    poste_id: &str,
    now: DateTime<Utc>,
) -> HeartbeatDecision {
    let row = match active.filter(|r| r.is_open()) {
        Some(row) => row,
        None => {
            return HeartbeatDecision::Refused {
                reason: RefusalReason::NotHolder,
                holder: None,
                close: None,
            }
        }
    };

    if !is_holder(row, user_id, poste_id) {
        return HeartbeatDecision::Refused {
            reason: RefusalReason::NotHolder,
            holder: Some(holder_of(row)),
            close: None,
        };
    }

    if is_expired(row, now) {
        // Le porteur revient trop tard : sa présence est refusée et la ligne
        // expirée est clôturée (expiration paresseuse, pas de job planifié).
        return HeartbeatDecision::Refused {
            reason: RefusalReason::Expired,
            holder: Some(holder_of(row)),
            close: Some(expiration_closure(now)),
        };
    }

    HeartbeatDecision::Accepted {
        renewal: renewal_of(row, now),
    }
}

/// **`return`** — restitution volontaire du projet par son porteur actif.
///
/// La restitution clôture la ligne et pose `sync_at` : elle n'a lieu qu'après
/// la publication du code et la poussée de l'état d'avancement (ordre imposé
/// par le plan §6 b, appliqué par le poste à l'étape 4).
pub fn return_project(
    active: Option<&HandoverRow>,
    user_id: i64,
    poste_id: &str,
    now: DateTime<Utc>,
) -> ReturnDecision {
    let row = match active.filter(|r| r.is_open()) {
        Some(row) => row,
        None => {
            // Projet libre, ou restitution déjà faite : rien à rejouer, jamais
            // de double clôture.
            return ReturnDecision::Refused {
                reason: RefusalReason::NotHolder,
                holder: None,
                close: None,
            };
        }
    };

    if !is_holder(row, user_id, poste_id) {
        return ReturnDecision::Refused {
            reason: RefusalReason::NotHolder,
            holder: Some(holder_of(row)),
            close: None,
        };
    }

    if is_expired(row, now) {
        return ReturnDecision::Refused {
            reason: RefusalReason::Expired,
            holder: Some(holder_of(row)),
            close: Some(expiration_closure(now)),
        };
    }

    ReturnDecision::Closed {
        id: row.id,
        closure: Closure {
            returned_at: now,
            returned_by: ReturnedBy::SelfReturn,
            return_reason: None,
            sync_at: Some(now),
        },
    }
}

/// **`force_return`** — libération forcée d'un projet tenu par un autre poste.
///
/// Réservée au rôle `admin` (matrice [`crate::roles`]), motif obligatoire et non
/// vide, `returned_by = 'admin'`. L'écriture au journal d'audit
/// (`handover.force_return`) est faite par l'appelant (étape 3), pas ici.
pub fn force_return(
    active: Option<&HandoverRow>,
    role: &str,
    reason: &str,
    now: DateTime<Utc>,
) -> ForceReturnDecision {
    if !roles::is_admin(role) {
        return ForceReturnDecision::Refused {
            reason: ForceRefusalReason::NotAdmin,
        };
    }

    let reason = reason.trim();
    if reason.is_empty() {
        return ForceReturnDecision::Refused {
            reason: ForceRefusalReason::ReasonMissing,
        };
    }

    let row = match active.filter(|r| r.is_open()) {
        Some(row) => row,
        None => {
            return ForceReturnDecision::Refused {
                reason: ForceRefusalReason::NoActiveHolder,
            }
        }
    };

    ForceReturnDecision::Closed {
        id: row.id,
        closure: Closure {
            returned_at: now,
            returned_by: ReturnedBy::Admin,
            return_reason: Some(reason.to_string()),
            // Libération imposée : aucune restitution volontaire, donc aucune
            // synchronisation d'état d'avancement n'est attestée.
            sync_at: None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    /// Instant de référence : 2026-01-01 09:00:00 UTC, puis décalages en
    /// minutes. Aucune horloge n'est lue dans les tests non plus.
    fn t(minutes: i64) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 1, 1, 9, 0, 0).unwrap() + TimeDelta::minutes(minutes)
    }

    const PROJECT: i64 = 7;
    const USER_A: i64 = 1;
    const USER_B: i64 = 2;
    const POSTE_A: &str = "poste-a";
    const POSTE_B: &str = "poste-b";

    /// Ligne ouverte posée à `t(0)`, échéance à `t(0) + 15 min`.
    fn open_row(id: i64, user_id: i64, poste_id: &str) -> HandoverRow {
        HandoverRow {
            id,
            project_id: PROJECT,
            user_id,
            poste_id: poste_id.to_string(),
            taken_at: t(0),
            heartbeat_at: t(0),
            expires_at: t(HANDOVER_TTL_MINUTES),
            returned_at: None,
            returned_by: None,
            return_reason: None,
            sync_at: None,
        }
    }

    /// Ligne clôturée (historique).
    fn closed_row(id: i64, user_id: i64, poste_id: &str) -> HandoverRow {
        let mut row = open_row(id, user_id, poste_id);
        row.returned_at = Some(t(20));
        row.returned_by = Some(ReturnedBy::SelfReturn);
        row.sync_at = Some(t(20));
        row
    }

    // ── Constantes du plan (§3, §6 b) ────────────────────────────────────────

    #[test]
    fn settings_match_the_owner_decisions() {
        assert_eq!(
            HANDOVER_TTL_MINUTES, 15,
            "réglage 1 : libération après 15 min"
        );
        assert_eq!(
            HANDOVER_HEARTBEAT_MINUTES, 3,
            "réglage 2 : présence toutes les 3 min"
        );
        assert_eq!(
            EXPIRATION_REASON,
            "portage expiré après 15 minutes sans présence"
        );
        assert_eq!(REFUSED_STATUS, 409);
    }

    /// Les valeurs `returned_by` doivent rester **strictement** celles du
    /// `CHECK` de la migration 0008, sinon toute clôture serait rejetée par la
    /// base au moment de l'étape 2.
    #[test]
    fn returned_by_matches_the_sql_check() {
        assert_eq!(
            ReturnedBy::ALL.map(ReturnedBy::as_str),
            ["self", "expiration", "admin"]
        );
        for value in ReturnedBy::ALL {
            assert_eq!(ReturnedBy::parse(value.as_str()), Some(value));
        }
        assert_eq!(ReturnedBy::parse("Autre"), None);
        assert_eq!(ReturnedBy::parse(""), None);
    }

    // ── Bornes exactes de l'expiration ──────────────────────────────────────

    #[test]
    fn expiration_boundaries_are_strictly_before_expires_at() {
        let row = open_row(1, USER_A, POSTE_A); // expires_at = t(15)
        assert!(!is_expired(&row, t(14)), "juste avant : encore actif");
        assert!(
            !is_expired(&row, t(15)),
            "exactement à l'échéance : `expires_at < now()` est faux → encore actif"
        );
        assert!(is_expired(&row, t(16)), "juste après : expiré");

        assert!(is_active(&row, t(14)));
        assert!(is_active(&row, t(15)));
        assert!(!is_active(&row, t(16)));

        // Une ligne déjà clôturée n'est jamais active, même avant son échéance.
        assert!(!is_active(&closed_row(2, USER_A, POSTE_A), t(1)));
        assert!(!closed_row(2, USER_A, POSTE_A).is_open());
    }

    // ── take ────────────────────────────────────────────────────────────────

    #[test]
    fn take_on_a_free_project_inserts_one_row_for_fifteen_minutes() {
        let decision = take(PROJECT, USER_A, POSTE_A, None, t(0));
        match decision {
            TakeDecision::Take { row } => {
                assert_eq!(row.project_id, PROJECT);
                assert_eq!(row.user_id, USER_A);
                assert_eq!(row.poste_id, POSTE_A);
                assert_eq!(row.taken_at, t(0));
                assert_eq!(row.heartbeat_at, t(0));
                assert_eq!(row.expires_at, t(15));
            }
            other => panic!("attendu Take, obtenu {other:?}"),
        }
        assert_eq!(
            take(PROJECT, USER_A, POSTE_A, None, t(0)).http_status(),
            200
        );
    }

    #[test]
    fn take_with_same_user_and_poste_renews_without_a_second_row() {
        let row = open_row(42, USER_A, POSTE_A);
        let decision = take(PROJECT, USER_A, POSTE_A, Some(&row), t(5));
        match &decision {
            TakeDecision::Renew { renewal } => {
                // Même ligne (aucune insertion), échéance repoussée de 15 min.
                assert_eq!(renewal.id, 42);
                assert_eq!(renewal.heartbeat_at, t(5));
                assert_eq!(renewal.expires_at, t(20));
            }
            other => panic!("attendu Renew (renouvellement, pas de doublon), obtenu {other:?}"),
        }
        assert_eq!(decision.action(), "renew");
    }

    #[test]
    fn take_by_another_user_on_a_live_hold_is_refused_with_holder_and_deadline() {
        let row = open_row(42, USER_A, POSTE_A);
        let decision = take(PROJECT, USER_B, POSTE_B, Some(&row), t(3));
        match &decision {
            TakeDecision::Refused { holder, until } => {
                assert_eq!(
                    holder,
                    &Holder {
                        user_id: USER_A,
                        poste_id: POSTE_A.to_string()
                    }
                );
                assert_eq!(*until, t(15));
            }
            other => panic!("attendu Refused, obtenu {other:?}"),
        }
        assert_eq!(decision.http_status(), 409);
        assert_eq!(decision.action(), "refuse");
    }

    #[test]
    fn take_by_another_user_after_expiry_replaces_the_expired_row() {
        let row = open_row(42, USER_A, POSTE_A);
        let decision = take(PROJECT, USER_B, POSTE_B, Some(&row), t(16));
        match &decision {
            TakeDecision::Replace {
                close,
                row: new_row,
            } => {
                assert_eq!(close.returned_at, t(16));
                assert_eq!(close.returned_by, ReturnedBy::Expiration);
                assert_eq!(close.returned_by.as_str(), "expiration");
                assert_eq!(close.return_reason.as_deref(), Some(EXPIRATION_REASON));
                assert_eq!(close.sync_at, None, "aucune restitution volontaire");
                assert_eq!(new_row.user_id, USER_B);
                assert_eq!(new_row.poste_id, POSTE_B);
                assert_eq!(new_row.expires_at, t(31));
            }
            other => panic!("attendu Replace (clôturer puis insérer), obtenu {other:?}"),
        }
        assert_eq!(decision.action(), "close_then_insert");
    }

    #[test]
    fn take_ignores_a_closed_row_and_inserts_a_new_one() {
        // Défense : une ligne clôturée n'est pas un porteur en place.
        let row = closed_row(42, USER_A, POSTE_A);
        assert!(matches!(
            take(PROJECT, USER_B, POSTE_B, Some(&row), t(1)),
            TakeDecision::Take { .. }
        ));
    }

    // ── heartbeat ───────────────────────────────────────────────────────────

    #[test]
    fn heartbeat_by_the_active_holder_pushes_the_deadline_by_fifteen_minutes() {
        let row = open_row(42, USER_A, POSTE_A);
        let decision = heartbeat(Some(&row), USER_A, POSTE_A, t(3));
        match &decision {
            HeartbeatDecision::Accepted { renewal } => {
                assert_eq!(renewal.id, 42);
                assert_eq!(renewal.heartbeat_at, t(3));
                assert_eq!(
                    renewal.expires_at,
                    t(18),
                    "now + 15 min, pas expires_at + 15"
                );
            }
            other => panic!("attendu Accepted, obtenu {other:?}"),
        }
        assert_eq!(decision.http_status(), 200);
    }

    #[test]
    fn heartbeat_by_a_non_holder_is_refused() {
        let row = open_row(42, USER_A, POSTE_A);
        let other_poste = heartbeat(Some(&row), USER_B, POSTE_B, t(1));
        match &other_poste {
            HeartbeatDecision::Refused {
                reason,
                holder,
                close,
            } => {
                assert_eq!(*reason, RefusalReason::NotHolder);
                assert_eq!(reason.as_str(), "pas porteur du projet");
                assert_eq!(holder.as_ref().map(|h| h.user_id), Some(USER_A));
                assert!(close.is_none(), "ligne non expirée : rien à clôturer");
            }
            other => panic!("attendu Refused, obtenu {other:?}"),
        }
        assert_eq!(other_poste.http_status(), 409);

        // Même compte, autre machine : ce n'est pas le porteur non plus.
        assert!(matches!(
            heartbeat(Some(&row), USER_A, POSTE_B, t(1)),
            HeartbeatDecision::Refused { .. }
        ));

        // Projet libre : personne ne signale de présence.
        assert!(matches!(
            heartbeat(None, USER_A, POSTE_A, t(1)),
            HeartbeatDecision::Refused {
                reason: RefusalReason::NotHolder,
                holder: None,
                close: None
            }
        ));
    }

    #[test]
    fn heartbeat_by_an_expired_holder_is_refused_and_closes_the_row() {
        let row = open_row(42, USER_A, POSTE_A);
        let decision = heartbeat(Some(&row), USER_A, POSTE_A, t(16));
        match decision {
            HeartbeatDecision::Refused {
                reason,
                holder: _,
                close,
            } => {
                assert_eq!(reason, RefusalReason::Expired);
                assert_eq!(reason.as_str(), "portage expiré");
                let close = close.expect("clôture paresseuse attendue");
                assert_eq!(close.returned_at, t(16));
                assert_eq!(close.returned_by, ReturnedBy::Expiration);
                assert_eq!(close.return_reason.as_deref(), Some(EXPIRATION_REASON));
                assert_eq!(close.sync_at, None);
            }
            other => panic!("attendu Refused(expiré), obtenu {other:?}"),
        }
    }

    // ── return ──────────────────────────────────────────────────────────────

    #[test]
    fn return_by_the_active_holder_closes_the_row_and_sets_sync_at() {
        let row = open_row(42, USER_A, POSTE_A);
        let decision = return_project(Some(&row), USER_A, POSTE_A, t(4));
        match &decision {
            ReturnDecision::Closed { id, closure } => {
                assert_eq!(*id, 42);
                assert_eq!(closure.returned_at, t(4));
                assert_eq!(closure.returned_by, ReturnedBy::SelfReturn);
                assert_eq!(closure.returned_by.as_str(), "self");
                assert_eq!(closure.return_reason, None, "aucun motif imposé à self");
                assert_eq!(closure.sync_at, Some(t(4)));
            }
            other => panic!("attendu Closed, obtenu {other:?}"),
        }
        assert_eq!(decision.http_status(), 200);
    }

    #[test]
    fn return_by_a_non_holder_is_refused() {
        let row = open_row(42, USER_A, POSTE_A);
        let decision = return_project(Some(&row), USER_B, POSTE_B, t(1));
        match decision {
            ReturnDecision::Refused {
                reason,
                holder,
                close,
            } => {
                assert_eq!(reason, RefusalReason::NotHolder);
                assert_eq!(holder.map(|h| h.user_id), Some(USER_A));
                assert!(close.is_none());
            }
            other => panic!("attendu Refused, obtenu {other:?}"),
        }
    }

    #[test]
    fn return_replayed_is_refused_without_any_second_closure() {
        // Après la première restitution, la ligne est clôturée : elle n'est
        // plus la ligne ouverte du projet (`returned_at IS NULL` ne la retient
        // plus), donc le rejeu tombe sur « aucun porteur ».
        let row = open_row(42, USER_A, POSTE_A);
        let first = return_project(Some(&row), USER_A, POSTE_A, t(4));
        assert!(matches!(first, ReturnDecision::Closed { .. }));

        let mut after = row.clone();
        if let ReturnDecision::Closed { closure, .. } = first {
            after.returned_at = Some(closure.returned_at);
            after.returned_by = Some(closure.returned_by);
            after.return_reason = closure.return_reason;
            after.sync_at = closure.sync_at;
        }
        assert!(
            matches!(
                return_project(None, USER_A, POSTE_A, t(5)),
                ReturnDecision::Refused {
                    reason: RefusalReason::NotHolder,
                    ..
                }
            ),
            "rejeu sur un projet libre : refus, aucune double clôture"
        );
        assert!(
            matches!(
                return_project(Some(&after), USER_A, POSTE_A, t(5)),
                ReturnDecision::Refused {
                    reason: RefusalReason::NotHolder,
                    ..
                }
            ),
            "rejeu sur la ligne déjà clôturée : refus, aucune double clôture"
        );
    }

    #[test]
    fn return_by_an_expired_holder_is_refused_and_closes_with_expiration() {
        let row = open_row(42, USER_A, POSTE_A);
        let decision = return_project(Some(&row), USER_A, POSTE_A, t(30));
        match decision {
            ReturnDecision::Refused {
                reason,
                holder: _,
                close,
            } => {
                assert_eq!(reason, RefusalReason::Expired);
                let close = close.expect("clôture paresseuse attendue");
                assert_eq!(close.returned_by, ReturnedBy::Expiration);
                assert_eq!(close.return_reason.as_deref(), Some(EXPIRATION_REASON));
                assert_eq!(close.sync_at, None);
            }
            other => panic!("attendu Refused(expiré), obtenu {other:?}"),
        }
    }

    // ── force_return ────────────────────────────────────────────────────────

    #[test]
    fn force_return_requires_an_admin_role() {
        let row = open_row(42, USER_A, POSTE_A);
        for role in ["dev", "standard", "", "inconnu"] {
            let decision = force_return(Some(&row), role, "poste abandonné", t(5));
            match decision {
                ForceReturnDecision::Refused { reason } => {
                    assert_eq!(reason, ForceRefusalReason::NotAdmin, "rôle {role:?}");
                    assert_eq!(decision.http_status(), 403);
                }
                other => panic!("attendu Refused(NotAdmin) pour {role:?}, obtenu {other:?}"),
            }
        }
    }

    #[test]
    fn force_return_requires_a_non_empty_reason() {
        let row = open_row(42, USER_A, POSTE_A);
        for reason in ["", "   ", "\n\t "] {
            let decision = force_return(Some(&row), "admin", reason, t(5));
            match decision {
                ForceReturnDecision::Refused { reason: why } => {
                    assert_eq!(why, ForceRefusalReason::ReasonMissing);
                    assert_eq!(why.as_str(), "motif de libération obligatoire");
                }
                other => panic!("attendu Refused(ReasonMissing), obtenu {other:?}"),
            }
        }
    }

    #[test]
    fn force_return_by_an_admin_closes_the_row_with_admin_and_the_reason() {
        let row = open_row(42, USER_A, POSTE_A);
        let decision = force_return(Some(&row), "admin", "  poste abandonné  ", t(5));
        match decision {
            ForceReturnDecision::Closed { id, closure } => {
                assert_eq!(id, 42);
                assert_eq!(closure.returned_at, t(5));
                assert_eq!(closure.returned_by, ReturnedBy::Admin);
                assert_eq!(closure.returned_by.as_str(), "admin");
                assert_eq!(
                    closure.return_reason.as_deref(),
                    Some("poste abandonné"),
                    "motif recopié sans espaces superflus, jamais vide"
                );
                assert_eq!(closure.sync_at, None);
            }
            other => panic!("attendu Closed(admin), obtenu {other:?}"),
        }
    }

    #[test]
    fn force_return_without_an_active_hold_is_refused() {
        assert!(matches!(
            force_return(None, "admin", "poste abandonné", t(5)),
            ForceReturnDecision::Refused {
                reason: ForceRefusalReason::NoActiveHolder
            }
        ));
        // Ligne déjà clôturée : plus rien à libérer.
        let closed = closed_row(42, USER_A, POSTE_A);
        assert!(matches!(
            force_return(Some(&closed), "admin", "poste abandonné", t(25)),
            ForceReturnDecision::Refused {
                reason: ForceRefusalReason::NoActiveHolder
            }
        ));
    }

    // ── Cohérence d'ensemble ────────────────────────────────────────────────

    /// Le portage complet d'un cycle de vie, uniquement avec les règles pures :
    /// prise → présence → reprise par un autre après expiration → restitution.
    #[test]
    fn full_lifecycle_from_take_to_return() {
        let taken = take(PROJECT, USER_A, POSTE_A, None, t(0));
        let row = match taken {
            TakeDecision::Take { row } => HandoverRow {
                id: 1,
                project_id: row.project_id,
                user_id: row.user_id,
                poste_id: row.poste_id,
                taken_at: row.taken_at,
                heartbeat_at: row.heartbeat_at,
                expires_at: row.expires_at,
                returned_at: None,
                returned_by: None,
                return_reason: None,
                sync_at: None,
            },
            other => panic!("attendu Take, obtenu {other:?}"),
        };

        // Présence à 3 min : échéance à 18 min.
        let renewal = match heartbeat(Some(&row), USER_A, POSTE_A, t(3)) {
            HeartbeatDecision::Accepted { renewal } => renewal,
            other => panic!("attendu Accepted, obtenu {other:?}"),
        };
        let mut row = row;
        row.heartbeat_at = renewal.heartbeat_at;
        row.expires_at = renewal.expires_at;

        // À 17 min le porteur est encore actif ; à 19 min il a expiré.
        assert!(is_active(&row, t(17)));
        let taken_by_b = take(PROJECT, USER_B, POSTE_B, Some(&row), t(19));
        let close = match taken_by_b {
            TakeDecision::Replace {
                close,
                row: new_row,
            } => {
                assert_eq!(new_row.user_id, USER_B);
                assert_eq!(new_row.expires_at, t(34));
                close
            }
            other => panic!("attendu Replace, obtenu {other:?}"),
        };
        assert_eq!(close.returned_by, ReturnedBy::Expiration);

        // Le nouveau porteur restitue.
        let mut row_b = row.clone();
        row_b.id = 2;
        row_b.user_id = USER_B;
        row_b.poste_id = POSTE_B.to_string();
        row_b.taken_at = t(19);
        row_b.heartbeat_at = t(19);
        row_b.expires_at = t(34);
        let returned = return_project(Some(&row_b), USER_B, POSTE_B, t(20));
        match returned {
            ReturnDecision::Closed { id, closure } => {
                assert_eq!(id, 2);
                assert_eq!(closure.returned_by, ReturnedBy::SelfReturn);
                assert_eq!(closure.sync_at, Some(t(20)));
            }
            other => panic!("attendu Closed, obtenu {other:?}"),
        }
    }
}
