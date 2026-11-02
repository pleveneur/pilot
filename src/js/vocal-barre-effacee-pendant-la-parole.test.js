// LA BARRE DU BAS S'EFFACE QUOI QU'IL ARRIVE — decision ferme du proprietaire
// (2026-11-13) : « la barre de saisie du bas ne s'efface pas comme elle
// devrait ; elle doit s'effacer apres un temps de repos, de facon FIABLE » — puis
// la meme decision, delai porte a DIX SECONDES le 2026-11-14 : « la zone de saisie
// doit disparaitre apres 10 secondes sans souris ».
//
// LA REGLE, telle quelle :
//   - la barre s'efface apres 10 000 ms sans geste, QUOI QU'IL ARRIVE ;
//   - seules DEUX circonstances d'usage la retiennent :
//       1. le CHAMP CONTIENT DU TEXTE (il est occupe) ;
//       2. le POINTEUR est sur la zone du bas (geste a l'appui) ;
//   - NI la parole de l'assistant, NI la parole de l'utilisateur, NI l'etat
//     d'ecoute du micro ne la retiennent. C'est le point central : les etats de
//     conversation ne sont PLUS une condition de non-masquage ;
//   - elle revient au geste : souris, clavier, ou parole.
//
// Les deux circonstances deja verrouillees ailleurs restent (le message de panne
// du micro et la question de l'assistant en attente) : ce ne sont pas des etats
// de conversation, et les effacer rendrait le bas inutilisable ou bloquerait le
// travail sans un mot (`ecran-vocal-question-visible.test.js`).
//
// CE QUE CE FICHIER EMPECHE (chaque test echoue si le defaut revient) :
//   1. la barre retenue pendant que Pilot PARLE ;
//   2. la barre retenue pendant que l'UTILISATEUR parle / que le micro ECOUTE ;
//   3. la barre retenue par le seul FOCUS dans le champ (un champ vide garde le
//      curseur apres un envoi : il retenait alors le bas pour toute la session) ;
//   4. la disparition des deux seules raisons d'usage (champ rempli, pointeur) ;
//   5. la perte du reveil par la PAROLE (le seul geste qui ne passe par aucun
//      des quatre ecouteurs de pointeur / clavier).
//
// Les commentaires sont en ASCII ; les chaines de l'interface sont copiees
// telles quelles.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sliceSource } from "./source-slice.js";
import { vocalChromeVisible } from "./vocal-chrome.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const SUPER = readFileSync(join(ICI, "super-agent.js"), "utf8").replace(/\r\n/g, "\n");
const MODULE = readFileSync(join(ICI, "vocal-chrome.js"), "utf8").replace(/\r\n/g, "\n");

/** Corps de `vocalChromeVisible` (decoupage VERIFIE : ancre absente = echec). */
const DECISION = sliceSource(MODULE, "export function vocalChromeVisible(", "\n}", 400);

/** `vocalSyncChrome` : le SEUL point d'ecriture de la classe du bas. */
const SYNC = sliceSource(
  SUPER,
  "function vocalSyncChrome(state) {",
  "  function vocalSyncBare() {",
  400,
);

/** Le repos complet : rien ne retient le bas, sauf ce que le cas ajoute. */
const REPOS = {
  saisie: false,
  micFerme: "",
  pointeurActif: false,
  pointeurGeste: false,
  question: false,
};

describe("1. la parole de l'assistant ne retient PAS la barre", () => {
  it("Pilot parle : la barre s'efface quand meme (elle ne doit pas rester visible)", () => {
    // LE DEFAUT VISE : la regle 3 d'avant (« Pilot ecoute ou parle ») retenait le
    // bas. Une lecture longue laissait donc la barre a l'ecran sans fin.
    expect(vocalChromeVisible({ ...REPOS, etat: "speaking" })).toBe(false);
    // Et elle ne la retient pas davantage quand tout le reste est au repos
    // complet : aucun fait d'usage ne vient la retenir par accident.
    expect(vocalChromeVisible({ etat: "speaking" })).toBe(false);
  });
});

