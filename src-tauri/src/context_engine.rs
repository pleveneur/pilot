// context_engine.rs — Context Engine V2 (RAG local via embeddings Ollama)
//
// Voir spec_context_engine.md §7. Indexe le projet en chunks vectoriels dans
// SQLite (.pilot/context-index.db) et renvoie les passages les plus pertinents
// par similarité cosinus au prompt.
//
// Implémentation synchrone (reqwest::blocking + rusqlite) pour éviter les
// contraintes Send des commandes async Tauri (rusqlite::Connection n'est pas
// Send à cause d'un RefCell interne). Les commandes Tauri sync s'exécutent sur
// le threadpool dédié de Tauri → ne figent pas l'UI.
//
// Robustesse : toute erreur (Ollama injoignable, index corrompu, modèle absent)
// est propagée à l'appelant qui retombe sur V1 heuristique — aucune panne.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};

// ── Constantes ───────────────────────────────────────────────────────────────

const CHUNK_LINES: usize = 60;
const CHUNK_OVERLAP: usize = 10;
const MAX_FILE_BYTES: usize = 512 * 1024;
const EMBED_BATCH: usize = 64;
const MAX_QUERY_CHUNKS: usize = 40;
const MIN_SCORE: f32 = 0.10;
// Limite du refresh incrémental dans le chemin critique du prompt : on ne
// re-indexe qu'un petit nombre de fichiers les plus récents pour ne jamais
// retarder l'envoi du prompt (Ollama lent/indisponible → fallback V1 rapide).
const MAX_REFRESH_FILES_PER_QUERY: usize = 20;

const INDEXED_EXT: &[&str] = &[
    "js", "ts", "mjs", "jsx", "tsx", "py", "md", "markdown", "rs", "json",
    "toml", "css", "html", "go", "java", "c", "cpp", "h", "hpp", "yaml", "yml",
    "txt", "sh", "sql", "vue", "svelte",
];

const IGNORE_DIRS: &[&str] = &[
    "node_modules", "target", ".git", "dist", "build", ".next", ".nuxt",
    ".venv", "venv", "__pycache__", ".pilot", "vendor", ".cache", "out",
    "coverage", ".idea", ".vscode", "deps",
];

// ── Types ────────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct Chunk {
    start_line: usize,
    end_line: usize,
    content: String,
}

#[derive(Serialize, Clone)]
pub struct IndexStatus {
    pub exists: bool,
    pub chunks: usize,
    pub model: String,
    pub built_at: String,
    pub ready: bool,
}

#[derive(Serialize, Clone)]
pub struct BuildStats {
    pub chunks: usize,
    pub files: usize,
    pub elapsed_ms: u64,
}

#[derive(Serialize, Clone)]
pub struct QueryResult {
    pub context: String,
    pub chunks_used: usize,
    pub source: String, // "rag" | "v1-fallback"
}

#[derive(Serialize, Clone)]
pub struct ProbeResult {
    pub ok: bool,
    pub dim: usize,
    pub error: Option<String>,
}

// ── Utilitaires ──────────────────────────────────────────────────────────────

fn index_db_path(project_path: &str) -> PathBuf {
    Path::new(project_path).join(".pilot").join("context-index.db")
}

fn file_mtime(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn file_hash(content: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(content);
    let bytes = h.finalize();
    let mut s = String::with_capacity(16);
    for b in bytes.iter().take(8) {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

fn is_indexed(name: &str) -> bool {
    let ext = name.rsplit('.').next().map(|e| e.to_lowercase()).unwrap_or_default();
    INDEXED_EXT.contains(&ext.as_str())
}

/// Fichiers racine déjà injectés par d'autres canaux → exclus de l'indexation
/// RAG (anti-doublon) : `AGENTS.md` est découvert/injecté nativement par pi/plh,
/// `PROJECT_MEMORY.md` est injecté séparément par H3 (`buildMemoryBlock`). Le V1
/// exclut déjà AGENTS.md ; le RAG doit faire de même pour les deux.
fn is_excluded_from_rag(name: &str) -> bool {
    name == "AGENTS.md" || name == "PROJECT_MEMORY.md"
}

fn is_ignored_dir(name: &str) -> bool {
    IGNORE_DIRS.contains(&name) || name.starts_with('.')
}

fn walk_project(root: &Path) -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    walk_rec(root, root, &mut out);
    out
}

fn walk_rec(root: &Path, dir: &Path, out: &mut Vec<(String, PathBuf)>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            if is_ignored_dir(&name) { continue; }
            walk_rec(root, &path, out);
        } else if path.is_file() {
            if is_excluded_from_rag(&name) { continue; }
            if !is_indexed(&name) { continue; }
            if let Ok(meta) = fs::metadata(&path) {
                if meta.len() as usize > MAX_FILE_BYTES { continue; }
            }
            let rel = path.strip_prefix(root)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| name.clone());
            out.push((rel, path));
        }
    }
}

