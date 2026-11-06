// persona_fiche.rs — LA FICHE DU PERSONNAGE ACTIF (Présences), lue et écrite par
// Pilot dans le cadre de la CASE « Discussion seulement via llama »
// (docs/conceptions/CONCEPTION-personnage-discussion-seule-via-llama.md § 3 et § 4).
//
// PRINCIPE : la fiche appartient à Présences. Pilot ne fait que la LIRE pour
// construire l'identité du personnage, et n'écrit QUE le fichier `fiche.json` du
// personnage actif, uniquement quand le personnage le demande (outil
// `ecrire_ma_fiche`), jamais les autres fichiers de Présences :
//   - ni `carnet.json`, ni `corbeille.json`, ni `journal-palier.json` ;
//   - ni la description visuelle ni le palier de relation (champs de `fiche.json`
//     qu'on ne touche jamais : la fusion préserve tout ce qui n'est pas un champ
//     de contenu) ;
//   - ni la fiche d'un AUTRE personnage (le dossier est celui du personnage
//     actif, retrouvé par son nom) ;
//   - ni un réglage de Pilot, ni un fichier de projet.
//
// VERSION PRÉCÉDENTE (§ 4.4) : AVANT chaque écriture, la fiche en vigueur est
// copiée dans `fiche-historique/<millisecondes>.json`, à côté d'elle. Les 20
// dernières versions sont gardées ; la fiche en vigueur, elle, n'est JAMAIS
// tronquée. Le retour en arrière des Options échange la fiche en vigueur avec la
// version la plus récente de l'historique — donc un second clic revient en
// avant, et rien n'est perdu.
//
// CE QUE LE PROPRIÉTAIRE A ÉCRIT N'EST JAMAIS EFFACÉ (§ 4.3) : la provenance d'un
// passage n'existe pas dans `fiche.json`. Pilot tient donc, dans SA configuration
// (`character_fiche_authors`, champ ADDITIF), la dernière valeur que le
// personnage a lui-même écrite pour chaque champ. Un passage dont la valeur
// actuelle ne correspond pas à cette trace est réputé écrit par le propriétaire :
// il peut être AJOUTÉ s'il est vide, jamais réécrit sans un accord explicite.
// Défaut raisonnable : dans le doute, on protège (fail-closed).
//
// Toute panne est dite, jamais réparée : un fichier abîmé ou trop gros est traité
// comme ABSENT (§ 3.3), rien n'est supprimé, rien n'est réécrit.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::discussion_seule;
use crate::AppState;

/// Dossier de Présences, sous le dossier personnel (`~/.presences`).
pub const PRESENCES_DIR: &str = ".presences";
/// Variable par laquelle Présences désigne un autre dossier de données (décision
/// D23 de Présences, `src/chemins.ts`). Absente = `~/.presences`, comme avant.
pub const PRESENCES_DATA_DIR_ENV: &str = "PRESENCES_DATA_DIR";
/// Sous-dossier des personnages.
pub const PERSONNAGES_DIR: &str = "personnages";
/// Fichier de fiche d'un personnage.
pub const FICHE_FILE: &str = "fiche.json";
/// Sous-dossier de l'historique des versions (créé seulement à la première
/// écriture réelle).
pub const HISTORY_DIR: &str = "fiche-historique";
/// Marqueur de la « gestion coupée » (décision D25 de Présences) : présent, il
/// arrête TOUT avant la moindre lecture de fiche.
pub const GESTION_FILE: &str = "gestion.json";
/// Plafond de lecture d'une fiche (une fiche trop grosse est traitée comme
/// absente : on ne la charge pas, on ne la répare pas).
pub const FICHE_MAX_BYTES: u64 = 256 * 1024;
/// Nombre de versions gardées dans l'historique (§ 4.4).
pub const HISTORY_MAX: usize = 20;

/// Les cinq CHAMPS DE CONTENU que le personnage peut écrire. Ordre de la fiche
/// et de l'identité envoyée au modèle. Tout autre champ de `fiche.json`
/// (`identifiant`, `nom`, `palier_relation`, `description_visuelle`, `portrait`)
/// est PRÉSERVÉ à l'identique et n'est jamais proposé à l'écriture.
pub const CONTENT_FIELDS: [&str; 5] = [
    "ce_qu_il_est",
    "ton_et_parler",
    "appel_du_proprietaire",
    "ce_qu_il_fait",
    "ce_qu_il_ne_fait_jamais",
];

/// Libellé français de chaque champ de contenu, dans le même ordre (sert au
/// prompt et au compte rendu d'écriture, jamais à l'écran tel quel).
pub const CONTENT_LABELS: [&str; 5] = [
    "ce que je suis",
    "mon ton et ma façon de parler",
    "comment j'appelle le propriétaire",
    "ce que je fais",
    "ce que je ne fais jamais",
];

/// État de la fiche du personnage actif.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FicheKind {
    /// La fiche existe et porte au moins un champ de contenu rempli.
    Ok,
    /// Le fichier existe mais aucun champ de contenu n'est rempli.
    Vide,
    /// Aucune fiche lisible (absente, abîmée, trop grosse, personnage introuvable).
    Absente,
    /// `gestion.json` présent : Présences a coupé la gestion. Refus avant lecture.
    Gestion,
}

impl FicheKind {
    /// Valeur lisible par l'écran (`discussion_seule_state`).
    pub fn as_str(self) -> &'static str {
        match self {
            FicheKind::Ok => "ok",
            FicheKind::Vide => "vide",
            FicheKind::Absente => "absente",
            FicheKind::Gestion => "gestion",
        }
    }
}

/// La fiche du personnage actif, réduite à ce qui sert à parler.
#[derive(Clone, Debug)]
pub struct FicheEtat {
    pub kind: FicheKind,
    /// Nom du personnage actif (vide si aucun).
    pub name: String,
    /// Champs de contenu NON VIDES, dans l'ordre du contrat.
    pub champs: Vec<(String, String)>,
    /// Vrai si au moins une version précédente existe (le lien des Options
    /// n'apparaît que dans ce cas).
    pub has_previous: bool,
    /// Dossier du personnage quand il a été retrouvé (seul chemin écrit).
    pub dir: Option<PathBuf>,
}

