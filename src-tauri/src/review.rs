// review.rs — Onglet « 🔍 Review » : revue de code assistée par LLM (H5).
//
// L'agent joue le rôle de **second reviewer** sur le diff de la session :
// - « modifs non commitées » : `git diff HEAD` (working tree vs HEAD) — utile
//   avant de committer ;
// - « dernier commit » : `git diff HEAD~1 HEAD` — utile après un commit.
//
// On lance un process pi **temporaire cadré** (`pi --mode rpc --no-session`,
// cwd = dossier temporaire) pour isoler pi du projet : la revue est fournie
// intégralement dans le prompt (le diff), pi n'a pas besoin d'accéder aux
// fichiers. On réutilise `help::ask_pi_caged` (mêmes garanties que l'aide
// intégrée : aucune pollution de la session de coding principale).
//
// Le modèle est lu depuis `config.review_model` (format "provider/modelId",
// peuplé par le sélecteur de l'UI Review). L'historique de revue est géré côté
// frontend et réinjecté à chaque tour (le process pi est sans mémoire).

use std::time::Duration;

use serde::Deserialize;
use tauri::State;

use crate::help::ask_pi_caged;

/// Un tour de la conversation de revue (côté frontend).
#[derive(Deserialize, Clone)]
pub struct ReviewTurn {
    pub role: String, // "user" | "assistant"
    pub content: String,
}

/// Diff maximum injecté dans le prompt (caractères). Au-delà, on tronque avec
/// une note : une revue pertinente n'a généralement pas besoin d'un diff
/// gigantesque, et ça évite d'exploser la fenêtre de contexte.
const MAX_DIFF_CHARS: usize = 60_000;

/// Commande principale : lance une revue de code sur le diff Git courant.
///
/// - `scope` : `"working"` (working tree vs HEAD, défaut) ou `"last"`
///   (dernier commit HEAD~1..HEAD).
/// - `question` : question de suivi optionnelle. Vide → revue initiale.
/// - `history` : historique de revue (réinjecté car pi est sans mémoire).
///
/// Retourne la revue en Markdown. Erreur si le projet n'est pas un repo Git,
/// s'il n'y a rien à reviewer, ou si aucun modèle n'est configuré.
#[tauri::command]
pub fn ask_review(
    state: State<crate::AppState>,
    scope: String,
    question: String,
    history: Vec<ReviewTurn>,
) -> Result<String, String> {
    let cfg = state.config.lock().unwrap();
    let pi_path = cfg.rpc_pi_path.clone();
    let review_model = cfg.review_model.clone();
    drop(cfg);

    if review_model.trim().is_empty() {
        return Err(
            "Aucun modèle configuré pour la revue. Sélectionne un modèle dans la liste déroulante de l'onglet Review."
                .to_string(),
        );
    }

    // Récupérer le diff Git du projet.
    let project = state.project_path.lock().unwrap();
    let cwd = match project.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Aucun projet ouvert".to_string()),
    };
    drop(project);

    let diff = git_review_diff(&cwd, &scope)?;
    if diff.trim().is_empty() {
        let hint = match scope.as_str() {
            "last" => "le dernier commit n'a apporté aucune modification",
            _ => "le working tree est propre (rien de modifié depuis HEAD)",
        };
        return Err(format!("Rien à reviewer : {}.", hint));
    }

    let prompt = build_review_prompt(&diff, &scope, &question, &history);

    // Cwd neutre (dossier temporaire) pour isoler pi du projet : la revue est
    // entièrement dans le prompt, pi n'accède à aucun fichier.
    let temp_cwd = std::env::temp_dir().to_string_lossy().to_string();

    ask_pi_caged(&temp_cwd, &pi_path, &prompt, Some(&review_model))
}

/// Récupère le diff unifié Git et le tronque si nécessaire.
/// - `scope = "working"` → `git diff HEAD` (working tree vs HEAD).
/// - `scope = "last"`   → `git diff HEAD~1 HEAD` (dernier commit).
///
/// Retourne `Err` si le projet n'est pas un repo Git. Retourne `Ok("")` si le
/// diff est vide (rien à reviewer) — l'appelant le signale à l'utilisateur.
fn git_review_diff(cwd: &str, scope: &str) -> Result<String, String> {
    // Vérifier qu'on est dans un work tree Git.
    let check = crate::run_captured(
        "git",
        &["-C", cwd, "rev-parse", "--is-inside-work-tree"],
        Duration::from_secs(3),
    );
    if !check.trim().eq_ignore_ascii_case("true") {
        return Err("Le projet n'est pas un repo Git (ou `git` est absent). Ouvre un projet versionné pour lancer une revue.".to_string());
    }

    let args: Vec<&str> = match scope {
        "last" => vec!["-C", cwd, "diff", "HEAD~1", "HEAD"],
        _ => vec!["-C", cwd, "diff", "HEAD"],
    };
    let out = crate::run_captured("git", &args, Duration::from_secs(10));
    if out.chars().count() > MAX_DIFF_CHARS {
        let mut truncated = out.chars().take(MAX_DIFF_CHARS).collect::<String>();
        truncated.push_str(&format!(
            "\n\n… [diff tronqué : {} caractères affichés sur {} — passe en scope « dernier commit » ou limite le nombre de fichiers modifiés pour une revue complète]",
            MAX_DIFF_CHARS,
            out.chars().count()
        ));
        return Ok(truncated);
    }
    Ok(out)
}

