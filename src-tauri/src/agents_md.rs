// agents_md.rs — Génération / mise à jour d'`AGENTS.md` par l'IA (issue #5).
//
// `AGENTS.md` est le fichier d'instructions projet lu nativement par pi et plh
// (discovery + injection dans le system prompt — cf. `resource-loader.ts` côté
// pi et `project_context.rs` côté plh). Pilot ne l'injecte pas lui-même (cela
// ferait doublon avec la discovery native).
//
// Cette commande lance un process pi **temporaire cadré** (`pi --mode rpc
// --no-session`) avec `cwd = projectPath` : pi a donc accès à ses outils
// (ls, read, write, edit) pour **analyser le projet** puis **créer ou mettre à
// jour** `AGENTS.md` à la racine. La session de coding principale (rpc_state
// dans `lib.rs`) n'est jamais touchée → aucune pollution. On réutilise
// `help::ask_pi_caged_timed` (mêmes garanties que l'aide intégrée et la revue).
//
// Le modèle est fourni par le frontend (modèle actif du chat, format
// "provider/modelId"). Le timeout est allongé (5 min) car l'agent enchaîne
// lectures + écriture.

use std::time::Duration;

use tauri::State;

use crate::help::ask_pi_caged_timed;

/// Timeout global de la génération : analyse du projet + écriture d'AGENTS.md.
/// 5 min laisse une marge pour un projet moyen (ls, read package.json/Cargo.toml,
/// read README, structure, write). Au-delà, on abandonne (non-bloquant).
const GENERATE_TIMEOUT_SECS: u64 = 300;

/// Commande : génère ou met à jour `AGENTS.md` à la racine du projet courant.
///
/// - `model` : modèle actif du chat (format "provider/modelId"), fourni par le
///   frontend. Si vide → erreur (pi `--no-session` n'a pas de modèle par défaut).
///
/// Retourne le texte de synthèse produit par l'agent (résumé court). Le fichier
/// `AGENTS.md` est écrit directement par l'agent via ses outils (write/edit).
///
/// Erreur si aucun projet ouvert, si aucun modèle fourni, ou si pi échoue.
#[tauri::command]
pub fn generate_agents_md(
    state: State<crate::AppState>,
    model: String,
) -> Result<String, String> {
    let model = model.trim();
    if model.is_empty() {
        return Err(
            "Aucun modèle sélectionné pour le chat. Choisis un modèle dans la liste déroulante de l'agent avant de générer AGENTS.md."
                .to_string(),
        );
    }

    let cfg = state.config.lock().unwrap();
    let pi_path = cfg.rpc_pi_path.clone();
    drop(cfg);

    // cwd = projet courant : pi accède aux outils read/ls/write pour analyser
    // et créer/mettre à jour AGENTS.md. Discovery native : pi lira l'AGENTS.md
    // existant dans son system prompt (utile pour la mise à jour).
    let project = state.project_path.lock().unwrap();
    let cwd = match project.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Aucun projet ouvert".to_string()),
    };
    drop(project);

    let exists = std::path::Path::new(&cwd).join("AGENTS.md").exists();
    let prompt = build_agents_md_prompt(&cwd, exists);

    ask_pi_caged_timed(
        &cwd,
        &pi_path,
        &prompt,
        Some(model),
        Duration::from_secs(GENERATE_TIMEOUT_SECS),
    )
}

/// Construit le prompt de génération / mise à jour d'AGENTS.md.
///
/// L'agent est cadré sur l'objectif (fichier utile à une prochaine session de
/// coding-agent), dispose de ses outils, et doit produire un fichier concis et
/// actionnable. En mise à jour, il préserve les sections utiles existantes.
fn build_agents_md_prompt(_project_path: &str, exists: bool) -> String {
    let action = if exists {
        "METS À JOUR le fichier AGENTS.md à la racine du projet. Conserve les\nsections existantes toujours pertinentes, enrichis-les et corrige ce qui est\nobsolète. Ne supprime pas les règles utiles déjà présentes."
    } else {
        "CRÉE le fichier AGENTS.md à la racine du projet."
    };

    format!(
"Tu es un agent de documentation technique. {action}

OBJECTIF : AGENTS.md est lu automatiquement par les coding-agents (pi, plh) au\ndébut de chaque session pour obtenir toutes les informations utiles au projet.\nIl doit permettre à un agent frais de travailler efficacement dès la première\nintervention, sans avoir à redécouvrir le projet.

PROCÉDURE (utilise tes outils) :
1. Liste la structure du projet (ls) pour en comprendre l'organisation.
2. Lis les fichiers clés : README.md, package.json, Cargo.toml, pyproject.toml,\n   tsconfig.json, ou tout manifeste pertinent. Lis aussi un ou deux fichiers\n   source représentatifs pour saisir les conventions réelles.
3. {file_action} via write (création) ou edit (mise à jour ciblée).

CONTENU ATTENDU d'AGENTS.md (Markdown, concis et actionnable) :
- **Rôle / langue** : à qui s'adresse le fichier, langue de communication\n  imposée à l'agent (si pertinent).
- **Stack technique** : technologies principales par couche.
- **Structure du projet** : arborescence des dossiers/fichiers importants\n  (schéma en code block, pas besoin d'être exhaustif).
- **Commandes** : build, test, lint, run (exemples concrets).
- **Conventions** : nommage, style, patterns à suivre.
- **Pièges / anti-patterns** : écueils connus du projet (si détectables).
- **Navigation rapide** (optionnel) : table « | Tâche | Fichier(s) à lire | »\n  pointant vers les docs/specs clés du projet.

RÈGLES :
- Sois factuel : ne décris QUE ce que tu observes dans le projet. Pas de\n  suppositions sur des features non présentes.
- Sois concis : vise 60–120 lignes. Un AGENTS.md trop long est ignoré.
- Commentaires et code en anglais ; prose explicative dans la langue du projet.
- Ne modifie AUCUN autre fichier qu'AGENTS.md.
- Une fois terminé, réponds par un court résumé (5–10 lignes) des sections\n  créées/mises à jour. Ne recopie pas le contenu du fichier.",
        action = action,
        file_action = if exists {
            "Mets à jour AGENTS.md"
        } else {
            "Crée AGENTS.md"
        }
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_creation_contains_create() {
        let p = build_agents_md_prompt("/proj", false);
        assert!(p.contains("CRÉE le fichier AGENTS.md"));
        assert!(p.contains(" OBJECTIF"));
        assert!(p.contains("write (création)"));
    }

    #[test]
    fn prompt_update_contains_conserve() {
        let p = build_agents_md_prompt("/proj", true);
        assert!(p.contains("METS À JOUR"));
        assert!(p.contains("Conserve les"));
        assert!(p.contains("edit (mise à jour ciblée)"));
    }
}