// test-verdict.js — PORTE UNIQUE DU VERDICT DES TESTS (et du contrôle de style).
//
// Constat fermé ici (audit `docs/rapports/RAPPORT-voies-de-contournement-livraison.md`,
// trou C6) : la porte d'auto-test rendait `{ ran: false }` depuis SIX chemins
// (E2 désactivé, projet inconnu, baseline indisponible, aucun runner, commande
// non dérivable, exception d'exécution) SANS dire pourquoi, et l'appelant ne
// distinguait donc pas « non lancé » de « vert ». Le contrôle de style faisait
// pire : en cas d'erreur du linter il rendait `{ ok: true, hadChecker: false }`,
// c'est-à-dire un VERT qui n'avait rien vérifié.
//
// Règle tenue par ce module (et par lui seul) :
//     un verdict n'est « vert » QUE si le contrôle a réellement tourné et a
//     réellement réussi. Tout le reste est « non lancé » ou « non vérifié »,
//     avec sa cause en clair.
//
// Module PUR : aucune I/O, aucun DOM, aucun minuteur — testable directement.

/** États possibles d'un verdict. Un seul est « bon ». */
export const TEST_VERDICT_GREEN = "vert";
export const TEST_VERDICT_RED = "rouge";
export const TEST_VERDICT_NOT_RUN = "non-lance";
export const TEST_VERDICT_UNVERIFIED = "non-verifie";

/**
 * Causes d'un verdict « tests non lancés ». Chaque retour de la porte d'auto-test
 * qui n'exécute rien DOIT en nommer une : c'est ce qui rend le silence
 * impossible (un `{ ran: false }` nu ne peut plus être écrit — verrou
 * `verdict-tests-jamais-silencieux.test.js`).
 */
export const NOT_RUN_CAUSES = {
  /** L'auto-test post-modification (E2) est désactivé dans les réglages. */
  E2_DISABLED: "e2-desactive",
  /** Aucun projet ouvert : il n'y a rien à tester. */
  NO_PROJECT: "projet-inconnu",
  /** La baseline des tests n'a pas pu être établie (timeout, panne). */
  BASELINE_UNAVAILABLE: "baseline-indisponible",
  /** Aucun exécuteur de tests reconnu dans les manifestes du projet. */
  NO_RUNNER: "aucun-executeur",
  /** La commande de tests n'a pas pu être dérivée. */
  NO_COMMAND: "commande-inderivable",
  /** L'invocation des tests a levé une erreur. */
  EXECUTION_ERROR: "erreur-execution",
  /** Un `ran: false` écrit sans cause (ne devrait plus arriver) : dit tel quel. */
  UNNAMED: "cause-non-nommee",
};

/** Libellés lisibles — une phrase par cause, dite à l'écran telle quelle. */
const CAUSE_LABELS = {
  [NOT_RUN_CAUSES.E2_DISABLED]: "auto-test désactivé",
  [NOT_RUN_CAUSES.NO_PROJECT]: "aucun projet ouvert",
  [NOT_RUN_CAUSES.BASELINE_UNAVAILABLE]: "baseline des tests indisponible",
  [NOT_RUN_CAUSES.NO_RUNNER]: "aucun exécuteur de tests reconnu",
  [NOT_RUN_CAUSES.NO_COMMAND]: "commande de tests non dérivable",
  [NOT_RUN_CAUSES.EXECUTION_ERROR]: "l'invocation des tests a échoué",
  [NOT_RUN_CAUSES.UNNAMED]: "aucune raison nommée par l'appelant",
};

/** Causes d'un contrôle de style qui n'a rien vérifié. */
export const LINT_UNVERIFIED_CAUSES = {
  /** Aucun fichier à contrôler (tâche sans fichier). */
  NO_FILES: "aucun-fichier",
  /** Le contrôle de style a levé une erreur. */
  EXECUTION_ERROR: NOT_RUN_CAUSES.EXECUTION_ERROR,
  /** La commande a répondu quelque chose d'inexploitable. */
  UNEXPECTED_RESULT: "reponse-inexploitable",
  /** Aucun contrôleur disponible pour ce langage. */
  NO_CHECKER: "aucun-controleur",
};

