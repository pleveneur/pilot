// retour-mode-conversation-en-bas.test.js — VERROU du défaut « au retour du mode
// Vocal vers le mode Détaillé, la conversation repart TOUT EN HAUT » (défaut
// rapporté une SECONDE fois après le correctif `conversation-scroll.test.js`).
//
// Ce que ce verrou tient, et qui manquait au premier :
//
//  1. la décision est calculée sur la géométrie lue à l'INSTANT de la sortie du
//     plein écran — cet instant n'est pas toujours celui de la mise en page
//     DÉFINITIVE. Une géométrie TRANSITOIRE (contenu mesuré comme non débordant)
//     fait rendre 0 : la conversation est écrite tout en haut, et rien ne la
//     corrige ensuite. `conversationScrollReplayTarget` rejoue la MÊME décision
//     sur la géométrie réelle, au premier signal de rendu.
//  2. le GESTE est réellement branché : `restoreSuperScroll` (donc les DEUX
//     sorties de plein écran, et les trois voies de sortie qui passent par
//     `exitVocal`) appelle cette vérification, sans minuterie, sans défilement
//     animé, et sans jamais ramener de force quelqu'un qui a repris la main.
//
// Il ÉCHOUE si le retour en haut revient : soit la fonction pure disparaît,
// soit elle rend `null` (donc n'écrit rien) dans le cas transitoire, soit le
// branchement est retiré de `restoreSuperScroll`.
//
// Rapport : docs/rapports/RAPPORT-retour-mode-conversation-en-bas.md.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  conversationAtBottom,
  conversationScrollReplayTarget,
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

/** Dernière INSTRUCTION d'un corps de fonction (les commentaires de fin sont
 *  ignorés : ils ne déplacent ni n'écrivent rien). */
function derniereInstruction(corps) {
  const lignes = corps
    .trimEnd()
    .replace(/\}$/, "")
    .trimEnd()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  let i = lignes.length - 1;
  while (i >= 0 && (lignes[i].startsWith("//") || lignes[i].startsWith("*") || lignes[i].startsWith("/*"))) {
    i -= 1;
  }
  return lignes[i] || "";
}

// Fenêtre d'exemple : la conversation fait 2400 px de contenu, on en voit 500.
const CLIENT = 500;
const HAUTEUR_REELLE = 2400;
// Le bas réel du contenu.
const BAS = 1900;

describe("1. la conversation ne peut plus RESTER en haut (cas transitoire)", () => {
  it("géométrie transitoire : la décision rend 0 — c'est le défaut — et le rendu la corrige", () => {
    // L'utilisateur était EN BAS juste avant de passer en mode Vocal.
    const memo = conversationScrollSnapshot(BAS, CLIENT, HAUTEUR_REELLE);
    expect(memo).toEqual({ top: BAS, atBottom: true });

    // Instant de la sortie : « Détaillé » n'est pas encore remis en page, le
    // contenu est mesuré comme NON débordant (scrollHeight == clientHeight).
    const transitoire = conversationScrollTarget(memo, CLIENT, CLIENT);
    expect(transitoire).toBe(0); // ← la conversation est bien écrite TOUT EN HAUT

    // Premier signal de rendu : la géométrie RÉELLE est disponible.
    const corrige = conversationScrollReplayTarget(memo, transitoire, 0, CLIENT, HAUTEUR_REELLE);
    // Sans ce second temps, la fonction n'existe pas (import en échec) ou rend
    // null : le test échoue. Avec lui, la conversation est sur ses derniers
    // échanges.
    expect(corrige).toBe(BAS);
  });

  it("le contenu a grandi pendant le plein écran : le rendu vise le bas RÉEL", () => {
    const memo = conversationScrollSnapshot(BAS, CLIENT, HAUTEUR_REELLE);
    const transitoire = conversationScrollTarget(memo, CLIENT, CLIENT);
    expect(transitoire).toBe(0);
    // 3000 px de contenu au lieu de 2400 : le bas est 2500, pas 1900.
    expect(conversationScrollReplayTarget(memo, transitoire, 0, CLIENT, 3000)).toBe(2500);
  });

  it("mise en page déjà juste : aucune seconde écriture (aucun clignotement)", () => {
    const memo = conversationScrollSnapshot(BAS, CLIENT, HAUTEUR_REELLE);
    const applique = conversationScrollTarget(memo, CLIENT, HAUTEUR_REELLE);
    expect(applique).toBe(BAS);
    // Rien à corriger : la fonction ne réécrit pas une position déjà bonne.
    expect(conversationScrollReplayTarget(memo, applique, applique, CLIENT, HAUTEUR_REELLE)).toBe(null);
  });

  it("un contenu qui ne déborde vraiment pas : rien à reposer", () => {
    const memo = conversationScrollSnapshot(0, 400, 400);
    expect(conversationScrollReplayTarget(memo, 0, 0, 400, 400)).toBe(null);
  });

  it("aucune photographie → aucune écriture inventée", () => {
    expect(conversationScrollReplayTarget(null, 0, 0, CLIENT, HAUTEUR_REELLE)).toBe(null);
    expect(conversationScrollReplayTarget(undefined, 0, 0, CLIENT, HAUTEUR_REELLE)).toBe(null);
  });
});

