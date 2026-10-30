// Tests — L'ETAT NU DE L'ECRAN VOCAL NE MASQUE JAMAIS LE PORTRAIT.
//
// Demande du proprietaire (2026-10-31) : le bouton unique « tout masquer » effacait
// TOUT, y compris le portrait. La decision, elle, n'a jamais change (2026-10-29,
// section 6 de docs/conceptions/CONCEPTION-ecran-vocal-portrait-et-colonnes.md) :
// « tout masquer, SAUF le portrait » ; spec_modes_ecran_vocal.md § 4ter.
//
// POURQUOI CE FICHIER EXISTE. Le masquage est une LISTE de noeuds ecrite en CSS,
// et `opacity: 0` sur un ancetre ne peut pas etre annule par un descendant : un
// portrait range DANS un noeud masque disparait avec lui, sans qu'aucune regle ne
// le nomme. C'est exactement ce qui est arrive le 2026-10-31 au matin, quand le
// personnage a ete transporte au centre du disque : `.vocal-bare .vocal-orb`
// etait deja ecrit, et le portrait, enfant du disque, s'eteignait avec lui.
// Le seul verrou existant etait « le bloc ne contient pas le mot portrait » — vrai
// a chaque instant, et pourtant insuffisant : il ne dit rien de l'ENDROIT ou vit
// le portrait. Ce fichier verifie l'endroit.
//
// Note du 2026-11-02 : le disque lui-meme n'est plus eteint par l'etat nu (il
// reste allume, voir `ecran-vocal-le-cercle-reste-visible.test.js`). Le defaut
// historique reste donc reproduit autrement ci-dessous — un portrait range dans
// un panneau qui s'eteint — pour que ce verificateur continue de trancher.
//
// CE QU'IL VERROUILLE :
//   1. aucun selecteur du masque n'atteint le portrait NI son nom, ancetres
//      compris (le controle de l'autre sens prouve que le verificateur n'est pas
//      complaisant : les noeuds qui DOIVENT s'eteindre sont bien atteints) ;
//      la ZONE DE SAISIE obeit a la meme regle depuis le 2026-11-01, et son
//      controle est pose en negatif dans le meme bloc ;
//   2. le portrait est un enfant DIRECT de la colonne de droite — jamais du disque
//      (defaut du 2026-10-31) et jamais de `.vocal-side-body`, dont le contenu est
//      reecrit (`innerHTML`) a chaque tic de 900 ms : la, il serait DETRUIT, pas
//      seulement masque ;
//   3. l'aller-retour : deux clics redonnent exactement l'ecran de depart, parce
//      que le seul ecrivain ne touche qu'UNE classe sur l'overlay et les attributs
//      de son propre bouton — rien d'autre n'est cache, vide, deplace ni recree ;
//   4. le bouton reste atteignable dans les DEUX etats : le masque ne l'atteint
//      pas (il vit dans la barre, qui n'est pas nommee), et l'exception nommee le
//      rallume explicitement ;
//   5. le portrait est la AVANT que l'etat nu ne s'applique : entrer directement
//      dans l'ecran Vocal (mode memorise, onglet 🧭 jamais ouvert) ne laisse pas
//      une memoire vide qui rendrait l'etat nu totalement vide.
//
// Les commentaires sont en ASCII ; les selecteurs et les extraits lus sont copies
// tels quels depuis les fichiers sources.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// Decoupage verifie : une ancre absente LEVE au lieu de rendre un fragment vide
// (quality-gate §3.4 : la source est normalisee en LF avant lecture).
// `neutraliserSource` retire commentaires et litteraux : un commentaire qui
// CITE un selecteur n'est pas une regle, et ne doit donc pas etre compte.
import { sliceSource, neutraliserSource } from "./source-slice.js";
import {
  VOCAL_BARE_CLASS,
  normalizeVocalBare,
  vocalBareNext,
  vocalBareClass,
  vocalBareLabel,
  vocalBareIcon,
  vocalBarePressed,
} from "./vocal-bare.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) =>
  readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const CSS = lire("src/css/style.css");
