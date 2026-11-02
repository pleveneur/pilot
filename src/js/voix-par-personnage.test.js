// voix-par-personnage.test.js — LA VOIX PROPRE AU PERSONNAGE ACTIF.
//
// Ce que ce fichier VERROUILLE (chaque test échoue si sa règle disparaît) :
//   1. la décision « quelle voix pour cette lecture ? » est PRISE À UN SEUL
//      ENDROIT (`character-voices.js`) et BRANCHÉE À UN SEUL (dans `speak`) ;
//   2. aucun personnage actif ⇒ comportement historique INTACT : voix générale,
//      et à l'écran AUCUNE ligne « voix du personnage » (ni champ, ni message) ;
//   3. personnage actif sans voix attribuée ⇒ voix générale (repli silencieux) ;
//   4. voix attribuée devenue indisponible ⇒ voix générale, jamais un échec ;
//   5. le catalogue proposé est la MÊME liste que le sélecteur général (aucune
//      seconde liste de voix, aucun second mécanisme de lecture) ;
//   6. la configuration est ADDITIVE : un ancien fichier sans le champ garde le
//      comportement d'avant (champ absent ⇒ objet vide, rien de touché).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CHARACTER_NAME_MAX,
  CHARACTER_VOICE_INHERIT_LABEL,
  CHARACTER_VOICES_KEY,
  characterVoiceOptions,
  characterVoiceRow,
  isUsableVoiceValue,
  normalizeCharacterName,
  normalizeCharacterVoices,
  storedVoiceForCharacter,
  voiceForCharacter,
  withCharacterVoice,
} from "./character-voices.js";
import {
  applyVoicePreferenceFromConfig,
  getCharacterVoices,
  getPreferredVoiceName,
  resolveReadingVoice,
  setCharacterVoices,
  setPreferredVoiceName,
} from "./read-aloud.js";
import { sliceSource } from "./source-slice.js";

/** Lit un fichier source avec les fins de ligne normalisées (piège CRLF CI). */
function read(rel) {
  return readFileSync(rel, "utf8").replace(/\r\n/g, "\n");
}

const GENERAL = "Amelie"; // voix générale (identité stable d'une voix système)
const NOVA = "Nova"; // personnage actif
const TOM = "local:piper:fr_FR-tom-medium"; // voix locale (hors ligne)

// ── 1. La décision : une seule règle, un seul endroit ──────────────────────

