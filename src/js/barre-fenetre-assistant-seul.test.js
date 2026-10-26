// barre-fenetre-assistant-seul.test.js — Verrou de l'angle haut droit du mode
// « Assistant seul ».
//
// LE DEFAUT (signale par le proprietaire) : en mode « Assistant seul », les DEUX
// boutons de droite de la barre du haut (le point des agents et le ⚙ des
// options) etaient places SOUS les trois boutons systeme de la fenetre :
// partiellement recouverts, donc difficiles a cliquer. En mode normal, le meme
// coin ne posait pas de probleme.
//
// LA CAUSE (structurelle, sans ecran) : les deux modes ne partagent PAS la meme
// zone.
//   - Mode normal : les trois boutons systeme (#window-controls) sont le
//     DERNIER enfant de la rangee d'onglets (#tab-row) — leur place est
//     RESERVEE dans le flux, rien ne passe dessous.
//   - Mode « Assistant seul » : l'overlay `.superagent-immersive` est
//     `position: fixed; inset: 0` et recouvre cette rangee ; mais les trois
//     boutons gardent `z-index: 100001` et restent donc peints AU-DESSUS, a la
//     MEME place (angle haut droit de la fenetre). La barre du mode
//     (`.sa-immersive-top`, qui demarre tout en haut depuis la suppression de la
//     bande de 32 px) posait ses propres boutons a droite SANS leur reserver
//     cette place : le ⚙ et le point se retrouvaient dans la bande des trois
//     boutons systeme.
//
// LA CORRECTION : la barre du mode reserve a DROITE la largeur du groupe
// (`--window-controls-width`) plus l'air des jetons (`--space-2`). Rien ne
// bouge en mode normal, ni la hauteur de la barre, ni la colonne de gauche.
//
// CE FICHIER N'EST PAS UNE VALEUR FIGEE : la largeur attendue est RECALCULEE
// depuis le disque (largeur d'une touche dans `#window-controls > button`,
// remplissage droit du groupe, nombre de boutons dans index.html). Si l'une de
// ces valeurs change sans que le jeton suive, le test echoue.
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

// 1. Les trois boutons systeme : largeur d'une touche et nombre de touches.
const groupe = bloc("#window-controls");
const touche = bloc("#window-controls > button");
const largeurTouche = enPixels(propriete(touche, "width"), "largeur d'une touche systeme");

const blocHtml = sliceSource(html, '<div id="window-controls">', "\n      </div>", 100);
const nombreTouches = (blocHtml.match(/<button /g) || []).length;
expect(nombreTouches, "les trois boutons systeme doivent etre dans index.html").toBeGreaterThanOrEqual(3);

// 2. Remplissage du groupe : « 4px 4px 4px 0 » -> l'air de DROITE est le 2e.
const remplissage = cotesEnCadre(cotes(propriete(groupe, "padding")));
const airDroiteGroupe = enPixels(remplissage[1], "air droit du groupe systeme");

// 3. Empreinte reelle du groupe dans l'angle haut droit.
const empreinte = nombreTouches * largeurTouche + airDroiteGroupe;

// 4. Le jeton nomme, et l'air des jetons.
const racine = bloc(":root");
const jeton = enPixels(propriete(racine, "--window-controls-width"), "--window-controls-width");
const airJetons = enPixels(propriete(racine, "--space-2"), "--space-2");

// 5. La barre du mode « Assistant seul ».
const barre = bloc(".sa-immersive-top");
const remplissageBarre = cotesEnCadre(cotes(propriete(barre, "padding")));

describe("mode « Assistant seul » — l'angle haut droit reserve la place des boutons systeme", () => {
  it("le jeton de largeur vaut EXACTEMENT l'empreinte mesuree des trois boutons", () => {
    // Aucune valeur figee : si une touche change de largeur (46 px) ou si l'air
    // du groupe change (4 px), ou si un quatrieme bouton apparait, le jeton doit
    // suivre — sinon la reservation de la barre devient fausse en silence.
    expect(jeton, `empreinte mesuree = ${nombreTouches} x ${largeurTouche} + ${airDroiteGroupe}`).toBe(empreinte);
  });

  it("la barre du mode reserve a DROITE cette largeur PLUS de l'air", () => {
    // Le 2e cote du remplissage est celui de DROITE. Il doit citer le jeton
    // (pas une valeur recopiee, qui divergerait) ...
    expect(remplissageBarre[1]).toContain("var(--window-controls-width)");
    // ... et la place reservee doit depasser l'empreinte du groupe : les deux
    // boutons de la barre restent ainsi entierement a GAUCHE des trois boutons
    // systeme, sans les toucher (c'est l'« air » demande par le proprietaire).
    const reserve = jeton + airJetons;
    expect(reserve, `reserve ${reserve} px pour une empreinte de ${empreinte} px`).toBeGreaterThan(empreinte);
  });

  it("la place est reservee a DROITE seulement : l'air de gauche de la barre ne change pas", () => {
    // La correction ne doit pas recentrer ni decaler la barre : le cote GAUCHE
    // garde son air, c'est uniquement le cote droit qui s'elargit.
    const airGaucheBarre = enPixels(remplissageBarre[3], "air gauche de la barre");
    expect(airGaucheBarre).toBeGreaterThan(0);
    expect(airGaucheBarre).toBeLessThan(jeton + airJetons);
  });

  it("la barre demarre toujours TOUT EN HAUT (aucun decalage vertical ajoute)", () => {
    // La correction est HORIZONTALE : la hauteur de la bande validee ne doit pas
    // bouger. L'overlay reste `inset: 0` et aucune regle ne lui pose de `top`
    // (c'est justement pourquoi les trois boutons systeme flottent sur cette
    // barre, et donc pourquoi la reservation laterale est necessaire).
    const overlay = bloc(".superagent-immersive");
    expect(propriete(overlay, "inset")).toBe("0");
    expect(overlay).not.toMatch(/\n\s*top:/);
  });

  it("les deux boutons vises sont les DERNIERS de la barre (c'est a eux que profite la reservation)", () => {
    // Ordre de la maquette ASS_Only_V4 : retour, titre, point des agents, ⚙.
    const js = lire("src/js/super-agent.js");
    const barreJs = sliceSource(js, '<div class="sa-immersive-top">', "\n      </div>", 200);
    const ordre = ["sa-immersive-back", "sa-immersive-title", "sa-immersive-agents", "sa-immersive-settings"]
      .map((classe) => barreJs.indexOf(classe));
    expect(ordre.every((i) => i >= 0), "les quatre elements de la barre doivent etre presents").toBe(true);
    expect([...ordre].sort((a, b) => a - b)).toEqual(ordre);
  });
});
