/**
 * Garde-fou de lisibilite du panneau des evenements systeme (la « cloche » de
 * l'onglet Assistant) en mode sombre.
 *
 * Constat mesure : les lignes du panneau `#superagent-events-panel` etaient
 * peintes avec `--text-secondary` (texte) et `--text-muted` (horodatage) sur
 * `--surface-floating`. En theme sombre par defaut cela donnait 6.76:1 pour le
 * texte (sous le seuil AAA de 7:1) et 3.41:1 pour l'horodatage (sous le seuil
 * AA de 4.5:1) : les rappels et evenements se lisaient mal.
 *
 * Correctif : deux jetons dedies, `--sa-events-text` et `--sa-events-time`,
 * definis dans les deux themes. En sombre ils pointent vers le primaire et le
 * secondaire (aucune couleur en dur, donc chaque sous-theme sombre suit sa
 * propre palette) ; en clair ils reprennent exactement les anciennes valeurs,
 * pour que l'apparence du mode clair ne bouge pas.
 *
 * Ce test echoue si le contraste du texte des evenements en mode sombre
 * retombe sous le seuil vise, si un jeton disparait, si une couleur est ecrite
 * en dur, ou si le mode clair change. Aucun navigateur n'est requis : simple
 * lecture du fichier de styles (fins de ligne normalisees, cf. quality-gate).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const css = readFileSync(resolve(ROOT, "src/css/style.css"), "utf8").replace(/\r\n/g, "\n");

/** Seuils vises (WCAG 2.1 : AA = 4.5:1, AAA = 7:1 pour du texte normal). */
const SEUIL_TEXTE_SOMBRE = 10; // texte des evenements, theme sombre par defaut
const SEUIL_HEURE_SOMBRE = 6; // horodatage, theme sombre par defaut
const SEUIL_TEXTE_SOUS_THEME = 4.5; // plancher AA pour tout sous-theme sombre
const SEUIL_HEURE_SOUS_THEME = 4; // plancher des horodatages des sous-themes

/** Sous-themes sombres (blocs `body.theme-dark.theme-*` du fichier de styles). */
const SOUS_THEMES_SOMBRES = [
  "body.theme-dark.theme-one-dark",
  "body.theme-dark.theme-dracula",
  "body.theme-dark.theme-nord",
  "body.theme-dark.theme-tokyo-night",
];

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
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    map.set(m[1], m[2].trim());
  }
  return map;
}

/** Fusionne deux cartes de variables (le second ecrase le premier). */
function mergeVars(base, over) {
  return new Map([...(base || new Map()), ...(over || new Map())]);
}

/**
 * Evalue une valeur CSS en resolvant les `var(--x)` / `var(--x, repli)`,
 * y compris imbriques. Retourne null si rien ne se resout.
 */
function evalValue(map, value, depth = 0) {
  if (value == null || depth > 10) return null;
  const text = String(value).trim();
  if (!/^var\(/i.test(text)) return text;
  const inner = text.slice(text.indexOf("(") + 1, text.lastIndexOf(")"));
  const comma = inner.indexOf(",");
  const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
  const fallback = comma < 0 ? null : inner.slice(comma + 1).trim();
  const direct = map && map.has(name) ? evalValue(map, map.get(name), depth + 1) : null;
  if (direct) return direct;
  return fallback ? evalValue(map, fallback, depth + 1) : null;
}

/** Couleur `color:` d'une regle, resolue dans le theme `map`. */
function colorOf(selector, map) {
  const body = blockOf(selector);
  if (body === null) return null;
  const m = body.match(/(?:^|[;\s])color\s*:\s*([^;]+);/);
  return m ? evalValue(map, m[1]) : null;
}

/** Canal sRGB -> luminance lineaire (WCAG). */
function linear(channel) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Luminance relative d'une couleur `#rrggbb`. */
function luminance(hex) {
  const n = String(hex || "").trim().replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(n)) throw new Error(`couleur inattendue : ${hex}`);
  return (
    0.2126 * linear(parseInt(n.slice(0, 2), 16)) +
    0.7152 * linear(parseInt(n.slice(2, 4), 16)) +
    0.0722 * linear(parseInt(n.slice(4, 6), 16))
  );
}

