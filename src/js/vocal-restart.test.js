// Tests — LE BOUTON DE RELANCE DE L'ECOUTE (« ok <personnage> »), decisions 401
// et 402 du suivi du proprietaire (RAPPORT-bouton-ok-nova.md).
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
//   4. L'ETIQUETTE porte le nom du PERSONNAGE ACTIF, borne pour tenir dans le
//      rond, et ce module n'invente ni ne retient aucun nom.
//   5. Le module est PUR : aucun DOM, aucun micro, aucune horloge, aucune
//      ecriture. Il ne peut donc pas doubler l'etat reel de la dictee.
//
// Les commentaires sont en ASCII ; les chaines qui viennent de l'interface
// (« ok », « Lancer l'écoute ») sont copiees telles quelles.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  vocalRestartVisible,
  vocalRestartLabel,
  VOCAL_RESTART_TITLE,
  VOCAL_RESTART_WORD,
  VOCAL_RESTART_NAME_MAX,
  VOCAL_RESTART_ETAT,
} from "./vocal-restart.js";

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
describe("2. l'etiquette dit le personnage ACTIF, sans en inventer aucun", () => {
  it("« ok » + le nom affiche", () => {
    expect(vocalRestartLabel("Nova")).toBe("ok Nova");
    expect(VOCAL_RESTART_WORD).toBe("ok");
  });

  it("sans nom, le bouton reste utilisable : « ok »", () => {
    expect(vocalRestartLabel("")).toBe("ok");
    expect(vocalRestartLabel("   ")).toBe("ok");
    expect(vocalRestartLabel(null)).toBe("ok");
    expect(vocalRestartLabel(undefined)).toBe("ok");
  });

  it("seul le PREMIER mot du nom est garde (un titre ne tiendrait pas)", () => {
    expect(vocalRestartLabel("Nova la gardienne")).toBe("ok Nova");
    expect(vocalRestartLabel("  Nova   la   gardienne  ")).toBe("ok Nova");
  });

  it("un nom trop long est abrege, jamais laisse deborder du rond", () => {
    const long = "Bartholomew";
    const etiquette = vocalRestartLabel(long);
    expect(etiquette.startsWith(`${VOCAL_RESTART_WORD} `)).toBe(true);
    const nom = etiquette.slice(VOCAL_RESTART_WORD.length + 1);
    expect(nom.length).toBeLessThanOrEqual(VOCAL_RESTART_NAME_MAX);
    expect(nom.endsWith("\u2026")).toBe(true);
    expect(nom).toBe("Bartholom\u2026");
  });

  it("un nom a la limite n'est PAS abrege", () => {
    const juste = "A".repeat(VOCAL_RESTART_NAME_MAX);
    expect(vocalRestartLabel(juste)).toBe(`${VOCAL_RESTART_WORD} ${juste}`);
  });

  it("le libelle d'action est dit en clair (infobulle + nom accessible)", () => {
    expect(VOCAL_RESTART_TITLE).toBe("Lancer l'\u00e9coute");
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
  });

  it("aucune animation, aucune duree : le mouvement reduit est respecte d'avance", () => {
    expect(CODE).not.toMatch(/animation|transition|duration/);
    // Le module ne produit AUCUNE valeur temporelle.
    expect(CODE).not.toMatch(/\d+\s*ms|\d\s*\/\s*60/);
  });
});
