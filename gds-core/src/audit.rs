// audit.rs — Journal d'audit du serveur web distant (mode remote) — socle partagé
//
// Extrait de `src-tauri/src/web_audit.rs` (refonte GDS, L1.7) : le serveur GDS
// autonome (`gds-server`) journalise les mêmes actions sensibles que le mode
// remote du desk. Aucune dépendance Tauri : le chemin du fichier est fourni de
// l'extérieur (`set_file`).
//
// Complément du rate limiting : trace les actions sensibles effectuées depuis
// un client distant (login, prompt, abort, new, compact, set_model,
// project_open/create, ws_open, kick, set_password, file_save/create/meta,
// rate_limited). Permet au desktop de superviser l'usage distant.
//
// Modèle :
//   - Ring buffer en mémoire (capacité CAPACITY=500, FIFO) pour l'affichage
//     desktop via `recent(n)` — rapide, non bloquant.
//   - **Persistance disque** (append-only JSONL) : chaque entrée est ajoutée à
//     `web_audit.jsonl` dans le dossier de config (`app_data_dir`). Au démarrage
//     (`set_file`), on recharge les CAPACITY dernières entrées dans le ring
//     buffer et on rotate le fichier s'il dépasse MAX_FILE_BYTES. `clear()`
//     vide aussi l'archive disque (sinon l'historique réapparaîtrait au reboot).
//   - Rotation : si le fichier dépasse MAX_FILE_BYTES (2 Mo), on le réécrit en
//     ne gardant que les ROTATE_KEEP (1000) dernières lignes. Borné entre
//     sessions et en session longue (check metadata à chaque `record`).
//   - `record()` reste rapide : append d'une ligne + check metadata (stat);
//     la rotation (read+rewrite) ne se déclenche que rarement.
//
// Confidentialité : le fichier contient des IPs et des token-keys (hashés).
// Il vit dans `app_data_dir` (permissions utilisateur). Les logs OS/Tailscale
// restent la source forensic de référence ; ce fichier est un complément
// pratique pour le superviseur.

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const CAPACITY: usize = 500;
/// Taille max du fichier JSONL avant rotation (2 Mo).
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
/// Nombre de lignes conservées après rotation.
const ROTATE_KEEP: usize = 1000;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AuditEntry {
    /// Timestamp epoch en millisecondes.
    pub ts: u64,
    /// IP source du client distant, ou chaîne vide si inconnue.
    pub ip: String,
    /// Hash court du token (identifie la session), ou vide pour login/kick.
    pub subject: String,
    /// Code action : "login" | "prompt" | "abort" | "new" | "compact"
    /// | "set_model" | "project_open" | "project_create" | "ws_open" | "ws_close"
    /// | "kick" | "set_password" | "rate_limited" | "file_save" | "file_create"
    /// | "file_meta" | "tracking_create" | "tracking_update" | "tracking_delete"
    /// | "tracking_list" | "admin_denied".
    /// Les actions de suivi fusionné (GDS Phase C1.5) portent le détail
    /// "<entité>:<clé>" (ex: "clients:Acme", "tasks:42").
    pub action: String,
    /// Détail court (ex: "127 car.", "provider/model", chemin projet/fichier).
    pub detail: String,
    /// true si l'action a réussi, false sinon (échec auth, refus readonly…).
    pub ok: bool,
}

/// Vrai si l'entrée passe le filtre du journal (L4.5). Pure — testable.
///
/// * `actions` : liste d'actions exactes à retenir (vide = aucune restriction) ;
/// * `q` : recherche libre insensible à la casse sur l'action, le détail, l'IP
///   et le sujet (vide = aucune restriction).
pub fn entry_matches(entry: &AuditEntry, actions: &[String], q: &str) -> bool {
    if !actions.is_empty() && !actions.iter().any(|a| a == &entry.action) {
        return false;
    }
    let needle = q.trim().to_lowercase();
    if needle.is_empty() {
        return true;
    }
    let haystack = format!(
        "{} {} {} {}",
        entry.action, entry.detail, entry.ip, entry.subject
    )
    .to_lowercase();
    haystack.contains(&needle)
}

