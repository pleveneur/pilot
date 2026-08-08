// code_graph.rs — Code Graph (graphe de connaissances projet)
//
// Voir spec_code_graph.md. Construit un graphe structurel du projet (nœuds =
// fichiers/fonctions/classes/imports, arêtes = calls/imports/inherits/
// references) stocké dans SQLite (.pilot/context-index.db), puis offre des
// requêtes pour l'injection dans le contexte agent : explain (voisins d'un
// nœud), affected (analyse d'impact par traversée inverse), path (plus court
// chemin), query (scoring par termes + BFS). Inspiré de graphify.
//
// Implémentation synchrone (même pattern que context_engine.rs : rusqlite +
// reqwest::blocking ne sont pas Send pour les commandes async). Les commandes
// Tauri sync s'exécutent sur le threadpool → ne figent pas l'UI.
//
// V1 = extraction heuristique (regex), sans dépendance tree-sitter. Les limites
// (faux positifs, scoping approximatif) sont assumées ; V2 passera à tree-sitter.
// Robuste : toute erreur retourne un résultat vide / graphe absent, jamais une panne.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

// Verrou global des accès SQLite du graphe. Le build complet (commande Tauri),
// le refresh du watcher (thread du poller, V2.1) et la query (au 1er prompt)
// peuvent s'exécuter en parallèle → rusqlite lèverait "database is locked" en
// écriture concurrente. Ce Mutex sérialise les accès (écritures + requêtes).
static GRAPH_DB_LOCK: Mutex<()> = Mutex::new(());

// Constantes ───────────────────────────────────────────────────────────────

const MAX_FILE_BYTES: usize = 512 * 1024;
const MAX_REFRESH_FILES_PER_QUERY: usize = 30;
const DEFAULT_BUDGET: usize = 4000;
// Profondeur max de l'AST parcouru par `walk_v2` (garde-fou anti stack overflow,
// indépendamment de la taille de pile du thread). La profondeur typique du code
// réel est < 50 ; 512 est très généreux.
const MAX_AST_DEPTH: usize = 512;

// Extensions reconnues pour l'extraction de graphe (code + docs + manifests).
const GRAPH_EXT: &[&str] = &[
    "js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx", "py", "rs", "go",
    "java", "c", "cpp", "h", "hpp", "md", "markdown", "json", "toml",
];

const IGNORE_DIRS: &[&str] = &[
    "node_modules", "target", ".git", "dist", "build", ".next", ".nuxt",
    ".venv", "venv", "__pycache__", ".pilot", "vendor", ".cache", "out",
    "coverage", ".idea", ".vscode", "deps",
];

// ── Types ────────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct NodeDef {
    id: String,          // identifiant canonique (path + kind + nom)
    label: String,       // nom lisible
    kind: String,        // file | module | class | function | method | import
    path: String,        // fichier source (relatif)
    line: i64,           // ligne de définition (0 si n/a)
}

#[derive(Clone)]
struct EdgeDef {
    source: String,
    target: String,
    relation: String,    // calls | imports | inherits | references | uses
    confidence: String,  // EXTRACTED | INFERRED
    path: String,
}

#[derive(Serialize, Clone)]
pub struct GraphStatus {
    pub exists: bool,
    pub nodes: usize,
    pub edges: usize,
    pub built_at: String,
    pub ready: bool,
}

#[derive(Serialize, Clone)]
pub struct GraphBuildStats {
    pub nodes: usize,
    pub edges: usize,
    pub files: usize,
    pub elapsed_ms: u64,
}

#[derive(Serialize, Clone)]
pub struct QueryGraphResult {
    pub context: String,
    pub nodes: usize,
    pub edges: usize,
    pub source: String, // "graph" | "empty"
}

// ── Export complet pour la visualisation (onglet Graphe) ────────────────────

#[derive(Serialize, Clone)]
pub struct GraphNodeView {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub path: String,
    pub line: i64,
}

#[derive(Serialize, Clone)]
pub struct GraphEdgeView {
    pub source: String,
    pub target: String,
    pub relation: String,
    pub confidence: String,
    pub path: String,
}

#[derive(Serialize, Clone)]
pub struct GraphExport {
    pub nodes: Vec<GraphNodeView>,
    pub edges: Vec<GraphEdgeView>,
}

// ── Utilitaires (dupliqués de context_engine.rs — ne pas toucher à l'existant) ─

