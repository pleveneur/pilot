// Tests unitaires — gds-admin.js (lot L4.1 : squelette de l'onglet transverse).
// Couvre les aides de rendu PURES (réutilisées par l'écran de paramétrage L5.1).
import { describe, it, expect } from "vitest";
import {
  ACCOUNT_ROLES,
  ACCOUNT_STATUSES,
  ACCOUNTS_DESC,
  ADMIN_SECTIONS,
  DEFAULT_HTTP_PORT,
  buildAccountCreateArgs,
  buildAccountListArgs,
  buildAccountPasswordArgs,
  buildAccountRoleArgs,
  buildAccountStatusArgs,
  buildAccountsConnArgs,
  formatAccountDate,
  formatBytes,
  initialAccountsState,
  initialConnectionState,
  nextStatusToggle,
  pickPrefill,
  renderAccountsSectionHtml,
  renderAccountsStatusHtml,
  renderAccountsTableHtml,
  renderAdminSectionHtml,
  renderAdminShellHtml,
  renderConnectionSectionHtml,
  renderConnectionStatusHtml,
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