/**
 * Fabrique le retour « rien n'a été exécuté ». C'EST LA SEULE FAÇON d'écrire
 * `ran: false` dans le front : la cause est obligatoire, donc jamais oubliable.
 * @param {string} cause une valeur de {@link NOT_RUN_CAUSES}
 * @returns {{ran: false, cause: string}}
 */
export function notRun(cause) {
  return { ran: false, cause: cause || NOT_RUN_CAUSES.E2_DISABLED };
}

/** Phrase d'une cause inconnue (jamais vide : on dit toujours quelque chose). */
function causeLabel(cause) {
  return CAUSE_LABELS[cause] || `raison non nommée (${cause || "aucune"})`;
}

/**
 * Verdict d'une porte de tests. Pure.
 *
 * « vert » EXIGE deux choses : le contrôle a tourné (`ran: true`) ET il a
 * réussi (`ok: true`). Un résultat absent, un `ran: false` nu, une exception :
 * tous « non lancé », jamais « vert ».
 *
 * @param {{ran?: boolean, ok?: boolean, cause?: string}|null|undefined} gate
 * @returns {{state: string, cause: string|null}}
 */
export function testVerdict(gate) {
  if (!gate || gate.ran !== true) {
    return { state: TEST_VERDICT_NOT_RUN, cause: (gate && gate.cause) || NOT_RUN_CAUSES.UNNAMED };
  }
  if (gate.ok === true) return { state: TEST_VERDICT_GREEN, cause: null };
  return { state: TEST_VERDICT_RED, cause: null };
}

/**
 * Vrai si — et seulement si — le verdict est « vert ». Le seul prédicat que
 * l'appelant doit utiliser pour conclure « les tests sont bons ».
 * @param {{state: string}|null|undefined} verdict
 */
export function isTestVerdictGreen(verdict) {
  return !!verdict && verdict.state === TEST_VERDICT_GREEN;
}

/**
 * Phrase affichable d'un verdict de tests. Un « non lancé » est écrit en clair,
 * avec sa raison : il ne peut pas être lu comme un vert.
 * @param {{state: string, cause?: string|null}|null|undefined} verdict
 */
export function testVerdictLabel(verdict) {
  const state = verdict && verdict.state;
  if (state === TEST_VERDICT_GREEN) return "🧪 Tests du projet : ✅ verts (le contrôle a réellement tourné).";
  if (state === TEST_VERDICT_RED) return "🧪 Tests du projet : ❌ en échec.";
  return `🧪 Tests du projet : ⏸ NON LANCÉS — ${causeLabel(verdict && verdict.cause)}.`;
}

/**
 * Verdict du contrôle de style (linting/syntaxe). Pure.
 *
 * Le piège fermé ici : `{ ok: true, hadChecker: false }` (erreur du linter ou
 * aucun contrôleur) n'est PAS un vert — c'est « non vérifié ». Seul
 * `ok: true` AVEC un contrôleur réellement passé est vert.
 *
 * @param {{ok?: boolean, hadChecker?: boolean, cause?: string}|null|undefined} lint
 * @returns {{state: string, cause: string|null}}
 */
export function lintVerdict(lint) {
  if (!lint) return { state: TEST_VERDICT_UNVERIFIED, cause: LINT_UNVERIFIED_CAUSES.NO_CHECKER };
  if (lint.ok === false && lint.hadChecker !== false) return { state: TEST_VERDICT_RED, cause: null };
  if (lint.ok === true && lint.hadChecker === true) return { state: TEST_VERDICT_GREEN, cause: null };
  return {
    state: TEST_VERDICT_UNVERIFIED,
    cause: lint.cause || LINT_UNVERIFIED_CAUSES.NO_CHECKER,
  };
}

/** Phrase affichable d'un verdict de contrôle de style. */
export function lintVerdictLabel(verdict) {
  const state = verdict && verdict.state;
  if (state === TEST_VERDICT_GREEN) return "🧹 Contrôle de style : ✅ passé.";
  if (state === TEST_VERDICT_RED) return "🧹 Contrôle de style : ❌ en échec.";
  const cause = (verdict && verdict.cause) || LINT_UNVERIFIED_CAUSES.NO_CHECKER;
  return `🧹 Contrôle de style : ⚠️ NON VÉRIFIÉ — ${
    cause === LINT_UNVERIFIED_CAUSES.NO_FILES ? "aucun fichier à contrôler" : causeLabel(cause)
  }.`;
}
