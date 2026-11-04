// conversation-scroll.test.js — VERROU du défaut « la conversation revient TOUT
// EN HAUT au retour d'un plein écran » (mode Vocal, mode Assistant seul).
//
// Deux verrous, et ils échouent tous les deux SANS le correctif :
//
//  1. la DÉCISION (« quelle position restaurer ») est pure et vérifiée ici :
//     en bas → en bas ; remonté volontairement → sa position exacte ;
//  2. le BRANCHEMENT réel dans super-agent.js : la photographie est prise AVANT
//     les déplacements de nœuds et la position rendue APRÈS la restitution, à la
//     sortie des DEUX pleins écrans. Sans ces appels, le module pur serait un
//     décor et la conversation repartirait de 0 (`scrollTop` remis à zéro par le
//     déplacement des nœuds).
//
// Rapport : docs/rapports/RAPPORT-retour-mode-conversation-en-bas.md.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  CONVERSATION_SCROLL_BOTTOM_THRESHOLD,
  conversationAtBottom,
  conversationScrollMax,
  conversationScrollSnapshot,
  conversationScrollTarget,
} from "./conversation-scroll.js";

const SUPER = readFileSync(fileURLToPath(new URL("./super-agent.js", import.meta.url)), "utf8").replace(
  /\r\n/g,
  "\n",
);

/** Corps d'une fonction (accolades équilibrées) — robuste aux ajouts internes. */
function corpsFonction(src, signature) {
  const debut = src.indexOf(signature);
  expect(debut, `signature introuvable : ${signature}`).toBeGreaterThan(-1);
  let i = src.indexOf("{", debut);
  let profondeur = 0;
  for (; i < src.length; i += 1) {
    if (src[i] === "{") profondeur += 1;
    else if (src[i] === "}") {
      profondeur -= 1;
      if (profondeur === 0) return src.slice(debut, i + 1);
    }
  }
  throw new Error(`accolades non équilibrées pour ${signature}`);
}

describe("1. la décision « quelle position restaurer » (pure)", () => {
  // Fenêtre d'exemple : la conversation fait 1000 px, on en voit 500.
  const CLIENT = 500;
  const HAUTEUR = 1000;

  it("le seuil du « déjà en bas » est celui du suivi automatique (une seule valeur)", () => {
    expect(CONVERSATION_SCROLL_BOTTOM_THRESHOLD).toBe(60);
    // La conversation de l'assistant lit cette valeur : elle n'est pas recopiée.
    expect(SUPER).toContain(
      "const SUPER_SCROLL_BOTTOM_THRESHOLD = CONVERSATION_SCROLL_BOTTOM_THRESHOLD;",
    );
    expect(SUPER).not.toContain("const SUPER_SCROLL_BOTTOM_THRESHOLD = 60;");
  });

  it("« en bas » : règle historique conservée à l'identique", () => {
    expect(conversationAtBottom(500, CLIENT, HAUTEUR)).toBe(true);
    expect(conversationAtBottom(460, CLIENT, HAUTEUR)).toBe(true);
    expect(conversationAtBottom(439, CLIENT, HAUTEUR)).toBe(false);
    // Un contenu qui ne déborde pas est toujours « en bas ».
    expect(conversationAtBottom(0, 500, 500)).toBe(true);
  });

  it("était EN BAS → il retrouve le bas (même si du contenu est arrivé)", () => {
    const memo = conversationScrollSnapshot(500, CLIENT, HAUTEUR);
    expect(memo).toEqual({ top: 500, atBottom: true });
    // Le contenu a grandi pendant le plein écran : le bas reste le bon endroit.
    expect(conversationScrollTarget(memo, CLIENT, 2400)).toBe(1900);
    expect(conversationScrollTarget(memo, CLIENT, HAUTEUR)).toBe(500);
  });

  it("avait REMONTÉ pour relire → sa position exacte, ni en haut ni en bas", () => {
    const memo = conversationScrollSnapshot(220, CLIENT, HAUTEUR);
    expect(memo.atBottom).toBe(false);
    expect(conversationScrollTarget(memo, CLIENT, HAUTEUR)).toBe(220);
    // Position 0 assumée (l'utilisateur est réellement en haut) : on ne « corrige »
    // pas son choix en le poussant ailleurs.
    expect(conversationScrollTarget(conversationScrollSnapshot(0, CLIENT, HAUTEUR), CLIENT, HAUTEUR)).toBe(0);
  });

  it("une position devenue hors d'atteinte est bornée, jamais au-delà du contenu", () => {
    // Le contenu a rétréci (session nettoyée) : on retombe sur le bas réel.
    const memo = conversationScrollSnapshot(900, CLIENT, 1000);
    expect(conversationScrollTarget(memo, CLIENT, 600)).toBe(100);
    expect(conversationScrollMax(CLIENT, 600)).toBe(100);
  });

  it("aucune photographie → aucune restauration inventée (null)", () => {
    expect(conversationScrollTarget(null, CLIENT, HAUTEUR)).toBe(null);
    expect(conversationScrollTarget(undefined, CLIENT, HAUTEUR)).toBe(null);
  });

  it("valeurs absentes ou non numériques : aucun NaN, aucune exception", () => {
    expect(conversationScrollSnapshot(undefined, undefined, undefined)).toEqual({
      top: 0,
      atBottom: true,
    });
    expect(conversationScrollTarget(conversationScrollSnapshot(NaN, NaN, NaN), NaN, NaN)).toBe(0);
  });
});

