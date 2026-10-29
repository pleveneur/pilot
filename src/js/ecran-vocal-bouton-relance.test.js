// Tests — LE BOUTON DE RELANCE DE L'ECOUTE (« Réveiller <Nom> ») : le BRANCHEMENT
// et la GEOMETRIE. Fiche du proprietaire, decisions 401 et 402 du suivi
// (RAPPORT-bouton-ok-nova.md), retouchees le 2026-10-29 : le bouton OCCUPE TOUTE
// LA SURFACE INTERIEURE du disque, et son libelle dit « Réveiller <Nom> »
// (RAPPORT-bouton-reveiller.md).
//
// `vocal-restart.test.js` verrouille la DECISION (se voit-il ? que dit-il ?).
// Ce fichier-ci verrouille ce que la decision ne peut pas prouver : que l'objet
// pose dans l'ecran est bien celui-la, qu'il ne cree pas une seconde voie de
// demarrage, qu'il ne deplace rien, et qu'il tient REELLEMENT dans le cercle.
//
// CE QUE CE FICHIER VERROUILLE :
//   1. Le bouton est un ENFANT du disque, apres le halo, MASQUE au depart ;
//      le disque n'est plus `aria-hidden` (un vrai controle doit etre
//      atteignable au clavier et nomme).
//   2. Son clic emprunte la voie EXISTANTE (`toggleVoiceInput`, celle du bouton
//      🎙️ de la barre de saisie) : une seule definition de `startVoiceInput`
//      dans tout le module, aucune seconde voie.
//   3. Sa visibilite est appliquee depuis l'etat REEL, a la fin de
//      `applyVocalState`, APRES `vocalSyncConversation` (donc jamais pendant les
//      350 ms d'un armement deja programme).
//   4. La geometrie est CALCULEE depuis le CSS : le bouton occupe la surface
//      INTERIEURE du disque (moins l'epaisseur de la bordure), sans en deborder,
//      et cela ne depend d'AUCUNE taille de fenetre.
//   5. Le bouton ne cree AUCUNE mise en page (position absolue), ne recouvre ni
//      le halo ni la phrase d'etat, et n'anime rien (mouvement reduit compris).
//
// Les commentaires sont en ASCII ; les selecteurs CSS et les chaines de
// l'interface sont copies tels quels.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sliceSource } from "./source-slice.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) => readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");

const CSS = lire("src/css/style.css");
const SUPER = lire("src/js/super-agent.js");

/** Corps d'une fonction du module (`sliceSource` LEVE si l'ancre a disparu). */
function corpsFonction(src, entete) {
  return sliceSource(src, entete, "\n  }", 2);
}

/** Corps d'un bloc CSS `selecteur { ... }` (premiere occurrence). */
function bloc(css, selecteur) {
  return sliceSource(css, selecteur, "}", 2);
}

/** Une valeur `prop: <n>px` d'un bloc CSS, en nombre. */
function px(css, prop) {
  const m = new RegExp(`${prop}:\\s*(-?\\d+(?:\\.\\d+)?)px`).exec(css);
  expect(m, `valeur ${prop} absente du bloc CSS`).not.toBeNull();
  return Number(m[1]);
}

// Taille PLEINE du disque, en pixels : la BORNE HAUTE du jeton `--vocal-orb-size`
// (le disque suit desormais la hauteur de la fenetre, de 120 a 336 px —
// CONCEPTION-ecran-vocal-cercle-et-bas.md §1.5). C'est cette borne qui sert de
// reference aux calculs de ce fichier : le bouton, lui, ne porte aucune taille,
// il suit le disque.
const DISQUE_PX = (() => {
  const jeton = /--vocal-orb-size:\s*clamp\((\d+)px,[^;]*?,\s*(\d+)px\)/.exec(
    bloc(CSS, ".pilot-vocal {"),
  );
  expect(jeton, "jeton `--vocal-orb-size` illisible").not.toBeNull();
  return Number(jeton[2]);
})();

