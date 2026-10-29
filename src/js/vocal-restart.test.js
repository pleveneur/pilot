// Tests — LE BOUTON DE RELANCE DE L'ECOUTE (« Réveiller <Nom> »), decisions 401
// et 402 du suivi du proprietaire (RAPPORT-bouton-ok-nova.md), retouchees le
// 2026-10-29 (RAPPORT-bouton-reveiller.md).
//
// CE QUE CE FICHIER VERROUILLE (et pourquoi) :
//   1. La VISIBILITE est une DECISION PURE et elle ne se trompe pas de sens :
//      visible quand la dictee ne tourne pas, DISPARUE pendant l'ecoute,
//      revenue des que le micro est coupe — c'est la fiche, mot pour mot.
//   2. Elle ne clignote pas : aucun bouton pendant les 350 ms qui separent la
//      fin d'une session de son rearment automatique (`armementProgramme`), et
//      aucun bouton pendant que Pilot parle ou travaille (la dictee y est fermee
//      par construction).
//   3. Elle n'est jamais un bouton mort : sans transcription disponible, rien.
//   4. L'ETIQUETTE est « Réveiller <Nom> », avec le nom du PERSONNAGE ACTIF,
//      un repli sur le nom HABITUEL de Pilot quand il n'y en a pas, et une
//      troncature propre quand le nom est tres long (le nom entier restant dans
//      l'infobulle et le nom accessible) ; ce module n'invente ni ne retient
//      aucun nom a lui.
//   5. Le module est PUR : aucun DOM, aucun micro, aucune horloge, aucune
//      ecriture. Il ne peut donc pas doubler l'etat reel de la dictee.
//
// Les commentaires sont en ASCII ; les chaines qui viennent de l'interface
// (« Réveiller », « Assistant ») sont copiees telles quelles.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  vocalRestartVisible,
  vocalRestartName,
  vocalRestartLabel,
  vocalRestartText,
  VOCAL_RESTART_VERB,
  VOCAL_RESTART_LABEL_MAX,
  VOCAL_RESTART_ETAT,
} from "./vocal-restart.js";
// Le nom HABITUEL vient de `assistant-persona.js` : c'est la MEME constante que
// l'onglet 🧭. L'importer ici prouve qu'il n'y a pas de second nom par defaut.
import { DEFAULT_ASSISTANT_NAME } from "./assistant-persona.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) => readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const MODULE = lire("src/js/vocal-restart.js");
/** Le CODE seul, commentaires retires : les commentaires parlent des interdits
 *  (ils les expliquent), et c'est le code qui doit les tenir. */
const CODE = MODULE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** Etat de reference : l'ecran au repos, tout pret a ecouter. */
const REPOS = {
  transcription: true,
  dicteeOuverte: false,
  armementProgramme: false,
  etat: "idle",
};