fn db_path(project_path: &str) -> PathBuf {
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

pub fn is_graph_file(name: &str) -> bool {
    let ext = name.rsplit('.').next().map(|e| e.to_lowercase()).unwrap_or_default();
    GRAPH_EXT.contains(&ext.as_str())
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
            if !is_graph_file(&name) { continue; }
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

fn read_file_content(abs: &Path) -> Option<String> {
    let mut buf = Vec::new();
    fs::File::open(abs).and_then(|mut f| f.read_to_end(&mut buf)).ok()?;
    Some(String::from_utf8_lossy(&buf).to_string())
}

// ── SQLite ───────────────────────────────────────────────────────────────────

fn open_db(db_path: &Path) -> Result<Connection, String> {
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir .pilot: {e}"))?;
    }
    let conn = Connection::open(db_path).map_err(|e| format!("open db: {e}"))?;
    conn.busy_timeout(std::time::Duration::from_secs(10))
        .map_err(|e| format!("busy_timeout: {e}"))?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| format!("pragma WAL: {e}"))?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS graph_nodes (
            id   TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            kind  TEXT NOT NULL,
            path  TEXT NOT NULL,
            line  INTEGER NOT NULL DEFAULT 0,
            file_hash TEXT NOT NULL,
            mtime INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS graph_edges (
            source TEXT NOT NULL,
            target TEXT NOT NULL,
            relation TEXT NOT NULL,
            confidence TEXT NOT NULL,
            path TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_edges_source ON graph_edges(source);
        CREATE INDEX IF NOT EXISTS idx_edges_target ON graph_edges(target);
        CREATE INDEX IF NOT EXISTS idx_nodes_path ON graph_nodes(path);
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

fn count_nodes(conn: &Connection) -> usize {
    conn.query_row("SELECT COUNT(*) FROM graph_nodes", [], |r| r.get::<_, i64>(0)).unwrap_or(0) as usize
}

fn count_edges(conn: &Connection) -> usize {
    conn.query_row("SELECT COUNT(*) FROM graph_edges", [], |r| r.get::<_, i64>(0)).unwrap_or(0) as usize
}

fn file_nodes_hash(conn: &Connection, rel: &str) -> Option<String> {
    conn.query_row(
        "SELECT file_hash FROM graph_nodes WHERE path = ?1 LIMIT 1",
        rusqlite::params![rel],
        |r| r.get::<_, String>(0),
    ).ok()
}

fn delete_file_graph(conn: &Connection, rel: &str) -> Result<(), String> {
    conn.execute("DELETE FROM graph_nodes WHERE path = ?1", rusqlite::params![rel])
        .map_err(|e| format!("del nodes: {e}"))?;
    conn.execute("DELETE FROM graph_edges WHERE path = ?1", rusqlite::params![rel])
        .map_err(|e| format!("del edges: {e}"))?;
    Ok(())
}

fn insert_file_graph(conn: &Connection, _rel: &str, file_hash: &str, mtime: u64, nodes: &[NodeDef], edges: &[EdgeDef]) -> Result<(), String> {
    {
        let mut stmt = conn.prepare(
            "INSERT OR REPLACE INTO graph_nodes(id, label, kind, path, line, file_hash, mtime)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        ).map_err(|e| format!("prep node: {e}"))?;
        for n in nodes {
            stmt.execute(rusqlite::params![n.id, n.label, n.kind, n.path, n.line, file_hash, mtime as i64])
                .map_err(|e| format!("ins node: {e}"))?;
        }
    }
    if !edges.is_empty() {
        let mut stmt = conn.prepare(
            "INSERT OR REPLACE INTO graph_edges(source, target, relation, confidence, path)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        ).map_err(|e| format!("prep edge: {e}"))?;
        for e in edges {
            stmt.execute(rusqlite::params![e.source, e.target, e.relation, e.confidence, e.path])
                .map_err(|e| format!("ins edge: {e}"))?;
        }
    }
    Ok(())
}

fn indexed_files(conn: &Connection) -> HashMap<String, u64> {
    let mut stmt = match conn.prepare("SELECT path, MAX(mtime) FROM graph_nodes GROUP BY path") {
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

// ── Extraction V1 heuristique ────────────────────────────────────────────────

fn detect_lang(rel: &str) -> &'static str {
    let ext = rel.rsplit('.').next().map(|e| e.to_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "js" | "mjs" | "cjs" | "jsx" | "ts" | "mts" | "cts" | "tsx" => "js",
        "py" => "py",
        "rs" => "rs",
        "md" | "markdown" => "md",
        _ => "other",
    }
}

/// Normalise un identifiant de nœud. `file:<path>` pour un fichier, sinon
/// `<kind>:<path>:<nom>`.
fn node_id(kind: &str, path: &str, name: &str) -> String {
    format!("{kind}:{path}:{name}")
}

/// Construit un nom de symbole court (dernier segment d'un path de symbole).
fn short_name(name: &str) -> String {
    name.rsplit('.').next().unwrap_or(name).to_string()
}

/// Construit un label lisible pour un nœud import : dernier segment du chemin,
/// sans l'extension de fichier (ex: `../src/modes/rpc/rpc-client.ts` → `rpc-client`).
/// Contrairement à `short_name`, on ne coupe PAS sur le dernier `.` (qui donnerait
/// `ts` pour `rpc-client.ts`) : on retire seulement une extension de fichier connue.
fn import_label(target: &str) -> String {
    let base = target.rsplit('/').next().unwrap_or(target);
    for ext in ["ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rs", "md", "json", "toml", "css", "scss", "html", "vue", "svelte"] {
        if let Some(stem) = base.strip_suffix(&format!(".{ext}")) {
            return stem.to_string();
        }
    }
    base.to_string()
}

/// Dispatch extraction selon le backend configuré.
fn extract_file(rel: &str, content: &str, extraction: &str) -> (Vec<NodeDef>, Vec<EdgeDef>) {
    if extraction == "treesitter" {
        return extract_v2(rel, content);
    }
    extract_v1(rel, content)
}

/// Extraits les nœuds + arêtes d'un fichier. V1 heuristique par regex.
/// Retourne (nodes, edges). Le nœud `file` est toujours en tête.
fn extract_v1(rel: &str, content: &str) -> (Vec<NodeDef>, Vec<EdgeDef>) {
    let lang = detect_lang(rel);
    let mut nodes: Vec<NodeDef> = Vec::new();
    let mut edges: Vec<EdgeDef> = Vec::new();

    // Nœud fichier
    let file_id = node_id("file", rel, rel);
    nodes.push(NodeDef { id: file_id.clone(), label: rel.to_string(), kind: "file".into(), path: rel.to_string(), line: 1 });

    // Index des symboles définis (par nom) → pour résoudre les references.
    let mut defined: HashMap<String, String> = HashMap::new(); // nom → node id

    let lines: Vec<&str> = content.lines().collect();

    match lang {
        "js" | "py" => {
            // Imports → arêtes file→imports→(nouveau nœud import ou fichier cible)
            for (i, &line) in lines.iter().enumerate() {
                let line_no = (i + 1) as i64;
                if lang == "js" {
                    // import X from '...' / require('...')
                    if let Some(cap) = regex_find(r#"(?:import\s+[^'"\n]*\s+from\s+|require\s*\(\s*)['"]([^'"]+)['"]"#, line) {
                        let target = cap;
                        if target.starts_with('.') || target.starts_with('/') || target.starts_with('#') {
                            let imp_id = node_id("import", rel, &target);
                            nodes.push(NodeDef { id: imp_id.clone(), label: import_label(&target), kind: "import".into(), path: rel.to_string(), line: line_no });
                            edges.push(EdgeDef { source: file_id.clone(), target: imp_id.clone(), relation: "imports".into(), confidence: "EXTRACTED".into(), path: rel.to_string() });
                        }
                    }
                } else {
                    // from .relative import X
                    if let Some(target) = regex_find(r"^\s*from\s+(\.+[\w.]*)\s+import", line) {
                        let imp_id = node_id("import", rel, &target);
                        nodes.push(NodeDef { id: imp_id.clone(), label: import_label(&target), kind: "import".into(), path: rel.to_string(), line: line_no });
                        edges.push(EdgeDef { source: file_id.clone(), target: imp_id.clone(), relation: "imports".into(), confidence: "EXTRACTED".into(), path: rel.to_string() });
                    }
                }

                // Classes / fonctions / méthodes
                if lang == "js" {
                    if let Some(name) = regex_find(r"^\s*(?:export\s+default\s+|export\s+)?(?:async\s+)?(?:function\s+|const\s+)([A-Za-z_$][\w$]*)\s*(?:=|\(|\s*=>)", line) {
                        if name.is_empty() { continue; }
                        let kind = if name.chars().next().map_or(false, |c| c.is_uppercase()) { "class" } else { "function" };
                        let nid = node_id(kind, rel, &name);
                        nodes.push(NodeDef { id: nid.clone(), label: short_name(&name), kind: kind.into(), path: rel.to_string(), line: line_no });
                        edges.push(EdgeDef { source: file_id.clone(), target: nid.clone(), relation: "contains".into(), confidence: "EXTRACTED".into(), path: rel.to_string() });
                        defined.insert(name, nid);
                    } else if let Some(name) = regex_find(r"^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)", line) {
                        let nid = node_id("class", rel, &name);
                        nodes.push(NodeDef { id: nid.clone(), label: short_name(&name), kind: "class".into(), path: rel.to_string(), line: line_no });
                        edges.push(EdgeDef { source: file_id.clone(), target: nid.clone(), relation: "contains".into(), confidence: "EXTRACTED".into(), path: rel.to_string() });
                        defined.insert(name, nid);
                    }
                } else {
                    // python def / class
                    if let Some(name) = regex_find(r"^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)", line) {
                        let nid = node_id("function", rel, &name);
                        nodes.push(NodeDef { id: nid.clone(), label: short_name(&name), kind: "function".into(), path: rel.to_string(), line: line_no });
                        edges.push(EdgeDef { source: file_id.clone(), target: nid.clone(), relation: "contains".into(), confidence: "EXTRACTED".into(), path: rel.to_string() });
                        defined.insert(name, nid);
                    } else if let Some(name) = regex_find(r"^\s*class\s+([A-Za-z_]\w*)", line) {
                        let nid = node_id("class", rel, &name);
                        nodes.push(NodeDef { id: nid.clone(), label: short_name(&name), kind: "class".into(), path: rel.to_string(), line: line_no });
                        edges.push(EdgeDef { source: file_id.clone(), target: nid.clone(), relation: "contains".into(), confidence: "EXTRACTED".into(), path: rel.to_string() });
                        defined.insert(name, nid);
                    }
                }
            }
        }
        "rs" => {
            for (i, &line) in lines.iter().enumerate() {
                let line_no = (i + 1) as i64;
                if let Some(imp) = regex_find(r"^\s*(?:pub\s+)?use\s+([\w:]+)", line) {
                    let imp_id = node_id("import", rel, &imp);
                    nodes.push(NodeDef { id: imp_id.clone(), label: import_label(&imp), kind: "import".into(), path: rel.to_string(), line: line_no });
                    edges.push(EdgeDef { source: file_id.clone(), target: imp_id.clone(), relation: "imports".into(), confidence: "EXTRACTED".into(), path: rel.to_string() });
                } else if let Some(name) = regex_find(r"^\s*(?:pub\s+)?fn\s+([A-Za-z_]\w*)", line) {
                    let nid = node_id("function", rel, &name);
                    nodes.push(NodeDef { id: nid.clone(), label: short_name(&name), kind: "function".into(), path: rel.to_string(), line: line_no });
                    edges.push(EdgeDef { source: file_id.clone(), target: nid.clone(), relation: "contains".into(), confidence: "EXTRACTED".into(), path: rel.to_string() });
                    defined.insert(name, nid);
                } else if let Some(name) = regex_find(r"^\s*(?:pub\s+)?struct\s+([A-Za-z_]\w*)", line) {
                    let nid = node_id("class", rel, &name);
                    nodes.push(NodeDef { id: nid.clone(), label: short_name(&name), kind: "class".into(), path: rel.to_string(), line: line_no });
                    edges.push(EdgeDef { source: file_id.clone(), target: nid.clone(), relation: "contains".into(), confidence: "EXTRACTED".into(), path: rel.to_string() });
                    defined.insert(name, nid);
                }
            }
        }
        "md" => {
            for (i, &line) in lines.iter().enumerate() {
                let line_no = (i + 1) as i64;
                // Liens markdown [label](target.md) → references
                let mut rest = line;
                while let Some(target) = regex_find(r"\[[^\]]*\]\(([^)]+)\)", rest) {
                    let t = target.split('#').next().unwrap_or("").trim().to_string();
                    if !t.is_empty() && !t.starts_with("http") && !t.starts_with("mailto:") {
                        let imp_id = node_id("import", rel, &t);
                        nodes.push(NodeDef { id: imp_id.clone(), label: import_label(&t), kind: "import".into(), path: rel.to_string(), line: line_no });
                        edges.push(EdgeDef { source: file_id.clone(), target: imp_id.clone(), relation: "references".into(), confidence: "EXTRACTED".into(), path: rel.to_string() });
                    }
                    // avancer
                    let pos = line.find(&t).unwrap_or(0) + t.len().max(1);
                    rest = &line[pos.min(line.len())..];
                }
            }
        }
        _ => {}
    }

    // Pass 2 : calls / references simples par nom (INFERRED). On cherche les
    // symboles définis localement dans le fichier et on repère les usages.
    // Pré-calcul de la ligne de définition de chaque symbole : l'ancien code
    // faisait un scan O(nodes) (`nodes.iter().find`) pour CHAQUE (ligne,
    // symbole) → complexité O(lignes × symboles × nœuds), très lente sur les
    // gros fichiers (ex: agent-pi.js ~360 Ko). Le lookup devient O(1).
    let def_line_of: HashMap<&String, i64> = defined.keys()
        .map(|name| (name, nodes.iter().find(|n| n.label == *name).map(|n| n.line).unwrap_or(0)))
        .collect();
    for (i, &line) in lines.iter().enumerate() {
        for name in defined.keys() {
            if name.len() < 2 { continue; }
            // Ignorer la ligne de définition elle-même
            let def_line = def_line_of.get(name).copied().unwrap_or(0);
            if (i + 1) as i64 == def_line { continue; }
            if line.contains(name) {
                if let Some(def_id) = defined.get(name) {
                    if def_id != &file_id {
                        edges.push(EdgeDef { source: node_id("file", rel, rel), target: def_id.clone(), relation: "uses".into(), confidence: "INFERRED".into(), path: rel.to_string() });
                    }
                }
            }
        }
    }

    // Déduplication des nœuds par id (un import répété ne doit créer qu'un nœud)
    let mut seen = HashSet::new();
    nodes.retain(|n| seen.insert(n.id.clone()));

    (nodes, edges)
}

/// Petit helper regex (retourne le 1er groupe, ou le match complet si pas de groupe).
fn regex_find(pattern: &str, text: &str) -> Option<String> {
    let re = regex::Regex::new(pattern).ok()?;
    let caps = re.captures(text)?;
    Some(caps.get(1).or_else(|| caps.get(0)).map(|m| m.as_str().to_string()).unwrap_or_default())
}

// ── Extraction V2 — Tree-sitter (AST précis) ──────────────────────────────────
// V2 = portage de l'idée graphify : parser chaque fichier avec tree-sitter pour
// obtenir des positions exactes, des appels résolus par portée et des héritages
// précis. Backend sélectionné par `graph_extraction` ("heuristic" | "treesitter").
// Robuste : toute erreur retombe sur des nœuds vides, jamais une panne.

/// Choisit la grammaire tree-sitter selon l'extension du fichier.
fn ts_language(rel: &str) -> Option<tree_sitter::Language> {
    let ext = rel.rsplit('.').next().map(|e| e.to_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "js" | "mjs" | "cjs" => Some(tree_sitter_javascript::LANGUAGE.into()),
        "jsx" | "tsx" => Some(tree_sitter_typescript::LANGUAGE_TSX.into()),
        "ts" | "mts" | "cts" => Some(tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()),
        "py" => Some(tree_sitter_python::LANGUAGE.into()),
        "rs" => Some(tree_sitter_rust::LANGUAGE.into()),
        _ => None,
    }
}

/// Import relatif (à résoudre dans le projet) — exclut les modules externes.
fn is_relative_import(s: &str) -> bool {
    s.starts_with('.') || s.starts_with('/') || s.starts_with('#')
}

/// Identifiant de symbole simple (lettre/underscore + alnum/underscore).
fn valid_ident(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c == '_' || c.is_alphabetic() => {}
        _ => return false,
    }
    name.chars().all(|c| c == '_' || c.is_alphanumeric())
}

/// Texte d'un champ d'un nœud tree-sitter (si présent).
fn field_text(node: tree_sitter::Node, field: &str, content: &str) -> Option<String> {
    let child = node.child_by_field_name(field)?;
    child.utf8_text(content.as_bytes()).ok().map(|s| s.to_string())
}

/// Cherche un enfant direct d'un kind donné.
fn find_child_kind<'a>(node: tree_sitter::Node<'a>, kind: &str) -> Option<tree_sitter::Node<'a>> {
    let n = node.child_count();
    for i in 0..n {
        if let Some(c) = node.child(i as u32) {
            if c.kind() == kind { return Some(c); }
        }
    }
    None
}

/// Cherche un descendant (DFS) d'un kind donné.
fn find_descendant_kind<'a>(node: tree_sitter::Node<'a>, kind: &str) -> Option<tree_sitter::Node<'a>> {
    if node.kind() == kind { return Some(node); }
    let n = node.child_count();
    for i in 0..n {
        if let Some(c) = node.child(i as u32) {
            if let Some(f) = find_descendant_kind(c, kind) { return Some(f); }
        }
    }
    None
}

/// Arête `inherits` depuis une classe JS/TS (`extends`).
/// Champ `superclass` (anciennes grammaires) ou nœud `class_heritage` (récent).
fn v2_inherits(node: tree_sitter::Node, rel: &str, class_id: &str, content: &str, edges: &mut Vec<EdgeDef>) {
    let superc = node.child_by_field_name("superclass")
        .or_else(|| find_child_kind(node, "class_heritage")
            .and_then(|h| find_descendant_kind(h, "identifier")));
    if let Some(sn) = superc {
        if let Ok(name) = sn.utf8_text(content.as_bytes()) {
            let tgt = node_id("class", rel, name);
            edges.push(EdgeDef {
                source: class_id.to_string(), target: tgt, relation: "inherits".into(),
                confidence: "INFERRED".into(), path: rel.to_string(),
            });
        }
    }
}

/// Arêtes `inherits` depuis une classe Python (superclasses).
fn v2_inherits_py(node: tree_sitter::Node, rel: &str, class_id: &str, content: &str, edges: &mut Vec<EdgeDef>) {
    if let Some(supers) = node.child_by_field_name("superclasses") {
        let n = supers.child_count();
        for i in 0..n {
            if let Some(c) = supers.child(i as u32) {
                if c.kind() == "identifier" {
                    if let Ok(name) = c.utf8_text(content.as_bytes()) {
                        let tgt = node_id("class", rel, name);
                        edges.push(EdgeDef {
                            source: class_id.to_string(), target: tgt, relation: "inherits".into(),
                            confidence: "INFERRED".into(), path: rel.to_string(),
                        });
                    }
                }
            }
        }
    }
}

/// Arête `calls` pour un call_expression : résolution par portée.
fn v2_call(node: tree_sitter::Node, rel: &str, content: &str, defined: &HashMap<String, String>, container: &Option<String>, edges: &mut Vec<EdgeDef>) {
    let src = container.clone().unwrap_or_else(|| node_id("file", rel, rel));
    if let Some(func) = node.child_by_field_name("function") {
        let fkind = func.kind();
        if fkind == "identifier" {
            // appel direct → cible unique si définie localement → EXTRACTED
            if let Ok(name) = func.utf8_text(content.as_bytes()) {
                if let Some(def_id) = defined.get(name) {
                    if *def_id != src {
                        edges.push(EdgeDef { source: src, target: def_id.clone(), relation: "calls".into(), confidence: "EXTRACTED".into(), path: rel.to_string() });
                    }
                }
            }
        } else if fkind == "member_expression" || fkind == "attribute" || fkind == "field_expression" {
            // obj.method() → méthode résolue si définie localement → INFERRED
            if let Some(prop) = func.child_by_field_name("property") {
                if let Ok(name) = prop.utf8_text(content.as_bytes()) {
                    if let Some(def_id) = defined.get(name) {
                        if *def_id != src {
                            edges.push(EdgeDef { source: src.clone(), target: def_id.clone(), relation: "calls".into(), confidence: "INFERRED".into(), path: rel.to_string() });
                        }
                    }
                }
            }
        }
    }
}

/// Marche récursive sur l'AST : collecte définitions, imports, héritages, appels.
fn walk_v2(node: tree_sitter::Node, lang: &str, rel: &str, file_id: &str, content: &str,
           nodes: &mut Vec<NodeDef>, edges: &mut Vec<EdgeDef>,
           defined: &mut HashMap<String, String>, container: &Option<String>, depth: usize) {
    // Garde anti stack overflow : ne pas descendre au-delà de `MAX_AST_DEPTH`.
    if depth > MAX_AST_DEPTH { return; }
    let kind = node.kind();
    let src = container.clone().unwrap_or_else(|| file_id.to_string());
    let line = (node.start_position().row + 1) as i64;
    let mut new_container = container.clone();

    // ── Définitions (fonctions / classes / méthodes) ──
    let is_func_kind = matches!(kind, "function_declaration" | "generator_function_declaration" | "function_item" | "function_definition" | "method_definition" | "method_signature");
    let is_class_kind = matches!(kind, "class_declaration" | "class_definition" | "struct_item" | "enum_item" | "trait_item" | "union_item");
    if is_func_kind || is_class_kind {
        if let Some(name) = field_text(node, "name", content) {
            if valid_ident(&name) {
                let is_method = kind == "method_definition" || kind == "method_signature"
                    || container.as_ref().map_or(false, |c| c.starts_with("class:"));
                let k = if is_class_kind {
                    "class"
                } else if is_method {
                    "method"
                } else {
                    "function"
                };
                let nid = node_id(k, rel, &name);
                nodes.push(NodeDef { id: nid.clone(), label: name.clone(), kind: k.into(), path: rel.to_string(), line });
                edges.push(EdgeDef { source: src.clone(), target: nid.clone(), relation: "contains".into(), confidence: "EXTRACTED".into(), path: rel.to_string() });
                defined.insert(name, nid.clone());
                new_container = Some(nid.clone());
                if is_class_kind {
                    if kind == "class_declaration" { v2_inherits(node, rel, &nid, content, edges); }
                    if kind == "class_definition" { v2_inherits_py(node, rel, &nid, content, edges); }
                }
            }
        }
    }

    // ── Bloc `impl` Rust : les fonctions dedans deviennent des méthodes ──
    if kind == "impl_item" {
        if let Some(t) = field_text(node, "type", content) {
            if let Some(tid) = defined.get(&t) {
                new_container = Some(tid.clone());
            }
        }
    }

    // ── Imports ──
    match kind {
        "import_statement" => {
            // JS/TS : `import x from 'src'` → champ source ; Python : `import os` → champ name.
            if lang == "js" {
                if let Some(source) = field_text(node, "source", content) {
                    let s = source.trim_matches(|c| c == '\'' || c == '"').to_string();
                    if is_relative_import(&s) {
                        let imp_id = node_id("import", rel, &s);
                        nodes.push(NodeDef { id: imp_id.clone(), label: import_label(&s), kind: "import".into(), path: rel.to_string(), line });
                        edges.push(EdgeDef { source: file_id.to_string(), target: imp_id, relation: "imports".into(), confidence: "EXTRACTED".into(), path: rel.to_string() });
                    }
                }
            } else if lang == "py" {
                if let Some(name) = field_text(node, "name", content) {
                    if is_relative_import(&name) {
                        let imp_id = node_id("import", rel, &name);
                        nodes.push(NodeDef { id: imp_id.clone(), label: import_label(&name), kind: "import".into(), path: rel.to_string(), line });
                        edges.push(EdgeDef { source: file_id.to_string(), target: imp_id, relation: "imports".into(), confidence: "EXTRACTED".into(), path: rel.to_string() });
                    }
                }
            }
        }
        "import_from_statement" => {
            if let Some(module) = field_text(node, "module_name", content) {
                if is_relative_import(&module) {
                    let imp_id = node_id("import", rel, &module);
                    nodes.push(NodeDef { id: imp_id.clone(), label: import_label(&module), kind: "import".into(), path: rel.to_string(), line });
                    edges.push(EdgeDef { source: file_id.to_string(), target: imp_id, relation: "imports".into(), confidence: "EXTRACTED".into(), path: rel.to_string() });
                }
            }
        }
        "use_declaration" => {
            if let Some(arg) = field_text(node, "argument", content) {
                if !arg.is_empty() {
                    let imp_id = node_id("import", rel, &arg);
                    nodes.push(NodeDef { id: imp_id.clone(), label: import_label(&arg), kind: "import".into(), path: rel.to_string(), line });
                    edges.push(EdgeDef { source: file_id.to_string(), target: imp_id, relation: "imports".into(), confidence: "EXTRACTED".into(), path: rel.to_string() });
                }
            }
        }
        _ => {}
    }

    // ── Appels (calls) ──
    if kind == "call_expression" || kind == "call" {
        v2_call(node, rel, content, defined, container, edges);
    }

    // ── Récursion sur les enfants ──
    let count = node.child_count();
    for i in 0..count {
        if let Some(child) = node.child(i as u32) {
            walk_v2(child, lang, rel, file_id, content, nodes, edges, defined, &new_container, depth + 1);
        }
    }
}

/// Extraction V2 — parser l'AST tree-sitter et produire nœuds + arêtes.
fn extract_v2(rel: &str, content: &str) -> (Vec<NodeDef>, Vec<EdgeDef>) {
    let mut nodes: Vec<NodeDef> = Vec::new();
    let mut edges: Vec<EdgeDef> = Vec::new();
    let file_id = node_id("file", rel, rel);
    nodes.push(NodeDef { id: file_id.clone(), label: rel.to_string(), kind: "file".into(), path: rel.to_string(), line: 1 });

    let Some(lang) = ts_language(rel) else { return (nodes, edges); };
    let mut parser = tree_sitter::Parser::new();
    if parser.set_language(&lang).is_err() { return (nodes, edges); }
    let Some(tree) = parser.parse(content, None) else { return (nodes, edges); };

    let lang = detect_lang(rel);
    let mut defined: HashMap<String, String> = HashMap::new();
    walk_v2(tree.root_node(), lang, rel, &file_id, content, &mut nodes, &mut edges, &mut defined, &None, 0);

    // Déduplication des nœuds par id
    let mut seen = HashSet::new();
    nodes.retain(|n| seen.insert(n.id.clone()));

    (nodes, edges)
}


// ── Build / Refresh ──────────────────────────────────────────────────────────

/// Refresh incrémental déclenché par le watcher de fichiers (V2.1).
/// Ne construit pas le graphe s'il est absent (c'est le build lazy frontend qui
/// le fait au 1er prompt). Retourne le nombre de nœuds indexés après refresh.
pub fn refresh_by_watcher(project_path: &str, max_files: usize) -> usize {
    let path = project_path.to_string();
    run_on_big_stack("code-graph-watcher", move || {
        Ok(refresh_by_watcher_inner(&path, max_files))
    }).unwrap_or(0)
}

fn refresh_by_watcher_inner(project_path: &str, max_files: usize) -> usize {
    let _guard = GRAPH_DB_LOCK.lock().unwrap();
    let dbp = db_path(project_path);
    if !dbp.exists() { return 0; }
    let conn = match open_db(&dbp) {
        Ok(c) => c,
        Err(_) => return 0,
    };
    // Graphe pas encore construit → ne rien faire (évite un build au démarrage).
    if meta_get(&conn, "graph_built_at").unwrap_or_default().is_empty() { return 0; }
    if count_nodes(&conn) == 0 { return 0; }
    let extraction = meta_get(&conn, "graph_extraction").unwrap_or_else(|| "heuristic".to_string());
    let include_calls = meta_get(&conn, "graph_include_calls").map_or(true, |v| v == "1");
    let t0 = std::time::Instant::now();
    incremental_refresh(&conn, project_path, max_files, &extraction, include_calls);
    eprintln!("[code-graph] watcher refresh: {} nodes ({}ms)", count_nodes(&conn), t0.elapsed().as_millis());
    count_nodes(&conn)
}

/// Exécute une closure dans un thread à grande pile (évite le stack overflow).
/// L'extraction V2 (tree-sitter) récurse profondément sur la pile du thread — le
/// parser C ET `walk_v2` — et les threads du threadpool Tauri ont une petite pile
/// par défaut (~1 Mo) → sur les gros fichiers (ex: agent-pi.js ~360 Ko, 73 000
/// nœuds) le build provoquait un stack overflow (0xc0000409).
fn run_on_big_stack<T: Send + 'static>(name: &str, f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    let handle = std::thread::Builder::new()
        .name(name.into())
        .stack_size(64 * 1024 * 1024)
        .spawn(f)
        .map_err(|e| format!("code-graph: spawn {name} thread: {e}"))?;
    handle.join().map_err(|_| format!("code-graph: {name} thread panicked"))?
}