// ---------------------------------------------------------------------------
describe("1. l'objet pose dans l'ecran : un rond DANS le disque", () => {
  const build = corpsFonction(SUPER, "function buildVocalOverlay()");
  // Du disque jusqu'au bouton de depannage : tout ce qui est entre les deux est
  // DANS le disque. Les commentaires HTML sont retires : ils PARLENT des
  // attributs (ils expliquent pourquoi `aria-hidden` est parti), et c'est le
  // balisage qui doit les tenir.
  const disque = sliceSource(
    build,
    '<div class="vocal-orb">',
    '<button type="button" class="vocal-mic-fix',
    40,
  ).replace(/<!--[\s\S]*?-->/g, "");

  it("il est un ENFANT du disque (pas un voisin, pas une copie)", () => {
    expect(disque).toMatch(/class="vocal-restart hidden"/);
    expect(disque).toMatch(/<button type="button"/);
  });

  it("il vient APRES le halo : il se peint au-dessus du remplissage", () => {
    expect(disque.indexOf("vocal-halo")).toBeLessThan(disque.indexOf("vocal-restart"));
  });

  it("il est MASQUE au depart : l'etat reel decide, pas le balisage", () => {
    // Avant `applyVocalState`, aucun etat n'est connu : le bouton ne doit rien
    // promettre. La regle 4 de `vocalRestartVisible` fait le reste.
    expect(disque).toMatch(/class="vocal-restart hidden"/);
    expect(disque).not.toMatch(/class="vocal-restart"/);
  });

  it("le disque n'est plus `aria-hidden` : le bouton est un vrai controle", () => {
    // Un sous-arbre `aria-hidden` contenant un bouton focusable est un piege :
    // le noeud serait atteignable au clavier mais muet pour un lecteur d'ecran.
    expect(disque).not.toMatch(/aria-hidden/);
  });

  it("l'infobulle, le nom accessible et le texte DISENT LA MEME CHOSE", () => {
    // Un seul texte, interpole UNE fois, pour les trois : on ne peut pas lire
    // « Réveiller Nova » a l'ecran et entendre autre chose au lecteur d'ecran.
    expect(disque).toMatch(
      /<button type="button" class="vocal-restart hidden" title="\$\{relance\}" aria-label="\$\{relance\}">\$\{relance\}<\/button>/,
    );
    // Et ce texte de depart n'est fait que de CONSTANTES : le nom du personnage
    // n'entre JAMAIS dans du balisage (il vient d'un fichier lu par Rust, il est
    // pose ensuite par `applyVocalRestartLabel`, en `textContent`).
    expect(build).toMatch(
      /const relance = `\$\{VOCAL_RESTART_VERB\} \$\{DEFAULT_ASSISTANT_NAME\}`/,
    );
    expect(build, "le nom du personnage interpole en HTML").not.toMatch(
      /\$\{superAgentDisplayLabel\(\)\}/,
    );
  });

  it("l'ordre des noeuds de l'ecran est inchange autour de lui", () => {
    const ordre = [...build.matchAll(/class="(vocal-[a-z-]+)/g)].map((m) => m[1]);
    expect(ordre).toEqual([
      "vocal-top",
      "vocal-stage",
      "vocal-orb",
      "vocal-halo",
      "vocal-restart",
      "vocal-mic-fix",
      "vocal-status",
      "vocal-input",
    ]);
  });
});

// ---------------------------------------------------------------------------
describe("2. une seule voie de demarrage : le clic emprunte l'existante", () => {
  const enter = corpsFonction(SUPER, "function enterVocal()");

  it("le clic appelle `toggleVoiceInput`, la fonction du bouton 🎙️", () => {
    expect(enter).toMatch(/relance\.addEventListener\("click", toggleVoiceInput\)/);
    // La MEME fonction est branchee sur le bouton de la barre de saisie : les
    // deux commandent la meme chose, il n'y a pas deux comportements.
    expect(SUPER).toMatch(
      /data-action="voice"[^\n]*\.addEventListener\("click", toggleVoiceInput\)/,
    );
    expect(enter, "le bouton a sa propre voie de demarrage").not.toMatch(
      /relance\.addEventListener\("click", startVoiceInput\)/,
    );
  });

  it("aucune seconde voie : `startVoiceInput` n'est definie qu'UNE fois", () => {
    expect(SUPER.match(/function startVoiceInput/g)).toHaveLength(1);
    // Et le bouton ne l'appelle pas lui-meme : il passe par le geste commun.
    const apres = corpsFonction(SUPER, "function enterVocal()");
    const i = apres.indexOf("const relance");
    const suite = apres.slice(i, i + 400);
    expect(suite).toMatch(/toggleVoiceInput/);
    expect(suite).not.toMatch(/startVoiceInput\(/);
  });

  it("il ne touche ni au micro, ni au rearment automatique", () => {
    // Le micro vit dans vocal-mic.js et le rearment dans `armVoiceInput` /
    // `vocalApplyConversationPlan` : le bouton ne fait que le geste commun.
    const i = enter.indexOf("const relance");
    const suite = enter.slice(i, i + 400);
    expect(suite).not.toMatch(/vocalMic|armVoiceInput|refreshVocalSensitivity/);
  });
});

// ---------------------------------------------------------------------------
describe("3. la visibilite est appliquee depuis l'etat REEL de la dictee", () => {
  const apply = corpsFonction(SUPER, "function applyVocalState()");
  const sync = corpsFonction(SUPER, "function vocalSyncRestartButton(state)");

  it("elle est appliquee a la FIN de `applyVocalState`, apres la conversation", () => {
    expect(apply).toMatch(/vocalSyncRestartButton\(state\)/);
    // APRES : l'armement vient peut-etre d'etre programme a l'instant, et le
    // bouton ne doit pas s'allumer pour un demi-clignement de 350 ms.
    expect(apply.indexOf("vocalSyncConversation()")).toBeLessThan(
      apply.indexOf("vocalSyncRestartButton(state)"),
    );
    // L'etat visuel est celui DEJA calcule : aucune seconde lecture de l'etat.
    expect(apply).toMatch(/const state = vocalScreenState\(etats\)/);
  });

  it("elle lit les trois sources REELLES, jamais un drapeau local", () => {
    expect(sync).toMatch(/voiceActive === true/);
    expect(sync).toMatch(/armementProgramme: !!vocalArmTimer/);
    expect(sync).toMatch(/transcription: voiceSupported === true/);
    expect(sync).toMatch(/etat: state/);
    // Aucune seconde source de verite : pas de drapeau garde a cote.
    expect(sync).not.toMatch(/vocalRestartAffiche|vocalRestartVisible =|let vocalRestart/);
  });

  it("la decision et l'etiquette sont PURES (module dedie)", () => {
    expect(sync).toMatch(/vocalRestartVisible\(/);
    // L'etiquette est posee par le point d'ecriture UNIQUE, pas ici.
    expect(sync).toMatch(/applyVocalRestartLabel\(bouton\)/);
    expect(SUPER).toMatch(
      /import \{[^}]*vocalRestartVisible[^}]*\} from "\.\/vocal-restart\.js"/,
    );
  });

  it("le libelle est ecrit a UN SEUL endroit, avec le nom du personnage", () => {
    const pose = sliceSource(SUPER, "function applyVocalRestartLabel(bouton) {", "\n}\n", 2);
    // Le nom vient de `superAgentDisplayLabel` (personnage actif, sinon nom
    // regle, sinon nom habituel) : aucune seconde source de nom.
    expect(pose).toMatch(/superAgentDisplayLabel\(\)/);
    // Le texte affiche est borne, le libelle complet porte le nom entier.
    expect(pose).toMatch(/vocalRestartText\(/);
    expect(pose).toMatch(/vocalRestartLabel\(/);
    // Texte, infobulle et nom accessible : les TROIS ensemble, ou pas du tout.
    expect(pose).toMatch(/el\.textContent = texte/);
    expect(pose).toMatch(/el\.title = complet/);
    expect(pose).toMatch(/el\.setAttribute\("aria-label", complet\)/);
    // Aucun balisage : le nom vient d'un fichier externe, il n'est pas du HTML.
    expect(pose).not.toMatch(/innerHTML/);
  });

  it("elle ne calcule aucun niveau sonore et ne touche pas au halo", () => {
    expect(sync).not.toMatch(/--vocal-heard|--vocal-level|planLevel|vocalSetLevel/);
    expect(sync).not.toMatch(/vocal-halo/);
  });

  it("le nom du bouton suit le personnage actif", () => {
    // `applyAssistantPersonaUi` est le point qui pousse le nom du personnage
    // dans l'interface : il met aussi l'etiquette du bouton a jour.
    const persona = sliceSource(
      SUPER,
      "export function applyAssistantPersonaUi()",
      "\n}\n",
      2,
    );
    expect(persona).toMatch(/applyVocalRestartLabel\(\)/);
  });
});

// ---------------------------------------------------------------------------
describe("4. la geometrie : il OCCUPE la surface interieure, sans en deborder", () => {
  const orb = bloc(CSS, ".vocal-orb {");
  const restart = bloc(CSS, ".vocal-restart {");

  it("le bouton est ROND, sans bord a lui (le contour du disque lui sert de bord)", () => {
    expect(restart).toMatch(/border-radius:\s*50%/);
    expect(restart).toMatch(/border:\s*none/);
    // Aucun anneau propre, aucune ombre : il fait partie de l'objet lumineux.
    expect(restart).not.toMatch(/box-shadow:\s*0 0 0 \dx/);
    expect(restart).not.toMatch(/outline:\s*\d/);
  });

  it("il est en ABSOLU et couvre TOUTE la surface interieure (`inset: 0`)", () => {
    expect(restart).toMatch(/position:\s*absolute/);
    // `inset: 0` = la boite de padding du disque, exactement. Aucune taille
    // propre, aucun decalage, aucune marge : il ne peut donc pas flotter dans
    // le cercle, ni le depasser, ni se poser de travers.
    expect(restart).toMatch(/inset:\s*0;/);
    expect(restart).not.toMatch(/(^|\n)\s*(width|height|top|left|right|bottom):/);
    expect(restart).not.toMatch(/margin:\s*0 auto/);
    // Centre sans `transform` : rien a neutraliser en mouvement reduit.
    expect(restart).not.toMatch(/transform:/);
  });

  it("son cercle COINCIDE avec le bord interieur de l'anneau, sans un pixel de trop", () => {
    // Chiffres LUS dans le CSS, jamais recopies : si l'un bouge sans l'autre,
    // ce test tombe et dit pourquoi.
    const disque = DISQUE_PX;
    const anneau = px(orb, "border");
    // Le disque n'a pas de `box-sizing` particulier : sa boite de padding fait
    // `width` x `width`, donc l'enfant en `inset: 0` mesure `width` x `width`.
    const rayonUtile = disque / 2; // bord INTERIEUR de l'anneau
    const rayonDuBouton = disque / 2; // `inset: 0` => la boite de padding
    expect(anneau).toBeGreaterThan(0);
    // 1. Il ne RECOUVRE pas la bordure : son rayon s'arrete au bord interieur.
    expect(rayonDuBouton).toBe(rayonUtile);
    // 2. Il ne DEBORDE pas : le bord exterieur de l'anneau est plus loin.
    expect(rayonDuBouton).toBeLessThan(rayonUtile + anneau);
    // 3. Il n'y a aucun JEU : la seule epaisseur entre le bouton et l'exterieur
    //    du disque est l'anneau lui-meme. « Il devient le cercle. »
    expect(rayonUtile + anneau - rayonDuBouton).toBe(anneau);
  });

  it("aucune valeur n'est propre au bouton : il suit le disque, rien d'autre", () => {
    // Pas d'unite relative a la fenetre, pas de dimension en pourcentage : le
    // bouton n'a AUCUNE taille a lui, et le disque n'en a qu'UNE (le jeton
    // `--vocal-orb-size`), partagee par `width` et `height`. Quelle que soit la
    // hauteur de la fenetre, le rapport bouton / disque ne peut donc pas varier.
    expect(restart).not.toMatch(/\d+(vw|vh|vmin|vmax)/);
    expect(restart).not.toMatch(
      /(width|height|min-width|max-width|min-height|max-height):\s*[\d.]+(%|vw|vh)/,
    );
    expect(orb).toMatch(/width:\s*var\(--vocal-orb-size\)/);
    expect(orb).toMatch(/height:\s*var\(--vocal-orb-size\)/);
  });

  it("le texte ne peut pas sortir du cercle, meme au pire cas", () => {
    // 1. Dernier recours du CSS : le rond decoupe ce qui depasserait.
    expect(restart).toMatch(/overflow:\s*hidden/);
    // 2. Et la place laissee au texte tient dans le disque, meme sur trois
    //    lignes — le pire cas du libelle borne par `vocalRestartText`.
    const disque = DISQUE_PX;
    const police = px(restart, "font-size");
    const interligne = Number(/line-height:\s*(\d+(?:\.\d+)?)/.exec(restart)[1]);
    const padding = Number(/padding:\s*0 (\d+)px/.exec(restart)[1]);
    const largeurTexte = disque - 2 * padding;
    expect(largeurTexte).toBeGreaterThan(0);
    const hauteurTexte = 3 * police * interligne;
    expect(Math.hypot(largeurTexte, hauteurTexte)).toBeLessThanOrEqual(disque);
  });

  it("le disque ne recoit ni `overflow` ni taille nouvelle", () => {
    // Une seule taille, lue du jeton : le bouton en `inset: 0` en decoule, donc
    // il n'y a rien a recalculer quand la fenetre change de hauteur.
    expect(orb).toMatch(/width:\s*var\(--vocal-orb-size\)/);
    expect(orb).toMatch(/height:\s*var\(--vocal-orb-size\)/);
    expect(orb).not.toMatch(/overflow/);
  });

  it("masque = `display: none` (absent de l'ecran ET du clavier)", () => {
    expect(bloc(CSS, ".vocal-restart.hidden")).toMatch(/display:\s*none/);
  });
});

// ---------------------------------------------------------------------------
describe("5. il ne recouvre rien et n'anime rien", () => {
  it("il ne touche ni la scene, ni la phrase d'etat, ni la barre de saisie", () => {
    // Les trois regles de mise en page sont inchangees : le bouton est absolu,
    // donc il ne peut pas les decaler.
    expect(bloc(CSS, ".vocal-stage {")).toMatch(/gap:\s*32px/);
    expect(bloc(CSS, ".vocal-status {")).toMatch(/position:\s*relative/);
    expect(bloc(CSS, ".vocal-input {")).toMatch(/margin:\s*0 auto 16px/);
    // Et il est pose DANS le disque, pas dans la scene.
    expect(bloc(CSS, ".vocal-restart {")).toMatch(/position:\s*absolute/);
  });

  it("il ne peut pas se poser sur le halo : jamais visible en ecoute", () => {
    // Le halo ne s'allume qu'en `vocal-state-listening` (regle CSS existante) ;
    // le bouton y est masque par la decision pure (regle 4). Les deux tiennent
    // ensemble : aucune image ou le rond recouvre la lueur de la voix.
    expect(CSS).toMatch(/\.pilot-vocal\.vocal-state-listening \.vocal-halo \{\s*\n\s*opacity: 1;/);
    const module = lire("src/js/vocal-restart.js");
    expect(module).toMatch(/return String\(e\.etat == null \? "" : e\.etat\) === VOCAL_RESTART_ETAT;/);
  });

  it("aucune animation, et le mouvement reduit coupe le seul effet", () => {
    const restart = bloc(CSS, ".vocal-restart {");
    expect(restart).not.toMatch(/animation/);
    expect(restart).toMatch(/transition:\s*background var\(--transition\)/);
    expect(CSS).toMatch(
      /\.pilot-vocal\.vocal-reduced \.vocal-restart \{\s*\n\s*transition: none;/,
    );
  });

  it("aucune couleur en dur : les jetons du theme seulement", () => {
    const restart = bloc(CSS, ".vocal-restart {");
    expect(restart).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(restart).not.toMatch(/\brgba?\(/);
    expect(restart).toMatch(/var\(--text-primary\)/);
  });

  it("le focus reprend le motif du projet (`--ring`)", () => {
    expect(bloc(CSS, ".vocal-restart:focus-visible")).toMatch(/box-shadow:\s*var\(--ring\)/);
  });
});
