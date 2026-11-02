// Tests — L'UTILISATEUR COMPREND CE QU'EST LA VOIX IMITÉE (VoiceStudio).
//
// Ce que ce fichier verrouille, et qui doit FAIRE ÉCHOUER la suite si l'un de ces
// points disparaît de l'écran des réglages (Paramètres → onglet « Assistant » →
// section « Lecture des réponses à voix haute ») :
//   1. l'explication est là : VoiceStudio est un **logiciel séparé**, à
//      **installer** soi-même sur **cet ordinateur**, et il doit être **lancé** ;
//   2. l'explication dit où le récupérer sans JAMAIS inventer d'adresse : Pilot,
//      qui n'embarque pas ce logiciel, ne donne aucune URL — un test refuse toute
//      adresse dans ce texte tant qu'aucune n'existe dans le dépôt ;
//   3. le repli est annoncé en clair (voix française locale, puis voix du
//      système) : le service absent ne bloque rien ;
//   4. le texte est écrit à UN SEUL endroit (`voicestudio-explication.js`, module
//      PUR), et la copie de repli de `index.html` est identique au caractère près
//      (aucune version divergente) ;
//   5. la phrase est réellement écrite dans la section au rendu
//      (`renderReadAloudVoice`), jamais masquée par le code et jamais conditionnée
//      à un service présent — c'est précisément quand il manque qu'elle sert ;
//   6. le reste de la section ne bouge pas : un seul réglage de voix
//      (`read_aloud_voice`), le choix mémorisé reste porté, le service absent
//      n'empêche rien.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { VOICESTUDIO_EXPLAIN_TEXT, fillVoiceStudioExplanation } from "./voicestudio-explication.js";
// Découpage de source VÉRIFIÉ (jamais `source.indexOf` en ligne : l'inventaire
// `source-slice.test.js` refuse un découpage non protégé).
import { sliceSource } from "./source-slice.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

