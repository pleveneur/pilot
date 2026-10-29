// Tests — LE BAS DE L'ECRAN VOCAL S'EFFACE AU REPOS
// (`docs/conceptions/CONCEPTION-ecran-vocal-cercle-et-bas.md` §2).
//
// CE QUE CE FICHIER VERROUILLE (et pourquoi) :
//   1. La decision PURE (`src/js/vocal-chrome.js`) : les quatre circonstances
//      qui interdisent le masquage, DANS L'ORDRE du document, et le masquage
//      permis au repos — y compris dictée armée mais encore silencieuse.
//   2. Les deux bornes du geste : 2 500 ms de delai, 4 px de mouvement, et
//      Echap qui ne reveille rien (c'est la sortie du mode).
//   3. Le BRANCHEMENT : un seul minuteur, un seul point d'ecriture de la classe,
//      la decision prise a la FIN de `applyVocalState` (donc a chaque etat), les
//      quatre ecouteurs poses a l'entree et retires a la sortie, et les deux
//      chemins qui font revenir le bas pendant qu'on ecrit (dictee + frappe).
//   4. Le PERIMETRE : la classe ne nomme QUE les trois noeuds du bas — jamais le
//      disque, la couronne, le bouton de relance, le logo ni « Travail » — et
//      l'effacement ne change pas la mise en page (aucun `display: none`).
//
// Le point 1 est celui qui empeche le defaut le plus grave : un bas qui
// s'effacerait PENDANT l'ecoute ou PENDANT une dictee en cours (on cacherait la
// ligne d'etat qui dit que le micro est ouvert, ou le texte en train d'arriver).
//
// Les commentaires sont en ASCII ; les chaines qui viennent de l'interface
// (textes affiches, selecteurs CSS) sont copiees telles quelles.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// Decoupage de source VERIFIE (une ancre absente leve au lieu de rendre un
// fragment vide qui rendrait l'assertion vraie par construction).
import { sliceSource } from "./source-slice.js";
import {
  VOCAL_CHROME_HIDDEN_CLASS,
  VOCAL_CHROME_IDLE_MS,
  VOCAL_CHROME_MOVE_PX,
  vocalChromeClass,
  vocalChromeMoved,
  vocalChromeVisible,
  vocalChromeWakeKey,
} from "./vocal-chrome.js";

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
function bloc(css, selecteur) {
  return sliceSource(css, selecteur, "}", 2);
}

/** Le bloc CSS du bas efface, tel qu'il est ecrit (les trois selecteurs). */
const BLOC_MASQUE = sliceSource(
  CSS,
  ".pilot-vocal.vocal-chrome-hidden .vocal-status,",
  "}",
  2,
);

