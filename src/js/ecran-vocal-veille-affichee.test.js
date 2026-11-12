// Tests — LA VEILLE SE VOIT SUR L'ECRAN VOCAL (constat du proprietaire, 2026-11-16).
//
// LE DEFAUT CORRIGE : quand la veille s'armait (20 s de silence, ou ordre
// d'arret), RIEN a l'ecran ne le disait. Le bas s'efface bien avant (10 s de
// repos), et la seule ligne qui demande le nom partait donc avec lui ; le
// cercle, lui, reprenait l'aspect du repos ordinaire (`vocalEtatAffiche` rend
// « idle » pendant la veille — comportement verrouille, inchange ici). Il
// fallait parler pour decouvrir qu'on attendait un nom.
//
// CE QUE CE FICHIER VERROUILLE :
//   1. UNE classe (`vocal-veille`), UN point d'ecriture, posee au MOMENT de
//      l'armement et retiree au moment ou la veille tombe — aucun minuteur,
//      aucun second mecanisme.
//   2. La ligne d'etat RESTE VISIBLE pendant la veille, et SEULE : la zone de
//      saisie et le bouton de depannage gardent leur effacement, la liste des
//      trois noeuds masques ne bouge pas, et la regle ne reprend aucune prise de
//      clic (issue #381).
//   3. Le cercle prend l'aspect de l'attente (anneau pointille, respiration
//      arretee) sans deplacer un pixel ; la respiration du repos reste intacte
//      HORS veille.
//   4. Ce qui n'a pas bouge : l'etat affiche (toujours « idle »), les 20 s, la
//      garde du nom, l'effacement du bas au repos, et le texte/nom qui viennent
//      des sources uniques (aucune phrase recopiee ici).
//
// Les commentaires sont en ASCII ; les selecteurs et les textes d'interface
// sont copies tels quels.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// Decoupage de source VERIFIE : une ancre absente LEVE au lieu de rendre un
// fragment vide qui rendrait l'assertion vraie par construction.
import { sliceSource } from "./source-slice.js";
import {
  VOCAL_ECOUTE_LIBRE_MS,
  VOCAL_VEILLE_CLASS,
  vocalEtatAffiche,
  vocalVeilleSentence,
  vocalNameSentence,
} from "./vocal-nom-garde.js";
import { VOCAL_CHROME_HIDDEN_CLASS, vocalChromeVisible } from "./vocal-chrome.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) =>
  readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const CSS = lire("src/css/style.css");
const SUPER = lire("src/js/super-agent.js");

/** Corps d'une fonction du module (`sliceSource` LEVE si l'ancre a disparu). */
function corpsFonction(src, entete) {
  return sliceSource(src, entete, "\n  }", 2);
}

/** Corps d'un bloc CSS `selecteur { ... }` (premiere occurrence). */
function bloc(css, selecteur, minLen = 2) {
  return sliceSource(css, selecteur, "}", minLen);
}

// Les trois blocs CSS qui comptent, lus par leur selecteur exact.
const SEL_MASQUE = ".pilot-vocal.vocal-chrome-hidden .vocal-status,";
const SEL_VEILLE = ".pilot-vocal.vocal-veille.vocal-chrome-hidden .vocal-status {";
const SEL_REDUIT = ".pilot-vocal.vocal-reduced.vocal-chrome-hidden .vocal-status,";
const SEL_ORB_REPOS = ".pilot-vocal.vocal-state-idle .vocal-orb {";
const SEL_ORB_VEILLE = ".pilot-vocal.vocal-veille.vocal-state-idle .vocal-orb {";

const BLOC_MASQUE = bloc(CSS, SEL_MASQUE);
const BLOC_VEILLE = bloc(CSS, SEL_VEILLE);
const BLOC_REDUIT = bloc(CSS, SEL_REDUIT);
const BLOC_ORB_REPOS = bloc(CSS, SEL_ORB_REPOS);
const BLOC_ORB_VEILLE = bloc(CSS, SEL_ORB_VEILLE);

// Les deux fonctions qui changent l'etat de veille, et le point d'ecriture de
// la classe : les trois seules portees du branchement.
const ENTREE_VEILLE = corpsFonction(SUPER, "  function vocalEnterVeille(origine) {");
const SORTIE_VEILLE = corpsFonction(SUPER, "  function vocalExitVeille() {");
const ECRITURE = corpsFonction(SUPER, "  function vocalSyncVeilleClass() {");

