/**
 * Verrou — LES DEUX DERNIÈRES GARDES DE L'ÉCRAN VOCAL.
 *
 * Deux défauts signalés par une revue indépendante (verdict FEU VERT, défauts
 * non bloquants) reproduisaient le profil du défaut d'origine de cet écran : un
 * écran MUET qui n'explique rien. Ce fichier lie les deux correctifs.
 *
 * ── GARDE 1 : l'attente du statut du projet est BORNÉE ─────────────────────
 * L'entrée dans le mode demande au moteur « ce projet est-il sensible ? ».
 * L'attente n'avait pas de borne : tant qu'elle durait, la dictée ne s'armait
 * pas, aucun message ne s'affichait, et le bouton 🎙️ rendait la main en
 * silence (sa garde testait le seul drapeau « réponse connue »). Correctif :
 * `withTimeout()` (la garde DÉJÀ écrite pour cette doctrine, aucun second
 * mécanisme) avec un délai court, de l'ordre des autres attentes de l'écran.
 * Au-delà : le projet reste NON VÉRIFIÉ — on ne suppose JAMAIS « projet libre »
 * (aucun armement automatique : l'audio d'un projet confidentiel ne part pas au
 * service de transcription), mais UNE phrase le dit sur la ligne d'état et le
 * GESTE fonctionne.
 *
 * ── GARDE 2 : le plafond des sessions vides est ATTEIGNABLE ────────────────
 * Le plafond (3 fins vides en 30 s ⇒ plus d'armement automatique) ne comptait
 * que la fin NORMALE et vide (`VOICE_END_EMPTY`). Une fin de moteur sans rien
 * transcrire et sans erreur affichée (`no-speech`, `aborted` sans geste)
 * arrivait en `VOICE_END_NO_SESSION` : elle n'était jamais comptée, donc le
 * micro pouvait se rouvrir sans limite, sans le moindre message. Correctif :
 * ces fins comptent aussi — le vide et la nature de la fin restent constatés à
 * UN SEUL endroit (`voice-auto-send.js`), aucune seconde détection.
 *
 * Aucun navigateur requis : décisions pures + lecture des sources (fins de
 * ligne normalisées, quality-gate 3.4 ; les commentaires sont retirés avant
 * lecture pour qu'aucun verrou ne soit satisfait par sa propre prose).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

import {
  isSilentEmptyVoiceEnd,
  normalizedVoiceText,
  VOICE_END_EMPTY,
  VOICE_END_NO_SESSION,
  VOICE_END_SEND,
  VOICE_END_USER_TAKEOVER,
} from "./voice-auto-send.js";
import {
  decideVocalDictation,
  noteEmptyVocalSession,
  VOCAL_DICTATION_ARM,
  VOCAL_DICTATION_DISARM,
  VOCAL_EMPTY_SESSION_LIMIT,
  VOCAL_EMPTY_SESSION_WINDOW_MS,
  VOCAL_MESSAGE_DICTEE_ECHEC,
  VOCAL_MESSAGE_SENSIBILITE_INCONNUE,
} from "./vocal-conversation.js";
// Découpage de source VÉRIFIÉ (aucun `indexOf` nu : une ancre absente doit
// échouer bruyamment, pas produire un fragment vide qui rendrait une assertion
// négative vraie par construction — 3ᵉ audit, défaut 4).
import { sliceSource } from "./source-slice.js";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const lire = (nom) => fs.readFileSync(path.join(ICI, nom), "utf8").replace(/\r\n/g, "\n");
const sansCommentaires = (src) =>
  src
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .join("\n");
const SUPER = sansCommentaires(lire("super-agent.js"));
const CONV = sansCommentaires(lire("vocal-conversation.js"));
const AUTO = sansCommentaires(lire("voice-auto-send.js"));

/** Corps d'une fonction (accolades équilibrées), sur source déjà nettoyée. */
function corpsFonction(src, signature) {
  const debut = src.indexOf(signature);
  expect(debut, signature).toBeGreaterThan(-1);
  // L'accolade OUVRANTE est la dernière de la ligne de signature (un objet par
  // défaut dans les paramètres ne doit pas être pris pour le corps).
  const i = src.lastIndexOf("{", src.indexOf("\n", debut));
  expect(i, signature).toBeGreaterThan(debut);
  let profondeur = 0;
  for (let j = i; j < src.length; j += 1) {
    if (src[j] === "{") profondeur += 1;
    else if (src[j] === "}") {
      profondeur -= 1;
      if (profondeur === 0) {
        // Même exigence que `sliceSource` : un corps minuscule est un symptôme,
        // jamais un résultat acceptable.
        expect(j + 1 - i, signature).toBeGreaterThan(40);
        return src.slice(i, j + 1);
      }
    }
  }
  throw new Error(`corps de ${signature} non trouvé`);
}

