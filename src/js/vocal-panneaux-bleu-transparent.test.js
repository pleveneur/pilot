/**
 * Verrou de la remarque n° 8 du proprietaire (2026-11-03), en deux temps :
 *
 *   1. « baisse l'opacite des panneaux [de la colonne des taches] sans degrader
 *      la lisibilite du texte » — le verre des deux colonnes passe de 55 % a
 *      46 %, soit un voile cumule de 0,43 sur le fond de l'application au lieu
 *      de 0,52 ;
 *   2. « reprends ce bleu, pour les cadres et le texte, sous forme transparente »
 *      — le bleu qui entoure la zone de saisie n'est ecrit nulle part en dur :
 *      c'est `--accent` (contour de focus, `box-shadow: var(--ring)`) et
 *      `--accent-text` (sa variante lisible). Les panneaux les reprennent par
 *      deux jetons derives : `--vocal-panel-frame` (55 % du bleu) et
 *      `--vocal-panel-text` (`--accent-text`).
 *
 * CE QUE LA MESURE A INTERDIT, et que ce fichier tient :
 *   - un TROISIEME jeton, un voile bleu sur la surface, a ete essaye puis retire.
 *     A 6 % du bleu melange au verre, le texte courant du panneau tombait a 4,19
 *     en `tokyo-day` (sa palette donne deja 4,52 sur son propre fond) et les
 *     titres de 5,31 a 4,46. La demande portait sur les cadres et le texte : un
 *     voile non demande qui prend la lisibilite ne passe pas.
 *   - descendre plus bas que 46 % : sous ce seuil, le panneau n'a plus de bord
 *     (4,05 en `nord`, il en faut 4) et `solarized` passe sous son plancher de
 *     3,8. C'est `ecran-vocal-transparence-visible.test.js` qui arbitre ; ce
 *     fichier-ci l'ecrit et le cite, il ne le contredit pas.
 *
 * POURQUOI CE FICHIER ECHOUE SI LE DEFAUT REVIENT :
 *   - une couleur ecrite en dur, un sous-theme qui fige un jeton, ou un jeton
 *     qui ne derive pas du bleu du theme => section 1 ;
 *   - les colonnes qui reprennent le gris uniforme (l'ancien `--glass-frame`,
 *     l'ancien `--text-secondary`) => section 2 (mutation rejouee : remettre
 *     `--vocal-panel-text: var(--text-secondary)` fait echouer la section 3,
 *     3,74 < 4,5 en `tokyo-day`) ;
 *   - un voile bleu de surface reintroduit => section 3 ;
 *   - une opacite qui repart a la hausse => section 4 (mutation rejouee :
 *     remettre 55 % la fait echouer).
 *
 * Aucun navigateur : lecture pure de `src/css/style.css` (fins de ligne
 * normalisees, quality-gate § 3.4) et calcul WCAG sur les DIX palettes.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CSS = readFileSync(resolve(ROOT, "src/css/style.css"), "utf8").replace(/\r\n/g, "\n");
const REGLES = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

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
const bloc = (sel) => {
  const r = TOUTES.find((x) => x.selecteur === sel);
  return r ? r.corps : null;
};

function vars(sel) {
  const corps = bloc(sel);
  if (corps === null) return null;
  const map = new Map();
  for (const m of corps.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) map.set(m[1], m[2].trim());
  return map;
}
const fusion = (base, over) => new Map([...(base || new Map()), ...(over || new Map())]);

function evalValeur(map, value, depth = 0) {
  if (value == null || depth > 12) return null;
  const texte = String(value).trim();
  if (!/^var\(/i.test(texte)) return texte;
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

const canaux = (hex) => {
  const n = String(hex).replace("#", "").trim();
  if (!/^[0-9a-f]{6}$/i.test(n)) throw new Error(`couleur inattendue : ${hex}`);
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
};
const hexDe = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const C = (x) => (Array.isArray(x) ? x : canaux(x));
const melange = (fg, bg, p) => {
  const a = C(fg);
  const b = C(bg);
  return hexDe(a.map((v, i) => v * p + b[i] * (1 - p)));
};
const lineaire = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const luminance = (hex) => {
  const n = canaux(hex);
  return 0.2126 * lineaire(n[0]) + 0.7152 * lineaire(n[1]) + 0.0722 * lineaire(n[2]);
};
const contraste = (a, b) => {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
/** Le plus grand ecart, en niveaux sur 255 : la mesure de perception du verrou T2. */
const ecart = (a, b) => Math.max(...C(a).map((v, i) => Math.abs(v - C(b)[i])));