fn build_graph_blocking(app: &AppHandle, project_path: &str) -> Result<GraphBuildStats, String> {
    let _guard = GRAPH_DB_LOCK.lock().unwrap();
    let app = app.clone();
    let project_path = project_path.to_string();
    run_on_big_stack("code-graph-build", move || build_graph_blocking_inner(&app, &project_path))
}

/// Corps réel du build (exécuté sur la grande pile par `build_graph_blocking`).
fn build_graph_blocking_inner(app: &AppHandle, project_path: &str) -> Result<GraphBuildStats, String> {
    let t0 = std::time::Instant::now();
    // Backend d'extraction (V1 heuristic | V2 treesitter) + inclusion des arêtes
    // `calls`, lus depuis AppState.config — AppConfig n'est PAS un state Tauri
    // géré directement (`app.state::<AppConfig>()` paniquerait « before manage »),
    // c'est un champ Mutex de AppState (même pattern que les autres commandes).
    let (extraction, include_calls) = {
        let state = app.state::<crate::AppState>();
        let config = state.config.lock().unwrap();
        (config.graph_extraction.clone(), config.graph_include_calls)
    };
    let root = Path::new(project_path);
    let files = walk_project(root);
    let total = files.len();
    let conn = open_db(&db_path(project_path))?;
    conn.execute("DELETE FROM graph_nodes", []).map_err(|e| format!("clear nodes: {e}"))?;
    conn.execute("DELETE FROM graph_edges", []).map_err(|e| format!("clear edges: {e}"))?;

    let mut done = 0usize;
    let mut nodes_total = 0usize;
    let mut edges_total = 0usize;
    for (rel, abs) in &files {
        match index_file_graph(&conn, rel, abs, &extraction, include_calls) {
            Ok((n, e)) => { nodes_total += n; edges_total += e; }
            Err(e) => eprintln!("[code-graph] skip {rel}: {e}"),
        }
        done += 1;
        if done % 10 == 0 || done == total {
            let _ = app.emit("graph-build-progress", serde_json::json!({ "done": done, "total": total, "file": rel }));
        }
    }
    // Résoudre les imports → arêtes inter-fichiers (fichier → fichier cible).
    let file_set: HashSet<String> = files.iter().map(|(r, _)| r.clone()).collect();
    let cross = refresh_cross_file_imports(&conn, &file_set)?;
    edges_total += cross;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    meta_set(&conn, "graph_built_at", &now.to_string())?;
    meta_set(&conn, "graph_extraction", &extraction)?;
    meta_set(&conn, "graph_include_calls", if include_calls { "1" } else { "0" })?;
    Ok(GraphBuildStats { nodes: nodes_total, edges: edges_total, files: done, elapsed_ms: t0.elapsed().as_millis() as u64 })
}

