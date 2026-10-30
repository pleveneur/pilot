// Tests — LA COLONNE DE GAUCHE DE L'ECRAN VOCAL EST ALIMENTEE, EN DIRECT, ET
// FILTREE (defaut signale : « la discussion est vide et ne s'actualise pas »).
//
// CE QUE CE FICHIER VERROUILLE (defaut -> regle) :
//   A1 — LE CORPS DE LA COLONNE EST CREE. Il ne l'etait pas : `vocalRenderDiscussion`
//        cherchait `.vocal-side-body` dans la colonne de gauche, qui n'en avait
//        aucun (le balisage statique ne le pose que dans la colonne de droite),
//        puis sortait par `if (!corps) return;` : le titre « DISCUSSION » etait
//        peint, le contenu jamais. Ce test ECHOUE sur le code d'avant.
//   A2 — LA REPONSE EST LUE DANS SES SEULES SECTIONS DE TEXTE
//        (`.agent-text-section`) : la reflexion et les lignes d'outils vivent
//        dans la MEME bulle, une lecture de la bulle entiere les ferait
//        paraître. La liste blanche est la regle.
//   A3 — LE FILTRE EST CELUI DU MODULE PUR : `vocalSpeechTurns()`, jamais une
//        seconde regle ecrite ici.
//   A4 — LE PLUS RECENT RESTE VISIBLE : le corps est colle au bas et defile
//        jusqu'au dernier message ecrit.
//   A5 — LA MISE A JOUR EST EN DIRECT, SANS SECONDE HORLOGE : le tic existant de
//        900 ms repasse par `vocalSyncSides()`, et le corps n'est reecrit que
//        quand le texte change (aucun clignotement, aucun gel de l'ecran).
//   A6 — AUCUN REGLAGE NOUVEAU, AUCUN STOCKAGE : rien n'est memorise, aucune
//        couleur en dur, la colonne reste du decor.
//
// Les commentaires sont en ASCII ; les chaines lues dans les sources sont
// copiees telles quelles.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// Decoupage VERIFIE (quality-gate § 3.4) : une ancre absente LEVE au lieu de
// rendre un fragment vide, qui rendrait vraie toute assertion negative.
import { sliceSource } from "./source-slice.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) => readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const SUPER = lire("src/js/super-agent.js");
const CSS = lire("src/css/style.css");

/** La peinture de la colonne de gauche, en entier. */
const RENDU = sliceSource(SUPER, "function vocalRenderDiscussion(", "\n}\n", 400);
/** La lecture de la conversation, en entier. */
const LECTURE = sliceSource(SUPER, "function collectVocalDiscussion()", "\n}\n", 200);
/** La branche « reponse de l'assistant » : c'est elle qui decide ce qui est lu. */
const BRANCHE_REPONSE = sliceSource(LECTURE, "} else {", "lus.push(", 80);
/** Le point d'ecriture unique des deux colonnes. */
const SYNCHRO = sliceSource(SUPER, "function vocalSyncSides()", "\n}\n", 300);

