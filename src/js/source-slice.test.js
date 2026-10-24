// Tests — découpage de source VÉRIFIÉ (`source-slice.js`) : 3ᵉ audit, point 4.
//
// Deux verrous :
//   1. le garde-fou de découpage lui-même (`sliceSource`) : ancre absente, ancre
//      de fin avant le début, fragment trop court → ÉCHEC (et non un fragment
//      vide qui rendrait une assertion négative vraie par construction) ;
//   2. l'INVENTAIRE : aucun fichier de test JS ne peut ajouter un découpage de
//      source non protégé (détecteur PUR `findUnprotectedSourceSlices`), et les
//      deux fichiers réparés par ce correctif doivent rester à zéro.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  sliceSource,
  sliceFrom,
  findUnprotectedSourceSlices,
  SourceSliceError,
} from "./source-slice.js";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, "../..");

// ── 1. Le garde-fou de découpage, testé POUR LUI-MÊME ────────────────────────
describe("sliceSource — un découpage faux ÉCHOUE au lieu de passer pour rien", () => {
  const SOURCE = "avant\nAAAA\ncontenu utile\nBBBB\nafter\n";

  it("découpe correctement entre deux ancres présentes", () => {
    expect(sliceSource(SOURCE, "AAAA", "BBBB")).toContain("contenu utile");
    expect(sliceSource(SOURCE, "AAAA", "BBBB")).not.toContain("after");
  });

  it("ÉCHOUE si l'ancre de début est absente (le défaut d'origine)", () => {
    // Avant : `src.slice(src.indexOf("absente"))` → "" et
    // `expect("").not.toContain(…)` était vrai par construction.
    expect(() => sliceSource(SOURCE, "ANCRE-QUI-N-EXISTE-PAS", "BBBB")).toThrow(
      SourceSliceError,
    );
    expect(() => sliceSource(SOURCE, "ANCRE-QUI-N-EXISTE-PAS", "BBBB")).toThrow(
      /ancre de début absente/,
    );
  });

  it("ÉCHOUE si l'ancre de fin est absente", () => {
    expect(() => sliceSource(SOURCE, "AAAA", "FIN-QUI-N-EXISTE-PAS")).toThrow(
      /ancre de fin absente/,
    );
  });

  it("ÉCHOUE si l'ancre de fin est placée AVANT le début", () => {
    // « avant » précède « AAAA » et n'apparaît plus ensuite : la borne est
    // incohérente, le fragment serait vide ou négatif.
    expect(() => sliceSource(SOURCE, "AAAA", "avant")).toThrow(
      /avant le début du fragment/,
    );
  });

  it("ÉCHOUE si le fragment est trop court", () => {
    expect(() => sliceSource(SOURCE, "AAAA", "BBBB", 500)).toThrow(/fragment trop court/);
    // La taille minimale est bien celle demandée, pas une constante ignorée.
    expect(sliceSource(SOURCE, "AAAA", "BBBB", 10).length).toBeGreaterThanOrEqual(10);
  });

  it("ÉCHOUE sur une source illisible ou une ancre vide", () => {
    expect(() => sliceSource(undefined, "AAAA")).toThrow(/source illisible/);
    expect(() => sliceSource(SOURCE, "")).toThrow(/ancre de début absente/);
  });

  it("sliceFrom exige aussi le début (jusqu'à la fin de la source)", () => {
    expect(sliceFrom(SOURCE, "contenu").startsWith("contenu")).toBe(true);
    expect(() => sliceFrom(SOURCE, "ANCRE-QUI-N-EXISTE-PAS")).toThrow(SourceSliceError);
  });

  it("la source est lue telle quelle (aucune normalisation surprise)", () => {
    expect(sliceSource(SOURCE, "\nAAAA\n", "\nBBBB")).toBe("\nAAAA\ncontenu utile");
  });
});

// ── 2. Le détecteur de découpage NON PROTÉGÉ ─────────────────────────────────
describe("findUnprotectedSourceSlices — détecte le motif exact du défaut", () => {
  it("détecte le code d'origine de read-aloud.test.js (cas de l'audit)", () => {
    // Reproduit tel quel : borne calculée en ligne par `indexOf`, non vérifiée,
    // avec une assertion NÉGATIVE derrière (vraie par construction).
    const avant = [
      "      const userFactory = src.slice(",
      '        file.includes("agent-pi") ? src.indexOf("appendDelegatedMessage(") : src.indexOf("appendMessage("),',
      "      );",
      "      if (userFactory.length) {",
      '        expect(userFactory.slice(0, userFactory.indexOf("\\n}\\n"))).not.toContain("attachReadAloud(");',
      "      }",
    ].join("\n");
    const sites = findUnprotectedSourceSlices(avant);
    expect(sites.length).toBeGreaterThanOrEqual(2);
    expect(sites.some((s) => /userFactory/.test(s.text))).toBe(true);
  });

  it("détecte une borne calculée en ligne, en début comme en fin", () => {
    const avant = [
      'const body = SOURCE.slice(SOURCE.indexOf("a"));',
      'const fin = SOURCE.slice(debut, SOURCE.indexOf("b", debut));',
    ].join("\n");
    expect(findUnprotectedSourceSlices(avant)).toHaveLength(2);
  });

  it("ne compte PAS un échantillon de code fautif écrit dans une chaîne ni un commentaire", () => {
    // Sinon l'inventaire s'auto-dénoncerait : ce fichier contient des extraits.
    const leurre = [
      'const echantillon = "src.slice(src.indexOf(0))";',
      '// avant : src.slice(src.indexOf("a")) → fragment vide',
      '/* x.slice(x.indexOf("a")) */',
    ].join("\n");
    expect(findUnprotectedSourceSlices(leurre)).toHaveLength(0);
  });

  it("ne signale PAS un découpage protégé par sliceSource, ni un découpage de texte", () => {
    const sain = [
      'const corps = sliceSource(src, "debut", "fin", 100);',
      "const quatre = nom.slice(0, 4);",
      "const reste = tableau.slice(1);",
      'const index = nom.indexOf("x");',
    ].join("\n");
    expect(findUnprotectedSourceSlices(sain)).toHaveLength(0);
  });
});