/** Rapport de contraste WCAG entre deux couleurs. */
function contraste(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

/** Fond du panneau cloche tel que peint par le CSS (variable de theme). */
function fondPanneau(map) {
  return evalValue(map, "var(--surface-floating)");
}

const SOMBRE = varsOf(".theme-dark");
const CLAIR = varsOf(".theme-light");

describe("jetons de lisibilite du panneau des evenements", () => {
  it("les deux themes definissent --sa-events-text et --sa-events-time", () => {
    for (const [nom, map] of [["sombre", SOMBRE], ["clair", CLAIR]]) {
      expect(map, `bloc de theme ${nom} introuvable`).not.toBeNull();
      expect(map.has("--sa-events-text"), `--sa-events-text manquant (${nom})`).toBe(true);
      expect(map.has("--sa-events-time"), `--sa-events-time manquant (${nom})`).toBe(true);
    }
  });

  it("le texte et l'horodatage passent par les jetons, sans couleur en dur", () => {
    const texte = blockOf(".sa-events-text");
    const heure = blockOf(".sa-events-time");
    expect(texte).toMatch(/color\s*:\s*var\(--sa-events-text\b/);
    expect(heure).toMatch(/color\s*:\s*var\(--sa-events-time\b/);
    // Aucune couleur litterale : tout vient des variables de theme.
    const sansVars = (body) => String(body).replace(/var\([^)]*\)/g, "");
    expect(sansVars(texte)).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(/);
    expect(sansVars(heure)).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(/);
  });
});

describe("contraste du panneau des evenements en mode sombre", () => {
  it("theme sombre par defaut : texte >= 10:1 et horodatage >= 6:1", () => {
    const fond = fondPanneau(SOMBRE);
    const texte = colorOf(".sa-events-text", SOMBRE);
    const heure = colorOf(".sa-events-time", SOMBRE);
    const ratioTexte = contraste(texte, fond);
    const ratioHeure = contraste(heure, fond);
    expect(ratioTexte, `texte ${texte} sur ${fond} = ${ratioTexte.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      SEUIL_TEXTE_SOMBRE
    );
    expect(ratioHeure, `horodatage ${heure} sur ${fond} = ${ratioHeure.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      SEUIL_HEURE_SOMBRE
    );
  });

  it("chaque sous-theme sombre gagne en lisibilite (texte et horodatage)", () => {
    for (const sel of SOUS_THEMES_SOMBRES) {
      const map = mergeVars(SOMBRE, varsOf(sel));
      const fond = fondPanneau(map);
      const avantTexte = evalValue(map, "var(--text-secondary)");
      const avantHeure = evalValue(map, "var(--text-muted)");
      const texte = colorOf(".sa-events-text", map);
      const heure = colorOf(".sa-events-time", map);
      expect(texte, `${sel} : couleur du texte non resolue`).toBeTruthy();
      expect(heure, `${sel} : couleur de l'horodatage non resolue`).toBeTruthy();
      const ratioTexte = contraste(texte, fond);
      const ratioHeure = contraste(heure, fond);
      expect(ratioTexte, `${sel} : texte = ${ratioTexte.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        SEUIL_TEXTE_SOUS_THEME
      );
      expect(ratioHeure, `${sel} : horodatage = ${ratioHeure.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        SEUIL_HEURE_SOUS_THEME
      );
      // Strictement meilleur que les anciennes couleurs : une regression vers
      // --text-secondary / --text-muted fait rougir ce test.
      expect(ratioTexte, `${sel} : pas de gain de contraste sur le texte`).toBeGreaterThan(
        contraste(avantTexte, fond)
      );
      expect(ratioHeure, `${sel} : pas de gain de contraste sur l'horodatage`).toBeGreaterThan(
        contraste(avantHeure, fond)
      );
    }
  });
});

describe("mode clair inchange", () => {
  it("texte et horodatage gardent exactement les couleurs d'avant", () => {
    // Valeurs figees = rendu du mode clair AVANT le correctif (--text-secondary
    // et --text-muted du theme clair). Toute modification fera rougir ce test.
    expect(colorOf(".sa-events-text", CLAIR)).toBe("#5a6170");
    expect(colorOf(".sa-events-time", CLAIR)).toBe("#8a91a0");
  });

  it("les jetons du theme clair renvoient aux variables d'origine", () => {
    expect(CLAIR.get("--sa-events-text")).toBe("var(--text-secondary)");
    expect(CLAIR.get("--sa-events-time")).toBe("var(--text-muted)");
  });
});
