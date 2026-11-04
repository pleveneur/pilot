// persona.rs — nom et portrait du PERSONNAGE ACTIF de l'Assistant.
//
// Le projet « Présences » dépose, quand un personnage est activé, deux fichiers
// dans un dossier que Pilot se contente de LIRE :
//
//   <dossier applicatif de Pilot>/.pilot/portrait/nom.txt      (le nom)
//   <dossier applicatif de Pilot>/.pilot/portrait/portrait.png (l'image)
//
// « Dossier applicatif de Pilot » est celui que Présences désigne dans sa
// décision D23 (docs/DECISIONS.md) : `<dossier personnel>/.pilot`, c'est-à-dire
// `C:\Users\<utilisateur>\.pilot` sous Windows, `~/.pilot` ailleurs — donc
// `~/.pilot/portrait`. Pilot lisait auparavant le dossier de données TAURI
// (`%APPDATA%\com.pilot.editor`), qui n'est PAS le même dossier : le portrait
// déposé par Présences n'y était jamais, et l'écran ne pouvait rien afficher.
// `persona_dir_candidates` ci-dessous dit, dans l'ORDRE, où Pilot cherche.
//
// Contrat (fixé par la demande, non modifiable ici) :
//   - fichier ABSENT = aucun personnage actif → l'Assistant garde son nom et son
//     icône habituels ; ce n'est PAS une panne : aucune erreur, aucun message,
//     aucune trace console ;
//   - Pilot ne fait que LIRE : ce module ne crée ni le dossier, ni les fichiers,
//     ne les nettoie jamais et n'y écrit pas un octet ;
//   - chemins portables (PathBuf::join) : Windows, macOS et Linux ;
//   - toute lecture impossible est un repli silencieux (`None`), jamais une
//     exception remontée à l'interface.
//
// La décision de repli vit ICI (une seule autorité) : `read_persona` renvoie
// toujours une valeur valide, `Persona::default()` représentant « aucun
// personnage actif ». Le front (src/js/assistant-persona.js) ne fait qu'afficher.
//
// ── RÈGLE DE PRIORITÉ entre les emplacements (correctif du 2026-11-14) ───────
//
// Trois emplacements candidats, dans cet ordre (voir `persona_sources`) :
//   1. `PRESENCES_PILOT_DIR/portrait`   — dépôt PERSONNEL (désigné par Présences) ;
//   2. `<dossier personnel>/.pilot/portrait` — dépôt PERSONNEL (D23, le normal) ;
//   3. `<app_data_dir>/.pilot/portrait` — dépôt HISTORIQUE de Pilot (repli).
//
//   a. Le premier dépôt PERSONNEL qui EXISTE est l'AUTORITÉ : sa lecture est
//      définitive et la recherche s'ARRÊTE là. Un dossier qui existe a « parlé »,
//      même s'il ne contient qu'une déclaration d'absence (« Aucun personnage »),
//      même s'il est vide. Aucun dépôt historique ne peut donc reprendre la main
//      derrière lui.
//   b. Déclaration EXPLICITE d'absence : `nom.txt` valant « Aucun personnage »
//      (casse et accents indifférents) ne donne AUCUN nom — ce n'est pas un nom
//      de personnage, c'est la phrase par laquelle Présences dit qu'il n'y en a
//      pas. Elle ferme la recherche (règle a) au lieu de s'afficher.
//   c. Le dépôt HISTORIQUE n'est lu que si AUCUN dépôt personnel n'existe, et il
//      ne fournit QUE le nom : son `portrait.png` n'est JAMAIS utilisé. Une
//      vieille image résiduelle (1,5 Mo dans `%APPDATA%\com.pilot.editor`) ne
//      peut donc plus réapparaître. Ce module ne la supprime pas, ne l'écrase
//      pas, ne la déplace pas : il l'IGNORE franchement.
//
// `persona_stamp_from_sources` publie une empreinte LÉGÈRE (date + taille des
// deux fichiers, contenu jamais lu) : le front la compare toutes les
// `PERSONA_WATCH_MS` pour savoir QUAND relire. Elle ne remplace jamais la
// lecture : c'est un détecteur de changement, pas une seconde lecture.

use serde::Serialize;
use std::path::{Path, PathBuf};

use base64::Engine as _;

/// Sous-dossier du dossier applicatif de Pilot où Présences dépose.
pub const PERSONA_DIR: &str = ".pilot";
/// Dossier du personnage actif (sous `PERSONA_DIR`).
pub const PERSONA_SUBDIR: &str = "portrait";
/// Fichier du NOM affiché.
pub const PERSONA_NAME_FILE: &str = "nom.txt";
/// Fichier de l'IMAGE affichée.
pub const PERSONA_IMAGE_FILE: &str = "portrait.png";
/// Fichier du GENRE du personnage (tâche 402) : « féminin », « masculin » ou
/// rien. ABSENT = aucun genre porté par la fiche, le réglage de Pilot s'applique
/// (comportement actuel) : ce n'est ni une erreur ni une panne.
pub const PERSONA_GENDER_FILE: &str = "genre.txt";
/// Fichier du MODÈLE par défaut du personnage (tâche 403), au format
/// `fournisseur/modèle`. ABSENT = le modèle réglé dans Pilot s'applique
/// (comportement actuel), sans erreur ni message.
pub const PERSONA_MODEL_FILE: &str = "modele.txt";
/// Longueur maximale du nom retenu (un nom plus long est tronqué proprement).
pub const PERSONA_NAME_MAX_CHARS: usize = 60;
/// Taille maximale de l'image retenue (8 Mio) : au-delà, repli sur l'icône
/// habituelle plutôt que de charger un fichier démesuré dans le WebView.
pub const PERSONA_IMAGE_MAX_BYTES: u64 = 8 * 1024 * 1024;
/// Variable d'environnement par laquelle Présences désigne un autre dossier
/// applicatif de Pilot (voir `Presences/src/chemins.ts`, `VARIABLE_DOSSIER_PILOT`).
/// Ce n'est PAS un réglage de Pilot : quand elle est absente, le dossier par
/// défaut (`<dossier personnel>/.pilot`) est utilisé, comme avant.
pub const PRESENCES_PILOT_DIR_ENV: &str = "PRESENCES_PILOT_DIR";

