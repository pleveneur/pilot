// Tests — UNE QUESTION AFFICHEE DANS L'ECRAN VOCAL REND LA ZONE DE SAISIE ET
// SES BOUTONS PLEINEMENT ACTIFS (complément a
// `spec_modes_ecran_vocal.md` §4bis).
//
// LE DEFAUT (rapport `docs/rapports/RAPPORT-question-utilisable-ecran-vocal.md`) :
//   - la question s'affichait bien dans l'ecran Vocal (correctif precedent :
//     la rangee `#pendingBar` est DEPLACEE dans `.vocal-input`), mais la ZONE
//     DE SAISIE n'y recevait jamais le curseur a son arrivee : ni `enterVocal`
//     ni `applyVocalState` ne tournent quand une question arrive — le seul
//     point appele a chaque changement de la file est
//     `pendingQuestionChromeSync`, et il ne s'occupait que de la VISIBILITE du
//     bas. Il fallait donc cliquer dans le champ avant de pouvoir ecrire ou
//     dicter sa reponse ;
//   - la rangee PEINT dans `.vocal-input`, mais le disque, lui, est `position:
//     relative` dans `.vocal-stage` (un des six hôtes cliquables de #381) et il
//     peint AU-DELA de sa boite : sur une fenetre basse, une question de 140 px
//     plus le bouton de depannage du micro ecrasent la scene alors que le
//     disque ne descend pas sous 120 px. Le bas du disque pouvait donc couvrir
//     le haut de la rangee et avaler le clic : un bouton qui ne repond pas du
//     premier coup ;
//   - enfin le geste 🎙️ ne servait a rien face a une question : la regle 4b
//     refermait la dictee ouverte dans la milliseconde qui suivait le clic, et
//     l'ecran promettait une dictee impossible. « Dicter sa reponse » etait
//     donc hors d'atteinte.
//
// CE QUE CE FICHIER VERROUILLE :
//   1. Le curseur est donne a l'ARRIVEE d'une nouvelle question (et seulement
//      la, seulement en mode Vocal, jamais par-dessus une modale, jamais en
//      re-rendu) — decision PURE `src/js/vocal-question-utilisable.js` ;
//   2. le point unique qui l'applique est `pendingQuestionChromeSync`, deja
//      appele a chaque changement de la file : aucun second mecanisme ;
//   3. la saisie REPOND a la question par le chemin existant (`send` detourne
//      l'envoi vers `validatePendingQuestion`), donc taper OU DICTER repond ;
//   4. la zone de saisie et sa rangee sont peintes DEVANT la scene : aucun
//      decor ne peut avaler le clic ;
//   5. une dictee ouverte par un GESTE n'est pas refermee par la question.
//
// Les commentaires sont en ASCII ; les extraits lus sont copies tels quels.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// Decoupage VERIFIE : une ancre absente LEVE (quality-gate §3.4).
import { sliceSource, neutraliserSource } from "./source-slice.js";
import {
  decideVocalQuestionFocus,
  planVocalQuestionFocus,
} from "./vocal-question-utilisable.js";
import {
  decideVocalDictation,
  VOCAL_DICTATION_ARM,
  VOCAL_DICTATION_DISARM,
  VOCAL_DICTATION_HOLD,
} from "./vocal-conversation.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) =>
  readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const CSS = lire("src/css/style.css");
const SUPER = lire("src/js/super-agent.js");

/** Corps d'une fonction de `super-agent.js` (indentation de 2 espaces). */
const corpsFonction = (src, entete, fin) => sliceSource(src, entete, fin, 2);

// Le POINT UNIQUE d'activation d'une question : le rappel pose par
// `createSuperAgent` et appele par `renderActivePendingQuestion`.
const HOOK = corpsFonction(
  SUPER,
  "  pendingQuestionChromeSync = () => {",
  "\n  };\n",
);
// Le rendu de la tete de file (la rangee de boutons).
const RENDU = corpsFonction(
  SUPER,
  "function renderActivePendingQuestion() {",
  "function enqueuePendingQuestion(q) {",
);
// Le seul point d'envoi de l'ecran (Entree, bouton Envoyer, fin de dictee).
const SEND = corpsFonction(SUPER, "  async function send() {", "\n  }\n");
// Les deux seuls appelants de `startVoiceInput` (le geste et l'armement auto).
const TOGGLE = corpsFonction(SUPER, "  function toggleVoiceInput() {", "\n  }\n");
const ARMEMENT = corpsFonction(SUPER, "  function armVoiceInput() {", "\n  }\n");
const ETAT_VOCAL = corpsFonction(
  SUPER,
  "  function vocalConversationState() {",
  "\n  }\n",
);

