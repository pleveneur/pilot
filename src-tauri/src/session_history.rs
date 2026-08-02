// session_history.rs — H9 : Historique de sessions searchable.
//
// Domaine extrait de `lib.rs` (2026-08) : index local `.pilot/sessions.jsonl`
// (append-style) + tags `.pilot/sessions-tags.json`, rétro-indexation depuis le
// dossier de sessions pi, recherche plein-texte et capture live par le frontend.
// Voir spec_session_history.md. Dépend de `crate::resolve_agent_home`,
// `crate::AppConfig` et `crate::AppState` (projet courant).

use std::collections::HashMap;
use std::fs;

use serde::Deserialize;
use serde_json::Value;
use tauri::State;

use crate::{resolve_agent_home, rpc_manager, AppConfig, AppState};

// ── H9 : Historique de sessions searchable ──
// Index local `.pilot/sessions.jsonl` (append-style, un objet JSON par ligne) +
// tags dans `.pilot/sessions-tags.json`. Rétro-indexation depuis le dossier de
// sessions pi du projet + capture live par le frontend (record_session_entry).
// Voir spec_session_history.md.

/// Racine `.pilot/` du projet.
fn pilot_meta_dir(project_path: &str) -> std::path::PathBuf {
    std::path::PathBuf::from(project_path).join(".pilot")
}

fn sessions_index_path(project_path: &str) -> std::path::PathBuf {
    pilot_meta_dir(project_path).join("sessions.jsonl")
}

fn sessions_tags_path(project_path: &str) -> std::path::PathBuf {
    pilot_meta_dir(project_path).join("sessions-tags.json")
}

/// Dossier des sessions pi pour le projet courant (même résolution que
/// `list_sessions` : `rpc_session_dir` si défini, sinon `~/.{stem}/agent/sessions`).
fn project_sessions_dir(config: &AppConfig) -> std::path::PathBuf {
    if config.rpc_session_dir.is_empty() {
        // safe unwrap : resolve_agent_home ne peut échouer que si USERPROFILE/HOME
        // absent — auquel cas on retombe sur un chemin vide (gestion plus loin).
        resolve_agent_home(&config.rpc_pi_path)
            .map(|h| h.join("agent").join("sessions"))
            .unwrap_or_default()
    } else {
        std::path::PathBuf::from(&config.rpc_session_dir)
    }
}

/// Tronque à `max` caractères (pas bytes) pour ne pas casser l'UTF-8.
fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let t: String = s.chars().take(max).collect();
    t
}

/// Convertit un chemin absolu ou relatif en chemin relatif au projet (best-effort).
fn normalize_rel(p: &str, project_path: &str) -> String {
    let pb = std::path::Path::new(p);
    if pb.is_absolute() {
        if let Ok(rel) = std::path::Path::new(project_path).join(p).strip_prefix(project_path) {
            return rel.to_string_lossy().replace('\\', "/");
        }
        // p absolu sous le projet : tenter strip_prefix direct
        if let Ok(rel) = pb.strip_prefix(project_path) {
            return rel.to_string_lossy().replace('\\', "/");
        }
        return p.replace('\\', "/");
    }
    p.replace('\\', "/")
}

/// Extrait le texte d'un message pi (`message.content[].text` concaténé).
fn extract_message_text(msg: &Value) -> String {
    let mut out = String::new();
    if let Some(arr) = msg.get("content").and_then(|c| c.as_array()) {
        for item in arr {
            if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                if let Some(t) = item.get("text").and_then(|x| x.as_str()) {
                    if !out.is_empty() {
                        out.push('\n');
                    }
                    out.push_str(t);
                }
            }
        }
    } else if let Some(t) = msg.get("content").and_then(|c| c.as_str()) {
        out.push_str(t);
    }
    out
}

/// Extrait un chemin fichier depuis un `input` de tool_use write/edit (clés
/// possibles : path / file_path / filePath). Insensible aux variations pi.
fn extract_tool_path(input: &Value) -> Option<String> {
    for k in ["path", "file_path", "filePath", "filename"] {
        if let Some(s) = input.get(k).and_then(|x| x.as_str()) {
            if !s.is_empty() {
                return Some(s.to_string());
            }
        }
    }
    None
}

