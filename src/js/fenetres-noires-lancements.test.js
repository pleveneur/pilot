// fenetres-noires-lancements.test.js — Garde automatique « fenêtres noires ».
//
// Pilot est une application GUI (sous-système Windows, sans console) : lancer un
// programme console SANS masquer sa fenêtre ouvre réellement une fenêtre noire
// qui clignote (fait mesuré, `docs/rapports/RAPPORT-fenetres-noires.md` § 1.2,
// essai C). Le masquage est TRANSITIF : masquer un processus suffit pour toute
// sa descendance.
//
// Cette garde tient trois choses, et rien d'autre :
//   1. CHAQUE `Command::new` des sources Rust (`src-tauri`, `gds-core`,
//      `gds-server`) porte le point unique `hide_console(…)` — ou, s'il doit
//      légitimement ouvrir une fenêtre, une marque d'exception motivée
//      (`FENETRE-CONSOLE-EXCEPTION :`), jamais une exception silencieuse ;
//   2. le drapeau lui-même n'existe qu'à UN endroit (`gds-core/src/proc.rs`) :
//      ni littéral `0x08000000`, ni `creation_flags(` ailleurs — c'est ce qui
//      empêche un futur lancement d'oublier le masque ;
//   3. le desk réutilise CE helper (aucune seconde définition de constante).
//
// Les lancements des modules de test Rust sont hors périmètre : ils sont lancés
// par `cargo test` (qui a sa propre console), jamais par l'application.
//
// La lecture NORMALISE les fins de ligne (`.replace(/\r\n/g, "\n")`) : sur un
// runner Windows le worktree est en CRLF (`.pi/skills/quality-gate/SKILL.md`
// § 3.4, incident v0.4.30).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

/** Dossiers Rust scannés (le dépôt tout entier côté desk + socle + serveur). */
const SCANNED_DIRS = ["src-tauri/src", "gds-core/src", "gds-server/src"];

/** Le point unique : seul fichier autorisé à écrire le drapeau. */
const HELPER_FILE = "gds-core/src/proc.rs";

/** Nom du point unique de masquage. */
const HELPER = "hide_console";

/** Marque d'une exception assumée (fenêtre VOULEE par l'utilisateur). */
const EXCEPTION_MARK = "FENETRE-CONSOLE-EXCEPTION";

/** Reconnaît une ligne de commentaire (Rust) : elle ne lance rien. */
function isComment(line) {
  const t = line.trimStart();
  return t.startsWith("//") || t.startsWith("/*") || t.startsWith("*");
}

function indentOf(line) {
  return line.length - line.trimStart().length;
}

/** Début de déclaration de fonction (méthode d'`impl` incluse). */
const FN_DECL = /^\s*(pub(\([^)]*\))?\s+)?(async\s+)?fn\s+[A-Za-z_]/;

/** Liste récursive des fichiers `.rs` d'un dossier (chemins relatifs au dépôt). */
function rustFiles(dir, out = []) {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) {
      rustFiles(rel, out);
    } else if (entry.endsWith(".rs")) {
      out.push(rel);
    }
  }
  return out;
}

/** Source normalisée (CRLF → LF) : indispensable sur un worktree Windows. */
function readSource(file) {
  return readFileSync(join(ROOT, file), "utf8").replace(/\r\n/g, "\n");
}

/**
 * Fenêtre « fonction englobante » d'un site de lancement : de la déclaration de
 * fonction la plus proche (indentation ≤ celle du site) jusqu'à la déclaration
 * suivante de même niveau. C'est la portée dans laquelle le masque est cherché :
 * une ligne `hide_console` posée dans la même fonction couvre les lancements de
 * cette fonction (cas réel : `which()` de `code_check.rs`).
 */
function functionWindow(lines, index) {
  const siteIndent = indentOf(lines[index]);
  let start = 0;
  for (let i = index; i >= 0; i--) {
    if (isComment(lines[i]) || !FN_DECL.test(lines[i])) continue;
    if (indentOf(lines[i]) > siteIndent) continue;
    start = i;
    break;
  }
  let end = lines.length - 1;
  for (let i = index + 1; i < lines.length; i++) {
    if (isComment(lines[i]) || !FN_DECL.test(lines[i])) continue;
    if (indentOf(lines[i]) <= indentOf(lines[start])) {
      end = i - 1;
      break;
    }
  }
  return { start, end };
}

