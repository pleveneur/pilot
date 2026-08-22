// super_agent.rs — Super-agent (spec_super_agent.md)
//
// Assistant de suivi multi-projets, lecture seule. Session RPC dédiée (canal
// `rpc-event-superagent`), base SQLite locale `~/.pilot/super-agent.db`
// (clients, projets, tâches, décisions, résumés de sessions), config (nom,
// clients, association projet → client) persistée dans AppConfig.

use rusqlite::Connection;
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

use crate::agent_service::SUPERAGENT_ID;
use crate::AppState;

// ── Base SQLite ──

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Erreur chemin données: {}", e))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Erreur création dossier: {}", e))?;
    Ok(dir.join("super-agent.db"))
}

pub(crate) fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let path = db_path(app)?;
    let conn = Connection::open(&path).map_err(|e| format!("Erreur ouverture base: {}", e))?;
    init_db(&conn)?;
    Ok(conn)
}

fn init_db(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS clients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            notes TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL UNIQUE,
            name TEXT DEFAULT '',
            client_id INTEGER,
            status TEXT DEFAULT 'suivi',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY(client_id) REFERENCES clients(id)
        );
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            description TEXT DEFAULT '',
            status TEXT DEFAULT 'demande',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY(project_id) REFERENCES projects(id)
        );
        CREATE TABLE IF NOT EXISTS decisions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            task_id INTEGER,
            summary TEXT NOT NULL,
            source_session TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY(project_id) REFERENCES projects(id),
            FOREIGN KEY(task_id) REFERENCES tasks(id)
        );
        CREATE TABLE IF NOT EXISTS session_summaries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            session_id TEXT DEFAULT '',
            summary TEXT NOT NULL,
            delivered INTEGER NOT NULL DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY(project_id) REFERENCES projects(id)
        );
        -- Perte silencieuse des comptes-rendus injectés à l'assistant :
        -- `delivered` marque si le résumé a été réellement délivré au
        -- super-agent. Un résumé persisté mais jamais livré (session fermée ou
        -- occupée) est rejoué à la prochaine opportunité (rejeu T2/T4/T5).
        CREATE TABLE IF NOT EXISTS injection_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            status TEXT DEFAULT '',
            ok INTEGER NOT NULL DEFAULT 0,
            detail TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY(project_id) REFERENCES projects(id)
        );
        -- Chantier #13 : planification d'actions récurrentes de l'assistant.
        -- `every` = intervalle en secondes (>= 60). `last_run_at` = dernière
        -- exécution (formule datetime('now') UTC), NULL si jamais exécuté.
        CREATE TABLE IF NOT EXISTS assistant_schedules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            prompt TEXT NOT NULL,
            every INTEGER NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            last_run_at TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );
        -- A7 : suivi temporel (jalons). Un jalon marque une étape du projet
        -- (release, milestone, objectif de date). `due_date` au format ISO.
        -- `status` : 'planifie' | 'atteint' | 'annule'.
        CREATE TABLE IF NOT EXISTS milestones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            due_date TEXT,
            status TEXT DEFAULT 'planifie',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY(project_id) REFERENCES projects(id)
        );
        "
    )
    .map_err(|e| format!("Erreur init base: {}", e))?;
    // Migrations : colonnes ajoutées après le schéma initial. SQLite n'a pas
    // `ADD COLUMN IF NOT EXISTS` avant 3.35, on vérifie via PRAGMA table_info.
    ensure_column(conn, "tasks", "deadline", "TEXT")?;
    ensure_column(conn, "tasks", "blocker_reason", "TEXT")?;
    ensure_column(conn, "tasks", "source_task_id", "INTEGER")?;
    // T1 : migration idempotente de la colonne `delivered` (résumés déjà en
    // base sur les anciennes bases). Les anciens résumés non livrés restent
    // `delivered=0` et seront rejoués à la prochaine opportunité.
    ensure_column(conn, "session_summaries", "delivered", "INTEGER NOT NULL DEFAULT 0")?;
    Ok(())
}

/// Ajoute une colonne à une table si elle n'existe pas déjà (migration
/// idempotente). SQLite ne supporte pas `ADD COLUMN IF NOT EXISTS` avant 3.35,
/// on inspecte donc `PRAGMA table_info` avant d'altérer.
fn ensure_column(conn: &Connection, table: &str, column: &str, decl: &str) -> Result<(), String> {
    let mut present = false;
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({})", table))
        .map_err(|e| format!("Erreur PRAGMA: {}", e))?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(1))
        .map_err(|e| format!("Erreur PRAGMA: {}", e))?;
    for row in rows {
        if row.map(|name| name == column).unwrap_or(false) {
            present = true;
            break;
        }
    }
    drop(stmt);
    if !present {
        conn.execute(
            &format!("ALTER TABLE {} ADD COLUMN {} {}", table, column, decl),
            [],
        )
        .map_err(|e| format!("Erreur ALTER TABLE {}.{}: {}", table, column, e))?;
    }
    Ok(())
}

// ── Session RPC dédiée ──

/// Démarre (lazy) la session super-agent. La session vit désormais dans le
/// registre unique de l'AgentService (id `superagent`, canal `rpc-event-superagent`
/// isolé). Lecture seule stricte sur les
/// projets : l'extension `pilot-assistant-files` bloque techniquement toute
/// écriture hors de `~/.pilot/assistant/` (espace d'écriture dédié de
/// l'assistant), et `pilot-choices` fournit les outils de question (ask_choice,
/// ask_input, ask_confirm, ask_multi_choice). Pas de skill. Canal dédié.
pub(crate) fn do_start_super_agent_session(state: &AppState, app: &AppHandle) -> Result<(), String> {
    let pi_path = state.config.lock().unwrap().rpc_pi_path.clone();
    let cwd = state
        .project_path
        .lock()
        .unwrap()
        .clone()
        .unwrap_or_default();
    let default_model = default_model_from_config(&pi_path);
    state
        .agent_service
        .start_superagent(app, &cwd, &pi_path, default_model)
}

/// Résout le modèle par défaut du backend actif depuis `model-switch.json`
/// (`~/.<stem>/agent/model-switch.json`, champ `defaultModel`). Retourne
/// `(provider, model_id)` si présent.
fn default_model_from_config(pi_path: &str) -> Option<(String, String)> {    let stem = if pi_path.is_empty() {
        "pi".to_string()
    } else {
        std::path::Path::new(pi_path)
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| "pi".to_string())
    };
    let path = crate::models_config::resolve_agent_home_by_stem(&stem)
        .ok()?
        .join("agent")
        .join("model-switch.json");
    if !path.exists() {
        return None;
    }
    let json_str = std::fs::read_to_string(&path).ok()?;
    let parsed: Value = serde_json::from_str(&json_str).ok()?;
    let def = parsed.get("defaultModel")?.as_str()?;
    let idx = def.find('/')?;
    Some((def[..idx].to_string(), def[idx + 1..].to_string()))
}

/// Liste concise des projets connus de la base (path + nom), pour que
/// l'assistant apprenne où se trouvent les projets au fil des discussions.
/// Retourne une chaîne vide si la base est vide ou inaccessible.
fn known_projects_context(app: &AppHandle) -> String {
    let conn = match open_db(app) {
        Ok(c) => c,
        Err(_) => return String::new(),
    };
    let mut stmt = match conn.prepare("SELECT path, name FROM projects ORDER BY updated_at DESC") {
        Ok(s) => s,
        Err(_) => return String::new(),
    };
    let rows = match stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))) {
        Ok(r) => r,
        Err(_) => return String::new(),
    };
    let mut items: Vec<String> = Vec::new();
    for row in rows.flatten() {
        let (path, name) = row;
        let label = if name.is_empty() || name == path {
            path
        } else {
            format!("{} ({})", name, path)
        };
        items.push(label);
    }
    if items.is_empty() {
        String::new()
    } else {
        format!("\n\nProjets que tu connais :\n- {}", items.join("\n- "))
    }
}

/// Liste les agents disponibles dans le registre global (base SQLite,
/// alimentée par `~/.pilot/agents.json`) et produit un résumé compact
/// (id, icône, description courte) injecté dans le prompt système de
/// l'assistant pour qu'il sache quels agents il peut piloter via `run_agents`.
/// Garde-fou : retourne une chaîne vide si le registre est vide ou illisible
/// (ne plante jamais).
fn available_agents_context(state: &AppState, app: &AppHandle) -> String {
    let agents = match state.agent_service.list_agents(app, None) {
        Ok(a) => a,
        Err(_) => return String::new(),
    };
    if agents.is_empty() {
        return String::new();
    }
    let items: Vec<String> = agents
        .iter()
        .map(|a| {
            let desc = a.description.trim();
            if desc.is_empty() {
                format!("- {} ({})", a.id, a.icon)
            } else {
                format!("- {} ({}) : {}", a.id, a.icon, desc)
            }
        })
        .collect();
    format!(
        "\n\nAgents disponibles dans le registre (utilisables via `run_agents`) :\n{}",
        items.join("\n")
    )
}

/// Bloc d'instructions injecté dans le prompt système de l'assistant : décrit
/// les outils d'agents (`run_agents`, `create_agent`, `delegate_to_coder`,
/// `ask_multi_choice`, `ask_confirm`, `ask_input`) et le flux « plan-maker »
/// pour les demandes de code importantes (plan → validation → délégation).
const SUPER_AGENT_TOOLS_PROMPT: &str = "\n\n## Outils d'agents\nTu disposes des outils suivants :\n- `run_agents(agent_ids, task)` : lance une tâche sur un ou plusieurs agents du registre (en parallèle si plusieurs). La run est lancée EN ARRIÈRE-PLAN : tu reçois immédiatement un accusé de lancement, puis le résultat agrégé t'est injecté à la fin de la run (tu en fais alors le compte-rendu à l'utilisateur). MÉTHODE PAR DÉFAUT pour exécuter du travail sur les projets.\n- `create_agent(...)` : crée un agent sur mesure si aucun agent existant ne convient.\n- `delegate_to_coder(request, project?)` : délègue une demande à l'agent standard d'un projet. EXCEPTION uniquement (voir plus bas).\n- `ask_multi_choice(title, options)` : demande à l'utilisateur de cocher une ou plusieurs options.\n- `ask_confirm(title, message)` : demande une validation Oui/Non.\n- `ask_input(title)` : demande une saisie libre.\n\n## Exclusivité des spécialités par projet\nUn seul agent de chaque spécialité (agent_id) peut tourner à la fois sur un même projet. Si tu demandes via `run_agents` un agent déjà actif sur le projet cible, la demande n'est PAS perdue : elle est mise en file d'attente et se lance automatiquement à la fin de la tâche en cours. Tu es informé de cette mise en attente (et du démarrage effectif). Deux agents de spécialités DIFFÉRENTES sur le même projet peuvent tourner en parallèle. Ne relance pas une demande mise en attente : elle se lancera d'elle-même.\n\n## Méthode de travail par défaut : agents spécifiques\nTu exécutes le travail sur les projets via des AGENTS SPÉCIFIQUES (`run_agents` / `create_agent`), PAS via `delegate_to_coder`.\n\nAvant de lancer une délégation :\n1. Reformule et affine la demande utilisateur. Si la tâche est floue, imprécise ou manque de contexte, pose des questions à l'utilisateur (`ask_input` / `ask_multi_choice`) AVANT de déléguer.\n2. Construis une demande claire et structurée pour l'agent : contexte, objectif, contraintes, format de sortie attendu. L'agent doit avoir toutes les informations nécessaires sans deviner.\n3. Affiche à l'utilisateur la demande finale que tu vas envoyer à l'agent (résumé concis) avant de lancer.\n4. Lance via `run_agents` (agent existant) ou `create_agent` (agent sur mesure si rien ne convient).\n\n`delegate_to_coder` est une EXCEPTION : à n'utiliser que pour une tâche simple d'écriture directe sur le projet actif, quand aucun agent spécifique ne convient ET que la création d'un nouvel agent n'est pas justifiée. Dans ce cas, précise pourquoi tu dérives.\n\n## Flux « plan-maker » pour les demandes importantes\nPour une demande de code importante (plusieurs fichiers, plusieurs étapes), utilise le flux suivant :\n1. Appelle `run_agents([\"plan-maker\"], \"<la demande>\")` pour obtenir un plan structuré (JSON : tâches + fichiers + coût estimé + contraintes suggérées).\n2. Présente le plan à l'utilisateur : affiche les tâches, puis demande via `ask_multi_choice` quelles tâches lancer (cases à cocher), et via `ask_confirm` s'il valide.\n3. Si l'utilisateur ajoute des contraintes ou modifie le plan, en tiens compte.\n4. Délègue l'exécution via `run_agents` (ou `create_agent`) avec le plan approuvé (tâches sélectionnées + contraintes).\n5. Surveille le résultat et informe l'utilisateur.\n\nPour les demandes simples (1 fichier, < 50 lignes), tu peux déléguer directement via `run_agents` sans plan-maker.\n";

/// Bloc d'instructions injecté dans le prompt système de l'assistant : règle
/// de résilience / anti-blocage. L'assistant ne s'arrête pas au premier
/// obstacle : il relance au moins une fois en changeant d'approche avant de
/// solliciter l'utilisateur. Distinct de la détection de boucle technique
/// (issue #55) qui reste un filet de sécurité contre les répétitions exactes.
const SUPER_AGENT_RESILIENCE_PROMPT: &str = "\n\n## Règle de résilience — ne jamais s'arrêter au premier obstacle\nSi une tâche déléguée ou une action échoue, ne t'arrête pas immédiatement et ne demande pas tout de suite à l'utilisateur. Relance AU MOINS UNE FOIS par toi-même en changeant d'approche entre les tentatives : autre agent, autre formulation de la demande, autre méthode, autre découpage de la tâche.\n\nRègle :\n- 1er échec → relance en changeant d'approche (n'indique à l'utilisateur que tu reprends qu'en bref).\n- 2e échec consécutif sur la même tâche, même après changement d'approche → préviens l'utilisateur avec un point clair (ce qui a été tenté, pourquoi ça bloque, options proposées).\n\nImportant : relancer en changeant d'approche n'est PAS une répétition en boucle. La détection de boucle technique (répétitions exactes de mêmes outils/textes) reste un filet de sécurité distinct ; ton comportement de relance est volontaire et varié.\n";

/// Bloc d'instructions injecté dans le prompt système de l'assistant : règle
/// par défaut sur le fichier AGENTS.md des projets. Quand l'assistant travaille
/// sur un projet qui n'a pas de fichier AGENTS.md (ou dont le contenu est
/// incomplet pour guider un agent), il doit le signaler à l'utilisateur,
/// programmer un rappel (`schedule_create`) pour revenir dessus, et ne pas
/// laisser ce point tomber dans l'oubli jusqu'à ce que le AGENTS.md soit créé.
/// Une fois créé, il désactive le rappel (`schedule_set_enabled`).
const SUPER_AGENT_AGENTSMD_PROMPT: &str = "\n\n## Règle par défaut — fichier AGENTS.md des projets\nQuand tu travailles sur un projet qui n'a pas de fichier AGENTS.md (ou dont le contenu est incomplet pour guider un agent), signale-le à l'utilisateur et programme un rappel (`schedule_create`) pour revenir dessus. Ne laisse pas ce point tomber dans l'oubli tant que le AGENTS.md n'est pas créé : relance le rappel si nécessaire. Une fois le AGENTS.md créé (ou complété), désactive le rappel correspondant (`schedule_set_enabled`).\n";