impl FicheEtat {
    /// Fiche complète (tests et lectures réussies).
    pub fn ok(
        name: &str,
        ce_qu_il_est: &str,
        ton: &str,
        appel: &str,
        fait: &str,
        ne_fait_jamais: &str,
    ) -> Self {
        let valeurs = [ce_qu_il_est, ton, appel, fait, ne_fait_jamais];
        let champs: Vec<(String, String)> = CONTENT_FIELDS
            .iter()
            .zip(valeurs.iter())
            .filter(|(_, v)| !v.trim().is_empty())
            .map(|(k, v)| (k.to_string(), v.trim().to_string()))
            .collect();
        let kind = if champs.is_empty() {
            FicheKind::Vide
        } else {
            FicheKind::Ok
        };
        Self {
            kind,
            name: name.to_string(),
            champs,
            has_previous: false,
            dir: None,
        }
    }

    /// Fiche absente pour un nom donné.
    pub fn absente(name: &str) -> Self {
        Self {
            kind: FicheKind::Absente,
            name: name.to_string(),
            champs: Vec::new(),
            has_previous: false,
            dir: None,
        }
    }

    /// Valeur d'un champ, ou chaîne vide.
    pub fn champ(&self, cle: &str) -> &str {
        self.champs
            .iter()
            .find(|(k, _)| k == cle)
            .map(|(_, v)| v.as_str())
            .unwrap_or("")
    }

    /// BLOC D'IDENTITÉ envoyé au modèle : les passages de la fiche, et rien
    /// d'autre. Aucun rôle, aucune consigne, aucun réglage de Pilot.
    pub fn prompt_block(&self) -> String {
        match self.kind {
            FicheKind::Ok => {
                if self.champs.is_empty() {
                    return String::new();
                }
                let mut lignes = vec!["## Ta fiche (écrite dans Présences)".to_string()];
                for (cle, valeur) in &self.champs {
                    let label = CONTENT_LABELS
                        .iter()
                        .zip(CONTENT_FIELDS.iter())
                        .find(|(_, k)| *k == cle)
                        .map(|(l, _)| *l)
                        .unwrap_or(cle.as_str());
                    lignes.push(format!("- {} : {}", label, valeur));
                }
                lignes.join("\n")
            }
            _ => String::new(),
        }
    }

    /// Ligne grise affichée UNE SEULE FOIS par session, en tête de discussion.
    /// `None` quand il n'y a rien à dire (fiche complète, partielle comprise).
    pub fn notice(&self) -> Option<&'static str> {
        match self.kind {
            FicheKind::Ok => None,
            FicheKind::Vide => Some(
                "Ce personnage n'a pas encore de fiche remplie : il te parle sans consigne, avec son nom.",
            ),
            FicheKind::Absente | FicheKind::Gestion => Some(
                "Ce personnage n'a pas encore de fiche : il te parle sans consigne, avec son nom.",
            ),
        }
    }

    /// Ligne discrète sous la case, dans les Options (même règle : rien quand la
    /// fiche est utilisable, même partielle).
    pub fn options_line(&self) -> Option<&'static str> {
        match self.kind {
            FicheKind::Ok => None,
            FicheKind::Vide => Some("Fiche vide — le personnage parle sans consigne."),
            FicheKind::Absente | FicheKind::Gestion => {
                Some("Fiche absente — le personnage parle sans consigne.")
            }
        }
    }
}

// ─────────────────────────── Résolution du dossier ───────────────────────────

/// Racine des données de Présences : `PRESENCES_DATA_DIR` si défini et non vide,
/// sinon `<dossier personnel>/.presences`. Aucun chemin en dur.
pub fn presences_root(home: Option<&Path>, override_dir: Option<&Path>) -> Option<PathBuf> {
    if let Some(dir) = override_dir {
        if !dir.as_os_str().is_empty() {
            return Some(dir.to_path_buf());
        }
    }
    home.map(|h| h.join(PRESENCES_DIR))
}

/// Racine de Présences lue dans l'environnement (même variable que Présences).
pub fn presences_root_from_env(home: Option<&Path>) -> Option<PathBuf> {
    let racine = std::env::var(PRESENCES_DATA_DIR_ENV)
        .ok()
        .map(|v| PathBuf::from(v.trim()))
        .filter(|p| !p.as_os_str().is_empty());
    presences_root(home, racine.as_deref())
}

