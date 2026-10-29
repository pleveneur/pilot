// Tests — UNE QUESTION DE L'ASSISTANT NE PEUT PAS ETRE INVISIBLE DANS L'ECRAN
// VOCAL (correctif ; `docs/conceptions/CONCEPTION-ecran-vocal-cercle-et-bas.md`
// §2 et §2.7).
//
// LE DEFAUT (prouve par le disque, voir le rapport
// `docs/rapports/RAPPORT-questions-invisibles-ecran-vocal.md`) :
//   - les questions de l'assistant (choix, choix multiple, confirmation, saisie
//     libre) sont peintes dans la rangee `#pendingBar` (`renderActivePendingQuestion`,
//     file FIFO `pendingQuestions`, chantier #132) ;
//   - cette rangee est un enfant du WRAPPER de l'onglet Assistant, posee juste
//     apres la barre de saisie — donc DERRIERE le calque plein ecran de l'ecran
//     Vocal (`.pilot-vocal`, `z-index: 99990`, fond OPAQUE) ;
//   - `enterVocal` ne deplacait que trois noeuds (logo, « Travail », barre de
//     saisie) : la rangee restait dans le wrapper, donc hors de l'ecran. En mode
//     Vocal, une question ne s'affichait NULLE PART : l'utilisateur ne voyait
//     rien et le travail restait bloque, sans un mot.
//
// CE QUE CE FICHIER VERROUILLE :
//   1. Le defaut d'origine est decrit par le disque : la rangee est peinte dans
//      `#pendingBar` (pas dans la conversation), et le calque Vocal est opaque.
//      Conclusion : une rangee laissee dans le wrapper est invisible.
//   2. La CORRECTION : `enterVocal` DEPLACE la rangee dans `.vocal-input`, JUSTE
//      AU-DESSUS de la ligne de saisie — meme noeud, memes boutons, memes
//      reponses — et `exitVocal` la restitue a sa place d'origine avant le
//      retrait du calque (sinon elle serait detruite avec lui).
//   3. Elle n'est JAMAIS masquee : la regle 5 de `vocal-chrome.js` retient le bas
//      tant qu'une question attend, `vocalSyncChrome` lit ce fait, et la decision
//      est RÉAPPLIQUEE a chaque changement de la file.
//   4. UNE SEULE question a la fois, file FIFO sans perte, et aucune question ne
//      s'efface toute seule (aucun minuteur : une question humaine attend).
//   5. La reponse reste la VOIE EXISTANTE (clic sur les boutons de la rangee, ou
//      saisie dans la barre principale detournee par `send()`). Aucun second
//      mecanisme de reponse n'est cree.
//   6. HORS du mode Vocal, rien ne change : tous les styles ajoutes sont bornes
//      a `.pilot-vocal`, et le bloc d'origine de la rangee est intact.
//
// Les commentaires sont en ASCII ; les selecteurs CSS et les extraits de code
// lus sont copies tels quels depuis les fichiers sources.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// Decoupage VERIFIE : une ancre absente LEVE au lieu de rendre un fragment vide
// (quality-gate §3.4 : la source est normalisee en LF avant lecture).
import { sliceSource } from "./source-slice.js";
import { vocalChromeVisible } from "./vocal-chrome.js";
import {
  decideVocalDictation,
  planVocalConversation,
  vocalDictationMessage,
  VOCAL_DICTATION_ARM,
  VOCAL_DICTATION_DISARM,
  VOCAL_RESUME_TRANSIENT_REASONS,
} from "./vocal-conversation.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) =>
  readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const CSS = lire("src/css/style.css");
const SUPER = lire("src/js/super-agent.js");

/** Corps d'une fonction de `super-agent.js` (indentation de 2 espaces). */
function corpsFonction(src, entete, fin) {
  return sliceSource(src, entete, fin, 2);
}

