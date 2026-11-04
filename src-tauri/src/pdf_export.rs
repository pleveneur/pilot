// pdf_export.rs — Conversion Markdown → PDF SANS AUCUNE fenêtre d'impression.
//
// PROBLÈME RÉSOLU (signalé par le propriétaire) : demander la conversion d'un
// Markdown en PDF passait par l'aperçu + la fenêtre d'impression du système
// (modale, bouton « Fermer » désactivé pendant l'attente, application figée) et
// aucun outil n'était exposé aux agents — « demander la conversion à l'agent »
// ne pouvait donc rien produire.
//
// CE QUE FAIT CE MODULE : il ÉCRIT un vrai fichier PDF sur le disque, à côté du
// Markdown (ou dans un dossier demandé), sans fenêtre, sans dialogue, sans
// passer par l'impression. Le moteur d'affichage du système n'est PAS sollicité
// (aucune API d'impression, aucun WebView) : la mise en page est faite ici, en
// Rust pur, avec les composants DÉJÀ embarqués (`pulldown-cmark` pour lire le
// Markdown, `flate2` déjà présent pour les images PNG). Aucune dépendance
// nouvelle à télécharger, aucune plateforme privilégiée : Windows, macOS et
// Linux produisent le MÊME fichier, par le MÊME chemin.
//
// FIL D'EXÉCUTION : la commande est `pub async fn` et déporte tout son travail
// dans `tauri::async_runtime::spawn_blocking` (patron déjà en place et verrouillé
// par `src/js/commandes-agent-non-bloquantes.test.js`). Une écriture lente ne
// gèle donc jamais l'interface — y compris pour un document contenant des
// images (la lecture/décodage des images se fait dans le même travail déporté).
//
// LOT DE FICHIERS : plusieurs sources sont traitées UNE PAR UNE ; l'échec d'une
// source n'annule jamais les autres (le rapport dit ce qui a été produit et ce
// qui a échoué).
//
// LIMITE DITE HONNÊTEMENT : les images JPEG et PNG (8 bits, non entrelacées)
// sont incorporées au PDF ; tout autre format (WebP, SVG, GIF, PNG 16 bits ou
// entrelacé, CMYK…) n'est pas décodable ici et apparaît comme une LIGNE DE
// TEXTE visible qui nomme le fichier omis — jamais un blocage, jamais un
// document silencieusement amputé.

use std::io::Write as _;
use std::path::{Path, PathBuf};

use pulldown_cmark::{CodeBlockKind, Event, Options, Parser, Tag, TagEnd};

// ── Géométrie de page (A4, en points PostScript : 1 pt = 1/72 pouce) ──
const PAGE_W: f32 = 595.276;
const PAGE_H: f32 = 841.89;
const MARGIN_X: f32 = 56.0;
const MARGIN_TOP: f32 = 56.0;
const MARGIN_BOTTOM: f32 = 56.0;
const CONTENT_W: f32 = PAGE_W - 2.0 * MARGIN_X;

const BODY_SIZE: f32 = 10.5;
const BODY_LEADING: f32 = 15.0;
const CODE_SIZE: f32 = 9.0;
const CODE_LEADING: f32 = 12.0;

/// Taille maximale d'une image incorporée (au-delà : ligne de texte visible).
const MAX_IMAGE_BYTES: u64 = 12 * 1024 * 1024;

/// `true` si le contenu commence par la signature d'un PDF.
pub fn has_pdf_signature(bytes: &[u8]) -> bool {
    bytes.starts_with(b"%PDF-")
}

// ─────────────────────────────────────────────────────────────────────────────
// Polices (base 14, aucune incorporation de fonte nécessaire)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Font {
    Regular,
    Bold,
    Italic,
    Mono,
}

impl Font {
    fn resource_name(self) -> &'static str {
        match self {
            Font::Regular => "F1",
            Font::Bold => "F2",
            Font::Italic => "F3",
            Font::Mono => "F4",
        }
    }

    fn base_font(self) -> &'static str {
        match self {
            Font::Regular => "Helvetica",
            Font::Bold => "Helvetica-Bold",
            Font::Italic => "Helvetica-Oblique",
            Font::Mono => "Courier",
        }
    }
}

/// Largeur approximative d'un caractère en fraction de cadratin.
///
/// Les tables de largeur des polices base 14 ne sont pas embarquées ici : on
/// utilise une table PAR CLASSE de caractères, fidèle à ±10 % pour Helvetica.
/// Conséquence assumée (dite dans le rapport) : la justification est approchée,
/// le texte n'est jamais coupé au milieu d'un mot.
/// Largeurs RÉELLES de Helvetica (fichier AFM, en 1/1000 d'em) pour les
/// caractères ASCII 32 → 126. Une largeur approximée par classe décalait le texte
/// de quelques points après chaque changement de style (« de l' italique »).
const HELVETICA_WIDTHS: [u16; 95] = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, // ' '..'/'
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, // '0'..'?'
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, // '@'..'O'
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, // 'P'..'_'
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, // '`'..'o'
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, // 'p'..'~'
];

/// Largeurs RÉELLES de Helvetica-Bold (même ordre).
const HELVETICA_BOLD_WIDTHS: [u16; 95] = [
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, //
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, //
    975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, //
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, //
    333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, //
    611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, //
];

fn char_factor(c: char, font: Font) -> f32 {
    if font == Font::Mono {
        // Courier est à chasse fixe : 600/1000 pour TOUS les caractères.
        return 0.6;
    }
    let cp = c as u32;
    if (0x20..=0x7e).contains(&cp) {
        let i = (cp - 0x20) as usize;
        let w = if font == Font::Bold {
            HELVETICA_BOLD_WIDTHS[i]
        } else {
            HELVETICA_WIDTHS[i]
        };
        return w as f32 / 1000.0;
    }
    // Hors ASCII (accents WinAnsi, ponctuation typographique) : largeurs des
    // polices base 14, autant que possible exactes. Elles ne servent QU'AU
    // découpage en lignes et aux centrages : la position du texte dans le PDF
    // est celle que le moteur calcule lui-même (une seule ligne = un seul objet
    // texte), donc une imprécision ici ne colle jamais deux mots.
    let bold = font == Font::Bold;
    match c {
        // Latin-1 : lettres accentuées (les mêmes largeurs que leur base).
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'è' | 'é' | 'ê' | 'ë' | 'ò' | 'ó'
        | 'ô' | 'õ' | 'ö' | 'ù' | 'ú' | 'û' | 'ü' | 'ñ' => 0.556,
        'ì' | 'í' | 'î' | 'ï' => 0.278,
        'ç' => {
            if bold {
                0.556
            } else {
                0.5
            }
        }
        'ý' => {
            if bold {
                0.556
            } else {
                0.5
            }
        }
        'ÿ' => {
            if bold {
                0.556
            } else {
                0.5
            }
        }
        'À' | 'Á' | 'Â' | 'Ã' | 'Ä' | 'Å' | 'È' | 'É' | 'Ê' | 'Ë' => {
            if bold {
                0.722
            } else {
                0.667
            }
        }
        'Ì' | 'Í' | 'Î' | 'Ï' => 0.278,
        'Ò' | 'Ó' | 'Ô' | 'Õ' | 'Ö' | 'Ù' | 'Ú' | 'Û' | 'Ü' => 0.778,
        'Ý' => 0.667,
        'Ñ' => 0.722,
        // Ponctuation et symboles WinAnsi.
        '«' | '»' => 0.556,
        '·' => 0.278,
        '°' => 0.4,
        '±' | '×' | '÷' => 0.584,
        '§' | '¶' => 0.556,
        '©' | '®' => 0.737,
        '™' | '‰' | '\u{2026}' | '—' | 'Œ' => 1.0,
        '–' => 0.556,
        '•' => 0.35,
        '€' => 0.556,
        'œ' => {
            if bold {
                0.611
            } else {
                0.944
            }
        }
        '\u{2018}' | '\u{2019}' => {
            if bold {
                0.278
            } else {
                0.222
            }
        }
        '\u{201C}' | '\u{201D}' | '¨' | '´' | '¸' | 'ˆ' | '˜' | '¯' => 0.333,
        _ => 0.556,
    }
}

fn text_width(text: &str, size: f32, font: Font) -> f32 {
    text.chars().map(|c| char_factor(c, font)).sum::<f32>() * size
}

// ─────────────────────────────────────────────────────────────────────────────
// Encodage WinAnsi (le PDF écrit des OCTETS, pas de l'UTF-8)
// ─────────────────────────────────────────────────────────────────────────────

/// Traduit un caractère en octet WinAnsi (l'encodage des polices base 14
/// déclarées avec `/Encoding /WinAnsiEncoding`). `None` = WinAnsi ne sait pas
/// l'écrire : l'appelant décide alors entre un repli ASCII et `?` — jamais un
/// octet inventé qui casserait le fichier.
fn winansi_byte(c: char) -> Option<u8> {
    let cp = c as u32;
    if (0x20..=0x7E).contains(&cp) || (0xA0..=0xFF).contains(&cp) {
        return Some(cp as u8);
    }
    // Formes pleine chasse (U+FF01..U+FF5E) : le caractère ASCII équivalent.
    if (0xFF01..=0xFF5E).contains(&cp) {
        return Some((cp - 0xFEE0) as u8);
    }
    let byte = match c {
        '\t' => b' ',
        '\n' | '\r' => b' ',
        '€' => 0x80,
        '‚' => 0x82,
        'ƒ' => 0x83,
        '„' => 0x84,
        '…' => 0x85,
        '†' => 0x86,
        '‡' => 0x87,
        'ˆ' => 0x88,
        '‰' => 0x89,
        'Š' => 0x8A,
        '‹' => 0x8B,
        'Œ' => 0x8C,
        'Ž' => 0x8E,
        '‘' => 0x91,
        '’' => 0x92,
        '“' => 0x93,
        '”' => 0x94,
        '•' => 0x95,
        '–' => 0x96,
        '—' => 0x97,
        '˜' => 0x98,
        '™' => 0x99,
        'š' => 0x9A,
        '›' => 0x9B,
        'œ' => 0x9C,
        'ž' => 0x9E,
        'Ÿ' => 0x9F,
        // Repli VOLONTAIRE et visible : quelques caractères typographiques qui ont
        // un équivalent ASCII honnête. Le lecteur du PDF voit le sens conservé.
        '→' | '⇒' => b'>',
        '←' | '⇐' => b'<',
        '↔' => b'-',
        '≈' => b'~',
        'ℓ' => b'l',
        _ => return None,
    };
    Some(byte)
}

