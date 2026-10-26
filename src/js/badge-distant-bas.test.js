/**
 * Verrou — LE BADGE « DISTANT » EST DANS LA LIGNE DU BAS DE LA COLONNE.
 *
 * Decision du proprietaire n° 375 (base de suivi de l'assistant), ferme :
 *   « Le badge descend EN BAS de la colonne de gauche, A DROITE de la ligne
 *     d'information qui nomme le moteur (du genre « Agent Pi (Suivi) »). »
 *   La proposition qui le placait dans la barre du haut est ECARTEE.
 * Document de la mission : `RAPPORT-badge-distant-bas.md`.
 *
 * Ce qui est verifie ici, et rien d'autre :
 *   (a) le badge a QUITTE le haut de la colonne (`#global-actions`) et vit dans
 *       la LIGNE D'INFORMATION DU BAS (`#sidebar-engine-row`), dernier enfant de
 *       `#sidebar`, SOUS le bloc accentue des menus ;
 *   (b) il est A DROITE du texte qui nomme le moteur (ordre du DOM : texte
 *       d'abord, badge ensuite) ;
 *   (c) la ligne liberee en haut ne laisse AUCUN trou (conteneur vide, marges et
 *       padding a 0, aucune hauteur minimale) ;
 *   (d) la colonne reste a 280 px et tout tient dedans : le TEXTE se reduit
 *       avant le badge (`min-width: 0` + ellipse), le badge ne se reduit ni ne
 *       grossit (`flex: 0 0 auto`, largeur au contenu), rien n'est rogne ;
 *   (e) le badge n'est pas devenu un bouton, il garde son libelle, son compteur,
 *       son infobulle et son clic ; le texte du moteur ne change pas et n'est
 *       pas duplique ;
 *   (f) le bandeau du haut garde ses 48 px et son logo.
 *
 * REGLE DE CALCUL : aucune valeur n'est figee ici. La largeur de la colonne, la
 * hauteur du badge et de sa ligne, les marges, le padding, l'icone et la taille
 * de police sont LUS dans `src/css/style.css` et dans `index.html`, puis
 * combines — si l'un de ces nombres change, le test recalcule au lieu de mentir.
 *
 * Ce fichier echoue si le badge remonte en haut de la colonne (c'est le sens
 * meme de ce verrou) : `badge_dans_la_ligne_du_bas` repasse a `false`.
 *
 * Aucun navigateur n'est requis : lecture des fichiers (fins de ligne
 * normalisees, cf. quality-gate 3.4).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// Decoupage de source VERIFIE : une ancre absente echoue au lieu de rendre une
// assertion negative vraie par construction.
import { sliceSource } from "./source-slice.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lire = (...p) =>
  readFileSync(resolve(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

const html = lire("index.html");
const css = lire("src/css/style.css");
const settingsJs = lire("src/js/settings.js");
const tauriConf = JSON.parse(lire("src-tauri/tauri.conf.json"));

// ── Lecture du CSS : blocs de regle et declarations ─────────────────────────

/** Blocs dont le selecteur est ecrit EXACTEMENT `selector {`. */
function blocs(source, selector) {
  const echappe = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\n)${echappe} \\{([^}]*)\\}`, "g");
  const trouves = [];
  let m;
  while ((m = re.exec(source)) !== null) trouves.push(m[1]);
  return trouves;
}

/** Le bloc doit exister : un selecteur renomme fait echouer la lecture. */
function bloc(selector) {
  const trouves = blocs(css, selector);
  expect(trouves.length, `regle CSS absente : ${selector}`).toBeGreaterThan(0);
  return trouves.join("\n");
}

/** Declarations `prop: valeur;` d'un bloc, blancs normalises. */
const declarations = (corps) => corps.replace(/\s+/g, " ").toLowerCase();

/** Valeur d'une propriete dans un bloc (chaine vide si absente). */
function valeur(selector, propriete) {
  const m = declarations(bloc(selector)).match(
    new RegExp(`(?:^| )${propriete}: ([^;]+);`),
  );
  return m ? m[1].trim() : "";
}

/** Un jeton de theme (`--font-xs`, `--radius-sm`…) lu dans la feuille. */
function jeton(nom) {
  const m = css.match(new RegExp(`--${nom}:\\s*([^;]+);`));
  expect(m, `jeton de theme absent : --${nom}`).not.toBeNull();
  return m[1].trim();
}

/** Remplace `var(--x)` par sa valeur, puis rend un nombre de pixels. */
function px(brut) {
  const resolu = String(brut).replace(/var\((--[a-z0-9-]+)\)/g, (_, nom) =>
    jeton(nom.slice(2)),
  );
  const n = parseFloat(resolu);
  expect(Number.isFinite(n), `valeur CSS non numerique : ${brut}`).toBe(true);
  return n;
}

/** Somme horizontale d'un raccourci `margin` / `padding` (top h bottom…). */
function horizontal(brut) {
  const parts = String(brut).trim().split(/\s+/).map(px);
  if (parts.length === 1) return parts[0] * 2;
  if (parts.length === 3) return parts[1] * 2;
  if (parts.length === 4) return parts[1] + parts[3];
  return parts[1] * 2; // 2 valeurs (vertical / horizontal)
}

/** Hauteur basse d'un raccourci `margin` / `padding`. */
function bas(brut) {
  const parts = String(brut).trim().split(/\s+/).map(px);
  if (parts.length === 1) return parts[0];
  if (parts.length === 3) return parts[2];
  if (parts.length === 4) return parts[2];
  return parts[0]; // 2 valeurs (vertical / horizontal)
}

/** Largeur estimee d'un texte (majoree : 0,62 em par caractere). */
function largeurTexte(texte, policePx) {
  return texte.length * policePx * 0.62;
}

// ── Lecture du HTML : les deux emplacements ────────────────────────────────

const BALISE_GLOBAL = '<div id="global-actions">';
const BALISE_LIGNE = '<div id="sidebar-engine-row">';

/** Contenu du conteneur du haut (vide depuis la decision 375). */
function contenuDuHaut() {
  const m = html.match(/<div id="global-actions">([\s\S]*?)\n    <\/div>/);
  if (!m) throw new Error("conteneur #global-actions introuvable");
  return m[1];
}

/** La colonne entiere, pour prouver l'ordre de ses enfants. */
const colonne = sliceSource(html, '<aside id="sidebar">', "</aside>", 1000);

/** Le contenu de la ligne d'information du bas (jusqu'a la fin de `#sidebar`). */
const contenuLigne = sliceSource(html, BALISE_LIGNE, "</aside>", 100);

