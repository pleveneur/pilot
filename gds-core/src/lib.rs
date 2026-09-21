//! Socle GDS partagé entre l'application desktop Pilot et le binaire serveur
//! `gds-server` (refonte GDS, décision 12 « mono-repo »).
//!
//! Ce crate ne doit **jamais** dépendre de Tauri : il est compilé par
//! `gds-server`, un binaire headless destiné au conteneur.
//!
//! Les modules (`db`, `git`, `git_cmd`, `ssh`, `auth`, `rate`, `audit`, `http`,
//! `config`, `roles`, `server_status`) sont déplacés depuis `src-tauri` au fil
//! du lot L1, à comportement identique.

pub mod db;
pub mod git_cmd;
pub mod proc;
pub mod ssh;