fn index_file_graph(conn: &Connection, rel: &str, abs: &Path, extraction: &str, include_calls: bool) -> Result<(usize, usize), String> {
    let content = read_file_content(abs).unwrap_or_default();
    let hash = file_hash(content.as_bytes());
    let mtime = file_mtime(abs);
    let (nodes, mut edges) = extract_file(rel, &content, extraction);
    // `graph_include_calls=false` → on ne stocke pas les arêtes `calls`
    // (allègement du sous-graphe injecté → économie de tokens).
    if !include_calls {
        edges.retain(|e| e.relation != "calls");
    }
    if nodes.is_empty() {
        delete_file_graph(conn, rel)?;
        return Ok((0, 0));
    }
    delete_file_graph(conn, rel)?;
    insert_file_graph(conn, rel, &hash, mtime, &nodes, &edges)?;
    Ok((nodes.len(), edges.len()))
}

/// Résout un chemin d'import relatif vers un fichier réel du projet.
/// Retourne le chemin relatif normalisé si trouvé, sinon None.
fn resolve_import_target(importing_rel: &str, target: &str, files: &HashSet<String>) -> Option<String> {
    let importing_dir = Path::new(importing_rel).parent().unwrap_or(Path::new(""));
    let base = importing_dir.join(target);
    // Essayer le chemin tel quel, puis avec chaque extension connue.
    let mut candidates = vec![base.clone()];
    for ext in ["js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx", "py", "rs", "md", "json", "toml"] {
        candidates.push(base.with_extension(ext));
    }
    for c in candidates {
        let norm = normalize_rel_path(&c);
        if files.contains(&norm) { return Some(norm); }
    }
    None
}