/// Un nom comparable : casse, espaces et accents ignorés (deux graphies du même
/// nom désignent le même personnage).
fn cle_nom(nom: &str) -> String {
    let mut plat = String::with_capacity(nom.len());
    for c in nom.trim().chars() {
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
        if sans_accent.is_whitespace() {
            plat.push(' ');
        } else {
            plat.push(sans_accent);
        }
    }
    plat.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Vrai si `gestion.json` est présent : Présences a coupé la gestion (D25). Dans
/// ce cas Pilot ne lit AUCUNE fiche et n'écrit rien.
pub fn gestion_coupee(root: &Path) -> bool {
    root.join(GESTION_FILE).is_file()
}

/// Dossiers de personnages, triés par nom de dossier (ordre stable).
fn personnage_dirs(root: &Path) -> Vec<PathBuf> {
    let dir = root.join(PERSONNAGES_DIR);
    let mut dossiers: Vec<PathBuf> = Vec::new();
    if let Ok(lecture) = std::fs::read_dir(&dir) {
        for entree in lecture.flatten() {
            let chemin = entree.path();
            if chemin.is_dir() && chemin.join(FICHE_FILE).is_file() {
                dossiers.push(chemin);
            }
        }
    }
    dossiers.sort();
    dossiers
}

/// Lit un `fiche.json` : objet JSON si le fichier est lisible et dans le plafond.
/// Toute autre situation rend `None` (traité comme absent, jamais réparé).
fn lire_fiche_json(chemin: &Path) -> Option<Value> {
    let meta = std::fs::metadata(chemin).ok()?;
    if !meta.is_file() || meta.len() > FICHE_MAX_BYTES {
        return None;
    }
    let brut = std::fs::read_to_string(chemin).ok()?;
    let valeur: Value = serde_json::from_str(&brut).ok()?;
    if valeur.is_object() {
        Some(valeur)
    } else {
        None
    }
}

/// Nom porté par une fiche (`nom`). Vide si absent.
fn nom_de_fiche(valeur: &Value) -> String {
    valeur
        .get("nom")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string()
}

/// Le dossier du personnage ACTIF : celui dont `fiche.json` porte le nom déposé
/// par Présences. Un nom différent n'est JAMAIS retenu (le nom déposé fait
/// autorité, § 3.3) : introuvable ⇒ aucun personnage écrit.
pub fn find_fiche_dir(root: &Path, persona_name: &str) -> Option<PathBuf> {
    let cible = cle_nom(persona_name);
    if cible.is_empty() {
        return None;
    }
    for dossier in personnage_dirs(root) {
        if let Some(valeur) = lire_fiche_json(&dossier.join(FICHE_FILE)) {
            if cle_nom(&nom_de_fiche(&valeur)) == cible {
                return Some(dossier);
            }
        }
    }
    None
}

/// Versions précédentes d'une fiche, de la PLUS ANCIENNE à la PLUS RÉCENTE.
pub fn history_files(fiche_dir: &Path) -> Vec<PathBuf> {
    let dir = fiche_dir.join(HISTORY_DIR);
    let mut fichiers: Vec<PathBuf> = Vec::new();
    if let Ok(lecture) = std::fs::read_dir(&dir) {
        for entree in lecture.flatten() {
            let chemin = entree.path();
            if chemin.is_file() && chemin.extension().map(|e| e == "json").unwrap_or(false) {
                fichiers.push(chemin);
            }
        }
    }
    fichiers.sort();
    fichiers
}

/// Lit la fiche du personnage actif. Fail-open : toute panne donne une fiche
/// ABSENTE (le personnage parle quand même, avec son nom).
pub fn read_fiche(root: &Path, persona_name: Option<&str>) -> FicheEtat {
    let name = persona_name.unwrap_or("").trim().to_string();
    if gestion_coupee(root) {
        return FicheEtat {
            kind: FicheKind::Gestion,
            name,
            champs: Vec::new(),
            has_previous: false,
            dir: None,
        };
    }
    if name.is_empty() {
        return FicheEtat::absente("");
    }
    let Some(dir) = find_fiche_dir(root, &name) else {
        return FicheEtat::absente(&name);
    };
    let Some(valeur) = lire_fiche_json(&dir.join(FICHE_FILE)) else {
        return FicheEtat::absente(&name);
    };
    let has_previous = !history_files(&dir).is_empty();
    let champs: Vec<(String, String)> = CONTENT_FIELDS
        .iter()
        .filter_map(|cle| {
            valeur
                .get(*cle)
                .and_then(|v| v.as_str())
                .map(|v| (cle.to_string(), v.trim().to_string()))
                .filter(|(_, v)| !v.is_empty())
        })
        .collect();
    let kind = if champs.is_empty() {
        FicheKind::Vide
    } else {
        FicheKind::Ok
    };
    FicheEtat {
        kind,
        name,
        champs,
        has_previous,
        dir: Some(dir),
    }
}

// ───────────────────────────── Décision d'écriture ───────────────────────────

/// Ce que le personnage propose d'écrire : des couples (champ de contenu,
/// valeur). Toute clé hors contrat est IGNORÉE (elle ne peut pas atteindre un
/// autre champ de la fiche).
pub fn normalize_proposal(paires: &[(String, String)]) -> Vec<(String, String)> {
    let mut retenues: Vec<(String, String)> = Vec::new();
    for (cle, valeur) in paires {
        let cle_norm = cle.trim();
        if !CONTENT_FIELDS.contains(&cle_norm) {
            continue;
        }
        let v = valeur.replace("\r\n", "\n");
        let v = v.trim();
        // Un contenu vide n'efface jamais rien : il est ignoré.
        if v.is_empty() {
            continue;
        }
        // Borne de sécurité : un champ reste un passage, pas un roman.
        let v: String = v.chars().take(2_000).collect();
        if let Some(slot) = retenues.iter_mut().find(|(k, _)| k == cle_norm) {
            slot.1 = v;
        } else {
            retenues.push((cle_norm.to_string(), v));
        }
    }
    retenues
}

/// Décision d'écriture : ce qui est écrit, ce qui est protégé.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct WriteDecision {
    /// Couples (champ, valeur) réellement écrits.
    pub writes: Vec<(String, String)>,
    /// Champs refusés parce que le passage appartient au propriétaire.
    pub protected: Vec<String>,
    /// Champs proposés identiques à la fiche actuelle (aucune écriture).
    pub unchanged: Vec<String>,
}

impl WriteDecision {
    pub fn is_empty(&self) -> bool {
        self.writes.is_empty() && self.protected.is_empty()
    }
}

/// DÉCIDE, sans rien écrire. Fonction PURE (§ 4.3) :
///   - champ vide (ou absent) dans la fiche → AJOUT autorisé, sans condition ;
///   - valeur identique → rien à faire ;
///   - valeur égale à ce que le personnage a lui-même écrit (`authors`) →
///     RÉÉCRITURE autorisée ;
///   - sinon → le passage est réputé écrit par le propriétaire → REFUS, sauf
///     accord explicite (`force`, jamais utilisé à l'oral par l'appelant).
pub fn decide_write(
    fiche: &FicheEtat,
    authors: &HashMap<String, String>,
    proposal: &[(String, String)],
    force: bool,
) -> WriteDecision {
    let mut decision = WriteDecision::default();
    if fiche.kind != FicheKind::Ok && fiche.kind != FicheKind::Vide {
        // Fiche absente : on ne crée rien (§ 4.6).
        return decision;
    }
    for (cle, valeur) in normalize_proposal(proposal) {
        let actuelle = fiche.champ(&cle);
        if !actuelle.is_empty() && actuelle == valeur.as_str() {
            decision.unchanged.push(cle);
            continue;
        }
        let ecrit_par_le_personnage = authors.get(&cle).map(|v| v == actuelle).unwrap_or(false);
        if actuelle.is_empty() || ecrit_par_le_personnage || force {
            decision.writes.push((cle, valeur));
        } else {
            decision.protected.push(cle);
        }
    }
    decision
}

