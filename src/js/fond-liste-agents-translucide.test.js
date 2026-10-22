/**
 * Garde-fou du FOND de la liste des agents (le cercle en haut a droite).
 *
 * Demande du proprietaire : le fond de la liste etait totalement opaque, il
 * doit devenir SUBTILEMENT translucide (apercevoir la page derriere), sans
 * jamais sacrifier la lisibilite. Les pastilles, le cercle d'activite et la
 * fiche agent ne changent pas.
 *
 * Choix retenu (reglages uniques dans `#agent-activity-dropdown`) :
 *   - `--agent-activity-panel-base`  : la teinte du fond, INCHANGEE
 *     (`color-mix(--superagent-accent 16%, --surface-3)`) - aucune couleur en
 *     dur, la teinte de l'assistant et les surfaces de theme restent la source ;
 *   - `--agent-activity-panel-alpha` : l'opacite de cette teinte, 94 %.
 *   La translucidation n'est appliquee QUE si `backdrop-filter` existe (flou
 *   d'arriere-plan tres faible, 2 px). Sinon la regle de base (fond OPAQUE,
 *   rendu historique) reste seule en vigueur : repli lisible garanti.
 *
 * Ce fichier echoue si :
 *   1. le fond redevient totalement opaque (ou sort de la plage 92 % - 95 %) ;
 *   2. la translucidation se fait sans flou d'arriere-plan possible (pas de
 *      repli opaque) ou avec une couleur ecrite en dur ;
 *   3. le libelle de la liste peut passer sous le seuil AA (4,5:1) dans l'un
 *      des deux themes de reference, y compris dans le pire cas de ce qui peut
 *      passer derriere (page claire / page sombre, image, PDF) ;
 *   4. une couleur de texte de la liste perd en contraste avec le fond
 *      d'editeur du theme derriere (non-regression, tous sous-themes) ;
 *   5. le cercle d'activite, les pastilles ou la fiche agent sont alteres.
 *
 * Aucun navigateur n'est requis : lecture du fichier de styles (fins de ligne
 * normalisees, cf. quality-gate 3.4).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const css = readFileSync(resolve(ROOT, "src/css/style.css"), "utf8").replace(/\r\n/g, "\n");

/** Plage d'opacite autorisee (92 % - 95 %, demande : "legerement transparent"). */
const ALPHA_MIN = 0.92;
const ALPHA_MAX = 0.95;
/** Seuil WCAG 2.1 AA pour du texte normal. */
const SEUIL_AA = 4.5;

const ROUGE = { r: 255, g: 255, b: 255, a: 1 };
const NOIR = { r: 0, g: 0, b: 0, a: 1 };