/** Le taux d'un jeton `color-mix(in srgb, var(--x) N%, …)`, en fraction. */
function taux(map, jeton, variable) {
  const valeur = evalValeur(map, `var(${jeton})`) || "";
  const re = new RegExp(`color-mix\\(\\s*in srgb\\s*,\\s*var\\(--${variable}\\)\\s*([\\d.]+)%`, "i");
  const m = valeur.match(re);
  return { valeur, taux: m ? Number(m[1]) / 100 : null };
}

const SOUS_THEMES = TOUTES.map((r) => r.selecteur).filter((s) =>
  /^body\.theme-(dark|light)\.theme-[a-z-]+$/.test(s),
);
const CALQUE = ".pilot-vocal";
const JETONS = ["--vocal-panel-frame", "--vocal-panel-text", "--vocal-glass"];
const DIX = [
  [".theme-dark", null],
  [".theme-dark", "body.theme-dark.theme-one-dark"],
  [".theme-dark", "body.theme-dark.theme-dracula"],
  [".theme-dark", "body.theme-dark.theme-nord"],
  [".theme-dark", "body.theme-dark.theme-tokyo-night"],
  [".theme-light", null],
  [".theme-light", "body.theme-light.theme-github"],
  [".theme-light", "body.theme-light.theme-one-light"],
  [".theme-light", "body.theme-light.theme-solarized"],
  [".theme-light", "body.theme-light.theme-tokyo-day"],
];

/** La carte de jetons effective d'une palette (base + sous-theme), calque inclus. */
function palette(base, sousTheme) {
  return fusion(fusion(vars(base), sousTheme ? vars(sousTheme) : null), vars(CALQUE));
}

/**
 * Le FOND EFFECTIF du panneau, tel que l'oeil le voit : le verre (46 % d'un jeton
 * deja a 94 %) pose sur le lavis du calque, lui-meme pose sur le fond de
 * l'application. Meme empilement que `ecran-vocal-transparence-visible.test.js` :
 * deux modeles differents mesureraient deux panneaux differents.
 */
function couches(carte) {
  const fond = evalValeur(carte, "var(--bg-app)");
  const surface = evalValeur(carte, "var(--surface-floating)");
  const texte = evalValeur(carte, "var(--text-primary)");
  const { taux: aVerre } = taux(carte, "--vocal-glass", "glass-tint");
  const tint = carte.get("--glass-tint") || "";
  const aTeinte = Number((tint.match(/([\d.]+)%/) || [])[1]) / 100;
  const lavis = carte.get("--vocal-wash") || "";
  const aLavis = Number((lavis.match(/([\d.]+)%/) || [])[1]) / 100;
  const arriere = melange(texte, fond, aLavis);
  const panneau = melange(surface, arriere, Math.min(1, aTeinte * aVerre));
  return { fond, surface, texte, arriere, panneau, aVerre };
}

