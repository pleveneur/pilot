/**
 * Garde-fou des PANNEAUX TRANSLUCIDES : la teinte du thème actif, tout de suite.
 *
 * Demande du proprietaire : les panneaux translucides de l'interface (voiles de
 * modale, menus flottants, listes survolees, pastilles actives) doivent prendre
 * la teinte du THEME ACTIF et suivre un changement de theme SANS redemarrage.
 *
 * Deux defauts constates, tous deux mesures au navigateur avant correction :
 *   1. plusieurs surfaces ecrivaient leur teinte EN DUR — `rgba(0, 0, 0, 0.5)`
 *      pour les voiles, vert et gris-bleu Catppuccin pour les pastilles et les
 *      lignes alternees. Elles ne changeaient donc JAMAIS de palette : la meme
 *      teinte dans les dix themes (sombre, clair, nord, solarized...).
 *   2. les panneaux qui floutent l'arriere-plan gardaient la teinte PRECEDENTE
 *      apres un changement de theme : le compositeur conserve un instantane de
 *      ce qu'il y a derriere pour le flouter, et rien ne le lui faisait
 *      recapturer.
 *
 * Choix retenu : TROIS jetons dans le mecanisme de theme EXISTANT (`.theme-dark`
 * et `.theme-light`), exprimes a partir des variables du theme — donc recalculés
 * pour les dix palettes sans une seule valeur recopiee, et sans stockage :
 *   --glass-tint       la surface d'un panneau flottant (« verre »), 94 % ;
 *   --glass-scrim      le voile d'une modale ;
 *   --glass-scrim-soft le voile d'une attente (chargement, indexation).
 * Plus `body.glass-refresh` (style.css) posee une image par `glass-theme.js` au
 * moment ou `theme.js` emet l'evenement de theme : le flou est retire le temps
 * que l'instantane du compositeur soit repris.
 *
 * Ce fichier echoue si :
 *   1. un jeton manque dans un theme de base, ou porte une couleur en dur ;
 *   2. un sous-theme le redefinit (il doit heriter, sinon il gèlerait la teinte) ;
 *   3. une surface translucide revient a une couleur ecrite en dur ;
 *   4. un panneau flottant redevient opaque (le flou ne sert plus a rien) ou
 *      tombe hors de la plage d'opacite 92 % - 95 % (lisibilite) ;
 *   5. la liste des surfaces de `body.glass-refresh` diverge de celle du module ;
 *   6. l'evenement de theme est recopie au lieu d'etre importe de `theme.js` ;
 *   7. le rafraichissement n'est plus branche au demarrage ;
 *   8. une colonne de l'ecran Vocal revient a une couleur ecrite en dur, ou
 *      perd sa surface de verre (decision du 2026-11-02 : les deux colonnes
 *      prennent la teinte du theme, elles ne sont plus des filets transparents) ;
 *   9. un reglage ou un stockage apparait (aucune preference ajoutee).
 *
 * Aucun navigateur n'est requis : lecture des fichiers (fins de ligne
 * normalisees, cf. quality-gate 3.4) et appels du module reel sur des doublures.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  GLASS_REFRESH_CLASS,
  GLASS_REFRESH_FRAMES,
  GLASS_SURFACE_SELECTOR,
  installGlassThemeRefresh,
  refreshGlassSurfaces,
} from "./glass-theme.js";
import { THEME_CHANGED_EVENT } from "./theme.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lire = (chemin) => readFileSync(resolve(ROOT, chemin), "utf8").replace(/\r\n/g, "\n");
const css = lire("src/css/style.css");
const cssWeb = lire("web/css/web.css");
const themeJs = lire("src/js/theme.js");
const glassJs = lire("src/js/glass-theme.js");
const mainJs = lire("src/js/main.js");

/** Retire les commentaires : un commentaire n'est pas une declaration. */
const sansCommentaires = (texte) => String(texte).replace(/\/\*[\s\S]*?\*\//g, "");
/** Idem pour du JavaScript (commentaires de ligne compris). */
const sansCommentairesJs = (texte) =>
  String(texte)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((ligne) => ligne.replace(/\/\/.*$/, ""))
    .join("\n");

/** Corps de la premiere regle dont le selecteur vaut exactement `selector`. */
function blockOf(selector, source = css) {
  const needle = `${selector} {`;
  const at = source.indexOf(needle);
  if (at < 0) return null;
  const end = source.indexOf("}", at);
  return end < 0 ? null : source.slice(at + needle.length, end);
}

/** Carte des proprietes personnalisees d'un bloc. */
function varsOf(selector, source = css) {
  const body = blockOf(selector, source);
  if (body === null) return null;
  const map = new Map();
  for (const m of sansCommentaires(body).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    map.set(m[1], m[2].trim());
  }
  return map;
}

const mergeVars = (base, over) => new Map([...(base || new Map()), ...(over || new Map())]);

/** Premiere declaration `propriete:` d'un corps de regle, normalisee. */
function declaration(body, propriete) {
  if (body === null) return null;
  const m = sansCommentaires(body).match(
    new RegExp(`(?:^|[;{])\\s*${propriete}\\s*:\\s*([\\s\\S]*?);`, "i")
  );
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

/** Blocs `@<nom> ... { ... }` (accolades appariees). */
function atRuleBlocks(nom, source = css) {
  const blocs = [];
  const needle = `@${nom}`;
  let i = source.indexOf(needle);
  while (i >= 0) {
    const open = source.indexOf("{", i);
    if (open < 0) break;
    let depth = 0;
    let j = open;
    for (; j < source.length; j++) {
      if (source[j] === "{") depth++;
      else if (source[j] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    blocs.push({ condition: source.slice(i + needle.length, open).trim(), corps: source.slice(open + 1, j) });
    i = source.indexOf(needle, j + 1);
  }
  return blocs;
}

/** Arguments de premier niveau d'un appel CSS. */
function splitArgs(inner) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of inner) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts.map((s) => s.trim());
}

/** Resout `var()`, `#rrggbb`, `transparent` et `color-mix(in srgb, a p%, b)`. */
function resolveColor(value, map, depth = 0) {
  const v = String(value || "").trim();
  if (!v || depth > 12) return null;
  const varM = v.match(/^var\(\s*(--[a-z0-9-]+)\s*(?:,([\s\S]*))?\)$/i);
  if (varM) {
    if (map && map.has(varM[1])) return resolveColor(map.get(varM[1]), map, depth + 1);
    return varM[2] ? resolveColor(varM[2], map, depth + 1) : null;
  }
  if (/^transparent$/i.test(v)) return { r: 0, g: 0, b: 0, a: 0 };
  const mixM = v.match(/^color-mix\(\s*in\s+srgb\s*,([\s\S]*)\)$/i);
  if (mixM) {
    const cotes = splitArgs(mixM[1]).map((cote) => {
      const m = cote.match(/^([\s\S]*?)\s+([\d.]+%)\s*$/);
      return m ? { expr: m[1], part: parseFloat(m[2]) / 100 } : { expr: cote, part: 0.5 };
    });
    if (cotes.length !== 2) return null;
    const gauche = resolveColor(cotes[0].expr, map, depth + 1);
    const droite = resolveColor(cotes[1].expr, map, depth + 1);
    if (!gauche || !droite) return null;
    const p = cotes[0].part;
    const q = 1 - p;
    const alpha = gauche.a * p + droite.a * q;
    if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
    return {
      r: (gauche.r * gauche.a * p + droite.r * droite.a * q) / alpha,
      g: (gauche.g * gauche.a * p + droite.g * droite.a * q) / alpha,
      b: (gauche.b * gauche.a * p + droite.b * droite.a * q) / alpha,
      a: alpha,
    };
  }
  const hexM = v.match(/^#([0-9a-f]{6})$/i);
  if (hexM) {
    const n = hexM[1];
    return {
      r: parseInt(n.slice(0, 2), 16),
      g: parseInt(n.slice(2, 4), 16),
      b: parseInt(n.slice(4, 6), 16),
      a: 1,
    };
  }
  return null;
}

const linear = (canal) => {
  const c = canal / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const luminance = (c) => 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b);
const contraste = (a, b) => {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
const composer = (couleur, alpha, fond) => ({
  r: couleur.r * alpha + fond.r * (1 - alpha),
  g: couleur.g * alpha + fond.g * (1 - alpha),
  b: couleur.b * alpha + fond.b * (1 - alpha),
  a: 1,
});

const BLANC = { r: 255, g: 255, b: 255, a: 1 };
const NOIR = { r: 0, g: 0, b: 0, a: 1 };
const SEUIL_AA = 4.5;

/** Les surfaces qui ecrivaient leur voile en dur : elles prennent --glass-scrim. */
const VOILES = [
  ".modal",
  ".gds-menu-overlay",
  ".pdf-export-overlay",
  ".git-diff-overlay",
  ".agent-ext-dialog-overlay",
  ".palette-backdrop",
  ".recent-files-backdrop",
];
/** Voiles d'attente (plus legers, rien ne doit etre lu derriere). */
const VOILES_SOFT = ["#loading-overlay", "#rag-building-overlay"];
/** Panneaux flottants qui floutent l'arriere-plan : surface de « verre ». */
const VERRE = [".projects-dropdown", ".context-menu"];

const SOMBRE = varsOf(".theme-dark");
const CLAIR = varsOf(".theme-light");
const SOUS_THEMES = [
  ".theme-one-dark",
  ".theme-dracula",
  ".theme-nord",
  ".theme-tokyo-night",
  ".theme-github",
  ".theme-one-light",
  ".theme-solarized",
  ".theme-tokyo-day",
];

/** Literal de couleur : ce qu'aucun jeton de teinte ne doit contenir. */
const COULEUR_EN_DUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/;

describe("panneaux translucides : une seule source de teinte, dans le theme", () => {
  it("les trois jetons existent dans les deux themes de base", () => {
    for (const [nom, map] of [
      ["sombre", SOMBRE],
      ["clair", CLAIR],
    ]) {
      for (const jeton of ["--glass-tint", "--glass-scrim", "--glass-scrim-soft"]) {
        expect(map, `theme ${nom}`).toBeTruthy();
        expect(map.has(jeton), `${jeton} absent du theme ${nom}`).toBe(true);
      }
    }
  });

  it("ils derivent des variables du theme, jamais d'une couleur recopiee", () => {
    for (const map of [SOMBRE, CLAIR]) {
      for (const jeton of ["--glass-tint", "--glass-scrim", "--glass-scrim-soft"]) {
        const valeur = map.get(jeton);
        expect(valeur, jeton).toMatch(/^color-mix\(in srgb, var\(--[a-z0-9-]+\) [\d.]+%, transparent\)$/);
        expect(valeur, `${jeton} porte une couleur en dur : ${valeur}`).not.toMatch(COULEUR_EN_DUR);
      }
    }
    // La teinte du verre est celle de la surface flottante du theme.
    expect(SOMBRE.get("--glass-tint")).toContain("var(--surface-floating)");
    expect(CLAIR.get("--glass-tint")).toContain("var(--surface-floating)");
  });

  it("aucun sous-theme ne les redefinit : ils heritent donc des dix palettes", () => {
    for (const sous of SOUS_THEMES) {
      const map = varsOf(sous);
      expect(map, `${sous} introuvable`).toBeTruthy();
      for (const jeton of ["--glass-tint", "--glass-scrim", "--glass-scrim-soft"]) {
        expect(map.has(jeton), `${sous} fige ${jeton} : la teinte ne suivrait plus la palette`).toBe(
          false
        );
      }
    }
  });

  it("l'opacite du verre reste dans la plage lisible (92 % - 95 %)", () => {
    for (const [nom, map] of [
      ["sombre", SOMBRE],
      ["clair", CLAIR],
    ]) {
      const couleur = resolveColor(map.get("--glass-tint"), map);
      expect(couleur, `teinte du verre non resolue (${nom})`).toBeTruthy();
      expect(couleur.a, `verre trop transparent (${nom})`).toBeGreaterThanOrEqual(0.92);
      expect(couleur.a, `verre quasi opaque (${nom})`).toBeLessThanOrEqual(0.95);
    }
  });

  it("le voile masque vraiment, dans les deux themes", () => {
    // En sombre le voile vient du fond de l'application, en clair de l'encre :
    // un voile clair ne masquerait rien.
    const sombre = resolveColor(SOMBRE.get("--glass-scrim"), SOMBRE);
    const clair = resolveColor(CLAIR.get("--glass-scrim"), CLAIR);
    expect(sombre.a).toBeGreaterThanOrEqual(0.5);
    expect(clair.a).toBeGreaterThanOrEqual(0.2);
    // Il assombrit la page, y compris une page franchement claire.
    expect(luminance(composer(sombre, sombre.a, BLANC))).toBeLessThan(luminance(BLANC) / 2);
    expect(luminance(composer(clair, clair.a, BLANC))).toBeLessThan(luminance(BLANC));
    // Et le voile d'attente est plus leger que celui d'une modale.
    expect(resolveColor(SOMBRE.get("--glass-scrim-soft"), SOMBRE).a).toBeLessThan(sombre.a);
  });
});

describe("panneaux translucides : plus aucune couleur ecrite en dur", () => {
  it("tous les voiles prennent --glass-scrim (ou --glass-scrim-soft)", () => {
    for (const selector of VOILES) {
      const fond = declaration(blockOf(selector), "background");
      expect(fond, `voile de ${selector} introuvable`).toBe("var(--glass-scrim)");
    }
    for (const selector of VOILES_SOFT) {
      const fond = declaration(blockOf(selector), "background");
      expect(fond, `voile d'attente de ${selector} introuvable`).toBe("var(--glass-scrim-soft)");
    }
    // Aucun de ces selecteurs ne garde un noir en dur.
    for (const selector of [...VOILES, ...VOILES_SOFT]) {
      expect(declaration(blockOf(selector), "background"), selector).not.toMatch(COULEUR_EN_DUR);
    }
  });

  it("les panneaux flottants sont un verre teinte et leur flou sert enfin a quelque chose", () => {
    for (const selector of VERRE) {
      const body = blockOf(selector);
      expect(declaration(body, "background"), selector).toBe("var(--glass-tint)");
      // Le flou n'est utile que si le fond laisse passer quelque chose.
      expect(declaration(body, "backdrop-filter"), selector).toMatch(/^blur\(/);
      const couleur = resolveColor(declaration(body, "background"), SOMBRE);
      expect(couleur.a, `${selector} opaque : le flou ne montre rien`).toBeLessThan(1);
    }
  });

  it("les pastilles et lignes alternees suivent aussi le theme", () => {
    // Carte d'agent active : l'ancienne valeur etait le vert Catppuccin en dur.
    const carte = blockOf(".agent-status-card.active");
    expect(declaration(carte, "background")).toContain("color-mix(");
    expect(declaration(carte, "background")).toContain("var(--success)");
    const puce = blockOf(".agent-status-card .asc-chip.active");
    expect(declaration(puce, "background")).toContain("var(--success)");
    // Tableau CSV : alternance et survol derives du texte du theme.
    const alternee = blockOf(".csv-table tbody tr:nth-child(even)");
    expect(declaration(alternee, "background")).toContain("var(--text-primary)");
    expect(declaration(blockOf(".csv-table tbody tr:hover"), "background")).toContain(
      "var(--text-primary)"
    );
    for (const selector of [
      ".agent-status-card.active",
      ".agent-status-card .asc-chip.active",
      ".csv-table tbody tr:nth-child(even)",
      ".csv-table tbody tr:hover",
      ".agent-message-error",
      ".agent-retry-btn:hover",
    ]) {
      const fond = declaration(blockOf(selector), "background");
      expect(fond, `${selector} : ${fond}`).toBeTruthy();
      expect(fond, `${selector} garde une couleur en dur`).not.toMatch(COULEUR_EN_DUR);
    }
  });

  it("le code de la reponse de l'assistant suit le theme lui aussi", () => {
    // Voile blanc en dur = invisible en theme clair ; voile noir = illisible en
    // sombre. Les deux prennent la teinte d'encre du theme actif.
    for (const [selector, part] of [
      [".help-msg-body code", "8%"],
      [".help-msg-body pre", "6%"],
    ]) {
      const fond = declaration(blockOf(selector), "background");
      expect(fond, selector).toBe(`color-mix(in srgb, var(--text-primary) ${part}, transparent)`);
      expect(fond, selector).not.toMatch(COULEUR_EN_DUR);
    }
  });

  it("le texte des panneaux flottants reste lisible sur les dix palettes", () => {
    const palettes = [
      ["sombre", SOMBRE, true],
      ["clair", CLAIR, false],
    ];
    for (const sous of SOUS_THEMES) {
      const base = /github|one-light|solarized|tokyo-day/.test(sous) ? CLAIR : SOMBRE;
      palettes.push([sous, mergeVars(base, varsOf(sous)), null]);
    }
    for (const [nom, map, base] of palettes) {
      const teinte = resolveColor("var(--glass-tint)", map);
      const texte = resolveColor("var(--text-primary)", map);
      expect(teinte, `verre non resolu (${nom})`).toBeTruthy();
      expect(texte, `texte non resolu (${nom})`).toBeTruthy();
      const opaque = resolveColor("var(--surface-floating)", map);
      const natif = contraste(texte, opaque);
      // Le panneau flotte sur l'application : c'est SON fond qui passe derriere.
      const app = resolveColor("var(--bg-app)", map);
      const ratio = contraste(texte, composer(teinte, teinte.a, app));
      expect(
        ratio,
        `${nom} : ${ratio.toFixed(2)}:1 en verre contre ${natif.toFixed(2)}:1 opaque (perte)`
      ).toBeGreaterThanOrEqual(Math.min(SEUIL_AA, natif) - 0.05);
      // Et dans les DEUX themes de base, le seuil AA tient meme si une page de
      // l'autre camp passe derriere (PDF, image, editeur de l'autre theme).
      if (base !== null) {
        const pire = base ? BLANC : NOIR;
        const dur = contraste(texte, composer(teinte, teinte.a, pire));
        expect(dur, `${nom}, page de l'autre camp : ${dur.toFixed(2)}:1`).toBeGreaterThanOrEqual(
          SEUIL_AA
        );
      }
    }
  });
});

describe("panneaux translucides : ils suivent un changement de theme sans redemarrage", () => {
  /** Selecteurs listes par la regle `body.glass-refresh` de style.css. */
  function regleCssRafraichissement() {
    const at = css.indexOf(`body.${GLASS_REFRESH_CLASS} `);
    expect(at, "regle body.glass-refresh introuvable dans style.css").toBeGreaterThan(-1);
    const open = css.indexOf("{", at);
    const close = css.indexOf("}", open);
    const selecteurs = css
      .slice(at, open)
      .split(",")
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .map((s) => s.replace(new RegExp(`^body\\.${GLASS_REFRESH_CLASS}\\s+`), ""));
    return { selecteurs, corps: css.slice(open + 1, close) };
  }

  it("la regle retire le flou des memes surfaces que le module", () => {
    const { selecteurs, corps } = regleCssRafraichissement();
    const duModule = GLASS_SURFACE_SELECTOR.split(",").map((s) => s.trim());
    expect(selecteurs.slice().sort()).toEqual(duModule.slice().sort());
    // Sans flou, le compositeur doit recapturer son arriere-plan.
    expect(corps).toMatch(/backdrop-filter:\s*none\s*!important/);
    expect(corps).toMatch(/-webkit-backdrop-filter:\s*none\s*!important/);
    // Aucune couleur dans ce bloc : il n'y a rien a tenir a jour ici.
    expect(sansCommentaires(corps)).not.toMatch(/color|background/i);
  });

  it("l'evenement de theme n'est jamais recopie : une seule source dans theme.js", () => {
    expect(themeJs).toMatch(/export const THEME_CHANGED_EVENT = "theme-changed";/);
    // theme.js l'exporte et s'en sert pour emettre.
    expect(themeJs).toMatch(/new CustomEvent\(THEME_CHANGED_EVENT,/);
    // Il n'y a plus aucun litteral d'evenement en plus de la declaration.
    expect(themeJs.match(/"theme-changed"/g) || []).toHaveLength(1);
    // Le module de rafraichissement l'importe, il ne le recopie pas.
    expect(glassJs).toMatch(/import\s*{\s*THEME_CHANGED_EVENT\s*}\s*from\s*"\.\/theme\.js"/);
    expect(glassJs.match(/"theme-changed"/g) || []).toHaveLength(0);
  });

  it("le rafraichissement est branche au demarrage, juste apres le theme", () => {
    expect(mainJs).toMatch(
      /import\s*{\s*installGlassThemeRefresh\s*}\s*from\s*"\.\/glass-theme\.js"/
    );
    const theme = mainJs.indexOf("initTheme();");
    const install = mainJs.indexOf("installGlassThemeRefresh(window, document);");
    expect(theme, "initTheme() introuvable dans main.js").toBeGreaterThan(-1);
    expect(install, "installGlassThemeRefresh introuvable dans main.js").toBeGreaterThan(theme);
  });

  it("le module pose la classe, la retire apres une image, et ne fait rien sans surface", () => {
    const classes = new Set();
    const body = {
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c),
      },
      querySelectorAll: (sel) => (sel === GLASS_SURFACE_SELECTOR ? [{}, {}] : []),
    };
    const queue = [];
    const win = { requestAnimationFrame: (cb) => queue.push(cb), setTimeout: (cb) => queue.push(cb) };

    expect(refreshGlassSurfaces(win, { body })).toBe(2);
    expect(classes.has(GLASS_REFRESH_CLASS), "le flou n'est pas retire").toBe(true);
    // On n'enleve pas la classe avant l'image suivante : le compositeur aurait
    // le temps de garder son ancien instantane.
    expect(GLASS_REFRESH_FRAMES).toBeGreaterThanOrEqual(2);
    while (queue.length) queue.shift()();
    expect(classes.has(GLASS_REFRESH_CLASS), "la classe reste posee apres coup").toBe(false);
  });

  it("sans surface a l'ecran, il ne pose rien (aucun effet de bord)", () => {
    const classes = new Set();
    const body = {
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c),
      },
      querySelectorAll: () => [],
    };
    const win = { requestAnimationFrame: vi.fn(), setTimeout: vi.fn() };
    expect(refreshGlassSurfaces(win, { body })).toBe(0);
    expect(classes.size).toBe(0);
    expect(win.requestAnimationFrame).not.toHaveBeenCalled();
    // Et sans corps de document, il ne leve pas.
    expect(refreshGlassSurfaces({}, null)).toBe(0);
    expect(refreshGlassSurfaces(null, {})).toBe(0);
  });

  it("il ecoute l'evenement de theme, une seule fois par fenetre", () => {
    const ecouteurs = [];
    const classes = new Set();
    const body = {
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
      },
      querySelectorAll: () => [{}],
    };
    const queue = [];
    const win = {
      addEventListener: (type, fn) => ecouteurs.push({ type, fn }),
      requestAnimationFrame: (cb) => queue.push(cb),
    };
    expect(installGlassThemeRefresh(win, { body })).toBe(true);
    expect(installGlassThemeRefresh(win, { body })).toBe(false);
    expect(ecouteurs).toHaveLength(1);
    expect(ecouteurs[0].type).toBe(THEME_CHANGED_EVENT);
    // A l'emission, la classe est posee ; elle repart une fois l'image passee.
    ecouteurs[0].fn();
    expect(classes.has(GLASS_REFRESH_CLASS)).toBe(true);
    while (queue.length) queue.shift()();
    expect(classes.has(GLASS_REFRESH_CLASS)).toBe(false);
  });
});

describe("panneaux translucides : rien d'autre ne bouge", () => {
  it("aucun reglage, aucun stockage, aucune preference ajoutes", () => {
    expect(glassJs).not.toMatch(/localStorage|sessionStorage|pilot_/);
    // Le module ne fait que basculer une classe : il ne peint rien lui-meme.
    expect(sansCommentairesJs(glassJs)).not.toMatch(/style\.|backgroundColor|backdropFilter/);
  });

  it("les colonnes de l'ecran Vocal prennent la teinte du theme, jamais une couleur en dur", () => {
    // DECISION DU 2026-11-02 (remarque du proprietaire : « la transparence ne se
    // voit pas »). Les deux colonnes ne portaient AUCUN fond : un filet de 1 px
    // devant un `--bg-app` uni. Elles portent maintenant une surface de verre,
    // et elle obeit aux memes trois regles que les panneaux flottants :
    //   - la teinte vient du THEME (`--vocal-glass`, un melange de
    //     `--glass-tint`), jamais d'une couleur ecrite ici ;
    //   - elle reste translucide (le melange laisse passer le fond du calque) ;
    //   - le flou est celui des panneaux, et il est rafraichi au changement de
    //     theme (les colonnes sont dans `GLASS_SURFACE_SELECTOR`).
    const verre = css.match(
      /\.vocal-side-discussion,\s*\n?\.vocal-side-tasks\s*\{[^}]*background-color[^}]*\}/,
    );
    expect(verre, "la surface des deux colonnes est introuvable").toBeTruthy();
    expect(declaration(verre[0], "background-color")).toBe("var(--vocal-glass)");
    expect(verre[0]).not.toMatch(COULEUR_EN_DUR);
    expect(declaration(verre[0], "backdrop-filter")).toBe("blur(12px)");
    // Le jeton n'est pas une couleur : c'est un melange du theme actif.
    const jeton = declaration(blockOf(".pilot-vocal"), "--vocal-glass");
    expect(jeton).toContain("var(--glass-tint)");
    expect(jeton).toMatch(/color-mix\(/);
    expect(jeton).not.toMatch(COULEUR_EN_DUR);
    // Le CALQUE, lui, ne floute rien : sa propre surface est peinte une fois et
    // le flou des colonnes lit ce qu'il y a derriere (les deux lavis).
    expect(declaration(blockOf(".pilot-vocal"), "backdrop-filter")).toBeNull();
    // Et les surfaces qui derivent deja du theme n'ont pas bouge.
    for (const selector of [".vocal-msg-user", ".vocal-restart"]) {
      const fond = declaration(blockOf(selector), "background");
      expect(fond, selector).toContain("var(--text-primary)");
      expect(fond, selector).not.toMatch(COULEUR_EN_DUR);
    }
  });

  it("l'interface web distante prend le meme voile, teinte par son theme", () => {
    const racine = blockOf(":root", cssWeb);
    const clair = blockOf('html[data-theme="light"]', cssWeb);
    expect(declaration(racine, "--scrim"), "--scrim absent du theme web sombre").toBeTruthy();
    expect(declaration(clair, "--scrim"), "--scrim absent du theme web clair").toBeTruthy();
    const overlay = blockOf(".modal-overlay", cssWeb);
    expect(declaration(overlay, "background")).toBe("var(--scrim)");
    expect(declaration(overlay, "background")).not.toMatch(COULEUR_EN_DUR);
  });
});
