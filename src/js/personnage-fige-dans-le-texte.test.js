// personnage-fige-dans-le-texte.test.js
//
// VERROU DE LA TÂCHE 416 — « le texte d'instructions en vigueur fige encore un
// personnage ».
//
// Le correctif précédent empêchait un personnage de se figer dans les textes
// LIVRÉS avec Pilot. Il ne pouvait rien contre le texte DURABLE déjà réglé par
// le propriétaire (`super_agent_prompt`) : celui du poste nommait « Sylvie »
// alors qu'aucun personnage n'était actif, imposait « au FÉMININ », une « voix
// féminine » et un « Ton chaleureux », et RIEN ne le signalait.
//
// Ce verrou ÉCHOUE si l'une de ces régressions revient :
//   1. un prénom écrit en dur n'est plus détecté (le défaut redeviendrait
//      invisible) ;
//   2. un genre, une voix ou un ton imposés ne sont plus détectés ;
//   3. le nettoyage perd une règle de travail quelconque (« on ne perd aucune
//      autre consigne ») ;
//   4. le nettoyage retouche la typographie française du reste du texte (espace
//      avant « : », « ; », « ») ou réécrit un texte déjà sain ;
//   5. la seule référence au nom cesse d'être `{nom}` (un nom écrit en dur ne
//      suivrait pas le personnage) ;
//   6. le signalement n'est plus affiché là où le prompt se règle, ou le geste
//      de nettoyage disparaît ;
//   7. le nettoyage devient AUTOMATIQUE (appelé ailleurs que dans le gestionnaire
//      du bouton, donc sans le geste de l'utilisateur) ;
//   8. un terme produit entre guillemets (« Pilot », « Présences »…) est signalé
//      à tort, ce qui décrédibiliserait l'avertissement.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  FROZEN_PERSONA_KINDS,
  QUOTED_WORD_NEVER_A_NAME,
  cleanFrozenPersonaText,
  findFrozenPersonaSigns,
  frozenPersonaCleanSummary,
  frozenPersonaNotice,
  textFreezesAPersona,
} from "./personnage-fige-dans-le-texte.js";
import { INSTRUCTION_NAME_PLACEHOLDER } from "./assistant-instructions.js";
// Découpage de source VÉRIFIÉ : une ancre qui bouge ÉCHOUE au lieu de rendre un
// fragment vide (qui rendrait une assertion négative vraie par construction).
import { sliceSource } from "./source-slice.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) => readFileSync(resolve(ICI, rel), "utf8").replace(/\r\n/g, "\n");

const SETTINGS_JS = lire("./settings.js");
const INDEX_HTML = lire("../../index.html");

/** Le texte RÉEL du défaut, tel qu'il était en vigueur sur le poste (extrait). */
const TEXTE_FIGE = [
  "Nova, assistante de suivi multi-projets de Pilot (nom choisi par le propriétaire le 2026-10-28 ; voix féminine). LECTURE SEULE STRICTE sur les fichiers des projets : seuls ~/.pilot/assistant et mes tables de suivi m'appartiennent.",
  "",
  "=== SILENCE ET APPEL PAR LE PRÉNOM (2026-10-30) ===",
  "Je ne réponds PAS aux paroles qui ne me sont pas adressées.",
  "Je reprends la parole UNIQUEMENT dans trois cas : 1) il m'appelle par mon prénom (« Sylvie ») ; 2) tout est TERMINÉ ; 3) j'ai BESOIN de lui.",
  "",
  "=== STYLE ET VOIX (2026-10-28) ===",
  "J'écris et je parle au FÉMININ. Ton chaleureux, posé, sûr de moi — jamais sèche, jamais mécanique. Je tutoie toujours. Concise et décidée : la chaleur ne remplace jamais la clarté. Français simple, phrases courtes, non technique, orienté décision.",
  "RELATION PERSONNELLE (demande du propriétaire, 2026-10-29) : il veut une vraie présence, pas une voix neutre d'outil. Je réponds de façon personnellement engagée, avec mes mots.",
  "CADRE QUI NE BOUGE PAS : ni flirt, ni infantisation, ni cajolerie. Une demande personnelle ne change JAMAIS une règle.",
  "",
  "=== LOIS DE TRAVAIL ===",
  "LIVRAISON : livrable vérifié + tests verts + doc à jour, sinon je dis ce qui manque.",
].join("\n");

const kinds = (text) => findFrozenPersonaSigns(text).map((s) => s.kind);