/// Bloc d'instructions injecté dans le prompt système de l'assistant : règles
/// anti-boucle pour l'outil `run_agents`. L'assistant doit construire des
/// prompts STRUCTURÉS (comme le mode manuel : contexte, objectif, contraintes,
/// fichiers, vérifications, ce qu'il ne faut PAS faire) pour que l'agent
/// réussisse du premier coup, et ne JAMAIS relancer la même tâche à l'identique
/// (cause racine des boucles de `run_agents`). Distinct de la détection de
/// boucle technique (issue #55) qui reste un filet de sécurité.
const SUPER_AGENT_ANTILOOP_PROMPT: &str = "\n\n## Règle anti-boucle — `run_agents`\nQuand tu délègues via `run_agents`, construis une demande STRUCTURÉE et COMPLÈTE (contexte, objectif, contraintes, fichiers concernés, vérifications attendues, ce qu'il ne faut PAS faire) pour que l'agent réussisse du premier coup. Une délégation bien formulée vaut mieux que plusieurs tentatives répétées : prends le temps de bien formuler avant de lancer.\n\nL'enveloppe de brief structuré (sections « ## Contexte », « ## Objectif », « ## Consignes », « ## Ce qu'il ne faut PAS faire ») est appliquée MÉCANIQUEMENT côté Pilot (super-agent.js) à chaque délégation : n'insère PAS toi-même ces sections d'en-tête dans ta tâche (Pilot les ajoute et les dédoublonnerait). Rédige le CONTENU de la tâche (ce que l'agent doit faire, ses contraintes, les vérifications attendues).\n\nNe relance JAMAIS la même tâche à l'identique :\n- Si une run échoue ou renvoie un résultat inutile, ne ré-émets pas le même `run_agents` avec la même tâche.\n- Change d'approche (autre agent, autre formulation, autre découpage) ou interroge l'utilisateur (`ask_input` / `ask_multi_choice`) pour clarifier.\n- Si tu as déjà lancé une tâche et reçu son résultat, passe à la suite : ne refais pas la même délégation.\n";

/// Bloc d'instructions injecté dans le prompt système de l'assistant : usage de
/// l'outil `list_agent_sessions` et de la dernière activité (`lastActivity` /
/// `lastActivityRelative` / `lastEvent`) pour juger si un agent progresse
/// réellement avant de décider de l'arrêter. Un agent avec une dernière activité
/// récente travaille encore, même sans sortie visible immédiate.
const SUPER_AGENT_SESSIONS_PROMPT: &str = "\n\n## Supervision des agents — juger la progression avant d'arrêter\nL'outil `list_agent_sessions` te donne la vue d'ensemble des sessions d'agents (projet, agent, mode, état, vivacité, visibilité, actif) et, quand une activité a été enregistrée, la dernière activité de chaque agent : `lastActivity` (timestamp ISO), `lastActivityRelative` (« il y a X min ») et `lastEvent` (type du dernier événement RPC).\n\nAvant de décider d'arrêter un agent, utilise `lastActivity` / `lastActivityRelative` pour juger s'il progresse réellement :\n- Un agent avec une dernière activité RÉCENTE travaille encore, même s'il n'a pas streamé de sortie visible depuis un moment. Ne l'arrête pas sur la seule absence de progression visible.\n- Ne considère l'arrêt que pour un agent réellement inactif (dernière activité ancienne, `lastActivityRelative` indiquant un long silence).\n- `lastEvent` t'indique le type de la dernière action (ex: `tool_execution_end`) pour comprendre ce que l'agent faisait.\n";

#[tauri::command]
pub async fn start_super_agent_session(state: State<'_, AppState>, app: AppHandle) -> Result<(), String> {
    // Async : le démarrage de la session (spawn du processus pi + handshake RPC
    // `new_session`/`set_model`) est bloquant et peut prendre plusieurs secondes
    // (démarrage Node.js + chargement des extensions). En commande synchrone, il
    // gelait le thread principal → tout le démarrage de Pilot attendait. En async,
    // il s'exécute sur le runtime async, l'UI reste réactive.
    do_start_super_agent_session(state.inner(), &app)
}

#[tauri::command]
pub fn stop_super_agent_session(state: State<AppState>) -> Result<(), String> {
    state.agent_service.stop_superagent()
}

/// Construit la consigne « réponses courtes » à injecter dans le prompt système
/// du super-agent (évolution 3). Retourne une chaîne vide si le mode est désactivé.
fn concise_guideline(enabled: bool) -> String {
    if !enabled {
        return String::new();
    }
    "\n\nRègle de style : réponds de façon concise. Informe l'utilisateur et prends des décisions, mais ne détaille pas tout ce qui se fait, sauf si l'utilisateur le demande explicitement. Utilise des phrases courtes.".to_string()
}

/// Construit la consigne « mode user-friendly » (issue #16) à injecter dans le
/// prompt système du super-agent. Quand activé, l'assistant répond en langage
/// simple, non technique, sauf si l'utilisateur demande explicitement du
/// technique. Retourne une chaîne vide si le mode est désactivé.
fn user_friendly_guideline(enabled: bool) -> String {
    if !enabled {
        return String::new();
    }
    "\n\nRègle de style : réponds en langage simple et non technique, sauf si l'utilisateur demande explicitement du technique. Évite le jargon, explique les concepts de façon accessible et privilégie des explications claires pour un non-spécialiste.".to_string()
}

/// Construit la consigne « voix » de l'assistant (style de réponse de
/// référence, validé par l'utilisateur). Toujours active : elle ne dépend
/// d'aucun toggle (ni « réponses courtes », ni « user-friendly » issue #16),
/// pour que le style soit permanent dans le noyau plutôt que dans la mémoire
/// d'un agent.
fn voice_guideline() -> String {
    "\n\nVoix de l'assistant (style de réponse permanent) :\n1. Phrases courtes et claires, NON techniques : un non-spécialiste doit tout comprendre sans effort.\n2. Structure en points : un point clé en tête, puis de courtes lignes qui avancent (pas de blabla).\n3. Orienté décision : proposer, trancher, lancer — ne pas rester dans le flou.\n4. Reformuler les retours techniques des agents en langage simple, orienté résultat, sans code ni noms de fichiers ou de fonctions.\n5. Quand un plan est montré : le présenter en étapes claires puis demander la validation par un geste simple (choix/confirmation).\n6. Concision : informer et décider, sans tout détailler, sauf demande explicite.\n7. Ton confiant et posé, conversation naturelle.".to_string()
}

/// Construit la consigne « personnalité adaptée à l'utilisateur » (A18) à
/// injecter dans le prompt système du super-agent. S'appuie sur la personnalité
/// déduite en arrière-plan de la conversation (persistée dans la config).
/// Retourne une chaîne vide si le mode est désactivé ou si aucune personnalité
/// n'a encore été déduite.
fn personality_guideline(enabled: bool, personality: &str) -> String {
    if !enabled || personality.trim().is_empty() {
        return String::new();
    }
    format!(
        "\n\nPersonnalité adaptée à l'utilisateur (déduite de la conversation) :\n{}",
        personality.trim()
    )
}

/// Construit le contexte projet injecté dans le prompt système du super-agent.
/// Le projet ACTIF est toujours la cible par défaut de la conversation ; l'ancien
/// projet de travail n'est rappelé qu'en second plan pour éviter que l'assistant
/// se focalise sur le mauvais projet (issue #40).
/// Retourne une chaîne vide si aucun projet actif ni de travail.
fn build_project_context(active: Option<&str>, working: Option<&str>) -> String {
    let mut ctx = String::new();
    if let Some(ap) = active {
        ctx.push_str(&format!(
            "\n\nProjet actuellement actif dans Pilot : « {} ». C'est le projet courant de la conversation.",
            ap
        ));
        if let Some(wp) = working {
            if Some(ap) != working {
                ctx.push_str(&format!(
                    "\nAncien projet de travail (ne le considère PLUS comme actif) : « {} ».",
                    wp
                ));
            }
        }
    } else if let Some(wp) = working {
        ctx.push_str(&format!(
            "\n\nProjet sur lequel tu travaillais : « {} ».",
            wp
        ));
    }
    if !ctx.is_empty() {
        ctx.push_str(
            "\nRègle : quand l'utilisateur parle d'un projet, considère TOUJOURS le projet actif comme le projet par défaut. N'utilise un ancien projet de travail que si l'utilisateur le nomme ou le mentionne explicitement. Si tu n'es pas sûr, demande-lui de préciser.",
        );
    }
    ctx
}

/// Envoie un prompt au super-agent (session RPC dédiée). Helper réutilisable par
/// la commande Tauri desktop et par le web remote (évolution 2). Démarre
/// paresseusement la session si nécessaire.
pub(crate) fn do_send_super_agent_prompt(
    state: &AppState,
    app: &AppHandle,
    message: String,
) -> Result<(), String> {
    // Démarrage paresseux : garantit qu'une session existe avant d'envoyer.
    do_start_super_agent_session(state, app)?;
    // T4 : au début d'un envoi réel, rejouer les résumés en attente (couvre le
    // web remote et le premier envoi). Fire-and-forget : un échec de rejeu ne
    // bloque pas le message utilisateur.
    let _ = replay_pending_superagent_summaries(state, app);
    // Prompt système : nom de l'assistant + rôle de suivi multi-projets + prompt
    // personnalisé (configurable). Le nom est toujours injecté pour que
    // l'assistant sache qui il est, même si l'utilisateur n'a pas renseigné de
    // prompt personnalisé.
    let (name, system_prompt, concise, user_memory, adaptive_personality, personality, user_friendly) = {
        let cfg = state.config.lock().unwrap();
        (cfg.super_agent_name.clone(), cfg.super_agent_prompt.clone(), cfg.super_agent_concise, cfg.super_agent_user_memory.clone(), cfg.super_agent_adaptive_personality, cfg.super_agent_personality.clone(), cfg.super_agent_user_friendly)
    };
    let name = if name.trim().is_empty() { "Assistant".to_string() } else { name.trim().to_string() };
    let mut full_system = format!(
        "Tu es « {} », l'assistant de suivi multi-projets de Pilot. Tu suis plusieurs projets (organisés par client) de la demande à la livraison, tu apprends des sessions d'agents et tu réponds aux questions. Tu es strictement en lecture seule : tu ne modifies jamais les fichiers des projets.",
        name
    );
    // Contexte projet : le projet actuellement actif dans Pilot + le projet sur
    // lequel l'assistant travaillait (dernier projet ouvert via `open_project`).
    // Le projet ACTIF est TOUJOURS la cible par défaut (issue #40).
    let active_project = state.active_project.lock().unwrap().clone();
    let working_project = state.working_project.lock().unwrap().clone();
    full_system.push_str(&build_project_context(active_project.as_deref(), working_project.as_deref()));
    // Apprendre où se trouvent les projets : injecter la liste des projets
    // connus de la base (s'enrichit au fil des discussions / sessions).
    full_system.push_str(&known_projects_context(app));
    // Agents du registre + outils d'agents + flux « plan-maker » : l'assistant
    // doit connaître les agents disponibles et la procédure de planification
    // avant délégation au codeur.
    full_system.push_str(&available_agents_context(state, app));
    full_system.push_str(SUPER_AGENT_TOOLS_PROMPT);
    // Règle de résilience / anti-blocage (évolution 1) : l'assistant relance au
    // moins une fois en changeant d'approche avant de solliciter l'utilisateur.
    // Distinct de la détection de boucle technique (issue #55).
    full_system.push_str(SUPER_AGENT_RESILIENCE_PROMPT);
    // Règle par défaut sur le fichier AGENTS.md des projets : signaler à
    // l'utilisateur + programmer un rappel tant que le AGENTS.md n'est pas créé.
    full_system.push_str(SUPER_AGENT_AGENTSMD_PROMPT);
    // Règle anti-boucle `run_agents` : prompts structurés + ne jamais relancer
    // la même tâche à l'identique (cause racine des boucles de run_agents).
    full_system.push_str(SUPER_AGENT_ANTILOOP_PROMPT);
    // Supervision des agents : juger la progression via la dernière activité
    // (lastActivity) avant de décider d'arrêter un agent.
    full_system.push_str(SUPER_AGENT_SESSIONS_PROMPT);
    if !system_prompt.trim().is_empty() {
        full_system.push_str("\n\n");
        full_system.push_str(system_prompt.trim());
    }
    // A17 : mémoire utilisateur persistée (profil/notes sur l'utilisateur ou
    // développeur de Pilot). Injectée comme le prompt personnalisé pour que
    // l'assistant prenne en compte durablement les préférences et le contexte.
    if !user_memory.trim().is_empty() {
        full_system.push_str("\n\nMémoire sur l'utilisateur (profil/notes appris au fil des discussions) :\n");
        full_system.push_str(user_memory.trim());
    }
    // A18 : personnalité adaptée à l'utilisateur (déduite en arrière-plan de la
    // conversation). Injectée comme la mémoire utilisateur A17.
    full_system.push_str(&personality_guideline(adaptive_personality, &personality));
    // Chantier #13 : documenter l'outil schedule (relances différées/périodiques).
    full_system.push_str(
        "\n\nTu disposes d'un outil `schedule_create` pour programmer une relance différée (afterSeconds) ou périodique (everySeconds >= 60) qui reviendra dans ta conversation à l'échéance. Utile pour surveiller un codeur en cours, ou repointer un chantier plus tard. Utilise `schedule_list` / `schedule_delete` pour gérer tes rappels. Max 20 rappels actifs. Désactive automatiquement un rappel devenu inutile (ne détecte plus rien, chantier terminé, condition remplie) via `schedule_set_enabled` au lieu de le supprimer, et réactive-le si le besoin revient.",
    );
    // Évolution 3 : mode « réponses courtes » (désactivé par défaut).
    full_system.push_str(&concise_guideline(concise));
    // Issue #16 : mode « user-friendly » (désactivé par défaut).
    full_system.push_str(&user_friendly_guideline(user_friendly));
    // Voix de l'assistant : style de réponse permanent, TOUJOURS actif
    // (indépendant des toggles concise / user-friendly).
    full_system.push_str(&voice_guideline());
    let full_message = format!("{}\n\n{}", full_system, message);
    let cmd = serde_json::json!({"type": "prompt", "message": full_message});
    state.agent_service.send_superagent(cmd)
}

#[tauri::command]
pub async fn send_super_agent_prompt(state: State<'_, AppState>, app: AppHandle, message: String) -> Result<(), String> {
    do_send_super_agent_prompt(state.inner(), &app, message)
}

/// Un tour de la conversation du super-agent (côté frontend).
#[derive(serde::Deserialize, Clone)]
pub struct SuperAgentTurn {
    pub role: String, // "user" | "assistant"
    pub content: String,
}

/// Appel bloquant du super-agent : lance un process pi **frais** `--no-session`
/// (pattern `ask_pi_caged`, éprouvé par l'aide et le reviewer), envoie
/// new_session → set_model → prompt, collecte le stream et retourne la réponse
/// complète. L'historique est réinjecté dans le prompt (le process est sans
/// mémoire). Garantit une réponse fiable, contrairement à la session persistante
/// `--no-session` qui ne streame pas de sortie.
///
/// Commande **async** : le travail bloquant (spawn du process pi + collecte du
/// stream) est exécuté dans `spawn_blocking` avec un timeout global, pour ne
/// jamais bloquer l'UI pendant la génération.
#[tauri::command]
pub async fn ask_super_agent(
    state: State<'_, AppState>,
    message: String,
    history: Vec<SuperAgentTurn>,
) -> Result<String, String> {
    let (pi_path, mut model, system_prompt, concise, user_memory, adaptive_personality, personality, user_friendly) = {
        let cfg = state.config.lock().unwrap();
        (
            cfg.rpc_pi_path.clone(),
            cfg.super_agent_model.clone(),
            cfg.super_agent_prompt.clone(),
            cfg.super_agent_concise,
            cfg.super_agent_user_memory.clone(),
            cfg.super_agent_adaptive_personality,
            cfg.super_agent_personality.clone(),
            cfg.super_agent_user_friendly,
        )
    };

    // Si aucun modèle n'a été choisi, retomber sur le modèle par défaut du
    // backend (pi --no-session n'a pas de modèle par défaut).
    if model.trim().is_empty() {
        if let Some((p, id)) = default_model_from_config(&pi_path) {
            model = format!("{}/{}", p, id);
        }
    }

    let cwd = state
        .project_path
        .lock()
        .unwrap()
        .clone()
        .unwrap_or_default();

    // Construire le prompt : prompt système (configurable) + historique + message
    // courant. Le prompt système cadre le comportement de l'assistant à chaque
    // tour (le process pi frais est sans mémoire).
    let mut prompt = String::new();
    if !system_prompt.trim().is_empty() {
        prompt.push_str(&format!("{}\n\n", system_prompt.trim()));
    }
    // A17 : mémoire utilisateur persistée (profil/notes sur l'utilisateur).
    if !user_memory.trim().is_empty() {
        prompt.push_str(&format!(
            "Mémoire sur l'utilisateur (profil/notes appris au fil des discussions) :\n{}\n\n",
            user_memory.trim()
        ));
    }
    // A18 : personnalité adaptée à l'utilisateur (déduite en arrière-plan).
    prompt.push_str(&personality_guideline(adaptive_personality, &personality));
    // Évolution 3 : mode « réponses courtes » (désactivé par défaut).
    prompt.push_str(&concise_guideline(concise));
    // Issue #16 : mode « user-friendly » (désactivé par défaut).
    prompt.push_str(&user_friendly_guideline(user_friendly));
    // « Voix » de l'assistant : style de réponse permanent, TOUJOURS actif
    // (indépendant des toggles concise / user-friendly).
    prompt.push_str(&voice_guideline());
    for turn in &history {
        let role = if turn.role == "user" { "Utilisateur" } else { "Assistant" };
        prompt.push_str(&format!("{} : {}\n\n", role, turn.content));
    }
    prompt.push_str(&format!("Utilisateur : {}", message));

    let pi_path_owned = pi_path;
    let cwd_owned = cwd;
    let prompt_owned = prompt;
    let model_owned = model;

    // Exécution bloquante dans spawn_blocking + timeout global (120 s).
    let result: Result<String, String> = tokio::time::timeout(
        std::time::Duration::from_secs(120),
        tokio::task::spawn_blocking(move || {
            let model_opt = if model_owned.trim().is_empty() {
                None
            } else {
                Some(model_owned.as_str())
            };
            crate::help::ask_pi_caged_timed(
                &cwd_owned,
                &pi_path_owned,
                &prompt_owned,
                model_opt,
                std::time::Duration::from_secs(110),
            )
        }),
    )
    .await
    .map_err(|_| {
        "Le super-agent a mis trop de temps à répondre (120 s). Réessayez ou changez de modèle.".to_string()
    })?
    .map_err(|e| format!("Erreur interne: {}", e))?;

    result
}

