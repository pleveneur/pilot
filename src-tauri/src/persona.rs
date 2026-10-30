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
            // peut plus jamais réapparaître (elle n'est ni lue ni supprimée).
            PersonaDepot::Legacy => Persona {
                name: persona.name,
                portrait: None,
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

/// Empreinte de l'ENSEMBLE des dépôts : existence du dossier + date et taille de
/// `nom.txt` et `portrait.png`. Elle change dès qu'un personnage est activé,
/// désactivé, remplacé — c'est ce qui permet au front de relire SANS redémarrer
/// Pilot, et sans relire plusieurs mégaoctets à chaque fois.
///
/// Fonction PURE de lecture de métadonnées : aucun contenu de fichier lu, aucune
/// écriture (le dossier du personnage reste en lecture seule).
pub fn persona_stamp_from_sources(sources: &[PersonaSource]) -> String {
    let mut morceaux: Vec<String> = Vec::new();
    for source in sources {
        morceaux.push(format!(
            "{}|{}|{}|{}",
            source.dir.display(),
            if source.dir.is_dir() { "dir" } else { "-" },
            file_stamp(&source.dir.join(PERSONA_NAME_FILE)),
            file_stamp(&source.dir.join(PERSONA_IMAGE_FILE)),
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
/// - `portrait.png` absent / vide / trop gros / pas un PNG → `portrait: None`.
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

    Persona { name, portrait }
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
    use tauri::Manager as _;
    let app_data = app.path().app_data_dir().ok();
    let home = app.path().home_dir().ok();
    let racine = std::env::var(PRESENCES_PILOT_DIR_ENV)
        .ok()
        .map(|v| PathBuf::from(v.trim()))
        .filter(|p| !p.as_os_str().is_empty());
    let sources = persona_sources(app_data.as_deref(), home.as_deref(), racine.as_deref());
    read_persona_from_sources(&sources)
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
    use tauri::Manager as _;
    let app_data = app.path().app_data_dir().ok();
    let home = app.path().home_dir().ok();
    let racine = std::env::var(PRESENCES_PILOT_DIR_ENV)
        .ok()
        .map(|v| PathBuf::from(v.trim()))
        .filter(|p| !p.as_os_str().is_empty());
    let sources = persona_sources(app_data.as_deref(), home.as_deref(), racine.as_deref());
    persona_stamp_from_sources(&sources)
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