describe("voir — les passages qui figent un personnage sont détectés", () => {
  it("détecte un prénom de personnage écrit en dur", () => {
    expect(kinds("Il m'appelle par mon prénom (« Sylvie ») et rien d'autre.")).toContain(
      FROZEN_PERSONA_KINDS.NAME
    );
  });

  it("détecte un prénom en tête de texte", () => {
    expect(kinds(`Sylvie, assistante de suivi. Je réponds vite.`)).toContain(
      FROZEN_PERSONA_KINDS.NAME
    );
  });

  it("détecte un genre imposé", () => {
    expect(kinds("J'écris et je parle au FÉMININ.")).toContain(FROZEN_PERSONA_KINDS.GENDER);
    expect(kinds("Je m'exprime au masculin, toujours.")).toContain(FROZEN_PERSONA_KINDS.GENDER);
  });

  it("détecte une voix imposée", () => {
    expect(kinds("Ma voix est féminine.")).toContain(FROZEN_PERSONA_KINDS.VOICE);
    expect(kinds("il veut une vraie présence, pas une voix neutre d'outil.")).toContain(
      FROZEN_PERSONA_KINDS.VOICE
    );
  });

  it("détecte un ton de personnage imposé", () => {
    expect(kinds("Ton chaleureux, posé, sûr de moi.")).toContain(FROZEN_PERSONA_KINDS.TONE);
  });

  it("ne signale RIEN dans un texte sain", () => {
    const sain = [
      "{nom}, assistante de suivi multi-projets de Pilot. LECTURE SEULE STRICTE sur les fichiers des projets : seuls ~/.pilot/assistant m'appartient.",
      "Je reprends la parole UNIQUEMENT dans trois cas : 1) il m'appelle par mon prénom ; 2) tout est TERMINÉ ; 3) j'ai BESOIN de lui.",
      "Quand un personnage est actif, JE SUIS ce personnage : je parle avec son nom, son ton, ses manières.",
    ].join("\n");
    expect(findFrozenPersonaSigns(sain)).toEqual([]);
    expect(textFreezesAPersona(sain)).toBe(false);
  });

  it("ne signale pas un mot produit entre guillemets (aucun faux signalement)", () => {
    const texte =
      "Je ne crée JAMAIS un agent pour « faire comme si » : « Présences » n'est pas branché, " +
      "et « Pilot » ne le fait pas non plus. Le jeton « {nom} » suit le personnage actif.";
    expect(findFrozenPersonaSigns(texte)).toEqual([]);
    // Un texte qui commence par le nom d'un PRODUIT n'est pas un prénom figé.
    expect(findFrozenPersonaSigns("Pilot, l'éditeur que j'habite. Je réponds vite.")).toEqual([]);
    // La liste des mots jamais pris pour un prénom est bien celle qui sert.
    expect(QUOTED_WORD_NEVER_A_NAME).toContain("pilot");
    expect(QUOTED_WORD_NEVER_A_NAME).toContain("présences");
  });

  it("nomme chaque passage dans l'ordre du texte (famille + extrait)", () => {
    const signs = findFrozenPersonaSigns(TEXTE_FIGE);
    expect(signs.length).toBeGreaterThan(0);
    const families = signs.map((s) => s.kind);
    expect(families).toContain(FROZEN_PERSONA_KINDS.NAME);
    expect(families).toContain(FROZEN_PERSONA_KINDS.GENDER);
    expect(families).toContain(FROZEN_PERSONA_KINDS.VOICE);
    expect(families).toContain(FROZEN_PERSONA_KINDS.TONE);
    for (const sign of signs) expect(sign.sentence.trim()).not.toBe("");
  });
});

