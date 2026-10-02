// Tests unitaires — gds-menu.js, étape 4 « choix du serveur » de l'étude
// « Ajouter un projet depuis le GDS ». Couvre les aides PURES du choix :
// libellés lisibles (nom, e-mail, hôte, port), fiches inutilisables écartées,
// et absence de tout champ sensible dans ce qui est produit.
import { describe, it, expect } from "vitest";
import {
  gdsNoServerHint,
  gdsServerChoices,
  gdsServerSelectorHtml,
  gdsServerProjectRows,
  gdsServerProjectsHtml,
} from "./gds-menu.js";

// Fiche serveur « compte GDS » telle que la renvoie `gds_list_saved_servers`,
// secrets compris : ils ne doivent JAMAIS ressortir des choix.
const fiche = {
  name: "GDS maison",
  host: "127.0.0.1",
  http_port: "8080",
  identity: true,
  validated: true,
  gds_email: "moi@exemple.fr",
  gds_role: "dev",
  gds_password: "SECRET-GDS-9f2",
  db_password: "SECRET-BASE-4c1",
  admin_password: "SECRET-ADMIN-7a3",
  user: "pilot",
  port: "5432",
  ssh_port: "2222",
  gds_server_repos: "/srv/git/repos",
  description: "serveur de test",
};

describe("gdsServerChoices (pure — étape 4)", () => {
  it("une fiche utilisable produit une entrée lisible (nom, e-mail, hôte:port)", () => {
    const choices = gdsServerChoices([fiche]);
    expect(choices).toHaveLength(1);
    expect(choices[0].label).toBe("GDS maison — moi@exemple.fr (127.0.0.1:8080)");
    expect(choices[0]).toMatchObject({
      name: "GDS maison",
      email: "moi@exemple.fr",
      host: "127.0.0.1",
      httpPort: "8080",
    });
    expect(choices[0].value).toBe("127.0.0.1|8080|moi@exemple.fr");
  });

  it("écarte les fiches inutilisables (compte absent, non validée, incomplète)", () => {
    expect(
      gdsServerChoices([
        { ...fiche, identity: false }, // fiche héritée du compte technique
        { ...fiche, identity: undefined }, // idem, sans drapeau
        { ...fiche, gds_email: "" }, // pas d'adresse GDS
        { ...fiche, validated: false }, // serveur jamais validé
        { ...fiche, http_port: "" }, // port du service inconnu
        { ...fiche, host: "   " }, // hôte absent
        null,
        "texte",
      ]),
    ).toEqual([]);
    expect(gdsServerChoices(null)).toEqual([]);
    expect(gdsServerChoices("pas une liste")).toEqual([]);
  });

  it("ne produit aucun champ sensible ni valeur de secret", () => {
    const choices = gdsServerChoices([fiche]);
    const json = JSON.stringify(choices);
    expect(json).not.toContain("SECRET");
    expect(json).not.toContain("password");
    expect(json).not.toContain("gds_password");
    expect(json).not.toContain("ssh_port");
    expect(json).not.toContain("/srv/git/repos");
    // Seuls des champs choisis explicitement sortent : rien de la fiche n'est recopié.
    expect(Object.keys(choices[0]).sort()).toEqual([
      "email",
      "host",
      "httpPort",
      "label",
      "name",
      "value",
    ]);
  });

  it("fiche sans nom : l'e-mail et l'adresse restent lisibles", () => {
    const [c] = gdsServerChoices([{ ...fiche, name: "" }]);
    expect(c.label).toBe("moi@exemple.fr (127.0.0.1:8080)");
    expect(c.name).toBe("127.0.0.1");
  });
});

describe("gdsServerSelectorHtml (pure — étape 4)", () => {
  const choices = gdsServerChoices([
    fiche,
    { ...fiche, name: "Second", host: "10.0.0.9", http_port: "8090", gds_email: "autre@exemple.fr" },
  ]);

  it("rend un choix par élément, sans aucun secret", () => {
    const html = gdsServerSelectorHtml(choices, choices[1].value);
    expect(html).toContain('id="gds-menu-server"');
    expect(html).toContain('value="10.0.0.9|8090|autre@exemple.fr" selected');
    expect(html).toContain("GDS maison — moi@exemple.fr (127.0.0.1:8080)");
    expect(html).not.toContain("SECRET");
    expect(html).not.toContain("password");
  });

  it("sélectionne le premier choix quand la valeur demandée n'existe plus", () => {
    const html = gdsServerSelectorHtml(choices, "disparu|8080|nulle@part");
    expect(html).toContain(`value="${choices[0].value}" selected`);
  });

  it("aucun serveur : aucun sélecteur, et un message clair à la place", () => {
    expect(gdsServerSelectorHtml([])).toBe("");
    const hint = gdsNoServerHint();
    expect(hint).toContain("Aucun serveur GDS");
    expect(hint).toContain("GDS — paramétrage");
    expect(hint).not.toMatch(/undefined|Error|error/);
  });

  it("échappe les valeurs (jamais de HTML injecté)", () => {
    const html = gdsServerSelectorHtml(gdsServerChoices([{ ...fiche, name: "<b>h</b>" }]));
    expect(html).not.toContain("<b>h</b>");
    expect(html).toContain("&lt;b&gt;h&lt;/b&gt;");
  });
});