/// Enregistre le projet sur lequel l'assistant travaille (dernier projet ouvert
/// via l'action `open_project`). Distinct du projet actif : quand l'utilisateur
/// change de projet, le projet de travail reste celui de la discussion en cours.
#[tauri::command]
pub fn set_super_agent_working_project(state: State<AppState>, path: String) -> Result<(), String> {
    *state.working_project.lock().unwrap() = Some(path);
    Ok(())
}

// ── Accès à la base de suivi par l'assistant (outils db_query / db_execute) ──
//
// L'assistant est responsable de son suivi : il construit et met à jour ses
// propres structures dans sa base SQLite (~/.pilot/super-agent.db). Ces commandes
// lui donnent un accès contrôlé (lecture SELECT / écriture CREATE/INSERT/UPDATE/
// DELETE/ALTER/DROP) sur SA base uniquement — jamais sur les fichiers des projets.
// Le frontend intercepte les outils d'extension (sentinel) et appelle ces
// commandes ; le résultat est renvoyé au LLM.

fn sqlite_value_to_json(v: rusqlite::types::Value) -> Value {
    match v {
        rusqlite::types::Value::Null => Value::Null,
        rusqlite::types::Value::Integer(i) => Value::Number(i.into()),
        rusqlite::types::Value::Real(f) => serde_json::Number::from_f64(f)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        rusqlite::types::Value::Text(s) => Value::String(s),
        rusqlite::types::Value::Blob(b) => Value::String(format!("<blob {} octets>", b.len())),
    }
}

/// Exécute une requête SELECT en lecture seule sur la base de suivi de
/// l'assistant. Retourne `{ rows: [...], count: n }`.
#[tauri::command]
pub fn super_agent_db_query(app: AppHandle, sql: String) -> Result<Value, String> {
    let trimmed = sql.trim_start();
    if !trimmed.to_uppercase().starts_with("SELECT") {
        return Err("super_agent_db_query : seules les requêtes SELECT sont autorisées".to_string());
    }
    let conn = open_db(&app)?;
    let mut stmt = conn.prepare(&sql).map_err(|e| format!("Erreur SQL : {}", e))?;
    let col_count = stmt.column_count();
    let col_names: Vec<String> = (0..col_count)
        .map(|i| stmt.column_name(i).unwrap_or("").to_string())
        .collect();
    let rows = stmt
        .query_map([], |r| {
            let mut obj = serde_json::Map::new();
            for (i, name) in col_names.iter().enumerate() {
                let val = r
                    .get::<_, rusqlite::types::Value>(i)
                    .unwrap_or(rusqlite::types::Value::Null);
                obj.insert(name.clone(), sqlite_value_to_json(val));
            }
            Ok(serde_json::Value::Object(obj))
        })
        .map_err(|e| format!("Erreur SQL : {}", e))?;
    let mut result: Vec<Value> = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| format!("Erreur SQL : {}", e))?);
    }
    Ok(serde_json::json!({ "rows": result, "count": result.len() }))
}

/// Exécute une requête d'écriture (CREATE TABLE, INSERT, UPDATE, DELETE, ALTER,
/// DROP, PRAGMA) sur la base de suivi de l'assistant. Retourne `{ ok: true }`.
#[tauri::command]
pub fn super_agent_db_execute(app: AppHandle, sql: String) -> Result<Value, String> {
    let trimmed = sql.trim_start();
    let upper = trimmed.to_uppercase();
    if upper.starts_with("SELECT") {
        return Err("super_agent_db_execute : utilisez super_agent_db_query pour les SELECT".to_string());
    }
    let conn = open_db(&app)?;
    conn.execute_batch(&sql).map_err(|e| format!("Erreur SQL : {}", e))?;
    Ok(serde_json::json!({ "ok": true }))
}

// ── Planification d'actions récurrentes de l'assistant (chantier #13) ──
//
// L'assistant (onglet 🧭) peut créer des `assistant_schedules` : des actions
// récurrentes (prompt) déclenchées périodiquement (intervalle `every` >= 60s)
// par le ticker du frontend (super-agent.js, toutes les 10 s). Garde-fous :
//   - `every` >= 60 s (borne minimale, évite le spam),
//   - max 20 planifications en parallèle,
//   - 1 exécution max par planification et par tick (last_run_at marqué
//     atomiquement lors de l'émission),
//   - session super-agent morte = pas de tick (super_agent_schedule_tick).

pub(crate) const SCHEDULE_MIN_EVERY_SECS: i64 = 60;
pub(crate) const SCHEDULE_MAX: i64 = 20;

/// Planification telle que renvoyée au frontend / à l'assistant.
pub(crate) struct DueSchedule {
    id: i64,
    name: String,
    prompt: String,
    every: i64,
}

impl DueSchedule {
    fn to_json(&self) -> Value {
        serde_json::json!({ "id": self.id, "name": self.name, "prompt": self.prompt, "every": self.every })
    }
}

/// Insère une planification. Valide les garde-fous (every >= 60s, nom/prompt
/// non vides, max 20). Retourne l'id créé. Fonction pure sur `Connection` pour
/// être testable (in-memory en test, open_db en production).
pub(crate) fn schedule_insert(
    conn: &Connection,
    name: &str,
    prompt: &str,
    every: i64,
) -> Result<i64, String> {
    let name = name.trim();
    let prompt = prompt.trim();
    if name.is_empty() {
        return Err("schedule : un nom est requis".to_string());
    }
    if prompt.is_empty() {
        return Err("schedule : un prompt est requis".to_string());
    }
    if every < SCHEDULE_MIN_EVERY_SECS {
        return Err(format!(
            "schedule : l'intervalle doit être >= {} s (reçu {} s)",
            SCHEDULE_MIN_EVERY_SECS, every
        ));
    }
    // Seuls les rappels ACTIFS (enabled = 1) comptent dans la limite : un rappel
    // désactivé libère sa place et peut être réactivé plus tard sans bloquer la
    // création de nouveaux rappels.
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM assistant_schedules WHERE enabled = 1", [], |r| r.get(0))
        .map_err(|e| format!("Erreur SQL : {}", e))?;
    if count >= SCHEDULE_MAX {
        return Err(format!(
            "schedule : maximum {} planifications atteint",
            SCHEDULE_MAX
        ));
    }
    conn.execute(
        "INSERT INTO assistant_schedules (name, prompt, every) VALUES (?1, ?2, ?3)",
        rusqlite::params![name, prompt, every],
    )
    .map_err(|e| {
        if e.to_string().contains("UNIQUE") {
            "schedule : ce nom existe déjà".to_string()
        } else {
            format!("Erreur SQL : {}", e)
        }
    })?;
    Ok(conn.last_insert_rowid())
}

/// Supprime une planification par id.
pub(crate) fn schedule_delete(conn: &Connection, id: i64) -> Result<bool, String> {
    let n = conn
        .execute("DELETE FROM assistant_schedules WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| format!("Erreur SQL : {}", e))?;
    Ok(n > 0)
}

/// Active/désactive une planification par id (sans la supprimer, pour pouvoir
/// la réactiver plus tard). Retourne false si l'id n'existe pas. Fonction pure
/// sur `Connection` pour être testable.
pub(crate) fn schedule_set_enabled(conn: &Connection, id: i64, enabled: bool) -> Result<bool, String> {
    let n = conn
        .execute(
            "UPDATE assistant_schedules SET enabled = ?1, updated_at = datetime('now') WHERE id = ?2",
            rusqlite::params![if enabled { 1 } else { 0 }, id],
        )
        .map_err(|e| format!("Erreur SQL : {}", e))?;
    Ok(n > 0)
}

/// Liste toutes les planifications.
pub(crate) fn schedule_list(conn: &Connection) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, prompt, every, enabled, last_run_at FROM assistant_schedules ORDER BY id",
        )
        .map_err(|e| format!("Erreur SQL : {}", e))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, i64>(0)?,
                "name": r.get::<_, String>(1)?,
                "prompt": r.get::<_, String>(2)?,
                "every": r.get::<_, i64>(3)?,
                "enabled": r.get::<_, i64>(4)? != 0,
                "last_run_at": r.get::<_, Option<String>>(5)?,
            }))
        })
        .map_err(|e| format!("Erreur SQL : {}", e))?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| format!("Erreur SQL : {}", e))?);
    }
    Ok(result)
}

/// Retourne les planifications dues à `now` (format datetime('now') UTC) et les
/// marque comme exécutées (last_run_at = now) : 1 exécution max par
/// planification et par tick — un second appel dans la même fenêtre ne renvoie
/// plus rien pour ces planifications.
pub(crate) fn schedule_due_and_mark(conn: &Connection, now: &str) -> Result<Vec<DueSchedule>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, prompt, every FROM assistant_schedules \
             WHERE enabled = 1 AND (last_run_at IS NULL \
               OR last_run_at <= datetime(?1, '-' || CAST(every AS TEXT) || ' seconds')) \
             ORDER BY id",
        )
        .map_err(|e| format!("Erreur SQL : {}", e))?;
    let rows = stmt
        .query_map([now], |r| {
            Ok(DueSchedule {
                id: r.get(0)?,
                name: r.get(1)?,
                prompt: r.get(2)?,
                every: r.get(3)?,
            })
        })
        .map_err(|e| format!("Erreur SQL : {}", e))?;
    let mut due = Vec::new();
    for row in rows {
        let d = row.map_err(|e| format!("Erreur SQL : {}", e))?;
        conn.execute(
            "UPDATE assistant_schedules SET last_run_at = ?1, updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, d.id],
        )
        .map_err(|e| format!("Erreur SQL : {}", e))?;
        due.push(d);
    }
    Ok(due)
}

// ── Commandes Tauri (appelées depuis super-agent.js / l'extension) ──

/// Crée une planification d'action récurrente pour l'assistant.
#[tauri::command]
pub fn super_agent_schedule_create(
    app: AppHandle,
    name: String,
    prompt: String,
    every: i64,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    let id = schedule_insert(&conn, &name, &prompt, every)?;
    Ok(serde_json::json!({ "ok": true, "id": id }))
}

/// Supprime une planification d'action récurrente.
#[tauri::command]
pub fn super_agent_schedule_delete(app: AppHandle, id: i64) -> Result<Value, String> {
    let conn = open_db(&app)?;
    let removed = schedule_delete(&conn, id)?;
    Ok(serde_json::json!({ "ok": removed, "id": id }))
}

/// Active/désactive une planification d'action récurrente (sans la supprimer).
#[tauri::command]
pub fn super_agent_schedule_set_enabled(app: AppHandle, id: i64, enabled: bool) -> Result<Value, String> {
    let conn = open_db(&app)?;
    let updated = schedule_set_enabled(&conn, id, enabled)?;
    Ok(serde_json::json!({ "ok": updated, "id": id, "enabled": enabled }))
}

/// Liste les planifications d'actions récurrentes.
#[tauri::command]
pub fn super_agent_schedule_list(app: AppHandle) -> Result<Value, String> {
    let conn = open_db(&app)?;
    let rows = schedule_list(&conn)?;
    Ok(serde_json::json!({ "schedules": rows, "count": rows.len() }))
}

/// Tick du ticker frontend (toutes les 10 s). Retourne les planifications dues
/// (au plus 1 par planification et par tick, marquées atomiquement) uniquement
/// si la session super-agent est vivante — session morte = pas de tick.
#[tauri::command]
pub async fn super_agent_schedule_tick(state: State<'_, AppState>, app: AppHandle) -> Result<Value, String> {
    if !state.agent_service.superagent_alive() {
        return Ok(serde_json::json!({ "alive": false, "due": [], "count": 0 }));
    }
    let conn = open_db(&app)?;
    let now: String = conn
        .query_row("SELECT datetime('now')", [], |r| r.get(0))
        .map_err(|e| format!("Erreur SQL : {}", e))?;
    let due = schedule_due_and_mark(&conn, &now)?;
    let due_json: Vec<Value> = due.iter().map(|d| d.to_json()).collect();
    Ok(serde_json::json!({ "alive": true, "due": due_json, "count": due_json.len() }))
}

#[tauri::command]
pub fn new_super_agent_session(state: State<AppState>, app: AppHandle) -> Result<(), String> {
    do_start_super_agent_session(state.inner(), &app)?;
    let cmd = serde_json::json!({"type": "new_session"});
    state.agent_service.send_superagent_sync(cmd).map(|_| ())
}

#[tauri::command]
pub fn set_super_agent_model(state: State<AppState>, app: AppHandle, provider: String, model_id: String) -> Result<(), String> {
    do_start_super_agent_session(state.inner(), &app)?;
    let cmd = serde_json::json!({"type": "set_model", "provider": provider, "modelId": model_id});
    let resp = state.agent_service.send_superagent_sync(cmd)?;
    // Vérifier le champ success : un set_model qui échoue (provider/modèle
    // introuvable) répond {success: false, error: "..."}.
    if let Some(false) = resp.get("success").and_then(|v| v.as_bool()) {
        let err = resp
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("set_model a échoué (réponse sans succès)")
            .to_string();
        return Err(format!(
            "pi a refusé set_model(provider='{}', modelId='{}') : {}",
            provider, model_id, err
        ));
    }
    // Persister le modèle actif pour l'appel bloquant `ask_super_agent`.
    let mut cfg = state.config.lock().unwrap();
    cfg.super_agent_model = format!("{}/{}", provider, model_id);
    crate::save_config_disk(&app, &cfg).ok();
    Ok(())
}

/// Envoie une commande arbitraire au processus pi du super-agent (ex:
/// `extension_ui_response` pour répondre aux boutons de question posés par
/// l'assistant via pilot-choices).
#[tauri::command]
pub async fn send_super_agent_command(state: State<'_, AppState>, app: AppHandle, command: Value) -> Result<(), String> {
    do_start_super_agent_session(state.inner(), &app)?;
    state.agent_service.send_superagent(command)
}

/// Arrête la génération en cours du super-agent.
///
/// ⚠️ Bug de démarrage (onglet Assistant) : ne doit JAMAIS redémarrer la
/// session. L'ancien code appelait `do_start_super_agent_session` avant d'envoyer
/// l'abort → sur un processus mort (crash en boucle), il le relançait au lieu de
/// l'arrêter (impossible d'arrêter un processus qui crashe en boucle). On n'envoie
/// l'abort QUE si la session est vivante ; si elle est morte, on renvoie une
/// erreur propre sans relancer le processus.
#[tauri::command]
pub async fn abort_super_agent(state: State<'_, AppState>, _app: AppHandle) -> Result<(), String> {
    if !state.agent_service.superagent_alive() {
        return Err("Le super-agent n'est pas actif (processus arrêté ou crashé). Rien à arrêter.".to_string());
    }
    let cmd = serde_json::json!({"type": "abort"});
    state.agent_service.send_superagent(cmd)
}