/// La trace de provenance à conserver dans la configuration : la valeur écrite
/// pour chaque champ réellement écrit (le personnage devient l'auteur de ce
/// passage).
pub fn author_updates(writes: &[(String, String)]) -> Vec<(String, String)> {
    writes
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect()
}

/// Libellé français d'un champ de contenu (pour le compte rendu).
pub fn field_label(cle: &str) -> &str {
    CONTENT_LABELS
        .iter()
        .zip(CONTENT_FIELDS.iter())
        .find(|(_, k)| **k == cle)
        .map(|(l, _)| *l)
        .unwrap_or(cle)
}

/// Ce qu'il faut RETENIR de l'écriture : l'issue, en une valeur testable.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WriteOutcome {
    /// Écriture faite (un ou plusieurs champs).
    Written(Vec<String>),
    /// Rien n'a changé (les valeurs proposées étaient déjà là).
    Nothing,
    /// Au moins un passage appartient au propriétaire : rien n'est écrit pour
    /// ceux-là (les ajouts purs, eux, ont pu passer).
    OwnerProtected(Vec<String>),
    /// Aucune fiche : on n'en crée pas.
    NoFiche,
    /// Le personnage a été DÉSACTIVÉ entre la demande et l'écriture : plus de
    /// personnage, donc plus de fiche à lui. Rien n'est écrit, pas même à moitié
    /// (§4.6).
    CharGone,
    /// Panne d'écriture (disque protégé, dossier illisible).
    Failed(String),
}

/// LE PERSONNAGE A-T-IL CHANGÉ (ou disparu) DEPUIS LA DEMANDE D'ÉCRITURE ?
/// Décision PURE, testable : vrai seulement quand une demande nommait un
/// personnage qui n'est plus celui d'aujourd'hui. Une demande qui ne nomme
/// personne (`demande` vide) ne peut pas fonder ce refus : elle suit le chemin
/// ordinaire (« fiche absente »).
pub fn persona_gone_since_request(demande: &str, actuel: &str) -> bool {
    let d = demande.trim().to_lowercase();
    if d.is_empty() {
        return false;
    }
    d != actuel.trim().to_lowercase()
}

/// Texte RENDU AU MODÈLE après l'appel de l'outil (il n'est pas montré tel quel
/// à l'utilisateur : le personnage le dit avec ses mots). `vocal` choisit la
/// phrase de la § 4.5 quand la modification est abandonnée.
pub fn report_text(outcome: &WriteOutcome, vocal: bool) -> String {
    match outcome {
        WriteOutcome::Written(champs) => {
            let quoi = champs
                .iter()
                .map(|c| field_label(c))
                .collect::<Vec<_>>()
                .join(", ");
            format!(
                "C'est écrit dans ta fiche ({}). L'ancienne version est gardée. Tu peux le dire au propriétaire en une phrase, avec tes mots.",
                quoi
            )
        }
        WriteOutcome::Nothing => {
            "Rien à changer : ta fiche dit déjà cela, mot pour mot. Aucune écriture n'a été faite.".to_string()
        }
        WriteOutcome::OwnerProtected(champs) => {
            let quoi = champs
                .iter()
                .map(|c| field_label(c))
                .collect::<Vec<_>>()
                .join(", ");
            if vocal {
                format!(
                    "Modification abandonnée : {} a été écrit par le propriétaire, rien n'a été touché, rien n'a été écrit. Dis-le en une phrase, avec tes mots : « Ça, c'est toi qui l'as écrit : je l'ai laissé tel quel. »",
                    quoi
                )
            } else {
                format!(
                    "Modification refusée : {} a été écrit par le propriétaire, rien n'a été écrit. Pose-lui la question, une seule fois, avec tes mots : « Ça, c'est toi qui l'as écrit. Je le change quand même ? » Si — et seulement si — il répond oui franchement, rappelle l'outil en ajoutant force: true.",
                    quoi
                )
            }
        }
        WriteOutcome::NoFiche => {
            "Aucune fiche n'existe pour ce personnage : elle n'est pas créée. Tu continues de parler sans consigne.".to_string()
        }
        WriteOutcome::CharGone => {
            "Tu n'as plus de personnage actif : il n'y a plus de fiche à toi, et rien n'a été changé. Dis-le en une phrase, avec tes mots : « Je n'ai plus de fiche à moi, je n'ai rien changé. »".to_string()
        }
        WriteOutcome::Failed(raison) => format!(
            "L'écriture n'a pas abouti ({}). Ta fiche est restée exactement comme avant. Dis-le simplement, sans mot technique.",
            raison
        ),
    }
}

/// Combien de versions retirer pour respecter le plafond de l'historique.
pub fn history_excess(count: usize) -> usize {
    count.saturating_sub(HISTORY_MAX)
}

// ──────────────────────────────── Écritures ──────────────────────────────────

/// Nom horodaté d'une version d'historique. Trié par le nom (chronologique).
pub fn history_file_name(millis: i64) -> String {
    format!("{:013}.json", millis)
}