const SUPER = lire("src/js/super-agent.js");

// ---------------------------------------------------------------------------
// 1. Le verificateur : un mini-moteur de selection, sans dependance.
//    Il ne peint rien et ne teste pas le navigateur : il repond a une seule
//    question — « ce selecteur peut-il atteindre ce noeud, ou l'un de ses
//    ancetres ? ». C'est exactement ce que fait le CSS pour `opacity: 0`.
// ---------------------------------------------------------------------------

/** Decompose un selecteur compose (`.a.b`, `#id`, `tag`) en tag/classes/id. */
function compose(texte) {
  const morceau = { tag: null, id: null, classes: [] };
  let i = 0;
  while (i < texte.length) {
    const c = texte[i];
    if (c === "." || c === "#") {
      let j = i + 1;
      while (j < texte.length && /[A-Za-z0-9_-]/.test(texte[j])) j += 1;
      if (c === ".") morceau.classes.push(texte.slice(i + 1, j));
      else morceau.id = texte.slice(i + 1, j);
      i = j;
    } else {
      let j = i;
      while (j < texte.length && /[A-Za-z0-9-]/.test(texte[j])) j += 1;
      morceau.tag = texte.slice(i, j).toLowerCase();
      i = j;
    }
  }
  return morceau;
}

/** Un noeud du document simule : un tag, ses classes, son id. */
const noeud = (tag, classes = []) => ({ tag, id: "", classes });

/** Le noeud porte-t-il le selecteur compose ? (aucune combinatoire ici) */
function porte(el, morceau) {
  if (!el) return false;
  if (morceau.tag && el.tag !== morceau.tag) return false;
  if (morceau.id && el.id !== morceau.id) return false;
  return morceau.classes.every((classe) => el.classes.includes(classe));
}

/**
 * Analyse un selecteur complet en composes + combinateurs.
 * `combin[0]` est le lien entre `composes[0]` et `composes[1]` : " " ou ">".
 */
function analyser(selecteur) {
  const mots = selecteur.trim().split(/\s+/);
  const composes = [];
  const combin = [];
  for (let i = 0; i < mots.length; i += 1) {
    if (mots[i] === ">") {
      combin[composes.length - 1] = ">";
      continue;
    }
    composes.push(compose(mots[i]));
    if (composes.length > 1 && combin[composes.length - 2] === undefined) {
      combin[composes.length - 2] = " ";
    }
  }
  return { composes, combin };
}

/**
 * Le selecteur atteint-il le DERNIER noeud de la chaine ?
 * @param {string} selecteur selecteur CSS (descendant et enfant seulement)
 * @param {object[]} chaine du plus haut ancetre au noeud vise
 */
function atteint(selecteur, chaine) {
  const { composes, combin } = analyser(selecteur);
  const dernier = chaine[chaine.length - 1];
  if (!porte(dernier, composes[composes.length - 1])) return false;
  let c = composes.length - 2;
  let i = chaine.length - 2;
  while (c >= 0) {
    if ((combin[c] || " ") === ">") {
      if (!porte(chaine[i], composes[c])) return false;
      i -= 1;
    } else {
      let trouve = false;
      while (i >= 0) {
        if (porte(chaine[i], composes[c])) {
          trouve = true;
          i -= 1;
          break;
        }
        i -= 1;
      }
      if (!trouve) return false;
    }
    c -= 1;
  }
  return true;
}

/**
 * Le noeud est-il ETEINT par le masque — lui ou l'un de ses ancetres ?
 * `opacity: 0` sur un ancetre ne peut pas etre annule par un descendant : c'est
 * la regle qui a produit le defaut du 2026-10-31.
 */
function eteintPar(selecteurs, chaine) {
  return selecteurs.filter((selecteur) =>
    chaine.some((_, i) => atteint(selecteur, chaine.slice(0, i + 1))),
  );
}

