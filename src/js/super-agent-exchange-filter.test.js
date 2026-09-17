// Tests — filtre des échanges mémorisés par l'Assistant.
// Garantie : un échange trivial (vide, trop court, purement protocolaire ou sans
// contenu réel) n'est PAS consigné dans la mémoire de suivi ; un échange porteur
// d'une demande et d'une réponse décrites l'est.

import { describe, it, expect } from "vitest";
import {
  shouldRememberExchange,
  shouldRememberAgentReport,
  shouldDeliverAgentReport,
  MIN_TOTAL_CHARS,
  MIN_RESPONSE_CHARS,
} from "./super-agent-exchange-filter.js";
import { buildRunAgentsSummary, RUN_PROGRESS_PREFIX } from "./run-agents-notify.js";

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

// ── Garde des comptes rendus d'agents (agent invisible + run_agents) ──
// Les deux chemins qui écrivaient sans filtre dans la mémoire de suivi de
// l'Assistant doivent réutiliser cette garde, sans jamais perdre un compte rendu
// de fin de tâche (délégation, résultat de run, échec de run).

describe("shouldRememberAgentReport — filtre des comptes rendus d'agents", () => {
  it("(a) refuse le vide et le purement protocolaire", () => {
    expect(shouldRememberAgentReport("")).toBe(false);
    expect(shouldRememberAgentReport("   \n ")).toBe(false);
    expect(shouldRememberAgentReport(null)).toBe(false);
    expect(shouldRememberAgentReport(undefined)).toBe(false);
    expect(shouldRememberAgentReport(123)).toBe(false);
    expect(shouldRememberAgentReport("merci !")).toBe(false);
    expect(shouldRememberAgentReport("Bonjour ! Que puis-je faire pour vous ?")).toBe(false);
    // Compte rendu générique de fin d'agent sans résultat (agent sans texte
    // final) : annonce protocolaire, aucun fait réutilisable.
    expect(shouldRememberAgentReport("L'agent a terminé la tâche déléguée en arrière-plan.")).toBe(false);
    expect(shouldRememberAgentReport("L'agent a terminé sa tâche.")).toBe(false);
  });

  it("(b) garde un compte rendu de délégation réel (livré ET mémorisé)", () => {
    const rapport =
      "Résultat de l'agent : J'ai corrigé le bug du watcher dans src-tauri/src/lib.rs et lancé cargo test.";
    expect(shouldRememberAgentReport(rapport)).toBe(true);
    expect(shouldDeliverAgentReport(shouldRememberAgentReport(rapport))).toBe(true);
  });

  it("(c) garde un résultat de run réel (DONE:, VERDICT:, fichier cité)", () => {
    const result = "DONE: src/js/super-agent.js mis à jour. VERDICT: CONFORME, tests unitaires verts.";
    const summary = buildRunAgentsSummary(result);
    expect(summary).toContain("[Tâche run_agents terminée]");
    expect(shouldRememberAgentReport(summary)).toBe(true);
    expect(shouldDeliverAgentReport(shouldRememberAgentReport(summary))).toBe(true);
  });

  it("(d) refuse un point d'avancement [Info run_agents] vide/elliptique", () => {
    const point = `${RUN_PROGRESS_PREFIX} ⏳ en file.`;
    expect(shouldRememberAgentReport(point)).toBe(false);
    // Le point d'avancement traverse `buildRunAgentsSummary` tel quel.
    expect(buildRunAgentsSummary(point)).toBe(point);
    expect(shouldRememberAgentReport(buildRunAgentsSummary(point))).toBe(false);
    expect(
      shouldRememberAgentReport(`${RUN_PROGRESS_PREFIX} ▶️ L'agent est déjà actif, la demande est mise en file d'attente.`)
    ).toBe(false);
  });

  it("ne perd JAMAIS un feedback de délégation en attente", () => {
    // Compte rendu générique (sans valeur) mais délégation en attente → remis.
    const generique = "L'agent a terminé la tâche déléguée en arrière-plan.";
    expect(shouldRememberAgentReport(generique)).toBe(false);
    expect(shouldDeliverAgentReport(shouldRememberAgentReport(generique), { delegationPending: true })).toBe(true);
  });

  it("fail-open : un verdict absent (appelant non filtrant) remet toujours", () => {
    expect(shouldDeliverAgentReport(undefined)).toBe(true);
    expect(shouldDeliverAgentReport(true)).toBe(true);
    expect(shouldDeliverAgentReport(false)).toBe(false);
  });
});
