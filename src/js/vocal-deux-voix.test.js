// Tests — REMARQUE DU PROPRIETAIRE DU 2026-10-03, point 2 : « on ne distingue
// pas les deux voix dans la colonne de discussion ».
// (docs/rapports/REMARQUES-interface-ecran-vocal-20261003.md, puis
// docs/rapports/RAPPORT-remarques-ecran-vocal-20261003.md § 2.)
//
// CE QUE CE FICHIER VERROUILLE :
//   V1 — les deux voix n'ont pas le meme COTE : la question va a droite
//        (`align-self: flex-end`, `text-align: end`), la reponse a gauche
//        (`flex-start`, `start`).
//   V2 — la question porte une TEINTE et un rayon dissymetrique ; la reponse n'a
//        AUCUN fond. Le fond vient de `--text-primary`, donc des dix palettes :
//        aucune couleur n'est ecrite en dur.
//   V3 — la differenciation ne coute RIEN au budget de lignes : ni l'une ni
//        l'autre n'ajoute de `padding-block`, et la hauteur de ligne (23 px) et
//        l'ecart (14 px) restent ceux de `vocalDiscussionView`. La largeur
//        maximale de la bulle laisse la colonne respirer sans rogner le texte.
//   V4 — aucune classe nouvelle, aucun second mecanisme : le role vient de
//        `vocalDiscussionView` (le modele), la classe est posee a UN endroit.
//   V5 — les deux titres, les tailles et le gris ne bougent pas : ce correctif
//        n'ajoute qu'un repere de plus, il n'en retire aucun.
//
// Les commentaires sont en ASCII ; les chaines lues dans les sources sont
// copiees telles quelles.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// Decoupage VERIFIE (quality-gate § 3.4) : une ancre absente LEVE au lieu de
// rendre un fragment vide, qui rendrait vraie toute assertion negative.
import { sliceSource } from "./source-slice.js";
import {
  VOCAL_DISCUSSION_GAP,
  VOCAL_DISCUSSION_LINE_H,
  vocalDiscussionView,
} from "./vocal-sides.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) => readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const CSS = lire("src/css/style.css");
const SUPER = lire("src/js/super-agent.js");

/** Regle CSS d'un selecteur, accolades exclues (decoupage verifie). */
function regle(selecteur, mini = 10) {
  return sliceSource(CSS, `${selecteur} {`, "}", mini);
}

const QUESTION = regle(".vocal-msg-user", 60);
const REPONSE = regle(".vocal-msg-assistant", 40);
const BULLE = regle(".vocal-msg", 40);

describe("V1 — les deux voix n'occupent pas le meme cote", () => {
  it("la question va a DROITE, la reponse a GAUCHE", () => {
    // Le sens de lecture de toutes les messageries : il ne s'apprend pas, et il
    // se voit sans lire le texte. C'est le repere principal de la remarque.
    expect(QUESTION).toMatch(/align-self:\s*flex-end/);
    expect(QUESTION).toMatch(/text-align:\s*end/);
    expect(REPONSE).toMatch(/align-self:\s*flex-start/);
    expect(REPONSE).toMatch(/text-align:\s*start/);
    // Les deux valeurs sont OPPOSEES : un seul cote ne suffirait pas a distinguer
    // deux voix, il faut deux cotes.
    const cote = (corps) => (corps.match(/align-self:\s*([a-z-]+)/) || [])[1];
    expect(cote(QUESTION)).not.toBe(cote(REPONSE));
  });

  it("le conteneur est bien une colonne qui accepte `align-self`", () => {
    // `align-self` n'a de sens que dans une colonne : la regle du corps doit donc
    // etre un `flex` en colonne, sinon le correctif ne changerait rien a l'ecran
    // (une assertion de source qui ne serait vraie que sur le papier).
    const corps = regle(".vocal-side-discussion > .vocal-side-body");
    expect(corps).toMatch(/display:\s*flex/);
    expect(corps).toMatch(/flex-direction:\s*column/);
  });
});

