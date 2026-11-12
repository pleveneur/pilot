// Tests — LA VEILLE NE S'ARME PAS PENDANT QUE L'ASSISTANT TRAVAILLE OU PARLE
//
// LE DEFAUT (rapport docs/rapports/RAPPORT-vocal-veille-pendant-le-tour.md) : le
// compte de silence de 20 s (`VOCAL_ECOUTE_LIBRE_MS`) n'etait relance que par
// cinq evenements ponctuels (front montant du niveau micro, texte accepte par la
// garde du nom, sortie de veille, reveil d'une phrase, entree dans le mode). Il
// n'etait JAMAIS suspendu par le travail de l'assistant ni par sa lecture a voix
// haute : apres un reveil par le nom, le compte repartait a l'instant du nom et
// s'armait au milieu du tour. La veille s'activait donc en pleine conversation,
// l'ecran ne l'affichait pas, et la phrase suivante du proprietaire etait jetee
// sans message par la garde du nom.
//
// CE QUE CE FICHIER VERROUILLE :
//   1. LA DECISION PURE : pendant que Pilot parle (`pilotParle`) ou travaille
//      (`travaille`), la veille ne s'arme pas, meme si le compte est echu.
//   2. L'EXISTANT INTACT : hors de ces deux etats, 20 s de silence reel arment la
//      veille exactement comme avant (19 999 ms -> non, 20 000 ms -> oui) ; sans
//      les deux faits, la decision est celle d'AVANT (aucun appelant casse).
//   3. AUCUN SEUIL TOUCHE : `VOCAL_ECOUTE_LIBRE_MS` reste 20 000, une seule
//      occurrence de la valeur dans tout le depot.
//   4. LE BRANCHEMENT : la decision recoit les deux faits (lus dans l'etat de
//      conversation existant), le compte est suspendu pendant ces deux etats et
//      RELANCE A LA FIN d'un tour (`agent_end`) et d'une lecture a voix haute.
//      Un seul point d'application, comme avant : aucun second mecanisme.
//
// Les commentaires sont en ASCII ; les chaines d'interface sont copiees telles
// quelles.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  decideVocalVeille,
  vocalVeilleSuspendue,
  VOCAL_ECOUTE_LIBRE_MS,
} from "./vocal-nom-garde.js";
import { sliceSource } from "./source-slice.js";

const ICI = dirname(fileURLToPath(import.meta.url));
// Le source peut arriver en CRLF (runner Windows) : on normalise AVANT toute
// recherche d'ancre multi-lignes (quality-gate § 3.4).
const lire = (rel) => readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const SUPER = lire("src/js/super-agent.js");
const CODE = lire("src/js/vocal-nom-garde.js");

/** Corps d'une fonction (ancre de fin : la fermeture en colonne 2). */
function corpsFonction(src, entete) {
  return sliceSource(src, entete, "\n  }\n", 60);
}

