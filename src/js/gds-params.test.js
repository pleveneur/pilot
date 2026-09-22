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
  serverTitle,
  validateServerForm,
  renderParamsStatusHtml,
  renderServersListHtml,
  renderServerFormHtml,
  renderServerActionsHtml,
  renderServersSectionHtml,
  initialIdentityState,
  renderIdentitySectionHtml,
  initialKeysState,
  renderKeysSectionHtml,
  initialProjectsState,
  projectBasename,
  projectStatusBadge,
  renderProjectRowHtml,
  renderProjectsListHtml,
  renderProjectsSectionHtml,
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

  it("validateServerForm exige nom + hôte + utilisateur, et le mot de passe en AJOUT seulement", () => {
    expect(validateServerForm({ mode: "add", name: "N", host: "", user: "pilot", dbPassword: "x" })).toMatch(/hôte/i);
    expect(validateServerForm({ mode: "add", name: "N", host: "h", user: "", dbPassword: "x" })).toMatch(/utilisateur/i);
    expect(validateServerForm({ mode: "add", name: "N", host: "h", user: "u", dbPassword: "" })).toMatch(/mot de passe/i);
    expect(validateServerForm({ mode: "add", name: "N", host: "h", user: "u", dbPassword: "x" })).toBe("");
    // En édition, un mot de passe vide est autorisé (il est conservé).
    expect(validateServerForm({ mode: "edit", name: "N", host: "h", user: "u", dbPassword: "" })).toBe("");
  });

  it("serverTitle : nom si renseigné, sinon user@host:port (fiches sans nom)", () => {
    expect(serverTitle({ name: "GDS maison", host: "h", user: "u" })).toBe("GDS maison");
    expect(serverTitle({ name: "  ", host: "h", user: "u", port: "5433" })).toBe("u@h:5433");
    expect(serverTitle(null)).toBe("@:5432");
  });

  it("validateServerForm exige le nom (obligatoire à la saisie)", () => {
    expect(validateServerForm({ mode: "add", name: "", host: "h", user: "u", dbPassword: "x" })).toMatch(/nom/i);
    expect(validateServerForm({ mode: "add", name: "N", host: "h", user: "u", dbPassword: "x" })).toBe("");
  });

  it("renderServersListHtml affiche le nom, la description et l'identité en second", () => {
    const html = renderServersListHtml({
      loading: false,
      hasProject: true,
      servers: [
        { host: "10.0.0.1", port: "5432", user: "pilot", name: "GDS maison", description: "Serveur de test", db_password: "SECRET" },
      ],
    });
    expect(html).toContain("GDS maison");
    expect(html).toContain("Serveur de test");
    expect(html).toContain("pilot@10.0.0.1:5432");
    expect(html).not.toContain("SECRET");
  });

  it("renderServerFormHtml rend les champs nom et description, sans secret", () => {
    const html = renderServerFormHtml({ mode: "edit", name: "N", description: "D", host: "h", user: "u", dbPassword: "SECRET" });
    expect(html).toContain('id="gds-params-srv-name"');
    expect(html).toContain('id="gds-params-srv-desc"');
    expect(html).toContain('value="N"');
    expect(html).toContain('value="D"');
    expect(html).not.toContain("SECRET");
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

  it("renderServersSectionHtml : sélecteur du projet cible (lot 2), repli sur hasProject", () => {
    // Sans `canApply` explicite : repli rétrocompatible sur `hasProject`.
    const withProject = renderServersSectionHtml({ loading: false, servers: [], hasProject: true });
    expect(withProject).toContain('id="gds-params-apply-project"');
    const noProject = renderServersSectionHtml({ loading: false, servers: [], hasProject: false });
    expect(noProject).not.toContain('id="gds-params-apply-project"');
    expect(noProject).toMatch(/Aucun projet connu/);
    // `canApply` explicite prioritaire + options rendues et sélection conservée.
    const html = renderServersSectionHtml({
      loading: false,
      servers: [],
      hasProject: false,
      canApply: true,
      projectChoices: [
        { path: "/p/a", label: "a" },
        { path: "/p/b", label: "b" },
      ],
      applyProject: "/p/b",
    });
    expect(html).toContain('value="/p/a"');
    expect(html).toContain('value="/p/b" selected');
  });

  it("renderServersListHtml : « Appliquer » activé selon canApply (repli hasProject)", () => {
    const srv = [{ host: "h", port: "5432", user: "u", name: "N" }];
    expect(renderServersListHtml({ loading: false, servers: srv, hasProject: true })).toMatch(
      /data-srv-action="apply">Appliquer/
    );
    expect(renderServersListHtml({ loading: false, servers: srv, hasProject: false })).toMatch(/data-srv-action="apply" disabled/);
    // `canApply: true` rend le bouton actif même sans projet ouvert (projet choisi).
    expect(renderServersListHtml({ loading: false, servers: srv, hasProject: false, canApply: true })).toMatch(
      /data-srv-action="apply">Appliquer/
    );
  });

  it("renderProjectRowHtml : détachement explicite, travail conservé par défaut (lot 3)", () => {
    const html = renderProjectRowHtml({ path: "/p/a", name: "a", provisioned: true, status: "ok", onServer: true });
    expect(html).toContain("Détacher");
    expect(html).not.toContain("Retirer");
    const pending = renderProjectRowHtml({ path: "/p/a", name: "a", provisioned: true, status: "ok", onServer: true }, "/p/a");
    expect(pending).toContain("Confirmer le détachement");
    expect(pending).toMatch(/décoché.{0,40}reste sur le serveur/s);
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

describe("gds-params — section Mes clés (L5.4)", () => {
  it("initialKeysState démarre en chargement, sans clé ni secret", () => {
    const s = initialKeysState();
    expect(s.loading).toBe(true);
    expect(s.publicKey).toBe("");
    expect(s.keyPath).toBe("");
    expect(s.generated).toBe(false);
    expect(s.status).toBeNull();
  });

  it("renderKeysSectionHtml affiche l'état de chargement", () => {
    const html = renderKeysSectionHtml(initialKeysState());
    expect(html).toContain('data-section-id="keys"');
    expect(html).toContain("Lecture de la clé SSH du poste");
    expect(html).not.toContain('id="gds-params-key-copy"');
  });

  it("renderKeysSectionHtml affiche la clé PUBLIQUE + copie + enregistrement sur le serveur", () => {
    const html = renderKeysSectionHtml({
      loading: false,
      publicKey: "ssh-ed25519 AAAAC3Nz pilot@poste",
      keyPath: "/home/u/.ssh/pilot_gds.pub",
      generated: true,
      email: "dev@exemple.com",
    });
    expect(html).toContain("ssh-ed25519 AAAAC3Nz pilot@poste");
    expect(html).toContain("/home/u/.ssh/pilot_gds.pub");
    expect(html).toContain("générée à l'instant");
    expect(html).toContain('id="gds-params-key-copy"');
    expect(html).toContain('id="gds-params-key-register"');
    expect(html).toContain("dev@exemple.com");
    // Plus aucune invitation à une manipulation manuelle de la clé.
    expect(html).not.toMatch(/manuel/i);
    expect(html).not.toContain("authorized_keys");
  });

  it("renderKeysSectionHtml désactive l'enregistrement sans identité (email)", () => {
    const html = renderKeysSectionHtml({ loading: false, publicKey: "ssh-ed25519 AAA", email: "" });
    expect(html).toMatch(/id="gds-params-key-register"[^>]*disabled/);
  });

  it("renderKeysSectionHtml signale une clé indisponible sans planter", () => {
    const html = renderKeysSectionHtml({ loading: false, publicKey: "", status: { kind: "error", text: "boom" } });
    expect(html).toContain("Clé publique indisponible");
    expect(html).toContain("boom");
  });

  it("renderKeysSectionHtml échappe la clé et remplace le squelette L5.4", () => {
    const section = renderKeysSectionHtml({ loading: false, publicKey: 'k"><script>', email: "e@x" });
    expect(section).not.toContain("<script>");
    const shell = renderParamsShellHtml({ sectionHtml: { keys: section } });
    expect(shell).not.toContain("À venir — L5.4");
    expect(shell).toContain("À venir — L5.5");
  });
});

describe("gds-params — section Mes projets GDS (L5.5)", () => {
  it("initialProjectsState démarre en chargement, sans projet ni secret", () => {
    const s = initialProjectsState();
    expect(s.loading).toBe(true);
    expect(s.projects).toEqual([]);
    expect(s.error).toBe("");
    expect(s.status).toBeNull();
    expect(s.pendingRemove).toBeNull();
  });

  it("projectBasename gère les séparateurs Windows et POSIX", () => {
    expect(projectBasename("C:\\dev\\pilot\\mon-projet")).toBe("mon-projet");
    expect(projectBasename("/home/u/pilot/mon-projet/")).toBe("mon-projet");
    expect(projectBasename("")).toBe("");
    expect(projectBasename(null)).toBe("");
  });

  it("projectStatusBadge distingue connecté / sur le serveur / provisionné / non configuré", () => {
    expect(projectStatusBadge("connected", true, true)).toEqual({ kind: "ok", text: "Connecté" });
    expect(projectStatusBadge("error", true, true).kind).toBe("warn");
    expect(projectStatusBadge("not_configured", false, false)).toEqual({ kind: "off", text: "Non configuré" });
    expect(projectStatusBadge("not_configured", true, false).text).toMatch(/Provisionné/);
  });

  it("renderProjectsListHtml couvre chargement / erreur / vide", () => {
    expect(renderProjectsListHtml({ loading: true })).toContain("Chargement de vos projets");
    expect(renderProjectsListHtml({ loading: false, error: "boom" })).toContain("boom");
    expect(renderProjectsListHtml({ loading: false, projects: [] })).toContain("Aucun projet local connu");
  });

  it("renderProjectRowHtml : un projet connecté propose Ouvrir + Synchroniser + Retirer", () => {
    const html = renderProjectRowHtml({ path: "C:\\dev\\p", name: "p", provisioned: true, status: "connected", onServer: true });
    expect(html).toContain('data-proj-action="open"');
    expect(html).toContain('data-proj-action="sync"');
    expect(html).toContain('data-proj-action="remove"');
    expect(html).not.toContain('data-proj-action="add"');
  });

  it("renderProjectRowHtml : un projet provisionné non ajouté propose « Ajouter au GDS »", () => {
    const html = renderProjectRowHtml({ path: "/p", name: "p", provisioned: true, status: "not_configured", onServer: false });
    expect(html).toContain('data-proj-action="add"');
    expect(html).not.toContain('data-proj-action="sync"');
    expect(html).not.toContain('data-proj-action="remove"');
  });

  it("renderProjectRowHtml : un projet non configuré ne propose que Ouvrir", () => {
    const html = renderProjectRowHtml({ path: "/p", name: "p", provisioned: false, status: "not_configured", onServer: false });
    expect(html).toContain('data-proj-action="open"');
    expect(html).not.toContain('data-proj-action="add"');
    expect(html).not.toContain('data-proj-action="sync"');
    expect(html).not.toContain('data-proj-action="remove"');
    expect(html).toContain("Non configuré");
  });

  it("renderProjectRowHtml : le retrait exige une double confirmation avec case de purge", () => {
    const pending = renderProjectRowHtml(
      { path: "/p", name: "p", provisioned: true, status: "connected", onServer: true },
      "/p"
    );
    expect(pending).toContain('data-proj-action="remove-confirm"');
    expect(pending).toContain('data-proj-action="remove-cancel"');
    expect(pending).toContain("data-proj-purge");
    expect(pending).not.toContain('data-proj-action="remove"');
  });

  it("renderProjectRowHtml échappe le nom et le chemin", () => {
    const html = renderProjectRowHtml({ path: '/x"><script>', name: 'n<script>', provisioned: false, status: "not_configured" });
    expect(html).not.toContain("<script>");
  });

  it("renderProjectsSectionHtml remplace le squelette L5.5", () => {
    const section = renderProjectsSectionHtml({ loading: false, projects: [] });
    expect(section).toContain('data-section-id="projects"');
    expect(section).toContain('id="gds-params-proj-list"');
    expect(section).not.toContain("À venir — L5.5");
    const shell = renderParamsShellHtml({ sectionHtml: { projects: section } });
    expect(shell).not.toContain("À venir — L5.5");
  });
});