describe("1. le curseur est donne a l'ARRIVEE d'une nouvelle question", () => {
  it("une question qui s'affiche prend le curseur", () => {
    expect(
      decideVocalQuestionFocus({
        vocal: true,
        questionId: "q1",
        modalOuverte: false,
        dejaConcentre: "",
      }),
    ).toBe(true);
  });

  it("hors du mode Vocal, le curseur n'est JAMAIS pris au reste de l'app", () => {
    // Editor, autre champ, barre de l'onglet : rien ne bouge. C'est la premiere
    // regle, et elle passe avant toutes les autres.
    expect(
      decideVocalQuestionFocus({
        vocal: false,
        questionId: "q1",
        modalOuverte: false,
        dejaConcentre: "",
      }),
    ).toBe(false);
  });

  it("sans question en attente, le champ n'est pas reveille", () => {
    expect(
      decideVocalQuestionFocus({
        vocal: true,
        questionId: "",
        modalOuverte: false,
        dejaConcentre: "",
      }),
    ).toBe(false);
    expect(planVocalQuestionFocus({ vocal: true, questionId: null })).toEqual({
      focus: false,
      memoire: "",
    });
  });

  it("une modale ouverte garde le curseur (meme garde que `applyVocalState`)", () => {
    expect(
      decideVocalQuestionFocus({
        vocal: true,
        questionId: "q1",
        modalOuverte: true,
        dejaConcentre: "",
      }),
    ).toBe(false);
  });

  it("un RE-RENDU (clic d'un choix multiple) ne retire pas le curseur au champ", () => {
    // Le rendu de la rangee est rappelle a chaque clic d'un choix multiple : sans
    // cette memoire, le curseur serait pris et repris sous les doigts de
    // l'utilisateur au milieu de sa selection.
    expect(
      decideVocalQuestionFocus({
        vocal: true,
        questionId: "q1",
        modalOuverte: false,
        dejaConcentre: "q1",
      }),
    ).toBe(false);
  });

  it("la question SUIVANTE prend le curseur a son tour (aucune perte)", () => {
    // Sequence reelle : q1 arrive (curseur), l'utilisateur clique un choix
    // (re-rendu : pas de vol), q1 est repondue (la file avance), q2 arrive.
    const premiere = planVocalQuestionFocus({ vocal: true, questionId: "q1" });
    expect(premiere).toEqual({ focus: true, memoire: "q1" });
    const reRendu = planVocalQuestionFocus({
      vocal: true,
      questionId: "q1",
      dejaConcentre: premiere.memoire,
    });
    expect(reRendu).toEqual({ focus: false, memoire: "q1" });
    const suivante = planVocalQuestionFocus({
      vocal: true,
      questionId: "q2",
      dejaConcentre: reRendu.memoire,
    });
    expect(suivante).toEqual({ focus: true, memoire: "q2" });
    // Plus de question : la memoire est effacee, donc une question ulterieure
    // reprendra le curseur meme si son identifiant ressemblait a l'ancien.
    expect(planVocalQuestionFocus({ vocal: true, questionId: "" })).toEqual({
      focus: false,
      memoire: "",
    });
  });
});