/// Actions de « connexion / administration » retenues par défaut par le journal
/// de l'écran d'administration (L4.5). Le poste peut demander « tout » en
/// passant une liste vide. Pure — testable.
pub fn admin_actions() -> Vec<String> {
    [
        "login",
        "set_password",
        "kick",
        "admin_denied",
        "write_denied",
        "rate_limited",
        "user_create",
        "user_role",
        "user_status",
        "user_password",
        "user_validate",
        "users_list",
        "project_assign",
        "project_unassign",
        "project_remove",
        "project_remove_purge",
        "ssh_key_revoke",
        // Cycle de vie du service (L2.10) : redémarrage / arrêt du service GDS.
        "service_restart",
        "service_stop",
        "project_create",
        "project_open",
        "project_select",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

pub struct WebAudit {
    entries: Mutex<VecDeque<AuditEntry>>,
    /// Chemin du fichier JSONL (None tant que `set_file` n'a pas été appelé).
    file: Mutex<Option<PathBuf>>,
}

impl WebAudit {
    pub fn new() -> Self {
        Self {
            entries: Mutex::new(VecDeque::with_capacity(CAPACITY)),
            file: Mutex::new(None),
        }
    }

    /// Active la persistance disque : charge l'historique JSONL dans le ring
    /// buffer (CAPACITY dernières entrées) et rotate le fichier si trop gros.
    /// À appeler une fois au démarrage (depuis le setup Tauri), avant toute
    /// requête web, pour ne perdre aucune entrée.
    pub fn set_file(&self, path: PathBuf) {
        // 1. Charger l'historique disque dans le ring buffer.
        let loaded = load_from_disk(&path);
        {
            let mut e = self.entries.lock().unwrap();
            // Au démarrage le ring buffer est vide : on prend l'historique disque.
            // Garde défensive : si des entrées RAM existent déjà (set_file tardif),
            // on ne les écrase pas pour éviter toute perte.
            if e.is_empty() {
                *e = loaded;
            }
        }
        // 2. Rotation si le fichier dépasse la taille max.
        rotate_if_needed(&path);
        // 3. Activer l'append pour les futures entrées.
        *self.file.lock().unwrap() = Some(path);
    }

    /// Enregistre une entrée d'audit : push dans le ring buffer (FIFO plafonnée)
    /// + append JSONL sur disque si `set_file` a été appelé.
    pub fn record(&self, ip: &str, subject: &str, action: &str, detail: &str, ok: bool) {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let entry = AuditEntry {
            ts,
            ip: ip.to_string(),
            subject: subject.to_string(),
            action: action.to_string(),
            detail: detail.to_string(),
            ok,
        };
        {
            let mut e = self.entries.lock().unwrap();
            if e.len() >= CAPACITY {
                e.pop_front();
            }
            e.push_back(entry.clone());
        }
        // Persistance disque (append-only) sous lock file : sérialise les IO
        // (append court + rotate rare) pour éviter qu'une rotation concurrente ne
        // corrompe le fichier. Le lock entries est déjà relâché, donc `recent()`/
        // `len()` restent non bloqués par l'IO.
        let file_lock = self.file.lock().unwrap();
        if let Some(path) = file_lock.as_ref() {
            append_line(path, &entry);
            rotate_if_needed(path);
        }
    }

    /// Renvoie les `n` dernières entrées, dans l'ordre chronologique
    /// (plus ancienne d'abord, plus récente en dernier).
    pub fn recent(&self, n: usize) -> Vec<AuditEntry> {
        let e = self.entries.lock().unwrap();
        let start = e.len().saturating_sub(n);
        e.iter().skip(start).cloned().collect()
    }

    /// Page du journal, **plus récentes d'abord**, filtrée (L4.5). `actions` =
    /// liste d'actions exactes à retenir (vide = toutes) ; `q` = recherche libre
    /// insensible à la casse sur l'action, le détail, l'IP et le sujet. Renvoie
    /// `(total_après_filtre, page)` : la pagination est calculée sur le total
    /// filtré, pas sur le tampon entier.
    pub fn page(&self, actions: &[String], q: &str, offset: usize, limit: usize) -> (usize, Vec<AuditEntry>) {
        let e = self.entries.lock().unwrap();
        let matched: Vec<&AuditEntry> = e.iter().filter(|x| entry_matches(x, actions, q)).collect();
        let total = matched.len();
        let page: Vec<AuditEntry> = matched
            .into_iter()
            .rev()
            .skip(offset)
            .take(limit)
            .cloned()
            .collect();
        (total, page)
    }

    /// Vide le journal (bouton « Effacer le journal ») : ring buffer **et**
    /// archive disque (sinon l'historique réapparaîtrait au prochain démarrage).
    pub fn clear(&self) {
        self.entries.lock().unwrap().clear();
        let file_lock = self.file.lock().unwrap();
        if let Some(path) = file_lock.as_ref() {
            let _ = fs::remove_file(path);
        }
    }

    /// Nombre d'entrées actuellement stockées en mémoire.
    pub fn len(&self) -> usize {
        self.entries.lock().unwrap().len()
    }
}

// ── Fonctions de persistance (fichier JSONL) ──

/// Charge les entrées depuis un fichier JSONL, en ne gardant que les
/// `CAPACITY` dernières (ordre chronologique). Ignore silencieusement les
/// lignes illisibles (robustesse aux écritures partielles / crash).
fn load_from_disk(path: &Path) -> VecDeque<AuditEntry> {
    let mut deque = VecDeque::with_capacity(CAPACITY);
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return deque, // fichier absent au premier lancement : normal
    };
    for line in content.lines() {
        if line.is_empty() {
            continue;
        }
        if let Ok(e) = serde_json::from_str::<AuditEntry>(line) {
            if deque.len() >= CAPACITY {
                deque.pop_front();
            }
            deque.push_back(e);
        }
    }
    deque
}

/// Ajoute une entrée en fin de fichier JSONL (create + append).
fn append_line(path: &Path, entry: &AuditEntry) {
    let line = match serde_json::to_string(entry) {
        Ok(l) => l,
        Err(_) => return,
    };
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{}", line);
    }
}

