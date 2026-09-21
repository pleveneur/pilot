// Tests unitaires — gds-params.js (lot L5.1 : squelette de l'onglet transverse
// « GDS — paramétrage »). Couvre les aides de rendu PURES et la RÉUTILISATION de
// la coquille de gds-admin.js (renderAdminShellHtml), sans duplication.
import { describe, it, expect } from "vitest";
import {
  PARAMS_SECTIONS,
  PARAMS_TITLE,
  PARAMS_SUBTITLE,
  renderParamsShellHtml,
  initialServerForm,
  initialServersState,
  serverLabel,
  validateServerForm,
  renderParamsStatusHtml,
  renderServersListHtml,
  renderServerFormHtml,
  renderServerActionsHtml,
  renderServersSectionHtml,
  initialIdentityState,
  renderIdentitySectionHtml,
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

describe("gds-params — section Serveurs GDS (L5.2)", () => {
  it("initialServersState démarre en chargement, sans serveur ni secret", () => {
    const s = initialServersState();
    expect(s.loading).toBe(true);
    expect(s.servers).toEqual([]);
    expect(s.form).toEqual(initialServerForm());
    expect(s.form.mode).toBe("add");
  });

  it("serverLabel formate user@host:port (défauts sûrs)", () => {
    expect(serverLabel({ user: "pilot", host: "10.0.0.1", port: "5433" })).toBe("pilot@10.0.0.1:5433");
    expect(serverLabel({ user: "pilot", host: "10.0.0.1" })).toBe("pilot@10.0.0.1:5432");
    expect(serverLabel(null)).toBe("@:5432");
  });

  it("validateServerForm exige hôte + utilisateur, et le mot de passe en AJOUT seulement", () => {
    expect(validateServerForm({ mode: "add", host: "", user: "pilot", dbPassword: "x" })).toMatch(/hôte/i);
    expect(validateServerForm({ mode: "add", host: "h", user: "", dbPassword: "x" })).toMatch(/utilisateur/i);
    expect(validateServerForm({ mode: "add", host: "h", user: "u", dbPassword: "" })).toMatch(/mot de passe/i);
    expect(validateServerForm({ mode: "add", host: "h", user: "u", dbPassword: "x" })).toBe("");
    // En édition, un mot de passe vide est autorisé (il est conservé).
    expect(validateServerForm({ mode: "edit", host: "h", user: "u", dbPassword: "" })).toBe("");
  });

  it("renderServersListHtml couvre chargement / erreur / vide", () => {
    expect(renderServersListHtml({ loading: true })).toContain("Chargement");
    expect(renderServersListHtml({ loading: false, error: "boom" })).toContain("boom");
    const empty = renderServersListHtml({ loading: false, servers: [] });
    expect(empty).toContain("Aucun serveur mémorisé");
  });

  it("renderServersListHtml rend une ligne par serveur SANS jamais afficher de secret", () => {
    const html = renderServersListHtml({
      loading: false,
      hasProject: true,
      servers: [
        { host: "10.0.0.1", port: "5432", user: "pilot", validated: true, db_password: "SECRET", admin_password: "ADMIN" },
      ],
    });
    expect(html).toContain("pilot@10.0.0.1:5432");
    expect(html).toContain('data-srv-action="apply"');
    expect(html).not.toContain("SECRET");
    expect(html).not.toContain("ADMIN");
    // Sans projet ouvert, « Appliquer » est désactivé.
    const noProj = renderServersListHtml({ loading: false, hasProject: false, servers: [{ host: "h", user: "u" }] });
    expect(noProj).toContain("disabled");
  });

  it("renderServersListHtml échappe les valeurs et propose la double confirmation de suppression", () => {
    const html = renderServersListHtml({
      loading: false,
      servers: [{ host: 'x"><script>', port: "5432", user: "u" }],
      pendingDelete: { host: 'x"><script>', user: "u" },
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("delete-confirm");
    expect(html).toContain("delete-cancel");
  });

  it("renderServerFormHtml ne réinjecte JAMAIS un mot de passe (champs toujours vides)", () => {
    const html = renderServerFormHtml({ mode: "edit", host: "h", port: "5432", user: "u", dbPassword: "SECRET", adminPassword: "ADMIN" });
    expect(html).toContain('id="gds-params-srv-host"');
    expect(html).toContain('id="gds-params-srv-dbpw"');
    expect(html).not.toContain("SECRET");
    expect(html).not.toContain("ADMIN");
    expect(html).toMatch(/type="password"[^>]*placeholder="laisser vide pour conserver"/);
  });

  it("renderServerActionsHtml : « Annuler » uniquement en édition", () => {
    expect(renderServerActionsHtml(initialServerForm())).toContain("Ajouter le serveur");
    expect(renderServerActionsHtml(initialServerForm())).not.toContain("gds-params-srv-cancel");
    const edit = renderServerActionsHtml({ mode: "edit" });
    expect(edit).toContain("Enregistrer les modifications");
    expect(edit).toContain("gds-params-srv-cancel");
  });

  it("renderServersSectionHtml remplace le squelette L5.2 sans toucher aux autres sections", () => {
    const section = renderServersSectionHtml({ loading: false, servers: [], hasProject: true });
    expect(section).toContain('data-section-id="servers"');
    expect(section).not.toContain("À venir — L5.2");
    const shell = renderParamsShellHtml({ sectionHtml: { servers: section } });
    expect(shell).toContain("gds-params-srv-list");
    expect(shell).not.toContain("À venir — L5.2");
    expect(shell).toContain("À venir — L5.3");
  });

  it("renderParamsStatusHtml distingue ok / loading / error", () => {
    expect(renderParamsStatusHtml(null)).toBe("");
    expect(renderParamsStatusHtml({ kind: "ok", text: "bien" })).toContain("gds-admin-status ok");
    expect(renderParamsStatusHtml({ kind: "loading", text: "…" })).toContain("loading");
    expect(renderParamsStatusHtml({ kind: "error", text: "nope" })).toContain("error");
  });
});

describe("gds-params — section Mon identité (L5.3)", () => {
  it("initialIdentityState démarre en chargement, sans identité ni secret", () => {
    const s = initialIdentityState();
    expect(s.loading).toBe(true);
    expect(s.email).toBe("");
    expect(s.gitName).toBe("");
    expect(s.status).toBeNull();
  });

  it("renderIdentitySectionHtml affiche l'état de chargement sans champ éditable", () => {
    const html = renderIdentitySectionHtml(initialIdentityState());
    expect(html).toContain('data-section-id="identity"');
    expect(html).toContain("Chargement de l'identité");
    expect(html).not.toContain('id="gds-params-id-email"');
  });

  it("renderIdentitySectionHtml pré-remplit email + nom git et propose l'enregistrement", () => {
    const html = renderIdentitySectionHtml({ loading: false, email: "dev@exemple.com", gitName: "Prénom Nom" });
    expect(html).toContain('id="gds-params-id-email"');
    expect(html).toContain('value="dev@exemple.com"');
    expect(html).toContain('id="gds-params-id-name"');
    expect(html).toContain('value="Prénom Nom"');
    expect(html).toContain('id="gds-params-id-save"');
    // Déplacement SANS ajout de logique : mêmes textes de stockage hors projet.
    expect(html).toContain("gds_secrets.json");
  });

  it("renderIdentitySectionHtml échappe les valeurs saisies", () => {
    const html = renderIdentitySectionHtml({ loading: false, email: 'x"><script>', gitName: "a&b" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("a&amp;b");
  });

  it("renderIdentitySectionHtml remplace le squelette L5.3 sans toucher aux autres sections", () => {
    const section = renderIdentitySectionHtml({ loading: false, email: "e@x", gitName: "N" });
    const shell = renderParamsShellHtml({ sectionHtml: { identity: section } });
    expect(shell).not.toContain("À venir — L5.3");
    expect(shell).toContain("À venir — L5.4");
  });
});