// ---------------------------------------------------------------------------
// 2. Les selecteurs du masque, lus dans la feuille de style.
// ---------------------------------------------------------------------------

/**
 * Le bloc d'effacement de l'etat nu, selecteurs seuls (sans son corps).
 *
 * REEVISION DU 2026-11-01, avec sa raison : l'ancre de fin etait
 * `.pilot-vocal.vocal-bare .vocal-input {` — la regle qui eteignait la ZONE DE
 * SAISIE a part. Cette regle a ete RETIREE : le bouton de masquage ne concerne
 * pas la zone sous le cercle (champ de texte, bouton de dictee, rangee de
 * questions), qui reste affichee et utilisable dans les deux etats. L'ancre
 * disparaissait avec elle. La fin du bloc est desormais la regle SUIVANTE
 * (`.vocal-top`), qui ne peut pas disparaitre : la barre du haut porte le
 * bouton de masquage lui-meme.
 *
 * Les COMMENTAIRES sont neutralises : ce fragment en contient un long, ecrit
 * pour dire ce que le bloc ne touche PAS ; il cite donc `display: none`,
 * « portrait » et `.vocal-input`. Ce qui compte est la REGLE, pas la phrase qui
 * explique pourquoi il n'y en a pas.
 */
const blocEffacement = () =>
  neutraliserSource(
    sliceSource(
      CSS,
      ".pilot-vocal.vocal-bare .vocal-mic-fix,",
      ".pilot-vocal.vocal-bare .vocal-top {",
      200,
    ),
  );

const selecteursEffacement = () =>
  blocEffacement()
    .split("{")[0]
    .split(",")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);

// Un SEUL ensemble : la zone de saisie n'a plus de regle a elle.
const TOUS_LES_SELECTEURS = () => selecteursEffacement();

// ---------------------------------------------------------------------------
// 3. L'arbre reel de l'ecran, lu dans le modele de `buildVocalOverlay`.
// ---------------------------------------------------------------------------

/**
 * Le corps du modele HTML de l'ecran (`ov.innerHTML = \` ... \`;`).
 *
 * Les COMMENTAIRES sont retires : ils citent des classes (`class="vocal-top"`)
 * et ne sont pas des noeuds. Le modele ne contient ni `>` en fin de balise ni
 * balise auto-fermante pour les elements a contenu : seules `img` est vide.
 */
function modele() {
  const debut = SUPER.indexOf("ov.innerHTML = `", SUPER.indexOf("function buildVocalOverlay()"));
  expect(debut, "le modele de l'ecran Vocal est introuvable").toBeGreaterThan(0);
  const fin = SUPER.indexOf("`;", debut);
  expect(fin, "la fin du modele de l'ecran Vocal est introuvable").toBeGreaterThan(debut);
  return SUPER.slice(debut, fin)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\$\{[^}]*\}/g, "INTERPOLE");
}

/**
 * La chaine d'ancetres d'un noeud du modele, du plus haut (l'overlay lui-meme)
 * au noeud vise. L'overlay est en etat NU : sa liste de classes est celle de
 * `buildVocalOverlay` PLUS `vocal-bare`, puisqu'on etudie cet etat-la.
 */
function chaineDe(classeVisee) {
  const racine = noeud("div", ["pilot-vocal", "vocal-state-idle", VOCAL_BARE_CLASS]);
  const pile = [racine];
  const vides = new Set(["img", "br", "hr", "input"]);
  for (const balise of modele().match(/<[^>]+>/g) || []) {
    const fermeture = balise.match(/^<\/([a-z]+)/i);
    if (fermeture) {
      pile.pop();
      continue;
    }
    const ouverture = balise.match(/^<([a-z]+)([\s\S]*)>$/i);
    if (!ouverture) continue;
    const classes = (balise.match(/class="([^"]*)"/) || ["", ""])[1]
      .split(/\s+/)
      .filter(Boolean);
    const el = noeud(ouverture[1].toLowerCase(), classes);
    if (el.classes.includes(classeVisee)) return [...pile, el];
    if (!vides.has(el.tag)) pile.push(el);
  }
  return [];
}