/// Un caractère que WinAnsi ne peut pas écrire et qui n'apporte pas de sens au
/// texte (émojis, pictogrammes, sélecteurs de variante) est RETIRÉ plutôt que
/// rendu par un « ? » : c'est déjà la règle du projet pour le texte lu à voix
/// haute (`speech-text.js`). Aucune lettre, aucun chiffre n'est jamais retiré.
fn est_decoratif(c: char) -> bool {
    matches!(c as u32,
        0xFE00..=0xFE0F      // sélecteurs de variante (ex. « ⚙️ »)
        | 0x200D            // liant d'émoji
        | 0x20E3            // touche combinatoire
        | 0x2300..=0x23FF   // ⌘ ⌛ …
        | 0x2500..=0x27BF   // dessins de cadre, dingbats, ✅ ❓ ⚙ ✨
        | 0x2B00..=0x2BFF   // ⬛ ⭐ …
        | 0x1F000..=0x1FAFF // émojis
    )
}

#[cfg(test)]
fn winansi_bytes(text: &str) -> Vec<u8> {
    text.chars()
        .map(|c| winansi_byte(c).unwrap_or(b'?'))
        .collect()
}

/// Chaîne littérale PDF : parenthèses et antislash échappés, octets WinAnsi
/// conservés tels quels (chaque octet ≥ 0x80 est porté par un `char` de même
/// valeur, puis reconverti à l'écriture — voir [`string_to_bytes`]).
fn pdf_string(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('(');
    for c in text.chars() {
        if c as u32 > 0xFF && est_decoratif(c) {
            continue; // émoji : retiré, jamais un « ? » au milieu d'une phrase
        }
        // La lettre grecque π (nom de l'onglet de l'agent Pi) n'existe dans aucune
        // police base 14 : elle est écrite « pi », sans perdre le sens.
        if c == 'π' || c == 'Π' {
            out.push_str("pi");
            continue;
        }
        match winansi_byte(c) {
            Some(b'(') => out.push_str("\\("),
            Some(b')') => out.push_str("\\)"),
            Some(b'\\') => out.push_str("\\\\"),
            Some(b) if b < 0x20 => out.push(' '),
            Some(b) => out.push(b as char),
            None => out.push('?'),
        }
    }
    out.push(')');
    out
}

/// Reconstitue les OCTETS d'un contenu PDF : les caractères < 256 sont des
/// octets WinAnsi portés tels quels.
fn string_to_bytes(text: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len());
    for c in text.chars() {
        let cp = c as u32;
        out.push(if cp < 256 { cp as u8 } else { b'?' });
    }
    out
}

fn num(v: f32) -> String {
    format!("{:.2}", v)
}

// ─────────────────────────────────────────────────────────────────────────────
// Analyse du Markdown → blocs de rendu
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
struct Run {
    text: String,
    font: Font,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum TokKind {
    Word,
    Space,
    Break,
}

#[derive(Clone, Debug)]
struct Tok {
    text: String,
    font: Font,
    kind: TokKind,
}

#[derive(Debug)]
enum Block {
    Heading(u8, Vec<Run>),
    Para(Vec<Run>),
    Quote(Vec<Run>),
    Item {
        depth: usize,
        marker: String,
        runs: Vec<Run>,
    },
    Code(String),
    Rule,
    Image {
        path: String,
        alt: String,
    },
    TableRow {
        header: bool,
        cells: Vec<Vec<Run>>,
    },
}

fn push_run(runs: &mut Vec<Run>, text: &str, font: Font) {
    if text.is_empty() {
        return;
    }
    if let Some(last) = runs.last_mut() {
        if last.font == font {
            last.text.push_str(text);
            return;
        }
    }
    runs.push(Run {
        text: text.to_string(),
        font,
    });
}

fn font_of(bold: u32, italic: u32) -> Font {
    if bold > 0 {
        Font::Bold
    } else if italic > 0 {
        Font::Italic
    } else {
        Font::Regular
    }
}

fn markdown_options() -> Options {
    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_TABLES);
    opts.insert(Options::ENABLE_STRIKETHROUGH);
    opts.insert(Options::ENABLE_TASKLISTS);
    opts.insert(Options::ENABLE_FOOTNOTES);
    // Pas de « smart punctuation » : les guillemets typographiques ne sont pas
    // nécessaires et compliquent l'encodage WinAnsi.
    opts
}

/// Analyse un Markdown en blocs de rendu (fonction PURE, aucun accès disque).
fn parse_blocks(md: &str) -> Vec<Block> {
    let mut blocks: Vec<Block> = Vec::new();
    let mut runs: Vec<Run> = Vec::new();
    let mut bold = 0u32;
    let mut italic = 0u32;
    let mut heading: Option<u8> = None;
    let mut lists: Vec<Option<u64>> = Vec::new();
    // Pile des items OUVERTS : l'indice de leur bloc dans `blocks`. Le bloc est
    // posé dès `Tag::Item` pour que l'ordre du document soit respecté (un item
    // parent apparaît AVANT ses sous-items) ; son texte y est versé ensuite.
    let mut item_idx: Vec<usize> = Vec::new();
    let mut code: Option<String> = None;
    let mut in_table = false;
    let mut in_head = false;
    let mut row: Vec<Vec<Run>> = Vec::new();
    let mut cell: Vec<Run> = Vec::new();
    let mut quote = 0usize;
    let mut in_metadata = false;
    let mut image: Option<(String, String)> = None;

    for event in Parser::new_ext(md, markdown_options()) {
        match event {
            Event::Start(Tag::Heading { level, .. }) => {
                heading = Some(match level {
                    pulldown_cmark::HeadingLevel::H1 => 1,
                    pulldown_cmark::HeadingLevel::H2 => 2,
                    pulldown_cmark::HeadingLevel::H3 => 3,
                    pulldown_cmark::HeadingLevel::H4 => 4,
                    pulldown_cmark::HeadingLevel::H5 => 5,
                    pulldown_cmark::HeadingLevel::H6 => 6,
                });
                runs.clear();
            }
            Event::End(TagEnd::Heading(_)) => {
                let level = heading.take().unwrap_or(2);
                blocks.push(Block::Heading(level, std::mem::take(&mut runs)));
            }
            Event::Start(Tag::Paragraph) => runs.clear(),
            Event::End(TagEnd::Paragraph) => {
                if !runs.is_empty() {
                    if let Some(idx) = item_idx.last().copied() {
                        // Dans une liste, le texte appartient à l'ITEM en cours : le
                        // pousser ici en ferait un paragraphe sans puce.
                        append_runs_to_item(&mut blocks, idx, &mut runs);
                    } else if quote > 0 {
                        blocks.push(Block::Quote(std::mem::take(&mut runs)));
                    } else {
                        blocks.push(Block::Para(std::mem::take(&mut runs)));
                    }
                }
            }
            Event::Start(Tag::BlockQuote(_)) => quote += 1,
            Event::End(TagEnd::BlockQuote(_)) => quote = quote.saturating_sub(1),
            Event::Start(Tag::CodeBlock(kind)) => {
                let mut buffer = String::new();
                if let CodeBlockKind::Fenced(lang) = &kind {
                    let l = lang.trim();
                    if !l.is_empty() && l.len() <= 24 {
                        buffer.push_str(&format!("// {}\n", l));
                    }
                }
                code = Some(buffer);
            }
            Event::End(TagEnd::CodeBlock) => {
                let text = code.take().unwrap_or_default();
                blocks.push(Block::Code(text.trim_end_matches('\n').to_string()));
            }
            Event::Start(Tag::List(first)) => lists.push(first),
            Event::End(TagEnd::List(_)) => {
                lists.pop();
            }
            Event::Start(Tag::Item) => {
                // Le texte déjà lu appartient à l'item PARENT : on le verse dans son
                // bloc avant d'ouvrir le suivant (sinon « - a » suivi d'un sous-item
                // perdait le texte de « a »).
                if let Some(idx) = item_idx.last().copied() {
                    append_runs_to_item(&mut blocks, idx, &mut runs);
                }
                runs.clear();
                let depth = lists.len().max(1);
                let marker = match lists.last_mut() {
                    Some(Some(n)) => {
                        let m = format!("{}.", n);
                        *n += 1;
                        m
                    }
                    _ => "•".to_string(),
                };
                blocks.push(Block::Item {
                    depth,
                    marker,
                    runs: Vec::new(),
                });
                item_idx.push(blocks.len() - 1);
            }
            Event::End(TagEnd::Item) => {
                if let Some(idx) = item_idx.pop() {
                    // Ce qui reste dans `runs` = le texte d'une liste SERRÉE (sans
                    // balise de paragraphe).
                    append_runs_to_item(&mut blocks, idx, &mut runs);
                }
            }
            Event::Start(Tag::Table(_)) => in_table = true,
            Event::End(TagEnd::Table) => in_table = false,
            Event::Start(Tag::TableHead) => {
                in_head = true;
                row.clear();
            }
            // pulldown-cmark ne ferme PAS de `TableRow` pour l'en-tête : il émet
            // les cellules directement entre `TableHead` et sa fin. Sans ce push,
            // l'en-tête du tableau DISPARAÎT du PDF.
            Event::End(TagEnd::TableHead) => {
                in_head = false;
                if !row.is_empty() {
                    blocks.push(Block::TableRow {
                        header: true,
                        cells: std::mem::take(&mut row),
                    });
                }
            }
            Event::Start(Tag::TableRow) => row.clear(),
            Event::End(TagEnd::TableRow) => blocks.push(Block::TableRow {
                header: in_head,
                cells: std::mem::take(&mut row),
            }),
            Event::Start(Tag::TableCell) => cell.clear(),
            Event::End(TagEnd::TableCell) => row.push(std::mem::take(&mut cell)),
            Event::Start(Tag::Image { dest_url, .. }) => {
                image = Some((dest_url.to_string(), String::new()));
            }
            Event::End(TagEnd::Image) => {
                if let Some((path, alt)) = image.take() {
                    blocks.push(Block::Image { path, alt });
                }
            }
            Event::Start(Tag::Strong) => bold += 1,
            Event::End(TagEnd::Strong) => bold = bold.saturating_sub(1),
            Event::Start(Tag::Emphasis) => italic += 1,
            Event::End(TagEnd::Emphasis) => italic = italic.saturating_sub(1),
            Event::Start(Tag::MetadataBlock(_)) => in_metadata = true,
            Event::End(TagEnd::MetadataBlock(_)) => in_metadata = false,
            Event::Text(text) => {
                if in_metadata {
                    continue;
                }
                if let Some((_, alt)) = image.as_mut() {
                    alt.push_str(&text);
                } else if let Some(buffer) = code.as_mut() {
                    // Le contenu d'un bloc de code est du TEXTE BRUT : il va dans le
                    // tampon du bloc. Il partait auparavant dans les `runs` du
                    // paragraphe, et le code était PERDU à l'écriture du PDF.
                    buffer.push_str(&text);
                } else if in_table {
                    push_run(&mut cell, &text, font_of(bold, italic));
                } else {
                    push_run(&mut runs, &text, font_of(bold, italic));
                }
            }
            Event::Code(text) => {
                let font = Font::Mono;
                if in_table {
                    push_run(&mut cell, &text, font);
                } else {
                    push_run(&mut runs, &text, font);
                }
            }
            Event::SoftBreak => push_run(&mut runs, " ", font_of(bold, italic)),
            Event::HardBreak => push_run(&mut runs, "\n", font_of(bold, italic)),
            Event::Rule => blocks.push(Block::Rule),
            Event::TaskListMarker(checked) => {
                let mark = if checked { "[x] " } else { "[ ] " };
                push_run(&mut runs, mark, Font::Regular);
            }
            Event::FootnoteReference(name) => {
                push_run(&mut runs, &format!("[{}]", name), Font::Regular);
            }
            Event::InlineMath(text) | Event::DisplayMath(text) => {
                push_run(&mut runs, &text, Font::Mono);
            }
            Event::Html(_) | Event::InlineHtml(_) => {}
            // Tout autre élément structurel (lien, définition de note, bloc
            // HTML, liste de définitions) n'ouvre pas de bloc propre : le
            // texte qu'il contient est déjà capté par `Event::Text`.
            Event::Start(_) | Event::End(_) => {}
        }
    }

    // Un paragraphe non fermé (Markdown tronqué) ne doit rien perdre.
    if !runs.is_empty() {
        match item_idx.last().copied() {
            Some(idx) => append_runs_to_item(&mut blocks, idx, &mut runs),
            None => blocks.push(Block::Para(std::mem::take(&mut runs))),
        }
    }
    // Un item vide (son texte est déjà dans ses sous-items) ne produit AUCUNE
    // puce orpheline.
    blocks.retain(|b| !matches!(b, Block::Item { runs, .. } if runs.is_empty()));
    blocks
}

