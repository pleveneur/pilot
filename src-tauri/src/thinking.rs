// thinking.rs — socle pur du « niveau de réflexion » (T2).
//
// Aucun effet sur le comportement actuel : rien n'appelle encore ces fonctions
// (leur application au lancement d'une session est une tâche ultérieure).
//
// Miroir Rust de `src/js/thinking-levels.js` (T1) : mêmes clés, même ramenage.
// Les niveaux sont ceux du moteur pi (`--thinking off|minimal|low|medium|high|
// xhigh|max`). Aucune liste n'est inventée : la liste réellement supportée est
// toujours fournie par l'appelant (session vivante, autorité) ou lue hors ligne
// dans `models-store.json` (par modèle) ou `models.json` (par fournisseur).

use std::path::Path;

use serde_json::Value;

/// Ordre croissant de réflexion.
pub const THINKING_LEVELS: [&str; 7] =
    ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

fn rank(level: &str) -> Option<usize> {
    THINKING_LEVELS.iter().position(|l| *l == level)
}

/// Ramène `requested` aux capacités du modèle : niveau supporté inchangé, sinon
/// le palier supporté immédiatement inférieur (jamais supérieur). Si aucun
/// palier inférieur n'existe, on rend le plus faible des niveaux supportés
/// (`off` ne remonte donc jamais tout seul). Niveau demandé inconnu ou liste
/// vide → `None` (rien à envoyer).
pub fn clamp_thinking_level(requested: &str, available: &[String]) -> Option<String> {
    let wanted = rank(requested)?;
    let mut levels: Vec<&String> = available.iter().filter(|l| rank(l).is_some()).collect();
    if levels.is_empty() {
        return None;
    }
    levels.sort_by_key(|l| rank(l).unwrap_or(0));
    let best = levels
        .iter()
        .rev()
        .find(|l| rank(l).unwrap_or(0) <= wanted)
        .copied()
        .unwrap_or(levels[0]);
    Some(best.clone())
}

/// Niveau effectif à poser : première valeur non vide de la chaîne de priorité
/// (session > agent > réglage général Pilot > défaut du modèle > défaut du
/// moteur — l'ordre est fourni par l'appelant), ramenée aux capacités du
/// modèle. `None` = ne rien envoyer : le moteur garde alors son propre défaut,
/// exactement comme aujourd'hui.
pub fn resolve_thinking_level(candidates: &[&str], available: &[String]) -> Option<String> {
    let requested = candidates
        .iter()
        .map(|c| c.trim())
        .find(|c| !c.is_empty())?;
    clamp_thinking_level(requested, available)
}

/// Niveaux supportés d'après le contenu de `~/.<stem>/agent/models-store.json`
/// (repli hors-ligne). Forme attendue : `<provider> → { models: [ … ] }` ; une
/// forme `<provider> → [ … ]` est aussi acceptée.
///
/// - entrée absente → `[]` (on n'invente rien : le menu dira « indisponible ») ;
/// - `reasoning: false` → `["off"]` ;
/// - `thinkingLevelMap` : seules les clés de valeur non `null` sont supportées ;
///   `off` est retenu dès que la clé existe ou que le modèle n'est pas
///   explicitement non raisonnant ;
/// - pas de `thinkingLevelMap` exploitable → `[]`.
pub fn available_levels_from_models_store(
    store: &Value,
    provider: &str,
    model_id: &str,
) -> Vec<String> {
    let Some(entry) = store
        .get(provider)
        .and_then(|p| p.get("models").or(Some(p)))
        .and_then(|models| models.as_array())
        .and_then(|arr| {
            arr.iter().find(|m| {
                m.get("id").and_then(|i| i.as_str()) == Some(model_id)
            })
        })
    else {
        return Vec::new();
    };
    if entry.get("reasoning").and_then(|r| r.as_bool()) == Some(false) {
        return vec!["off".to_string()];
    }
    let Some(map) = entry.get("thinkingLevelMap").and_then(|m| m.as_object()) else {
        return Vec::new();
    };
    THINKING_LEVELS
        .iter()
        .filter(|key| {
            **key == "off" || map.get(**key).map(|v| !v.is_null()).unwrap_or(false)
        })
        .map(|key| (*key).to_string())
        .collect()
}

