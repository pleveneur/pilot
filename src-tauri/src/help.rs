// help.rs — Réponse sur la documentation de Pilot (spec_help.md).
//
// On répond à une question sur l'utilisation/paramétrage de Pilot en se basant
// sur le **handbook** (doc condensée embarquée). Deux usages :
//   - le socle structuré (`answer_from_handbook` → `ask_help_doc`), appelé par
//     l'outil `answer_from_documentation` de l'Assistant — c'est le point
//     d'entrée depuis le retrait de l'écran « ❓ Aide » ;
//   - l'emballage historique (`ask_help`, avec historique), conservé mais sans
//     appelant côté écran.
//
// Option A (pi cadré) — Niveau 1 : on lance un **processus pi temporaire**
// `pi --mode rpc --no-session`, on lui envoie un prompt fortement cadré
// (handbook + consigne « pas d'outils, pas de fichiers » + historique d'aide +
// question), on collecte la réponse, puis on tue le process. La session de
// coding principale (AgentService) n'est **jamais touchée** →
// aucune pollution, aucune modif de `rpc_manager.rs`.
//
// IMPORTANT — synchronisation des commandes : pi traite les commandes RPC de
// façon asynchrone/désordonnée (l'accusé `new_session` peut arriver APRÈS
// celui de `prompt`). Si on envoie new_session + set_model + prompt d'affilée
// sans attendre les accusés, `new_session` traité en dernier réinitialise la
// session et le prompt est perdu → aucune réponse streamée. On attend donc
// l'accusé `{"type":"response","command":<cmd>}` de chaque commande avant
// d'envoyer la suivante (pattern éprouvé par test direct).

use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{Manager, State};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Handbook embarqué à la compilation (généré par `scripts/build-handbook.js`
/// depuis les blocs `<!-- HELP:* -->` de `help/overview.md` + des `spec_*.md`).
/// Toujours synchro avec la version installée.
pub const HANDBOOK: &str = include_str!("../../help/handbook.md");

/// Un tour de la conversation d'aide (côté frontend). L'historique est géré par
/// `help.js` et réinjecté à chaque question (le process pi est `--no-session`,
/// sans mémoire entre les tours).
#[derive(Deserialize, Clone)]
pub struct HelpTurn {
    pub role: String, // "user" | "assistant"
    pub content: String,
}

/// Retourne le contenu du handbook (pour affichage éventuel / debug côté UI).
#[tauri::command]
pub fn get_handbook() -> String {
    HANDBOOK.to_string()
}

// ── Documentation de Pilot LISIBLE sur disque (spec_help.md §4.6) ──
//
// L'Assistant répond aux questions de mode d'emploi : il lui faut la
// documentation dans des fichiers qu'il peut OUVRIR, pas seulement embarquée
// dans le binaire. Le contenu n'est ni réécrit ni dupliqué : on découpe le
// handbook déjà compilé (`HANDBOOK`, généré par `scripts/build-handbook.js`)
// sur les marqueurs de thème qu'il porte, et on écrit un fichier par thème au
// démarrage, dans `<app_data_dir>/aide/`. **Un seul contenu, une seule
// source** de production (le handbook).

/// Nom du dossier de la documentation lisible, sous le dossier de données.
pub const DOC_DIR_NAME: &str = "aide";

/// Nom du fichier d'index de la documentation lisible.
pub const DOC_INDEX_FILE: &str = "index.md";

/// Marqueur de frontière de thème dans le handbook généré.
pub const TOPIC_MARKER_PREFIX: &str = "<!-- HELP-TOPIC:";

/// Fin d'un marqueur de thème (`-->`).
const TOPIC_MARKER_SUFFIX: &str = "-->";

/// Découpe un handbook en **thèmes** `(slug, contenu)`, dans l'ordre du
/// fichier. Un thème commence à un marqueur `<!-- HELP-TOPIC:<slug> -->` ; le
/// contenu qui précède le premier marqueur (en-tête généré) est ignoré.
/// **Fonction pure** : testable sur n'importe quel handbook.
pub fn handbook_topics(handbook: &str) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    let mut current: Option<(String, Vec<&str>)> = None;
    for line in handbook.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix(TOPIC_MARKER_PREFIX) {
            if let Some(slug) = rest.strip_suffix(TOPIC_MARKER_SUFFIX) {
                if let Some((prev, lines)) = current.take() {
                    push_topic(&mut out, &prev, &lines);
                }
                current = Some((slug.trim().to_string(), Vec::new()));
                continue;
            }
        }
        if let Some((_, lines)) = current.as_mut() {
            lines.push(line);
        }
    }
    if let Some((slug, lines)) = current.take() {
        push_topic(&mut out, &slug, &lines);
    }
    out
}

/// Range un thème terminé : contenu vide ou slug vide → rien (jamais un
/// fichier fantôme dans le dossier de documentation).
fn push_topic(out: &mut Vec<(String, String)>, slug: &str, lines: &[&str]) {
    if slug.trim().is_empty() {
        return;
    }
    let body = lines.join("\n");
    let body = body.trim();
    if body.is_empty() {
        return;
    }
    out.push((slug.trim().to_string(), format!("{}\n", body)));
}

/// Nom de fichier d'un thème : `<slug>.md`, slug réduit aux caractères sûrs
/// (aucun séparateur de chemin ne peut venir d'un handbook). Repli
/// `theme.md` si le slug ne contient aucun caractère exploitable.
pub fn doc_file_name(topic: &str) -> String {
    let mut slug = String::new();
    for c in topic.chars() {
        if c.is_ascii_alphanumeric() {
            slug.push(c.to_ascii_lowercase());
        } else if !slug.ends_with('-') {
            slug.push('-');
        }
    }
    let slug = slug.trim_matches('-');
    if slug.is_empty() {
        "theme.md".to_string()
    } else {
        format!("{}.md", slug)
    }
}

/// Titre lisible d'un thème : son premier titre Markdown, sinon le slug.
/// Sert uniquement à l'index (le contenu écrit, lui, n'est pas réécrit).
fn doc_title(topic: &str, body: &str) -> String {
    for line in body.lines() {
        let t = line.trim_start();
        let rest = t
            .strip_prefix("### ")
            .or_else(|| t.strip_prefix("## "))
            .or_else(|| t.strip_prefix("# "));
        if let Some(r) = rest {
            let r = r.trim();
            if !r.is_empty() {
                return r.to_string();
            }
        }
    }
    topic.to_string()
}