// ---------------------------------------------------------------------------
describe("1. la decision pure : quatre circonstances retiennent le bas", () => {
  it("le repos, champ vide et pointeur ailleurs : le bas S'EFFACE", () => {
    // C'est la demande du proprietaire : l'ecran nu au repos. Et la dictee
    // armee mais encore muette ne change RIEN (cas particulier du §2.3) : aucun
    // fait ne la represente ici, donc l'ecran reste nu jusqu'au premier mot.
    expect(vocalChromeVisible({ etat: "idle", saisie: false })).toBe(false);
    expect(vocalChromeVisible({})).toBe(false);
    expect(vocalChromeVisible()).toBe(false);
    // Le troisieme etat, lui, ne retient pas le bas non plus : « reflechir »
    // n'est ni une ecoute ni une parole, et la phrase d'etat y est stable.
    expect(vocalChromeVisible({ etat: "thinking", saisie: false })).toBe(false);
  });

  it("regle 1 — un message du MICRO FERME retient le bas, quoi qu'il arrive", () => {
    expect(vocalChromeVisible({ etat: "idle", micFerme: "Micro refuse." })).toBe(true);
    // Le bouton « Autoriser le micro » est le seul recours : il reste cliquable
    // meme si tout le reste autoriserait le masquage.
    expect(
      vocalChromeVisible({ etat: "idle", saisie: false, pointeurActif: false, micFerme: "x" }),
    ).toBe(true);
    // Un message vide (ou l'absence de message) n'est pas une panne.
    expect(vocalChromeVisible({ etat: "idle", micFerme: "" })).toBe(false);
    expect(vocalChromeVisible({ etat: "idle", micFerme: "   " })).toBe(false);
  });

  it("regle 2 — le CHAMP occupe retient le bas (texte dicte, brouillon, focus)", () => {
    // Dictee en cours de transcription ou brouillon : le texte est la.
    expect(vocalChromeVisible({ etat: "idle", saisie: true })).toBe(true);
    // Et le focus dans le champ suffit (un utilisateur au clavier ne se
    // retrouve jamais devant un ecran sans zone de saisie).
    expect(vocalChromeVisible({ etat: "thinking", saisie: true })).toBe(true);
  });

  it("regle 3 — ECOUTE et PAROLE retiennent le bas, jamais masquees", () => {
    // LE DEFAUT A EMPECHER : un bas qui s'effacerait pendant que Pilot ecoute
    // cacherait la seule ligne qui dit que le micro est ouvert, et pendant la
    // lecture la seule qui dit que Pilot repond.
    expect(vocalChromeVisible({ etat: "listening", saisie: false })).toBe(true);
    expect(vocalChromeVisible({ etat: "speaking", saisie: false })).toBe(true);
    // Meme sans texte, sans panne et pointeur ailleurs : ce sont bien les etats
    // qui retiennent le bas, pas autre chose.
    expect(
      vocalChromeVisible({ etat: "listening", saisie: false, micFerme: "", pointeurActif: false }),
    ).toBe(true);
    expect(
      vocalChromeVisible({ etat: "speaking", saisie: false, micFerme: "", pointeurActif: false }),
    ).toBe(true);
  });

  it("regle 4 — le POINTEUR sur la zone du bas le retient", () => {
    expect(vocalChromeVisible({ etat: "idle", pointeurActif: true })).toBe(true);
    // Un `false` explicite, ou l'absence du fait, n'interdit rien.
    expect(vocalChromeVisible({ etat: "idle", pointeurActif: false })).toBe(false);
  });

  it("l'ORDRE des quatre regles est celui du document (1 -> 4)", () => {
    // Il se lit dans le source : chaque regle garde son numero, et la premiere
    // est bien le micro ferme. Un ordre change serait un changement de spec.
    const src = readFileSync(join(ICI, "vocal-chrome.js"), "utf8").replace(/\r\n/g, "\n");
    const paires = [
      ["1. Micro ferme", "micFerme"],
      ["2. Champ occupe", "saisie"],
      ["3. Pilot ecoute ou parle", "etat"],
      ["4. Pointeur sur la zone du bas", "pointeurActif"],
    ];
    let precedent = -1;
    for (const [commentaire, champ] of paires) {
      const iCommentaire = src.indexOf(commentaire);
      expect(iCommentaire, `regle « ${commentaire} » absente`).toBeGreaterThan(precedent);
      const iChamp = src.indexOf(`f.${champ}`, iCommentaire);
      expect(iChamp, `fait \`${champ}\` non lu sous sa regle`).toBeGreaterThan(iCommentaire);
      precedent = iCommentaire;
    }
  });

  it("la classe est l'INVERSE de la visibilite, et elle a un nom unique", () => {
    expect(VOCAL_CHROME_HIDDEN_CLASS).toBe("vocal-chrome-hidden");
    expect(vocalChromeClass(false)).toBe("vocal-chrome-hidden");
    expect(vocalChromeClass(true)).toBe("");
    // Seul `false` masque : tout le reste laisse le bas visible.
    expect(vocalChromeClass(undefined)).toBe("");
  });
});