// Le corps de `enterVocal` et celui de `exitVocal` : ce sont les deux seuls
// endroits qui deplacent et restituent la rangee des questions.
const ENTER = corpsFonction(SUPER, "  function enterVocal() {", "  function exitVocal() {");
const EXIT = corpsFonction(SUPER, "  function exitVocal() {", "  function autoReadVocalReply() {");

// La file des questions (#132) : enregistrement, rendu de la tete de file,
// ajout et fin de question.
const RENDU = corpsFonction(
  SUPER,
  "function renderActivePendingQuestion() {",
  "function enqueuePendingQuestion(q) {",
);
const ENFILE = corpsFonction(
  SUPER,
  "function enqueuePendingQuestion(q) {",
  "function finalizePendingQuestion() {",
);
const FINALISE = corpsFonction(
  SUPER,
  "function finalizePendingQuestion() {",
  "function telegramDescriptorOf(q) {",
);

// `vocalSyncChrome` : SEUL point d'ecriture de la classe qui efface le bas.
const SYNC_CHROME = corpsFonction(
  SUPER,
  "function vocalSyncChrome(state) {",
  "\n  }",
);

// Le bloc CSS de la rangee sur l'ecran Vocal, et le bloc d'origine de la rangee
// (onglet Assistant), qui ne doit pas bouger.
const CSS_VOCAL = sliceSource(
  CSS,
  ".pilot-vocal .agent-pending-bar-container {",
  "}",
  2,
);
const CSS_RANGEE = sliceSource(CSS, ".agent-pending-bar-container {", "}", 2);
// Le bloc qui EFFACE le bas de l'ecran Vocal.
const CSS_MASQUE = sliceSource(
  CSS,
  ".pilot-vocal.vocal-chrome-hidden .vocal-status,",
  "}",
  2,
);
// La regle qui rend le clic aux hotes de l'ecran (issue #381).
const CSS_HOTES = sliceSource(CSS, ".pilot-vocal .vocal-top,", "}", 2);

// ---------------------------------------------------------------------------
describe("1. le defaut d'origine, tel que le disque le decrit", () => {
  it("la question est peinte dans la RANGEE #pendingBar, pas dans la conversation", () => {
    // `renderActivePendingQuestion` ecrit dans `pendingBarEl` et n'ouvre jamais
    // la zone des messages : c'est une rangee, pas une bulle de conversation.
    expect(RENDU).toContain("pendingBarEl.innerHTML");
    expect(RENDU).not.toContain("messagesEl");
    expect(RENDU).not.toContain("superMessagesEl");
    // Et cette rangee vit dans le WRAPPER de l'onglet, apres la barre de saisie.
    expect(SUPER).toContain("wrapper.appendChild(inputBar);");
    expect(SUPER).toContain("wrapper.appendChild(pendingBar);");
  });

  it("le calque de l'ecran Vocal est OPAQUE (donc ce qui est derriere est invisible)", () => {
    const calque = sliceSource(CSS, ".pilot-vocal {", "}", 200);
    // Il couvre le viewport et se pose au-dessus de tout l'onglet.
    expect(calque).toMatch(/position:\s*fixed/);
    expect(calque).toMatch(/inset:\s*0/);
    expect(calque).toMatch(/z-index:\s*99990/);
    // Et il ne laisse rien voir au travers : c'est ce qui rendait la rangee
    // invisible plutot que simplement recouverte d'un voile.
    const fond = /background(?:-color)?:\s*([^;]+);/.exec(calque);
    expect(fond, "le calque doit peindre un fond").not.toBeNull();
    expect(fond[1].trim()).not.toBe("transparent");
    expect(fond[1]).not.toMatch(/rgba\([^)]*,\s*0(?:\.0+)?\s*\)/);
  });
});