/// Fichiers de la documentation lisible : l'index **puis** un fichier par
/// thème. Le contenu de chaque thème est le bloc du handbook **tel quel**
/// (aucune réécriture de fond). Deux blocs qui déclarent le **même** thème sont
/// fusionnés dans le fichier de ce thème (un seul fichier par thème, dans
/// l'ordre du handbook).
pub fn doc_files_of(handbook: &str) -> Vec<(String, String)> {
    let topics = handbook_topics(handbook);
    let mut index = String::new();
    index.push_str("# Documentation de Pilot (aide)\n\n");
    index.push_str(
        "Documentation de l'éditeur Pilot, un fichier par thème (même dossier que cet \
         index).\n\n",
    );
    let mut files: Vec<(String, String)> = Vec::new();
    for (topic, body) in &topics {
        let name = doc_file_name(topic);
        let title = doc_title(topic, body);
        if let Some(existing) = files.iter_mut().find(|(n, _)| *n == name) {
            existing.1.push('\n');
            existing.1.push_str(body);
            continue;
        }
        index.push_str(&format!("- [{}]({})\n", title, name));
        files.push((name, body.clone()));
    }
    let mut out = vec![(DOC_INDEX_FILE.to_string(), index)];
    out.extend(files);
    out
}

/// Écrit la documentation lisible dans `dir` (créé au besoin). **Idempotent** :
/// un fichier dont le contenu est déjà exactement le bon n'est **pas** réécrit
/// (aucune écriture disque inutile, aucune date de modification qui bouge).
/// Retourne le nombre de fichiers réellement écrits (0 = tout était à jour).
pub fn write_doc_files(dir: &Path, handbook: &str) -> Result<usize, String> {
    let files = doc_files_of(handbook);
    if files.len() <= 1 {
        return Err(
            "Documentation vide : aucun thème trouvé dans le handbook (marqueurs HELP-TOPIC \
             absents ?)"
                .to_string(),
        );
    }
    std::fs::create_dir_all(dir)
        .map_err(|e| format!("Création du dossier de documentation impossible : {}", e))?;
    let mut written = 0usize;
    for (name, content) in files {
        let path = dir.join(&name);
        if std::fs::read_to_string(&path).ok().as_deref() == Some(content.as_str()) {
            continue;
        }
        std::fs::write(&path, &content)
            .map_err(|e| format!("Écriture de {} impossible : {}", path.display(), e))?;
        written += 1;
    }
    Ok(written)
}

/// Dossier de la documentation lisible sous un dossier de données donné.
pub fn doc_dir_for(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(DOC_DIR_NAME)
}

/// Dossier de la documentation lisible (dossier de données de l'application).
/// Le chemin annoncé à l'Assistant est **exactement** celui utilisé pour
/// l'écriture (même fonction) : aucun risque d'annoncer un chemin faux.
pub fn doc_dir(app: &tauri::AppHandle) -> PathBuf {
    doc_dir_for(&app.path().app_data_dir().unwrap_or_default())
}

/// Écrit la documentation lisible **au démarrage** de Pilot (appelée depuis le
/// `setup` de `run()`). Fail-open : un échec d'écriture est signalé sans jamais
/// bloquer ni faire échouer le démarrage. Retourne le nombre de fichiers
/// écrits (0 = déjà à jour).
pub fn write_startup_docs(app: &tauri::AppHandle) -> usize {
    let dir = doc_dir(app);
    match write_doc_files(&dir, HANDBOOK) {
        Ok(n) => n,
        Err(e) => {
            eprintln!(
                "[aide] documentation lisible non écrite dans {} : {}",
                dir.display(),
                e
            );
            0
        }
    }
}

// ── Socle réutilisable : « répondre à partir de la documentation » ──
//
// Cette brique existait déjà, mêlée à l'écran « ❓ Aide » : corpus embarqué +
// construction du prompt + processus pi temporaire cadré. Elle est désormais
// **extraite** et rend un résultat **structuré**, pour être utilisable par
// d'autres appelants (l'Assistant notamment) sans rien réinventer. L'écran Aide
// reste un simple emballage (`ask_help`), son comportement ne change pas.

/// Plafond de sortie d'une réponse rendue par la brique documentaire.
pub const MAX_ANSWER_CHARS: usize = 6000;

/// Radical du marqueur que le modèle doit placer en TÊTE de réponse quand la
/// documentation intégrée ne permet pas de répondre. Le côté programme retire
/// le marqueur et positionne le drapeau : c'est **déterministe**, donc testable
/// sans appeler de modèle.
pub const INSUFFICIENT_KEY: &str = "DOCUMENTATION_INSUFFISANTE";

/// Marqueur complet, tel qu'imposé dans le prompt (majuscules + deux-points).
pub const INSUFFICIENT_MARKER: &str = "DOCUMENTATION_INSUFFISANTE:";

/// Résultat structuré de la brique documentaire (indépendant de tout écran).
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct HandbookAnswer {
    /// Texte de la réponse : marqueur retiré, coupure éventuelle **dite** dedans.
    pub answer: String,
    /// Titres de la documentation réellement cités dans le texte rendu.
    /// Calculés **par le programme** (jamais déclarés par le modèle) et
    /// recoupés avec les titres qui existent vraiment dans le corpus.
    pub cited_sections: Vec<String>,
    /// Vrai si le modèle a signalé que la documentation ne dit rien.
    pub insufficient: bool,
    /// Vrai si la réponse a été coupée au plafond de sortie.
    pub truncated: bool,
}

/// Variante **pure** de `handbook_sections` (testable sur un corpus arbitraire).
/// `handbook_sections_of(HANDBOOK)` = les titres réellement présents dans la
/// documentation embarquée.
pub fn handbook_sections_of(corpus: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut in_fence = false;
    for line in corpus.lines() {
        let trimmed_start = line.trim_start();
        if trimmed_start.starts_with("```") || trimmed_start.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        let rest = match line.strip_prefix("### ") {
            Some(r) => r,
            None => match line.strip_prefix("## ") {
                Some(r) => r,
                None => continue,
            },
        };
        let title = rest.trim();
        if !title.is_empty() && !out.iter().any(|s| s == title) {
            out.push(title.to_string());
        }
    }
    out
}

