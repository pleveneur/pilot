// source-slice.js — découpage de SOURCE de test, VÉRIFIÉ (utilitaire de TEST).
//
// Pourquoi ce fichier : plusieurs tests lisent le source d'un module et en
// découpent une fonction pour vérifier une règle de BRANCHEMENT. Écrit à la
// main (`src.slice(src.indexOf("…"), src.indexOf("…"))`), ce découpage est
// silencieusement faux dès qu'une ancre change : `indexOf` rend −1, `slice`
// rend une chaîne vide (ou un fragment vide), et l'assertion
// `expect(fragment).not.toContain(…)` devient vraie PAR CONSTRUCTION. Le test
// ne vérifie alors plus rien (3ᵉ audit, défaut 4).
//
// Ce helper rend le découpage VÉRIFIABLE : une ancre absente, une ancre de fin
// placée avant le début, ou un fragment trop court LÈVENT une erreur — donc le
// test échoue bruyamment au lieu de passer pour rien. Il est lui-même testé
// (`source-slice.test.js`), et son usage est imposé par l'inventaire de
// `source-slice.test.js` (aucun découpage non protégé ajouté dans les tests JS).
//
// Aucun import applicatif : ce module ne sert qu'aux tests.

export class SourceSliceError extends Error {
  constructor(message) {
    super(message);
    this.name = "SourceSliceError";
  }
}

/**
 * Découpe `src` entre `startAnchor` (inclus) et `endAnchor` (exclu).
 *
 * @param {string} src source complète (déjà normalisée en LF si besoin)
 * @param {string} startAnchor ancre de début — DOIT exister
 * @param {string} [endAnchor] ancre de fin — DOIT exister APRÈS le début ;
 *   omise, le fragment va jusqu'à la fin de la source
 * @param {number} [minLen] taille minimale exigée pour le fragment
 * @returns {string} le fragment, garanti non vide et assez long
 * @throws {SourceSliceError} ancre absente, fin avant le début, fragment trop court
 */
export function sliceSource(src, startAnchor, endAnchor, minLen = 1) {
  if (typeof src !== "string") {
    throw new SourceSliceError("source illisible (chaîne attendue)");
  }
  if (typeof startAnchor !== "string" || startAnchor === "") {
    throw new SourceSliceError("ancre de début absente (chaîne non vide attendue)");
  }
  const start = src.indexOf(startAnchor);
  if (start < 0) {
    throw new SourceSliceError(`ancre de début absente : ${startAnchor}`);
  }
  let end;
  if (endAnchor === undefined) {
    end = src.length;
  } else {
    end = src.indexOf(endAnchor, start + startAnchor.length);
    if (end < 0) {
      // Distingue « absente » de « présente mais avant le début » : dans les deux
      // cas le fragment serait faux, mais le diagnostic n'est pas le même.
      if (src.indexOf(endAnchor) >= 0) {
        throw new SourceSliceError(
          `ancre de fin placée avant le début du fragment : ${endAnchor}`,
        );
      }
      throw new SourceSliceError(`ancre de fin absente : ${endAnchor}`);
    }
    if (end <= start) {
      throw new SourceSliceError(
        `ancre de fin placée avant le début du fragment : ${endAnchor}`,
      );
    }
  }
  const fragment = src.slice(start, end);
  if (fragment.length < minLen) {
    throw new SourceSliceError(
      `fragment trop court (${fragment.length} < ${minLen}) entre « ${startAnchor} » et « ${endAnchor ?? "fin de source"} »`,
    );
  }
  return fragment;
}

/**
 * Variante pratique quand la fin du fragment est la fin de la source : même
 * garde de début et de taille, sans exigence d'ancre de fin.
 */
export function sliceFrom(src, startAnchor, minLen = 1) {
  return sliceSource(src, startAnchor, undefined, minLen);
}

// ── Inventaire : découpage de source NON PROTÉGÉ dans un fichier de test ─────
//
// Motif refusé, et LUI SEUL : une borne de `.slice(…)` calculée EN LIGNE par un
// `indexOf(` / `lastIndexOf(` — `x.slice(x.indexOf("a"))`,
// `x.slice(debut, x.indexOf("b"))`, `x.slice(0, x.indexOf("c"))`. C'est
// exactement le motif du défaut : l'ancre change, l'indice vaut −1, le fragment
// est vide (ou commence au dernier caractère) et l'assertion négative qui suit
// devient vraie par construction.
//
// Les bornes passées par une VARIABLE (`const debut = src.indexOf(…)` puis
// `src.slice(debut, …)`) ne sont volontairement PAS jugées ici : leur garde est
// une assertion voisine, qu'aucune analyse textuelle simple ne peut trancher de
// façon fiable. Les deux fichiers réparés par ce correctif utilisent désormais
// `sliceSource` et sont tenus à zéro par un test dédié.

/**
 * Neutralise ce qui n'est PAS du code : littéraux de chaîne, gabarits et
 * commentaires. Sans cela, un ÉCHANTILLON de code fautif écrit dans une chaîne
 * (comme dans `source-slice.test.js`) serait compté comme un vrai découpage, et
 * un commentaire citant le motif le serait aussi. Les retours à la ligne sont
 * conservés (numéros de ligne stables).
 */
export function neutraliserSource(source) {
  const vider = (m) => m.replace(/[^\n]/g, " ");
  return String(source)
    .replace(/\/\*[\s\S]*?\*\//g, vider)
    .replace(/(^|[^:\\])\/\/.*$/gm, "$1")
    .replace(/`[^`]*`/g, vider)
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

/**
 * @param {string} source contenu d'un fichier
 * @returns {Array<{line:number, text:string}>} sites de découpage non protégé
 */
export function findUnprotectedSourceSlices(source) {
  const texte = neutraliserSource(String(source).replace(/\r\n/g, "\n"));
  const lignes = texte.split("\n");
  const ligneDe = (pos) => texte.slice(0, pos).split("\n").length;
  const sites = [];
  const ouverture = /\.slice\(/g;
  let m;
  while ((m = ouverture.exec(texte)) !== null) {
    const args = argumentsDEt(texte, m.index + m[0].length - 1);
    if (args === null || !/(last)?[iI]ndexOf\(/.test(args)) continue;
    const num = ligneDe(m.index);
    sites.push({ line: num, text: lignes[num - 1].trim() });
  }
  return sites;
}

/**
 * Rend le texte des arguments d'un appel, parenthèses équilibrées : `slice(`
 * accepte un appel imbriqué dans ses bornes (`x.slice(0, x.indexOf("a"))`), et
 * s'arrêter à la première `)` manquerait précisément le `indexOf(` cherché.
 *@param {string} texte source déjà neutralisée
 * @param {number} ouvrante position de la parenthèse ouvrante
 * @returns {string|null} arguments, ou null si l'appel n'est pas refermé
 */
function argumentsDEt(texte, ouvrante) {
  let profondeur = 0;
  const limite = Math.min(texte.length, ouvrante + 2000);
  for (let i = ouvrante; i < limite; i += 1) {
    const c = texte[i];
    if (c === "(") profondeur += 1;
    else if (c === ")") {
      profondeur -= 1;
      if (profondeur === 0) return texte.slice(ouvrante + 1, i);
    }
  }
  return null;
}