/// Copie la fiche en vigueur dans l'historique, PUIS retire les versions
/// au-delà du plafond (les plus anciennes seulement). La fiche en vigueur n'est
/// jamais touchée ici. Rend le chemin de la copie.
pub fn snapshot_fiche(fiche_dir: &Path, millis: i64) -> Result<PathBuf, String> {
    let dir = fiche_dir.join(HISTORY_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| format!("historique inutilisable : {}", e))?;
    let source = fiche_dir.join(FICHE_FILE);
    let brut = std::fs::read_to_string(&source).map_err(|e| format!("fiche illisible : {}", e))?;
    let copie = dir.join(history_file_name(millis));
    std::fs::write(&copie, brut).map_err(|e| format!("copie impossible : {}", e))?;
    // Plafond : on retire les plus ANCIENNES versions, jamais la fiche en vigueur.
    let fichiers = history_files(fiche_dir);
    let exces = history_excess(fichiers.len());
    for ancien in fichiers.iter().take(exces) {
        let _ = std::fs::remove_file(ancien);
    }
    Ok(copie)
}

/// ÉCRIT les champs décidés dans `fiche.json` du personnage, en préservant
/// TOUT le reste (nom, identifiant, palier, description visuelle, portrait,
/// champs inconnus). La version précédente est copiée AVANT (§ 4.4).
pub fn apply_writes(
    fiche_dir: &Path,
    writes: &[(String, String)],
    millis: i64,
) -> Result<(), String> {
    let chemin = fiche_dir.join(FICHE_FILE);
    let mut valeur = lire_fiche_json(&chemin)
        .ok_or_else(|| "fiche illisible : rien n'a été écrit".to_string())?;
    let Some(objet) = valeur.as_object_mut() else {
        return Err("fiche illisible : rien n'a été écrit".to_string());
    };
    for (cle, contenu) in writes {
        if !CONTENT_FIELDS.contains(&cle.as_str()) {
            continue;
        }
        objet.insert(cle.clone(), Value::String(contenu.clone()));
    }
    let texte = serde_json::to_string_pretty(&valeur)
        .map_err(|e| format!("fiche non sérialisable : {}", e))?;
    // Copie de sécurité AVANT l'écriture : une écriture qui échoue laisse
    // quand même la version d'avant sur le disque.
    snapshot_fiche(fiche_dir, millis)?;
    std::fs::write(&chemin, texte).map_err(|e| format!("écriture impossible : {}", e))?;
    Ok(())
}

/// Retour à la version précédente (§ 4.4) : la fiche en vigueur ET la version la
/// plus récente de l'historique s'échangent. Un second appel revient donc en
/// avant, et rien n'est perdu.
pub fn rollback_fiche(fiche_dir: &Path, millis: i64) -> Result<bool, String> {
    let versions = history_files(fiche_dir);
    let Some(derniere) = versions.last().cloned() else {
        return Ok(false);
    };
    let precedent = std::fs::read_to_string(&derniere)
        .map_err(|e| format!("version précédente illisible : {}", e))?;
    if serde_json::from_str::<Value>(&precedent).is_err() {
        return Err("version précédente illisible : rien n'a été changé".to_string());
    }
    let chemin = fiche_dir.join(FICHE_FILE);
    let actuelle = std::fs::read_to_string(&chemin).map_err(|e| format!("fiche illisible : {}", e))?;
    // L'état actuel part dans l'historique (sous un nom neuf), puis la version
    // précédente PREND SA PLACE : l'échange est réversible par le même geste.
    let dir = fiche_dir.join(HISTORY_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| format!("historique inutilisable : {}", e))?;
    let mut nom = history_file_name(millis);
    let mut n = 1;
    while dir.join(&nom).exists() {
        nom = history_file_name(millis + n);
        n += 1;
    }
    std::fs::write(dir.join(&nom), &actuelle).map_err(|e| format!("copie impossible : {}", e))?;
    std::fs::remove_file(&derniere).map_err(|e| format!("version précédente non retirée : {}", e))?;
    std::fs::write(&chemin, precedent).map_err(|e| format!("écriture impossible : {}", e))?;
    let fichiers = history_files(fiche_dir);
    let exces = history_excess(fichiers.len());
    for ancien in fichiers.iter().take(exces) {
        let _ = std::fs::remove_file(ancien);
    }
    Ok(true)
}

/// Issue d'une écriture, prête pour l'écran et pour le compte rendu au modèle.
pub struct WriteResult {
    pub outcome: WriteOutcome,
    /// Vrai si la valeur écrite doit être portée à la trace de provenance.
    pub author_updates: Vec<(String, String)>,
}

/// DÉCIDE puis ÉCRIT. `vocal` : aucune question, la modification d'un passage du
/// propriétaire est abandonnée (§ 4.5) et `force` est ignoré.
#[allow(clippy::too_many_arguments)]
pub fn write_from_proposal(
    root: &Path,
    persona_name: &str,
    authors: &HashMap<String, String>,
    proposal: &[(String, String)],
    force: bool,
    vocal: bool,
    millis: i64,
) -> WriteResult {
    let fiche = read_fiche(root, Some(persona_name));
    if fiche.kind == FicheKind::Gestion {
        return WriteResult {
            outcome: WriteOutcome::NoFiche,
            author_updates: Vec::new(),
        };
    }
    let Some(dir) = fiche.dir.clone() else {
        return WriteResult {
            outcome: WriteOutcome::NoFiche,
            author_updates: Vec::new(),
        };
    };
    let decision = decide_write(&fiche, authors, proposal, force && !vocal);
    let mut outcome = WriteOutcome::Nothing;
    if !decision.writes.is_empty() {
        match apply_writes(&dir, &decision.writes, millis) {
            Ok(()) => outcome = WriteOutcome::Written(decision.writes.iter().map(|(k, _)| k.clone()).collect()),
            Err(e) => {
                return WriteResult {
                    outcome: WriteOutcome::Failed(e),
                    author_updates: Vec::new(),
                }
            }
        }
    }
    if !decision.protected.is_empty() {
        outcome = WriteOutcome::OwnerProtected(decision.protected.clone());
    }
    WriteResult {
        outcome,
        author_updates: author_updates(&decision.writes),
    }
}

// ─────────────────────────── Commandes Tauri ──────────────────────────────────

fn racine_presences(app: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager as _;
    let home = app.path().home_dir().ok();
    presences_root_from_env(home.as_deref())
}