/// Normalise un texte pour comparer des titres : minuscules + espaces réduits.
fn normalize_for_match(s: &str) -> String {
    s.to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Sections de la documentation citées dans `answer` : recoupement fait **par
/// le programme** avec les titres réels du corpus embarqué (`HANDBOOK`).
///
/// Limite assumée : ce recoupement est **approximatif par construction** (on ne
/// reconnaît qu'une citation littérale du titre) — il ne doit jamais être
/// présenté comme une « source exacte ».
pub fn cited_sections_in_corpus(corpus: &str, answer: &str) -> Vec<String> {
    let haystack = normalize_for_match(answer);
    if haystack.is_empty() {
        return Vec::new();
    }
    handbook_sections_of(corpus)
        .into_iter()
        .filter(|title| haystack.contains(&normalize_for_match(title)))
        .collect()
}

/// Longueur (en octets) du marqueur d'insuffisance placé en TÊTE de `text`,
/// `0` s'il est absent. Tolère l'habillage Markdown courant (`**`, `>`, `#`,
/// `-`, backtick) et un espace avant le deux-points ; un marqueur au milieu du
/// texte n'est **pas** interprété (signal honnête, pas de détection opportuniste).
fn insufficient_marker_len(text: &str) -> usize {
    let mut start = 0usize;
    for (i, c) in text.char_indices() {
        if c.is_whitespace() || matches!(c, '*' | '_' | '#' | '>' | '-' | '`') {
            start = i + c.len_utf8();
        } else {
            break;
        }
    }
    let rest = &text[start..];
    if !rest.to_uppercase().starts_with(INSUFFICIENT_KEY) {
        return 0;
    }
    let mut i = INSUFFICIENT_KEY.len();
    while i < rest.len() && rest.as_bytes()[i].is_ascii_whitespace() {
        i += 1;
    }
    if rest.as_bytes().get(i) == Some(&b':') {
        start + i + 1
    } else {
        0
    }
}

/// Coupe `text` au plafond `MAX_ANSWER_CHARS`, **proprement** : sur une fin de
/// phrase si possible, sinon sur une fin de mot — jamais au milieu d'un mot.
/// Retourne `None` si le texte tient dans le plafond.
fn cut_at_cap(text: &str) -> Option<String> {
    if text.chars().count() <= MAX_ANSWER_CHARS {
        return None;
    }
    let head: String = text.chars().take(MAX_ANSWER_CHARS).collect();
    let min_keep = MAX_ANSWER_CHARS * 3 / 4;
    // 1. Dernière fin de phrase (ponctuation forte suivie d'un blanc) assez
    //    proche du plafond pour ne pas amputer la réponse inutilement.
    let mut sentence_cut: Option<String> = None;
    for (pos, (i, c)) in head.char_indices().enumerate() {
        if matches!(c, '.' | '!' | '?' | '…') {
            let after = head[i + c.len_utf8()..].chars().next();
            let boundary = after.map(|a| a.is_whitespace()).unwrap_or(true);
            if boundary && pos + 1 >= min_keep {
                sentence_cut = Some(head[..i + c.len_utf8()].trim_end().to_string());
            }
        }
    }
    if let Some(kept) = sentence_cut {
        return Some(kept);
    }
    // 2. Sinon, dernière fin de mot (dernier blanc du plafond).
    match head.rfind(|c: char| c.is_whitespace()) {
        Some(idx) if idx > 0 => Some(head[..idx].trim_end().to_string()),
        _ => Some(head.trim_end().to_string()),
    }
}

/// Mention explicite de coupure, ajoutée au texte rendu (la coupure est dite).
fn truncation_notice() -> String {
    format!(
        "_… Réponse tronquée à {} caractères : la documentation intégrée contient davantage de \
         contenu sur ce sujet. Demande une précision pour obtenir la suite._",
        MAX_ANSWER_CHARS
    )
}

/// Finition d'une réponse brute du modèle : drapeau d'insuffisance + marqueur
/// retiré, plafond appliqué avec coupure **dite**, sections citées recoupées
/// avec le corpus embarqué. **Fonction pure** : aucun appel de modèle.
pub fn finish_help_answer(raw: &str) -> HandbookAnswer {
    finish_help_answer_from_corpus(raw, HANDBOOK)
}

/// Variante **pure** de `finish_help_answer` (corpus arbitraire, testable).
pub fn finish_help_answer_from_corpus(raw: &str, corpus: &str) -> HandbookAnswer {
    let text = raw.trim();
    let marker_len = insufficient_marker_len(text);
    let mut answer = if marker_len > 0 {
        text[marker_len..].trim().to_string()
    } else {
        text.to_string()
    };
    let mut truncated = false;
    if let Some(kept) = cut_at_cap(&answer) {
        truncated = true;
        answer = format!("{}\n\n{}", kept, truncation_notice());
    }
    let cited_sections = cited_sections_in_corpus(corpus, &answer);
    HandbookAnswer {
        answer,
        cited_sections,
        insufficient: marker_len > 0,
        truncated,
    }
}

/// Résolution du **modèle** de la brique documentaire, par repli : modèle de
/// l'Assistant → réglage d'aide existant → défaut de la configuration.
///
/// Condition de survie : plus aucun écran n'écrit forcément le réglage d'aide,
/// donc la brique ne peut pas en dépendre seule. `Err` = message **explicite et
/// lisible**, jamais un échec silencieux.
///
/// `available` = spécifications installées ("provider/modelId") ; `None` = liste
/// illisible → aucune validation (fail-open, cf. `resolve_super_agent_model`).
pub(crate) fn resolve_help_doc_model(
    assistant_model: &str,
    help_model: &str,
    global: Option<(String, String)>,
    available: Option<&[String]>,
) -> Result<String, String> {
    crate::super_agent::resolve_super_agent_model(assistant_model, help_model, global, available)
        .map(|(provider, model_id)| format!("{}/{}", provider, model_id))
        .ok_or_else(|| {
            "Aucun modèle disponible pour répondre à partir de la documentation : choisis un \
             modèle dans ⚙️ → Assistant."
                .to_string()
        })
}

/// Lance la brique sur un prompt déjà construit et rend le résultat structuré.
fn run_help_prompt(
    cwd: &str,
    pi_path: &str,
    prompt: &str,
    model: &str,
) -> Result<HandbookAnswer, String> {
    let raw = ask_pi_caged(cwd, pi_path, prompt, Some(model))?;
    Ok(finish_help_answer(&raw))
}

/// **Cœur de la brique** : répond à `question` à partir de la documentation
/// embarquée. Une seule entrée (la question) : aucun chemin de projet, aucun
/// historique, aucun fichier.
pub fn answer_from_handbook(
    state: &crate::AppState,
    question: &str,
) -> Result<HandbookAnswer, String> {
    let question = question.trim();
    if question.is_empty() {
        return Err("Question vide : précise ce que tu veux savoir sur Pilot.".to_string());
    }

    let cfg = state.config_snapshot();
    let pi_path = cfg.rpc_pi_path.clone();
    let global = crate::super_agent::default_model_from_config(&pi_path);
    let available = crate::agents::available_model_specs(&pi_path).ok();
    let model = resolve_help_doc_model(
        &cfg.super_agent_model,
        &cfg.help_model,
        global,
        available.as_deref(),
    )?;

    let prompt = build_help_prompt(question, &[]);

    // Cwd neutre (dossier temporaire) : pi --no-session ne charge pas de session
    // projet, et un cwd vide évite tout scan de fichiers.
    let cwd = std::env::temp_dir().to_string_lossy().to_string();

    run_help_prompt(&cwd, &pi_path, &prompt, &model)
}

/// Commande **destinée à l'Assistant** : une seule entrée (la question), aucun
/// chemin de projet, aucun historique, aucun fichier. Rend le résultat
/// structuré (texte, sections citées, drapeaux).
#[tauri::command]
pub fn ask_help_doc(
    state: State<crate::AppState>,
    question: String,
) -> Result<HandbookAnswer, String> {
    answer_from_handbook(&state, &question)
}

/// Commande de l'écran « ❓ Aide » : **simple emballage** de la brique
/// (`run_help_prompt` + prompt avec historique). Comportement inchangé côté
/// interface : même modèle (`config.help_model`), même message d'erreur quand
/// aucun modèle n'est choisi, même retour texte.
#[tauri::command]
pub fn ask_help(
    state: State<crate::AppState>,
    question: String,
    history: Vec<HelpTurn>,
) -> Result<String, String> {
    let cfg = state.config.lock().unwrap();
    let pi_path = cfg.rpc_pi_path.clone();
    let help_model = cfg.help_model.clone();
    drop(cfg);

    if help_model.trim().is_empty() {
        return Err(
            "Aucun modèle configuré pour l'aide. Choisis un modèle dans ⚙️ → Assistant."
                .to_string(),
        );
    }

    let prompt = build_help_prompt(&question, &history);

    // Cwd neutre (dossier temporaire) pour isoler l'aide : pi --no-session ne
    // charge pas de session projet, et un cwd vide évite tout scan de fichiers.
    let cwd = std::env::temp_dir().to_string_lossy().to_string();

    run_help_prompt(&cwd, &pi_path, &prompt, &help_model).map(|r| r.answer)
}

/// Construit le prompt cadré envoyé à pi : consigne « assistant d'aide », le
/// handbook, l'historique d'aide (réinjecté) et la nouvelle question.
fn build_help_prompt(question: &str, history: &[HelpTurn]) -> String {
    let mut s = String::new();
    s.push_str(
        "MODE AIDE PILOT. Tu es l'assistant d'aide de l'éditeur Pilot.\n\
         Réponds UNIQUEMENT à partir du HANDBOOK ci-dessous. N'utilise AUCUN outil,\n\
         ne lis ni ne modifie aucun fichier, n'exécute aucune commande. Si la question\n\
         sort du cadre de Pilot, dis-le clairement et oriente l'utilisateur vers la\n\
         documentation. Réponds en français, de façon claire et concise, en Markdown.\n\
         Cite les titres de sections du HANDBOOK que tu utilises.\n\
         Si le HANDBOOK ne contient pas de quoi répondre, commence IMPÉRATIVEMENT\n\
         ta réponse par le marqueur DOCUMENTATION_INSUFFISANTE: seul en tête, puis\n\
         explique en une phrase ce qui manque. Ne mets ce marqueur dans AUCUN\n\
         autre cas.\n\n",
    );
    s.push_str("=== HANDBOOK ===\n");
    s.push_str(HANDBOOK);
    s.push_str("\n=== FIN HANDBOOK ===\n\n");

    // Historique d'aide (réinjecté car le process pi est sans mémoire).
    let non_empty: Vec<&HelpTurn> = history
        .iter()
        .filter(|t| !t.content.trim().is_empty())
        .collect();
    if !non_empty.is_empty() {
        s.push_str("[Historique de la conversation d'aide]\n");
        for turn in non_empty {
            let label = match turn.role.as_str() {
                "assistant" => "Assistant",
                _ => "Utilisateur",
            };
            s.push_str(&format!("{} : {}\n", label, turn.content.trim()));
        }
        s.push('\n');
    }

    s.push_str(&format!("Question : {}\n", question.trim()));
    s
}

// ── Helpers de lecture stdout (thread + canal avec timeout réel) ──

/// Lance un thread qui lit stdout de pi ligne par ligne et pousse chaque ligne
/// sur un canal mpsc. Permet d'utiliser `recv_timeout` pour un timeout réel
/// (un `BufReader::lines()` bloquant ne permettrait pas de timeout réactif).
/// Retourne le `Receiver`. Le thread se termine à la fermeture de stdout
/// (EOF) → le receiver obtiendra alors `Err(Disconnected)`.
fn spawn_stdout_reader(stdout: std::process::ChildStdout) -> mpsc::Receiver<String> {
    let (tx, rx) = mpsc::channel::<String>();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(l) => {
                    if tx.send(l).is_err() {
                        break; // le récepteur a été droppé (fin demandée)
                    }
                }
                Err(_) => break,
            }
        }
        // Fermeture naturelle : tx drop → rx.recv() renvoie Disconnected.
    });
    rx
}

