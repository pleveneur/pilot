import { describe, it, expect } from "vitest";
import {
  detectRepeatedBlock,
  detectRepeatedWord,
  detectRepeatedToolCalls,
  detectRepeatedActions,
  detectSemanticLoop,
  findRepeatedTail,
  buildLoopCorrectionPrompt,
  buildToolLoopFingerprint,
  MAX_LOOP_ESCALATION,
  LOOP_ESCALATION_LEVELS,
  normalizeLoopLine,
} from "./loop-detection.js";

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

describe("detectRepeatedWord", () => {
  it("false sur entrée vide / invalide", () => {
    expect(detectRepeatedWord("")).toBe(false);
    expect(detectRepeatedWord(null)).toBe(false);
    expect(detectRepeatedWord(undefined)).toBe(false);
    expect(detectRepeatedWord("   ")).toBe(false);
  });

  it("detecte un même mot court répété consécutivement (issue #62)", () => {
    const text = Array(8).fill("tool").join(" ");
    expect(detectRepeatedWord(text)).toBe(true);
  });

  it("false si le mot n'est pas répété assez de fois", () => {
    const text = Array(3).fill("tool").join(" ");
    expect(detectRepeatedWord(text)).toBe(false);
  });

  it("detecte une séquence de caractères périodique sans espaces (issue #62)", () => {
    // "tool" répété 3 fois = 12 caractères, motif minimal "tool"
    expect(detectRepeatedWord("tooltooltool")).toBe(true);
    expect(detectRepeatedWord("thornthornthorn")).toBe(true);
  });

  it("detecte une séquence périodique noyée dans une ligne", () => {
    const text = "Je réfléchis tooltooltooltooltooltooltooltool et je continue.";
    expect(detectRepeatedWord(text)).toBe(true);
  });

  it("false sur un texte normal sans répétition", () => {
    const text =
      "Je continue l'analyse du composant et je vérifie chaque branche de la " +
      "gestion des erreurs avant de proposer une correction ciblée.";
    expect(detectRepeatedWord(text)).toBe(false);
  });

  it("false sur un mot long non périodique", () => {
    expect(detectRepeatedWord("internationalization")).toBe(false);
  });

  it("respecte l'option minWordRepeat", () => {
    // 6 répétitions → pas une boucle avec minWordRepeat=8
    expect(detectRepeatedWord(Array(6).fill("tool").join(" "))).toBe(false);
    // 8 répétitions → boucle
    expect(detectRepeatedWord(Array(8).fill("tool").join(" "))).toBe(true);
  });

  it("respecte l'option minSeqRepeat", () => {
    // "tool" répété 2 fois = 8 caractères → sous minSeqChars, non détecté
    expect(detectRepeatedWord("tooltool")).toBe(false);
    // 3 répétitions → détecté
    expect(detectRepeatedWord("tooltooltool")).toBe(true);
  });
});

