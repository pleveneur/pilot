/**
 * Verrou des DEUX demandes du proprietaire du 2026-11-14 sur le bas de l'ecran
 * Vocal :
 *
 *  1. « la zone de saisie doit disparaitre apres 10 secondes sans souris »
 *     (2 500 ms jusqu'ici) ;
 *  2. les QUATRE regles qui INTERDISENT le masquage ne bougent pas d'un iota :
 *     micro ferme, champ de saisie occupe, pointeur sur la zone du bas, question
 *     de l'assistant en attente.
 *
 * Ce fichier echoue si :
 *  - le delai n'est pas exactement 10 000 ms, ou s'il devient reglable ;
 *  - le repos avec la DICTEE ARMEE MAIS SILENCIEUSE cesse de masquer ;
 *  - une seule des quatre interdictions est retiree, adoucie ou reordonnee ;
 *  - un mouvement ou une frappe cesse de ramener le bas (et de remettre le
 *    decompte a zero) ;
 *  - un second minuteur ou un second point d'ecriture de la classe apparait.
 *
 * La decision reste PURE (`vocal-chrome.js` : aucun DOM, aucune minuterie) : ce
 * fichier n'a besoin ni de navigateur, ni de faux minuteur pour la verifier.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sliceSource } from "./source-slice.js";
import {
  VOCAL_CHROME_HIDDEN_CLASS,
  VOCAL_CHROME_IDLE_MS,
  vocalChromeClass,
  vocalChromeMoved,
  vocalChromeVisible,
  vocalChromeWakeKey,
} from "./vocal-chrome.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) =>
  readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const SUPER = lire("src/js/super-agent.js");
const CHROME = lire("src/js/vocal-chrome.js");

/** Le fait de repos : champ vide, pas de question, micro ouvert, pointeur loin. */
const REPOS = {
  micFerme: "",
  saisie: false,
  pointeurActif: false,
  pointeurGeste: false,
  question: false,
};

describe("0. L'ETAT PAR DEFAUT EST MASQUE (demande du proprietaire, 2026-11-14)", () => {
  it("a l'entree du mode, le bas est efface TOUT DE SUITE", () => {
    // « Par defaut, ce bloc ne doit pas s'afficher » : il n'y a pas de decompte
    // a attendre a l'ouverture, et aucun affichage de courtoisie. L'entree ne
    // pose donc AUCUN minuteur (il n'y a qu'une pose dans tout le fichier :
    // le reveil par un geste).
    const entree = sliceSource(SUPER, "function enterVocal() {", "vocalSyncSides();", 200);
    expect(entree).not.toMatch(/vocalRestartChromeTimer\(\)/);
    expect(SUPER.match(/vocalRestartChromeTimer\(\);/g) || []).toHaveLength(1);
    // Le premier rendu est deja efface : la classe est posee AVANT la peinture,
    // dans la meme tache que l'entree du calque dans le document.
    expect(entree).toContain("document.body.appendChild(vocalOverlay)");
    expect(entree.indexOf("document.body.appendChild(vocalOverlay)")).toBeLessThan(
      entree.indexOf("vocalSyncChrome();"),
    );
    // Et la decision, elle, rend deja « masquage permis » pour l'etat d'entree :
    // micro ouvert (aucun message), champ vide, aucun geste, aucune question.
    expect(vocalChromeVisible({ micFerme: "", saisie: false, pointeurGeste: false })).toBe(false);
    expect(vocalChromeClass(vocalChromeVisible({ micFerme: "" }))).toBe(VOCAL_CHROME_HIDDEN_CLASS);
  });

  it("un changement d'etat interne ne la rallume pas (remasquee = remasquee)", () => {
    // Le point d'ecriture de la classe, seul juge, ne lit AUCUN etat de
    // conversation et ne pose jamais de minuteur : une reflexion, une lecture,
    // un passage a l'ecoute laissent donc l'ecran nu. Seul un geste rallume.
    const sync = sliceSource(SUPER, "function vocalSyncChrome(state)", "\n  }", 80);
    expect(sync).not.toMatch(/vocalRestartChromeTimer|setTimeout/);
    expect(sync).not.toMatch(/\betat:/);
    const etat = sliceSource(SUPER, "function applyVocalState(", "\n  }", 300);
    expect(etat).not.toMatch(/vocalRestartChromeTimer|setTimeout|vocalWakeChrome/);
  });

  it("une fois remasquee, elle se rallume au geste (et seulement la)", () => {
    // Le reveil est le SEUL chemin qui repose le minuteur, et la decision pure
    // garde ses quatre interdictions, inchangees et prioritaires.
    const reveil = sliceSource(SUPER, "function vocalWakeChrome()", "\n  }", 20);
    expect(reveil).toContain("vocalRestartChromeTimer()");
    expect(vocalChromeMoved({ x: 104, y: 100 }, { x: 100, y: 100 })).toBe(true);
    for (const fait of ["micFerme", "saisie", "question"]) {
      const valeur = fait === "micFerme" ? "refus" : true;
      expect(vocalChromeVisible({ ...REPOS, [fait]: valeur }), fait).toBe(true);
    }
    // Le pointeur est le cas a part : c'est le GESTE qui retient, pas la
    // position (`pointeurGeste: false` = le decompte est alle au bout).
    expect(vocalChromeVisible({ ...REPOS, pointeurActif: true, pointeurGeste: true })).toBe(true);
    expect(vocalChromeVisible({ ...REPOS, pointeurActif: true, pointeurGeste: false })).toBe(false);
  });
});