describe("1. le bleu vient du theme, jamais d'une couleur ecrite", () => {
  it("les deux jetons existent dans le calque et derivent du bleu", () => {
    const carte = vars(CALQUE);
    expect(carte, `bloc ${CALQUE} introuvable`).not.toBeNull();
    const { valeur, taux: p } = taux(carte, "--vocal-panel-frame", "accent");
    expect(valeur, "--vocal-panel-frame absent").toBeTruthy();
    expect(p, "--vocal-panel-frame ne derive pas de var(--accent)").toBeCloseTo(0.55, 5);
    // « sous forme transparente » : le cadre laisse voir ce qu'il y a derriere.
    expect(valeur).toMatch(/transparent/);
    expect(valeur.replace(/var\([^)]*\)/g, "")).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(/);
    // Le texte : la variante LISIBLE du bleu, pas une teinte inventee.
    expect(carte.get("--vocal-panel-text")).toBe("var(--accent-text)");
  });

  it("aucun sous-theme ne fige un des trois jetons (le theme suit a chaud)", () => {
    expect(SOUS_THEMES.length).toBeGreaterThanOrEqual(8);
    for (const sel of SOUS_THEMES) {
      const corps = bloc(sel) || "";
      for (const jeton of JETONS) {
        expect(corps, `${jeton} fige dans ${sel}`).not.toContain(jeton);
      }
    }
  });

  it("les dix palettes definissent bien `--accent` et `--accent-text`", () => {
    // Si une palette oubliait le bleu, le panneau tomberait sur un repli muet.
    expect(DIX).toHaveLength(10);
    for (const [base, sous] of DIX) {
      const carte = palette(base, sous);
      expect(evalValeur(carte, "var(--accent)"), `--accent absent (${sous || base})`).toMatch(
        /^#[0-9a-f]{6}$/i,
      );
      expect(evalValeur(carte, "var(--accent-text)"), `--accent-text absent (${sous || base})`).toMatch(
        /^#[0-9a-f]{6}$/i,
      );
    }
  });
});