// ---------------------------------------------------------------------------
describe("2. la rangee entre dans l'ecran, AU-DESSUS de la ligne de saisie", () => {
  it("`enterVocal` la DEPLACE dans `.vocal-input` (meme noeud, aucun second rendu)", () => {
    // La zone est celle de la barre de saisie : la rangee y est inseree, donc
    // elle herite de son `pointer-events: auto` et de son alignement.
    expect(ENTER).toContain('vocalOverlay.querySelector(".vocal-input")');
    expect(ENTER).toContain("zone.insertBefore(pendingBar,");
    // Sa place d'origine est memorisee pour une restitution EXACTE.
    expect(ENTER).toContain("vocalQuestionsHome = { parent: pendingBar.parentNode");
    // Aucune COPIE : c'est le noeud du document qui est deplace, jamais clone.
    expect(ENTER).not.toContain("pendingBar.cloneNode");
    expect(ENTER).not.toContain("createElement(\"div\")");
  });

  it("elle est posee AVANT la barre de saisie (donc au-dessus, pas en dessous)", () => {
    // La reference de l'insertion est la barre de saisie elle-meme, et seulement
    // si elle est bien dans la zone : la rangee ne peut donc pas passer apres.
    // (Comparaison a espaces normalises : le source est mis en forme sur
    // plusieurs lignes, ce qui ne change pas l'instruction.)
    expect(ENTER.replace(/\s+/g, " ")).toContain(
      "zone.insertBefore(pendingBar, inputBar && inputBar.parentNode === zone ? inputBar : null);",
    );
    // Et ce deplacement vient APRES celui de la barre de saisie (sinon la
    // reference `inputBar` ne serait pas encore dans la zone).
    const barre = ENTER.indexOf("zone.appendChild(inputBar);");
    const rangee = ENTER.indexOf("zone.insertBefore(pendingBar,");
    expect(barre).toBeGreaterThan(-1);
    expect(rangee).toBeGreaterThan(barre);
  });

  it("`exitVocal` la restitue a sa place d'origine AVANT de retirer le calque", () => {
    // Sinon le noeud serait detruit avec l'overlay : l'onglet Assistant
    // perdrait sa rangee pour de bon, et une question encore en attente a la
    // sortie du mode ne serait plus jamais affichable.
    const retrait = EXIT.indexOf("vocalOverlay.remove();");
    const restitution = EXIT.indexOf("vocalQuestionsHome.parent.insertBefore(pendingBar,");
    expect(restitution).toBeGreaterThan(-1);
    expect(restitution).toBeLessThan(retrait);
    // Restitution AVANT celle de la barre de saisie : dans le wrapper, la rangee
    // etait le dernier enfant, DERRIERE `inputBar`. Cet ordre rend a la barre son
    // voisin d'origine (`next.parentNode === parent` passe donc encore).
    const barre = EXIT.indexOf("vocalInputHome.parent.insertBefore(inputBar,");
    expect(barre).toBeGreaterThan(restitution);
    // Et la memoire est remise a zero (pas de place fantome a la reentree).
    expect(EXIT).toContain("vocalQuestionsHome = null;");
  });

  it("hors question, elle ne prend aucune place (le repos est inchange)", () => {
    // Conteneur vide = aucun filet, aucune marge : la ligne de saisie reste
    // exactement la ou le lot 2 l'a posee.
    const vide = sliceSource(
      CSS,
      ".pilot-vocal .agent-pending-bar-container:empty {",
      "}",
      2,
    );
    expect(vide).toMatch(/margin:\s*0/);
    expect(vide).toMatch(/padding:\s*0/);
  });

  it("sa hauteur reste dans la place reservee par la formule du disque", () => {
    // §1.5 : 289 px sont reserves au reste de l'ecran (air du haut, barre de
    // 44 px, ligne d'etat, saisie, marge basse). Au-dela de 140 px de question,
    // la boite du halo (disque + 2 x couronne) ne tiendrait plus dans la
    // fenetre : le disque serait rogne. Un plafond plus grand ferait donc un
    // changement de mise en page — c'est interdit ici.
    const plafond = /max-height:\s*min\((\d+)px/.exec(CSS_VOCAL);
    expect(plafond, "la rangee doit borner sa hauteur").not.toBeNull();
    expect(Number(plafond[1])).toBeLessThanOrEqual(140);
    // Et elle defile au-dela, plutot que de pousser l'ecran.
    expect(CSS_VOCAL).not.toMatch(/overflow:\s*visible/);
  });

  it("la rangee herite du clic de son hote `.vocal-input`, sans nouvel hote", () => {
    // Les six hotes cliquables de l'ecran (issue #381) contiennent deja la zone
    // de saisie : la rangee deplacee dedans est donc cliquable par heritage.
    expect(CSS_HOTES).toContain(".pilot-vocal .vocal-input");
    // Aucun hote supplementaire n'est reclame pour elle : la liste exhaustive
    // reste celle du #381, et un decor ne capte jamais un clic.
    expect(CSS_HOTES).not.toContain("agent-pending");
  });
});

// ---------------------------------------------------------------------------
describe("3. la question ne peut JAMAIS etre masquee sur l'ecran Vocal", () => {
  it("la regle 5 retient le bas tant qu'une question attend", () => {
    // Comportement REELLEMENT execute (le module est pur).
    expect(vocalChromeVisible({ etat: "idle", question: true })).toBe(true);
    // Sans question, le repos continue d'effacer le bas : l'ecran reste nu.
    expect(vocalChromeVisible({ etat: "idle", question: false })).toBe(false);
    expect(vocalChromeVisible({ etat: "idle" })).toBe(false);
  });

  it("`vocalSyncChrome` lit ce fait dans la FILE (source unique)", () => {
    expect(SYNC_CHROME).toMatch(/question:\s*hasPendingQuestion\(\)/);
  });

  it("le bas est RÉAPPLIQUE a chaque changement de la file", () => {
    // Un rappel pose par `createSuperAgent`, et appele a la fin du rendu : une
    // question qui arrive pendant que le bas est efface le fait revenir.
    expect(SUPER).toContain("let pendingQuestionChromeSync = null;");
    expect(SUPER).toContain("pendingQuestionChromeSync = () => {");
    expect(SUPER).toContain("if (!vocalOverlay) return;");
    expect(SUPER).toContain("pendingQuestionChromeSync = null;");
    // Appel a la fin du rendu de la question active (apres le placeholder, donc
    // une fois l'affichage complet).
    const appel = RENDU.indexOf("pendingQuestionChromeSync()");
    const placeholder = RENDU.indexOf("pendingInputEl.placeholder");
    expect(appel).toBeGreaterThan(-1);
    expect(appel).toBeGreaterThan(placeholder);
  });

  it("ni la classe d'effacement, ni le style de la rangee ne la cachent", () => {
    // La classe ne nomme QUE les trois noeuds du bas : jamais la rangee des
    // questions (qui vit pourtant DANS la zone de saisie).
    expect(CSS_MASQUE).not.toContain("agent-pending");
    // Et le bloc de la rangee sur l'ecran Vocal ne cache rien et ne recouvre
    // rien : aucun `display: none`, aucune `visibility`, aucun `absolute` qui
    // pourrait passer sous le disque ou sous la barre.
    expect(CSS_VOCAL).not.toMatch(/display:\s*none/);
    expect(CSS_VOCAL).not.toMatch(/visibility:\s*hidden/);
    expect(CSS_VOCAL).not.toMatch(/position:\s*absolute/);
    // Ce bloc est bien CELUI de l'ecran Vocal : il est borne a `.pilot-vocal`.
    expect(CSS_VOCAL).toContain(".pilot-vocal");
  });
});

// ---------------------------------------------------------------------------
describe("4. une seule question a la fois, file FIFO sans perte", () => {
  it("le rendu ne peint QUE la tete de file", () => {
    expect(RENDU).toContain("const q = pendingQuestions[0];");
    // Une seule barre par rendu : aucune boucle sur la file, donc aucun
    // empilement de deux questions a l'ecran.
    expect(RENDU).not.toMatch(/for\s*\(|\.forEach\(|\.map\(/);
  });

  it("l'ajout et la fin de question gardent la file intacte", () => {
    // Ajout en queue, retrait de la TETE : aucune question n'est remplacee ni
    // ecrasee, et la suivante prend la place de la precedente.
    expect(ENFILE).toContain("pendingQuestions.push(q);");
    expect(FINALISE).toContain("pendingQuestions.shift()");
    expect(FINALISE).toContain("renderActivePendingQuestion();");
  });

  it("aucune question ne s'efface toute seule (aucun minuteur, aucune expiration)", () => {
    // Une question humaine attend une reponse : elle ne doit jamais disparaitre
    // par delai. Aucun des trois points de la file ne programme de minuterie.
    for (const corps of [RENDU, ENFILE, FINALISE]) {
      expect(corps).not.toMatch(/setTimeout|setInterval|AbortSignal\.timeout/);
    }
    // Et l'ecran Vocal n'en programme aucune pour la rangee non plus.
    expect(ENTER).not.toMatch(/setTimeout/);
    expect(EXIT).not.toMatch(/setTimeout/);
  });
});

// ---------------------------------------------------------------------------
describe("5. la reponse reste la VOIE EXISTANTE, aucun second mecanisme", () => {
  it("la barre principale detourne l'envoi vers la question en attente", () => {
    // `send()` : si une question attend, le texte saisi devient la note / la
    // valeur de cette question. C'est ce chemin qui repond aussi depuis
    // l'ecran Vocal (la barre de saisie y est DEPLACEE, pas recopiee).
    const envoi = sliceSource(
      SUPER,
      "  async function send() {",
      '    const userBubble = appendMessage(messagesEl, "user", text);',
      500,
    );
    expect(envoi).toContain("hasPendingQuestion()");
    expect(envoi).toContain("validatePendingQuestion(");
    // La reponse a une question ne part JAMAIS comme un prompt d'agent.
    expect(envoi.indexOf("validatePendingQuestion(")).toBeLessThan(
      envoi.indexOf("sendSuperAgentMessage(") === -1 ? Infinity : envoi.indexOf("sendSuperAgentMessage("),
    );
  });

  it("la reponse d'une question passe par le demandeur, puis fait avancer la file", () => {
    // `validatePendingQuestion` (appelee par `send()`) confie la valeur a la
    // question elle-meme (`q.submit`) : un seul chemin d'application de la
    // reponse, celui du rendu de la rangee.
    const valide = sliceSource(
      SUPER,
      "function validatePendingQuestion(raw) {",
      "\n}\n",
      20,
    );
    expect(valide).toContain("q.submit(note, false)");
    // Puis l'envoi reel et l'avancement de la file (clic d'un bouton, comme
    // saisie dans la barre) : la reponse part et la question suivante prend la
    // place de la precedente.
    const fin = sliceSource(
      SUPER,
      "async function finishPendingQuestion(q, value, cancelled) {",
      "\n}\n",
      200,
    );
    expect(fin).toContain("q.responder(q.id, value, cancelled)");
    expect(fin).toContain("finalizePendingQuestion();");
    expect(fin).toContain("clearPendingInput();");
    // Le clic d'un bouton de choix re-rend la rangee (choix multiple) ou valide.
    expect(SUPER).toMatch(/renderActivePendingQuestion\(\);/);
    // Enfin : la sortie de l'ecran Vocal ne repond a RIEN a la place de
    // l'utilisateur — elle ne touche pas a la file.
    expect(EXIT).not.toContain("pendingQuestions");
    expect(EXIT).not.toContain("responder(");
    expect(ENTER).not.toContain("pendingQuestions");
  });
});

// ---------------------------------------------------------------------------
describe("6. hors du mode Vocal, le comportement est inchange", () => {
  it("tous les styles ajoutes sont bornes a `.pilot-vocal`", () => {
    // Le bloc decrit au-dessus ne vaut que pour l'ecran Vocal : l'onglet
    // Assistant garde exactement la presentation qu'il avait.
    const selecteurs = [
      ".pilot-vocal .agent-pending-bar-container",
      ".pilot-vocal .agent-pending-bar {",
      ".pilot-vocal .agent-pending-title {",
      ".pilot-vocal .agent-choice-buttons {",
    ];
    for (const selecteur of selecteurs) {
      expect(CSS).toContain(selecteur);
    }
  });

  it("le bloc d'origine de la rangee est intact", () => {
    // Filet, fond et plafond de hauteur du dessous de la barre de saisie : rien
    // n'a ete retire a la version commune.
    expect(CSS_RANGEE).toMatch(/border-top:\s*1px solid var\(--border-subtle\)/);
    expect(CSS_RANGEE).toMatch(/background:\s*var\(--surface-2\)/);
    expect(CSS_RANGEE).toMatch(/max-height:\s*220px/);
  });
});

// ---------------------------------------------------------------------------
describe("7. la dictee ne repond pas a ma place (regle 4b)", () => {
  // Sans cette garde, l'ecran Vocal s'armait tout seul PENDANT qu'une question
  // attendait : une phrase prononcee a cote (un mot a quelqu'un d'autre, un
  // commentaire) partait comme reponse a la question — et une CONFIRMATION,
  // dont la valeur par defaut est « oui », etait donc validee sans un geste.
  // Repondre a la place de l'utilisateur est interdit : la dictee automatique
  // se ferme tant qu'une question est en file.
  const REPOS = {
    modeOuvert: true,
    projetSensible: false,
    pilotParle: false,
    reflechit: false,
    occupe: false,
    dicteeOuverte: false,
    arretManuel: false,
    sessionsVides: false,
    erreur: "",
    transcription: true,
    apresLecture: false,
    sensibiliteConnue: true,
    sensibiliteIndisponible: false,
    mesureOuverte: true,
  };

  it("au repos sans question, rien ne change : la dictee s'arme", () => {
    expect(decideVocalDictation({ ...REPOS }).action).toBe(VOCAL_DICTATION_ARM);
  });

  it("une question en attente ferme la dictee automatique", () => {
    const d = decideVocalDictation({ ...REPOS, question: true });
    expect(d.action).toBe(VOCAL_DICTATION_DISARM);
    expect(d.raison).toBe("question-en-attente");
    // Ce refus n'est PAS une panne : aucune phrase d'echec ne s'affiche, et il
    // n'est pas repris en boucle (aucune reprise programmee).
    expect(vocalDictationMessage(d.raison)).toBe("");
    expect(VOCAL_RESUME_TRANSIENT_REASONS).not.toContain(d.raison);
  });

  it("une dictee DEJA OUVERTE est fermee, pas maintenue", () => {
    // Placee AVANT la regle 5 (« deja ouverte » ne fait que maintenir) : une
    // dictee ouverte au moment ou la question arrive ne peut pas envoyer sa
    // transcription comme reponse.
    const plan = planVocalConversation(
      { ...REPOS, dicteeOuverte: true, question: true },
      { dicteeOuverte: true, minuteur: false },
    );
    expect(plan.desarmer).toBe(true);
    expect(plan.delai).toBe(0);
  });

  it("l'ecran transmet le fait, lu dans la FILE (source unique)", () => {
    const etats = sliceSource(
      SUPER,
      "  function vocalConversationState() {",
      "\n  }\n",
      50,
    );
    expect(etats).toMatch(/question:\s*hasPendingQuestion\(\),/);
  });
});
