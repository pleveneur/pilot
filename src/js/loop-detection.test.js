import { describe, it, expect } from "vitest";
import { detectRepeatedBlock, normalizeLoopLine } from "./loop-detection.js";

describe("normalizeLoopLine", () => {
  it("trimme et collapse les espaces multiples", () => {
    expect(normalizeLoopLine("  hello    world  ")).toBe("hello world");
    expect(normalizeLoopLine("")).toBe("");
    expect(normalizeLoopLine("   ")).toBe("");
  });

  it("retourne '' sur entrée invalide", () => {
    expect(normalizeLoopLine(null)).toBe("");
    expect(normalizeLoopLine(undefined)).toBe("");
    expect(normalizeLoopLine(42)).toBe("");
  });
});

describe("detectRepeatedBlock", () => {
  it("false sur entrée vide / invalide", () => {
    expect(detectRepeatedBlock("")).toBe(false);
    expect(detectRepeatedBlock(null)).toBe(false);
    expect(detectRepeatedBlock(undefined)).toBe(false);
    expect(detectRepeatedBlock("   ")).toBe(false);
  });

  it("detecte un bloc multi-lignes répété à l'identique", () => {
    const block =
      "Je dois continuer à analyser la fonction de parsing du plan de réponse " +
      "et vérifier chaque branche de gestion des erreurs de validation.";
    // 3 répétitions consécutives du même bloc de 2 lignes
    const text = Array(3)
      .fill([block, block + " (suite)"])
      .flat()
      .join("\n");
    expect(detectRepeatedBlock(text)).toBe(true);
  });

  it("detecte une seule ligne longue répétée", () => {
    const line =
      "Je réfléchis à la meilleure stratégie pour structurer la sortie du " +
      "parseur sans introduire de régression dans les fonctions existantes.";
    const text = Array(3).fill(line).join("\n");
    expect(detectRepeatedBlock(text, { minBlockChars: 100 })).toBe(true);
  });

  it("false si les blocs ne sont pas identiques (variation)", () => {
    const a =
      "Je réfléchis à la façon de gérer les erreurs de parsing dans la fonction " +
      "principale de validation des réponses du plan détaillé.";
    const b =
      "J'implémente maintenant la gestion des erreurs de parsing dans la fonction " +
      "principale de validation des réponses du plan détaillé.";
    const c =
      "Je vérifie ensuite la compatibilité de la fonction avec les anciennes " +
      "réponses produites par les modèles précédents du registre.";
    const text = [a, b, c, a, b, c].join("\n");
    // Même si des mots reviennent, aucun bloc IDENTIQUE ne se répète consécutivement.
    expect(detectRepeatedBlock(text)).toBe(false);
  });

  it("false sur un texte long normal sans répétition", () => {
    const lines = [];
    for (let i = 0; i < 40; i++) {
      lines.push(
        `Ligne ${i} : analyse du composant et des dépendances pour la refactorisation ` +
          `de la fonction de gestion des états de l'interface utilisateur.`
      );
    }
    expect(detectRepeatedBlock(lines.join("\n"))).toBe(false);
  });

  it("false sur un bloc trop court (< minBlockChars)", () => {
    const text = Array(3).fill("courte ligne répétée").join("\n");
    expect(detectRepeatedBlock(text)).toBe(false);
  });

  it("respecte l'option maxLines (hors fenêtre)", () => {
    const line =
      "Je réfléchis longuement à la meilleure façon de structurer la sortie du " +
      "parseur de plan pour éviter les boucles de correction inutiles.";
    const prefix = Array(80).fill("texte préalable normal sans aucune répétition ici").join("\n");
    const text = prefix + "\n" + Array(3).fill(line).join("\n");
    // La boucle est à la fin → dans les 40 dernières lignes → détectée.
    expect(detectRepeatedBlock(text)).toBe(true);
    // Fenêtre réduite excluant la boucle → non détectée.
    const windowText = text.split("\n").slice(0, 30).join("\n");
    expect(detectRepeatedBlock(windowText, { maxLines: 10 })).toBe(false);
  });

  it("respecte l'option minRepeat", () => {
    const line =
      "Analyse détaillée du comportement de la fonction de gestion des erreurs " +
      "lorsque le format de sortie fourni par le modèle est invalide.";
    // 2 répétitions seulement → pas une boucle avec minRepeat=3
    expect(detectRepeatedBlock(Array(2).fill(line).join("\n"), { minBlockChars: 100 })).toBe(false);
    // 3 répétitions → boucle
    expect(detectRepeatedBlock(Array(3).fill(line).join("\n"), { minBlockChars: 100 })).toBe(true);
  });
});