// ---------------------------------------------------------------------------
describe("1. une classe, un point d'ecriture, posee a l'instant de l'armement", () => {
  it("le nom de la classe est celui que la feuille de style connait", () => {
    expect(VOCAL_VEILLE_CLASS).toBe("vocal-veille");
    expect(CSS).toContain(".pilot-vocal.vocal-veille");
  });

  it("un seul ecrivain, et il ne fait rien d'autre que poser ou retirer la classe", () => {
    // Aucune deuxieme ecriture ailleurs dans le fichier.
    const definitions = SUPER.match(/function vocalSyncVeilleClass\(/g) || [];
    expect(definitions).toHaveLength(1);
    // Il lit la SEULE verite (`vocalVeilleArmee`) et la seule classe du module.
    expect(ECRITURE).toContain(
      "vocalOverlay.classList.toggle(VOCAL_VEILLE_CLASS, vocalVeilleArmee === true)",
    );
    // Aucun ecran ouvert : rien a faire (et surtout aucune exception).
    expect(ECRITURE).toContain("if (!vocalOverlay) return;");
    // Aucun minuteur, aucun texte ecrit dans le DOM, aucune autre classe.
    expect(ECRITURE).not.toMatch(/setTimeout|setInterval|textContent|innerHTML/);
    expect(ECRITURE).not.toMatch(/classList\.(add|remove)/);
    const classes = ECRITURE.match(/classList\.toggle\(([A-Z_]+)/g) || [];
    expect(classes).toEqual(["classList.toggle(VOCAL_VEILLE_CLASS"]);
  });

  it("la classe est posee DANS la fonction qui arme la veille (donc sans attendre un geste)", () => {
    // Une seule affectation `vocalVeilleArmee = true` dans tout le fichier : le
    // point d'armement, ou la classe est posee dans la meme tache.
    const armements = SUPER.match(/vocalVeilleArmee = true;/g) || [];
    expect(armements).toHaveLength(1);
    expect(ENTREE_VEILLE).toContain("vocalVeilleArmee = true;");
    expect(ENTREE_VEILLE).toContain("vocalSyncVeilleClass();");
    // Ordre : l'etat d'abord, l'aspect ensuite (jamais l'inverse).
    expect(ENTREE_VEILLE.indexOf("vocalVeilleArmee = true;")).toBeLessThan(
      ENTREE_VEILLE.indexOf("vocalSyncVeilleClass();"),
    );
    // Aucun minuteur n'est pose la : la veille n'est pas une animation.
    expect(ENTREE_VEILLE).not.toMatch(/setTimeout|setInterval/);
  });

  it("la classe tombe AVEC la veille, dans la fonction qui la leve", () => {
    expect(SORTIE_VEILLE).toContain("vocalVeilleArmee = false;");
    expect(SORTIE_VEILLE).toContain("vocalSyncVeilleClass();");
    expect(SORTIE_VEILLE.indexOf("vocalVeilleArmee = false;")).toBeLessThan(
      SORTIE_VEILLE.indexOf("vocalSyncVeilleClass();"),
    );
    expect(SORTIE_VEILLE).not.toMatch(/setTimeout|setInterval/);
  });
});

// ---------------------------------------------------------------------------
describe("2. la ligne d'etat reste visible pendant la veille, et SEULE", () => {
  it("l'effacement du bas n'a pas bouge : trois noeuds, opacite 0", () => {
    const noeuds = [...BLOC_MASQUE.matchAll(/\.vocal-chrome-hidden \.([a-z-]+)/g)].map(
      (m) => m[1],
    );
    expect(noeuds).toEqual(["vocal-status", "vocal-input", "vocal-mic-fix"]);
    expect(BLOC_MASQUE).toMatch(/opacity:\s*0/);
    expect(BLOC_MASQUE).toMatch(/visibility:\s*hidden/);
    expect(VOCAL_CHROME_HIDDEN_CLASS).toBe("vocal-chrome-hidden");
  });

  it("la liste des noeuds masques ne grandit pas (aucun quatrieme nom)", () => {
    // Meme lecture que `vocal-saisie-declenchement.test.js` : la regle
    // d'exception reprend `.vocal-status`, elle n'ajoute aucun nom.
    const masques = CSS.match(/\.vocal-chrome-hidden \.vocal-[a-z-]+/g) || [];
    expect([...new Set(masques)].sort()).toEqual([
      ".vocal-chrome-hidden .vocal-input",
      ".vocal-chrome-hidden .vocal-mic-fix",
      ".vocal-chrome-hidden .vocal-status",
    ]);
  });

  it("l'exception ne rend visible que la ligne d'etat, et le dit en clair", () => {
    expect(BLOC_VEILLE).toMatch(/opacity:\s*1/);
    expect(BLOC_VEILLE).toMatch(/visibility:\s*visible/);
    expect(BLOC_VEILLE).toMatch(/transform:\s*none/);
    // Elle exige les DEUX circonstances : veille armee ET bas efface.
    expect(BLOC_VEILLE).toContain("vocal-veille");
    expect(BLOC_VEILLE).toContain("vocal-chrome-hidden");
    // La saisie et le bouton de depannage restent effaces : aucun nom d'eux ici.
    expect(BLOC_VEILLE).not.toContain(".vocal-input");
    expect(BLOC_VEILLE).not.toContain(".vocal-mic-fix");
    // La forme de l'effacement ne change pas (aucun `display`, aucune position).
    expect(BLOC_VEILLE).not.toMatch(/display:/);
    expect(BLOC_VEILLE).not.toMatch(/position:/);
  });

  it("aucune prise de clic nouvelle : la ligne ne s'interpose pas (issue #381)", () => {
    // Elle reste `pointer-events: none` (heritee du bloc d'effacement) : il n'y a
    // rien a cliquer dessus, et rien n'y avale un clic destine a l'ecran.
    expect(BLOC_VEILLE).not.toMatch(/pointer-events:\s*auto/);
    // Une seule regle de la feuille remet un noeud du bas en `visibility:
    // visible`, et c'est celle de la veille.
    const exceptions = [
      ...CSS.matchAll(/[^{}]*\.vocal-chrome-hidden[^{}]*\{[^}]*visibility:\s*visible[^}]*\}/g),
    ].map((m) => m[0]);
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0]).toContain("vocal-veille");
  });

  it("la regle est placee entre l'effacement et le mouvement reduit", () => {
    // AVANT le bloc du mouvement reduit, pour que son `transition: none` gagne
    // (aucun fondu quand le systeme demande le mouvement reduit).
    expect(BLOC_REDUIT).toMatch(/transition:\s*none/);
    const iMasque = CSS.indexOf(SEL_MASQUE);
    const iVeille = CSS.indexOf(SEL_VEILLE);
    const iReduit = CSS.indexOf(SEL_REDUIT);
    expect(iMasque).toBeGreaterThan(-1);
    expect(iVeille).toBeGreaterThan(iMasque);
    expect(iReduit).toBeGreaterThan(iVeille);
    // Et APRES le bloc d'effacement, dont les tests de decoupage s'arretent a sa
    // premiere accolade fermante.
    expect(BLOC_MASQUE).not.toContain("vocal-veille");
  });
});