/** Tous les `Command::new(` hors commentaires d'un fichier. */
function launchSites(file) {
  const lines = readSource(file).split("\n");
  // Les modules de test Rust ne sont jamais lancés par l'application.
  const testsAt = lines.findIndex((l) => /^\s*mod tests\w*\s*\{/.test(l));
  const sites = [];
  for (let i = 0; i < lines.length; i++) {
    if (testsAt !== -1 && i > testsAt) break;
    if (isComment(lines[i])) continue;
    if (!/Command::new\s*\(/.test(lines[i])) continue;
    sites.push({ file, line: i + 1, index: i, lines });
  }
  return sites;
}

const ALL_FILES = SCANNED_DIRS.flatMap((dir) => rustFiles(dir));
const ALL_SITES = ALL_FILES.flatMap((file) => launchSites(file));

describe("fenêtres noires — point unique de masquage", () => {
  it("le helper existe dans le socle et est neutre hors Windows", () => {
    const src = readSource(HELPER_FILE);
    expect(src).toContain(`pub fn ${HELPER}(cmd: &mut std::process::Command)`);
    // Sous Windows : le drapeau. Ailleurs : fonction neutre (même signature).
    expect(src).toMatch(/#\[cfg\(windows\)\][\s\S]{0,200}creation_flags\(CREATE_NO_WINDOW\)/);
    expect(src).toMatch(/#\[cfg\(not\(windows\)\)\]/);
  });

  it("le desk réutilise CE helper (aucune seconde définition du drapeau)", () => {
    const src = readSource("src-tauri/src/lib.rs");
    expect(src).toContain(`pub(crate) use gds_core::proc::${HELPER};`);
  });

  it("aucun littéral de drapeau hors du point unique", () => {
    const offenders = ALL_FILES.filter((f) => f !== HELPER_FILE)
      .filter((f) => /0x08000000/.test(readSource(f)));
    expect(offenders).toEqual([]);
  });

  it("aucun `creation_flags(` hors du point unique", () => {
    const offenders = ALL_FILES.filter((f) => f !== HELPER_FILE).filter((f) =>
      readSource(f)
        .split("\n")
        .some((l) => !isComment(l) && /creation_flags\s*\(/.test(l)),
    );
    expect(offenders).toEqual([]);
  });

  it("le balayage trouve réellement des sites (garde non vide)", () => {
    expect(ALL_FILES.length).toBeGreaterThan(40);
    expect(ALL_SITES.length).toBeGreaterThan(25);
  });
});

describe("fenêtres noires — chaque lancement est masqué ou exception motivée", () => {
  it("aucun lancement sans `hide_console` ni marque d'exception", () => {
    const offenders = [];
    for (const site of ALL_SITES) {
      const { start, end } = functionWindow(site.lines, site.index);
      const window = site.lines.slice(start, end + 1);
      const masked = window.some((l) => !isComment(l) && l.includes(`${HELPER}(`));
      const excepted = window.some((l) =>
        new RegExp(`${EXCEPTION_MARK}\\s*:\\s*\\S`).test(l),
      );
      if (!masked && !excepted) {
        offenders.push(`${site.file}:${site.line}`);
      }
    }
    // Message actionnable : ajouter `crate::hide_console(&mut cmd)` (ou
    // `gds_core::proc::hide_console`) juste avant le lancement, ou bien une
    // marque `// FENETRE-CONSOLE-EXCEPTION : <pourquoi la fenêtre est voulue>`.
    expect(offenders).toEqual([]);
  });

  it("les exceptions portent toutes une motivation d'une ligne", () => {
    const unjustified = [];
    for (const file of ALL_FILES) {
      for (const line of readSource(file).split("\n")) {
        if (!line.includes(EXCEPTION_MARK)) continue;
        if (!new RegExp(`${EXCEPTION_MARK}\\s*:\\s*\\S`).test(line)) {
          unjustified.push(`${file}: ${line.trim()}`);
        }
        if (line.length < 60) unjustified.push(`${file}: ${line.trim()} (trop court)`);
      }
    }
    expect(unjustified).toEqual([]);
  });

  it("les trois causes du rapport sont corrigées (P1, P2, P3)", () => {
    // P1 — élévation PowerShell du GDS (2 sites).
    const gds = readSource("src-tauri/src/gds.rs");
    expect(gds.match(/hide_console\(&mut cmd\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    // P2 — commande projet lancée depuis le web distant.
    expect(readSource("src-tauri/src/web_server.rs")).toMatch(
      /Command::new\(prog\)[\s\S]{0,400}hide_console\(&mut cmd\)/,
    );
    // P3 — `cmd.exe` intermédiaire du terminal intégré (la fenêtre finale reste
    // ouverte par `start`).
    const lib = readSource("src-tauri/src/lib.rs");
    expect(lib.match(/\/c", "start", "cmd\.exe"/g)?.length ?? 0).toBe(2);
    expect(lib).toMatch(/start", "cmd\.exe", "\/k", cmd\][\s\S]{0,200}hide_console\(&mut launcher\)/);
  });
});