describe("2. le branchement réel : photographier avant, rendre après", () => {
  it("la sortie de « Assistant seul » photographie AVANT de déplacer les nœuds", () => {
    const sortie = corpsFonction(SUPER, "function exitImmersive() {");
    const memo = sortie.indexOf("memoizeSuperScroll(messagesEl)");
    const retourConversation = sortie.indexOf("wrapper.insertBefore(messagesEl, toolbar)");
    expect(memo).toBeGreaterThan(-1);
    expect(retourConversation).toBeGreaterThan(-1);
    // L'ORDRE est le correctif : après le déplacement, scrollTop vaut déjà 0.
    expect(memo).toBeLessThan(retourConversation);
  });

  it("la sortie de « Assistant seul » rend la position APRÈS avoir retiré l'overlay", () => {
    const sortie = corpsFonction(SUPER, "function exitImmersive() {");
    const retrait = sortie.indexOf("immersiveOverlay.remove()");
    const rendu = sortie.indexOf("restoreSuperScroll(messagesEl)");
    expect(rendu).toBeGreaterThan(-1);
    expect(retrait).toBeGreaterThan(-1);
    // La mise en page de « Détaillé » doit être complète pour que la mesure soit juste.
    expect(rendu).toBeGreaterThan(retrait);
    // C'est bien la DERNIÈRE écriture de la fonction (aucun autre déplacement après).
    const apres = sortie.slice(rendu + "restoreSuperScroll(messagesEl)".length);
    expect(apres).not.toContain("insertBefore");
  });

  it("la sortie de l'écran Vocal applique exactement le même correctif", () => {
    const sortie = corpsFonction(SUPER, "function exitVocal() {");
    const memo = sortie.indexOf("memoizeSuperScroll(messagesEl)");
    const rendu = sortie.indexOf("restoreSuperScroll(messagesEl)");
    expect(memo).toBeGreaterThan(-1);
    expect(rendu).toBeGreaterThan(-1);
    expect(memo).toBeLessThan(rendu);
    // Photographie avant la restitution des nœuds, rendu après le retrait du calque.
    expect(memo).toBeLessThan(sortie.indexOf("vocalOverlay.remove()"));
    expect(rendu).toBeGreaterThan(sortie.indexOf("vocalOverlay.remove()"));
    expect(rendu).toBeGreaterThan(sortie.indexOf("document.body.classList.remove(VOCAL_ACTIVE_CLASS)"));
  });

  it("une seule source de décision : le geste appelle le module pur, sans recalcul local", () => {
    const helpers = corpsFonction(SUPER, "function restoreSuperScroll(messagesEl) {");
    expect(helpers).toContain("conversationScrollTarget(");
    const memo = corpsFonction(SUPER, "function memoizeSuperScroll(messagesEl) {");
    expect(memo).toContain("conversationScrollSnapshot(");
    // Le suivi automatique du bas reprend ensuite la main, ré-armé seulement si
    // l'utilisateur était réellement en bas.
    expect(helpers).toContain("superAtBottom = memo.atBottom;");
    // Aucun défilement animé parasite, aucun second minuteur.
    for (const interdit of ["scrollTo(", "smooth", "setTimeout", "requestAnimationFrame"]) {
      expect(helpers, interdit).not.toContain(interdit);
    }
  });

  it("aucun autre déplacement de la conversation n'a été ajouté", () => {
    // La conversation n'est déplacée qu'aux trois endroits déjà existants : son
    // montage, l'entrée dans « Assistant seul » et sa sortie. Ce correctif
    // n'invente aucun nouveau déplacement (et l'écran Vocal n'en fait aucun :
    // il la rend invisible, ce qui préserve ses mesures).
    const deplacements = SUPER.match(/insertBefore\(messagesEl|appendChild\(messagesEl\)/g) || [];
    expect(deplacements.length).toBe(3);
    expect(SUPER).toContain("wrapper.appendChild(messagesEl)");
    expect(SUPER).toContain('.sa-immersive-messages").appendChild(messagesEl)');
    expect(SUPER).toContain("wrapper.insertBefore(messagesEl, toolbar)");
  });
});