describe("detectRepeatedToolCalls", () => {
  it("false sur entrée vide / invalide", () => {
    expect(detectRepeatedToolCalls([])).toBe(false);
    expect(detectRepeatedToolCalls(null)).toBe(false);
    expect(detectRepeatedToolCalls(undefined)).toBe(false);
    expect(detectRepeatedToolCalls("tool::bash::ls")).toBe(false);
  });

  it("detecte une boucle de commandes bash identiques (issue #55)", () => {
    const fp = "tool::bash::cargo test --lib";
    expect(detectRepeatedToolCalls([fp, fp, fp])).toBe(true);
  });

  it("false si les tool calls ne sont pas identiques", () => {
    const fps = [
      "tool::bash::cargo test --lib",
      "tool::bash::cargo build",
      "tool::bash::cargo test --lib",
      "tool::bash::cargo build",
    ];
    expect(detectRepeatedToolCalls(fps)).toBe(false);
  });

  it("false si la répétition est interrompue par un autre outil", () => {
    const fps = [
      "tool::bash::cargo test --lib",
      "tool::bash::cargo test --lib",
      "tool::read_file::src/main.rs",
      "tool::bash::cargo test --lib",
    ];
    expect(detectRepeatedToolCalls(fps)).toBe(false);
  });

  it("respecte l'option minRepeat", () => {
    const fp = "tool::bash::cargo test --lib";
    expect(detectRepeatedToolCalls([fp, fp], { minRepeat: 3 })).toBe(false);
    expect(detectRepeatedToolCalls([fp, fp, fp], { minRepeat: 3 })).toBe(true);
    expect(detectRepeatedToolCalls([fp, fp], { minRepeat: 2 })).toBe(true);
  });

  it("detecte une boucle de 4 tool calls identiques", () => {
    const fp = "tool::bash::ls -la src-tauri/target/debug/deps";
    expect(detectRepeatedToolCalls([fp, fp, fp, fp])).toBe(true);
  });

  it("detecte une boucle de requêtes DB identiques (issue #10)", () => {
    // Empreinte produite par buildToolLoopFingerprint("db_query", {sql}) — le
    // format utilisé à la fois par tool_execution_start et par
    // accumulateSuperLoopToolResponse pour les requêtes DB de l'assistant.
    const fp = 'tool::db_query::{"sql":"SELECT * FROM projects"}';
    expect(detectRepeatedToolCalls([fp, fp, fp])).toBe(true);
  });

  it("detecte une boucle de requêtes DB même avec un SQL court (issue #10)", () => {
    // Un SQL court produit une empreinte courte : le détecteur d'outils doit la
    // repérer indépendamment de la longueur du buffer texte (qui resterait sous
    // SUPER_LOOP_BUFFER_MIN).
    const fp = 'tool::db_query::{"sql":"SELECT 1"}';
    expect(detectRepeatedToolCalls([fp, fp, fp])).toBe(true);
  });

  it("false si les requêtes DB diffèrent (pas une boucle)", () => {
    const fps = [
      'tool::db_query::{"sql":"SELECT * FROM projects"}',
      'tool::db_query::{"sql":"SELECT * FROM tasks"}',
      'tool::db_query::{"sql":"SELECT * FROM projects"}',
    ];
    expect(detectRepeatedToolCalls(fps)).toBe(false);
  });
});

describe("detectRepeatedActions", () => {
  it("false sur entrée vide / invalide", () => {
    expect(detectRepeatedActions([])).toBe(false);
    expect(detectRepeatedActions(null)).toBe(false);
    expect(detectRepeatedActions(undefined)).toBe(false);
    expect(detectRepeatedActions("x")).toBe(false);
  });

  it("false si moins de minRepeat actions", () => {
    expect(detectRepeatedActions(["a", "b"])).toBe(false);
  });

  it("détecte une même action répétée minRepeat fois dans la fenêtre", () => {
    expect(detectRepeatedActions(["a", "a", "a", "a", "a"])).toBe(true);
    expect(detectRepeatedActions(["a", "b", "a", "b", "a", "b", "a", "b", "a"])).toBe(true);
  });

  it("ne déclenche pas si l'action n'apparaît pas assez souvent", () => {
    expect(detectRepeatedActions(["a", "b", "a", "b", "a", "b", "a", "b"])).toBe(false);
  });

  it("respecte la fenêtre glissante (windowSize)", () => {
    // 5 occurrences de "a" mais la 1ère sort de la fenêtre de 2.
    expect(detectRepeatedActions(["a", "b", "c"], { windowSize: 2, minRepeat: 5 })).toBe(false);
    // 5 occurrences de "a" dans la fenêtre de 5.
    expect(detectRepeatedActions(["a", "b", "c", "a", "a", "a", "a", "a"], { windowSize: 5, minRepeat: 5 })).toBe(true);
  });

  it("respecte minRepeat personnalisé", () => {
    expect(detectRepeatedActions(["a", "a"], { minRepeat: 2 })).toBe(true);
    expect(detectRepeatedActions(["a", "a"], { minRepeat: 3 })).toBe(false);
    expect(detectRepeatedActions(["a", "a", "a", "a", "a"], { minRepeat: 5 })).toBe(true);
  });
});