describe("2. les panneaux prennent le bleu : cadre, surface, titres", () => {
  const groupees = (motif) =>
    TOUTES.find(
      (r) =>
        r.selecteur.includes(".vocal-side-discussion") &&
        r.selecteur.includes(".vocal-side-tasks") &&
        motif.test(r.corps),
    );

  it("le cadre des deux colonnes lit le bleu, pas l'ancien gris", () => {
    const cadre = groupees(/border\s*:/);
    expect(cadre, "le cadre des colonnes est introuvable").toBeTruthy();
    expect(cadre.corps).toMatch(/border\s*:\s*1px solid var\(--vocal-panel-frame\)/);
    expect(cadre.corps).not.toContain("--glass-frame");
  });

  it("la surface des deux colonnes est le verre du theme, sans voile bleu ajoute", () => {
    const surface = groupees(/background-color\s*:/);
    expect(surface, "la surface des colonnes est introuvable").toBeTruthy();
    expect(surface.corps).toMatch(/background-color\s*:\s*var\(--vocal-glass\)/);
    // Le voile de surface a ete essaye puis retire (voir l'entete) : s'il revient,
    // la ligne de fond se remet a melanger un accent, et ce test le dit. On ne
    // regarde QUE la ligne de fond : le liseré interne (`box-shadow`) fait partie
    // du cadre et garde son bleu.
    const fond = (surface.corps.match(/background-color\s*:\s*([^;]+);/) || [])[1] || "";
    expect(fond.trim()).toBe("var(--vocal-glass)");
    expect(fond).not.toMatch(/color-mix|#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/);
    // Et aucun jeton de voile ne subsiste dans le calque.
    expect(vars(CALQUE).has("--vocal-panel-veil")).toBe(false);
  });

  it("les titres et l'identite des taches prennent le bleu du texte", () => {
    // Une seule regle porte les DEUX titres (ils ne peuvent donc pas deriver
    // l'un de l'autre) : elle doit lire `--vocal-panel-text`.
    const titres = TOUTES.find(
      (r) =>
        r.selecteur.includes(".vocal-discussion-title") &&
        r.selecteur.includes(".vocal-tasks-title"),
    );
    expect(titres, "la regle groupee des deux titres est introuvable").toBeTruthy();
    expect(titres.corps).toMatch(/color\s*:\s*var\(--vocal-panel-text\)/);
    const who = bloc(".vocal-task-who") || "";
    expect(who, ".vocal-task-who introuvable").toBeTruthy();
    expect(who).toMatch(/color\s*:\s*var\(--vocal-panel-text\)/);
    // Le RESUME d'une tache reste au texte principal du theme : c'est le texte
    // qu'on lit vraiment, il ne prend pas la teinte.
    const mission = bloc(".vocal-task-mission") || "";
    expect(mission).toBeTruthy();
    expect(mission).not.toMatch(/color\s*:/);
  });
});

describe("3. la lisibilite passe avant la transparence (mesure sur les dix palettes)", () => {
  it("les titres bleus tiennent 4,5:1 partout, et relevent le point faible de l'ancien gris", () => {
    const releves = [];
    for (const [base, sous] of DIX) {
      const { panneau, fond } = couches(palette(base, sous));
      const carte = palette(base, sous);
      const titre = contraste(evalValeur(carte, "var(--vocal-panel-text)"), panneau);
      const ancien = contraste(evalValeur(carte, "var(--text-secondary)"), panneau);
      const surFond = contraste(evalValeur(carte, "var(--text-secondary)"), fond);
      releves.push({ nom: sous || base, titre, ancien, surFond });
      expect(titre, `titres illisibles sur ${sous || base}`).toBeGreaterThanOrEqual(4.5);
    }
    // Plancher reel : 4,98 (`clair` et `github`) — la marge au seuil est mince
    // mais tenue sur les dix palettes.
    expect(Math.min(...releves.map((r) => r.titre))).toBeGreaterThanOrEqual(4.9);
    // Ce que le bleu apporte, dit exactement : il ne gagne pas partout (dans
    // `clair` le gris du secondaire valait 5,19 contre 4,98), mais il releve le
    // POINT FAIBLE — la ou le secondaire tombait a 3,74 (`tokyo-day`). C'est la
    // que la lisibilite se jouait.
    const pireTitre = Math.min(...releves.map((r) => r.titre));
    const pireAncien = Math.min(...releves.map((r) => r.ancien));
    expect(pireAncien).toBeLessThan(4.5);
    expect(pireTitre).toBeGreaterThan(pireAncien + 1);
  });

  it("le texte courant respecte le plancher que la palette la plus douce impose", () => {
    // `solarized` a une encre volontairement douce : 4,13 sur SON PROPRE fond.
    // Sur le panneau elle vaut 3,82 ; le verrou existant T3 impose 3,8 et c'est
    // lui l'autorite. Le test l'ecrit plutot que de laisser croire a 4,5.
    const releves = [];
    for (const [base, sous] of DIX) {
      const { panneau, fond, texte } = couches(palette(base, sous));
      const surPanneau = contraste(texte, panneau);
      releves.push({ nom: sous || base, surPanneau, fond: contraste(texte, fond) });
      if (!String(sous || base).includes("solarized")) {
        expect(surPanneau, `texte illisible sur ${sous || base}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    const sol = releves.find((r) => r.nom.includes("solarized"));
    expect(sol.surPanneau).toBeGreaterThanOrEqual(3.8);
    expect(sol.fond).toBeLessThan(4.5); // constat, pas une excuse
    expect(Math.min(...releves.map((r) => r.surPanneau))).toBeGreaterThanOrEqual(3.8);
  });
});

describe("4. le panneau est plus transparent qu'avant, et pas au-dela du lisible", () => {
  it("le verre passe de 55 % a 46 % : le panneau est PLUS transparent", () => {
    const carte = vars(CALQUE);
    const { taux: p } = taux(carte, "--vocal-glass", "glass-tint");
    expect(p).toBeCloseTo(0.46, 5);
    // Voile cumule sur le fond de l'application : 1 - (1 - 0,94 x 0,46) = 0,43.
    const voile = 1 - (1 - 0.94 * p);
    expect(voile).toBeLessThanOrEqual(0.45);
    expect(voile).toBeLessThan(0.52); // la valeur d'avant la remarque
  });

  it("le verre ne descend pas sous 44 % : il n'y aurait plus de panneau", () => {
    const carte = vars(CALQUE);
    const { taux: p } = taux(carte, "--vocal-glass", "glass-tint");
    expect(p).toBeGreaterThanOrEqual(0.44);
    // Et le panneau garde un BORD visible sur les dix palettes : l'ecart avec ce
    // qu'il recouvre vaut au moins 4 niveaux (mesure du verrou T2). A 44 % il
    // tombe a 4,05 en `nord`, d'ou le 46 % retenu.
    const bords = DIX.map(([base, sous]) => {
      const { panneau, arriere } = couches(palette(base, sous));
      return ecart(panneau, arriere);
    });
    expect(Math.min(...bords)).toBeGreaterThanOrEqual(4);
  });
});