describe("1. ce que le masque atteint — et ce qu'il n'atteint JAMAIS (defaut du 2026-10-31)", () => {
  it("aucun selecteur du masque n'atteint le portrait, ni lui ni un ancetre", () => {
    const chaine = chaineDe("vocal-portrait");
    // La chaine doit exister : sans elle, le test passerait pour une mauvaise
    // raison (une lecture ratee rendrait une liste vide, donc « rien n'est
    // atteint »). On exige donc explicitement le portrait a son extremite.
    expect(chaine.length).toBeGreaterThan(2);
    expect(chaine[chaine.length - 1].classes).toContain("vocal-portrait");
    const coupables = eteintPar(TOUS_LES_SELECTEURS(), chaine);
    expect(
      coupables.map((s) => s.replace(".pilot-vocal.vocal-bare ", "")),
      "ces selecteurs eteignent le portrait ou l'un de ses ancetres",
    ).toEqual([]);
  });

  it("aucun selecteur du masque n'atteint le NOM du portrait", () => {
    // Le nom (`.vocal-portrait-name`) est cree a l'execution, JUSTE APRES l'image :
    // il a donc exactement les memes ancetres. Une legende eteinte alors que
    // l'image reste allumee serait un demi-masquage.
    const chaine = chaineDe("vocal-portrait");
    const avecLeNom = [...chaine.slice(0, -1), noeud("div", ["vocal-portrait-name"])];
    expect(eteintPar(TOUS_LES_SELECTEURS(), avecLeNom)).toEqual([]);
  });

  it("LE VERIFICATEUR N'EST PAS COMPLAISANT : ce qui doit s'eteindre l'est bien", () => {
    // Sans ce controle, une erreur de lecture (liste de selecteurs vide, chaine
    // vide) ferait passer les deux tests precedents en ne verifiant rien.
    const selecteurs = TOUS_LES_SELECTEURS();
    // La COLONNE DES TACHES (et non les ancetres du portrait, qui vit maintenant
    // sous le cercle) : le masque doit toujours l'atteindre.
    const colonne = chaineDe("vocal-side-body").slice(0, -1); // jusqu'a la colonne
    // La ligne d'etat, la colonne de gauche, le titre, la liste : tous nommes,
    // tous atteints. LE DISQUE N'EST PLUS DANS CETTE LISTE, et son controle est
    // passe en NEGATIF juste apres (regle du proprietaire, 2026-11-02 : « quand
    // il desactive l'affichage, le cercle ne doit pas disparaitre »). LA ZONE DE
    // SAISIE N'Y ETAIT PLUS depuis la revision du 2026-11-01, pour la meme
    // raison : une regle dediee l'eteignait, cette regle est retiree.
    const attendus = [
      noeud("div", ["vocal-status"]),
      noeud("aside", ["vocal-side-discussion", "vocal-side"]),
      noeud("div", ["vocal-side-body"]),
    ];
    for (const el of attendus) {
      expect(
        eteintPar(selecteurs, [...colonne, el]).length,
        `le masque devrait atteindre .${el.classes[0]}`,
      ).toBeGreaterThan(0);
    }
    // Le titre est un enfant de la colonne, la ou la liste l'est aussi.
    expect(
      eteintPar(selecteurs, [...colonne, noeud("div", ["vocal-tasks-title"])]).length,
    ).toBeGreaterThan(0);
    // LE PENDANT NEGATIF (revision du 2026-11-01) : la zone de saisie — le
    // champ de texte, le bouton de dictee et la rangee de questions qu'elle
    // porte — n'est atteinte par AUCUN selecteur du masque. Le verificateur
    // continue donc de trancher dans les deux sens.
    expect(
      eteintPar(selecteurs, [...colonne, noeud("div", ["vocal-input"])]),
      "l'etat nu ne doit jamais atteindre la zone de saisie",
    ).toEqual([]);
    // ET LE DISQUE (2026-11-02) : jamais atteint, ni lui ni ses pieces, dans
    // l'arbre reel de l'ecran comme sous la scene. Un cerclé eteint retirerait
    // a l'ecran nu le seul objet qui dise encore l'etat de la voix.
    const disque = chaineDe("vocal-orb");
    expect(disque[disque.length - 1].classes).toContain("vocal-orb");
    expect(
      eteintPar(selecteurs, disque),
      "l'etat nu ne doit jamais atteindre le disque",
    ).toEqual([]);
  });

  it("le verificateur reproduit le defaut : portrait DANS un panneau eteint = eteint", () => {
    // C'est l'arbre exact du 2026-10-31 au matin (commit afef214) transpose au
    // masque d'aujourd'hui : le portrait range DANS un noeud que le bloc eteint
    // s'eteint avec lui, sans qu'aucune regle ne le nomme. Ce test fixe la
    // sensibilite du verificateur : la meme mesure DESIGNERA le coupable des
    // qu'un ancetre du portrait sera nomme. (Le disque, lui, n'est plus eteint :
    // il ne peut donc plus servir de temoin — le panneau de gauche le remplace.)
    const alors = [
      noeud("div", ["pilot-vocal", "vocal-state-idle", VOCAL_BARE_CLASS]),
      noeud("div", ["vocal-stage"]),
      noeud("aside", ["vocal-side-discussion", "vocal-side"]),
      noeud("img", ["vocal-portrait"]),
    ];
    expect(
      eteintPar(TOUS_LES_SELECTEURS(), alors).map((s) =>
        s.replace(".pilot-vocal.vocal-bare ", ""),
      ),
    ).toEqual([".vocal-side-discussion"]);
  });
});