#[tauri::command]
pub fn get_super_agent_state(state: State<AppState>, app: AppHandle) -> Result<Value, String> {
    do_start_super_agent_session(state.inner(), &app)?;
    let cmd = serde_json::json!({"type": "get_state"});
    state.agent_service.send_superagent_sync_timeout(cmd, 8)
}

// ── Config (nom, clients, association projet → client) ──

#[tauri::command]
pub fn get_super_agent_config(state: State<AppState>) -> Result<Value, String> {
    let cfg = state.config.lock().unwrap();
    Ok(serde_json::json!({
        "name": cfg.super_agent_name,
        "clients": cfg.super_agent_clients,
        "project_client": cfg.super_agent_project_client,
        "prompt": cfg.super_agent_prompt,
        "show_thinking": cfg.super_agent_show_thinking,
        "show_tools": cfg.super_agent_show_tools,
        "super_agent_invisible_agent": cfg.super_agent_invisible_agent,
        "super_agent_quality_gate": cfg.super_agent_quality_gate,
        "super_agent_force_structured_brief": cfg.super_agent_force_structured_brief,
        "super_agent_inherit_context": cfg.super_agent_inherit_context,
        "super_agent_user_friendly": cfg.super_agent_user_friendly,
        "super_agent_auto_check_startup": cfg.super_agent_auto_check_startup,
        "adaptive_personality": cfg.super_agent_adaptive_personality,
        "personality": cfg.super_agent_personality,
    }))
}

#[tauri::command]
pub fn set_super_agent_config(
    state: State<AppState>,
    app: AppHandle,
    name: Option<String>,
    clients: Option<Vec<String>>,
    project_client: Option<HashMap<String, String>>,
    prompt: Option<String>,
    show_thinking: Option<bool>,
    show_tools: Option<bool>,
    adaptive_personality: Option<bool>,
    super_agent_quality_gate: Option<bool>,
    super_agent_force_structured_brief: Option<bool>,
    super_agent_inherit_context: Option<bool>,
    super_agent_user_friendly: Option<bool>,
    super_agent_auto_check_startup: Option<bool>,
) -> Result<(), String> {
    let mut cfg = state.config.lock().unwrap();
    if let Some(n) = name {
        cfg.super_agent_name = n;
    }
    if let Some(c) = clients {
        cfg.super_agent_clients = c;
    }
    if let Some(pc) = project_client {
        cfg.super_agent_project_client = pc;
    }
    if let Some(p) = prompt {
        cfg.super_agent_prompt = p;
    }
    if let Some(v) = show_thinking {
        cfg.super_agent_show_thinking = v;
    }
    if let Some(v) = show_tools {
        cfg.super_agent_show_tools = v;
    }
    if let Some(v) = adaptive_personality {
        cfg.super_agent_adaptive_personality = v;
    }
    if let Some(v) = super_agent_quality_gate {
        cfg.super_agent_quality_gate = v;
    }
    if let Some(v) = super_agent_force_structured_brief {
        cfg.super_agent_force_structured_brief = v;
    }
    if let Some(v) = super_agent_inherit_context {
        cfg.super_agent_inherit_context = v;
    }
    if let Some(v) = super_agent_user_friendly {
        cfg.super_agent_user_friendly = v;
    }
    if let Some(v) = super_agent_auto_check_startup {
        cfg.super_agent_auto_check_startup = v;
    }
    crate::save_config_disk(&app, &cfg)?;
    Ok(())
}

/// Permet à l'assistant de mettre à jour son propre prompt personnalisé au fil
/// des discussions (outil `update_my_prompt`). Le changement est persisté dans
/// la config (donc pris en compte dès le prochain message) et un historique des
/// versions est conservé pour traçabilité / réversibilité.
#[tauri::command]
pub fn set_super_agent_prompt(state: State<AppState>, app: AppHandle, prompt: String) -> Result<(), String> {
    let mut cfg = state.config.lock().unwrap();
    cfg.super_agent_prompt = prompt.clone();
    crate::save_config_disk(&app, &cfg)?;
    // Historique des versions du prompt (traçabilité / réversibilité).
    if let Ok(dir) = app.path().app_data_dir() {
        if std::fs::create_dir_all(&dir).is_ok() {
            let hist = dir.join("prompt-history.md");
            let ts = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();
            let entry = format!("\n--- {ts} ---\n{prompt}\n");
            let _ = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&hist)
                .and_then(|mut f| std::io::Write::write_all(&mut f, entry.as_bytes()));
        }
    }
    Ok(())
}

/// Permet à l'assistant de mettre à jour la mémoire persistée sur l'utilisateur
/// (A17, outil `update_user_memory`). Profil/notes sur l'utilisateur ou
/// développeur de Pilot (préférences, contexte, habitudes) appris au fil des
/// discussions. Le changement est persisté dans la config (donc injecté dès le
/// prochain message) et un historique des versions est conservé pour traçabilité
/// / réversibilité.
#[tauri::command]
pub fn set_super_agent_user_memory(state: State<AppState>, app: AppHandle, memory: String) -> Result<(), String> {
    let mut cfg = state.config.lock().unwrap();
    cfg.super_agent_user_memory = memory.clone();
    crate::save_config_disk(&app, &cfg)?;
    // Historique des versions de la mémoire (traçabilité / réversibilité).
    if let Ok(dir) = app.path().app_data_dir() {
        if std::fs::create_dir_all(&dir).is_ok() {
            let hist = dir.join("user-memory-history.md");
            let ts = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();
            let entry = format!("\n--- {ts} ---\n{memory}\n");
            let _ = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&hist)
                .and_then(|mut f| std::io::Write::write_all(&mut f, entry.as_bytes()));
        }
    }
    Ok(())
}

/// Persiste la personnalité adaptée à l'utilisateur (A18) déduite en
/// arrière-plan de la conversation. Le changement est persisté dans la config
/// (donc injecté dès le prochain message) et un historique des versions est
/// conservé pour traçabilité / réversibilité.
#[tauri::command]
pub fn set_super_agent_personality(state: State<AppState>, app: AppHandle, personality: String) -> Result<(), String> {
    let mut cfg = state.config.lock().unwrap();
    cfg.super_agent_personality = personality.clone();
    crate::save_config_disk(&app, &cfg)?;
    // Historique des versions de la personnalité (traçabilité / réversibilité).
    if let Ok(dir) = app.path().app_data_dir() {
        if std::fs::create_dir_all(&dir).is_ok() {
            let hist = dir.join("personality-history.md");
            let ts = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();
            let entry = format!("\n--- {ts} ---\n{personality}\n");
            let _ = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&hist)
                .and_then(|mut f| std::io::Write::write_all(&mut f, entry.as_bytes()));
        }
    }
    Ok(())
}

/// Analyse en arrière-plan la conversation en cours (A18) pour déduire le
/// style/ton/personnalité qui correspond le mieux à l'utilisateur. Lance un
/// process pi frais `--no-session` (pattern `ask_pi_caged`, éprouvé par l'aide
/// et le reviewer) sur l'historique fourni et retourne une description concise
/// de la personnalité. Commande **async** : le travail bloquant est exécuté dans
/// `spawn_blocking` avec un timeout global, pour ne jamais bloquer l'UI.
#[tauri::command]
pub async fn analyze_super_agent_personality(
    state: State<'_, AppState>,
    history: Vec<SuperAgentTurn>,
) -> Result<String, String> {
    let (pi_path, mut model) = {
        let cfg = state.config.lock().unwrap();
        (cfg.rpc_pi_path.clone(), cfg.super_agent_model.clone())
    };
    if model.trim().is_empty() {
        if let Some((p, id)) = default_model_from_config(&pi_path) {
            model = format!("{}/{}", p, id);
        }
    }
    let cwd = state
        .project_path
        .lock()
        .unwrap()
        .clone()
        .unwrap_or_default();

    // Construire le prompt d'analyse à partir de l'historique de la conversation.
    let mut prompt = String::from(
        "Analyse la conversation suivante entre un utilisateur et un assistant de suivi de projets. Déduis le style, le ton et la personnalité qui correspondent le mieux à l'UTILISATEUR (sa façon de s'exprimer, son niveau de détail, son humour, sa formalité, ses préférences de communication). Réponds UNIQUEMENT par une description concise (2 à 4 phrases) de la personnalité à adopter pour s'adapter à cet utilisateur, à la première personne du point de vue de l'assistant (ex: « Je m'adresse à toi de façon directe et concise, avec un ton léger… »). Ne répète pas la conversation.",
    );
    for turn in &history {
        let role = if turn.role == "user" { "Utilisateur" } else { "Assistant" };
        prompt.push_str(&format!("\n\n{} : {}", role, turn.content));
    }

    let pi_path_owned = pi_path;
    let cwd_owned = cwd;
    let prompt_owned = prompt;
    let model_owned = model;

    let result: String = tokio::time::timeout(
        std::time::Duration::from_secs(120),
        tokio::task::spawn_blocking(move || {
            let model_opt = if model_owned.trim().is_empty() {
                None
            } else {
                Some(model_owned.as_str())
            };
            crate::help::ask_pi_caged_timed(
                &cwd_owned,
                &pi_path_owned,
                &prompt_owned,
                model_opt,
                std::time::Duration::from_secs(110),
            )
        }),
    )
    .await
    .map_err(|_| "L'analyse de personnalité a mis trop de temps à répondre (120 s).".to_string())?
    .map_err(|e| format!("Erreur interne: {}", e))??;

    Ok(result.trim().to_string())
}

// L'onglet Super-agent est GLOBAL (multi-projets) : son état d'ouverture est
// persisté dans AppConfig (pas par projet) pour le rouvrir au démarrage.
#[tauri::command]
pub fn set_super_agent_open(state: State<AppState>, app: AppHandle, open: bool) -> Result<(), String> {
    let mut cfg = state.config.lock().unwrap();
    cfg.super_agent_open = open;
    crate::save_config_disk(&app, &cfg)?;
    Ok(())
}

// ── Clients ──

#[tauri::command]
pub fn list_clients(state: State<AppState>, _app: AppHandle) -> Result<Value, String> {
    let cfg = state.config.lock().unwrap();
    let clients: Vec<Value> = cfg
        .super_agent_clients
        .iter()
        .map(|c| serde_json::json!({"name": c}))
        .collect();
    Ok(serde_json::json!({"clients": clients}))
}

#[tauri::command]
pub fn add_client(state: State<AppState>, app: AppHandle, name: String) -> Result<(), String> {
    let mut cfg = state.config.lock().unwrap();
    if !cfg.super_agent_clients.contains(&name) {
        cfg.super_agent_clients.push(name);
        crate::save_config_disk(&app, &cfg)?;
    }
    Ok(())
}

#[tauri::command]
pub fn remove_client(state: State<AppState>, app: AppHandle, name: String) -> Result<(), String> {
    let mut cfg = state.config.lock().unwrap();
    cfg.super_agent_clients.retain(|c| c != &name);
    // Retirer l'association projet → client pour ce client.
    cfg.super_agent_project_client.retain(|_, v| v != &name);
    crate::save_config_disk(&app, &cfg)?;
    Ok(())
}

#[tauri::command]
pub fn rename_client(state: State<AppState>, app: AppHandle, old_name: String, new_name: String) -> Result<(), String> {
    let mut cfg = state.config.lock().unwrap();
    if let Some(idx) = cfg.super_agent_clients.iter().position(|c| c == &old_name) {
        cfg.super_agent_clients[idx] = new_name.clone();
    }
    for v in cfg.super_agent_project_client.values_mut() {
        if *v == old_name {
            *v = new_name.clone();
        }
    }
    crate::save_config_disk(&app, &cfg)?;
    Ok(())
}

#[tauri::command]
pub fn set_project_client(state: State<AppState>, app: AppHandle, project_path: String, client: Option<String>) -> Result<(), String> {
    let mut cfg = state.config.lock().unwrap();
    match client {
        Some(c) => { cfg.super_agent_project_client.insert(project_path, c); }
        None => { cfg.super_agent_project_client.remove(&project_path); }
    }
    crate::save_config_disk(&app, &cfg)?;
    Ok(())
}

/// Liste les projets connus de la base avec leur client associé (source de
/// vérité : la config `super_agent_project_client`, path → nom de client).
/// Retourne `{ projects: [{ path, name, client }] }`.
#[tauri::command]
pub fn list_super_agent_projects(state: State<AppState>, app: AppHandle) -> Result<Value, String> {
    let conn = open_db(&app)?;
    let mut stmt = conn
        .prepare("SELECT path, name FROM projects ORDER BY updated_at DESC")
        .map_err(|e| format!("Erreur lecture projets: {}", e))?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| format!("Erreur lecture projets: {}", e))?;
    let mut projects: Vec<Value> = Vec::new();
    for row in rows {
        if let Ok((path, name)) = row {
            projects.push(serde_json::json!({"path": path, "name": name}));
        }
    }
    drop(stmt);
    drop(conn);
    // Associer le client depuis la config (source de vérité de l'association).
    let cfg = state.config.lock().unwrap();
    for p in projects.iter_mut() {
        let path = p.get("path").and_then(|v| v.as_str()).unwrap_or("");
        let client = cfg.super_agent_project_client.get(path).cloned().unwrap_or_default();
        p["client"] = serde_json::json!(client);
    }
    Ok(serde_json::json!({"projects": projects}))
}

// ── Tableau de bord de suivi multi-projets ──

/// Renvoie un tableau de bord structuré de suivi multi-projets : clients,
/// projets (avec compteurs de tâches), décisions récentes et sessions récentes.
/// Lecture seule de la base de suivi de l'assistant (~/.pilot/super-agent.db).
#[tauri::command]
pub async fn get_super_agent_tracking(app: AppHandle) -> Result<Value, String> {
    let conn = open_db(&app)?;

    // Clients (depuis la table clients).
    let mut stmt = conn
        .prepare("SELECT id, name FROM clients ORDER BY name")
        .map_err(|e| format!("Erreur lecture clients: {}", e))?;
    let client_rows = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| format!("Erreur lecture clients: {}", e))?;
    let mut clients: Vec<(i64, String)> = Vec::new();
    for row in client_rows {
        if let Ok((id, name)) = row {
            clients.push((id, name));
        }
    }
    drop(stmt);

    let mut result_clients: Vec<Value> = Vec::new();
    for (client_id, client_name) in clients {
        // Projets du client avec compteurs de tâches.
        let mut stmt = conn
            .prepare("SELECT id, name, path FROM projects WHERE client_id = ?1 ORDER BY name")
            .map_err(|e| format!("Erreur lecture projets: {}", e))?;
        let project_rows = stmt
            .query_map(rusqlite::params![client_id], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
            })
            .map_err(|e| format!("Erreur lecture projets: {}", e))?;
        let mut projects: Vec<Value> = Vec::new();
        for row in project_rows {
            if let Ok((pid, pname, ppath)) = row {
                let tasks_en_cours: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM tasks WHERE project_id = ?1 AND status NOT IN ('terminee','livree','annulee')",
                        rusqlite::params![pid],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                let tasks_terminees: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM tasks WHERE project_id = ?1 AND status IN ('terminee','livree')",
                        rusqlite::params![pid],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                projects.push(serde_json::json!({
                    "name": pname,
                    "path": ppath,
                    "tasks_en_cours": tasks_en_cours,
                    "tasks_terminees": tasks_terminees,
                }));
            }
        }
        drop(stmt);

        // Décisions récentes du client (via ses projets).
        let mut stmt = conn
            .prepare(
                "SELECT d.summary FROM decisions d
                 JOIN projects p ON p.id = d.project_id
                 WHERE p.client_id = ?1
                 ORDER BY d.created_at DESC LIMIT 10",
            )
            .map_err(|e| format!("Erreur lecture décisions: {}", e))?;
        let decision_rows = stmt
            .query_map(rusqlite::params![client_id], |r| r.get::<_, String>(0))
            .map_err(|e| format!("Erreur lecture décisions: {}", e))?;
        let mut decisions: Vec<String> = Vec::new();
        for row in decision_rows {
            if let Ok(s) = row {
                decisions.push(s);
            }
        }
        drop(stmt);

        // Sessions récentes du client (via ses projets).
        let mut stmt = conn
            .prepare(
                "SELECT p.name, s.summary FROM session_summaries s
                 JOIN projects p ON p.id = s.project_id
                 WHERE p.client_id = ?1
                 ORDER BY s.created_at DESC LIMIT 10",
            )
            .map_err(|e| format!("Erreur lecture sessions: {}", e))?;
        let session_rows = stmt
            .query_map(rusqlite::params![client_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(|e| format!("Erreur lecture sessions: {}", e))?;
        let mut sessions: Vec<String> = Vec::new();
        for row in session_rows {
            if let Ok((pname, summary)) = row {
                sessions.push(format!("{}: {}", pname, summary));
            }
        }
        drop(stmt);

        result_clients.push(serde_json::json!({
            "name": client_name,
            "projects": projects,
            "decisions_recentes": decisions,
            "sessions_recentes": sessions,
        }));
    }

    Ok(serde_json::json!({ "clients": result_clients }))
}

