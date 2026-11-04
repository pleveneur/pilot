// VERROUS — PUBLICATION SANS macOS (décision du propriétaire du 2026-11-15 :
// « Contourne sans macOS »).
//
// Ce qui s'est passé, mesuré sur trois runs réels : la machine Apple n'a jamais
// été attribuée, GitHub a ANNULÉ le job de tests macOS au bout de ~15 min
// (15:23:15 → 15:38:17), et — comme `continue-on-error` couvre un ÉCHEC mais pas
// une ANNULATION — `create-release`, `build` et `latest-json` ont été SAUTÉS.
// Résultat : aucune release pour 0.6.16, 0.6.17 ni 0.6.18.
//
// Deux verrous, dans cet ordre :
//   1. une annulation macOS ne peut plus faire sauter la chaîne de publication
//      (et les tests macOS continuent de tourner : le contrôle n'est pas
//      supprimé, il est rendu non bloquant) ;
//   2. une livraison incomplète ne peut pas repartir SANS autorisation
//      explicite — le refus reste le comportement par défaut, l'autorisation est
//      bornée à macOS, et l'absence est ANNONCÉE (journal + corps de la release
//      + notes de latest.json).
//
// Preuve par mutation attendue (vérifiée, puis restaurée) :
//   - remettre `macos-latest` dans la matrice du job `test` fait échouer le
//     verrou 1 ;
//   - poser `ALLOW_INCOMPLETE_RELEASE: "1"` en dur dans le workflow, ou retirer
//     `allowIncompleteScope: MACOS_PLATFORMS` de `gen-latest-json.js`, fait
//     échouer le verrou 2.
//
// La lecture normalise les fins de ligne (worktree CRLF des runners Windows) :
// cf. `.pi/skills/quality-gate/SKILL.md` § 3.4.

import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

import {
  CRITICAL_PLATFORMS,
  MACOS_PLATFORMS,
  evaluateDelivery,
  evaluateMacosGap,
  macosMissingNotice,
} from "./release-gates.js";
import { platformFromBinaryName } from "./latest-json-platforms.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Lit un fichier en normalisant les fins de ligne (piège CRLF). */
function lire(rel) {
  return readFileSync(resolve(HERE, rel), "utf8").replace(/\r\n/g, "\n");
}

/** Le code sans les commentaires : la prose ne doit pas satisfaire un verrou. */
function sansCommentaires(src) {
  return src
    .split("\n")
    .map((l) => l.replace(/(^|\s)#.*$/, "$1"))
    .join("\n");
}

const WF = lire("../.github/workflows/release.yml");
const WF_CODE = sansCommentaires(WF);

/**
 * Bloc YAML d'un job : de «   <nom>: » jusqu'au prochain en-tête de job (ligne
 * à 2 espaces terminant par « : »). Retourne "" si le job n'existe pas.
 */
function jobBlock(name, source = WF) {
  const lines = source.split("\n");
  const start = lines.findIndex((l) => l === `  ${name}:`);
  if (start === -1) return "";
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}[a-z][a-z0-9-]*:\s*$/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join("\n");
}

/** Nom de tous les jobs du workflow, dans l'ordre du fichier. */
function jobNames(source = WF) {
  const lines = source.split("\n");
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (start === -1) return [];
  const names = [];
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^ {2}([a-z][a-z0-9-]*):\s*$/);
    if (m) names.push(m[1]);
  }
  return names;
}