describe("V2 — la question est une bulle teintee, la reponse n'en a pas", () => {
  it("la teinte vient de `--text-primary`, jamais d'une couleur ecrite en dur", () => {
    expect(QUESTION).toMatch(/background:\s*color-mix\(in srgb, var\(--text-primary\) 8%, transparent\)/);
    // Aucune couleur litterale : ni hexa, ni rgb(), ni teinte nommee. La bulle
    // suit donc les dix palettes de l'application.
    for (const [nom, corps] of [
      ["question", QUESTION],
      ["reponse", REPONSE],
      ["message", BULLE],
    ]) {
      expect(corps, `${nom} : aucune couleur en dur`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(corps, `${nom} : aucun rgb()`).not.toMatch(/\brgba?\(/);
      expect(corps, `${nom} : aucune teinte nommee`).not.toMatch(
        /\b(?:white|black|red|blue|green|gray|grey)\b/,
      );
    }
  });

  it("le rayon est dissymetrique : la pointe de la bulle designe la reponse", () => {
    expect(QUESTION).toMatch(/border-radius:\s*14px 14px 3px 14px/);
    // La reponse n'a ni fond ni rayon : elle est du TEXTE, pas une bulle — c'est
    // la difference la plus lisible avec la question, et la moins chargee.
    expect(REPONSE).not.toMatch(/background/);
    expect(REPONSE).not.toMatch(/border-radius/);
  });

  it("la bulle ne colle jamais au bord de la colonne", () => {
    // Les 12 px d'indentation d'origine sont EQUILIBRES : la bulle a la meme
    // respiration de chaque cote, sinon le texte parait decale dans son fond.
    expect(QUESTION).toMatch(/padding-inline-start:\s*12px/);
    expect(QUESTION).toMatch(/padding-inline-end:\s*12px/);
    // Et elle ne prend pas toute la largeur : une bulle pleine largeur se lit
    // comme la colonne elle-meme, donc les deux voix se confondent de nouveau.
    const maxi = Number((QUESTION.match(/max-width:\s*(\d+)%/) || [])[1]);
    expect(Number.isFinite(maxi)).toBe(true);
    expect(maxi).toBeGreaterThan(60);
    expect(maxi).toBeLessThan(100);
    // La reponse, elle, occupe la colonne : c'est le texte de reference.
    expect(REPONSE).toMatch(/max-width:\s*100%/);
  });
});

describe("V3 — la differenciation ne coute rien au budget de lignes", () => {
  it("aucune marge verticale : la ligne (23) et l'ecart (14) restent le budget", () => {
    // `vocalDiscussionView` calcule le nombre de lignes en divisant la hauteur de
    // la colonne par `23 + 14`. Une marge verticale ferait mentir ce calcul : le
    // dernier message serait rogne ou un trou apparaitrait.
    expect(VOCAL_DISCUSSION_LINE_H).toBe(23);
    expect(VOCAL_DISCUSSION_GAP).toBe(14);
    for (const [nom, corps] of [
      ["question", QUESTION],
      ["reponse", REPONSE],
      ["message", BULLE],
    ]) {
      expect(corps, `${nom} : aucun padding-block ajoute`).not.toMatch(/padding-block/);
      expect(corps, `${nom} : aucun margin-block ajoute`).not.toMatch(/margin-block/);
    }
    // La hauteur de ligne declaree dans la feuille de style est celle du modele.
    expect(QUESTION).toMatch(/line-height:\s*23px/);
    expect(BULLE).toMatch(/line-height:\s*23px/);
  });

  it("le nombre de lignes affiche est celui que le modele decide", () => {
    // Deux lignes de question, huit de reponse : les bornes du modele, rejouees
    // ici pour que le CSS ne puisse pas les contredire.
    expect(QUESTION).toMatch(/-webkit-line-clamp:\s*2/);
    expect(REPONSE).toMatch(/-webkit-line-clamp:\s*8/);
    const vue = vocalDiscussionView(
      [
        { role: "user", text: "Et maintenant ?" },
        { role: "assistant", text: "Maintenant, la reponse." },
      ],
      { columnHeight: 512, track: 320 },
    );
    expect(vue.items.map((m) => m.role)).toEqual(["user", "assistant"]);
  });
});

describe("V4 — aucune classe nouvelle, aucun second mecanisme", () => {
  it("la classe vient du MODELE, posee a un seul endroit", () => {
    // Le CSS ajoute des reperes, il n'invente pas de balisage : le role est lu
    // dans le modele et la classe est ecrite une seule fois.
    expect(SUPER).not.toContain('class="vocal-msg');
    const corps = sliceSource(
      SUPER,
      "function buildVocalDiscussionHtml(vue)",
      "return html;",
      100,
    );
    expect(corps).toMatch(/message\.role === "user" \? "vocal-msg vocal-msg-user"/);
    expect(corps).toMatch(/"vocal-msg vocal-msg-assistant"/);
    // Aucune classe nouvelle n'a ete ajoutee pour la remarque : les deux classes
    // existaient deja, le correctif ne fait que les peindre autrement.
    const classes = new Set(SUPER.match(/vocal-msg-[a-z-]+/g) || []);
    expect([...classes].sort()).toEqual(["vocal-msg-assistant", "vocal-msg-user"]);
  });

  it("aucun noeud d'avatar ni de pastille n'a ete ajoute a la discussion", () => {
    // La remarque disait « sans encombrement » : pas d'icone, pas de pastille, pas
    // de point de couleur. Un seul noeud par message, celui du texte.
    for (const mot of ["vocal-msg-avatar", "vocal-msg-badge", "vocal-msg-dot"]) {
      expect(CSS, `${mot} : aucune classe ajoutee`).not.toContain(mot);
      expect(SUPER, `${mot} : aucun balisage ajoute`).not.toContain(mot);
    }
  });
});

describe("V5 — les reperes qui existaient ne bougent pas", () => {
  it("les tailles et le gris de la question sont ceux du lot 3", () => {
    expect(QUESTION).toMatch(/font-size:\s*var\(--font-base\)/);
    expect(QUESTION).toMatch(/color:\s*var\(--vocal-ink-soft\)/);
    // La reponse garde son indentation nulle et sa taille : le correctif ne
    // touche que le cote, la teinte et le rayon.
    expect(REPONSE).toMatch(/padding-inline-start:\s*0/);
    expect(BULLE).toMatch(/font-size:\s*var\(--font-zone\)/);
  });

  it("l'ecart entre deux messages vient d'UNE regle, inchangee", () => {
    const ecart = regle(".vocal-msg + .vocal-msg");
    expect(ecart).toMatch(/margin-block-start:\s*14px/);
  });
});
