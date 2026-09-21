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
/// Autorisé à `admin`, ou à un `dev` **attribué** au projet (`is_member`). Le
/// rôle `standard` en est exclu (matrice §5.2, publication forcée du suivi) ;
/// la session historique (`Legacy`) est autorisée (compatibilité).
pub fn can_publish_project(role: &str, is_member: bool) -> bool {
    match Role::parse(role) {
        Role::Admin | Role::Legacy => true,
        Role::Dev => is_member,
        Role::Standard | Role::Unknown => false,
    }
}

/// Publication **forcée** du suivi (`tracking/force`, L3.6).
///
/// Règle resserrée (spec cible §8.2) : le compte doit être `admin`, ou `dev`
/// **attribué** au projet. Le rôle `standard` est exclu et un compte inconnu
/// aussi — la session historique du poste n'entre pas par ce chemin (le compte
/// est relu en base par email), donc aucun « fail-open » n'est nécessaire ici.
pub fn can_force_publish(role: &str, is_member: bool) -> bool {
    match Role::parse(role) {
        Role::Admin => true,
        Role::Dev => is_member,
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

    /// Publication d'un projet existant : `dev` **attribué** seulement.
    #[test]
    fn publish_project_requires_admin_or_assigned_dev() {
        assert!(can_publish_project("admin", false), "admin n'a pas besoin d'attribution");
        assert!(can_publish_project("dev", true), "dev attribué");
        assert!(!can_publish_project("dev", false), "dev non attribué");
        assert!(!can_publish_project("standard", true), "standard, même attribué");
        assert!(!can_publish_project("root", true));
        assert!(can_publish_project("", false), "session historique : compatibilité");
    }

    /// Publication forcée du suivi (L3.6, spec §8.2) : admin, ou dev attribué.
    #[test]
    fn force_publish_requires_admin_or_assigned_dev() {
        assert!(can_force_publish("admin", false));
        assert!(can_force_publish("admin", true));
        assert!(can_force_publish("dev", true));
        assert!(!can_force_publish("dev", false));
        assert!(!can_force_publish("standard", true));
        assert!(!can_force_publish("", true), "pas de fail-open sur ce chemin");
        assert!(!can_force_publish("root", true));
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