/// Phrases par lesquelles Présences déclare qu'il n'y a AUCUN personnage actif
/// (elle les écrit dans `nom.txt`). Comparaison en minuscules, accents retirés,
/// ponctuation de fin ignorée : « Aucun personnage », « aucun personnage. »,
/// « Aucun personnage actif » et « No character » sont toutes reconnues.
/// Une telle valeur n'est JAMAIS un nom de personnage.
pub const PERSONA_NO_CHARACTER_MARKERS: &[&str] = &[
    "aucun personnage",
    "aucun personnage actif",
    "pas de personnage",
    "no character",
];

/// Signature PNG (8 premiers octets) : un `portrait.png` qui n'en est pas un
/// n'est pas affiché (repli), jamais une image cassée dans l'interface.
const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];

/// Rôle d'un dépôt du personnage (voir la règle de priorité en tête de module).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PersonaDepot {
    /// Dépôt PERSONNEL : celui que Présences gère (surcharge ou dossier personnel).
    /// Il fait autorité dès qu'il existe, et son image est affichable.
    Personal,
    /// Dépôt HISTORIQUE de Pilot (`<app_data_dir>/.pilot/portrait`) : repli de
    /// dernier recours, NOM seulement — son image n'est jamais utilisée.
    Legacy,
}

/// Un emplacement candidat et son rôle.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PersonaSource {
    pub dir: PathBuf,
    pub depot: PersonaDepot,
}

/// Personnage actif lu sur le disque. `None` = fichier absent (ou inutilisable).
/// `Default` = « aucun personnage actif » → nom et icône habituels.
#[derive(Debug, Serialize, Clone, Default, PartialEq, Eq)]
pub struct Persona {
    /// Nom affiché (première ligne de `nom.txt`, rognée et bornée).
    pub name: Option<String>,
    /// Portrait prêt à afficher (`data:image/png;base64,…`) ou `None`.
    pub portrait: Option<String>,
    /// Genre porté par la fiche (`genre.txt`), canonique : `"feminin"` ou
    /// `"masculin"`. `None` = aucun genre porté par la fiche (défaut) — c'est le
    /// réglage de Pilot qui s'applique alors, comme avant ce lot.
    pub gender: Option<String>,
    /// Modèle par défaut du personnage (`modele.txt`), `"fournisseur/modèle"`.
    /// `None` = aucun modèle porté par la fiche → chaîne de modèles de Pilot.
    pub model: Option<String>,
}

/// Identité SEULE du personnage actif (nom, genre, modèle), sans l'image.
///
/// C'est ce que lit l'assemblage du prompt de l'assistant : relire un portrait
/// de plusieurs mégaoctets à chaque message pour connaître un genre serait un
/// gaspillage pur (l'image est mise en base64, donc encore plus lourde).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PersonaIdentity {
    pub name: Option<String>,
    pub gender: Option<String>,
    pub model: Option<String>,
}

/// Dossier du personnage actif sous un dossier applicatif de Pilot donné.
///
/// Fonction PURE (aucune entrée/sortie) : c'est le seul endroit où le chemin du
/// contrat est construit, donc le seul à vérifier.
pub fn persona_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(PERSONA_DIR).join(PERSONA_SUBDIR)
}

/// Dossiers où Pilot cherche le personnage actif, DANS L'ORDRE, doublons retirés.
///
/// Fonction PURE (aucune entrée/sortie, aucune variable d'environnement lue
/// ici : l'appelant les résout) :
///
///   1. `override_dir/portrait` — `PRESENCES_PILOT_DIR` (dossier applicatif de
///      Pilot désigné explicitement par Présences) ;
///   2. `<home>/.pilot/portrait` — **ce que Présences dépose** (D23) ;
///   3. `<app_data_dir>/.pilot/portrait` — l'emplacement historique de Pilot,
///      conservé pour qu'aucun autre hôte ne perde l'affichage.
///
/// Un argument `None` retire simplement son candidat.
pub fn persona_sources(
    app_data_dir: Option<&Path>,
    home_dir: Option<&Path>,
    override_dir: Option<&Path>,
) -> Vec<PersonaSource> {
    let mut sources: Vec<PersonaSource> = Vec::new();
    let mut pousser = |dir: PathBuf, depot: PersonaDepot| {
        if !sources.iter().any(|s| s.dir == dir) {
            sources.push(PersonaSource { dir, depot });
        }
    };
    if let Some(racine) = override_dir {
        if !racine.as_os_str().is_empty() {
            pousser(persona_dir(racine), PersonaDepot::Personal);
        }
    }
    if let Some(home) = home_dir {
        // `persona_dir(home)` = `<home>/.pilot/portrait` : le dossier de D23.
        pousser(persona_dir(home), PersonaDepot::Personal);
    }
    if let Some(data) = app_data_dir {
        pousser(persona_dir(data), PersonaDepot::Legacy);
    }
    sources
}

/// Dossiers où Pilot cherche le personnage actif, DANS L'ORDRE — mêmes candidats
/// que `persona_sources` (seuls les chemins, sans leur rôle).
pub fn persona_dir_candidates(
    app_data_dir: Option<&Path>,
    home_dir: Option<&Path>,
    override_dir: Option<&Path>,
) -> Vec<PathBuf> {
    persona_sources(app_data_dir, home_dir, override_dir)
        .into_iter()
        .map(|source| source.dir)
        .collect()
}

/// Lit le personnage en appliquant la RÈGLE DE PRIORITÉ du module, et s'arrête
/// au PREMIER dépôt qui EXISTE (règle a). Le dépôt historique ne fournit que le
/// nom (règle c).
pub fn read_persona_from_sources(sources: &[PersonaSource]) -> Persona {
    for source in sources {
        // Un dépôt absent n'a rien dit : il ne ferme pas la recherche.
        if !source.dir.is_dir() {
            continue;
        }
        let persona = read_persona(&source.dir);
        return match source.depot {
            PersonaDepot::Personal => persona,
            // Dépôt historique : NOM seulement. Une vieille image résiduelle ne
            // peut plus jamais réapparaître (elle n'est ni lue ni supprimée), et
            // aucune fiche périmée n'impose un genre ni un modèle à l'assistant :
            // ces deux champs restent `None` → réglages de Pilot, comme avant.
            PersonaDepot::Legacy => Persona {
                name: persona.name,
                portrait: None,
                gender: None,
                model: None,
            },
        };
    }
    Persona::default()
}

