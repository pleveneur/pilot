// roles.rs — Matrice des droits ADMIN / DÉVELOPPEUR / STANDARD (refonte GDS, L3.5)
//
// Module **PUR** : aucune dépendance à PostgreSQL, à git ou au réseau. Toute
// décision de droit est prise ici (une seule source de vérité), ce qui la rend
// testable sans base ni service. Le routeur HTTP du socle, les commandes du
// poste et les gardes de la couche base réutilisent ces mêmes fonctions.
//
// Vocabulaire figé (décision 8, contraintes de la migration 0006) :
//   - `admin`    : seul à gérer les comptes et les dépôts ;
//   - `dev`      : agit sur les projets qui lui sont **attribués** ;
//   - `standard` : **lecture seule** (consulter le suivi/tickets, récupérer sa
//                  copie) ; n'écrit jamais.
//
// Compatibilité (règle de sécurité de la refonte) : la session **historique du
// poste** (rôle vide, le propriétaire local n'ayant pas de compte GDS) conserve
// les droits d'écriture — c'est le même principe de « fail-open » que la lecture
// restreinte des projets posée en L3.4. Un rôle **hors vocabulaire** est, lui,
// refusé (fermé par défaut).

/// Rôle administrateur : gestion des comptes et des dépôts (matrice §5.2).
pub const ROLE_ADMIN: &str = "admin";
/// Rôle développeur : agit sur les projets qui lui sont attribués.
pub const ROLE_DEV: &str = "dev";
/// Rôle standard : lecture seule.
pub const ROLE_STANDARD: &str = "standard";

/// Rôle normalisé.
///
/// `Legacy` = session historique du poste (rôle vide, aucun compte GDS
/// rattaché) : droits préservés pour ne casser aucune installation existante.
/// `Unknown` = valeur hors vocabulaire : jamais privilégiée.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Admin,
    Dev,
    Standard,
    Legacy,
    Unknown,
}

impl Role {
    /// Normalise une chaîne de rôle. Les espaces sont ignorés ; une chaîne vide
    /// désigne la session historique du poste.
    pub fn parse(role: &str) -> Role {
        match role.trim() {
            "admin" => Role::Admin,
            "dev" => Role::Dev,
            "standard" => Role::Standard,
            "" => Role::Legacy,
            _ => Role::Unknown,
        }
    }

    /// Libellé stable (journalisation, messages).
    pub fn as_str(self) -> &'static str {
        match self {
            Role::Admin => ROLE_ADMIN,
            Role::Dev => ROLE_DEV,
            Role::Standard => ROLE_STANDARD,
            Role::Legacy => "",
            Role::Unknown => "unknown",
        }
    }
}

/// Le rôle est-il administrateur ? (garde des routes d'administration)
pub fn is_admin(role: &str) -> bool {
    Role::parse(role) == Role::Admin
}

/// Gestion des comptes (créer, activer/désactiver, changer de rôle, réinitialiser
/// un mot de passe) : **administrateur uniquement** (matrice §5.2).
pub fn can_manage_accounts(role: &str) -> bool {
    is_admin(role)
}

/// Gestion des dépôts (ajouter/retirer un projet côté service) :
/// **administrateur uniquement** (matrice §5.2).
pub fn can_manage_repos(role: &str) -> bool {
    is_admin(role)
}

/// Écriture du suivi et des tickets.
///
/// Autorisée à `admin`, `dev` et à la session historique du poste (`Legacy`) ;
/// refusée au rôle `standard` (lecture seule, matrice §5.2) et à tout rôle hors
/// vocabulaire.
pub fn can_write(role: &str) -> bool {
    matches!(Role::parse(role), Role::Admin | Role::Dev | Role::Legacy)
}

/// Ajout d'un projet GDS (création du dépôt + première publication).
///
/// Autorisé à `admin` et `dev` (décision 8 : « le DEVELOPPEUR publie
/// automatiquement dès qu'il ajoute »), ainsi qu'à la session historique
/// (`Legacy`, compatibilité). Refusé à `standard`.
pub fn can_add_project(role: &str) -> bool {
    matches!(Role::parse(role), Role::Admin | Role::Dev | Role::Legacy)
}

/// Publication (pousser/forcer) d'un projet **existant**.
///
/// Règle décisive (décision 2026-09) : **avoir un compte sur le serveur suffit**.
/// Un `admin` ou un `dev` publie **tous** les projets du serveur, qu'il y soit
/// attribué ou non — l'attribution n'est plus une condition d'accès. Le rôle
/// `standard` reste **lecture seule** et un rôle hors vocabulaire est refusé ;
/// la session historique (`Legacy`) est autorisée (compatibilité).
pub fn can_publish_project(role: &str) -> bool {
    matches!(Role::parse(role), Role::Admin | Role::Dev | Role::Legacy)
}

