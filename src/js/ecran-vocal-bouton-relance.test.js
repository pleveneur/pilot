// Tests — LE BOUTON DE RELANCE DE L'ECOUTE (« ok <personnage> ») : le BRANCHEMENT
// et la GEOMETRIE. Fiche du proprietaire, decisions 401 et 402 du suivi
// (RAPPORT-bouton-ok-nova.md).
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
//   4. La geometrie est CALCULEE : taille et position lues dans le CSS, rayon du
//      disque lu dans le CSS — le bouton tient entierement dedans, sans dependre
//      d'une taille de fenetre.
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
    // Le libelle est une CHAINE AFFICHEE (constante du module pur, deja
    // verifiee dans `vocal-restart.test.js`) : elle est interpolee une seule
    // fois, pour l'infobulle ET pour le nom accessible.
    expect(disque).toMatch(/aria-label="\$\{VOCAL_RESTART_TITLE\}"/);
    expect(disque).toMatch(/title="\$\{VOCAL_RESTART_TITLE\}"/);
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
    expect(sync).toMatch(/vocalRestartLabel\(superAgentDisplayLabel\(\)\)/);
    expect(SUPER).toMatch(
      /import \{[^}]*vocalRestartVisible[^}]*\} from "\.\/vocal-restart\.js"/,
    );
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
    expect(persona).toMatch(/vocal-restart/);
    expect(persona).toMatch(/vocalRestartLabel\(label\)/);
  });
});

// ---------------------------------------------------------------------------
describe("4. la geometrie : il tient DANS le disque, a toute taille de fenetre", () => {
  const orb = bloc(CSS, ".vocal-orb {");
  const restart = bloc(CSS, ".vocal-restart {");

  it("le bouton est ROND, sans bord a lui (le contour du disque lui sert de bord)", () => {
    expect(restart).toMatch(/border-radius:\s*50%/);
    expect(restart).toMatch(/border:\s*none/);
    // Aucun anneau propre, aucune ombre : il fait partie de l'objet lumineux.
    expect(restart).not.toMatch(/box-shadow:\s*0 0 0 \dx/);
    expect(restart).not.toMatch(/outline:\s*\d/);
  });

  it("il est dans le HAUT du disque, en ABSOLU (aucune mise en page)", () => {
    expect(restart).toMatch(/position:\s*absolute/);
    expect(restart).toMatch(/top:\s*3px/);
    // Centre sans `transform` : rien a neutraliser en mouvement reduit.
    expect(restart).toMatch(/left:\s*0;/);
    expect(restart).toMatch(/right:\s*0;/);
    expect(restart).toMatch(/margin:\s*0 auto/);
    expect(restart).not.toMatch(/transform:/);
  });

  it("le point le plus eloigne du bouton reste DANS le rayon interieur", () => {
    // Chiffres LUS dans le CSS, jamais recopies : si l'un bouge sans l'autre,
    // ce test tombe et dit pourquoi.
    const taille = px(restart, "width");
    const haut = px(restart, "top");
    const disque = px(orb, "width");
    const anneau = px(orb, "border");
    // Le disque n'a pas de `box-sizing` particulier : sa boite de padding fait
    // `width` x `width` et le rayon interieur de l'anneau vaut la moitie.
    const rayonUtile = disque / 2;
    const demi = taille / 2;
    const centre = haut + demi; // distance du haut de la boite au centre du bouton
    const distanceAuCentre = rayonUtile - centre;
    expect(taille).toBeGreaterThan(0);
    expect(haut).toBeGreaterThanOrEqual(anneau); // il ne mord pas sur l'anneau
    // Le bord haut du bouton est DANS le disque, et son point le plus eloigne
    // du centre du disque aussi : aucune taille de fenetre n'y change rien,
    // puisque le disque et le bouton sont en pixels fixes.
    expect(distanceAuCentre + demi).toBeLessThanOrEqual(rayonUtile);
    // Marge restante : il ne touche pas l'anneau (>= 2 px de respiration).
    expect(rayonUtile - (distanceAuCentre + demi)).toBeGreaterThanOrEqual(2);
  });

  it("le disque ne recoit ni `overflow` ni taille nouvelle", () => {
    expect(orb).toMatch(/width:\s*168px/);
    expect(orb).toMatch(/height:\s*168px/);
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
