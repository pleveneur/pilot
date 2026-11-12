// veille-transcription-locale.test.js — LA VEILLE DE 20 S S'ARME AUSSI QUAND LA
// TRANSCRIPTION EST LOCALE.
//
// LE DÉFAUT SIGNALÉ (version installée) : avec la case « Transcrire avec le
// service de voix local » cochée, la mise en veille automatique après 20 s de
// silence ne s'armait JAMAIS — l'écran restait à l'écoute indéfiniment. Sans
// cette case (moteur du navigateur), tout fonctionnait : la veille s'armait
// après la réponse et le nom réveillait du premier coup.
//
// LES DEUX CAUSES, toutes deux propres à l'oreille locale, et ce que ce fichier
// verrouille :
//
//   1. LE TEXTE QUI N'EST PAS UNE PAROLE. Le compte à rebours repart à chaque
//      texte rendu par le moteur. Le service local transcrit la pièce EN
//      CONTINU — micro armé et silence compris (le commentaire de `onresult`
//      dans super-agent.js le dit déjà, correctif « la barre du bas ne s'efface
//      plus ») : chaque texte remettait le compte à zéro AVANT son terme. La
//      règle pure `texteCompteCommeParole` tranche : seule une parole que le
//      MICRO A MESURÉE compte ; un texte rendu alors que la mesure est ouverte
//      et n'entend aucune voix n'est pas une parole.
//
//   2. LE COMPTE PERDU. Le compte n'existe que sous la forme d'UN `setTimeout`
//      que plusieurs chemins annulent (suspension pendant la lecture ou le
//      tour, sortie du mode). Avec le moteur du navigateur, chaque fin de
//      session de reconnaissance (`no-speech`, quelques secondes) réapplique
//      l'état et le relance ; avec l'oreille locale, la session ne se ferme
//      jamais d'elle-même (le pont n'envoie la fin de flux que si Pilot la
//      demande) : plus rien ne recréait le compte. `vocalVeilleReexamenPass` le
//      rejoue chaque seconde, avec la MÊME décision et le MÊME délai.
//
// CE QUI NE CHANGE PAS, et qui est vérifié ici : le seuil de 20 s (une seule
// occurrence dans le dépôt), la phrase d'invitation, l'aspect de la veille
// (`vocal-veille`, posé par `vocalSyncVeilleClass`), le réveil par le nom, le
// réexamen qui ne touche JAMAIS un compte en cours, et l'écoute non locale
// (la règle ne dépend PAS du moteur : une voix mesurée accompagne toujours un
// vrai mot).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  decideVocalVeille,
  texteCompteCommeParole,
  VOCAL_ECOUTE_LIBRE_MS,
  VOCAL_VEILLE_REEXAMEN_MS,
} from "./vocal-nom-garde.js";
import { sliceSource } from "./source-slice.js";

const ICI = dirname(fileURLToPath(import.meta.url));
// Le source peut arriver en CRLF (runner Windows) : on normalise AVANT toute
// recherche d'ancre multi-lignes (quality-gate § 3.4).
const lire = (rel) => readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const SUPER = lire("src/js/super-agent.js");
const CODE = lire("src/js/vocal-nom-garde.js");

/** Corps d'une fonction (ancre de fin : la fermeture en colonne 2). */
function corpsFonction(src, entete, minLen = 60) {
  return sliceSource(src, entete, "\n  }\n", minLen);
}

/**
 * SIMULATION du compte à rebours : à chaque seconde, le réexamen périodique
 * rejoue la décision pure, et le repère (`depart`) n'est déplacé que par un
 * SIGNE DE VIE (une parole réellement comptée). Aucune horloge réelle : le
 * temps est avancé à la main, ce qui rend le résultat exact et reproductible.
 * @param {{dureeMs?: number, signesDeVie?: number[]}} options
 * @returns {number|null} l'instant où la veille s'arme, ou null si jamais
 */
function armeApres({ dureeMs = 90000, signesDeVie = [] } = {}) {
  let depart = 0;
  const signes = new Set(signesDeVie);
  for (let t = 0; t <= dureeMs; t += VOCAL_VEILLE_REEXAMEN_MS) {
    if (signes.has(t)) depart = t;
    const vu = decideVocalVeille({ modeOuvert: true, ecouleMs: t - depart });
    if (vu.armer === true) return t;
  }
  return null;
}

/** Les instants d'un texte rendu toutes les `periodeMs` (oreille locale). */
function textesToutesLes(periodeMs, dureeMs) {
  const instants = [];
  for (let t = 0; t <= dureeMs; t += periodeMs) instants.push(t);
  return instants;
}