/// Lit la prochaine ligne de pi avec un timeout. Retourne :
/// - `Ok(Some(line))` si une ligne est disponible
/// - `Ok(None)` si stdout est fermé (EOF, canal déconnecté)
/// - `Err("Timeout…")` si aucune ligne dans le délai imparti
fn next_line(rx: &mpsc::Receiver<String>, timeout: Duration) -> Result<Option<String>, String> {
    match rx.recv_timeout(timeout) {
        Ok(line) => Ok(Some(line)),
        Err(mpsc::RecvTimeoutError::Timeout) => Err("Timeout : pi n'a pas répondu dans le délai".to_string()),
        Err(mpsc::RecvTimeoutError::Disconnected) => Ok(None), // EOF stdout
    }
}

/// Extrait le message d'erreur d'un event `process_exit` / `extension_error`.
fn event_error_msg(event: &serde_json::Value) -> String {
    event
        .get("reason")
        .or_else(|| event.get("message"))
        .or_else(|| event.get("error"))
        .and_then(|v| v.as_str())
        .unwrap_or("Erreur lors de la réponse de l'aide")
        .to_string()
}

/// Attend l'accusé `{"type":"response","command":cmd}` de pi, vérifie `success`.
/// Ignore les events non pertinents (extension_ui_request, notifications…).
/// Détecte `process_exit` / `extension_error` (erreur immédiate).
fn wait_response(
    rx: &mpsc::Receiver<String>,
    cmd: &str,
    timeout: Duration,
) -> Result<bool, String> {
    let start = Instant::now();
    loop {
        // Timeout GLOBAL strict (pas seulement d'inactivité) : si pi streame en
        // continu (thinking_delta), recv_timeout(Duration::ZERO) renverrait
        // quand même les lignes en attente → boucle infinie sans cette garde.
        if start.elapsed() >= timeout {
            return Err(format!("Timeout : pi n'a pas accusé la commande {}", cmd));
        }
        let remaining = timeout.saturating_sub(start.elapsed());
        match next_line(rx, remaining)? {
            None => return Err(format!("pi a fermé stdout avant d'accuser {}", cmd)),
            Some(line) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let event = match serde_json::from_str::<serde_json::Value>(trimmed) {
                    Ok(e) => e,
                    Err(_) => continue,
                };
                let etype = event.get("type").and_then(|v| v.as_str()).unwrap_or("");
                if etype == "response"
                    && event.get("command").and_then(|v| v.as_str()) == Some(cmd)
                {
                    let ok = event.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
                    if !ok {
                        let err = event
                            .get("error")
                            .and_then(|v| v.as_str())
                            .unwrap_or("commande échouée")
                            .to_string();
                        return Err(format!("pi a refusé {} : {}", cmd, err));
                    }
                    return Ok(true);
                }
                if etype == "process_exit" || etype == "extension_error" {
                    return Err(event_error_msg(&event));
                }
                // Autres events (extension_ui_request, etc.) → ignorés.
            }
        }
    }
}

