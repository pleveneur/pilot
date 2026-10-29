// Tests — L'ÉCOUTE REPART TOUTE SEULE APRÈS CHAQUE RÉPONSE (écran Vocal)
//
// CE QUE CE FICHIER VERROUILLE — défaut signalé par le propriétaire :
// « En mode vocal, après chaque réponse de l'assistant, l'écoute doit repartir
// toute seule ; là, plus rien n'écoute et je dois cliquer sur le rond. »
//
// CAUSE (docs/rapports/RAPPORT-reprise-ecoute-auto.md, §2) : l'armement automatique
// était un COUP UNIQUE. La minuterie de reprise (600 ms après le dernier mot
// lu) était programmée une fois ; à l'échéance, `vocalApplyConversationPlan`
// rendait la main SANS RIEN reprogrammer dès que l'écran n'était pas exactement
// au repos — ce qui est le cas juste après une réponse (queue audio de la voix
// de Pilot, tour qui se referme, mesure du micro qui se réouvre, réponse de
// sensibilité encore en vol). La dictée restait fermée jusqu'au prochain geste.
//
//   1. Un refus PASSAGER est REPRIS (nombre borné), pas abandonné.
//   2. Un refus DÉFINITIF n'est jamais repris (projet sensible, arrêt manuel,
//      plafond des sessions vides, erreur, dictée indisponible, hors du mode).
//   3. Après une réponse — avec ou sans lecture — l'écoute s'ouvre seule.
//   4. JAMAIS d'ouverture pendant que Pilot parle.
//   5. Jamais de boucle : une seule minuterie, un nombre borné de reprises.
//   6. Le branchement est vérifié sur le SOURCE (une seule minuterie, une seule
//      voie de démarrage, halo inchangé) — fins de ligne normalisées
//      (quality-gate 3.4).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sliceSource } from "./source-slice.js";

import {
  VOCAL_ARM_AFTER_READ_MS,
  VOCAL_ARM_DELAY_MS,
  VOCAL_DICTATION_ARM,
  VOCAL_DICTATION_HOLD,
  VOCAL_RESUME_MAX_RETRIES,
  VOCAL_RESUME_RETRY_MS,
  VOCAL_RESUME_TRANSIENT_REASONS,
  decideVocalDictation,
  planVocalConversation,
  vocalResumeRetry,
} from "./vocal-conversation.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (nom) => readFileSync(join(ICI, nom), "utf8").replace(/\r\n/g, "\n");
// Les commentaires sont retirés : aucun verrou ne doit être satisfait par sa
// propre prose.
const sansCommentaires = (src) =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("/*") && !t.startsWith("*");
    })
    .join("\n");
const SUPER = sansCommentaires(lire("super-agent.js"));
const CONV = sansCommentaires(lire("vocal-conversation.js"));

/** État de repos complet de l'écran Vocal (tout est ouvert, rien ne bloque). */
const REPOS = {
  modeOuvert: true,
  projetSensible: false,
  pilotParle: false,
  reflechit: false,
  occupe: false,
  arretManuel: false,
  sessionsVides: false,
  erreur: "",
  transcription: true,
  apresLecture: false,
  sensibiliteConnue: true,
  sensibiliteIndisponible: false,
  mesureOuverte: true,
};

