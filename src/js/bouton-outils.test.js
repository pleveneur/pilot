/**
 * Verrou du lot « bouton Outils » — `docs/rapports/RAPPORT-bouton-outils.md`.
 *
 * Trois decisions du proprietaire, tenues ici :
 *   (a) la ligne non deployee du bloc du bas s'appelle « Outils » (au pluriel) et
 *       le menu qu'elle ouvre s'appelle « Autres outils » : c'est le mot AFFICHE,
 *       le `title`, l'`aria-label` du bouton, l'`aria-label` du menu et le texte
 *       d'accueil de premiere ouverture. Aucun ancien libelle ne subsiste.
 *   (b) tant que le menu est OUVERT, le bouton ne se voit plus — et il ne se
 *       voit plus SANS que rien d'autre ne bouge : la regle d'etat ne porte que
 *       la peinture (`opacity`), jamais la mise en page, sinon le bloc et le menu
 *       sauteraient de 32 px a l'ouverture.
 *   (c) a la fermeture (souris sortie, clic ailleurs, Echap), le bouton revient
 *       exactement comme avant : la classe `open` tombe avec l'etat du menu,
 *       parce que `sidebar.js` l'ecrit dans la MEME fonction que la classe
 *       `hidden` du panneau, et la zone de survol du repli ne lit jamais cette
 *       classe.
 *
 * Aucun navigateur n'est requis : lecture des fichiers (fins de ligne
 * normalisees, cf. quality-gate 3.4). Les decoupages passent par `sliceSource`
 * (garde-fou du 3e audit, point 4) : une ancre absente echoue bruyamment.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sliceSource } from "./source-slice.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lire = (...p) =>
  readFileSync(resolve(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

const html = lire("index.html");
const css = lire("src/css/style.css");
const sidebarJs = lire("src/js/sidebar.js");
const repliJs = lire("src/js/sidebar-footer-fold.js");

/** HTML du bloc du bas de la colonne, commentaires RETIRES : les commentaires
 *  citent volontairement les libelles disparus, ils ne doivent pas tromper les
 *  verifications de structure. */
const piedNu = sliceSource(html, 'id="project-footer"', "</aside>", 4000).replace(
  /<!--[\s\S]*?-->/g,
  "",
);

/** Bloc de regle dont le selecteur est ecrit EXACTEMENT `selector {`. */
function bloc(source, selector) {
  const echappe = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\n)${echappe} \\{([^}]*)\\}`, "g");
  const trouves = [];
  let m;
  while ((m = re.exec(source)) !== null) trouves.push(m[1]);
  expect(trouves.length, `regle CSS absente : ${selector}`).toBeGreaterThan(0);
  return trouves.join("\n");
}

/** Noms de proprietes declarees dans un corps de regle (commentaires retires). */
const proprietes = (corps) =>
  (corps
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .match(/(?:^|;)\s*([a-z-]+)\s*:/g) || [])
    .map((m) => m.replace(/[;:\s]/g, ""))
    .filter(Boolean);

/** Balise ouvrante du declencheur `#btn-more-screens`. */
const baliseDeclencheur = () => {
  const m = piedNu.match(/<button id="btn-more-screens"[^>]*>/);
  expect(m, "declencheur #btn-more-screens introuvable").not.toBeNull();
  return m[0];
};

/** Corps de `_initProjectFooterMenu`, du debut du corps a la fin de la methode. */
const corpsDuMenu = () =>
  sliceSource(
    sidebarJs,
    "  _initProjectFooterMenu() {",
    "this._fermerMenuAutresEcrans = fermer;",
    1500,
  );