/// Collecte le stream de la réponse au prompt : accumule les `text_delta` des
/// events `message_update` jusqu'à `agent_end`. Ignore les `thinking_*`
/// (raisonnement interne) pour ne garder que le texte final affichable.
/// Détecte `process_exit` / `extension_error`.
fn collect_stream(rx: &mpsc::Receiver<String>, timeout: Duration) -> Result<String, String> {
    let start = Instant::now();
    let mut collected = String::new();
    loop {
        // Timeout GLOBAL strict (cf. wait_response) : sans cette garde, une
        // inférence qui streame en continu (thinking_delta) ne déclencherait
        // jamais le timeout car recv_timeout(Duration::ZERO) renvoie les lignes
        // en attente → boucle infinie.
        if start.elapsed() >= timeout {
            return Err("Timeout : la réponse de l'aide a pris plus de 2 minutes".to_string());
        }
        let remaining = timeout.saturating_sub(start.elapsed());
        match next_line(rx, remaining)? {
            None => {
                // EOF stdout sans agent_end.
                if collected.trim().is_empty() {
                    return Err("L'IA n'a retourné aucun texte (stream fermé prématurément)".to_string());
                }
                return Ok(collected.trim().to_string());
            }
            Some(line) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let event = match serde_json::from_str::<serde_json::Value>(trimmed) {
                    Ok(e) => e,
                    Err(_) => continue,
                };
                let etype = event.get("type").and_then(|v| v.as_str()).unwrap_or("");
                match etype {
                    "message_update" => {
                        if let Some(delta) = event.get("assistantMessageEvent") {
                            let dtype = delta.get("type").and_then(|v| v.as_str()).unwrap_or("");
                            if dtype == "text_delta" {
                                if let Some(t) = delta.get("delta").and_then(|v| v.as_str()) {
                                    collected.push_str(t);
                                }
                            }
                            // text_start / text_end / thinking_* : ignorés (le
                            // texte est déjà accumulé via text_delta).
                        }
                    }
                    "agent_end" => {
                        if collected.trim().is_empty() {
                            return Err("L'IA n'a retourné aucun texte".to_string());
                        }
                        return Ok(collected.trim().to_string());
                    }
                    "process_exit" | "extension_error" => {
                        return Err(event_error_msg(&event));
                    }
                    _ => {} // response(prompt), extension_ui_request, etc. → ignorés
                }
            }
        }
    }
}

/// Lance un processus pi temporaire `--mode rpc --no-session`, envoie les
/// commandes en séquence (new_session → set_model → prompt) en **attendant
/// l'accusé de chacune** avant la suivante, collecte la réponse streamée,
/// puis tue le process. Le modèle (format "provider/modelId") est obligatoire.
///
/// **Réutilisé** par l'emballage `ask_help` (historique, sans appelant côté
/// écran), l'onglet « 🔍 Review »
/// (`review::ask_review`) et la génération/mise à jour d'`AGENTS.md`
/// (`agents_md::generate_agents_md`) : tout usage d'un pi temporaire cadré (pas
/// de session persistante, pas de pollution de la session de coding principale)
/// passe par ici. Le `prompt` est entièrement à la charge de l'appelant
/// (consigne + contexte + question). `cwd` à la charge de l'appelant : un cwd
/// neutre (ex: temp_dir) isole pi du projet (aide/review) ; le cwd du projet lui
/// donne accès aux outils read/ls/write (génération AGENTS.md).
///
/// Timeout par défaut 120 s. Pour une tâche plus longue (analyse + écriture),
/// utiliser `ask_pi_caged_timed`.
pub fn ask_pi_caged(
    cwd: &str,
    pi_path: &str,
    prompt: &str,
    model: Option<&str>,
) -> Result<String, String> {
    ask_pi_caged_timed(cwd, pi_path, prompt, model, Duration::from_secs(120))
}