describe("2. l'endroit du portrait : jamais dans le disque, jamais dans la liste", () => {
  const chaine = () => chaineDe("vocal-portrait");

  it("il est un enfant DIRECT de la composition du milieu, SOUS le cercle", () => {
    // Point 7 des remarques du proprietaire (2026-11-13) : le personnage n'est
    // plus dans une colonne, il est SOUS le cercle, sur le meme axe. Ses deux
    // ancetres sont donc la COMPOSITION et la scene — et la colonne des taches
    // n'est plus dans sa chaine du tout.
    const ch = chaine();
    expect(ch[ch.length - 1].classes).toContain("vocal-portrait");
    expect(ch[ch.length - 2].classes).toContain("vocal-center");
    expect(ch[ch.length - 3].classes).toContain("vocal-stage");
    expect(ch.some((el) => el.classes.includes("vocal-side-tasks"))).toBe(false);
  });

  it("il n'est PAS dans le disque : le cercle ne porte ni image ni nom", () => {
    expect(chaine().some((el) => el.classes.includes("vocal-orb"))).toBe(false);
    // Le modele ne pose QUE l'image : aucun nom dans le disque, et aucune classe
    // `vocal-orb-name` (l'ancien nom du cercle a disparu avec le lot 1).
    expect(modele()).not.toContain("vocal-orb-name");
    // Deuxiemement point d'ecriture du nom : il n'y en a qu'un, cree a l'execution.
    expect(SUPER.match(/className = "vocal-portrait-name"/g)?.length).toBe(1);
  });

  it("il n'est PAS dans la liste des taches, dont le contenu est reecrit a chaque tic", () => {
    // `vocalRenderColumn` ecrit `liste.innerHTML = html` toutes les 900 ms : un
    // portrait range la serait DETRUIT, pas seulement masque — et l'etat nu
    // n'aurait plus rien a laisser allume.
    expect(chaine().some((el) => el.classes.includes("vocal-side-body"))).toBe(false);
    const rendu = sliceSource(
      SUPER,
      "function vocalRenderColumn(plan) {",
      "function collectVocalDiscussion",
      200,
    );
    // La seule ecriture de contenu vise `.vocal-side-body`, et rien d'autre.
    expect(rendu).toContain('colonne.querySelector(".vocal-side-body")');
    expect(rendu.match(/innerHTML =/g)?.length).toBe(1);
  });
});

