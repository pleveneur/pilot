/**
 * EXPORT MARKDOWN → PDF SANS FENÊTRE D'IMPRESSION — verrou complet.
 *
 * Défaut d'origine (rapport : docs/rapports/RAPPORT-pdf-sans-impression.md) :
 * l'export « Exporter en PDF » passait par un aperçu HTML dans une iframe puis
 * `iframe.contentWindow.print()` — la fenêtre d'impression du système. Le bouton
 * « mouline » indéfiniment, l'application se fige, et rien ne prouve qu'un
 * fichier a été écrit. Aucun outil n'existait pour qu'un agent produise un PDF.
 *
 * Ce fichier verrouille les SEPT exigences :
 *   1. l'export ne passe PLUS JAMAIS par l'impression (aucun `print()`, aucune
 *      iframe, aucun dialogue) — vérifié sur les sources réelles ;
 *   2. la conversion est confiée à la commande Rust `markdown_to_pdf`, déclarée
 *      `pub async fn` + `spawn_blocking` (l'application reste utilisable), et
 *      enregistrée dans `generate_handler!` ;
 *   3. un SEUL point d'exécution côté front (`runPdfExportRequest`) : la fenêtre
 *      et les trois canaux d'agent ne recopient pas la règle ;
 *   4. l'outil d'agent existe (`export_markdown_pdf`) et sa description dit ce
 *      qu'il produit et où ;
 *   5. le lot est traité fichier par fichier : un échec n'annule pas les autres
 *      et le rapport nomme chaque succès et chaque échec ;
 *   6. le panneau ne bloque jamais : son bouton « Fermer » n'est jamais
 *      désactivé (aucun état d'attente irréversible) ;
 *   7. aucune dépendance nouvelle n'a été ajoutée au moteur PDF.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args) => invokeMock(...args),
}));
vi.mock("./toast.js", () => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
  toastInfo: vi.fn(),
  showToast: vi.fn(),
}));

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const pdfExportSrc = () => readFileSync(resolve(HERE, "pdf-export.js"), "utf8").replace(/\r\n/g, "\n");
const rustSrc = (rel) =>
  readFileSync(resolve(ROOT, "src-tauri/src", rel), "utf8").replace(/\r\n/g, "\n");

/** Retire commentaires de bloc et de ligne : on juge le CODE, pas la prose. */
function codeOnly(source) {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const n = source[i + 1];
    if (c === "/" && n === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? source.length : end + 2;
      continue;
    }
    if (c === "/" && n === "/") {
      const nl = source.indexOf("\n", i);
      i = nl < 0 ? source.length : nl;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source[j] === c) {
          j += 1;
          break;
        }
        j += 1;
      }
      out += source.slice(i, j);
      i = j;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

const {
  PDF_EXPORT_SENTINEL,
  PDF_UI_TIMEOUT_MS,
  PDF_NO_SOURCE_MESSAGE,
  PDF_NO_ANSWER_MESSAGE,
  isMarkdownPath,
  pdfSourcesOf,
  normalizePdfRequest,
  pdfRequestFrom,
  isPdfExportRequest,
  pdfReportCounts,
  pdfReportLines,
  pdfReportStatus,
  pdfToolAnswer,
  pdfToolErrorAnswer,
  formatPdfToolResult,
} = await import("./pdf-gateway.js");