describe("buildToolLoopFingerprint", () => {
  it("sérialise les arguments de façon stable", () => {
    expect(buildToolLoopFingerprint("db_query", { sql: "SELECT * FROM projects" })).toBe(
      'tool::db_query::{"sql":"SELECT * FROM projects"}'
    );
  });

  it("priorise la commande bash", () => {
    expect(buildToolLoopFingerprint("bash", { command: "cargo test --lib" })).toBe(
      "tool::bash::cargo test --lib"
    );
  });

  it("priorise le chemin de fichier", () => {
    expect(buildToolLoopFingerprint("read_file", { path: "src/main.rs" })).toBe(
      "tool::read_file::src/main.rs"
    );
  });

  it("différencie deux lectures du même fichier à des offsets différents", () => {
    // Un agent parcourant un GROS fichier par morceaux (offset successifs) ne
    // doit PAS être détecté comme une boucle : l'empreinte doit inclure offset.
    const fp1 = buildToolLoopFingerprint("read", { path: "src/js/super-agent.js", offset: 1, limit: 100 });
    const fp2 = buildToolLoopFingerprint("read", { path: "src/js/super-agent.js", offset: 101, limit: 100 });
    expect(fp1).toBe("tool::read::src/js/super-agent.js::offset=1::limit=100");
    expect(fp2).toBe("tool::read::src/js/super-agent.js::offset=101::limit=100");
    expect(fp1).not.toBe(fp2);
    expect(detectRepeatedToolCalls([fp1, fp2, fp1])).toBe(false);
  });

  it("détecte une vraie boucle : relire le même fichier au même offset", () => {
    // Relecture du MÊME fichier au MÊME offset → même empreinte → boucle.
    const fp1 = buildToolLoopFingerprint("read", { path: "src/js/super-agent.js", offset: 1, limit: 100 });
    const fp2 = buildToolLoopFingerprint("read", { path: "src/js/super-agent.js", offset: 1, limit: 100 });
    expect(fp1).toBe(fp2);
    expect(detectRepeatedToolCalls([fp1, fp2, fp1])).toBe(true);
  });

  it("garde le path seul quand offset est absent (comportement historique)", () => {
    expect(buildToolLoopFingerprint("read", { path: "src/main.rs" })).toBe(
      "tool::read::src/main.rs"
    );
  });

  it("retombe sur la sérialisation vide si args absent", () => {
    expect(buildToolLoopFingerprint("db_query", null)).toBe("tool::db_query::{}");
  });

  it("produit une empreinte stable pour run_agents (anti-boucle)", () => {
    // L'assistant relance la même délégation run_agents à l'identique : même
    // agents + même tâche → même empreinte → detectRepeatedToolCalls la détecte.
    const fp1 = buildToolLoopFingerprint("run_agents", {
      agent_ids: "codeur,testeur",
      task: "Corriger le bug de parsing du plan",
    });
    const fp2 = buildToolLoopFingerprint("run_agents", {
      agent_ids: "codeur,testeur",
      task: "Corriger le bug de parsing du plan",
    });
    expect(fp1).toBe(fp2);
    expect(detectRepeatedToolCalls([fp1, fp2, fp1])).toBe(true);
  });

  it("distingue deux run_agents différents (pas une boucle)", () => {
    const fp1 = buildToolLoopFingerprint("run_agents", {
      agent_ids: "codeur",
      task: "Corriger le bug A",
    });
    const fp2 = buildToolLoopFingerprint("run_agents", {
      agent_ids: "codeur",
      task: "Corriger le bug B",
    });
    expect(fp1).not.toBe(fp2);
    expect(detectRepeatedToolCalls([fp1, fp2, fp1])).toBe(false);
  });
});

