// pdf-gateway.js — SOURCE UNIQUE de l'export Markdown → PDF SANS IMPRESSION.
//
// POURQUOI CE MODULE (défaut corrigé) : l'export PDF passait par un aperçu dans
// une iframe puis `iframe.contentWindow.print()`, c'est-à-dire la fenêtre
// d'impression du système — l'application « moulinait » et se figeait, et aucun
// agent ne pouvait produire un PDF. Désormais la conversion est faite par le
// moteur PDF embarqué (Rust, hors fil d'affichage) et le fichier est ÉCRIT sur
// le disque : aucune fenêtre, aucun dialogue, aucun blocage.
//
// Ce fichier ne fait AUCUNE I/O et ne touche à AUCUN DOM : il porte les
// décisions, partagées mot pour mot par les TROIS appelants —
//   1. l'extension d'agent `pilot-pdf.ts` (outil `export_markdown_pdf`), qui
//      importe `./pdf-gateway.js` écrit à côté d'elle ;
//   2. la fenêtre (`pdf-export.js`), qui exécute la commande Rust et renvoie le
//      rapport ;
//   3. les tests Vitest, qui n'ont besoin d'aucun runtime pi ni Tauri.
//
// RÈGLES PORTÉES ICI (une seule copie, jamais une seconde) :
//   - la sentinelle machine `PILOT_PDF_EXPORT::<JSON>` (un agent ne peut pas
//     appeler une commande Tauri : il passe par un titre de `ctx.ui.input`) ;
//   - la NORMALISATION de la demande (liste de sources non vide, extension
//     contrôlée, dossier de sortie optionnel) ;
//   - la mise en FORME LISIBLE du rapport (succès nommés, échecs nommés avec
//     leur raison) — jamais un succès inventé, jamais un échec avalé.

/**
 * Sentinelle machine de l'export PDF. Une famille à elle (pas
 * `PILOT_ASSISTANT_`) : l'outil est disponible dans TOUTES les sessions
 * d'agent (chat du projet, agents multi-rôles, assistant).
 */
export const PDF_EXPORT_SENTINEL = "PILOT_PDF_EXPORT::";

/**
 * Attente maximale d'une réponse de Pilot à l'outil. Un lot de gros documents
 * peut être long (conversion + relecture de chaque PDF) : la borne est large,
 * mais elle existe — une réponse perdue ne laisse jamais l'outil pendu.
 */
export const PDF_UI_TIMEOUT_MS = 180000;

/** Extensions Markdown acceptées (en minuscules, sans le point). Exactement
 *  celles que le socle Rust sait lire (`is_markdown_path` dans pdf_export.rs) :
 *  les deux listes ne peuvent pas diverger. */
export const PDF_SOURCE_EXTENSIONS = ["md", "markdown", "mdx"];

/** Message unique quand la demande ne contient rien de convertible. */
export const PDF_NO_SOURCE_MESSAGE =
  "Aucun fichier Markdown fourni : rien n'a été converti. Indiquez le chemin absolu d'au moins un fichier .md.";

/** Message unique quand aucune réponse n'est revenue de Pilot. */
export const PDF_NO_ANSWER_MESSAGE =
  "La conversion PDF n'a pas répondu (fenêtre fermée ou attente expirée). Aucun PDF n'est garanti : vérifiez le disque avant d'annoncer un résultat.";

/**
 * Vrai si le chemin désigne un fichier Markdown (`.md` / `.markdown` / `.mdx`,
 * casse indifférente). Aucun autre test n'est fait ici : l'existence du fichier est
 * vérifiée par le socle Rust, seule autorité sur le disque.
 * @param {unknown} path
 * @returns {boolean}
 */
export function isMarkdownPath(path) {
  if (typeof path !== "string") return false;
  const clean = path.trim();
  if (!clean) return false;
  const dot = clean.lastIndexOf(".");
  if (dot < 0) return false;
  const ext = clean.slice(dot + 1).toLowerCase();
  return PDF_SOURCE_EXTENSIONS.includes(ext);
}