/// Date ISO (UTC) « maintenant ».
fn now_iso() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S").to_string()
}

/// Parse un fichier de session pi (JSONL) → entrée d'index (Value).
/// Défensif : tolère plusieurs schémas (pi évolue). Renvoie None si fichier
/// illisible ou sans message utilisateur (session vide).
fn parse_session_file(path: &std::path::Path, project_path: &str) -> Option<Value> {
    let content = fs::read_to_string(path).ok()?;
    let file_name = path.file_stem()?.to_str()?;
    let parts: Vec<&str> = file_name.splitn(2, '_').collect();
    let timestamp_raw = parts.first().unwrap_or(&"").to_string();
    let id = parts.get(1).unwrap_or(&"").to_string();

    let meta = fs::metadata(path).ok()?;
    let modified = meta
        .modified()
        .ok()
        .map(|t| {
            let dt: chrono::DateTime<chrono::Utc> = t.into();
            dt.format("%Y-%m-%dT%H:%M:%S").to_string()
        })
        .unwrap_or(timestamp_raw);

    let mut prompt = String::new();
    let mut summary = String::new();
    let mut files: Vec<String> = Vec::new();
    let mut turns: u64 = 0;
    let mut model = String::new();
    let mut tokens: Option<u64> = None;
    let mut cost: Option<f64> = None;

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let v: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let t = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
        match t {
            "message" => {
                if let Some(msg) = v.get("message") {
                    let role = msg.get("role").and_then(|r| r.as_str()).unwrap_or("");
                    if role == "user" {
                        turns += 1;
                        if prompt.is_empty() {
                            prompt = extract_message_text(msg);
                        }
                    } else if role == "assistant" {
                        if summary.is_empty() {
                            summary = extract_message_text(msg);
                        }
                        // tool_use persistés dans le content assistant
                        if let Some(arr) = msg.get("content").and_then(|c| c.as_array()) {
                            for item in arr {
                                if item.get("type").and_then(|x| x.as_str()) == Some("tool_use") {
                                    let name = item.get("name").and_then(|x| x.as_str()).unwrap_or("");
                                    if name == "write" || name == "edit" {
                                        if let Some(input) = item.get("input") {
                                            if let Some(p) = extract_tool_path(input) {
                                                let rel = normalize_rel(&p, project_path);
                                                if !files.contains(&rel) {
                                                    files.push(rel);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            "model_change" => {
                if let Some(m) = v.get("model") {
                    let prov = m.get("provider").and_then(|x| x.as_str()).unwrap_or("");
                    let id2 = m.get("id").and_then(|x| x.as_str()).unwrap_or("");
                    if !prov.is_empty() || !id2.is_empty() {
                        model = format!("{}/{}", prov, id2);
                    }
                }
            }
            // Events de streaming (peuvent être persistés selon la version de pi) :
            // capture défensive des tool calls et des stats.
            "tool_execution_start" | "toolcall_start" => {
                let name = v
                    .get("tool")
                    .and_then(|x| x.get("name"))
                    .and_then(|x| x.as_str())
                    .or_else(|| v.get("toolName").and_then(|x| x.as_str()))
                    .or_else(|| v.get("name").and_then(|x| x.as_str()))
                    .unwrap_or("");
                if name == "write" || name == "edit" {
                    let input = v.get("args").or_else(|| v.get("input")).or_else(|| v.get("tool").and_then(|x| x.get("args")));
                    if let Some(input) = input {
                        if let Some(p) = extract_tool_path(input) {
                            let rel = normalize_rel(&p, project_path);
                            if !files.contains(&rel) {
                                files.push(rel);
                            }
                        }
                    }
                }
            }
            "session_stats" | "agent_end" => {
                let stats = v
                    .get("stats")
                    .or_else(|| v.get("data"))
                    .or_else(|| Some(&v));
                if let Some(stats) = stats {
                    if tokens.is_none() {
                        if let Some(tt) = stats
                            .get("tokens")
                            .and_then(|x| x.get("total"))
                            .and_then(|x| x.as_u64())
                        {
                            tokens = Some(tt);
                        } else if let Some(tt) = stats.get("totalTokens").and_then(|x| x.as_u64()) {
                            tokens = Some(tt);
                        }
                    }
                    if cost.is_none() {
                        if let Some(c) = stats.get("cost").and_then(|x| x.as_f64()) {
                            cost = Some(c);
                        } else if let Some(c) = stats.get("totalCost").and_then(|x| x.as_f64()) {
                            cost = Some(c);
                        }
                    }
                }
            }
            _ => {}
        }
    }

    files.sort();

    Some(serde_json::json!({
        "id": id,
        "timestamp": modified,
        "project": project_path,
        "model": model,
        "prompt": truncate_chars(&prompt, 500),
        "summary": truncate_chars(&summary, 300),
        "files": files,
        "tags": [],
        "tokens": tokens,
        "cost": cost,
        "turns": turns,
        "duration_s": null,
        "origin": null,
        "kind": "chat",
        "parent": null,
        "indexed_at": now_iso()
    }))
}

/// Lit l'index `.pilot/sessions.jsonl` → Vec<Value>.
fn read_session_index(project_path: &str) -> Vec<Value> {
    let path = sessions_index_path(project_path);
    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let mut out = Vec::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<Value>(line) {
            out.push(v);
        }
    }
    out
}

/// Écrit l'index (réécriture atomique de tout le fichier).
fn write_session_index(project_path: &str, entries: &[Value]) -> Result<(), String> {
    let path = sessions_index_path(project_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Création .pilot: {}", e))?;
    }
    let mut out = String::new();
    for e in entries {
        out.push_str(&serde_json::to_string(e).map_err(|x| format!("Serde: {}", x))?);
        out.push('\n');
    }
    fs::write(&path, out).map_err(|e| format!("Écriture index sessions: {}", e))?;
    Ok(())
}

/// Lit le fichier de tags → HashMap<id, Vec<String>>.
fn read_session_tags(project_path: &str) -> HashMap<String, Vec<String>> {
    let path = sessions_tags_path(project_path);
    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return HashMap::new(),
    };
    let v: Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return HashMap::new(),
    };
    let mut map = HashMap::new();
    if let Some(obj) = v.as_object() {
        for (id, arr) in obj {
            let tags: Vec<String> = arr
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            if !tags.is_empty() {
                map.insert(id.clone(), tags);
            }
        }
    }
    map
}

fn write_session_tags(project_path: &str, tags: &HashMap<String, Vec<String>>) -> Result<(), String> {
    let path = sessions_tags_path(project_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Création .pilot: {}", e))?;
    }
    let obj: serde_json::Map<String, Value> = tags
        .iter()
        .map(|(k, v)| (k.clone(), Value::Array(v.iter().map(|s| Value::String(s.clone())).collect())))
        .collect();
    let s = serde_json::to_string(&Value::Object(obj)).map_err(|e| format!("Serde tags: {}", e))?;
    fs::write(&path, s).map_err(|e| format!("Écriture tags: {}", e))?;
    Ok(())
}

/// (Re)construit l'index depuis le dossier de sessions pi du projet.
#[tauri::command]
pub fn index_sessions(state: State<AppState>) -> Result<usize, String> {
    let project_path = state
        .project_path
        .lock()
        .unwrap()
        .clone()
        .ok_or("Aucun projet ouvert")?;
    let config = state.config.lock().unwrap();
    let session_dir = project_sessions_dir(&config);
    let folder_name = project_to_session_folder(&project_path);
    let project_dir = session_dir.join(&folder_name);
    drop(config);

    let mut entries: Vec<Value> = Vec::new();
    if project_dir.exists() {
        let entries_iter = fs::read_dir(&project_dir)
            .map_err(|e| format!("Lecture dossier sessions: {}", e))?;
        for entry in entries_iter {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            if let Some(e) = parse_session_file(&path, &project_path) {
                entries.push(e);
            }
        }
    }
    entries.sort_by(|a, b| {
        let ta = a.get("timestamp").and_then(|x| x.as_str()).unwrap_or("");
        let tb = b.get("timestamp").and_then(|x| x.as_str()).unwrap_or("");
        tb.cmp(ta)
    });
    let n = entries.len();
    write_session_index(&project_path, &entries)?;
    Ok(n)
}

#[derive(Deserialize)]
pub struct SearchParams {
    query: Option<String>,
    tag: Option<String>,
    file: Option<String>,
    kind: Option<String>,
    limit: Option<usize>,
}

/// Recherche dans l'index. Full-text (substring insensible à la casse, ou
/// regex si la chaîne commence par `/`), filtres tag/file/kind. Tri décroissant
/// par timestamp. Tags fusionnés depuis le fichier de tags.
#[tauri::command]
pub fn search_sessions(state: State<AppState>, params: SearchParams) -> Result<Value, String> {
    let project_path = state
        .project_path
        .lock()
        .unwrap()
        .clone()
        .ok_or("Aucun projet ouvert")?;
    let mut entries = read_session_index(&project_path);
    let tags_map = read_session_tags(&project_path);

    // Fusion des tags dans chaque entrée (par id).
    for e in entries.iter_mut() {
        if let Some(id) = e.get("id").and_then(|x| x.as_str()) {
            if let Some(tags) = tags_map.get(id) {
                if let Some(obj) = e.as_object_mut() {
                    obj.insert(
                        "tags".to_string(),
                        Value::Array(tags.iter().map(|s| Value::String(s.clone())).collect()),
                    );
                }
            }
        }
    }

    let query = params.query.unwrap_or_default();
    let tag = params.tag.unwrap_or_default();
    let file = params.file.unwrap_or_default();
    let kind = params.kind.unwrap_or_default();
    let limit = params.limit.unwrap_or(200);

    // Compilation d'une regex optionnelle (si query commence par `/`).
    let re = if let Some(rest) = query.strip_prefix('/') {
        regex::Regex::new(rest).ok()
    } else {
        None
    };
    let q_lc = query.to_lowercase();

    let mut results: Vec<Value> = Vec::new();
    for e in entries {
        let id = e.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
        // Filtre kind
        if !kind.is_empty() {
            let k = e.get("kind").and_then(|x| x.as_str()).unwrap_or("chat");
            if k != kind {
                continue;
            }
        }
        // Filtre tag
        if !tag.is_empty() {
            let tags = e.get("tags").and_then(|x| x.as_array()).cloned().unwrap_or_default();
            let has = tags.iter().any(|x| x.as_str() == Some(&tag));
            if !has {
                continue;
            }
        }
        // Filtre file (chemin relatif contenant)
        if !file.is_empty() {
            let files = e.get("files").and_then(|x| x.as_array()).cloned().unwrap_or_default();
            let flc = file.to_lowercase();
            let has = files
                .iter()
                .any(|x| x.as_str().map(|s| s.to_lowercase().contains(&flc)).unwrap_or(false));
            if !has {
                continue;
            }
        }
        // Filtre query full-text
        if !query.is_empty() {
            let prompt = e.get("prompt").and_then(|x| x.as_str()).unwrap_or("").to_string();
            let summary = e.get("summary").and_then(|x| x.as_str()).unwrap_or("").to_string();
            let files = e.get("files").and_then(|x| x.as_array()).cloned().unwrap_or_default();
            let files_str = files
                .iter()
                .filter_map(|x| x.as_str())
                .collect::<Vec<_>>()
                .join(" ");
            let hay = format!("{} {} {}", prompt, summary, files_str);
            if let Some(re) = &re {
                if !re.is_match(&hay) {
                    continue;
                }
            } else {
                if !hay.to_lowercase().contains(&q_lc) {
                    continue;
                }
            }
        }
        let _ = id;
        results.push(e);
        if results.len() >= limit {
            break;
        }
    }
    // Tri déjà assuré à l'indexation, mais on re-trie au cas où (live updates).
    results.sort_by(|a, b| {
        let ta = a.get("timestamp").and_then(|x| x.as_str()).unwrap_or("");
        let tb = b.get("timestamp").and_then(|x| x.as_str()).unwrap_or("");
        tb.cmp(ta)
    });
    let indexed = sessions_index_path(&project_path).exists();
    Ok(serde_json::json!({ "entries": results, "total": results.len(), "indexed": indexed }))
}

/// Retourne le détail d'une session : entrée indexée + contenu complet du
/// JSONL pi (messages simplifiés : role + text + tool_use name/path).
#[tauri::command]
pub fn get_session_detail(state: State<AppState>, id: String) -> Result<Value, String> {
    let project_path = state
        .project_path
        .lock()
        .unwrap()
        .clone()
        .ok_or("Aucun projet ouvert")?;
    let entries = read_session_index(&project_path);
    let entry = entries
        .iter()
        .find(|e| e.get("id").and_then(|x| x.as_str()) == Some(&id))
        .cloned()
        .ok_or("Session non trouvée dans l'index")?;

    // Localiser le fichier JSONL pi correspondant.
    let config = state.config.lock().unwrap();
    let session_dir = project_sessions_dir(&config);
    let folder_name = project_to_session_folder(&project_path);
    let project_dir = session_dir.join(&folder_name);
    drop(config);

    let mut messages: Vec<Value> = Vec::new();
    if project_dir.exists() {
        for entry_it in fs::read_dir(&project_dir).map_err(|e| format!("Lecture sessions: {}", e))? {
            let entry_it = match entry_it {
                Ok(e) => e,
                Err(_) => continue,
            };
            let path = entry_it.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
            if !stem.ends_with(&format!("_{}", id)) {
                continue;
            }
            let content = fs::read_to_string(&path).unwrap_or_default();
            for line in content.lines() {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                let v: Value = match serde_json::from_str(line) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                if v.get("type").and_then(|x| x.as_str()) != Some("message") {
                    continue;
                }
                if let Some(msg) = v.get("message") {
                    let role = msg.get("role").and_then(|x| x.as_str()).unwrap_or("").to_string();
                    let text = extract_message_text(msg);
                    let mut tools: Vec<Value> = Vec::new();
                    if let Some(arr) = msg.get("content").and_then(|c| c.as_array()) {
                        for item in arr {
                            if item.get("type").and_then(|x| x.as_str()) == Some("tool_use") {
                                let name = item.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string();
                                let input = item.get("input").cloned().unwrap_or(Value::Null);
                                let path_str = extract_tool_path(&input).unwrap_or_default();
                                tools.push(serde_json::json!({
                                    "name": name,
                                    "path": path_str
                                }));
                            }
                        }
                    }
                    if !text.is_empty() || !tools.is_empty() {
                        messages.push(serde_json::json!({
                            "role": role,
                            "text": text,
                            "tools": tools
                        }));
                    }
                }
            }
            break;
        }
    }
    // Fusion tags
    let tags_map = read_session_tags(&project_path);
    let tags = tags_map.get(&id).cloned().unwrap_or_default();
    let mut entry = entry;
    if let Some(obj) = entry.as_object_mut() {
        obj.insert(
            "tags".to_string(),
            Value::Array(tags.iter().map(|s| Value::String(s.clone())).collect()),
        );
    }
    Ok(serde_json::json!({
        "entry": entry,
        "messages": messages
    }))
}

/// Persiste les tags d'une session (fichier séparé, ne touche pas l'index).
#[tauri::command]
pub fn set_session_tags(state: State<AppState>, id: String, tags: Vec<String>) -> Result<(), String> {
    let project_path = state
        .project_path
        .lock()
        .unwrap()
        .clone()
        .ok_or("Aucun projet ouvert")?;
    let mut map = read_session_tags(&project_path);
    if tags.is_empty() {
        map.remove(&id);
    } else {
        // dédupliquer + trier
        let mut t: Vec<String> = tags.into_iter().collect();
        t.sort();
        t.dedup();
        map.insert(id, t);
    }
    write_session_tags(&project_path, &map)
}

/// Liste tous les tags utilisés (pour l'autocomplétion).
#[tauri::command]
pub fn list_session_tags(state: State<AppState>) -> Result<Vec<String>, String> {
    let project_path = state
        .project_path
        .lock()
        .unwrap()
        .clone()
        .ok_or("Aucun projet ouvert")?;
    let map = read_session_tags(&project_path);
    let mut all: Vec<String> = Vec::new();
    for tags in map.values() {
        for t in tags {
            if !all.contains(t) {
                all.push(t.clone());
            }
        }
    }
    all.sort();
    Ok(all)
}

/// Écrit/met à jour une entrée de session dans l'index (capture live, appelé par
/// le frontend à l'agent_end). Append-style : retire l'entrée existante de même
/// id puis réécrit. Les tags ne sont jamais écrasés (gérés dans un fichier à part).
#[tauri::command]
pub fn record_session_entry(state: State<AppState>, entry: Value) -> Result<(), String> {
    let project_path = state
        .project_path
        .lock()
        .unwrap()
        .clone()
        .ok_or("Aucun projet ouvert")?;
    let id = entry
        .get("id")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    if id.is_empty() {
        return Err("id de session manquant".into());
    }
    let mut entries = read_session_index(&project_path);
    entries.retain(|e| {
        e.get("id").and_then(|x| x.as_str()).unwrap_or("") != id
    });
    // Forcer tags=[] dans l'index (les tags vivent dans le fichier dédié).
    let mut entry = entry;
    if let Some(obj) = entry.as_object_mut() {
        obj.insert("tags".to_string(), Value::Array(vec![]));
        // Champ indexed_at horodaté
        obj.insert("indexed_at".to_string(), Value::String(now_iso()));
    }
    entries.push(entry);
    entries.sort_by(|a, b| {
        let ta = a.get("timestamp").and_then(|x| x.as_str()).unwrap_or("");
        let tb = b.get("timestamp").and_then(|x| x.as_str()).unwrap_or("");
        tb.cmp(ta)
    });
    write_session_index(&project_path, &entries)
}

// ── Sessions pi (liste + reprise) ──

#[tauri::command]
pub fn list_sessions(state: State<AppState>) -> Result<Value, String> {
    let project_path = state.project_path.lock().unwrap();
    let project_path = project_path.as_ref().ok_or("Aucun projet ouvert")?;

    let config = state.config.lock().unwrap();
    let session_dir = if config.rpc_session_dir.is_empty() {
        // Repertoire par defaut : ~/.{stem}/agent/sessions (pi, plh, ...)
        resolve_agent_home(&config.rpc_pi_path)?.join("agent").join("sessions")
    } else {
        std::path::PathBuf::from(&config.rpc_session_dir)
    };

    // Calculer le nom du dossier projet
    let folder_name = project_to_session_folder(project_path);
    let project_dir = session_dir.join(&folder_name);

    if !project_dir.exists() {
        return Ok(serde_json::json!([]));
    }

    let mut sessions = Vec::new();
    let entries = std::fs::read_dir(&project_dir)
        .map_err(|e| format!("Erreur lecture dossier sessions: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Erreur entrée: {}", e))?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }

        let file_name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        // Format: YYYY-MM-DDTHH-MM-SS-SSSZ_UUID
        let parts: Vec<&str> = file_name.splitn(2, '_').collect();
        let timestamp = parts.first().unwrap_or(&"").to_string();
        let session_id = parts.get(1).unwrap_or(&"").to_string();

        // Taille du fichier
        let meta = std::fs::metadata(&path).ok();
        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);

        // Date de modification du fichier (mtime)
        let modified = meta
            .and_then(|m| m.modified().ok())
            .map(|t| {
                let dt: chrono::DateTime<chrono::Utc> = t.into();
                dt.format("%Y-%m-%dT%H:%M:%S").to_string()
            })
            .unwrap_or(timestamp);

        // Lire le fichier en entier pour extraire l'aperçu
        let content = std::fs::read_to_string(&path).unwrap_or_default();

        // Extraire le premier message utilisateur comme aperçu
        let preview = content
            .lines()
            .filter_map(|line| serde_json::from_str::<Value>(line).ok())
            .find(|v| {
                v.get("type").and_then(|t| t.as_str()) == Some("message")
                    && v.get("message").and_then(|m| m.get("role")).and_then(|r| r.as_str()) == Some("user")
            })
            .and_then(|v| {
                v.get("message")?.get("content")?.as_array()?.first()?.get("text")?.as_str().map(|s| s.to_string())
            })
            .unwrap_or_default();
        let preview = if preview.len() > 120 {
            // Découper à 120 caractères (pas bytes) pour éviter de casser un caractère UTF-8
            let chars: Vec<char> = preview.chars().collect();
            let truncated: String = chars.iter().take(120).collect();
            format!("{}…", truncated)
        } else {
            preview
        };

        sessions.push(serde_json::json!({
            "id": session_id,
            "timestamp": modified,
            "file": path.to_string_lossy().to_string(),
            "size": size,
            "preview": preview
        }));
    }

    // Trier par date décroissante
    sessions.sort_by(|a, b| {
        let ta = a.get("timestamp").and_then(|v| v.as_str()).unwrap_or("");
        let tb = b.get("timestamp").and_then(|v| v.as_str()).unwrap_or("");
        tb.cmp(ta)
    });

    Ok(serde_json::json!(sessions))
}

/// Convertit un chemin de projet en nom de dossier de sessions
pub(crate) fn project_to_session_folder(path: &str) -> String {
    let clean: String = path
        .chars()
        .map(|c| match c {
            ':' | '\\' | '/' => '-',
            _ => c,
        })
        .collect();
    format!("--{}--", clean)
}

#[tauri::command]
pub fn resume_agent_session(state: State<AppState>, session_file: String) -> Result<(), String> {
    let mut rpc = state.rpc_state.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session agent active")?;
    let cmd = serde_json::json!({
        "type": "switch_session",
        "sessionPath": session_file
    });
    rpc_manager::send_command_sync(session, cmd).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_chars_keeps_short() {
        assert_eq!(truncate_chars("hello", 10), "hello");
    }

    #[test]
    fn truncate_chars_truncates_by_chars() {
        // Trongue par caractères, pas par octets (caractères multi-octets)
        assert_eq!(truncate_chars("héllo", 3), "hél");
        assert_eq!(truncate_chars("abcdef", 3), "abc");
    }

    #[test]
    fn normalize_rel_relative_unchanged() {
        assert_eq!(normalize_rel("src/main.js", "/proj"), "src/main.js");
    }

    #[test]
    fn normalize_rel_absolute_in_project() {
        // Chemin absolu sous le projet → relatif (temp_dir est absolu sur Windows & Unix)
        let proj = std::env::temp_dir().join("proj_norm_test");
        let file = proj.join("src/main.js");
        assert_eq!(
            normalize_rel(&file.to_string_lossy(), &proj.to_string_lossy()),
            "src/main.js"
        );
        // Séparateurs Windows normalisés
        let proj_w = proj.to_string_lossy().replace("\\", "/");
        assert_eq!(
            normalize_rel(&file.to_string_lossy().replace("\\", "/"), &proj_w),
            "src/main.js"
        );
    }

    #[test]
    fn normalize_rel_absolute_outside() {
        // Chemin absolu hors projet → inchangé (backslashes → slash)
        assert_eq!(normalize_rel("/other/file.js", "/proj"), "/other/file.js");
    }

    #[test]
    fn extract_message_text_content_array() {
        let v = serde_json::json!({"content": [
            {"type": "text", "text": "premier"},
            {"type": "text", "text": "second"}
        ]});
        assert_eq!(extract_message_text(&v), "premier\nsecond");
    }

    #[test]
    fn extract_message_text_skips_non_text() {
        let v = serde_json::json!({"content": [
            {"type": "image", "data": "x"},
            {"type": "text", "text": "seul texte"}
        ]});
        assert_eq!(extract_message_text(&v), "seul texte");
    }

    #[test]
    fn extract_message_text_content_string() {
        let v = serde_json::json!({"content": "texte brut"});
        assert_eq!(extract_message_text(&v), "texte brut");
    }

    #[test]
    fn extract_message_text_empty() {
        let v = serde_json::json!({"content": []});
        assert_eq!(extract_message_text(&v), "");
        assert_eq!(extract_message_text(&serde_json::json!({})), "");
    }

    #[test]
    fn extract_tool_path_variants() {
        for key in ["path", "file_path", "filePath", "filename"] {
            let v = serde_json::json!({key: "src/x.rs"});
            assert_eq!(extract_tool_path(&v).as_deref(), Some("src/x.rs"), "clé {key}");
        }
    }

    #[test]
    fn extract_tool_path_priority_and_empty() {
        // path prioritaire sur file_path
        let v = serde_json::json!({"path": "a.rs", "file_path": "b.rs"});
        assert_eq!(extract_tool_path(&v).as_deref(), Some("a.rs"));
        // vide → None
        let v = serde_json::json!({"path": "", "file_path": "ok.rs"});
        assert_eq!(extract_tool_path(&v).as_deref(), Some("ok.rs"));
        assert_eq!(extract_tool_path(&serde_json::json!({})), None);
    }
}