// ── (a) Les DEUX libelles ────────────────────────────────────────────────────
describe("(a) le bouton s'appelle « Outils » et son menu « Autres outils »", () => {
  it("le mot affiche sur la ligne non deployee est « Outils » (pluriel)", () => {
    expect(piedNu).toContain('<span class="pj-btn-label">Outils</span>');
    // Aucun des mots d'avant : ni « Action » (singulier, libelle precedent),
    // ni « Actions », ni le nom du MENU recopie sur la ligne.
    expect(piedNu, "l'ancien libelle « Action » est revenu").not.toContain(
      '<span class="pj-btn-label">Action</span>',
    );
    expect(piedNu).not.toContain('<span class="pj-btn-label">Actions</span>');
    expect(piedNu).not.toContain(
      '<span class="pj-btn-label">Autres outils</span>',
    );
  });

  it("le `title` et l'`aria-label` du bouton disent « Outils »", () => {
    const balise = baliseDeclencheur();
    const title = (balise.match(/title="([^"]*)"/) || [])[1] || "";
    const aria = (balise.match(/aria-label="([^"]*)"/) || [])[1] || "";
    expect(title.startsWith("Outils —")).toBe(true);
    expect(aria.startsWith("Outils —")).toBe(true);
    // L'infobulle enrichie (Q2) nomme toujours les six autres lignes du bloc.
    for (const libelle of [
      "Brouillon",
      "Options",
      "Assistant",
      "Dossier du projet",
      "Terminal",
      "Commandes du projet",
    ]) {
      expect(title).toContain(libelle);
    }
    expect(title).toContain("au survol");
  });

  it("le menu deploye a pour titre d'accessibilite « Autres outils »", () => {
    expect(piedNu).toContain('role="menu" aria-label="Autres outils"');
    expect(piedNu, "l'ancien nom du menu est revenu").not.toContain(
      'aria-label="Autres écrans"',
    );
    expect(piedNu).not.toContain('aria-label="Autres ecrans"');
    // Le panneau et le declencheur gardent leurs identifiants : le cablage
    // (`main.js`, `project-commands.js`, `interproject.js`) n'a pas bouge.
    expect(piedNu).toContain('id="pj-more-menu"');
    expect(piedNu).toContain('id="btn-more-screens"');
    expect(piedNu).toContain('aria-controls="pj-more-menu"');
  });

  it("l'aide de premiere ouverture dit « Outils »", () => {
    // `index.html` porte le texte d'accueil ; il designait la ligne par son
    // ancien nom, il doit la designer par le nouveau.
    const accueil = sliceSource(
      html,
      "« Lancer l'agent »</strong> ouvre la conversation",
      "</li>",
      80,
    );
    expect(accueil).toContain("<strong>« Outils »</strong>");
    expect(accueil).not.toContain("<strong>« Action »</strong>");
  });
});

// ── (b) Le bouton disparait tant que le menu est ouvert ──────────────────────
describe("(b) menu ouvert : le bouton ne se voit plus, sans saut de mise en page", () => {
  it("la regle d'etat efface la peinture (`opacity: 0`)", () => {
    const etat = bloc(css, "#btn-more-screens.open");
    expect(proprietes(etat)).toContain("opacity");
    expect(etat.replace(/\s+/g, " ").toLowerCase()).toContain("opacity: 0");
  });

  it("elle ne touche QUE la peinture : aucune propriete de mise en page", () => {
    // Le piege du lot : masquer par `display: none` retirerait la ligne de
    // 32 px, le bloc se reduirait et le menu, ancre sur le haut de
    // `.pj-more-wrap`, descendrait avec lui. `visibility: hidden` ferait, lui,
    // perdre le focus clavier. La regle reste donc SANS effet sur la place et
    // sur l'ordre de tabulation.
    const etat = bloc(css, "#btn-more-screens.open");
    const noms = proprietes(etat).sort();
    expect(noms).toEqual(["opacity", "pointer-events"]);
    const texte = etat.replace(/\s+/g, " ").toLowerCase();
    for (const interdit of [
      "display:",
      "visibility:",
      "height:",
      "width:",
      "margin",
      "padding",
      "position:",
      "top:",
      "bottom:",
      "inset",
      "flex",
      "font-size",
      "transform:",
    ]) {
      expect(texte, `propriete de mise en page ajoutee : ${interdit}`).not.toContain(
        interdit,
      );
    }
  });

  it("la ligne garde sa place de 32 px et le menu son ancrage", () => {
    // Hauteur de ligne : inchangee, c'est elle qui reserve l'espace pendant que
    // le bouton ne peint plus.
    expect(proprietes(bloc(css, ".pj-panel button"))).toContain("height");
    expect(bloc(css, ".pj-panel button").replace(/\s+/g, " ")).toContain(
      "height: 32px",
    );
    // Le panneau s'ouvre vers le haut, ancre sur `.pj-more-wrap` : ce conteneur
    // doit rester en `position: relative` et NE PAS porter de hauteur propre,
    // sinon la disparition du bouton deplacerait le menu.
    expect(bloc(css, ".pj-more-wrap").replace(/\s+/g, " ")).toContain(
      "position: relative",
    );
    expect(proprietes(bloc(css, ".pj-more-wrap"))).not.toContain("height");
    expect(bloc(css, ".pj-more-menu").replace(/\s+/g, " ")).toContain(
      "bottom: calc(100% + 4px)",
    );
  });

  it("la cle de l'etat est la classe `open`, et elle n'exige aucun selecteur moderne", () => {
    // Le declencheur porte deja la classe `open` en meme temps que le menu perd
    // la sienne (`sidebar.js`) : aucune mecanique nouvelle, donc aucun `:has()`
    // (non disponible sur toutes les webviews du projet).
    expect(css).not.toContain(":has(");
    expect(css).toContain("#btn-more-screens.open {");
  });
});