/// État complet du mode pour l'écran (Options + pastille de l'onglet). Source
/// unique : les phrases viennent de Rust, jamais recopiées en JavaScript.
/// FAIL-OPEN : toute panne rend « inactif », donc le comportement habituel.
#[tauri::command]
pub fn discussion_seule_state(app: tauri::AppHandle, state: tauri::State<AppState>) -> Value {
    let identite = crate::persona::read_active_persona_identity(&app);
    let nom = identite.name.clone();
    let carte = {
        let cfg = state.config.lock().unwrap();
        cfg.character_conversation_only.clone()
    };
    let actif = discussion_seule::is_active(&carte, nom.as_deref());
    let fiche = match racine_presences(&app) {
        Some(root) => read_fiche(&root, nom.as_deref()),
        None => FicheEtat::absente(nom.as_deref().unwrap_or("")),
    };
    json!({
        "persona": nom.clone().unwrap_or_default(),
        "fiche_name": fiche.name.clone(),
        "active": actif,
        "fiche": fiche.kind.as_str(),
        "has_previous": fiche.has_previous,
        "notice": fiche.notice(),
        "options_line": fiche.options_line(),
        "badge": discussion_seule::BADGE_LABEL,
        // Phrases et repères du mode : servis par la source unique Rust, jamais
        // recopiés dans la fenêtre.
        "config_key": discussion_seule::CONVERSATION_ONLY_KEY,
        "refusal_text": discussion_seule::refusal_sentence(false),
        "refusal_vocal": discussion_seule::refusal_sentence(true),
        "no_local_model": discussion_seule::NO_LOCAL_MODEL_SENTENCE,
        "work_refusal": discussion_seule::WORK_TOOL_REFUSAL,
        "waiting_line": discussion_seule::WAITING_LINE,
        "waiting_notice_ms": discussion_seule::WAITING_NOTICE_MS,
        "waiting_timeout_ms": discussion_seule::WAITING_TIMEOUT_MS,
        "partial_stop_line": discussion_seule::PARTIAL_STOP_LINE,
        "disabled_line": discussion_seule::PERSONA_DISABLED_LINE,
        "fiche_tool": discussion_seule::FICHE_TOOL_NAME,
        "fiche_sentinel": discussion_seule::FICHE_SENTINEL,
        // Ligne grise du CHANGEMENT de personnage (§3.4) : vide sans personnage.
        "persona_line": discussion_seule::persona_switch_line(
            nom.as_deref().unwrap_or(""),
        ),
    })
}

/// Coche / décoche la case pour UN personnage (clé = son nom). Persisté dans la
/// configuration ; désactiver RETIRE l'entrée au lieu d'écrire `false`.
#[tauri::command]
pub fn set_discussion_seule(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    name: String,
    active: bool,
) -> Result<Value, String> {
    {
        let mut cfg = state.config.lock().unwrap();
        discussion_seule::set_state(&mut cfg.character_conversation_only, &name, active);
        crate::save_config_disk(&app, &cfg)?;
    }
    Ok(discussion_seule_state(app, state))
}

/// ÉCRITURE de la fiche par le personnage (outil `ecrire_ma_fiche`). Rend le
/// compte rendu destiné au MODÈLE, jamais une erreur technique brute.
#[tauri::command]
pub fn persona_fiche_write(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    payload: String,
    vocal: bool,
    // Personnage qui a DEMANDÉ l'écriture (nom capté par l'écran au moment de
    // l'envoi). Il permet de reconnaître le cas « personnage désactivé pendant
    // l'écriture » (§4.6) : plus de personnage, donc rien n'est écrit du tout.
    persona: Option<String>,
) -> String {
    let Some(root) = racine_presences(&app) else {
        return report_text(&WriteOutcome::Failed("dossier introuvable".to_string()), vocal);
    };
    let nom = crate::persona::read_active_persona_identity(&app)
        .name
        .unwrap_or_default();
    if persona_gone_since_request(persona.as_deref().unwrap_or(""), &nom) {
        return report_text(&WriteOutcome::CharGone, vocal);
    }
    if nom.trim().is_empty() {
        return report_text(&WriteOutcome::NoFiche, vocal);
    }
    let valeur: Value = match serde_json::from_str(&payload) {
        Ok(v) => v,
        Err(_) => {
            return report_text(
                &WriteOutcome::Failed("demande illisible".to_string()),
                vocal,
            )
        }
    };
    let force = valeur.get("force").and_then(|v| v.as_bool()).unwrap_or(false);
    let proposition: Vec<(String, String)> = CONTENT_FIELDS
        .iter()
        .filter_map(|cle| {
            valeur
                .get(*cle)
                .and_then(|v| v.as_str())
                .map(|v| (cle.to_string(), v.to_string()))
        })
        .collect();
    let authors = {
        let cfg = state.config.lock().unwrap();
        cfg.character_fiche_authors
            .iter()
            .find(|(k, _)| k.trim().eq_ignore_ascii_case(nom.trim()))
            .map(|(_, v)| v.clone())
            .unwrap_or_default()
    };
    let resultat = write_from_proposal(
        &root,
        &nom,
        &authors,
        &proposition,
        force,
        vocal,
        chrono::Local::now().timestamp_millis(),
    );
    // Trace de provenance : ce que le personnage a écrit lui-même (ADDITIF, dans
    // la configuration de Pilot — jamais dans le dossier de Présences).
    if !resultat.author_updates.is_empty() {
        let mut cfg = state.config.lock().unwrap();
        let entree = cfg
            .character_fiche_authors
            .entry(nom.trim().to_string())
            .or_default();
        for (cle, valeur) in &resultat.author_updates {
            entree.insert(cle.clone(), valeur.clone());
        }
        if let Err(e) = crate::save_config_disk(&app, &cfg) {
            eprintln!("[discussion seule] provenance non enregistrée : {}", e);
        }
    }
    report_text(&resultat.outcome, vocal)
}

