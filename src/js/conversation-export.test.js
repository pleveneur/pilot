// Tests unitaires — conversation-export.js (F2/F3 : génération Markdown/HTML)
import { describe, it, expect } from "vitest";
import { toMarkdown, toHtml } from "./conversation-export.js";

describe("toMarkdown", () => {
  it("retourne une chaîne vide si aucun événement", () => {
    expect(toMarkdown([])).toBe("");
  });

  it("rend un message utilisateur", () => {
    const md = toMarkdown([{ kind: "user", text: "Bonjour" }]);
    expect(md).toContain("### 👤 Vous");
    expect(md).toContain("Bonjour");
  });

  it("rend un message assistant", () => {
    const md = toMarkdown([{ kind: "assistant", text: "Je corrige", content: "<p>Je corrige</p>" }]);
    expect(md).toContain("### 🤖 Agent");
    expect(md).toContain("Je corrige");
  });

  it("rend la pensée en citation", () => {
    const md = toMarkdown([{ kind: "thinking", text: "réflexion" }]);
    expect(md).toContain("💭");
    expect(md).toContain("réflexion");
  });

  it("rend un appel outil et son résultat en bloc code", () => {
    const md = toMarkdown([
      { kind: "tool", text: "bash ls" },
      { kind: "tool_result", text: "bash\nfichier.txt", raw: "fichier.txt" },
    ]);
    expect(md).toContain("🔧");
    expect(md).toContain("bash ls");
    expect(md).toContain("```");
    expect(md).toContain("fichier.txt");
  });

  it("rend un message système et une erreur", () => {
    const md = toMarkdown([
      { kind: "system", text: "Plan mis en pause" },
      { kind: "error", text: "Échec de connexion" },
    ]);
    expect(md).toContain("Plan mis en pause");
    expect(md).toContain("Échec de connexion");
  });
});

describe("toHtml", () => {
  it("retourne un document HTML complet pour des événements", () => {
    const html = toHtml([
      { kind: "user", text: "Bonjour", content: "Bonjour" },
      { kind: "assistant", text: "Salut", content: "<p>Salut</p>" },
    ]);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("👤");
    expect(html).toContain("🤖");
    expect(html).toContain("</html>");
  });

  it("échappe le texte brut (XSS)", () => {
    const html = toHtml([{ kind: "error", text: "<script>alert(1)</script>" }]);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("retourne un document minimal si aucun événement", () => {
    const html = toHtml([]);
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
  });
});
