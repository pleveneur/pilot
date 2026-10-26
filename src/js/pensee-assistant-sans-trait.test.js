/**
 * Garde-fou visuel : le bloc de pensee de l'Assistant n'a AUCUN trait vertical.
 *
 * Decision du proprietaire (reste en 0.5.0, correction d'affichage) : dans une
 * bulle de l'Assistant, le trait vertical violet a gauche du bloc « pensee »
 * est retire. Rien d'autre ne change : le bloc, son libelle, son repli, son
 * texte et sa respiration restent identiques.
 *
 * Origine du trait (avant correction) :
 *   - `src/css/style.css` `.agent-thinking` posait `border-left: 2px solid
 *     var(--accent)` + `padding-left: 10px` ; cette classe est PARTAGEE avec la
 *     bulle de l'agent Pi (`src/js/agent-pi.js`) et avec celle de l'Assistant
 *     (`src/js/super-agent.js`) ;
 *   - `.superagent-wrapper .agent-thinking` ne faisait que RECOLORER cette
 *     bordure en violet (`border-left-color: var(--superagent-accent)`), d'ou le
 *     trait violet constate par le proprietaire.
 *
 * Correctif : sous `.superagent-wrapper` UNIQUEMENT, `border-left: none` et
 * `padding-left: 12px` (les 2 px de bordure sont rendus au retrait) : le texte
 * reste exactement a la meme place et l'agent Pi n'est pas touche.
 *
 * Ce test lit le fichier de styles et les deux rendus JS (aucun navigateur
 * requis ; fins de ligne normalisees, cf. quality-gate § 3.4). Il echoue si :
 *   1. une regle visant `.superagent-wrapper .agent-thinking` redessine un trait
 *      (bordure, contour, ombre interne, pseudo-element) ;
 *   2. l'alignement n'est plus compense (`padding-left` autre que 12px) ou si
 *      le retrait n'est plus ecrit explicitement dans la regle ;
 *   3. le bloc de pensee de l'agent Pi perd son trait (regression ailleurs) ;
 *   4. le bloc de pensee de l'Assistant disparait (verrou de lisibilite) ;
 *   5. le trait de la BULLE de l'Assistant (bordure gauche coloree par projet)
 *      disparait : il n'est PAS concerne par la demande et doit rester.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lire = (...p) => readFileSync(resolve(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

const css = lire("src/css/style.css");
const superAgentJs = lire("src/js/super-agent.js");
const agentPiJs = lire("src/js/agent-pi.js");

/** Le CSS sans ses commentaires (ils citent volontairement les regles). */
const cssNu = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Toutes les regles dont le SELECTEUR contient `.agent-thinking`. */
function reglesPensee(source) {
  const re = /(?:^|\n)([^{}\n]*\.agent-thinking[^{}\n]*)\{([^{}]*)\}/g;
  const trouvees = [];
  let m;
  while ((m = re.exec(source)) !== null) {
    trouvees.push({
      selecteur: m[1].trim().replace(/\s+/g, " "),
      corps: m[2],
    });
  }
  return trouvees;
}