/// RETOUR EN ARRIÈRE depuis les Options (§ 4.4) : la version précédente revient,
/// l'état actuel part dans l'historique. Un second clic revient en avant.
#[tauri::command]
pub fn persona_fiche_rollback(app: tauri::AppHandle) -> Result<Value, String> {
    let Some(root) = racine_presences(&app) else {
        return Err("Dossier de Présences introuvable : rien n'a changé.".to_string());
    };
    let nom = crate::persona::read_active_persona_identity(&app)
        .name
        .unwrap_or_default();
    let fiche = read_fiche(&root, Some(nom.as_str()));
    let Some(dir) = fiche.dir else {
        return Err("Aucune fiche pour ce personnage : rien n'a changé.".to_string());
    };
    let fait = rollback_fiche(&dir, chrono::Local::now().timestamp_millis())?;
    if !fait {
        return Err("Aucune version précédente : rien n'a changé.".to_string());
    }
    let apres = read_fiche(&root, Some(nom.as_str()));
    Ok(json!({
        "restored": true,
        "has_previous": apres.has_previous,
        "fiche": apres.kind.as_str(),
        "notice": apres.notice(),
        "options_line": apres.options_line(),
    }))
}

#[cfg(test)]
mod tests_personnage_desactive {
    use super::*;

    /// §4.6 « personnage désactivé pendant l'écriture » : la demande nommait un
    /// personnage, il n'y en a plus (ou ce n'est plus le même) ⇒ rien n'est
    /// écrit, et la phrase est celle du document.
    #[test]
    fn un_personnage_desactive_pendant_l_ecriture_n_ecrit_rien() {
        assert!(persona_gone_since_request("Nova", ""));
        assert!(persona_gone_since_request("Nova", "Sylvie"));
        // Casse et espaces ne changent rien : c'est le MÊME personnage.
        assert!(!persona_gone_since_request(" Nova ", "nova"));
        // Une demande qui ne nomme personne ne fonde jamais ce refus (elle suit
        // le chemin « fiche absente »).
        assert!(!persona_gone_since_request("", ""));
        assert!(!persona_gone_since_request("   ", "Nova"));
    }

