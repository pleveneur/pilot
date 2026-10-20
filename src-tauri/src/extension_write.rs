//! Écriture FIABLE des fichiers embarqués (extensions pi) sur disque.
//!
//! Défaut corrigé (tâche 361) : le motif `std::fs::write(&file, content).is_ok()`
//! **avalait** l'échec d'écriture. Étant donné une extension restée en **lecture
//! seule** (ou verrouillée) sur disque, l'écriture échouait en silence, l'ancien
//! fichier — périmé, voire cassé — était **conservé** puis passé en
//! `--extension` au processus pi. À l'installation d'une nouvelle version, un
//! agent pouvait donc tourner avec des outils périmés (incident 0.4.31 : plus
//! d'outils de lancement d'agents pour l'assistant).
//!
//! Stratégie, dans cet ordre :
//! 1. **contenu déjà identique** sur disque → aucune écriture (évite les
//!    réécritures inutiles, donc les verrous et l'usure du disque) ;
//! 2. **écriture directe** ;
//! 3. échec → **retrait de l'attribut « lecture seule »** puis nouvelle
//!    tentative. L'attribut est modifiable côté Rust sur toutes les
//!    plateformes (`std::fs::Permissions::set_readonly`) : sous Windows il
//!    correspond à `FILE_ATTRIBUTE_READONLY`, sous Unix au bit d'écriture du
//!    mode du fichier ;
//! 4. échec → **écriture dans un fichier temporaire** du MÊME dossier puis
//!    **remplacement de la cible**. On ne s'appuie PAS sur un renommage
//!    par-dessus une cible en lecture seule : ce cas n'est pas documenté comme
//!    fonctionnel sur toutes les plateformes (voir la limite mesurée dans
//!    `RAPPORT-361-extensions.md`). La cible est donc retirée (après retrait de
//!    la lecture seule) avant le renommage ;
//! 5. **vérification finale** : le contenu relu doit être identique à celui
//!    embarqué, sinon `Err`. Un succès n'est jamais annoncé sur un fichier
//!    douteux.
//!
//! Toute erreur est **retournée** à l'appelant (`Result` / [`BatchReport`]) et
//! journalisée : plus aucun échec silencieux.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Résultat d'une écriture réussie.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WriteOutcome {
    /// Le fichier sur disque contenait déjà exactement le contenu embarqué :
    /// rien n'a été écrit.
    Unchanged,
    /// Le fichier a été (ré)écrit avec le contenu embarqué.
    Written,
}

/// Rapport d'écriture d'un lot de fichiers embarqués.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct BatchReport {
    /// Chemins des fichiers **réellement à jour** sur disque. Un fichier dont
    /// l'écriture a échoué n'y figure JAMAIS : on ne passe pas à pi un fichier
    /// périmé ou douteux.
    pub paths: Vec<String>,
    /// Échecs, sous la forme `nom : raison`. Jamais avalés.
    pub failures: Vec<String>,
    /// Nombre de fichiers dont le contenu était déjà identique (aucune
    /// écriture effectuée).
    pub unchanged: usize,
}

impl BatchReport {
    /// `true` si tous les fichiers ont été écrits (ou étaient déjà à jour).
    pub(crate) fn is_complete(&self) -> bool {
        self.failures.is_empty()
    }

    /// Résumé lisible des échecs (journaux, message d'erreur remonté).
    pub(crate) fn failure_summary(&self) -> String {
        self.failures.join(" ; ")
    }

}

/// Compteur monotone : garantit un nom de fichier temporaire unique même pour
/// deux écritures lancées dans la même nanoseconde (spawns d'agents parallèles).
static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Chemin d'un fichier temporaire VOISIN de la cible (même dossier : le
/// renommage final reste atomique et ne traverse aucun système de fichiers).
fn temp_sibling(target: &Path) -> PathBuf {
    let n = TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let name = target
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "extension".to_string());
    target.with_file_name(format!(".{}.{}-{}-{}.tmp", name, std::process::id(), n, nanos))
}

/// Retire l'attribut « lecture seule » de la cible.
///
/// Retourne `Ok(true)` si l'attribut a été retiré, `Ok(false)` s'il n'y avait
/// rien à retirer (fichier absent ou déjà inscriptible), `Err` si le retrait
/// lui-même échoue (droits insuffisants…).
fn clear_readonly(target: &Path) -> Result<bool, String> {
    let meta = match std::fs::metadata(target) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(format!("métadonnées illisibles ({})", e)),
    };
    let mut perms = meta.permissions();
    if !perms.readonly() {
        return Ok(false);
    }
    perms.set_readonly(false);
    std::fs::set_permissions(target, perms)
        .map_err(|e| format!("retrait de la lecture seule refusé ({})", e))?;
    Ok(true)
}

/// Vérifie que le contenu relu est EXACTEMENT celui attendu.
fn verify(target: &Path, content: &str) -> Result<(), String> {
    match std::fs::read(target) {
        Ok(bytes) if bytes == content.as_bytes() => Ok(()),
        Ok(_) => Err(format!(
            "contenu relu différent du contenu embarqué ({})",
            target.display()
        )),
        Err(e) => Err(format!("relecture impossible ({})", e)),
    }
}

