// Tests unitaires — gds-admin.js (lot L4.1 : squelette de l'onglet transverse).
// Couvre les aides de rendu PURES (réutilisées par l'écran de paramétrage L5.1).
import { describe, it, expect } from "vitest";
import {
  ACCOUNT_ROLES,
  ACCOUNT_STATUSES,
  ACCOUNTS_DESC,
  ADMIN_SECTIONS,
  AUDIT_PAGE_SIZE,
  DEFAULT_HTTP_PORT,
  applyProjectsLoad,
  buildAccountCreateArgs,
  buildAccountListArgs,
  buildAccountPasswordArgs,
  buildAccountRoleArgs,
  buildAccountStatusArgs,
  buildAccountsConnArgs,
  buildAuditArgs,
  buildGitReposArgs,
  buildProjectAssignArgs,
  buildProjectListArgs,
  buildProjectMembersArgs,
  buildProjectRemoveArgs,
  buildProjectUnassignArgs,
  buildServerStatusArgs,
  buildServiceStatusArgs,
  buildSshKeyRevokeArgs,
  buildSshKeysArgs,
  canControlService,
  findRepoForProject,
  formatAccountDate,
  formatAuditTime,
  formatBulkAssignConfirmation,
  formatBytes,
  formatProjectRemoveConfirmation,
  initialAccountsState,
  initialConnectionState,
  initialProjectsState,
  initialServiceState,
  initialStorageState,
  nextStatusToggle,
  pickPrefill,
  projectsWithoutMember,
  adminServerOptionValue,
  renderAdminServerSelectorHtml,
  renderAccountsSectionHtml,
  renderAccountsStatusHtml,
  renderAccountsTableHtml,
  renderAdminSectionHtml,
  renderAdminShellHtml,
  renderAuditTableHtml,
  renderConnectionSectionHtml,
  renderConnectionStatusHtml,
  renderProjectBulkAssignConfirmHtml,
  renderProjectBulkAssignHtml,
  renderProjectMembersHtml,
  renderProjectRemoveConfirmHtml,
  renderProjectsSectionHtml,
  renderProjectsStatusHtml,
  renderProjectsTableHtml,
  renderServiceConfirmHtml,
  renderServiceProgramsHtml,
  renderServiceSectionHtml,
  renderServiceStatusHtml,
  renderSpaceHtml,
  renderSshKeyRevokeConfirmHtml,
  renderSshKeysTableHtml,
  renderStorageSectionHtml,
  renderStorageStatusHtml,
  SERVICE_DESC,
  SERVICE_HEALTH_MAX_ATTEMPTS,
  serviceConfirmText,
  shortPublicKey,
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

  it("remplace une section par son HTML rempli, les autres restant des squelettes (L4.2)", () => {
    const html = renderAdminShellHtml({
      title: "T",
      subtitle: "S",
      sections: ADMIN_SECTIONS,
      sectionHtml: { connection: renderConnectionSectionHtml(initialConnectionState()) },
    });
    // La section « Connexion » n'est plus un squelette…
    expect(html).not.toContain("À venir — L4.2");
    expect(html).toContain('id="gds-admin-host"');
    // …mais les sections suivantes le restent (L4.3 à L4.6 pas encore faites).
    for (const todo of ["L4.3", "L4.4", "L4.5", "L4.6"]) {
      expect(html).toContain(`À venir — ${todo}`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// L4.2 — bloc « Connexion serveur »
// ─────────────────────────────────────────────────────────────────────────────

describe("initialConnectionState (pure)", () => {
  it("part d'un formulaire vide avec le port HTTP par défaut", () => {
    const s = initialConnectionState();
    expect(s.host).toBe("");
    expect(s.port).toBe(DEFAULT_HTTP_PORT);
    expect(s.email).toBe("");
    expect(s.ok).toBe(false);
    expect(s.loading).toBe(false);
    expect(s.server).toBeNull();
  });
});

describe("formatBytes (pure)", () => {
  it("formate les unités et n'invente pas de valeur pour l'inconnu", () => {
    expect(formatBytes(0)).toBe("0 o");
    expect(formatBytes(512)).toBe("512 o");
    expect(formatBytes(1024)).toBe("1.0 Ko");
    expect(formatBytes(2048)).toBe("2.0 Ko");
    expect(formatBytes(15 * 1024)).toBe("15 Ko");
    expect(formatBytes(1024 * 1024)).toBe("1.0 Mo");
    expect(formatBytes(1024 ** 3)).toBe("1.0 Go");
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(undefined)).toBe("—");
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes("12")).toBe("—");
  });
});

describe("pickPrefill (pure)", () => {
  it("prend le premier serveur exploitable et applique le port par défaut", () => {
    expect(pickPrefill([])).toBeNull();
    expect(pickPrefill(null)).toBeNull();
    expect(pickPrefill([{ host: "", email: "a@b" }])).toBeNull();
    expect(pickPrefill([{ host: "h", email: "" }])).toBeNull();
    expect(
      pickPrefill([
        { host: "", email: "a@b" },
        { host: " 192.168.1.9 ", http_port: "8090", email: " admin@x ", has_password: true },
      ])
    ).toEqual({ host: "192.168.1.9", port: "8090", email: "admin@x", hasPassword: true });
    // Port absent → port par défaut.
    expect(pickPrefill([{ host: "h", email: "a@b" }])).toEqual({
      host: "h",
      port: DEFAULT_HTTP_PORT,
      email: "a@b",
      hasPassword: false,
    });
  });
});

describe("adminServerOptionValue / renderAdminServerSelectorHtml (pure, lot 4)", () => {
  const servers = [
    { host: " 10.0.0.1 ", http_port: "8090", email: " a@b ", has_password: true },
    { host: "10.0.0.2", email: "c@d" },
  ];

  it("clé d'affichage : hôte|email rognés", () => {
    expect(adminServerOptionValue(servers[0])).toBe("10.0.0.1|a@b");
    expect(adminServerOptionValue({})).toBe("|");
  });

  it("aucun serveur : aucun sélecteur (pas de bruit inutile)", () => {
    expect(renderAdminServerSelectorHtml([])).toBe("");
    expect(renderAdminServerSelectorHtml([{ host: "", email: "a@b" }])).toBe("");
  });

  it("liste les serveurs, sélectionne le courant, sans jamais de secret", () => {
    const html = renderAdminServerSelectorHtml(servers, { host: "10.0.0.2", email: "c@d" });
    expect(html).toContain('id="gds-admin-server-select"');
    expect(html).toContain('value="10.0.0.1|a@b"');
    expect(html).toContain('value="10.0.0.2|c@d" selected');
    expect(html).toContain("— saisie manuelle —");
    expect(html).not.toContain("has_password");
    expect(html).not.toContain("password");
  });

  it("échappe les valeurs (jamais de HTML injecté)", () => {
    const html = renderAdminServerSelectorHtml([{ host: "<b>h</b>", email: "x@y" }]);
    expect(html).not.toContain("<b>h</b>");
    expect(html).toContain("&lt;b&gt;h&lt;/b&gt;");
  });
});

describe("renderConnectionStatusHtml (pure)", () => {
  it("affiche les trois états : attente, en cours, erreur", () => {
    expect(renderConnectionStatusHtml(initialConnectionState())).toContain("Renseignez l'adresse");
    expect(renderConnectionStatusHtml({ loading: true })).toContain("Test de connexion en cours");
    const err = renderConnectionStatusHtml({ error: "<b>Identifiants invalides</b>" });
    expect(err).toContain("gds-admin-status error");
    expect(err).toContain("Identifiants invalides");
    expect(err).not.toContain("<b>");
  });

  it("affiche version, migrations, compteurs et volumes en cas de succès", () => {
    const html = renderConnectionStatusHtml({
      ok: true,
      server: {
        base_url: "http://192.168.1.10:8080",
        email: "admin@x",
        role: "admin",
        version: "0.4.16",
        migration_version: 7,
        users: 3,
        projects: 2,
        git_repos: 2,
        repos_bytes: 4096,
        db_bytes: 2048,
        uptime_seconds: 42,
      },
    });
    expect(html).toContain("gds-admin-status ok");
    expect(html).toContain("http://192.168.1.10:8080");
    expect(html).toContain("0.4.16");
    expect(html).toContain("Migrations</b> 7");
    expect(html).toContain("4.0 Ko");
    expect(html).toContain("2.0 Ko");
    // Valeur inconnue (base non mesurée) → « — », jamais un faux 0.
    expect(renderConnectionStatusHtml({ ok: true, server: { db_bytes: null } })).toContain("gds-admin-status ok");
    expect(renderConnectionStatusHtml({ ok: true, server: { db_bytes: null } })).toContain("—");
  });

  it("PREUVE : n'affiche JAMAIS un secret même si l'objet d'état en contient un", () => {
    const html = renderConnectionStatusHtml({
      ok: true,
      server: {
        base_url: "http://h:8080",
        version: "1",
        password: "S3CR3T-PW",
        admin_password: "S3CR3T-PW",
        token: "TOKEN-PW",
      },
      error: "",
    });
    expect(html).not.toContain("S3CR3T-PW");
    expect(html).not.toContain("TOKEN-PW");
  });
});

describe("renderConnectionSectionHtml (pure) — secrets", () => {
  it("rend les quatre champs et les deux boutons", () => {
    const html = renderConnectionSectionHtml(initialConnectionState());
    expect(html).toContain('id="gds-admin-host"');
    expect(html).toContain('id="gds-admin-port"');
    expect(html).toContain('id="gds-admin-email"');
    expect(html).toContain('id="gds-admin-password"');
    expect(html).toContain('id="gds-admin-test"');
    expect(html).toContain('id="gds-admin-connect"');
    expect(html).toContain("Tester la connexion");
    expect(html).toContain("Se connecter");
    expect(html).toContain("À connecter — L4.2");
  });

  it("pré-remplit adresse/port/email et signale un mot de passe mémorisé sans le révéler", () => {
    const html = renderConnectionSectionHtml({
      ...initialConnectionState(),
      host: "192.168.1.10",
      port: "8090",
      email: "admin@x",
      hasPassword: true,
    });
    expect(html).toContain('value="192.168.1.10"');
    expect(html).toContain('value="8090"');
    expect(html).toContain('value="admin@x"');
    expect(html).toContain("•••••••• (mémorisé)");
  });

  it("PREUVE : le champ mot de passe n'a jamais de valeur, même si l'état en porte une", () => {
    const html = renderConnectionSectionHtml({
      ...initialConnectionState(),
      host: "h",
      email: "a@b",
      password: "S3CR3T-PW",
      token: "TOKEN-PW",
    });
    const input = html.match(/<input id="gds-admin-password"[^>]*>/);
    expect(input).not.toBeNull();
    expect(input[0]).not.toContain("value=");
    expect(html).not.toContain("S3CR3T-PW");
    expect(html).not.toContain("TOKEN-PW");
  });

  it("affiche un badge « Connecté » quand le test a réussi", () => {
    const html = renderConnectionSectionHtml({
      ...initialConnectionState(),
      ok: true,
      server: { version: "1", base_url: "http://h:8080", role: "admin", email: "a@b" },
    });
    expect(html).toContain("gds-admin-badge ok");
    expect(html).not.toContain("À connecter — L4.2");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// L4.3 — section « Comptes »
// ─────────────────────────────────────────────────────────────────────────────

describe("gds-admin — comptes (L4.3)", () => {
  it("expose les vocabulaires de rôles et de statuts du socle", () => {
    expect(ACCOUNT_ROLES.map((r) => r.value)).toEqual(["admin", "dev", "standard"]);
    expect(ACCOUNT_STATUSES.map((s) => s.value)).toEqual(["pending", "active", "disabled"]);
    expect(ACCOUNT_ROLES.every((r) => r.label)).toBe(true);
    expect(ACCOUNT_STATUSES.every((s) => s.label)).toBe(true);
  });

  it("formate une date ISO en JJ/MM/AAAA et reste tolérant sinon", () => {
    expect(formatAccountDate("2026-07-10T12:34:56Z")).toMatch(/^\d{2}\/\d{2}\/2026$/);
    expect(formatAccountDate("")).toBe("—");
    expect(formatAccountDate(null)).toBe("—");
    expect(formatAccountDate("pas une date")).toBe("—");
  });

  it("calcule la bascule de statut (désactiver / réactiver)", () => {
    expect(nextStatusToggle("active")).toEqual({
      target: "disabled",
      label: "Désactiver",
      icon: "user-x",
    });
    expect(nextStatusToggle("pending").target).toBe("disabled");
    expect(nextStatusToggle("disabled")).toEqual({
      target: "active",
      label: "Réactiver",
      icon: "user-check",
    });
  });

  it("initialise l'état des comptes sans liste chargée ni secret", () => {
    const s = initialAccountsState();
    expect(s.accounts).toBeNull();
    expect(s.loading).toBe(false);
    expect(s.error).toBe("");
    expect(s.notice).toBe("");
    expect(s.form).toEqual({ email: "", name: "", role: "dev" });
    expect(s.reset).toEqual({ email: "", password: "" });
  });

  it("rend la zone d'état (idle / chargement / erreur / notice / compte)", () => {
    expect(renderAccountsStatusHtml(initialAccountsState())).toContain(
      "Connectez-vous au serveur"
    );
    expect(renderAccountsStatusHtml({ ...initialAccountsState(), loading: true })).toContain(
      "Chargement des comptes"
    );
    expect(renderAccountsStatusHtml({ ...initialAccountsState(), error: "boum" })).toContain(
      "boum"
    );
    expect(renderAccountsStatusHtml({ ...initialAccountsState(), notice: "ok" })).toContain("ok");
    const s = { ...initialAccountsState(), accounts: [{}, {}] };
    expect(renderAccountsStatusHtml(s)).toContain("2 compte(s)");
  });

  it("rend un tableau vide ou une liste d'absence pour un serveur sans compte", () => {
    expect(renderAccountsTableHtml(initialAccountsState())).toBe("");
    expect(
      renderAccountsTableHtml({ ...initialAccountsState(), accounts: [] })
    ).toContain("Aucun compte");
  });

  it("rend une ligne complète (adresse, rôle, statut, date, actions)", () => {
    const html = renderAccountsTableHtml({
      ...initialAccountsState(),
      accounts: [
        {
          email: "dev@exemple.com",
          name: "Dev Un",
          role: "dev",
          status: "active",
          created_at: "2026-07-10T00:00:00Z",
        },
      ],
    });
    expect(html).toContain("dev@exemple.com");
    expect(html).toContain('class="gds-admin-acc-role"');
    expect(html).toContain('data-acc-action="role"');
    expect(html).toContain('data-acc-action="toggle"');
    expect(html).toContain('data-acc-action="reset"');
    // Un compte actif propose la désactivation.
    expect(html).toContain('data-target="disabled"');
    expect(html).toContain("Désactiver");
    expect(html).toContain("gds-admin-badge ok");
    expect(html).toContain("10/07/2026");
  });

  it("propose la réactivation et l'activation d'un compte selon son statut", () => {
    const html = renderAccountsTableHtml({
      ...initialAccountsState(),
      accounts: [
        { email: "a@b", role: "admin", status: "disabled", created_at: "2026-01-02T00:00:00Z" },
        { email: "c@d", role: "standard", status: "pending", created_at: "2026-01-02T00:00:00Z" },
      ],
    });
    expect(html).toContain("Réactiver");
    expect(html).toContain("gds-admin-badge off");
    expect(html).toContain("gds-admin-badge warn");
  });

  it("rend le formulaire de création et les boutons (aucun mot de passe rendu)", () => {
    const html = renderAccountsSectionHtml({
      ...initialAccountsState(),
      accounts: [],
      form: { email: "a@b.com", name: "A", role: "admin" },
    });
    expect(html).toContain('id="gds-admin-acc-new-email"');
    expect(html).toContain('id="gds-admin-acc-new-name"');
    expect(html).toContain('id="gds-admin-acc-new-role"');
    expect(html).toContain('id="gds-admin-acc-new-password"');
    expect(html).toContain('id="gds-admin-acc-create"');
    expect(html).toContain('id="gds-admin-acc-refresh"');
    expect(html).toContain('value="a@b.com"');
    expect(html).toContain("selected");
    expect(html).not.toMatch(/id="gds-admin-acc-new-password"[^>]*value=/);
  });

  it("ouvre le panneau de réinitialisation sans jamais préremplir le mot de passe", () => {
    const html = renderAccountsSectionHtml({
      ...initialAccountsState(),
      accounts: [],
      reset: { email: "a@b.com", password: "SECRET" },
    });
    expect(html).toContain('id="gds-admin-acc-reset-password"');
    expect(html).toContain('data-acc-action="reset-save"');
    expect(html).toContain('data-acc-action="reset-cancel"');
    expect(html).not.toContain("SECRET");
  });

  it("n'expose jamais un secret présent dans l'état (mot de passe, token)", () => {
    const html = renderAccountsSectionHtml({
      ...initialAccountsState(),
      accounts: [
        { email: "a@b", role: "admin", status: "active", created_at: "2026-01-02T00:00:00Z" },
      ],
      password: "S3CR3T-PW",
      token: "TOKEN-PW",
      reset: { email: "a@b", password: "RESET-PW" },
    });
    expect(html).not.toContain("S3CR3T-PW");
    expect(html).not.toContain("TOKEN-PW");
    expect(html).not.toContain("RESET-PW");
  });

  it("échappe le contenu du serveur (pas d'injection HTML)", () => {
    const html = renderAccountsTableHtml({
      ...initialAccountsState(),
      accounts: [{ email: '<img src=x onerror=alert(1)>', role: "x", status: "y" }],
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("construit les charges utiles des commandes (identité admin + cible)", () => {
    const conn = { host: "h", httpPort: "8080", email: "admin@b" };
    expect(buildAccountsConnArgs(conn)).toEqual({
      host: "h",
      httpPort: "8080",
      email: "admin@b",
      password: "",
    });
    expect(buildAccountListArgs(conn)).toEqual(buildAccountsConnArgs(conn));
    expect(buildAccountCreateArgs(conn, { email: "e", name: "n", role: "dev", password: "p" })).toEqual({
      host: "h",
      httpPort: "8080",
      email: "admin@b",
      password: "",
      targetEmail: "e",
      targetName: "n",
      targetRole: "dev",
      targetPassword: "p",
    });
    expect(buildAccountRoleArgs(conn, "e", "admin")).toEqual({
      host: "h",
      httpPort: "8080",
      email: "admin@b",
      password: "",
      targetEmail: "e",
      targetRole: "admin",
    });
    expect(buildAccountStatusArgs(conn, "e", "disabled")).toMatchObject({
      targetEmail: "e",
      targetStatus: "disabled",
    });
    expect(buildAccountPasswordArgs(conn, "e", "np")).toMatchObject({
      targetEmail: "e",
      targetPassword: "np",
    });
  });

  it("tolère une connexion absente dans les charges utiles", () => {
    expect(buildAccountListArgs(null)).toEqual({
      host: "",
      httpPort: "",
      email: "",
      password: "",
    });
  });

  it("décrit la section et garde le squelette L4.3 dans le shell brut", () => {
    expect(ACCOUNTS_DESC.length).toBeGreaterThan(40);
    const shell = renderAdminShellHtml({
      title: "t",
      subtitle: "s",
      sections: ADMIN_SECTIONS,
      sectionHtml: { connection: "<div id='conn'></div>" },
    });
    expect(shell).toContain("À venir — L4.3");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// L4.4 — « Dépôts / projets »
// ─────────────────────────────────────────────────────────────────────────────

describe("L4.4 — dépôts / projets (rendus purs + charges utiles)", () => {
  const conn = { host: "h", httpPort: "8080", email: "admin@b" };

  it("initialise l'état des projets sans liste chargée ni secret", () => {
    const s = initialProjectsState();
    expect(s.projects).toBeNull();
    expect(s.repos).toBeNull();
    expect(s.loading).toBe(false);
    expect(s.selected).toBeNull();
    expect(s.members).toBeNull();
    expect(s.removing).toBeNull();
    expect(s.memberForm).toEqual({ email: "", role: "dev" });
  });

  it("construit les charges utiles des commandes projets (mot de passe vide)", () => {
    expect(buildProjectListArgs(conn)).toEqual(buildAccountsConnArgs(conn));
    expect(buildGitReposArgs(conn)).toEqual(buildAccountsConnArgs(conn));
    expect(buildProjectMembersArgs(conn, 4)).toEqual({
      host: "h",
      httpPort: "8080",
      email: "admin@b",
      password: "",
      projectId: 4,
    });
    expect(buildProjectAssignArgs(conn, 4, "dev@x", "dev")).toEqual({
      host: "h",
      httpPort: "8080",
      email: "admin@b",
      password: "",
      projectId: 4,
      targetEmail: "dev@x",
      targetRole: "dev",
    });
    expect(buildProjectUnassignArgs(conn, 4, "dev@x")).toMatchObject({
      projectId: 4,
      targetEmail: "dev@x",
      password: "",
    });
    // `purge` est un drapeau EXPLICITE : absent → faux (aucune destruction).
    expect(buildProjectRemoveArgs(conn, 4, true)).toMatchObject({ projectId: 4, purge: true });
    expect(buildProjectRemoveArgs(conn, 4, false)).toMatchObject({ purge: false });
    expect(buildProjectRemoveArgs(conn, 4, undefined)).toMatchObject({ purge: false });
  });

  it("relie un dépôt à son projet par project_id", () => {
    const repos = [
      { id: 1, project_id: 2, bare_path: "/srv/repos/beta.git" },
      { id: 2, project_id: 5, bare_path: "/srv/repos/alpha.git" },
    ];
    expect(findRepoForProject(repos, 5).bare_path).toBe("/srv/repos/alpha.git");
    expect(findRepoForProject(repos, 9)).toBeNull();
    expect(findRepoForProject(null, 1)).toBeNull();
  });

  it("décrit la confirmation : ce qui est détruit, purge distinguée", () => {
    const project = { id: 3, name: "alpha" };
    const noPurge = formatProjectRemoveConfirmation(project, false);
    expect(noPurge).toContain("alpha");
    expect(noPurge).toContain("entrées en base");
    expect(noPurge).toContain("purge est désactivée");
    expect(noPurge).toContain("reste sur le disque");
    expect(noPurge).not.toContain("IRRÉVERSIBLE");
    const purge = formatProjectRemoveConfirmation(project, true);
    expect(purge).toContain("purge est ACTIVÉE");
    expect(purge).toContain("IRRÉVERSIBLE");
    expect(purge).toContain("dépôt bare");
  });

  it("rend la zone d'état (idle / chargement / erreur / notice / nombre)", () => {
    expect(renderProjectsStatusHtml(initialProjectsState())).toContain("Connectez-vous au serveur");
    expect(renderProjectsStatusHtml({ loading: true })).toContain("Chargement des projets");
    expect(renderProjectsStatusHtml({ error: "boum" })).toContain("boum");
    expect(renderProjectsStatusHtml({ notice: "ok" })).toContain("ok");
    expect(renderProjectsStatusHtml({ projects: [{}, {}, {}] })).toContain("3 projet(s)");
  });

  it("rend le tableau des projets (dépôt relié, actions membres/retirer)", () => {
    expect(renderProjectsTableHtml(initialProjectsState())).toBe("");
    expect(renderProjectsTableHtml({ projects: [] })).toContain("Aucun projet");
    const html = renderProjectsTableHtml({
      projects: [{ id: 5, name: "alpha" }],
      repos: [{ id: 1, project_id: 5, bare_path: "/srv/repos/alpha.git" }],
    });
    expect(html).toContain("alpha");
    expect(html).toContain("/srv/repos/alpha.git");
    expect(html).toContain('data-prj-action="members"');
    expect(html).toContain('data-prj-action="remove"');
    expect(html).toContain('data-id="5"');
  });

  it("rend les membres du projet déplié, avec attribution et retrait", () => {
    expect(renderProjectMembersHtml(initialProjectsState())).toBe("");
    const html = renderProjectMembersHtml({
      selected: 5,
      projects: [{ id: 5, name: "alpha" }],
      repos: [],
      members: [{ user_id: 9, email: "dev@x", name: "Dev", role: "dev" }],
      memberForm: { email: "", role: "dev" },
    });
    expect(html).toContain("dev@x");
    expect(html).toContain('data-mem-action="assign"');
    expect(html).toContain('data-mem-action="unassign"');
    expect(html).toContain('id="gds-admin-prj-member-email"');
  });

  it("rend le panneau de confirmation avec purge décochée par défaut", () => {
    expect(renderProjectRemoveConfirmHtml(initialProjectsState())).toBe("");
    const html = renderProjectRemoveConfirmHtml({
      projects: [{ id: 5, name: "alpha" }],
      removing: { project_id: 5, name: "alpha", purge: false },
    });
    expect(html).toContain("Confirmation");
    expect(html).toContain('data-prj-action="remove-confirm"');
    expect(html).toContain('data-prj-action="remove-cancel"');
    expect(html).toContain('id="gds-admin-prj-purge"');
    expect(html).not.toMatch(/id="gds-admin-prj-purge"[^>]*checked/);
    // Purge cochée : la case est rendue cochée et le texte est explicite.
    const withPurge = renderProjectRemoveConfirmHtml({
      projects: [{ id: 5, name: "alpha" }],
      removing: { project_id: 5, name: "alpha", purge: true },
    });
    expect(withPurge).toMatch(/id="gds-admin-prj-purge"[^>]*checked/);
    expect(withPurge).toContain("IRRÉVERSIBLE");
  });

  it("compose la section complète et échappe le contenu du serveur", () => {
    const html = renderProjectsSectionHtml({
      ...initialProjectsState(),
      projects: [{ id: 1, name: '<script>alert(1)</script>' }],
      repos: [],
    });
    expect(html).toContain('data-section-id="repos"');
    expect(html).toContain('id="gds-admin-prj-refresh"');
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("n'expose jamais un secret présent dans l'état projets", () => {
    const html = renderProjectsSectionHtml({
      ...initialProjectsState(),
      projects: [{ id: 1, name: "alpha" }],
      repos: [],
      password: "S3CR3T-PW",
      token: "TOKEN-PW",
      members: [],
      selected: 1,
    });
    expect(html).not.toContain("S3CR3T-PW");
    expect(html).not.toContain("TOKEN-PW");
  });

  it("remplace la section L4.4 dans le shell et garde les suivantes en squelette", () => {
    const shell = renderAdminShellHtml({
      title: "t",
      subtitle: "s",
      sections: ADMIN_SECTIONS,
      sectionHtml: { repos: renderProjectsSectionHtml(initialProjectsState()) },
    });
    expect(shell).not.toContain("À venir — L4.4");
    expect(shell).toContain("À venir — L4.5");
  });
});

describe("L4.7 — projets sans membre (repérage + attribution groupée)", () => {
  it("liste UNIQUEMENT les projets sans aucun membre attribué", () => {
    const projects = [
      { id: 1, name: "alpha", member_count: 0 },
      { id: 2, name: "beta", member_count: 2 },
      { id: 3, name: "gamma" }, // member_count absent = aucun membre
      { id: 4, name: "delta", member_count: 1 },
    ];
    expect(projectsWithoutMember(projects).map((p) => p.id)).toEqual([1, 3]);
    expect(projectsWithoutMember(null)).toEqual([]);
  });

  it("repère « aucun membre » à l'écran et permet de filtrer", () => {
    const projects = [
      { id: 1, name: "alpha", member_count: 0 },
      { id: 2, name: "beta", member_count: 3 },
    ];
    const html = renderProjectsTableHtml({ projects, repos: [] });
    expect(html).toContain("aucun membre");
    expect(html).toContain("3 membre(s)");
    const filtered = renderProjectsTableHtml({ projects, repos: [], onlyOrphans: true });
    expect(filtered).toContain("alpha");
    expect(filtered).not.toContain("beta");
  });

  it("affiche le bloc groupé seulement s'il reste un projet sans membre", () => {
    expect(
      renderProjectBulkAssignHtml({ projects: [{ id: 2, name: "beta", member_count: 1 }] })
    ).toContain("Aucun projet sans membre");
    const html = renderProjectBulkAssignHtml({
      projects: [{ id: 1, name: "alpha", member_count: 0 }],
    });
    expect(html).toContain('id="gds-admin-prj-orphan-email"');
    expect(html).toContain('id="gds-admin-prj-orphan-role"');
    expect(html).toContain('data-prj-action="assign-missing"');
  });

  it("exige une confirmation explicite du compte et du rôle choisis", () => {
    expect(renderProjectBulkAssignConfirmHtml(initialProjectsState())).toBe("");
    const html = renderProjectBulkAssignConfirmHtml({
      projects: [
        { id: 1, name: "alpha", member_count: 0 },
        { id: 2, name: "beta", member_count: 1 },
      ],
      bulkConfirm: { email: "dev@x", role: "dev" },
    });
    expect(html).toContain("Confirmation");
    expect(html).toContain("dev@x");
    expect(html).toContain("1 projet(s)");
    expect(html).toContain('data-prj-action="assign-missing-confirm"');
    expect(html).toContain('data-prj-action="assign-missing-cancel"');
    expect(html).toContain("idempotente");
    expect(formatBulkAssignConfirmation(0, "dev@x", "dev")).toContain("0 projet(s)");
  });

  it("affiche le compte FRAIS du serveur après une attribution, jamais une réponse antérieure", () => {
    const state = {
      ...initialProjectsState(),
      projects: [{ id: 1, name: "alpha", member_count: 0 }],
      loadSeq: 2, // la demande courante porte le numéro 2
    };
    // Réponse d'une demande ANTÉRIEURE (numéro 1) : ignorée → badge inchangé.
    const stale = applyProjectsLoad(
      state,
      1,
      { ok: true, projects: [{ id: 1, name: "alpha", member_count: 0 }] },
      { ok: true, git_repos: [] }
    );
    expect(stale).toBe(state);
    expect(renderProjectsTableHtml(stale)).toContain("aucun membre");
    // Réponse de la demande courante (numéro 2), fraîche du serveur : le badge suit.
    const fresh = applyProjectsLoad(
      state,
      2,
      { ok: true, projects: [{ id: 1, name: "alpha", member_count: 2 }] },
      { ok: true, git_repos: [] }
    );
    expect(fresh).not.toBe(state);
    expect(renderProjectsTableHtml(fresh)).toContain("2 membre(s)");
    expect(renderProjectsTableHtml(fresh)).not.toContain("aucun membre");
    // L'état initial ne porte aucune demande en cours.
    expect(initialProjectsState().loadSeq).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// L4.5 — « Espace utilisé + journal »
// ─────────────────────────────────────────────────────────────────────────────

describe("L4.5 — espace + journal + clefs SSH (rendus purs + charges utiles)", () => {
  const conn = { host: "h", httpPort: "8080", email: "admin@b" };

  it("initialise l'état sans donnée chargée ni secret", () => {
    const s = initialStorageState();
    expect(s.server).toBeNull();
    expect(s.audit).toBeNull();
    expect(s.keys).toBeNull();
    expect(s.auditOffset).toBe(0);
    expect(s.auditScope).toBe("admin");
    expect(s.revoking).toBeNull();
  });

  it("construit les charges utiles (mot de passe vide, bornes respectées)", () => {
    expect(buildServerStatusArgs(conn)).toEqual(buildAccountsConnArgs(conn));
    expect(buildSshKeysArgs(conn)).toEqual(buildAccountsConnArgs(conn));
    expect(buildAuditArgs(conn)).toMatchObject({
      host: "h",
      httpPort: "8080",
      email: "admin@b",
      password: "",
      offset: 0,
      limit: AUDIT_PAGE_SIZE,
      scope: "admin",
      search: "",
    });
    // Portée inconnue ramenée à « admin » ; `limit` borné à 200.
    expect(buildAuditArgs(conn, { scope: "n'importe", limit: 9999 }).scope).toBe("admin");
    expect(buildAuditArgs(conn, { scope: "all" }).scope).toBe("all");
    expect(buildAuditArgs(conn, { limit: 9999 }).limit).toBe(200);
    // `limit` absent/absurde (0) → taille de page par défaut.
    expect(buildAuditArgs(conn, { limit: 0 }).limit).toBe(AUDIT_PAGE_SIZE);
    expect(buildAuditArgs(conn, { limit: NaN }).limit).toBe(AUDIT_PAGE_SIZE);
    expect(buildAuditArgs(conn, { offset: -5 }).offset).toBe(0);
    expect(buildSshKeyRevokeArgs(conn, "7")).toEqual({
      host: "h",
      httpPort: "8080",
      email: "admin@b",
      password: "",
      keyId: 7,
    });
  });

  it("formate les dates d'audit et raccourcit les clefs", () => {
    expect(formatAuditTime(null)).toBe("—");
    expect(formatAuditTime(0)).toBe("—");
    expect(typeof formatAuditTime(1700000000000)).toBe("string");
    expect(formatAuditTime(1700000000000)).not.toBe("—");
    expect(shortPublicKey("ssh-ed25519 AAAA", 40)).toBe("ssh-ed25519 AAAA");
    const long = "ssh-ed25519 " + "A".repeat(80);
    expect(shortPublicKey(long).endsWith("…")).toBe(true);
    expect(shortPublicKey(long).length).toBeLessThan(long.length);
  });

  it("rend l'espace utilisé, avec un total honnête (— si inconnu)", () => {
    const html = renderSpaceHtml({
      ...initialStorageState(),
      server: { repos_bytes: 2048, db_bytes: 1024 },
    });
    expect(html).toContain("Espace dépôts");
    expect(html).toContain("Espace base");
    expect(html).toContain("3.0 Ko");
    // Donnée manquante : « — », jamais un faux 0.
    const partial = renderSpaceHtml({ ...initialStorageState(), server: { repos_bytes: null } });
    expect(partial).toContain("—");
    expect(partial).not.toContain("0 o");
  });

  it("rend le journal : pagination, portée, échecs distingués", () => {
    const html = renderAuditTableHtml({
      ...initialStorageState(),
      audit: [
        { ts: 1700000000000, action: "login", detail: "ok", ip: "10.0.0.1", ok: true },
        { ts: 1700000001000, action: "login", detail: "refus", ip: "10.0.0.2", ok: false },
      ],
      auditTotal: 120,
      auditOffset: 0,
      auditScope: "admin",
    });
    expect(html).toContain("data-audit-scope=\"admin\"");
    expect(html).toContain("data-audit-scope=\"all\"");
    expect(html).toContain("1–50 sur 120");
    expect(html).toContain("login");
    expect(html).toContain("✓");
    expect(html).toContain("✗");
    // Première page : « Précédent » désactivé ; « Suivant » actif.
    expect(html).toMatch(/data-audit-page="prev" disabled/);
    expect(html).not.toMatch(/data-audit-page="next" disabled/);
    // Dernière page : « Suivant » désactivé.
    const last = renderAuditTableHtml({
      ...initialStorageState(),
      audit: [],
      auditTotal: 120,
      auditOffset: 100,
    });
    expect(last).toMatch(/data-audit-page="next" disabled/);
    expect(last).toContain("Aucune entrée pour ce filtre.");
  });

  it("liste les clefs SSH et n'expose que la clef publique", () => {
    const html = renderSshKeysTableHtml({
      ...initialStorageState(),
      keys: [
        { id: 3, email: "dev@x", public_key: "ssh-ed25519 AAAA test", created_at: "2026-01-01T00:00:00+00:00" },
      ],
    });
    expect(html).toContain("dev@x");
    expect(html).toContain("ssh-ed25519 AAAA test");
    expect(html).toContain("data-ssh-action=\"revoke\"");
    expect(renderSshKeysTableHtml(initialStorageState())).toContain("Clefs non chargées.");
    expect(
      renderSshKeysTableHtml({ ...initialStorageState(), keys: [] })
    ).toContain("Aucune clef SSH enregistrée.");
  });

  it("exige une confirmation explicite avant toute révocation", () => {
    // Aucune confirmation à l'état initial : rien à révoquer.
    expect(renderSshKeyRevokeConfirmHtml(initialStorageState())).toBe("");
    const html = renderSshKeyRevokeConfirmHtml({
      ...initialStorageState(),
      revoking: { id: 3, email: "dev@x" },
    });
    expect(html).toContain("authorized_keys");
    expect(html).toContain("irréversible");
    expect(html).toContain("data-ssh-action=\"revoke-confirm\"");
    expect(html).toContain("data-ssh-action=\"revoke-cancel\"");
  });

  it("compose la section complète avec ses quatre blocs", () => {
    const html = renderStorageSectionHtml({
      ...initialStorageState(),
      server: { repos_bytes: 10, db_bytes: 20 },
      audit: [],
      keys: [],
    });
    expect(html).toContain('data-section-id="storage"');
    expect(html).toContain('id="gds-admin-sto-refresh"');
    expect(html).toContain("Espace occupé par les dépôts et la base");
    expect(html).toContain("Journal des connexions & actions");
    expect(html).toContain("Clefs SSH autorisées");
    // Sans connexion : message d'invite, aucun tableau.
    const empty = renderStorageSectionHtml(initialStorageState());
    expect(empty).toContain("Connectez-vous");
  });

  it("rend l'état du bloc : chargement, erreur, notice, invite", () => {
    expect(renderStorageStatusHtml({ ...initialStorageState(), loading: true })).toContain(
      "Chargement"
    );
    expect(renderStorageStatusHtml({ ...initialStorageState(), error: "boom" })).toContain("boom");
    expect(renderStorageStatusHtml({ ...initialStorageState(), notice: "ok fait" })).toContain(
      "ok fait"
    );
    expect(renderStorageStatusHtml(initialStorageState())).toContain("Connectez-vous");
    expect(
      renderStorageStatusHtml({ ...initialStorageState(), server: { repos_bytes: 1 } })
    ).toContain("chargé");
  });

  it("n'expose jamais un secret présent dans l'état", () => {
    const html = renderStorageSectionHtml({
      ...initialStorageState(),
      server: { repos_bytes: 1, db_bytes: 2 },
      audit: [{ ts: 1, action: "login", detail: "d", ip: "i", ok: true }],
      keys: [{ id: 1, email: "dev@x", public_key: "k" }],
      password: "S3CR3T-PW",
      token: "TOKEN-PW",
    });
    expect(html).not.toContain("S3CR3T-PW");
    expect(html).not.toContain("TOKEN-PW");
  });

  it("remplace la section L4.5 dans le shell et garde L4.6 en squelette", () => {
    const shell = renderAdminShellHtml({
      title: "t",
      subtitle: "s",
      sections: ADMIN_SECTIONS,
      sectionHtml: { storage: renderStorageSectionHtml(initialStorageState()) },
    });
    expect(shell).not.toContain("À venir — L4.5");
    expect(shell).toContain("À venir — L4.6");
  });
});

describe("L4.6 — Contrôle du service (rendus purs, garde de rôle, double confirmation)", () => {
  it("définit un état initial sans secret", () => {
    const s = initialServiceState();
    expect(s.status).toBeNull();
    expect(s.loading).toBe(false);
    expect(s.error).toBe("");
    expect(s.confirm).toBeNull();
    expect(s.waiting).toBeNull();
    expect(s.stopped).toBe(false);
    expect(JSON.stringify(s)).not.toContain("password");
    expect(JSON.stringify(s)).not.toContain("token");
  });

  it("réserve le pilotage du service au rôle administrateur", () => {
    expect(canControlService("admin")).toBe(true);
    expect(canControlService(" Admin ")).toBe(true);
    expect(canControlService("dev")).toBe(false);
    expect(canControlService("")).toBe(false);
    expect(canControlService(null)).toBe(false);
    expect(canControlService(undefined)).toBe(false);
  });

  it("décrit clairement les effets, notamment ce qui est CONSERVÉ", () => {
    const stop = serviceConfirmText("stop");
    expect(stop).toContain("arrêtés");
    expect(stop).toContain("interrompus");
    expect(stop).toContain("CONSERVÉS");
    expect(stop).toContain("PostgreSQL");
    const restart = serviceConfirmText("restart");
    expect(restart).toContain("redémarrés");
    expect(restart).toContain("CONSERVÉS");
    expect(restart).toContain("PostgreSQL");
    expect(stop).not.toBe(restart);
  });

  it("construit la connexion admin des actions de service (sans mot de passe)", () => {
    const args = buildServiceStatusArgs({ host: "h", httpPort: "8787", email: "a@x" });
    expect(args).toEqual({ host: "h", httpPort: "8787", email: "a@x", password: "" });
    expect(buildServiceStatusArgs(undefined).password).toBe("");
  });

  it("exige la double confirmation : le bouton Confirmer reste désactivé sans acquittement", () => {
    expect(renderServiceConfirmHtml(initialServiceState())).toBe("");
    const pending = renderServiceConfirmHtml({
      ...initialServiceState(),
      confirm: { action: "restart", ack: false },
    });
    expect(pending).toContain("Double confirmation");
    expect(pending).toContain("CONSERVÉS");
    expect(pending).toContain('data-svc-action="restart-confirm"');
    expect(pending).toContain("disabled");
    expect(pending).toContain('id="gds-admin-svc-ack"');
    const ack = renderServiceConfirmHtml({
      ...initialServiceState(),
      confirm: { action: "restart", ack: true },
    });
    expect(ack).toContain("checked");
    expect(ack).not.toContain("disabled");
    const stop = renderServiceConfirmHtml({
      ...initialServiceState(),
      confirm: { action: "stop", ack: true },
    });
    expect(stop).toContain('data-svc-action="stop-confirm"');
    expect(stop).toContain("Arrêter le service");
    expect(stop).toContain("Arrêter le service :");
  });

  it("masque les boutons hors rôle administrateur et les montre pour l'admin", () => {
    const forbidden = renderServiceSectionHtml(initialServiceState(), "dev");
    expect(forbidden).toContain('data-section-id="service"');
    expect(forbidden).toContain("réservées au rôle administrateur");
    expect(forbidden).not.toContain('data-svc-action="restart"');
    expect(forbidden).not.toContain('data-svc-action="stop"');
    expect(forbidden).not.toContain('id="gds-admin-svc-refresh"');
    const allowed = renderServiceSectionHtml(initialServiceState(), "admin");
    expect(allowed).toContain('data-svc-action="restart"');
    expect(allowed).toContain('data-svc-action="stop"');
    expect(allowed).toContain('id="gds-admin-svc-refresh"');
    expect(allowed).toContain('id="gds-admin-service-status"');
    expect(allowed).not.toContain("réservées au rôle administrateur");
  });

  it("rend l'état du service (chargement, suivi, erreur, arrêt, notice, invite)", () => {
    expect(renderServiceStatusHtml({ ...initialServiceState(), loading: true })).toContain(
      "Interrogation du service"
    );
    const up = renderServiceStatusHtml({
      ...initialServiceState(),
      waiting: "up",
      attempts: 3,
    });
    expect(up).toContain("Redémarrage en cours");
    expect(up).toContain(`tentative 3/${SERVICE_HEALTH_MAX_ATTEMPTS}`);
    expect(
      renderServiceStatusHtml({ ...initialServiceState(), waiting: "down", attempts: 1 })
    ).toContain("Arrêt demandé");
    expect(renderServiceStatusHtml({ ...initialServiceState(), error: "boom" })).toContain("boom");
    expect(renderServiceStatusHtml({ ...initialServiceState(), stopped: true })).toContain(
      "arrêté"
    );
    expect(renderServiceStatusHtml({ ...initialServiceState(), notice: "fait" })).toContain(
      "fait"
    );
    expect(
      renderServiceStatusHtml({ ...initialServiceState(), status: { pid: 4242 } })
    ).toContain("4242");
    expect(renderServiceStatusHtml(initialServiceState())).toContain("Connectez-vous");
  });

  it("rend les programmes pilotés (jamais PostgreSQL)", () => {
    expect(renderServiceProgramsHtml(initialServiceState())).toBe("");
    const html = renderServiceProgramsHtml({
      ...initialServiceState(),
      status: {
        pid: 99,
        states: [
          { name: "gds-server", state: "RUNNING", pid: 55 },
          { name: "sshd", state: "STOPPED", pid: 56 },
        ],
      },
    });
    expect(html).toContain("gds-server");
    expect(html).toContain("sshd");
    expect(html).toContain("RUNNING");
    expect(html).toContain("STOPPED");
    expect(html).not.toContain("postgres");
    expect(renderServiceProgramsHtml({
      ...initialServiceState(),
      status: { error: "superviseur injoignable" },
    })).toContain("superviseur injoignable");
  });

  it("n'expose jamais un secret présent dans l'état", () => {
    const html = renderServiceSectionHtml(
      {
        ...initialServiceState(),
        status: { pid: 1, states: [{ name: "gds-server", state: "RUNNING", pid: 2 }] },
        password: "S3CR3T-PW",
        token: "TOKEN-PW",
      },
      "admin"
    );
    expect(html).not.toContain("S3CR3T-PW");
    expect(html).not.toContain("TOKEN-PW");
  });

  it("remplace la section L4.6 dans le shell (plus de squelette)", () => {
    const shell = renderAdminShellHtml({
      title: "t",
      subtitle: "s",
      sections: ADMIN_SECTIONS,
      sectionHtml: { service: renderServiceSectionHtml(initialServiceState(), "admin") },
    });
    expect(shell).not.toContain("À venir — L4.6");
    expect(shell).toContain('data-section-id="service"');
  });

  it("expose une description de section non vide", () => {
    expect(SERVICE_DESC.length).toBeGreaterThan(20);
    expect(SERVICE_DESC).toContain("PostgreSQL");
  });
});
