// Verrou — l'etat nu de l'ecran Vocal ne prend que ce qu'il nomme.
//
// Mission « le portrait survit au masquage » (2026-11-01). Le bouton-oeil de
// l'ecran Vocal eteint « tout » — et l'exception du proprietaire (2026-10-29)
// est un perimetre, pas une intention : dans l'etat nu il reste EXACTEMENT
//
//   1. le PORTRAIT du personnage et son NOM   (decision du 2026-10-29) ;
//   2. le BOUTON de masquage, seul moyen de revenir ;
//   3. la ZONE DE SAISIE sous le cercle — champ de texte, bouton de dictee,
//      rangee de questions (precision du 2026-11-01 : on ne peut pas se taire
//      dans un ecran vide).
//
// Ce fichier est un SECOND verificateur, independant de
// `ecran-vocal-masquage-garde-le-portrait.test.js` : il ne decoupe rien dans le
// CSS, il LIT les regles (selecteur + corps) et les CONFRONTE a l'arbre reel de
// l'ecran. Un selecteur qui n'atteint pas un noeud ne peut rien lui faire : c'est
// exactement la propriete a tenir.
//
// Les trois tests echouent VRAIMENT si la regle casse — la mutation a ete
// verifiee a la main, et la reproduction du defaut du 2026-10-31 (portrait
// transporte dans le disque) sert de controle interne : le moteur doit alors
// designer `.vocal-orb`.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sliceSource, neutraliserSource } from "./source-slice.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) =>
  readFileSync(resolve(ICI, "../..", rel), "utf8").replace(/\r\n/g, "\n");

const CSS = lire("src/css/style.css");
const SUPER = lire("src/js/super-agent.js");

// ---------------------------------------------------------------------------
// 1. Un moteur de selecteurs minuscule — juste ce que le CSS emploie ici :
//    composés simples (balise, .classe), descendant et enfant (`>`).
// ---------------------------------------------------------------------------

function compose(texte) {
  const m = texte.trim().match(/^([a-zA-Z][\w-]*)?((?:\.[\w-]+)*)$/);
  if (!m) return null;
  return {
    tag: (m[1] || "").toLowerCase(),
    classes: (m[2] || "").split(".").filter(Boolean),
  };
}

const noeud = (tag, classes = []) => ({ tag, classes });

function porte(el, morceau) {
  if (!morceau) return false;
  if (morceau.tag && morceau.tag !== el.tag) return false;
  return morceau.classes.every((c) => el.classes.includes(c));
}

/** Decoupe un selecteur en composés et operateurs. */
function analyser(selecteur) {
  const jetons = selecteur
    .replace(/>/g, " > ")
    .split(/\s+/)
    .filter(Boolean);
  const composes = [];
  const liens = [];
  for (const jeton of jetons) {
    if (jeton === ">") {
      liens[composes.length - 1] = ">";
      continue;
    }
    const c = compose(jeton);
    if (!c) return null;
    composes.push(c);
  }
  return composes.length ? { composes, liens } : null;
}

/** Le selecteur atteint-il la chaine `chaine` (de l'ancetre au noeud) ? */
function atteint(selecteur, chaine) {
  const a = analyser(selecteur);
  if (!a) return false;
  const n = chaine.length;
  const m = a.composes.length;
  if (m > n) return false;
  if (!porte(chaine[n - 1], a.composes[m - 1])) return false;
  let cible = n - 2;
  for (let i = m - 2; i >= 0; i -= 1) {
    const lien = a.liens[i + 1] === ">" ? ">" : " ";
    if (lien === ">") {
      if (cible < 0 || !porte(chaine[cible], a.composes[i])) return false;
      cible -= 1;
      continue;
    }
    let trouve = -1;
    for (let k = cible; k >= 0; k -= 1) {
      if (porte(chaine[k], a.composes[i])) {
        trouve = k;
        break;
      }
    }
    if (trouve < 0) return false;
    cible = trouve - 1;
  }
  return true;
}

// ---------------------------------------------------------------------------
// 2. Les regles du CSS, commentaires neutralises (un commentaire qui CITE un
//    selecteur n'est pas une regle : c'est meme souvent le contraire).
// ---------------------------------------------------------------------------

const REGLES = (() => {
  const texte = neutraliserSource(CSS);
  const regles = [];
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(texte)) !== null) {
    const selecteurs = m[1]
      .split(",")
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (selecteurs.length) regles.push({ selecteurs, corps: m[2] });
  }
  return regles;
})();