/// Si le fichier dépasse `MAX_FILE_BYTES`, le réécrit en ne gardant que les
/// `ROTATE_KEEP` dernières lignes (bornage entre sessions et en session longue).
fn rotate_if_needed(path: &Path) {
    let len = match fs::metadata(path) {
        Ok(md) => md.len(),
        Err(_) => return,
    };
    if len <= MAX_FILE_BYTES {
        return;
    }
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return,
    };
    let lines: Vec<&str> = content.lines().filter(|l| !l.is_empty()).collect();
    if lines.len() <= ROTATE_KEEP {
        return; // peu de lignes mais fichier gros (lignes très longues) : on garde tout
    }
    let keep_from = lines.len() - ROTATE_KEEP;
    let mut out = String::with_capacity(content.len() / 2);
    for l in &lines[keep_from..] {
        out.push_str(l);
        out.push('\n');
    }
    let _ = fs::write(path, out);
}
#[cfg(test)]
mod tests {
    use super::*;

    fn entry(action: &str, detail: &str) -> AuditEntry {
        AuditEntry {
            ts: 1,
            ip: "10.0.0.1".to_string(),
            subject: "sub".to_string(),
            action: action.to_string(),
            detail: detail.to_string(),
            ok: true,
        }
    }

    #[test]
    fn entry_matches_restricts_on_exact_actions() {
        let actions = vec!["login".to_string()];
        assert!(entry_matches(&entry("login", "ok"), &actions, ""));
        assert!(!entry_matches(&entry("project_remove", "x"), &actions, ""));
        // Liste vide = aucune restriction d'action.
        assert!(entry_matches(&entry("project_remove", "x"), &[], ""));
    }

    #[test]
    fn entry_matches_free_search_is_case_insensitive() {
        let e = entry("project_remove_purge", "42:Alpha");
        assert!(entry_matches(&e, &[], "alpha"));
        assert!(entry_matches(&e, &[], "10.0.0.1"));
        assert!(entry_matches(&e, &[], "PURGE"));
        assert!(!entry_matches(&e, &[], "beta"));
        // Espaces ignorés.
        assert!(entry_matches(&e, &[], "  alpha  "));
    }

    #[test]
    fn admin_actions_cover_logins_and_admin_events() {
        let a = admin_actions();
        for expected in [
            "login",
            "user_create",
            "project_remove_purge",
            "ssh_key_revoke",
            "admin_denied",
        ] {
            assert!(a.iter().any(|x| x == expected), "{} manquant", expected);
        }
        // Aucune action purement métier (prompt) dans le filtre d'administration.
        assert!(!a.iter().any(|x| x == "prompt"));
    }

    #[test]
    fn page_filters_paginates_and_is_newest_first() {
        let a = WebAudit::new();
        a.record("ip", "s", "login", "d1", true);
        a.record("ip", "s", "prompt", "d2", true);
        a.record("ip", "s", "login", "d3", true);
        let (total, page) = a.page(&["login".to_string()], "", 0, 10);
        assert_eq!(total, 2);
        // Plus récent d'abord : d3 avant d1.
        assert_eq!(page[0].detail, "d3");
        assert_eq!(page[1].detail, "d1");
        // Pagination calculée sur le total filtré.
        let (total, page) = a.page(&["login".to_string()], "", 1, 1);
        assert_eq!(total, 2);
        assert_eq!(page.len(), 1);
        assert_eq!(page[0].detail, "d1");
        // Aucune restriction : les 3 entrées, plus récentes d'abord.
        let (total, page) = a.page(&[], "", 0, 10);
        assert_eq!(total, 3);
        assert_eq!(page[0].action, "login");
    }
}
