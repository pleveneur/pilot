// Tests unitaires — gds-params.js (lot L5.1 : squelette de l'onglet transverse
// « GDS — paramétrage »). Couvre les aides de rendu PURES et la RÉUTILISATION de
// la coquille de gds-admin.js (renderAdminShellHtml), sans duplication.
import { describe, it, expect } from "vitest";
import {
  PARAMS_SECTIONS,
  PARAMS_TITLE,
  PARAMS_SUBTITLE,
  renderParamsShellHtml,
} from "./gds-params.js";
import { renderAdminShellHtml } from "./gds-admin.js";

describe("gds-params — squelette L5.1", () => {
  it("déclare les quatre sections du paramétrage dans l'ordre du plan", () => {
    expect(PARAMS_SECTIONS.map((s) => s.id)).toEqual(["servers", "identity", "keys", "projects"]);
    expect(PARAMS_SECTIONS.map((s) => s.title)).toEqual([
      "Serveurs GDS",
      "Mon identité",
      "Mes clés",
      "Mes projets GDS",
    ]);
  });

  it("associe chaque section à sa micro-tâche du LOT 5", () => {
    expect(PARAMS_SECTIONS.map((s) => s.todo)).toEqual(["L5.2", "L5.3", "L5.4", "L5.5"]);
  });

  it("chaque section porte une icône (bibliothèque Lucide déjà utilisée)", () => {
    for (const s of PARAMS_SECTIONS) {
      expect(String(s.icon).trim().length).toBeGreaterThan(0);
      expect(String(s.desc).trim().length).toBeGreaterThan(0);
    }
  });

  it("renderParamsShellHtml réutilise la coquille d'administration (mêmes classes)", () => {
    const html = renderParamsShellHtml();
    // Identique à renderAdminShellHtml avec les sections du paramétrage.
    const expected = renderAdminShellHtml({
      title: PARAMS_TITLE,
      subtitle: PARAMS_SUBTITLE,
      sections: PARAMS_SECTIONS,
    });
    expect(html).toBe(expected);
    expect(html).toContain("gds-admin-scroll");
    expect(html).toContain("gds-admin-body");
  });

  it("renderParamsShellHtml affiche titre, sous-titre et les 4 titres de section", () => {
    const html = renderParamsShellHtml();
    expect(html).toContain(PARAMS_TITLE);
    expect(html).toContain(PARAMS_SUBTITLE);
    for (const s of PARAMS_SECTIONS) {
      expect(html).toContain(s.title);
      expect(html).toContain(`data-section-id="${s.id}"`);
      expect(html).toContain(`À venir — ${s.todo}`);
    }
  });

  it("renderParamsShellHtml accepte une section REMPLIE (sectionHtml) sans toucher aux autres", () => {
    const html = renderParamsShellHtml({ sectionHtml: { servers: "<div id=\"x\">rempli</div>" } });
    expect(html).toContain('<div id="x">rempli</div>');
    // La section fournie est remplacée : plus de squelette « À venir — L5.2 ».
    expect(html).not.toContain("À venir — L5.2");
    // Les sections non fournies restent des squelettes (L5.3, L5.4, L5.5).
    expect(html).toContain("À venir — L5.3");
    expect(html).toContain("À venir — L5.4");
    expect(html).toContain("À venir — L5.5");
  });
});
