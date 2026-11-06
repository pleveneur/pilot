/**
 * « Discussion seulement via llama » — verrous de la FENÊTRE.
 *
 * Ce que ces tests protègent : la case n'existe que si un personnage est actif,
 * le mode inactif ne change RIEN à l'écran, la sentinelle de la fiche et la
 * clé de configuration ne sont écrites qu'à un seul endroit (et sont bien les
 * mêmes que côté socle), et les phrases affichées viennent du socle.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  CONVERSATION_ONLY_KEY,
  DISCUSSION_ONLY_BADGE,
  DISCUSSION_ONLY_LABEL,
  FICHE_SENTINEL,
  ROLLBACK_LABEL,
  badgeVisible,
  checkboxChecked,
  checkboxVisible,
  emptyDiscussionState,
  ficheRequestPayload,
  ficheToolValue,
  interruptionPlan,
  isNoLocalModelError,
  keepDraftAfterSend,
  noLocalModelSentence,
  normalizeDiscussionState,
  optionsNotice,
  refusalSentence,
  rollbackVisible,
  sessionNotice,
  waitingPlan,
} from "./discussion-seule.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = resolve(ICI, "../..");
const lire = (p) => readFileSync(resolve(RACINE, p), "utf8").replace(/\r\n/g, "\n");

const ETAT_SANS_PERSONNAGE = normalizeDiscussionState({
  persona: "",
  active: false,
  fiche: "absente",
  options_line: "",
});

const ETAT_COCHE = normalizeDiscussionState({
  persona: "Sylvie",
  active: true,
  fiche: "ok",
  has_previous: true,
  options_line: "",
  badge: "Discussion seule",
  refusal_text: "Le modèle local de llama n'a pas répondu ; ton message est gardé : réessaie, ou décoche « Discussion seulement via llama ».",
  refusal_vocal: "Le modèle local n'a pas répondu ; ton message est gardé.",
  no_local_model: "Aucun modèle local n'est réglé pour ce personnage.",
  waiting_line: "J'attends le modèle local…",
  waiting_notice_ms: 3000,
  waiting_timeout_ms: 60000,
  fiche_tool: "ecrire_ma_fiche",
  fiche_sentinel: "PILOT_PERSONA_FICHE::",
});

describe("la case n'existe qu'avec un personnage actif", () => {
  it("sans personnage : aucune case, aucune pastille, aucune ligne", () => {
    expect(checkboxVisible(ETAT_SANS_PERSONNAGE)).toBe(false);
    expect(checkboxChecked(ETAT_SANS_PERSONNAGE)).toBe(false);
    expect(badgeVisible(ETAT_SANS_PERSONNAGE)).toBe(false);
    expect(optionsNotice(ETAT_SANS_PERSONNAGE)).toBe("");
    expect(rollbackVisible(ETAT_SANS_PERSONNAGE)).toBe(false);
  });

  it("avec un personnage : la case apparaît, décochée par défaut", () => {
    const etat = normalizeDiscussionState({ persona: "Sylvie", active: false, fiche: "ok" });
    expect(checkboxVisible(etat)).toBe(true);
    expect(checkboxChecked(etat)).toBe(false);
    expect(badgeVisible(etat)).toBe(false);
  });

  it("un nom fait uniquement d'espaces ne vaut pas un personnage", () => {
    const etat = normalizeDiscussionState({ persona: "   ", active: true });
    expect(checkboxVisible(etat)).toBe(false);
    expect(badgeVisible(etat)).toBe(false);
  });
});

describe("le mode actif se voit, sans rien ajouter d'autre", () => {
  it("la pastille est le libellé exact de la conception", () => {
    expect(badgeVisible(ETAT_COCHE)).toBe(true);
    expect(DISCUSSION_ONLY_BADGE).toBe("Discussion seule");
    expect(ETAT_COCHE.badge).toBe("Discussion seule");
  });

  it("le lien de retour n'apparaît qu'avec une version d'avant", () => {
    expect(rollbackVisible(ETAT_COCHE)).toBe(true);
    const sans = normalizeDiscussionState({ persona: "Sylvie", active: true, has_previous: false });
    expect(rollbackVisible(sans)).toBe(false);
  });

  it("les libellés sont ceux de la conception", () => {
    expect(DISCUSSION_ONLY_LABEL).toBe("Discussion seulement via llama");
    expect(ROLLBACK_LABEL).toBe("Revenir à la version précédente de la fiche");
  });
});

describe("l'état servi par le socle est lu sans invention", () => {
  it("une réponse incomplète ne peut jamais activer le mode", () => {
    const etat = normalizeDiscussionState({});
    expect(etat.active).toBe(false);
    expect(checkboxVisible(etat)).toBe(false);
  });

  it("une réponse absente ou d'un autre type retombe sur le défaut inactif", () => {
    for (const brut of [null, undefined, 42, "texte", []]) {
      const etat = normalizeDiscussionState(brut);
      expect(etat.active).toBe(false);
      expect(etat.persona).toBe("");
    }
  });

  it("un `active` qui n'est pas le booléen vrai n'active pas le mode", () => {
    for (const valeur of ["true", 1, "oui", {}]) {
      const etat = normalizeDiscussionState({ persona: "Sylvie", active: valeur });
      expect(etat.active).toBe(false);
    }
  });

  it("la ligne grise des Options vient du socle, jamais inventée ici", () => {
    const etat = normalizeDiscussionState({
      persona: "Sylvie",
      options_line: "Fiche absente — le personnage parle sans consigne.",
    });
    expect(optionsNotice(etat)).toBe("Fiche absente — le personnage parle sans consigne.");
    expect(optionsNotice(normalizeDiscussionState({ persona: "Sylvie" }))).toBe("");
  });
});

describe("la requête d'écriture de la fiche est reconnue par sa sentinelle", () => {
  it("rend la charge utile, et rien du tout pour une autre requête", () => {
    expect(ficheRequestPayload("PILOT_PERSONA_FICHE::", 'PILOT_PERSONA_FICHE::{"ton_et_parler":"douce"}')).toBe(
      '{"ton_et_parler":"douce"}',
    );
    expect(ficheRequestPayload("PILOT_PERSONA_FICHE::", "PILOT_ASSISTANT_PROMPT::{}")).toBe(null);
    expect(ficheRequestPayload("PILOT_PERSONA_FICHE::", "")).toBe(null);
    expect(ficheRequestPayload("PILOT_PERSONA_FICHE::", undefined)).toBe(null);
  });

  it("le compte rendu du socle est rendu tel quel au modèle", () => {
    expect(ficheToolValue("C'est écrit dans ta fiche (Ton et parler).")).toBe(
      "C'est écrit dans ta fiche (Ton et parler).",
    );
    // Une panne du socle ne fait jamais croire à une écriture réussie.
    expect(ficheToolValue("")).not.toContain("C'est écrit");
    expect(ficheToolValue(undefined)).not.toContain("C'est écrit");
  });
});

describe("attente et refus", () => {
  it("rien avant 3 s, la ligne d'attente ensuite, le refus après 60 s", () => {
    expect(waitingPlan(ETAT_COCHE, 0).showWaiting).toBe(false);
    expect(waitingPlan(ETAT_COCHE, 2999).showWaiting).toBe(false);
    expect(waitingPlan(ETAT_COCHE, 3000).showWaiting).toBe(true);
    expect(waitingPlan(ETAT_COCHE, 59_999).showRefusal).toBe(false);
    expect(waitingPlan(ETAT_COCHE, 60_000).showRefusal).toBe(true);
  });

  it("les délais par défaut sont ceux du socle (3 s et 60 s)", () => {
    const defaut = emptyDiscussionState();
    expect(defaut.waitingNoticeMs).toBe(3000);
    expect(defaut.waitingTimeoutMs).toBe(60000);
  });

  it("le refus a une version écrite et une version orale, toutes deux du socle", () => {
    expect(refusalSentence(ETAT_COCHE, false)).toContain("décoche");
    expect(refusalSentence(ETAT_COCHE, true)).toContain("message est gardé");
    expect(refusalSentence(normalizeDiscussionState({}), false)).toBe("");
  });

  it("le refus « aucun modèle local » est reconnu quand il remonte du socle", () => {
    expect(noLocalModelSentence(ETAT_COCHE)).toContain("Aucun modèle local");
    expect(isNoLocalModelError(ETAT_COCHE, "Erreur : " + noLocalModelSentence(ETAT_COCHE))).toBe(true);
    expect(isNoLocalModelError(ETAT_COCHE, "autre panne")).toBe(false);
    expect(isNoLocalModelError(normalizeDiscussionState({}), "peu importe")).toBe(false);
  });

  it("la désactivation du personnage est dite UNE fois, même hors du mode", () => {
    // Le mode n'est plus actif (plus de personnage) : la ligne doit pourtant
    // sortir, sinon l'utilisateur croit à une panne (§1.5).
    const vide = normalizeDiscussionState({
      persona: "",
      active: false,
      disabled_line: "Le personnage a été désactivé : l'assistant reprend son fonctionnement habituel.",
    });
    expect(badgeVisible(vide)).toBe(false);
    const dite = sessionNotice(vide, { disabled: false });
    expect(dite.key).toBe("disabled");
    expect(dite.text).toContain("l'assistant reprend son fonctionnement habituel");
    // Une seule fois : la seconde relecture ne redit rien.
    expect(sessionNotice(vide, { disabled: true })).toEqual({ text: "", key: "" });
    // Le texte est écrit dans le socle, jamais recopié dans la fenêtre.
    expect(lire("src-tauri/src/discussion_seule.rs")).toContain(
      "Le personnage a été désactivé : l'assistant reprend son fonctionnement habituel.",
    );
    expect(lire("src/js/discussion-seule.js")).not.toContain("a été désactivé :");
  });

  it("une réponse déjà reçue est gardée quand le local se coupe en pleine réponse", () => {
    const etat = normalizeDiscussionState({
      persona: "Nova",
      active: true,
      refusal_text: "Refus écrit.",
      partial_stop_line: "La réponse s'est arrêtée : le modèle local n'a plus répondu.",
    });
    // Texte déjà reçu : la réponse reste, SEULE la ligne grise du socle s'ajoute.
    const garde = interruptionPlan(etat, "Voici ce que je", false);
    expect(garde.keepAnswer).toBe(true);
    expect(garde.sentence).toBe("La réponse s'est arrêtée : le modèle local n'a plus répondu.");
    // Rien reçu : c'est le refus du §2.2 qui s'applique (message gardé).
    const rien = interruptionPlan(etat, "   ", false);
    expect(rien.keepAnswer).toBe(false);
    expect(rien.sentence).toBe("Refus écrit.");
    // La ligne grise est écrite dans le socle, jamais recopiée dans la fenêtre.
    expect(lire("src-tauri/src/discussion_seule.rs")).toContain(
      "La réponse s'est arrêtée : le modèle local n'a plus répondu.",
    );
    expect(lire("src/js/discussion-seule.js")).not.toContain("La réponse s'est arrêtée");
  });

  it("le refus à 60 secondes est armé par le socle, pas par une valeur locale", () => {
    const etat = normalizeDiscussionState({ persona: "Nova", active: true });
    expect(etat.waitingTimeoutMs).toBe(60000);
    expect(waitingPlan(etat, 59_999).showRefusal).toBe(false);
    expect(waitingPlan(etat, 60_000).showRefusal).toBe(true);
    const socle = lire("src-tauri/src/discussion_seule.rs");
    expect(socle).toMatch(/WAITING_TIMEOUT_MS: u64 = 60_000;/);
  });

  it("un envoi refusé garde le texte dans la barre", () => {
    expect(keepDraftAfterSend(false)).toBe(true);
    expect(keepDraftAfterSend(true)).toBe(false);
  });
});

describe("les deux lignes grises de la conversation (une seule fois chacune)", () => {
  const actif = (extra) =>
    normalizeDiscussionState({ persona: "Nova", active: true, ...extra });

  it("la ligne « sans consigne » vient du socle et ne se répète pas", () => {
    const etat = actif({ fiche: "vide", notice: "Ce personnage n'a pas encore de fiche remplie." });
    expect(sessionNotice(etat, {})).toEqual({
      text: "Ce personnage n'a pas encore de fiche remplie.",
      key: "notice",
    });
    expect(sessionNotice(etat, { notice: true })).toEqual({ text: "", key: "" });
  });

  it("rien n'est dit quand la fiche est utilisable, ni quand le mode est inactif", () => {
    expect(sessionNotice(actif({ fiche: "ok" }), {})).toEqual({ text: "", key: "" });
    expect(
      sessionNotice(normalizeDiscussionState({ persona: "Nova", active: false, notice: "x" }), {}),
    ).toEqual({ text: "", key: "" });
  });

  it("le changement de personnage se dit une fois, puis plus jamais", () => {
    const etat = actif({ persona_line: "Personnage actif : Nova." });
    expect(sessionNotice(etat, { persona: false })).toEqual({
      text: "Personnage actif : Nova.",
      key: "persona",
    });
    expect(sessionNotice(etat, { persona: true })).toEqual({ text: "", key: "" });
  });

  it("les deux phrases sont écrites dans le socle, jamais recopiées dans la fenêtre", () => {
    const socle = lire("src-tauri/src/persona_fiche.rs");
    expect(socle).toContain("Ce personnage n'a pas encore de fiche");
    const mode = lire("src-tauri/src/discussion_seule.rs");
    expect(mode).toContain('format!("Personnage actif : {}.", nom)');
    expect(lire("src/js/discussion-seule.js")).not.toContain("Personnage actif : ");
  });
});

describe("les valeurs partagées sont écrites une seule fois", () => {
  it("la sentinelle et la clé sont les mêmes que côté socle", () => {
    const rust = lire("src-tauri/src/discussion_seule.rs");
    const sentinelle = /pub const FICHE_SENTINEL: &str = "([^"]+)"/.exec(rust);
    const cle = /pub const CONVERSATION_ONLY_KEY: &str = "([^"]+)"/.exec(rust);
    const pastille = /pub const BADGE_LABEL: &str = "([^"]+)"/.exec(rust);
    expect(sentinelle?.[1]).toBe(FICHE_SENTINEL);
    expect(cle?.[1]).toBe(CONVERSATION_ONLY_KEY);
    expect(pastille?.[1]).toBe(DISCUSSION_ONLY_BADGE);
  });

  it("l'extension de la fiche porte la même sentinelle et le même outil", () => {
    const extension = lire("src-tauri/extensions/pilot-persona-fiche.ts");
    expect(extension).toContain(FICHE_SENTINEL);
    expect(extension).toContain("ecrire_ma_fiche");
    // Un seul outil : aucun outil de travail dans le mode.
    expect(extension.match(/pi\.registerTool\(/g)?.length).toBe(1);
  });
});