// ---------------------------------------------------------------------------
describe("garde 1 — une fin d'écoute VIDE compte, même quand le moteur ne dit rien", () => {
  it("la fin normale et vide compte (plafond déjà atteignable avant)", () => {
    expect(isSilentEmptyVoiceEnd({ reason: VOICE_END_EMPTY, dictatedText: "" })).toBe(true);
    expect(isSilentEmptyVoiceEnd({ reason: VOICE_END_EMPTY, dictatedText: "   \n " })).toBe(true);
  });

  it("la fin SILENCIEUSE du moteur compte aussi (c'est le défaut corrigé)", () => {
    // `no-speech` / `aborted` sans geste : applyVoiceEnd referme la session avant
    // `onend`, la fin arrive en VOICE_END_NO_SESSION et n'était jamais comptée.
    expect(isSilentEmptyVoiceEnd({ reason: VOICE_END_NO_SESSION, dictatedText: "" })).toBe(true);
    expect(
      isSilentEmptyVoiceEnd({ reason: VOICE_END_NO_SESSION, dictatedText: "" }, { erreurAffichee: false, arretDemande: false }),
    ).toBe(true);
  });

  it("une erreur AFFICHÉE ne compte pas : elle a déjà sa phrase", () => {
    expect(
      isSilentEmptyVoiceEnd({ reason: VOICE_END_NO_SESSION, dictatedText: "" }, { erreurAffichee: true }),
    ).toBe(false);
  });

  it("un arrêt DEMANDÉ (🎙️, envoi, sortie du mode) ne compte pas", () => {
    expect(
      isSilentEmptyVoiceEnd({ reason: VOICE_END_NO_SESSION, dictatedText: "" }, { arretDemande: true }),
    ).toBe(false);
  });

  it("une dictée qui a transcrit du texte ne compte jamais", () => {
    expect(isSilentEmptyVoiceEnd({ reason: VOICE_END_SEND, dictatedText: "bonjour" })).toBe(false);
    expect(isSilentEmptyVoiceEnd({ reason: VOICE_END_NO_SESSION, dictatedText: "ok" })).toBe(false);
  });

  it("la reprise en main de l'utilisateur ne compte pas (sa saisie prime)", () => {
    expect(
      isSilentEmptyVoiceEnd({ reason: VOICE_END_USER_TAKEOVER, dictatedText: "" }),
    ).toBe(false);
  });

  it("entrées absentes ou invalides : jamais une exception", () => {
    expect(isSilentEmptyVoiceEnd(null)).toBe(false);
    expect(isSilentEmptyVoiceEnd(undefined, undefined)).toBe(false);
    expect(isSilentEmptyVoiceEnd({}, null)).toBe(false);
  });

  it("le vide est constaté UNE fois, par le module partagé (aucun .trim() ailleurs)", () => {
    // La fonction s'appuie sur `normalizedVoiceText` de CE module : c'est la
    // seule détection de « pas de texte » du dépôt pour une dictée.
    const corps = corpsFonction(AUTO, "export function isSilentEmptyVoiceEnd");
    expect(corps).toMatch(/normalizedVoiceText\(fin\.dictatedText\)/);
    expect(corps).not.toMatch(/\.trim\(\)/);
    expect(normalizedVoiceText("  \n ")).toBe("");
    // Aucune seconde détection dans l'écran ni dans la conversation.
    expect(sansCommentaires(corpsFonction(SUPER, "function vocalNoteEmptySession"))).not.toMatch(
      /dictatedText|\.trim\(\)|finalText/,
    );
    expect(CONV).not.toMatch(/dictatedText|\.trim\(\)/);
  });

  it("le plafond EXISTANT s'atteint alors : 3 fins vides en 30 s ⇒ plus d'armement", () => {
    const t0 = 1_000_000;
    let historique = [];
    let suspendu = false;
    for (let i = 0; i < VOCAL_EMPTY_SESSION_LIMIT; i += 1) {
      if (!isSilentEmptyVoiceEnd({ reason: VOICE_END_NO_SESSION, dictatedText: "" })) continue;
      const r = noteEmptyVocalSession(historique, t0 + i * 1000);
      historique = r.sessions;
      suspendu = r.suspendu;
    }
    expect(suspendu).toBe(true);
    // Et la décision pure refuse alors l'armement automatique (règle 5c).
    const d = decideVocalDictation({
      modeOuvert: true,
      transcription: true,
      sensibiliteConnue: true,
      mesureOuverte: true,
      sessionsVides: true,
    });
    expect(d.action).not.toBe(VOCAL_DICTATION_ARM);
    expect(d.raison).toBe("sessions-vides");
    // Une seule fin ne suffit pas : le plafond garde son seuil (3).
    expect(noteEmptyVocalSession([], t0).suspendu).toBe(VOCAL_EMPTY_SESSION_LIMIT <= 1);
    expect(VOCAL_EMPTY_SESSION_WINDOW_MS).toBe(30_000);
  });
});

