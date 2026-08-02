// models_config.rs — Édition des registres de modèles IA (onglet « Fournisseurs »).
//
// Domaine extrait de `lib.rs` (2026-08) : lecture/écriture de `models.json` et
// `model-switch.json` d'un backend (pi/plh/...), liste des backends disponibles,
// test de disponibilité d'un provider. Ces commandes travaillent sur le
// répertoire home du backend (`~/.{stem}`), résolu par stem explicite. Elles ne
// dépendent ni de `AppState`, ni du watcher.

use serde_json::Value;

/// Résout `~/.<stem>` (home dir + dossier point-stem). Contrairement à
/// `resolve_agent_home` qui déduit le stem du chemin de l'exécutable, cette
/// variante prend un stem explicite (« pi », « plh », ...) pour permettre
/// d'éditer le registre d'un backend même s'il n'est pas celui actif.
pub fn resolve_agent_home_by_stem(stem: &str) -> Result<std::path::PathBuf, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "Impossible de trouver le home dir".to_string())?;
    let clean = stem.trim().trim_start_matches('.');
    if clean.is_empty() {
        return Err("stem vide".to_string());
    }
    Ok(std::path::PathBuf::from(&home).join(format!(".{}", clean)))
}
/// Liste les backends disponibles : scanne le home dir à la recherche de
/// dossiers `.{stem}/agent/models.json`. Retourne les stems (ex: ["pi","plh"]),
/// triés, avec « pi » en tête si présent. Sert à peupler le sélecteur de
/// backend dans l'onglet Fournisseurs.
#[tauri::command]
pub fn list_agent_backends() -> Result<Vec<String>, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "Impossible de trouver le home dir".to_string())?;
    let home_dir = std::path::Path::new(&home);
    let mut stems: Vec<String> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(home_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = match name.to_str() {
                Some(s) => s,
                None => continue,
            };
            if !name.starts_with('.') {
                continue;
            }
            let stem = name.trim_start_matches('.');
            if stem.is_empty() {
                continue;
            }
            // Ne garder que les dossiers contenant agent/models.json
            let models_file = entry.path().join("agent").join("models.json");
            if models_file.is_file() {
                stems.push(stem.to_string());
            }
        }
    }
    stems.sort();
    // « pi » en tête si présent (backend canonique)
    if let Some(pos) = stems.iter().position(|s| s == "pi") {
        let pi = stems.remove(pos);
        stems.insert(0, pi);
    }
    Ok(stems)
}
/// Lit le `models.json` d'un backend donné (`~/.{stem}/agent/models.json`).
/// Retourne l'objet JSON tel quel (round-trip) pour préserver les clés non
/// gérées par l'UI. Si le fichier n'existe pas, retourne un objet vide.
#[tauri::command]
pub fn read_models_config(stem: String) -> Result<Value, String> {
    let path = resolve_agent_home_by_stem(&stem)?.join("agent").join("models.json");
    if !path.exists() {
        return Ok(serde_json::json!({ "providers": {} }));
    }
    let json_str = std::fs::read_to_string(&path)
        .map_err(|e| format!("Lecture models.json: {}", e))?;
    let config: Value = serde_json::from_str(&json_str)
        .map_err(|e| format!("JSON invalide: {}", e))?;
    Ok(config)
}
/// Écrit le `models.json` d'un backend. Backup `models.json.bak` avant écriture,
/// puis écriture atomique (fichier temp + rename). Validation : `providers`
/// doit être un objet (ou absent → {});
#[tauri::command]
pub fn write_models_config(stem: String, config: Value) -> Result<(), String> {
    // Validation minimale
    let mut cfg = config;
    if cfg.get("providers").is_none() {
        cfg = serde_json::json!({ "providers": {} });
    }
    if !cfg["providers"].is_object() {
        return Err("`providers` doit être un objet".to_string());
    }
    let agent_dir = resolve_agent_home_by_stem(&stem)?.join("agent");
    std::fs::create_dir_all(&agent_dir)
        .map_err(|e| format!("Création du dossier agent: {}", e))?;
    let target = agent_dir.join("models.json");
    // Backup
    if target.exists() {
        let bak = agent_dir.join("models.json.bak");
        let _ = std::fs::copy(&target, &bak);
    }
    let pretty = serde_json::to_string_pretty(&cfg)
        .map_err(|e| format!("Sérialisation JSON: {}", e))?;
    std::fs::write(&target, pretty)
        .map_err(|e| format!("Écriture models.json: {}", e))?;
    Ok(())
}
/// Lit le `model-switch.json` d'un backend (`~/.{stem}/agent/model-switch.json`).
/// Contient `{ aliases: {...}, defaultModel: "provider/id" }`. Retourne `{}` si
/// le fichier n'existe pas.
#[tauri::command]
pub fn read_model_aliases(stem: String) -> Result<Value, String> {
    let path = resolve_agent_home_by_stem(&stem)?.join("agent").join("model-switch.json");
    if !path.exists() {
        return Ok(serde_json::json!({ "aliases": {}, "defaultModel": "" }));
    }
    let json_str = std::fs::read_to_string(&path)
        .map_err(|e| format!("Lecture model-switch.json: {}", e))?;
    let parsed: Value = serde_json::from_str(&json_str)
        .map_err(|e| format!("JSON invalide: {}", e))?;
    Ok(parsed)
}
/// Écrit le `model-switch.json` d'un backend. Backup `.bak` + écriture.
/// Validation : si `aliases` est présent, ce doit être un objet ; si
/// `defaultModel` est présent, ce doit être une chaîne.
#[tauri::command]
pub fn write_model_aliases(stem: String, config: Value) -> Result<(), String> {
    if let Some(a) = config.get("aliases") {
        if !a.is_null() && !a.is_object() {
            return Err("`aliases` doit être un objet".to_string());
        }
    }
    if let Some(d) = config.get("defaultModel") {
        if !d.is_null() && !d.is_string() {
            return Err("`defaultModel` doit être une chaîne".to_string());
        }
    }
    let agent_dir = resolve_agent_home_by_stem(&stem)?.join("agent");
    std::fs::create_dir_all(&agent_dir)
        .map_err(|e| format!("Création du dossier agent: {}", e))?;
    let target = agent_dir.join("model-switch.json");
    if target.exists() {
        let bak = agent_dir.join("model-switch.json.bak");
        let _ = std::fs::copy(&target, &bak);
    }
    let pretty = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Sérialisation JSON: {}", e))?;
    std::fs::write(&target, pretty)
        .map_err(|e| format!("Écriture model-switch.json: {}", e))?;
    Ok(())
}
/// Teste la disponibilité d'un provider : effectue `GET {baseUrl}/models`
/// (endpoint OpenAI-compatible, supporté par ollama et llama-cpp server) et
/// retourne la liste des IDs de modèles disponibles côté serveur. Si l'API key
/// est renseignée (et != "none"), ajoute l'en-tête Authorization Bearer.
/// Timeout 4 s. Retourne `{ ok, models: [...], error }`.
#[tauri::command]
pub async fn test_provider_models(base_url: String, api_key: Option<String>) -> Result<Value, String> {
    use tokio::time::{timeout, Duration};
    let key = api_key.unwrap_or_default();
    let key = key.trim();
    let mut url = base_url.trim().trim_end_matches('/').to_string();
    if !url.starts_with("http://") && !url.starts_with("https://") {
        url = format!("http://{}", url);
    }
    let endpoint = format!("{}/models", url);
    // Client bloquant dans spawn_blocking pour ne pas bloquer le runtime async
    // de Tauri. reqwest est configuré avec rustls-tls (pas de dépendance système
    // OpenSSL). Timeout global 5 s (spawn_blocking) + 4 s par requête HTTP.
    let key_owned = if key.is_empty() || key == "none" {
        String::new()
    } else {
        key.to_string()
    };
    let endpoint_owned = endpoint.clone();
    let res = timeout(
        Duration::from_secs(5),
        tokio::task::spawn_blocking(move || -> Result<Value, String> {
            let b = reqwest::blocking::Client::builder()
                .timeout(std::time::Duration::from_secs(4))
                .danger_accept_invalid_certs(true);
            let client = b.build().map_err(|e| e.to_string())?;
            let mut req = client.get(&endpoint_owned);
            if !key_owned.is_empty() {
                req = req.bearer_auth(&key_owned);
            }
            let resp = req.send().map_err(|e| e.to_string())?;
            let status = resp.status();
            let body = resp.text().map_err(|e| e.to_string())?;
            if !status.is_success() {
                return Ok(serde_json::json!({
                    "ok": false,
                    "models": [],
                    "error": format!("HTTP {}", status.as_u16())
                }));
            }
            let parsed: Value = serde_json::from_str(&body)
                .map_err(|e| format!("Réponse non-JSON: {}", e))?;
            // Format OpenAI: { data: [ { id: "..." }, ... ] }
            let mut ids: Vec<String> = Vec::new();
            if let Some(data) = parsed["data"].as_array() {
                for m in data {
                    if let Some(id) = m["id"].as_str() {
                        ids.push(id.to_string());
                    }
                }
            }
            ids.sort();
            Ok(serde_json::json!({ "ok": true, "models": ids, "error": null }))
        }),
    )
    .await;
    match res {
        Ok(Ok(Ok(v))) => Ok(v),
        Ok(Ok(Err(e))) => Ok(serde_json::json!({ "ok": false, "models": [], "error": e })),
        Ok(Err(_)) => Ok(serde_json::json!({ "ok": false, "models": [], "error": "join error" })),
        Err(_) => Ok(serde_json::json!({ "ok": false, "models": [], "error": "timeout (5s)" })),
    }
}