// ── Apprentissage : injection de résumé de session ──

// P0-4 : borne de taille du résumé injecté à l'assistant. Un résumé de fin de
// tâche (run d'agents délégués, délégation, session) trop volumineux encombre
// le contexte de l'assistant. On tronque au-delà de cette borne et on ajoute un
// marqueur de troncature explicite.
const SUPER_AGENT_SUMMARY_MAX_CHARS: usize = 8000;
const SUMMARY_TRUNCATION_MARKER: &str = "\n…[résumé tronqué : trop volumineux]";

/// Tronque un résumé pour l'injection à l'assistant (borne + marqueur).
fn truncate_summary(summary: &str) -> String {
    if summary.len() <= SUPER_AGENT_SUMMARY_MAX_CHARS {
        return summary.to_string();
    }
    let mut cut = summary.chars().take(SUPER_AGENT_SUMMARY_MAX_CHARS).collect::<String>();
    cut.push_str(SUMMARY_TRUNCATION_MARKER);
    cut
}

/// Enregistre un résumé de session dans la base et l'injecte au super-agent
/// (s'il est démarré) pour qu'il apprenne en continu.
#[tauri::command]
pub fn inject_session_summary(
    state: State<AppState>,
    app: AppHandle,
    project_path: Option<String>,
    session_id: Option<String>,
    summary: String,
) -> Result<Value, String> {
    // P0-4 : borne le résumé (quant à la taille) pour ne pas encombrer le
    // contexte de l'assistant. Tronqué ici à la source, le marqueur de
    // troncature informe l'assistant que le résultat a été agrégé.
    let summary = truncate_summary(&summary);
    // Persister TOUJOURS dans la base (delivered=0 par défaut). En cas de
    // super-agent indisponible ou occupé, le résumé est conservé en attente et
    // sera rejoué plus tard (`replay_pending_superagent_summaries`) → plus
    // aucune perte silencieuse.
    let conn = open_db(&app)?;
    let project_id: Option<i64> = match &project_path {
        Some(p) => {
            conn.execute(
                "INSERT INTO projects (path, name) VALUES (?1, ?2)
                 ON CONFLICT(path) DO UPDATE SET updated_at = datetime('now')",
                rusqlite::params![p, p],
            )
            .map_err(|e| format!("Erreur enregistrement projet: {}", e))?;
            conn.query_row(
                "SELECT id FROM projects WHERE path = ?1",
                rusqlite::params![p],
                |r| r.get(0),
            )
            .ok()
        }
        None => None,
    };
    conn.execute(
        "INSERT INTO session_summaries (project_id, session_id, summary, delivered) VALUES (?1, ?2, ?3, 0)",
        rusqlite::params![project_id, session_id.unwrap_or_default(), summary],
    )
    .map_err(|e| format!("Erreur enregistrement résumé: {}", e))?;
    let summary_rowid = conn.last_insert_rowid();

    // Injecter au super-agent s'il est vivant ET non occupé. Sinon le laisser
    // en attente (delivered=0) : le rejeu le délivrera à la prochaine
    // opportunité.
    if superagent_available(state.inner()) {
        let msg = build_injection_message(project_path.as_deref(), &summary);
        let cmd = serde_json::json!({"type": "prompt", "message": msg});
        match state.agent_service.send_superagent(cmd) {
            Ok(()) => {
                conn.execute(
                    "UPDATE session_summaries SET delivered = 1 WHERE id = ?1",
                    rusqlite::params![summary_rowid],
                )
                .map_err(|e| format!("Erreur marquage livré: {}", e))?;
                log_injection(&conn, project_id, "delivered", true, "ok");
                drop(conn);
                Ok(serde_json::json!({"status": "delivered", "detail": "ok"}))
            }
            Err(e) => {
                log_injection(&conn, project_id, "error", false, &e);
                drop(conn);
                Ok(serde_json::json!({"status": "error", "detail": e}))
            }
        }
    } else {
        log_injection(&conn, project_id, "queued", true, "super-agent indisponible ou occupé — sera rejoué");
        drop(conn);
        Ok(serde_json::json!({
            "status": "queued",
            "detail": "super-agent indisponible ou occupé — sera rejoué"
        }))
    }
}

/// Construit le message d'injection d'un résumé au super-agent. Le message est
/// clairement marqué comme un résumé/injection (pas une saisie utilisateur).
fn build_injection_message(project_path: Option<&str>, summary: &str) -> String {
    format!(
        "[Résumé de session] Projet: {}\n{}\n\nIntègre ces informations dans ton suivi (tâches, décisions, état d'avancement).",
        project_path.unwrap_or(""),
        summary
    )
}

/// Journalise un résultat d'injection dans la table injection_logs (audit).
fn log_injection(conn: &Connection, project_id: Option<i64>, status: &str, ok: bool, detail: &str) {
    let _ = conn.execute(
        "INSERT INTO injection_logs (project_id, status, ok, detail) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![project_id, status, ok as i64, detail],
    );
}

/// Le super-agent est-il disponible pour recevoir une injection ? (session
/// vivante ET non occupée).
fn superagent_available(state: &AppState) -> bool {
    state.agent_service.superagent_alive()
        && !state
            .agent_service
            .agent_process_busy(&state.agent_anomaly, "", SUPERAGENT_ID)
}

/// Rejoue les résumés en attente (`delivered=0`) vers le super-agent quand la
/// session est vivante et non occupée. Idempotent : un résumé livré n'est
/// jamais rejoué ; un résumé en attente est livré au plus une fois (marqué
/// `delivered=1` après succès). Chaque tentative est journalisée en
/// `injection_logs`. S'arrête dès que le super-agent devient indisponible.
fn replay_pending_superagent_summaries(state: &AppState, app: &AppHandle) -> Result<(), String> {
    if !superagent_available(state) {
        return Ok(());
    }
    let conn = open_db(app)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, project_id, session_id, summary FROM session_summaries \
             WHERE delivered = 0 ORDER BY id",
        )
        .map_err(|e| format!("Erreur lecture résumés en attente: {}", e))?;
    let pending: Vec<(i64, Option<i64>, String, String)> = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, Option<i64>>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })
        .map_err(|e| format!("Erreur lecture résumés en attente: {}", e))?
        .collect::<Result<_, _>>()
        .map_err(|e| format!("Erreur lecture résumés en attente: {}", e))?;
    drop(stmt);
    for (id, project_id, session_id, summary) in pending {
        // Re-vérifier la disponibilité à chaque itération (le super-agent peut
        // devenir occupé pendant le rejeu).
        if !superagent_available(state) {
            break;
        }
        let project_path = project_id.and_then(|pid| {
            conn.query_row(
                "SELECT path FROM projects WHERE id = ?1",
                rusqlite::params![pid],
                |r| r.get::<_, String>(0),
            )
            .ok()
        });
        let _ = session_id;
        let msg = build_injection_message(project_path.as_deref(), &summary);
        let cmd = serde_json::json!({"type": "prompt", "message": msg});
        match state.agent_service.send_superagent(cmd) {
            Ok(()) => {
                conn.execute(
                    "UPDATE session_summaries SET delivered = 1 WHERE id = ?1",
                    rusqlite::params![id],
                )
                .map_err(|e| format!("Erreur marquage livré: {}", e))?;
                log_injection(&conn, project_id, "delivered", true, "rejoué");
            }
            Err(e) => {
                log_injection(&conn, project_id, "error", false, &e);
            }
        }
    }
    Ok(())
}

/// Commande Tauri : rejoue les résumés en attente vers le super-agent. Appelée
/// à l'ouverture de l'onglet 🧭 (fire-and-forget) et en début de
/// `do_send_super_agent_prompt` (couvre le web remote et le premier envoi).
#[tauri::command]
pub fn replay_superagent_summaries(state: State<AppState>, app: AppHandle) -> Result<(), String> {
    replay_pending_superagent_summaries(state.inner(), &app)
}

// ── Initialisation d'un projet existant ──

/// Analyse un projet (structure, docs) et pose les questions nécessaires au
/// super-agent pour son fonctionnement. En V1 : enregistre le projet dans la
/// base et envoie un prompt d'initialisation au super-agent.
#[tauri::command]
pub fn initialize_super_agent(
    state: State<AppState>,
    app: AppHandle,
    project_path: String,
) -> Result<(), String> {
    // Enregistrer le projet dans la base.
    let conn = open_db(&app)?;
    conn.execute(
        "INSERT INTO projects (path, name) VALUES (?1, ?2)
         ON CONFLICT(path) DO UPDATE SET updated_at = datetime('now')",
        rusqlite::params![project_path, project_path],
    )
    .map_err(|e| format!("Erreur enregistrement projet: {}", e))?;
    drop(conn);

    // S'assurer que la session est démarrée.
    do_start_super_agent_session(state.inner(), &app)?;

    let msg = format!(
        "Tu es l'assistant de suivi du projet « {} ». Analyse ce projet (structure, documentation, historique) puis pose les questions nécessaires à ton fonctionnement : contexte, objectifs, client, jalons, état d'avancement. Tu es en lecture seule : ne modifie aucun fichier du projet.",
        project_path
    );
    let cmd = serde_json::json!({"type": "prompt", "message": msg});
    state.agent_service.send_superagent(cmd)
}

// ── Question sur tous les projets ──

/// Répond à une question en s'appuyant sur la base + le super-agent.
#[tauri::command]
pub fn query_super_agent(state: State<AppState>, app: AppHandle, question: String) -> Result<(), String> {
    do_start_super_agent_session(state.inner(), &app)?;
    let cmd = serde_json::json!({"type": "prompt", "message": question});
    state.agent_service.send_superagent(cmd)
}

// ── A4/A5/A6/A7/A8/A9/A3 : API typée de suivi de l'assistant ──
//
// Commandes typées (au lieu de SQL brut via db_query/db_execute) pour les
// opérations courantes de suivi : tâches, décisions, jalons, échéances,
// blocages, handoff inter-projets, lecture cadrée de fichiers, suivi temporel,
// vue d'ensemble, santé projet et recherche de sessions. Lecture/écriture sur
// la base de suivi (sauf read_project_file / search_project / search_sessions
// qui lisent les fichiers/index du projet en lecture seule stricte).

/// Résout l'id d'un projet dans la base (upsert si nécessaire) et le retourne.
/// Helper partagé par les commandes typées de suivi.
fn resolve_project_id(conn: &Connection, project_path: &str) -> Result<i64, String> {
    conn.execute(
        "INSERT INTO projects (path, name) VALUES (?1, ?2)\n         ON CONFLICT(path) DO UPDATE SET updated_at = datetime('now')",
        rusqlite::params![project_path, project_path],
    )
    .map_err(|e| format!("Erreur enregistrement projet: {}", e))?;
    conn.query_row(
        "SELECT id FROM projects WHERE path = ?1",
        rusqlite::params![project_path],
        |r| r.get(0),
    )
    .map_err(|e| format!("Projet introuvable après upsert: {}", e))
}

/// A4 — Crée une tâche dans un projet. Retourne `{ ok, task_id }`.
#[tauri::command]
pub fn super_agent_create_task(
    app: AppHandle,
    project_path: String,
    title: String,
    description: Option<String>,
    deadline: Option<String>,
) -> Result<Value, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("create_task : un titre est requis".to_string());
    }
    let conn = open_db(&app)?;
    let project_id = resolve_project_id(&conn, &project_path)?;
    conn.execute(
        "INSERT INTO tasks (project_id, title, description, deadline) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![project_id, title, description.unwrap_or_default(), deadline],
    )
    .map_err(|e| format!("Erreur création tâche: {}", e))?;
    Ok(serde_json::json!({ "ok": true, "task_id": conn.last_insert_rowid() }))
}

/// A4 — Met à jour le statut d'une tâche. Retourne `{ ok, task_id, status }`.
#[tauri::command]
pub fn super_agent_update_task_status(
    app: AppHandle,
    task_id: i64,
    status: String,
) -> Result<Value, String> {
    let status = status.trim();
    if status.is_empty() {
        return Err("update_task_status : un statut est requis".to_string());
    }
    let conn = open_db(&app)?;
    let n = conn
        .execute(
            "UPDATE tasks SET status = ?1, updated_at = datetime('now') WHERE id = ?2",
            rusqlite::params![status, task_id],
        )
        .map_err(|e| format!("Erreur mise à jour statut: {}", e))?;
    if n == 0 {
        return Err(format!("Tâche {} introuvable", task_id));
    }
    Ok(serde_json::json!({ "ok": true, "task_id": task_id, "status": status }))
}

/// A5 — Ajoute une décision à un projet (optionnellement liée à une tâche).
/// Retourne `{ ok, decision_id }`.
#[tauri::command]
pub fn super_agent_add_decision(
    app: AppHandle,
    project_path: String,
    summary: String,
    task_id: Option<i64>,
) -> Result<Value, String> {
    let summary = summary.trim();
    if summary.is_empty() {
        return Err("add_decision : un résumé est requis".to_string());
    }
    let conn = open_db(&app)?;
    let project_id = resolve_project_id(&conn, &project_path)?;
    conn.execute(
        "INSERT INTO decisions (project_id, task_id, summary) VALUES (?1, ?2, ?3)",
        rusqlite::params![project_id, task_id, summary],
    )
    .map_err(|e| format!("Erreur ajout décision: {}", e))?;
    Ok(serde_json::json!({ "ok": true, "decision_id": conn.last_insert_rowid() }))
}

/// A6 — Ajoute un jalon à un projet. Retourne `{ ok, milestone_id }`.
#[tauri::command]
pub fn super_agent_add_milestone(
    app: AppHandle,
    project_path: String,
    title: String,
    due_date: Option<String>,
) -> Result<Value, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("add_milestone : un titre est requis".to_string());
    }
    let conn = open_db(&app)?;
    let project_id = resolve_project_id(&conn, &project_path)?;
    conn.execute(
        "INSERT INTO milestones (project_id, title, due_date) VALUES (?1, ?2, ?3)",
        rusqlite::params![project_id, title, due_date],
    )
    .map_err(|e| format!("Erreur ajout jalon: {}", e))?;
    Ok(serde_json::json!({ "ok": true, "milestone_id": conn.last_insert_rowid() }))
}

/// A7 — Fixe (ou efface) l'échéance d'une tâche. Retourne `{ ok, task_id, deadline }`.
#[tauri::command]
pub fn super_agent_set_deadline(
    app: AppHandle,
    task_id: i64,
    deadline: Option<String>,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    let n = conn
        .execute(
            "UPDATE tasks SET deadline = ?1, updated_at = datetime('now') WHERE id = ?2",
            rusqlite::params![deadline, task_id],
        )
        .map_err(|e| format!("Erreur mise à jour échéance: {}", e))?;
    if n == 0 {
        return Err(format!("Tâche {} introuvable", task_id));
    }
    Ok(serde_json::json!({ "ok": true, "task_id": task_id, "deadline": deadline }))
}

/// A8 — Marque une tâche comme bloquée avec une raison. Retourne `{ ok, task_id }`.
#[tauri::command]
pub fn super_agent_flag_blocker(
    app: AppHandle,
    task_id: i64,
    reason: String,
) -> Result<Value, String> {
    let reason = reason.trim();
    if reason.is_empty() {
        return Err("flag_blocker : une raison est requise".to_string());
    }
    let conn = open_db(&app)?;
    let n = conn
        .execute(
            "UPDATE tasks SET blocker_reason = ?1, updated_at = datetime('now') WHERE id = ?2",
            rusqlite::params![reason, task_id],
        )
        .map_err(|e| format!("Erreur marquage blocage: {}", e))?;
    if n == 0 {
        return Err(format!("Tâche {} introuvable", task_id));
    }
    Ok(serde_json::json!({ "ok": true, "task_id": task_id, "blocker_reason": reason }))
}