const sansCommentaires = (texte) => String(texte).replace(/\/\*[\s\S]*?\*\//g, "");

/** Corps de la premiere regle dont le selecteur vaut exactement `selector`. */
function blockOf(selector) {
  const needle = `${selector} {`;
  const at = css.indexOf(needle);
  if (at < 0) return null;
  const end = css.indexOf("}", at);
  return end < 0 ? null : css.slice(at + needle.length, end);
}

/** Carte des proprietes personnalisees (`--nom: valeur;`) d'un bloc. */
function varsOf(selector) {
  const body = blockOf(selector);
  if (body === null) return null;
  const map = new Map();
  for (const m of sansCommentaires(body).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    map.set(m[1], m[2].trim());
  }
  return map;
}

/** Fusionne deux cartes de variables (le second ecrase le premier). */
function mergeVars(base, over) {
  return new Map([...(base || new Map()), ...(over || new Map())]);
}

/** Blocs `@<nom> ... { ... }` du fichier de styles (accolades appariees). */
function atRuleBlocks(nom) {
  const blocs = [];
  const needle = `@${nom}`;
  let i = css.indexOf(needle);
  while (i >= 0) {
    const open = css.indexOf("{", i);
    if (open < 0) break;
    let depth = 0;
    let j = open;
    for (; j < css.length; j++) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    blocs.push({
      condition: css.slice(i + needle.length, open).trim(),
      corps: css.slice(open + 1, j),
    });
    i = css.indexOf(needle, j + 1);
  }
  return blocs;
}

/** Decoupe les arguments de premier niveau d'un appel CSS. */
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

/**
 * Resout une valeur CSS de couleur : `var(--x[, repli])`, `#rrggbb`,
 * `transparent` et `color-mix(in srgb, <couleur> <p>%, <couleur> [<q>%])`.
 * Retourne `{ r, g, b, a }` (canaux 0-255, alpha 0-1) ou null.
 */
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
    // Melange premultiplie (regle CSS de color-mix).
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

/** Canal sRGB -> luminance lineaire (WCAG). */
function linear(canal) {
  const c = canal / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Luminance relative d'une couleur resolue. */
function luminance(couleur) {
  return 0.2126 * linear(couleur.r) + 0.7152 * linear(couleur.g) + 0.0722 * linear(couleur.b);
}

/** Rapport de contraste WCAG entre deux couleurs resolues. */
function contraste(avant, arriere) {
  const a = luminance(avant);
  const b = luminance(arriere);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Compose une couleur semi-transparente sur un fond (alpha " over "). */
function composer(couleur, alpha, fond) {
  return {
    r: couleur.r * alpha + fond.r * (1 - alpha),
    g: couleur.g * alpha + fond.g * (1 - alpha),
    b: couleur.b * alpha + fond.b * (1 - alpha),
    a: 1,
  };
}

/** Couleur `color:` d'une regle, resolue dans la carte de variables fournie. */
function colorOf(selector, map) {
  const body = blockOf(selector);
  if (body === null) return null;
  const m = sansCommentaires(body).match(/(?:^|[;\s])color\s*:\s*([^;]+);/);
  return m ? resolveColor(m[1], map) : null;
}

/** Valeur de la premiere declaration `propriete:` d'un corps de regle. */
function declaration(body, propriete) {
  const clean = sansCommentaires(body);
  const m = clean.match(new RegExp(`(?:^|[;{])\\s*${propriete}\\s*:\\s*([\\s\\S]*?);`, "i"));
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

/** Opacite du fond de la liste, lue dans le fichier de styles. */
function opaciteFond() {
  const valeur = varsOf("#agent-activity-dropdown")?.get("--agent-activity-panel-alpha");
  expect(valeur, "--agent-activity-panel-alpha introuvable").toBeTruthy();
  expect(valeur, `opacite inattendue : ${valeur}`).toMatch(/^[\d.]+%$/);
  return parseFloat(valeur) / 100;
}

/** Expression de la teinte du fond (source unique, sans couleur en dur). */
function teinteFond() {
  const valeur = varsOf("#agent-activity-dropdown")?.get("--agent-activity-panel-base");
  expect(valeur, "--agent-activity-panel-base introuvable").toBeTruthy();
  return valeur;
}

/** Bloc `@supports` qui porte le fond translucide de la liste. */
function blocSupportsFond() {
  return atRuleBlocks("supports").find((b) => b.corps.includes("#agent-activity-dropdown {"));
}

const SOMBRE = varsOf(".theme-dark");
const CLAIR = varsOf(".theme-light");

/** Sous-themes declares dans le fichier de styles. */
const SOUS_THEMES_SOMBRES = [
  ".theme-one-dark",
  ".theme-dracula",
  ".theme-nord",
  ".theme-tokyo-night",
];
const SOUS_THEMES_CLAIRS = [
  ".theme-github",
  ".theme-one-light",
  ".theme-solarized",
  ".theme-tokyo-day",
];

/** Les deux themes de reference + leurs sous-themes, avec leur pire page derriere. */
const THEMES = [
  {
    nom: "sombre",
    base: SOMBRE,
    pirePage: ROUGE, // texte clair : c'est une page CLAIRE qui l'ecrase le plus
    sous: SOUS_THEMES_SOMBRES,
    classeSous: "theme-dark",
  },
  {
    nom: "clair",
    base: CLAIR,
    pirePage: NOIR, // texte sombre : c'est une page SOMBRE qui l'ecrase le plus
    sous: SOUS_THEMES_CLAIRS,
    classeSous: "theme-light",
  },
];

/** Couleurs de texte de la liste, telles qu'elles sont peintes. */
const TEXTES = [
  { selector: ".agent-activity-item", quoi: "libelle (--text-primary)" },
  {
    selector: '.agent-activity-item[data-kind="superagent"] .agent-activity-item-label',
    quoi: "libelle de l'assistant (--superagent-accent)",
  },
  { selector: ".agent-activity-item-project", quoi: "projet (--text-muted)" },
];

describe("fond de la liste des agents : subtilement translucide", () => {
  it("le fond translucide existe et son opacite est dans la plage 92 % - 95 %", () => {
    const bloc = blocSupportsFond();
    expect(bloc, "aucun bloc @supports ne peint le fond de la liste").toBeTruthy();
    expect(bloc.condition).toMatch(/backdrop-filter/i);
    const fond = declaration(bloc.corps, "background");
    expect(fond, "fond translucide introuvable").toBeTruthy();
    // La translucidation se fait par l'opacite de la teinte existante.
    expect(fond).toContain("color-mix(");
    expect(fond).toMatch(/\btransparent\b/);
    expect(fond).toContain("var(--agent-activity-panel-alpha)");

    const alpha = opaciteFond();
    expect(alpha, `fond trop opaque (${alpha})`).toBeLessThan(1);
    expect(alpha, `fond quasi opaque (${alpha}) : la page ne se devine plus`).toBeLessThanOrEqual(
      ALPHA_MAX
    );
    expect(alpha, `fond trop transparent (${alpha}) : lisibilite en danger`).toBeGreaterThanOrEqual(
      ALPHA_MIN
    );
  });

  it("le repli sans flou d'arriere-plan reste OPAQUE (jamais translucide sans flou)", () => {
    const body = blockOf("#agent-activity-dropdown");
    expect(body, "regle #agent-activity-dropdown introuvable").toBeTruthy();
    const fond = declaration(body, "background");
    expect(fond, "fond de repli introuvable").toBe("var(--agent-activity-panel-base)");
    // La flou est bien declare dans le bloc @supports (pas dans la regle de base).
    expect(blocSupportsFond().corps).toMatch(/backdrop-filter:\s*blur\(/);
    for (const [nom, map] of [
      ["sombre", SOMBRE],
      ["clair", CLAIR],
    ]) {
      const couleur = resolveColor(fond, mergeVars(map, varsOf("#agent-activity-dropdown")));
      expect(couleur, `fond de repli non resolu (${nom})`).toBeTruthy();
      expect(couleur.a, `fond de repli translucide en theme ${nom}`).toBe(1);
    }
  });

  it("aucune couleur ecrite en dur : la teinte de l'assistant et les surfaces restent la source", () => {
    const corps = sansCommentaires(blockOf("#agent-activity-dropdown"));
    // La teinte de base est un melange de variables de theme existantes.
    expect(teinteFond()).toMatch(/var\(--superagent-accent\)/);
    expect(teinteFond()).toMatch(/var\(--surface-3\)/);
    // Ni la teinte, ni le fond translucide ne portent de couleur litterale.
    const literaux = /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/;
    expect(teinteFond()).not.toMatch(literaux);
    const fondTranslucide = declaration(blocSupportsFond().corps, "background");
    expect(fondTranslucide).not.toMatch(literaux);
    expect(corps).not.toMatch(/background\s*:\s*#[0-9a-fA-F]{3,8}/);
  });
});

describe("fond de la liste des agents : lisibilite du texte", () => {
  it("le libelle reste au-dessus du seuil AA dans les deux themes, meme au pire", () => {
    const alpha = opaciteFond();
    for (const theme of THEMES) {
      const map = theme.base;
      const teinte = resolveColor(teinteFond(), map);
      const libelle = colorOf(".agent-activity-item", map);
      expect(teinte, `teinte du fond non resolue (${theme.nom})`).toBeTruthy();
      expect(libelle, `couleur du libelle non resolue (${theme.nom})`).toBeTruthy();
      // Pire cas : page franchement claire / franchement sombre derriere la
      // liste (PDF, image, editeur de l'autre theme), + fond d'editeur du theme.
      const fonds = {
        "fond d'editeur du theme": resolveColor("var(--bg-editor)", map),
        "page blanche": ROUGE,
        "page noire": NOIR,
      };
      for (const [quoi, derriere] of Object.entries(fonds)) {
        const fond = composer(teinte, alpha, derriere);
        const ratio = contraste(libelle, fond);
        expect(
          ratio,
          `theme ${theme.nom}, ${quoi} : libelle a ${ratio.toFixed(2)}:1 (< ${SEUIL_AA}:1)`
        ).toBeGreaterThanOrEqual(SEUIL_AA);
      }
    }
  });

  it("aucune couleur de texte ne perd en contraste (tous les themes)", () => {
    const alpha = opaciteFond();
    for (const theme of THEMES) {
      const cartes = [["(defaut)", theme.base]];
      for (const sous of theme.sous) {
        cartes.push([sous, mergeVars(theme.base, varsOf(sous))]);
      }
      for (const [nom, map] of cartes) {
        const teinte = resolveColor(teinteFond(), map);
        const editeur = resolveColor("var(--bg-editor)", map);
        const translucide = composer(teinte, alpha, editeur);
        for (const texte of TEXTES) {
          const couleur = colorOf(texte.selector, map);
          expect(couleur, `${theme.nom} ${nom} : ${texte.quoi} non resolu`).toBeTruthy();
          const avant = contraste(couleur, teinte);
          const apres = contraste(couleur, translucide);
          expect(
            apres,
            `${theme.nom} ${nom} : ${texte.quoi} passe de ${avant.toFixed(2)}:1 a ` +
              `${apres.toFixed(2)}:1 (regression)`
          ).toBeGreaterThanOrEqual(avant - 0.005);
        }
      }
    }
  });
});

describe("fond de la liste des agents : rien d'autre ne bouge", () => {
  it("le cercle d'activite, les pastilles et la fiche agent gardent leur rendu", () => {
    // Cercle : attenue au repos, plein quand il respire.
    expect(declaration(blockOf("#agent-activity-dot"), "opacity")).toBe("0.6");
    const respiration = blockOf("#agent-activity-dot.breathing");
    expect(declaration(respiration, "opacity")).toBe("1");
    expect(declaration(respiration, "background")).toBe("var(--superagent-accent)");
    // Pastilles : attenuees au repos, pleines et lumineuses quand l'agent travaille.
    expect(declaration(blockOf(".agent-activity-item-dot"), "opacity")).toBe("0.5");
    const pastilleActive = blockOf(".agent-activity-item-dot.breathing");
    expect(declaration(pastilleActive, "opacity")).toBe("1");
    expect(declaration(pastilleActive, "background")).toBe("var(--accent)");
    expect(declaration(pastilleActive, "animation")).toMatch(/agent-pulse/);
    // Fiche agent : fond opaque inchange.
    const fiche = blockOf("#agent-activity-card");
    expect(declaration(fiche, "background")).toBe("var(--surface-2)");
  });

  it("la liste reste peinte par la meme regle (ouverture, contenu, ombre intactes)", () => {
    const body = blockOf("#agent-activity-dropdown");
    expect(declaration(body, "box-shadow")).toContain("rgba(0, 0, 0, 0.35)");
    expect(declaration(body, "border-radius")).toBe("var(--radius-sm)");
    expect(declaration(body, "z-index")).toBe("10001");
    expect(css).toContain("#agent-activity-dropdown.hidden { display: none; }");
  });
});