describe("décision — quelle voix pour cette lecture", () => {
  it("aucun personnage actif : la voix générale, exactement comme avant", () => {
    expect(voiceForCharacter("", GENERAL, { [NOVA]: TOM })).toBe(GENERAL);
    expect(voiceForCharacter(null, GENERAL, { [NOVA]: TOM })).toBe(GENERAL);
    expect(voiceForCharacter("   ", GENERAL, { [NOVA]: TOM })).toBe(GENERAL);
    // Voix générale vide = automatique : rien n'est inventé.
    expect(voiceForCharacter("", "", {})).toBe("");
  });

  it("personnage actif sans voix attribuée : repli SILENCIEUX sur la voix générale", () => {
    expect(voiceForCharacter(NOVA, GENERAL, {})).toBe(GENERAL);
    expect(voiceForCharacter(NOVA, GENERAL, { [NOVA]: "" })).toBe(GENERAL);
    expect(voiceForCharacter(NOVA, GENERAL, null)).toBe(GENERAL);
    // Entrée d'un AUTRE personnage : elle ne sert pas à celui-ci.
    expect(voiceForCharacter(NOVA, GENERAL, { Lena: TOM })).toBe(GENERAL);
  });

  it("personnage actif avec une voix utilisable : c'est SA voix", () => {
    expect(voiceForCharacter(NOVA, GENERAL, { [NOVA]: TOM })).toBe(TOM);
    expect(voiceForCharacter(NOVA, GENERAL, { [NOVA]: "local:voicestudio:moi" })).toBe(
      "local:voicestudio:moi",
    );
  });

  it("la casse du nom ne fait pas perdre la voix choisie", () => {
    expect(voiceForCharacter("nova", GENERAL, { [NOVA]: TOM })).toBe(TOM);
    expect(voiceForCharacter("NOVA", GENERAL, { [NOVA]: TOM })).toBe(TOM);
  });

  it("voix attribuée INUTILISABLE (valeur vide, locale inconnue) : voix générale", () => {
    expect(isUsableVoiceValue("")).toBe(false);
    expect(isUsableVoiceValue("   ")).toBe(false);
    expect(isUsableVoiceValue("local:autre-moteur")).toBe(false);
    expect(isUsableVoiceValue(TOM)).toBe(true);
    expect(isUsableVoiceValue("local:piper")).toBe(true);
    expect(isUsableVoiceValue("local:voicestudio:moi")).toBe(true);
    expect(isUsableVoiceValue("Amelie")).toBe(true); // voix du système
    expect(voiceForCharacter(NOVA, GENERAL, { [NOVA]: "local:autre-moteur" })).toBe(GENERAL);
  });

  it("voix attribuée DISPARUE de l'ordinateur : voix générale, jamais un échec", () => {
    // L'appelant dit ce qui existe encore réellement sur cette machine.
    const gone = () => false;
    expect(voiceForCharacter(NOVA, GENERAL, { [NOVA]: TOM }, gone)).toBe(GENERAL);
    // Un contrôle d'existence qui échoue ne prive pas le personnage de sa voix :
    // les replis de la lecture restent là pour ça.
    const boom = () => {
      throw new Error("panne");
    };
    expect(voiceForCharacter(NOVA, GENERAL, { [NOVA]: TOM }, boom)).toBe(TOM);
  });

  it("changer de personnage change la voix, sans rien redémarrer", () => {
    const voices = { [NOVA]: TOM, Lena: "local:voicestudio:moi" };
    expect(voiceForCharacter(NOVA, GENERAL, voices)).toBe(TOM);
    expect(voiceForCharacter("Lena", GENERAL, voices)).toBe("local:voicestudio:moi");
    expect(voiceForCharacter("Ines", GENERAL, voices)).toBe(GENERAL);
  });

  it("une voix IMPOSÉE garde la main (écoute d'exemple des Paramètres)", () => {
    setPreferredVoiceName(GENERAL);
    setCharacterVoices({ [NOVA]: TOM });
    expect(resolveReadingVoice({ voiceName: "Alex" })).toBe("Alex");
  });

  it("sans personnage actif, le module de lecture ne change PAS de voix", () => {
    setPreferredVoiceName(GENERAL);
    setCharacterVoices({ [NOVA]: TOM });
    // Aucun personnage n'est actif dans ce processus : le réglage général seul
    // décide (le tableau des voix de personnages reste sans effet).
    expect(resolveReadingVoice()).toBe(GENERAL);
    expect(resolveReadingVoice({ character: "" })).toBe(GENERAL);
    expect(resolveReadingVoice({ character: NOVA, characterVoices: { [NOVA]: TOM } })).toBe(TOM);
    setCharacterVoices({});
  });
});

// ── 2. L'écran : la ligne n'existe pas sans personnage actif ───────────────