/// Normalise un chemin relatif (résout `.` et `..`) et le rend en `/`.
fn normalize_rel_path(p: &Path) -> String {
    let mut out: Vec<String> = Vec::new();
    for comp in p.components() {
        match comp {
            std::path::Component::Normal(s) => out.push(s.to_string_lossy().to_string()),
            std::path::Component::ParentDir => { out.pop(); }
            std::path::Component::CurDir => {}
            _ => {}
        }
    }
    out.join("/")
}

/// Ajoute les arêtes inter-fichiers `imports` (fichier → fichier cible) en
/// résolvant les imports relatifs vers des fichiers réels du projet. Sans
/// cela, le graphe ne contient que des arêtes intra-fichier → la vue « par
/// fichier » ne montre aucun lien entre fichiers.
fn add_cross_file_imports(conn: &Connection, files: &HashSet<String>) -> Result<usize, String> {
    let mut stmt = conn.prepare(
        "SELECT source, target FROM graph_edges WHERE relation = 'imports'"
    ).map_err(|e| format!("prep imports: {e}"))?;
    let rows = stmt.query_map([], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    }).map_err(|e| format!("query imports: {e}"))?;
    let mut added = 0usize;
    for row in rows.flatten() {
        let (src, tgt) = row;
        // src = file:<rel>:<rel> ; tgt = import:<rel>:<target>
        let rel = src.strip_prefix("file:")
            .and_then(|s| s.rsplit_once(':').map(|(r, _)| r.to_string()));
        let Some(rel) = rel else { continue; };
        let prefix = format!("import:{rel}:");
        let Some(target) = tgt.strip_prefix(&prefix) else { continue; };
        if let Some(resolved) = resolve_import_target(&rel, target, files) {
            if resolved != rel {
                let src_file = node_id("file", &rel, &rel);
                let tgt_file = node_id("file", &resolved, &resolved);
                conn.execute(
                    "INSERT OR IGNORE INTO graph_edges(source, target, relation, confidence, path) VALUES (?1, ?2, 'imports', 'EXTRACTED', ?3)",
                    rusqlite::params![src_file, tgt_file, rel],
                ).map_err(|e| format!("ins cross import: {e}"))?;
                added += 1;
            }
        }
    }
    Ok(added)
}

/// Supprime puis recrée les arêtes inter-fichiers d'import (utilisé par le
/// refresh incrémental pour ne pas laisser d'arêtes obsolètes).
fn refresh_cross_file_imports(conn: &Connection, files: &HashSet<String>) -> Result<usize, String> {
    conn.execute(
        "DELETE FROM graph_edges WHERE relation = 'imports' AND source LIKE 'file:%' AND target LIKE 'file:%'",
        [],
    ).map_err(|e| format!("del cross imports: {e}"))?;
    add_cross_file_imports(conn, files)
}

fn incremental_refresh(conn: &Connection, project_path: &str, max_files: usize, extraction: &str, include_calls: bool) {
    let root = Path::new(project_path);
    let disk_files = walk_project(root);
    let disk_set: HashSet<&str> = disk_files.iter().map(|(r, _)| r.as_str()).collect();
    let indexed = indexed_files(conn);
    // 1. Supprimer les fichiers disparus
    for rel in indexed.keys() {
        if !disk_set.contains(rel.as_str()) {
            let _ = delete_file_graph(conn, rel);
        }
    }
    // 2. Re-indexer les modifiés / nouveaux (triés par mtime décroissant), borné.
    let mut to_refresh: Vec<(String, PathBuf, u64)> = disk_files.iter()
        .filter_map(|(rel, abs)| {
            let disk_mtime = file_mtime(abs);
            let need = match file_nodes_hash(conn, rel) {
                Some(_) => {
                    // Comparer le hash réel du fichier disque au hash stocké.
                    let content = read_file_content(abs).unwrap_or_default();
                    let h = file_hash(content.as_bytes());
                    file_nodes_hash(conn, rel).map_or(true, |prev| prev != h)
                }
                None => true,
            };
            if need { Some((rel.clone(), abs.clone(), disk_mtime)) } else { None }
        })
        .collect();
    to_refresh.sort_by(|a, b| b.2.cmp(&a.2));
    for (rel, abs, _) in to_refresh.into_iter().take(max_files) {
        if let Err(e) = index_file_graph(conn, &rel, &abs, extraction, include_calls) {
            eprintln!("[code-graph] refresh skip {rel}: {e}");
        }
    }
    // Recréer les arêtes inter-fichiers d'import (les fichiers ont pu changer).
    let file_set: HashSet<String> = disk_files.iter().map(|(r, _)| r.clone()).collect();
    let _ = refresh_cross_file_imports(conn, &file_set);
}

// ── Requêtes ─────────────────────────────────────────────────────────────────

fn load_graph(conn: &Connection) -> (Vec<(String, String, String, String, i64)>, Vec<(String, String, String, String, String)>) {
    // nodes: id, label, kind, path, line
    let mut nodes = Vec::new();
    let mut stmt = match conn.prepare("SELECT id, label, kind, path, line FROM graph_nodes") {
        Ok(s) => s,
        Err(_) => return (nodes, Vec::new()),
    };
    let rows = stmt.query_map([], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, i64>(4)?))
    });
    if let Ok(iter) = rows {
        for r in iter.flatten() { nodes.push(r); }
    }

    // edges: source, target, relation, confidence, path
    let mut edges = Vec::new();
    let mut stmt = match conn.prepare("SELECT source, target, relation, confidence, path FROM graph_edges") {
        Ok(s) => s,
        Err(_) => return (nodes, edges),
    };
    let rows = stmt.query_map([], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, String>(4)?))
    });
    if let Ok(iter) = rows {
        for r in iter.flatten() { edges.push(r); }
    }
    (nodes, edges)
}

fn estimate_tokens(s: &str) -> usize {
    (s.len() as f32 / 3.5).ceil() as usize
}

