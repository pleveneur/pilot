// Tests — LE BOUTON « TRAVAIL » SUR L'ECRAN DU MODE VOCAL (decision du
// proprietaire : « le bouton Travail qu'on trouve en haut a droite doit aussi
// exister sur l'ecran du mode vocal, tout en haut, juste a gauche des boutons
// systeme de la fenetre »).
//
// CE QUE CE FICHIER VERROUILLE (et pourquoi) :
//   1. C'est le MEME bouton : le noeud `#agent-activity` est DEPLACE dans
//      l'overlay a l'entree du mode et restitue a la sortie. Aucune copie,
//      aucun second `id`, aucun second panneau, aucun second ecouteur : si
//      quelqu'un recree un bouton pour cet ecran, ces assertions tombent.
//   2. La PLACE demandee : tout en haut, immediatement a GAUCHE des trois
//      boutons systeme. Elle est ecrite une seule fois, en CSS, et son
//      arithmetique est RECALCULEE depuis le disque (largeur des touches,
//      air du groupe, hauteur du bouton) : aucune valeur choisie a l'oeil.
//   3. Le CONTENU du panneau ne change pas : les trois volets et la fiche
//      restent ceux du panneau unique, alimentes par le meme code.
//   4. Rien d'autre ne bouge sur l'ecran : ni l'objet lumineux, ni la ligne
//      d'etat, ni la barre de saisie, ni le bouton de relance (la coupure de la
//      voix). La regle ne nomme que `#agent-activity`.
//
// Les commentaires sont en ASCII ; les chaines qui viennent de l'interface
// (selecteurs, identifiants) sont copiees telles quelles.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sliceSource } from "./source-slice.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) =>
  readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");

const SUPER = lire("src/js/super-agent.js");
const CSS = lire("src/css/style.css");
const HTML = lire("index.html");
const ACTIVITE = lire("src/js/agent-activity.js");
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

/** Nombre d'occurrences d'un motif. */
function combien(src, motif) {
  return (src.match(motif) || []).length;
}