describe("1. LE DELAI — dix secondes sans souris", () => {
  it("le delai vaut EXACTEMENT 10 000 ms (decision du 2026-11-14)", () => {
    // REGLE PROTEGEE : le temps de repos avant effacement du bas. Le
    // proprietaire a demande dix secondes ; 2 500 ms etait l'ancienne valeur, et
    // toute autre valeur est un retour en arriere silencieux.
    expect(VOCAL_CHROME_IDLE_MS).toBe(10_000);
    expect(VOCAL_CHROME_IDLE_MS).not.toBe(2500);
  });

  it("c'est UNE constante, pas un reglage : aucun jeton CSS, aucune config", () => {
    // REGLE PROTEGEE : la decision n'est pas exposable. On ne doit trouver ni
    // lecture de configuration, ni `--vocal-...idle` dans la feuille de style, ni
    // variante par plateforme : une seule source, le module pur.
    const declaration = sliceSource(CHROME, "export const VOCAL_CHROME_IDLE_MS", "\n", 4);
    expect(declaration).toBe("export const VOCAL_CHROME_IDLE_MS = 10000;");
    expect(declaration).not.toMatch(/import|config|window|localStorage/);
    const css = lire("src/css/style.css");
    expect(css).not.toMatch(/--vocal-chrome-idle/);
    // Et le module reste PUR : ni DOM, ni minuterie, ni horloge.
    expect(CHROME).not.toMatch(/document\.|window\.|setTimeout|setInterval|Date\.now/);
  });

  it("le minuteur UNIQUE lit cette constante, et repart de zero a chaque geste", () => {
    // REGLE PROTEGEE : un seul minuteur, arme avec la constante. Un nombre ecrit
    // en dur ici ferait diverger le code de la decision.
    expect(SUPER.match(/vocalChromeTimer = setTimeout\(/g) || []).toHaveLength(1);
    const tic = sliceSource(SUPER, "function vocalRestartChromeTimer()", "\n  }", 40);
    expect(tic).toContain("VOCAL_CHROME_IDLE_MS");
    expect(tic).not.toMatch(/setTimeout\([^)]*,\s*\d/);
    // Repartir de zero : il annule AVANT de reposer.
    expect(tic.indexOf("clearVocalChromeTimer()")).toBeLessThan(
      tic.indexOf("setTimeout("),
    );
  });

  it("aucun geste pendant 10 s = masquage ; au repos, le bas s'efface", () => {
    // REGLE PROTEGEE : la decision au bout du delai. Au repos, rien ne retient le
    // bas : `vocalChromeVisible` rend false et la classe est posee.
    expect(vocalChromeVisible(REPOS)).toBe(false);
    expect(vocalChromeClass(vocalChromeVisible(REPOS))).toBe(VOCAL_CHROME_HIDDEN_CLASS);
    // Sans aucun fait, non plus : rien ne retient le bas par defaut.
    expect(vocalChromeVisible()).toBe(false);
    expect(vocalChromeVisible({})).toBe(false);
  });

  it("le repos avec la DICTEE ARMEE MAIS SILENCIEUSE masque QUAND MEME", () => {
    // REGLE PROTEGEE (cas particulier VOULU, decision du 2026-11-13) : la dictee
    // ouverte n'est pas un texte, pas une question, pas un geste. L'ecran doit
    // rester nu quand on ne fait rien.
    expect(
      vocalChromeVisible({ ...REPOS, dicteeArmee: true, saisie: false, question: false }),
    ).toBe(false);
    // Et aucun etat de conversation ne retient le bas : ni la parole de Pilot, ni
    // celle de l'utilisateur, ni l'ecoute du micro.
    for (const etat of ["speaking", "listening", "reflecting", "parole", "ecoute"]) {
      expect(
        vocalChromeVisible({ ...REPOS, [etat]: true }),
        `l'etat ${etat} retient le bas`,
      ).toBe(false);
    }
  });

  it("un mouvement ou une frappe RAMENE le bas, et remet le decompte a zero", () => {
    // REGLE PROTEGEE : le reveil. Le gel du minuteur n'existe pas : tout geste
    // relance le delai complet (`vocalRestartChromeTimer` est rappele), et le
    // pointeur redevient un geste recent.
    expect(vocalChromeMoved({ x: 200, y: 400 }, { x: 100, y: 400 })).toBe(true);
    expect(vocalChromeWakeKey("a")).toBe(true);
    const reveil = sliceSource(SUPER, "function vocalWakeChrome()", "\n  }", 20);
    expect(reveil).toContain("vocalRestartChromeTimer()");
    expect(reveil).toContain("vocalSyncChrome()");
    // Le point d'ecriture de la classe, lui, ne pose JAMAIS le minuteur : sinon un
    // appel venu de nulle part rallumerait le bas indefiniment.
    const sync = sliceSource(SUPER, "function vocalSyncChrome(state)", "\n  }", 80);
    expect(sync).not.toContain("vocalRestartChromeTimer()");
    expect(sync).not.toMatch(/setTimeout/);
    // Les quatre gestes : pointeur qui bouge de 4 px, clic, molette, clavier — le
    // geste de pointeur est pose par chacun d'eux.
    expect(SUPER).toContain("vocalChromeGestePointeur = true");
  });
});

describe("2. LES QUATRE INTERDICTIONS — une par une, aucune ne doit tomber", () => {
  it("REGLE 1 — micro ferme : le bouton « Autoriser le micro » ne s'efface jamais", () => {
    // Si cette regle tombe, l'utilisateur dont le micro est refuse (ou occupe, ou
    // absent) perd le SEUL recours qui lui reste : le bouton de depannage.
    for (const raison of ["refus", "absent", "occupe", "peripherique-retire", "panne"]) {
      expect(vocalChromeVisible({ ...REPOS, micFerme: raison }), `mic ${raison}`).toBe(true);
    }
    // Le fait est lu comme « une raison NON VIDE », jamais comme un booleen : une
    // chaine vide (micro ouvert) ne retient rien.
    expect(vocalChromeVisible({ ...REPOS, micFerme: "" })).toBe(false);
    expect(vocalChromeVisible({ ...REPOS, micFerme: null })).toBe(false);
  });

  it("REGLE 2 — champ de saisie OCCUPE : du texte dans le champ retient le bas", () => {
    // Si cette regle tombe, le brouillon (ou la dictee en cours de transcription)
    // disparait de l'ecran au bout de dix secondes.
    expect(vocalChromeVisible({ ...REPOS, saisie: true })).toBe(true);
    // Un champ VIDE ne retient rien, meme avec le curseur dedans : le focus n'est
    // pas du texte (decision du 2026-11-13, sinon le bas ne s'effacait plus).
    expect(vocalChromeVisible({ ...REPOS, saisie: false, focus: true })).toBe(false);
  });

  it("REGLE 3 — pointeur sur la zone du bas : un GESTE retient, une position non", () => {
    // Si cette regle tombe, on cache le bouton que la souris vient de viser.
    expect(vocalChromeVisible({ ...REPOS, pointeurActif: true, pointeurGeste: true })).toBe(true);
    // Mais le fait ABSENT vaut geste recent : un appelant qui ne le fournit pas
    // garde le comportement d'avant (`pointeurGeste` retire, pas mis a false).
    const { pointeurGeste: _absent, ...sansGeste } = REPOS;
    expect(vocalChromeVisible({ ...sansGeste, pointeurActif: true })).toBe(true);
    // Le decompte alle au bout (`pointeurGeste === false`) laisse masquer : la
    // souris simplement POSEE ne retient pas le bas.
    expect(vocalChromeVisible({ ...REPOS, pointeurActif: true, pointeurGeste: false })).toBe(false);
  });

  it("REGLE 4 — une QUESTION de l'assistant attend une reponse : le bas reste", () => {
    // Si cette regle tombe, la rangee de boutons disparait avec le bas et le
    // travail reste bloque sans que l'utilisateur sache pourquoi.
    expect(vocalChromeVisible({ ...REPOS, question: true })).toBe(true);
    // Rien n'expire ici : c'est l'utilisateur qui repond, pas un delai.
    expect(vocalChromeVisible({ ...REPOS, question: true, saisie: false })).toBe(true);
  });

  it("l'ORDRE des quatre regles est celui du module : 1 micro, 2 saisie, 3 pointeur, 4 question", () => {
    // Les quatre interdictions sont lues DANS L'ORDRE, et une seule suffit : la
    // premiere vraie l'emporte. Ce test tombe si une regle est deplacee, retiree
    // ou si une cinquieme s'introduit entre elles.
    const corps = sliceSource(CHROME, "export function vocalChromeVisible", "\n}", 80);
    const i1 = corps.indexOf("f.micFerme");
    const i2 = corps.indexOf("f.saisie ===");
    const i3 = corps.indexOf("f.pointeurActif ===");
    const i4 = corps.indexOf("f.question ===");
    expect(i1).toBeGreaterThanOrEqual(0);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
    expect(i4).toBeGreaterThan(i3);
    // Aucune autre circonstance : les seuls `return true` sont les quatre regles.
    expect(corps.match(/return true;/g) || []).toHaveLength(4);
    expect(corps.match(/return false;/g) || []).toHaveLength(1);
    // Et tous les faits fournis a la decision sont ceux-la, rien de plus.
    for (const interdit of ["parole", "speaking", "listening", "reflecting", "microCapte"]) {
      expect(corps, `un etat de conversation retient le bas : ${interdit}`).not.toContain(interdit);
    }
  });

  it("les quatre regles sont celles qui interdisent, pas celles qui obligent", () => {
    // Le sens de la decision compte : `true` = le bas RESTE (masquage interdit).
    // Inverser le sens ferait masquer le bas pendant qu'on tape un brouillon.
    expect(vocalChromeVisible({ saisie: true })).toBe(true);
    expect(vocalChromeClass(true)).toBe("");
    expect(vocalChromeClass(false)).toBe(VOCAL_CHROME_HIDDEN_CLASS);
  });
});
