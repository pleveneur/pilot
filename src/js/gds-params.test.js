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
  serverIdentityLabel,
  gdsRoleLabel,
  formatServerTestDate,
  serverStateBadge,
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
  keysRegisterHint,
  keysRegisterErrorMessage,
  keysServerKey,
  normalizeKeysTarget,
  keysNoServerHint,
  renderKeysTargetHtml,
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

  it("validateServerForm exige nom + adresse + e-mail GDS, et le mot de passe en AJOUT seulement", () => {
    expect(validateServerForm({ mode: "add", name: "N", host: "", email: "a@b", password: "x" })).toMatch(/adresse/i);
    expect(validateServerForm({ mode: "add", name: "N", host: "h", email: "", password: "x" })).toMatch(/e-mail GDS/i);
    expect(validateServerForm({ mode: "add", name: "N", host: "h", email: "a@b", password: "" })).toMatch(/mot de passe/i);
    expect(validateServerForm({ mode: "add", name: "N", host: "h", email: "a@b", password: "x" })).toBe("");
    // En édition, un mot de passe vide est autorisé (il est conservé).
    expect(validateServerForm({ mode: "edit", name: "N", host: "h", email: "a@b", password: "" })).toBe("");
  });

  it("serverTitle : nom si renseigné, sinon user@host:port (fiches sans nom)", () => {
    expect(serverTitle({ name: "GDS maison", host: "h", user: "u" })).toBe("GDS maison");
    expect(serverTitle({ name: "  ", host: "h", user: "u", port: "5433" })).toBe("u@h:5433");
    expect(serverTitle(null)).toBe("@:5432");
  });

  it("validateServerForm exige le nom (obligatoire à la saisie)", () => {
    expect(validateServerForm({ mode: "add", name: "", host: "h", email: "a@b", password: "x" })).toMatch(/nom/i);
    expect(validateServerForm({ mode: "add", name: "N", host: "h", email: "a@b", password: "x" })).toBe("");
  });

  it("validateServerForm : e-mail GDS plausible et port numérique (refus clairs)", () => {
    // Le rôle de l'e-mail est désormais celui de l'IDENTITÉ : une adresse sans
    // « @ » n'en est pas une (le compte technique de la base n'est plus demandé).
    expect(validateServerForm({ mode: "add", name: "N", host: "h", email: "patrick", password: "x" })).toMatch(/adresse valide/i);
    // Port vide (repli 8080 côté interface) ou numérique : acceptés.
    expect(validateServerForm({ mode: "add", name: "N", host: "h", email: "a@b", password: "x", port: "" })).toBe("");
    expect(validateServerForm({ mode: "add", name: "N", host: "h", email: "a@b", password: "x", port: "8080" })).toBe("");
    expect(validateServerForm({ mode: "add", name: "N", host: "h", email: "a@b", password: "x", port: "80a" })).toMatch(/nombre/i);
  });

  it("serverIdentityLabel : adresse GDS du compte utilisateur, ancienne forme pour les fiches héritées", () => {
    expect(
      serverIdentityLabel({ host: "10.0.0.1", http_port: "8080", gds_email: "dev@exemple.com", user: "dev@exemple.com" })
    ).toBe("dev@exemple.com — 10.0.0.1:8080");
    // Port HTTP absent : repli 8080 (valeur par défaut du service).
    expect(serverIdentityLabel({ host: "h", gds_email: "a@b" })).toBe("a@b — h:8080");
    // Fiche héritée (compte technique) : affichage inchangé.
    expect(serverIdentityLabel({ host: "10.0.0.1", port: "5433", user: "pilot" })).toBe("pilot@10.0.0.1:5433");
  });

  it("gdsRoleLabel : vocabulaire du socle traduit en langage simple", () => {
    expect(gdsRoleLabel("admin")).toBe("administrateur");
    expect(gdsRoleLabel("dev")).toBe("développeur");
    expect(gdsRoleLabel("standard")).toBe("standard (lecture seule)");
    expect(gdsRoleLabel("")).toBe("");
  });

  it("renderServerFormHtml demande le compte GDS (e-mail + mot de passe), plus le compte de la base", () => {
    const html = renderServerFormHtml();
    expect(html).toMatch(/E-mail GDS/i);
    expect(html).toContain('id="gds-params-srv-email"');
    expect(html).toContain('id="gds-params-srv-gdspw"');
    expect(html).not.toContain('id="gds-params-srv-user"');
    expect(html).not.toContain('id="gds-params-srv-dbpw"');
  });

  it("renderServerFormHtml affiche le rôle reconnu après un test", () => {
    expect(renderServerFormHtml({ mode: "edit", role: "dev" })).toMatch(/Rôle reconnu : <strong>développeur<\/strong>/);
    expect(renderServerFormHtml({ role: "" })).toMatch(/affiché ici après un test/);
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
    const html = renderServerFormHtml({ mode: "edit", name: "N", description: "D", host: "h", email: "a@b", password: "SECRET" });
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
    const html = renderServerFormHtml({ mode: "edit", host: "h", port: "8080", email: "a@b", password: "SECRET" });
    expect(html).toContain('id="gds-params-srv-host"');
    expect(html).toContain('id="gds-params-srv-gdspw"');
    expect(html).not.toContain("SECRET");
    expect(html).toMatch(/type="password"[^>]*placeholder="laisser vide pour conserver"/);
  });

  it("renderServersListHtml : fiche « compte GDS » — identité, rôle et « Appliquer » neutralisé sans compte technique", () => {
    const html = renderServersListHtml({
      loading: false,
      hasProject: true,
      servers: [
        {
          host: "10.0.0.1",
          port: "5432",
          user: "dev@exemple.com",
          name: "GDS maison",
          identity: true,
          http_port: "8080",
          gds_email: "dev@exemple.com",
          gds_role: "dev",
          has_db_password: false,
          gds_password: "SECRET",
        },
      ],
    });
    expect(html).toContain("dev@exemple.com — 10.0.0.1:8080");
    expect(html).toContain("Rôle : développeur");
    expect(html).toMatch(/data-srv-action="apply" disabled/);
    expect(html).toContain('data-identity="1"');
    expect(html).not.toContain("SECRET");
    // Fiche héritée : comportement inchangé (Appliquer actif).
    const legacy = renderServersListHtml({ loading: false, hasProject: true, servers: [{ host: "h", port: "5432", user: "pilot", has_db_password: true }] });
    expect(legacy).toMatch(/data-srv-action="apply">Appliquer/);
    expect(legacy).toContain('data-identity="0"');
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

  it("formatServerTestDate : date locale, chaîne vide si absente ou illisible (lot 5)", () => {
    expect(formatServerTestDate("")).toBe("");
    expect(formatServerTestDate("pas une date")).toBe("");
    expect(formatServerTestDate("2026-09-22T15:04:05Z")).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
    const d = new Date("2026-09-22T15:04:05Z");
    const p = (n) => String(n).padStart(2, "0");
    expect(formatServerTestDate("2026-09-22T15:04:05Z")).toBe(
      `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
    );
  });

  it("serverStateBadge : jamais testé / joignable / injoignable, avec date (lot 5)", () => {
    expect(serverStateBadge({})).toEqual({ kind: "off", text: "Jamais testé" });
    expect(serverStateBadge({ reachable: null })).toEqual({ kind: "off", text: "Jamais testé" });
    expect(serverStateBadge({ reachable: true }).kind).toBe("ok");
    expect(serverStateBadge({ reachable: false }).kind).toBe("warn");
    expect(serverStateBadge({ reachable: true, last_test_at: "2026-09-22T15:04:05Z" }).text).toMatch(/^Joignable \(\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}\)$/);
    expect(serverStateBadge({ reachable: false, last_test_at: "2026-09-22T15:04:05Z" }).text).toMatch(/^Injoignable \(/);
    // Date illisible : l'état reste dit, sans inventer de date.
    expect(serverStateBadge({ reachable: true, last_test_at: "x" })).toEqual({ kind: "ok", text: "Joignable" });
  });

  it("renderServersListHtml affiche l'état du serveur (lot 5)", () => {
    const html = renderServersListHtml({
      loading: false,
      hasProject: true,
      servers: [{ host: "h", port: "5432", user: "u", name: "N", reachable: false, last_test_at: "2026-09-22T15:04:05Z" }],
    });
    expect(html).toContain("gds-badge-warn");
    expect(html).toMatch(/Injoignable \(/);
    expect(html).not.toContain("db_password");
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
    // Aucun serveur cible tant que la liste des serveurs déclarés n'est pas lue.
    expect(s.servers).toEqual([]);
    expect(s.target).toBe("");
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

  it("renderKeysSectionHtml explique AVANT le clic que la clé part à l'activation du GDS", () => {
    const html = renderKeysSectionHtml({ loading: false, publicKey: "ssh-ed25519 AAA", email: "e@x" });
    expect(html).toContain("automatiquement");
    expect(html).toContain("activation du GDS");
    expect(html).toContain("serveur distant"); // fin du texte permanent de la section
  });

  it("keysRegisterErrorMessage remplace « GDS non provisionné » par un chemin actionnable", () => {
    const text = keysRegisterErrorMessage("GDS non provisionné");
    expect(text).not.toContain("GDS non provisionné");
    expect(text).toContain("activerez le GDS sur votre projet");
    expect(text).toContain("Activer GDS");
    // Les autres erreurs restent affichées telles quelles (préfixe Error: retiré).
    expect(keysRegisterErrorMessage("Error: Permission denied (publickey)")).toBe(
      "Permission denied (publickey)"
    );
  });

  it("renderKeysSectionHtml affiche l'erreur non provisionnée traduite", () => {
    const html = renderKeysSectionHtml({
      loading: false,
      publicKey: "ssh-ed25519 AAA",
      email: "e@x",
      status: { kind: "error", text: keysRegisterErrorMessage("GDS non provisionné") },
    });
    expect(html).toContain("activerez le GDS sur votre projet");
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

describe("gds-params — Mes clés : serveur cible déclaré (clef hors projet)", () => {
  const srv = { host: "192.0.2.10", port: "5433", user: "pilot", name: "GDS maison" };

  it("keysServerKey identifie un serveur par user@host:port (port par défaut 5432)", () => {
    expect(keysServerKey(srv)).toBe("pilot@192.0.2.10:5433");
    expect(keysServerKey({ host: "h", user: "pilot" })).toBe("pilot@h:5432");
    expect(keysServerKey(null)).toBe("@:5432");
  });

  it("normalizeKeysTarget garde la cible valide, sinon prend la première", () => {
    expect(normalizeKeysTarget("pilot@192.0.2.10:5433", [srv])).toBe("pilot@192.0.2.10:5433");
    expect(normalizeKeysTarget("pilot@disparu:5432", [srv])).toBe("pilot@192.0.2.10:5433");
    expect(normalizeKeysTarget("", [])).toBe("");
  });

  it("renderKeysTargetHtml propose le sélecteur des serveurs déclarés", () => {
    const html = renderKeysTargetHtml([srv, { host: "autre", user: "dev", port: "5432" }], "pilot@192.0.2.10:5433");
    expect(html).toContain('id="gds-params-key-target"');
    expect(html).toContain('value="pilot@192.0.2.10:5433" selected');
    expect(html).toContain("GDS maison");
  });

  it("renderKeysTargetHtml explique l'absence de serveur déclaré (message de la correction précédente)", () => {
    const html = renderKeysTargetHtml([], "");
    expect(html).not.toContain("gds-params-key-target");
    expect(html).toContain(keysNoServerHint().replace(/'/g, "&#39;"));
    expect(html).toContain("activerez le GDS sur votre projet");
  });

  it("renderKeysSectionHtml porte le sélecteur sans altérer les identifiants DOM existants", () => {
    const withServer = renderKeysSectionHtml({
      loading: false,
      publicKey: "ssh-ed25519 AAA",
      email: "dev@exemple.com",
      servers: [srv],
      target: "pilot@192.0.2.10:5433",
    });
    expect(withServer).toContain('id="gds-params-key-target"');
    expect(withServer).toContain('id="gds-params-key-copy"');
    expect(withServer).toContain('id="gds-params-key-register"');
    // Sans serveur déclaré : explication, aucun sélecteur, bouton inchangé.
    const noServer = renderKeysSectionHtml({ loading: false, publicKey: "ssh-ed25519 AAA", email: "dev@exemple.com" });
    expect(noServer).not.toContain("gds-params-key-target");
    expect(noServer).toContain('id="gds-params-key-register"');
    expect(noServer).toContain("activerez le GDS sur votre projet");
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
