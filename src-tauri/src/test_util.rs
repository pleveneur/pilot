#![cfg(test)]
//! Utilitaires partagés par les TESTS du crate.
//!
//! Ce module n'est compilé qu'en mode test (`#[cfg(test)]` sur sa déclaration
//! dans `lib.rs`, doublé ici) : il n'entre jamais dans le binaire de
//! production, et aucun comportement de production n'en dépend.
//!
//! Deux garanties, pour supprimer deux défauts constatés :
//!
//! 1. **Unicité.** Les répertoires temporaires de test n'étaient distingués
//!    que par `std::process::id()`. Or les tests Rust tournent EN PARALLÈLE
//!    dans un même processus : deux tests du même processus recevaient le
//!    même dossier, se l'arrachaient (et se le supprimaient mutuellement).
//!    Ici : `<pid>-<compteur atomique>-<nanos>`, unique entre tests, entre
//!    processus et entre exécutions.
//!
//! 2. **Nettoyage garanti.** La suppression du dossier était une ligne en fin
//!    de test : inaccessible dès qu'un `assert` échouait (les résidus
//!    s'accumulaient). Ici : la suppression est faite par le `Drop` du
//!    gardien, donc MÊME en cas d'échec ou de panique du test.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

/// Compteur monotone global : garantit l'unicité entre tests parallèles d'un
/// même processus, même appelés dans la même nanoseconde.
static COUNTER: AtomicU64 = AtomicU64::new(0);

/// Suffixe unique : `<pid>-<compteur>-<nanos>`.
pub(crate) fn unique_suffix() -> String {
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{}-{}-{}", std::process::id(), n, nanos)
}

/// Répertoire temporaire de test : unique et supprimé automatiquement.
///
/// `Deref<Target = Path>` : le gardien s'utilise comme le `PathBuf` qu'il
/// remplace (`dir.join(...)`, `dir.to_string_lossy()`, `&*dir`…).
///
/// `AsRef<Path>` n'est volontairement PAS implémenté : cela rend
/// inconvertible un `std::fs::remove_dir_all(&dir)` resté par erreur (le
/// compilateur signale la ligne au lieu de supprimer le dossier en silence).
pub(crate) struct TempDir {
    path: PathBuf,
}

impl TempDir {
    /// Crée `<temp>/<label>-<suffixe unique>` (répertoire VIDE existant).
    pub(crate) fn new(label: &str) -> Self {
        Self::new_with(label, true)
    }

    /// Comme [`TempDir::new`], mais sans créer le répertoire : pour les tests
    /// qui ont besoin d'un chemin UNIQUE et INEXISTANT (« dépôt absent »…) —
    /// la suppression de fin de test reste garantie.
    pub(crate) fn new_absent(label: &str) -> Self {
        Self::new_with(label, false)
    }

    fn new_with(label: &str, create: bool) -> Self {
        let path = std::env::temp_dir().join(format!("{}-{}", label, unique_suffix()));
        // Un résidu d'une exécution interrompue portant le même nom est
        // impossible (suffixe unique), mais on repart d'un état propre par
        // principe.
        let _ = std::fs::remove_dir_all(&path);
        if create {
            std::fs::create_dir_all(&path).expect("création du répertoire temporaire de test");
        }
        TempDir { path }
    }

    /// Chemin en `String` (pour les API qui attendent un `&str`).
    pub(crate) fn str(&self) -> String {
        self.path.to_string_lossy().to_string()
    }
}

impl std::ops::Deref for TempDir {
    type Target = Path;
    fn deref(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        // `remove_dir_all` sur un chemin déjà absent est une erreur `NotFound`
        // sans conséquence : le nettoyage est idempotent et ne panique jamais.
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// Prend un verrou de test en RÉCUPÉRANT sa contamination (`PoisonError`).
///
/// Un test qui panique en tenant le verrou (par exemple en changeant
/// `GIT_CONFIG_GLOBAL`) empoisonnait le mutex : tous les tests suivants
/// échouaient à leur tour sur `lock().unwrap()`. Un échec doit rester LOCAL au
/// test qui échoue, jamais contaminer la suite.
pub(crate) fn lock_unpoisoned<T>(m: &'static Mutex<T>) -> MutexGuard<'static, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}