// ── (c) Le bouton revient exactement comme avant a la fermeture ──────────────
describe("(c) a la fermeture, le bouton revient comme avant", () => {
  it("une SEULE ecriture de l'etat, qui pose ET retire la classe `open`", () => {
    const corps = corpsDuMenu();
    // `classList.toggle(nom, force)` est le seul ecrivain : il pose la classe ET
    // la retire. Un `add`/`remove` separe laisserait un chemin de fermeture sans
    // retour du bouton — c'est exactement ce que ce test interdit.
    const ecritures = corps.match(/classList\.(?:add|remove|toggle|replace)\("open"/g);
    expect(ecritures, "plusieurs ecritures de la classe `open`").not.toBeNull();
    expect(ecritures.length).toBe(1);
    expect(corps).toContain('btn.classList.toggle("open", ouvert);');
    // La classe du menu est ecrite AVANT celle du bouton : `open` ne peut jamais
    // signaler un menu ferme, ni l'inverse.
    expect(corps.indexOf('menu.classList.toggle("hidden", !ouvert)')).toBeLessThan(
      corps.indexOf('btn.classList.toggle("open", ouvert)'),
    );
    // `aria-expanded` suit la meme variable : les trois reflets sont d'accord.
    expect(corps).toContain(
      'btn.setAttribute("aria-expanded", ouvert ? "true" : "false");',
    );
  });

  it("les TROIS fermetures passent par la meme fonction", () => {
    const corps = corpsDuMenu();
    // Une seule porte de sortie : `fermer` n'agit que si le menu est ouvert et
    // rend toujours la main au meme `setOuvert(false)`.
    expect(corps).toContain("const fermer = () => {");
    expect(corps).toContain("if (estOuvert()) setOuvert(false);");
    const appels = corps.match(/(?:^|[^.\w])fermer\(\);/g) || [];
    // Ligne du menu choisie, clic exterieur, Echap (+ le bouton lui-meme, qui
    // bascule par `setOuvert(!estOuvert())`).
    expect(appels.length).toBeGreaterThanOrEqual(3);
    // 1. Echap : referme puis rend le focus au declencheur, qui redevient
    //    visible a cet instant precis.
    expect(corps).toContain('e.key !== "Escape"');
    expect(corps.indexOf("fermer();\n      btn.focus();")).toBeGreaterThan(-1);
    // 2. Ligne choisie.
    expect(corps).toContain('if (e.target.closest(".pj-more-item")) fermer();');
    // 3. Clic exterieur, en phase de CAPTURE (le clic garde son effet).
    expect(corps).toContain("true\n    );");
  });

  it("la zone de survol du repli ne lit jamais la classe `open`", () => {
    // C'est le piege principal du lot : la zone qui maintient le menu ouvert est
    // le cadre `#project-footer`, tenu par `sidebar-footer-fold.js`. Ce module
    // decide sur la VRAIE classe du panneau (`hidden`) et compte les lignes sur
    // cette meme classe : effacer la peinture du bouton ne peut donc pas lui
    // faire croire que le menu est ferme, ni changer le nombre de lignes vues.
    expect(repliJs).not.toMatch(/\bopen\b/);
    expect(repliJs).toContain('menu.classList.contains("hidden")');
    expect(repliJs).toContain('.closest(".hidden")');
    // Le repli ferme le menu AVANT de rogner, par la fonction du menu : la
    // sortie de survol referme donc le menu, et le bouton revient avec lui.
    expect(sidebarJs).toContain("this._fermerMenuAutresEcrans = fermer;");
    expect(repliJs).toContain("fermerMenuAutresEcrans");
  });
});