/// Lit le personnage dans une liste de dossiers, tous considérés comme des
/// dépôts PERSONNELS : le premier qui EXISTE a l'autorité, et rien n'est fusionné
/// entre deux dossiers. Aucun dossier existant → `Persona::default()`.
pub fn read_persona_from(dirs: &[PathBuf]) -> Persona {
    let sources: Vec<PersonaSource> = dirs
        .iter()
        .cloned()
        .map(|dir| PersonaSource {
            dir,
            depot: PersonaDepot::Personal,
        })
        .collect();
    read_persona_from_sources(&sources)
}

/// Vrai si le contenu de `nom.txt` est la DÉCLARATION EXPLICITE d'une absence de
/// personnage (« Aucun personnage », casse et accents indifférents). Pure.
pub fn declares_no_character(raw: &str) -> bool {
    let normalise = raw.replace("\r\n", "\n").replace('\r', "\n");
    let premiere = match normalise.lines().map(|l| l.trim()).find(|l| !l.is_empty()) {
        Some(ligne) => ligne,
        None => return false,
    };
    let mut plat = String::with_capacity(premiere.len());
    for c in premiere.chars() {
        if c.is_control() {
            continue;
        }
        let minuscule = c.to_lowercase().next().unwrap_or(c);
        let sans_accent = match minuscule {
            'à' | 'â' | 'ä' | 'á' | 'ã' | 'å' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'î' | 'ï' | 'í' | 'ì' => 'i',
            'ô' | 'ö' | 'ó' | 'õ' | 'ò' => 'o',
            'ù' | 'û' | 'ü' | 'ú' => 'u',
            'ç' => 'c',
            'ñ' => 'n',
            autre => autre,
        };
        plat.push(sans_accent);
    }
    // Espaces multiples réduits, ponctuation de fin retirée (« . », « ! », « … »).
    let compact: String = plat.split_whitespace().collect::<Vec<_>>().join(" ");
    let compact = compact.trim_end_matches(['.', '!', '…', ';', ':', ' ']);
    PERSONA_NO_CHARACTER_MARKERS.contains(&compact)
}

/// Empreinte LÉGÈRE d'un fichier (date de modification + taille), sans jamais
/// lire son contenu. `-` quand le fichier n'existe pas.
fn file_stamp(path: &Path) -> String {
    match std::fs::metadata(path) {
        Ok(meta) if meta.is_file() => {
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            format!("{}:{}", mtime, meta.len())
        }
        _ => "-".to_string(),
    }
}

/// Empreinte de l'ENSEMBLE des dépôts : existence du dossier + date et taille
/// des fichiers de la fiche (`nom.txt`, `portrait.png`, `genre.txt`,
/// `modele.txt`). Elle change dès qu'un personnage est activé, désactivé,
/// remplacé, ou que sa fiche change de genre / de modèle — c'est ce qui permet au
/// front de relire SANS redémarrer Pilot, et sans relire plusieurs mégaoctets à
/// chaque fois.
///
/// Fonction PURE de lecture de métadonnées : aucun contenu de fichier lu, aucune
/// écriture (le dossier du personnage reste en lecture seule).
pub fn persona_stamp_from_sources(sources: &[PersonaSource]) -> String {
    let mut morceaux: Vec<String> = Vec::new();
    for source in sources {
        morceaux.push(format!(
            "{}|{}|{}|{}|{}|{}",
            source.dir.display(),
            if source.dir.is_dir() { "dir" } else { "-" },
            file_stamp(&source.dir.join(PERSONA_NAME_FILE)),
            file_stamp(&source.dir.join(PERSONA_IMAGE_FILE)),
            file_stamp(&source.dir.join(PERSONA_GENDER_FILE)),
            file_stamp(&source.dir.join(PERSONA_MODEL_FILE)),
        ));
    }
    morceaux.join(";")
}

/// Normalise le contenu de `nom.txt` : première ligne utile, espaces rognés,
/// caractères de contrôle retirés, longueur bornée. Rend `None` si rien de
/// lisible ne reste (fichier vide, blancs seuls, contenu de contrôle seul).
pub fn normalize_name(raw: &str) -> Option<String> {
    // Première ligne non vide : un fichier qui commence par un saut de ligne
    // (éditeurs Windows) ne doit pas perdre son nom.
    let normalise = raw.replace("\r\n", "\n").replace('\r', "\n");
    // Caractères de contrôle retirés AVANT le choix de la ligne : une ligne qui
    // ne contient qu'un caractère de contrôle n'est pas un nom, et ne doit pas
    // masquer la ligne utile suivante. On garde les sauts de ligne (séparateurs).
    let propre: String = normalise
        .chars()
        .filter(|c| *c == '\n' || !c.is_control())
        .collect();
    let premiere = propre.lines().map(|l| l.trim()).find(|l| !l.is_empty())?;
    let nom = premiere.trim();
    if nom.is_empty() {
        return None;
    }
    // Une déclaration EXPLICITE d'absence (« Aucun personnage ») n'est pas un nom :
    // c'est la phrase par laquelle Présences dit qu'il n'y a pas de personnage.
    if declares_no_character(nom) {
        return None;
    }
    let borne: String = nom.chars().take(PERSONA_NAME_MAX_CHARS).collect();
    let borne = borne.trim().to_string();
    if borne.is_empty() {
        None
    } else {
        Some(borne)
    }
}

/// Encode un PNG en `data:` URL, ou `None` si l'octet-image n'en est pas un ou
/// si sa taille sort des bornes du contrat.
pub fn png_data_url(bytes: &[u8]) -> Option<String> {
    if bytes.is_empty() || bytes.len() as u64 > PERSONA_IMAGE_MAX_BYTES {
        return None;
    }
    if bytes.len() < PNG_SIGNATURE.len() || bytes[..PNG_SIGNATURE.len()] != PNG_SIGNATURE {
        return None;
    }
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Some(format!("data:image/png;base64,{}", encoded))
}

