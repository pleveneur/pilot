/**
 * REGISTRE DES COMPORTEMENTS VALIDÉS — ENTRÉE N° 1.
 *
 * COMPORTEMENT ATTENDU (une ligne, en français simple) :
 *   « Pendant que l'Assistant travaille, la barre de saisie respire toujours :
 *     ralentie quand Windows demande moins d'animations, jamais arrêtée. »
 *
 * DÉFAUT CONSTATÉ PAR LE PROPRIÉTAIRE (2026-11-17) : sur sa machine, les effets
 * d'animation Windows sont désactivés, donc l'application annonce en permanence
 * `prefers-reduced-motion: reduce`. Le bloc de mouvement réduit ajouté le
 * 2026-11-02 (commit e1f1ab8) listait le sélecteur de la barre de saisie dans
 * une règle `animation: none`. Ce bloc est la DERNIÈRE règle du fichier de
 * style : dernière dans la cascade, elle gagnait toujours sur la respiration
 * normale (`assistant-input-breathe 1s`). Le JavaScript, lui, était intact :
 * `agent_start` posait bien la classe `superagent-input-reflecting`.
 *
 * CE QUE CE FICHIER VERROUILLE (décision du propriétaire : garder un signal,
 * mais plus doux) :
 *   1. en mouvement réduit, AUCUNE règle `animation: none` ne s'applique plus à
 *      la barre de saisie en réflexion ;
 *   2. une version RALENTIE de la même respiration s'applique (durée de l'ordre
 *      de 2,5 à 3 s) ;
 *   3. cette version ralentie ne fait varier que l'INTENSITÉ du voile : aucune
 *      taille, aucune position, aucun mouvement de mise en page ;
 *   4. hors mouvement réduit, c'est TOUJOURS la respiration normale (1 s) qui
 *      s'applique : le réglage système ne change que le cas réduit ;
 *   5. les HUIT autres indicateurs d'activité gardent leur `animation: none`.
 *
 * La cascade est RÉSOLUE ici (règles lues dans le fichier, triées par ordre de
 * source, media query prise en compte) : le test n'affirme pas la présence d'un
 * texte, il vérifie QUELLE règle gagne. Il est donc rouge si l'ancien
 * extincteur revient, où qu'il soit placé dans le fichier.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ICI = dirname(fileURLToPath(import.meta.url));
const STYLE = readFileSync(join(ICI, "..", "css", "style.css"), "utf8").replace(/\r\n/g, "\n");

/** Sélecteur de la barre de saisie de l'Assistant en état de réflexion. */
const SELECTEUR = ".agent-chat-input-bar.superagent-input-reflecting .agent-input";

/** Les huit indicateurs d'activité qui, eux, doivent rester arrêtés. */
const INDICATEURS_ARRETES = [
  "#agent-activity-dot.breathing",
  ".agent-activity-item-dot.breathing",
  ".superagent.breathing",
  ".sa-immersive-dot.breathing",
  ".agent-status.agent-status-streaming",
  ".sa-missions-dot",
  ".agent-tool-inline.running .agent-tool-dot",
  ".dash-tracking-agent.busy i",
];

/**
 * Neutralise les commentaires CSS (mêmes longueurs, lignes conservées) : un
 * sélecteur CITÉ dans un commentaire n'est jamais une règle.
 */