// ── Chunking ─────────────────────────────────────────────────────────────────

fn chunk_file(rel: &str, content: &str) -> Vec<Chunk> {
    let lines: Vec<&str> = content.lines().collect();
    if lines.is_empty() { return Vec::new(); }
    let is_md = rel.ends_with(".md") || rel.ends_with(".markdown");
    if is_md {
        chunk_markdown(&lines)
    } else {
        chunk_by_lines(&lines, CHUNK_LINES, CHUNK_OVERLAP)
    }
}

fn chunk_by_lines(lines: &[&str], size: usize, overlap: usize) -> Vec<Chunk> {
    let mut chunks = Vec::new();
    if lines.is_empty() { return chunks; }
    let step = if size > overlap { size - overlap } else { 1 };
    let mut start = 0;
    while start < lines.len() {
        let end = (start + size).min(lines.len());
        let content = lines[start..end].join("\n");
        chunks.push(Chunk {
            start_line: start + 1,
            end_line: end,
            content,
        });
        if end >= lines.len() { break; }
        start += step;
    }
    chunks
}

fn chunk_markdown(lines: &[&str]) -> Vec<Chunk> {
    let mut chunks = Vec::new();
    let mut section_start = 0;
    for (i, line) in lines.iter().enumerate() {
        let is_heading = line.trim_start().starts_with('#');
        if is_heading && i > section_start {
            push_md_section(&mut chunks, &lines[section_start..i], section_start);
            section_start = i;
        }
    }
    if section_start < lines.len() {
        push_md_section(&mut chunks, &lines[section_start..], section_start);
    }
    chunks
}

fn push_md_section(chunks: &mut Vec<Chunk>, section: &[&str], offset: usize) {
    if section.iter().all(|l| l.trim().is_empty()) { return; }
    if section.len() > CHUNK_LINES {
        for mut c in chunk_by_lines(section, CHUNK_LINES, CHUNK_OVERLAP) {
            c.start_line += offset;
            c.end_line += offset;
            chunks.push(c);
        }
    } else {
        chunks.push(Chunk {
            start_line: offset + 1,
            end_line: offset + section.len(),
            content: section.join("\n"),
        });
    }
}

// ── Embeddings (Ollama, blocking) ────────────────────────────────────────────

fn vec_to_blob(v: &[f32]) -> Vec<u8> {
    let mut buf = Vec::with_capacity(v.len() * 4);
    for &f in v {
        buf.extend_from_slice(&f.to_le_bytes());
    }
    buf
}

fn blob_to_vec(b: &[u8]) -> Vec<f32> {
    b.chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

fn http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        // connect_timeout court : un port local fermé (Ollama éteint) répond
        // vite, on ne veut jamais attendre des dizaines de secondes pour
        // établir une connexion.
        .connect_timeout(std::time::Duration::from_secs(3))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("http client: {e}"))
}

/// Client HTTP à timeout encore plus court pour le chemin critique du prompt
/// (query_context_index). Garantit que la requête de contexte ne gèle jamais
/// l'envoi du prompt : en cas de timeout, l'appelant retombe sur V1.
fn http_fast_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(2))
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| format!("http fast client: {e}"))
}

/// Appelle Ollama /api/embed (batch) puis fallback /api/embeddings (un par un).
fn embed_batch(client: &reqwest::blocking::Client, endpoint: &str, model: &str, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
    let url = format!("{}/api/embed", endpoint.trim_end_matches('/'));
    let body = serde_json::json!({ "model": model, "input": texts });
    let resp = client.post(&url).json(&body).send();
    match resp {
        Ok(r) if r.status().is_success() => {
            let v: serde_json::Value = r.json().map_err(|e| format!("embed parse: {e}"))?;
            let arr = v.get("embeddings").and_then(|e| e.as_array())
                .ok_or_else(|| "réponse /api/embed sans 'embeddings'".to_string())?;
            arr.iter().map(|row| {
                row.as_array().ok_or_else(|| "ligne embedding non-array".to_string())?
                    .iter().map(|x| x.as_f64().map(|f| f as f32).ok_or_else(|| "valeur non-float".to_string()))
                    .collect::<Result<Vec<f32>, _>>()
            }).collect()
        }
        Ok(r) if r.status().as_u16() == 404 => embed_legacy(client, endpoint, model, texts),
        Ok(r) => Err(format!("Ollama /api/embed HTTP {}", r.status())),
        Err(_) => embed_legacy(client, endpoint, model, texts),
    }
}