/** Blocs de regle dont le selecteur est ecrit EXACTEMENT `selector {`. */
function blocsExacts(source, selector) {
  const echappe = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\n)${echappe} \\{([^}]*)\\}`, "g");
  const trouvees = [];
  let m;
  while ((m = re.exec(source)) !== null) trouvees.push(m[1]);
  return trouvees;
}

/** Declarations d'un corps de regle, normalisees (`prop: valeur`). */
function declarations(corps) {
  return corps
    .split(";")
    .map((d) => d.trim().toLowerCase().replace(/\s*:\s*/, ": ").replace(/\s+/g, " "))
    .filter(Boolean);
}

/** Vrai si la declaration dessine un trait visible (bordure ou contour). */
function poseUnTrait(decl) {
  if (!/^(border|outline)/.test(decl)) return false;
  // `none`, `0`, `0px`, `0 none` : aucun trait. Tout le reste dessine.
  return !/:\s*(none|0|0px|0 none)(\s|$)/.test(decl);
}

describe("bloc de pensee de l'Assistant : aucun trait vertical", () => {
  const regles = reglesPensee(cssNu);
  const assistant = regles.filter((r) => /\.superagent-wrapper\b/.test(r.selecteur));

  it("la regle de la pensee de l'Assistant existe toujours (sinon le test serait vrai par construction)", () => {
    expect(
      assistant.length,
      "aucune regle `.superagent-wrapper ... .agent-thinking` : la verification n'aurait plus de prise"
    ).toBeGreaterThan(0);
  });

  it("aucune regle ne redessine un trait a gauche de la pensee de l'Assistant", () => {
    const traits = [];
    for (const r of assistant) {
      if (/::?(before|after)\b/i.test(r.selecteur)) {
        traits.push(`${r.selecteur} (pseudo-element)`);
      }
      for (const d of declarations(r.corps)) {
        if (poseUnTrait(d)) traits.push(`${r.selecteur} -> ${d}`);
        if (/^box-shadow/.test(d) && /\binset\b/.test(d)) traits.push(`${r.selecteur} -> ${d}`);
        if (/^background-image/.test(d) && /gradient/.test(d)) traits.push(`${r.selecteur} -> ${d}`);
      }
    }
    expect(traits, `trait(s) vertical(aux) reintroduit(s) : ${traits.join(" | ")}`).toEqual([]);
  });

  it("l'alignement est compense : le retrait est ecrit et le padding rend les 2 px liberes", () => {
    const decls = assistant.flatMap((r) => declarations(r.corps));
    expect(
      decls.some((d) => /^border-left:/.test(d) || /^border:/.test(d)),
      "le retrait du trait doit etre ecrit EXPLICITEMENT dans la regle de l'Assistant"
    ).toBe(true);
    expect(decls).toContain("padding-left: 12px");
  });

  it("le bloc de pensee de l'agent Pi garde son trait (aucune regression ailleurs)", () => {
    const base = regles.find((r) => r.selecteur === ".agent-thinking");
    expect(base, "regle de base `.agent-thinking` absente").toBeTruthy();
    const decls = declarations(base.corps);
    expect(decls).toContain("border-left: 2px solid var(--accent)");
    expect(decls).toContain("padding-left: 10px");
    // Le rendu de l'agent Pi utilise bien cette classe partagee.
    expect(agentPiJs).toContain('block.className = "agent-thinking"');
  });

  it("le trait de la BULLE de l'Assistant est conserve (hors perimetre de la demande)", () => {
    const bulle = blocsExacts(cssNu, ".superagent-wrapper .agent-bubble-assistant");
    expect(bulle.length, "regle de la bulle de l'Assistant absente").toBeGreaterThan(0);
    expect(bulle.join(";")).toMatch(/border-left:\s*3px solid var\(--superagent-accent\)/);
  });

  it("le bloc de pensee de l'Assistant existe et reste lisible (texte, libelle, repli)", () => {
    expect(superAgentJs).toMatch(/block\.className = "agent-thinking"/);
    expect(superAgentJs).toContain('class="agent-thinking-content"');
    expect(superAgentJs).toContain('class="agent-thinking-dots">pensée<');
    const contenu = declarations(blocsExacts(cssNu, ".agent-thinking-content").join(";"));
    expect(contenu).toEqual(
      expect.arrayContaining(["font-size: var(--font-sm)", "color: var(--text-secondary)"])
    );
    // La respiration du bloc (marges + reserve de lecture) ne depend pas du trait.
    const base = declarations(regles.find((r) => r.selecteur === ".agent-thinking").corps);
    expect(base).toContain("margin: 6px 0");
  });

  it("les deux themes definissent toujours l'accent violet de l'Assistant", () => {
    const occurrences = cssNu.match(/--superagent-accent:\s*#[0-9a-f]{6}/gi) || [];
    expect(occurrences.length, "accent de l'Assistant absent d'un des deux themes").toBeGreaterThanOrEqual(2);
  });
});
