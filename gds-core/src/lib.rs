//! Socle GDS partagé entre l'application desktop Pilot et le binaire serveur
//! `gds-server` (refonte GDS, décision 12 « mono-repo »).
//!
//! Ce crate ne doit **jamais** dépendre de Tauri : il est compilé par
//! `gds-server`, un binaire headless destiné au conteneur.
//!
//! Les modules (`db`, `git`, `git_cmd`, `ssh`, `auth`, `rate`, `audit`, `http`,
//! `config`, `roles`, `server_status`) sont déplacés depuis `src-tauri` au fil
//! du lot L1, à comportement identique.

pub mod audit;
pub mod auth;
pub mod config;
pub mod db;
pub mod git;
pub mod git_cmd;
pub mod http;
pub mod proc;
pub mod rate;
// Matrice des droits ADMIN / DÉVELOPPEUR / STANDARD (refonte GDS, L3.5) :
// module pur, sans dépendance base/réseau, partagé par le socle et le poste.
pub mod roles;
pub mod server_status;
pub mod ssh;