/// Verse le texte en cours dans le bloc de l'item ouvert `idx`, en séparant deux
/// paragraphes d'un espace. Sans item ouvert, le texte reste dans `runs`.
fn append_runs_to_item(blocks: &mut [Block], idx: usize, runs: &mut Vec<Run>) {
    if runs.is_empty() {
        return;
    }
    if let Some(Block::Item { runs: item, .. }) = blocks.get_mut(idx) {
        if !item.is_empty() {
            push_run(item, " ", Font::Regular);
        }
        for run in runs.drain(..) {
            push_run(item, &run.text, run.font);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Découpage en lignes
// ─────────────────────────────────────────────────────────────────────────────

fn tokenize(runs: &[Run]) -> Vec<Tok> {
    let mut out: Vec<Tok> = Vec::new();
    for run in runs {
        let mut word = String::new();
        let flush = |word: &mut String, out: &mut Vec<Tok>| {
            if !word.is_empty() {
                out.push(Tok {
                    text: std::mem::take(word),
                    font: run.font,
                    kind: TokKind::Word,
                });
            }
        };
        for c in run.text.chars() {
            match c {
                '\n' => {
                    flush(&mut word, &mut out);
                    out.push(Tok {
                        text: String::new(),
                        font: run.font,
                        kind: TokKind::Break,
                    });
                }
                ' ' => {
                    flush(&mut word, &mut out);
                    out.push(Tok {
                        text: " ".to_string(),
                        font: run.font,
                        kind: TokKind::Space,
                    });
                }
                '\t' => {
                    flush(&mut word, &mut out);
                    out.push(Tok {
                        text: "    ".to_string(),
                        font: run.font,
                        kind: TokKind::Space,
                    });
                }
                _ => word.push(c),
            }
        }
        flush(&mut word, &mut out);
    }
    out
}

fn merge_line(toks: &[Tok]) -> Vec<Run> {
    let mut runs: Vec<Run> = Vec::new();
    for tok in toks {
        if tok.kind == TokKind::Break {
            continue;
        }
        push_run(&mut runs, &tok.text, tok.font);
    }
    // Pas d'espace en fin de ligne (il décalerait le texte sans raison).
    if let Some(last) = runs.last_mut() {
        while last.text.ends_with(' ') {
            last.text.pop();
        }
    }
    runs.retain(|r| !r.text.is_empty());
    runs
}

/// Découpe une suite de `Run` en lignes tenant dans `width`. Aucun mot n'est
/// coupé sauf s'il est plus large que la ligne entière (alors coupé aux
/// caractères) — jamais de boucle infinie : chaque passage consomme au moins un
/// caractère.
fn wrap_runs(runs: &[Run], size: f32, width: f32) -> Vec<Vec<Run>> {
    let width = width.max(24.0);
    let toks = tokenize(runs);
    let mut lines: Vec<Vec<Tok>> = Vec::new();
    let mut cur: Vec<Tok> = Vec::new();
    let mut cur_w = 0.0f32;

    for tok in toks {
        match tok.kind {
            TokKind::Break => {
                lines.push(std::mem::take(&mut cur));
                cur_w = 0.0;
            }
            TokKind::Space => {
                if cur.is_empty() {
                    continue; // jamais d'espace en début de ligne
                }
                let w = text_width(&tok.text, size, tok.font);
                if cur_w + w > width {
                    lines.push(std::mem::take(&mut cur));
                    cur_w = 0.0;
                } else {
                    cur_w += w;
                    cur.push(tok);
                }
            }
            TokKind::Word => {
                let w = text_width(&tok.text, size, tok.font);
                if cur_w + w > width && !cur.is_empty() {
                    lines.push(std::mem::take(&mut cur));
                    cur_w = 0.0;
                }
                if w > width {
                    let mut buf = String::new();
                    let mut buf_w = 0.0f32;
                    for c in tok.text.chars() {
                        let cw = text_width(&c.to_string(), size, tok.font);
                        if buf_w + cw > width && !buf.is_empty() {
                            lines.push(vec![Tok {
                                text: std::mem::take(&mut buf),
                                font: tok.font,
                                kind: TokKind::Word,
                            }]);
                            buf_w = 0.0;
                        }
                        buf.push(c);
                        buf_w += cw;
                    }
                    if !buf.is_empty() {
                        cur_w += buf_w;
                        cur.push(Tok {
                            text: buf,
                            font: tok.font,
                            kind: TokKind::Word,
                        });
                    }
                } else {
                    cur_w += w;
                    cur.push(tok);
                }
            }
        }
    }
    if !cur.is_empty() {
        lines.push(cur);
    }
    if lines.is_empty() {
        lines.push(Vec::new());
    }
    lines.iter().map(|l| merge_line(l)).collect()
}

// ─────────────────────────────────────────────────────────────────────────────
// Images (JPEG tel quel, PNG décodé avec `flate2` — déjà dans le projet)
// ─────────────────────────────────────────────────────────────────────────────

struct LoadedImage {
    width: u32,
    height: u32,
    /// Données déjà prêtes pour le PDF (JPEG brut ou RGB compressé en zlib).
    data: Vec<u8>,
    filter: &'static str,
    gray: bool,
    /// Canal alpha (niveaux de gris compressé en zlib), si présent.
    alpha: Option<Vec<u8>>,
}

fn zlib(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut enc = flate2::write::ZlibEncoder::new(
        Vec::new(),
        flate2::Compression::fast(),
    );
    enc.write_all(data)
        .map_err(|e| format!("compression impossible : {}", e))?;
    enc.finish().map_err(|e| format!("compression impossible : {}", e))
}

fn jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32, u8)> {
    if bytes.len() < 4 || bytes[0] != 0xFF || bytes[1] != 0xD8 {
        return None;
    }
    let mut i = 2usize;
    while i + 9 < bytes.len() {
        if bytes[i] != 0xFF {
            i += 1;
            continue;
        }
        let marker = bytes[i + 1];
        if marker == 0xD8 || marker == 0x01 || (0xD0..=0xD7).contains(&marker) {
            i += 2;
            continue;
        }
        if marker == 0xD9 {
            return None;
        }
        let len = u16::from_be_bytes([bytes[i + 2], bytes[i + 3]]) as usize;
        let is_sof = (0xC0..=0xC3).contains(&marker)
            || (0xC5..=0xC7).contains(&marker)
            || (0xC9..=0xCB).contains(&marker)
            || (0xCD..=0xCF).contains(&marker);
        if is_sof {
            if i + 9 >= bytes.len() {
                return None;
            }
            let precision = bytes[i + 4];
            let height = u16::from_be_bytes([bytes[i + 5], bytes[i + 6]]) as u32;
            let width = u16::from_be_bytes([bytes[i + 7], bytes[i + 8]]) as u32;
            let components = bytes[i + 9];
            return Some((width, height, if components == 1 { precision } else { precision }));
        }
        i += 2 + len;
    }
    None
}

fn jpeg_components(bytes: &[u8]) -> u8 {
    let mut i = 2usize;
    while i + 9 < bytes.len() {
        if bytes[i] != 0xFF {
            i += 1;
            continue;
        }
        let marker = bytes[i + 1];
        if marker == 0xD8 || marker == 0x01 || (0xD0..=0xD7).contains(&marker) {
            i += 2;
            continue;
        }
        if marker == 0xD9 {
            break;
        }
        let len = u16::from_be_bytes([bytes[i + 2], bytes[i + 3]]) as usize;
        let is_sof = (0xC0..=0xC3).contains(&marker)
            || (0xC5..=0xC7).contains(&marker)
            || (0xC9..=0xCB).contains(&marker)
            || (0xCD..=0xCF).contains(&marker);
        if is_sof && i + 9 < bytes.len() {
            return bytes[i + 9];
        }
        i += 2 + len;
    }
    0
}

fn paeth(a: u8, b: u8, c: u8) -> u8 {
    let p = a as i32 + b as i32 - c as i32;
    let pa = (p - a as i32).abs();
    let pb = (p - b as i32).abs();
    let pc = (p - c as i32).abs();
    if pa <= pb && pa <= pc {
        a
    } else if pb <= pc {
        b
    } else {
        c
    }
}

/// Décode un PNG 8 bits NON entrelacé (gris, gris+alpha, RGB, RGBA, palette).
/// Tout autre cas renvoie une erreur EXPLICITE (affichée comme ligne de texte).
fn decode_png(bytes: &[u8]) -> Result<LoadedImage, String> {
    if bytes.len() < 8 || &bytes[0..8] != b"\x89PNG\r\n\x1a\n" {
        return Err("signature PNG absente".to_string());
    }
    let mut pos = 8usize;
    let mut width = 0u32;
    let mut height = 0u32;
    let mut depth = 0u8;
    let mut color_type = 0u8;
    let mut interlace = 0u8;
    let mut palette: Vec<[u8; 3]> = Vec::new();
    let mut trns: Vec<u8> = Vec::new();
    let mut idat: Vec<u8> = Vec::new();

    while pos + 8 <= bytes.len() {
        let len = u32::from_be_bytes([bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]])
            as usize;
        let kind = &bytes[pos + 4..pos + 8];
        let start = pos + 8;
        let end = start.saturating_add(len);
        if end + 4 > bytes.len() {
            return Err("PNG tronqué".to_string());
        }
        let data = &bytes[start..end];
        match kind {
            b"IHDR" => {
                if data.len() < 13 {
                    return Err("en-tête PNG illisible".to_string());
                }
                width = u32::from_be_bytes([data[0], data[1], data[2], data[3]]);
                height = u32::from_be_bytes([data[4], data[5], data[6], data[7]]);
                depth = data[8];
                color_type = data[9];
                interlace = data[12];
            }
            b"PLTE" => {
                palette = data.chunks_exact(3).map(|c| [c[0], c[1], c[2]]).collect();
            }
            b"tRNS" => trns = data.to_vec(),
            b"IDAT" => idat.extend_from_slice(data),
            _ => {}
        }
        pos = end + 4;
        if kind == b"IEND" {
            break;
        }
    }

    if depth != 8 {
        return Err(format!("PNG {} bits non pris en charge", depth));
    }
    if interlace != 0 {
        return Err("PNG entrelacé non pris en charge".to_string());
    }
    if width == 0 || height == 0 || width > 20000 || height > 20000 {
        return Err("dimensions PNG hors limites".to_string());
    }

    let channels = match color_type {
        0 => 1usize,
        2 => 3,
        3 => 1,
        4 => 2,
        6 => 4,
        _ => return Err(format!("type de couleur PNG {} non pris en charge", color_type)),
    };
    if color_type == 3 && palette.is_empty() {
        return Err("palette PNG absente".to_string());
    }

    let mut raw: Vec<u8> = Vec::new();
    {
        let mut dec = flate2::read::ZlibDecoder::new(&idat[..]);
        std::io::Read::read_to_end(&mut dec, &mut raw)
            .map_err(|e| format!("données PNG illisibles : {}", e))?;
    }

    let stride = width as usize * channels;
    let expected = (stride + 1) * height as usize;
    if raw.len() < expected {
        return Err("données PNG incomplètes".to_string());
    }

    // Dé-filtrage des lignes (5 filtres PNG).
    let mut pixels = vec![0u8; stride * height as usize];
    for y in 0..height as usize {
        let filter = raw[y * (stride + 1)];
        let src = &raw[y * (stride + 1) + 1..y * (stride + 1) + 1 + stride];
        let (prev_rows, cur_rows) = pixels.split_at_mut(y * stride);
        let prev: Option<&[u8]> = if y == 0 {
            None
        } else {
            Some(&prev_rows[(y - 1) * stride..y * stride])
        };
        let cur = &mut cur_rows[..stride];
        for x in 0..stride {
            let a = if x >= channels { cur[x - channels] } else { 0 };
            let b = prev.map(|p| p[x]).unwrap_or(0);
            let c = if x >= channels {
                prev.map(|p| p[x - channels]).unwrap_or(0)
            } else {
                0
            };
            cur[x] = match filter {
                0 => src[x],
                1 => src[x].wrapping_add(a),
                2 => src[x].wrapping_add(b),
                3 => src[x].wrapping_add(((a as u16 + b as u16) / 2) as u8),
                4 => src[x].wrapping_add(paeth(a, b, c)),
                f => {
                    return Err(format!("filtre PNG {} inconnu", f));
                }
            };
        }
    }

    let px = width as usize * height as usize;
    let mut rgb = Vec::with_capacity(px * 3);
    let mut alpha: Option<Vec<u8>> = None;
    match color_type {
        0 => {
            for i in 0..px {
                let g = pixels[i];
                rgb.extend_from_slice(&[g, g, g]);
            }
        }
        4 => {
            let mut a = Vec::with_capacity(px);
            for i in 0..px {
                let g = pixels[i * 2];
                a.push(pixels[i * 2 + 1]);
                rgb.extend_from_slice(&[g, g, g]);
            }
            alpha = Some(a);
        }
        2 => rgb.extend_from_slice(&pixels),
        6 => {
            let mut a = Vec::with_capacity(px);
            for i in 0..px {
                rgb.extend_from_slice(&pixels[i * 4..i * 4 + 3]);
                a.push(pixels[i * 4 + 3]);
            }
            alpha = Some(a);
        }
        3 => {
            let mut a: Option<Vec<u8>> = if trns.is_empty() {
                None
            } else {
                Some(Vec::with_capacity(px))
            };
            for i in 0..px {
                let idx = pixels[i] as usize;
                let entry = palette.get(idx).copied().unwrap_or([0, 0, 0]);
                rgb.extend_from_slice(&entry);
                if let Some(a) = a.as_mut() {
                    a.push(trns.get(idx).copied().unwrap_or(255));
                }
            }
            alpha = a;
        }
        _ => unreachable!(),
    }

    // Un alpha entièrement opaque n'a pas besoin d'un masque (fichier plus léger).
    if let Some(a) = &alpha {
        if a.iter().all(|v| *v == 255) {
            alpha = None;
        }
    }

    Ok(LoadedImage {
        width,
        height,
        data: zlib(&rgb)?,
        filter: "FlateDecode",
        gray: false,
        alpha: match alpha {
            Some(a) => Some(zlib(&a)?),
            None => None,
        },
    })
}

fn load_image(path: &Path) -> Result<LoadedImage, String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("introuvable ({})", e))?;
    if meta.len() > MAX_IMAGE_BYTES {
        return Err(format!(
            "trop volumineuse ({} octets > {} octets)",
            meta.len(),
            MAX_IMAGE_BYTES
        ));
    }
    let bytes = std::fs::read(path).map_err(|e| format!("illisible ({})", e))?;
    if bytes.starts_with(&[0xFF, 0xD8]) {
        let (w, h) = match jpeg_dimensions(&bytes) {
            Some((w, h, _)) => (w, h),
            None => return Err("dimensions JPEG illisibles".to_string()),
        };
        let components = jpeg_components(&bytes);
        return match components {
            1 | 3 => Ok(LoadedImage {
                width: w,
                height: h,
                data: bytes,
                filter: "DCTDecode",
                gray: components == 1,
                alpha: None,
            }),
            _ => Err("JPEG CMJN non pris en charge".to_string()),
        };
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return decode_png(&bytes);
    }
    Err("format d'image non pris en charge (JPEG et PNG seulement)".to_string())
}