// ---------------------------------------------------------------------------
describe("1. la visibilite suit l'etat REEL de la dictee", () => {
  it("au repos, la dictee fermee : le bouton SE VOIT", () => {
    expect(vocalRestartVisible(REPOS)).toBe(true);
    // Le nom de l'etat de reference est celui que `vocalScreenState` produit :
    // une faute de frappe ici ne pourrait pas passer inapercue.
    expect(VOCAL_RESTART_ETAT).toBe("idle");
  });

  it("pendant l'ecoute, il DISPARAIT — c'est la regle du proprietaire", () => {
    expect(vocalRestartVisible({ ...REPOS, dicteeOuverte: true })).toBe(false);
  });

  it("des que le micro est coupe, il REVIENT", () => {
    // Fin de session : la dictee est refermee (aucune erreur, aucun verrou) et
    // aucun armement n'est encore programme.
    expect(vocalRestartVisible({ ...REPOS, dicteeOuverte: false })).toBe(true);
  });

  it("il ne s'allume pas pour un demi-clignement de 350 ms", () => {
    // `vocalSyncConversation` vient de programmer le rearment automatique : le
    // bouton doit rester absent, sinon il apparaitrait entre chaque silence.
    expect(vocalRestartVisible({ ...REPOS, armementProgramme: true })).toBe(false);
  });

  it("il reste absent pendant que Pilot PARLE et pendant qu'il TRAVAILLE", () => {
    // Dans ces deux etats la dictee est fermee par construction (desarmement
    // voulu, regles 3 et 4 de `decideVocalDictation`) : un bouton y promettrait
    // une reprise que l'ecran refuserait aussitot — et il se poserait sur le
    // halo, qui ne s'allume qu'en ecoute.
    for (const etat of ["speaking", "thinking"]) {
      expect(vocalRestartVisible({ ...REPOS, etat }), etat).toBe(false);
    }
  });

  it("sans transcription disponible, ce n'est pas un bouton mort : rien", () => {
    // L'ecran dit deja « dictee indisponible sur ce poste » : un bouton qui ne
    // peut rien ouvrir serait un mensonge.
    expect(vocalRestartVisible({ ...REPOS, transcription: false })).toBe(false);
    expect(vocalRestartVisible({ ...REPOS, transcription: undefined })).toBe(false);
    // Ce n'est pas la seule garde : une transcription absente ne suffit pas a
    // montrer le bouton non plus.
    expect(
      vocalRestartVisible({ ...REPOS, transcription: true, etat: "listening" }),
    ).toBe(false);
  });

  it("aucun etat fourni : aucune exception, et rien d'invente", () => {
    expect(vocalRestartVisible()).toBe(false);
    expect(vocalRestartVisible(null)).toBe(false);
    expect(vocalRestartVisible(undefined)).toBe(false);
    expect(vocalRestartVisible({})).toBe(false);
    // Un etat inconnu (faute de frappe, valeur future) ne montre rien : le
    // bouton est une exception au repos, pas un affichage par defaut.
    expect(vocalRestartVisible({ ...REPOS, etat: "idle " })).toBe(false);
    expect(vocalRestartVisible({ ...REPOS, etat: "IDLE" })).toBe(false);
  });

  it("aucun etat incoherent : les trois verrous sont independants", () => {
    // Chaque garde suffit a elle seule, quel que soit l'ordre des autres.
    const cas = [
      { transcription: false, dicteeOuverte: false, armementProgramme: false, etat: "idle" },
      { transcription: true, dicteeOuverte: true, armementProgramme: true, etat: "idle" },
      { transcription: true, dicteeOuverte: false, armementProgramme: true, etat: "idle" },
      { transcription: true, dicteeOuverte: false, armementProgramme: false, etat: "speaking" },
    ];
    for (const etats of cas) {
      expect(vocalRestartVisible(etats), JSON.stringify(etats)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
describe("2. l'etiquette dit « Réveiller <Nom> », sans inventer aucun nom", () => {
  it("« Réveiller » + le nom affiche, au mot pres", () => {
    expect(vocalRestartLabel("Nova")).toBe("Réveiller Nova");
    expect(VOCAL_RESTART_VERB).toBe("R\u00e9veiller");
    // Tant que le nom tient dans le cercle, le texte AFFICHE est le libelle
    // complet : aucune difference entre ce qu'on lit et ce qu'on annonce.
    expect(vocalRestartText("Nova")).toBe("R\u00e9veiller Nova");
    // Le nom d'un personnage a droit a ses espaces (il ne s'arrete plus au
    // premier mot : « Réveiller Nova la gardienne » est un libelle valide).
    expect(vocalRestartLabel("Nova la gardienne")).toBe("R\u00e9veiller Nova la gardienne");
    expect(vocalRestartLabel("  Nova   la   gardienne  ")).toBe(
      "R\u00e9veiller Nova la gardienne",
    );
  });

  it("sans personnage actif : le nom HABITUEL de Pilot, jamais un trou", () => {
    // Le repli n'est pas une chaine recopiee ici : c'est `DEFAULT_ASSISTANT_NAME`.
    const attendu = `R\u00e9veiller ${DEFAULT_ASSISTANT_NAME}`;
    for (const brut of ["", "   ", "\n\t ", null, undefined]) {
      expect(vocalRestartLabel(brut), JSON.stringify(brut)).toBe(attendu);
      expect(vocalRestartText(brut), JSON.stringify(brut)).toBe(attendu);
      expect(vocalRestartName(brut), JSON.stringify(brut)).toBe(DEFAULT_ASSISTANT_NAME);
    }
    // Et jamais « undefined », jamais un double espace, jamais d'espace aux bords.
    for (const brut of ["", "  ", null, undefined, " Nova "]) {
      const texte = vocalRestartLabel(brut);
      expect(texte).not.toMatch(/\s{2,}/);
      expect(texte.trim()).toBe(texte);
      expect(texte).not.toBe("R\u00e9veiller undefined");
      expect(texte).not.toBe("R\u00e9veiller null");
      expect(texte.startsWith("R\u00e9veiller ")).toBe(true);
    }
  });

  it("un nom TRES long (60 car.) ne casse rien : texte abrege, nom entier garde", () => {
    const long = "Bartholomew-Casimir de la Tour d'Auvergne Quinzieme du Nom";
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.length).toBeGreaterThan(VOCAL_RESTART_LABEL_MAX);
    const texte = vocalRestartText(long);
    // 1. le texte affiche tient dans la borne (comptee en caracteres)
    expect(Array.from(texte).length).toBeLessThanOrEqual(VOCAL_RESTART_LABEL_MAX);
    // 2. il est signale comme abrege
    expect(texte.endsWith("\u2026")).toBe(true);
    // 3. le verbe est intact et il reste de la place pour le nom
    expect(texte.startsWith(`R\u00e9veiller `)).toBe(true);
    expect(texte).not.toBe(`R\u00e9veiller\u2026`);
    // 4. le nom ENTIER est dans le libelle complet : rien n'est perdu, c'est lui
    //    que portent l'infobulle et le nom accessible.
    expect(vocalRestartLabel(long)).toBe(`R\u00e9veiller ${long}`);
  });

  it("la coupe tombe sur une fin de MOT, jamais au milieu d'un mot", () => {
    const long = "Nova la gardienne des claviers anciens et des nuits blanches";
    const complet = vocalRestartLabel(long);
    const texte = vocalRestartText(long);
    const avant = texte.slice(0, -1); // sans le « … »
    expect(texte.endsWith("\u2026")).toBe(true);
    // Ce qui reste est un PREFIXE du libelle complet…
    expect(complet.startsWith(avant)).toBe(true);
    // …et la coupe tombe juste devant un espace : le mot est entier.
    expect(complet[avant.length]).toBe(" ");
    // Aucun espace avant le « … » (il a ete retire, pas laisse trainer).
    expect(texte).not.toMatch(/\s\u2026$/);
  });

  it("un texte a la LIMITE n'est pas abrege", () => {
    const nom = "A".repeat(VOCAL_RESTART_LABEL_MAX - VOCAL_RESTART_VERB.length - 1);
    const complet = vocalRestartLabel(nom);
    expect(Array.from(complet).length).toBe(VOCAL_RESTART_LABEL_MAX);
    expect(vocalRestartText(nom)).toBe(complet);
    // Un caractere de plus : la coupe s'active.
    expect(vocalRestartText(`${nom}A`).endsWith("\u2026")).toBe(true);
  });

  it("la coupe compte des CARACTERES : un nom avec emoji n'est jamais coupe en deux", () => {
    const emoji = "Nova \u{1F31F}\u{1F680}\u{1F319}\u{1F3A7}\u{1F3A4}\u{1F525}\u{1F4AB}\u{1F6F8}\u{1F308}\u{1F30D}";
    const texte = vocalRestartText(emoji);
    // Aucune demi-paire de substitution laissee seule : le texte reste lisible.
    expect(texte).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(texte).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    expect(Array.from(texte).length).toBeLessThanOrEqual(VOCAL_RESTART_LABEL_MAX);
  });
});

// ---------------------------------------------------------------------------
describe("3. le module est PUR : il ne touche ni au DOM, ni au micro, ni a la dictee", () => {
  it("aucune API micro, aucun niveau, aucun minuteur", () => {
    expect(CODE).not.toMatch(/getUserMedia|AudioContext|mediaDevices/);
    expect(CODE).not.toMatch(/vocalMic|startVoiceInput|stopVoiceInput|toggleVoiceInput/);
    expect(CODE).not.toMatch(/--vocal-|setTimeout|setInterval|requestAnimationFrame/);
  });

  it("aucun acces au DOM ni au stockage : seulement des decisions", () => {
    expect(CODE).not.toMatch(/document\.|window\.|localStorage|sessionStorage|invoke\(/);
    expect(CODE).not.toMatch(/new Date|Date\.now/);
  });

  it("aucun etat garde entre deux appels (meme entree, meme sortie)", () => {
    const premier = vocalRestartVisible(REPOS);
    vocalRestartVisible({ ...REPOS, etat: "speaking" });
    expect(vocalRestartVisible(REPOS)).toBe(premier);
    expect(vocalRestartLabel("Nova")).toBe(vocalRestartLabel("Nova"));
    // Changer de nom ne laisse AUCUNE trace : le module ne retient rien.
    expect(vocalRestartLabel("Autre")).toBe("R\u00e9veiller Autre");
    expect(vocalRestartText("Nova")).toBe("R\u00e9veiller Nova");
  });

  it("aucune animation, aucune duree : le mouvement reduit est respecte d'avance", () => {
    expect(CODE).not.toMatch(/animation|transition|duration/);
    // Le module ne produit AUCUNE valeur temporelle.
    expect(CODE).not.toMatch(/\d+\s*ms|\d\s*\/\s*60/);
  });
});