describe("2. un SEUL point applique la regle (aucun second mecanisme)", () => {
  it("`pendingQuestionChromeSync` donne le curseur au champ", () => {
    // Sans ces deux lignes, la question s'affichait mais la saisie restait
    // inerte : il fallait cliquer dans le champ avant d'ecrire ou de dicter.
    expect(HOOK).toContain("planVocalQuestionFocus({");
    expect(HOOK).toContain("inputEl.focus();");
  });

  it("la decision n'est pas reecrite sur place : elle vient du module pur", () => {
    expect(HOOK).toContain("vocal: true,");
    expect(HOOK).toContain("questionId:");
    expect(HOOK).toContain("modalOuverte:");
    expect(HOOK).toContain("dejaConcentre: vocalQuestionFocused,");
    // Aucun second juge : pas de test d'identifiant ecrit ici.
    expect(HOOK).not.toMatch(/!==\s*tete/);
  });

  it("le point unique est bien celui appele a CHAQUE changement de la file", () => {
    // `renderActivePendingQuestion` est le seul endroit ou une question
    // s'affiche (arrivee, reponse, avancement de la file) : c'est donc le seul
    // branchement necessaire, et il existe deja.
    expect(RENDU).toContain("pendingQuestionChromeSync()");
    const appel = RENDU.indexOf("pendingQuestionChromeSync()");
    const placeholder = RENDU.indexOf("pendingInputEl.placeholder");
    expect(placeholder).toBeGreaterThan(-1);
    expect(placeholder).toBeLessThan(appel);
  });

  it("aucun minuteur : une question humaine n'expire pas", () => {
    expect(HOOK).not.toContain("setTimeout");
    expect(HOOK).not.toContain("setInterval");
    expect(RENDU).not.toContain("setTimeout");
    expect(RENDU).not.toContain("setInterval");
  });

  it("aucun second affichage : la question reste la rangee existante", () => {
    // Le seul rendu est `pendingQuestions[0]` dans `pendingBarEl` : ce fichier
    // ne cree ni second conteneur, ni seconde file.
    expect(RENDU).toContain("const q = pendingQuestions[0];");
    expect(SUPER.match(/pendingQuestions\.push\(/g)).toHaveLength(1);
  });
});

describe("3. la saisie REPOND a la question (taper ou dicter)", () => {
  it("`send` detourne l'envoi vers la question tant qu'une question attend", () => {
    // C'est le chemin EXISTANT : Entree, le bouton Envoyer et la fin de dictee
    // (`applyVoiceEnd` -> `send`) passent tous par ici. La reponse tapee ou
    // DICTEE dans la zone de saisie repond donc a la question, et la question
    // se referme (`validatePendingQuestion` -> fin de question -> file avancee).
    expect(SEND).toContain("hasPendingQuestion()");
    expect(SEND).toContain("validatePendingQuestion(inputEl.value);");
    // Detour AVANT l'envoi normal : le texte ne part pas comme une demande.
    const detour = SEND.indexOf("validatePendingQuestion(inputEl.value);");
    const normal = SEND.indexOf("if (!text) return;");
    expect(normal).toBeGreaterThan(-1);
    expect(detour).toBeLessThan(normal);
    expect(SEND).toContain("return;");
  });

  it("`send` coupe d'abord la lecture a voix haute en mode Vocal", () => {
    // Une reponse dictee pendant que Pilot lit serait parlee par-dessus lui.
    const arret = SEND.indexOf("stopReading()");
    const detour = SEND.indexOf("validatePendingQuestion(inputEl.value);");
    expect(arret).toBeGreaterThan(-1);
    expect(arret).toBeLessThan(detour);
  });
});

describe("4. la saisie et ses boutons sont DEVANT la scene (aucun clic avale)", () => {
  const BLOC_INPUT = sliceSource(CSS, ".vocal-input {", "}", 80);

  it("la zone de saisie est peinte au-dessus de la scene", () => {
    // Le disque peint au-dela de sa boite sur une fenetre basse : sans ordre de
    // peinture explicite il passerait devant la rangee et avalerait le clic du
    // haut des boutons.
    expect(BLOC_INPUT).toContain("position: relative;");
    expect(BLOC_INPUT).toMatch(/z-index:\s*1;/);
  });

  it("elle ne change pas la mise en page (aucun decalage, aucune taille)", () => {
    // `position: relative` sans `top/left/right/bottom` ne deplace rien : la
    // disposition de l'ecran Vocal reste celle du lot 2 + §2.7.
    expect(BLOC_INPUT).not.toMatch(/\b(top|left|right|bottom):/);
    expect(BLOC_INPUT).not.toContain("position: absolute");
  });

  it("elle reste sous le logo des trois modes et sous « Travail »", () => {
    // Ces deux noeuds vivent dans la bande du haut (z-index 2 et 3) : la saisie
    // ne doit pas passer devant eux.
    const logo = sliceSource(CSS, "body.pilot-vocal-active #mode-logo {", "}", 40);
    expect(logo).toMatch(/z-index:\s*2;/);
    const travail = sliceSource(
      CSS,
      "body.pilot-vocal-active #agent-activity {",
      "}",
      40,
    );
    expect(travail).toMatch(/z-index:\s*3;/);
  });

  it("aucun nouveau hote cliquable : la liste de #381 reste a SIX entrees", () => {
    // La rangee de questions herite du `pointer-events: auto` de `.vocal-input`
    // (sixieme hote). Lui donner son propre selecteur rouvrirait la porte a un
    // calque qui capte les clics — ce que le verrou #381 interdit.
    const hotes = sliceSource(
      CSS,
      "/* ── CE QUI RESTE CLIQUABLE SUR L'ECRAN VOCAL (issue #381) ──",
      "{\n  pointer-events: auto;\n}",
      80,
    );
    // Seule la LISTE DE SELECTEURS compte : le commentaire qui precede la regle
    // est ecarte (il contient des virgules de prose).
    const selecteurs = hotes
      .split("*/")
      .pop()
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.startsWith(".pilot-vocal"));
    expect(selecteurs).toHaveLength(6);
    expect(selecteurs).toContain(".pilot-vocal .vocal-input");
    expect(hotes).not.toContain("agent-pending");
  });

  it("le seul `pointer-events: none` qui touche la saisie est celui de l'effacement", () => {
    // Hors effacement du bas, rien ne desactive le clic dans la zone de saisie.
    // Recherche par REGLE (selecteur + corps).
    //
    // CORRECTION DU 2026-11-01 : la phrase precedente affirmait qu'« un
    // commentaire voisin ne peut donc pas fausser le compte » — c'etait faux. Le
    // motif `[^{}]+` qui precede l'accolade ouvrante avale le commentaire place
    // JUSTE AVANT la regle, et les commentaires n'ont pas d'accolade. Le
    // commentaire du bloc de l'etat nu, qui explique que la zone de saisie n'y
    // est PAS nommee, la nommait donc en clair et comptait pour une seconde
    // regle. On neutralise les commentaires AVANT de compter.
    const regles = neutraliserSource(CSS).match(/[^{}]+\{[^}]*pointer-events:\s*none[^}]*\}/g) || [];
    const surSaisie = regles.filter((r) => r.split("{")[0].includes(".vocal-input"));
    expect(surSaisie).toHaveLength(1);
    expect(surSaisie[0]).toContain("vocal-chrome-hidden");
    // Et cet effacement-la ne peut pas s'appliquer tant qu'une question attend
    // (regle 5 de `vocal-chrome.js`, verrouillee par
    // `ecran-vocal-question-visible.test.js`).
  });

  it("aucune regle ne desactive le clic sur la rangee de questions", () => {
    expect(CSS).not.toMatch(/agent-pending[^{]*\{[^}]*pointer-events:\s*none/);
  });
});