fn normalize_term(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Scorings : trouve les nœuds candidats pour une question (label/path match).
fn score_nodes(nodes: &[(String, String, String, String, i64)], terms: &[String]) -> Vec<(f32, String)> {
    let mut scored: Vec<(f32, String)> = Vec::new();
    for (id, label, _kind, path, _line) in nodes {
        let nlabel = normalize_term(label);
        let npath = normalize_term(path);
        let joined = terms.join(" ");
        let mut score = 0.0f32;
        // Match exact du label complet (multi-mots)
        if !joined.is_empty() {
            if nlabel == joined || npath == joined { score += 10.0; }
            else if nlabel.starts_with(&joined) || npath.starts_with(&joined) { score += 5.0; }
        }
        // Par terme
        for t in terms {
            if nlabel == *t { score += 3.0; }
            else if npath == *t { score += 2.0; }
            else if nlabel.contains(t.as_str()) || npath.contains(t.as_str()) { score += 1.0; }
        }
        if score > 0.0 { scored.push((score, id.clone())); }
    }
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    scored
}

fn find_node_by_label(nodes: &[(String, String, String, String, i64)], label: &str) -> Option<String> {
    let nl = normalize_term(label);
    let mut exact: Option<String> = None;
    for (id, lbl, _k, _p, _l) in nodes {
        if lbl == label { return Some(id.clone()); }
        if normalize_term(lbl) == nl { exact = Some(id.clone()); }
    }
    exact
}

fn build_adjacency(edges: &[(String, String, String, String, String)]) -> HashMap<String, Vec<(String, String, String)>> {
    // id → vec<(relation, confidence, neighbor)>
    let mut adj: HashMap<String, Vec<(String, String, String)>> = HashMap::new();
    for (src, tgt, rel, conf, _p) in edges {
        adj.entry(src.clone()).or_default().push((rel.clone(), conf.clone(), tgt.clone()));
        adj.entry(tgt.clone()).or_default().push((format!("in-{rel}"), conf.clone(), src.clone()));
    }
    adj
}

/// `explain` : nœud + ses voisins directs.
fn explain_block(nodes: &[(String, String, String, String, i64)], adj: &HashMap<String, Vec<(String, String, String)>>, query: &str) -> String {
    let Some(id) = find_node_by_label(nodes, query) else {
        return format!("[graphe] nœud « {query} » introuvable");
    };
    let mut out = String::new();
    let mut nlabel = String::new();
    let mut npath = String::new();
    let mut nline = 0i64;
    for (nid, l, _k, p, ln) in nodes {
        if *nid == id { nlabel = l.clone(); npath = p.clone(); nline = *ln; break; }
    }
    out.push_str(&format!("### {nlabel} ({npath} L{nline})\n"));
    if let Some(neighbors) = adj.get(&id) {
        let mut sorted = neighbors.clone();
        sorted.sort();
        for (rel, conf, nb) in sorted.iter().take(40) {
            let lbl = nodes.iter().find(|n| &n.0 == nb).map(|n| n.1.clone()).unwrap_or_else(|| nb.clone());
            out.push_str(&format!("- →{rel}→ {lbl} [{conf}]\n"));
        }
    }
    out
}

/// `affected` : traversée inverse (nœuds qui dépendent de la cible).
fn affected_block(nodes: &[(String, String, String, String, i64)], adj: &HashMap<String, Vec<(String, String, String)>>, query: &str, depth: usize) -> String {
    let Some(id) = find_node_by_label(nodes, query) else {
        return format!("[graphe] nœud « {query} » introuvable");
    };
    // BFS inverse : on suit les arêtes "in-relation" (dépendants).
    let mut visited = HashSet::new();
    let mut frontier = vec![id.clone()];
    let mut affected_ids: Vec<String> = Vec::new();
    for _ in 0..depth {
        if frontier.is_empty() { break; }
        let mut next = Vec::new();
        for f in &frontier {
            if let Some(neighbors) = adj.get(f) {
                for (_rel, _conf, nb) in neighbors {
                    // Les arêtes in-* pointent vers les nœuds sources (dépendants)
                    if visited.insert(nb.clone()) {
                        affected_ids.push(nb.clone());
                        next.push(nb.clone());
                    }
                }
            }
        }
        frontier = next;
    }
    if affected_ids.is_empty() {
        return format!("[graphe] « {query} » : aucun dépendant détecté (ou graphe trop partiel)");
    }
    let mut out = String::new();
    out.push_str(&format!("### Impact de « {query} » ({} nœud(s) dépendant(s))\n", affected_ids.len()));
    for aid in affected_ids.into_iter().take(60) {
        if let Some((_id, l, k, p, ln)) = nodes.iter().find(|n| n.0 == aid) {
            out.push_str(&format!("- `{l}` ({k}, {p} L{ln})\n"));
        }
    }
    out
}

/// `path` : plus court chemin BFS entre deux nœuds.
fn path_block(nodes: &[(String, String, String, String, i64)], adj: &HashMap<String, Vec<(String, String, String)>>, a: &str, b: &str) -> String {
    let Some(start) = find_node_by_label(nodes, a) else { return format!("[graphe] nœud « {a} » introuvable"); };
    let Some(goal) = find_node_by_label(nodes, b) else { return format!("[graphe] nœud « {b} » introuvable"); };
    if start == goal { return format!("[graphe] « {a} » et « {b} » désignent le même nœud"); }

    let mut prev: HashMap<String, (String, String)> = HashMap::new(); // node → (pred, rel)
    let mut visited = HashSet::new();
    let mut frontier = vec![start.clone()];
    visited.insert(start.clone());
    let mut found = false;
    while !frontier.is_empty() && !found {
        let mut next = Vec::new();
        for f in &frontier {
            if let Some(neighbors) = adj.get(f) {
                for (rel, _conf, nb) in neighbors {
                    if visited.insert(nb.clone()) {
                        prev.insert(nb.clone(), (f.clone(), rel.clone()));
                        if *nb == goal { found = true; break; }
                        next.push(nb.clone());
                    }
                }
            }
            if found { break; }
        }
        frontier = next;
    }
    if !found {
        return format!("[graphe] aucun chemin entre « {a} » et « {b} »");
    }
    // Reconstruire le chemin
    let mut chain: Vec<(String, String)> = vec![(goal.clone(), String::new())];
    let mut cur = goal;
    while let Some((pred, rel)) = prev.get(&cur) {
        chain.push((pred.clone(), rel.clone()));
        cur = pred.clone();
        if cur == start { break; }
    }
    chain.reverse();
    let mut out = String::new();
    out.push_str(&format!("### Chemin « {a} » → « {b} » ({} hop(s))\n", chain.len().saturating_sub(1)));
    let label_of = |nid: &str| nodes.iter().find(|n| n.0 == nid).map(|n| n.1.clone()).unwrap_or_else(|| nid.to_string());
    for (i, (nid, _rel)) in chain.iter().enumerate() {
        out.push_str(&format!("{}{}\n", "  ".repeat(i), label_of(nid)));
        if i + 1 < chain.len() {
            // rel stockée sur le nœud suivant
            let next_rel = chain[i + 1].1.clone();
            out.push_str(&format!("{}  └─{next_rel}─\n", "  ".repeat(i)));
        }
    }
    out
}

/// `query` : score les nœuds contre le prompt, BFS depuis les seeds, rend un
/// sous-graphe Markdown compact borné par budget.
fn query_block(nodes: &[(String, String, String, String, i64)], _edges: &[(String, String, String, String, String)], adj: &HashMap<String, Vec<(String, String, String)>>, prompt: &str, budget: usize) -> (String, usize, usize) {
    let terms: Vec<String> = normalize_term(prompt).split_whitespace().map(|s| s.to_string()).collect();
    if terms.is_empty() { return (String::new(), 0, 0); }
    let scored = score_nodes(nodes, &terms);
    if scored.is_empty() { return (String::new(), 0, 0); }
    // Seeds : top 3
    let seeds: Vec<String> = scored.iter().take(3).map(|(_, id)| id.clone()).collect();

    // BFS limité depuis les seeds
    let mut visited: HashSet<String> = HashSet::new();
    let mut collected: Vec<String> = Vec::new();
    let mut frontier = seeds.clone();
    for _ in 0..2 {
        if frontier.is_empty() { break; }
        let mut next = Vec::new();
        for f in &frontier {
            if visited.insert(f.clone()) { collected.push(f.clone()); }
            if let Some(neighbors) = adj.get(f) {
                for (_rel, _conf, nb) in neighbors {
                    if !visited.contains(nb) && collected.len() + next.len() < 80 {
                        next.push(nb.clone());
                    }
                }
            }
        }
        frontier = next;
    }

    // Construire le bloc Markdown borné par budget
    let mut out = String::new();
    let mut tokens = 0usize;
    let mut nodes_used = 0usize;
    let mut edges_used = 0usize;
    let label_of = |nid: &str| nodes.iter().find(|n| n.0 == nid).map(|n| n.1.clone()).unwrap_or_else(|| nid.to_string());
    let file_of = |nid: &str| nodes.iter().find(|n| n.0 == nid).map(|n| n.3.clone()).unwrap_or_default();
    let line_of = |nid: &str| nodes.iter().find(|n| n.0 == nid).map(|n| n.4).unwrap_or(0);

    // D'abord les seeds avec leurs voisins
    for (i, sid) in seeds.iter().enumerate() {
        let mut block = String::new();
        block.push_str(&format!("### {}\n", label_of(sid)));
        // Fichier source
        let f = file_of(sid);
        if !f.is_empty() { block.push_str(&format!("- source: `{f}` L{}\n", line_of(sid))); }
        if let Some(neighbors) = adj.get(sid) {
            let mut nb: Vec<_> = neighbors.iter().filter(|n| collected.contains(&n.2)).collect();
            nb.sort();
            for (rel, conf, nid) in nb.into_iter().take(12) {
                if !collected.contains(nid) { continue; }
                block.push_str(&format!("- →{rel}→ {} [{conf}]\n", label_of(nid)));
                edges_used += 1;
            }
        }
        let bt = estimate_tokens(&block);
        if tokens + bt > budget && i > 0 { break; }
        out.push_str(&block);
        out.push('\n');
        tokens += bt;
        nodes_used += 1;
        if tokens >= budget { break; }
    }
    if nodes_used == 0 {
        // Fallback : au moins le premier seed
        if let Some(sid) = seeds.first() {
            let block = format!("### {}\n- source: `{}` L{}\n", label_of(sid), file_of(sid), line_of(sid));
            out.push_str(&block);
            nodes_used += 1;
        }
    }
    (out, nodes_used, edges_used)
}

fn query_graph_blocking(project_path: &str, prompt: &str, budget: usize) -> Result<QueryGraphResult, String> {
    let _guard = GRAPH_DB_LOCK.lock().unwrap();
    let path = project_path.to_string();
    let prompt = prompt.to_string();
    run_on_big_stack("code-graph-query", move || query_graph_blocking_inner(&path, &prompt, budget))
}

fn query_graph_blocking_inner(project_path: &str, prompt: &str, budget: usize) -> Result<QueryGraphResult, String> {
    let dbp = db_path(project_path);
    if !dbp.exists() {
        return Ok(QueryGraphResult { context: String::new(), nodes: 0, edges: 0, source: "empty".into() });
    }
    let conn = open_db(&dbp)?;
    if count_nodes(&conn) == 0 {
        return Ok(QueryGraphResult { context: String::new(), nodes: 0, edges: 0, source: "empty".into() });
    }
    // Refresh incrémental borné avant la query (au fil de l'eau).
    // Le backend d'extraction est celui du dernier build (stocké en meta).
    let extraction = meta_get(&conn, "graph_extraction").unwrap_or_else(|| "heuristic".to_string());
    let include_calls = meta_get(&conn, "graph_include_calls").map_or(true, |v| v == "1");
    incremental_refresh(&conn, project_path, MAX_REFRESH_FILES_PER_QUERY, &extraction, include_calls);
    let (nodes, edges) = load_graph(&conn);
    if nodes.is_empty() {
        return Ok(QueryGraphResult { context: String::new(), nodes: 0, edges: 0, source: "empty".into() });
    }
    let adj = build_adjacency(&edges);
    let (context, n, e) = query_block(&nodes, &edges, &adj, prompt, budget);
    if context.is_empty() {
        return Ok(QueryGraphResult { context: String::new(), nodes: 0, edges: 0, source: "empty".into() });
    }
    Ok(QueryGraphResult { context, nodes: n, edges: e, source: "graph".into() })
}

fn graph_status_inner(project_path: &str) -> GraphStatus {
    let dbp = db_path(project_path);
    if !dbp.exists() {
        return GraphStatus { exists: false, nodes: 0, edges: 0, built_at: String::new(), ready: false };
    }
    let conn = match open_db(&dbp) {
        Ok(c) => c,
        Err(_) => return GraphStatus { exists: true, nodes: 0, edges: 0, built_at: String::new(), ready: false },
    };
    let nodes = count_nodes(&conn);
    let edges = count_edges(&conn);
    let built_at = meta_get(&conn, "graph_built_at").unwrap_or_default()
        .parse::<u64>().map(|ms| {
            chrono::DateTime::from_timestamp_millis(ms as i64)
                .map(|d| d.format("%Y-%m-%d %H:%M").to_string())
                .unwrap_or_default()
        }).unwrap_or_default();
    GraphStatus { exists: true, nodes, edges, built_at, ready: nodes > 0 }
}

// ── Wiki (mode B) ────────────────────────────────────────────────────────────

/// Génère `.pilot/graph-wiki/` : un index Markdown des god-nodes + un aperçu
/// par module. Retourne le chemin relatif du dossier wiki (ou chaîne vide si
/// le graphe est absent). L'agent peut consulter ce wiki à la demande via ses
/// outils (coût zéro au prompt). Inspiré de `graphify --wiki`.
fn build_graph_wiki_inner(project_path: &str) -> Result<String, String> {
    let dbp = db_path(project_path);
    if !dbp.exists() {
        return Ok(String::new());
    }
    let conn = open_db(&dbp)?;
    if count_nodes(&conn) == 0 {
        return Ok(String::new());
    }
    let (nodes, edges) = load_graph(&conn);
    let adj = build_adjacency(&edges);

    // Degré de chaque nœud (god-nodes)
    let mut degree: Vec<(usize, &String)> = nodes.iter().map(|n| (adj.get(&n.0).map(|v| v.len()).unwrap_or(0), &n.0)).collect();
    degree.sort_by(|a, b| b.0.cmp(&a.0));

    let label_of = |nid: &str| nodes.iter().find(|n| n.0 == nid).map(|n| n.1.clone()).unwrap_or_else(|| nid.to_string());
    let path_of = |nid: &str| nodes.iter().find(|n| n.0 == nid).map(|n| n.3.clone()).unwrap_or_default();

    let out_dir = Path::new(project_path).join(".pilot").join("graph-wiki");
    fs::create_dir_all(&out_dir).map_err(|e| format!("mkdir wiki: {e}"))?;

    // index.md
    let mut index = String::new();
    index.push_str("# Graph Wiki — graphe de connaissances du projet\n\n");
    index.push_str("> Structure du projet : fichiers, fonctions, classes, imports et relations.\n");
    index.push_str("> Chaque relation est marquée EXTRACTED (lue dans le code) ou INFERRED (déduite).\n\n");
    index.push_str("## God nodes (concepts les plus connectés)\n\n");
    for (d, nid) in degree.iter().take(15) {
        if *d == 0 { break; }
        let p = path_of(nid);
        index.push_str(&format!("- **{}** (degré {}) — `{}`\n", label_of(nid), d, p));
    }
    index.push_str("\n## Nœuds par fichier\n\n");
    let mut by_file: HashMap<String, Vec<&(String, String, String, String, i64)>> = HashMap::new();
    for n in &nodes {
        if n.2 == "file" { continue; }
        by_file.entry(n.3.clone()).or_default().push(n);
    }
    let mut files: Vec<_> = by_file.keys().collect();
    files.sort();
    for f in files {
        let items = &by_file[f];
        index.push_str(&format!("### `{f}`\n"));
        for n in items {
            index.push_str(&format!("- `{}` ({}, L{})\n", n.1, n.2, n.4));
        }
        index.push_str("\n");
    }
    fs::write(out_dir.join("index.md"), index).map_err(|e| format!("write index: {e}"))?;

    // god-nodes.md (les N hubs, avec leurs voisins)
    let mut gd = String::new();
    gd.push_str("# God nodes\n\nLes concepts les plus connectés du projet (architectural hubs).\n\n");
    for (d, nid) in degree.iter().take(20) {
        if *d == 0 { break; }
        gd.push_str(&format!("## {} (degré {})\n- source: `{}`\n", label_of(nid), d, path_of(nid)));
        if let Some(neighbors) = adj.get(*nid) {
            let mut s: Vec<_> = neighbors.iter().collect();
            s.sort();
            for (rel, conf, nb) in s.into_iter().take(15) {
                gd.push_str(&format!("- →{rel}→ {} [{conf}]\n", label_of(nb)));
            }
        }
        gd.push_str("\n");
    }
    fs::write(out_dir.join("god-nodes.md"), gd).map_err(|e| format!("write god-nodes: {e}"))?;

    Ok(".pilot/graph-wiki".to_string())
}

// ── Commandes Tauri (sync) ───────────────────────────────────────────────────

/// Status du graphe (via projet).
#[tauri::command]
pub fn graph_status(project_path: String) -> Result<GraphStatus, String> {
    Ok(graph_status_inner(&project_path))
}

/// Build complet (rebuild). Sync → threadpool Tauri, n'fige pas l'UI.
#[tauri::command]
pub fn build_code_graph(app: AppHandle, project_path: String) -> Result<GraphBuildStats, String> {
    build_graph_blocking(&app, &project_path)
}

/// Query graphe : sous-graphe pertinent au prompt, borné par budget.
#[tauri::command]
pub fn query_code_graph(project_path: String, prompt: String, budget_tokens: u32) -> Result<QueryGraphResult, String> {
    let budget = if budget_tokens == 0 { DEFAULT_BUDGET } else { budget_tokens as usize };
    query_graph_blocking(&project_path, &prompt, budget)
}

/// Explain : voisins d'un nœud (via label).
#[tauri::command]
pub fn graph_explain(project_path: String, node: String) -> Result<String, String> {
    let dbp = db_path(&project_path);
    if !dbp.exists() { return Ok("[graphe] index absent (lancer la construction)".into()); }
    let conn = open_db(&dbp)?;
    let (nodes, edges) = load_graph(&conn);
    let adj = build_adjacency(&edges);
    Ok(explain_block(&nodes, &adj, &node))
}

/// Affected : analyse d'impact (traversée inverse).
#[tauri::command]
pub fn graph_affected(project_path: String, node: String, depth: Option<u32>) -> Result<String, String> {
    let dbp = db_path(&project_path);
    if !dbp.exists() { return Ok("[graphe] index absent (lancer la construction)".into()); }
    let conn = open_db(&dbp)?;
    let (nodes, edges) = load_graph(&conn);
    let adj = build_adjacency(&edges);
    Ok(affected_block(&nodes, &adj, &node, depth.unwrap_or(2) as usize))
}

/// Path : plus court chemin entre deux nœuds.
#[tauri::command]
pub fn graph_path(project_path: String, from: String, to: String) -> Result<String, String> {
    let dbp = db_path(&project_path);
    if !dbp.exists() { return Ok("[graphe] index absent (lancer la construction)".into()); }
    let conn = open_db(&dbp)?;
    let (nodes, edges) = load_graph(&conn);
    let adj = build_adjacency(&edges);
    Ok(path_block(&nodes, &adj, &from, &to))
}

/// Wiki (mode B) : génère `.pilot/graph-wiki/` (index + god-nodes).
#[tauri::command]
pub fn build_graph_wiki(project_path: String) -> Result<String, String> {
    build_graph_wiki_inner(&project_path)
}

/// Export complet du graphe (nœuds + arêtes) pour la visualisation 2D
/// (onglet Graphe). Retourne un objet vide si le graphe est absent.
#[tauri::command]
pub fn graph_export(project_path: String) -> Result<GraphExport, String> {
    let dbp = db_path(&project_path);
    if !dbp.exists() {
        return Ok(GraphExport { nodes: Vec::new(), edges: Vec::new() });
    }
    let conn = open_db(&dbp)?;
    let (nodes, edges) = load_graph(&conn);
    Ok(GraphExport {
        nodes: nodes.into_iter().map(|(id, label, kind, path, line)| GraphNodeView { id, label, kind, path, line }).collect(),
        edges: edges.into_iter().map(|(source, target, relation, confidence, path)| GraphEdgeView { source, target, relation, confidence, path }).collect(),
    })
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn node_id_is_canonical() {
        assert_eq!(node_id("file", "src/main.rs", "src/main.rs"), "file:src/main.rs:src/main.rs");
        assert_eq!(node_id("function", "src/a.rs", "run"), "function:src/a.rs:run");
    }

    #[test]
    fn short_name_takes_last_segment() {
        assert_eq!(short_name("auth.login"), "login");
        assert_eq!(short_name("run"), "run");
    }

    #[test]
    fn import_label_strips_extension_not_last_dot() {
        // Le bug : short_name("rpc-client.ts") → "ts". import_label doit donner "rpc-client".
        assert_eq!(import_label("../src/modes/rpc/rpc-client.ts"), "rpc-client");
        assert_eq!(import_label("../src/modes/rpc/rpc-client"), "rpc-client");
        assert_eq!(import_label("./utils"), "utils");
        assert_eq!(import_label("@/components/Button"), "Button");
        assert_eq!(import_label("../b"), "b");
    }

    #[test]
    fn extract_python_defs_and_imports() {
        let content = "import os\nfrom .utils import helper\n\ndef main():\n    pass\n\nclass Foo:\n    pass\n";
        let (nodes, edges) = extract_v1("main.py", content);
        // file + import(.utils) + function(main) + class(Foo)
        assert!(nodes.iter().any(|n| n.kind == "file"));
        assert!(nodes.iter().any(|n| n.kind == "function" && n.label == "main"));
        assert!(nodes.iter().any(|n| n.kind == "class" && n.label == "Foo"));
        assert!(nodes.iter().any(|n| n.kind == "import"));
        assert!(edges.iter().any(|e| e.relation == "imports" && e.confidence == "EXTRACTED"));
        assert!(edges.iter().any(|e| e.relation == "contains"));
    }

    #[test]
    fn extract_js_defs() {
        let content = "import x from './x';\nexport function run(a) { return a; }\nexport class Widget {}\n";
        let (nodes, edges) = extract_v1("main.js", content);
        assert!(nodes.iter().any(|n| n.kind == "function" && n.label == "run"));
        assert!(nodes.iter().any(|n| n.kind == "class" && n.label == "Widget"));
        assert!(edges.iter().any(|e| e.relation == "imports"));
    }

    #[test]
    fn extract_rust_fn_and_use() {
        let content = "use std::collections::HashMap;\npub fn run() {}\npub struct Foo {}\n";
        let (nodes, _edges) = extract_v1("lib.rs", content);
        assert!(nodes.iter().any(|n| n.kind == "function" && n.label == "run"));
        assert!(nodes.iter().any(|n| n.kind == "class" && n.label == "Foo"));
        assert!(nodes.iter().any(|n| n.kind == "import"));
    }

    #[test]
    fn extract_markdown_links() {
        let content = "See [spec](spec_pilot.md) and [doc](docs/how-it-works.md).";
        let (nodes, edges) = extract_v1("README.md", content);
        assert!(nodes.iter().filter(|n| n.kind == "import").count() >= 2);
        assert!(edges.iter().any(|e| e.relation == "references"));
    }

    #[test]
    fn extract_v2_python_defs_and_calls() {
        let content = "from .utils import helper\n\ndef greet():\n    return helper()\n\nclass Foo:\n    def bar(self):\n        return greet()\n";
        let (nodes, edges) = extract_v2("main.py", content);
        assert!(nodes.iter().any(|n| n.kind == "function" && n.label == "greet"));
        assert!(nodes.iter().any(|n| n.kind == "class" && n.label == "Foo"));
        assert!(nodes.iter().any(|n| n.kind == "method" && n.label == "bar"));
        assert!(edges.iter().any(|e| e.relation == "imports"));
        // bar() appelle greet() (définie localement) → arête calls EXTRACTED
        assert!(edges.iter().any(|e| e.relation == "calls" && e.target.contains("greet") && e.confidence == "EXTRACTED"));
    }

    #[test]
    fn extract_v2_js_calls_and_inherits() {
        let content = "import x from './x';\nexport class Base {}\nexport class Widget extends Base {\n  render() { return this.foo(); }\n  foo() {}\n}\nfunction run() { return new Widget(); }\n";
        let (nodes, edges) = extract_v2("main.js", content);
        assert!(nodes.iter().any(|n| n.kind == "class" && n.label == "Widget"));
        assert!(nodes.iter().any(|n| n.kind == "class" && n.label == "Base"));
        assert!(nodes.iter().any(|n| n.kind == "method" && n.label == "foo"));
        assert!(nodes.iter().any(|n| n.kind == "function" && n.label == "run"));
        assert!(edges.iter().any(|e| e.relation == "imports"));
        assert!(edges.iter().any(|e| e.relation == "inherits" && e.source.contains("Widget") && e.target.contains("Base")));
    }

    #[test]
    fn extract_v2_rust_fn_and_use() {
        let content = "use std::collections::HashMap;\npub fn run() -> u32 { 1 }\npub struct Foo {}\nimpl Foo {\n    pub fn new() -> Self { Self {} }\n}\n";
        let (nodes, edges) = extract_v2("lib.rs", content);
        assert!(nodes.iter().any(|n| n.kind == "function" && n.label == "run"));
        assert!(nodes.iter().any(|n| n.kind == "class" && n.label == "Foo"));
        assert!(nodes.iter().any(|n| n.kind == "method" && n.label == "new"));
        assert!(edges.iter().any(|e| e.relation == "imports"));
    }

    #[test]
    fn extract_v2_falls_back_on_unsupported_lang() {
        // Pas de grammaire tree-sitter pour le markdown → uniquement le nœud file.
        let (nodes, _edges) = extract_v2("README.md", "# Title\nSee [a](b.md)\n");
        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].kind, "file");
    }

    #[test]
    fn extract_dedups_repeated_imports() {
        let content = "from .utils import a\nfrom .utils import b\n";
        let (nodes, _) = extract_v1("main.py", content);
        // Un seul nœud import pour .utils
        let imports: Vec<_> = nodes.iter().filter(|n| n.kind == "import").collect();
        assert_eq!(imports.len(), 1);
    }

    #[test]
    fn graph_roundtrip_sqlite() {
        let tmp = std::env::temp_dir().join(format!("cg-roundtrip-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(tmp.join(".pilot")).unwrap();
        let conn = open_db(&tmp.join(".pilot").join("context-index.db")).unwrap();
        let (nodes, edges) = extract_v1("main.py", "from .utils import helper\ndef main(): pass\n");
        insert_file_graph(&conn, "main.py", "abcd", 0, &nodes, &edges).unwrap();
        assert_eq!(count_nodes(&conn), nodes.len());
        assert_eq!(count_edges(&conn), edges.len());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn extract_v2_deep_nesting_no_stack_overflow() {
        // Fichier JS avec 2000 blocs imbriqués (bien au-delà du code réel) : la
        // garde de profondeur (MAX_AST_DEPTH) + la grande pile évitent le stack
        // overflow (0xc0000409) qui se produisait sur les gros fichiers.
        let mut content = String::new();
        for _ in 0..2000 { content.push_str("if (a) { "); }
        content.push_str("foo();");
        for _ in 0..2000 { content.push_str(" }"); }
        let (nodes, _edges) = run_on_big_stack("cg-test", move || Ok(extract_v2("deep.js", &content))).unwrap();
        assert!(!nodes.is_empty());
    }

    #[test]
    fn is_graph_file_recognizes_extensions() {
        assert!(is_graph_file("src/app.js"));
        assert!(is_graph_file("src/lib.tsx"));
        assert!(is_graph_file("lib.rs"));
        assert!(is_graph_file("README.md"));
        assert!(!is_graph_file("assets/logo.png"));
        assert!(!is_graph_file("notes.txt"));
        assert!(!is_graph_file("noext"));
    }

    #[test]
    fn refresh_by_watcher_returns_zero_without_project() {
        // Pas de dossier projet → DB absente → refresh inoffensif (retourne 0).
        let n = refresh_by_watcher("/nonexistent/path/xyz", 10);
        assert_eq!(n, 0);
    }

    #[test]
    fn query_scoring_finds_by_label() {
        let nodes = vec![
            (node_id("file", "src/main.rs", "src/main.rs"), "src/main.rs".to_string(), "file".to_string(), "src/main.rs".to_string(), 1i64),
            (node_id("function", "src/a.rs", "run"), "run".to_string(), "function".to_string(), "src/a.rs".to_string(), 5i64),
            (node_id("class", "src/b.rs", "Widget"), "Widget".to_string(), "class".to_string(), "src/b.rs".to_string(), 10i64),
        ];
        let terms = vec!["widget".to_string()];
        let scored = score_nodes(&nodes, &terms);
        assert_eq!(scored.first().map(|(_, id)| id.clone()), Some(node_id("class", "src/b.rs", "Widget")));
    }

    #[test]
    fn explain_returns_unknown_when_missing() {
        let nodes: Vec<(String, String, String, String, i64)> = Vec::new();
        let edges: Vec<(String, String, String, String, String)> = Vec::new();
        let adj = build_adjacency(&edges);
        let out = explain_block(&nodes, &adj, "rien");
        assert!(out.contains("introuvable"));
    }

    #[test]
    fn resolve_import_target_finds_file_with_extension() {
        let files: HashSet<String> = ["src/modes/rpc/rpc-client.ts".to_string()].into_iter().collect();
        // Depuis pi-docs/rpc-client-clone.test.ts, import '../src/modes/rpc/rpc-client'
        let resolved = resolve_import_target("pi-docs/rpc-client-clone.test.ts", "../src/modes/rpc/rpc-client", &files);
        assert_eq!(resolved.as_deref(), Some("src/modes/rpc/rpc-client.ts"));
    }

    #[test]
    fn add_cross_file_imports_creates_file_to_file_edges() {
        let tmp = std::env::temp_dir().join(format!("cg-cross-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(tmp.join(".pilot")).unwrap();
        let conn = open_db(&tmp.join(".pilot").join("context-index.db")).unwrap();
        // Fichier A importe B : arête file→import (même chemin) + nœud import.
        let (nodes, edges) = extract_v1("src/a.ts", "import x from '../b'\n");
        insert_file_graph(&conn, "src/a.ts", "h1", 0, &nodes, &edges).unwrap();
        // Fichier B existe dans le projet (import '../b' depuis src/a.ts → b.ts à la racine).
        let files: HashSet<String> = ["src/a.ts".to_string(), "b.ts".to_string()].into_iter().collect();
        let added = add_cross_file_imports(&conn, &files).unwrap();
        assert!(added >= 1);
        // Vérifier l'arête inter-fichiers file:src/a.ts → file:b.ts
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM graph_edges WHERE source = 'file:src/a.ts:src/a.ts' AND target = 'file:b.ts:b.ts' AND relation = 'imports'",
            [], |r| r.get(0),
        ).unwrap();
        assert_eq!(count, 1);
        let _ = std::fs::remove_dir_all(&tmp);
    }
}

