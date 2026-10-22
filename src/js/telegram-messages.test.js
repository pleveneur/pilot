// Tests unitaires — telegram-messages.js (REFONTE des messages Telegram).
//
// Objet : garantir, par des CONTRÔLES qui échouent si la règle de contenu est
// cassée, que le propriétaire qui suit DEUX projets en même temps reçoit peu de
// messages, courts, et toujours exploitables :
//
//   [a] jamais un message à deux projets ;
//   [b] jamais de chemin, nom de fonction, numéro de session, empreinte ni
//       compte de tests ;
//   [c] un évènement sans information utile ne produit AUCUN envoi ;
//   [d] jamais deux messages pour la même information (rafale = un envoi) ;
//   [e] le nom du projet est TOUJOURS en tête ;
//   [f] les heures calmes (23 h → 7 h) sont respectées (sauf danger immédiat).
//
// Aucun accès réseau, aucune horloge réelle : l'horloge et l'envoyeur sont
// INJECTÉS (`setTelegramGateDeps`), le module reste pur côté formatage.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  MAX_ALERT_CHARS,
  MAX_ASSISTANT_CHARS,
  MAX_HELD_MESSAGES,
  MAX_RESULT_CHARS,
  MAX_START_CHARS,
  TELEGRAM_BURST_WINDOW_MS,
  TELEGRAM_MESSAGE_TYPES,
  buildAlertMessage,
  buildAssistantMessage,
  buildEndMessage,
  buildOwnerMessage,
  buildStartMessage,
  flushHeldOwnerEvents,
  heldOwnerMessageCount,
  isQuietHours,
  msUntilQuietEnd,
  projectShortName,
  publishOwnerEvent,
  publishOwnerText,
  resetTelegramGate,
  setTelegramGateDeps,
  shouldDeliverNow,
} from "./telegram-messages.js";

// Deux projets suivis EN MÊME TEMPS (le cas qui posait problème).
const PROJET_A = "G:/IA_PL/makefilm";
const PROJET_B = "G:/IA_PL/pilot";
const NOM_A = "makefilm";
const NOM_B = "pilot";

const HEURE_PLEINE = Date.parse("2026-05-05T10:00:00"); // 10 h : hors heures calmes
const NUIT = Date.parse("2026-05-05T23:30:00"); // 23 h 30 : heures calmes
const PETIT_MATIN = Date.parse("2026-05-06T04:00:00"); // 4 h : heures calmes
const REVEIL = Date.parse("2026-05-06T07:00:01"); // juste après 7 h

/** Envoyeur factice : on n'atteint jamais le moteur Rust ni le réseau. */
let envoyes = [];
const sender = (text) => {
  envoyes.push(text);
};

/** Horloge pilotée par le test. */
let horloge = HEURE_PLEINE;

beforeEach(() => {
  envoyes = [];
  horloge = HEURE_PLEINE;
  resetTelegramGate();
  setTelegramGateDeps({ send: sender, now: () => horloge });
});

afterEach(() => {
  resetTelegramGate();
  setTelegramGateDeps({ send: null, now: () => Date.now() });
});