/// Variante paramétrable d'`ask_pi_caged` : permet de régler le timeout de
/// collecte du stream (utile pour les tâches d'agent qui utilisent des outils :
/// analyse de projet, écriture de fichier…). Mêmes séquence et garanties
/// qu'`ask_pi_caged`. Timeout global stricte sur l'ensemble de la collecte.
pub fn ask_pi_caged_timed(
    cwd: &str,
    pi_path: &str,
    prompt: &str,
    model: Option<&str>,
    timeout: Duration,
) -> Result<String, String> {
    let pi_exe = if pi_path.is_empty() { "pi" } else { pi_path };

    let mut cmd = Command::new(pi_exe);
    cmd.args(["--mode", "rpc", "--no-session"])
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Impossible de lancer pi pour l'aide : {}", e))?;

    let mut stdin = child.stdin.take().ok_or("Impossible d'accéder à stdin")?;
    let stdout = child.stdout.take().ok_or("Impossible d'accéder à stdout")?;
    let stderr_child = child.stderr.take().ok_or("Impossible d'accéder à stderr")?;

    // Thread de lecture stdout (timeout réel via recv_timeout).
    let rx = spawn_stdout_reader(stdout);

    // Thread de lecture stderr en arrière-plan (non-bloquant). Sur Windows,
    // pi.cmd → node survit à kill() : stderr resterait ouvert, et un
    // read_to_string bloquant penderait indéfiniment. On lit donc dans un thread.
    let stderr_buf = Arc::new(Mutex::new(String::new()));
    let stderr_buf_clone = stderr_buf.clone();
    thread::spawn(move || {
        let mut reader = BufReader::new(stderr_child);
        let mut s = String::new();
        let _ = reader.read_to_string(&mut s);
        *stderr_buf_clone.lock().unwrap() = s;
    });

    // Helper local d'envoi d'une commande JSON.
    let mut send = |cmd: &serde_json::Value| -> Result<(), String> {
        let line = serde_json::to_string(cmd).unwrap_or_default();
        writeln!(stdin, "{}", line).map_err(|e| format!("Erreur écriture stdin : {}", e))?;
        stdin.flush().map_err(|e| format!("Erreur flush : {}", e))?;
        Ok(())
    };

    // 1. new_session — attendre l'accusé avant de continuer.
    send(&serde_json::json!({"type":"new_session"}))
        .map_err(|e| format!("Erreur envoi new_session : {}", e))?;
    wait_response(&rx, "new_session", Duration::from_secs(30))
        .map_err(|e| format!("new_session : {}", e))?;

    // 2. set_model — obligatoire (pi --no-session n'a pas de modèle par défaut).
    if let Some(m) = model {
        let m = m.trim();
        if !m.is_empty() {
            let (provider, model_id) = match m.split_once('/') {
                Some((p, id)) => (p, id),
                None => (m, ""),
            };
            send(&serde_json::json!({
                "type": "set_model",
                "provider": provider,
                "modelId": model_id
            }))
            .map_err(|e| format!("Erreur envoi set_model : {}", e))?;
            wait_response(&rx, "set_model", Duration::from_secs(30)).map_err(|e| {
                format!(
                    "Modèle d'aide « {} » invalide : {} — choisis un autre modèle dans ⚙️ → Assistant",
                    m, e
                )
            })?;
        }
    }

    // 3. prompt — on garde stdin ouvert (ne pas drop) : pi a besoin du canal
    //    ouvert pendant le streaming de la réponse. On tue le process à la fin.
    send(&serde_json::json!({ "type": "prompt", "message": prompt }))
        .map_err(|e| format!("Erreur envoi prompt : {}", e))?;

    let result = collect_stream(&rx, timeout);

    // Nettoyage : tuer pi ferme stdout → le thread de lecture se termine.
    // try_wait (non-bloquant) : sur Windows, pi.cmd lance un enfant node qui
    // survit à kill() ; un wait() bloquant pourrait donc pendre. On ne bloque pas.
    let _ = child.kill();
    let exit_status = child.try_wait().ok().flatten();
    let err_out = stderr_buf.lock().unwrap().clone();

    match result {
        Ok(text) => Ok(text),
        Err(e) => {
            // Enrichir le message d'erreur avec le code de sortie + stderr pour
            // le diagnostic, sans fuir le handbook.
            let exit_dbg = match exit_status {
                Some(s) => format!("exit_code={}", s.code().unwrap_or(-1)),
                None => "exit indisponible".to_string(),
            };
            let stderr_dbg = if err_out.trim().is_empty() {
                String::new()
            } else {
                format!("\nstderr: {}", err_out.trim())
            };
            Err(format!("{} [{}{}]{}", e, exit_dbg, stderr_dbg, ""))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Socle documentaire : tests PURS, sans appel de modèle ──

    /// (a) Le marqueur d'insuffisance lève le drapeau ET disparaît du texte.
    /// Ce test échoue si on retire le traitement du marqueur.
    #[test]
    fn marqueur_dinsuffisance_leve_le_drapeau_et_quitte_le_texte() {
        let a = finish_help_answer(
            "DOCUMENTATION_INSUFFISANTE: la documentation ne couvre pas ce sujet.",
        );
        assert!(a.insufficient, "drapeau insuffisante attendu");
        assert!(!a.answer.contains(INSUFFICIENT_MARKER));
        assert!(!a.answer.contains(INSUFFICIENT_KEY));
        assert!(a.answer.starts_with("la documentation ne couvre pas"));

        // Habillage Markdown toléré (`**MARQUEUR :**`) → même verdict.
        let b = finish_help_answer("**DOCUMENTATION_INSUFFISANTE :** rien sur ce point.");
        assert!(b.insufficient);
        assert!(!b.answer.contains(INSUFFICIENT_KEY));

        // Réponse normale : aucun drapeau, texte intact.
        let c = finish_help_answer("## Pilot en bref\n\nPilot est un éditeur.");
        assert!(!c.insufficient);
        assert!(!c.truncated);
        assert_eq!(c.answer, "## Pilot en bref\n\nPilot est un éditeur.");

        // Marqueur au milieu du texte : pas interprété (signal honnête).
        let d = finish_help_answer("Voici la réponse. DOCUMENTATION_INSUFFISANTE: non.");
        assert!(!d.insufficient);
    }

    /// (b) Réponse trop longue → coupure propre + drapeau + coupure DITE.
    /// Ce test échoue si on retire le plafond.
    #[test]
    fn reponse_trop_longue_est_coupee_proprement_et_la_coupure_est_dite() {
        let phrase = "Pilot affiche la documentation dans un onglet. ";
        let raw = phrase.repeat(400); // ≈ 18 800 caractères
        assert!(raw.chars().count() > MAX_ANSWER_CHARS);

        let a = finish_help_answer(&raw);
        assert!(a.truncated, "drapeau tronquée attendu");
        assert!(a.answer.contains("tronquée"), "la coupure doit être dite : {}", a.answer);
        assert!(a.answer.contains(&MAX_ANSWER_CHARS.to_string()));

        // Coupure sur une fin de phrase (pas au milieu d'un mot).
        let kept = a.answer.split("\n\n_…").next().unwrap();
        assert!(kept.ends_with('.'), "coupure attendue sur une fin de phrase : …{:?}", &kept[kept.len().saturating_sub(40)..]);
        assert!(raw.starts_with(kept), "le texte gardé doit être un début du texte brut");
        assert!(
            kept.chars().count() <= MAX_ANSWER_CHARS,
            "le texte gardé dépasse le plafond"
        );

        // Sans ponctuation de phrase : coupure sur une fin de MOT (jamais au
        // milieu d'un mot).
        let raw_words = "mot ".repeat(2000);
        let b = finish_help_answer(&raw_words);
        assert!(b.truncated);
        let kept_words = b.answer.split("\n\n_…").next().unwrap();
        assert!(raw_words.starts_with(kept_words));
        assert!(
            raw_words[kept_words.len()..].starts_with(' '),
            "la coupure doit tomber sur un blanc (fin de mot)"
        );
    }

    /// (c) Toute section citée existe réellement dans le corpus embarqué, et le
    /// recoupement est fait par le programme. Ce test échoue si on retire le
    /// calcul des sections citées.
    #[test]
    fn les_sections_citees_existent_dans_le_corpus() {
        let corpus = handbook_sections_of(HANDBOOK);
        assert!(corpus.len() > 50, "corpus inattendu : {} titres", corpus.len());

        let some_title = corpus
            .iter()
            .find(|t| t.as_str() == "Terminal intégré")
            .cloned()
            .expect("titre « Terminal intégré » attendu dans le handbook");
        let a = finish_help_answer(&format!(
            "Ouvre le panneau et clique sur « {} » (voir ## {}).",
            some_title, some_title
        ));
        assert!(
            a.cited_sections.contains(&some_title),
            "section réelle non détectée : {:?}",
            a.cited_sections
        );
        for s in &a.cited_sections {
            assert!(corpus.contains(s), "section inventée (absente du corpus) : {}", s);
        }

        // Un titre qui n'existe pas dans le corpus n'est JAMAIS cité.
        let b = finish_help_answer("Voir ## Section totalement inventée par le modèle.");
        assert!(!b.cited_sections.iter().any(|s| s.contains("inventée")));
        assert!(b.cited_sections.iter().all(|s| corpus.contains(s)));
    }

    /// (d) Résolution du modèle : assistant → réglage d'aide → défaut, et cas
    /// « rien disponible » → erreur explicite. Ce test échoue si on retire la
    /// résolution par repli.
    #[test]
    fn le_modele_est_resolu_par_repli_avec_erreur_explicite_si_rien() {
        let global = Some(("plh".to_string(), "defaut-global".to_string()));

        // 1. modèle de l'Assistant prioritaire.
        assert_eq!(
            resolve_help_doc_model("plh/assistant", "plh/aide", global.clone(), None).unwrap(),
            "plh/assistant"
        );
        // 2. sinon le réglage d'aide existant.
        assert_eq!(
            resolve_help_doc_model("", "plh/aide", global.clone(), None).unwrap(),
            "plh/aide"
        );
        // 3. sinon le défaut de la configuration.
        assert_eq!(
            resolve_help_doc_model("", "   ", global.clone(), None).unwrap(),
            "plh/defaut-global"
        );

        // Un modèle de l'Assistant disparu du registre retombe sur le réglage
        // d'aide (jamais un modèle inexistant).
        let available = vec!["plh/aide".to_string()];
        assert_eq!(
            resolve_help_doc_model("plh/supprime", "plh/aide", None, Some(&available)).unwrap(),
            "plh/aide"
        );

        // Rien de disponible → erreur explicite et lisible (jamais silencieux).
        let err = resolve_help_doc_model("", "  ", None, None).unwrap_err();
        assert!(
            err.to_lowercase().contains("aucun modèle"),
            "message d'erreur inattendu : {}",
            err
        );
    }

    // ── Documentation lisible sur disque (§4.6) : tests PURS / disque local ──

    /// (a) La documentation est écrite au BON endroit, un fichier par thème +
    /// un index, et le contenu n'est pas réécrit (c'est le bloc du handbook).
    /// Ce test échoue si le geste d'écriture ou le découpage par thème est
    /// retiré.
    #[test]
    fn la_documentation_est_ecrite_en_fichiers_lisibles_au_bon_endroit() {
        let app_data = std::env::temp_dir().join(format!("pilot-aide-{}", std::process::id()));
        let dir = doc_dir_for(&app_data);
        assert_eq!(dir, app_data.join(DOC_DIR_NAME));
        let _ = std::fs::remove_dir_all(&app_data);

        let written = write_doc_files(&dir, HANDBOOK).expect("écriture de la documentation");
        assert!(written >= 2, "au moins l'index + un thème (écrits : {written})");

        // L'index est là et pointe des fichiers qui existent VRAIMENT.
        let index = std::fs::read_to_string(dir.join(DOC_INDEX_FILE)).expect("index.md lisible");
        let mut linked = 0usize;
        for line in index.lines() {
            let Some(open) = line.rfind("](") else { continue };
            let Some(close) = line.rfind(')') else { continue };
            if close <= open + 2 {
                continue;
            }
            let name = &line[open + 2..close];
            assert!(
                dir.join(name).is_file(),
                "l'index annonce {} qui n'existe pas dans {}",
                name,
                dir.display()
            );
            linked += 1;
        }
        assert!(linked > 10, "l'index doit lister les thèmes (liés : {linked})");

        // Le thème `overview` est présent et contient le vrai contenu.
        let overview = std::fs::read_to_string(dir.join("overview.md")).expect("overview.md");
        assert!(overview.contains("## Pilot en bref"), "contenu réel attendu");
        assert!(overview.contains("Pilot est un"));

        // Le premier thème réellement listé est aussi celui du handbook.
        let topics = handbook_topics(HANDBOOK);
        let unique: std::collections::BTreeSet<String> =
            topics.iter().map(|(t, _)| doc_file_name(t)).collect();
        assert_eq!(
            unique.len(),
            linked,
            "un fichier par thème (thèmes homonymes fusionnés), ni plus ni moins"
        );
        assert_eq!(topics[0].0, "overview");
        // Le thème `orchestration` est déclaré par DEUX blocs : ils sont
        // fusionnés dans un seul fichier (aucun écrasement silencieux).
        if topics.len() > unique.len() {
            let orch = std::fs::read_to_string(dir.join("orchestration.md")).expect("fusion");
            assert!(
                orch.contains("## Mode Orchestration") && orch.contains("### Reviewer indépendant"),
                "les deux blocs `orchestration` doivent cohabiter"
            );
        }

        // IDEMPOTENCE : un second passage n'écrit RIEN.
        assert_eq!(
            write_doc_files(&dir, HANDBOOK).expect("second passage"),
            0,
            "contenu inchangé → aucune écriture"
        );
        // ... et un contenu qui change est bien réécrit (un seul fichier).
        std::fs::write(dir.join("overview.md"), "ancien contenu\n").expect("écriture");
        assert_eq!(write_doc_files(&dir, HANDBOOK).expect("réécriture"), 1);

        let _ = std::fs::remove_dir_all(&app_data);
    }

    /// Le découpage par thème lit les marqueurs du handbook généré ; sans eux,
    /// aucun fichier ne serait produit (le séparateur `---` ne suffit pas : un
    /// bloc peut en contenir un).
    #[test]
    fn le_decoupage_par_theme_suit_les_marqueurs_du_handbook() {
        let mini = "<!-- PILOT-HELP topics=a,b -->\n# Aide\nintro\n\
                    <!-- HELP-TOPIC:a -->\n## Thème A\ntexte a\n\n---\n\nsuite a\n\
                    <!-- HELP-TOPIC:b -->\n## Thème B\ntexte b\n";
        let topics = handbook_topics(mini);
        assert_eq!(topics.len(), 2);
        assert_eq!(topics[0].0, "a");
        assert!(topics[0].1.contains("## Thème A"));
        // Le `---` interne au bloc ne coupe PAS le thème.
        assert!(topics[0].1.contains("suite a"), "thème coupé sur `---` : {:?}", topics[0].1);
        assert!(!topics[0].1.contains("intro"), "l'en-tête généré reste hors thème");
        assert_eq!(topics[1].0, "b");

        let files = doc_files_of(mini);
        let names: Vec<&str> = files.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names, vec![DOC_INDEX_FILE, "a.md", "b.md"]);
        // Deux blocs du même thème → un seul fichier (contenus fusionnés).
        let fusion = format!("{mini}<!-- HELP-TOPIC:a -->\n## Thème A bis\nautre a\n");
        let names: Vec<String> = doc_files_of(&fusion).into_iter().map(|(n, _)| n).collect();
        assert_eq!(names, vec![DOC_INDEX_FILE.to_string(), "a.md".to_string(), "b.md".to_string()]);

        // Un handbook sans marqueur ne produit rien : erreur explicite, jamais
        // un dossier vide silencieux.
        let dir = std::env::temp_dir().join(format!("pilot-aide-vide-{}", std::process::id()));
        assert!(write_doc_files(&dir, "# rien du tout\n").is_err());
    }

    /// Le slug d'un thème ne peut jamais fabriquer un chemin.
    #[test]
    fn le_nom_de_fichier_dun_theme_est_sur() {
        assert_eq!(doc_file_name("overview"), "overview.md");
        assert_eq!(doc_file_name("theme-parametres"), "theme-parametres.md");
        assert_eq!(doc_file_name("../../etc/passwd"), "etc-passwd.md");
        assert_eq!(doc_file_name("A\\B"), "a-b.md");
        assert_eq!(doc_file_name("..."), "theme.md");
    }

    /// L'écriture au démarrage est BRANCHÉE dans le `setup` de `run()` : sans
    /// cet appel, les fichiers existeraient en théorie seulement.
    #[test]
    fn lecriture_au_demarrage_est_branchee_dans_le_setup() {
        let src = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/lib.rs"))
            .expect("lecture de lib.rs")
            .replace("\r\n", "\n");
        // Ligne EXACTE (indentation comprise) : une version commentée ne compte
        // pas comme un branchement (sinon le verrou ne verrouillerait rien).
        let branche = src
            .lines()
            .any(|l| l.trim() == "help::write_startup_docs(&handle);");
        assert!(
            branche,
            "le setup de run() doit APPELER help::write_startup_docs(&handle); \
             (ligne non commentée)"
        );
    }

    /// Test d'intégration (ignoré par défaut) : nécessite pi dans le PATH et un
    /// modèle local lancé (llama-cpp/ornith). Lancer avec :
    ///   cargo test --lib -- --ignored integration_ask_pi_caged
    /// Valide que la séquence synchronisée (new_session → set_model → prompt)
    /// produit bien une réponse streamée.
    #[test]
    #[ignore]
    fn integration_ask_pi_caged() {
        let cwd = std::env::temp_dir().to_string_lossy().to_string();
        // pi n'est pas forcément dans le PATH du test : utiliser PI_PATH env ou
        // le chemin npm par défaut (Windows).
        let pi_path = std::env::var("PI_PATH")
            .unwrap_or_else(|_| "C:\\Users\\pldistance\\AppData\\Roaming\\npm\\pi.cmd".to_string());
        let res = ask_pi_caged(&cwd, &pi_path, "Réponds uniquement le mot OK", Some("llama-cpp/ornith"));
        println!("[help test] résultat = {:?}", res);
        assert!(res.is_ok(), "ask_pi_for_help a échoué : {:?}", res);
        let txt = res.unwrap();
        assert!(txt.to_uppercase().contains("OK"), "réponse inattendue : {}", txt);
        println!("[help test] ✅ réponse reçue : {}", txt);
    }
}