/// Écrit `content` dans `target` de façon fiable.
///
/// Ne réécrit rien si le contenu est déjà identique. En cas d'obstacle
/// (lecture seule, verrou), tente les contournements décrits dans la
/// documentation du module. Retourne une erreur EXPLICITE si le fichier n'a pas
/// pu être mis à jour et vérifié.
pub(crate) fn write_embedded(target: &Path, content: &str) -> Result<WriteOutcome, String> {
    // 1. Déjà à jour : aucune écriture (ni verrou pris, ni date modifiée).
    if matches!(std::fs::read(target), Ok(existing) if existing == content.as_bytes()) {
        return Ok(WriteOutcome::Unchanged);
    }

    let mut last_err;

    // 2. Écriture directe.
    match std::fs::write(target, content) {
        Ok(()) => return verify(target, content).map(|()| WriteOutcome::Written),
        Err(e) => last_err = format!("écriture directe refusée ({})", e),
    }

    // 3. Retrait de l'attribut « lecture seule » puis nouvelle tentative.
    match clear_readonly(target) {
        Ok(true) => match std::fs::write(target, content) {
            Ok(()) => return verify(target, content).map(|()| WriteOutcome::Written),
            Err(e) => {
                last_err = format!(
                    "{} ; écriture après retrait de la lecture seule refusée ({})",
                    last_err, e
                )
            }
        },
        Ok(false) => {}
        Err(e) => last_err = format!("{} ; {}", last_err, e),
    }

    // 4. Fichier temporaire voisin puis remplacement de la cible.
    let tmp = temp_sibling(target);
    if let Err(e) = std::fs::write(&tmp, content) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!(
            "{} ; écriture temporaire impossible ({})",
            last_err, e
        ));
    }
    // La cible est retirée avant le renommage : un `rename` par-dessus une
    // cible en lecture seule n'est pas garanti (cf. doc du module).
    let _ = clear_readonly(target);
    if target.exists() {
        if let Err(e) = std::fs::remove_file(target) {
            let _ = std::fs::remove_file(&tmp);
            return Err(format!(
                "{} ; remplacement impossible (suppression de la cible refusée : {})",
                last_err, e
            ));
        }
    }
    if let Err(e) = std::fs::rename(&tmp, target) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!(
            "{} ; renommage du fichier temporaire refusé ({})",
            last_err, e
        ));
    }
    verify(target, content).map(|()| WriteOutcome::Written)
}

/// Écrit un lot de fichiers embarqués `(nom, contenu)` dans `dir`.
///
/// Chaque échec est journalisé et **remonté** dans [`BatchReport::failures`] ;
/// le fichier concerné n'apparaît pas dans [`BatchReport::paths`], donc aucun
/// chemin périmé n'est transmis à pi. Le dossier `dir` est supposé exister
/// (les appelants le créent ; un dossier absent produit un échec explicite).
pub(crate) fn write_embedded_batch(dir: &Path, files: &[(&str, &str)]) -> BatchReport {
    let mut report = BatchReport::default();
    for (name, content) in files {
        let target = dir.join(name);
        match write_embedded(&target, content) {
            Ok(WriteOutcome::Unchanged) => {
                report.unchanged += 1;
                report.paths.push(target.to_string_lossy().to_string());
            }
            Ok(WriteOutcome::Written) => {
                report.paths.push(target.to_string_lossy().to_string());
            }
            Err(e) => {
                // Jamais silencieux : visible dans les journaux ET dans le rapport.
                eprintln!("[extensions] {} non écrite : {}", target.display(), e);
                report.failures.push(format!("{} : {}", name, e));
            }
        }
    }
    report
}

#[cfg(test)]
mod tests {
    //! Tests PURS (aucun accès à `~/.pilot`, aucun processus pi) : tout se passe
    //! dans un répertoire temporaire unique et auto-nettoyé.

    use super::*;
    use crate::test_util::TempDir;

    /// (a) Un fichier resté en LECTURE SEULE est bien remplacé par le contenu
    /// embarqué (cas exact de l'incident 0.4.31).
    #[test]
    fn fichier_en_lecture_seule_est_remplace() {
        let dir = TempDir::new("pilot-ext-ro");
        let target = dir.join("pilot-choices.ts");
        std::fs::write(&target, "ANCIEN CONTENU PERIME").expect("écriture initiale");
        let mut perms = std::fs::metadata(&target).expect("métadonnées").permissions();
        perms.set_readonly(true);
        std::fs::set_permissions(&target, perms).expect("passage en lecture seule");
        assert!(
            std::fs::metadata(&target).expect("métadonnées").permissions().readonly(),
            "le test doit partir d'un fichier réellement en lecture seule"
        );

        let outcome = write_embedded(&target, "NOUVEAU CONTENU EMBARQUE").expect("remplacement attendu");

        assert_eq!(outcome, WriteOutcome::Written);
        assert_eq!(
            std::fs::read_to_string(&target).expect("relecture"),
            "NOUVEAU CONTENU EMBARQUE",
            "le fichier périmé doit être REMPLACÉ (jamais conservé)"
        );
        assert_ne!(
            std::fs::read_to_string(&target).expect("relecture"),
            "ANCIEN CONTENU PERIME",
            "aucun contenu périmé ne doit subsister"
        );
    }

