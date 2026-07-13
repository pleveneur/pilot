import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import * as fs from "node:fs";
import * as path from "node:path";

// --- Helpers ---

interface FetchResult {
  markdown: string;
  title: string;
  url: string;
}

async function fetchAndConvert(url: string, ctx?: { signal?: AbortSignal }): Promise<FetchResult> {
  // 1. Fetch the page
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; PiHelp-Fetch/1.0)",
      "Accept": "text/html,application/xhtml+xml",
    },
    signal: ctx?.signal,
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
    throw new Error(`Type de contenu non supporté : ${contentType}. Seul le HTML est accepté.`);
  }

  const html = await response.text();

  // 2. Parse DOM and extract main content with Readability
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article) {
    throw new Error("Impossible d'extraire le contenu principal de cette page.");
  }

  // 3. Convert HTML to Markdown
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  });

  // Custom rules for better Markdown output
  turndown.addRule("remove-empty-links", {
    filter: (node) => {
      return node.nodeName === "A" && !node.textContent?.trim();
    },
    replacement: () => "",
  });

  const markdown = turndown.turndown(article.content);

  return {
    markdown: `# ${article.title}\n\n> Source : ${url}\n\n${markdown}`,
    title: article.title ?? "sans-titre",
    url,
  };
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// --- Extension ---

export default function (pi: ExtensionAPI) {
  // ============================================================
  // Outil custom : fetch_webpage
  // ============================================================
  pi.registerTool({
    name: "fetch_webpage",
    label: "Fetch Webpage",
    description:
      "Récupère le contenu d'une page web (documentation, article) et le convertit en Markdown. " +
      "À utiliser quand l'utilisateur demande d'aller chercher ou consulter une page de documentation en ligne.",
    parameters: Type.Object({
      url: Type.String({ description: "L'URL complète de la page web à récupérer" }),
      saveToFile: Type.Optional(
        Type.Boolean({
          description: "Si true, sauvegarde également le résultat dans un fichier Markdown local (dans docs/)",
          default: false,
        })
      ),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      onUpdate?.({ content: [{ type: "text", text: `Récupération de ${params.url}...` }] });

      try {
        const result = await fetchAndConvert(params.url, { signal });

        // Optionally save to file
        let filePath: string | undefined;
        if (params.saveToFile) {
          const docsDir = path.join(ctx?.cwd ?? process.cwd(), "docs");
          ensureDir(docsDir);
          const filename = `${slugify(result.title)}.md`;
          filePath = path.join(docsDir, filename);
          fs.writeFileSync(filePath, result.markdown, "utf-8");
        }

        const responseText = result.markdown.length > 50000
          ? result.markdown.slice(0, 50000) + "\n\n[... contenu tronqué à 50 000 caractères ...]"
          : result.markdown;

        return {
          content: [{ type: "text", text: responseText }],
          details: {
            title: result.title,
            url: result.url,
            savedTo: filePath ?? null,
            totalLength: result.markdown.length,
          },
        };
      } catch (err: any) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `❌ Erreur lors du fetch : ${message}` }],
          details: { error: message, url: params.url },
        };
      }
    },
  });

  // ============================================================
  // Commande slash : /fetch
  // ============================================================
  pi.registerCommand("fetch", {
    description: "Récupère une page web et la convertit en Markdown. Usage : /fetch <url>",
    handler: async (args, ctx) => {
      const url = args?.trim();

      if (!url) {
        ctx.ui.notify("Usage : /fetch <url>\nExemple : /fetch https://pi.dev/docs/latest/rpc", "error");
        return;
      }

      // Validate URL format
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        ctx.ui.notify(`URL invalide : "${url}". Doit commencer par http:// ou https://`, "error");
        return;
      }

      ctx.ui.notify(`Récupération de ${parsed.href}...`, "info");
      ctx.ui.setStatus("fetch", `Fetching ${parsed.hostname}...`);

      try {
        const result = await fetchAndConvert(parsed.href, { signal: ctx.signal });

        // Save to docs/
        const docsDir = path.join(ctx.cwd, "docs");
        ensureDir(docsDir);
        const filename = `${slugify(result.title)}.md`;
        const filePath = path.join(docsDir, filename);
        fs.writeFileSync(filePath, result.markdown, "utf-8");

        ctx.ui.notify(
          `✅ Page sauvegardée : "${result.title}" → docs/${filename} (${result.markdown.length.toLocaleString()} caractères)`,
          "success"
        );
        ctx.ui.setStatus("fetch", `Saved: docs/${filename}`);
      } catch (err: any) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(`❌ Erreur : ${message}`, "error");
        ctx.ui.setStatus("fetch", "Error");
      }
    },
  });

  // ============================================================
  // Événement de démarrage
  // ============================================================
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("Extension 'web-to-markdown' chargée — /fetch <url> disponible", "info");
  });
}
