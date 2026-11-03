// Verrou du lot B, trou C6 (docs/rapports/RAPPORT-voies-de-contournement-livraison.md) :
// UN VERDICT « TESTS NON LANCÉS » NE PEUT PLUS PASSER POUR UN « VERT », ET LE
// CONTRÔLE DE STYLE NE PEUT PLUS LAISSER PASSER EN CAS DE PROBLÈME.
//
// Ce qui était ouvert, mesuré sur la source :
//   - la porte d'auto-test rendait `{ ran: false }` depuis SIX chemins sans dire
//     pourquoi : l'appelant ne pouvait pas distinguer « rien n'a tourné » de
//     « tout est vert » ;
//   - le contrôle de style rendait `{ ok: true, hadChecker: false }` quand le
//     linter était en panne, c'est-à-dire un VERT qui n'avait rien vérifié.
//
// Le verrou tient en deux étages, et refuse de les mélanger :
//   1. la DÉCISION, pure (`src/js/test-verdict.js`) — testée directement ;
//   2. le CÂBLAGE dans `src/js/agent-pi.js` — vérifié sur la source
//      (commentaires retirés), parce qu'une décision que personne n'applique ne
//      ferme aucun trou.
//
// Preuve par mutation : remettre un `return { ran: false };` dans `runTestGate`,
// ou `{ ok: true, hadChecker: false, output }` sans cause dans `runLintCheck`,
// fait échouer ce bloc — et lui seul.
//
// La lecture normalise les fins de ligne (worktree CRLF) :
// cf. `.pi/skills/quality-gate/SKILL.md` § 3.4.

import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

import {
  LINT_UNVERIFIED_CAUSES,
  NOT_RUN_CAUSES,
  TEST_VERDICT_GREEN,
  TEST_VERDICT_NOT_RUN,
  TEST_VERDICT_RED,
  isTestVerdictGreen,
  lintVerdict,
  lintVerdictLabel,
  notRun,
  testVerdict,
  testVerdictLabel,
} from "./test-verdict.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(HERE, "agent-pi.js"), "utf8").replace(/\r\n/g, "\n");

/** Le code sans les commentaires : la prose ne doit pas satisfaire un verrou. */
function sansCommentaires(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");
}

/** Corps d'une fonction déclarée à l'indentation de module (2 espaces). */
function corpsDeFonction(nom) {
  const code = sansCommentaires(SOURCE);
  const debut = code.indexOf(`  function ${nom}(`);
  const debutAsync = code.indexOf(`  async function ${nom}(`);
  const start = debutAsync !== -1 ? debutAsync : debut;
  expect(start, `fonction ${nom} introuvable`).toBeGreaterThan(-1);
  const reste = code.slice(start);
  // Fin : la prochaine déclaration de fonction au même niveau.
  const fin = reste.slice(1).search(/\n {2}(async )?function /);
  return fin === -1 ? reste : reste.slice(0, fin + 1);
}

const CODE = sansCommentaires(SOURCE);

// ── 1. La décision : « non lancé » n'est jamais « vert » ────────────────────
describe("porte du verdict — un non lancé n'est jamais un vert", () => {
  it("un retour sans exécution n'est PAS vert, et sa cause est nommable", () => {
    for (const cause of Object.values(NOT_RUN_CAUSES)) {
      const v = testVerdict(notRun(cause));
      expect(v.state).toBe(TEST_VERDICT_NOT_RUN);
      expect(v.cause).toBe(cause);
      expect(isTestVerdictGreen(v)).toBe(false);
      // La phrase dite à l'écran nomme la raison : pas de « ⏸ » muet.
      expect(testVerdictLabel(v)).toContain("NON LAN");
    }
  });

  it("un `{ ran: false }` nu est quand même attrapé — et signalé comme tel", () => {
    // Cas d'un appelant qui n'aurait pas utilisé `notRun()`.
    const v = testVerdict({ ran: false });
    expect(v.state).toBe(TEST_VERDICT_NOT_RUN);
    expect(isTestVerdictGreen(v)).toBe(false);
    expect(v.cause).toBe(NOT_RUN_CAUSES.UNNAMED);
  });

  it("un résultat absent compte comme non lancé (jamais vert)", () => {
    for (const rien of [null, undefined, 0, "", "vert"]) {
      const v = testVerdict(rien);
      expect(v.state).toBe(TEST_VERDICT_NOT_RUN);
      expect(isTestVerdictGreen(v)).toBe(false);
    }
  });

  it("vert exige DEUX choses : avoir tourné ET avoir réussi", () => {
    expect(testVerdict({ ran: true, ok: true }).state).toBe(TEST_VERDICT_GREEN);
    expect(isTestVerdictGreen(testVerdict({ ran: true, ok: true }))).toBe(true);
    // Avoir réussi sans avoir tourné ne suffit pas...
    expect(testVerdict({ ok: true }).state).toBe(TEST_VERDICT_NOT_RUN);
    expect(isTestVerdictGreen(testVerdict({ ok: true }))).toBe(false);
    // ...et avoir tourné sans réussir n'est pas vert non plus.
    expect(testVerdict({ ran: true, ok: false }).state).toBe(TEST_VERDICT_RED);
    expect(isTestVerdictGreen(testVerdict({ ran: true, ok: false }))).toBe(false);
  });

  it("le prédicat « vert » ne rend jamais vrai sur autre chose qu'un vert", () => {
    const faux = [
      null,
      undefined,
      {},
      { state: TEST_VERDICT_RED },
      { state: TEST_VERDICT_NOT_RUN },
      { state: "vert-avec-reserve" },
    ];
    for (const v of faux) expect(isTestVerdictGreen(v)).toBe(false);
  });
});