// ── Étape 5 : liste des projets du serveur choisi + actions par ligne ──
// Projet tel que le renvoie `gds_server_projects`.
const project = (name) => ({
  id: 1,
  name,
  repo_name: name,
  repo_url: "ssh://git@127.0.0.1:2222/srv/git/repos/" + name + ".git",
  path_on_server: "/srv/git/repos/" + name + ".git",
  status: "active",
  description: "",
});

// Dépôt tel que le renvoie `gds_server_git_repos` (enrichi de l'état local),
// secrets compris : rien de sensible ne doit ressortir des lignes.
const repo = (name, extra = {}) => ({
  id: 1,
  project_id: 1,
  name,
  path_on_server: "/srv/git/repos/" + name + ".git",
  bare_path: "/srv/git/repos/" + name + ".git",
  email: "SECRET-MAIL@exemple.fr",
  password: "SECRET-MDP",
  local_exists: false,
  local_path: "/SECRET-CHEMIN/" + name,
  work_exists: false,
  work_path: "",
  ...extra,
});

describe("gdsServerProjectRows (pure — étape 5)", () => {
  it("un projet déjà présent est signalé, grisé, et propose d'ouvrir la copie locale", () => {
    const rows = gdsServerProjectRows(
      [project("Kodali")],
      [repo("Kodali", { local_exists: true, local_path: "C:\\GDS\\Kodali" })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Kodali",
      alreadyLocal: true,
      greyed: true,
      openPath: "C:\\GDS\\Kodali",
      hasRepo: true,
    });
    // Aucune action de récupération : uniquement l'ouverture de la copie locale,
    // plus le rattachement d'une copie rangée ailleurs (jamais d'impasse).
    expect(rows[0].actions.map((a) => a.act)).toEqual(["open", "attach"]);
    expect(rows[0].actions[0].label).toBe("Ouvrir le projet local");
    expect(rows[0].chip).toBe("déjà récupéré");
  });

  it("un projet de travail déjà sur le poste est grisé et s'ouvre depuis son dossier", () => {
    const rows = gdsServerProjectRows(
      [project("Sigma")],
      [repo("Sigma", { work_exists: true, work_path: "D:\\Projets\\Sigma" })],
    );
    expect(rows[0]).toMatchObject({ alreadyLocal: true, greyed: true, openPath: "D:\\Projets\\Sigma" });
    expect(rows[0].actions.map((a) => a.act)).toEqual(["open", "attach"]);
    expect(rows[0].chip).toBe("déjà sur ce poste");
  });

  it("un projet absent propose la récupération et le rattachement d'une copie existante", () => {
    const rows = gdsServerProjectRows([project("Nuage")], [repo("Nuage")]);
    expect(rows[0]).toMatchObject({ alreadyLocal: false, greyed: false, openPath: "" });
    expect(rows[0].actions.map((a) => a.act)).toEqual(["get", "attach"]);
    expect(rows[0].actions.map((a) => a.label)).toEqual([
      "Récupérer une copie",
      "J'ai déjà ce projet ailleurs",
    ]);
    // Aucune étiquette de grisé, et pas de chemin local exposé.
    expect(rows[0].chip).toBe("");
  });

  it("ne produit aucun champ ni valeur sensible", () => {
    const rows = gdsServerProjectRows([project("Kodali")], [repo("Kodali")]);
    const json = JSON.stringify(rows);
    expect(json).not.toContain("SECRET");
    expect(json).not.toContain("password");
    expect(json).not.toContain("@exemple.fr");
    expect(json).not.toContain("/srv/git/repos");
    // Champs produits : une liste blanche, rien de la ligne serveur n'est recopié.
    expect(Object.keys(rows[0]).sort()).toEqual([
      "actions",
      "alreadyLocal",
      "chip",
      "greyed",
      "hasRepo",
      "name",
      "openPath",
    ]);
  });

  it("un projet sans dépôt sur le serveur n'est pas proposé à la récupération", () => {
    const rows = gdsServerProjectRows([project("SansDepot")], []);
    expect(rows[0]).toMatchObject({ hasRepo: false, alreadyLocal: false });
    expect(rows[0].actions.map((a) => a.act)).toEqual(["attach"]);
    expect(rows[0].chip).toBe("aucun dépôt sur le serveur");
  });

  it("le rattachement d'une copie rangée ailleurs est proposé sur toutes les lignes", () => {
    const rows = gdsServerProjectRows(
      [project("Kodali"), project("Nuage"), project("SansDepot")],
      [
        repo("Kodali", { local_exists: true, local_path: "/tmp/Kodali" }),
        repo("Nuage"),
      ],
    );
    for (const r of rows) {
      const attach = r.actions.find((a) => a.act === "attach");
      expect(attach && attach.label).toBe("J'ai déjà ce projet ailleurs");
    }
    // Chaque ligne a exactement une action principale, plus le rattachement.
    expect(rows.map((r) => r.actions.map((a) => a.act))).toEqual([
      ["open", "attach"],
      ["get", "attach"],
      ["attach"],
    ]);
  });

  it("rapproche les projets et les dépôts par le nom, en gardant l'ordre du serveur", () => {
    const rows = gdsServerProjectRows(
      [project("Beta"), project("Alpha")],
      [repo("Alpha", { local_exists: true, local_path: "/tmp/Alpha" }), repo("Inconnu")],
    );
    expect(rows.map((r) => r.name)).toEqual(["Beta", "Alpha"]);
    expect(rows.map((r) => r.alreadyLocal)).toEqual([false, true]);
    // Entrées sans nom ou listes absentes : aucune ligne, jamais de plantage.
    expect(gdsServerProjectRows(null, null)).toEqual([]);
    expect(gdsServerProjectRows([{ name: "  " }, null], [])).toEqual([]);
  });
});