function sansCommentaires(css) {
  const src = String(css);
  let out = "";
  let i = 0;
  while (i < src.length) {
    if (src[i] === "/" && src[i + 1] === "*") {
      i += 2;
      out += "  ";
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        out += src[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      i += 2;
      out += "  ";
      continue;
    }
    out += src[i];
    i += 1;
  }
  return out;
}

/** Index de l'accolade fermant celle ouverte en `ouvrante`. */
function fermeture(src, ouvrante) {
  let profondeur = 0;
  for (let i = ouvrante; i < src.length; i += 1) {
    if (src[i] === "{") profondeur += 1;
    else if (src[i] === "}") {
      profondeur -= 1;
      if (profondeur === 0) return i;
    }
  }
  return -1;
}

/**
 * Toutes les règles d'un morceau de feuille de style, dans l'ORDRE DE SOURCE.
 * Une règle d'at-rule (`@keyframes`, `@media`…) est parcourue : ses règles
 * internes sont rendues à plat, avec `dansReduit` à vrai si elles vivent dans
 * le bloc de mouvement réduit.
 */
function reglesDe(src, debut = 0, fin = src.length, dansReduit = false) {
  const regles = [];
  let i = debut;
  let debutSelecteur = debut;
  while (i < fin) {
    const c = src[i];
    if (c === ";") {
      debutSelecteur = i + 1;
      i += 1;
      continue;
    }
    if (c === "}") {
      i += 1;
      debutSelecteur = i;
      continue;
    }
    if (c !== "{") {
      i += 1;
      continue;
    }
    const close = fermeture(src, i);
    if (close < 0) break;
    const selecteur = src.slice(debutSelecteur, i).trim();
    const corps = src.slice(i + 1, close);
    if (selecteur.startsWith("@")) {
      const reduit = dansReduit || /prefers-reduced-motion/.test(selecteur);
      regles.push(...reglesDe(src, i + 1, close, reduit));
    } else {
      regles.push({ selecteur, corps, dansReduit, position: i });
    }
    i = close + 1;
    debutSelecteur = i;
  }
  return regles;
}

/** Valeur de la propriété `animation` d'un corps de règle, ou null. */
function animationDe(corps) {
  const m = /(?:^|;)\s*animation\s*:\s*([^;]+)/.exec(corps);
  return m ? m[1].trim().replace(/\s+/g, " ") : null;
}

/** true si le sélecteur de la barre de saisie figure dans la liste. */
function viseLaBarre(selecteur) {
  return selecteur
    .split(",")
    .map((s) => s.trim())
    .some((s) => s === SELECTEUR);
}

/**
 * Résout la CASCADE pour la barre de saisie : règles applicables dans l'ordre
 * de source, la dernière gagne (même sélecteur, même spécificité).
 * @param {string} css feuille de style (ou extrait)
 * @param {{mouvementReduit:boolean}} options
 * @returns {{valeur:string|null, arret:boolean}}
 */
function cascadeBarreDeSaisie(css, { mouvementReduit }) {
  const src = sansCommentaires(css);
  const applicables = reglesDe(src)
    .filter((r) => viseLaBarre(r.selecteur))
    // Une règle du bloc « mouvement réduit » ne s'applique que si le média
    // correspond : hors réduction, elle est ignorée comme le ferait le moteur.
    .filter((r) => !r.dansReduit || mouvementReduit)
    .map((r) => animationDe(r.corps))
    .filter((v) => v !== null);
  const valeur = applicables.length ? applicables[applicables.length - 1] : null;
  return { valeur, arret: valeur === null || /^none\b/i.test(valeur) };
}

/** Durée déclarée dans une valeur `animation`, en millisecondes (0 si absente). */
function dureeMs(valeur) {
  const m = /(\d+(?:\.\d+)?)(ms|s)\b/.exec(String(valeur || ""));
  if (!m) return 0;
  return m[2] === "s" ? Number(m[1]) * 1000 : Number(m[1]);
}

/** Corps du `@keyframes` nommé, ou "" s'il est absent. */
function keyframesDe(css, nom) {
  const src = sansCommentaires(css);
  const re = new RegExp(`@keyframes\\s+${nom}\\s*\\{`);
  const m = re.exec(src);
  if (!m) return "";
  const ouvrante = m.index + m[0].length - 1;
  const close = fermeture(src, ouvrante);
  return close < 0 ? "" : src.slice(ouvrante + 1, close);
}

describe("REGISTRE N° 1 — la barre de saisie respire toujours pendant le travail", () => {
  it("témoin : l'ancien extincteur (sélecteur dans la liste `animation: none`) est bien VU comme un arrêt", () => {
    // Ce cas rend le test non vide : avec le code d'avant le correctif (commit
    // e1f1ab8), la résolution de cascade doit conclure « arrêtée ». Si ce cas
    // devenait vert par erreur, les suivants ne prouveraient plus rien.
    const ancien = `
      @media (prefers-reduced-motion: reduce) {
        .superagent.breathing,
        ${SELECTEUR} {
          animation: none;
        }
      }
    `;
    const verdict = cascadeBarreDeSaisie(ancien, { mouvementReduit: true });
    expect(verdict.arret).toBe(true);
    expect(verdict.valeur).toBe("none");
  });

  it("en mouvement réduit, aucune règle `animation: none` ne s'applique plus à la barre : une respiration ralentie l'emporte", () => {
    const verdict = cascadeBarreDeSaisie(STYLE, { mouvementReduit: true });
    expect(verdict.arret).toBe(false);
    // La version ralentie : 2,5 à 3 s, en boucle.
    expect(dureeMs(verdict.valeur)).toBeGreaterThanOrEqual(2500);
    expect(dureeMs(verdict.valeur)).toBeLessThanOrEqual(3000);
    expect(verdict.valeur).toMatch(/infinite/);
    // La respiration normale (1 s) n'est plus celle qui gagne ici.
    expect(verdict.valeur).not.toContain("assistant-input-breathe 1s");
  });

  it("hors mouvement réduit, c'est TOUJOURS la respiration normale (1 s) qui s'applique", () => {
    const verdict = cascadeBarreDeSaisie(STYLE, { mouvementReduit: false });
    expect(verdict.arret).toBe(false);
    expect(verdict.valeur).toBe("assistant-input-breathe 1s ease-in-out infinite");
    expect(dureeMs(verdict.valeur)).toBe(1000);
  });

  it("la version ralentie ne fait varier que l'intensité : ni taille, ni position, ni mise en page", () => {
    const images = keyframesDe(STYLE, "assistant-input-breathe-reduced");
    expect(images.length).toBeGreaterThan(0);
    // Les images du dégradé varient (l'intensité respire)…
    expect(images).toContain("background-image");
    // … et RIEN ne bouge : aucune propriété de taille, de position, de marge,
    // de transformation ni d'opacité globale n'est animée.
    const proprietesAnimees = [...images.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
    const interdites = [
      "background-size",
      "width",
      "height",
      "transform",
      "translate",
      "margin",
      "padding",
      "top",
      "left",
      "right",
      "bottom",
      "font-size",
      "opacity",
    ];
    const coupables = proprietesAnimees.filter((p) => interdites.includes(p));
    expect(coupables).toEqual([]);
  });

  it("les huit autres indicateurs d'activité gardent, eux, `animation: none` (réglage respecté)", () => {
    const src = sansCommentaires(STYLE);
    const regles = reglesDe(src).filter((r) => r.dansReduit && /^none\b/i.test(animationDe(r.corps) || ""));
    const arretes = regles.flatMap((r) => r.selecteur.split(",").map((s) => s.trim()));
    expect(arretes.slice().sort()).toEqual(INDICATEURS_ARRETES.slice().sort());
    // La barre de saisie n'est JAMAIS dans une liste `animation: none`.
    expect(arretes).not.toContain(SELECTEUR);
  });
});