// ---------------------------------------------------------------------------
describe("le branchement du plafond dans l'écran", () => {
  it("`onend` passe à `applyVoiceEnd` le contexte de la session", () => {
    // Erreur AFFICHÉE : seule une erreur qui a produit une phrase compte comme
    // telle (`vocalDictationMessage` est la source des phrases, comme avant).
    expect(SUPER).toMatch(/erreurAffichee = vocalDictationMessage\(ev\.error\) !== "";/);
    // Arrêt DEMANDÉ : posé par le SEUL arrêt programmé (stopVoiceInput), remis à
    // zéro à chaque session (aucun drapeau qui survit d'une dictée à l'autre).
    expect(SUPER).toMatch(/voiceStopVoulu = true;/);
    expect(SUPER).toMatch(/voiceStopVoulu = false;/);
    expect((SUPER.match(/voiceStopVoulu = true;/g) || []).length).toBe(1);
    expect((SUPER.match(/^ {4}voiceStopVoulu = false;$/gm) || []).length).toBe(1);
    expect(SUPER).toMatch(/let voiceStopVoulu = false;/);
    // Le contexte est lu AVANT le traitement de la fin, puis transmis.
    expect(SUPER).toMatch(/const arretDemande = voiceStopVoulu;/);
    expect(SUPER).toMatch(/const fin = applyVoiceEnd\(\{/);
    expect(SUPER).toMatch(/vocalNoteEmptySession\(fin, \{ erreurAffichee, arretDemande \}\);/);
    // Un seul passage par `applyVoiceEnd` : aucune seconde fin d'écoute.
    expect((SUPER.match(/applyVoiceEnd\(\{/g) || []).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("garde 1 — l'attente du statut du projet est BORNÉE", () => {
  it("elle passe par `withTimeout` (aucun second mécanisme d'attente bornée)", () => {
    const relu = corpsFonction(SUPER, "function refreshVocalSensitivity");
    expect(relu).toMatch(/withTimeout\(/);
    expect(relu).toMatch(/invoke\("is_project_sensitive"/);
    // Le délai vient d'UNE constante, courte (ordre des autres attentes du front).
    expect(relu).toMatch(/VOCAL_SENSITIVITY_TIMEOUT_MS/);
    const m = SUPER.match(/VOCAL_SENSITIVITY_TIMEOUT_MS = (\d+);/);
    expect(m, "délai de la garde").toBeTruthy();
    const ms = Number(m[1]);
    expect(ms).toBeGreaterThanOrEqual(200);
    expect(ms).toBeLessThanOrEqual(1500);
    // Aucune autre course de promesse écrite à la main pour cet écran : un seul
    // mécanisme (`setTimeout` + `Promise.race` ne doivent pas réapparaître ici).
    expect(relu).not.toMatch(/Promise\.race/);
    expect(relu).not.toMatch(/new Promise/);
    // Aucun second délai inventé dans le fichier pour cette garde.
    expect((SUPER.match(/withTimeout\(\s*invoke\("is_project_sensitive"/g) || []).length).toBe(1);
  });

  it("délai dépassé ⇒ projet NON VÉRIFIÉ, jamais « libre »", () => {
    const relu = corpsFonction(SUPER, "function refreshVocalSensitivity");
    // La sentinelle du délai dépassé est `null` (le repli de `withTimeout`).
    expect(relu).toMatch(/null\s*\n?\s*\)/);
    expect(relu).toMatch(/if \(reponse === null\)/);
    // Ce qui est posé dans ce cas : non vérifié + drapeau lisible par l'écran.
    expect(relu).toMatch(/vocalSensibiliteIndisponible = true;/);
    // Et SURTOUT pas de pari sur « projet libre » : aucune écriture
    // `vocalProjectSensible = false` dans la branche du délai dépassé.
    const branche = sliceSource(relu, "if (reponse === null)", "} else {", 60);
    expect(branche).not.toMatch(/vocalProjectSensible\s*=/);
    expect(branche).toMatch(/vocalSensibiliteConnue = false;/);
    // Une erreur d'IPC, elle, reste fail-open (comportement existant inchangé).
    expect(relu).toMatch(/\.catch\(\(\) => \(\{ sensible: false \}\)\)/);
    // Le drapeau repart à zéro à la sortie du mode et à chaque relecture.
    expect((SUPER.match(/vocalSensibiliteIndisponible = false;/g) || []).length).toBeGreaterThanOrEqual(4);
  });

  it("délai dépassé ⇒ la ligne d'état l'explique, en UNE phrase", () => {
    // Le drapeau entre dans l'état par le champ que la décision pure lit.
    expect(SUPER).toMatch(/sensibiliteIndisponible: vocalSensibiliteIndisponible === true,/);
    // La raison produite par la décision pure…
    const d = decideVocalDictation({
      modeOuvert: true,
      transcription: true,
      sensibiliteConnue: false,
      sensibiliteIndisponible: true,
      mesureOuverte: true,
    });
    expect(d.action).toBe(VOCAL_DICTATION_DISARM);
    expect(d.raison).toBe("sensibilite-indisponible");
    // …est TRADUITE par l'écran (jamais un écran muet).
    expect(SUPER).toMatch(
      /if \(raison === "sensibilite-indisponible"\) return VOCAL_MESSAGE_SENSIBILITE_INCONNUE;/,
    );
    // Une phrase simple, une seule, qui dit quoi faire.
    expect(VOCAL_MESSAGE_SENSIBILITE_INCONNUE).not.toMatch(/\n/);
    expect(VOCAL_MESSAGE_SENSIBILITE_INCONNUE.length).toBeGreaterThan(20);
    expect(VOCAL_MESSAGE_SENSIBILITE_INCONNUE.length).toBeLessThan(120);
    expect(VOCAL_MESSAGE_SENSIBILITE_INCONNUE).not.toBe(VOCAL_MESSAGE_DICTEE_ECHEC);
  });

  it("délai dépassé ⇒ le GESTE 🎙️ fonctionne (plus de bouton sans effet)", () => {
    const geste = corpsFonction(SUPER, "function toggleVoiceInput");
    // La garde « réponse pas encore arrivée » n'empêche plus le geste quand
    // l'attente a été bornée sans réponse.
    expect(geste).toMatch(/if \(!vocalSensibiliteConnue && !vocalSensibiliteIndisponible\) return;/);
    // Le refus « projet sensible » (projet CONNU 🔒) reste, lui, prioritaire.
    const indiceSensible = geste.indexOf("vocalProjectSensible");
    const indiceGarde = geste.indexOf("!vocalSensibiliteIndisponible");
    expect(indiceSensible).toBeGreaterThan(-1);
    expect(indiceSensible).toBeLessThan(indiceGarde);
    // Le geste lève aussi le plafond (comportement existant, inchangé).
    expect(geste).toMatch(/vocalSessionsVides = \[\];/);
    expect(geste).toMatch(/vocalDicteeSuspendue = false;/);
  });

  it("une dictée ouverte par un GESTE n'est pas refermée par la raison du délai", () => {
    // La règle « déjà ouverte » (5) passe AVANT la raison du statut non vérifié.
    const d = decideVocalDictation({
      modeOuvert: true,
      transcription: true,
      dicteeOuverte: true,
      sensibiliteConnue: false,
      sensibiliteIndisponible: true,
      mesureOuverte: true,
    });
    expect(d.raison).toBe("deja-ouverte");
    expect(d.action).not.toBe(VOCAL_DICTATION_DISARM);
  });

  it("pendant l'attente (pas encore dépassée) : aucun armement, et rien d'inventé", () => {
    const d = decideVocalDictation({
      modeOuvert: true,
      transcription: true,
      sensibiliteConnue: false,
      sensibiliteIndisponible: false,
      mesureOuverte: true,
    });
    expect(d.action).toBe(VOCAL_DICTATION_DISARM);
    expect(d.raison).toBe("sensibilite-inconnue");
  });
});
