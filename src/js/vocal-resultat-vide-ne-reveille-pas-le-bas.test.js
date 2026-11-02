// Tests — UN RESULTAT DE DICTEE VIDE NE REVEILLE PAS LE BAS DE L'ECRAN VOCAL
// (`spec_modes_ecran_vocal.md` § 4bis, correctif du 2026-11-15).
//
// LE DEFAUT VERROUILLE ICI (rapporte par le proprietaire : « la barre du bas ne
// s'efface plus ») : dans le gestionnaire de resultat de la dictee
// (`rec.onresult`), `vocalWakeChrome()` etait appele a CHAQUE resultat, sans
// regarder s'il contenait un seul mot. Or le moteur de reconnaissance emet des
// resultats VIDES en continu — micro arme, piece silencieuse — et l'ecran Vocal
// arme justement la dictee AU REPOS. Le decompte etait donc remis a zero avant
// son terme, a repetition, et le bas ne s'effacait plus jamais.
//
// CE QUE CE FICHIER EXIGE, et pourquoi il echoue si l'on revient en arriere :
//   1. BRANCHEMENT — dans le gestionnaire, le SEUL appel au reveil est gouverne
//      par le texte (`if (transcript.trim()) vocalWakeChrome();`), et le chemin
//      vide ne fait que rejouer la decision (`else vocalSyncChrome();`). Un
//      `vocalWakeChrome();` inconditionnel fait tomber le test ;
//   2. CONSEQUENCE — seul `vocalWakeChrome` repose le decompte
//      (`vocalRestartChromeTimer`), `vocalSyncChrome` n'en pose JAMAIS : un
//      resultat vide ne peut donc pas relancer les 10 s (`VOCAL_CHROME_IDLE_MS`) ;
//   3. SORTIE — un champ vide n'interdit pas le masquage (decision PURE de
//      `vocal-chrome.js`) : le decompte arrive a son terme et le bas s'efface.
//      Sans le point 1, ce troisieme point ne se produisait jamais.
//
// Les commentaires sont en ASCII ; les chaines du source sont copiees telles
// quelles. Decoupage de source VERIFIE (`sliceSource` leve si une ancre
// disparait) : un fragment vide ne peut pas rendre une assertion vraie par
// construction.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sliceSource } from "./source-slice.js";
import {
  VOCAL_CHROME_IDLE_MS,
  vocalChromeClass,
  vocalChromeVisible,
} from "./vocal-chrome.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const SUPER = readFileSync(join(ICI, "super-agent.js"), "utf8").replace(/\r\n/g, "\n");

/** Corps d'une fonction du module (`sliceSource` LEVE si l'ancre a disparu). */
function corpsFonction(src, entete) {
  return sliceSource(src, entete, "\n  }", 2);
}

/**
 * Le gestionnaire de RESULTAT de la dictee, seul endroit qui voit le texte
 * arriver du moteur. Borne a `onerror` : la suite (erreurs, fin d'ecoute) n'a
 * rien a voir avec le reveil du bas.
 */
const GESTIONNAIRE = sliceSource(
  SUPER,
  "rec.onresult = (e) => {",
  "rec.onerror = (ev) => {",
  400,
);