/// A7 — Retourne la timeline d'un projet : jalons + tâches avec échéances.
/// Une tâche est `overdue` si son échéance est passée et qu'elle n'est pas
/// terminée (statut hors terminee/livree/annulee). Utilise `resolve_project_id`.
#[tauri::command]
pub fn super_agent_get_project_timeline(
    app: AppHandle,
    project_path: String,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    let project_id = resolve_project_id(&conn, &project_path)?;

    let mut milestones = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT id, title, due_date, status FROM milestones WHERE project_id = ?1 ORDER BY due_date ASC",
            )
            .map_err(|e| format!("Erreur lecture jalons: {}", e))?;
        let rows = stmt
            .query_map(rusqlite::params![project_id], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, String>(3)?,
                ))
            })
            .map_err(|e| format!("Erreur lecture jalons: {}", e))?;
        for row in rows {
            if let Ok((id, title, due_date, status)) = row {
                milestones.push(serde_json::json!({
                    "id": id, "title": title, "due_date": due_date, "status": status
                }));
            }
        }
    }

    let mut tasks = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT id, title, status, deadline, blocker_reason,\n                       (deadline < date('now') AND status NOT IN ('terminee','livree','annulee')) AS overdue\n                 FROM tasks WHERE project_id = ?1 AND deadline IS NOT NULL ORDER BY deadline ASC",
            )
            .map_err(|e| format!("Erreur lecture tâches: {}", e))?;
        let rows = stmt
            .query_map(rusqlite::params![project_id], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, i64>(5)?,
                ))
            })
            .map_err(|e| format!("Erreur lecture tâches: {}", e))?;
        for row in rows {
            if let Ok((id, title, status, deadline, blocker_reason, overdue)) = row {
                tasks.push(serde_json::json!({
                    "id": id, "title": title, "status": status, "deadline": deadline,
                    "blocker_reason": blocker_reason, "overdue": overdue != 0
                }));
            }
        }
    }

    Ok(serde_json::json!({
        "project_path": project_path,
        "milestones": milestones,
        "tasks": tasks,
    }))
}

/// A9 — Crée une tâche dans le projet cible en référençant la tâche source
/// (handoff inter-projets). Retourne `{ ok, task_id, source_task_id }`.
#[tauri::command]
pub fn super_agent_handoff_to_project(
    app: AppHandle,
    source_path: String,
    target_path: String,
    task_id: i64,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    // Lire la tâche source pour la dupliquer dans le projet cible.
    let (title, description, deadline): (String, String, Option<String>) = conn
        .query_row(
            "SELECT title, description, deadline FROM tasks WHERE id = ?1",
            rusqlite::params![task_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|e| format!("Tâche source {} introuvable: {}", task_id, e))?;
    let target_project_id = resolve_project_id(&conn, &target_path)?;
    conn.execute(
        "INSERT INTO tasks (project_id, title, description, deadline, source_task_id) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![target_project_id, title, description, deadline, task_id],
    )
    .map_err(|e| format!("Erreur handoff: {}", e))?;
    let new_id = conn.last_insert_rowid();
    Ok(serde_json::json!({
        "ok": true, "task_id": new_id, "source_task_id": task_id,
        "source_path": source_path, "target_path": target_path,
    }))
}

/// A3 — Lit un fichier du projet en lecture seule. Le chemin relatif est résolu
/// sous le projet ; tout chemin absolu, remontant (`..`) ou sortant du projet est
/// refusé. Retourne `{ path, content }`.
#[tauri::command]
pub fn super_agent_read_project_file(
    app: AppHandle,
    project_path: String,
    rel_path: String,
) -> Result<Value, String> {
    let _ = app;
    let rel = std::path::Path::new(&rel_path);
    if rel.is_absolute()
        || rel
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("read_project_file : chemin hors du projet refusé".to_string());
    }
    let project = std::path::Path::new(&project_path);
    let canonical_project = project
        .canonicalize()
        .map_err(|e| format!("Projet introuvable: {}", e))?;
    let full = project.join(rel);
    let canonical_full = full
        .canonicalize()
        .map_err(|e| format!("Fichier introuvable: {}", e))?;
    if !canonical_full.starts_with(&canonical_project) {
        return Err("read_project_file : chemin hors du projet refusé".to_string());
    }
    let content = std::fs::read_to_string(&canonical_full)
        .map_err(|e| format!("Erreur lecture fichier: {}", e))?;
    Ok(serde_json::json!({ "path": rel_path, "content": content }))
}

/// A3 — Recherche un motif dans les fichiers d'un projet (lecture seule).
/// Délègue à `search::search_project_dir` (déjà refactoré).
#[tauri::command]
pub fn super_agent_search_project(
    app: AppHandle,
    project_path: String,
    query: String,
    use_regex: bool,
    extensions: String,
    max_results: Option<usize>,
) -> Result<Value, String> {
    let _ = app;
    let results = crate::search::search_project_dir(
        &project_path,
        query,
        use_regex,
        extensions,
        max_results,
    )?;
    serde_json::to_value(results).map_err(|e| format!("Erreur sérialisation: {}", e))
}

/// A9 — Vue d'ensemble multi-projets agrégée par client : nombre de projets,
/// tâches ouvertes/terminées, décisions récentes, sessions récentes et jalons à
/// venir. Retourne un JSON structuré.
#[tauri::command]
pub fn super_agent_project_overview(app: AppHandle) -> Result<Value, String> {
    let conn = open_db(&app)?;

    let mut clients = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT c.id, c.name FROM clients c ORDER BY c.name")
            .map_err(|e| format!("Erreur lecture clients: {}", e))?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| format!("Erreur lecture clients: {}", e))?;
        for row in rows {
            if let Ok((cid, cname)) = row {
                let mut projects = Vec::new();
                {
                    let mut pstmt = conn
                        .prepare("SELECT id, path, name FROM projects WHERE client_id = ?1 ORDER BY name")
                        .map_err(|e| format!("Erreur lecture projets: {}", e))?;
                    let prows = pstmt
                        .query_map(rusqlite::params![cid], |r| {
                            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
                        })
                        .map_err(|e| format!("Erreur lecture projets: {}", e))?;
                    for prow in prows {
                        if let Ok((pid, ppath, pname)) = prow {
                            let open: i64 = conn
                                .query_row(
                                    "SELECT COUNT(*) FROM tasks WHERE project_id = ?1 AND status NOT IN ('terminee','livree','annulee')",
                                    rusqlite::params![pid],
                                    |r| r.get(0),
                                )
                                .unwrap_or(0);
                            let done: i64 = conn
                                .query_row(
                                    "SELECT COUNT(*) FROM tasks WHERE project_id = ?1 AND status IN ('terminee','livree')",
                                    rusqlite::params![pid],
                                    |r| r.get(0),
                                )
                                .unwrap_or(0);
                            projects.push(serde_json::json!({
                                "id": pid, "path": ppath, "name": pname,
                                "tasks_open": open, "tasks_done": done,
                            }));
                        }
                    }
                }
                clients.push(serde_json::json!({
                    "id": cid, "name": cname, "projects": projects,
                }));
            }
        }
    }

    // Décisions récentes (globales, toutes projets confondus).
    let mut recent_decisions = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT d.summary, d.created_at, p.path FROM decisions d LEFT JOIN projects p ON p.id = d.project_id ORDER BY d.created_at DESC LIMIT 10",
            )
            .map_err(|e| format!("Erreur lecture décisions: {}", e))?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                ))
            })
            .map_err(|e| format!("Erreur lecture décisions: {}", e))?;
        for row in rows {
            if let Ok((summary, created_at, path)) = row {
                recent_decisions.push(serde_json::json!({
                    "summary": summary, "created_at": created_at, "project_path": path,
                }));
            }
        }
    }

    // Jalons à venir (planifiés, échéance future ou nulle).
    let mut upcoming_milestones = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT m.title, m.due_date, p.path FROM milestones m JOIN projects p ON p.id = m.project_id WHERE m.status = 'planifie' AND m.due_date IS NOT NULL AND m.due_date >= date('now') ORDER BY m.due_date ASC LIMIT 10",
            )
            .map_err(|e| format!("Erreur lecture jalons: {}", e))?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| format!("Erreur lecture jalons: {}", e))?;
        for row in rows {
            if let Ok((title, due_date, path)) = row {
                upcoming_milestones.push(serde_json::json!({
                    "title": title, "due_date": due_date, "project_path": path,
                }));
            }
        }
    }

    // Sessions récentes : scanne l'index de sessions de chaque projet connu.
    let mut recent_sessions = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT path FROM projects")
            .map_err(|e| format!("Erreur lecture projets: {}", e))?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| format!("Erreur lecture projets: {}", e))?;
        for row in rows {
            if let Ok(path) = row {
                for e in crate::session_history::read_session_index(&path) {
                    let ts = e.get("timestamp").and_then(|x| x.as_str()).unwrap_or("");
                    let summary = e.get("summary").and_then(|x| x.as_str()).unwrap_or("");
                    recent_sessions.push(serde_json::json!({
                        "project_path": path, "timestamp": ts, "summary": summary,
                    }));
                }
            }
        }
    }
    recent_sessions.sort_by(|a, b| {
        let ta = a.get("timestamp").and_then(|x| x.as_str()).unwrap_or("");
        let tb = b.get("timestamp").and_then(|x| x.as_str()).unwrap_or("");
        tb.cmp(ta)
    });
    recent_sessions.truncate(10);

    Ok(serde_json::json!({
        "clients": clients,
        "recent_decisions": recent_decisions,
        "recent_sessions": recent_sessions,
        "upcoming_milestones": upcoming_milestones,
    }))
}

/// A8 — Détecte proactivement les problèmes d'un projet : tâches bloquées
/// (blocker_reason non vide), tâches en retard, jalons dépassés. Retourne un
/// rapport JSON.
#[tauri::command]
pub fn super_agent_check_project_health(
    app: AppHandle,
    project_path: String,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    let project_id = resolve_project_id(&conn, &project_path)?;

    let mut blocked = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT id, title, blocker_reason FROM tasks WHERE project_id = ?1 AND blocker_reason IS NOT NULL AND blocker_reason != ''",
            )
            .map_err(|e| format!("Erreur lecture tâches bloquées: {}", e))?;
        let rows = stmt
            .query_map(rusqlite::params![project_id], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
            })
            .map_err(|e| format!("Erreur lecture tâches bloquées: {}", e))?;
        for row in rows {
            if let Ok((id, title, reason)) = row {
                blocked.push(serde_json::json!({"id": id, "title": title, "reason": reason}));
            }
        }
    }

    let mut overdue = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT id, title, deadline FROM tasks WHERE project_id = ?1 AND deadline IS NOT NULL AND deadline < date('now') AND status NOT IN ('terminee','livree','annulee')",
            )
            .map_err(|e| format!("Erreur lecture tâches en retard: {}", e))?;
        let rows = stmt
            .query_map(rusqlite::params![project_id], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
            })
            .map_err(|e| format!("Erreur lecture tâches en retard: {}", e))?;
        for row in rows {
            if let Ok((id, title, deadline)) = row {
                overdue.push(serde_json::json!({"id": id, "title": title, "deadline": deadline}));
            }
        }
    }

    let mut missed_milestones = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT id, title, due_date FROM milestones WHERE project_id = ?1 AND status = 'planifie' AND due_date IS NOT NULL AND due_date < date('now')",
            )
            .map_err(|e| format!("Erreur lecture jalons dépassés: {}", e))?;
        let rows = stmt
            .query_map(rusqlite::params![project_id], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
            })
            .map_err(|e| format!("Erreur lecture jalons dépassés: {}", e))?;
        for row in rows {
            if let Ok((id, title, due_date)) = row {
                missed_milestones.push(serde_json::json!({"id": id, "title": title, "due_date": due_date}));
            }
        }
    }

    Ok(serde_json::json!({
        "project_path": project_path,
        "blocked_tasks": blocked,
        "overdue_tasks": overdue,
        "missed_milestones": missed_milestones,
    }))
}

/// A3 — Recherche dans l'index de sessions d'un projet (lecture seule).
/// Délègue à `session_history::search_sessions_in` (déjà refactoré).
#[tauri::command]
pub fn super_agent_search_sessions(
    app: AppHandle,
    project_path: String,
    params: Value,
) -> Result<Value, String> {
    let _ = app;
    let params: crate::session_history::SearchParams =
        serde_json::from_value(params).map_err(|e| format!("Paramètres invalides: {}", e))?;
    crate::session_history::search_sessions_in(&project_path, params)
}

// ── Transfert de mémoire (issue #69) ──
//
// Export/import de la « mémoire » de l'assistant (suivi multi-projets) pour
// transférer son suivi entre deux postes. Format unifié JSON :
//   { format: "pilot-assistant-memory", version: 1, exported_at, sections: {...} }
// Sections optionnelles (tracking / settings / behavior / appearance) : chaque
// section n'est incluse que si cochée à l'export. À l'import, le fichier est
// validé (format + version) puis REMPLACE la mémoire locale (confirmation côté
// UI). L'import est transactionnel : purge puis réinsertion dans la même
// transaction, avec réécriture des ids parents → enfants. Aucune donnée
// personnelle (coffre vault, conversations privées, tables etat_reprise /
// magnus_* / mes_*) n'est exportée.

pub(crate) const MEMORY_FORMAT: &str = "pilot-assistant-memory";
pub(crate) const MEMORY_VERSION: u64 = 1;

/// Valide le format et la version d'un export JSON. Retourne la valeur parsée.
/// Fonction pure testable.
pub(crate) fn validate_export_json(input: &str) -> Result<Value, String> {
    let v: Value = serde_json::from_str(input).map_err(|e| format!("Fichier invalide : {}", e))?;
    let format = v.get("format").and_then(|x| x.as_str()).unwrap_or("");
    if format != MEMORY_FORMAT {
        return Err("Fichier invalide : format inconnu".to_string());
    }
    let version = v.get("version").and_then(|x| x.as_u64()).unwrap_or(0);
    if version != MEMORY_VERSION {
        return Err(format!("Version non supportée : {}", version));
    }
    match v.get("sections") {
        Some(Value::Object(_)) | None => {}
        _ => return Err("Fichier invalide : sections mal formées".to_string()),
    }
    Ok(v)
}

