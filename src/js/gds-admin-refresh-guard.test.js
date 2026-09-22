/**
 * Garde-fou : écouteur du bouton « rafraîchir » des comptes de l'onglet
 * « 🖥️ GDS Serveur — administration ».
 *
 * Régression corrigée : `bind()` contenait `if (refresh) refresh.addEventListener(...)`
 * alors que `refresh` n'était déclaré nulle part → `ReferenceError: refresh is
 * not defined` à l'ouverture de l'onglet, écran blanc. Ce test échoue si
 * l'identifiant repart d'un `q("#gds-admin-acc-refresh")` manquant.
 *
 * Aucun navigateur n'est requis : simple lecture du fichier source.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = readFileSync(resolve(ROOT, "src/js/gds-admin.js"), "utf8");

/** Corps de `bind()`, découpé sur les accolades équilibrées. */
function bindBody() {
  const start = src.indexOf("function bind() {");
  expect(start, "function bind() absente de gds-admin.js").toBeGreaterThan(-1);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error("accolades de bind() non équilibrées");
}

describe("onglet d'administration GDS — écouteurs du bloc comptes", () => {
  it("déclare `refresh` depuis #gds-admin-acc-refresh avant de l'utiliser", () => {
    const body = bindBody();
    const decl = body.indexOf('const refresh = q("#gds-admin-acc-refresh");');
    const use = body.indexOf("if (refresh) refresh.addEventListener(");
    expect(decl, "déclaration `const refresh = q(\"#gds-admin-acc-refresh\")` absente").toBeGreaterThan(-1);
    expect(use, "écouteur `if (refresh) refresh.addEventListener(...)` absent").toBeGreaterThan(-1);
    expect(decl).toBeLessThan(use);
    expect(body).toMatch(/if \(refresh\) refresh\.addEventListener\("click", \(\) => loadAccounts\(\)\);/);
  });
});