// ---------------------------------------------------------------------------
// Replique FIDÈLE de `vocalApplyConversationPlan` (super-agent.js) avec une
// horloge factice : une seule minuterie, décision RÉÉVALUÉE à chaque échéance,
// refus passager reprogrammé un nombre BORNÉ de fois. Le branchement RÉEL est
// verrouillé par les ancres de la section 6 : cette replique ne remplace pas la
// vérification du source, elle la complète (aucun test n'importe
// `super-agent.js`, qui a besoin d'un DOM complet).
function ecranVocal() {
  const ecran = {
    temps: 0,
    minuteur: null, // { quand, tentatives }
    ouvert: false,
    ouvertures: 0,
    echeances: 0,
  };

  // Corps du `setTimeout` réel : la décision est RÉÉVALUÉE, jamais supposée.
  function echeance(tentatives, etats) {
    ecran.echeances += 1;
    const d = decideVocalDictation({ ...etats(), dicteeOuverte: ecran.ouvert });
    if (d.action === VOCAL_DICTATION_ARM) {
      ecran.ouvert = true;
      ecran.ouvertures += 1;
      return null;
    }
    const relance = vocalResumeRetry(d.raison, tentatives);
    return relance ? { quand: ecran.temps + relance, tentatives: tentatives + 1 } : null;
  }

  /** Applique un plan (même ordre exact que la fonction de l'écran). */
  ecran.plan = (etats) => {
    const e = { ...etats(), dicteeOuverte: ecran.ouvert };
    const p = planVocalConversation(e, {
      dicteeOuverte: ecran.ouvert,
      minuteur: ecran.minuteur !== null,
    });
    if (p.couper) ecran.minuteur = null;
    if (p.desarmer) ecran.ouvert = false;
    if (!p.delai || ecran.minuteur) return p;
    ecran.minuteur = { quand: ecran.temps + p.delai, tentatives: 0 };
    return p;
  };

  /** Avance l'horloge ; `etats` est relu à CHAQUE échéance. */
  ecran.avance = (ms, etats) => {
    const fin = ecran.temps + ms;
    while (ecran.minuteur && ecran.minuteur.quand <= fin) {
      ecran.temps = ecran.minuteur.quand;
      ecran.minuteur = echeance(ecran.minuteur.tentatives, etats);
      if (ecran.ouvert) return ecran;
    }
    ecran.temps = fin;
    return ecran;
  };

  return ecran;
}

// ── 1. La règle pure : quels refus méritent une reprise ────────────────────
describe("1. la règle pure dit quels refus méritent une reprise", () => {
  it("les quatre refus PASSAGERS sont repris, avec le délai du module", () => {
    expect(VOCAL_RESUME_TRANSIENT_REASONS).toEqual([
      "pilot-parle",
      "tour-en-cours",
      "mesure-fermee",
      "sensibilite-inconnue",
    ]);
    for (const raison of VOCAL_RESUME_TRANSIENT_REASONS) {
      expect(vocalResumeRetry(raison, 0), raison).toBe(VOCAL_RESUME_RETRY_MS);
    }
    expect(VOCAL_RESUME_RETRY_MS).toBe(400);
  });

  it("les refus DÉFINITIFS ne sont JAMAIS repris (aucune relance en silence)", () => {
    for (const raison of [
      "projet-sensible",
      "hors-mode",
      "arret-manuel",
      "sessions-vides",
      "erreur",
      "sans-transcription",
      "sensibilite-indisponible",
      "deja-ouverte",
      "au-repos",
      "apres-lecture",
      "",
      "inconnue",
    ]) {
      expect(vocalResumeRetry(raison, 0), raison).toBe(0);
    }
    expect(vocalResumeRetry(null, 0)).toBe(0);
    expect(vocalResumeRetry(undefined, 0)).toBe(0);
  });

  it("la reprise est BORNÉE (aucune boucle possible)", () => {
    expect(VOCAL_RESUME_MAX_RETRIES).toBe(8);
    for (let i = 0; i < VOCAL_RESUME_MAX_RETRIES; i += 1) {
      expect(vocalResumeRetry("pilot-parle", i), String(i)).toBe(VOCAL_RESUME_RETRY_MS);
    }
    expect(vocalResumeRetry("pilot-parle", VOCAL_RESUME_MAX_RETRIES)).toBe(0);
    expect(vocalResumeRetry("pilot-parle", VOCAL_RESUME_MAX_RETRIES + 50)).toBe(0);
    // Le module reste PUR : aucune horloge, aucun effet.
    expect(CONV).not.toMatch(/setTimeout|setInterval|Date\.now|requestAnimationFrame/);
  });
});