// ── 3. INVENTAIRE : aucun nouveau découpage non protégé dans les tests JS ───
// Relevé des sites HISTORIQUES (antérieurs au 3ᵉ audit) : ils sont GELÉS, pas
// excusés. Tout site NOUVEAU est refusé, et tout fichier absent de ce tableau
// doit être à zéro. Les deux fichiers réparés par ce correctif
// (`read-aloud.test.js`, `relances-relecture.test.js`) n'y figurent PAS : ils
// sont tenus à zéro par l'assertion explicite ci-dessous.
const INVENTAIRE_HISTORIQUE = {
  "scripts/release-workflow.test.js": 1,
  "src/js/agent-hardening.test.js": 1,
  "src/js/agent-scroll.test.js": 1,
  "src/js/agents-ui-travail-arriere-plan.test.js": 1,
  "src/js/contraste-evenements-sombre.test.js": 1,
  "src/js/demarrage-verification-pi.test.js": 1,
  "src/js/file-attente-arret-conserve.test.js": 1,
  "src/js/file-attente-fenetre-rejeu.test.js": 1,
  "src/js/file-attente-retrait-mission.test.js": 1,
  "src/js/garde-fou-refus-lecture-seule.test.js": 1,
  "src/js/panneau-suivi-trois-onglets.test.js": 8,
  "src/js/pi-update-startup.test.js": 1,
  "src/js/planificateur-plan-complet.test.js": 1,
  "src/js/reglage-voix-onglet-assistant.test.js": 2,
  "src/js/super-agent-badges-nom-projet.test.js": 1,
  "src/js/super-agent-schedule.test.js": 1,
  "src/js/taille-et-style-panneau.test.js": 1,
  "src/js/telegram-dialog.test.js": 1,
  "src/js/travail-visible.test.js": 1,
  "src/js/update-window-bus.test.js": 2,
  "src/js/updater-attente-qui-bloque.test.js": 2,
  "src/js/updater-attente-terrain.test.js": 1,
  "src/js/verrou-par-projet.test.js": 4,
  "src/js/voix-locale-choix.test.js": 1,
};

function fichiersDeTest(dossier, sortie = []) {
  for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
    const p = path.join(dossier, e.name);
    if (e.isDirectory()) {
      if (["node_modules", "target", "dist", ".git", ".pilot", "release-notes"].includes(e.name)) {
        continue;
      }
      fichiersDeTest(p, sortie);
    } else if (e.name.endsWith(".test.js")) {
      sortie.push(p);
    }
  }
  return sortie;
}

describe("inventaire — aucun découpage de source NON PROTÉGÉ ajouté dans les tests JS", () => {
  const fichiers = [
    ...fichiersDeTest(path.join(RACINE, "src")),
    ...fichiersDeTest(path.join(RACINE, "scripts")),
    ...fichiersDeTest(path.join(RACINE, "web")),
  ].map((f) => path.relative(RACINE, f).split(path.sep).join("/"));

  it("le balayage voit bien les fichiers de test (inventaire non vide)", () => {
    expect(fichiers.length).toBeGreaterThan(100);
    expect(fichiers).toContain("src/js/relances-relecture.test.js");
    expect(fichiers).toContain("src/js/read-aloud.test.js");
  });

  it("aucun fichier ne dépasse son relevé historique, et aucun nouveau site n'apparaît", () => {
    const trop = [];
    for (const rel of fichiers) {
      const source = fs.readFileSync(path.join(RACINE, rel), "utf8");
      const sites = findUnprotectedSourceSlices(source);
      const plafond = INVENTAIRE_HISTORIQUE[rel] ?? 0;
      if (sites.length > plafond) {
        trop.push(
          `${rel} : ${sites.length} découpage(s) non protégé(s) (plafond ${plafond}) → ` +
            sites.map((s) => `l.${s.line} « ${s.text.slice(0, 70)} »`).join(" ; "),
        );
      }
    }
    expect(trop, trop.join("\n")).toEqual([]);
  });

  it("les fichiers réparés par ce correctif sont à ZÉRO découpage non protégé", () => {
    for (const rel of ["src/js/read-aloud.test.js", "src/js/relances-relecture.test.js"]) {
      expect(INVENTAIRE_HISTORIQUE[rel], `${rel} ne doit pas être réintroduit dans le relevé`).toBe(
        undefined,
      );
      const sites = findUnprotectedSourceSlices(
        fs.readFileSync(path.join(RACINE, rel), "utf8"),
      );
      expect(sites, `${rel} : ${JSON.stringify(sites)}`).toEqual([]);
    }
  });

  it("le relevé historique n'est jamais périmé (pas de site fantôme)", () => {
    // Garde inverse : un fichier du relevé qui n'existe plus (renommé) doit être
    // retiré du tableau — sinon le plafond resterait inscrit pour rien.
    const fantomes = Object.keys(INVENTAIRE_HISTORIQUE).filter((rel) => !fichiers.includes(rel));
    expect(fantomes, `fichiers du relevé introuvables : ${fantomes.join(", ")}`).toEqual([]);
  });
});
