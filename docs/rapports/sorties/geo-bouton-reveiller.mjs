// Calcul de geometrie du bouton de relance (verification a l'oeil, hors test).
// Lit le CSS REEL : aucun chiffre recopie. Usage : node docs/rapports/sorties/geo-bouton-reveiller.mjs
import { readFileSync } from "node:fs";

const css = readFileSync("src/css/style.css", "utf8");
const bloc = (sel) => {
  const i = css.indexOf(sel + " {");
  const j = css.indexOf("\n}", i);
  if (i < 0 || j < 0) throw new Error("bloc absent : " + sel);
  return css.slice(i, j);
};
const px = (s, p) => Number(new RegExp(p + ":\\s*(-?\\d+(?:\\.\\d+)?)px").exec(s)[1]);

const orb = bloc(".vocal-orb");
const btn = bloc(".vocal-restart");
const d = px(orb, "width");
const b = px(orb, "border");
const pad = Number(/padding: 0 (\d+)px/.exec(btn)[1]);
const fs = px(btn, "font-size");
const lh = Number(/line-height:\s*(\d+(?:\.\d+)?)/.exec(btn)[1]);

const ri = d / 2; // bord INTERIEUR de l'anneau
const re = d / 2 + b; // bord exterieur
const rb = d / 2; // `inset: 0` => boite de padding du disque
const lignes = 3;
const larg = d - 2 * pad;
const haut = lignes * fs * lh;

console.log("disque", d, "anneau", b);
console.log("rayon interieur", ri, "| rayon exterieur", re);
console.log("rayon du bouton", rb, "| jeu avec l'anneau", ri - rb, "| depassement", rb - ri);
console.log("marge jusqu'a l'exterieur", re - rb, "(= epaisseur de l'anneau)");
console.log(
  "zone de texte",
  larg,
  "x",
  haut.toFixed(1),
  "| diagonale",
  Math.hypot(larg, haut).toFixed(1),
  "<=",
  d,
);