// ─────────────────────────────────────────────────────────────────────────────
// Mise en page
// ─────────────────────────────────────────────────────────────────────────────

struct Page {
    ops: Vec<String>,
}

struct PdfImage {
    name: String,
    image: LoadedImage,
}

struct Renderer {
    pages: Vec<Page>,
    y: f32,
    images: Vec<PdfImage>,
}

impl Renderer {
    fn new() -> Self {
        Renderer {
            pages: vec![Page { ops: Vec::new() }],
            y: PAGE_H - MARGIN_TOP,
            images: Vec::new(),
        }
    }

    fn op(&mut self, op: String) {
        if let Some(page) = self.pages.last_mut() {
            page.ops.push(op);
        }
    }

    fn new_page(&mut self) {
        self.pages.push(Page { ops: Vec::new() });
        self.y = PAGE_H - MARGIN_TOP;
    }

    /// Garantit `needed` points disponibles ; sinon nouvelle page. Jamais plus
    /// d'une page vide consécutive (une hauteur ≤ zone utile démarre toujours).
    fn ensure(&mut self, needed: f32) {
        if self.y - needed < MARGIN_BOTTOM {
            self.new_page();
        }
    }

    fn color(&mut self, r: f32, g: f32, b: f32) {
        self.op(format!("{} {} {} rg", num(r), num(g), num(b)));
    }

    /// Écrit une ligne de `Run` à partir de `x0`, à la taille `size`.
    ///
    /// UN SEUL objet texte par ligne : les morceaux de styles différents s'y
    /// enchaînent (changement de police au milieu), et c'est le MOTEUR PDF qui
    /// avance avec les largeurs RÉELLES de la police. Aucune position n'est
    /// calculée pour chaque morceau, donc aucun décalage cumulé possible — même
    /// pour un caractère hors ASCII, dont la largeur n'est ici qu'approchée
    /// (cette approximation ne sert plus qu'au découpage en lignes).
    fn draw_runs(&mut self, runs: &[Run], size: f32, x0: f32, leading: f32) {
        let baseline = self.y - size;
        let mut body = String::new();
        let mut current_font: Option<Font> = None;
        for run in runs {
            if run.text.is_empty() {
                continue;
            }
            // Un morceau qui n'est fait que d'espaces compte : c'est lui qui
            // sépare deux mots de styles différents.
            // En revanche un morceau qui ne donne AUCUN caractère écrit (un émoji
            // seul, que WinAnsi ne sait pas rendre) ne laisse pas d'objet texte
            // vide derrière lui.
            let encoded = pdf_string(&run.text);
            if encoded == "()" {
                continue;
            }
            if current_font != Some(run.font) {
                body.push_str(&format!("/{} {} Tf\n", run.font.resource_name(), num(size)));
                current_font = Some(run.font);
            }
            body.push_str(&format!("{} Tj\n", encoded));
        }
        if body.is_empty() {
            self.y -= leading;
            return;
        }
        self.op(format!(
            "BT\n{} {} Td\n{}ET",
            num(x0),
            num(baseline),
            body
        ));
        self.y -= leading;
    }

    fn rect(&mut self, x: f32, y: f32, w: f32, h: f32, gray_shade: f32) {
        self.color(gray_shade, gray_shade, gray_shade);
        self.op(format!(
            "{} {} {} {} re f",
            num(x),
            num(y),
            num(w),
            num(h)
        ));
    }

    fn hline(&mut self, x1: f32, x2: f32, y: f32, shade: f32, width: f32) {
        self.op(format!(
            "{} {} {} RG {} w {} {} m {} {} l S",
            num(shade),
            num(shade),
            num(shade),
            num(width),
            num(x1),
            num(y),
            num(x2),
            num(y)
        ));
    }

