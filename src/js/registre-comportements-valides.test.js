/**
 * GARDE-FOU DU REGISTRE DES COMPORTEMENTS VALIDÉS.
 *
 * CE QUE CE FICHIER VERROUILLE :
 *   1. CHAQUE LIGNE DU REGISTRE A UN TEST DE COMPORTEMENT QUI EXISTE VRAIMENT.
 *      Le test lit le registre (`spec_registre_comportements_valides.md`) et va
 *      chercher le titre cité DANS le fichier de test : un titre renommé, un
 *      fichier déplacé ou supprimé fait échouer cette suite. La liste n'est
 *      jamais recopiée ici — sinon le garde-fou ne détecterait aucune dérive.
 *   2. LE TEST CITÉ EST UN VRAI TEST. Il doit être un `it(...)` (jamais
 *      `it.skip` / `it.todo`), et son corps doit contenir au moins une
 *      assertion (`expect(`) avant le test suivant : un test creux ne
 *      verrouille rien.
 *   3. LE REGISTRE N'EST PAS VIDÉ. Numéros uniques et consécutifs depuis 1,
 *      pas de couple fichier + titre en double, au moins 6 entrées (les
 *      comportements validés minimum), chaque ligne réellement rédigée.
 *   4. RIEN N'ENTRE NI NE SORT EN SILENCE. Un fichier de test qui se déclare
 *      « REGISTRE DES COMPORTEMENTS VALIDÉS — ENTRÉE N° n » doit figurer au
 *      registre sous CE numéro, et inversement le registre ne peut pas
 *      revendiquer une entrée numérotée qu'aucun fichier ne porte.
 *   5. LE REGISTRE EST ANNONCÉ. `AGENTS.md` doit citer le fichier : supprimer
 *      la spec ou la retirer de la documentation fait échouer la suite.
 *
 * Ce fichier n'exécute aucun test de comportement à la place des autres : il
 * ne fait que vérifier que le registre dit la vérité sur le disque.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ICI, "..", "..");
const REGISTRE = join(RACINE, "spec_registre_comportements_valides.md");

/** Fins de ligne normalisées : un worktree CRLF ne doit rien faire échouer. */
const lire = (chemin) => readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");

const SOURCE_REGISTRE = lire(REGISTRE);

/**
 * Le tableau du registre seul : entre le titre « ## Le registre » et le
 * prochain titre de niveau 2. Les tableaux d'exemple du mode d'emploi sont
 * ainsi hors de portée (ils ne sont pas des entrées).
 */
function lignesDuRegistre(source) {
  const debut = source.indexOf("## Le registre");
  if (debut === -1) return [];
  const suite = source.indexOf("\n## ", debut + 1);
  const bloc = suite === -1 ? source.slice(debut) : source.slice(debut, suite);
  return bloc
    .split("\n")
    .filter((ligne) => ligne.trimStart().startsWith("|"))
    .filter((ligne) => !/^\s*\|[\s:|-]+\|\s*$/.test(ligne)) // séparateur
    .filter((ligne) => !ligne.includes("Comportement attendu")); // en-tête
}

/**
 * Une ligne de registre -> { numero, comportement, fichier, titre }.
 * Le format est FIXÉ par la spec : quatre barres verticales, la troisième
 * cellule portant `chemin :: titre`. Une cellule de plus (un `|` dans un
 * titre) est une erreur dite, jamais avalée.
 */
function analyserLigne(ligne) {
  const cellules = ligne.split("|");
  if (cellules.length !== 5) {
    return {
      erreur: `la ligne n'a pas 3 colonnes (un « | » traîne dans un titre ?) : ${ligne.trim()}`,
    };
  }
  const numero = cellules[1].trim();
  const comportement = cellules[2].trim();
  const cible = cellules[3].trim();
  const separe = cible.indexOf("::");
  if (separe === -1) {
    return { erreur: `la colonne « Test qui le protège » n'a pas de « :: » : ${ligne.trim()}` };
  }
  const fichier = cible.slice(0, separe).trim().replace(/^`|`$/g, "");
  const titre = cible.slice(separe + 2).trim();
  return { numero, comportement, fichier, titre };
}

/** Tous les fichiers de test du front (là où vivent les verrous). */
const FICHIERS_DE_TEST = readdirSync(ICI)
  .filter((nom) => nom.endsWith(".test.js"))
  .sort();