// ---------------------------------------------------------------------------
describe("1. LA RÈGLE PURE : un texte sans voix mesurée n'est pas une parole", () => {
  it("(a) mesure OUVERTE et aucune voix : le texte ne remet PAS le compte à zéro", () => {
    // C'est le cas de l'oreille locale dans une pièce silencieuse : le service
    // rend du texte, le micro n'entend rien.
    expect(texteCompteCommeParole({ microMesure: true, voixMesuree: false })).toBe(false);
  });

  it("(b) mesure OUVERTE et voix MESURÉE : le texte compte (comportement d'avant)", () => {
    expect(texteCompteCommeParole({ microMesure: true, voixMesuree: true })).toBe(true);
  });

  it("(c) AUCUNE mesure ouverte : le mot compte quand même (fail-open)", () => {
    // Rien ne permet de contredire le mot : on ne le prive jamais de son effet,
    // sinon un vrai locuteur pourrait voir la veille s'armer pendant qu'il parle.
    expect(texteCompteCommeParole({ microMesure: false, voixMesuree: false })).toBe(true);
    expect(texteCompteCommeParole({})).toBe(true);
    expect(texteCompteCommeParole()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("2. LE DÉFAUT, tel qu'il se produisait, puis son effet corrigé", () => {
  it("(a) avant : un texte rendu toutes les 2 s remet le compte à zéro — la veille ne s'arme JAMAIS", () => {
    // Chaque texte rendu comptait comme un signe de vie : le repère repartait
    // toutes les 2 s, donc 20 s ne pouvaient jamais s'écouler.
    const arme = armeApres({ dureeMs: 120000, signesDeVie: textesToutesLes(2000, 120000) });
    expect(arme).toBe(null);
  });

  it("(b) après : les mêmes textes, filtrés par la règle, laissent le compte courir — armement à 20 s", () => {
    // Les textes rendus sans voix mesurée ne sont plus des signes de vie : le
    // repère reste au dernier vrai signe (ici l'entrée dans le mode) et la
    // veille s'arme au terme EXACT des 20 s.
    const arme = armeApres({ dureeMs: 120000, signesDeVie: [0] });
    expect(arme).toBe(VOCAL_ECOUTE_LIBRE_MS);
    expect(VOCAL_ECOUTE_LIBRE_MS).toBe(20000);
  });

  it("(c) une vraie conversation tient l'écran éveillé, puis la veille s'arme 20 s après le dernier mot", () => {
    // Voix mesurées toutes les 3 s jusqu'à 60 s : rien ne s'arme avant.
    const voix = textesToutesLes(3000, 60000);
    const arme = armeApres({ dureeMs: 120000, signesDeVie: voix });
    expect(arme).toBe(60000 + VOCAL_ECOUTE_LIBRE_MS);
  });

  it("(d) le réexamen périodique ne raccourcit rien : à 19 999 ms il n'arme pas, à 20 000 ms il arme", () => {
    expect(armeApres({ dureeMs: VOCAL_ECOUTE_LIBRE_MS - 1, signesDeVie: [0] })).toBe(null);
    expect(armeApres({ dureeMs: VOCAL_ECOUTE_LIBRE_MS, signesDeVie: [0] })).toBe(
      VOCAL_ECOUTE_LIBRE_MS,
    );
  });
});

// ---------------------------------------------------------------------------
describe("3. LE BRANCHEMENT : le mot ne remet le compte à zéro que s'il est une parole", () => {
  it("(a) `vocalNoteWord` consulte la règle pure avant de relancer le compte", () => {
    const corps = corpsFonction(SUPER, "  function vocalNoteWord() {", 300);
    expect(corps).toContain("texteCompteCommeParole({");
    expect(corps).toContain("microMesure: vocalMicListening === true");
    expect(corps).toContain("voixMesuree: vocalMicCapte === true");
    // UN SEUL relancement, et il est DANS la garde : le texte qui n'est pas une
    // parole ne peut pas tenir l'écran éveillé.
    const relances = corps.split("vocalRestartVeilleTimer()").length - 1;
    expect(relances).toBe(1);
    expect(corps.indexOf("texteCompteCommeParole({")).toBeLessThan(
      corps.indexOf("vocalRestartVeilleTimer()"),
    );
  });

  it("(b) une parole MESURÉE remet toujours le compte à zéro (comportement conservé)", () => {
    const corps = corpsFonction(SUPER, "  function vocalSetLevel(niveau) {", 300);
    expect(corps).toContain("if (pas.capte === true) vocalRestartVeilleTimer();");
  });

  it("(c) la règle ne dépend PAS du moteur : aucune condition « local » dans ce chemin", () => {
    const corps = corpsFonction(SUPER, "  function vocalNoteWord() {", 300);
    // Aucune condition sur le moteur (identifiant, drapeau, évènement local) : la
    // règle est celle du MICRO, identique quel que soit celui qui transcrit.
    expect(corps).not.toContain("localEar");
    expect(corps).not.toContain("oreille-locale");
    expect(corps).not.toContain("dictationLocale");
  });
});

// ---------------------------------------------------------------------------
describe("4. LE COMPTE PERDU : un réexamen périodique, qui ne décide rien de nouveau", () => {
  it("(a) le réexamen rejoue la MÊME décision pure, construite à UN SEUL endroit", () => {
    const corps = corpsFonction(SUPER, "  function vocalVeilleReexamenPass() {", 200);
    expect(corps).toContain("vocalVeilleDecision(false)");
    expect(corps).toContain('vocalEnterVeille("silence")');
    // Une seule construction de la décision dans tout le fichier, et elle porte
    // le délai du module pur (aucun seuil recopié).
    expect((SUPER.match(/decideVocalVeille\(\{/g) || []).length).toBe(1);
    const decision = corpsFonction(SUPER, "  function vocalVeilleDecision(veilleArmee) {", 120);
    expect(decision).toContain("decideVocalVeille({");
    expect(decision).toContain("ecouleMs: Date.now() - vocalVeilleDepart");
    expect(decision).toContain("...vocalVeilleEtat()");
  });

  it("(b) il ne touche JAMAIS un compte en cours (aucun raccourcissement, aucune remise à zéro)", () => {
    const corps = corpsFonction(SUPER, "  function vocalVeilleReexamenPass() {", 200);
    // Un compte qui tourne porte la décision : le réexamen sort.
    expect(corps).toContain("if (vocalVeilleTimer) return;");
    // Et il n'écrit ni le minuteur ni le repère : il ne fait que recréer.
    expect(corps).not.toContain("clearVocalVeilleTimer()");
    expect(corps).not.toContain("vocalVeilleDepart = Date.now()");
    expect(corps).not.toContain("vocalVeilleTimer =");
  });

  it("(c) il existe SEULEMENT pendant l'écran Vocal : ouvert à l'entrée, annulé à la sortie", () => {
    const entree = corpsFonction(SUPER, "  function enterVocal() {", 2000);
    expect(entree).toContain(
      "setInterval(vocalVeilleReexamenPass, VOCAL_VEILLE_REEXAMEN_MS)",
    );
    const sortie = corpsFonction(SUPER, "  function exitVocal(", 1000);
    expect(sortie).toContain("clearVocalVeilleReexamen()");
    const nettoyage = corpsFonction(SUPER, "  function clearVocalVeilleReexamen() {", 60);
    expect(nettoyage).toContain("clearInterval(vocalVeilleReexamen)");
    // Une seule création d'intervalle dans tout le fichier.
    expect(SUPER.split("setInterval(vocalVeilleReexamenPass").length - 1).toBe(1);
  });

  it("(d) la période vient du module pur, et le repère n'est jamais périmé", () => {
    expect(VOCAL_VEILLE_REEXAMEN_MS).toBe(1000);
    expect(CODE).toContain("export const VOCAL_VEILLE_REEXAMEN_MS = 1000;");
    // Le repère est posé AVANT les sorties anticipées de la relance : le
    // réexamen ne compte jamais 20 s depuis un signe de vie périmé.
    const relance = corpsFonction(SUPER, "  function vocalRestartVeilleTimer() {", 300);
    expect(relance.indexOf("vocalVeilleDepart = Date.now();")).toBeLessThan(
      relance.indexOf("if (!vocalOverlay"),
    );
    // Et la suspension le suit : à la sortie de la lecture / du tour, le compte
    // repart de là, comme la relance « de zéro ».
    const suspension = corpsFonction(SUPER, "  function vocalSyncVeilleSuspension() {", 200);
    expect(suspension).toContain("vocalVeilleDepart = Date.now();");
    expect(suspension.indexOf("vocalVeilleDepart = Date.now();")).toBeLessThan(
      suspension.indexOf("if (vocalVeilleArmee === true) return;"),
    );
  });
});

// ---------------------------------------------------------------------------
describe("5. CE QUI NE CHANGE PAS : 20 s, l'invitation, l'aspect, le nom", () => {
  it("(a) le seuil de 20 s garde UNE seule occurrence, dans le module pur", () => {
    expect(CODE).toContain("export const VOCAL_ECOUTE_LIBRE_MS = 20000;");
    expect(CODE.split("VOCAL_ECOUTE_LIBRE_MS = 20000").length - 1).toBe(1);
    expect(SUPER).not.toContain("= 20000");
    expect(SUPER).not.toContain("= 20_000");
  });

  it("(b) la veille s'arme par la MÊME porte, et son aspect est toujours posé", () => {
    expect(SUPER.split('vocalEnterVeille("silence")').length - 1).toBe(2);
    const entree = corpsFonction(SUPER, "  function vocalEnterVeille(origine) {", 100);
    expect(entree).toContain("vocalSyncVeilleClass();");
    expect(entree).toContain("vocalVeilleArmee = true;");
  });

  it("(c) le réveil par le nom lève la veille et repart le compte, sans modification", () => {
    const sortie = corpsFonction(SUPER, "  function vocalExitVeille() {", 100);
    expect(sortie).toContain("vocalVeilleArmee = false;");
    expect(sortie).toContain("vocalSyncVeilleClass();");
    expect(sortie).toContain("vocalRestartVeilleTimer();");
  });
});