/** Toutes les regles qui s'appliquent a l'etat nu (`vocal-bare`). */
const reglesNues = () =>
  REGLES.filter((r) => r.selecteurs.some((s) => s.includes("vocal-bare")));

/** Une declaration qui fait disparaitre un noeud, ou lui coupe le clic. */
const MASQUE =
  /(?:^|[;\s])(opacity\s*:\s*0(?:[;\s}]|$)|visibility\s*:\s*hidden|display\s*:\s*none|pointer-events\s*:\s*none)/;

/** La liste lisible des selecteurs coupables, pour un message utile. */
const coupables = (chaine) => {
  const vus = new Set();
  for (const regle of reglesNues()) {
    if (!MASQUE.test(regle.corps)) continue;
    for (const s of regle.selecteurs) {
      if (chaine.some((_, i) => atteint(s, chaine.slice(0, i + 1)))) vus.add(s);
    }
  }
  return [...vus];
};

// ---------------------------------------------------------------------------
// 3. L'arbre REEL de l'ecran : lu dans `buildVocalOverlay`, pas suppose.
// ---------------------------------------------------------------------------

// Le gabarit de l'overlay, extrait avec `sliceSource` : ancre de debut ET ancre
// de fin verifiees, taille plancher. Un decoupage par `indexOf` en ligne
// vaudrait -1 le jour ou le texte bouge, rendrait un fragment vide, et toutes
// les assertions negatives qui suivent deviendraient vraies par construction
// (`source-slice.test.js` refuse d'ailleurs ce motif dans un fichier de test).
// L'ancre de fin porte son RETRAIT (`\n    \`;`) : la fermeture du gabarit est la
// seule ligne de cette forme, la fin du libelle de relance est, elle, en ligne.
const GABARIT = () =>
  sliceSource(
    SUPER,
    'ov.className = "pilot-vocal vocal-state-idle";',
    "\n    `;",
    400,
  );

/** La chaine de noeuds du PREMIER element portant la classe demandee. */
function chaineDe(classe) {
  const html = GABARIT().replace(/<!--[\s\S]*?-->/g, " ");
  const racine = noeud("div", ["pilot-vocal", "vocal-bare"]);
  const pile = [racine];
  const vides = new Set(["img", "input", "br", "hr", "meta", "link"]);
  let cible = null;
  const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const [, fermant, nom, attrs] = m;
    const tag = nom.toLowerCase();
    if (fermant) {
      if (pile.length > 1) pile.pop();
      continue;
    }
    const classes = (attrs.match(/class="([^"]*)"/) || [, ""])[1].split(/\s+/).filter(Boolean);
    const el = noeud(tag, classes);
    if (!cible && classes.includes(classe)) cible = [...pile, el];
    if (!vides.has(tag) && !/\/\s*$/.test(attrs)) pile.push(el);
  }
  return cible;
}

const overlay = () => noeud("div", ["pilot-vocal", "vocal-bare"]);

describe("1. le portrait et son nom ne sont JAMAIS atteints par l'etat nu", () => {
  it("le portrait est un enfant direct de la colonne de droite, hors du disque", () => {
    const chaine = chaineDe("vocal-portrait");
    expect(chaine, "le modele doit contenir .vocal-portrait").toBeTruthy();
    // On nomme ses ancetres : s'il repart dans le disque, ce test le dit.
    expect(chaine.map((n) => n.classes.join("."))).toEqual([
      "pilot-vocal.vocal-bare",
      "vocal-stage",
      "vocal-side-tasks.vocal-side",
      "vocal-portrait",
    ]);
  });

  it("aucun selecteur du masque n'atteint le portrait (ancetres compris)", () => {
    const chaine = chaineDe("vocal-portrait");
    expect(coupables(chaine)).toEqual([]);
  });

  it("aucun selecteur du masque n'atteint le NOM du portrait", () => {
    const chaine = chaineDe("vocal-portrait");
    const nom = [...chaine.slice(0, -1), noeud("div", ["vocal-portrait-name"])];
    expect(coupables(nom)).toEqual([]);
  });

  it("le verificateur n'est pas complaisant : le defaut du 2026-10-31 est vu", () => {
    // Le matin du 2026-10-31, le portrait vivait DANS un noeud que l'etat nu
    // eteint. Le meme calcul doit alors designer ce noeud : la regle d'opacite
    // emportait le portrait par heritage. (Le disque, lui, n'est plus eteint
    // depuis le 2026-11-02 : il ne peut donc plus servir de temoin — le panneau
    // de gauche le remplace, avec exactement le meme mecanisme.)
    const defaut = [
      overlay(),
      noeud("div", ["vocal-stage"]),
      noeud("aside", ["vocal-side-discussion", "vocal-side"]),
      noeud("img", ["vocal-portrait"]),
    ];
    expect(coupables(defaut)).toContain(
      ".pilot-vocal.vocal-bare .vocal-side-discussion",
    );
  });
});