/** Le bloc du bas (menus), pour prouver que la ligne d'info vient APRES lui. */
const contenuPied = sliceSource(html, '<div id="project-footer"', "</aside>", 500);

const badge = html.match(/<span id="remote-badge"[\s\S]*?<\/b><\/span>/);
if (!badge) throw new Error("badge #remote-badge introuvable");

/** Libelle ecrit par `main.js` depuis la source unique (`backend-info.js`). */
const TEXTE_MOTEUR = "Moteur · Agent Pi";

/**
 * Calcul central, refait a partir du disque : le badge est-il dans la ligne du
 * bas, a droite du texte du moteur, et plus en haut ?
 */
function badge_dans_la_ligne_du_bas() {
  const contenuHaut = contenuDuHaut();
  const dansLeHaut = contenuHaut.includes('id="remote-badge"');
  const dansLaLigne = contenuLigne.includes('id="remote-badge"');
  const apresLeBlocDesMenus = contenuPied.includes('id="remote-badge"');
  const texteAvantBadge =
    contenuLigne.indexOf('id="project-engine"') > -1 &&
    contenuLigne.indexOf('id="project-engine"') <
      contenuLigne.indexOf('id="remote-badge"');
  return dansLaLigne && !dansLeHaut && apresLeBlocDesMenus && texteAvantBadge;
}