fn embed_legacy(client: &reqwest::blocking::Client, endpoint: &str, model: &str, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
    let url = format!("{}/api/embeddings", endpoint.trim_end_matches('/'));
    let mut out = Vec::with_capacity(texts.len());
    for t in texts {
        let body = serde_json::json!({ "model": model, "prompt": t });
        let resp = client.post(&url).json(&body).send()
            .map_err(|e| format!("Ollama injoignable ({e})"))?;
        if !resp.status().is_success() {
            return Err(format!("Ollama /api/embeddings HTTP {}", resp.status()));
        }
        let v: serde_json::Value = resp.json().map_err(|e| format!("embeddings parse: {e}"))?;
        let arr = v.get("embedding").and_then(|e| e.as_array())
            .ok_or_else(|| "réponse sans 'embedding'".to_string())?;
        let vec: Vec<f32> = arr.iter()
            .map(|x| x.as_f64().map(|f| f as f32).ok_or_else(|| "valeur non-float".to_string()))
            .collect::<Result<Vec<_>, _>>()?;
        out.push(vec);
    }
    Ok(out)
}

fn embed_one(client: &reqwest::blocking::Client, endpoint: &str, model: &str, text: &str) -> Result<Vec<f32>, String> {
    let mut v = embed_batch(client, endpoint, model, &[text.to_string()])?;
    if v.is_empty() { return Err("embedding vide".into()); }
    Ok(v.remove(0))
}

// ── SQLite ───────────────────────────────────────────────────────────────────

fn open_db(db_path: &Path) -> Result<Connection, String> {
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir .pilot: {e}"))?;
    }
    let conn = Connection::open(db_path).map_err(|e| format!("open db: {e}"))?;
    conn.busy_timeout(std::time::Duration::from_secs(10))
        .map_err(|e| format!("busy_timeout: {e}"))?;
    // Mode WAL : autorise les lectures concurrentes pendant une écriture (build
    // arrière-plan + query simultanée sans "database is locked").
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| format!("pragma WAL: {e}"))?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS chunks (
            id INTEGER PRIMARY KEY,
            path TEXT NOT NULL,
            start_line INTEGER NOT NULL,
            end_line INTEGER NOT NULL,
            content TEXT NOT NULL,
            file_hash TEXT NOT NULL,
            mtime INTEGER NOT NULL,
            embedding BLOB NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);",
    ).map_err(|e| format!("init schema: {e}"))?;
    Ok(conn)
}

fn meta_get(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM meta WHERE key = ?1", rusqlite::params![key], |r| r.get(0)).ok()
}

fn meta_set(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES (?1, ?2)", rusqlite::params![key, value])
        .map_err(|e| format!("meta set: {e}"))?;
    Ok(())
}

fn count_chunks(conn: &Connection) -> usize {
    conn.query_row("SELECT COUNT(*) FROM chunks", [], |r| r.get::<_, i64>(0)).unwrap_or(0) as usize
}

fn delete_file_chunks(conn: &Connection, rel: &str) -> Result<(), String> {
    conn.execute("DELETE FROM chunks WHERE path = ?1", rusqlite::params![rel])
        .map_err(|e| format!("delete chunks: {e}"))?;
    Ok(())
}