// ---------------------------------------------------------------------------
describe("1. la decision PURE : le travail et la lecture suspendent la veille", () => {
  it("(a) pendant que l'assistant TRAVAILLE, 20 s ecoulees n'arment PAS la veille", () => {
    const vu = decideVocalVeille({
      modeOuvert: true,
      travaille: true,
      ecouleMs: VOCAL_ECOUTE_LIBRE_MS,
    });
    expect(vu.armer).toBe(false);
    expect(vu.raison).toBe("assistant-travaille");
    // Un tour peut durer 120 s, une lecture n'est pas bornee : meme tres
    // au-dela du delai, rien ne s'arme.
    expect(
      decideVocalVeille({ modeOuvert: true, travaille: true, ecouleMs: 120000 }).armer,
    ).toBe(false);
  });

  it("(b) pendant que l'assistant LIT sa reponse, idem", () => {
    const vu = decideVocalVeille({
      modeOuvert: true,
      pilotParle: true,
      ecouleMs: VOCAL_ECOUTE_LIBRE_MS,
    });
    expect(vu.armer).toBe(false);
    expect(vu.raison).toBe("pilot-parle");
    expect(
      decideVocalVeille({ modeOuvert: true, pilotParle: true, ecouleMs: 600000 }).armer,
    ).toBe(false);
  });

  it("(c) hors de ces deux etats, le comportement d'AVANT est conserve a l'identique", () => {
    // Le silence REEL de 20 s arme la veille, comme avant.
    expect(decideVocalVeille({ modeOuvert: true, ecouleMs: VOCAL_ECOUTE_LIBRE_MS - 1 })).toEqual({
      armer: false,
      raison: "silence-court",
    });
    expect(decideVocalVeille({ modeOuvert: true, ecouleMs: VOCAL_ECOUTE_LIBRE_MS })).toEqual({
      armer: true,
      raison: "silence-atteint",
    });
    // Un appelant qui ne passe AUCUN des deux faits (comportement d'avant, cas
    // d'un troisieme appelant eventuel) garde exactement l'ancienne decision.
    expect(decideVocalVeille({ modeOuvert: true, ecouleMs: VOCAL_ECOUTE_LIBRE_MS }).armer).toBe(true);
    // Et les etats a `false` ne suspendent rien.
    expect(
      decideVocalVeille({
        modeOuvert: true,
        pilotParle: false,
        travaille: false,
        ecouleMs: VOCAL_ECOUTE_LIBRE_MS,
      }).armer,
    ).toBe(true);
  });

  it("(d) les regles qui precedent gardent la priorite (hors mode, veille, reveil)", () => {
    expect(decideVocalVeille({ travaille: true, ecouleMs: 999999 })).toEqual({
      armer: false,
      raison: "hors-mode",
    });
    expect(
      decideVocalVeille({ modeOuvert: true, veilleArmee: true, travaille: true, ecouleMs: 999999 }),
    ).toEqual({ armer: false, raison: "deja-en-veille" });
    expect(
      decideVocalVeille({ modeOuvert: true, reveil: true, travaille: true, ecouleMs: 999999 }),
    ).toEqual({ armer: false, raison: "reveil" });
  });

  it("(e) `vocalVeilleSuspendue` ne regarde QUE ces deux faits", () => {
    expect(vocalVeilleSuspendue({})).toBe(false);
    expect(vocalVeilleSuspendue()).toBe(false);
    expect(vocalVeilleSuspendue({ pilotParle: true })).toBe(true);
    expect(vocalVeilleSuspendue({ travaille: true })).toBe(true);
    expect(vocalVeilleSuspendue({ pilotParle: true, travaille: true })).toBe(true);
    // Aucun autre fait ne suspend la veille : la dictee ouverte, une question en
    // attente et l'occupation du moteur ne sont pas des etats de conversation.
    expect(vocalVeilleSuspendue({ dicteeOuverte: true, question: true, occupe: true })).toBe(false);
  });

  it("(f) AUCUN seuil touche : 20 000 ms, une seule fois dans le depot", () => {
    expect(VOCAL_ECOUTE_LIBRE_MS).toBe(20000);
    expect((CODE.match(/VOCAL_ECOUTE_LIBRE_MS\s*=\s*20000/g) || []).length).toBe(1);
    // Aucune valeur en dur dans l'ecran.
    expect(SUPER).not.toMatch(/\b20[_,]?000\b/);
    // Aucun nouveau reglage : la decision ne lit aucune configuration.
    expect(corpsFonction(CODE, "export function decideVocalVeille(etats) {")).not.toMatch(
      /invoke\(|get_config|VOCAL_\w*_KEY/,
    );
  });
});

// ---------------------------------------------------------------------------
describe("2. le branchement : les deux faits arrives jusqu'a la decision", () => {
  it("la decision recoit `pilotParle` et `travaille`, lus dans l'etat EXISTANT", () => {
    // Les deux faits viennent de `vocalConversationState`, deja source unique de
    // l'etat de conversation : aucun nouveau drapeau, aucune seconde lecture.
    const etat = corpsFonction(SUPER, "  function vocalVeilleEtat() {");
    expect(etat).toContain("vocalConversationState()");
    expect(etat).toContain("pilotParle: base.pilotParle");
    expect(etat).toContain("travaille: base.reflechit");
    // `vocalVeilleEtat` ne fabrique aucun fait : il ne lit que ceux-la.
    expect(etat).not.toMatch(/vocalSpeaking\s*=[^=]|reflectingActive\s*=[^=]/);

    // LA DECISION EST CONSTRUITE A UN SEUL ENDROIT (`vocalVeilleDecision`), que
    // le minuteur du compte ET le reexamen periodique interrogent : la
    // factorisation ne retire aucune garantie, elle en ajoute une (une seule
    // construction, donc aucune regle recopiee dans un second appelant).
    const decision = corpsFonction(SUPER, "  function vocalVeilleDecision(veilleArmee) {");
    expect(decision).toContain("decideVocalVeille({");
    // Les deux faits sont passes a la decision PURE (aucune regle recopiee ici).
    expect(decision).toContain("...vocalVeilleEtat(),");
    expect(decision).not.toContain('raison === "silence-atteint"');
    const minuteur = corpsFonction(SUPER, "  function vocalRestartVeilleTimer() {");
    expect(minuteur).toContain("vocalVeilleDecision(vocalVeilleArmee)");
  });

  it("pendant ces deux etats, le compte n'est ni pose ni laisse tourner", () => {
    const minuteur = corpsFonction(SUPER, "  function vocalRestartVeilleTimer() {");
    // Refus de POSER le compte quand la veille est suspendue.
    expect(minuteur).toContain("if (vocalVeilleSuspendue(vocalVeilleEtat())) return;");
    // ...et il est place AVANT la programmation du minuteur : sinon un compte
    // continuerait de tourner pendant le tour.
    expect(minuteur.indexOf("vocalVeilleSuspendue(vocalVeilleEtat())")).toBeLessThan(
      minuteur.indexOf("vocalVeilleTimer = setTimeout("),
    );

    const sync = corpsFonction(SUPER, "  function vocalSyncVeilleSuspension() {");
    // Le compte est ANNULE pendant les deux etats...
    expect(sync).toContain("vocalVeilleSuspendue(vocalVeilleEtat())");
    expect(sync).toContain("clearVocalVeilleTimer();");
    // ...et RELANCE (de zero) a la fin : jamais une reprise a mi-chemin, jamais
    // un relancement permanent d'un compte deja en cours.
    expect(sync).toContain("vocalRestartVeilleTimer();");
    expect(sync).toContain("if (vocalVeilleTimer) return;");
    // Rien hors du mode Vocal, rien quand la garde est deja armee (etat stable).
    expect(sync).toContain("if (!vocalOverlay) return;");
    expect(sync).toContain("if (vocalVeilleArmee === true) return;");
  });

  it("UN SEUL point d'application par etat : etat visuel, fin de tour, fin de lecture", () => {
    // 1. Tout changement d'etat visuel (parole, reflexion) passe par
    //    `applyVocalState` : la suspension y est appliquee, avant la dictee (le
    //    compte ne lit que la parole et le travail).
    const etat = corpsFonction(SUPER, "  function applyVocalState() {");
    expect(etat).toContain("vocalSyncVeilleSuspension();");
    expect(etat.indexOf("vocalSyncVeilleSuspension();")).toBeLessThan(
      etat.indexOf("vocalSyncConversation();"),
    );

    // 2. FIN DE TOUR (`agent_end`) : le compte repart de zero, apres la lecture
    //    automatique (qui, elle, le suspend des sa premiere annonce).
    const finDeTour = sliceSource(
      SUPER,
      "if (!demandePartie) autoReadVocalReply();",
      "// ── Mode",
      200,
    );
    expect(finDeTour).toContain("vocalRestartVeilleTimer();");

    // 3. FIN DE LECTURE (le `parlait -> ne parle plus` deja disponible) : le
    //    compte repart de zero.
    const lecture = corpsFonction(SUPER, "  const onVocalReadAloudState = (e) => {");
    expect(lecture).toContain("vocalSpeaking = isReadAloudSpeaking(etat);");
    expect(lecture).toContain("if (parlait && !vocalSpeaking) vocalSyncVeilleSuspension();");
  });

  it("aucun second mecanisme : un seul compte de veille dans tout l'ecran", () => {
    // Un seul minuteur, une seule variable de compte, un seul `setTimeout` lie a
    // la veille.
    expect((SUPER.match(/vocalVeilleTimer = setTimeout\(/g) || []).length).toBe(1);
    expect((SUPER.match(/let vocalVeilleTimer/g) || []).length).toBe(1);
    // Aucun second module ne decide de la veille : la decision reste dans le
    // module pur et n'est appelee que par le compte.
    expect((SUPER.match(/decideVocalVeille\(\{/g) || []).length).toBe(1);
    // Aucun nouveau reglage / aucune nouvelle cle de configuration.
    expect(CODE).not.toMatch(/vocal_veille|VOCAL_VEILLE_KEY/);
    expect(SUPER).not.toMatch(/vocal_veille|VOCAL_VEILLE_KEY/);
  });
});
