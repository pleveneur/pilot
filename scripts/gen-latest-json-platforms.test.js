// gen-latest-json-platforms.test.js — l'index des mises à jour ne doit JAMAIS
// proposer le mauvais paquet.
//
// Constat (rapport-maj-non-detectee.md, défaut n° 11) : l'installateur NSIS
// (`…-setup.exe`, celui réellement utilisé par une installation
// `installMode: currentUser`) et le MSI (`….msi`) étaient associés à la MÊME
// clé `windows-x86_64`. Le dernier des deux l'emportait → `latest.json`
// proposait le MSI, donc une SECONDE installation, et l'ancienne version
// restait celle qui était relancée.
//
// Ce fichier échoue si les deux formats se disputent de nouveau la même entrée.

import { describe, it, expect } from "vitest";
import {
  WINDOWS_TARGET,
  WINDOWS_UPDATER_FAMILY,
  isExcludedWindowsInstaller,
  platformFromBinaryName,
  windowsInstallerFamily,
} from "./latest-json-platforms.js";

const NSIS = "Pilot_0.4.36_x64-setup.exe";
const MSI = "Pilot_0.4.36_x64_en-US.msi";

// Rejoue la boucle d'indexation du générateur (nom → clé ; la dernière entrée
// écraserait la précédente). Sert à prouver la déterminisme quel que soit
// l'ordre de retour des assets de l'API GitHub.
function indexPlatforms(names) {
  const platforms = {};
  for (const name of names) {
    const key = platformFromBinaryName(name);
    if (key) platforms[key] = name;
  }
  return platforms;
}

describe("famille d'installateur Windows", () => {
  it("reconnaît NSIS et MSI", () => {
    expect(windowsInstallerFamily(NSIS)).toBe("nsis");
    expect(windowsInstallerFamily(MSI)).toBe("msi");
    expect(windowsInstallerFamily("Pilot_0.4.36_aarch64.app.tar.gz")).toBeNull();
  });

  it("retient la famille de l'installation réelle (NSIS currentUser)", () => {
    expect(WINDOWS_UPDATER_FAMILY).toBe("nsis");
    // preuve du choix : src-tauri/tauri.conf.json → bundle.windows.nsis.installMode
    expect(isExcludedWindowsInstaller(MSI)).toBe(true);
    expect(isExcludedWindowsInstaller(NSIS)).toBe(false);
  });
});

describe("cible d'updater par artefact", () => {
  it("le NSIS sert windows-x86_64", () => {
    expect(platformFromBinaryName(NSIS)).toBe(WINDOWS_TARGET);
  });

  it("le MSI ne peut jamais servir windows-x86_64", () => {
    expect(platformFromBinaryName(MSI)).toBeNull();
    expect(isExcludedWindowsInstaller(MSI)).toBe(true);
  });

  it("les autres plateformes sont inchangées", () => {
    expect(platformFromBinaryName("Pilot_0.4.36_aarch64.app.tar.gz")).toBe("darwin-aarch64");
    expect(platformFromBinaryName("Pilot_0.4.36_x64.app.tar.gz")).toBe("darwin-x86_64");
    expect(platformFromBinaryName("Pilot_0.4.36_amd64.AppImage")).toBe("linux-x86_64");
    expect(platformFromBinaryName("Pilot_0.4.36_aarch64.AppImage")).toBe("linux-aarch64");
    // Artefacts non destinés à l'updater : ignorés comme avant.
    expect(platformFromBinaryName("Pilot_0.4.36_x64.dmg")).toBeNull();
    expect(platformFromBinaryName("Pilot_0.4.36_amd64.deb")).toBeNull();
  });
});

describe("indexation : l'installateur et le MSI ne se disputent plus l'entrée", () => {
  const all = [
    NSIS,
    MSI,
    "Pilot_0.4.36_aarch64.app.tar.gz",
    "Pilot_0.4.36_x64.app.tar.gz",
    "Pilot_0.4.36_amd64.AppImage",
  ];

  it("le NSIS gagne, quel que soit l'ordre des assets", () => {
    for (const order of [all, [...all].reverse(), [MSI, NSIS, ...all.slice(2)]]) {
      const platforms = indexPlatforms(order);
      expect(platforms[WINDOWS_TARGET]).toBe(NSIS);
      expect(Object.values(platforms)).not.toContain(MSI);
      // Aucune entrée supplémentaire créée pour le MSI.
      expect(Object.keys(platforms).sort()).toEqual(
        ["darwin-aarch64", "darwin-x86_64", "linux-x86_64", "windows-x86_64"].sort()
      );
    }
  });

  it("le MSI seul ne fabrique pas d'entrée Windows (pas de repli silencieux)", () => {
    const platforms = indexPlatforms([MSI]);
    expect(platforms[WINDOWS_TARGET]).toBeUndefined();
    expect(Object.keys(platforms)).toEqual([]);
  });
});