fn insert_chunks(conn: &Connection, rel: &str, file_hash: &str, mtime: u64, chunks: &[Chunk], embeddings: &[Vec<f32>]) -> Result<(), String> {
    let mut stmt = conn.prepare(
        "INSERT INTO chunks(path, start_line, end_line, content, file_hash, mtime, embedding)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    ).map_err(|e| format!("prepare insert: {e}"))?;
    for (ch, emb) in chunks.iter().zip(embeddings.iter()) {
        stmt.execute(rusqlite::params![
            rel, ch.start_line as i64, ch.end_line as i64, ch.content, file_hash, mtime as i64, vec_to_blob(emb)
        ]).map_err(|e| format!("insert chunk: {e}"))?;
    }
    Ok(())
}

fn indexed_files(conn: &Connection) -> HashMap<String, u64> {
    let mut stmt = match conn.prepare("SELECT path, MAX(mtime) FROM chunks GROUP BY path") {
        Ok(s) => s,
        Err(_) => return HashMap::new(),
    };
    let rows = stmt.query_map([], |r| {
        let path: String = r.get(0)?;
        let mtime: i64 = r.get(1).unwrap_or(0);
        Ok((path, mtime as u64))
    });
    rows.map(|i| i.filter_map(|x| x.ok()).collect()).unwrap_or_default()
}

fn all_chunks(conn: &Connection) -> Vec<(String, usize, usize, String, Vec<f32>)> {
    let mut stmt = match conn.prepare("SELECT path, start_line, end_line, content, embedding FROM chunks") {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let rows = stmt.query_map([], |r| {
        let blob: Vec<u8> = r.get(4)?;
        Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as usize, r.get::<_, i64>(2)? as usize, r.get::<_, String>(3)?, blob))
    });
    rows.map(|i| i.filter_map(|x| x.ok())
        .map(|(p, s, e, c, b)| (p, s, e, c, blob_to_vec(&b)))
        .collect())
        .unwrap_or_default()
}

// ── Indexation d'un fichier ──────────────────────────────────────────────────

/// Indexe un fichier : read + chunk + embed + insert.
fn index_file(conn: &Connection, client: &reqwest::blocking::Client, rel: &str, abs: &Path, endpoint: &str, model: &str) -> Result<usize, String> {
    let mut buf = Vec::new();
    fs::File::open(abs).and_then(|mut f| f.read_to_end(&mut buf))
        .map_err(|e| format!("read {rel}: {e}"))?;
    let content = String::from_utf8_lossy(&buf).to_string();
    let hash = file_hash(&buf);
    let mtime = file_mtime(abs);
    let chunks = chunk_file(rel, &content);
    if chunks.is_empty() {
        delete_file_chunks(conn, rel)?;
        return Ok(0);
    }
    let mut all_emb = Vec::with_capacity(chunks.len());
    for batch in chunks.chunks(EMBED_BATCH) {
        let texts: Vec<String> = batch.iter().map(|c| c.content.clone()).collect();
        let emb = embed_batch(client, endpoint, model, &texts)?;
        all_emb.extend(emb);
    }
    if all_emb.len() != chunks.len() {
        return Err(format!("embedding count mismatch ({}/{})", all_emb.len(), chunks.len()));
    }
    delete_file_chunks(conn, rel)?;
    insert_chunks(conn, rel, &hash, mtime, &chunks, &all_emb)?;
    Ok(chunks.len())
}

// ── Build complet ────────────────────────────────────────────────────────────

fn build_index_blocking(app: &AppHandle, project_path: &str, endpoint: &str, model: &str) -> Result<BuildStats, String> {
    let t0 = std::time::Instant::now();
    let root = Path::new(project_path);
    let files = walk_project(root);
    let total = files.len();
    let db_path = index_db_path(project_path);
    let conn = open_db(&db_path)?;
    conn.execute("DELETE FROM chunks", []).map_err(|e| format!("clear: {e}"))?;
    meta_set(&conn, "model", model)?;
    let client = http_client()?;
    let mut done = 0usize;
    let mut chunks_total = 0usize;
    for (rel, abs) in &files {
        match index_file(&conn, &client, rel, abs, endpoint, model) {
            Ok(n) => chunks_total += n,
            Err(e) => eprintln!("[context-engine] skip {rel}: {e}"),
        }
        done += 1;
        let _ = app.emit("context-index-progress", serde_json::json!({ "done": done, "total": total }));
    }
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    meta_set(&conn, "built_at", &now.to_string())?;
    Ok(BuildStats { chunks: chunks_total, files: done, elapsed_ms: t0.elapsed().as_millis() as u64 })
}

// ── Refresh incrémental ──────────────────────────────────────────────────────

