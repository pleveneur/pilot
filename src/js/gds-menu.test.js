// Tests unitaires — gds-menu.js, étape 4 « choix du serveur » de l'étude
// « Ajouter un projet depuis le GDS ». Couvre les aides PURES du choix :
// libellés lisibles (nom, e-mail, hôte, port), fiches inutilisables écartées,
// et absence de tout champ sensible dans ce qui est produit.
import { describe, it, expect } from "vitest";
import {
  gdsNoServerHint,
  gdsServerChoices,
  gdsServerSelectorHtml,
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