/// Sérialise le suivi (tracking) de la base en JSON, avec les ids naturels pour
/// que l'import puisse réécrire les relations parents → enfants. Fonction pure
/// sur `Connection`, testable (in-memory en test, open_db en production).
pub(crate) fn serialize_tracking(conn: &Connection) -> Result<Value, String> {
    let mut clients = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, name, notes, created_at, updated_at FROM clients ORDER BY id")
            .map_err(|e| format!("Erreur lecture clients : {}", e))?;
        let rows = stmt
            .query_map([], |r| {
                Ok(serde_json::json!({
                    "id": r.get::<_, i64>(0)?,
                    "name": r.get::<_, String>(1)?,
                    "notes": r.get::<_, String>(2)?,
                    "created_at": r.get::<_, String>(3)?,
                    "updated_at": r.get::<_, String>(4)?,
                }))
            })
            .map_err(|e| format!("Erreur lecture clients : {}", e))?;
        for row in rows {
            clients.push(row.map_err(|e| format!("Erreur lecture clients : {}", e))?);
        }
    }

    let mut projects = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, client_id, path, name, status, created_at, updated_at FROM projects ORDER BY id")
            .map_err(|e| format!("Erreur lecture projets : {}", e))?;
        let rows = stmt
            .query_map([], |r| {
                Ok(serde_json::json!({
                    "id": r.get::<_, i64>(0)?,
                    "client_id": r.get::<_, Option<i64>>(1)?,
                    "path": r.get::<_, String>(2)?,
                    "name": r.get::<_, String>(3)?,
                    "status": r.get::<_, String>(4)?,
                    "created_at": r.get::<_, String>(5)?,
                    "updated_at": r.get::<_, String>(6)?,
                }))
            })
            .map_err(|e| format!("Erreur lecture projets : {}", e))?;
        for row in rows {
            projects.push(row.map_err(|e| format!("Erreur lecture projets : {}", e))?);
        }
    }

    let mut tasks = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT id, project_id, title, description, status, deadline, blocker_reason, source_task_id, created_at, updated_at FROM tasks ORDER BY id",
            )
            .map_err(|e| format!("Erreur lecture tâches : {}", e))?;
        let rows = stmt
            .query_map([], |r| {
                Ok(serde_json::json!({
                    "id": r.get::<_, i64>(0)?,
                    "project_id": r.get::<_, i64>(1)?,
                    "title": r.get::<_, String>(2)?,
                    "description": r.get::<_, String>(3)?,
                    "status": r.get::<_, String>(4)?,
                    "deadline": r.get::<_, Option<String>>(5)?,
                    "blocker_reason": r.get::<_, Option<String>>(6)?,
                    "source_task_id": r.get::<_, Option<i64>>(7)?,
                    "created_at": r.get::<_, String>(8)?,
                    "updated_at": r.get::<_, String>(9)?,
                }))
            })
            .map_err(|e| format!("Erreur lecture tâches : {}", e))?;
        for row in rows {
            tasks.push(row.map_err(|e| format!("Erreur lecture tâches : {}", e))?);
        }
    }

    let mut decisions = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, project_id, task_id, summary, source_session, created_at FROM decisions ORDER BY id")
            .map_err(|e| format!("Erreur lecture décisions : {}", e))?;
        let rows = stmt
            .query_map([], |r| {
                Ok(serde_json::json!({
                    "id": r.get::<_, i64>(0)?,
                    "project_id": r.get::<_, Option<i64>>(1)?,
                    "task_id": r.get::<_, Option<i64>>(2)?,
                    "summary": r.get::<_, String>(3)?,
                    "source_session": r.get::<_, String>(4)?,
                    "created_at": r.get::<_, String>(5)?,
                }))
            })
            .map_err(|e| format!("Erreur lecture décisions : {}", e))?;
        for row in rows {
            decisions.push(row.map_err(|e| format!("Erreur lecture décisions : {}", e))?);
        }
    }

    let mut milestones = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, project_id, title, due_date, status, created_at, updated_at FROM milestones ORDER BY id")
            .map_err(|e| format!("Erreur lecture jalons : {}", e))?;
        let rows = stmt
            .query_map([], |r| {
                Ok(serde_json::json!({
                    "id": r.get::<_, i64>(0)?,
                    "project_id": r.get::<_, i64>(1)?,
                    "title": r.get::<_, String>(2)?,
                    "due_date": r.get::<_, Option<String>>(3)?,
                    "status": r.get::<_, String>(4)?,
                    "created_at": r.get::<_, String>(5)?,
                    "updated_at": r.get::<_, String>(6)?,
                }))
            })
            .map_err(|e| format!("Erreur lecture jalons : {}", e))?;
        for row in rows {
            milestones.push(row.map_err(|e| format!("Erreur lecture jalons : {}", e))?);
        }
    }

    let mut session_summaries = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, project_id, session_id, summary, delivered, created_at FROM session_summaries ORDER BY id")
            .map_err(|e| format!("Erreur lecture résumés : {}", e))?;
        let rows = stmt
            .query_map([], |r| {
                Ok(serde_json::json!({
                    "id": r.get::<_, i64>(0)?,
                    "project_id": r.get::<_, Option<i64>>(1)?,
                    "session_id": r.get::<_, String>(2)?,
                    "summary": r.get::<_, String>(3)?,
                    "delivered": r.get::<_, i64>(4)?,
                    "created_at": r.get::<_, String>(5)?,
                }))
            })
            .map_err(|e| format!("Erreur lecture résumés : {}", e))?;
        for row in rows {
            session_summaries.push(row.map_err(|e| format!("Erreur lecture résumés : {}", e))?);
        }
    }

    let mut injection_logs = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, project_id, status, ok, detail, created_at FROM injection_logs ORDER BY id")
            .map_err(|e| format!("Erreur lecture logs injection : {}", e))?;
        let rows = stmt
            .query_map([], |r| {
                Ok(serde_json::json!({
                    "id": r.get::<_, i64>(0)?,
                    "project_id": r.get::<_, Option<i64>>(1)?,
                    "status": r.get::<_, String>(2)?,
                    "ok": r.get::<_, i64>(3)?,
                    "detail": r.get::<_, String>(4)?,
                    "created_at": r.get::<_, String>(5)?,
                }))
            })
            .map_err(|e| format!("Erreur lecture logs injection : {}", e))?;
        for row in rows {
            injection_logs.push(row.map_err(|e| format!("Erreur lecture logs injection : {}", e))?);
        }
    }

    Ok(serde_json::json!({
        "clients": clients,
        "projects": projects,
        "tasks": tasks,
        "decisions": decisions,
        "milestones": milestones,
        "session_summaries": session_summaries,
        "injection_logs": injection_logs,
    }))
}

/// Remplace transactionnellement le suivi (tracking) par les données importées,
/// en réécrivant les ids parents → enfants (clients → projets →
/// tâches/décisions/jalons/résumés de session). Active l'application des clés
/// étrangères sur la connexion pour garantir l'intégrité FK. Retourne la liste
/// des sous-sections remplacées. Fonction pure sur `Connection`, testable.
pub(crate) fn replace_tracking(conn: &Connection, data: &Value) -> Result<Vec<String>, String> {
    // PRAGMA foreign_keys doit être posé HORS transaction (ignoré dedans).
    conn.execute_batch("PRAGMA foreign_keys = ON")
        .map_err(|e| format!("Erreur PRAGMA : {}", e))?;

    let result = (|| -> Result<Vec<String>, String> {
        conn.execute_batch("BEGIN")
            .map_err(|e| format!("Erreur début transaction : {}", e))?;
        // Purge dans l'ordre inverse des dépendances (enfants d'abord).
        conn.execute_batch(
            "DELETE FROM injection_logs;\n\
             DELETE FROM decisions;\n\
             DELETE FROM session_summaries;\n\
             DELETE FROM milestones;\n\
             DELETE FROM tasks;\n\
             DELETE FROM projects;\n\
             DELETE FROM clients;",
        )
        .map_err(|e| format!("Erreur purge : {}", e))?;

        let mut client_map: HashMap<i64, i64> = HashMap::new();
        if let Some(clients) = data.get("clients").and_then(|x| x.as_array()) {
            for c in clients {
                let old = c.get("id").and_then(|x| x.as_i64()).unwrap_or(0);
                let name = c.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string();
                if name.trim().is_empty() {
                    continue;
                }
                let notes = c.get("notes").and_then(|x| x.as_str()).unwrap_or("").to_string();
                let created = c.get("created_at").and_then(|x| x.as_str()).unwrap_or("");
                let updated = c.get("updated_at").and_then(|x| x.as_str()).unwrap_or("");
                conn.execute(
                    "INSERT INTO clients (name, notes, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
                    rusqlite::params![name, notes, created, updated],
                )
                .map_err(|e| format!("Erreur insertion client « {} » : {}", name, e))?;
                client_map.insert(old, conn.last_insert_rowid());
            }
        }

        let mut project_map: HashMap<i64, i64> = HashMap::new();
        if let Some(projects) = data.get("projects").and_then(|x| x.as_array()) {
            for p in projects {
                let old = p.get("id").and_then(|x| x.as_i64()).unwrap_or(0);
                let path = p.get("path").and_then(|x| x.as_str()).unwrap_or("").to_string();
                if path.trim().is_empty() {
                    continue;
                }
                let name = p.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string();
                let status = p.get("status").and_then(|x| x.as_str()).unwrap_or("suivi").to_string();
                let client_old = p.get("client_id").and_then(|x| x.as_i64());
                let client_new = client_old.and_then(|cid| client_map.get(&cid)).copied();
                let created = p.get("created_at").and_then(|x| x.as_str()).unwrap_or("");
                let updated = p.get("updated_at").and_then(|x| x.as_str()).unwrap_or("");
                conn.execute(
                    "INSERT INTO projects (path, name, client_id, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    rusqlite::params![path, name, client_new, status, created, updated],
                )
                .map_err(|e| format!("Erreur insertion projet « {} » : {}", path, e))?;
                project_map.insert(old, conn.last_insert_rowid());
            }
        }

        let mut task_map: HashMap<i64, i64> = HashMap::new();
        if let Some(tasks) = data.get("tasks").and_then(|x| x.as_array()) {
            for t in tasks {
                let old = t.get("id").and_then(|x| x.as_i64()).unwrap_or(0);
                let project_old = t.get("project_id").and_then(|x| x.as_i64());
                let project_new = project_old.and_then(|pid| project_map.get(&pid)).copied();
                let title = t.get("title").and_then(|x| x.as_str()).unwrap_or("").to_string();
                if title.trim().is_empty() {
                    continue;
                }
                let description = t.get("description").and_then(|x| x.as_str()).unwrap_or("").to_string();
                let status = t.get("status").and_then(|x| x.as_str()).unwrap_or("demande").to_string();
                let deadline = t.get("deadline").and_then(|x| x.as_str()).map(String::from);
                let blocker_reason = t.get("blocker_reason").and_then(|x| x.as_str()).map(String::from);
                let created = t.get("created_at").and_then(|x| x.as_str()).unwrap_or("");
                let updated = t.get("updated_at").and_then(|x| x.as_str()).unwrap_or("");
                conn.execute(
                    "INSERT INTO tasks (project_id, title, description, status, deadline, blocker_reason, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    rusqlite::params![project_new, title, description, status, deadline, blocker_reason, created, updated],
                )
                .map_err(|e| format!("Erreur insertion tâche « {} » : {}", title, e))?;
                task_map.insert(old, conn.last_insert_rowid());
            }
            // Second passage : source_task_id (handoff) réécrit après toutes les
            // insertions (référence vers une tâche potentiellement plus tardive).
            for t in tasks {
                let old = t.get("id").and_then(|x| x.as_i64());
                let src_old = t.get("source_task_id").and_then(|x| x.as_i64());
                if let (Some(o), Some(so)) = (old, src_old) {
                    if let (Some(&new_id), Some(&src_new)) = (task_map.get(&o), task_map.get(&so)) {
                        conn.execute(
                            "UPDATE tasks SET source_task_id = ?1 WHERE id = ?2",
                            rusqlite::params![src_new, new_id],
                        )
                        .map_err(|e| format!("Erreur réécriture source_task_id : {}", e))?;
                    }
                }
            }
        }

        if let Some(decisions) = data.get("decisions").and_then(|x| x.as_array()) {
            for d in decisions {
                let project_old = d.get("project_id").and_then(|x| x.as_i64());
                let project_new = project_old.and_then(|p| project_map.get(&p)).copied();
                let task_old = d.get("task_id").and_then(|x| x.as_i64());
                let task_new = task_old.and_then(|t| task_map.get(&t)).copied();
                let summary = d.get("summary").and_then(|x| x.as_str()).unwrap_or("").to_string();
                if summary.trim().is_empty() {
                    continue;
                }
                let source_session = d.get("source_session").and_then(|x| x.as_str()).unwrap_or("").to_string();
                let created = d.get("created_at").and_then(|x| x.as_str()).unwrap_or("");
                conn.execute(
                    "INSERT INTO decisions (project_id, task_id, summary, source_session, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                    rusqlite::params![project_new, task_new, summary, source_session, created],
                )
                .map_err(|e| format!("Erreur insertion décision : {}", e))?;
            }
        }

        if let Some(milestones) = data.get("milestones").and_then(|x| x.as_array()) {
            for m in milestones {
                let project_old = m.get("project_id").and_then(|x| x.as_i64());
                let project_new = project_old.and_then(|p| project_map.get(&p)).copied();
                let title = m.get("title").and_then(|x| x.as_str()).unwrap_or("").to_string();
                if title.trim().is_empty() {
                    continue;
                }
                let due_date = m.get("due_date").and_then(|x| x.as_str()).map(String::from);
                let status = m.get("status").and_then(|x| x.as_str()).unwrap_or("planifie").to_string();
                let created = m.get("created_at").and_then(|x| x.as_str()).unwrap_or("");
                let updated = m.get("updated_at").and_then(|x| x.as_str()).unwrap_or("");
                conn.execute(
                    "INSERT INTO milestones (project_id, title, due_date, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    rusqlite::params![project_new, title, due_date, status, created, updated],
                )
                .map_err(|e| format!("Erreur insertion jalon « {} » : {}", title, e))?;
            }
        }

        if let Some(sums) = data.get("session_summaries").and_then(|x| x.as_array()) {
            for s in sums {
                let project_old = s.get("project_id").and_then(|x| x.as_i64());
                let project_new = project_old.and_then(|p| project_map.get(&p)).copied();
                let summary = s.get("summary").and_then(|x| x.as_str()).unwrap_or("").to_string();
                if summary.trim().is_empty() {
                    continue;
                }
                let session_id = s.get("session_id").and_then(|x| x.as_str()).unwrap_or("").to_string();
                let delivered = s.get("delivered").and_then(|x| x.as_i64()).unwrap_or(0);
                let created = s.get("created_at").and_then(|x| x.as_str()).unwrap_or("");
                conn.execute(
                    "INSERT INTO session_summaries (project_id, session_id, summary, delivered, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                    rusqlite::params![project_new, session_id, summary, delivered, created],
                )
                .map_err(|e| format!("Erreur insertion résumé de session : {}", e))?;
            }
        }

        // Logs d'injection : les ids projets sont réécrits comme les autres
        // entrées (project_id → nouvel id).
        if let Some(logs) = data.get("injection_logs").and_then(|x| x.as_array()) {
            for l in logs {
                let project_old = l.get("project_id").and_then(|x| x.as_i64());
                let project_new = project_old.and_then(|p| project_map.get(&p)).copied();
                let status = l.get("status").and_then(|x| x.as_str()).unwrap_or("").to_string();
                let ok = l.get("ok").and_then(|x| x.as_i64()).unwrap_or(0);
                let detail = l.get("detail").and_then(|x| x.as_str()).unwrap_or("").to_string();
                let created = l.get("created_at").and_then(|x| x.as_str()).unwrap_or("");
                conn.execute(
                    "INSERT INTO injection_logs (project_id, status, ok, detail, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                    rusqlite::params![project_new, status, ok, detail, created],
                )
                .map_err(|e| format!("Erreur insertion log injection : {}", e))?;
            }
        }

        conn.execute_batch("COMMIT")
            .map_err(|e| format!("Erreur commit : {}", e))?;
        Ok(vec![
            "clients".to_string(),
            "projects".to_string(),
            "tasks".to_string(),
            "decisions".to_string(),
            "milestones".to_string(),
            "session_summaries".to_string(),
            "injection_logs".to_string(),
        ])
    })();

    if result.is_err() {
        let _ = conn.execute_batch("ROLLBACK");
    }
    result
}

/// Exporte la mémoire de l'assistant. `include` = { tracking, settings, behavior,
/// ui } (booléens). Retourne la chaîne JSON unifiée. Aucune donnée personnelle
/// (coffre vault, conversations privées) n'est incluse.
#[tauri::command]
pub fn export_super_agent_memory(
    state: State<AppState>,
    app: AppHandle,
    include: Value,
) -> Result<String, String> {
    let want = |k: &str| include.get(k).and_then(|x| x.as_bool()).unwrap_or(false);
    let mut sections = serde_json::Map::new();
    if want("tracking") {
        let conn = open_db(&app)?;
        sections.insert("tracking".to_string(), serialize_tracking(&conn)?);
    }
    {
        let cfg = state.config.lock().unwrap();
        if want("settings") {
            sections.insert(
                "settings".to_string(),
                serde_json::json!({
                    "name": cfg.super_agent_name,
                    "clients": cfg.super_agent_clients,
                    "project_client": cfg.super_agent_project_client,
                }),
            );
        }
        if want("behavior") {
            sections.insert(
                "behavior".to_string(),
                serde_json::json!({
                    "prompt": cfg.super_agent_prompt,
                    "user_memory": cfg.super_agent_user_memory,
                    "personality": cfg.super_agent_personality,
                    "concise": cfg.super_agent_concise,
                    "user_friendly": cfg.super_agent_user_friendly,
                    "quality_gate": cfg.super_agent_quality_gate,
                }),
            );
        }
        if want("ui") {
            sections.insert(
                "appearance".to_string(),
                serde_json::json!({
                    "theme": cfg.theme,
                    "subtheme": cfg.subtheme,
                }),
            );
        }
    }
    let exported_at = chrono::Utc::now().to_rfc3339();
    let out = serde_json::json!({
        "format": MEMORY_FORMAT,
        "version": MEMORY_VERSION,
        "exported_at": exported_at,
        "sections": sections,
    });
    serde_json::to_string_pretty(&out).map_err(|e| format!("Erreur sérialisation : {}", e))
}