describe("2. la relecture de l'utilisateur n'est jamais écrasée", () => {
  it("il avait REMONTÉ et n'a pas bougé : sa position exacte est reposée", () => {
    // 220 px : il lisait un passage.
    const memo = conversationScrollSnapshot(220, CLIENT, HAUTEUR_REELLE);
    expect(memo.atBottom).toBe(false);
    // Géométrie transitoire : la première écriture a atterri à 0 (faux).
    expect(conversationScrollReplayTarget(memo, 0, 0, CLIENT, HAUTEUR_REELLE)).toBe(220);
  });

  it("il a repris la main APRÈS notre écriture : on ne le ramène pas", () => {
    const memo = conversationScrollSnapshot(220, CLIENT, HAUTEUR_REELLE);
    // Il a déplacé la conversation (900 px) depuis notre écriture à 0.
    expect(conversationScrollReplayTarget(memo, 0, 900, CLIENT, HAUTEUR_REELLE)).toBe(null);
  });

  it("il cherchait le BAS : le bas reste sa position, même s'il a bougé", () => {
    const memo = conversationScrollSnapshot(BAS, CLIENT, HAUTEUR_REELLE);
    expect(conversationScrollReplayTarget(memo, 0, 120, CLIENT, HAUTEUR_REELLE)).toBe(BAS);
  });

  it("le seuil du « déjà en bas » reste celui, unique, du suivi automatique", () => {
    // Une position à 60 px du bas est « en bas » : au retour, il tombe sur le
    // vrai bas, pas sur 60 px au-dessus.
    const memo = conversationScrollSnapshot(BAS - 60, CLIENT, HAUTEUR_REELLE);
    expect(conversationAtBottom(BAS - 60, CLIENT, HAUTEUR_REELLE)).toBe(true);
    expect(memo.atBottom).toBe(true);
    expect(conversationScrollReplayTarget(memo, 0, 0, CLIENT, HAUTEUR_REELLE)).toBe(BAS);
    // À 61 px du bas, il n'était plus « en bas » : sa position est rendue.
    expect(conversationScrollSnapshot(BAS - 61, CLIENT, HAUTEUR_REELLE).atBottom).toBe(false);
  });
});

describe("3. le geste est réellement branché (sinon le module pur est un décor)", () => {
  it("la restitution appelle la vérification de rendu", () => {
    const restitution = corpsFonction(SUPER, "function restoreSuperScroll(messagesEl) {");
    // Sans cet appel, la décision reste celle de l'instant transitoire : le
    // retour en haut revient et ce test échoue.
    expect(restitution).toContain("replaySuperScrollAfterLayout(");
    // La décision reste celle du module pur (aucun second avis recalculé ici).
    expect(restitution).toContain("conversationScrollTarget(");
    expect(restitution).toContain("superAtBottom = memo.atBottom;");
  });

  it("la vérification utilise le signal de RENDU, jamais un minuteur, jamais un défilement animé", () => {
    const rejeu = corpsFonction(SUPER, "function replaySuperScrollAfterLayout(messagesEl, memo, applique) {");
    expect(rejeu).toContain("requestAnimationFrame(");
    expect(rejeu).toContain("conversationScrollReplayTarget(");
    for (const interdit of ["setTimeout", "setInterval", "smooth", "scrollTo(", "behavior"]) {
      expect(rejeu, interdit).not.toContain(interdit);
    }
    // Une seule demande de rendu : aucune boucle, aucun second passage programmé
    // depuis le rappel (une seule occurrence de `requestAnimationFrame(`).
    expect(rejeu.match(/requestAnimationFrame\(/g)).toHaveLength(1);
  });

  it("un onglet démonté ou un environnement sans rendu n'écrit rien", () => {
    const rejeu = corpsFonction(SUPER, "function replaySuperScrollAfterLayout(messagesEl, memo, applique) {");
    expect(rejeu).toContain("isConnected");
    expect(rejeu).toContain('typeof requestAnimationFrame !== "function"');
  });

  it("les DEUX pleins écrans passent par la même restitution (trois voies de sortie identiques)", () => {
    // exitImmersive() et exitVocal() : la seconde porte les trois voies de sortie
    // du mode Vocal (le logo, Échap, la fermeture de l'onglet).
    const sortieAssistantSeul = corpsFonction(SUPER, "function exitImmersive() {");
    const sortieVocal = corpsFonction(SUPER, "function exitVocal() {");
    expect(sortieAssistantSeul).toContain("restoreSuperScroll(messagesEl)");
    expect(sortieVocal).toContain("restoreSuperScroll(messagesEl)");
    // La restitution reste la DERNIÈRE écriture des deux sorties : la mesure est
    // prise une fois l'overlay retiré et la classe de mode enlevée.
    expect(derniereInstruction(sortieAssistantSeul)).toBe("restoreSuperScroll(messagesEl);");
    expect(derniereInstruction(sortieVocal)).toBe("restoreSuperScroll(messagesEl);");
  });

  it("la seule source de la décision de rejeu est le module pur (aucun seuil recopié)", () => {
    // Aucune valeur de seuil n'est réinventée dans le geste.
    const rejeu = corpsFonction(SUPER, "function replaySuperScrollAfterLayout(messagesEl, memo, applique) {");
    expect(rejeu).not.toMatch(/\b(60|1900)\b/);
    expect(SUPER).toContain("conversationScrollReplayTarget,");
  });
});