/**
 * Découpe une liste de sources telle qu'un modèle peut l'envoyer : chaînes,
 * tableaux, valeur unique, séparateurs éventuels. Les entrées vides sont
 * retirées et les doublons exacts supprimés (un même fichier n'est pas converti
 * deux fois dans le même lot).
 * @param {unknown} sources
 * @returns {string[]}
 */
export function pdfSourcesOf(sources) {
  const raw = [];
  // Un modèle peut envoyer un tableau, une valeur unique, ou plusieurs chemins
  // séparés par un saut de ligne / un point-virgule. On ne coupe JAMAIS sur la
  // virgule : un chemin de fichier peut en contenir.
  if (Array.isArray(sources)) {
    raw.push(...sources);
  } else {
    raw.push(sources);
  }
  const seen = new Set();
  const out = [];
  const rawParts = [];
  for (const value of raw) {
    if (typeof value !== "string") continue;
    for (const part of value.split(/\r?\n|;/)) {
      rawParts.push(part);
    }
  }
  for (const value of rawParts) {
    const clean = value.trim().replace(/^["'`]+|["'`]+$/g, "").trim();
    if (!clean) continue;
    const key = clean.replace(/\\/g, "/").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

/**
 * Normalise une demande d'export : `{ sources, out_dir, error }`.
 * - `sources` : chemins nettoyés, non vides ;
 * - `out_dir` : dossier demandé, ou `null` (chaque PDF à côté de sa source) ;
 * - `error` : message lisible si la demande ne peut pas être exécutée (`""` si
 *   elle est valable). On ne devine JAMAIS un chemin à la place de l'appelant.
 * @param {{sources?:unknown, out_dir?:unknown, outDir?:unknown}|null|undefined} request
 * @returns {{sources:string[], out_dir:string|null, error:string}}
 */
export function normalizePdfRequest(request) {
  const req = request && typeof request === "object" ? request : {};
  const sources = pdfSourcesOf(req.sources);
  if (sources.length === 0) {
    return { sources: [], out_dir: null, error: PDF_NO_SOURCE_MESSAGE };
  }
  const rawDir = typeof req.out_dir === "string" ? req.out_dir : req.outDir;
  const outDir = typeof rawDir === "string" && rawDir.trim() ? rawDir.trim() : null;
  return { sources, out_dir: outDir, error: "" };
}

/**
 * Demande d'export portée par un titre de demande d'extension, ou `null` si ce
 * n'en est pas une. Ne lève jamais : un JSON illisible donne `null`.
 * @param {unknown} title
 * @returns {{sources:string[], out_dir:string|null, error:string}|null}
 */
export function pdfRequestFrom(title) {
  if (typeof title !== "string" || !title.startsWith(PDF_EXPORT_SENTINEL)) return null;
  const payload = title.slice(PDF_EXPORT_SENTINEL.length);
  let parsed = null;
  try {
    parsed = JSON.parse(payload);
  } catch (_) {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { sources: [], out_dir: null, error: PDF_NO_SOURCE_MESSAGE };
  }
  return normalizePdfRequest(parsed);
}

/**
 * Vrai si le titre porte une demande d'export PDF (sentinelle présente, JSON
 * lisible ou non : dans tous les cas l'utilisateur ne doit jamais voir la
 * chaîne brute).
 * @param {unknown} title
 * @returns {boolean}
 */
export function isPdfExportRequest(title) {
  return typeof title === "string" && title.startsWith(PDF_EXPORT_SENTINEL);
}

/**
 * Compte les résultats d'un rapport : `{ produced, failed, total }`.
 * Tolérant (rapport absent, champs manquants) : jamais d'exception.
 * @param {{results?:Array<object>}|null|undefined} report
 * @returns {{produced:number, failed:number, total:number}}
 */
export function pdfReportCounts(report) {
  const results = report && Array.isArray(report.results) ? report.results : [];
  let produced = 0;
  let failed = 0;
  for (const r of results) {
    if (r && r.ok && typeof r.output === "string" && r.output) produced += 1;
    else failed += 1;
  }
  return { produced, failed, total: results.length };
}

/**
 * Lignes lisibles d'un rapport : un succès dit le chemin, les pages et la
 * taille ; un échec dit la source ET la raison. Aucune ligne inventée.
 * @param {{results?:Array<object>}|null|undefined} report
 * @returns {string[]}
 */
export function pdfReportLines(report) {
  const results = report && Array.isArray(report.results) ? report.results : [];
  const { produced, failed } = pdfReportCounts(report);
  const lines = [];
  lines.push(produced === 1 ? "1 PDF produit :" : `${produced} PDF produits :`);
  for (const r of results) {
    if (r && r.ok && typeof r.output === "string") {
      const pages = Number(r.pages) || 0;
      const bytes = Number(r.bytes) || 0;
      lines.push(`- OK ${r.output} (${pages} page(s), ${bytes} octets)`);
    }
  }
  if (failed > 0) {
    lines.push(failed === 1 ? "1 échec :" : `${failed} échecs :`);
    for (const r of results) {
      if (r && r.ok) continue;
      const source = r && typeof r.source === "string" && r.source ? r.source : "(source inconnue)";
      const reason = r && typeof r.error === "string" && r.error ? r.error : "raison inconnue";
      lines.push(`- ÉCHEC ${source} : ${reason}`);
    }
  }
  return lines;
}

/**
 * Phrase d'état unique pour l'écran (barre de l'export) : elle ne prétend
 * jamais un succès complet quand un fichier a échoué.
 * @param {{results?:Array<object>}|null|undefined} report
 * @returns {string}
 */
export function pdfReportStatus(report) {
  const { produced, failed, total } = pdfReportCounts(report);
  if (total === 0) return "Aucun fichier à convertir";
  if (failed === 0) return produced === 1 ? "✅ PDF produit" : `✅ ${produced} PDF produits`;
  if (produced === 0) return failed === 1 ? "❌ Échec de la conversion" : `❌ ${failed} échecs`;
  return `⚠️ ${produced} PDF produit(s), ${failed} échec(s)`;
}

/**
 * Réponse renvoyée au moteur d'agent : le rapport JSON complet (le modèle lit
 * les chemins produits et les raisons d'échec) — jamais un résumé qui
 * masquerait un échec.
 * @param {{results?:Array<object>}|null|undefined} report
 * @returns {string}
 */
export function pdfToolAnswer(report) {
  const safe = report && typeof report === "object" ? report : { results: [] };
  const { produced, failed } = pdfReportCounts(safe);
  return JSON.stringify({
    produced,
    failed,
    results: Array.isArray(safe.results) ? safe.results : [],
  });
}

/**
 * Réponse d'ERREUR renvoyée au moteur d'agent (demande invalide, commande en
 * échec) : toujours un JSON `{error}` lisible, jamais une exception propagée.
 * @param {unknown} error
 * @returns {string}
 */
export function pdfToolErrorAnswer(error) {
  const reason =
    typeof error === "string" && error.trim()
      ? error.trim()
      : error && typeof error.message === "string" && error.message
        ? error.message
        : "conversion PDF impossible";
  return JSON.stringify({ error: reason });
}

/**
 * Mise en forme du résultat de l'outil pour le modèle : `{ text, isError }`.
 * Partagée par l'extension et les tests, pour que le texte lu par le modèle ne
 * dépende pas de l'endroit d'où la conversion a été lancée.
 * @param {unknown} answer - réponse de Pilot (JSON de rapport, JSON d'erreur, ou texte brut)
 * @returns {{text:string, isError:boolean}}
 */
export function formatPdfToolResult(answer) {
  if (answer == null || answer === "") {
    return { text: PDF_NO_ANSWER_MESSAGE, isError: true };
  }
  const raw = typeof answer === "string" ? answer : JSON.stringify(answer);
  let report = null;
  try {
    report = JSON.parse(raw);
  } catch (_) {
    report = null;
  }
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    // Réponse non JSON : transmise telle quelle, jamais réécrite ni inventée.
    return { text: raw, isError: false };
  }
  if (typeof report.error === "string" && report.error) {
    return { text: report.error, isError: true };
  }
  const counts = pdfReportCounts(report);
  const lines = pdfReportLines(report);
  return { text: lines.join("\n"), isError: counts.failed > 0 || counts.produced === 0 };
}