describe("detectSemanticLoop", () => {
  it("false sur entrée vide / invalide", () => {
    expect(detectSemanticLoop("")).toBe(false);
    expect(detectSemanticLoop(null)).toBe(false);
    expect(detectSemanticLoop(undefined)).toBe(false);
    expect(detectSemanticLoop("   ")).toBe(false);
  });

  it("detecte une boucle sémantique (mêmes idées, mots différents)", () => {
    const a =
      "Je dois analyser la fonction de parsing du plan de réponse et vérifier chaque branche de gestion des erreurs de validation.";
    const b =
      "Je dois analyser la fonction de parsing du plan de réponse et contrôler chaque branche de gestion des erreurs de validation.";
    const c =
      "Je dois analyser la fonction de parsing du plan de réponse et valider chaque branche de gestion des erreurs de validation.";
    // 3 blocs sémantiquement très proches (mêmes idées, formulation légèrement différente)
    const text = [a, b, c].join("\n\n");
    expect(detectSemanticLoop(text)).toBe(true);
  });

  it("false sur des blocs sémantiquement distincts", () => {
    const a =
      "Je dois analyser la fonction de parsing du plan de réponse et vérifier chaque branche de gestion des erreurs de validation.";
    const b =
      "J'implémente maintenant la gestion des erreurs de parsing dans la fonction principale de validation des réponses du plan détaillé.";
    const c =
      "Je vérifie ensuite la compatibilité de la fonction avec les anciennes réponses produites par les modèles précédents du registre.";
    const d =
      "Je documente enfin le comportement du composant dans le manuel de référence du projet.";
    const text = [a, b, c, d].join("\n\n");
    expect(detectSemanticLoop(text)).toBe(false);
  });

  it("false sur un texte long normal sans répétition", () => {
    const blocks = [
      "Je dois analyser la fonction de parsing du plan de réponse et vérifier chaque branche de gestion des erreurs de validation.",
      "J'implémente maintenant la gestion des erreurs de parsing dans la fonction principale de validation des réponses du plan détaillé.",
      "Je vérifie ensuite la compatibilité de la fonction avec les anciennes réponses produites par les modèles précédents du registre.",
      "Je documente enfin le comportement du composant dans le manuel de référence du projet.",
      "Je prépare ensuite les tests unitaires pour couvrir les cas limites de la fonction de tri des résultats.",
      "Je mets à jour la documentation de l'API pour refléter les nouveaux paramètres de configuration du module.",
      "Je vérifie la performance de la fonction de recherche sur de grands volumes de données avant de finaliser.",
      "Je corrige enfin les avertissements du linter dans les fichiers de configuration du projet.",
    ];
    expect(detectSemanticLoop(blocks.join("\n\n"))).toBe(false);
  });

  it("respecte l'option threshold", () => {
    const a =
      "Je dois analyser la fonction de parsing du plan de réponse et vérifier chaque branche de gestion des erreurs de validation.";
    const b =
      "Je dois analyser la fonction de parsing du plan de réponse et contrôler chaque branche de gestion des erreurs de validation.";
    const text = [a, b, a, b].join("\n\n");
    // Seuil très haut → non détecté
    expect(detectSemanticLoop(text, { threshold: 0.99 })).toBe(false);
    // Seuil bas → détecté
    expect(detectSemanticLoop(text, { threshold: 0.3 })).toBe(true);
  });
});

describe("findRepeatedTail", () => {
  it("retourne '' sur entrée vide / invalide", () => {
    expect(findRepeatedTail("")).toBe("");
    expect(findRepeatedTail(null)).toBe("");
    expect(findRepeatedTail(undefined)).toBe("");
  });

  it("retourne la queue répétée d'un bloc multi-lignes", () => {
    const block =
      "Je dois continuer à analyser la fonction de parsing du plan de réponse " +
      "et vérifier chaque branche de gestion des erreurs de validation.";
    const text = Array(3).fill(block).join("\n");
    const tail = findRepeatedTail(text, { minBlockChars: 100 });
    expect(tail).toContain(block);
    expect(tail.split("\n").length).toBe(3);
  });

  it("retourne '' si aucune répétition", () => {
    const lines = [];
    for (let i = 0; i < 20; i++) {
      lines.push(
        `Ligne ${i} : analyse du composant et des dépendances pour la refactorisation de la fonction de gestion des états.`
      );
    }
    expect(findRepeatedTail(lines.join("\n"))).toBe("");
  });
});

describe("buildLoopCorrectionPrompt", () => {
  it("produit un message pour chaque niveau d'escalade", () => {
    for (let level = 1; level <= MAX_LOOP_ESCALATION; level++) {
      const msg = buildLoopCorrectionPrompt(level);
      expect(typeof msg).toBe("string");
      expect(msg.length).toBeGreaterThan(20);
    }
  });

  it("mentionne la queue répétée quand fournie", () => {
    const msg = buildLoopCorrectionPrompt(1, { repeatedTail: "bloc répété" });
    expect(msg).toContain("ignorée");
  });

  it("les niveaux sont distincts", () => {
    const m1 = buildLoopCorrectionPrompt(1);
    const m2 = buildLoopCorrectionPrompt(2);
    const m3 = buildLoopCorrectionPrompt(3);
    const m4 = buildLoopCorrectionPrompt(4);
    expect(new Set([m1, m2, m3, m4]).size).toBe(4);
  });

  it("expose les constantes d'escalade", () => {
    expect(MAX_LOOP_ESCALATION).toBe(4);
    expect(LOOP_ESCALATION_LEVELS.ABANDON).toBe(5);
  });
});