/// Lit le personnage actif dans `dir` — LECTURE SEULE, jamais d'erreur.
///
/// - dossier absent → `Persona::default()` (aucun personnage actif) ;
/// - `nom.txt` absent / vide / illisible → `name: None` ;
/// - `portrait.png` absent / vide / trop gros / pas un PNG → `portrait: None` ;
/// - `genre.txt` absent / vide / inconnu → `gender: None` (le réglage de Pilot
///   s'applique, comportement actuel) ;
/// - `modele.txt` absent / vide / mal formé → `model: None` (chaîne de modèles de
///   Pilot, comportement actuel).
///
/// Aucun `create_dir_all`, aucun `remove_*`, aucun `write` : le dossier de
/// Présences n'est jamais touché en écriture.
pub fn read_persona(dir: &Path) -> Persona {
    let name = std::fs::read(dir.join(PERSONA_NAME_FILE))
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .and_then(|raw| normalize_name(&raw));

    let portrait_path = dir.join(PERSONA_IMAGE_FILE);
    let portrait = match std::fs::metadata(&portrait_path) {
        Ok(meta) if meta.is_file() && meta.len() > 0 && meta.len() <= PERSONA_IMAGE_MAX_BYTES => {
            std::fs::read(&portrait_path)
                .ok()
                .and_then(|bytes| png_data_url(&bytes))
        }
        // Absent, dossier, vide ou trop gros : repli silencieux sur l'icône.
        _ => None,
    };

    Persona {
        name,
        portrait,
        gender: read_fiche_line(&dir.join(PERSONA_GENDER_FILE))
            .and_then(|ligne| normalize_gender_line(&ligne)),
        model: read_fiche_line(&dir.join(PERSONA_MODEL_FILE))
            .and_then(|ligne| normalize_model_line(&ligne)),
    }
}

/// Première ligne utile d'un PETIT fichier texte de la fiche (nom, genre,
/// modèle). Fichier absent, vide, illisible ou non UTF-8 → `None`, jamais une
/// erreur : une fiche incomplète n'est pas une panne.
pub fn read_fiche_line(path: &Path) -> Option<String> {
    let raw = std::fs::read(path).ok()?;
    let texte = String::from_utf8(raw).ok()?;
    let normalise = texte.replace("\r\n", "\n").replace('\r', "\n");
    normalise
        .lines()
        .map(|l| l.trim())
        .find(|l| !l.is_empty())
        .map(|l| l.to_string())
}

/// Contenu de `genre.txt` → valeur CANONIQUE (`"feminin"` / `"masculin"`) ou
/// `None`. Une valeur inconnue (« autre », un prénom…) ne vaut pas un genre :
/// `None`, donc le réglage de Pilot, donc le comportement actuel.
///
/// La reconnaissance des mots appartient à `assistant_identity` : une seule
/// autorité pour « qu'est-ce qu'un genre ».
pub fn normalize_gender_line(raw: &str) -> Option<String> {
    match crate::assistant_identity::canonical_assistant_gender(raw) {
        "" => None,
        canonique => Some(canonique.to_string()),
    }
}

/// Contenu de `modele.txt` → `"fournisseur/modèle"` ou `None`. Tout ce qui n'est
/// pas une spécification de modèle est ignoré (le modèle de Pilot s'applique),
/// sans retirer les lignes de commentaire éventuelles : seule la première ligne
/// utile est considérée.
pub fn normalize_model_line(raw: &str) -> Option<String> {
    let ligne = raw.trim();
    if ligne.is_empty() || ligne.starts_with('#') {
        return None;
    }
    let (provider, model_id) = crate::super_agent::parse_model_spec(ligne)?;
    Some(format!("{}/{}", provider, model_id))
}

/// Identité du personnage (nom, genre, modèle) dans un dossier — sans image.
/// Même règle d'absence que `read_persona` : tout champ manquant donne `None`.
pub fn read_persona_identity(dir: &Path) -> PersonaIdentity {
    // Aucun appel à `read_persona` ici : il lirait le portrait (jusqu'à 8 Mio)
    // pour le mettre en base64, à CHAQUE message de l'assistant. L'identité ne
    // lit que les trois petits fichiers texte, et n'ouvre jamais l'image.
    PersonaIdentity {
        name: std::fs::read(dir.join(PERSONA_NAME_FILE))
            .ok()
            .and_then(|bytes| String::from_utf8(bytes).ok())
            .and_then(|raw| normalize_name(&raw)),
        gender: read_fiche_line(&dir.join(PERSONA_GENDER_FILE))
            .and_then(|ligne| normalize_gender_line(&ligne)),
        model: read_fiche_line(&dir.join(PERSONA_MODEL_FILE))
            .and_then(|ligne| normalize_model_line(&ligne)),
    }
}

/// Identité du personnage actif, en appliquant la MÊME règle de priorité entre
/// dépôts que `read_persona_from_sources` : le premier dépôt qui existe répond.
pub fn read_persona_identity_from_sources(sources: &[PersonaSource]) -> PersonaIdentity {
    for source in sources {
        if !source.dir.is_dir() {
            continue;
        }
        let identite = read_persona_identity(&source.dir);
        return match source.depot {
            PersonaDepot::Personal => identite,
            // Dépôt historique : aucune identité imposée (nom seul, pas de genre
            // ni de modèle) — même raison que pour l'image (règle c).
            PersonaDepot::Legacy => PersonaIdentity {
                name: identite.name,
                gender: None,
                model: None,
            },
        };
    }
    PersonaIdentity::default()
}

/// Dossiers candidats résolus par Tauri (dossier de données, dossier personnel)
/// et par l'environnement (`PRESENCES_PILOT_DIR`).
///
/// POINT UNIQUE de résolution : les trois commandes qui lisent le personnage
/// (`read_assistant_persona`, `read_assistant_persona_stamp` et la lecture
/// légère d'identité) passent par ici, pour qu'aucune ne puisse interroger un
/// dossier que les autres ignorent.
pub fn persona_sources_for(app: &tauri::AppHandle) -> Vec<PersonaSource> {
    use tauri::Manager as _;
    let app_data = app.path().app_data_dir().ok();
    let home = app.path().home_dir().ok();
    let racine = std::env::var(PRESENCES_PILOT_DIR_ENV)
        .ok()
        .map(|v| PathBuf::from(v.trim()))
        .filter(|p| !p.as_os_str().is_empty());
    persona_sources(app_data.as_deref(), home.as_deref(), racine.as_deref())
}

/// Identité du personnage actif pour l'assemblage du prompt de l'assistant et
/// pour le choix de son modèle : LECTURE LÉGÈRE (nom, genre, modèle), sans
/// jamais charger le portrait. Fail-open : aucune source résoluble → identité
/// vide, donc réglages de Pilot, donc comportement actuel.
pub fn read_active_persona_identity(app: &tauri::AppHandle) -> PersonaIdentity {
    read_persona_identity_from_sources(&persona_sources_for(app))
}