describe("2. le bouton de masquage ne disparait pas dans l'etat nu", () => {
  it("il vit dans la barre du haut, et la barre n'est pas eteinte", () => {
    const barre = chaineDe("vocal-top");
    expect(barre, "le modele doit contenir .vocal-top").toBeTruthy();
    // La barre garde son fond et son filet transparents (c'est voulu : elle
    // redevient une simple bande), mais elle ne peut pas etre rendue
    // invisible ni non cliquable — le bouton est dedans.
    expect(coupables(barre)).toEqual([]);
  });

  it("il est explicitement RALLUME, et rien ne l'eteint", () => {
    // Il est ajoute apres coup par `buildVocalDisplayToggle()` dans `.vocal-top`,
    // la barre du haut — pas dans l'overlay directement (ou un fond transparent
    // le noierait).
    expect(SUPER).toContain('buildVocalDisplayToggle(ov.querySelector(".vocal-top"))');
    expect(SUPER).toContain("barre.appendChild(bouton)");
    const chaine = [...chaineDe("vocal-top"), noeud("button", ["vocal-display-toggle"])];
    expect(coupables(chaine)).toEqual([]);
    // Un retour EXPLICITE : sans lui, une regle d'effacement ajoutee un jour sur
    // la barre emporterait le bouton, et l'ecran n'aurait plus de retour.
    const retours = reglesNues()
      .filter((r) => r.selecteurs.some((s) => atteint(s, chaine)))
      .filter((r) => /opacity\s*:\s*1/.test(r.corps) && /visibility\s*:\s*visible/.test(r.corps));
    expect(retours.length).toBeGreaterThan(0);
  });
});

describe("3. la zone de saisie n'est ni masquee, ni deplacee", () => {
  it("le modele place la zone sous le cercle, et la barre de chat y entre", () => {
    const chaine = chaineDe("vocal-input");
    expect(chaine, "le modele doit contenir .vocal-input").toBeTruthy();
    expect(chaine.map((n) => n.classes.join("."))).toEqual([
      "pilot-vocal.vocal-bare",
      "vocal-input",
    ]);
    // La barre de chat (champ + dictee) est DEPLACEE dans cette zone, meme noeud.
    expect(SUPER).toContain('zone.appendChild(inputBar)');
    expect(SUPER).toContain('inputBar.className = "agent-chat-input-bar"');
    // Et le champ comme le bouton de dictee viennent de `agent-pi.js`.
    const AGENT = lire("src/js/agent-pi.js");
    expect(AGENT).toContain('<textarea class="agent-input"');
    expect(AGENT).toContain('class="agent-btn agent-mic-btn"');
  });

  it("aucun selecteur du masque n'atteint la zone, le champ, ni le bouton de dictee", () => {
    const zone = chaineDe("vocal-input");
    const barre = [...zone, noeud("div", ["agent-chat-input-bar"])];
    const champ = [...barre, noeud("textarea", ["agent-input"])];
    const micro = [...barre, noeud("button", ["agent-btn", "agent-mic-btn"])];
    expect(coupables(zone)).toEqual([]);
    expect(coupables(barre)).toEqual([]);
    expect(coupables(champ)).toEqual([]);
    expect(coupables(micro)).toEqual([]);
    // Aucune regle de l'etat nu ne la nomme, meme sans la masquer : une regle
    // qui la nommerait pour la deplacer ou la redimensionner ferait sauter le
    // champ sous le curseur.
    const nomment = reglesNues()
      .flatMap((r) => r.selecteurs)
      .filter((s) => s.includes("vocal-input"));
    expect(nomment).toEqual([]);
  });

  it("le bas ne s'efface pas non plus tout seul pendant l'etat nu", () => {
    // Sans cela, la zone disparaitrait 2,5 s apres le clic (effacement au repos,
    // §4bis) : le bouton de masquage aurait l'air de vider la saisie aussi.
    expect(SUPER).toMatch(/const visible = vocalBare \|\|/);
    expect(SUPER).not.toMatch(/const visible = !vocalBare/);
  });
});
