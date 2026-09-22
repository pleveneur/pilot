/**
 * Garde-fou d'affichage des tableaux d'administration GDS.
 *
 * En thème sombre, les cellules de `.gds-admin-table` n'avaient aucune couleur
 * de texte explicite et aucun ancêtre n'en imposait : elles héritaient du noir
 * par défaut, invisible sur le fond sombre (listes des comptes, des programmes,
 * des membres, des clefs, du journal…). Le correctif pose la couleur du thème
 * sur la base `.gds-admin-table`. Ce test échoue si cette déclaration disparaît
 * — la régression serait silencieuse, visible seulement en thème sombre.
 *
 * Aucun navigateur n'est requis : simple lecture du fichier de styles.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const css = readFileSync(resolve(ROOT, "src/css/style.css"), "utf8");

/** Extrait le corps de la première règle dont le sélecteur vaut exactement `sel`. */
function block(sel) {
  const m = css.match(new RegExp(`(?:^|\\})\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : "";
}

describe("style des tableaux d'administration GDS", () => {
  it("pose une couleur de texte explicite (variable de thème) sur la base des tableaux", () => {
    expect(block(".gds-admin-table")).toMatch(/color\s*:\s*var\(--text-primary\b/);
  });

  it("n'utilise pas de couleur écrite en dur pour cette base", () => {
    // La couleur doit venir de la variable de thème (repli hexadécimal admis dans var()).
    const body = block(".gds-admin-table").replace(/var\([^)]*\)/g, "");
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(/);
  });
});