fn incremental_refresh(conn: &Connection, client: &reqwest::blocking::Client, project_path: &str, endpoint: &str, model: &str, max_files: usize) {
    let root = Path::new(project_path);
    let disk_files = walk_project(root);
    let disk_set: HashSet<&str> = disk_files.iter().map(|(r, _)| r.as_str()).collect();
    let indexed = indexed_files(conn);
    // 1. Supprimer les fichiers disparus
    for rel in indexed.keys() {
        if !disk_set.contains(rel.as_str()) {
            let _ = delete_file_chunks(conn, rel);
        }
    }
    // 2. Re-indexer les modifiés / nouveaux, en triant par mtime décroissant
    //    (les plus récents d'abord) et en s'arrêtant à max_files. Borné pour
    //    ne jamais retarder le prompt dans le chemin critique.
    let mut to_refresh: Vec<(String, PathBuf, u64)> = disk_files.iter()
        .filter_map(|(rel, abs)| {
            let disk_mtime = file_mtime(abs);
            let need = indexed.get(rel).map_or(true, |prev| *prev != disk_mtime);
            if need { Some((rel.clone(), abs.clone(), disk_mtime)) } else { None }
        })
        .collect();
    to_refresh.sort_by(|a, b| b.2.cmp(&a.2));
    for (rel, abs, _) in to_refresh.into_iter().take(max_files) {
        if let Err(e) = index_file(conn, client, &rel, &abs, endpoint, model) {
            eprintln!("[context-engine] refresh skip {rel}: {e}");
        }
    }
}

// ── Cosinus + Query ──────────────────────────────────────────────────────────

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let n = a.len().min(b.len());
    if n == 0 { return 0.0; }
    let mut dot = 0.0f32;
    let mut na = 0.0f32;
    let mut nb = 0.0f32;
    for i in 0..n {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if na == 0.0 || nb == 0.0 { return 0.0; }
    dot / (na.sqrt() * nb.sqrt())
}

