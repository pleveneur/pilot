// latest-json-platforms.js — Logique PURE de l'index des mises à jour
// (utilisée par `scripts/gen-latest-json.js`).
//
// Rôle : dire quel artefact d'une release sert quelle cible d'updater Tauri
// (`windows-x86_64`, `darwin-aarch64`, …), et — point critique — décider
// LAQUELLE des deux familles d'installateurs Windows gagne. Les deux
// (`…-setup.exe` NSIS et `….msi` MSI) visent la MÊME cible `windows-x86_64` :
// sans choix explicite, la dernière rencontrée écrase l'autre et l'index
// propose un installeur qui ne correspond pas à l'installation réelle (une
// seconde copie est posée et l'ancienne version reste celle qui est relancée).
//
// Choix retenu : NSIS. L'application s'installe avec l'installateur NSIS en
// mode `currentUser` (`src-tauri/tauri.conf.json` →
// `bundle.windows.nsis.installMode = "currentUser"`). Le MSI n'est donc JAMAIS
// proposé par l'updater : il est écarté explicitement, jamais silencieusement.

/** Cible d'updater servie par les installateurs Windows (NSIS ou MSI). */
export const WINDOWS_TARGET = "windows-x86_64";

/** Famille d'installateur Windows retenue pour l'index des mises à jour. */
export const WINDOWS_UPDATER_FAMILY = "nsis";

/**
 * Famille d'installateur Windows d'un artefact, ou null si ce n'en est pas un.
 * @param {string} name nom du fichier (ex: "Pilot_0.4.36_x64-setup.exe")
 * @returns {"nsis"|"msi"|null}
 */
export function windowsInstallerFamily(name) {
  const n = String(name).toLowerCase();
  if (n.endsWith("-setup.exe")) return "nsis";
  if (n.endsWith(".msi")) return "msi";
  return null;
}

/**
 * Vrai si l'artefact est un installateur Windows d'une famille qui n'est pas
 * retenue pour l'updater (aujourd'hui : le MSI). Il ne doit jamais prendre la
 * place du NSIS dans l'index.
 * @param {string} name
 */
export function isExcludedWindowsInstaller(name) {
  const family = windowsInstallerFamily(name);
  return family !== null && family !== WINDOWS_UPDATER_FAMILY;
}

/**
 * Mappe un nom de binaire vers la clé plateforme Tauri attendue par l'updater.
 * Retourne null si le fichier n'est pas un artefact d'updater reconnu — ou
 * s'il appartient à une famille d'installateur Windows non retenue (MSI).
 * @param {string} name
 * @returns {string|null} ex: "windows-x86_64", "darwin-aarch64", …
 */
export function platformFromBinaryName(name) {
  const n = String(name).toLowerCase();
  const family = windowsInstallerFamily(n);
  if (family) return family === WINDOWS_UPDATER_FAMILY ? WINDOWS_TARGET : null;
  if (n.endsWith(".app.tar.gz")) {
    if (n.includes("aarch64")) return "darwin-aarch64";
    if (n.includes("x64")) return "darwin-x86_64";
    return null;
  }
  if (n.endsWith(".appimage")) {
    if (n.includes("aarch64")) return "linux-aarch64";
    return "linux-x86_64";
  }
  return null;
}
