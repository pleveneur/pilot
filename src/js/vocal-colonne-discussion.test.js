// Tests — LOT 3 de l'ecran Vocal : LA COLONNE DE GAUCHE, L'APERCU DE LA
// DISCUSSION (docs/conceptions/CONCEPTION-ecran-vocal-portrait-et-colonnes.md,
// § 1.3 « ce que la colonne montre », § 4.2 « les deux mesures de texte » et
// § 4.3 « fichiers, symboles, tests » qui nomme T1 a T8).
//
// CE QUE CE FICHIER VERROUILLE :
//   T1 — les questions de l'utilisateur sont dans la colonne : 13 px, gris,
//        DEUX lignes au plus (jamais une seule, jamais trois).
//   T2 — les reponses : 15 px, `--text-primary`, HUIT lignes au plus.
//   T3 — l'ordre est chronologique, le plus recent en bas.
//   T4 — la coupe tombe sur une frontiere de mot, jamais dans un mot.
//   T5 — rien n'est deplace : `collectVocalDiscussion()` ne fait que lire.
//   T6 — le degrade est en HAUT (vers le titre), jamais en bas.
//   T7 — six messages lus au plus, et l'excedent est DIT.
//   T8 — une seule source : `vocalSyncSides()` ne lit pas la conversation, il
//        appelle `collectVocalDiscussion()`.
// Plus les verrous de coherence : les deux titres partagent UNE regle (donc la
// meme hauteur), les valeurs du tableau § 4.2 se rejouent, aucun hote cliquable
// ajoute (six, pas sept — issue #381), aucun reglage nouveau.
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
  VOCAL_DISCUSSION_MAX_MESSAGES,
  VOCAL_DISCUSSION_LINE_H,
  VOCAL_DISCUSSION_GAP,
  VOCAL_DISCUSSION_HEAD_PX,
  VOCAL_DISCUSSION_QUESTION_LINES,
  VOCAL_DISCUSSION_ANSWER_LINES,
  VOCAL_DISCUSSION_MORE_PX,
  VOCAL_DISCUSSION_TITLE,
  planVocalDiscussion,
  vocalDiscussionView,
  vocalDiscussionMoreText,
  vocalCharsPerLine,
  vocalExcerpt,
  vocalSideClipped,
} from "./vocal-sides.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) => readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const CSS = lire("src/css/style.css");
const SUPER = lire("src/js/super-agent.js");
const SIDES = lire("src/js/vocal-sides.js");

/** Fragment de `super-agent.js` entre deux ancres (decoupage verifie). */
function corps(debut, fin, mini = 40) {
  return sliceSource(SUPER, debut, fin, mini);
}

/** Regle CSS d'un selecteur, accolades exclues (decoupage verifie). */
function regle(selecteur, mini = 10) {
  return sliceSource(CSS, `${selecteur} {`, "}", mini);
}

/** Le corps de la colonne de gauche, tel que la feuille de style le peint. */
const CORPS = regle(".vocal-side-discussion > .vocal-side-body");
const MESSAGE = regle(".vocal-msg");
const QUESTION = regle(".vocal-msg-user");
const REPONSE = regle(".vocal-msg-assistant");
/** Les regles propres au lot 3, mises bout a bout : elles ne doivent nommer
 *  aucun hote cliquable, aucun `:hover`, aucun reglage. */
const LOT3 = [
  CORPS,
  MESSAGE,
  QUESTION,
  REPONSE,
  sliceSource(CSS, '.vocal-side-discussion[data-vocal-more="1"]', "}", 20),
  sliceSource(CSS, ".vocal-side-discussion .vocal-side-more", "}", 20),
  sliceSource(CSS, ".vocal-msg + .vocal-msg", "}", 20),
].join("\n");

const LONG = "voici une phrase volontairement longue qui ne tiendra pas sur le nombre de lignes";