// ── 2. Après une réponse, l'écoute repart toute seule ─────────────────────
describe("2. après une réponse, l'écoute repart toute seule", () => {
  it("sans lecture : l'armement du repos ouvre la dictée", () => {
    const ecran = ecranVocal();
    ecran.plan(() => REPOS);
    expect(ecran.minuteur.quand).toBe(VOCAL_ARM_DELAY_MS);
    ecran.avance(VOCAL_ARM_DELAY_MS, () => REPOS);
    expect(ecran.ouvert).toBe(true);
    expect(ecran.ouvertures).toBe(1);
  });

  it("après la lecture : l'armement de fin de lecture ouvre la dictée", () => {
    const ecran = ecranVocal();
    const apres = { ...REPOS, apresLecture: true };
    ecran.plan(() => apres);
    expect(ecran.minuteur.quand).toBe(VOCAL_ARM_AFTER_READ_MS);
    ecran.avance(VOCAL_ARM_AFTER_READ_MS, () => apres);
    expect(ecran.ouvert).toBe(true);
    expect(ecran.ouvertures).toBe(1);
  });

  it("le refus PASSAGER est rattrapé : la dictée s'ouvre quand l'état se pose", () => {
    // Cas réel : la mesure du micro n'est pas encore réouverte à l'échéance.
    const ecran = ecranVocal();
    ecran.plan(() => REPOS); // 350 ms
    ecran.avance(VOCAL_ARM_DELAY_MS, () => ({ ...REPOS, mesureOuverte: false }));
    // 1re échéance : refus passager `mesure-fermee`, minuterie reprogrammée.
    expect(ecran.ouvert).toBe(false);
    expect(ecran.minuteur).not.toBeNull();
    expect(ecran.minuteur.tentatives).toBe(1);
    ecran.avance(VOCAL_RESUME_RETRY_MS, () => ({ ...REPOS, mesureOuverte: false }));
    expect(ecran.ouvert).toBe(false);
    // La mesure se réouvre : la reprise suivante ouvre la dictée, sans geste.
    const ouvert = ecran.avance(VOCAL_RESUME_RETRY_MS, () => REPOS);
    expect(ouvert.ouvert).toBe(true);
    expect(ouvert.ouvertures).toBe(1);
  });
});

// ── 3. Jamais pendant que Pilot parle ─────────────────────────────────────
describe("3. jamais d'ouverture pendant que Pilot parle", () => {
  it("pendant la lecture, aucun armement — et la reprise reste bornée", () => {
    const ecran = ecranVocal();
    ecran.plan(() => REPOS); // une intention d'armement est en vol (350 ms)
    // La lecture démarre avant l'échéance : le micro ne doit jamais s'ouvrir.
    const lecture = () => ({ ...REPOS, pilotParle: true, apresLecture: false });
    ecran.avance(60_000, lecture);
    expect(ecran.ouvert).toBe(false);
    expect(ecran.ouvertures).toBe(0);
    // Les reprises s'arrêtent d'elles-mêmes : une échéance + MAX reprises.
    expect(ecran.echeances).toBe(1 + VOCAL_RESUME_MAX_RETRIES);
    expect(ecran.minuteur).toBeNull();
  });

  it("la lecture finie, la reprise suivante ouvre (jamais avant)", () => {
    const ecran = ecranVocal();
    ecran.plan(() => REPOS);
    const debut = ecran.temps;
    // Lecture de 2 s, puis fin de lecture : l'état est relu à chaque échéance.
    const etats = () => ({ ...REPOS, pilotParle: ecran.temps < debut + 2000, apresLecture: ecran.temps >= debut + 2000 });
    ecran.avance(2000, etats);
    expect(ecran.ouvert).toBe(false);
    // La fin de lecture réarme (marge plus longue), et l'écoute repart seule.
    ecran.plan(etats);
    ecran.avance(VOCAL_ARM_AFTER_READ_MS, etats);
    expect(ecran.ouvert).toBe(true);
    expect(ecran.ouvertures).toBe(1);
  });

  it("un tour en cours est un refus passager, jamais une ouverture", () => {
    const ecran = ecranVocal();
    ecran.plan(() => REPOS);
    ecran.avance(60_000, () => ({ ...REPOS, occupe: true }));
    expect(ecran.ouvert).toBe(false);
    expect(decideVocalDictation({ ...REPOS, occupe: true }).raison).toBe("tour-en-cours");
  });
});