/// Importe la mémoire de l'assistant depuis un fichier JSON unifié. Valide le
/// format + version, puis REMPLACE (selon `sections` cochées) le suivi en base
/// (transaction) et/ou la config (settings / behavior / appearance persistées).
/// Retourne `{ ok, imported: [sections importées] }`.
#[tauri::command]
pub fn import_super_agent_memory(
    state: State<AppState>,
    app: AppHandle,
    json: String,
    sections: Value,
) -> Result<Value, String> {
    let v = validate_export_json(&json)?;
    let sections_obj = v
        .get("sections")
        .and_then(|s| s.as_object())
        .cloned()
        .unwrap_or_default();
    let want = |k: &str| sections.get(k).and_then(|x| x.as_bool()).unwrap_or(false);

    let mut imported: Vec<String> = Vec::new();

    if want("tracking") {
        if let Some(tr) = sections_obj.get("tracking") {
            let conn = open_db(&app)?;
            replace_tracking(&conn, tr)?;
            imported.push("tracking".to_string());
        }
    }

    let mut config_changed = false;
    {
        let mut cfg = state.config.lock().unwrap();
        if want("settings") {
            if let Some(s) = sections_obj.get("settings") {
                if let Some(n) = s.get("name").and_then(|x| x.as_str()) {
                    cfg.super_agent_name = n.to_string();
                }
                if let Some(c) = s.get("clients").and_then(|x| x.as_array()) {
                    cfg.super_agent_clients =
                        c.iter().filter_map(|x| x.as_str().map(String::from)).collect();
                }
                if let Some(pc) = s.get("project_client").and_then(|x| x.as_object()) {
                    let mut m = HashMap::new();
                    for (k, val) in pc {
                        if let Some(pr) = val.as_str() {
                            m.insert(k.clone(), pr.to_string());
                        }
                    }
                    cfg.super_agent_project_client = m;
                }
                imported.push("settings".to_string());
                config_changed = true;
            }
        }
        if want("behavior") {
            if let Some(s) = sections_obj.get("behavior") {
                if let Some(p) = s.get("prompt").and_then(|x| x.as_str()) {
                    cfg.super_agent_prompt = p.to_string();
                }
                if let Some(m) = s.get("user_memory").and_then(|x| x.as_str()) {
                    cfg.super_agent_user_memory = m.to_string();
                }
                if let Some(p) = s.get("personality").and_then(|x| x.as_str()) {
                    cfg.super_agent_personality = p.to_string();
                }
                if let Some(c) = s.get("concise").and_then(|x| x.as_bool()) {
                    cfg.super_agent_concise = c;
                }
                if let Some(u) = s.get("user_friendly").and_then(|x| x.as_bool()) {
                    cfg.super_agent_user_friendly = u;
                }
                if let Some(q) = s.get("quality_gate").and_then(|x| x.as_bool()) {
                    cfg.super_agent_quality_gate = q;
                }
                imported.push("behavior".to_string());
                config_changed = true;
            }
        }
        if want("ui") {
            if let Some(s) = sections_obj.get("appearance") {
                if let Some(t) = s.get("theme").and_then(|x| x.as_str()) {
                    cfg.theme = t.to_string();
                }
                if let Some(st) = s.get("subtheme").and_then(|x| x.as_str()) {
                    cfg.subtheme = st.to_string();
                }
                imported.push("appearance".to_string());
                config_changed = true;
            }
        }
        if config_changed {
            crate::save_config_disk(&app, &cfg)?;
        }
    }

    Ok(serde_json::json!({ "ok": true, "imported": imported }))
}

#[cfg(test)]
mod tests {
    use super::{
        build_project_context, init_db, replace_tracking, schedule_delete, schedule_due_and_mark,
        schedule_insert, schedule_list, schedule_set_enabled, serialize_tracking,
        validate_export_json, MEMORY_FORMAT, MEMORY_VERSION,
    };
    use rusqlite::Connection;

    fn mem_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();
        conn
    }

    #[test]
    fn memory_validate_accepts_valid_export() {
        let json = format!(
            r#"{{"format": "{}", "version": {}, "exported_at": "2025-01-01", "sections": {{"tracking": {{}} }}}}"#,
            MEMORY_FORMAT, MEMORY_VERSION
        );
        let v = validate_export_json(&json).unwrap();
        assert_eq!(v["format"], MEMORY_FORMAT);
        assert!(v["sections"].is_object());
    }

    #[test]
    fn memory_validate_rejects_wrong_format_or_version() {
        let bad_format = format!(
            r#"{{"format": "autre", "version": {}, "sections": {{}}}}"#,
            MEMORY_VERSION
        );
        assert!(validate_export_json(&bad_format).unwrap_err().contains("format"));
        let bad_version =
            format!(r#"{{"format": "{}", "version": 99, "sections": {{}}}}"#, MEMORY_FORMAT);
        assert!(validate_export_json(&bad_version).unwrap_err().contains("Version"));
        assert!(validate_export_json("pas du json").is_err());
        // sections non-objet refusé.
        let bad_sections = format!(
            r#"{{"format": "{}", "version": {}, "sections": []}}"#,
            MEMORY_FORMAT, MEMORY_VERSION
        );
        assert!(validate_export_json(&bad_sections).is_err());
    }

    #[test]
    fn memory_serialize_and_replace_roundtrip() {
        let conn = mem_conn();
        // Activer les FK pour vérifier l'intégrité pendant le replace.
        conn.execute_batch("PRAGMA foreign_keys = ON").unwrap();
        // Peupler : client → projet → tâche (+ handoff) + décision + jalon + résumé.
        conn.execute_batch(
            "INSERT INTO clients (name) VALUES ('Client A');\
             INSERT INTO projects (path, name, client_id) VALUES ('/p/a', 'A', 1);\
             INSERT INTO tasks (project_id, title) VALUES (1, 'Tâche 1');\
             INSERT INTO tasks (project_id, title, source_task_id) VALUES (1, 'Tâche 2', 1);\
             INSERT INTO decisions (project_id, task_id, summary) VALUES (1, 1, 'Décision 1');\
             INSERT INTO milestones (project_id, title) VALUES (1, 'Jalon 1');\
             INSERT INTO session_summaries (project_id, summary, delivered) VALUES (1, 'Résumé 1', 1);\
             INSERT INTO injection_logs (project_id, status, ok, detail) VALUES (1, 'delivered', 1, 'rejoué');",
        )
        .unwrap();

        let data = serialize_tracking(&conn).unwrap();
        assert_eq!(data["clients"].as_array().unwrap().len(), 1);
        assert_eq!(data["projects"].as_array().unwrap().len(), 1);
        assert_eq!(data["tasks"].as_array().unwrap().len(), 2);
        assert_eq!(data["decisions"].as_array().unwrap().len(), 1);
        assert_eq!(data["milestones"].as_array().unwrap().len(), 1);
        assert_eq!(data["session_summaries"].as_array().unwrap().len(), 1);
        assert_eq!(data["injection_logs"].as_array().unwrap().len(), 1);
        assert_eq!(data["injection_logs"].as_array().unwrap().len(), 1);

        // Replace (idempotence : ré-appliquer ne change pas les compteurs ni le
        // contenu, seuls les ids auto-incrémentés changent).
        let imported = replace_tracking(&conn, &data).unwrap();
        assert!(imported.contains(&"tasks".to_string()));
        let data2 = serialize_tracking(&conn).unwrap();
        // Contenu équivalent (mêmes noms/paths/titres), ids réécrits acceptés.
        assert_eq!(data["clients"][0]["name"], data2["clients"][0]["name"]);
        assert_eq!(data["projects"][0]["path"], data2["projects"][0]["path"]);
        assert_eq!(data["tasks"][0]["title"], data2["tasks"][0]["title"]);
        assert_eq!(data["tasks"][1]["title"], data2["tasks"][1]["title"]);
        assert_eq!(data["decisions"][0]["summary"], data2["decisions"][0]["summary"]);
        assert_eq!(data["milestones"][0]["title"], data2["milestones"][0]["title"]);
        assert_eq!(
            data["session_summaries"][0]["summary"],
            data2["session_summaries"][0]["summary"]
        );
        // T1 : la colonne `delivered` survit au round-trip export/import.
        assert_eq!(
            data["session_summaries"][0]["delivered"],
            data2["session_summaries"][0]["delivered"]
        );
        assert_eq!(
            data["injection_logs"][0]["status"],
            data2["injection_logs"][0]["status"]
        );
        // T1 : la colonne `delivered` survit au round-trip export/import.
        assert_eq!(
            data["session_summaries"][0]["delivered"],
            data2["session_summaries"][0]["delivered"]
        );
        assert_eq!(
            data["injection_logs"][0]["status"],
            data2["injection_logs"][0]["status"]
        );
        // La relation parent→enfant est réécrite : le projet pointe vers le
        // client ré-inséré (nouvel id).
        let new_client_id = data2["clients"][0]["id"].as_i64().unwrap();
        assert_eq!(data2["projects"][0]["client_id"].as_i64().unwrap(), new_client_id);

        // Idempotence : un second replace produit le même état.
        replace_tracking(&conn, &data2).unwrap();
        let data3 = serialize_tracking(&conn).unwrap();
        assert_eq!(data3["tasks"].as_array().unwrap().len(), 2);
        assert_eq!(data3["decisions"].as_array().unwrap().len(), 1);

        // Intégrité FK : les projets référencent un client existant et les
        // tâches/décisions/jalons/résumés un projet existant.
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM projects p JOIN clients c ON c.id = p.client_id",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        let task_join: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tasks t JOIN projects p ON p.id = t.project_id",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(task_join, 2);
        // source_task_id réécrit et pointe vers une tâche existante.
        let src_ok: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tasks t JOIN tasks s ON s.id = t.source_task_id WHERE t.title = 'Tâche 2'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(src_ok, 1);
    }

    #[test]
    fn memory_replace_rolls_back_on_failure() {
        let conn = mem_conn();
        conn.execute_batch("INSERT INTO clients (name) VALUES ('Gardé')").unwrap();
        // Données invalides : tâche référençant un projet inexistant, avec FK ON
        // → tasks.project_id est NOT NULL et le mapping produit NULL → l'insertion
        // échoue et la transaction doit être annulée (rollback).
        let bad = serde_json::json!({
            "clients": [],
            "projects": [],
            "tasks": [{ "id": 1, "project_id": 99, "title": "X", "description": "", "status": "demande", "deadline": null, "blocker_reason": null, "source_task_id": null, "created_at": "", "updated_at": "" }]
        });
        assert!(replace_tracking(&conn, &bad).is_err());
        // Rollback : le contenu initial est conservé.
        let names: i64 = conn
            .query_row("SELECT COUNT(*) FROM clients", [], |r| r.get(0))
            .unwrap();
        assert_eq!(names, 1);
    }

    #[test]
    fn schedule_rejects_every_below_60() {
        let conn = mem_conn();
        let err = schedule_insert(&conn, "trop rapide", "prompt", 59).unwrap_err();
        assert!(err.contains(">= 60"));
        // 60 est accepté.
        assert!(schedule_insert(&conn, "ok", "prompt", 60).is_ok());
    }

    #[test]
    fn schedule_rejects_empty_name_or_prompt_and_duplicate_name() {
        let conn = mem_conn();
        assert!(schedule_insert(&conn, "  ", "prompt", 120).is_err());
        assert!(schedule_insert(&conn, "nom", "  ", 120).is_err());
        assert!(schedule_insert(&conn, "même nom", "a", 120).is_ok());
        assert!(schedule_insert(&conn, "même nom", "b", 120).is_err());
    }

    #[test]
    fn schedule_caps_at_20() {
        let conn = mem_conn();
        for i in 0..20 {
            schedule_insert(&conn, &format!("s{}", i), "prompt", 120).unwrap();
        }
        assert!(schedule_insert(&conn, "s21", "prompt", 120).is_err());
    }

    #[test]
    fn schedule_due_marks_and_returns_at_most_once_per_tick() {
        let conn = mem_conn();
        schedule_insert(&conn, "s1", "prompt", 60).unwrap();
        // Premier tick : jamais exécutée → due.
        let due = schedule_due_and_mark(&conn, "2025-01-01 00:00:00").unwrap();
        assert_eq!(due.len(), 1);
        // Second tick immédiat : marquée → plus due.
        let due2 = schedule_due_and_mark(&conn, "2025-01-01 00:00:00").unwrap();
        assert!(due2.is_empty());
        // Avance de 61 s → due à nouveau.
        let due3 = schedule_due_and_mark(&conn, "2025-01-01 00:01:01").unwrap();
        assert_eq!(due3.len(), 1);
        // Marquer avec une date dans le futur ne renvoie rien non plus.
        assert!(schedule_due_and_mark(&conn, "2025-01-01 00:00:30").unwrap().is_empty());
    }

    #[test]
    fn schedule_delete_and_list() {
        let conn = mem_conn();
        let id = schedule_insert(&conn, "s1", "prompt", 120).unwrap();
        assert_eq!(schedule_list(&conn).unwrap().len(), 1);
        assert!(schedule_delete(&conn, id).unwrap());
        assert!(!schedule_delete(&conn, id).unwrap());
        assert!(schedule_list(&conn).unwrap().is_empty());
    }

    #[test]
    fn schedule_set_enabled_toggles_and_ignores_unknown_id() {
        let conn = mem_conn();
        let id = schedule_insert(&conn, "s1", "prompt", 120).unwrap();
        // Désactivation : le rappel n'est plus dû (enabled = 0).
        assert!(schedule_set_enabled(&conn, id, false).unwrap());
        assert!(schedule_due_and_mark(&conn, "2025-01-01 00:00:00").unwrap().is_empty());
        // Réactivation : le rappel redevient dû.
        assert!(schedule_set_enabled(&conn, id, true).unwrap());
        assert_eq!(schedule_due_and_mark(&conn, "2025-01-01 00:00:00").unwrap().len(), 1);
        // Id inexistant : retourne false, pas d'erreur.
        assert!(!schedule_set_enabled(&conn, 9999, false).unwrap());
    }

    #[test]
    fn schedule_max_counts_only_enabled() {
        let conn = mem_conn();
        // Remplit la limite avec des rappels actifs.
        for i in 0..20 {
            schedule_insert(&conn, &format!("s{}", i), "prompt", 120).unwrap();
        }
        assert!(schedule_insert(&conn, "s21", "prompt", 120).is_err());
        // Désactiver un rappel libère une place : on peut en créer un nouveau.
        let first = schedule_list(&conn).unwrap();
        let first_id = first[0]["id"].as_i64().unwrap();
        assert!(schedule_set_enabled(&conn, first_id, false).unwrap());
        assert!(schedule_insert(&conn, "s21", "prompt", 120).is_ok());
    }

    #[test]
    fn active_project_is_always_the_default_target() {
        let ctx = build_project_context(Some("/proj/actif"), Some("/proj/ancien"));
        // Le projet actif est annoncé comme « projet courant de la conversation ».
        assert!(ctx.contains("Projet actuellement actif dans Pilot : « /proj/actif »."));
        // L'ancien projet de travail est explicitement rétrogradé.
        assert!(ctx.contains("Ancien projet de travail (ne le considère PLUS comme actif) : « /proj/ancien »."));
        // La règle insiste sur la primauté du projet actif.
        assert!(ctx.contains("considère TOUJOURS le projet actif comme le projet par défaut"));
        // L'index de l'ancien projet (source du bug #40) n'apparaît PAS comme actif.
        assert!(!ctx.contains("Projet actuellement actif dans Pilot : « /proj/ancien »."));
    }

    #[test]
    fn no_working_when_same_as_active() {
        // Si l'ancien projet == projet actif, on ne parle pas d'un « ancien projet ».
        let ctx = build_project_context(Some("/proj"), Some("/proj"));
        assert!(ctx.contains("Projet actuellement actif"));
        assert!(!ctx.contains("Ancien projet de travail"));
    }

    #[test]
    fn working_only_when_no_active() {
        let ctx = build_project_context(None, Some("/proj"));
        assert!(ctx.contains("Projet sur lequel tu travaillais : « /proj »."));
        assert!(!ctx.contains("Projet actuellement actif"));
    }

    #[test]
    fn empty_when_no_project() {
        assert_eq!(build_project_context(None, None), "");
    }
}