describe("3. l'aller-retour : deux clics redonnent l'ecran de depart", () => {
  // L'etat pur, tel que le bouton le fait.
  const apresDeuxClics = () => {
    let etat = normalizeVocalBare(false);
    const depart = [vocalBareClass(etat), vocalBareLabel(etat), vocalBareIcon(etat), vocalBarePressed(etat)];
    etat = vocalBareNext(etat);
    etat = vocalBareNext(etat);
    return { depart, retour: [vocalBareClass(etat), vocalBareLabel(etat), vocalBareIcon(etat), vocalBarePressed(etat)] };
  };

  it("classe, libelle, icone et `aria-pressed` reviennent identiques", () => {
    const { depart, retour } = apresDeuxClics();
    expect(retour).toEqual(depart);
    expect(retour[0]).toBe("");
    expect(VOCAL_BARE_CLASS).toBe("vocal-bare");
  });

  it("le premier clic pose une seule classe : `vocal-bare`, sur l'overlay", () => {
    const sync = sliceSource(SUPER, "function vocalSyncBare() {", "  function vocalWakeChrome() {", 200);
    // UNE ecriture de classe, et c'est la seule du corps.
    expect(sync.match(/classList\./g)?.length).toBe(1);
    expect(sync).toContain("vocalOverlay.classList.toggle(VOCAL_BARE_CLASS");
    // Le retour ne peut donc pas echouer : la classe retiree, l'ecran est celui
    // d'avant le premier clic, sans rien a reconstruire.
  });

  it("rien d'autre n'est cache, vide, deplace ni recree : aucun etat perdu", () => {
    const sync = sliceSource(SUPER, "function vocalSyncBare() {", "  function vocalWakeChrome() {", 200);
    // Les COMMENTAIRES sont neutralises : le corps cite les mots qu'il s'interdit
    // (`innerHTML` est ecrit par `setIcon`), ce qui ne fait pas une ecriture.
    const code = sync
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    // Aucun noeud n'est cree, retire, vide, masque ni deplace par le masquage :
    // son etat ne peut donc pas dependre du nombre de clics.
    for (const interdit of [
      ".hidden =",
      ".style.",
      "innerHTML",
      "removeChild",
      "appendChild",
      "insertBefore",
      "createElement",
      "removeAttribute(",
      'setAttribute("class"',
      "className",
    ]) {
      expect(code, `vocalSyncBare ne doit pas toucher ${interdit}`).not.toContain(interdit);
    }
    // Seuls les attributs du bouton lui-meme changent (libelle, etat, icone).
    const attributs = sync.match(/setAttribute\("([a-z-]+)"/g) || [];
    expect(attributs.sort()).toEqual([
      'setAttribute("aria-label"',
      'setAttribute("aria-pressed"',
      'setAttribute("title"',
    ]);
  });

  it("le masque ne nomme que des noeuds : aucune regle de place, donc rien ne saute", () => {
    // « Restaurer exactement l'etat de depart » se joue ici : si le masque
    // touchait une dimension, la place serait recalculee et le retour ferait
    // sauter le disque et le portrait.
    const bloc = blocEffacement();
    for (const interdit of [
      "display:",
      "width:",
      "height:",
      "margin",
      "padding",
      "position:",
      "top:",
      "left:",
      "transform",
      "flex",
      "grid",
      "overflow",
    ]) {
      expect(bloc, `le bloc d'effacement ne doit pas contenir ${interdit}`).not.toContain(interdit);
    }
    expect(bloc).toMatch(/opacity:\s*0/);
    expect(bloc).toMatch(/visibility:\s*hidden/);
  });
});

describe("4. le bouton reste trouvable et cliquable dans les DEUX etats", () => {
  it("le masque ne l'atteint pas : il vit dans la barre, qui n'est pas nommee", () => {
    const chaine = [
      noeud("div", ["pilot-vocal", "vocal-state-idle", VOCAL_BARE_CLASS]),
      noeud("div", ["vocal-top"]),
      noeud("button", [VOCAL_BARE_CLASS === "vocal-bare" ? "vocal-display-toggle" : "x"]),
    ];
    expect(eteintPar(TOUS_LES_SELECTEURS(), chaine)).toEqual([]);
  });

  it("et l'exception nommee le rallume explicitement, fond et ombre compris", () => {
    const exception = sliceSource(
      CSS,
      ".pilot-vocal.vocal-bare .vocal-top .vocal-display-toggle {",
      "}",
      60,
    );
    expect(exception).toMatch(/opacity:\s*1/);
    expect(exception).toMatch(/visibility:\s*visible/);
    // Il reste la seule chose de la bande : elle perd son fond, il le garde.
    const barre = sliceSource(CSS, ".pilot-vocal.vocal-bare .vocal-top {", "}", 40);
    expect(barre).toMatch(/background:\s*transparent/);
    expect(exception).toMatch(/background:\s*var\(--bg-elevated\)/);
  });
});

describe("5. le portrait est LA avant que l'etat nu ne s'applique", () => {
  const entree = () => sliceSource(SUPER, "function enterVocal() {", "  function exitVocal() {", 2000);

  it("un portrait absent de la memoire est relu a l'entree, par le mecanisme existant", () => {
    // Entrer directement dans l'ecran Vocal (mode memorise au demarrage, onglet 🧭
    // jamais ouvert) laissait la memoire vide : le portrait restait `hidden`, et
    // l'etat nu ne gardait plus RIEN — le proprietaire voyait « tout efface ».
    const corps = entree();
    expect(corps).toContain('if (getAssistantPortrait() === "") refreshAssistantPersonaAndApply()');
    // Une seule relecture, et seulement quand rien n'est en memoire (l'image est
    // une URL `data:` de plusieurs megaoctets).
    expect(corps.match(/refreshAssistantPersonaAndApply\(\)/g)?.length).toBe(1);
    // Fail-open : la lecture ne peut ni retarder ni empecher l'entree dans le mode.
    expect(corps).toContain("refreshAssistantPersonaAndApply().catch(() => {})");
    // Et l'ordre : le portrait d'abord, l'etat nu ensuite, la largeur en dernier.
    expect(corps.indexOf("applyVocalPortrait(vocalOverlay);")).toBeLessThan(
      corps.indexOf('if (getAssistantPortrait() === "")'),
    );
    expect(corps.indexOf('if (getAssistantPortrait() === "")')).toBeLessThan(
      corps.indexOf("vocalSyncSides();"),
    );
  });

  it("l'ecran Vocal n'invente aucun second mecanisme de lecture du personnage", () => {
    // Meme garde, meme fonction que le plein ecran de l'Assistant : aucune lecture
    // en clair, aucun `invoke`, aucun nouveau reglage.
    expect(entree()).not.toContain("invoke(");
    expect(entree()).not.toContain("localStorage");
    const imm = sliceSource(SUPER, "function enterImmersive() {", "  function exitImmersive() {", 2000);
    const garde = 'if (getAssistantPortrait() === "") refreshAssistantPersonaAndApply().catch(() => {});';
    expect(imm, "la garde de reference a change de forme").toContain(garde);
    expect(entree(), "l'ecran Vocal doit reprendre EXACTEMENT la meme garde").toContain(garde);
  });

  it("a la sortie, rien ne survit : on rentre TOUJOURS avec tout visible", () => {
    const sortie = sliceSource(SUPER, "function exitVocal() {", "  function autoReadVocalReply() {", 4000);
    expect(sortie).toContain("vocalBare = normalizeVocalBare(false);");
  });
});
