// Tests unitaires — gds-admin.js (lot L4.1 : squelette de l'onglet transverse).
// Couvre les aides de rendu PURES (réutilisées par l'écran de paramétrage L5.1).
import { describe, it, expect } from "vitest";
import {
  ADMIN_SECTIONS,
  renderAdminSectionHtml,
  renderAdminShellHtml,
} from "./gds-admin.js";

describe("ADMIN_SECTIONS (squelette L4.1)", () => {
  it("expose les 5 sections du LOT 4, dans l'ordre des micro-tâches", () => {
    expect(ADMIN_SECTIONS.map((s) => s.id)).toEqual([
      "connection",
      "accounts",
      "repos",
      "storage",
      "service",
    ]);
  });

  it("associe chaque section à sa micro-tâche (L4.2 → L4.6)", () => {
    expect(ADMIN_SECTIONS.map((s) => s.todo)).toEqual([
      "L4.2",
      "L4.3",
      "L4.4",
      "L4.5",
      "L4.6",
    ]);
  });

  it("chaque section a un titre, une description et une icône", () => {
    for (const s of ADMIN_SECTIONS) {
      expect(typeof s.title).toBe("string");
      expect(s.title.length).toBeGreaterThan(0);
      expect(typeof s.desc).toBe("string");
      expect(s.desc.length).toBeGreaterThan(0);
      expect(typeof s.icon).toBe("string");
      expect(s.icon.length).toBeGreaterThan(0);
    }
  });
});

describe("renderAdminSectionHtml (pure)", () => {
  it("génère une section avec son identifiant, son titre et son repère « À venir »", () => {
    const html = renderAdminSectionHtml(ADMIN_SECTIONS[0]);
    expect(html).toContain('data-section-id="connection"');
    expect(html).toContain("Connexion serveur");
    expect(html).toContain("À venir — L4.2");
    expect(html).toContain('data-lucide="plug-zap"');
  });

  it("échappe le contenu (pas d'injection HTML)", () => {
    const html = renderAdminSectionHtml({
      id: 'x"><script>',
      icon: "user",
      title: "<b>t</b>",
      desc: "<img src=x onerror=alert(1)>",
      todo: "L9.9",
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>t</b>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("renderAdminShellHtml (pure, réutilisable L5.1)", () => {
  it("compose la coquille : titre, sous-titre et toutes les sections", () => {
    const html = renderAdminShellHtml({
      title: "Écran",
      subtitle: "Sous-titre",
      sections: ADMIN_SECTIONS,
    });
    expect(html).toContain('class="gds-admin-scroll"');
    expect(html).toContain("Écran");
    expect(html).toContain("Sous-titre");
    for (const s of ADMIN_SECTIONS) {
      expect(html).toContain(`data-section-id="${s.id}"`);
    }
  });

  it("tolère une liste de sections vide / absente", () => {
    expect(renderAdminShellHtml({ title: "T", subtitle: "S", sections: [] })).toContain(
      'class="gds-admin-body"'
    );
    expect(renderAdminShellHtml({ title: "T", subtitle: "S" })).toContain(
      'class="gds-admin-body"'
    );
  });
});