describe("Decision 375 — le badge « Distant » est en bas, a droite du moteur", () => {
  it("le badge est dans la ligne du bas, et plus dans le haut de la colonne", () => {
    // Ce seul booleen resume la decision : s'il repasse a `false`, le badge est
    // remonte en haut (ou a gauche du texte) et le test rougit.
    expect(
      badge_dans_la_ligne_du_bas(),
      "le badge doit etre DANS #sidebar-engine-row, APRES #project-engine, et " +
        "ne doit plus etre dans #global-actions",
    ).toBe(true);
    // Aucune trace du badge dans le haut : ni l'element, ni son libelle.
    expect(contenuDuHaut()).not.toContain('id="remote-badge"');
    expect(contenuDuHaut()).not.toContain("remote-badge-label");
    // Un seul badge dans toute la page (aucun doublon cree par le deplacement).
    expect(html.split('id="remote-badge"').length - 1).toBe(1);
  });

  it("la ligne du bas est le DERNIER element de la colonne, sous les menus", () => {
    // Ordre dans `#sidebar` : bandeau → liste → bloc des menus → ligne d'info.
    expect(html.indexOf(BALISE_LIGNE)).toBeGreaterThan(
      html.indexOf(BALISE_GLOBAL),
    );
    expect(html.indexOf('id="project-footer"')).toBeLessThan(
      html.indexOf(BALISE_LIGNE),
    );
    expect(html.indexOf(BALISE_LIGNE)).toBeLessThan(html.indexOf("</aside>"));
    // Elle FERME la colonne : aucun autre `#id` de bloc n'apparait apres elle.
    const ids = [...colonne.matchAll(/<div id="([a-z-]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(2);
    expect(ids[ids.length - 1]).toBe("sidebar-engine-row");
    // Et elle ne contient que les deux elements attendus (le texte, le badge).
    expect(contenuLigne.match(/<span id=/g) || []).toHaveLength(2);
  });

  it("le badge est A DROITE du texte (ordre du DOM, texte d'abord)", () => {
    const moteur = contenuLigne.indexOf('id="project-engine"');
    const badgePos = contenuLigne.indexOf('id="remote-badge"');
    expect(moteur).toBeGreaterThan(-1);
    expect(badgePos).toBeGreaterThan(moteur);
    // Et le badge est cale a droite par la marge automatique de gauche, meme
    // quand le texte du moteur est absent (avant la premiere sonde).
    expect(valeur(".remote-badge", "margin")).toBe("0 0 0 auto");
  });

  it("la ligne liberee en haut ne laisse aucun trou", () => {
    // Le conteneur du haut est vide : aucun element, aucun texte.
    expect(contenuDuHaut().replace(/<!--[\s\S]*?-->/g, "").trim()).toBe("");
    const d = declarations(bloc("#global-actions"));
    expect(d).toContain("margin: 0;");
    expect(d).toContain("padding: 0;");
    expect(d).not.toMatch(/min-height:\s*\d/);
    // Et rien n'est reserve ailleurs pour l'ancienne ligne : la ligne d'info a
    // une hauteur propre, elle ne « reprend » pas celle du haut.
    expect(px(valeur("#sidebar-engine-row", "height"))).toBeGreaterThan(0);
  });
});

describe("Decision 375 — la colonne reste a 280 px et rien ne deborde", () => {
  const largeurColonne = px(valeur("#sidebar", "width"));
  const largeurMini = px(valeur("#sidebar", "min-width"));
  const margeLigne = horizontal(valeur("#sidebar-engine-row", "margin"));
  const paddingLigne = horizontal(valeur("#sidebar-engine-row", "padding"));
  const espaceLigne = px(valeur("#sidebar-engine-row", "gap"));
  const hauteurBadge = px(valeur(".remote-badge", "height"));
  const hauteurLigne = px(valeur("#sidebar-engine-row", "height"));
  const policeBadge = px(valeur(".remote-badge", "font-size"));
  const largeurIcone = px(valeur(".icon-sm", "width"));

  it("la colonne garde sa largeur et sa largeur minimale (aucune n'est poussee)", () => {
    expect(largeurColonne).toBe(largeurMini);
    // La ligne du bas ne pose AUCUNE largeur en dur : elle prend celle de la
    // colonne, elle ne l'elargit pas.
    expect(valeur("#sidebar-engine-row", "width")).toBe("");
    expect(valeur("#sidebar-engine-row", "min-width")).toBe("");
  });

  it("la ligne tient dans la colonne : marges + padding + badge + texte", () => {
    // Largeur reellement disponible DANS la ligne, calculee depuis le disque.
    const interieur = largeurColonne - margeLigne - paddingLigne;
    expect(interieur).toBeGreaterThan(0);
    // Largeur MINIMALE du badge : ses deux bordures, son padding horizontal, son
    // icone, ses deux `gap` et son libelle (« Distant » + compteur), lus dans le
    // HTML et dans la feuille.
    const libelle = (badge[0].match(/remote-badge-label">([^<]+)</) || [])[1];
    const compteur = (badge[0].match(/remote-badge-count">([^<]+)</) || [])[1];
    expect(libelle, "libelle du badge introuvable").toBeTruthy();
    const largeurBadgeMini =
      2 * px(valeur(".remote-badge", "border")) +
      horizontal(valeur(".remote-badge", "padding")) +
      largeurIcone +
      2 * px(valeur(".remote-badge", "gap")) +
      largeurTexte(libelle, policeBadge) +
      largeurTexte(` ${compteur}`, policeBadge);
    // Meme si le texte du moteur tombait a 0 px, le badge tient : il ne peut
    // donc pas etre pousse hors du cadre.
    expect(interieur - espaceLigne - largeurBadgeMini).toBeGreaterThan(0);
    // Et il reste de la place pour le texte du moteur, au complet.
    const policeMoteur = px(valeur(".project-engine", "font-size"));
    expect(
      interieur - espaceLigne - largeurBadgeMini,
      "le texte du moteur n'a plus la place de s'afficher en entier",
    ).toBeGreaterThan(largeurTexte(TEXTE_MOTEUR, policeMoteur));
  });

  it("le TEXTE se reduit avant le badge, jamais l'inverse", () => {
    // Le texte du moteur est l'element elastique : il prend la place restante et
    // peut descendre sous la largeur de son contenu (min-width: 0) jusqu'a
    // l'ellipse.
    expect(valeur("#sidebar-engine-row .project-engine", "flex")).toBe(
      "1 1 auto",
    );
    expect(valeur("#sidebar-engine-row .project-engine", "min-width")).toBe("0");
    expect(valeur(".project-engine", "text-overflow")).toBe("ellipsis");
    expect(valeur(".project-engine", "overflow")).toBe("hidden");
    expect(valeur(".project-engine", "white-space")).toBe("nowrap");
    // Le badge, lui, ne se reduit ni ne grossit, et sa largeur suit son contenu.
    expect(valeur(".remote-badge", "flex")).toBe("0 0 auto");
    expect(valeur(".remote-badge", "width")).toBe("auto");
    expect(valeur(".remote-badge", "white-space")).toBe("nowrap");
    // Rien ne depasse de la ligne (pas de debordement horizontal possible).
    expect(valeur("#sidebar-engine-row", "overflow")).toBe("hidden");
  });

  it("la ligne a exactement la hauteur du badge : rien n'est rogne", () => {
    expect(hauteurLigne).toBe(hauteurBadge);
    expect(valeur("#sidebar-engine-row", "align-items")).toBe("center");
    // Le badge n'a pas grossi depuis le LOT 2 (meme hauteur, meme famille).
    expect(hauteurBadge).toBe(px(valeur("#btn-open-project", "height")));
  });

  it("la colonne garde de la place pour la liste des fichiers (fenetre minimale)", () => {
    // Hauteur du bloc des menus recalculee depuis le disque : bordures, padding
    // vertical, lignes de 32 px et leurs `gap` (compte lu dans `.pj-panel`).
    const panneau = sliceSource(html, '<div class="pj-panel">', "</aside>", 200);
    const lignes = panneau
      .split("\n")
      .filter(
        (l) => l.startsWith("        <button") || l.includes('id="pj-more-wrap"'),
      ).length;
    const hauteurLigneBouton = px(valeur(".pj-panel button", "height"));
    const gapMenus = px(valeur(".pj-panel", "gap"));
    const paddingMenus = valeur("#project-footer", "padding").split(/\s+/).map(px);
    const hauteurMenus =
      2 * px(valeur("#project-footer", "border")) +
      2 * paddingMenus[0] +
      lignes * hauteurLigneBouton +
      (lignes - 1) * gapMenus;
    const hauteurBandeau = px(valeur("#project-selector", "height"));
    // Bas de colonne = bloc des menus + sa marge basse + la ligne d'info + sa
    // marge basse. Toutes ces valeurs viennent du disque (aucun nombre fige).
    const basDeColonne =
      hauteurMenus +
      bas(valeur("#project-footer", "margin")) +
      hauteurLigne +
      bas(valeur("#sidebar-engine-row", "margin"));
    // Fenetre minimale de l'application, lue dans `tauri.conf.json`.
    const fenetreMini =
      tauriConf.app.windows[0].minHeight ?? tauriConf.app.windows[0].height;
    expect(fenetreMini).toBeGreaterThan(0);
    const reste = fenetreMini - hauteurBandeau - basDeColonne;
    expect(
      reste,
      "la liste des fichiers n'a plus de place a la fenetre minimale",
    ).toBeGreaterThan(100);
  });
});

describe("Decision 375 — le badge et le texte sont inchanges", () => {
  it("le badge n'est pas un bouton et ne le devient pas", () => {
    expect(badge[0].startsWith('<span id="remote-badge"')).toBe(true);
    expect(badge[0]).not.toContain("<button");
    expect(badge[0]).not.toContain('role="button"');
    expect(badge[0]).not.toContain("onclick");
    // Libelle, compteur et infobulle : textes inchanges.
    expect(badge[0]).toContain('class="remote-badge-label">Distant</span>');
    expect(badge[0]).toContain('id="remote-badge-count">0</b>');
    expect(badge[0]).toContain("cliquer pour gérer");
    expect(badge[0]).toContain('data-lucide="globe"');
  });

  it("son clic et sa logique d'affichage n'ont pas bouge (il ouvre Options)", () => {
    expect(settingsJs).toContain(
      'remoteBadge.addEventListener("click", () => btnSettings.click())',
    );
    expect(settingsJs).toContain('document.getElementById("remote-badge-count")');
    expect(settingsJs).toContain('remoteBadge.classList.add("hidden")');
    expect(settingsJs).toContain('remoteBadge.classList.remove("hidden", "off")');
  });

  it("le texte du moteur n'est NI change NI duplique", () => {
    // Un seul element pour nommer le moteur dans toute la colonne.
    expect(html.split('id="project-engine"').length - 1).toBe(1);
    expect(html.split('class="project-engine"').length - 1).toBe(1);
    // Meme identifiant, meme classe : `main.js` n'a pas eu a changer.
    expect(html).toContain('<span id="project-engine" class="project-engine">');
    // Il est rempli par la source unique et suit la re-sonde du backend.
    const mainJs = lire("src/js/main.js");
    expect(mainJs).toContain('document.getElementById("project-engine")');
    expect(mainJs).toContain("agentDisplayLabel()");
    expect(mainJs).toContain(
      'window.addEventListener("pilot-backend-changed", syncEngineSubtitle)',
    );
  });

  it("le bandeau du haut garde ses 48 px et son logo valide", () => {
    expect(px(valeur("#project-selector", "height"))).toBe(48);
    expect(html).toContain('id="btn-project-logo"');
    expect(html).toContain('src="/logo_pilot_vector.svg"');
    // Le sous-titre du moteur n'est plus dans le bandeau (il est descendu).
    const bandeau = sliceSource(html, '<div id="project-selector">', BALISE_GLOBAL, 200);
    expect(bandeau).not.toContain('id="project-engine"');
  });
});
