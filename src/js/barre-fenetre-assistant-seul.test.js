// barre-fenetre-assistant-seul.test.js — Verrou du coin haut droit du mode
// « Assistant seul ».
//
// HISTORIQUE (deux defauts successifs, mesures a l'appui) :
//   1. Le ⚙ et le point des agents etaient places SOUS les trois boutons
//      systeme de la fenetre : partiellement recouverts, donc difficiles a
//      cliquer. Cause : l'overlay du mode est `position: fixed; inset: 0` et
//      recouvre la rangee d'onglets, alors que les trois boutons systeme
//      gardent `z-index: 100001` et restent peints AU-DESSUS ; la barre du
//      mode posait ses deux boutons dans la MEME ligne.
//   2. Premiere correction : 150 px de marge a DROITE (largeur du groupe +
//      air) pour ne plus les recouvrir. Effet de bord signale par le
//      proprietaire : les deux boutons ne sont plus dans le coin, ils
//      flottent au milieu-droite.
//
// ETAT VERROUILLE ICI (ce que le proprietaire demande) :
//   - la barre du mode vit sur la SECONDE ligne, SOUS la rangee des boutons
//     systeme (decalage = hauteur mesuree de cette rangee) ;
//   - ses deux boutons de droite prennent l'air droit EXACT du groupe
//     systeme, donc le MEME bord droit que lui : alignes sur le bord de la
//     fenetre ;
//   - aucune reservation laterale (le ⚙ n'est plus repousse vers le milieu) ;
//   - aucun empilement : une marge haute, un remplissage droit, pas de
//     `position` / `z-index` / `top` ajoutes sur la barre.
//
// CE FICHIER NE FIGE AUCUN NOMBRE : la largeur du groupe, son air droit et la
// hauteur de la rangee sont RECALCULES depuis le disque (`index.html`,
// `#window-controls`, `#tab-row`). Une valeur qui bouge sans que le CSS
// suive fait echouer le test. Si quelqu'un remet les deux boutons a cheval
// sur la rangee systeme, les deux derniers tests rougissent.
//
// Aucun navigateur n'est requis (lecture des fichiers, fins de ligne
// normalisees, cf. quality-gate 3.4).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sliceSource } from "./source-slice.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lire = (...p) =>
  readFileSync(resolve(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

const css = lire("src/css/style.css");
const html = lire("index.html");

/** "46px" -> 46 (une unite en px est exigee : aucune valeur relative admise). */
function enPixels(valeur, quoi) {
  const m = String(valeur).trim().match(/^(-?\d+(?:\.\d+)?)px$/);
  expect(m, `${quoi} : valeur en px attendue, trouve « ${valeur} »`).not.toBeNull();
  return Number(m[1]);
}

/** Bloc CSS complet d'un selecteur (jusqu'a l'accolade fermante en debut de ligne). */
function bloc(selecteur) {
  return sliceSource(css, "\n" + selecteur + " {\n", "\n}", 40);
}

/** Valeur brute d'une propriete dans un bloc (plusieurs jetons par ligne admis,
 *  commentaires retires : une declaration ne suit pas forcement un autre point
 *  virgule, elle peut suivre un commentaire). */
function propriete(blocCss, nom) {
  const sansCommentaires = blocCss.replace(/\/\*[\s\S]*?\*\//g, "");
  const m = sansCommentaires.match(new RegExp("(?:^|[;{])\\s*" + nom + ":\\s*([^;]+);"));
  expect(m, `propriete « ${nom} » introuvable`).not.toBeNull();
  return m[1].trim();
}

/** Decoupe un remplissage CSS en ses cotes (1 a 4 valeurs), sans casser les
 *  expressions `calc(...)` : on ne coupe qu'aux espaces de profondeur 0. */
function cotes(remplissage) {
  const morceaux = [];
  let courant = "";
  let profondeur = 0;
  for (const c of String(remplissage).trim()) {
    if (c === "(") profondeur += 1;
    if (c === ")") profondeur -= 1;
    if (/\s/.test(c) && profondeur === 0) {
      if (courant) morceaux.push(courant);
      courant = "";
      continue;
    }
    courant += c;
  }
  if (courant) morceaux.push(courant);
  return morceaux;
}

/** Etend une liste de 1 a 4 cotes en [haut, droite, bas, gauche]. */
function cotesEnCadre(liste) {
  const [h, d = h, b = h, g = d] = liste;
  return [h, d, b, g];
}

// ── Mesures prises SUR LE DISQUE ───────────────────────────────────────────

// 0. `box-sizing: border-box` est GLOBAL : il est indispensable au calcul
//    ci-dessous (la bordure basse de la rangee est COMPRISE dans sa hauteur).
expect(css, "box-sizing: border-box global attendu (base du calcul de hauteur)")
  .toMatch(/\*,\s*\*::before,\s*\*::after\s*\{\s*box-sizing:\s*border-box/);

// 1. Les trois boutons systeme : largeur d'une touche et nombre de touches.
const groupe = bloc("#window-controls");
const touche = bloc("#window-controls > button");
const largeurTouche = enPixels(propriete(touche, "width"), "largeur d'une touche systeme");

const blocHtml = sliceSource(html, '<div id="window-controls">', "\n      </div>", 100);
const nombreTouches = (blocHtml.match(/<button /g) || []).length;
expect(nombreTouches, "les trois boutons systeme doivent etre dans index.html").toBeGreaterThanOrEqual(3);

// 2. Remplissage du groupe : « 4px 4px 4px 0 » -> l'air de DROITE est le 2e.
const remplissageGroupe = cotesEnCadre(cotes(propriete(groupe, "padding")));
const airDroiteGroupe = enPixels(remplissageGroupe[1], "air droit du groupe systeme");

// 3. Empreinte laterale reelle du groupe.
const empreinte = nombreTouches * largeurTouche + airDroiteGroupe;

// 4. La RANGEE qui porte le groupe, donc la hauteur de la premiere ligne.
const rangee = bloc("#tab-row");
const hauteurRangee = enPixels(propriete(rangee, "min-height"), "hauteur de la rangee d'onglets");
const filetRangee = enPixels(
  cotes(propriete(rangee, "border-bottom"))[0],
  "filet bas de la rangee d'onglets",
);
// border-box : le filet est pris DANS la hauteur declaree. Le bas de la
// premiere ligne (donc le bas des boutons systeme) est a `hauteurRangee`.
const basBandeSystemes = hauteurRangee;

// 5. Les jetons nommes, et l'air des jetons.
const racine = bloc(":root");
const jetons = {};
for (const nom of [
  "--window-controls-width",
  "--window-controls-air",
  "--window-controls-height",
  "--space-2",
]) {
  jetons[nom] = enPixels(propriete(racine, nom), nom);
}

/** Resout une valeur CSS simple en pixels : `Npx`, `var(--jeton)`, ou
 *  `calc(<terme> + <terme>)` de tels termes. Sert a comparer les declarations
 *  ENTRE ELLES (aucun nombre recopie dans ce fichier). */
function resoudre(valeur, quoi) {
  const v = String(valeur).trim();
  const calc = v.match(/^calc\(([\s\S]+)\)$/);
  if (calc) {
    const termes = cotes(calc[1].replace(/\+/g, " "));
    return termes.reduce((somme, terme) => somme + resoudre(terme, quoi), 0);
  }
  const variable = v.match(/^var\((--[a-z0-9-]+)\)$/);
  if (variable) {
    expect(jetons[variable[1]], `jeton ${variable[1]} attendu dans :root pour ${quoi}`).toBeTypeOf("number");
    return jetons[variable[1]];
  }
  return enPixels(v, quoi);
}

// 6. La barre du mode « Assistant seul ».
const barre = bloc(".sa-immersive-top");
const remplissageBarre = cotesEnCadre(cotes(propriete(barre, "padding")));
const decalageBarre = resoudre(propriete(barre, "margin-top"), "marge haute de la barre");
const airDroiteBarre = resoudre(remplissageBarre[1], "air droit de la barre");
const airGaucheBarre = resoudre(remplissageBarre[3], "air gauche de la barre");
const hauteurBarre = enPixels(propriete(barre, "height"), "hauteur de la barre du mode");

// 7. L'overlay du mode.
const overlay = bloc(".superagent-immersive");

describe("mode « Assistant seul » — les deux boutons sont SOUS la rangee systeme et alignes a DROITE", () => {
  it("le jeton de largeur vaut EXACTEMENT l'empreinte mesuree des trois boutons", () => {
    // Mesure de reference du groupe (plus utilisee pour reserver une place,
    // mais toujours verifiee : c'est elle qui dit ou est le bord droit).
    expect(
      jetons["--window-controls-width"],
      `empreinte mesuree = ${nombreTouches} x ${largeurTouche} + ${airDroiteGroupe}`,
    ).toBe(empreinte);
  });

  it("le jeton de hauteur vaut la hauteur mesuree de la rangee systeme", () => {
    // Aucune valeur figee : si la rangee change de hauteur (36 px), le jeton
    // doit suivre, sinon le decalage devient faux en silence.
    expect(
      jetons["--window-controls-height"],
      `rangee = ${hauteurRangee} px dont ${filetRangee} px de filet bas`,
    ).toBe(basBandeSystemes);
  });

  it("le jeton d'air droit vaut l'air droit mesure du groupe systeme", () => {
    expect(jetons["--window-controls-air"]).toBe(airDroiteGroupe);
  });

  it("la barre descend de la hauteur EXACTE de la rangee systeme (une marge, pas un empilement)", () => {
    // C'est la marge haute qui place la barre sur la SECONDE ligne.
    expect(propriete(barre, "margin-top")).toContain("var(--window-controls-height)");
    expect(decalageBarre, `la barre demarre a ${decalageBarre} px du haut`).toBe(basBandeSystemes);
    // ... et qui ne pousse pas le contenu inutilement plus bas.
    expect(decalageBarre).toBeLessThanOrEqual(basBandeSystemes + jetons["--space-2"]);
  });

  it("les deux boutons de droite prennent l'air droit EXACT des boutons systeme", () => {
    // Meme bord droit que le dernier bouton systeme : alignes sur le bord de
    // la fenetre, plus au milieu. Aucune place reservee a la largeur du
    // groupe (c'etait le defaut « boutons flottants »).
    expect(propriete(barre, "padding")).toContain("var(--window-controls-air)");
    expect(propriete(barre, "padding")).not.toContain("--window-controls-width");
    expect(airDroiteBarre).toBe(airDroiteGroupe);
    // Confortable a cliquer : jamais colle au bord, jamais repousse dedans.
    expect(airDroiteBarre).toBeGreaterThan(0);
    expect(airDroiteBarre).toBeLessThan(largeurTouche);
  });

  it("aucune couche ajoutee sur la barre (ni position, ni z-index, ni top)", () => {
    // La cause des deux defauts precedents etait un jeu de couches. Le
    // placement se fait par UNE marge et UN remplissage, rien d'autre.
    const sansCommentaires = barre.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(sansCommentaires).not.toMatch(/(?:^|[;{])\s*position\s*:/);
    expect(sansCommentaires).not.toMatch(/(?:^|[;{])\s*z-index\s*:/);
    expect(sansCommentaires).not.toMatch(/(?:^|[;{])\s*top\s*:/);
  });

  it("l'overlay reste plein ecran et la hauteur de la barre ne bouge pas", () => {
    expect(propriete(overlay, "inset")).toBe("0");
    expect(overlay).not.toMatch(/(?:^|[;{])\s*top\s*:/);
    expect(hauteurBarre, "la hauteur de la barre du mode ne doit pas exploser").toBe(58);
  });

  it("la correction ne recentre pas la barre : l'air de GAUCHE ne change pas", () => {
    expect(airGaucheBarre).toBe(18);
  });

  it("les deux boutons vises sont les DERNIERS de la barre", () => {
    // Ordre de la maquette ASS_Only_V4 : retour, titre, point des agents, ⚙.
    const js = lire("src/js/super-agent.js");
    const barreJs = sliceSource(js, '<div class="sa-immersive-top">', "\n      </div>", 200);
    const ordre = ["sa-immersive-back", "sa-immersive-title", "sa-immersive-agents", "sa-immersive-settings"]
      .map((classe) => barreJs.indexOf(classe));
    expect(ordre.every((i) => i >= 0), "les quatre elements de la barre doivent etre presents").toBe(true);
    expect([...ordre].sort((a, b) => a - b)).toEqual(ordre);
  });

  it("le ⚙ reste le DERNIER bouton de la barre apres le deplacement de l'entree Travail", () => {
    // Le bord droit de la barre, c'est son dernier enfant place dans le flux :
    // seul le ⚙ touche donc le bord. Or l'entree « Travail » est DEPLACEE dans
    // la barre a chaque entree en mode (super-agent.js, enterImmersive). Si
    // elle etait posee APRES le ⚙, le bord droit serait le compteur et les
    // deux boutons vises ne seraient plus alignes sur celui des boutons
    // systeme — sans qu'aucun test ne rougisse. Cet ordre n'existe que dans le
    // source (aucun DOM ici) : on lit donc l'insertion elle-meme.
    const js = lire("src/js/super-agent.js");
    const insertion = sliceSource(
      js,
      "const agentsHost = immersiveOverlay.querySelector(",
      "document.body.appendChild(immersiveOverlay);",
      100,
    );
    expect(insertion).toContain("insertBefore(activity, agentsHost)");
    // Jamais a la fin de la barre : ni `appendChild`, ni insertion apres le
    // dernier enfant, ni insertion a cote du ⚙.
    expect(insertion).not.toContain("appendChild(activity)");
    expect(insertion).not.toContain("insertBefore(activity, null)");
    expect(insertion).not.toContain("settings");
  });

  it("le dernier bouton ne porte aucune marge qui decollerait le bord droit", () => {
    // L'air droit est porte par le REMPLISSAGE de la barre (l'air du groupe
    // systeme). Une marge propre au ⚙ s'y ajouterait : le bord droit des deux
    // boutons ne coinciderait plus avec celui des boutons systeme.
    const dernier = bloc(".sa-immersive-settings");
    const sansCommentaires = dernier.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(sansCommentaires).not.toMatch(/(?:^|[;{])\s*margin[^:]*:/);
    expect(propriete(dernier, "flex-shrink")).toBe("0");
  });

  it("le coin des deux boutons est SOUS et a DROITE de celui des boutons systeme", () => {
    // Le test qui doit rougir si quelqu'un remet les deux boutons a cheval :
    //   - verticalement, la barre (donc ses boutons) demarre au bas de la
    //     rangee systeme ou en dessous ;
    //   - horizontalement, elle s'arrete au meme bord droit.
    expect(decalageBarre).toBeGreaterThanOrEqual(basBandeSystemes);
    expect(airDroiteBarre).toBe(airDroiteGroupe);
    // Et les deux zones ne peuvent pas se recouvrir : la premiere ligne
    // s'arrete a `basBandeSystemes`, la barre commence la ou elle s'arrete.
    expect(basBandeSystemes - decalageBarre).toBeLessThanOrEqual(0);
  });
});