const { runPdfExportRequest, runPdfSentinelRequest } = await import("./pdf-export.js");

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── 1. La demande : sources, destination, sentinelle ─────────────────────────
describe("demande d'export : ce qui entre, ce qui n'entre pas", () => {
  it("ne retient que les Markdown, dédoublonnés, et découpe sur les retours à la ligne ou le point-virgule", () => {
    expect(pdfSourcesOf(["a.md", " a.md ", "b.markdown;c.md"])).toEqual([
      "a.md",
      "b.markdown",
      "c.md",
    ]);
    expect(pdfSourcesOf("x.md\ny.md")).toEqual(["x.md", "y.md"]);
    // Une VIRGULE ne sépare pas : « mon dossier/mon fichier, v2.md » est UN nom.
    expect(pdfSourcesOf(["mon dossier/mon fichier, v2.md"])).toEqual([
      "mon dossier/mon fichier, v2.md",
    ]);
  });

  it("ne retire JAMAIS un fichier en silence : un non-Markdown part au moteur, qui nomme l'échec", () => {
    // Le socle Rust est la SEULE autorité sur le disque : il vaut mieux un échec
    // nommé (« n'est pas un fichier Markdown ») qu'un fichier disparu du lot sans
    // que personne ne le sache.
    const req = normalizePdfRequest({ sources: ["rapport.docx"] });
    expect(req.error).toBe("");
    expect(req.sources).toEqual(["rapport.docx"]);
    expect(isMarkdownPath("rapport.docx")).toBe(false);
  });

  it("exige une source : message clair, jamais une conversion silencieuse de rien", () => {
    expect(normalizePdfRequest({ sources: [] }).error).toBe(PDF_NO_SOURCE_MESSAGE);
    expect(normalizePdfRequest(null).error).toBe(PDF_NO_SOURCE_MESSAGE);
  });

  it("lit une destination demandée, sinon laisse le moteur écrire à côté", () => {
    expect(normalizePdfRequest({ sources: ["C:/x/y.md"], out_dir: "C:/out" }).out_dir).toBe(
      "C:/out",
    );
    expect(normalizePdfRequest({ sources: ["C:/x/y.md"] }).out_dir).toBe(null);
  });

  it("reconnaît la sentinelle PDF et REFUSE tout autre titre", () => {
    const title = PDF_EXPORT_SENTINEL + JSON.stringify({ sources: ["/p/a.md"] });
    expect(isPdfExportRequest(title)).toBe(true);
    expect(isPdfExportRequest("PILOT_ASSISTANT_SCHEDULE::{\"op\":\"list\"}")).toBe(false);
    expect(isPdfExportRequest("")).toBe(false);
    expect(pdfRequestFrom(title).sources).toEqual(["/p/a.md"]);
    // Payload illisible : refus explicite, pas d'exception.
    expect(pdfRequestFrom(PDF_EXPORT_SENTINEL + "{oops").error).toBeTruthy();
    expect(isMarkdownPath("C:/x/y.MD")).toBe(true);
    expect(isMarkdownPath("notes.mdx")).toBe(true);
    expect(isMarkdownPath("a.pdf")).toBe(false);
  });
});

// ── 2. Le rapport : un échec n'efface jamais un succès ───────────────────────
describe("rapport : fichier par fichier, aucun silence", () => {
  const mixed = {
    results: [
      { source: "/p/a.md", output: "/p/a.pdf", ok: true, bytes: 1200, pages: 2, error: null },
      { source: "/p/b.md", output: null, ok: false, bytes: 0, pages: 0, error: "disque plein" },
    ],
    produced: 1,
    failed: 1,
  };

  it("nomme le PDF produit ET l'échec avec sa raison", () => {
    const lines = pdfReportLines(mixed).join("\n");
    expect(lines).toContain("/p/a.pdf");
    expect(lines).toContain("2 page(s)");
    expect(lines).toContain("1 échec");
    expect(lines).toContain("/p/b.md");
    expect(lines).toContain("disque plein");
    expect(pdfReportCounts(mixed)).toEqual({ produced: 1, failed: 1, total: 2 });
    expect(pdfReportStatus(mixed)).toBe("⚠️ 1 PDF produit(s), 1 échec(s)");
  });

  it("ne prétend jamais un succès complet quand un fichier a échoué", () => {
    expect(pdfReportStatus(mixed)).not.toContain("✅");
    expect(pdfReportStatus({ results: [mixed.results[1]], produced: 0, failed: 1 })).toBe(
      "❌ Échec de la conversion",
    );
    expect(pdfReportStatus({ results: [mixed.results[0]], produced: 1, failed: 0 })).toBe(
      "✅ PDF produit",
    );
    expect(pdfReportStatus(null)).toBe("Aucun fichier à convertir");
  });

  it("rend au moteur un rapport JSON complet, ou une erreur NOMMÉE — jamais du vide", () => {
    const answer = JSON.parse(pdfToolAnswer(mixed));
    expect(answer.produced).toBe(1);
    expect(answer.failed).toBe(1);
    expect(answer.results).toHaveLength(2);
    expect(JSON.parse(pdfToolErrorAnswer("disque plein")).error).toBe("disque plein");
    expect(JSON.parse(pdfToolErrorAnswer(new Error("boum"))).error).toBe("boum");
  });

  it("le texte lu par le modèle ne dépend pas du canal : succès lisibles, échec en erreur", () => {
    const okOne = formatPdfToolResult(
      JSON.stringify({ results: [mixed.results[0]], produced: 1, failed: 0 }),
    );
    expect(okOne.isError).toBe(false);
    expect(okOne.text).toContain("/p/a.pdf");

    const failed = formatPdfToolResult(pdfToolErrorAnswer("disque plein"));
    expect(failed.isError).toBe(true);
    expect(failed.text).toBe("disque plein");

    // Aucune réponse (dialogue perdu) : l'agent lit une phrase, jamais `undefined`.
    expect(formatPdfToolResult(null).text).toBe(PDF_NO_ANSWER_MESSAGE);
    expect(formatPdfToolResult(null).isError).toBe(true);
  });

  it("le plafond d'attente de l'outil et celui du cœur sont IDENTIQUES", () => {
    const src = readFileSync(resolve(ROOT, "src-tauri/extensions/pilot-pdf.ts"), "utf8");
    const m = src.match(/const PILOT_UI_OPTS\s*=\s*\{\s*timeout:\s*([\d_]+)\s*\}/);
    expect(m, "pilot-pdf.ts doit déclarer sa borne d'attente").not.toBeNull();
    expect(Number(m[1].replace(/_/g, ""))).toBe(PDF_UI_TIMEOUT_MS);
  });
});