describe("écran — la ligne « voix du personnage » n'apparaît que si un personnage est actif", () => {
  const BASE = [
    { value: "", label: "Automatique (voix de la langue de l'interface)" },
    { value: "local:piper", label: "Français — femme" },
    { value: GENERAL, label: "Amelie (fr-FR)" },
  ];

  it("aucun personnage actif : aucune ligne, aucune option, aucun message", () => {
    for (const absent of ["", null, undefined, "   ", "\n\t"]) {
      const row = characterVoiceRow(absent, { [NOVA]: TOM }, BASE);
      expect(row.visible).toBe(false);
      expect(row.label).toBe("");
      expect(row.value).toBe("");
      expect(row.options).toEqual([]);
    }
  });

  it("personnage actif : la ligne porte SON nom et propose la voix générale par défaut", () => {
    const row = characterVoiceRow(NOVA, { [NOVA]: TOM }, BASE);
    expect(row.visible).toBe(true);
    expect(row.label).toContain(NOVA);
    expect(row.value).toBe(TOM);
    // Le premier choix ne peut pas être « automatique » : pour un personnage, ne
    // rien choisir veut dire « comme la voix de lecture ci-dessus ».
    expect(row.options[0]).toEqual({ value: "", label: CHARACTER_VOICE_INHERIT_LABEL });
    expect(row.options.length).toBe(BASE.length); // la même liste, sans doublon
    expect(row.options.slice(1).map((o) => o.value)).toEqual(["local:piper", GENERAL]);
  });

  it("le catalogue est celui du réglage général : aucune voix inventée", () => {
    expect(characterVoiceOptions(BASE)).toEqual([
      { value: "", label: CHARACTER_VOICE_INHERIT_LABEL },
      { value: "local:piper", label: "Français — femme" },
      { value: GENERAL, label: "Amelie (fr-FR)" },
    ]);
    // Un sélecteur absent ou vide ne fait pas planter l'écran.
    expect(characterVoiceOptions(null)).toEqual([
      { value: "", label: CHARACTER_VOICE_INHERIT_LABEL },
    ]);
    expect(
      characterVoiceOptions([{ value: "local:piper", label: "Femme" }, { value: "local:piper", label: "Femme" }]),
    ).toEqual([
      { value: "", label: CHARACTER_VOICE_INHERIT_LABEL },
      { value: "local:piper", label: "Femme" },
      { value: "local:piper", label: "Femme" },
    ]);
  });

  it("le libellé de repli écrit dans index.html est IDENTIQUE à celui du module", () => {
    const html = read("index.html");
    expect(html).toContain(`<option value="">${CHARACTER_VOICE_INHERIT_LABEL}</option>`);
  });

  it("index.html : une seule ligne de personnage, dans la section de lecture, masquée par défaut", () => {
    const html = read("index.html");
    // Un seul endroit, jamais dupliqué ailleurs dans l'interface.
    expect(html.split('id="setting-read-aloud-character-voice"').length - 1).toBe(1);
    expect(html.split('id="read-aloud-character-row"').length - 1).toBe(1);
    // Dans la section « Lecture des réponses » (onglet Assistant), et pas
    // ailleurs : découpage VÉRIFIÉ (une ancre absente échoue au lieu de rendre
    // une assertion vraie par construction).
    const section = sliceSource(
      html,
      'id="settings-section-read-aloud"',
      'id="settings-section-vocal-delay"',
    );
    expect(section).toContain('id="read-aloud-character-row"');
    const ligne = sliceSource(section, 'id="read-aloud-character-row"', ">");
    // Masquée à l'affichage initial : aucun clignotement de ligne vide, et rien
    // n'est visible si aucun personnage n'est actif (settings.js la révèle).
    expect(ligne).toContain("display:none");
    // Le champ est libellé et décrit (aucune ligne muette).
    expect(html).toContain('for="setting-read-aloud-character-voice"');
    expect(html).toContain('aria-describedby="read-aloud-character-note"');
    expect(html).toContain('id="read-aloud-character-note"');
  });
});

// ── 3. Mémorisation : une entrée par personnage, jamais une valeur vide ────

