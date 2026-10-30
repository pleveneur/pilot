/**
 * Verrou du CADRE des panneaux translucides (demande du proprietaire,
 * 2026-11-02) : « un cadre visible, en bords arrondis, dans la meme couleur que
 * le texte translucide de ces panneaux ».
 *
 * Trois choses sont tenues ici, et chacune echoue si le defaut revient :
 *
 *  1. LA COULEUR vient d'un jeton de theme, `--glass-frame`, derive du TEXTE
 *     secondaire (`color-mix(in srgb, var(--text-secondary) 80%, transparent)`).
 *     Aucune couleur n'est ecrite en dur, aucun sous-theme ne le fige : il suit
 *     donc les dix palettes, y compris un changement a chaud (ce sont des
 *     variables CSS, recalculees au repeint — l'acquis `684e9f3` reste vrai).
 *     Le cadre est lisible (contraste mesure) sans jamais crier plus fort que
 *     le texte qu'il entoure.
 *  2. L'ARRONDI est un jeton qui existait deja (`--radius-lg`, celui de
 *     `.projects-dropdown`) : aucun cinquieme rayon invente, et jamais une
 *     valeur en px ecrite sur place.
 *  3. LA MESURE dit vrai : le cadre est PRIS sur la largeur de la colonne
 *     (`box-sizing: border-box`), et le nombre de caracteres par ligne
 *     (`vocalCharsPerLine`) le retranche — `VOCAL_SIDE_FRAME_PX`. La hauteur,
 *     elle, ne bouge pas : aucun `padding-block`, donc les budgets de lignes et
 *     de taches restent exacts.
 *
 * Aucun navigateur n'est requis : lecture pure du fichier de styles (fins de
 * ligne normalisees, cf. quality-gate § 3.4) et du module pur `vocal-sides.js`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  VOCAL_SIDE_FRAME_PX,
  VOCAL_DISCUSSION_CHAR_PX,
  VOCAL_TASK_PX,
  VOCAL_TASK_HEADER_PX,
  vocalCharsPerLine,
} from "./vocal-sides.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CSS = readFileSync(resolve(ROOT, "src/css/style.css"), "utf8").replace(/\r\n/g, "\n");

/** Le CSS sans ses commentaires : ce sont les REGLES qui comptent ici. */
const REGLES = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Toutes les regles du fichier, dans l'ordre : `{ selecteur, corps }`.
 * Un CSS plat suffit (les @media ne contiennent que des regles simples) ; le
 * selecteur est borne par le `}` ou le `;` precedent, jamais par un commentaire
 * (ils sont deja retires).
 */
function regles(source) {
  const out = [];
  let i = 0;
  for (;;) {
    const open = source.indexOf("{", i);
    if (open < 0) break;
    const start = Math.max(source.lastIndexOf("}", open), source.lastIndexOf(";", open), -1) + 1;
    const selecteur = source.slice(start, open).trim();
    const close = source.indexOf("}", open);
    if (close < 0) break;
    out.push({ selecteur, corps: source.slice(open + 1, close) });
    i = close + 1;
  }
  return out;
}

const TOUTES = regles(REGLES);

/** Corps de la premiere regle dont le selecteur vaut exactement `selector`. */
function bloc(selector) {
  const r = TOUTES.find((x) => x.selecteur === selector);
  return r ? r.corps : null;
}

/** Carte des proprietes personnalisees (`--nom: valeur;`) d'un bloc. */
function vars(selector) {
  const corps = bloc(selector);
  if (corps === null) return null;
  const map = new Map();
  for (const m of corps.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) map.set(m[1], m[2].trim());
  return map;
}

/** Fusionne deux cartes (le second ecrase le premier). */
const fusion = (base, over) => new Map([...(base || new Map()), ...(over || new Map())]);

