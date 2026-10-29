// Tests — ECRAN NU du mode Vocal (decision du proprietaire, 2026-10-28)
//
// CE QUE CE FICHIER VERROUILLE (et pourquoi) :
//   1. L'ecran Vocal ne dessine QUE l'objet, l'unique ligne d'etat, le bouton
//      de depannage du micro et la barre de saisie : aucun conteneur de
//      messages, aucune bulle, aucun texte de la conversation (le trait de
//      niveau est parti le 12/11, et son absence est exigee ici).
//   2. Rien de la conversation n'ENTRE dans cet ecran a l'entree du mode : les
//      seuls noeuds deplaces sont la barre de saisie (meme noeud, meme envoi) et
//      le LOGO-bouton des trois modes (lots 1 a 3 : il n'entre plus dans la
//      barre de 44 px, il entre dans l'overlay). La conversation reste entiere
//      dans l'onglet de l'agent, ou on la retrouve en quittant le mode.
//   3. La ligne d'etat ne porte jamais un message : seulement les trois phrases
//      de l'ecran (ou le message clair du micro ferme).
//   4. La LECTURE A VOIX HAUTE ne depend de rien de ce qui est affiche : elle
//      actionne le bouton « Ecouter » de la derniere reponse, pose par
//      read-aloud.js dans la conversation de l'onglet — c'est desormais le seul
//      moyen d'entendre la reponse, donc rien ne doit devenir muet.
//   5. La conversation n'est JAMAIS peinte pendant le mode (regle CSS dediee,
//      independante de la couleur de fond de l'overlay), sans casser les
//      mesures de defilement (`visibility`, jamais `display: none`).
//   6. Ce que l'ecran nu DOIT garder (objet 168 px, saisie 720 px, trois
//      sorties du mode, mouvement reduit) : aucun nettoyage futur ne doit les
//      emporter en meme temps que la conversation.
//
// Les commentaires sont en ASCII ; les chaines qui viennent de l'interface sont
// copiees telles quelles.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sliceSource } from "./source-slice.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) =>
  readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");

// Le source peut arriver en CRLF (runner Windows) : `lire` normalise AVANT toute
// recherche d'ancre multi-lignes (quality-gate 3.4).
const SUPER = lire("src/js/super-agent.js");
const CSS = lire("src/css/style.css");
const READ_ALOUD = lire("src/js/read-aloud.js");
const SPEC = lire("spec_modes_ecran_vocal.md");
const HELP = lire("help/overview.md");

/** Corps d'une fonction du module (`sliceSource` LEVE si l'ancre a disparu). */
function corpsFonction(src, entete) {
  return sliceSource(src, entete, "\n  }", 40);
}

/** Corps d'un bloc CSS `selecteur { ... }` (premiere occurrence). */
function bloc(css, selecteur) {
  return sliceSource(css, selecteur, "}", 10);
}

// ---------------------------------------------------------------------------
describe("1. ce que l'ecran Vocal dessine, et rien d'autre", () => {
  const build = corpsFonction(SUPER, "function buildVocalOverlay()");

  it("l'ecran nu : l'objet, la ligne d'etat, la saisie", () => {
    for (const noeud of [
      "vocal-top",
      "vocal-stage",
      "vocal-orb",
      "vocal-halo",
      "vocal-restart",
      "vocal-status",
      "vocal-mic-fix",
      "vocal-input",
    ]) {
      expect(build, `noeud absent de l'ecran : ${noeud}`).toMatch(
        new RegExp(`class="[^"]*${noeud}`),
      );
    }
    // Le trait de niveau (200 x 3 px) a ete RETIRE le 12/11 : l'ecran nu est
    // plus nu encore, et ce fichier l'exige au lieu de l'ignorer.
    expect(build, "le trait de niveau ne doit plus exister").not.toMatch(/vocal-level/);
  });

  it("aucun conteneur de conversation dans le balisage de l'ecran", () => {
    // Aucune bulle, aucun fil, aucun rendu de message : l'ecran ne sait pas
    // afficher la conversation, donc il ne peut pas la montrer.
    expect(build).not.toMatch(
      /agent-message|agent-chat-messages|agent-chat-container|agent-tool-call|messagesEl|markdown/i,
    );
  });
});

