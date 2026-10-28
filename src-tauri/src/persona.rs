// persona.rs — nom et portrait du PERSONNAGE ACTIF de l'Assistant.
//
// Le projet « Présences » dépose, quand un personnage est activé, deux fichiers
// dans un dossier que Pilot se contente de LIRE :
//
//   <dossier de données de l'application>/.pilot/portrait/nom.txt     (le nom)
//   <dossier de données de l'application>/.pilot/portrait/portrait.png (l'image)
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

use serde::Serialize;
use std::path::{Path, PathBuf};

use base64::Engine as _;

/// Sous-dossier du dossier de données de l'application où Présences dépose.
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

/// Signature PNG (8 premiers octets) : un `portrait.png` qui n'en est pas un
/// n'est pas affiché (repli), jamais une image cassée dans l'interface.
const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];

/// Personnage actif lu sur le disque. `None` = fichier absent (ou inutilisable).
/// `Default` = « aucun personnage actif » → nom et icône habituels.
#[derive(Debug, Serialize, Clone, Default, PartialEq, Eq)]
pub struct Persona {
    /// Nom affiché (première ligne de `nom.txt`, rognée et bornée).
    pub name: Option<String>,
    /// Portrait prêt à afficher (`data:image/png;base64,…`) ou `None`.
    pub portrait: Option<String>,
}

/// Dossier du personnage actif sous le dossier de données de l'application.
///
/// Fonction PURE (aucune entrée/sortie) : c'est le seul endroit où le chemin du
/// contrat est construit, donc le seul à vérifier.
pub fn persona_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(PERSONA_DIR).join(PERSONA_SUBDIR)
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
/// Fail-open de bout en bout : un dossier de données non résoluble donne
/// `Persona::default()` — l'Assistant garde alors son nom et son icône
/// habituels, sans erreur et sans message.
#[tauri::command]
pub fn read_assistant_persona(app: tauri::AppHandle) -> Persona {
    use tauri::Manager as _;
    match app.path().app_data_dir() {
        Ok(data_dir) => read_persona(&persona_dir(&data_dir)),
        Err(_) => Persona::default(),
    }
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
}