    /// (b) Un échec d'écriture est REMONTÉ (jamais avalé) et ne laisse aucun
    /// fichier temporaire derrière lui.
    #[test]
    fn echec_ecriture_est_remonte_et_nettoie() {
        let dir = TempDir::new("pilot-ext-err");
        let target = dir.join("pilot-choices.ts");
        // Une CIBLE qui n'est pas un fichier : aucune écriture ne peut aboutir.
        std::fs::create_dir(&target).expect("cible en dossier");

        let err = write_embedded(&target, "CONTENU").expect_err("un échec doit être retourné");

        assert!(!err.is_empty(), "le message d'erreur doit être explicite : {err}");
        assert!(target.is_dir(), "la cible n'a pas été remplacée par un fichier");
        let leftovers: Vec<String> = std::fs::read_dir(&*dir)
            .expect("lecture du dossier")
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temporaires laissés sur disque : {:?}", leftovers);
    }

    /// (c) Un contenu déjà identique n'est PAS réécrit (fichier en lecture seule
    /// et date de modification inchangée : aucune écriture n'a eu lieu).
    #[test]
    fn contenu_identique_n_est_pas_reecrit() {
        let dir = TempDir::new("pilot-ext-idem");
        let target = dir.join("pilot-skills.ts");
        std::fs::write(&target, "MEME CONTENU").expect("écriture initiale");
        let mut perms = std::fs::metadata(&target).expect("métadonnées").permissions();
        perms.set_readonly(true);
        std::fs::set_permissions(&target, perms).expect("passage en lecture seule");
        let before = std::fs::metadata(&target).expect("métadonnées").modified().ok();

        let outcome = write_embedded(&target, "MEME CONTENU").expect("aucune écriture attendue");

        assert_eq!(outcome, WriteOutcome::Unchanged);
        let after_meta = std::fs::metadata(&target).expect("métadonnées");
        assert_eq!(before, after_meta.modified().ok(), "la date de modification ne doit pas changer");
        assert_eq!(std::fs::read_to_string(&target).expect("relecture"), "MEME CONTENU");
    }

    /// Le lot remonte les échecs ET n'expose jamais le chemin d'un fichier
    /// périmé : l'appelant ne peut pas le passer en `--extension`.
    #[test]
    fn lot_remonte_les_echecs_sans_exposer_le_fichier_perime() {
        let dir = TempDir::new("pilot-ext-batch");
        // Une extension en lecture seule et périmée, une extension impossible à
        // écrire (cible = dossier), une extension neuve.
        let ro = dir.join("pilot-choices.ts");
        std::fs::write(&ro, "PERIME").expect("écriture initiale");
        let mut perms = std::fs::metadata(&ro).expect("métadonnées").permissions();
        perms.set_readonly(true);
        std::fs::set_permissions(&ro, perms).expect("lecture seule");
        let broken = dir.join("pilot-assistant-actions.ts");
        std::fs::create_dir(&broken).expect("cible en dossier");

        let files = [
            ("pilot-choices.ts", "A JOUR"),
            ("pilot-assistant-actions.ts", "A JOUR"),
            ("pilot-assistant-tools.ts", "A JOUR"),
        ];
        let report = write_embedded_batch(&dir, &files);

        assert!(!report.is_complete(), "le lot doit signaler un échec");
        assert_eq!(report.failures.len(), 1, "un seul fichier en échec : {:?}", report.failures);
        assert!(
            report.failures[0].starts_with("pilot-assistant-actions.ts"),
            "l'échec doit nommer le fichier : {:?}",
            report.failures
        );
        assert!(
            !report.paths.iter().any(|p| p.ends_with("pilot-assistant-actions.ts")),
            "un fichier non écrit ne doit JAMAIS être transmis : {:?}",
            report.paths
        );
        assert_eq!(report.paths.len(), 2);
        assert_eq!(std::fs::read_to_string(&ro).expect("relecture"), "A JOUR");
    }

    /// Le lot est idempotent : un second passage ne réécrit rien.
    #[test]
    fn lot_idempotent_ne_reecrit_rien() {
        let dir = TempDir::new("pilot-ext-idem-batch");
        let files = [("pilot-context.ts", "CONTEXTE"), ("pilot-skills.ts", "SKILLS")];
        let first = write_embedded_batch(&dir, &files);
        assert!(first.is_complete());
        assert_eq!(first.paths.len(), 2);
        assert_eq!(first.unchanged, 0);

        let second = write_embedded_batch(&dir, &files);
        assert!(second.is_complete());
        assert_eq!(second.unchanged, 2, "les deux fichiers étaient déjà à jour");
        assert_eq!(second.paths, first.paths);
    }
}