// ---------------------------------------------------------------------------
describe("2. rien de la conversation n'entre dans l'ecran a l'entree du mode", () => {
  const enter = corpsFonction(SUPER, "function enterVocal()");

  it("les seuls noeuds deplaces sont la saisie, le logo et « Travail »", () => {
    expect(enter).toMatch(/zone\.appendChild\(inputBar\)/);
    // Adaptation L4 : le bouton des modes entre dans l'OVERLAY (la barre de
    // 44 px ne le recoit plus). L'intention d'origine est conservee : un seul
    // bouton de sortie deplacé, le meme noeud, jamais recree.
    expect(enter).toMatch(/vocalOverlay\.appendChild\(modeButton\)/);
    // Decision du proprietaire : l'entree « Travail » est elle aussi DEPLACEE
    // (le MEME noeud du document, jamais une copie) pour que le suivi du
    // travail reste joignable depuis cet ecran. Ce n'est pas une exception au
    // principe de l'ecran nu : c'est un BOUTON, pas un affichage — la
    // conversation, elle, ne revient pas (assertions du bloc suivant).
    expect(enter).toMatch(/document\.getElementById\("agent-activity"\)/);
    expect(enter).toMatch(/vocalOverlay\.appendChild\(activite\)/);
    expect(enter).not.toMatch(/agent-chat|agent-message/);
    expect(enter, "le bouton est de nouveau pose dans la barre de 44 px").not.toMatch(
      /barre\.appendChild\(modeButton\)/,
    );
  });

  it("la conversation, la barre d'outils et les bandeaux restent dans l'onglet", () => {
    for (const interdit of [
      "messagesEl",
      "toolbar",
      "pendingBar",
      "busyHint",
      "statusEl",
      "wrapper",
    ]) {
      expect(enter, `noeud de conversation deplace dans l'ecran : ${interdit}`).not.toContain(
        interdit,
      );
    }
    // Aucun contenu n'est ecrit dans l'ecran a l'entree : il n'est que structure.
    expect(enter).not.toMatch(/innerHTML/);
    expect(enter).not.toMatch(/textContent/);
  });
});

// ---------------------------------------------------------------------------
describe("3. la ligne d'etat ne porte jamais la conversation", () => {
  const etat = corpsFonction(SUPER, "function applyVocalState()");

  it("elle ne recoit que les trois phrases de l'ecran (ou le micro ferme)", () => {
    // Correctif de revue : la ligne est toujours ecrite a UN seul endroit (la fin
    // de applyVocalState), mais la phrase est choisie par `vocalStatusLine`, qui
    // garde exactement la meme priorite : etat anime > micro ferme > phrases de
    // l'ecran. La ligne peut en plus dire « dictee indisponible » au repos, ce
    // que la decision PURE prevoit deja (`sans-transcription`) : aucun texte de
    // conversation n'entre ici pour autant.
    expect(etat).toMatch(/const texte = vocalStatusLine\(state\);/);
    const ligne = corpsFonction(SUPER, "function vocalStatusLine");
    expect(ligne).toMatch(
      /if \(state !== "idle"\) return vocalStatusText\(state\);\s*if \(vocalMicFerme\) return vocalMicFerme;/,
    );
    expect(ligne).not.toMatch(/messagesEl|lastAssistantRawText|pendingText|agent-message|streaming/i);
  });

  it("aucun texte de message n'y est injecte", () => {
    expect(etat).not.toMatch(/innerHTML|lastAssistantRawText|pendingText|agent-message|streaming/i);
  });
});