/** Lit un fichier du dépôt (fin de lignes normalisées : piège CI Windows). */
function read(relative) {
  return readFileSync(join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");
}

/** Espaces ramenés à un seul (une indentation ne change pas le texte affiché). */
function collapse(text) {
  return String(text == null ? "" : text)
    .replace(/\s+/g, " ")
    .trim();
}

const SOURCE = read("src/js/voicestudio-explication.js");
const SETTINGS = read("src/js/settings.js");
const INDEX = read("index.html");

/** Texte de repli écrit dans `index.html` (le nœud de la section des réglages). */
function htmlNoteText() {
  const found = INDEX.match(
    /<span id="read-aloud-voicestudio-note"[^>]*>([\s\S]*?)<\/span>/,
  );
  expect(found, "le nœud #read-aloud-voicestudio-note doit exister dans index.html").toBeTruthy();
  return found[1];
}

describe("voix imitée — l'explication affichée dans les réglages", () => {
  it("est une phrase courte, en français, qui tient en une lecture", () => {
    const texte = collapse(VOICESTUDIO_EXPLAIN_TEXT);
    expect(texte.length).toBeGreaterThan(200);
    // Une phrase longue ne se lit plus : on vérifie qu'aucun passage n'excède
    // largement une phrase (le texte est fait de phrases courtes, séparées).
    const phrases = texte.split(/(?<=[.!?])\s+/);
    expect(phrases.length).toBeGreaterThanOrEqual(4);
    for (const phrase of phrases) {
      expect(phrase.length, `phrase trop longue : ${phrase}`).toBeLessThanOrEqual(220);
    }
    // Le vocabulaire de l'écran, pas celui du développement.
    expect(texte).not.toMatch(/\bAPI\b|endpoint|processus|binaire|daemon|port\s*3900/i);
  });

  it("dit que VoiceStudio est un logiciel SÉPARÉ, installé et lancé par l'utilisateur", () => {
    const texte = collapse(VOICESTUDIO_EXPLAIN_TEXT);
    expect(texte).toContain("logiciel séparé");
    expect(texte).toContain("s'installe sur cet ordinateur");
    expect(texte).toContain("Pilot ne l'installe pas");
    expect(texte).toContain("ne le lance pas");
    expect(texte).toContain("doit être lancé et rester ouvert");
  });

  it("dit que le service absent ne bloque pas la lecture (repli annoncé)", () => {
    const texte = collapse(VOICESTUDIO_EXPLAIN_TEXT);
    expect(texte).toContain("la lecture ne s'arrête pas");
    expect(texte).toContain("voix française locale");
    expect(texte).toContain("voix du système");
    expect(texte).toContain("à côté du bouton « Écouter »");
  });

  it("dit où le récupérer SANS inventer aucune adresse", () => {
    const texte = collapse(VOICESTUDIO_EXPLAIN_TEXT);
    // Rien d'inventé : ni lien, ni domaine, ni nom de paquet, ni commande.
    expect(texte).not.toMatch(/https?:\/\//i);
    expect(texte).not.toMatch(/www\./i);
    expect(texte).not.toMatch(/\.(com|fr|io|net|org|dev)\b/i);
    expect(texte).not.toMatch(/git clone|npm i|docker|choco |winget|brew /i);
    // Et le manque est dit franchement, avec le geste réel qui relance la
    // vérification (bouton existant de la même section).
    expect(texte).toContain("Où le récupérer");
    expect(texte).toContain("ne donne aucune adresse de téléchargement");
    expect(texte).toContain("« Vérifier à nouveau »");
  });

  it("garde le module PUR : aucun DOM global, aucune couche Tauri, aucun réseau", () => {
    expect(SOURCE).not.toMatch(/\bdocument\./);
    expect(SOURCE).not.toMatch(/\bwindow\./);
    expect(SOURCE).not.toContain("@tauri-apps");
    expect(SOURCE).not.toMatch(/\bfetch\(/);
    // Il n'écrit que dans le nœud qu'on lui PASSE.
    const fake = {};
    expect(fillVoiceStudioExplanation(fake)).toBe(true);
    expect(fake.textContent).toBe(VOICESTUDIO_EXPLAIN_TEXT);
    // Un nœud absent n'est pas une erreur (les Paramètres restent utilisables).
    expect(fillVoiceStudioExplanation(null)).toBe(false);
    expect(fillVoiceStudioExplanation(undefined)).toBe(false);
  });
});

describe("voix imitée — l'explication est bien dans l'écran des réglages", () => {
  it("le nœud est dans la section « Lecture des réponses à voix haute »", () => {
    const section = sliceSource(
      INDEX,
      '<div class="settings-section" id="settings-section-read-aloud">',
      "<!-- Mode Vocal : SEUL endroit ou se regle le delai d'envoi",
      500,
    );
    expect(section).toContain('id="read-aloud-voicestudio-note"');
  });

  it("la copie de repli de index.html est IDENTIQUE au texte du module", () => {
    expect(collapse(htmlNoteText())).toBe(collapse(VOICESTUDIO_EXPLAIN_TEXT));
  });

  it("la ligne est visible : ni `display:none`, ni `hidden` sur ce nœud", () => {
    // Le fragment commence à la BALISE de la ligne (style compris) et va jusqu'à
    // sa fermeture : tout ce qui pourrait cacher la phrase y est visible.
    const row = sliceSource(
      INDEX,
      '<div class="setting-row setting-row-indent" style="font-size:11px;color:var(--text-muted);">\n              <span id="read-aloud-voicestudio-note"',
      "</div>",
      200,
    );
    expect(row).not.toMatch(/display\s*:\s*none/i);
    expect(row).not.toMatch(/\bhidden\b/i);
    expect(row).not.toMatch(/visibility\s*:\s*hidden/i);
  });

  it("settings.js écrit le texte du module dans ce nœud, au rendu de la section", () => {
    // Le nœud est déclaré par son identifiant (aucun autre sélecteur).
    expect(SETTINGS).toContain(
      'const readAloudVoiceStudioNote = document.getElementById("read-aloud-voicestudio-note")',
    );
    // Une seule porte : le module d'explication.
    expect(SETTINGS).toContain('from "./voicestudio-explication.js"');
    expect(SETTINGS).toContain("fillVoiceStudioExplanation");
    // L'appel est DANS le rendu de la section, avant toute sortie anticipée : il
    // a donc lieu à chaque ouverture, chaque vérification et chaque choix.
    const rendu = sliceSource(
      SETTINGS,
      "  function renderReadAloudVoice(wanted, local) {",
      "  // ── Téléchargement d'un modèle de voix locale (GESTE EXPLICITE seulement) ──",
      1200,
    );
    expect(rendu).toContain("fillVoiceStudioExplanation(readAloudVoiceStudioNote)");
    // …et il précède le `return` qui sort quand la liste n'est pas encore prête.
    const appel = rendu.indexOf("fillVoiceStudioExplanation(readAloudVoiceStudioNote)");
    const retrait = rendu.indexOf("if (!selectReadAloudVoice) return;");
    expect(appel).toBeGreaterThanOrEqual(0);
    expect(retrait).toBeGreaterThan(appel);
    // Le rendu est bien atteint à l'ouverture des réglages (chemin unique).
    const ouverture = sliceSource(
      SETTINGS,
      "  function refreshReadAloudVoice(choice, options) {",
      "  /** Vérification automatique déjà faite pour cette ouverture des Paramètres. */",
      200,
    );
    expect(ouverture).toContain("renderReadAloudVoice(wanted, known)");
  });

  it("le texte n'est jamais masqué ni conditionné par le code des réglages", () => {
    // Aucune écriture de visibilité sur ce nœud : la phrase reste affichée, que
    // le service tourne, manque ou n'ait jamais été vérifié.
    const usages = SETTINGS.split("readAloudVoiceStudioNote").length - 1;
    expect(usages).toBe(2); // la déclaration + l'appel, rien d'autre
    expect(SETTINGS).not.toMatch(/readAloudVoiceStudioNote\.(style|hidden|dataset)/);
  });

  it("ne touche pas au réglage unique de la voix (`read_aloud_voice`)", () => {
    // Un seul champ, enregistré comme avant : l'explication n'ajoute aucun
    // réglage, donc rien à relire au chargement suivant.
    const enregistrement = sliceSource(
      SETTINGS,
      "      read_aloud_voice: selectReadAloudVoice ? selectReadAloudVoice.value : \"\",",
      "    };",
      40,
    );
    expect(enregistrement).toContain("selectReadAloudVoice.value");
    expect(SETTINGS.match(/read_aloud_voice:/g) || []).toHaveLength(1);
    expect(SETTINGS).not.toContain("read_aloud_voicestudio");
    expect(INDEX).not.toContain("read_aloud_voicestudio");
  });
});