// ---------------------------------------------------------------------------
describe("3. le cercle de la veille : l'attente se voit, la place ne bouge pas", () => {
  it("le repos ordinaire respire toujours (hors veille, rien ne change)", () => {
    expect(BLOC_ORB_REPOS).toMatch(/animation:\s*vocal-breathe/);
  });

  it("la veille : anneau pointille, respiration arretee", () => {
    expect(BLOC_ORB_VEILLE).toMatch(/animation:\s*none/);
    expect(BLOC_ORB_VEILLE).toMatch(/border-style:\s*dashed/);
  });

  it("aucune geometrie touchee : ni taille, ni position, ni centrage", () => {
    expect(BLOC_ORB_VEILLE).not.toMatch(/\b(width|height|inset|margin|top|left)\s*:/);
    expect(BLOC_ORB_VEILLE).not.toMatch(/border-radius/);
    expect(BLOC_ORB_VEILLE).not.toMatch(/transform\s*:/);
    // La teinte d'etat reste celle du module : aucune couleur inventee ici.
    expect(BLOC_ORB_VEILLE).not.toMatch(/--vocal-state\s*:/);
    expect(BLOC_ORB_VEILLE).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });

  it("elle ne vise que l'etat repos : la parole et la reflexion gardent leur aspect", () => {
    // Le selecteur complet (lu dans la feuille, pas recompose) porte les deux
    // etats : la veille ET le repos affiche.
    expect(CSS).toContain(SEL_ORB_VEILLE);
    expect(BLOC_ORB_VEILLE).not.toMatch(/vocal-state-(speaking|thinking|listening)/);
    // Aucun autre element de l'ecran n'est nomme (halo, relance, couronne).
    expect(BLOC_ORB_VEILLE).not.toMatch(/vocal-halo|vocal-restart|::before|::after/);
  });
});