/** Les lignes du gestionnaire qui appellent REELLEMENT le reveil. */
function lignesDeReveil(src) {
  return src
    .split("\n")
    .filter((ligne) => /vocalWakeChrome\s*\(/.test(ligne))
    .map((ligne) => ligne.trim());
}

// ---------------------------------------------------------------------------
describe("1. le branchement : le reveil est reserve au TEXTE dicte", () => {
  it("un resultat VIDE ne peut pas appeler `vocalWakeChrome` (aucun appel nu)", () => {
    // Le defaut d'origine, tel qu'il etait ecrit : un appel inconditionnel a
    // chaque resultat, vide compris. Il ne doit plus exister.
    const appels = lignesDeReveil(GESTIONNAIRE);
    expect(appels.length, `appels trouves : ${JSON.stringify(appels)}`).toBe(1);
    // Le SEUL appel restant est celui de la branche « il y a du texte ».
    expect(appels[0]).toBe("if (transcript.trim()) vocalWakeChrome();");
    // Et un `vocalWakeChrome();` seul sur sa ligne serait exactement le defaut.
    expect(GESTIONNAIRE).not.toMatch(/(^|\n)\s*vocalWakeChrome\(\);\s*(\n|$)/);
  });

  it("le chemin VIDE rejoue la decision sans toucher au decompte", () => {
    // `vocalSyncChrome` applique la classe sans jamais reposer de minuteur (voir
    // le bloc 2) : le decompte en cours continue sa route, il ne repart pas.
    expect(GESTIONNAIRE).toMatch(/else\s+vocalSyncChrome\(\);/);
    // Le commentaire du correctif est juste au-dessus du branchement : il porte
    // la cause, pas une seconde logique.
    expect(GESTIONNAIRE).toMatch(/CORRECTIF « la barre du bas ne s'efface plus »/);
  });

  it("le reveil vient APRES l'ecriture du texte et le redimensionnement", () => {
    // L'ordre compte : le champ doit deja contenir le mot quand le bas revient
    // (sinon on reveille le bas sur un champ vide, et la decision le remasque
    // aussitot). Ce point est celui du test du masque, verifie ici sur le meme
    // fragment pour que ce fichier tienne seul.
    const iEcriture = GESTIONNAIRE.indexOf("inputEl.value = preText + sep + transcript;");
    const iResize = GESTIONNAIRE.indexOf("resizeInput();", iEcriture);
    const iReveil = GESTIONNAIRE.indexOf("if (transcript.trim()) vocalWakeChrome();");
    expect(iEcriture).toBeGreaterThan(-1);
    expect(iResize).toBeGreaterThan(iEcriture);
    expect(iReveil).toBeGreaterThan(iResize);
  });

  it("aucun AUTRE chemin de la dictee ne reveille le bas", () => {
    // Tout le demarrage de la dictee : le bouton 🎙️ et l'armement automatique y
    // passent. Un second appel (dans `onstart`, `onend`, une reprise de session)
    // rendrait le correctif inoperant sans qu'on le voie.
    const session = sliceSource(SUPER, "function startVoiceInput(", "function immersiveAssistantName(", 400);
    expect(lignesDeReveil(session)).toEqual(["if (transcript.trim()) vocalWakeChrome();"]);
  });
});

// ---------------------------------------------------------------------------
describe("2. la consequence : seul le reveil repose les 10 s", () => {
  it("`vocalWakeChrome` remet le decompte a zero", () => {
    const corps = corpsFonction(SUPER, "function vocalWakeChrome(");
    expect(corps).toMatch(/vocalRestartChromeTimer\(\)/);
    expect(corps).toMatch(/vocalSyncChrome\(\)/);
  });

  it("`vocalSyncChrome` ne pose JAMAIS de minuteur (il ne peut donc pas relancer le delai)", () => {
    const corps = corpsFonction(SUPER, "function vocalSyncChrome(");
    expect(corps).not.toMatch(/vocalRestartChromeTimer/);
    expect(corps).not.toMatch(/setTimeout/);
    // Il ne fait que lire les faits, trancher et ecrire la classe.
    expect(corps).toMatch(/vocalChromeVisible\(faits\)/);
    expect(corps).toMatch(/vocalChromeClass\(visible\)/);
  });

  it("le delai protege reste 10 000 ms, dans une seule constante", () => {
    // Un decompte plus long (ou plus court) changerait la promesse du §4bis et
    // masquerait le defaut au lieu de le corriger.
    expect(VOCAL_CHROME_IDLE_MS).toBe(10_000);
  });
});

// ---------------------------------------------------------------------------
describe("3. la sortie : un champ vide laisse le bas s'effacer", () => {
  it("au repos, champ VIDE, rien ne retient le bas (donc le decompte aboutit)", () => {
    // Etat de l'ecran Vocal APRES un resultat vide : le texte n'a pas change
    // (le champ est vide), le micro est ouvert, aucune question, pointeur
    // ailleurs. C'est exactement le cas ou le bas doit s'effacer.
    expect(
      vocalChromeVisible({
        saisie: false,
        micFerme: "",
        pointeurActif: false,
        pointeurGeste: false,
        question: false,
      }),
    ).toBe(false);
    // Et la classe posee est bien celle de l'effacement.
    expect(vocalChromeClass(false)).toBe("vocal-chrome-hidden");
  });

  it("des que le champ CONTIENT le mot, le bas revient (l'autre sens de la regle)", () => {
    // Meme diction de decision, uniquement le fait `saisie` qui change : c'est
    // la preuve que le correctif distingue le resultat VIDE du resultat PARLE,
    // et non qu'il a supprime le reveil.
    expect(vocalChromeVisible({ saisie: true })).toBe(true);
    expect(vocalChromeClass(true)).toBe("");
  });
});