    fn render_blocks(&mut self, blocks: &[Block], base_dir: Option<&Path>) {
        for block in blocks {
            match block {
                Block::Heading(level, runs) => {
                    let (size, before, after) = match level {
                        1 => (19.0f32, 16.0f32, 7.0f32),
                        2 => (15.5, 14.0, 6.0),
                        3 => (13.0, 12.0, 5.0),
                        4 => (11.5, 10.0, 4.0),
                        _ => (11.0, 9.0, 4.0),
                    };
                    let leading = size + 4.0;
                    let bold_runs: Vec<Run> = runs
                        .iter()
                        .map(|r| Run {
                            text: r.text.clone(),
                            font: if r.font == Font::Mono {
                                Font::Mono
                            } else {
                                Font::Bold
                            },
                        })
                        .collect();
                    let lines = wrap_runs(&bold_runs, size, CONTENT_W);
                    self.ensure(before + leading);
                    self.y -= before;
                    for line in &lines {
                        self.ensure(leading);
                        self.color(0.08, 0.08, 0.08);
                        self.draw_runs(line, size, MARGIN_X, leading);
                    }
                    self.y -= after;
                    if *level == 1 {
                        self.hline(MARGIN_X, MARGIN_X + CONTENT_W, self.y + after - 1.0, 0.8, 0.7);
                    }
                }
                Block::Para(runs) => {
                    let lines = wrap_runs(runs, BODY_SIZE, CONTENT_W);
                    self.color(0.12, 0.12, 0.12);
                    for line in &lines {
                        self.ensure(BODY_LEADING);
                        self.color(0.12, 0.12, 0.12);
                        self.draw_runs(line, BODY_SIZE, MARGIN_X, BODY_LEADING);
                    }
                    self.y -= 7.0;
                }
                Block::Quote(runs) => {
                    let indent = 18.0;
                    let width = CONTENT_W - indent;
                    let lines = wrap_runs(runs, BODY_SIZE, width);
                    self.color(0.35, 0.35, 0.35);
                    for line in &lines {
                        self.ensure(BODY_LEADING);
                        self.op(format!(
                            "{} {} {} RG 2 w {} {} m {} {} l S",
                            num(0.78),
                            num(0.78),
                            num(0.78),
                            num(MARGIN_X),
                            num(self.y - BODY_LEADING + 2.0),
                            num(MARGIN_X),
                            num(self.y + 2.0)
                        ));
                        self.color(0.35, 0.35, 0.35);
                        self.draw_runs(line, BODY_SIZE, MARGIN_X + indent, BODY_LEADING);
                    }
                    self.y -= 6.0;
                }
                Block::Item {
                    depth,
                    marker,
                    runs,
                } => {
                    let indent = 14.0 + (*depth as f32 - 1.0) * 16.0;
                    let marker_w = text_width(marker, BODY_SIZE, Font::Regular) + 6.0;
                    let width = CONTENT_W - indent - marker_w;
                    let lines = wrap_runs(runs, BODY_SIZE, width);
                    for (i, line) in lines.iter().enumerate() {
                        self.ensure(BODY_LEADING);
                        if i == 0 {
                            self.color(0.12, 0.12, 0.12);
                            let baseline = self.y - BODY_SIZE;
                            self.op(format!(
                                "BT /F1 {} Tf {} {} Td {} Tj ET",
                                num(BODY_SIZE),
                                num(MARGIN_X + indent),
                                num(baseline),
                                pdf_string(marker)
                            ));
                        }
                        self.color(0.12, 0.12, 0.12);
                        self.draw_runs(line, BODY_SIZE, MARGIN_X + indent + marker_w, BODY_LEADING);
                    }
                    self.y -= 3.0;
                }
                Block::Code(text) => {
                    let indent = 8.0;
                    let width = CONTENT_W - 2.0 * indent;
                    let mut runs = Vec::new();
                    for (i, raw) in text.split('\n').enumerate() {
                        if i > 0 {
                            push_run(&mut runs, "\n", Font::Mono);
                        }
                        push_run(&mut runs, raw, Font::Mono);
                    }
                    let lines = if text.is_empty() {
                        vec![Vec::new()]
                    } else {
                        wrap_runs(&runs, CODE_SIZE, width)
                    };
                    self.ensure(CODE_LEADING * 2.0);
                    self.y -= 4.0;
                    for line in &lines {
                        self.ensure(CODE_LEADING);
                        self.rect(MARGIN_X, self.y - CODE_LEADING, CONTENT_W, CODE_LEADING, 0.96);
                        self.color(0.15, 0.15, 0.15);
                        self.draw_runs(line, CODE_SIZE, MARGIN_X + indent, CODE_LEADING);
                    }
                    self.y -= 6.0;
                }
                Block::Rule => {
                    self.ensure(16.0);
                    self.hline(MARGIN_X, MARGIN_X + CONTENT_W, self.y - 8.0, 0.82, 1.0);
                    self.y -= 16.0;
                }
                Block::Image { path, alt } => {
                    self.render_image(path, alt, base_dir);
                }
                Block::TableRow { header, cells } => {
                    self.render_table_row(*header, cells);
                }
            }
        }
    }

    fn render_image(&mut self, path: &str, alt: &str, base_dir: Option<&Path>) {
        let resolved = resolve_relative(base_dir, path);
        let loaded = resolved
            .as_ref()
            .map(|p| load_image(p))
            .unwrap_or_else(|| Err("chemin d'image vide".to_string()));

        match loaded {
            Ok(image) => {
                // 1 px ≈ 0.75 pt (96 dpi), réduit pour tenir dans la largeur utile.
                let mut w = image.width as f32 * 0.75;
                let mut h = image.height as f32 * 0.75;
                let max_w = CONTENT_W - 8.0;
                let max_h = PAGE_H - MARGIN_TOP - MARGIN_BOTTOM - 40.0;
                if w > max_w {
                    let k = max_w / w;
                    w *= k;
                    h *= k;
                }
                if h > max_h {
                    let k = max_h / h;
                    w *= k;
                    h *= k;
                }
                let name = format!("Im{}", self.images.len());
                self.images.push(PdfImage {
                    name: name.clone(),
                    image,
                });
                self.ensure(h + 12.0);
                self.y -= 4.0;
                let x = MARGIN_X + (CONTENT_W - w) / 2.0;
                self.op(format!(
                    "q {} 0 0 {} {} {} cm /{} Do Q",
                    num(w),
                    num(h),
                    num(x),
                    num(self.y - h),
                    name
                ));
                self.y -= h + 4.0;
                if !alt.trim().is_empty() {
                    let runs = vec![Run {
                        text: alt.trim().to_string(),
                        font: Font::Italic,
                    }];
                    let lines = wrap_runs(&runs, 9.0, CONTENT_W);
                    self.color(0.4, 0.4, 0.4);
                    for line in &lines {
                        self.ensure(12.0);
                        self.color(0.4, 0.4, 0.4);
                        self.draw_runs(line, 9.0, MARGIN_X, 12.0);
                    }
                }
                self.y -= 6.0;
            }
            Err(reason) => {
                // JAMAIS de blocage ni de silence : une ligne visible dit que
                // l'image n'est pas dans le PDF et pourquoi.
                let label = format!("[image non incorporée : {} ({})]", path, reason);
                let runs = vec![Run {
                    text: label,
                    font: Font::Italic,
                }];
                let lines = wrap_runs(&runs, 9.0, CONTENT_W);
                self.color(0.45, 0.25, 0.25);
                for line in &lines {
                    self.ensure(12.0);
                    self.color(0.45, 0.25, 0.25);
                    self.draw_runs(line, 9.0, MARGIN_X, 12.0);
                }
                self.y -= 6.0;
            }
        }
    }

    fn render_table_row(&mut self, header: bool, cells: &[Vec<Run>]) {
        if cells.is_empty() {
            return;
        }
        let n = cells.len();
        let padding = 5.0f32;
        let separator = 8.0f32;
        let cell_w = (CONTENT_W - separator * (n as f32 - 1.0)) / n as f32;
        let size = 9.2f32;
        let leading = 12.6f32;

        let mut wrapped: Vec<Vec<Vec<Run>>> = Vec::new();
        let mut max_lines = 1usize;
        for cell in cells {
            let runs: Vec<Run> = if header {
                cell.iter()
                    .map(|r| Run {
                        text: r.text.clone(),
                        font: if r.font == Font::Mono { Font::Mono } else { Font::Bold },
                    })
                    .collect()
            } else {
                cell.clone()
            };
            let lines = wrap_runs(&runs, size, cell_w - 2.0 * padding);
            max_lines = max_lines.max(lines.len());
            wrapped.push(lines);
        }
        let block_h = max_lines as f32 * leading + 2.0;

        self.ensure(block_h + 2.0);
        if header && self.y - block_h >= MARGIN_BOTTOM {
            self.rect(MARGIN_X, self.y - block_h, CONTENT_W, block_h, 0.93);
        }
        // TOUTES les cellules d'une rangée partent de la MÊME ligne de base : sinon
        // chaque cellule descendait d'un interligne et les colonnes étaient
        // décalées verticalement les unes par rapport aux autres.
        let row_y = self.y;
        for (i, lines) in wrapped.iter().enumerate() {
            let x = MARGIN_X + i as f32 * (cell_w + separator);
            let mut y_line = row_y;
            for line in lines.iter() {
                self.y = y_line;
                self.color(0.15, 0.15, 0.15);
                self.draw_runs(line, size, x + padding, leading);
                y_line -= leading;
            }
        }
        self.y = row_y - block_h;
        self.hline(MARGIN_X, MARGIN_X + CONTENT_W, self.y, 0.86, 0.5);
    }
}

fn resolve_relative(base_dir: Option<&Path>, path: &str) -> Option<PathBuf> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return None;
    }
    // URL distantes : non récupérées (aucun accès réseau ici).
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") || trimmed.starts_with("data:")
    {
        return None;
    }
    let candidate = PathBuf::from(trimmed);
    if candidate.is_absolute() {
        return Some(candidate);
    }
    base_dir.map(|dir| dir.join(candidate))
}

// ─────────────────────────────────────────────────────────────────────────────
// Sérialisation PDF
// ─────────────────────────────────────────────────────────────────────────────

