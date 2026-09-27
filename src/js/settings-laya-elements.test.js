import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Garde anti-régression (défaut trouvé le 27/09/2026) : un élément Laya utilisé
// dans l'enregistrement des Réglages mais jamais DÉCLARÉ faisait échouer TOUS
// les enregistrements de réglages (ReferenceError sur l'identifiant inconnu),
// et le bouton « Choisir le programme… » de l'interpréteur restait sans effet.
const source = readFileSync(new URL("./settings.js", import.meta.url), "utf8");

describe("Réglages — éléments Laya", () => {
  it("déclare chaque élément Laya (input/chk/btn) qu'il utilise", () => {
    const used = [...new Set(source.match(/\b(?:input|chk|btn)Laya[A-Za-z]+/g) || [])].sort();
    const declared = new Set(
      [...source.matchAll(/const ((?:input|chk|btn)Laya[A-Za-z]+) = document\.getElementById/g)].map(
        (m) => m[1]
      )
    );
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((name) => !declared.has(name))).toEqual([]);
  });

  it("garde le champ de l'interpréteur : déclaré, relu, et rempli par le bouton", () => {
    expect(source).toContain(
      'const inputLayaNodePath = document.getElementById("setting-laya-node-path")'
    );
    expect(source).toContain("inputLayaNodePath.value = currentConfig.laya_node_path");
    expect(source).toContain("btnLayaNodeBrowse.addEventListener");
  });

  it("enregistre les sept réglages Laya (aucun n'est perdu à l'enregistrement)", () => {
    for (const key of [
      "laya_autostart_enabled",
      "laya_service_path",
      "laya_model_dir",
      "laya_model_auto_download_enabled",
      "laya_model_base_url",
      "laya_fetch_path",
      "laya_node_path",
    ]) {
      expect(source).toContain(`${key}:`);
    }
  });

  // Défaut trouvé le 27/09/2026 (issue #23) : un service tué au démarrage ne
  // pouvait être relancé qu'en redémarrant Pilot, et l'écran ne disait jamais
  // POURQUOI il ne répondait pas. Le bouton de démarrage à la demande affiche
  // l'issue RÉELLE renvoyée par le moteur.
  it("propose un démarrage du service à la demande, câblé sur la commande réelle", () => {
    const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
    expect(html).toMatch(/id="btn-laya-service-start"[^>]*class="settings-btn"/);
    expect(html).toMatch(/Démarrer le service maintenant/);
    expect(source).toContain("btnLayaServiceStart.addEventListener");
    expect(source).toContain('invoke("laya_service_start")');
    expect(source).toContain("layaOutcomeMessage(outcome)");
  });
});