/// Publication **forcée** du suivi (`tracking/force`, L3.6).
///
/// Un **compte valide** sur le serveur (`admin` ou `dev`) publie, qu'il soit
/// attribué au projet ou non (décision 2026-09). Le rôle `standard` est refusé
/// et la session historique du poste n'entre pas par ce chemin (le compte est
/// relu en base par email), donc aucun « fail-open » n'est nécessaire ici.
pub fn can_force_publish(role: &str) -> bool {
    match Role::parse(role) {
        Role::Admin | Role::Dev => true,
        Role::Standard | Role::Legacy | Role::Unknown => false,
    }
}

/// Message de refus pour une écriture réservée (routes du suivi).
pub fn write_denied_message(role: &str) -> &'static str {
    match Role::parse(role) {
        Role::Standard => "Rôle standard : lecture seule",
        _ => "Écriture non autorisée",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Matrice §5.2 — gestion des comptes et des dépôts : **admin seul**.
    #[test]
    fn accounts_and_repos_are_admin_only() {
        assert!(can_manage_accounts("admin"));
        assert!(can_manage_repos("admin"));
        for role in ["dev", "standard", "", "root", "ADMIN"] {
            assert!(!can_manage_accounts(role), "comptes : {}", role);
            assert!(!can_manage_repos(role), "dépôts : {}", role);
        }
        // `is_admin` ne tolère ni la casse ni les espaces hors trim.
        assert!(is_admin(" admin "));
        assert!(!is_admin("Admin"));
    }

    /// Écriture du suivi : `standard` = lecture seule ; `admin`, `dev` et la
    /// session historique écrivent ; un rôle inconnu est refusé.
    #[test]
    fn write_is_denied_to_standard_only() {
        assert!(can_write("admin"));
        assert!(can_write("dev"));
        assert!(can_write(""), "session historique du poste : compatibilité");
        assert!(!can_write("standard"));
        assert!(!can_write("root"), "rôle hors vocabulaire : fermé par défaut");
    }

    /// Ajout d'un projet : administrateur ou développeur.
    #[test]
    fn add_project_allows_admin_and_dev() {
        assert!(can_add_project("admin"));
        assert!(can_add_project("dev"));
        assert!(can_add_project(""), "session historique du poste : compatibilité");
        assert!(!can_add_project("standard"));
        assert!(!can_add_project("root"));
    }

    /// Publication d'un projet existant : tout compte serveur (`admin`/`dev`)
    /// publie, l'attribution n'est plus une condition ; `standard` = lecture seule.
    #[test]
    fn publish_project_allows_any_server_account() {
        assert!(can_publish_project("admin"));
        assert!(can_publish_project("dev"), "un compte serveur suffit, attribué ou non");
        assert!(!can_publish_project("standard"), "standard : lecture seule");
        assert!(!can_publish_project("root"));
        assert!(can_publish_project(""), "session historique : compatibilité");
    }

    /// Publication forcée du suivi (L3.6) : admin ou dev, sans condition
    /// d'attribution ; `standard` et rôle inconnu restent refusés.
    #[test]
    fn force_publish_allows_any_server_account() {
        assert!(can_force_publish("admin"));
        assert!(can_force_publish("dev"), "un compte serveur suffit, attribué ou non");
        assert!(!can_force_publish("standard"), "standard : lecture seule");
        assert!(!can_force_publish(""), "pas de fail-open sur ce chemin");
        assert!(!can_force_publish("root"));
    }

    /// Normalisation : seules les valeurs exactes du vocabulaire sont reconnues.
    #[test]
    fn role_parsing_is_exact() {
        assert_eq!(Role::parse("admin"), Role::Admin);
        assert_eq!(Role::parse("dev"), Role::Dev);
        assert_eq!(Role::parse("standard"), Role::Standard);
        assert_eq!(Role::parse(""), Role::Legacy);
        assert_eq!(Role::parse("  dev  "), Role::Dev);
        assert_eq!(Role::parse("Dev"), Role::Unknown);
        assert_eq!(Role::parse("superadmin"), Role::Unknown);
        assert_eq!(Role::Legacy.as_str(), "");
        assert_eq!(Role::Admin.as_str(), "admin");
    }
}