fn serialize_pdf(pages: &[Page], images: &[PdfImage]) -> Vec<u8> {
    let mut objects: Vec<Vec<u8>> = Vec::new();

    // 1 = catalogue, 2 = arbre des pages (corps remplis à la fin).
    objects.push(Vec::new());
    objects.push(Vec::new());
    let pages_num = 2usize;

    let mut font_numbers: Vec<usize> = Vec::new();
    for font in [Font::Regular, Font::Bold, Font::Italic, Font::Mono] {
        let body = format!(
            "<< /Type /Font /Subtype /Type1 /BaseFont /{} /Encoding /WinAnsiEncoding >>",
            font.base_font()
        );
        objects.push(body.into_bytes());
        font_numbers.push(objects.len());
    }

    // Images : objet image + objet de transparence (SMask) éventuel.
    let mut image_refs: Vec<(String, usize)> = Vec::new();
    for entry in images {
        let image = &entry.image;
        let alpha_num = entry.image.alpha.as_ref().map(|alpha| {
            let mut body: Vec<u8> = format!(
                "<< /Type /XObject /Subtype /Image /Width {} /Height {} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length {} >>\nstream\n",
                image.width,
                image.height,
                alpha.len()
            )
            .into_bytes();
            body.extend_from_slice(alpha);
            body.extend_from_slice(b"\nendstream");
            objects.push(body);
            objects.len()
        });

        let mut dict = format!(
            "<< /Type /XObject /Subtype /Image /Width {} /Height {} /ColorSpace /{} /BitsPerComponent 8 /Filter /{} /Length {}",
            image.width,
            image.height,
            if image.gray { "DeviceGray" } else { "DeviceRGB" },
            image.filter,
            image.data.len()
        );
        if let Some(a) = alpha_num {
            dict.push_str(&format!(" /SMask {} 0 R", a));
        }
        dict.push_str(" >>\nstream\n");
        let mut body = dict.into_bytes();
        body.extend_from_slice(&image.data);
        body.extend_from_slice(b"\nendstream");
        objects.push(body);
        image_refs.push((entry.name.clone(), objects.len()));
    }

    let xobject_dict = if image_refs.is_empty() {
        String::new()
    } else {
        let entries: Vec<String> = image_refs
            .iter()
            .map(|(name, n)| format!("/{} {} 0 R", name, n))
            .collect();
        format!(" /XObject << {} >>", entries.join(" "))
    };

    let mut kids: Vec<String> = Vec::new();
    for page in pages {
        let content = page.ops.join("\n");
        let content_bytes = string_to_bytes(&content);
        let mut content_obj = format!(
            "<< /Length {} >>\nstream\n",
            content_bytes.len()
        )
        .into_bytes();
        content_obj.extend_from_slice(&content_bytes);
        content_obj.extend_from_slice(b"\nendstream");
        objects.push(content_obj);
        let content_num = objects.len();

        let page_body = format!(
            "<< /Type /Page /Parent {} 0 R /MediaBox [0 0 {} {}] /Resources << /Font << /F1 {} 0 R /F2 {} 0 R /F3 {} 0 R /F4 {} 0 R >>{} >> /Contents {} 0 R >>",
            pages_num,
            num(PAGE_W),
            num(PAGE_H),
            font_numbers[0],
            font_numbers[1],
            font_numbers[2],
            font_numbers[3],
            xobject_dict,
            content_num
        );
        objects.push(page_body.into_bytes());
        let page_num = objects.len();
        kids.push(format!("{} 0 R", page_num));
    }

    let catalog = b"<< /Type /Catalog /Pages 2 0 R >>".to_vec();
    objects[0] = catalog;
    objects[1] = format!(
        "<< /Type /Pages /Kids [{}] /Count {} >>",
        kids.join(" "),
        kids.len()
    )
    .into_bytes();

    let mut out: Vec<u8> = Vec::new();
    out.extend_from_slice(b"%PDF-1.7\n");
    out.extend_from_slice(&[b'%', 0xE2, 0xE3, 0xCF, 0xD3, b'\n']);

    let mut offsets: Vec<usize> = Vec::with_capacity(objects.len());
    for (index, body) in objects.iter().enumerate() {
        offsets.push(out.len());
        out.extend_from_slice(format!("{} 0 obj\n", index + 1).as_bytes());
        out.extend_from_slice(body);
        out.extend_from_slice(b"\nendobj\n");
    }

    let xref_pos = out.len();
    out.extend_from_slice(format!("xref\n0 {}\n", objects.len() + 1).as_bytes());
    out.extend_from_slice(b"0000000000 65535 f \n");
    for offset in &offsets {
        out.extend_from_slice(format!("{:010} 00000 n \n", offset).as_bytes());
    }
    out.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n",
            objects.len() + 1,
            xref_pos
        )
        .as_bytes(),
    );
    out
}

/// Rend un Markdown en PDF. Fonction PURE (aucune écriture) : c'est elle que
/// les tests appellent. `base_dir` sert à retrouver les images relatives.
///
/// Retourne `(octets du PDF, nombre de pages)`.
pub fn render_markdown_pdf(md: &str, base_dir: Option<&Path>) -> (Vec<u8>, usize) {
    let blocks = parse_blocks(md);
    let mut renderer = Renderer::new();
    renderer.render_blocks(&blocks, base_dir);
    let page_count = renderer.pages.len();
    let bytes = serialize_pdf(&renderer.pages, &renderer.images);
    (bytes, page_count)
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversion de fichiers + rapport (plusieurs sources, un par un)
// ─────────────────────────────────────────────────────────────────────────────

/// Résultat de la conversion d'UNE source.
#[derive(serde::Serialize, Clone, Debug)]
pub struct PdfFileResult {
    /// Chemin du Markdown source.
    pub source: String,
    /// Chemin du PDF produit (`None` en cas d'échec).
    pub output: Option<String>,
    /// `true` si le PDF a été écrit ET relu sur le disque.
    pub ok: bool,
    /// Taille du fichier produit (octets), 0 en cas d'échec.
    pub bytes: usize,
    /// Nombre de pages, 0 en cas d'échec.
    pub pages: usize,
    /// Raison de l'échec, en clair (`None` si succès).
    pub error: Option<String>,
}

/// Rapport global : ce qui a été produit et ce qui a échoué.
#[derive(serde::Serialize, Clone, Debug, Default)]
pub struct PdfExportReport {
    pub results: Vec<PdfFileResult>,
    pub produced: usize,
    pub failed: usize,
}

fn is_markdown_path(path: &Path) -> bool {
    match path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .as_deref()
    {
        Some("md") | Some("markdown") | Some("mdx") => true,
        _ => false,
    }
}

fn output_path_for(source: &Path, out_dir: Option<&str>) -> Result<PathBuf, String> {
    let stem = source
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "document".to_string());
    match out_dir.map(str::trim).filter(|d| !d.is_empty()) {
        Some(dir) => {
            let dir = PathBuf::from(dir);
            std::fs::create_dir_all(&dir)
                .map_err(|e| format!("dossier de sortie inutilisable ({})", e))?;
            Ok(dir.join(format!("{}.pdf", stem)))
        }
        None => Ok(source.with_extension("pdf")),
    }
}

/// Convertit UN Markdown. Un échec est décrit, jamais propagé en panique.
/// TÉMOIN DE TEST : identifiant du fil qui a RÉELLEMENT exécuté une conversion.
/// Sert à prouver, test à l'appui, que le travail quitte le fil de l'interface.
#[cfg(test)]
static FIL_DE_CONVERSION: std::sync::Mutex<Option<std::thread::ThreadId>> =
    std::sync::Mutex::new(None);

fn convert_one(source: &str, out_dir: Option<&str>) -> PdfFileResult {
    #[cfg(test)]
    {
        if let Ok(mut slot) = FIL_DE_CONVERSION.lock() {
            *slot = Some(std::thread::current().id());
        }
    }
    let mut result = PdfFileResult {
        source: source.to_string(),
        output: None,
        ok: false,
        bytes: 0,
        pages: 0,
        error: None,
    };

    let path = PathBuf::from(source);
    if !is_markdown_path(&path) {
        result.error = Some("ce n'est pas un fichier Markdown (.md)".to_string());
        return result;
    }
    let md = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(err) => {
            result.error = Some(format!("lecture impossible : {}", err));
            return result;
        }
    };
    let base_dir = path.parent().map(|p| p.to_path_buf());
    let (bytes, pages) = render_markdown_pdf(&md, base_dir.as_deref());

    if !has_pdf_signature(&bytes) || bytes.is_empty() {
        result.error = Some("le document produit n'est pas un PDF".to_string());
        return result;
    }

    let target = match output_path_for(&path, out_dir) {
        Ok(target) => target,
        Err(err) => {
            result.error = Some(err);
            return result;
        }
    };

    if let Err(err) = std::fs::write(&target, &bytes) {
        result.error = Some(format!("écriture impossible : {}", err));
        return result;
    }

    // VÉRIFICATION SUR LE DISQUE : on relit ce qui a été écrit. Un fichier vide
    // ou sans signature n'est pas un succès, même si l'écriture a rendu `Ok`.
    match std::fs::read(&target) {
        Ok(written) if has_pdf_signature(&written) && !written.is_empty() => {
            result.output = Some(target.to_string_lossy().to_string());
            result.bytes = written.len();
            result.pages = pages;
            result.ok = true;
        }
        Ok(written) => {
            result.error = Some(format!(
                "fichier écrit sans signature PDF ({} octets)",
                written.len()
            ));
        }
        Err(err) => {
            result.error = Some(format!("vérification impossible : {}", err));
        }
    }
    result
}

/// Cœur SYNCHRONE (exécuté hors du fil d'affichage) : convertit chaque source,
/// une par une. L'échec d'une source n'annule JAMAIS les autres.
pub fn markdown_to_pdf_blocking(sources: &[String], out_dir: Option<&str>) -> Result<PdfExportReport, String> {
    let mut list: Vec<String> = sources
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if list.is_empty() {
        return Err("Aucun fichier Markdown fourni : rien n'a été converti.".to_string());
    }
    list.dedup();

    let mut report = PdfExportReport::default();
    for source in &list {
        let one = convert_one(source, out_dir);
        if one.ok {
            report.produced += 1;
        } else {
            report.failed += 1;
        }
        report.results.push(one);
    }
    Ok(report)
}

