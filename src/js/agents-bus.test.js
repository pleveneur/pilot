// Tests unitaires — agents-bus.js (source de vérité « run occupée »)
// Couvre la garde anti-chevauchement de l'assistant : la détection d'une run en
// cours s'appuie sur `isRunInProgress()` (état réel du bus), pas seulement sur
// le flag local de super-agent.js. `busState.runState` est initialisé à "idle"
// au chargement du module (aucune run en cours), donc `isRunInProgress()` doit
// retourner false sans amorcer le bus (env vitest Node, sans Tauri/window).
import { describe, it, expect } from "vitest";
import { isRunInProgress } from "./agents-bus.js";

describe("isRunInProgress — source de vérité « run occupée ou non »", () => {
  it("est exportée comme fonction (contrat de la source unique)", () => {
    expect(typeof isRunInProgress).toBe("function");
  });

  it("retourne false quand le bus est idle (runState initial = idle, aucune run en cours)", () => {
    expect(isRunInProgress()).toBe(false);
  });
});
