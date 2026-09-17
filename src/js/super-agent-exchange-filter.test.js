// Tests — filtre des échanges mémorisés par l'Assistant.
// Garantie : un échange trivial (vide, trop court, purement protocolaire ou sans
// contenu réel) n'est PAS consigné dans la mémoire de suivi ; un échange porteur
// d'une demande et d'une réponse décrites l'est.

import { describe, it, expect } from "vitest";
import {
  shouldRememberExchange,
  MIN_TOTAL_CHARS,
  MIN_RESPONSE_CHARS,
} from "./super-agent-exchange-filter.js";

describe("shouldRememberExchange — filtre de mémorisation", () => {
  it("refuse un échange vide ou incomplet", () => {
    expect(shouldRememberExchange("", "")).toBe(false);
    expect(shouldRememberExchange("corrige le bug du watcher dans src-tauri", "")).toBe(false);
    expect(shouldRememberExchange("", "J'ai corrigé le watcher.")).toBe(false);
    expect(shouldRememberExchange(null, undefined)).toBe(false);
    expect(shouldRememberExchange("   ", "   ")).toBe(false);
  });

  it("refuse une réponse sans contenu réel (trop brève)", () => {
    const demande = "Peux-tu regarder le module de contexte du projet et me dire ce qu'il fait exactement ?";
    expect(shouldRememberExchange(demande, "Oui.")).toBe(false);
    expect(shouldRememberExchange(demande, "…")).toBe(false);
    expect(shouldRememberExchange(demande, "x".repeat(MIN_RESPONSE_CHARS - 1))).toBe(false);
  });

  it("refuse un échange trop court au total", () => {
    const demande = "corrige le typo";
    const reponse = "C'est fait.";
    expect(demande.length + reponse.length).toBeLessThan(MIN_TOTAL_CHARS);
    expect(shouldRememberExchange(demande, reponse)).toBe(false);
  });

  it("refuse un échange purement protocolaire (même long)", () => {
    expect(shouldRememberExchange("bonjour", "Bonjour ! Que puis-je faire pour vous ?")).toBe(false);
    expect(shouldRememberExchange("merci beaucoup", "De rien, bonne journée !")).toBe(false);
    expect(shouldRememberExchange("ok", "Parfait, entendu. Je reste disponible si besoin.")).toBe(false);
    expect(shouldRememberExchange("salut, comment vas-tu ?", "Très bien merci et toi ? Bonne journée.")).toBe(false);
  });

  it("accepte un échange porteur d'une demande et d'une réponse décrites", () => {
    const demande = "Ajoute un filtre pour ne plus mémoriser les échanges insignifiants";
    const reponse =
      "J'ai ajouté shouldRememberExchange dans super-agent-exchange-filter.js et branché le filtre dans agent-pi.js.";
    expect(shouldRememberExchange(demande, reponse)).toBe(true);
  });

  it("accepte un échange long dont un seul mot n'est pas protocolaire", () => {
    expect(shouldRememberExchange("ok", "Bien reçu, j'ai déplacé le fichier de configuration dans docs.")).toBe(true);
  });

  it("accepte une demande courte si la réponse est détaillée", () => {
    const reponse =
      "Le watcher repose sur un poller Rust qui lit le dossier toutes les 2 secondes et filtre les extensions ignorées.";
    expect(shouldRememberExchange("explique le watcher", reponse)).toBe(true);
  });
});