describe("T1 — les questions de l'utilisateur sont dans la colonne", () => {
  it("une question de l'onglet apparait dans l'apercu, a sa place", () => {
    const vue = vocalDiscussionView([{ role: "user", text: "Ou est passee la colonne ?" }], {
      columnHeight: 512,
      track: 320,
    });
    expect(vue.items).toHaveLength(1);
    expect(vue.items[0].role).toBe("user");
    expect(vue.items[0].text).toBe("Ou est passee la colonne ?");
  });

  it("elle est en 13 px et en gris : `--font-base` et `--vocal-ink-soft`", () => {
    // 13 px : le jeton existant, aucune valeur inventee.
    expect(CSS).toMatch(/--font-base:\s*13px/);
    expect(QUESTION).toMatch(/font-size:\s*var\(--font-base\)/);
    // Le gris des colonnes : melange au fond, donc il suit les dix palettes.
    expect(CSS).toMatch(
      /--vocal-ink-soft:\s*color-mix\(in srgb, var\(--text-primary\) 85%, var\(--bg-app\)\)/,
    );
    expect(QUESTION).toMatch(/color:\s*var\(--vocal-ink-soft\)/);
    // Aucune couleur en dur dans la colonne.
    expect(LOT3).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("DEUX lignes au plus : jamais une seule, jamais trois", () => {
    expect(VOCAL_DISCUSSION_QUESTION_LINES).toBe(2);
    expect(QUESTION).toMatch(/-webkit-line-clamp:\s*2;/);
    const deux = vocalExcerpt(LONG.repeat(2), 2, 42);
    expect(deux.clipped).toBe(true);
    // Le texte rendu tient dans les DEUX lignes annoncees, ellipse comprise.
    expect(deux.text.length).toBeLessThanOrEqual(2 * 42);
    // Une question courte n'est pas coupee du tout.
    const courte = vocalExcerpt("Ca marche ?", 2, 42);
    expect(courte.clipped).toBe(false);
    expect(courte.text).toBe("Ca marche ?");
  });

  it("elle est indentee de 12 px, la reponse non", () => {
    expect(QUESTION).toMatch(/padding-inline-start:\s*12px/);
    expect(REPONSE).toMatch(/padding-inline-start:\s*0/);
  });
});

describe("T2 — les reponses sont dans la colonne", () => {
  it("15 px, texte plein, huit lignes au plus", () => {
    expect(CSS).toMatch(/--font-zone:\s*15px/);
    expect(MESSAGE).toMatch(/font-size:\s*var\(--font-zone\)/);
    expect(MESSAGE).toMatch(/color:\s*var\(--text-primary\)/);
    expect(VOCAL_DISCUSSION_ANSWER_LINES).toBe(8);
    expect(REPONSE).toMatch(/-webkit-line-clamp:\s*8;/);
    const huit = vocalExcerpt(LONG.repeat(6), 8, 42);
    expect(huit.clipped).toBe(true);
    expect(huit.text.length).toBeLessThanOrEqual(8 * 42);
  });

  it("la hauteur de ligne est celle du budget : 23 px, pour les deux", () => {
    // Si la feuille de style n'alignait pas ses lignes sur `VOCAL_DISCUSSION_LINE_H`,
    // le nombre de lignes calcule par la decision ne serait plus celui qu'on voit.
    expect(VOCAL_DISCUSSION_LINE_H).toBe(23);
    expect(MESSAGE).toMatch(/line-height:\s*23px/);
    expect(QUESTION).toMatch(/line-height:\s*23px/);
    // L'ecart entre deux messages est celui du budget : 14 px.
    expect(VOCAL_DISCUSSION_GAP).toBe(14);
    expect(sliceSource(CSS, ".vocal-msg + .vocal-msg", "}", 20)).toMatch(
      /margin-block-start:\s*14px/,
    );
  });

  it("une reponse n'est jamais coupee a trois lignes par un plafond trop court", () => {
    // 8 lignes x 42 caracteres = 336 : le plafond de la feuille de style est
    // bien celui de la decision, il ne la contredit pas.
    const huit = vocalExcerpt(LONG.repeat(6), 8, 42);
    expect(huit.text.length).toBeGreaterThan(3 * 42);
  });
});

describe("T3 — l'ordre est chronologique, le plus recent en bas", () => {
  it("trois messages de suite gardent leur ordre", () => {
    const vue = vocalDiscussionView(
      [
        { role: "user", text: "premier" },
        { role: "assistant", text: "deuxieme" },
        { role: "user", text: "troisieme" },
      ],
      { columnHeight: 512, track: 320 },
    );
    expect(vue.items.map((m) => m.text)).toEqual(["premier", "deuxieme", "troisieme"]);
  });

  it("le corps est colle au BAS de la colonne, le titre reste en haut", () => {
    expect(regle(".vocal-side-discussion")).toMatch(/justify-content:\s*space-between/);
    expect(CORPS).toMatch(/justify-content:\s*flex-end/);
    // Le corps s'arrete a son contenu : c'est `space-between` qui le pousse.
    expect(CORPS).toMatch(/flex:\s*0 1 auto/);
  });
});

describe("T4 — la coupe tombe sur un mot, jamais dans un mot", () => {
  it("le texte rendu est un PREFIXE exact de l'original, et l'ellipse le dit", () => {
    const brut = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima";
    const extrait = vocalExcerpt(brut, 2, 20);
    expect(extrait.clipped).toBe(true);
    expect(extrait.text.endsWith("\u2026")).toBe(true);
    const coupe = extrait.text.slice(0, -1);
    // Prefixe EXACT : aucun caractere invente, aucun caractere perdu au milieu.
    expect(brut.startsWith(coupe)).toBe(true);
    // Le caractere qui suivait, dans l'original, est un espace : le mot rendu
    // est donc entier, il n'a pas ete tranche.
    expect(brut.charAt(coupe.length)).toBe(" ");
    // Aucun residu de ponctuation juste avant l'ellipse.
    expect(coupe).not.toMatch(/[\s,;:.!?-]$/);
  });

  it("les sauts de ligne de la conversation sont reduits, pas recopies", () => {
    const extrait = vocalExcerpt("  une\n\nligne\tet   une autre  ", 2, 42);
    expect(extrait.text).toBe("une ligne et une autre");
  });

  it("`vocalSideClipped` dit la verite sans rien modifier", () => {
    expect(vocalSideClipped("court", 2, 42)).toBe(false);
    expect(vocalSideClipped(LONG.repeat(2), 2, 42)).toBe(true);
    // Un texte vide n'est jamais « coupe ».
    expect(vocalSideClipped("", 2, 42)).toBe(false);
  });
});

describe("T5 — rien n'est deplace : la conversation est LUE", () => {
  const LECTURE = corps("function collectVocalDiscussion()", "\n}\n", 200);

  it("`collectVocalDiscussion` ne fait que lire", () => {
    expect(LECTURE).toMatch(/querySelectorAll\(/);
    expect(LECTURE).toMatch(/\.textContent/);
    expect(LECTURE).not.toMatch(/appendChild|insertBefore|removeChild/);
    expect(LECTURE).not.toMatch(/\.remove\(/);
    expect(LECTURE).not.toMatch(/innerHTML/);
    // Aucune ecriture de texte : le `textContent` n'est jamais a gauche d'un `=`.
    expect(LECTURE).not.toMatch(/textContent\s*=[^=]/);
    // Aucune classe posee, aucun noeud cree.
    expect(LECTURE).not.toMatch(/classList\.(add|remove|toggle)|createElement|cloneNode/);
  });

  it("la conversation de l'onglet reste cachee par `visibility`, jamais retirees", () => {
    // Le reflet d'un noeud invisible : si l'on passait a `display: none`, le
    // defilement de l'historique serait perdu a la sortie du mode.
    expect(CSS).toMatch(
      /body\.pilot-vocal-active\s+\.agent-chat-messages\s*\{[^}]*visibility:\s*hidden/,
    );
  });

  it("seules les deux familles de messages sont lues : un apercu, pas un journal", () => {
    expect(LECTURE).toMatch(/"\.agent-message-user, \.agent-message-assistant"/);
    expect(LECTURE).not.toMatch(/agent-thinking|agent-tool-inline|agent-message-system/);
    // La BULLE, jamais la rangee d'actions (le bouton « Ecouter » n'est pas dit).
    expect(LECTURE).toMatch(/querySelector\("\.agent-bubble"\)/);
  });
});

describe("T6 — le degrade est en HAUT, vers le titre", () => {
  const MASQUE = sliceSource(CSS, '.vocal-side-discussion[data-vocal-more="1"]', "}", 20);

  it("le masque va vers le bas de l'ecran, donc efface le HAUT du contenu", () => {
    expect(MASQUE).toMatch(/-webkit-mask-image:\s*linear-gradient\(to bottom,/);
    expect(MASQUE).toMatch(/mask-image:\s*linear-gradient\(to bottom,/);
    // Jamais l'inverse : un degrade vers le haut effacerait le message le plus
    // recent, celui qui compte le plus.
    expect(LOT3).not.toMatch(/linear-gradient\(to top/);
  });

  it("il ne s'arme que s'il y a effectivement plus haut", () => {
    // `data-vocal-more` n'est pose qu'avec la valeur "1" quand `hidden > 0`.
    expect(corps("function vocalRenderDiscussion(", "\n}\n", 400)).toMatch(
      /vue\.hidden > 0 \? "1" : "0"/,
    );
  });

  it("le masque est sur le CORPS, pas sur la colonne : le titre reste net", () => {
    // Le masque etant pose sur `.vocal-side-body`, le titre — qui est le frere
    // place avant lui — n'est jamais concerne par le degrade.
    expect(MASQUE).toMatch(/> \.vocal-side-body/);
    expect(regle(".vocal-side-discussion")).not.toMatch(/mask-image/);
  });
});

describe("T7 — six messages au plus, et l'excedent est DIT", () => {
  it("la lecture est bornee a six messages, le total reste connu", () => {
    expect(VOCAL_DISCUSSION_MAX_MESSAGES).toBe(6);
    expect(corps("function collectVocalDiscussion()", "\n}\n", 200)).toMatch(
      /total - VOCAL_DISCUSSION_MAX_MESSAGES/,
    );
  });

  it("l'excedent est compte en echanges et ecrit en toutes lettres", () => {
    const vue = vocalDiscussionView([{ role: "user", text: "une question" }], {
      columnHeight: 512,
      track: 320,
      total: 12,
    });
    expect(vue.total).toBe(12);
    expect(vue.hidden).toBe(11);
    expect(vue.more).toBe(6);
    expect(vocalDiscussionMoreText(6)).toBe("\u2026 et 6 \u00e9changes plus haut");
    expect(vocalDiscussionMoreText(1)).toBe("\u2026 et 1 \u00e9change plus haut");
    // Rien a dire quand tout tient : aucune phrase, donc aucun trou.
    expect(vocalDiscussionMoreText(0)).toBe("");
  });

  it("la place de la phrase du surplus est RESERVEE : elle ne pousse personne", () => {
    expect(VOCAL_DISCUSSION_MORE_PX).toBe(15 + 14);
    expect(sliceSource(CSS, ".vocal-side-discussion .vocal-side-more", "}", 20)).toMatch(
      /margin-block-end:\s*14px/,
    );
  });

  it("seuls les derniers messages sont montres, jamais un trou au milieu", () => {
    const messages = [];
    for (let i = 0; i < 6; i++) {
      messages.push({ role: i % 2 === 0 ? "user" : "assistant", text: `message ${i}` });
    }
    const vue = vocalDiscussionView(messages, { columnHeight: 231, track: 320 });
    const rendus = vue.items.map((m) => m.text.split(" ")[1]);
    // Une suite CONTIGUE, qui finit sur le plus recent.
    expect(rendus).toEqual(rendus.map((_, i) => String(5 - rendus.length + 1 + i)));
  });
});

describe("T8 — une seule source, un seul point de peinture", () => {
  it("`vocalSyncSides` appelle la peinture de gauche, il ne lit pas la conversation", () => {
    const sync = corps("function vocalSyncSides()", "\n}\n", 300);
    expect(sync).toMatch(/vocalRenderDiscussion\(plan\)/);
    expect(sync).not.toMatch(/superMessagesEl|messagesEl/);
    expect(sync).not.toMatch(/collectVocalDiscussion/);
    expect(sync).not.toMatch(/innerHTML/);
  });

  it("une seule fonction lit la conversation, une seule ecrit la colonne", () => {
    const lecture = SUPER.match(/function collectVocalDiscussion\(/g) || [];
    const peinture = SUPER.match(/function vocalRenderDiscussion\(/g) || [];
    expect(lecture).toHaveLength(1);
    expect(peinture).toHaveLength(1);
    const rendu = corps("function vocalRenderDiscussion(", "\n}\n", 400);
    expect(rendu).toMatch(/collectVocalDiscussion\(\)/);
    expect(rendu).toMatch(/vocalDiscussionView\(/);
    expect(rendu).toMatch(/buildVocalDiscussionHtml\(/);
    // Le balisage n'est ecrit qu'a UN seul endroit.
    expect(SUPER.match(/html = buildVocalDiscussionHtml\(/g) || []).toHaveLength(1);
  });

  it("le module de decision reste PUR : aucun DOM, aucune commande, aucun reglage", () => {
    expect(SIDES).not.toMatch(/document\.|window\.|invoke\(|localStorage|sessionStorage/);
    expect(SIDES).not.toMatch(/setTimeout|setInterval|requestAnimationFrame/);
  });
});

describe("les deux titres sont sur la MEME ligne : une seule regle", () => {
  it("« DISCUSSION » et « TACHES » partagent leur regle typographique", () => {
    expect(VOCAL_DISCUSSION_TITLE).toBe("DISCUSSION");
    // Une regle, deux selecteurs : les deux titres ne peuvent pas deriver l'un
    // de l'autre (ils sont a la meme hauteur, a un pixel pres).
    const titre = sliceSource(CSS, ".vocal-discussion-title,\n.vocal-tasks-title {", "}", 40);
    expect(titre).toMatch(/font-size:\s*11px/);
    expect(titre).toMatch(/letter-spacing:\s*0\.08em/);
    expect(titre).toMatch(/text-transform:\s*uppercase/);
    expect(titre).toMatch(/padding-block:\s*14px/);
    // Aucun deuxieme bloc ne vient redefinir le titre de gauche en cachette.
    expect(CSS).not.toMatch(/\n\.vocal-discussion-title\s*\{/);
  });

  it("le titre de gauche est pose par la peinture, jamais dans le balisage statique", () => {
    expect(corps("function vocalRenderDiscussion(", "\n}\n", 400)).toMatch(
      /vocalColumnNode\(colonne, "\.vocal-discussion-title", "first"\)/,
    );
    expect(SUPER).not.toMatch(/class="vocal-discussion-title"/);
    expect(SUPER).not.toMatch(/class="vocal-msg/);
  });
});

describe("le tableau § 4.2 se rejoue : les lignes suivent la hauteur", () => {
  it("13 a 512 et a 511, 12 a 479, 9 a 383, 8 a 331, 7 a 287, 5 a 231", () => {
    expect(VOCAL_DISCUSSION_HEAD_PX).toBe(14);
    const attendu = [
      [512, 13],
      [511, 13],
      [479, 12],
      [383, 9],
      [331, 8],
      [287, 7],
      [231, 5],
    ];
    for (const [hauteur, lignes] of attendu) {
      expect(planVocalDiscussion(hauteur, 320).lines).toBe(lignes);
    }
  });

  it("`charsPerLine` vient de la largeur REELLE moins le cadre : 39 a 320 px, 34 a 282, 49 a 400", () => {
    // CORRECTIF DU 2026-11-02 (cadre des panneaux) : le cadre des deux colonnes
    // prend 22 px de large (1 px de bordure + 10 px de marge interieure de
    // chaque cote, `VOCAL_SIDE_FRAME_PX`), et `vocalCharsPerLine()` le retire
    // AVANT de diviser. 320 -> 298 -> 39 ; 282 -> 260 -> 34 ; 400 -> 378 -> 49.
    // Le chiffre baisse, il ne s'assouplit pas : c'est la place reelle du texte.
    expect(vocalCharsPerLine(320)).toBe(39);
    expect(vocalCharsPerLine(282)).toBe(34);
    expect(vocalCharsPerLine(400)).toBe(49);
    // Jamais zero, meme sans colonne : aucune division par zero en aval.
    expect(vocalCharsPerLine(0)).toBe(1);
    expect(vocalCharsPerLine(undefined)).toBe(1);
    // Une colonne n'existe pas (hauteur nulle) : aucune ligne a peindre.
    expect(planVocalDiscussion(0, 0).lines).toBe(0);
  });

  it("une colonne de 512 px montre un echange entier (2 + 8 lignes)", () => {
    const vue = vocalDiscussionView(
      [
        { role: "user", text: "question" },
        { role: "assistant", text: "reponse" },
      ],
      { columnHeight: 512, track: 320 },
    );
    expect(vue.items).toHaveLength(2);
    expect(vue.lines).toBe(13);
    expect(vue.charsPerLine).toBe(39);
  });

  it("une colonne trop basse montre QUAND MEME le plus recent, coupe court", () => {
    // Une colonne qui n'affiche rien alors que la conversation existe serait un
    // mensonge silencieux.
    const vue = vocalDiscussionView([{ role: "assistant", text: LONG }], {
      columnHeight: 40,
      track: 320,
    });
    expect(vue.items).toHaveLength(1);
    expect(vue.items[0].text.endsWith("\u2026")).toBe(true);
    expect(vue.items[0].text.length).toBeLessThanOrEqual(39);
  });
});

describe("aucun hote cliquable ajoute, aucun reglage nouveau", () => {
  it("la colonne de gauche ne capte aucun clic et ne porte aucun noeud focusable", () => {
    // Issue #381 : SIX hotes, pas sept. Les colonnes restent `pointer-events:
    // none` (regle de `.vocal-side`, non touchee) et le lot 3 n'y pose rien.
    expect(LOT3).not.toMatch(/pointer-events/);
    expect(LOT3).not.toMatch(/cursor:\s*pointer/);
    const rendu = corps("function vocalRenderDiscussion(", "\n}\n", 400);
    expect(rendu).not.toMatch(/<button|<a\s|tabindex|role=/);
    const html = corps("function buildVocalDiscussionHtml(", "\n}\n", 200);
    expect(html).not.toMatch(/<button|<a\s|tabindex|role=/);
  });

  it("la colonne ne reagit pas au survol : un retour visuel promettrait une action", () => {
    expect(LOT3).not.toMatch(/:hover/);
  });

  it("aucun reglage nouveau, aucun stockage : l'etat vit en memoire", () => {
    expect(LOT3).not.toMatch(/localStorage|sessionStorage/);
    const rendu = corps("function vocalRenderDiscussion(", "\n}\n", 400);
    expect(rendu).not.toMatch(/localStorage|sessionStorage|invoke\(/);
  });
});