describe("A1 — la colonne de gauche recoit un corps, et il est peint", () => {
  it("le corps est CREE par la peinture, il n'est plus seulement cherche", () => {
    // Le defaut, mot pour mot : la peinture ne faisait que CHERCHER le corps.
    expect(RENDU).not.toMatch(/querySelector\("\.vocal-side-body"\)/);
    // Il le cree, une seule fois, et le pose en DERNIER (sous le titre).
    expect(RENDU).toMatch(/vocalColumnNode\(colonne, "\.vocal-side-body", "last"\)/);
    // Le titre est toujours cree en PREMIER : l'apercu tombe au bas de la colonne.
    const titre = RENDU.indexOf('".vocal-discussion-title"');
    const corps = RENDU.indexOf('".vocal-side-body"');
    expect(titre).toBeGreaterThan(-1);
    expect(corps).toBeGreaterThan(titre);
    expect(RENDU).toMatch(/vocalColumnNode\(colonne, "\.vocal-discussion-title", "first"\)/);
  });

  it("le balisage statique de l'aside de gauche reste vide : rien n'est duplique", () => {
    // Le corps de la colonne de droite est dans le balisage ; celui de gauche
    // n'y est pas — c'est voulu (la liste ordonnee des classes de l'overlay ne
    // bouge pas). Une seule creation, a l'execution.
    expect(SUPER).toContain('<aside class="vocal-side-discussion vocal-side"></aside>');
    expect(RENDU).toMatch(/ov\.querySelector\("\.vocal-side-discussion"\)/);
  });

  it("le corps peint n'est jamais masque par la feuille de style", () => {
    // « une zone sans hauteur ou cachee » : la regle du corps de gauche est
    // explicite, elle ne l'efface ni ne le reduit a zero.
    const CORPS = sliceSource(CSS, ".vocal-side-discussion > .vocal-side-body {", "}", 20);
    expect(CORPS).not.toMatch(/display:\s*none/);
    expect(CORPS).not.toMatch(/visibility:\s*hidden/);
    expect(CORPS).not.toMatch(/height:\s*0/);
    expect(CORPS).toMatch(/display:\s*flex/);
  });

  it("un contenu vide n'ecrit rien du tout, mais le corps reste en place", () => {
    // Aucun message : la colonne garde son corps (aucune exception, aucun
    // noeud retire) et ne peint rien.
    expect(RENDU).toMatch(/data-vocal-discussion/);
    expect(RENDU).not.toMatch(/\.remove\(|removeChild/);
  });
});

describe("A2 — un message technique ne peut pas entrer dans la colonne", () => {
  it("la reponse est lue dans ses SEULES sections de texte", () => {
    expect(BRANCHE_REPONSE).toMatch(/querySelectorAll\("\.agent-text-section"\)/);
    // La bulle entiere n'est JAMAIS lue comme le texte de la reponse : elle
    // porte aussi la reflexion et les lignes d'outils.
    expect(BRANCHE_REPONSE).not.toMatch(/source\.textContent/);
    expect(BRANCHE_REPONSE).toMatch(/morceaux\.join/);
  });

  it("la demande du proprietaire est lue dans sa bulle, sans l'etiquette de projet", () => {
    const BRANCHE_DEMANDE = sliceSource(LECTURE, "if (estUtilisateur) {", "} else {", 80);
    expect(BRANCHE_DEMANDE).toMatch(/\.textContent/);
    expect(BRANCHE_DEMANDE).toMatch(/\.agent-project-badges/);
  });

  it("les deux familles du chat, et elles seules, sont parcourues", () => {
    expect(LECTURE).toMatch(/"\.agent-message-user, \.agent-message-assistant"/);
    expect(LECTURE).toMatch(/querySelector\("\.agent-bubble"\)/);
  });
});

describe("A3 — le filtre est celui du module pur, pas une seconde regle", () => {
  it("la lecture passe par `vocalSpeechTurns()`", () => {
    expect(SUPER).toMatch(/import \{ vocalSpeechTurns \} from "\.\/vocal-discussion-turns\.js"/);
    expect(LECTURE).toMatch(/vocalSpeechTurns\(lus\)/);
    // Le total compte les TOURS DE PAROLE, jamais les messages techniques.
    expect(LECTURE).toMatch(/const total = messages\.length;/);
  });

  it("aucune regle de filtrage n'est reecrite dans la lecture", () => {
    // Une seule regle, un seul endroit : si la lecture se met a comparer des
    // roles ou des familles elle-meme, il y aura deux verites.
    expect(LECTURE).not.toMatch(/kind\s*===|kind\s*!==|includes\(kind\)/);
    expect(LECTURE).not.toMatch(/VOCAL_SILENT_KINDS|VOCAL_SPEECH_KINDS/);
  });
});

describe("A4 — le message le plus recent reste visible", () => {
  it("le corps defile jusqu'au dernier message ecrit", () => {
    expect(RENDU).toMatch(/corps\.scrollTop = corps\.scrollHeight;/);
    // Apres l'ecriture, jamais avant : un defilement pose sur du vide ne va nulle part.
    expect(RENDU.indexOf("corps.innerHTML = html")).toBeLessThan(
      RENDU.indexOf("corps.scrollTop = corps.scrollHeight"),
    );
  });

  it("le contenu remonte du bas : le dernier message touche le bord bas", () => {
    expect(sliceSource(CSS, ".vocal-side-discussion > .vocal-side-body {", "}", 20)).toMatch(
      /justify-content:\s*flex-end/,
    );
  });
});

describe("A5 — la mise a jour est en direct, sans seconde horloge", () => {
  it("le tic existant repasse par `vocalSyncSides`, qui peint la colonne", () => {
    expect(SUPER).toMatch(/vocalSidesTick = setInterval\(vocalSyncSides, VOCAL_SIDES_TICK_MS\)/);
    expect(SYNCHRO).toMatch(/vocalRenderDiscussion\(plan\)/);
  });

  it("le corps n'est reecrit que si le texte change : aucun clignotement", () => {
    expect(RENDU).toMatch(/getAttribute\("data-vocal-discussion"\) !== html/);
    expect(RENDU).toMatch(/setAttribute\("data-vocal-discussion", html\)/);
  });

  it("aucune boucle non bornee : l'ecran ne peut pas se figer sur un rendu", () => {
    expect(RENDU).not.toMatch(/for\s*\(\s*;\s*;|while\s*\(\s*(true|1)\s*\)/);
    expect(LECTURE).not.toMatch(/for\s*\(\s*;\s*;|while\s*\(\s*(true|1)\s*\)/);
    // Les deux boucles de la lecture avancent sur des index, pas sur du contenu.
    expect(LECTURE).toMatch(/for \(let i = 0; i < noeuds\.length; i\+\+\)/);
  });

  it("une conversation deja ouverte n'attend aucun evenement : elle est lue a l'entree", () => {
    // `enterVocal` peint les colonnes en DERNIER, apres l'etat : l'historique de
    // la session en cours est donc la des l'ouverture.
    const ENTREE = sliceSource(SUPER, "function enterVocal()", "\n  function exitVocal()", 400);
    expect(ENTREE).toMatch(/vocalSyncSides\(\);/);
    // Et la lecture ne depend d'aucun evenement : elle relit le DOM a chaque tic.
    expect(LECTURE).toMatch(/superMessagesEl/);
  });
});

describe("A6 — aucun reglage nouveau, aucun stockage, aucun clic", () => {
  it("l'apercu ne se memorise pas et ne s'enregistre pas", () => {
    expect(RENDU).not.toMatch(/localStorage|sessionStorage|invoke\(/);
    expect(LECTURE).not.toMatch(/localStorage|sessionStorage|invoke\(/);
  });

  it("la colonne reste du decor : aucun noeud focusable, aucune couleur en dur", () => {
    expect(RENDU).not.toMatch(/<button|<a\s|tabindex|role=/);
    expect(RENDU).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(LECTURE).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