// ---------------------------------------------------------------------------
describe("4. la lecture a voix haute ne depend de rien de ce qui est affiche", () => {
  const lecture = corpsFonction(SUPER, "function autoReadVocalReply()");

  it("la source du texte reste le bouton « Ecouter » de la derniere reponse", () => {
    // Meme source qu'hors mode Vocal : le bouton pose par read-aloud.js sous le
    // dernier message de l'onglet. L'ecran nu ne le retire pas, ne le copie pas,
    // et ne fabrique aucun second lecteur.
    expect(lecture).toMatch(
      /messagesEl\.querySelectorAll\("\.agent-message-assistant \.agent-read-btn"\)/,
    );
    expect(lecture).toMatch(/bouton\.click\(\)/);
    expect(lecture).not.toMatch(/speechSynthesis|SpeechSynthesisUtterance|\.speak\(/);
  });

  it("elle ne cherche aucun element de l'ecran Vocal", () => {
    expect(lecture).toMatch(/if \(!vocalOverlay\) return;/);
    expect(lecture).not.toMatch(/vocalOverlay\.querySelector|\.vocal-(orb|level|status|stage|input)/);
  });

  it("le bouton de lecture existe toujours cote conversation (read-aloud.js)", () => {
    expect(READ_ALOUD).toMatch(/export function attachReadAloud/);
    expect(READ_ALOUD).toMatch(/agent-read-btn/);
  });
});

// ---------------------------------------------------------------------------
describe("5. la conversation n'est jamais peinte pendant le mode Vocal", () => {
  it("la zone des messages est invisible tant que l'ecran Vocal est actif", () => {
    const nu = bloc(CSS, "body.pilot-vocal-active .agent-chat-messages {");
    expect(nu).toMatch(/visibility:\s*hidden/);
    // `display: none` est interdit : il remettrait la conversation en haut de
    // son historique a la sortie du mode (mesures de defilement perdues).
    expect(nu).not.toMatch(/display:\s*none/);
  });

  it("l'ecran lui-meme reste opaque et couvre la fenetre", () => {
    const overlay = bloc(CSS, ".pilot-vocal {");
    expect(overlay).toMatch(/position:\s*fixed/);
    expect(overlay).toMatch(/inset:\s*0/);
    expect(overlay).toMatch(/background:\s*var\(--bg-app\)/);
  });
});

// ---------------------------------------------------------------------------
describe("6. ce que l'ecran nu doit garder", () => {
  it("l'objet et la saisie gardent leurs mesures, le trait n'existe plus", () => {
    expect(bloc(CSS, ".vocal-orb {")).toMatch(/width:\s*168px/);
    expect(bloc(CSS, ".vocal-input {")).toMatch(/width:\s*min\(720px/);
    // Un trait qui reviendrait par une regle CSS serait aussi genant qu'un
    // trait dans le balisage : les deux sont refuses ici.
    expect(CSS).not.toMatch(/\.vocal-level\b/);
    expect(CSS).not.toMatch(/vocal-level-bar/);
  });

  it("les trois sorties du mode et le mouvement reduit restent branches", () => {
    // Bouton des modes + Ctrl+Shift+A + Echap + fermeture de l'onglet.
    expect(SUPER).toMatch(/onVocalKeydown/);
    expect(SUPER).toMatch(/e\.key !== "Escape"/);
    expect(SUPER).toMatch(/vocalReducedMotion\(\)/);
    expect((SUPER.match(/exitVocal\(\)/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
describe("7. la regle est ecrite noir sur blanc (spec + aide integree)", () => {
  it("la spec decrit l'ecran nu", () => {
    expect(SPEC).toMatch(/écran nu/i);
    expect(SPEC).toMatch(/Rien de la conversation n'est affiché/);
  });

  it("l'aide integree le dit aussi", () => {
    const aide = sliceSource(HELP, "<!-- HELP:modes-ecran -->", "<!-- /HELP:modes-ecran -->", 100);
    expect(aide).toMatch(/Rien de la conversation n'y est\s+affich/i);
    expect(aide).toMatch(/écran nu/i);
  });
});