// ---------------------------------------------------------------------------
describe("2. le geste : 2 500 ms, 4 px, et Echap excepte", () => {
  it("le delai de remasquage est de 2 500 ms", () => {
    expect(VOCAL_CHROME_IDLE_MS).toBe(2500);
    expect(VOCAL_CHROME_MOVE_PX).toBe(4);
  });

  it("un mouvement sous 4 px n'est pas un geste (main posee qui tremble)", () => {
    const repere = { x: 100, y: 100 };
    expect(vocalChromeMoved({ x: 101, y: 101 }, repere)).toBe(false); // 1,41 px
    expect(vocalChromeMoved({ x: 102, y: 100 }, repere)).toBe(false); // 2 px
    expect(vocalChromeMoved({ x: 100, y: 102 }, repere)).toBe(false); // 2 px
    // 4 px : le seuil LUI-MEME est un geste (>=).
    expect(vocalChromeMoved({ x: 104, y: 100 }, repere)).toBe(true);
    expect(vocalChromeMoved({ x: 103, y: 103 }, repere)).toBe(true); // 4,24 px
  });

  it("sans repere connu, le premier mouvement reveille (l'ecran vient de s'ouvrir)", () => {
    expect(vocalChromeMoved({ x: 10, y: 10 }, null)).toBe(true);
    expect(vocalChromeMoved({ x: 10, y: 10 }, undefined)).toBe(true);
    // Et une position illisible ne reveille rien plutot que de faire n'importe quoi.
    expect(vocalChromeMoved(null, { x: 0, y: 0 })).toBe(false);
    expect(vocalChromeMoved({ x: Number.NaN, y: 0 }, { x: 0, y: 0 })).toBe(false);
  });

  it("toute touche reveille, SAUF Echap (la sortie du mode)", () => {
    for (const touche of ["a", "A", "Enter", " ", "Tab", "ArrowUp", "Backspace", "F5"]) {
      expect(vocalChromeWakeKey(touche), `touche ${touche}`).toBe(true);
    }
    expect(vocalChromeWakeKey("Escape")).toBe(false);
    expect(vocalChromeWakeKey("Esc")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("3. le branchement : un minuteur, un point d'ecriture, quatre ecouteurs", () => {
  it("la decision est prise a la FIN de `applyVocalState`, apres le bouton de relance", () => {
    const corps = corpsFonction(SUPER, "function applyVocalState(");
    // Dernier appel de la fonction : l'etat vient d'etre fige, rien ne peut plus
    // le changer derriere. Et l'appel REÇOIT l'etat calcule (pas le dernier
    // connu) : le masquage ne peut donc pas se tromper d'un etat. Les
    // commentaires de branchement sont sautes, le dernier APPEL compte.
    const appels = corps.match(/^\s*(vocalSync\w+\([^)]*\);|return .*;)\s*$/gm) ?? [];
    expect(appels[appels.length - 1].trim()).toBe("vocalSyncChrome(state);");
    expect(corps).toMatch(/vocalSyncRestartButton\(state\);\s*$/m);
  });

  it("`vocalSyncChrome` lit les QUATRE faits et n'ecrit la classe qu'a un seul endroit", () => {
    const corps = corpsFonction(SUPER, "function vocalSyncChrome(");
    // Les faits : l'etat, le champ (texte ou focus), la panne du micro, le
    // pointeur. S'il en manque un, la regle correspondante ne s'applique jamais.
    expect(corps).toMatch(/etat:\s*vocalChromeEtat/);
    expect(corps).toMatch(/saisie:/);
    expect(corps).toMatch(/champ\.value/);
    expect(corps).toMatch(/document\.activeElement === champ/);
    expect(corps).toMatch(/micFerme:\s*vocalMicFerme/);
    expect(corps).toMatch(/pointeurActif:\s*vocalChromePointeurSurLeBas\(\)/);
    // La decision est PURE et la classe vient de sa correspondance unique.
    expect(corps).toMatch(/vocalChromeVisible\(faits\)/);
    expect(corps).toMatch(/vocalChromeClass\(visible\)/);
    // Le minuteur arme force la visibilite (pendant les 2,5 s, le bas est
    // visible meme si l'on ne fait rien).
    expect(corps).toMatch(/vocalChromeTimer !== 0 \|\| vocalChromeVisible/);
    // Et il ne pose JAMAIS le minuteur : sinon il tournerait sans fin.
    expect(corps).not.toMatch(/vocalRestartChromeTimer|setTimeout/);
  });

  it("la classe n'est ecrite qu'a DEUX endroits dans tout `super-agent.js`", () => {
    // Pose/retrait dans `vocalSyncChrome`, retrait a la sortie du mode : aucune
    // troisieme ecriture, donc aucun second juge.
    const mentions = (SUPER.match(/VOCAL_CHROME_HIDDEN_CLASS/g) || []).length;
    expect(mentions).toBe(3); // l'import, la pose, le retrait de sortie
    const poses = (SUPER.match(/classList\.toggle\(\s*VOCAL_CHROME_HIDDEN_CLASS/g) || []).length;
    expect(poses).toBe(1);
  });

  it("un SEUL minuteur : il est toujours annule avant d'etre repose", () => {
    const corps = corpsFonction(SUPER, "function vocalRestartChromeTimer(");
    expect(corps).toMatch(/clearVocalChromeTimer\(\)/);
    expect(corps).toMatch(/VOCAL_CHROME_IDLE_MS/);
    // Pose du minuteur : deux endroits, et deux seulement (le geste et l'entree
    // dans le mode). Un troisieme appel ferait un second decompte.
    const poses = (SUPER.match(/vocalRestartChromeTimer\(\);/g) || []).length;
    expect(poses).toBe(2);
  });

  it("les quatre ecouteurs sont poses a l'entree et retires a la sortie", () => {
    const entree = corpsFonction(SUPER, "function enterVocal(");
    expect(entree).toMatch(/attachVocalChromeListeners\(\)/);
    // Entrer dans le mode EST un geste : le bas demarre visible.
    expect(entree).toMatch(/vocalRestartChromeTimer\(\)/);
    const sortie = corpsFonction(SUPER, "function exitVocal(");
    expect(sortie).toMatch(/detachVocalChromeListeners\(\)/);
    expect(sortie).toMatch(/clearVocalChromeTimer\(\)/);
    // Les quatre familles d'evenements, en phase de capture (pour voir le geste
    // meme s'il vise un noeud qui arrete la propagation).
    const pose = corpsFonction(SUPER, "function attachVocalChromeListeners(");
    for (const evenement of ["pointermove", "pointerdown", "wheel", "keydown"]) {
      expect(pose, evenement).toContain(`"${evenement}"`);
    }
    expect(pose).toMatch(/,\s*true\)/);
    // La molette est passive : elle ne bloque pas le defilement de la page.
    expect(pose).toMatch(/passive:\s*true/);
    const retrait = corpsFonction(SUPER, "function detachVocalChromeListeners(");
    for (const evenement of ["pointermove", "pointerdown", "wheel", "keydown"]) {
      expect(retrait, evenement).toContain(`"${evenement}"`);
    }
    // Aucun ecouteur anonyme : les quatre fonctions sont nommees, donc
    // reellement retirables.
    expect(pose).toMatch(/onVocalChromePointerMove/);
    expect(pose).toMatch(/onVocalChromeKeydown/);
  });

  it("Echap ne reveille pas le bas (il sort du mode)", () => {
    const corps = corpsFonction(SUPER, "onVocalChromeKeydown = (e) =>");
    expect(corps).toMatch(/vocalChromeWakeKey\(e && e\.key\)/);
    expect(corps).toMatch(/if \(!vocalChromeWakeKey/);
  });

  it("la dictee et la frappe font revenir le bas (deux appels, aucune logique)", () => {
    // 1. Le texte dicte : il revient dans le champ, et le reveil est APRES
    //    l'ecriture et le redimensionnement — la zone est deja remplie quand le
    //    bas revient (jamais un bas reveille sur un champ vide).
    const dictee = sliceSource(SUPER, "rec.onresult", "vocalWakeChrome();", 60);
    expect(dictee).toMatch(/inputEl\.value = /);
    expect(dictee).toMatch(/resizeInput\(\);/);
    // 2. L'ecouteur `input` de LA zone de saisie (la frappe de l'utilisateur),
    //    celui qui existe deja : aucun second ecouteur n'est pose.
    const frappe = sliceSource(SUPER, 'inputEl.addEventListener("input"', "});", 60);
    expect(frappe).toMatch(/vocalWakeChrome\(\)/);
    expect(frappe).toMatch(/voiceUserTookOver = true/);
  });
});

// ---------------------------------------------------------------------------
describe("4. le perimetre : trois noeuds, et rien de plus", () => {
  it("la classe CSS ne nomme QUE la ligne d'etat, la saisie et le bouton du micro", () => {
    const noeuds = [...BLOC_MASQUE.matchAll(/\.vocal-chrome-hidden \.([a-z-]+)/g)].map(
      (m) => m[1],
    );
    // Exactement trois noeuds, tous du BAS, chacun sous l'overlay du mode.
    expect(noeuds).toEqual(["vocal-status", "vocal-input", "vocal-mic-fix"]);
    expect(BLOC_MASQUE).not.toMatch(/\.vocal-orb|\.vocal-halo|\.vocal-restart|\.vocal-top/);
    // Le LOGO (bouton des trois modes) et « Travail » ne sont jamais concernes :
    // aucune regle du masquage ne peut les atteindre, ni les cacher.
    expect(BLOC_MASQUE).not.toMatch(/mode-logo|agent-activity|screen-mode/);
    expect(CSS).not.toMatch(/\.vocal-chrome-hidden[^{]*#mode-logo/);
    expect(CSS).not.toMatch(/\.vocal-chrome-hidden[^{]*#agent-activity/);
    // Le cercle ne bouge pas d'un pixel : aucune regle du masquage ne touche la
    // scene, le disque ou son emplacement.
    expect(CSS).not.toMatch(/\.vocal-chrome-hidden[^{]*\.vocal-stage/);
  });

  it("l'effacement ne change pas la mise en page (aucun `display: none`)", () => {
    // La place de la ligne d'etat et de la saisie est CONSERVEE : sans cela le
    // cercle se recentrerait d'un coup et « le cercle est le centre » serait faux.
    expect(BLOC_MASQUE).not.toMatch(/display:\s*none/);
    expect(BLOC_MASQUE).not.toMatch(/position:\s*absolute/);
    expect(BLOC_MASQUE).not.toMatch(/(^|\n)\s*(height|margin|padding|top|left):\s*0/);
    // Ce qui est ecrit, dans l'ordre du document : opacite, translation,
    // visibilite retardee, pointeur inerte.
    expect(BLOC_MASQUE).toMatch(/opacity:\s*0/);
    expect(BLOC_MASQUE).toMatch(/transform:\s*translateY\(8px\)/);
    expect(BLOC_MASQUE).toMatch(/visibility:\s*hidden/);
    expect(BLOC_MASQUE).toMatch(/pointer-events:\s*none/);
    // Le fondu dure 180 ms et la visibilite n'arrive qu'a la FIN du fondu.
    expect(BLOC_MASQUE).toMatch(/transition:\s*opacity var\(--transition\)/);
    expect(BLOC_MASQUE).toMatch(/visibility 0s linear 180ms/);
    expect(CSS).toMatch(/--transition:\s*0\.18s/);
  });

  it("les trois noeuds retrouvent leur transition au RETOUR, sans seconde regle", () => {
    // Le retour est le meme chemin a l'envers : la transition est posee sur les
    // blocs eux-memes, donc visible <-> efface s'anime dans les deux sens.
    for (const selecteur of [".vocal-status {", ".vocal-input {"]) {
      const corps = bloc(CSS, selecteur);
      expect(corps, selecteur).toMatch(/transition:\s*opacity var\(--transition\)/);
      expect(corps, selecteur).toMatch(/transform var\(--transition\)/);
    }
  });

  it("en mouvement reduit, l'effacement est instantane (aucun fondu)", () => {
    const reduit = sliceSource(
      CSS,
      ".pilot-vocal.vocal-reduced.vocal-chrome-hidden .vocal-status,",
      "}",
      2,
    );
    expect(reduit).toMatch(/transition:\s*none/);
    expect(reduit).not.toMatch(/translateY/);
    // Et les trois noeuds du bas sont bien couverts par la liste du mouvement
    // reduit (sinon une transition survivrait a la regle generale).
    const liste = bloc(CSS, ".pilot-vocal.vocal-reduced,\n");
    expect(liste).toMatch(/\.vocal-status/);
    expect(liste).toMatch(/\.vocal-input/);
    expect(liste).toMatch(/\.vocal-mic-fix/);
  });
});