/** Motifs INTERDITS dans un message destiné au téléphone du propriétaire. */
const INTERDITS = [
  /[A-Za-z]:[\\/]/, // chemin Windows absolu
  /(^|\s)\/[\w.-]+\/[\w.-]+/, // chemin POSIX absolu
  /\.(?:js|ts|rs|json|md|css|html|toml|lock|yml|yaml)\b/i, // nom de fichier
  /\w+\(\)/, // nom de fonction
  /\bsession\s*\d/i, // numéro de session
  /\bmission\s*(?:n°|#)?\s*\d/i, // numéro de mission
  /\b[0-9a-f]{8,}\b/i, // empreinte / identifiant hexadécimal
  /\d+\s*(?:tests?|assertions?)\b/i, // compte de tests
  /\bbranche\s+\S/i, // nom de branche
  /\bcommit\s+\S/i, // commit
  /```|`/, // code
];

/** Aucun des motifs interdits ne doit apparaître dans `message`. */
function expectAucunDetailTechnique(message) {
  for (const motif of INTERDITS) {
    expect(message, `motif interdit ${motif} dans « ${message} »`).not.toMatch(motif);
  }
}

// ───────────────────────────────────────────────────────────────────────────
describe("projectShortName — UNE seule source pour le nom court du projet", () => {
  it("rend le nom du dossier, quel que soit le séparateur", () => {
    expect(projectShortName("G:\\IA_PL\\makefilm")).toBe(NOM_A);
    expect(projectShortName("/home/moi/makefilm")).toBe(NOM_A);
    expect(projectShortName("G:/IA_PL/makefilm/")).toBe(NOM_A);
    // Clé composite (projet, agent) du registre des agents.
    expect(projectShortName("G:/IA_PL/makefilm::coder")).toBe(NOM_A);
    // Une valeur déjà réduite à un nom nu est rendue telle quelle.
    expect(projectShortName("makefilm")).toBe(NOM_A);
  });

  it("refuse une valeur vide ou inexploitable (jamais de tête vide)", () => {
    for (const valeur of ["", "   ", null, undefined, "G:", ".", "..", "G:\\"]) {
      expect(projectShortName(valeur), `valeur ${JSON.stringify(valeur)}`).toBe("");
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("un constructeur PAR TYPE, une seule source de vérité", () => {
  it("DÉBUT : une ligne, projet en tête, action en minuscule", () => {
    const message = buildStartMessage({
      project: PROJET_A,
      action: "Correction de l'autotest lancée",
    });
    // « autotest » n'est pas une mention de tests : le mot reste intact.
    expect(message).toBe("makefilm : correction de l'autotest lancée");
    expect(message.split("\n")).toHaveLength(1);
  });

  it("FIN (succès) : verdict « livré » + une ligne « À tester » au maximum", () => {
    const message = buildEndMessage({
      project: PROJET_B,
      ok: true,
      result: "le bouton répond",
      testable: "cliquer sur le bouton",
    });
    expect(message).toBe("pilot : livré — le bouton répond\nÀ tester : cliquer sur le bouton");
    expect(message.split("\n")).toHaveLength(2);
  });

  it("FIN (succès) sans précision utile : une seule ligne", () => {
    expect(buildEndMessage({ project: PROJET_B, ok: true })).toBe("pilot : livré");
  });

  it("FIN (échec) : UNE ligne, jamais de « À tester »", () => {
    const message = buildEndMessage({
      project: PROJET_B,
      ok: false,
      result: "l'enregistrement échoue",
      testable: "vérifier le dossier",
    });
    expect(message).toBe("pilot : échec — l'enregistrement échoue");
    expect(message.split("\n")).toHaveLength(1);
    expect(message).not.toContain("À tester");
  });

  it("ALERTE : une ligne — ce qui bloque ET la décision attendue", () => {
    const message = buildAlertMessage({
      project: PROJET_A,
      problem: "un agent est resté bloqué",
      decision: "le relancer ou changer le délai d'inactivité",
    });
    expect(message).toBe(
      "⚠️ makefilm : un agent est resté bloqué — à décider : le relancer ou changer le délai d'inactivité",
    );
    expect(message.split("\n")).toHaveLength(1);
  });

  it("ALERTE sans décision possible : AUCUN message (jamais de bruit)", () => {
    expect(buildAlertMessage({ project: PROJET_A, problem: "un agent est bloqué" })).toBe("");
    expect(buildAlertMessage({ project: PROJET_A, decision: "relancer" })).toBe("");
  });

  it("ASSISTANT : phrase simple préfixée du projet, nettoyée et bornée", () => {
    const message = buildAssistantMessage({
      project: PROJET_B,
      text: "J'ai terminé la mission. Détail : `src/js/a.js` et 12 tests OK.",
    });
    expect(message).toBe("pilot : j'ai terminé la mission. Détail: et tests OK.");
    expect(message.length).toBeLessThanOrEqual(NOM_B.length + 3 + MAX_ASSISTANT_CHARS);
  });

  it("un type inconnu ne produit rien (aucun gabarit inventé)", () => {
    expect(buildOwnerMessage({ type: "progress", project: PROJET_A })).toBe("");
    expect(buildOwnerMessage({ type: undefined, project: PROJET_A })).toBe("");
  });

  it("les messages restent courts (bornes respectées)", () => {
    const long = "a".repeat(400);
    expect(buildStartMessage({ project: PROJET_A, action: long }).length).toBeLessThanOrEqual(
      MAX_START_CHARS + NOM_A.length + 3,
    );
    expect(buildEndMessage({ project: PROJET_A, ok: true, result: long }).length).toBeLessThanOrEqual(
      MAX_RESULT_CHARS + NOM_A.length + 13,
    );
    expect(
      buildAlertMessage({ project: PROJET_A, problem: long, decision: long }).length,
    ).toBeLessThanOrEqual(2 * MAX_ALERT_CHARS + NOM_A.length + 30);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("CONTRÔLE [a] — jamais un message à deux projets", () => {
  it("[a] un projet qui contient DEUX chemins est refusé par tous les gabarits", () => {
    const deux = `${PROJET_A} ${PROJET_B}`;
    expect(projectShortName(deux)).toBe("");
    expect(buildStartMessage({ project: deux, action: "travail en cours" })).toBe("");
    expect(buildEndMessage({ project: deux, ok: true, result: "livré" })).toBe("");
    expect(buildAlertMessage({ project: deux, problem: "bloqué", decision: "relancer" })).toBe("");
    expect(buildAssistantMessage({ project: deux, text: "voilà" })).toBe("");
  });

  it("[a] une publication à deux projets n'envoie rien du tout", () => {
    const etat = publishOwnerEvent({
      type: TELEGRAM_MESSAGE_TYPES.END,
      project: `${PROJET_A} ${PROJET_B}`,
      ok: true,
      result: "terminé",
    });
    expect(etat.status).toBe("empty");
    expect(envoyes).toEqual([]);
  });

  it("[a] deux projets = deux messages DISTINCTS, jamais fusionnés", () => {
    publishOwnerEvent({
      type: TELEGRAM_MESSAGE_TYPES.END,
      project: PROJET_A,
      ok: true,
      result: "livré",
    });
    publishOwnerEvent({
      type: TELEGRAM_MESSAGE_TYPES.END,
      project: PROJET_B,
      ok: true,
      result: "livré",
    });
    expect(envoyes).toEqual(["makefilm : livré — livré", "pilot : livré — livré"]);
    // Chaque message ne parle QUE de son projet.
    expect(envoyes[0]).not.toContain(NOM_B);
    expect(envoyes[1]).not.toContain(NOM_A);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("CONTRÔLE [b] — aucun détail technique dans un message", () => {
  const TECHNIQUE = {
    action:
      "correction de src/js/telegram-messages.js via openFile() — session 42, empreinte a3f5b2c1d4, 12 tests OK, branche feat/x",
    result:
      "le module `pilot-edit-gate.ts` a été corrigé (fonction openFile()), 3/4 tests échouaient, session 471, commit abc1234",
    testable: "lancer `npm test` dans G:\\IA_PL\\pilot\\src\\js puis relire handbook.md",
  };

  it("[b] DÉBUT : aucun chemin, fichier, fonction, session, empreinte ni compte", () => {
    const message = buildStartMessage({ project: PROJET_A, action: TECHNIQUE.action });
    expect(message.startsWith(`${NOM_A} : `)).toBe(true);
    expectAucunDetailTechnique(message);
  });

  it("[b] FIN : aucun détail technique, verdict de tests conservé (« tests OK/KO »)", () => {
    const ok = buildEndMessage({ project: PROJET_B, ok: true, result: TECHNIQUE.result });
    expectAucunDetailTechnique(ok);
    expect(ok).toContain("tests KO");
    const testable = buildEndMessage({
      project: PROJET_B,
      ok: true,
      testable: TECHNIQUE.testable,
    });
    expectAucunDetailTechnique(testable);
  });

  it("[b] ALERTE : aucun détail technique", () => {
    const message = buildAlertMessage({
      project: PROJET_A,
      problem: "blocage dans src-tauri/src/telegram.rs (fn notify_background, session 99)",
      decision: "relancer via run_agents() ou branche fix/x",
    });
    expectAucunDetailTechnique(message);
  });

  it("[b] aucune donnée technique ne fuit par la porte de publication", () => {
    publishOwnerEvent({
      type: TELEGRAM_MESSAGE_TYPES.END,
      project: PROJET_B,
      ok: false,
      result: TECHNIQUE.result,
    });
    expect(envoyes).toHaveLength(1);
    expectAucunDetailTechnique(envoyes[0]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("CONTRÔLE [c] — un évènement sans information utile n'envoie RIEN", () => {
  const CAS_SANS_INTERET = [
    ["étape intermédiaire", { type: TELEGRAM_MESSAGE_TYPES.START, project: PROJET_A }],
    ["préparation", { type: TELEGRAM_MESSAGE_TYPES.START, project: PROJET_A, action: "   " }],
    ["fin sans projet", { type: TELEGRAM_MESSAGE_TYPES.END, ok: true, result: "terminé" }],
    ["alerte sans décision", { type: TELEGRAM_MESSAGE_TYPES.ALERT, project: PROJET_A, problem: "bloqué" }],
    ["type inconnu", { type: "progress", project: PROJET_A, result: "50 %" }],
    ["texte vide", {}],
    [
      "texte réduit à du technique",
      { type: TELEGRAM_MESSAGE_TYPES.START, project: PROJET_A, action: "src/js/a.js" },
    ],
  ];

  it("[c] aucun envoi, et le statut le dit (`empty`)", () => {
    for (const [nom, event] of CAS_SANS_INTERET) {
      const etat = publishOwnerEvent(event);
      expect(etat.status, `cas « ${nom} »`).toBe("empty");
      expect(etat.text, `cas « ${nom} »`).toBe("");
    }
    expect(envoyes).toEqual([]);
  });

  it("[c] aucun message « tout va bien » ni accusé de réception", () => {
    // Ces textes ne sont plus des évènements : ils ne produisent rien.
    for (const texte of ["", "   ", "OK", "bien reçu"]) {
      expect(publishOwnerText(texte).status).toBe("empty");
    }
    expect(envoyes).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("CONTRÔLE [d] — une seule information, un seul message", () => {
  it("[d] la même information deux fois de suite ne part qu'une fois", () => {
    const event = {
      type: TELEGRAM_MESSAGE_TYPES.END,
      project: PROJET_A,
      ok: true,
      result: "livré",
    };
    expect(publishOwnerEvent(event).status).toBe("sent");
    horloge += 1000;
    expect(publishOwnerEvent(event).status).toBe("dropped");
    expect(envoyes).toEqual(["makefilm : livré — livré"]);
  });

  it("[d] une rafale de formulations proches = un seul envoi", () => {
    publishOwnerEvent({
      type: TELEGRAM_MESSAGE_TYPES.END,
      project: PROJET_A,
      ok: true,
      result: "le correctif est en place",
    });
    horloge += 5000;
    publishOwnerEvent({
      type: TELEGRAM_MESSAGE_TYPES.END,
      project: PROJET_A,
      ok: true,
      result: "le correctif est en place et vérifié",
    });
    expect(envoyes).toHaveLength(1);
  });

  it("[d] deux PROJETS différents ne sont jamais confondus (chacun son message)", () => {
    publishOwnerEvent({
      type: TELEGRAM_MESSAGE_TYPES.END,
      project: PROJET_A,
      ok: true,
      result: "livré",
    });
    horloge += 1000;
    publishOwnerEvent({
      type: TELEGRAM_MESSAGE_TYPES.END,
      project: PROJET_B,
      ok: true,
      result: "livré",
    });
    expect(envoyes).toHaveLength(2);
  });

  it("[d] la même information peut repartir après la fenêtre anti-rafale", () => {
    const event = { type: TELEGRAM_MESSAGE_TYPES.ALERT, project: PROJET_A, problem: "bloqué", decision: "relancer" };
    publishOwnerEvent(event);
    horloge += TELEGRAM_BURST_WINDOW_MS + 1;
    expect(publishOwnerEvent(event).status).toBe("sent");
    expect(envoyes).toHaveLength(2);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("CONTRÔLE [e] — le nom du projet est TOUJOURS en tête", () => {
  const MESSAGES = [
    ["début", buildStartMessage({ project: PROJET_A, action: "travail lancé" }), NOM_A],
    ["fin", buildEndMessage({ project: PROJET_B, ok: true, result: "livré" }), NOM_B],
    ["échec", buildEndMessage({ project: PROJET_A, ok: false, result: "boum" }), NOM_A],
    [
      "alerte",
      buildAlertMessage({ project: PROJET_B, problem: "bloqué", decision: "relancer" }),
      NOM_B,
    ],
    ["assistant", buildAssistantMessage({ project: PROJET_A, text: "voilà" }), NOM_A],
  ];

  it("[e] chaque type commence par « <projet> : » (alerte : « ⚠️ <projet> : »)", () => {
    for (const [type, message, nom] of MESSAGES) {
      expect(message, `type ${type}`).not.toBe("");
      expect(message.replace(/^⚠️ /, "").startsWith(`${nom} : `), `type ${type}`).toBe(true);
    }
  });

  it("[e] sans projet, aucun message n'est publié (jamais de message anonyme)", () => {
    for (const event of [
      { type: TELEGRAM_MESSAGE_TYPES.START, action: "travail" },
      { type: TELEGRAM_MESSAGE_TYPES.END, ok: true, result: "livré" },
      { type: TELEGRAM_MESSAGE_TYPES.ALERT, problem: "bloqué", decision: "relancer" },
      { type: TELEGRAM_MESSAGE_TYPES.ASSISTANT, text: "voilà" },
    ]) {
      expect(publishOwnerEvent(event).status).toBe("empty");
    }
    expect(envoyes).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("CONTRÔLE [f] — heures calmes 23 h → 7 h", () => {
  it("[f] la plage est reconnue (23 h, minuit, 6 h 59) et pas le reste", () => {
    expect(isQuietHours(NUIT)).toBe(true);
    expect(isQuietHours(PETIT_MATIN)).toBe(true);
    expect(isQuietHours(Date.parse("2026-05-06T06:59:00"))).toBe(true);
    expect(isQuietHours(REVEIL)).toBe(false);
    expect(isQuietHours(HEURE_PLEINE)).toBe(false);
    expect(msUntilQuietEnd(HEURE_PLEINE)).toBe(0);
    expect(msUntilQuietEnd(NUIT)).toBeGreaterThan(0);
  });

  it("[f] rien n'est envoyé pendant les heures calmes, mais rien n'est perdu", () => {
    const etat = publishOwnerEvent({
      type: TELEGRAM_MESSAGE_TYPES.END,
      project: PROJET_B,
      ok: true,
      result: "livré",
    });
    horloge = NUIT; // 23 h 30
    const nuit = publishOwnerEvent({
      type: TELEGRAM_MESSAGE_TYPES.END,
      project: PROJET_B,
      ok: true,
      result: "livré",
    });
    expect(etat.status).toBe("sent");
    expect(nuit.status).toBe("held");
    expect(envoyes).toHaveLength(1); // rien de plus la nuit
    expect(heldOwnerMessageCount()).toBe(1);
    // Remise à l'heure du réveil : le message retenu part une seule fois.
    const remis = flushHeldOwnerEvents(REVEIL, sender);
    expect(remis).toEqual(["pilot : livré — livré"]);
    expect(envoyes).toHaveLength(2);
  });

  it("[f] un danger IMMÉDIAT franchit les heures calmes", () => {
    horloge = PETIT_MATIN;
    expect(shouldDeliverNow({ danger: true }, horloge)).toBe(true);
    const etat = publishOwnerEvent({
      type: TELEGRAM_MESSAGE_TYPES.ALERT,
      project: PROJET_A,
      problem: "l'application ne démarre plus",
      decision: "la relancer ou restaurer la version précédente",
      danger: true,
    });
    expect(etat.status).toBe("sent");
    expect(envoyes).toHaveLength(1);
  });

  it("[f] la réserve des messages retenus est bornée", () => {
    horloge = NUIT;
    for (let i = 0; i < MAX_HELD_MESSAGES + 5; i += 1) {
      publishOwnerEvent({
        type: TELEGRAM_MESSAGE_TYPES.END,
        project: PROJET_B,
        ok: true,
        result: `livraison ${"x".repeat(i + 1)}`,
      });
    }
    expect(heldOwnerMessageCount()).toBe(MAX_HELD_MESSAGES);
    expect(envoyes).toEqual([]); // toujours rien la nuit
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("porte unique de publication", () => {
  it("un échec de l'envoyeur ne remonte jamais (jamais d'erreur visible)", () => {
    setTelegramGateDeps({
      send: () => {
        throw new Error("moteur indisponible");
      },
    });
    expect(() =>
      publishOwnerEvent({
        type: TELEGRAM_MESSAGE_TYPES.END,
        project: PROJET_A,
        ok: true,
        result: "livré",
      }),
    ).not.toThrow();
  });

  it("sans envoyeur, la publication ne fait rien et ne lève rien", () => {
    setTelegramGateDeps({ send: null });
    const etat = publishOwnerEvent({
      type: TELEGRAM_MESSAGE_TYPES.END,
      project: PROJET_A,
      ok: true,
      result: "livré",
    });
    // Le message était valide : il est simplement parti dans le vide.
    expect(etat.status).toBe("sent");
    expect(envoyes).toEqual([]);
  });
});