/// Un fournisseur qui déclare `compat.supportsReasoningEffort === false` dans
/// `~/.<stem>/agent/models.json` (cas `llama-cpp`) ne propose aucun réglage de
/// niveau : seul `off` a un sens. Ces modèles ne figurent pas dans
/// `models-store.json`, d'où cette seconde source.
pub fn provider_declares_no_reasoning_effort(models_json: &Value, provider: &str) -> bool {
    models_json
        .get("providers")
        .and_then(|p| p.get(provider))
        .and_then(|p| p.get("compat"))
        .and_then(|c| c.get("supportsReasoningEffort"))
        .and_then(|v| v.as_bool())
        == Some(false)
}

/// Lecture hors ligne de la liste des niveaux d'un modèle, en deux sources :
/// la carte **par modèle** de `models-store.json` (la plus précise, prime), puis
/// la déclaration **par fournisseur** de `models.json`. Fichier absent, JSON
/// invalide ou modèle inconnu → liste vide (fail-open : on ne propose rien plutôt
/// qu'une liste inventée, et aucune session pi n'est requise).
pub fn read_available_levels(
    store_path: &Path,
    models_path: &Path,
    provider: &str,
    model_id: &str,
) -> Vec<String> {
    let store = std::fs::read_to_string(store_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok());
    if let Some(store) = &store {
        let levels = available_levels_from_models_store(store, provider, model_id);
        if !levels.is_empty() {
            return levels;
        }
    }
    let models = std::fs::read_to_string(models_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok());
    match models {
        Some(models) if provider_declares_no_reasoning_effort(&models, provider) => {
            vec!["off".to_string()]
        }
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn levels(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    /// Ramenage : les mêmes cas sont vérifiés côté JS (table partagée T1/T2).
    #[test]
    fn clamp_respects_model_capabilities() {
        let capable = levels(&["off", "low", "medium", "high"]);
        // Niveau supporté → inchangé.
        assert_eq!(clamp_thinking_level("medium", &capable).as_deref(), Some("medium"));
        // Au-dessus du maximum supporté → maximum supporté.
        assert_eq!(clamp_thinking_level("max", &capable).as_deref(), Some("high"));
        // Palier non supporté → palier inférieur le plus proche.
        let sparse = levels(&["off", "low", "high"]);
        assert_eq!(clamp_thinking_level("medium", &sparse).as_deref(), Some("low"));
        // `off` reste `off`, même sur un modèle qui sait raisonner.
        assert_eq!(clamp_thinking_level("off", &capable).as_deref(), Some("off"));
        // Modèle qui ne sait pas raisonner : seul `off` subsiste.
        assert_eq!(clamp_thinking_level("high", &levels(&["off"])).as_deref(), Some("off"));
        // Liste vide → rien à envoyer.
        assert_eq!(clamp_thinking_level("high", &[]), None);
        // Niveau demandé inconnu → rien à envoyer.
        assert_eq!(clamp_thinking_level("ultra", &capable), None);
    }

    /// Chaîne de priorité : première valeur non vide, puis ramenage.
    #[test]
    fn resolve_picks_first_non_empty_candidate_then_clamps() {
        let capable = levels(&["off", "low", "medium", "high"]);
        let unavailable = levels(&["off"]);

        // Session > agent > général : la session gagne.
        assert_eq!(
            resolve_thinking_level(&["high", "low", "medium"], &capable).as_deref(),
            Some("high")
        );
        // Étages vides → le suivant fournit la valeur.
        assert_eq!(
            resolve_thinking_level(&["", " ", "medium"], &capable).as_deref(),
            Some("medium")
        );
        // Aucun étage renseigné → ne rien envoyer (défaut du moteur conservé).
        assert_eq!(resolve_thinking_level(&["", "  "], &capable), None);
        assert_eq!(resolve_thinking_level(&[], &capable), None);
        // Valeur demandée mais liste indisponible → ne rien envoyer.
        assert_eq!(resolve_thinking_level(&["high"], &[]), None);
        // Modèle non raisonnant → ramené à « off » (le demandé « high » n'est
        // jamais transformé silencieusement en autre chose qu'un palier inférieur).
        assert_eq!(
            resolve_thinking_level(&["high"], &unavailable).as_deref(),
            Some("off")
        );
    }

    /// Repli hors-ligne : lecture de la carte des niveaux du modèle.
    #[test]
    fn available_levels_reads_thinking_level_map() {
        let store = json!({
            "ollama": { "models": [
                { "id": "glm-5.2:cloud", "reasoning": true,
                  "thinkingLevelMap": { "off": null, "minimal": null, "low": "low",
                                        "medium": null, "high": "high",
                                        "xhigh": null, "max": null } },
                { "id": "llama-cpp", "reasoning": false },
                { "id": "sans-carte", "reasoning": true }
            ]},
            "plat": [ { "id": "m1", "reasoning": true,
                        "thinkingLevelMap": { "off": "none", "low": "low" } } ]
        });

        // Clés `null` écartées ; `off` retenu ; ordre croissant.
        assert_eq!(
            available_levels_from_models_store(&store, "ollama", "glm-5.2:cloud"),
            levels(&["off", "low", "high"])
        );
        // Modèle non raisonnant → « off » seul.
        assert_eq!(
            available_levels_from_models_store(&store, "ollama", "llama-cpp"),
            levels(&["off"])
        );
        // Pas de carte exploitable → liste vide (on n'invente rien).
        assert!(available_levels_from_models_store(&store, "ollama", "sans-carte").is_empty());
        // Modèle absent → liste vide.
        assert!(available_levels_from_models_store(&store, "ollama", "inconnu").is_empty());
        assert!(available_levels_from_models_store(&store, "absent", "m1").is_empty());
        // Forme `<provider> → [ … ]` acceptée.
        assert_eq!(
            available_levels_from_models_store(&store, "plat", "m1"),
            levels(&["off", "low"])
        );
    }

    /// Repli par fournisseur (`compat.supportsReasoningEffort`).
    #[test]
    fn provider_compat_declares_no_reasoning_effort() {
        // Forme réelle de ~/.pi/agent/models.json.
        let models = json!({
            "providers": {
                "llama-cpp": { "api": "openai-completions", "models": [ { "id": "gemma4-12b" } ],
                               "compat": { "supportsDeveloperRole": false,
                                           "supportsReasoningEffort": false } },
                "ollama": { "compat": {} },
                "autre": { "compat": { "supportsReasoningEffort": true } }
            }
        });
        assert!(provider_declares_no_reasoning_effort(&models, "llama-cpp"));
        assert!(!provider_declares_no_reasoning_effort(&models, "ollama"));
        assert!(!provider_declares_no_reasoning_effort(&models, "autre"));
        assert!(!provider_declares_no_reasoning_effort(&models, "inconnu"));
        assert!(!provider_declares_no_reasoning_effort(&json!({}), "llama-cpp"));
    }

    /// Lecture disque des deux sources, la carte par modèle primant.
    #[test]
    fn read_available_levels_prefers_model_map_then_provider_compat() {
        let dir = std::env::temp_dir();
        let stem = std::process::id();
        let store_path = dir.join(format!("pilot-thinking-t2-store-{stem}.json"));
        let models_path = dir.join(format!("pilot-thinking-t2-models-{stem}.json"));
        std::fs::write(
            &store_path,
            json!({
                "ollama": { "models": [
                    { "id": "glm", "reasoning": true,
                      "thinkingLevelMap": { "off": "none", "low": "low", "high": "high" } }
                ]}
            })
            .to_string(),
        )
        .unwrap();
        std::fs::write(
            &models_path,
            json!({
                "providers": {
                    "llama-cpp": { "compat": { "supportsReasoningEffort": false } },
                    "ollama": { "compat": { "supportsReasoningEffort": false } },
                    "ollama-kalico": { "compat": {} },
                }
            })
            .to_string(),
        )
        .unwrap();

        // La carte par modèle prime sur la déclaration du fournisseur.
        assert_eq!(
            read_available_levels(&store_path, &models_path, "ollama", "glm"),
            levels(&["off", "low", "high"])
        );
        // Modèle absent de la carte + fournisseur déclaré non raisonnant → `off` seul.
        assert_eq!(
            read_available_levels(&store_path, &models_path, "llama-cpp", "gemma4-12b"),
            levels(&["off"])
        );
        // Modèle absent + fournisseur muet → liste vide (on n'invente rien).
        assert!(read_available_levels(&store_path, &models_path, "ollama-kalico", "x").is_empty());
        // Fournisseur inconnu des deux fichiers → liste vide.
        assert!(read_available_levels(&store_path, &models_path, "inconnu", "x").is_empty());

        let _ = std::fs::remove_file(&store_path);
        let _ = std::fs::remove_file(&models_path);
    }

    /// Fichier absent ou illisible → liste vide, jamais d'erreur.
    #[test]
    fn read_available_levels_fails_open() {
        let missing = std::env::temp_dir().join("pilot-thinking-inexistant.json");
        assert!(read_available_levels(&missing, &missing, "ollama", "glm-5.2:cloud").is_empty());
        assert!(
            read_available_levels(
                Path::new("Z:/chemin/inexistant.json"),
                Path::new("Z:/chemin/inexistant.json"),
                "a",
                "b"
            )
            .is_empty()
        );
    }
}