/// Commande Tauri : personnage actif de l'Assistant (`{ name, portrait }`).
///
/// Applique la RÈGLE DE PRIORITÉ décrite en tête de module
/// (`persona_sources` puis `read_persona_from_sources`) :
///   1. le premier dépôt PERSONNEL qui existe (`PRESENCES_PILOT_DIR/portrait`
///      s'il est défini, sinon `<dossier personnel>/.pilot/portrait` — ce que
///      Présences dépose, décision D23) FAIT AUTORITÉ et arrête la recherche ;
///      une déclaration d'absence (« Aucun personnage ») y donne « aucun
///      personnage », jamais un nom ;
///   2. le dépôt HISTORIQUE `<app_data_dir>/.pilot/portrait` n'est lu que si
///      aucun dépôt personnel n'existe, et son image n'est JAMAIS utilisée.
///
/// Aucun chemin en dur : les trois emplacements sont résolus par Tauri ou par
/// l'environnement, donc portables Windows / macOS / Linux.
///
/// Fail-open de bout en bout : aucun dossier résoluble donne
/// `Persona::default()` — l'Assistant garde alors son nom et son icône
/// habituels, sans erreur et sans message.
#[tauri::command]
pub fn read_assistant_persona(app: tauri::AppHandle) -> Persona {
    read_persona_from_sources(&persona_sources_for(&app))
}