describe("2. la parole de l'utilisateur et l'ecoute du micro ne retiennent PAS la barre", () => {
  it("le micro ecoute : la barre s'efface quand meme", () => {
    expect(vocalChromeVisible({ ...REPOS, etat: "listening" })).toBe(false);
    expect(vocalChromeVisible({ etat: "listening" })).toBe(false);
  });

  it("le pire cas d'avant (dictee ouverte ET un mot deja transcrit) ne retient plus rien", () => {
    // C'est exactement le fait d'usage que l'ancienne regle 3 consultait : une
    // dictee vivante laissait le bas allume entre deux tours, pour toujours. La
    // decision ne regarde plus l'etat du tout, donc ce cas ne peut pas revenir
    // par un autre chemin.
    const faits = { ...REPOS, etat: "listening", dicteeOuverte: true, motRecu: true };
    expect(vocalChromeVisible(faits)).toBe(false);
  });

  it("le module de decision ne lit PLUS aucun etat (ni parole, ni ecoute)", () => {
    // Verrou de SOURCE : la decision ne consulte pas le fait `etat` et ne connait
    // plus les noms d'etats de conversation. Sans cela, quelqu'un pourrait
    // remettre la regle 3 « pour la lisibilite » sans qu'aucun test ne bronche.
    expect(DECISION).not.toMatch(/\.etat\b/);
    expect(DECISION).not.toContain('"listening"');
    expect(DECISION).not.toContain('"speaking"');
  });

  it("`vocalSyncChrome` ne transmet plus aucun etat a la decision", () => {
    expect(SYNC).not.toMatch(/\betat:/);
  });
});

describe("3. les DEUX seules raisons d'usage sont intactes", () => {
  it("le champ REMPLI retient la barre", () => {
    expect(vocalChromeVisible({ ...REPOS, saisie: true })).toBe(true);
  });

  it("le pointeur sur la zone du bas retient la barre (geste a l'appui)", () => {
    expect(vocalChromeVisible({ ...REPOS, pointeurActif: true, pointeurGeste: true })).toBe(true);
    // Un fait ABSENT (`pointeurGeste` non fourni) vaut geste recent : un appelant
    // qui ne le donne pas garde le comportement d'avant, il ne masque pas par
    // oubli.
    expect(vocalChromeVisible({ saisie: false, micFerme: "", pointeurActif: true, question: false })).toBe(
      true,
    );
  });

  it("le FOCUS dans un champ VIDE ne retient plus la barre", () => {
    // Deuxieme cause du symptome : le champ garde le curseur apres un envoi, et
    // « champ occupe » valait alors « focus dedans » — la barre ne s'effacait plus
    // du tout. La regle du proprietaire dit « le champ CONTIENT DU TEXTE ».
    expect(SYNC).toMatch(/saisie:\s*texte\.trim\(\) !== ""/);
    expect(SYNC).not.toMatch(/activeElement/);
  });

  it("un champ vide, sans texte ni focus, laisse la decision effacer le bas", () => {
    // Le meme fait, vu de la decision pure : rien a lire dans le champ.
    expect(vocalChromeVisible(REPOS)).toBe(false);
  });
});

describe("4. la barre REVIENT quand on parle (le seul geste sans pointeur ni clavier)", () => {
  it("prendre la parole reveille la barre par le reveil EXISTANT", () => {
    // La parole ne passe par aucun des quatre ecouteurs (pointeur, clic, molette,
    // clavier) : c'est `vocalBargeIn` (voix detectee par la garde du micro) qui
    // doit appeler le reveil. Aucun second minuteur n'est cree pour autant.
    const prise = sliceSource(SUPER, "  function vocalBargeIn(rapport) {", "\n  function enterVocal", 400);
    expect(prise).toMatch(/vocalWakeChrome\(\);/);
    // Et le reveil reste bien celui qui existe : un seul minuteur, 10 000 ms.
    expect(SUPER.match(/vocalChromeTimer = setTimeout\(/g) || []).toHaveLength(1);
    expect(SUPER.match(/vocalRestartChromeTimer\(\);/g) || []).toHaveLength(2);
  });

  it("la dictee reveille aussi la barre (les mots arrivent dans le champ)", () => {
    const dictee = sliceSource(SUPER, "rec.onresult", "vocalWakeChrome();", 60);
    expect(dictee).toMatch(/inputEl\.value = /);
  });
});