// ── 2. La décision : un contrôle de style en panne n'est pas un « ok » ──────
describe("porte du contrôle de style — une panne de linter n'est pas un vert", () => {
  it("l'ancien vert fail-open est désormais « non vérifié »", () => {
    const v = lintVerdict({ ok: true, hadChecker: false });
    expect(v.state).not.toBe(TEST_VERDICT_GREEN);
    expect(lintVerdictLabel(v)).toContain("NON V");
  });

  it("un linter réellement en panne d'exécution n'est pas un vert", () => {
    const v = lintVerdict({
      ok: true,
      hadChecker: false,
      cause: LINT_UNVERIFIED_CAUSES.EXECUTION_ERROR,
    });
    expect(v.state).not.toBe(TEST_VERDICT_GREEN);
    // La phrase nomme la panne : « l'invocation des tests a échoué » vient du
    // libellé de cause partagé.
    expect(lintVerdictLabel(v)).toContain("NON V");
  });

  it("un linter qui a réellement tourné et réussi est vert", () => {
    const v = lintVerdict({ ok: true, hadChecker: true });
    expect(v.state).toBe(TEST_VERDICT_GREEN);
    expect(lintVerdictLabel(v)).toContain("✅");
  });

  it("un linter qui a réellement trouvé une erreur est rouge", () => {
    const v = lintVerdict({ ok: false, hadChecker: true });
    expect(v.state).toBe(TEST_VERDICT_RED);
    expect(lintVerdictLabel(v)).toContain("❌");
  });

  it("aucun résultat du tout n'est pas un vert", () => {
    for (const rien of [null, undefined, {}]) {
      expect(lintVerdict(rien).state).not.toBe(TEST_VERDICT_GREEN);
    }
  });
});

// ── 3. Le câblage dans agent-pi.js ──────────────────────────────────────────
describe("câblage dans agent-pi.js", () => {
  it("la porte est importée depuis un seul module", () => {
    expect(CODE).toMatch(/from "\.\/test-verdict\.js"/);
    expect(CODE).toContain("notRun");
    expect(CODE).toContain("testVerdict");
    expect(CODE).toContain("lintVerdict");
  });

  it("runTestGate ne rend plus AUCUN `ran: false` nu", () => {
    const corps = corpsDeFonction("runTestGate");
    expect(corps).not.toBe("");
    // Le cœur du verrou : plus un seul retour silencieux.
    expect(corps).not.toMatch(/ran:\s*false/);
    // Chaque sortie sans exécution passe par la fabrique, qui exige une cause.
    expect(corps).toContain("notRun(");
    // ...et CHAQUE cause déclarée est nommée par une sortie (sauf celle qui
    // signale justement un appelant qui n'en aurait pas donné).
    for (const [nom, cause] of Object.entries(NOT_RUN_CAUSES)) {
      if (cause === NOT_RUN_CAUSES.UNNAMED) continue;
      expect(corps, `cause ${nom} jamais rendue`).toContain(`NOT_RUN_CAUSES.${nom}`);
    }
  });

  it("runLintCheck ne rend plus le vert fail-open sans cause", () => {
    // Interdiction à l'échelle du fichier : c'est la forme exacte du trou.
    expect(CODE).not.toMatch(/ok:\s*true,\s*hadChecker:\s*false/);
    const corps = corpsDeFonction("runLintCheck");
    expect(corps).not.toBe("");
    // Tout retour qui déclare `hadChecker: false` doit nommer sa cause.
    const objets = corps.match(/\{[^{}]*hadChecker:\s*false[^{}]*\}/g) || [];
    expect(objets.length).toBeGreaterThan(0);
    for (const obj of objets) expect(obj).toContain("cause:");
  });

  it("le verdict est DIT à l'écran, pas seulement calculé", () => {
    // Un « non lancé » affiché : la promesse du module est tenue.
    expect(CODE).toContain("appendSystemMessage(messagesEl, testVerdictLabel(testGateVerdict))");    for (const appel of ["testVerdict(", "testVerdictLabel(", "lintVerdict(", "lintVerdictLabel("]) {
      expect(CODE, `${appel} jamais appelé`).toContain(appel);
    }
    // Le verdict de la porte gouverne la correction, plus `ran` lu à la main.
    expect(CODE).toContain("testGateVerdict.state === TEST_VERDICT_RED");
  });
});
