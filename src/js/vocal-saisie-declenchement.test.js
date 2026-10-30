// Tests — REMARQUE DU PROPRIETAIRE DU 2026-10-03, point 3 : « la barre de saisie
// doit etre invisible par defaut, apparaitre quand on bouge la souris, rester
// utilisable pendant qu'on s'en sert, et disparaitre apres un temps
// d'inactivite ».
// (docs/rapports/REMARQUES-interface-ecran-vocal-20261003.md, puis
// docs/rapports/RAPPORT-remarques-ecran-vocal-20261003.md § 3.)
//
// LA REMARQUE PORTE SUR LE DECLENCHEMENT, PAS SUR LE MECANISME : le compte a
// rebours de 2 500 ms existait deja et il etait juste. Le defaut reel etait que
// la regle 4 du module pur retenait le bas pour une POSITION (`pointeurActif`),
// et la bande du bas couvre toute la largeur de l'ecran : une souris simplement
// POSEE dessus — sans bouger, sans cliquer — empechait le masquage POUR TOUJOURS.
// Il fallait en sortir pour que le decompte reprenne.
//
// CE QUE CE FICHIER VERROUILLE :
//   D1 — la decision pure : une POSITION seule ne retient plus le bas, un GESTE
//        oui. Les trois cas sont nommes (geste recent, geste expire, fait absent).
//   D2 — le GESTE expire AVEC le decompte : c'est la seule chose que le
//        correctif ajoute au minuteur, et elle est faite avant de repeindre.
//   D3 — les deux gestes qui arment le fait sont les DEUX seuls ecouteurs de
//        pointeur (deplacement au-dela de 4 px, clic), et l'entree comme la
//        sortie du mode remettent le fait a zero : aucun etat ne survit.
//   D4 — le reveil reste IMMEDIAT : le bas visible ne depend pas du fait (le
//        minuteur en cours le tient allume), donc un geste montre la barre a
//        l'instant ou il a lieu. Rien n'a ete ajoute entre le geste et la barre.
//   D5 — aucun second mecanisme : pas de second minuteur, pas de `localStorage`,
//        pas de reglage, et la saisie n'est pas ajoutee aux noeuds masquables.
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
import {
  VOCAL_CHROME_IDLE_MS,
  VOCAL_CHROME_MOVE_PX,
  vocalChromeVisible,
} from "./vocal-chrome.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) => readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const CSS = lire("src/css/style.css");
const SUPER = lire("src/js/super-agent.js");

/** Le corps de `vocalSyncChrome`, seul point d'ecriture de la classe. */
const SYNC = sliceSource(SUPER, "function vocalSyncChrome(state)", "vocalChromeClass(visible)", 400);
/** Le corps du minuteur unique. */
const TIMER = sliceSource(SUPER, "function vocalRestartChromeTimer()", "VOCAL_CHROME_IDLE_MS);", 300);
/** Les deux ecouteurs de pointeur. */
const MOVE = sliceSource(SUPER, "const onVocalChromePointerMove", "vocalWakeChrome();", 100);
const DOWN = sliceSource(SUPER, "const onVocalChromePointerDown", "vocalWakeChrome();", 100);

describe("D1 — une POSITION ne retient plus le bas, un GESTE oui", () => {
  it("le pointeur pose sur la bande du bas laisse le masquage se faire", () => {
    // C'EST la remarque : sans rien faire, la barre disparait. Le pointeur est
    // sur la bande (position vraie) et le decompte est alle au bout.
    expect(
      vocalChromeVisible({ etat: "idle", saisie: false, micFerme: "", pointeurActif: true, pointeurGeste: false, question: false }),
    ).toBe(false);
  });

  it("un geste recent retient le bas, et un fait ABSENT aussi (compatibilite)", () => {
    const base = { etat: "idle", saisie: false, micFerme: "", pointeurActif: true };
    expect(vocalChromeVisible({ ...base, pointeurGeste: true })).toBe(true);
    // Un appelant qui ne fournit pas le fait garde le comportement d'avant : le
    // correctif ne peut pas rendre le bas masquable par oubli d'un champ.
    expect(vocalChromeVisible(base)).toBe(true);
    // Et sans pointeur du tout, le fait n'a aucun effet : c'est bien la regle 4
    // qui le lit, pas une regle nouvelle.
    expect(vocalChromeVisible({ ...base, pointeurActif: false, pointeurGeste: false })).toBe(false);
  });

  it("les quatre autres circonstances passent AVANT : elles retiennent le bas", () => {
    // Le correctif ne peut pas masquer la barre pendant qu'on s'en sert : micro
    // ferme, champ occupe, ecoute/parole et question l'emportent, meme quand le
    // geste a expire.
    const expire = { pointeurActif: true, pointeurGeste: false, etat: "idle", saisie: false, micFerme: "", question: false };
    expect(vocalChromeVisible({ ...expire, micFerme: "refus" })).toBe(true);
    expect(vocalChromeVisible({ ...expire, saisie: true })).toBe(true);
    expect(vocalChromeVisible({ ...expire, etat: "listening" })).toBe(true);
    expect(vocalChromeVisible({ ...expire, etat: "speaking" })).toBe(true);
    expect(vocalChromeVisible({ ...expire, question: true })).toBe(true);
  });
});