fn estimate_tokens(s: &str) -> usize {
    (s.len() as f32 / 3.5).ceil() as usize
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunk_by_lines_respects_size_and_overlap() {
        let lines = vec!["l0", "l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8", "l9",
                         "l10", "l11", "l12", "l13", "l14", "l15", "l16", "l17", "l18", "l19"];
        let chunks = chunk_by_lines(&lines, 8, 2);
        // 20 lignes, step = 6 → chunk 0 [0..8], 1 [6..14], 2 [12..20]
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].start_line, 1);
        assert_eq!(chunks[0].end_line, 8);
        assert_eq!(chunks[1].start_line, 7); // 6+1 (offset ligne)
        assert_eq!(chunks[2].end_line, 20);
        assert!(chunks[0].content.contains("l0"));
        assert!(chunks[1].content.contains("l6"));
        assert!(chunks[2].content.contains("l19"));
    }

    #[test]
    fn chunk_by_lines_empty() {
        assert!(chunk_by_lines(&[], 8, 2).is_empty());
    }

    #[test]
    fn chunk_markdown_splits_on_headings() {
        let src = ["# Intro", "a", "b", "## Detail", "c", "### Sous", "d"];
        let chunks = chunk_markdown(&src);
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].start_line, 1); // # Intro … b
        assert_eq!(chunks[0].end_line, 3);
        assert_eq!(chunks[1].start_line, 4); // ## Detail … c
        assert_eq!(chunks[1].end_line, 5);
        assert_eq!(chunks[2].start_line, 6); // ### Sous … d
        assert_eq!(chunks[2].end_line, 7);
        assert!(chunks[0].content.contains("# Intro"));
        assert!(chunks[1].content.contains("## Detail"));
    }

    #[test]
    fn push_md_section_skips_blank_section() {
        let mut chunks = Vec::new();
        push_md_section(&mut chunks, &[], 0);
        push_md_section(&mut chunks, &["", "  "], 0);
        assert!(chunks.is_empty());
    }

    #[test]
    fn cosine_identical_is_one_and_orthogonal_zero() {
        let a = [1.0, 0.0, 2.0];
        let b = [1.0, 0.0, 2.0];
        let o = [0.0, 1.0, 0.0];
        assert!((cosine(&a, &b) - 1.0).abs() < 1e-5);
        assert!((cosine(&a, &o)).abs() < 1e-5);
    }

    #[test]
    fn cosine_empty_vectors_is_zero() {
        assert_eq!(cosine(&[], &[]), 0.0);
        assert_eq!(cosine(&[0.0, 0.0], &[1.0, 1.0]), 0.0);
    }

    #[test]
    fn blob_roundtrip_preserves_floats() {
        let v = [0.25f32, -1.5, 3.0, 0.0];
        let blob = vec_to_blob(&v);
        let back = blob_to_vec(&blob);
        assert_eq!(back, v);
    }

    #[test]
    fn estimate_tokens_grows_with_length() {
        assert!(estimate_tokens("x") >= 1);
        assert!(estimate_tokens(&"a".repeat(350)) > estimate_tokens("a"));
    }

    #[test]
    fn is_indexed_and_ignored() {
        assert!(is_indexed("main.rs"));
        assert!(is_indexed("README.md"));
        assert!(!is_indexed("image.png"));
        assert!(!is_indexed("archive.zip"));
        assert!(is_ignored_dir("node_modules"));
        assert!(is_ignored_dir(".git"));
        assert!(!is_ignored_dir("src"));
    }

    #[test]
    fn rag_excludes_agents_and_project_memory() {
        // AGENTS.md et PROJECT_MEMORY.md sont déjà injectés par d'autres canaux
        // (pi natif / H3) → exclus de l'indexation RAG (anti-doublon).
        assert!(is_excluded_from_rag("AGENTS.md"));
        assert!(is_excluded_from_rag("PROJECT_MEMORY.md"));
        // Les autres fichiers .md restent indexés.
        assert!(!is_excluded_from_rag("README.md"));
        assert!(!is_excluded_from_rag("spec_pilot.md"));
        assert!(!is_excluded_from_rag("main.rs"));
    }

    #[test]
    fn file_hash_is_stable_and_short() {
        let h1 = file_hash(b"hello");
        let h2 = file_hash(b"hello");
        let h3 = file_hash(b"world");
        assert_eq!(h1, h2);
        assert_ne!(h1, h3);
        assert_eq!(h1.len(), 16);
    }

    #[test]
    fn chunk_file_picks_markdown_vs_lines() {
        let md = "# T\na\n## S\nb";
        assert_eq!(chunk_file("doc.md", md).len(), 2);
        // Fichier non-markdown → un seul chunk par lignes.
        let txt = "a\nb\nc";
        assert_eq!(chunk_file("notes.txt", txt).len(), 1);
    }

    #[test]
    fn query_source_falls_back_before_any_network_when_db_missing() {
        // Sans DB, query_index_blocking retourne v1-fallback sans toucher au
        // réseau : le prompt ne doit jamais dépendre d'Ollama pour partir.
        let tmp = std::env::temp_dir().join(format!("ctx-fallback-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let _ = std::fs::create_dir_all(&tmp);
        let res = query_index_blocking(tmp.to_str().unwrap(), "prompt", 1000, "http://127.0.0.1:9", "m")
            .unwrap();
        assert_eq!(res.source, "v1-fallback");
        assert!(res.context.is_empty());
        let _ = std::fs::remove_dir_all(&tmp);
    }
}

fn query_index_blocking(project_path: &str, prompt: &str, budget_tokens: usize, endpoint: &str, model: &str) -> Result<QueryResult, String> {
    let db_path = index_db_path(project_path);
    if !db_path.exists() {
        return Ok(QueryResult { context: String::new(), chunks_used: 0, source: "v1-fallback".into() });
    }
    let conn = open_db(&db_path)?;
    if count_chunks(&conn) == 0 {
        return Ok(QueryResult { context: String::new(), chunks_used: 0, source: "v1-fallback".into() });
    }
    let client = http_fast_client()?;
    // 1. Embedder le prompt AVANT tout refresh : c'est le seul appel bloquant
    //    du chemin critique. Timeout court (8s). Si Ollama ne répond pas
    //    (éteint), on retombe immédiatement sur V1 SANS refresh — le prompt
    //    n'est jamais retardé par la ré-indexation.
    let q_vec = match embed_one(&client, endpoint, model, prompt) {
        Ok(v) => v,
        Err(e) => return Ok(QueryResult { context: String::new(), chunks_used: 0, source: format!("v1-fallback:{e}") }),
    };
    // 2. Ollama répond → refresh incrémental LIMITÉ (au plus MAX_REFRESH_FILES
    //    fichiers récents) pour rafraîchir un peu l'index sans retarder le
    //    prompt. Jamais bloquant : si un fichier échoue, on passe au suivant.
    incremental_refresh(&conn, &client, project_path, endpoint, model, MAX_REFRESH_FILES_PER_QUERY);
    let chunks = all_chunks(&conn);
    if chunks.is_empty() {
        return Ok(QueryResult { context: String::new(), chunks_used: 0, source: "v1-fallback".into() });
    }
    let mut scored: Vec<(f32, String, usize, usize, String)> = chunks.into_iter()
        .map(|(p, s, e, c, v)| (cosine(&q_vec, &v), p, s, e, c))
        .collect();
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    let mut out = String::new();
    let mut used = 0usize;
    let mut tokens = 0usize;
    for (score, path, start, end, content) in &scored {
        if *score < MIN_SCORE { break; }
        let block = format!("### {} (l. {}-{}, score {:.2})\n{}\n\n", path, start, end, score, content);
        let bt = estimate_tokens(&block);
        if tokens + bt > budget_tokens { break; }
        out.push_str(&block);
        tokens += bt;
        used += 1;
        if used >= MAX_QUERY_CHUNKS { break; }
    }
    if used == 0 {
        return Ok(QueryResult { context: String::new(), chunks_used: 0, source: "v1-fallback".into() });
    }
    Ok(QueryResult { context: out, chunks_used: used, source: "rag".into() })
}

// ── Probe / Status ───────────────────────────────────────────────────────────

fn rag_probe_blocking(endpoint: &str, model: &str) -> ProbeResult {
    let client = match http_client() {
        Ok(c) => c,
        Err(e) => return ProbeResult { ok: false, dim: 0, error: Some(e) },
    };
    match embed_one(&client, endpoint, model, "probe") {
        Ok(v) => ProbeResult { ok: true, dim: v.len(), error: None },
        Err(e) => ProbeResult { ok: false, dim: 0, error: Some(e) },
    }
}

pub fn index_status(project_path: &str) -> IndexStatus {
    let db_path = index_db_path(project_path);
    let exists = db_path.exists();
    if !exists {
        return IndexStatus { exists: false, chunks: 0, model: String::new(), built_at: String::new(), ready: false };
    }
    let conn = match open_db(&db_path) {
        Ok(c) => c,
        Err(_) => return IndexStatus { exists: true, chunks: 0, model: String::new(), built_at: String::new(), ready: false },
    };
    let chunks = count_chunks(&conn);
    let model = meta_get(&conn, "model").unwrap_or_default();
    let built_at = meta_get(&conn, "built_at").unwrap_or_default()
        .parse::<u64>().map(|ms| {
            chrono::DateTime::from_timestamp_millis(ms as i64)
                .map(|d| d.format("%Y-%m-%d %H:%M").to_string())
                .unwrap_or_default()
        }).unwrap_or_default();
    IndexStatus { exists: true, chunks, model, built_at, ready: chunks > 0 }
}

// ── Commandes Tauri (sync) ───────────────────────────────────────────────────

#[tauri::command]
pub fn context_rag_probe(endpoint: String, model: String) -> Result<ProbeResult, String> {
    Ok(rag_probe_blocking(&endpoint, &model))
}

#[tauri::command]
pub fn context_index_status(project_path: String) -> Result<IndexStatus, String> {
    Ok(index_status(&project_path))
}

/// Build complet. Sync (bloquant) — s'exécute sur le threadpool Tauri, n'fige
/// pas l'UI. Émet "context-index-progress" pendant le build, "context-index-done"
/// à la fin (succès ou échec) et retourne les stats.
#[tauri::command]
pub fn build_context_index(app: AppHandle, project_path: String, endpoint: String, model: String) -> Result<BuildStats, String> {
    let res = build_index_blocking(&app, &project_path, &endpoint, &model);
    match &res {
        Ok(stats) => {
            let _ = app.emit("context-index-done", serde_json::json!({
                "ok": true,
                "stats": { "chunks": stats.chunks, "files": stats.files, "elapsed_ms": stats.elapsed_ms }
            }));
        }
        Err(e) => {
            let _ = app.emit("context-index-done", serde_json::json!({ "ok": false, "error": e }));
        }
    }
    res
}

#[tauri::command]
pub fn query_context_index(project_path: String, prompt: String, budget_tokens: u32, endpoint: String, model: String) -> Result<QueryResult, String> {
    query_index_blocking(&project_path, &prompt, budget_tokens as usize, &endpoint, &model)
}

#[tauri::command]
pub fn context_index_clear(project_path: String) -> Result<(), String> {
    let db = index_db_path(&project_path);
    if db.exists() { fs::remove_file(&db).map_err(|e| format!("remove db: {e}"))?; }
    Ok(())
}