/**
 * Le source d'un test, avec une seconde version où les guillemets échappés
 * sont rendus tels quels : un titre contenant `"` est écrit `\"` dans le
 * fichier, et doit quand même être retrouvé.
 */
function sourceDuTest(relatif) {
  const chemin = join(RACINE, normalize(relatif));
  if (!existsSync(chemin) || !statSync(chemin).isFile()) return null;
  const source = lire(chemin);
  return { source, desechappe: source.replace(/\\"/g, '"') };
}

const ENTREES = lignesDuRegistre(SOURCE_REGISTRE).map(analyserLigne);

describe("1. le registre est lisible et complet", () => {
  it("le tableau du registre existe et porte au moins les six comportements validés", () => {
    expect(
      ENTREES.length,
      "le registre ne contient aucune ligne : le garde-fou n'a plus rien à vérifier",
    ).toBeGreaterThanOrEqual(6);
  });

  it("chaque ligne est réellement rédigée : numéro, phrase d'attendu, cible", () => {
    for (const entree of ENTREES) {
      expect(entree.erreur, entree.erreur).toBeUndefined();
      expect(entree.numero).toMatch(/^\d+$/);
      // Une phrase, pas un pense-bête : elle dit ce que l'utilisateur constate.
      expect(
        entree.comportement.length,
        `l'entrée ${entree.numero} n'a pas de phrase d'attendu`,
      ).toBeGreaterThan(30);
      expect(entree.comportement.endsWith("."), `l'entrée ${entree.numero} n'est pas une phrase`).toBe(
        true,
      );
      expect(entree.fichier).toMatch(/\.test\.js$/);
      expect(entree.titre.length).toBeGreaterThan(10);
      // Aucune ligne « à faire » : un verrou annoncé mais absent n'est pas un verrou.
      const brut = `${entree.comportement} ${entree.fichier} ${entree.titre}`.toLowerCase();
      for (const mot of ["todo", "à faire", "a faire", "à compléter", "a completer"]) {
        expect(brut.includes(mot), `l'entrée ${entree.numero} annonce un travail non fait`).toBe(
          false,
        );
      }
    }
  });

  it("les numéros sont uniques et consécutifs depuis 1", () => {
    const numeros = ENTREES.map((e) => Number(e.numero));
    expect(new Set(numeros).size, "deux entrées portent le même numéro").toBe(numeros.length);
    // Un numéro manquant est nommé : « 1, 2, 4 » -> « le numéro 3 manque ».
    for (let attendu = 1; attendu <= numeros.length; attendu += 1) {
      expect(
        numeros[attendu - 1],
        `le numéro ${attendu} manque : le registre doit rester numéroté de 1 à N sans trou (${numeros.join(", ")})`,
      ).toBe(attendu);
    }
  });

  it("aucun couple fichier + titre n'est inscrit deux fois", () => {
    const cles = ENTREES.map((e) => `${e.fichier} :: ${e.titre}`);
    expect(new Set(cles).size, "une même ligne est recopiée").toBe(cles.length);
  });
});

describe("2. chaque ligne du registre a un test qui existe vraiment", () => {
  it("les fichiers cités existent, et chaque titre y est retrouvé mot pour mot", () => {
    for (const entree of ENTREES) {
      const trouve = sourceDuTest(entree.fichier);
      expect(trouve, `le fichier ${entree.fichier} est introuvable (entrée ${entree.numero})`).not.toBeNull();
      const { source, desechappe } = trouve;
      const present = source.includes(entree.titre) || desechappe.includes(entree.titre);
      expect(
        present,
        `le test « ${entree.titre} » n'existe plus dans ${entree.fichier} (entrée ${entree.numero}) : le registre n'est plus à jour`,
      ).toBe(true);
    }
  });

  it("le titre cité est celui d'un VRAI test, jamais d'un test sauté", () => {
    for (const entree of ENTREES) {
      const { source, desechappe } = sourceDuTest(entree.fichier);
      const texte = source.includes(entree.titre) ? source : desechappe;
      const index = texte.indexOf(entree.titre);
      expect(
        index,
        `le titre « ${entree.titre} » est introuvable dans ${entree.fichier} (entrée ${entree.numero})`,
      ).toBeGreaterThan(-1);
      const debut = texte.lastIndexOf("\n", index) + 1;
      // Ce qui PRÉCÈDE le titre : la ligne doit commencer par `it("` — ni
      // commentaire, ni `describe`, ni `it.skip`, ni `it.todo`.
      expect(
        texte.slice(debut, index).trim(),
        `« ${entree.titre} » n'est pas porté par un it(...) (entrée ${entree.numero})`,
      ).toBe('it("');
    }
  });

  it("le test cité n'est pas creux : il porte au moins une assertion avant le test suivant", () => {
    for (const entree of ENTREES) {
      const { source, desechappe } = sourceDuTest(entree.fichier);
      const texte = source.includes(entree.titre) ? source : desechappe;
      const index = texte.indexOf(entree.titre);
      const suite = texte.slice(index + entree.titre.length);
      const suivant = suite.search(/\n\s*(it|describe)\(/);
      const corps = suivant === -1 ? suite : suite.slice(0, suivant);
      // Les commentaires ne comptent pas : une assertion annoncée en commentaire
      // n'est pas une assertion. Un test creux ne verrouille rien.
      const corpsNetAttendu = corps
        .split("\n")
        .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
        .join("\n");
      expect(
        corpsNetAttendu.includes("expect("),
        `le test « ${entree.titre} » ne vérifie rien (aucune assertion) : il ne verrouille pas le comportement`,
      ).toBe(true);
    }
  });
});

describe("3. rien n'entre ni ne sort du registre en silence", () => {
  /** Fichiers de test qui se déclarent eux-mêmes entrée du registre. */
  function entreesDeclarees() {
    const declarees = [];
    const motif = /REGISTRE DES COMPORTEMENTS VALID[EÉ]S\s*—\s*ENTR[EÉ]E N°\s*(\d+)/g;
    for (const nom of FICHIERS_DE_TEST) {
      for (const m of lire(join(ICI, nom)).matchAll(motif)) {
        declarees.push({ numero: m[1], fichier: `src/js/${nom}` });
      }
    }
    return declarees;
  }

  it("tout fichier qui se déclare entrée du registre y figure, sous ce numéro", () => {
    const declarees = entreesDeclarees();
    expect(
      declarees.length,
      "aucun fichier ne se déclare entrée du registre : la bijection ne prouve plus rien",
    ).toBeGreaterThan(0);
    for (const declaree of declarees) {
      const entree = ENTREES.find((e) => e.numero === declaree.numero);
      expect(
        entree,
        `le fichier ${declaree.fichier} se déclare ENTRÉE N° ${declaree.numero}, absente du registre`,
      ).toBeDefined();
      expect(
        entree.fichier,
        `l'ENTRÉE N° ${declaree.numero} désigne ${entree.fichier}, pas ${declaree.fichier}`,
      ).toBe(declaree.fichier);
    }
  });

  it("un fichier = une entrée, et un numéro déclaré n'est jamais pris deux fois", () => {
    const declarees = entreesDeclarees();
    // Deux marques dans le même fichier : on ne sait plus laquelle est l'entrée.
    const parFichier = new Map();
    for (const d of declarees) {
      parFichier.set(d.fichier, (parFichier.get(d.fichier) || 0) + 1);
    }
    for (const [fichier, compte] of parFichier) {
      expect(compte, `${fichier} se déclare entrée du registre ${compte} fois`).toBe(1);
    }
    // Deux fichiers qui revendiquent le même numéro : une entrée au registre
    // ne peut pas désigner deux comportements à la fois.
    const parNumero = new Map();
    for (const d of declarees) {
      parNumero.set(d.numero, [...(parNumero.get(d.numero) || []), d.fichier]);
    }
    for (const [numero, fichiers] of parNumero) {
      expect(fichiers.length, `l'ENTRÉE N° ${numero} est revendiquée par ${fichiers.join(", ")}`).toBe(
        1,
      );
    }
  });

  it("le registre est annoncé dans AGENTS.md (il ne peut pas disparaître en silence)", () => {
    const agents = lire(join(RACINE, "AGENTS.md"));
    expect(
      agents.includes("spec_registre_comportements_valides.md"),
      "AGENTS.md ne cite plus le registre des comportements validés",
    ).toBe(true);
    expect(
      agents.includes("registre-comportements-valides.test.js"),
      "AGENTS.md ne cite plus le garde-fou du registre",
    ).toBe(true);
  });
});