/// Commande Tauri : convertit un ou plusieurs Markdown en PDF, SANS fenêtre
/// d'impression ni dialogue, et rend le chemin de chaque fichier produit.
///
/// `pub async fn` + `spawn_blocking` : l'écriture des fichiers se fait hors du
/// thread de la fenêtre (aucun gel de l'interface, même avec des images).
#[tauri::command]
pub async fn markdown_to_pdf(
    sources: Vec<String>,
    out_dir: Option<String>,
) -> Result<PdfExportReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        markdown_to_pdf_blocking(&sources, out_dir.as_deref())
    })
    .await
    .map_err(|e| format!("Erreur interne (join) markdown_to_pdf: {}", e))?
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "pilot-pdf-{}-{}-{}",
            tag,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&dir).expect("dossier temporaire");
        dir
    }

    fn xref_offsets(bytes: &[u8]) -> Vec<usize> {
        let text = String::from_utf8_lossy(bytes).to_string();
        let mut offsets = Vec::new();
        for line in text.lines() {
            let t = line.trim_end();
            // Ligne d'entrée xref : 10 chiffres, un espace, 5 chiffres, « n ».
            if t.len() == 18 && t.ends_with(" 00000 n") {
                if let Ok(v) = t[0..10].parse::<usize>() {
                    offsets.push(v);
                }
            }
        }
        offsets
    }

    #[test]
    fn le_pdf_commence_par_la_signature_et_finit_par_eof() {
        let (bytes, pages) = render_markdown_pdf("# Titre\n\nUn paragraphe.", None);
        assert!(has_pdf_signature(&bytes), "signature PDF absente");
        assert!(bytes.len() > 200, "PDF trop court");
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.contains("%%EOF"), "fin de PDF absente");
        assert!(pages >= 1);
    }

    #[test]
    fn la_table_xref_pointe_sur_chaque_objet() {
        let (bytes, _) = render_markdown_pdf("# Un\n\n## Deux\n\ntexte", None);
        let offsets = xref_offsets(&bytes);
        assert!(offsets.len() >= 6, "objets manquants");
        for offset in offsets {
            assert!(offset < bytes.len(), "décalage hors du fichier");
            let tail = String::from_utf8_lossy(&bytes[offset..(offset + 24).min(bytes.len())]);
            assert!(
                tail.contains(" 0 obj"),
                "la table xref ne pointe pas sur un objet : {:?}",
                tail
            );
        }
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.contains("/Type /Catalog"));
        assert!(text.contains("/Type /Pages"));
        assert!(text.contains("/Type /Page "));
    }

    #[test]
    fn le_contenu_d_un_bloc_de_code_est_dans_le_pdf() {
        // Le TEXTE du bloc de code doit apparaître : il partait dans les `runs` du
        // paragraphe et le PDF ne montrait que la ligne « // rust ».
        let (bytes, _) = render_markdown_pdf(
            "Avant\n\n```rust\nfn main() { println!(\"bonjour\"); }\n```\n\nAprès",
            None,
        );
        let text = String::from_utf8_lossy(&bytes);
        // Les parenthèses sont échappées dans le PDF (`\(`), on cherche donc le
        // début du code sans elles.
        assert!(text.contains("fn main"), "le code est perdu");
        assert!(text.contains("bonjour"), "le code est tronqué");
        assert!(text.contains("Apr"), "le texte qui suit le code est perdu");
    }

    #[test]
    fn l_entete_d_un_tableau_est_dans_le_pdf() {
        // pulldown-cmark ne ferme pas de `TableRow` pour l'en-tête : sans le push
        // sur `TableHead`, le titre des colonnes disparaissait du PDF.
        let (bytes, _) = render_markdown_pdf(
            "| Colonne A | Colonne B |\n|---|---|\n| 1 | 2 |",
            None,
        );
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.contains("Colonne"), "l'en-tête du tableau est perdu");
        assert!(text.contains("A") && text.contains("B"));
    }

    #[test]
    fn une_liste_lache_ne_produit_pas_de_puce_orpheline() {
        // Liste « lâche » (lignes vides entre les items) : le texte restait dans
        // les `runs` du paragraphe, la puce était perdue ou dupliquée.
        let (bytes, _) = render_markdown_pdf("- premier\n\n- second\n  - sous", None);
        let puces = bytes.iter().filter(|b| **b == 0x95).count();
        assert_eq!(puces, 3, "puce par item attendue ({} trouvée(s))", puces);
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.contains("premier") && text.contains("second") && text.contains("sous"));
    }

    #[test]
    fn le_texte_du_markdown_est_dans_le_pdf() {
        let (bytes, _) = render_markdown_pdf("Bonjour le monde accentué : éàüç", None);
        // Le contenu est en WinAnsi : « é » devient l'octet 0xE9.
        assert!(
            bytes.windows(7).any(|w| w == b"Bonjour"),
            "aucun texte rendu"
        );
        assert!(
            bytes.iter().any(|b| *b == 0xE9),
            "les accents (WinAnsi) sont perdus"
        );
        assert!(!String::from_utf8_lossy(&bytes).contains("PILOT_"));
    }

    #[test]
    fn un_document_long_produit_plusieurs_pages() {
        let paragraphe = "Ceci est une phrase de remplissage pour la pagination. ".repeat(12);
        let mut md = String::new();
        for i in 0..40 {
            md.push_str(&format!("## Section {}\n\n{}\n\n", i + 1, paragraphe));
        }
        let (bytes, pages) = render_markdown_pdf(&md, None);
        assert!(pages > 3, "pagination inopérante (pages = {})", pages);
        assert!(has_pdf_signature(&bytes));
        // Chaque page est un objet /Type /Page distinct.
        let text = String::from_utf8_lossy(&bytes);
        assert_eq!(text.matches("/Type /Page ").count(), pages);
    }

    #[test]
    fn les_structures_markdown_ne_paniquent_pas() {
        let md = "# T\n\n- a\n- b\n  - b1\n  - b2\n\n1. un\n2. deux\n\n> citation\n\n```rust\nfn main() {}\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n---\n\nUn *italique* et du **gras** et `du code`.\n\n```\ncode non terminé";
        let (bytes, pages) = render_markdown_pdf(md, None);
        assert!(has_pdf_signature(&bytes));
        assert!(pages >= 1);
    }

    #[test]
    fn une_image_absente_devient_une_ligne_visible_jamais_un_blocage() {
        let dir = temp_dir("img-missing");
        let md = "Avant\n\n![capture](absente.png)\n\nAprès";
        let (bytes, _) = render_markdown_pdf(md, Some(&dir));
        let text = String::from_utf8_lossy(&bytes);
        // Le texte est encodé en WinAnsi : on cherche une partie ASCII.
        assert!(
            text.contains("image non incorpor"),
            "l'image manquante n'est pas signalée dans le PDF"
        );
        assert!(text.contains("Apr"))
    }

    #[test]
    fn une_image_png_reelle_est_incorporee() {
        let dir = temp_dir("img-png");
        // PNG 2x2 RGB écrit à la main (lignes filtrées « 0 »).
        let png = build_png_rgb2x2();
        std::fs::write(dir.join("p.png"), &png).expect("écriture PNG");
        let md = "![p](p.png)";
        let (bytes, _) = render_markdown_pdf(md, Some(&dir));
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.contains("/Subtype /Image"), "image non incorporée");
        assert!(!text.contains("non incorpor"), "l'image a été refusée");
        assert!(text.contains("/Filter /FlateDecode"));
    }

    #[test]
    fn un_png_invalide_est_signale_sans_panique() {
        let dir = temp_dir("img-bad");
        std::fs::write(dir.join("bad.png"), b"\x89PNG\r\n\x1a\npas un vrai png").unwrap();
        let (bytes, _) = render_markdown_pdf("![x](bad.png)", Some(&dir));
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.contains("image non incorpor"));
    }

    #[test]
    fn un_lot_traite_chaque_fichier_et_un_echec_n_annule_pas_les_autres() {
        let dir = temp_dir("batch");
        let a = dir.join("a.md");
        let b = dir.join("b.md");
        let c = dir.join("c.md");
        std::fs::write(&a, "# A\n\ntexte").unwrap();
        std::fs::write(&b, "# B\n\ntexte").unwrap();
        std::fs::write(&c, "# C\n\ntexte").unwrap();
        let sources = vec![
            a.to_string_lossy().to_string(),
            dir.join("inexistant.md").to_string_lossy().to_string(),
            b.to_string_lossy().to_string(),
        ];
        let report = markdown_to_pdf_blocking(&sources, None).expect("rapport");
        assert_eq!(report.produced, 2, "les bons fichiers doivent être convertis");
        assert_eq!(report.failed, 1, "l'échec doit être compté");
        for name in ["a.pdf", "b.pdf"] {
            let path = dir.join(name);
            let bytes = std::fs::read(&path).expect("PDF produit sur le disque");
            assert!(has_pdf_signature(&bytes), "{} n'est pas un PDF", name);
            assert!(bytes.len() > 200);
        }
        assert!(!dir.join("inexistant.pdf").exists());
    }

    /// PREUVE DE BOUT EN BOUT : un document RÉEL (titres, liste, tableau, code,
    /// accents, image) est converti par la commande publique, ÉCRIT sur le
    /// disque, puis RELU octet par octet. C'est exactement ce que fait
    /// l'utilisateur qui clique « Exporter en PDF » — sans fenêtre d'impression.
    #[test]
    fn un_document_complet_est_ecrit_puis_relu_sur_le_disque() {
        let dir = temp_dir("end-to-end");
        std::fs::write(dir.join("p.png"), build_png_rgb2x2()).expect("PNG de test");
        let md = "# Rapport de démonstration\n\n\
Un paragraphe accentué : éàüçœ €, avec du **gras**, de l'*italique* et du `code`.\n\n\
## Liste\n\n- premier point\n- deuxième point\n  - sous-point\n\n\
## Tableau\n\n| Colonne A | Colonne B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\n\
## Code\n\n```rust\nfn main() { println!(\"bonjour\"); }\n```\n\n\
![capture](p.png)\n\n\
> Une citation pour finir.\n";
        let src = dir.join("document.md");
        std::fs::write(&src, md).expect("écriture du Markdown");

        let report = markdown_to_pdf_blocking(&[src.to_string_lossy().to_string()], None)
            .expect("rapport du lot");
        assert_eq!(report.produced, 1, "le document doit être converti");
        assert_eq!(report.failed, 0);

        let out = report.results[0].output.clone().expect("chemin du PDF");
        assert!(out.ends_with("document.pdf"), "chemin inattendu : {}", out);

        // RELU DEPUIS LE DISQUE, pas depuis la mémoire du moteur.
        let bytes = std::fs::read(&out).expect("PDF présent sur le disque");
        assert!(has_pdf_signature(&bytes), "le fichier ne commence pas par %PDF");
        assert!(bytes.len() > 2_000, "PDF suspectement petit : {}", bytes.len());
        assert_eq!(bytes.len(), report.results[0].bytes, "taille annoncée ≠ taille réelle");
        assert!(report.results[0].pages >= 1);
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.contains("%%EOF"), "fin de fichier PDF absente");
        assert!(text.contains("/Subtype /Image"), "image non incorporée");
        assert!(!text.contains("PILOT_"), "aucune sentinelle ne doit atterrir dans un PDF");
        // Aucun fichier temporaire oublié à côté du PDF.
        assert!(!dir.join("document.pdf.part").exists());
    }

    #[test]
    fn la_conversion_s_execute_hors_du_fil_de_l_interface() {
        // PREUVE DE NON-BLOCAGE : on ne se contente pas de constater que le code
        // appelle `spawn_blocking`. La commande RÉELLE est appelée, et le témoin
        // posé PAR LE MOTEUR pendant la conversion dit sur quel fil elle a tourné ;
        // il ne doit pas être celui de l'appelant (celui de l'interface).
        let dir = temp_dir("hors-du-fil");
        let mut md = String::from("# Document long

");
        for i in 0..400 {
            md.push_str(&format!(
                "## Section {}

Un paragraphe de texte pour la section {} avec des mots et des accents : éàüç.

- point un
- point deux

",
                i, i
            ));
        }
        let src = dir.join("long.md");
        std::fs::write(&src, md).expect("Markdown long");
        let src_arg = src.to_string_lossy().to_string();

        let fil_appelant = std::thread::current().id();
        if let Ok(mut slot) = FIL_DE_CONVERSION.lock() {
            *slot = None;
        }

        let report = tauri::async_runtime::block_on(markdown_to_pdf(vec![src_arg], None))
            .expect("la commande doit rendre un rapport");

        assert_eq!(report.produced, 1, "le document long doit être converti");
        assert_eq!(report.failed, 0);
        assert!(report.results[0].pages > 1, "le document long tient sur plusieurs pages");

        let fil_conversion = FIL_DE_CONVERSION
            .lock()
            .ok()
            .and_then(|slot| *slot)
            .expect("le témoin de conversion doit avoir été posé");
        assert_ne!(
            fil_conversion, fil_appelant,
            "la conversion a tourné sur le fil de l'interface : Pilot gèlerait"
        );

        // Le PDF est bien sur le disque et relisible, comme après un vrai geste.
        let out = report.results[0].output.clone().expect("chemin du PDF");
        let bytes = std::fs::read(&out).expect("PDF sur le disque");
        assert!(has_pdf_signature(&bytes));
    }

    #[test]
    fn un_vrai_document_du_projet_se_convertit_sans_impression() {
        // Preuve sur des documents RÉELS du dépôt (README + AGENTS.md : titres,
        // tableaux, blocs de code, listes, accents, liens). Le test se retire de
        // lui-même hors du dépôt (aucun fichier requis à côté du binaire).
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("racine du dépôt")
            .to_path_buf();
        let docs = ["README.md", "AGENTS.md"];
        let existing: Vec<String> = docs
            .iter()
            .map(|name| root.join(name))
            .filter(|path| path.exists())
            .map(|path| path.to_string_lossy().to_string())
            .collect();
        if existing.is_empty() {
            return;
        }
        let out = temp_dir("vrais-documents");
        let report = markdown_to_pdf_blocking(
            &existing,
            Some(out.to_string_lossy().as_ref()),
        )
        .expect("rapport du lot");
        assert_eq!(report.produced, existing.len(), "chaque document doit produire un PDF");
        assert_eq!(report.failed, 0);
        for result in &report.results {
            let path = result.output.clone().expect("chemin du PDF");
            let bytes = std::fs::read(&path).expect("PDF sur le disque");
            assert!(has_pdf_signature(&bytes), "{} ne commence pas par %PDF", path);
            assert!(bytes.len() > 1_000, "{} est suspectement petit", path);
            assert!(result.pages >= 1);
            assert_eq!(bytes.len(), result.bytes);
            // Le CONTENU du document est bien dans le fichier (pas une page vide).
            let text = String::from_utf8_lossy(&bytes);
            assert!(
                text.contains("Pilot"),
                "le texte du document est absent de {}",
                path
            );
        }
    }

    #[test]
    fn une_ligne_est_un_seul_objet_texte() {
        // Verrou du défaut « codagepi » : le texte d'une ligne ne doit PLUS être
        // placé morceau par morceau avec des largeurs calculées (une largeur
        // approchée décalait la suite de la ligne et collait les mots).
        let (bytes, _) = render_markdown_pdf(
            "Un **gras** collé au texte, de l'*italique*, du `code` et \u{153}.",
            None,
        );
        let text = String::from_utf8_lossy(&bytes).to_string();
        // Une seule ligne de texte ⇒ un seul objet texte, et plusieurs polices
        // à l'intérieur (c'est le moteur qui avance entre les morceaux).
        assert_eq!(
            text.matches("BT\n").count(),
            1,
            "la ligne doit être un seul objet texte"
        );
        for police in ["/F1 ", "/F2 ", "/F3 "] {
            assert!(
                text.contains(&format!("{}10.50 Tf", police)),
                "la police {} manque dans l'objet texte",
                police
            );
        }
        // Aucun positionnement manuel au milieu de la ligne.
        assert_eq!(text.matches(" Td\n").count(), 1, "un seul Td, en début de ligne");
    }

    #[test]
    fn un_lot_vide_est_refuse_en_clair() {
        let err = markdown_to_pdf_blocking(&[], None).unwrap_err();
        assert!(err.contains("Aucun fichier"));
    }

    #[test]
    fn un_fichier_non_markdown_est_refuse_sans_rien_ecrire() {
        let dir = temp_dir("not-md");
        let path = dir.join("note.txt");
        std::fs::write(&path, "du texte").unwrap();
        let report =
            markdown_to_pdf_blocking(&[path.to_string_lossy().to_string()], None).expect("rapport");
        assert_eq!(report.failed, 1);
        assert_eq!(report.produced, 0);
        assert!(!dir.join("note.pdf").exists());
        assert!(report.results[0]
            .error
            .as_deref()
            .unwrap_or("")
            .contains("Markdown"));
    }

    #[test]
    fn le_dossier_de_sortie_est_respecte() {
        let dir = temp_dir("out-dir");
        let src = dir.join("doc.md");
        std::fs::write(&src, "# Doc\n\ncontenu").unwrap();
        let out = dir.join("exports");
        let report = markdown_to_pdf_blocking(
            &[src.to_string_lossy().to_string()],
            Some(out.to_string_lossy().as_ref()),
        )
        .expect("rapport");
        assert_eq!(report.produced, 1);
        let produced = out.join("doc.pdf");
        assert!(produced.exists(), "PDF absent du dossier demandé");
        let bytes = std::fs::read(&produced).unwrap();
        assert!(has_pdf_signature(&bytes));
    }

    #[test]
    fn le_chemin_du_pdf_produit_est_rendu() {
        let dir = temp_dir("returned-path");
        let src = dir.join("mon-doc.md");
        std::fs::write(&src, "texte").unwrap();
        let report =
            markdown_to_pdf_blocking(&[src.to_string_lossy().to_string()], None).expect("rapport");
        let output = report.results[0].output.clone().expect("chemin produit");
        assert!(output.ends_with("mon-doc.pdf"));
        assert!(PathBuf::from(&output).exists());
        assert!(report.results[0].bytes > 0);
    }

    #[test]
    fn l_encodage_winansi_ne_perd_pas_les_accents() {
        let bytes = winansi_bytes("éàüçœ€—");
        assert_eq!(bytes, vec![0xE9, 0xE0, 0xFC, 0xE7, 0x9C, 0x80, 0x97]);
        // Un caractère non représentable qui a un équivalent ASCII honnête est
        // traduit (repli visible, jamais un octet inventé)…
        assert_eq!(winansi_bytes("→"), vec![b'>']);
        // … une lettre non représentable devient « ? » (visible, pas silencieuse).
        assert_eq!(winansi_bytes("Ж"), vec![b'?']);
        // Un émoji est RETIRÉ (règle déjà appliquée au texte lu à voix haute).
        assert_eq!(pdf_string("Options ⚙️ ici"), "(Options  ici)");
    }

    #[test]
    fn la_coupure_de_ligne_ne_perd_aucun_mot() {
        let runs = vec![Run {
            text: "un deux trois quatre cinq six sept huit neuf dix onze douze".to_string(),
            font: Font::Regular,
        }];
        let lines = wrap_runs(&runs, BODY_SIZE, 120.0);
        assert!(lines.len() > 1, "aucune coupure : risque de débordement");
        let joined: String = lines
            .iter()
            .map(|line| {
                line.iter()
                    .map(|r| r.text.as_str())
                    .collect::<Vec<_>>()
                    .join("")
            })
            .collect::<Vec<_>>()
            .join(" ");
        for mot in ["un", "deux", "onze", "douze"] {
            assert!(joined.contains(mot), "mot perdu : {}", mot);
        }
    }

    #[test]
    fn un_mot_plus_long_que_la_ligne_est_coupe_sans_boucle_infinie() {
        let runs = vec![Run {
            text: "A".repeat(400),
            font: Font::Regular,
        }];
        let lines = wrap_runs(&runs, BODY_SIZE, 100.0);
        assert!(lines.len() > 1);
        let total: usize = lines
            .iter()
            .map(|l| l.iter().map(|r| r.text.len()).sum::<usize>())
            .sum();
        assert_eq!(total, 400);
    }

    // Fabrique un PNG 2×2 RGB valide (aucune dépendance de test externe).
    fn build_png_rgb2x2() -> Vec<u8> {
        let raw: [u8; 14] = [
            0, 255, 0, 0, 0, 255, 0, //
            0, 0, 0, 255, 255, 255, 255,
        ];
        let compressed = zlib(&raw).expect("compression PNG");
        let mut out: Vec<u8> = Vec::new();
        out.extend_from_slice(b"\x89PNG\r\n\x1a\n");
        let mut push_chunk = |kind: &[u8; 4], data: &[u8]| {
            out.extend_from_slice(&(data.len() as u32).to_be_bytes());
            out.extend_from_slice(kind);
            out.extend_from_slice(data);
            out.extend_from_slice(&[0, 0, 0, 0]); // CRC non vérifiée par le décodeur
        };
        let mut ihdr = Vec::new();
        ihdr.extend_from_slice(&2u32.to_be_bytes());
        ihdr.extend_from_slice(&2u32.to_be_bytes());
        ihdr.extend_from_slice(&[8, 2, 0, 0, 0]);
        push_chunk(b"IHDR", &ihdr);
        push_chunk(b"IDAT", &compressed);
        push_chunk(b"IEND", &[]);
        out
    }
}