/// Construit le prompt de revue cadré : consigne « second reviewer », le diff,
/// l'historique de revue (réinjecté) et la question de suivi éventuelle.
fn build_review_prompt(diff: &str, scope: &str, question: &str, history: &[ReviewTurn]) -> String {
    let scope_label = match scope {
        "last" => "le dernier commit (HEAD~1..HEAD)",
        _ => "les modifications non commitées (working tree vs HEAD)",
    };

    let mut s = String::new();
    s.push_str(
        "MODE REVUE DE CODE. Tu es un **second reviewer** expérimenté. Tu analyses le\n\
         DIFF Git fourni ci-dessous et tu produis une revue structurée. Tu N'utilises\n\
         AUCUN outil, ne lis ni ne modifie aucun fichier, n'exécutes aucune commande :\n\
         tout le contexte nécessaire est dans le diff. Réponds en français, en Markdown.\n\n",
    );
    s.push_str(&format!("Portée de la revue : {}.\n\n", scope_label));

    s.push_str("=== DIFF GIT ===\n");
    s.push_str("```diff\n");
    s.push_str(diff.trim());
    s.push_str("\n```\n=== FIN DIFF ===\n\n");

    s.push_str(
        "Structure ta revue ainsi (saute toute section sans remarque) :\n\
         - **🟢 Points positifs** : ce qui est bien fait (qualité, lisibilité, choix pertinents).\n\
         - **🔴 Bugs / erreurs** : bugs probables, erreurs de logique, cas limites oubliés.\n\
         - **⚠️ Sécurité** : failles potentielles (injections, fuites, auth, parsing non sûr).\n\
         - **⚡ Performance** : complexité inutile, allocations, I/O, requêtes en boucle.\n\
         - **🎨 Style / cohérence** : nommage, conventions du projet, duplication, lisibilité.\n\
         - **📐 Cohérence specs** : écart avec les specs/conventions du projet (si déductible).\n\
         - **💡 Suggestions** : améliorations concrètes (court, actionnable). Cite des lignes.\n\n\
         Sois concis et précis. Cite des noms de fichiers / morceaux de code. Ne reformule\n\
         pas le diff : analyse-le. Si le diff est trivial, dis-le franchement.\n\n",
    );

    // Historique de revue (réinjecté car le process pi est sans mémoire).
    let non_empty: Vec<&ReviewTurn> = history
        .iter()
        .filter(|t| !t.content.trim().is_empty())
        .collect();
    if !non_empty.is_empty() {
        s.push_str("[Historique de la conversation de revue]\n");
        for turn in non_empty {
            let label = match turn.role.as_str() {
                "assistant" => "Reviewer",
                _ => "Utilisateur",
            };
            s.push_str(&format!("{} : {}\n", label, turn.content.trim()));
        }
        s.push('\n');
    }

    let q = question.trim();
    if q.is_empty() {
        s.push_str("Lance la revue initiale selon la structure ci-dessus.\n");
    } else {
        s.push_str(&format!("Question / suivi : {}\n", q));
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_review_prompt_contains_diff_and_consign() {
        let prompt = build_review_prompt("@@ a\n-old\n+new", "working", "", &[]);
        assert!(prompt.contains("MODE REVUE DE CODE"));
        assert!(prompt.contains("=== DIFF GIT ==="));
        assert!(prompt.contains("+new"));
        assert!(prompt.contains("Lance la revue initiale"));
    }

    #[test]
    fn build_review_prompt_appends_followup_question() {
        let prompt = build_review_prompt("@@ \n+x", "last", "Approfondis la sécurité", &[]);
        assert!(prompt.contains("Approfondis la sécurité"));
        assert!(prompt.contains("dernier commit (HEAD~1..HEAD)"));
        assert!(!prompt.contains("Lance la revue initiale"));
    }
}