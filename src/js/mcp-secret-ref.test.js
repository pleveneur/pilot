import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Garde anti-régression (défaut trouvé le 02/10/2026) : le champ « Clé » d'un
// serveur MCP distant attendait la référence d'une entrée du coffre, référence
// générée automatiquement et affichée NULLE PART → champ impossible à remplir.
// Correctif : liste déroulante des entrées du coffre (libellé = description,
// valeur = « vault:<id> ») + référence affichée dans l'onglet 🔐.
//
// Les deux assertions de ce fichier doivent casser si (a) le sélecteur
// disparaît, ou (b) un mot de passe se remet à transiter vers l'interface.
const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const settings = readFileSync(new URL("./settings.js", import.meta.url), "utf8");
const vault = readFileSync(new URL("./vault.js", import.meta.url), "utf8");
const lib = readFileSync(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");

describe("Paramètres — champ « Clé » d'un serveur MCP", () => {
  it("propose les entrées du coffre dans une liste déroulante (saisie libre conservée)", () => {
    expect(html).toMatch(/id="mcp-f-secret-ref"[^>]*list="mcp-secret-ref-list"/);
    expect(html).toContain('<datalist id="mcp-secret-ref-list">');
    // Le libellé et l'aide décrivent ce que le champ attend réellement.
    expect(html).not.toContain("vault:mon-entree");
    expect(html).toContain("verrouillé au lancement de l'agent");
  });

  it("remplit la liste depuis le coffre et gère le coffre verrouillé / vide", () => {
    expect(settings).toContain("fillMcpSecretRefOptions()");
    expect(settings).toContain('invoke("vault_list_refs")');
    expect(settings).toContain("e.description");
    expect(settings).toContain("Coffre 🔐 verrouillé");
    expect(settings).toContain("ne contient aucune entrée");
  });

  it("ne fait jamais transiter un mot de passe du coffre vers l'interface", () => {
    // Le sélecteur n'a pas le droit d'appeler la liste COMPLÈTE (elle contient
    // les mots de passe) : il passe par la projection dédiée, déclarée en Rust.
    expect(settings).not.toMatch(/invoke\(\s*["']vault_list["']/);
    expect(lib).toContain("vault::vault_list_refs");
  });

  it("affiche la référence d'une entrée dans l'onglet Coffre", () => {
    expect(vault).toContain('ref.textContent = "vault:" + e.id');
    expect(vault).toContain('"vault:" + e.id');
  });
});