    #[test]
    fn la_phrase_du_personnage_desactive_est_celle_du_document() {
        let dit = report_text(&WriteOutcome::CharGone, true);
        assert!(dit.contains("Je n'ai plus de fiche à moi, je n'ai rien changé."));
        // Rien n'est promis d'autre : aucune version, aucun fichier nommé.
        assert!(!dit.contains("version"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn carte(paires: &[(&str, &str)]) -> HashMap<String, String> {
        paires
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    fn fiche_du_contrat() -> FicheEtat {
        FicheEtat::ok(
            "Sylvie",
            "une archiviste patiente",
            "douce, précise",
            "mon cher",
            "",
            "",
        )
    }

    // ── Le contrat de champs : cinq, et rien d'autre ────────────────────────
    #[test]
    fn seuls_les_cinq_champs_de_contenu_sont_ecrits() {
        let fiche = fiche_du_contrat();
        let proposal = vec![
            ("ce_qu_il_est".to_string(), "une archiviste patiente".to_string()),
            ("palier_relation".to_string(), "5".to_string()),
            ("description_visuelle".to_string(), "grande".to_string()),
            ("portrait".to_string(), "x.png".to_string()),
            ("carnet".to_string(), "souvenir".to_string()),
            ("ce_qu_il_fait".to_string(), "je range les documents".to_string()),
        ];
        let decision = decide_write(&fiche, &HashMap::new(), &proposal, false);
        assert_eq!(
            decision.writes,
            vec![(
                "ce_qu_il_fait".to_string(),
                "je range les documents".to_string()
            )]
        );
        // Le palier, la description visuelle et le portrait ne sont jamais écrits.
        assert!(decision.protected.is_empty());
    }

    // ── § 4.3 : ce que le propriétaire a écrit n'est jamais effacé ──────────
    #[test]
    fn un_passage_du_proprietaire_n_est_jamais_reecrit_sans_accord() {
        let fiche = fiche_du_contrat();
        // Aucune trace d'écriture par le personnage : tout est au propriétaire.
        let proposal = vec![("ton_et_parler".to_string(), "familière".to_string())];
        let decision = decide_write(&fiche, &HashMap::new(), &proposal, false);
        assert!(decision.writes.is_empty());
        assert_eq!(decision.protected, vec!["ton_et_parler".to_string()]);
    }

    #[test]
    fn un_passage_ecrit_par_le_personnage_peut_etre_reecrit() {
        let fiche = fiche_du_contrat();
        let authors = carte(&[("ton_et_parler", "douce, précise")]);
        let proposal = vec![("ton_et_parler".to_string(), "familière".to_string())];
        let decision = decide_write(&fiche, &authors, &proposal, false);
        assert_eq!(
            decision.writes,
            vec![("ton_et_parler".to_string(), "familière".to_string())]
        );
        assert!(decision.protected.is_empty());
    }

    #[test]
    fn un_champ_vide_s_ajoute_toujours_sans_rien_demander() {
        let fiche = fiche_du_contrat();
        let proposal = vec![
            ("ce_qu_il_ne_fait_jamais".to_string(), "je n'invente rien".to_string()),
            ("appel_du_proprietaire".to_string(), "patron".to_string()),
        ];
        let decision = decide_write(&fiche, &HashMap::new(), &proposal, false);
        assert_eq!(decision.writes.len(), 1);
        assert_eq!(decision.writes[0].0, "ce_qu_il_ne_fait_jamais");
        // `appel_du_proprietaire` est rempli (« mon cher ») et sans trace : protégé.
        assert_eq!(decision.protected, vec!["appel_du_proprietaire".to_string()]);
    }

    #[test]
    fn une_valeur_identique_n_ecrit_rien() {
        let fiche = fiche_du_contrat();
        let proposal = vec![(
            "ce_qu_il_est".to_string(),
            "une archiviste patiente".to_string(),
        )];
        let decision = decide_write(&fiche, &HashMap::new(), &proposal, false);
        assert!(decision.writes.is_empty());
        assert_eq!(decision.unchanged, vec!["ce_qu_il_est".to_string()]);
        assert!(decision.protected.is_empty());
    }

    #[test]
    fn l_accord_explicite_autorise_la_reecriture() {
        let fiche = fiche_du_contrat();
        let proposal = vec![("ton_et_parler".to_string(), "familière".to_string())];
        let decision = decide_write(&fiche, &HashMap::new(), &proposal, true);
        assert_eq!(decision.writes.len(), 1);
        assert!(decision.protected.is_empty());
    }

    #[test]
    fn une_valeur_vide_ne_supprime_rien() {
        let fiche = fiche_du_contrat();
        let proposal = vec![("ton_et_parler".to_string(), "   ".to_string())];
        let decision = decide_write(&fiche, &HashMap::new(), &proposal, true);
        assert!(decision.writes.is_empty(), "un contenu vide ne remplace jamais un passage");
    }

    #[test]
    fn une_fiche_absente_n_est_jamais_creee() {
        let fiche = FicheEtat::absente("Sylvie");
        let proposal = vec![("ce_qu_il_est".to_string(), "quelque chose".to_string())];
        let decision = decide_write(&fiche, &HashMap::new(), &proposal, true);
        assert!(decision.is_empty(), "aucune écriture décidée sur une fiche absente");
    }

    // ── Les textes de § 3.3 et § 4.5 ───────────────────────────────────────
    #[test]
    fn la_ligne_grise_est_dite_une_fois_et_jamais_sur_une_fiche_partielle() {
        let absente = FicheEtat::absente("Sylvie");
        assert_eq!(
            absente.notice(),
            Some("Ce personnage n'a pas encore de fiche : il te parle sans consigne, avec son nom.")
        );
        let vide = FicheEtat {
            kind: FicheKind::Vide,
            ..FicheEtat::absente("Sylvie")
        };
        assert_eq!(
            vide.notice(),
            Some(
                "Ce personnage n'a pas encore de fiche remplie : il te parle sans consigne, avec son nom."
            )
        );
        // Fiche incomplète (un seul champ) : aucun message, c'est un état normal.
        let partielle = FicheEtat::ok("Sylvie", "", "douce", "", "", "");
        assert_eq!(partielle.kind, FicheKind::Ok);
        assert_eq!(partielle.notice(), None);
    }

    #[test]
    fn la_ligne_des_options_suit_le_meme_contrat() {
        assert_eq!(
            FicheEtat::absente("Sylvie").options_line(),
            Some("Fiche absente — le personnage parle sans consigne.")
        );
        let vide = FicheEtat {
            kind: FicheKind::Vide,
            ..FicheEtat::absente("Sylvie")
        };
        assert_eq!(
            vide.options_line(),
            Some("Fiche vide — le personnage parle sans consigne.")
        );
        assert_eq!(fiche_du_contrat().options_line(), None);
    }

    #[test]
    fn les_trois_phrases_d_ecriture_sont_celles_de_la_conception() {
        let ecrit = report_text(&WriteOutcome::Written(vec!["ton_et_parler".to_string()]), true);
        assert!(ecrit.contains("L'ancienne version est gardée"));
        let abandon = report_text(&WriteOutcome::OwnerProtected(vec!["ton_et_parler".to_string()]), true);
        assert!(abandon.contains("Ça, c'est toi qui l'as écrit : je l'ai laissé tel quel."));
        let panne = report_text(&WriteOutcome::Failed("disque protégé".to_string()), true);
        assert!(panne.contains("restée exactement comme avant"));
    }

    #[test]
    fn a_l_ecrit_la_question_est_posee_et_l_accord_explicite_demande() {
        let texte = report_text(&WriteOutcome::OwnerProtected(vec!["ton_et_parler".to_string()]), false);
        assert!(texte.contains("Ça, c'est toi qui l'as écrit. Je le change quand même ?"));
        assert!(texte.contains("force: true"));
        // À l'oral, aucune question : la modification est abandonnée et dite.
        let oral = report_text(&WriteOutcome::OwnerProtected(vec!["ton_et_parler".to_string()]), true);
        assert!(!oral.contains("Je le change quand même"));
    }

    // ── Le bloc d'identité : la fiche, rien d'autre ────────────────────────
    #[test]
    fn le_bloc_d_identite_ne_porte_que_les_passages_remplis() {
        let bloc = fiche_du_contrat().prompt_block();
        assert!(bloc.contains("ce que je suis : une archiviste patiente"));
        assert!(bloc.contains("mon ton et ma façon de parler : douce, précise"));
        assert!(bloc.contains("comment j'appelle le propriétaire : mon cher"));
        // Les champs vides ne produisent pas de ligne.
        assert!(!bloc.contains("ce que je fais"));
        assert!(!bloc.contains("ce que je ne fais jamais"));
        // Aucune phrase de rôle de Pilot.
        assert!(!bloc.contains("multi-projets"));
        assert!(!bloc.contains("lecture seule"));
    }

    #[test]
    fn une_fiche_absente_ne_produit_aucun_bloc_d_identite() {
        assert!(FicheEtat::absente("Sylvie").prompt_block().is_empty());
    }

    // ── Historique (§ 4.4) ─────────────────────────────────────────────────
    #[test]
    fn l_historique_garde_vingt_versions() {
        assert_eq!(HISTORY_MAX, 20);
        assert_eq!(history_excess(19), 0);
        assert_eq!(history_excess(20), 0);
        assert_eq!(history_excess(23), 3);
    }

    // ── Racine de Présences ────────────────────────────────────────────────
    #[test]
    fn la_racine_par_defaut_est_dans_le_dossier_personnel() {
        let home = Path::new("/home/test");
        assert_eq!(
            presences_root(Some(home), None),
            Some(PathBuf::from("/home/test/.presences"))
        );
        // Une variable d'environnement non vide l'emporte.
        assert_eq!(
            presences_root(Some(home), Some(Path::new("/data/presences"))),
            Some(PathBuf::from("/data/presences"))
        );
        // Sans dossier personnel ni variable : rien, jamais un chemin inventé.
        assert_eq!(presences_root(None, None), None);
    }
}