describe("D2 — le geste expire AVEC le decompte", () => {
  it("le minuteur remet le geste a zero AVANT de repeindre", () => {
    // L'ordre compte : si la repeinture passait d'abord, elle lirait encore un
    // geste vivant et le bas resterait allume jusqu'au prochain mouvement — donc
    // jamais, si la souris ne bouge plus.
    const iGeste = TIMER.indexOf("vocalChromeGestePointeur = false;");
    const iSync = TIMER.indexOf("vocalSyncChrome();");
    expect(iGeste).toBeGreaterThan(0);
    expect(iSync).toBeGreaterThan(iGeste);
  });

  it("le fait est donne a la decision pure, sous son nom", () => {
    expect(SYNC).toContain("pointeurGeste: vocalChromeGestePointeur === true");
    expect(SYNC).toContain("pointeurActif: vocalChromePointeurSurLeBas()");
  });

  it("le decompte a toujours la meme duree : ce n'est pas un nouveau reglage", () => {
    expect(VOCAL_CHROME_IDLE_MS).toBe(2500);
    // Le corps du minuteur ne contient pas la constante (elle ferme la fonction) :
    // on verifie donc qu'il la PASSE, sous son nom, et jamais un nombre ecrit en
    // dur — un second `2500` serait un second reglage a tenir a jour.
    expect(TIMER).toContain("setTimeout(");
    expect(SUPER).toContain("}, VOCAL_CHROME_IDLE_MS);");
    expect(TIMER).not.toMatch(/\b2500\b/);
    // Le seuil de reveil non plus : le tremblement d'une main posee ne reveille
    // pas l'ecran, donc il ne peut pas relancer le decompte sans fin.
    expect(VOCAL_CHROME_MOVE_PX).toBe(4);
  });
});

describe("D3 — deux gestes arment le fait, et rien ne survit a l'ecran", () => {
  it("le deplacement au-dela du seuil arme le geste, APRES le seuil", () => {
    // Avant le seuil, un tremblement ne doit rien armer : le fait est pose apres
    // `vocalChromeMoved`, pas avant.
    const iSeuil = MOVE.indexOf("vocalChromeMoved(");
    const iGeste = MOVE.indexOf("vocalChromeGestePointeur = true;");
    expect(iSeuil).toBeGreaterThan(0);
    expect(iGeste).toBeGreaterThan(iSeuil);
  });

  it("le clic arme le geste et remet le repere sur la position", () => {
    expect(DOWN).toContain("vocalChromeGestePointeur = true;");
    expect(DOWN).toContain("vocalChromeRepere = vocalChromePointeur;");
  });

  it("l'entree et la sortie du mode remettent le fait a zero", () => {
    // Deux ecritures a `false`, plus la declaration : aucune troisieme source de
    // verite, et surtout aucun etat qui survit a la sortie du mode.
    // Une declaration (avec sa valeur de depart) et TROIS remises a zero :
    // l'entree dans le mode, la sortie, et l'expiration du decompte.
    expect(SUPER.match(/let vocalChromeGestePointeur = false;/g) || []).toHaveLength(1);
    expect(SUPER.match(/vocalChromeGestePointeur = false;/g) || []).toHaveLength(4);
  });

  it("aucun ecouteur du pointeur n'est ajoute ailleurs : deux, pas trois", () => {
    const ajouts = SUPER.match(/addEventListener\("pointer(?:move|down)"/g) || [];
    expect(ajouts).toEqual(['addEventListener("pointermove"', 'addEventListener("pointerdown"']);
  });
});

describe("D4 — le reveil reste immediat, et la saisie reste utilisable", () => {
  it("le bas est visible des que le decompte tourne, sans dependre du fait", () => {
    // Le geste appelle `vocalWakeChrome()` -> le minuteur repart -> `visible` est
    // vrai par `vocalChromeTimer !== 0`. Le fait `pointeurGeste` ne sert donc qu'a
    // l'EXPIRATION, jamais a l'affichage : aucun delai n'a ete ajoute.
    expect(SYNC).toContain("vocalBare || vocalChromeTimer !== 0 || vocalChromeVisible(faits)");
  });

  it("la liste des noeuds que le bas peut eteindre ne grandit pas", () => {
    // Trois noeuds, pas quatre : le statut, la zone de saisie et le bouton de
    // depannage du micro. Le correctif ne change QUE le declencheur du masquage,
    // il n'ajoute rien a cette liste — et surtout ni le portrait ni les colonnes.
    const masques = CSS.match(/\.vocal-chrome-hidden \.vocal-[a-z-]+/g) || [];
    expect([...new Set(masques)].sort()).toEqual([
      ".vocal-chrome-hidden .vocal-input",
      ".vocal-chrome-hidden .vocal-mic-fix",
      ".vocal-chrome-hidden .vocal-status",
    ]);
  });
});

describe("D5 — aucun second mecanisme", () => {
  it("aucune memoire, aucun reglage, aucun second minuteur", () => {
    // L'etat du bas vit en MEMOIRE seulement : rien n'est ecrit sur le disque.
    expect(SUPER).not.toMatch(/localStorage[^\n]*vocalChromeGestePointeur/);
    expect(SUPER).not.toMatch(/localStorage[^\n]*vocal_chrome/);
    expect(SUPER).not.toMatch(/setInterval\([^)]*vocalChrome/);
    // Un seul minuteur pour le bas, celui du module (`setTimeout`).
    expect(TIMER).not.toContain("setInterval");
  });

  it("la feuille de style ne bouge pas : la classe et son inverse suffisent", () => {
    // Le correctif est une decision, pas une animation : aucune transition
    // nouvelle, aucune duree ecrite dans le CSS du bas.
    expect(CSS).not.toMatch(/\.vocal-chrome-hidden\s*\{[^}]*transition/s);
    expect(SUPER).toContain("vocalOverlay.classList.toggle(VOCAL_CHROME_HIDDEN_CLASS");
  });
});