describe("mémorisation — une entrée par personnage", () => {
  it("attribuer, remplacer, retirer", () => {
    let map = withCharacterVoice({}, NOVA, TOM);
    expect(map).toEqual({ [NOVA]: TOM });
    map = withCharacterVoice(map, "Lena", "local:voicestudio:moi");
    expect(map).toEqual({ [NOVA]: TOM, Lena: "local:voicestudio:moi" });
    // Remplacer ne duplique pas le personnage.
    map = withCharacterVoice(map, NOVA, "local:piper");
    expect(map).toEqual({ [NOVA]: "local:piper", Lena: "local:voicestudio:moi" });
    // Retirer = revenir à la voix générale : AUCUNE entrée vide conservée.
    map = withCharacterVoice(map, NOVA, "");
    expect(map).toEqual({ Lena: "local:voicestudio:moi" });
    // Une voix inutilisable retire aussi l'entrée (jamais une valeur morte).
    expect(withCharacterVoice({ [NOVA]: TOM }, NOVA, "local:autre-moteur")).toEqual({});
  });

  it("l'objet reçu n'est pas modifié (aucun effet de bord)", () => {
    const before = { [NOVA]: TOM };
    const after = withCharacterVoice(before, NOVA, "local:piper");
    expect(before).toEqual({ [NOVA]: TOM });
    expect(after).toEqual({ [NOVA]: "local:piper" });
  });

  it("une seule entrée par personnage, même si la casse a changé", () => {
    const map = withCharacterVoice({ nova: TOM }, "Nova", "local:piper");
    expect(Object.keys(map)).toEqual(["Nova"]);
  });

  it("une configuration abîmée est nettoyée, jamais une exception", () => {
    expect(normalizeCharacterVoices(null)).toEqual({});
    expect(normalizeCharacterVoices("n'importe quoi")).toEqual({});
    expect(normalizeCharacterVoices([NOVA])).toEqual({});
    expect(normalizeCharacterVoices({ "": TOM, "   ": TOM })).toEqual({});
    expect(normalizeCharacterVoices({ [NOVA]: "", Lena: "local:autre-moteur" })).toEqual({});
    expect(normalizeCharacterVoices({ [NOVA]: TOM })).toEqual({ [NOVA]: TOM });
  });

  it("nom de personnage borné et sur une ligne", () => {
    expect(normalizeCharacterName("  Nova  ")).toBe("Nova");
    expect(normalizeCharacterName("No\nva")).toBe("No va");
    expect(normalizeCharacterName(null)).toBe("");
    expect(normalizeCharacterName("x".repeat(200)).length).toBe(CHARACTER_NAME_MAX);
    expect(storedVoiceForCharacter({ [NOVA]: TOM }, "  nova ")).toBe(TOM);
    expect(storedVoiceForCharacter({ [NOVA]: TOM }, "")).toBe("");
  });
});

// ── 4. Configuration : additive et rétrocompatible ────────────────────────

describe("configuration — additive, un ancien fichier reste valide", () => {
  it("un ancien fichier (champ absent) ne change rien", () => {
    setPreferredVoiceName("Amelie");
    setCharacterVoices({ [NOVA]: TOM });
    applyVoicePreferenceFromConfig({ theme: "dark" });
    applyVoicePreferenceFromConfig(null);
    applyVoicePreferenceFromConfig(undefined);
    expect(getPreferredVoiceName()).toBe("Amelie");
    expect(getCharacterVoices()).toEqual({ [NOVA]: TOM });
    setCharacterVoices({});
  });

  it("les deux réglages sont appliqués au même endroit, et indépendamment", () => {
    setPreferredVoiceName("");
    setCharacterVoices({});
    applyVoicePreferenceFromConfig({ [CHARACTER_VOICES_KEY]: { [NOVA]: TOM } });
    expect(getCharacterVoices()).toEqual({ [NOVA]: TOM });
    // Le champ général peut manquer sans effacer les voix des personnages.
    expect(getPreferredVoiceName()).toBe("");
    applyVoicePreferenceFromConfig({ read_aloud_voice: GENERAL });
    expect(getPreferredVoiceName()).toBe(GENERAL);
    expect(getCharacterVoices()).toEqual({ [NOVA]: TOM });
    // Champ présent mais vide (aucune voix propre) : l'état devient vide.
    applyVoicePreferenceFromConfig({ [CHARACTER_VOICES_KEY]: {} });
    expect(getCharacterVoices()).toEqual({});
  });

  it("l'état interne n'est pas exposé modifiable", () => {
    setCharacterVoices({ [NOVA]: TOM });
    const copy = getCharacterVoices();
    copy[NOVA] = "local:piper";
    expect(getCharacterVoices()).toEqual({ [NOVA]: TOM });
    setCharacterVoices({});
  });
});

// ── 5. Branchement : la règle n'est écrite qu'une fois ────────────────────