// ---------------------------------------------------------------------------
describe("4. l'etat, le seuil et le texte n'ont pas bouge", () => {
  it("l'etat affiche pendant la veille est TOUJOURS le repos (verrou du 2026-11-16)", () => {
    // Le correctif est un ASPECT (CSS), pas un cinquieme etat : une ligne qui
    // s'ecoute redeviendrait « Je vous ecoute », ce que le proprietaire a
    // refuse.
    expect(vocalEtatAffiche({ veilleArmee: true, etat: "listening" })).toBe("idle");
    expect(vocalEtatAffiche({ veilleArmee: true, etat: "speaking" })).toBe("speaking");
  });

  it("les 20 s et la garde du nom sont intacts", () => {
    expect(VOCAL_ECOUTE_LIBRE_MS).toBe(20000);
    // Aucun seuil recopie dans la feuille de style ni dans le branchement.
    expect(CSS).not.toMatch(/\b20000\b|\b20_000\b/);
    expect(ECRITURE).not.toMatch(/\b20\s?000\b/);
  });

  it("la phrase vient de la source unique, le nom aussi : rien n'est recopie", () => {
    // Le nom affiche reste `superAgentDisplayLabel()`, lu au seul point
    // d'ecriture de la ligne d'etat.
    expect(SUPER).toContain('vocalVeilleArmee === true ? superAgentDisplayLabel() : ""');
    // Aucune phrase d'invitation n'est ecrite en dur dans le branchement ni
    // dans la feuille de style : elles vivent dans `vocal-nom-garde.js`.
    for (const source of [SUPER, CSS]) {
      expect(source).not.toContain("Je me mets en veille");
      expect(source).not.toContain("dites mon nom pour me parler");
    }
    // Les deux phrases restent celles du module, inchangees.
    expect(vocalVeilleSentence("Aurelia")).toBe(
      "Je me mets en veille — dites « Aurelia » pour me parler.",
    );
    expect(vocalNameSentence("Aurelia")).toBe("Dites « Aurelia » pour me parler.");
  });
});

// ---------------------------------------------------------------------------
describe("5. hors veille, le bas s'efface exactement comme avant", () => {
  it("au repos, rien ne retient le bas : la decision pure n'a pas change", () => {
    expect(vocalChromeVisible({})).toBe(false);
    expect(vocalChromeVisible({ etat: "idle", saisie: false })).toBe(false);
    // Ce qui retient le bas est inchange (champ rempli, pointeur, panne).
    expect(vocalChromeVisible({ saisie: true })).toBe(true);
    expect(vocalChromeVisible({ micFerme: true })).toBe(true);
    expect(vocalChromeVisible({ question: true })).toBe(true);
  });

  it("l'exception de la veille ne peut pas s'appliquer sans la classe", () => {
    // Tout le bloc d'exception exige `.vocal-veille` : sans la classe, la seule
    // regle qui parle du bas efface est celle des trois noeuds.
    expect(SEL_VEILLE).toContain(".vocal-veille");
    expect(SEL_VEILLE).toContain(".vocal-chrome-hidden");
    expect(SEL_VEILLE).toContain(".vocal-status");
    // Et la classe n'est posee que par le point d'ecriture, lui-meme appele par
    // les deux fonctions de veille.
    const appels = SUPER.match(/vocalSyncVeilleClass\(\);/g) || [];
    expect(appels).toHaveLength(2);
  });
});
