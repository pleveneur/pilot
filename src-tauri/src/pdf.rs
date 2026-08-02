// pdf.rs — Export Markdown → HTML (pour impression PDF).
//
// Domaine extrait de `lib.rs` (2026-08) : `export_pdf` génère un document HTML
// complet (même CSS que la prévisualisation) à partir d'un Markdown source.
// Fonction pure (path → HTML), sans état applicatif.

use pulldown_cmark::Parser;
use std::fs;

#[tauri::command]
pub fn export_pdf(source_path: String) -> Result<String, String> {
    let md = fs::read_to_string(&source_path).map_err(|e| format!("Erreur lecture: {}", e))?;

    // Génération HTML via pulldown-cmark
    let mut html_output = String::new();
    pulldown_cmark::html::push_html(&mut html_output, Parser::new_ext(&md, pulldown_cmark::Options::all()));

    // Document HTML complet avec le même CSS que la prévisualisation
    let full_html = format!(
        r#"<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.7;
    color: #1e1e1e;
    background: #ffffff;
    padding: 30px 40px;
    max-width: 900px;
    margin: 0 auto;
  }}
  h1 {{ font-size: 1.8em; margin: 0.8em 0 0.4em; border-bottom: 1px solid #ddd; padding-bottom: 0.2em; }}
  h2 {{ font-size: 1.5em; margin: 0.8em 0 0.4em; }}
  h3 {{ font-size: 1.3em; margin: 0.7em 0 0.3em; }}
  h4, h5, h6 {{ font-size: 1.1em; margin: 0.6em 0 0.3em; }}
  p {{ margin: 0.5em 0; }}
  a {{ color: #007acc; text-decoration: none; }}
  ul, ol {{ padding-left: 2em; margin: 0.5em 0; }}
  li {{ margin: 0.2em 0; }}
  blockquote {{
    margin: 0.8em 0;
    padding: 0.5em 1em;
    border-left: 4px solid #ccc;
    background: #f9f9f9;
  }}
  code {{
    font-family: 'Consolas', 'Courier New', monospace;
    font-size: 0.9em;
    background: #f5f5f5;
    padding: 2px 5px;
    border-radius: 3px;
  }}
  pre {{
    background: #f5f5f5;
    padding: 12px 16px;
    border-radius: 6px;
    overflow-x: auto;
    margin: 0.8em 0;
    line-height: 1.5;
  }}
  pre code {{ background: none; padding: 0; font-size: 0.85em; }}
  table {{ border-collapse: collapse; margin: 0.8em 0; width: 100%; }}
  th, td {{ border: 1px solid #ddd; padding: 6px 12px; text-align: left; }}
  th {{ background: #f5f5f5; font-weight: bold; }}
  hr {{ border: none; border-top: 1px solid #ddd; margin: 1em 0; }}
  img {{
    max-width: 100%;
    margin: 1em 0;
    display: block;
  }}
  @media print {{
    body {{ padding: 20px 30px; }}
    @page {{ margin: 15mm; }}
    img {{ page-break-inside: avoid; max-height: 95vh; }}
    h1, h2, h3, h4 {{ page-break-after: avoid; }}
    p {{ orphans: 3; widows: 3; }}
  }}
</style>
</head>
<body>
{}
</body>
</html>"#, html_output);

    Ok(full_html)
}