describe("branchement — une seule décision, un seul point d'application", () => {
  it("la décision ne vit QUE dans character-voices.js", () => {
    const module = read("src/js/character-voices.js");
    expect(module).toMatch(/export function voiceForCharacter\(/);
    // Ce module ne lit RIEN : aucune synthèse, aucun son, aucun disque, aucun
    // appel au service des personnages — il rend seulement une valeur.
    expect(module).not.toContain("SpeechSynthesisUtterance");
    expect(module).not.toContain("speechSynthesis");
    expect(module).not.toContain("speak(");
    expect(module).not.toContain("Audio(");
    expect(module).not.toContain("invoke(");
    expect(module).not.toContain("getPreferredVoiceName"); // le réglage général n'est pas relu ici
    // Aucune seconde liste de voix : le catalogue vient du sélecteur général.
    expect(module).not.toContain("localVoiceChoices(");
    expect(module).not.toContain("voiceStudioChoices(");
  });

  it("read-aloud.js applique la règle à UN SEUL endroit : le choix de la voix lue", () => {
    const source = read("src/js/read-aloud.js");
    expect(source).toMatch(/from "\.\/character-voices\.js"/);
    expect(source.split("export function resolveReadingVoice(").length - 1).toBe(1);
    // Le point d'application, dans `speak` : la voix n'est plus lue en direct.
    expect(source).toContain("let choice = resolveReadingVoice(options);");
    expect(source).not.toMatch(/getPreferredVoiceName\(\)\s*:\s*options\.voiceName/);
    // Le module lit le personnage ACTIF tel qu'il est déposé, jamais deviné.
    expect(source).toMatch(/import \{ getAssistantPersonaName \} from "\.\/assistant-persona\.js"/);
    // Une seule voix retenue par lecture : aucun second choix plus loin.
    expect(source.split("resolveReadingVoice(").length - 1).toBe(4);
  });

  it("aucun second mécanisme de lecture n'a été ajouté", () => {
    const source = read("src/js/read-aloud.js");
    expect(source.split("new Utterance(").length - 1).toBe(1);
    expect(source.split("synth.speak(").length - 1).toBe(1);
    expect(source.split("splitSentences(textForSpeech(").length - 1).toBe(1);
  });

  it("les Paramètres n'ajoutent AUCUN second catalogue ni aucune lecture", () => {
    const settings = read("src/js/settings.js");
    expect(settings).toMatch(/from "\.\/character-voices\.js"/);
    expect(settings.split("characterVoiceRow(").length - 1).toBe(1);
    // Le catalogue est celui du sélecteur général : settings ne le reconstruit pas.
    expect(settings).not.toContain("characterVoiceOptions(");
    expect(settings).not.toContain("localVoiceChoices(");
    // Toujours aucune lecture directe depuis les Paramètres.
    expect(settings).not.toContain(".speak(");
    expect(settings).not.toContain("SpeechSynthesisUtterance");
    // Enregistrement : la clé est écrite à côté du réglage général.
    // La clé écrite vient de la source unique (aucune valeur recopiée).
    expect(settings).toMatch(/^\s*\[CHARACTER_VOICES_KEY\]: \{ \.\.\.characterVoicesDraft \},/m);
    expect(settings).toMatch(/^\s*read_aloud_voice:/m);
  });

  it("sans personnage actif, la ligne est MASQUÉE par le code (pas par le CSS seul)", () => {
    const settings = read("src/js/settings.js");
    expect(settings).toMatch(/if \(!row\.visible\) \{\s*\n\s*readAloudCharacterRow\.style\.display = "none";/);
    expect(settings).toMatch(/readAloudCharacterRow\.style\.display = "";/);
  });

  it("le personnage actif est lu à CHAQUE lecture (changement sans redémarrage)", () => {
    const source = read("src/js/read-aloud.js");
    // La lecture du nom n'est pas figée dans une variable de module au démarrage.
    expect(source).toMatch(/opts\.character === undefined \? getAssistantPersonaName\(\) : opts\.character/);
  });
});