/** Evalue `var(--x)` / `var(--x, repli)`, imbrique. `null` si rien ne se resout. */
function evalValeur(map, value, depth = 0) {
  if (value == null || depth > 10) return null;
  const texte = String(value).trim();
  if (!/^var\(/i.test(texte)) return texte;
  // Bornes par VARIABLES, verifiees : un `var(` sans parenthese fermante rend
  // `-1` a `lastIndexOf`, et le fragment serait faux en silence.
  const ouvert = texte.indexOf("(");
  const ferme = texte.lastIndexOf(")");
  if (ouvert < 0 || ferme <= ouvert) return null;
  const inner = texte.slice(ouvert + 1, ferme);
  const comma = inner.indexOf(",");
  const nom = (comma < 0 ? inner : inner.slice(0, comma)).trim();
  const repli = comma < 0 ? null : inner.slice(comma + 1).trim();
  const direct = map && map.has(nom) ? evalValeur(map, map.get(nom), depth + 1) : null;
  if (direct) return direct;
  return repli ? evalValeur(map, repli, depth + 1) : null;
}

const SOMBRE = vars(".theme-dark");
const CLAIR = vars(".theme-light");

/** Melange sRGB d'une couleur sur un fond, pour un poids `p` (0..1). */
function melange(fg, bg, p) {
  const canaux = (hex) => {
    const n = String(hex).replace("#", "").trim();
    if (!/^[0-9a-f]{6}$/i.test(n)) throw new Error(`couleur inattendue : ${hex}`);
    return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
  };
  const [fr, fg_, fb] = canaux(fg);
  const [br, bg_, bb] = canaux(bg);
  const m = (a, b) => Math.round(a * p + b * (1 - p));
  return `#${[m(fr, br), m(fg_, bg_), m(fb, bb)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}

function lineaire(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function luminance(hex) {
  const n = String(hex || "").trim().replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(n)) throw new Error(`couleur inattendue : ${hex}`);
  return (
    0.2126 * lineaire(parseInt(n.slice(0, 2), 16)) +
    0.7152 * lineaire(parseInt(n.slice(2, 4), 16)) +
    0.0722 * lineaire(parseInt(n.slice(4, 6), 16))
  );
}

function contraste(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Le poids du texte secondaire dans le cadre, lu dans le jeton lui-meme. */
function poidsDuJeton(map) {
  const valeur = evalValeur(map, "var(--glass-frame)");
  const m = String(valeur || "").match(/color-mix\([^)]*var\(--text-secondary\)\s*([\d.]+)%/i);
  return { valeur, poids: m ? Number(m[1]) / 100 : null };
}

/** Les blocs de sous-theme (`body.theme-dark.theme-*` / `body.theme-light.theme-*`). */
const SOUS_THEMES = TOUTES.map((r) => r.selecteur).filter((s) =>
  /^body\.theme-(dark|light)\.theme-[a-z-]+$/.test(s),
);

describe("1. la couleur du cadre est un jeton de theme, pas une couleur ecrite", () => {
  it("`--glass-frame` existe dans les DEUX themes et derive du texte secondaire", () => {
    for (const [nom, map] of [
      ["sombre", SOMBRE],
      ["clair", CLAIR],
    ]) {
      expect(map, `bloc de theme ${nom} introuvable`).not.toBeNull();
      const { valeur, poids } = poidsDuJeton(map);
      expect(valeur, `--glass-frame manquant (${nom})`).toBeTruthy();
      // Meme famille que le texte translucide des panneaux : le secondaire.
      expect(valeur).toMatch(/color-mix\(\s*in srgb\s*,\s*var\(--text-secondary\)\s*[\d.]+%\s*,\s*transparent\s*\)/);
      // Un seul poids, dans les deux themes : 80 % (mesure : 5.32:1 en sombre,
      // 3.69:1 en clair sur `--bg-app`).
      expect(poids).toBeCloseTo(0.8, 5);
      // Aucune couleur litterale dans la valeur : tout vient de variables.
      expect(valeur.replace(/var\([^)]*\)/g, "")).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(/);
    }
  });

  it("aucun sous-theme ne fige `--glass-frame` : il suit le theme a chaud", () => {
    // `684e9f3` a rendu les teintes du verre dependantes du theme. Redefinir le
    // cadre dans un sous-theme le figerait pour cette palette — exactement ce
    // qu'on ne veut pas.
    expect(SOUS_THEMES.length).toBeGreaterThanOrEqual(8);
    for (const sel of SOUS_THEMES) {
      expect(bloc(sel) || "", `--glass-frame fige dans ${sel}`).not.toContain("--glass-frame");
    }
  });

  it("le cadre est lisible sur le fond, sans crier plus fort que le texte", () => {
    const PLAFOND_MIN = 2.6; // plancher mesure (tokyo-day) : la palette elle-meme est douce
    const mesures = [];
    for (const [nom, base] of [
      ["sombre", SOMBRE],
      ["clair", CLAIR],
    ]) {
      for (const sel of [null, ...SOUS_THEMES.filter((s) => bloc(s) && s.startsWith(`body.${nom === "sombre" ? "theme-dark" : "theme-light"}.`))]) {
        const map = sel ? fusion(base, vars(sel)) : base;
        const etiquette = sel || (nom === "sombre" ? ".theme-dark" : ".theme-light");
        const fond = evalValeur(map, "var(--bg-app)");
        const texte = evalValeur(map, "var(--text-secondary)");
        const { poids } = poidsDuJeton(map);
        expect(poids, `poids du cadre introuvable (${etiquette})`).not.toBeNull();
        const cadre = melange(texte, fond, poids);
        const ratioCadre = contraste(cadre, fond);
        const ratioTexte = contraste(texte, fond);
        mesures.push({ etiquette, ratioCadre, ratioTexte });
        expect(
          ratioCadre,
          `cadre ${cadre} sur ${fond} = ${ratioCadre.toFixed(2)}:1 (${etiquette})`,
        ).toBeGreaterThanOrEqual(PLAFOND_MIN);
        // Le cadre ne depasse jamais le texte secondaire : il encadre, il ne
        // prend pas la parole.
        expect(
          ratioCadre,
          `cadre ${ratioCadre.toFixed(2)}:1 > texte ${ratioTexte.toFixed(2)}:1 (${etiquette})`,
        ).toBeLessThanOrEqual(ratioTexte + 1e-9);
      }
    }
    // Les deux themes par defaut, mesures au plus juste (regression visible).
    const sombre = mesures.find((m) => m.etiquette === ".theme-dark");
    const clair = mesures.find((m) => m.etiquette === ".theme-light");
    expect(sombre.ratioCadre).toBeGreaterThanOrEqual(5.0);
    expect(clair.ratioCadre).toBeGreaterThanOrEqual(3.5);
  });
});

describe("2. le cadre est pose, arrondi, sans inventer de valeur", () => {
  it("les deux colonnes de l'ecran Vocal portent le cadre, avec le jeton d'arrondi existant", () => {
    const regle = TOUTES.find(
      (r) =>
        r.selecteur.includes(".vocal-side-discussion") && r.selecteur.includes(".vocal-side-tasks"),
    );
    expect(regle, "aucune regle groupee pour les deux colonnes").toBeTruthy();
    expect(regle.selecteur).toMatch(/\.vocal-side-discussion\s*,\s*\n?\.vocal-side-tasks/);
    const corps = regle.corps;
    expect(corps).toMatch(/border\s*:\s*1px solid var\(--glass-frame\)/);
    expect(corps).toMatch(/border-radius\s*:\s*var\(--radius-lg\)/);
    // Le cadre est PRIS sur la largeur (voir section 3), pas ajoute a cote.
    expect(corps).toMatch(/box-sizing\s*:\s*border-box/);
    // Aucune couleur en dur dans la regle.
    expect(corps.replace(/var\([^)]*\)/g, "")).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(/);
  });

  it("`--radius-lg` est un jeton qui existait deja : aucun rayon invente", () => {
    // Les rayons sont definis une seule fois chacun (bloc de documentation des
    // jetons en tete de `style.css`) : une seconde definition en cacherait une
    // autre.
    for (const nom of ["--radius-sm", "--radius-md", "--radius-lg"]) {
      const defs = REGLES.match(new RegExp(`\\${nom}\\s*:`, "g")) || [];
      expect(defs.length, `${nom} defini plusieurs fois`).toBe(1);
    }
    const lg = REGLES.match(/--radius-lg\s*:\s*([^;]+);/);
    expect(lg, "--radius-lg introuvable").toBeTruthy();
    expect(lg[1].trim()).toBe("12px");
    // Et les panneaux arrondis s'en servent (le dropdown le portait deja).
    expect(bloc(".projects-dropdown") || "").toMatch(/border-radius\s*:\s*var\(--radius-lg\)/);
  });

  it("tout panneau en verre (`--glass-tint`) porte le meme cadre", () => {
    // Le « meme mecanisme », c'est le jeton de verre des panneaux flottants.
    // Les voiles (`--glass-scrim`, `--glass-scrim-soft`) sont des surfaces plein
    // ecran, pas des panneaux : ils n'ont pas de bord.
    const verre = TOUTES.filter((r) => /background\s*:\s*var\(--glass-tint\)/.test(r.corps));
    const noms = verre.map((r) => r.selecteur.replace(/\s+/g, " ").trim());
    expect(noms, "panneaux en verre introuvables").toContain(".projects-dropdown");
    expect(noms).toContain(".context-menu");
    for (const r of verre) {
      expect(r.corps, `cadre manquant dans ${r.selecteur}`).toMatch(
        /border\s*:\s*1px solid var\(--glass-frame\)/,
      );
      expect(r.corps, `arrondi manquant dans ${r.selecteur}`).toMatch(
        /border-radius\s*:\s*var\(--radius-(sm|md|lg|xl)\)/,
      );
    }
  });

  it("aucun panneau ne revient a `--border-subtle` pour son cadre", () => {
    for (const sel of [".projects-dropdown", ".context-menu"]) {
      expect(bloc(sel) || "", `${sel} est revenu a --border-subtle`).not.toContain(
        "var(--border-subtle)",
      );
    }
  });
});

describe("3. le cadre ne retrecit pas la place du texte sans le dire", () => {
  it("`VOCAL_SIDE_FRAME_PX` est la somme EXACTE de ce que la feuille de style prend", () => {
    const regle = TOUTES.find(
      (r) =>
        r.selecteur.includes(".vocal-side-discussion") && r.selecteur.includes(".vocal-side-tasks"),
    );
    const bordure = Number((regle.corps.match(/border\s*:\s*(\d+)px solid/) || [])[1]);
    const marge = Number((regle.corps.match(/padding-inline\s*:\s*(\d+)px/) || [])[1]);
    expect(bordure).toBe(1);
    expect(marge).toBe(10);
    expect(VOCAL_SIDE_FRAME_PX).toBe(2 * (bordure + marge));
    expect(VOCAL_SIDE_FRAME_PX).toBe(22);
  });

  it("`vocalCharsPerLine` retranche le cadre AVANT de compter", () => {
    for (const track of [282, 320, 400, 800]) {
      const attendu = Math.max(1, Math.floor((track - VOCAL_SIDE_FRAME_PX) / VOCAL_DISCUSSION_CHAR_PX));
      expect(vocalCharsPerLine(track), `largeur ${track}`).toBe(attendu);
      // Et strictement moins que la largeur brute : le cadre n'est pas gratuit.
      expect(vocalCharsPerLine(track)).toBeLessThan(Math.floor(track / VOCAL_DISCUSSION_CHAR_PX));
    }
    // Jamais zero, meme sans colonne ou avec une colonne plus etroite que le cadre.
    expect(vocalCharsPerLine(0)).toBe(1);
    expect(vocalCharsPerLine(10)).toBe(1);
    expect(vocalCharsPerLine(undefined)).toBe(1);
    expect(vocalCharsPerLine(NaN)).toBe(1);
  });

  it("la HAUTEUR ne perd rien : aucun `padding-block`, aucune hauteur posee", () => {
    const regle = TOUTES.find(
      (r) =>
        r.selecteur.includes(".vocal-side-discussion") && r.selecteur.includes(".vocal-side-tasks"),
    );
    for (const interdit of ["padding-block", "padding:", "height:", "margin-block", "margin:"]) {
      expect(regle.corps, `le cadre touche la hauteur (${interdit})`).not.toContain(interdit);
    }
    // Et les budgets de hauteur du module sont intacts (46 px par tache, 20 px
    // de titre) : le cadre ne les a pas pousses.
    expect(VOCAL_TASK_PX).toBe(46);
    expect(VOCAL_TASK_HEADER_PX).toBe(20);
  });
});
