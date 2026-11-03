// Verrous du lot B — DECISIONS DE PUBLICATION (trous C7.2, C7.4 et C7.5 de
// docs/rapports/RAPPORT-voies-de-contournement-livraison.md).
//
// Ce fichier couvre deux choses, et refuse de les melanger :
//   1. la DECISION, pure (`scripts/release-gates.js`) — testee directement, sans
//      reseau, sans fichier, sans variables d'environnement ;
//   2. le CABLAGE, dans le code des scripts — une decision qui existe mais que
//      personne n'appelle ne ferme aucun trou. Le cablage est verifie sur la
//      SOURCE (commentaires retires), pour qu'aucun retour silencieux ne
//      reapparaisse.
//
// Preuve par mutation attendue : retirer l'appel a `evaluateDelivery` de
// `gen-latest-json.js`, ou remettre le repli `|| "Pilot " + VERSION`, fait
// echouer les tests de cablage — et seulement eux.
//
// La lecture normalise les fins de ligne (worktree CRLF) :
// cf. `.pi/skills/quality-gate/SKILL.md` § 3.4.

import { existsSync, readFileSync, readdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

import {
  ALLOW_EXISTING_RELEASE_ENV,
  ALLOW_INCOMPLETE_ENV,
  ALLOW_MISSING_NOTES_ENV,
  CRITICAL_PLATFORMS,
  EXIT_RELEASE_REFUSED,
  OPTIONAL_PLATFORMS,
  evaluateDelivery,
  evaluateExistingRelease,
  evaluateReleaseNotes,
  flagEnabled,
  hasReadableNotes,
  notesPathForTag,
} from "./release-gates.js";
const HERE = dirname(fileURLToPath(import.meta.url));

/** Lit une source en normalisant les fins de ligne (piege CRLF). */
function lire(rel) {
  return readFileSync(resolve(HERE, rel), "utf8").replace(/\r\n/g, "\n");
}

/**
 * Retire les commentaires pour ne juger que le CODE : les commentaires
 * racontent justement les gardes supprimees, ils ne doivent pas compter.
 */
function sansCommentaires(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");
}

// ── 1. Le changelog est obligatoire (trou C7.2) ─────────────────────────────
describe("changelog obligatoire", () => {
  it("un titre seul n'est pas un changelog lisible", () => {
    expect(hasReadableNotes("")).toBe(false);
    expect(hasReadableNotes("   \n\n")).toBe(false);
    expect(hasReadableNotes("# Pilot v1.2.3")).toBe(false);
    expect(hasReadableNotes("# Pilot v1.2.3\n## Corrections")).toBe(false);
    expect(hasReadableNotes("---")).toBe(false);
  });

  it("une ligne de contenu suffit", () => {
    expect(hasReadableNotes("## Corrections\n- le bouton repond")).toBe(true);
    expect(hasReadableNotes("Corrections diverses.")).toBe(true);
  });

  it("sans note lisible, la publication est REFUSEE et dit ou ecrire", () => {
    const v = evaluateReleaseNotes({ tag: "v1.2.3" });
    expect(v.ok).toBe(false);
    expect(v.accepted).toBe(false);
    // Le refus nomme le fichier attendu : un refus muet serait une panne.
    // Le nom est celui de la CONVENTION REELLE du depot — `release-notes/vX.Y.Z.md`,
    // avec le `v`, comme tous les fichiers de `release-notes/` — et non le chemin
    // sans `v` que la garde reclame a tort depuis l'incident de publication 0.6.12.
    expect(v.reason).toContain("release-notes/v1.2.3.md");
    expect(v.reason).toContain("OBLIGATOIRE");
  });

  it("le refus nomme EXACTEMENT le fichier attendu, jamais un chemin voisin", () => {
    // Un refus qui nommerait un fichier different de celui que la porte lit
    // enverrait l'utilisateur ecrire un changelog... que la porte ignorerait.
    for (const tag of ["v1.2.3", "1.2.3", "V1.2.3", " v1.2.3 "]) {
      const v = evaluateReleaseNotes({ tag });
      expect(v.ok).toBe(false);
      expect(v.reason).toContain(notesPathForTag(tag));
      expect(v.reason).toContain("release-notes/v1.2.3.md");
    }
    // Et l'inverse : le chemin SANS `v` n'est jamais reclame (c'etait le defaut).
    expect(evaluateReleaseNotes({ tag: "v1.2.3" }).reason).not.toContain("release-notes/1.2.3.md");
  });

  it("une note lisible laisse passer", () => {
    const v = evaluateReleaseNotes({ tag: "v1.2.3", notes: "- une correction" });
    expect(v.ok).toBe(true);
    expect(v.accepted).toBe(false);
  });

  it("l'acceptation explicite est possible mais TRACEE", () => {
    const v = evaluateReleaseNotes({ tag: "v1.2.3", allowMissing: true });
    expect(v.ok).toBe(true);
    expect(v.accepted).toBe(true);
    // Une acceptation sans trace serait un contournement silencieux.
    expect(v.reason).toContain(ALLOW_MISSING_NOTES_ENV);
  });
});

// ── 1 bis. Le chemin de la porte EST celui des fichiers reellement committes ──
describe("chemin du changelog = convention du depot", () => {
  it("chaque changelog de release-notes/ est atteint par la porte", () => {
    // Verite du depot, pas d'une chaine inventee : pour chaque fichier
    // `vX.Y.Z.md` present, la porte doit designer CE fichier. Avec l'ancien
    // calcul (version sans `v`), aucun de ces fichiers n'etait trouve : la
    // garde refusait toutes les publications.
    const dossier = resolve(HERE, "../release-notes");
    const fichiers = readdirSync(dossier).filter((f) => /^v\d+\.\d+\.\d+\.md$/.test(f));
    expect(fichiers.length).toBeGreaterThan(0);
    for (const f of fichiers) {
      const tag = f.replace(/\.md$/, "");
      const chemin = notesPathForTag(tag);
      expect(existsSync(resolve(HERE, "..", chemin)), `${tag} -> ${chemin} introuvable`).toBe(true);
    }
  });
});

// ── 2. Livraison incomplete = echec explicite (trou C7.4) ───────────────────
describe("livraison incomplete", () => {
  /** Un jeu de plateformes complet sur le chemin critique. */
  const complete = () =>
    Object.fromEntries(CRITICAL_PLATFORMS.map((k) => [k, { signature: "s", url: "u" }]));

  it("toutes les cibles critiques presentes : la publication passe", () => {
    const v = evaluateDelivery({ platforms: complete() });
    expect(v.ok).toBe(true);
    expect(v.missing).toEqual([]);
  });

  it("une cible critique manquante BLOQUE (ce n'est plus un avertissement)", () => {
    const platforms = complete();
    delete platforms["darwin-x86_64"];
    const v = evaluateDelivery({ platforms });
    expect(v.ok).toBe(false);
    expect(v.missing).toContain("darwin-x86_64");
    // La cible est nommee : l'exploitant sait laquelle relancer.
    expect(v.reason).toContain("darwin-x86_64");
  });

  it("plusieurs cibles manquantes sont toutes nommees", () => {
    const v = evaluateDelivery({ platforms: {} });
    expect(v.ok).toBe(false);
    for (const k of CRITICAL_PLATFORMS) expect(v.missing).toContain(k);
  });

  it("Linux n'est PAS exige : sa fabrication est un job separe et optionnel", () => {
    const v = evaluateDelivery({ platforms: complete() });
    expect(v.ok).toBe(true);
    for (const k of OPTIONAL_PLATFORMS) expect(CRITICAL_PLATFORMS).not.toContain(k);
    // Exiger Linux ferait echouer TOUTES les publications (elle n'a pas fini
    // quand latest-json demarre) : c'est la topologie de release.yml, verrouillee
    // par scripts/release-workflow.test.js.
    expect(CRITICAL_PLATFORMS.length).toBeLessThan(
      CRITICAL_PLATFORMS.length + OPTIONAL_PLATFORMS.length
    );
  });

  it("l'acceptation explicite d'une livraison incomplete est TRACEE", () => {
    const v = evaluateDelivery({ platforms: {}, allowIncomplete: true });
    expect(v.ok).toBe(true);
    expect(v.accepted).toBe(true);
    expect(v.reason).toContain(ALLOW_INCOMPLETE_ENV);
  });
});

// ── 3. Republier un tag existant = refus net (trou C7.5) ────────────────────
describe("tag deja publie", () => {
  it("un tag libre laisse creer la Release", () => {
    const v = evaluateExistingRelease({ tag: "v1.2.3", already: false });
    expect(v.ok).toBe(true);
    expect(v.refused).toBe(false);
  });

  it("un tag deja publie est REFUSE, avec la sortie de secours nommee", () => {
    const v = evaluateExistingRelease({ tag: "v1.2.3", already: true });
    expect(v.ok).toBe(false);
    expect(v.refused).toBe(true);
    expect(v.reason).toContain("v1.2.3");
    expect(v.reason).toContain(ALLOW_EXISTING_RELEASE_ENV);
  });

  it("un re-run volontaire passe, mais laisse une trace", () => {
    const v = evaluateExistingRelease({ tag: "v1.2.3", already: true, allowExisting: true });
    expect(v.ok).toBe(true);
    expect(v.refused).toBe(false);
    expect(v.accepted).toBe(true);
    expect(v.reason).toContain(ALLOW_EXISTING_RELEASE_ENV);
  });

  it("le code de sortie d'un refus est distinct d'une panne", () => {
    expect(EXIT_RELEASE_REFUSED).not.toBe(0);
    expect(EXIT_RELEASE_REFUSED).not.toBe(1);
  });

  it("les drapeaux d'acceptation sont lus de facon tolerante", () => {
    for (const v of ["1", "true", "oui", " yes ", "TRUE"]) expect(flagEnabled(v)).toBe(true);
    for (const v of ["", undefined, null, "0", "non"]) expect(flagEnabled(v)).toBe(false);
  });
});

// ── 4. Le cablage : une decision non appelee ne ferme rien ──────────────────
describe("cablage des decisions dans les scripts", () => {
  it("create-release.js passe par la porte, et ne dit plus « rien a creer »", () => {
    const code = sansCommentaires(lire("./create-release.js"));
    expect(code).toContain("evaluateExistingRelease(");
    expect(code).toContain("EXIT_RELEASE_REFUSED");
    // Le retour silencieux d'origine : plus une seule instruction ne le fait.
    expect(code).not.toContain("rien à créer");
    // Les trois chemins (GET 200, POST 422, GET 404) passent la porte.
    expect(code.match(/applyExistingRelease\(\{ already:/g) || []).toHaveLength(3);
  });

  it("create-release.js refuse AVANT que la Release existe, si le changelog manque", () => {
    const code = sansCommentaires(lire("./create-release.js"));
    expect(code).toContain("evaluateReleaseNotes(");
    // La porte du changelog precede l'appel reseau qui cree la Release.
    const iNotes = code.indexOf("if (!notesDecision.ok) refuse(");
    const iCreation = code.indexOf("method: \"POST\"");
    expect(iNotes).toBeGreaterThan(-1);
    expect(iCreation).toBeGreaterThan(iNotes);
  });

  it("le chemin du changelog n'est ecrit qu'a un seul endroit", () => {
    // Deux scripts lisent le meme fichier : le chemin est partage, pas recopie.
    for (const f of ["./create-release.js", "./gen-latest-json.js"]) {
      const code = sansCommentaires(lire(f));
      expect(code, f).toContain("notesPathForTag");
      expect(code, `${f} recopie le chemin`).not.toMatch(/`release-notes\/\$\{/);
    }
    // Convention REELLE du depot : `release-notes/vX.Y.Z.md` (cf. AGENTS.md et
    // tous les fichiers deja committes). L'assertion precedente figeait le
    // contraire (`release-notes/1.2.3.md`) et rendait la garde infalsifiablement
    // rouge : elle refusait des versions dont le changelog existait.
    expect(notesPathForTag("v1.2.3")).toBe("release-notes/v1.2.3.md");
    // Un tag sans `v` designe le MEME fichier : le `v` est ajoute, jamais double.
    expect(notesPathForTag("1.2.3")).toBe("release-notes/v1.2.3.md");
    expect(notesPathForTag("V1.2.3")).toBe("release-notes/v1.2.3.md");
    expect(notesPathForTag("v1.2.3")).not.toContain("vv");
  });

  it("gen-latest-json.js passe les portes changelog ET livraison", () => {
    const code = sansCommentaires(lire("./gen-latest-json.js"));
    expect(code).toContain("evaluateReleaseNotes(");
    expect(code).toContain("evaluateDelivery(");
    expect(code).toContain("CRITICAL_PLATFORMS");
    // Plus de repli silencieux : la porte 1 a deja exige un changelog lisible.
    expect(code).not.toMatch(/\|\|\s*`Pilot \$\{VERSION\}`/);
    // Un refus doit interrompre AVANT l'ecriture de latest.json.
    const iRefus = code.indexOf("if (!delivery.ok) refuse(");
    const iEcriture = code.indexOf("fs.writeFileSync(OUT");
    expect(iRefus).toBeGreaterThan(-1);
    expect(iEcriture).toBeGreaterThan(iRefus);
  });

  it("les decisions ne sont pas dupliquees dans le workflow", () => {
    // Une seule source de verite : le workflow appelle les scripts, il ne
    // reimplemente ni la liste des cibles ni la regle du changelog.
    const wf = lire("../.github/workflows/release.yml");
    expect(wf).toContain("scripts/create-release.js");
    expect(wf).toContain("scripts/gen-latest-json.js");
    expect(wf).not.toContain("darwin-aarch64");
  });
});