// ── 3. L'exécution : une seule voie, hors du fil d'affichage ─────────────────
describe("exécution : la commande Rust, et rien d'autre", () => {
  it("appelle `markdown_to_pdf` avec les sources normalisées et la destination", async () => {
    invokeMock.mockResolvedValue({
      results: [
        { source: "/p/a.md", output: "/p/a.pdf", ok: true, bytes: 10, pages: 1, error: null },
      ],
      produced: 1,
      failed: 0,
    });
    const report = await runPdfExportRequest({ sources: ["/p/a.md", "/p/a.md"] });
    expect(report.produced).toBe(1);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0][0]).toBe("markdown_to_pdf");
    expect(invokeMock.mock.calls[0][1]).toEqual({ sources: ["/p/a.md"], outDir: null });
  });

  it("ne lève JAMAIS : une panne de commande devient un échec nommé, source par source", async () => {
    invokeMock.mockRejectedValue(new Error("moteur indisponible"));
    const report = await runPdfExportRequest({ sources: ["/p/a.md", "/p/b.md"] });
    expect(report.failed).toBe(2);
    expect(report.produced).toBe(0);
    expect(report.results.map((r) => r.source)).toEqual(["/p/a.md", "/p/b.md"]);
    for (const r of report.results) expect(r.error).toBe("moteur indisponible");
  });

  it("une demande vide n'appelle même pas le moteur", async () => {
    const report = await runPdfExportRequest({ sources: ["  ", ""] });
    expect(invokeMock).not.toHaveBeenCalled();
    expect(report.error).toBe(PDF_NO_SOURCE_MESSAGE);
  });

  it("la sentinelle d'un agent passe par le MÊME point d'exécution", async () => {
    invokeMock.mockResolvedValue({ results: [], produced: 0, failed: 0 });
    const answer = await runPdfSentinelRequest(
      PDF_EXPORT_SENTINEL + JSON.stringify({ sources: ["/p/a.md"] }),
    );
    expect(invokeMock.mock.calls[0][0]).toBe("markdown_to_pdf");
    expect(JSON.parse(answer)).toHaveProperty("results");

    // Titre étranger : rien n'est exécuté, la raison est dite.
    invokeMock.mockClear();
    const refused = JSON.parse(await runPdfSentinelRequest("PILOT_AUTRE_CHOSE::{}"));
    expect(refused.error).toBeTruthy();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("`markdown_to_pdf` est `pub async fn` + `spawn_blocking` et enregistrée", () => {
    const src = rustSrc("pdf_export.rs");
    const decl = src.match(/#\[tauri::command\][\s\S]{0,200}?pub async fn markdown_to_pdf/);
    expect(decl, "la commande doit être asynchrone (jamais sur le fil d'affichage)").not.toBeNull();
    expect(src).toContain("tauri::async_runtime::spawn_blocking");
    const lib = rustSrc("lib.rs");
    expect(lib).toMatch(/mod pdf_export;/);
    expect(lib).toMatch(/pdf_export::markdown_to_pdf/);
  });

  it("le moteur PDF n'imprime rien et n'ouvre aucun dialogue", () => {
    const src = codeOnly(rustSrc("pdf_export.rs"));
    for (const interdit of ["window.print", "contentWindow.print", "printDialog", "ShellExecute"]) {
      expect(src.toLowerCase()).not.toContain(interdit.toLowerCase());
    }
  });

  it("aucune dépendance nouvelle n'a été ajoutée pour produire le PDF", () => {
    const manifest = readFileSync(resolve(ROOT, "src-tauri/Cargo.toml"), "utf8");
    // Le moteur s'appuie sur des crates DÉJÀ présentes (pulldown-cmark, flate2).
    expect(manifest).toMatch(/flate2\s*=\s*"1"/);
    expect(manifest).toMatch(/pulldown-cmark/);
    // Aucune bibliothèque d'impression / de PDF téléchargée pour ce travail.
    for (const interdit of ["headless_chrome", "wkhtmltopdf", "weasyprint", "chromiumoxide", "printpdf"]) {
      expect(manifest).not.toContain(interdit);
    }
  });
});

// ── 4. Plus aucune fenêtre d'impression dans le front ────────────────────────
describe("front : la fenêtre d'impression a disparu du chemin d'export", () => {
  it("`pdf-export.js` n'imprime pas, n'ouvre pas d'iframe, ne demande aucun dialogue", () => {
    const code = codeOnly(pdfExportSrc());
    expect(code).not.toMatch(/\bprint\s*\(/);
    expect(code).not.toContain("contentWindow");
    expect(code).not.toContain("createElement(\"iframe\")");
    expect(code).not.toContain("window.open");
    expect(code).not.toMatch(/\bconfirm\s*\(/);
    // Le seul appel système reste la conversion : `markdown_to_pdf`.
    expect(code).toContain("markdown_to_pdf");
  });

  it("le bouton « Fermer » n'est JAMAIS désactivé (aucune attente irréversible)", () => {
    const code = codeOnly(pdfExportSrc());
    expect(code).not.toMatch(/closeBtn\.disabled\s*=\s*true/);
    expect(code).not.toMatch(/#pdf-export-close[\s\S]{0,80}?disabled\s*=\s*true/);
    // Il est bien branché (un panneau qu'on ne peut pas fermer serait pire).
    expect(code).toMatch(/closeBtn\.addEventListener\(\s*"click"/);
    expect(code).toContain("Escape");
  });

  it("aucun fichier du front ne rappelle l'impression par iframe pour exporter", () => {
    // Le seul `print()` du dépôt ne doit plus concerner l'export PDF.
    const files = ["pdf-export.js", "pdf-gateway.js", "sidebar.js"];
    for (const f of files) {
      const code = codeOnly(readFileSync(resolve(HERE, f), "utf8"));
      expect(code, f).not.toContain("contentWindow.print");
    }
  });

  it("un SEUL point d'exécution côté front : aucune copie de la commande ailleurs", () => {
    const channels = ["super-agent.js", "agent-pi.js", "agents-bus.js"];
    for (const f of channels) {
      const code = codeOnly(readFileSync(resolve(HERE, f), "utf8").replace(/\r\n/g, "\n"));
      expect(code, `${f} doit passer par le point unique`).toContain("runPdfSentinelRequest");
      expect(code, `${f} ne doit pas appeler le moteur directement`).not.toContain(
        'invoke("markdown_to_pdf"',
      );
    }
    // L'outil est bien enregistré comme outil d'extension pour les agents.
    const ext = readFileSync(resolve(ROOT, "src-tauri/extensions/pilot-pdf.ts"), "utf8");
    expect(ext).toContain('name: "export_markdown_pdf"');
    expect(ext).toMatch(/description:/);
    expect(ext).toContain("PDF");
    // ... et écrit pour toutes les sessions d'agent, pas seulement l'assistant.
    const service = rustSrc("agent_service.rs");
    expect(service).toContain("fn write_pdf_extension");
    expect(service.match(/Self::write_pdf_extension\(/g).length).toBeGreaterThanOrEqual(4);
  });

  it("la sentinelle PDF est traduite, jamais affichée brute", async () => {
    const { readableMachineText, isSelfAnsweredMachineRequest } = await import(
      "./machine-sentinel.js"
    );
    const title = PDF_EXPORT_SENTINEL + JSON.stringify({ sources: ["/p/a.md"] });
    const said = readableMachineText(title);
    expect(said).not.toContain("PILOT_");
    expect(said.toLowerCase()).toContain("pdf");
    // Action interne : le relais l'EXÉCUTE, il ne prétend pas attendre une réponse.
    expect(isSelfAnsweredMachineRequest({ method: "input", title })).toBe(true);
    // Une famille inconnue reste neutre, un texte sans sentinelle n'est pas réécrit.
    expect(readableMachineText("PILOT_INCONNU::x")).not.toContain("PILOT_");
    expect(readableMachineText("Bonjour")).toBe("Bonjour");
  });
});