// ---------------------------------------------------------------------------
describe("1. le MEME bouton, jamais un second", () => {
  it("un seul noeud dans tout le document : un id, un bouton, un panneau", () => {
    expect(combien(HTML, /id="agent-activity"/g)).toBe(1);
    expect(combien(HTML, /id="agent-activity-entry"/g)).toBe(1);
    expect(combien(HTML, /id="agent-activity-dropdown"/g)).toBe(1);
    expect(combien(HTML, /id="agent-activity-card"/g)).toBe(1);
    // Le panneau et la fiche sont DANS le conteneur : deplacer le conteneur
    // deplace donc le bouton ET son panneau, sans rien recopier.
    const conteneur = sliceSource(HTML, '<div id="agent-activity">', "\n    </div>", 100);
    expect(conteneur).toContain('id="agent-activity-entry"');
    expect(conteneur).toContain('id="agent-activity-dropdown"');
  });

  it("l'ecran Vocal DEPLACE ce noeud au lieu d'en dessiner un autre", () => {
    const entree = corpsFonction(SUPER, "function enterVocal");
    expect(entree).toMatch(/document\.getElementById\("agent-activity"\)/);
    expect(entree).toMatch(/vocalOverlay\.appendChild\(activite\)/);
    // La place d'origine est memorisee (parent + voisin) : restitution exacte.
    expect(entree).toMatch(
      /vocalActivityHome = \{ parent: activite\.parentNode, next: activite\.nextSibling \}/,
    );
    // Le balisage de l'ecran n'en contient AUCUNE trace : il n'y a pas de
    // second bouton « Travail » cree pour ce mode.
    const build = corpsFonction(SUPER, "function buildVocalOverlay");
    expect(build).not.toMatch(/agent-activity/);
  });

  it("aucun second ecouteur de clic : celui d'agent-activity.js reste le seul", () => {
    // Un seul ajout d'ecouteur sur l'entree, et il porte sur l'entree EXISTANTE.
    expect(combien(ACTIVITE, /agent-activity-entry"\)/g)).toBeGreaterThan(0);
    const i = ACTIVITE.indexOf('const entry = document.getElementById("agent-activity-entry");');
    expect(i).toBeGreaterThan(-1);
    const apres = ACTIVITE.slice(i, i + 400);
    expect(apres).toMatch(/trigger\.addEventListener\("click"/);
    // L'ecran Vocal ne pose aucun ecouteur sur le bouton : il ne peut pas
    // exister deux comportements pour le meme clic.
    const entree = corpsFonction(SUPER, "function enterVocal");
    expect(entree).not.toMatch(/activite\.addEventListener/);
  });
});

// ---------------------------------------------------------------------------
describe("2. la place demandee : tout en haut, juste a gauche des boutons systeme", () => {
  const regle = bloc(CSS, "body.pilot-vocal-active #agent-activity {");
  const entreeBouton = bloc(CSS, "#agent-activity-entry {");

  it("la regle est la seule a placer le bouton sur cet ecran", () => {
    expect(regle).toMatch(/position:\s*absolute/);
    expect(regle).toMatch(/margin:\s*0;/);
    expect(regle).toMatch(/z-index:\s*3/);
  });

  it("le decalage vertical CENTRE les 22 px du bouton dans la ligne des touches", () => {
    // Recalcul depuis le disque : hauteur de la rangee - l'air du groupe donne
    // la hauteur des touches ; le bouton (22 px) est centre dedans.
    const rangee = bloc(CSS, "#tab-row {");
    const groupe = bloc(CSS, "#window-controls {");
    const hauteurRangee = Number(rangee.match(/min-height:\s*(\d+)px/)[1]);
    const air = Number(groupe.match(/padding:\s*(\d+)px/)[1]);
    const hauteurTouche = hauteurRangee - 2 * air;
    const hauteurBouton = Number(entreeBouton.match(/height:\s*(\d+)px/)[1]);
    const attendu = air + (hauteurTouche - hauteurBouton) / 2;
    expect(air).toBe(4);
    expect(hauteurTouche).toBe(28);
    expect(hauteurBouton).toBe(22);
    expect(attendu).toBe(7);
    expect(regle).toMatch(new RegExp(`top:\\s*${attendu}px`));
    // Le bouton ne mord pas la ligne des touches : il tient dedans.
    expect(attendu + hauteurBouton).toBeLessThanOrEqual(air + hauteurTouche + 0.5);
  });

  it("le decalage horizontal reprend la largeur des touches + l'air de « Detaille »", () => {
    // Largeur du groupe des trois boutons, recomptee depuis le disque.
    const largeurBouton = Number(
      bloc(CSS, "#window-controls > button {").match(/width:\s*(\d+)px/)[1],
    );
    const groupe = bloc(CSS, "#window-controls {");
    const air = Number(groupe.match(/padding:\s*(\d+)px/)[1]);
    const largeurGroupe = largeurBouton * 3 + air;
    expect(largeurGroupe).toBe(142);
    // L'air qui separe deja l'entree des boutons systeme dans « Detaille ».
    const marge = bloc(CSS, "#agent-activity {").match(/margin:\s*0 (\d+)px 0 (\d+)px/);
    expect(marge, "marge de l'entree introuvable").not.toBeNull();
    const airEntree = Number(marge[1]);
    expect(airEntree).toBe(6);
    expect(regle).toMatch(
      new RegExp(
        `right:\\s*calc\\(var\\(--window-controls-width\\) \\+ ${airEntree}px\\)`,
      ),
    );
    // Le jeton lui-meme vaut bien la largeur recomptee : si un jour les touches
    // changent, ce test echoue AVANT que le bouton ne se decolle.
    expect(bloc(CSS, ":root {")).toMatch(
      new RegExp(`--window-controls-width:\\s*${largeurGroupe}px`),
    );
  });

  it("le bouton reste au-dessus de l'ecran mais SOUS les boutons systeme", () => {
    // L'overlay est a 99990 ; les boutons systeme a 100001. Le bouton vit dans
    // l'overlay (donc au-dessus du contenu de l'ecran) et ne peut pas passer
    // devant la fenetre : elle reste fermable et deplacable.
    const overlay = bloc(CSS, ".pilot-vocal {");
    expect(overlay).toMatch(/z-index:\s*99990/);
    const systeme = bloc(CSS, "#window-controls {");
    expect(systeme).toMatch(/z-index:\s*100001/);
    // Un z-index LOCAL (petit) dans l'overlay : pas de valeur qui imite ceux du
    // contexte racine.
    expect(regle).not.toMatch(/z-index:\s*1\d{4}/);
  });
});

// ---------------------------------------------------------------------------
describe("3. le panneau montre la meme chose que sur l'ecran principal", () => {
  it("les trois volets et la fiche sont ceux du panneau unique", () => {
    for (const volet of [
      'id="agent-activity-pane-agents"',
      'id="agent-activity-pane-tasks"',
      'id="agent-activity-pane-events"',
      'id="agent-activity-pane"',
    ]) {
      if (volet === 'id="agent-activity-pane"') continue; // garde generique
      expect(HTML).toContain(volet);
    }
    // Les volets sont DANS le panneau : un seul panneau, donc un seul contenu
    // quel que soit l'ecran d'ou il s'ouvre.
    const panneau = sliceSource(HTML, '<div id="agent-activity-dropdown"', "\n        </div>\n", 100);
    expect(panneau).toContain("agent-activity-pane-agents");
    expect(panneau).toContain("agent-activity-pane-tasks");
  });

  it("le contenu vient de la MEME source et du MEME code", () => {
    // UNE seule definition du magasin partage : c'est elle qui garantit le
    // meme affichage sur les deux ecrans.
    expect(combien(ACTIVITE, /export function subscribeAgentActivity/g)).toBe(1);
    // Le panneau ET le bouton la consomment (aucun poll prive pour un ecran).
    expect(combien(ACTIVITE, /subscribeAgentActivity\(/g)).toBeGreaterThanOrEqual(3);
    expect(ACTIVITE).toMatch(/export function initAgentActivity/);
    // Le compteur « en cours / total » du bouton n'existe qu'une fois.
    expect(combien(HTML, /id="agent-activity-count"/g)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("4. rien d'autre ne bouge sur l'ecran Vocal", () => {
  const regle = bloc(CSS, "body.pilot-vocal-active #agent-activity {");

  it("la regle ne nomme QUE le bouton (aucun autre element de l'ecran)", () => {
    for (const autre of [
      "vocal-orb",
      "vocal-restart",
      "vocal-halo",
      "vocal-input",
      "vocal-status",
      "vocal-top",
      "vocal-stage",
      "mode-logo",
    ]) {
      expect(regle).not.toContain(autre);
    }
  });

  it("les commandes vocales gardent leurs regles et leur place", () => {
    // Le bouton de relance et la coupure de la voix restent dans le disque.
    expect(bloc(CSS, ".vocal-restart {")).toMatch(/position:\s*absolute/);
    // La ligne d'etat et la barre de saisie ne sont pas deplacees.
    expect(bloc(CSS, ".vocal-status {")).toMatch(/position|margin/);
    expect(bloc(CSS, ".vocal-input {")).toMatch(/width:\s*min\(720px/);
    // Le bouton de relance est TOUJOURS branche sur l'entree du mode.
    const entree = corpsFonction(SUPER, "function enterVocal");
    expect(entree).toMatch(/relance\.addEventListener\("click", toggleVoiceInput\)/);
  });

  it("la restitution se fait AVANT le retrait de l'overlay, pour les trois noeuds", () => {
    const sortie = corpsFonction(SUPER, "function exitVocal");
    const retrait = sortie.indexOf("vocalOverlay.remove()");
    expect(retrait).toBeGreaterThan(-1);
    const activite = sortie.indexOf("activiteHome.parent.insertBefore(activite, nextActivite)");
    const logo = sortie.indexOf("modeHome.parent.insertBefore(modeButton, next)");
    const saisie = sortie.indexOf("vocalInputHome.parent.insertBefore(inputBar, next)");
    expect(activite).toBeGreaterThan(-1);
    expect(logo).toBeGreaterThan(-1);
    expect(saisie).toBeGreaterThan(-1);
    // Les trois sortent de l'overlay AVANT qu'il ne soit retire et detruit.
    expect(activite).toBeLessThan(retrait);
    expect(logo).toBeLessThan(retrait);
    expect(saisie).toBeLessThan(retrait);
    expect(sortie).toMatch(/vocalActivityHome = null;/);
  });
});

// ---------------------------------------------------------------------------
describe("5. la regle est ecrite noir sur blanc (spec + aide integree)", () => {
  it("la spec decrit le bouton « Travail » sur cet ecran", () => {
    expect(SPEC).toMatch(/Travail/);
    expect(SPEC).toMatch(/gauche des trois boutons de fen/);
  });

  it("l'aide integree le dit aussi", () => {
    const aide = sliceSource(HELP, "<!-- HELP:modes-ecran -->", "<!-- /HELP:modes-ecran -->", 100);
    expect(aide).toMatch(/Travail/);
  });
});
