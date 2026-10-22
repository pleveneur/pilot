// Contrat de la chaine d'integration (`.github/workflows/release.yml`).
//
// Objectif de ces gardes : une publication doit rester RAPIDE et ne jamais
// etre bloquee par la cible Linux. Concretement, la fabrication Linux (job
// `build-linux`) ne doit JAMAIS retenir `latest-json` — le job qui compose le
// fichier de mise a jour de TOUS les utilisateurs.
//
// Ces tests figent les decisions prises pour la tache « publication rapide » :
//   - Linux hors de la matrice `build` (donc hors du chemin critique) ;
//   - `latest-json` ne depend QUE de `build` ;
//   - le plafond Linux depasse sa duree reelle (sinon il est annule avant
//     d'enregistrer son cache : boucle infernale des compilations a froid) ;
//   - Linux ne compile qu'UNE fois (tauri-action compile deja) ;
//   - les paquets npm sont mis en cache au lieu d'etre retelécharges partout ;
//   - le budget de cache du depot (10 Go) reste tenu.
//
// La lecture normalise les fins de ligne (worktree CRLF des runners Windows) :
// cf. `.pi/skills/quality-gate/SKILL.md` § 3.4.

import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKFLOW = resolve(HERE, "../.github/workflows/release.yml");

const SRC = readFileSync(WORKFLOW, "utf8").replace(/\r\n/g, "\n");

/**
 * Bloc YAML d'un job : de «   <nom>: » jusqu'au prochain en-tete de job
 * (ligne a 2 espaces terminant par « : »). Retourne "" si le job n'existe pas.
 */
function jobBlock(name) {
  const lines = SRC.split("\n");
  const start = lines.findIndex((l) => l === `  ${name}:`);
  if (start === -1) return "";
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}[a-z][a-z0-9-]*:\s*$/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join("\n");
}

/** Valeur de la ligne `needs:` au niveau du job (indent 4), ou null. */
function jobNeeds(block) {
  const m = block.match(/^ {4}needs: (.+)$/m);
  return m ? m[1].trim() : null;
}

describe("release.yml — chemin critique", () => {
  it("la cible Linux a son propre job, hors de la matrice build", () => {
    const build = jobBlock("build");
    expect(build).not.toBe("");
    // Aucune entree Linux dans la matrice : c'est ce qui la sort du chemin
    // critique de latest-json.
    expect(build).not.toMatch(/platform: ubuntu/);
    expect(build).not.toMatch(/unknown-linux-gnu/);

    const linux = jobBlock("build-linux");
    expect(linux).not.toBe("");
    // La plateforme n'est pas supprimee pour autant : elle est toujours
    // fabriquee, simplement ailleurs.
    expect(linux).toContain("runs-on: ubuntu-22.04");
    expect(linux).toContain("x86_64-unknown-linux-gnu");
    expect(linux).toContain("LAYA_TARGET_PLATFORM: linux/x64");
  });

  it("latest-json ne depend que de build (jamais de la fabrication Linux)", () => {
    const latest = jobBlock("latest-json");
    expect(latest).not.toBe("");
    expect(jobNeeds(latest)).toBe("build");
    // La seconde passe Linux tourne APRES latest-json : elle ne peut donc pas
    // le retarder.
    const refresh = jobBlock("latest-json-linux");
    expect(refresh).not.toBe("");
    expect(jobNeeds(refresh)).toContain("latest-json");
    expect(refresh).not.toContain("needs: build-linux");
  });

  it("une fabrication Linux cassee ne fait pas echouer la publication", () => {
    expect(jobBlock("build-linux")).toContain("continue-on-error: true");
    // Et elle ne peut pas retenir `build` non plus.
    expect(jobNeeds(jobBlock("build"))).not.toContain("build-linux");
  });

  it("le plafond de la branche Linux depasse sa duree reelle", () => {
    const m = jobBlock("build-linux").match(/^ {4}timeout-minutes: (\d+)$/m);
    expect(m).not.toBeNull();
    const minutes = Number(m[1]);
    // 45 min annulaient la branche en pleine compilation (donc sans cache
    // enregistre). La valeur doit laisser la place de finir a froid.
    expect(minutes).toBeGreaterThan(45);
    expect(minutes).toBeLessThanOrEqual(180);
  });

  it("la plateforme Linux ne compile qu'une fois", () => {
    const linux = jobBlock("build-linux");
    // Seules les lignes de commande comptent : les commentaires racontent
    // justement l'etape supprimee.
    const commands = linux
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");
    // tauri-action compile lui-meme (avec `tauri/custom-protocol`) : aucune
    // etape de compilation manuelle ne doit subsister a cote.
    expect(commands).not.toMatch(/cargo build/);
    expect(commands).not.toContain("--features tauri/custom-protocol");
    expect(linux).toContain("tauri-apps/tauri-action@v0");
  });
});

describe("release.yml — cache et bibliotheque externe", () => {
  it("les paquets npm sont mis en cache (un seul cache par systeme)", () => {
    for (const job of ["test", "build", "build-linux"]) {
      const block = jobBlock(job);
      expect(block, `job ${job}`).toContain("actions/cache@v4");
      expect(block, `job ${job}`).toContain("hashFiles('package-lock.json')");
      expect(block, `job ${job}`).toContain("path: ~/.npm");
      // `npm ci` se sert du cache restaure (repli reseau automatique).
      expect(block, `job ${job}`).toMatch(/npm ci( --omit=dev)? --prefer-offline/);
    }
  });

  it("le service Laya n'est recopie qu'une fois par job", () => {
    // La copie (~114 Mo) est faite par `beforeBuildCommand`, que tauri-action
    // execute : aucune etape explicite ne doit la refaire.
    expect(SRC).not.toContain("run: npm run prepare:laya");

    const conf = JSON.parse(
      readFileSync(resolve(HERE, "../src-tauri/tauri.conf.json"), "utf8")
    );
    expect(conf.build.beforeBuildCommand).toContain("prepare:laya");
    expect(conf.build.beforeBuildCommand).toContain("build:mcp");
    // Le front doit toujours etre construit par tauri-action (la compilation
    // manuelle supprimee ne fournissait pas `dist/` autrement).
    expect(conf.build.beforeBuildCommand).toContain("npm run build");
  });

  it("le budget de cache du depot reste tenu (target/ seulement pour les cibles lentes)", () => {
    const build = jobBlock("build");
    // Windows garde son `target/` (fabrication la plus lourde apres Linux).
    const windows = build.slice(build.indexOf("windows-latest"));
    expect(windows).toContain('rust_cache_targets: "true"');
    // Les deux cibles macOS non : ~2 Go chacune pour 6 a 10 min de compilation.
    expect(build.match(/rust_cache_targets: "false"/g) || []).toHaveLength(2);
    expect(jobBlock("build-linux")).toContain('cache-targets: "true"');
  });
});