describe("5. une dictee ouverte par un GESTE tient face a une question", () => {
  const REPOS = {
    modeOuvert: true,
    projetSensible: false,
    sensibiliteConnue: true,
    sensibiliteIndisponible: false,
    pilotParle: false,
    reflechit: false,
    occupe: false,
    dicteeOuverte: false,
    question: false,
    arretManuel: false,
    sessionsVides: false,
    erreur: "",
    transcription: true,
    apresLecture: false,
    mesureOuverte: true,
  };

  it("sans geste, une question ferme la dictee AUTOMATIQUE (regle 4b d'origine)", () => {
    // Verrou conserve : une phrase prononcee a cote ne doit jamais valoir
    // reponse (et « oui » pour une confirmation).
    expect(
      decideVocalDictation({ ...REPOS, dicteeOuverte: true, question: true }),
    ).toEqual({
      action: VOCAL_DICTATION_DISARM,
      raison: "question-en-attente",
      delai: 0,
    });
    // Et elle n'en ouvre pas une non plus.
    expect(decideVocalDictation({ ...REPOS, question: true }).action).toBe(
      VOCAL_DICTATION_DISARM,
    );
  });

  it("ouverte par un GESTE, la dictee est MAINTENUE : on peut dicter sa reponse", () => {
    // Sans cela, le bouton 🎙️ se refermait dans la milliseconde qui suivait le
    // clic : l'ecran promettait une dictee impossible.
    expect(
      decideVocalDictation({
        ...REPOS,
        dicteeOuverte: true,
        ouvertureParGeste: true,
        question: true,
      }),
    ).toEqual({
      action: VOCAL_DICTATION_HOLD,
      raison: "deja-ouverte",
      delai: 0,
    });
  });

  it("le fait est publie par l'etat de l'ecran, pas invente ailleurs", () => {
    expect(ETAT_VOCAL).toContain("ouvertureParGeste:");
    // Toujours combine a la session REELLEMENT ouverte : un drapeau perime ne
    // maintient rien.
    expect(ETAT_VOCAL).toContain(
      "ouvertureParGeste: voiceActive === true && vocalDicteeParGeste === true,",
    );
  });

  it("le GESTE pose le drapeau, l'armement automatique le retire", () => {
    const geste = TOGGLE.indexOf("vocalDicteeParGeste = true;");
    const demarrage = TOGGLE.indexOf("startVoiceInput();");
    expect(geste).toBeGreaterThan(-1);
    expect(demarrage).toBeGreaterThan(-1);
    expect(geste).toBeLessThan(demarrage);
    const auto = ARMEMENT.indexOf("vocalDicteeParGeste = false;");
    const demarrageAuto = ARMEMENT.indexOf("startVoiceInput();");
    expect(auto).toBeGreaterThan(-1);
    expect(demarrageAuto).toBeGreaterThan(-1);
    expect(auto).toBeLessThan(demarrageAuto);
  });

  it("la fermeture de la session remet le drapeau a zero", () => {
    const stop = corpsFonction(SUPER, "  function stopVoiceInput() {", "\n  }\n");
    expect(stop).toContain("vocalDicteeParGeste = false;");
  });

  it("l'armement automatique ne s'arme toujours pas sur une question", () => {
    // Le geste est la SEULE facon de dicter une reponse ; l'automatisme reste
    // ferme (aucune reponse dictee a la place de l'utilisateur).
    const decision = decideVocalDictation({ ...REPOS, question: true });
    expect(decision.action).not.toBe(VOCAL_DICTATION_ARM);
  });
});