describe("gdsServerProjectsHtml (pure — étape 5)", () => {
  it("grise la ligne d'un projet déjà présent et rend son bouton d'ouverture", () => {
    const rows = gdsServerProjectRows(
      [project("Kodali")],
      [repo("Kodali", { local_exists: true, local_path: "C:\\GDS\\Kodali" })],
    );
    const html = gdsServerProjectsHtml(rows);
    expect(html).toContain("gds-menu-item-greyed");
    expect(html).toContain("Ouvrir le projet local");
    expect(html).toContain("déjà récupéré");
    expect(html).not.toContain("Récupérer une copie");
    expect(html).toContain("J&#39;ai déjà ce projet ailleurs");
    expect(html).not.toContain("SECRET");
  });

  it("rend la récupération et le rattachement pour un projet absent", () => {
    const html = gdsServerProjectsHtml(gdsServerProjectRows([project("Nuage")], [repo("Nuage")]));
    expect(html).toContain("Récupérer une copie");
    expect(html).toContain("J&#39;ai déjà ce projet ailleurs");
    expect(html).not.toContain("gds-menu-item-greyed");
    expect(html).not.toContain("SECRET");
    expect(html).not.toContain("password");
  });

  it("aucun projet sur le serveur : message clair, jamais de liste muette", () => {
    const html = gdsServerProjectsHtml([]);
    expect(html).toContain("Aucun projet");
    expect(html).toContain("gds-empty");
    expect(html).not.toMatch(/undefined|Error|error|NaN/);
    // Une liste absente ou sans ligne exploitable donne le même message.
    expect(gdsServerProjectsHtml(null)).toContain("Aucun projet");
    expect(gdsServerProjectsHtml(gdsServerProjectRows([], []))).toContain("Aucun projet");
  });

  it("échappe les noms, les étiquettes et les libellés (aucun HTML injecté)", () => {
    const html = gdsServerProjectsHtml([
      {
        name: "<b>Kodali</b>",
        chip: "<i>déjà</i>",
        greyed: true,
        actions: [
          { act: "open", label: "<u>Ouvrir</u>", icon: "folder-open", title: '"onclick="x' },
        ],
      },
    ]);
    expect(html).not.toContain("<b>Kodali</b>");
    expect(html).not.toContain("<i>déjà</i>");
    expect(html).not.toContain("<u>Ouvrir</u>");
    expect(html).not.toContain('onclick="x');
    expect(html).toContain("&lt;b&gt;Kodali&lt;/b&gt;");
    expect(html).toContain("&lt;u&gt;Ouvrir&lt;/u&gt;");
    expect(html).toContain("data-act=\"open\"");
  });
});