// ───────────────────────────────────────────────────────────────────────────
// VERROU 1 — une annulation de machine Apple ne fait plus sauter la publication
// ───────────────────────────────────────────────────────────────────────────
describe("annulation macOS — traitée comme un échec toléré", () => {
  it("le job dont dépend create-release ne tourne sur aucune machine Apple", () => {
    const test = sansCommentaires(jobBlock("test"));
    expect(test, "le job `test` doit exister").not.toBe("");
    // Ni dans `runs-on`, ni dans la matrice : la seule façon qu'une annulation
    // macOS redevienne bloquante est de réintroduire la machine ici.
    expect(test).not.toMatch(/macos/i);
    // Verdict de tests favorable toujours exigé avant la Release.
    expect(jobBlock("create-release")).toContain("needs: [test]");
  });

  it("les tests macOS tournent toujours (le contrôle n'est pas supprimé)", () => {
    const macos = sansCommentaires(jobBlock("test-macos"));
    expect(macos, "le job `test-macos` doit exister").not.toBe("");
    expect(macos).toContain("runs-on: macos-latest");
    // Les DEUX suites, comme sur les autres machines.
    expect(macos).toContain("cargo test --manifest-path src-tauri/Cargo.toml --lib");
    expect(macos).toContain("npm test");
    expect(macos).toContain("npm run build:mcp");
    // Non bloquant : un échec macOS ne retient pas la publication.
    expect(macos).toMatch(/^ {4}continue-on-error: true$/m);
  });

  it("aucun job ne dépend de test-macos : une annulation ne saute personne", () => {
    const dependants = jobNames().filter((j) => {
      if (j === "test-macos") return false;
      const ligne = sansCommentaires(jobBlock(j)).match(/^ {4}needs: (.+)$/m);
      return ligne ? ligne[1].includes("test-macos") : false;
    });
    expect(dependants).toEqual([]);
  });

  it("les deux cibles macOS de la fabrication sont tolérées (échec ET annulation)", () => {
    const build = sansCommentaires(jobBlock("build"));
    expect(build).toMatch(/^ {4}continue-on-error: \$\{\{ matrix\.platform == 'macos-latest' \}\}$/m);
    // Les cibles macOS sont toujours fabriquées quand une machine est obtenue.
    expect(build.match(/platform: macos-latest/g) || []).toHaveLength(2);
    expect(build).toContain("aarch64-apple-darwin");
    expect(build).toContain("x86_64-apple-darwin");
  });

  it("latest-json tourne même si une cible de build a été annulée", () => {
    const latest = sansCommentaires(jobBlock("latest-json"));
    expect(latest).toMatch(/^ {4}if: always\(\)$/m);
    expect(latest).toMatch(/^ {4}needs: build$/m);
  });

  it("la fabrication et la Release restent suspendues au verdict de tests", () => {
    // Le correctif ne doit pas relâcher la garde inverse : create-release et
    // build attendent toujours `test`, et latest-json attend `build`.
    expect(jobBlock("create-release")).toContain("needs: [test]");
    expect(jobBlock("build")).toContain("needs: [create-release, test]");
    expect(sansCommentaires(jobBlock("latest-json"))).toMatch(/^ {4}needs: build$/m);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// VERROU 2 — une livraison incomplète ne repart jamais sans autorisation
// ───────────────────────────────────────────────────────────────────────────
describe("livraison sans macOS — autorisation explicite obligatoire", () => {
  /** Cibles présentes : Windows seul (le cas « macOS absent »). */
  const windowsOnly = () => ({
    "windows-x86_64": { signature: "s", url: "u" },
  });
  const all = () =>
    Object.fromEntries(CRITICAL_PLATFORMS.map((k) => [k, { signature: "s", url: "u" }]));

  it("sans autorisation, une livraison sans macOS est REFUSÉE (défaut intact)", () => {
    const v = evaluateDelivery({
      platforms: windowsOnly(),
      allowIncompleteScope: MACOS_PLATFORMS,
    });
    expect(v.ok).toBe(false);
    expect(v.accepted).toBe(false);
    expect(v.missing).toEqual([...MACOS_PLATFORMS]);
    expect(v.blocking).toEqual([...MACOS_PLATFORMS]);
  });

  it("avec l'autorisation explicite, l'absence de macOS passe et nomme sa portée", () => {
    const v = evaluateDelivery({
      platforms: windowsOnly(),
      allowIncomplete: true,
      allowIncompleteScope: MACOS_PLATFORMS,
    });
    expect(v.ok).toBe(true);
    expect(v.accepted).toBe(true);
    expect(v.reason).toContain("ALLOW_INCOMPLETE_RELEASE");
  });

  it("l'autorisation macOS ne couvre JAMAIS une autre plateforme manquante", () => {
    // Windows manquant + macOS manquant : la livraison est cassée, pas
    // « sans macOS ». Le drapeau posé ne doit rien couvrir ici.
    const v = evaluateDelivery({
      platforms: {},
      allowIncomplete: true,
      allowIncompleteScope: MACOS_PLATFORMS,
    });
    expect(v.ok).toBe(false);
    expect(v.blocking).toContain("windows-x86_64");
    expect(v.reason).toContain("windows-x86_64");
    // Et une cible macOS PRÉSENTE ne déclenche évidemment rien.
    expect(evaluateDelivery({ platforms: all(), allowIncompleteScope: MACOS_PLATFORMS }).ok).toBe(true);
  });

  it("l'autorisation du workflow n'est jamais posée en dur", () => {
    const valeurs = [...WF_CODE.matchAll(/^\s+ALLOW_INCOMPLETE_RELEASE: (.+)$/gm)].map((m) =>
      m[1].trim()
    );
    // Deux endroits : la génération et la seconde passe Linux.
    expect(valeurs.length).toBeGreaterThanOrEqual(2);
    for (const v of valeurs) {
      // Une valeur dérivée d'une sortie d'étape/de job, jamais un littéral :
      // « 1 » en dur serait exactement la tolérance muette interdite.
      expect(v, `autorisation en dur : ${v}`).toMatch(/^\$\{\{/);
      expect(v).toMatch(/allow_incomplete/);
    }
    // La décision vient d'une seule étape, dont la règle est PURE et testée.
    expect(WF_CODE).toContain("scripts/detect-macos-gap.js");
    expect(WF_CODE).toContain("steps.macos.outputs.allow_incomplete");
    // Le refus par défaut reste dans le script, pas dans un `env` du workflow.
    expect(WF).not.toMatch(/ALLOW_INCOMPLETE_RELEASE:\s*["']?(1|true|oui|yes)["']?\s*$/m);
  });

  it("gen-latest-json.js lit l'autorisation et la borne à macOS", () => {
    const code = sansCommentaires(lire("./gen-latest-json.js"));
    expect(code).toContain("allowIncomplete: flagEnabled(process.env[ALLOW_INCOMPLETE_ENV])");
    expect(code).toContain("allowIncompleteScope: MACOS_PLATFORMS");
    // Un refus interrompt toujours AVANT l'écriture de latest.json ET avant de
    // réécrire le corps de la release.
    const iRefus = code.indexOf("if (!delivery.ok) refuse(");
    const iEcriture = code.indexOf("fs.writeFileSync(OUT");
    const iPatch = code.indexOf("await patchReleaseBody(releaseId, releaseBody)");
    expect(iRefus).toBeGreaterThan(-1);
    expect(iEcriture).toBeGreaterThan(iRefus);
    expect(iPatch).toBeGreaterThan(iRefus);
  });

  it("l'étape d'autorisation n'accorde rien quand rien n'est livré", () => {
    const mapper = platformFromBinaryName;
    // Aucun artefact d'updater : livraison cassée, jamais « macOS absent ».
    expect(evaluateMacosGap({ assetNames: [], mapper }).allowIncomplete).toBe(false);
    expect(evaluateMacosGap({ assetNames: ["readme.txt"], mapper }).allowIncomplete).toBe(false);
    // Windows seul (NSIS signé) : là, et là seulement, l'autorisation est donnée.
    expect(
      evaluateMacosGap({
        assetNames: ["Pilot_1.0.0_x64-setup.exe", "Pilot_1.0.0_x64-setup.exe.sig"],
        mapper,
      }).allowIncomplete
    ).toBe(true);
    // macOS présent (même une seule des deux cibles) : rien à autoriser.
    expect(
      evaluateMacosGap({
        assetNames: ["Pilot_1.0.0_aarch64.app.tar.gz", "Pilot_1.0.0_aarch64.app.tar.gz.sig"],
        mapper,
      }).allowIncomplete
    ).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// VERROU 3 — l'absence est VISIBLE, et aucune cible macOS n'est annoncée à tort
// ───────────────────────────────────────────────────────────────────────────
describe("absence de macOS — annoncée, jamais inventée", () => {
  it("la phrase française n'existe que si macOS manque réellement", () => {
    expect(macosMissingNotice([])).toBeNull();
    // macOS servi (seul Windows, ou Windows + Linux, manquent) : aucune phrase.
    expect(macosMissingNotice(["windows-x86_64"])).toBeNull();
    expect(macosMissingNotice(["windows-x86_64", "linux-x86_64"])).toBeNull();
    const texte = macosMissingNotice([...MACOS_PLATFORMS]);
    expect(texte).toContain("macOS n'est pas servi cette fois");
    expect(texte).toContain("resteront sur leur version actuelle");
    // Une seule des deux cibles manquante : la phrase est quand même écrite.
    expect(macosMissingNotice(["darwin-x86_64"])).toContain("macOS n'est pas servi");
  });

  it("la phrase est écrite dans le corps de la release ET dans les notes", () => {
    const code = sansCommentaires(lire("./gen-latest-json.js"));
    expect(code).toContain("macosMissingNotice(delivery.missing)");
    expect(code).toContain("const notes = releaseBody.trim()");
    expect(code).toContain("await patchReleaseBody(releaseId, releaseBody)");
    // Le workflow, lui, ne compose aucune phrase : une seule source de texte.
    expect(WF_CODE).not.toContain("macOS n'est pas servi");
  });

  it("latest.json n'annonce aucune cible macOS sans artefact", () => {
    const code = sansCommentaires(lire("./gen-latest-json.js"));
    // Les clés de `platforms` ne viennent QUE du scan des fichiers réellement
    // déposés et d'une signature non vide.
    expect(code).toContain("platforms[key] = { signature, url: binAsset.browser_download_url }");
    expect(code).not.toMatch(/darwin-[a-z0-9_]+\s*[:,]\s*\{/);
    expect(code).not.toMatch(/platforms\["darwin/);
  });
});