/// Commande Tauri : EMPREINTE du personnage actif (chaîne courte, sans image).
///
/// Le front la compare périodiquement pour savoir QUAND relire le personnage
/// (`read_assistant_persona`), afin qu'une activation ou une désactivation dans
/// Présences se voie SANS redémarrer Pilot. Mêmes dossiers, mêmes règles de
/// priorité que `read_assistant_persona` : c'est un détecteur de changement, pas
/// une seconde lecture du personnage.
///
/// Fail-open : aucun dossier résoluble donne une empreinte vide, jamais une
/// exception.
#[tauri::command]
pub fn read_assistant_persona_stamp(app: tauri::AppHandle) -> String {
    persona_stamp_from_sources(&persona_sources_for(&app))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Dossier de test UNIQUE (aucun test ne partage un dossier avec un autre).
    fn dossier_de_test(nom: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!(
            "pilot-persona-{}-{}-{}",
            std::process::id(),
            nom,
            unique
        ));
        std::fs::create_dir_all(&dir).expect("dossier temporaire");
        dir
    }

    fn png_minimal() -> Vec<u8> {
        let mut bytes = PNG_SIGNATURE.to_vec();
        bytes.extend_from_slice(&[0, 0, 0, 13, b'I', b'H', b'D', b'R']);
        bytes
    }

    #[test]
    fn persona_dir_suit_le_contrat_sous_le_dossier_de_donnees() {
        let dir = persona_dir(Path::new("/data/app"));
        assert_eq!(
            dir,
            Path::new("/data/app").join(".pilot").join("portrait"),
            "dossier du contrat : <app_data_dir>/.pilot/portrait"
        );
    }

    #[test]
    fn dossier_absent_ne_donne_aucun_personnage_et_ne_cree_rien() {
        let racine = dossier_de_test("absent");
        let dir = racine.join(".pilot").join("portrait");
        let persona = read_persona(&dir);
        assert_eq!(persona, Persona::default());
        assert!(
            !dir.exists(),
            "la lecture ne doit JAMAIS creer le dossier du personnage"
        );
        let _ = std::fs::remove_dir_all(&racine);
    }

    #[test]
    fn nom_present_donne_le_nom_du_personnage() {
        let dir = dossier_de_test("nom");
        std::fs::write(dir.join(PERSONA_NAME_FILE), "Aurelia\n").expect("nom.txt");
        let persona = read_persona(&dir);
        assert_eq!(persona.name.as_deref(), Some("Aurelia"));
        assert_eq!(persona.portrait, None, "pas d'image : repli sur l'icone");
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ── Genre et modèle portés par la fiche (tâches 402 et 403) ─────────────

    /// Une fiche SANS `genre.txt` ni `modele.txt` (donc toute fiche écrite avant
    /// ce lot, dont celles que Présences dépose aujourd'hui) reste lisible :
    /// aucun des deux champs n'est renseigné, AUCUNE erreur, comportement actuel.
    #[test]
    fn fiche_sans_genre_ni_modele_ne_change_rien_et_ne_casse_rien() {
        let dir = dossier_de_test("fiche-sans-identite");
        std::fs::write(dir.join(PERSONA_NAME_FILE), "Aurelia
").expect("nom.txt");
        let persona = read_persona(&dir);
        assert_eq!(persona.name.as_deref(), Some("Aurelia"));
        assert_eq!(persona.gender, None, "genre absent = reglage de Pilot");
        assert_eq!(persona.model, None, "modele absent = chaine de modeles de Pilot");
        // La commande publique renvoie EXACTEMENT la meme chose (champs additifs
        // serialises a `null`, jamais une erreur de deserialisation).
        let json = serde_json::to_value(&persona).expect("serialisation");
        assert_eq!(json.get("gender"), Some(&serde_json::Value::Null));
        assert_eq!(json.get("model"), Some(&serde_json::Value::Null));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn genre_de_la_fiche_est_lu_et_normalise() {
        let dir = dossier_de_test("genre");
        std::fs::write(dir.join(PERSONA_GENDER_FILE), "  Féminin
").expect("genre.txt");
        assert_eq!(read_persona(&dir).gender.as_deref(), Some("feminin"));
        std::fs::write(dir.join(PERSONA_GENDER_FILE), "Homme
").expect("genre.txt");
        assert_eq!(read_persona(&dir).gender.as_deref(), Some("masculin"));
        // Valeur inconnue ou vide : AUCUN genre, donc le reglage de Pilot.
        std::fs::write(dir.join(PERSONA_GENDER_FILE), "autre
").expect("genre.txt");
        assert_eq!(read_persona(&dir).gender, None);
        std::fs::write(dir.join(PERSONA_GENDER_FILE), "

").expect("genre.txt");
        assert_eq!(read_persona(&dir).gender, None);
        // Fichier non UTF-8 : ignore, aucune panne.
        std::fs::write(dir.join(PERSONA_GENDER_FILE), [0xffu8, 0xfe]).expect("genre.txt");
        assert_eq!(read_persona(&dir).gender, None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn modele_de_la_fiche_est_lu_et_normalise() {
        let dir = dossier_de_test("modele");
        std::fs::write(dir.join(PERSONA_MODEL_FILE), "plh/rapide
").expect("modele.txt");
        assert_eq!(read_persona(&dir).model.as_deref(), Some("plh/rapide"));
        std::fs::write(dir.join(PERSONA_MODEL_FILE), "  anthropic / claude-sonnet 
")
            .expect("modele.txt");
        assert_eq!(
            read_persona(&dir).model.as_deref(),
            Some("anthropic/claude-sonnet")
        );
        // Ce qui n'est pas une specification de modele est ignore.
        for invalide in ["", "   ", "# commentaire", "sans-slash", "/manque-fournisseur"] {
            std::fs::write(dir.join(PERSONA_MODEL_FILE), invalide).expect("modele.txt");
            assert_eq!(
                read_persona(&dir).model,
                None,
                "« {invalide} » ne doit imposer aucun modele"
            );
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// L'IDENTITÉ (ce que lit le prompt de l'assistant a chaque message) ne
    /// charge JAMAIS le portrait : un portrait de plusieurs megaoctets ne doit pas
    /// etre lu ni encode en base64 pour connaitre un genre.
    #[test]
    fn identite_ne_lit_jamais_le_portrait() {
        let dir = dossier_de_test("identite-legere");
        std::fs::write(dir.join(PERSONA_NAME_FILE), "Aurelia
").expect("nom.txt");
        std::fs::write(dir.join(PERSONA_GENDER_FILE), "feminin
").expect("genre.txt");
        std::fs::write(dir.join(PERSONA_MODEL_FILE), "plh/fin
").expect("modele.txt");
        std::fs::write(dir.join(PERSONA_IMAGE_FILE), png_minimal()).expect("portrait.png");
        let identite = read_persona_identity(&dir);
        assert_eq!(identite.name.as_deref(), Some("Aurelia"));
        assert_eq!(identite.gender.as_deref(), Some("feminin"));
        assert_eq!(identite.model.as_deref(), Some("plh/fin"));
        // Un portrait ILLISIBLE (dossier a la place du fichier) ne gene pas
        // l'identite : la preuve que l'image n'est pas ouverte ici.
        std::fs::remove_file(dir.join(PERSONA_IMAGE_FILE)).expect("retrait image");
        std::fs::create_dir(dir.join(PERSONA_IMAGE_FILE)).expect("dossier a la place du PNG");
        let identite = read_persona_identity(&dir);
        assert_eq!(identite.gender.as_deref(), Some("feminin"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Le dépôt HISTORIQUE (`<app_data_dir>/.pilot/portrait`) ne fournit QUE le
    /// nom : aucun genre ni modèle périmé ne vient s'imposer à l'assistant.
    #[test]
    fn depot_historique_ne_porte_ni_genre_ni_modele() {
        let racine = dossier_de_test("historique");
        let legacy = racine.join("legacy");
        std::fs::create_dir_all(&legacy).expect("dossier");
        std::fs::write(legacy.join(PERSONA_NAME_FILE), "Ancien
").expect("nom.txt");
        std::fs::write(legacy.join(PERSONA_GENDER_FILE), "masculin
").expect("genre.txt");
        std::fs::write(legacy.join(PERSONA_MODEL_FILE), "plh/vieux
").expect("modele.txt");
        let sources = vec![PersonaSource { dir: legacy, depot: PersonaDepot::Legacy }];
        let identite = read_persona_identity_from_sources(&sources);
        assert_eq!(identite.name.as_deref(), Some("Ancien"));
        assert_eq!(identite.gender, None);
        assert_eq!(identite.model, None);
        // Le dépôt PERSONNEL, lui, porte bien les deux champs.
        let perso = racine.join("perso");
        std::fs::create_dir_all(&perso).expect("dossier");
        std::fs::write(perso.join(PERSONA_GENDER_FILE), "féminin
").expect("genre.txt");
        std::fs::write(perso.join(PERSONA_MODEL_FILE), "plh/fin
").expect("modele.txt");
        let sources = vec![
            PersonaSource { dir: perso, depot: PersonaDepot::Personal },
            PersonaSource { dir: racine.join("legacy"), depot: PersonaDepot::Legacy },
        ];
        let identite = read_persona_identity_from_sources(&sources);
        assert_eq!(identite.gender.as_deref(), Some("feminin"));
        assert_eq!(identite.model.as_deref(), Some("plh/fin"));
        let _ = std::fs::remove_dir_all(&racine);
    }

    /// L'empreinte couvre les deux nouveaux fichiers : deposer un `genre.txt`
    /// change l'empreinte, donc la fiche est relue sans redemarrer Pilot.
    #[test]
    fn empreinte_suit_les_fichiers_de_genre_et_de_modele() {
        let racine = dossier_de_test("empreinte-identite");
        let dir = racine.join("portrait");
        std::fs::create_dir_all(&dir).expect("dossier");
        std::fs::write(dir.join(PERSONA_NAME_FILE), "Aurelia
").expect("nom.txt");
        let sources = vec![PersonaSource { dir: dir.clone(), depot: PersonaDepot::Personal }];
        let avant = persona_stamp_from_sources(&sources);
        std::fs::write(dir.join(PERSONA_GENDER_FILE), "feminin
").expect("genre.txt");
        let apres_genre = persona_stamp_from_sources(&sources);
        assert_ne!(avant, apres_genre, "le genre doit changer l'empreinte");
        std::fs::write(dir.join(PERSONA_MODEL_FILE), "plh/fin
").expect("modele.txt");
        let apres_modele = persona_stamp_from_sources(&sources);
        assert_ne!(apres_genre, apres_modele, "le modele doit changer l'empreinte");
        let _ = std::fs::remove_dir_all(&racine);
    }

    #[test]
    fn nom_absent_donne_le_repli_et_le_portrait_seul_reste_lisible() {
        let dir = dossier_de_test("sans-nom");
        std::fs::write(dir.join(PERSONA_IMAGE_FILE), png_minimal()).expect("portrait.png");
        let persona = read_persona(&dir);
        assert_eq!(persona.name, None, "nom absent : nom habituel cote interface");
        assert!(
            persona
                .portrait
                .as_deref()
                .unwrap_or("")
                .starts_with("data:image/png;base64,"),
            "portrait present : image affichable"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn nom_vide_ou_illisible_donne_le_repli_sans_exception() {
        let dir = dossier_de_test("nom-vide");
        std::fs::write(dir.join(PERSONA_NAME_FILE), "   \n\t\n").expect("nom.txt vide");
        assert_eq!(read_persona(&dir).name, None);
        // Octets non UTF-8 : illisible → repli, jamais d'erreur.
        std::fs::write(dir.join(PERSONA_NAME_FILE), [0xffu8, 0xfe, 0x00]).expect("nom.txt binaire");
        assert_eq!(read_persona(&dir).name, None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn nom_tronque_et_caracteres_de_controle_retires() {
        let long = "A".repeat(PERSONA_NAME_MAX_CHARS + 20);
        let raw = format!("\u{7}\r\n  {}\r\nseconde ligne ignoree", long);
        let nom = normalize_name(&raw).expect("nom retenu");
        assert_eq!(nom.chars().count(), PERSONA_NAME_MAX_CHARS);
        assert!(!nom.contains('\u{7}'));
        assert_eq!(normalize_name(""), None);
        assert_eq!(normalize_name("Premiere ligne\nDeuxieme ligne").as_deref(), Some("Premiere ligne"));
    }

    #[test]
    fn portrait_absent_vide_ou_pas_png_donne_le_repli() {
        let dir = dossier_de_test("portrait");
        assert_eq!(read_persona(&dir).portrait, None, "fichier absent");
        std::fs::write(dir.join(PERSONA_IMAGE_FILE), b"").expect("portrait vide");
        assert_eq!(read_persona(&dir).portrait, None, "fichier vide");
        std::fs::write(dir.join(PERSONA_IMAGE_FILE), b"pas une image").expect("portrait textuel");
        assert_eq!(read_persona(&dir).portrait, None, "signature PNG absente");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn portrait_trop_gros_n_est_pas_affiche() {
        let mut gros = PNG_SIGNATURE.to_vec();
        gros.resize(PERSONA_IMAGE_MAX_BYTES as usize + 1, 0);
        assert_eq!(png_data_url(&gros), None);
    }

    // ── Emplacement du depot (correctif « le portrait n'apparait pas ») ──────
    //
    // Presences depose dans `<dossier personnel>/.pilot/portrait` (sa decision
    // D23). Pilot lisait `<app_data_dir>/.pilot/portrait` : deux dossiers
    // differents, donc aucun portrait a l'ecran. Ces trois tests tiennent
    // l'ordre des emplacements et l'absence de fusion entre deux depots.

    #[test]
    fn l_emplacement_de_presences_passe_avant_celui_de_tauri() {
        let dirs = persona_dir_candidates(
            Some(Path::new("/data/app")),
            Some(Path::new("/home/moi")),
            None,
        );
        assert_eq!(
            dirs,
            vec![
                Path::new("/home/moi").join(".pilot").join("portrait"),
                Path::new("/data/app").join(".pilot").join("portrait"),
            ],
            "le dossier personnel (ce que Presences depose) est lu EN PREMIER"
        );
    }

    #[test]
    fn le_dossier_designe_par_presences_passe_en_tete_et_aucun_doublon() {
        let dirs = persona_dir_candidates(
            Some(Path::new("/home/moi")),
            Some(Path::new("/home/moi")),
            Some(Path::new("/home/moi")),
        );
        assert_eq!(
            dirs,
            vec![Path::new("/home/moi").join(".pilot").join("portrait")],
            "trois fois le meme dossier = un seul candidat"
        );
        // Un dossier de surcharge VIDE n'est pas un candidat (aucune racine
        // vide ne doit designer `/portrait`).
        let vide = persona_dir_candidates(None, None, Some(Path::new("")));
        assert!(vide.is_empty(), "surcharge vide : aucun candidat");
        // Aucun dossier resoluble : aucun candidat, jamais une panne.
        assert!(persona_dir_candidates(None, None, None).is_empty());
    }

    #[test]
    fn le_premier_dossier_qui_a_un_fichier_gagne_et_rien_n_est_fusionne() {
        let home = dossier_de_test("home");
        let data = dossier_de_test("data");
        let dirs = persona_dir_candidates(Some(&data), Some(&home), None);
        let dossier_home = home.join(PERSONA_DIR).join(PERSONA_SUBDIR);
        let dossier_data = data.join(PERSONA_DIR).join(PERSONA_SUBDIR);
        std::fs::create_dir_all(&dossier_home).expect("depot Presences");
        std::fs::create_dir_all(&dossier_data).expect("depot historique");

        // Aucun fichier nulle part : aucun personnage.
        assert_eq!(read_persona_from(&dirs), Persona::default());

        // Le depot de Presences porte le nom ET l'image ; l'historique l'image
        // d'un AUTRE personnage : c'est le premier dossier qui gagne, en entier.
        std::fs::write(dossier_home.join(PERSONA_NAME_FILE), "Sylvie\n").expect("nom.txt");
        std::fs::write(dossier_home.join(PERSONA_IMAGE_FILE), png_minimal()).expect("portrait.png");
        std::fs::write(dossier_data.join(PERSONA_NAME_FILE), "Ancien\n").expect("nom ancien");
        let persona = read_persona_from(&dirs);
        assert_eq!(
            persona.name.as_deref(),
            Some("Sylvie"),
            "le nom vient du dossier de Presences, jamais de l'autre"
        );
        assert!(persona.portrait.is_some(), "le portrait du meme dossier est lu");

        // Le dossier de Presences n'a plus que le nom : c'est LUI qui repond,
        // meme si l'autre dossier contient encore une image.
        let _ = std::fs::remove_file(dossier_home.join(PERSONA_IMAGE_FILE));
        let persona = read_persona_from(&dirs);
        assert_eq!(persona.name.as_deref(), Some("Sylvie"));
        assert_eq!(
            persona.portrait, None,
            "aucune fusion : l'image de l'autre dossier n'est pas empruntee"
        );

        let _ = std::fs::remove_dir_all(&home);
        let _ = std::fs::remove_dir_all(&data);
    }

    // ── Désactivation complète (correctif du 2026-11-14) ─────────────────────
    //
    // Presences ecrit « Aucun personnage » dans `nom.txt` quand AUCUN personnage
    // n'est actif. Ce n'est pas un nom : c'est une declaration d'absence. Et
    // l'ancienne image du depot historique ne doit JAMAIS reprendre la main.

    #[test]
    fn la_declaration_d_absence_n_est_jamais_un_nom() {
        assert!(declares_no_character("Aucun personnage"));
        assert!(declares_no_character("  aucun personnage  \r\n"));
        assert!(declares_no_character("AUCUN PERSONNAGE"));
        assert!(declares_no_character("Aucun personnage.\n"));
        assert!(declares_no_character("Aucun personnage actif"));
        assert!(declares_no_character("No character"));
        // Un vrai nom n'est jamais pris pour une declaration d'absence.
        assert!(!declares_no_character("Sylvie"));
        assert!(!declares_no_character("Aucune"));
        assert!(!declares_no_character(""));
        // ... et elle ne ressort pas comme nom normalise.
        assert_eq!(normalize_name("Aucun personnage\n"), None);
        assert_eq!(normalize_name("Sylvie\n").as_deref(), Some("Sylvie"));
    }

    #[test]
    fn le_dossier_personnel_qui_declare_l_absence_ferme_la_recherche() {
        let home = dossier_de_test("home-absent-personnage");
        let data = dossier_de_test("data-ancien");
        let dossier_home = home.join(PERSONA_DIR).join(PERSONA_SUBDIR);
        let dossier_data = data.join(PERSONA_DIR).join(PERSONA_SUBDIR);
        std::fs::create_dir_all(&dossier_home).expect("depot Presences");
        std::fs::create_dir_all(&dossier_data).expect("depot historique");
        // Le depot personnel DIT qu'il n'y a aucun personnage...
        std::fs::write(dossier_home.join(PERSONA_NAME_FILE), "Aucun personnage").expect("nom.txt");
        // ... et l'ancien depot porte encore un nom ET une image (1,5 Mo chez le
        // proprietaire) : ni l'un ni l'autre ne doivent revenir.
        std::fs::write(dossier_data.join(PERSONA_NAME_FILE), "Sylvie\n").expect("nom ancien");
        std::fs::write(dossier_data.join(PERSONA_IMAGE_FILE), png_minimal()).expect("image ancienne");

        let sources = persona_sources(Some(&data), Some(&home), None);
        assert_eq!(
            read_persona_from_sources(&sources),
            Persona::default(),
            "declaration d'absence : aucun nom, aucune image, et surtout PAS l'image du depot historique"
        );
        // Aucune fusion, aucune ecriture : l'ancienne image est ignoree, pas touchee.
        assert!(dossier_data.join(PERSONA_IMAGE_FILE).is_file());

        let _ = std::fs::remove_dir_all(&home);
        let _ = std::fs::remove_dir_all(&data);
    }

    #[test]
    fn l_image_du_depot_historique_n_est_jamais_utilisee() {
        let home = dossier_de_test("home-sans-depot");
        let data = dossier_de_test("data-seul");
        let dossier_data = data.join(PERSONA_DIR).join(PERSONA_SUBDIR);
        std::fs::create_dir_all(&dossier_data).expect("depot historique");
        std::fs::write(dossier_data.join(PERSONA_NAME_FILE), "Ancien\n").expect("nom ancien");
        std::fs::write(dossier_data.join(PERSONA_IMAGE_FILE), png_minimal()).expect("image ancienne");

        // Aucun depot personnel n'existe : l'historique est consulte, mais pour le
        // NOM seulement.
        let sources = persona_sources(Some(&data), Some(&home), None);
        let persona = read_persona_from_sources(&sources);
        assert_eq!(persona.name.as_deref(), Some("Ancien"));
        assert_eq!(
            persona.portrait, None,
            "une vieille image residuelle ne peut plus jamais reapparaitre a l'ecran"
        );

        let _ = std::fs::remove_dir_all(&home);
        let _ = std::fs::remove_dir_all(&data);
    }

    #[test]
    fn un_dossier_personnel_vide_fait_autorite_sur_l_historique() {
        let home = dossier_de_test("home-vide");
        let data = dossier_de_test("data-rempli");
        let dossier_home = home.join(PERSONA_DIR).join(PERSONA_SUBDIR);
        let dossier_data = data.join(PERSONA_DIR).join(PERSONA_SUBDIR);
        std::fs::create_dir_all(&dossier_home).expect("depot Presences vide");
        std::fs::create_dir_all(&dossier_data).expect("depot historique");
        std::fs::write(dossier_data.join(PERSONA_NAME_FILE), "Sylvie\n").expect("nom ancien");
        std::fs::write(dossier_data.join(PERSONA_IMAGE_FILE), png_minimal()).expect("image ancienne");

        // Le dossier personnel existe (Presences l'a cree) : il a « parle », meme
        // vide, donc il ferme la recherche.
        let sources = persona_sources(Some(&data), Some(&home), None);
        assert_eq!(read_persona_from_sources(&sources), Persona::default());

        let _ = std::fs::remove_dir_all(&home);
        let _ = std::fs::remove_dir_all(&data);
    }

    #[test]
    fn l_empreinte_change_quand_le_personnage_change() {
        let home = dossier_de_test("empreinte");
        let dossier_home = home.join(PERSONA_DIR).join(PERSONA_SUBDIR);
        let sources = persona_sources(None, Some(&home), None);

        // Dossier absent.
        let vide = persona_stamp_from_sources(&sources);
        // Activation : les fichiers apparaissent.
        std::fs::create_dir_all(&dossier_home).expect("depot");
        let cree = persona_stamp_from_sources(&sources);
        assert_ne!(vide, cree, "la creation du dossier doit changer l'empreinte");
        std::fs::write(dossier_home.join(PERSONA_NAME_FILE), "Sylvie\n").expect("nom.txt");
        let nomme = persona_stamp_from_sources(&sources);
        assert_ne!(cree, nomme, "l'arrivee du nom doit changer l'empreinte");
        std::fs::write(dossier_home.join(PERSONA_IMAGE_FILE), png_minimal()).expect("portrait.png");
        let avec_image = persona_stamp_from_sources(&sources);
        assert_ne!(nomme, avec_image, "l'arrivee de l'image doit changer l'empreinte");
        // Rien ne bouge : l'empreinte est stable (aucune relecture inutile).
        assert_eq!(avec_image, persona_stamp_from_sources(&sources));
        // Desactivation : le nom change de valeur, l'empreinte suit.
        std::fs::write(dossier_home.join(PERSONA_NAME_FILE), "Aucun personnage")
            .expect("nom.txt desactive");
        assert_ne!(avec_image, persona_stamp_from_sources(&sources));
        // Retrait de l'image : l'empreinte suit encore.
        let _ = std::fs::remove_file(dossier_home.join(PERSONA_IMAGE_FILE));
        assert_ne!(
            persona_stamp_from_sources(&sources),
            avec_image,
            "le retrait de l'image doit changer l'empreinte"
        );

        let _ = std::fs::remove_dir_all(&home);
    }
}