// ── 4. Coupure volontaire et refus définitifs ─────────────────────────────
describe("4. une coupure volontaire (et les refus définitifs) ne se défait jamais", () => {
  it("après un arrêt manuel, aucune minuterie et aucune reprise", () => {
    const ecran = ecranVocal();
    const plan = ecran.plan(() => ({ ...REPOS, arretManuel: true }));
    expect(plan.delai).toBe(0);
    expect(ecran.minuteur).toBeNull();
    ecran.avance(60_000, () => ({ ...REPOS, arretManuel: true }));
    expect(ecran.ouvert).toBe(false);
    expect(ecran.echeances).toBe(0);
  });

  it("projet sensible, sessions vides, erreur : rien ne s'ouvre, rien ne se reprend", () => {
    for (const etat of [
      { ...REPOS, projetSensible: true },
      { ...REPOS, sessionsVides: true },
      { ...REPOS, erreur: "micro refusé" },
      { ...REPOS, transcription: false },
      { ...REPOS, sensibiliteIndisponible: true, sensibiliteConnue: false },
      { ...REPOS, modeOuvert: false },
    ]) {
      const ecran = ecranVocal();
      ecran.plan(() => etat);
      ecran.avance(60_000, () => etat);
      expect(ecran.ouvert, JSON.stringify(etat)).toBe(false);
      expect(ecran.echeances, JSON.stringify(etat)).toBe(0);
    }
  });

  it("une dictée déjà ouverte n'est jamais rouverte (aucune seconde session)", () => {
    const ecran = ecranVocal();
    ecran.plan(() => REPOS);
    ecran.avance(VOCAL_ARM_DELAY_MS, () => REPOS);
    expect(ecran.ouvertures).toBe(1);
    const encore = ecran.plan(() => REPOS);
    expect(encore.desarmer).toBe(false);
    expect(encore.delai).toBe(0);
    expect(decideVocalDictation({ ...REPOS, dicteeOuverte: true }).action).toBe(VOCAL_DICTATION_HOLD);
  });
});

// ── 5. Le branchement RÉEL (source vérifié) ───────────────────────────────
describe("5. le branchement réel dans l'écran", () => {
  const PLAN = () => sliceSource(SUPER, "function vocalApplyConversationPlan(plan) {", "\n  }\n", 400);

  it("la règle de reprise est IMPORTÉE du module pur (aucune copie dans l'écran)", () => {
    expect(SUPER).toMatch(/vocalResumeRetry,/);
    expect(SUPER).toContain('} from "./vocal-conversation.js";');
    // Aucun délai recopié dans l'écran : le nombre vient du module.
    expect(PLAN()).not.toMatch(/tentatives\s*[<>]=?\s*\d/);
    // Un seul APPEL dans l'écran (l'import n'est pas un appel).
    expect((SUPER.match(/vocalResumeRetry\(/g) || [])).toHaveLength(1);
  });

  it("UNE SEULE minuterie d'armement, et un nombre borné de reprises", () => {
    expect((SUPER.match(/vocalArmTimer = setTimeout\(/g) || [])).toHaveLength(1);
    const plan = PLAN();
    expect(plan).toContain("if (!plan.delai || vocalArmTimer) return;");
    expect(plan).toContain("const relance = vocalResumeRetry(decision.raison, tentatives);");
    expect(plan).toContain("tentatives: tentatives + 1,");
    // La décision reste RÉÉVALUÉE à l'échéance ; l'écran ne décide jamais seul.
    expect(plan).toContain("const decision = decideVocalDictation(vocalConversationState());");
    expect(plan).toContain("if (decision.action !== VOCAL_DICTATION_ARM) {");
    expect(plan).toContain("armVoiceInput();");
    // La reprise repasse par le MÊME point : aucun second chemin d'ouverture.
    expect(plan).toContain("vocalApplyConversationPlan({");
  });

  it("une seule voie d'ouverture de la dictée (aucun second moteur)", () => {
    expect((SUPER.match(/new SR\(\)/g) || [])).toHaveLength(1);
    const armement = sliceSource(SUPER, "function armVoiceInput() {", "\n  }\n", 100);
    expect(armement).toContain("startVoiceInput();");
    expect(armement).not.toContain("new SR()");
  });

  it("la fin de lecture pose toujours le drapeau de réarmement", () => {
    const etat = sliceSource(SUPER, "const onVocalReadAloudState = (e) => {", "\n  };", 400);
    expect(etat).toContain("if (parlait && !vocalSpeaking) vocalApresLecture = true;");
    expect(etat).toContain("applyVocalState();");
  });

  it("aucune API audio ajoutée, et le halo n'est pas touché", () => {
    // Le micro reste ouvert par `vocal-mic.js` seulement.
    expect(SUPER).not.toMatch(/getUserMedia|mediaDevices|AudioContext/);
    expect(CONV).not.toMatch(/getUserMedia|mediaDevices|AudioContext/);
    // Aucune apparence modifiée par ce correctif : le halo, l'objet lumineux et
    // la ligne d'état sont ceux du lot 2 (aucune règle CSS ajoutée ici).
    const css = lire("../css/style.css");
    expect(css).toMatch(/\.pilot-vocal/);
  });
});