describe("réparer — le retrait est ciblé et ne perd aucune autre consigne", () => {
  const resultat = cleanFrozenPersonaText(TEXTE_FIGE);

  it("remplace le prénom en tête par la seule référence au nom", () => {
    expect(resultat.changed).toBe(true);
    expect(resultat.text.startsWith(`${INSTRUCTION_NAME_PLACEHOLDER}, assistante de suivi`)).toBe(
      true
    );
    expect(resultat.text).not.toContain("Nova");
    expect(resultat.text).not.toContain("Sylvie");
  });

  it("retire le genre, la voix et le ton imposés", () => {
    expect(resultat.text).not.toMatch(/F[ÉE]MININ/u);
    expect(resultat.text).not.toContain("voix féminine");
    expect(resultat.text).not.toContain("voix neutre");
    expect(resultat.text).not.toContain("Ton chaleureux");
    expect(findFrozenPersonaSigns(resultat.text)).toEqual([]);
  });

  it("CONSERVE toutes les autres consignes, au mot près", () => {
    for (const consigne of [
      "LECTURE SEULE STRICTE sur les fichiers des projets : seuls ~/.pilot/assistant et mes tables de suivi m'appartiennent.",
      "Je ne réponds PAS aux paroles qui ne me sont pas adressées.",
      "UNIQUEMENT dans trois cas : 1) il m'appelle par mon prénom ;",
      "Je tutoie toujours.",
      "Concise et décidée : la chaleur ne remplace jamais la clarté.",
      "Je réponds de façon personnellement engagée, avec mes mots.",
      "CADRE QUI NE BOUGE PAS : ni flirt, ni infantisation, ni cajolerie.",
      "LIVRAISON : livrable vérifié + tests verts + doc à jour, sinon je dis ce qui manque.",
      "=== SILENCE ET APPEL PAR LE PRÉNOM (2026-10-30) ===",
    ]) {
      expect(resultat.text).toContain(consigne);
    }
  });

  it("ne retouche PAS la typographie française du reste du texte", () => {
    // Espace avant « : », « ; » et « » : celle du propriétaire, intacte.
    expect(resultat.text).toContain("dans trois cas : 1)");
    expect(resultat.text).toContain("LIVRAISON : livrable");
    expect(resultat.text).not.toMatch(/cas: 1/u);
    expect(resultat.text).not.toMatch(/«Sylvie/u);
  });

  it("rend un texte déjà sain À L'IDENTIQUE (aucun reformatage silencieux)", () => {
    const sain = "Une consigne : celle-ci.   Et une autre ; celle-là.";
    const r = cleanFrozenPersonaText(sain);
    expect(r.text).toBe(sain);
    expect(r.changed).toBe(false);
    expect(r.removals).toEqual([]);
  });

  it("est idempotent (un second nettoyage ne change plus rien)", () => {
    const second = cleanFrozenPersonaText(resultat.text);
    expect(second.text).toBe(resultat.text);
    expect(second.changed).toBe(false);
  });

  it("rend un résumé du geste, et jamais un message quand rien n'a été retiré", () => {
    expect(frozenPersonaCleanSummary(resultat)).toMatch(/passages? retirés?/u);
    expect(frozenPersonaCleanSummary(cleanFrozenPersonaText("Rien à retirer ici."))).toBe(
      "Aucun passage à retirer dans ce texte."
    );
  });
});

describe("le signalement est lisible et réparable dans les Options", () => {
  it("dit en français simple ce qui fige un personnage et nomme le geste", () => {
    const notice = frozenPersonaNotice(findFrozenPersonaSigns(TEXTE_FIGE));
    expect(notice).toContain("fige un personnage");
    expect(notice).toContain("un prénom de personnage écrit en dur");
    expect(notice).toContain("Nettoyer ce texte");
    expect(notice).toContain(INSTRUCTION_NAME_PLACEHOLDER);
    expect(frozenPersonaNotice([])).toBe(null);
  });

  it("l'encart et son bouton existent là où le prompt se règle", () => {
    expect(INDEX_HTML).toContain('id="setting-superagent-prompt"');
    expect(INDEX_HTML).toContain('id="assistant-prompt-frozen"');
    expect(INDEX_HTML).toContain('id="btn-assistant-prompt-clean"');
    expect(INDEX_HTML).toContain("Nettoyer ce texte");
    // Le bouton est SOUS le champ du prompt (jamais dans un autre onglet).
    expect(INDEX_HTML.indexOf('id="assistant-prompt-frozen"')).toBeGreaterThan(
      INDEX_HTML.indexOf('id="setting-superagent-prompt"')
    );
  });

  it("le signalement suit ce que l'on tape, sans jamais toucher au texte", () => {
    expect(SETTINGS_JS).toContain("findFrozenPersonaSigns(taSuperAgentPrompt.value");
    expect(SETTINGS_JS).toContain(
      'taSuperAgentPrompt.addEventListener("input", refreshAssistantPromptFrozen)'
    );
  });

  it("le nettoyage n'est JAMAIS automatique : un seul appel, dans le clic", () => {
    // Le module est bien importé, et l'unique APPEL du nettoyage vit dans le clic :
    // aucun autre chemin ne peut retirer un passage sans le geste de l'utilisateur.
    expect(SETTINGS_JS).toContain("from \"./personnage-fige-dans-le-texte.js\"");
    expect(SETTINGS_JS.match(/cleanFrozenPersonaText\(/g)).toHaveLength(1);
    const corps = sliceSource(
      SETTINGS_JS,
      'btnAssistantPromptClean.addEventListener("click"',
      "cleanFrozenPersonaText(taSuperAgentPrompt.value"
    );
    // Le clic est bien celui du bouton de nettoyage, et rien ne s'intercale
    // entre le geste et l'appel.
    expect(corps.length).toBeLessThan(400);
  });
});
