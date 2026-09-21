// git_cmd.rs — Commandes git bas niveau (socle partagé desk/serveur).
//
// Déplacé depuis `src-tauri/src/git.rs` (refonte GDS, L1.5a) : `git_init_bare`
// crée le dépôt bare d'un projet GDS (spec_gds.md §4). Le desk le réutilise via
// `crate::git::git_init_bare` (ré-export), le serveur via `gds_core::git`.

use crate::proc::run_captured;
use std::time::Duration;

/// Initialise un dépôt bare (côté serveur GDS).
pub fn git_init_bare(path: &str) -> Result<(), String> {
    let out = run_captured("git", &["init", "--bare", path], Duration::from_secs(10));
    if out.trim().is_empty() {
        return Err("git init --bare a échoué (git absent ?)".to_string());
    }
    Ok(())
}
