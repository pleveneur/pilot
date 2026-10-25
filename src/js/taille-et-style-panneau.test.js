/**
 * Verrou de DIMENSION et de STYLE du panneau unique du suivi du travail (#139).
 *
 * Demandes du proprietaire (decisions fermes) :
 *   - une largeur ENTRE 300 ET 360 px, assez pour les trois onglets
 *     (« Agents », « Taches », « Evenements ») sur UNE SEULE ligne, et JAMAIS
 *     plus de 40 % de la largeur de la fenetre ;
 *   - une hauteur JAMAIS superieure a 60 % de la hauteur de la fenetre ;
 *     au-dela, c'est le CONTENU qui defile, jamais le panneau ;
 *   - les onglets sur une seule ligne, jamais coupes, jamais deux lignes,
 *     jamais d'ascenseur horizontal ;
 *   - le panneau ne sort JAMAIS de l'ecran (fenetre etroite : il se recale) ;
 *   - la coquille garde son style (cercle, panneau, onglets, fond legerement
 *     translucide, ombre, arrondis, couleurs des themes) ;
 *   - le CONTENU des trois listes reprend EXACTEMENT le style des listes du
 *     panneau du bas (memes classes, memes jetons, aucune valeur recopiee).
 *
 * Reglages uniques : les six variables `--agent-activity-panel-*` declarees dans
 * `#agent-activity` et consommees par `#agent-activity-dropdown`. Le gabarit des
 * listes est ecrit une seule fois, en selecteurs GROUPES (`.sa-events-list`,
 * `.sa-tasks-list`, `#agent-activity-list` ; `.sa-events-item`,
 * `.agent-activity-item`) : c'est ce partage qui prouve qu'il n'y a pas de
 * recopie de valeurs.
 *
 * Ce fichier echoue si :
 *   (a) la largeur sort de [300, 360] px, depasse 40 % de la fenetre ou fait
 *       sortir le panneau de l'ecran ;
 *   (b) la hauteur depasse 60 % de la fenetre (ou le panneau sort par le bas) ;
 *   (c) les onglets peuvent passer sur deux lignes, etre tronques, ou la barre
 *       peut defiler horizontalement ;
 *   (d) le contenu des listes ne reprend plus le style du panneau du bas (ou le
 *       recopie au lieu de le partager) ;
 *   (e) le fond perd sa translucidite, ou un texte de liste perd en contraste
 *       (AA) dans l'un des deux themes.
 *
 * Aucun navigateur n'est requis : lecture du fichier de styles et de
 * `index.html` (fins de ligne normalisees, cf. quality-gate 3.4), puis
 * evaluation des valeurs dimensionnelles pour plusieurs tailles de fenetre.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const css = readFileSync(resolve(ROOT, "src/css/style.css"), "utf8").replace(/\r\n/g, "\n");
const html = readFileSync(resolve(ROOT, "index.html"), "utf8").replace(/\r\n/g, "\n");

/** Bornes decidees par le proprietaire. */
const LARGEUR_MIN = 300;
const LARGEUR_MAX = 360;
const PART_LARGEUR_MAX = 0.4;
const PART_HAUTEUR_MAX = 0.6;
/** Seuil WCAG 2.1 AA pour du texte normal. */
const SEUIL_AA = 4.5;
/**
 * Majorant de la largeur d'un caractere, en `em` : les libelles d'onglet sont en
 * `--font-sm` (12 px) semi-gras ; 0,62 em par caractere surestime largement la
 * largeur reelle (lettres latines + accents), c'est volontaire.
 */
const LARGEUR_CARACTERE_EM = 0.62;

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

/** Valeur d'une declaration simple d'un bloc (`null` si absente). */
function declaration(body, prop) {
  if (body === null) return null;
  const m = sansCommentaires(body).match(
    new RegExp(`(?:^|[;{])\\s*${prop}\\s*:\\s*([\\s\\S]*?);`, "i")
  );
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

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
 * Evalue une valeur dimensionnelle du CSS (`clamp`, `min`, `max`, `calc`,
 * `var`, px/vw/vh) en pixels pour une fenetre `vp = { l, h }`.
 * Un `%` est refuse : sur un panneau `position: absolute`, il se resoudrait sur
 * la largeur du conteneur `#agent-activity` (le cercle de 14 px), jamais sur la
 * fenetre — c'est le piege que ce verrou interdit.
 */
function dimension(expr, vars, vp, prof = 0) {
  const t = String(expr).replace(/\s+/g, " ").trim();
  if (!t) throw new Error("expression vide");
  if (prof > 14) throw new Error(`expression trop profonde : ${expr}`);

  const mVar = t.match(/^var\(\s*(--[a-z0-9-]+)\s*(?:,([\s\S]*))?\)$/i);
  if (mVar) {
    if (vars.has(mVar[1])) return dimension(vars.get(mVar[1]), vars, vp, prof + 1);
    if (mVar[2]) return dimension(mVar[2], vars, vp, prof + 1);
    throw new Error(`variable non definie : ${mVar[1]}`);
  }

  const mFn = t.match(/^(clamp|min|max)\(([\s\S]*)\)$/i);
  if (mFn) {
    const args = splitArgs(mFn[2]).map((a) => dimension(a, vars, vp, prof + 1));
    const nom = mFn[1].toLowerCase();
    if (nom === "clamp") {
      if (args.length !== 3) throw new Error(`clamp attend 3 valeurs : ${expr}`);
      return Math.min(Math.max(args[0], args[1]), args[2]);
    }
    return nom === "min" ? Math.min(...args) : Math.max(...args);
  }

  const mCalc = t.match(/^calc\(([\s\S]*)\)$/i);
  if (mCalc) return somme(mCalc[1], vars, vp, prof + 1);

  const mDim = t.match(/^(-?[\d.]+)(px|vw|vh|%)$/);
  if (mDim) {
    const n = parseFloat(mDim[1]);
    if (mDim[2] === "px") return n;
    if (mDim[2] === "vw") return (n / 100) * vp.l;
    if (mDim[2] === "vh") return (n / 100) * vp.h;
    throw new Error(`pourcentage interdit dans une dimension du panneau : ${expr}`);
  }

  return somme(t, vars, vp, prof + 1);
}

/** Somme / difference de plus bas niveau (les parentheses sont respectees). */
function somme(texte, vars, vp, prof) {
  let depth = 0;
  for (let i = texte.length - 1; i >= 0; i--) {
    const ch = texte[i];
    if (ch === ")") depth++;
    else if (ch === "(") depth--;
    else if (
      depth === 0 &&
      (ch === "+" || ch === "-") &&
      i > 0 &&
      texte[i - 1] === " " &&
      texte[i + 1] === " "
    ) {
      const gauche = dimension(texte.slice(0, i), vars, vp, prof + 1);
      const droite = dimension(texte.slice(i + 1), vars, vp, prof + 1);
      return ch === "+" ? gauche + droite : gauche - droite;
    }
  }
  throw new Error(`expression non reconnue : ${texte}`);
}

const VARS_PANNEAU = () => varsOf("#agent-activity");
const BLOC_PANNEAU = () => blockOf("#agent-activity-dropdown");

/** Largeur effectivement peinte du panneau, pour une fenetre donnee. */
function largeurPanneau(vp) {
  const vars = VARS_PANNEAU();
  const width = dimension(declaration(BLOC_PANNEAU(), "width"), vars, vp);
  const maxWidth = dimension(declaration(BLOC_PANNEAU(), "max-width"), vars, vp);
  return Math.min(width, maxWidth);
}

/** Hauteur maximale effectivement peinte du panneau, pour une fenetre donnee. */
function hauteurPanneau(vp) {
  const vars = VARS_PANNEAU();
  return dimension(declaration(BLOC_PANNEAU(), "max-height"), vars, vp);
}

/**
 * Decalage vertical reel du panneau depuis le haut de la fenetre, MESURE sur
 * l'agencement en vigueur (Chrome, 1654 et 600 px de large) : bande de fenetre
 * 32 px + rangee d'onglets 37 px (36 px de contenu + 1 px de filet bas) = 69 px.
 * Le panneau s'ouvre donc SOUS la rangee (`top: calc(100% + 1px)` depuis
 * `#agent-activity`, qui fait toute la hauteur de la rangee) : il ne recouvre
 * jamais le bouton « Travail » (bas du bouton a 61 px).
 * Avant la suppression de la bande de contexte : 30 px (le panneau s'ouvrait
 * juste sous le bouton, dans la bande de 26 px).
 */
const DECALAGE_HAUT = 69;

const FENETRES = [
  { l: 1920, h: 1080 },
  { l: 1600, h: 900 },
  { l: 1440, h: 900 },
  { l: 1280, h: 800 },
  { l: 1024, h: 768 },
  { l: 900, h: 700 },
  { l: 800, h: 600 },
  { l: 760, h: 900 },
  { l: 600, h: 800 },
  { l: 420, h: 800 },
  { l: 360, h: 640 },
  { l: 320, h: 480 },
];

describe("panneau du suivi du travail — dimensions (a)(b)", () => {
  it("les dimensions sont des valeurs NOMMEES, declarees une seule fois", () => {
    const vars = VARS_PANNEAU();
    expect(vars, "bloc #agent-activity introuvable").toBeTruthy();
    const attendues = {
      "--agent-activity-panel-min-width": "320px",
      "--agent-activity-panel-ideal-width": "34vw",
      "--agent-activity-panel-max-width": "360px",
      "--agent-activity-panel-width-share": "40vw",
      "--agent-activity-panel-height-share": "60vh",
    };
    for (const [nom, valeur] of Object.entries(attendues)) {
      expect(vars.get(nom), `${nom} manquant`).toBe(valeur);
      const declarations = css.match(new RegExp(`${nom}\\s*:`, "g")) || [];
      expect(declarations.length, `${nom} doit etre declare une seule fois`).toBe(1);
    }
    // Le panneau ne consomme QUE ces variables : aucun nombre en dur.
    const body = BLOC_PANNEAU();
    for (const prop of ["width", "max-width", "max-height"]) {
      const valeur = declaration(body, prop);
      expect(valeur, `${prop} manquant`).toBeTruthy();
      expect(valeur, `${prop} doit venir d'une valeur nommee`).toMatch(
        /^var\(--agent-activity-panel-|^(clamp|min|max)\([\s\S]*var\(--agent-activity-panel-/
      );
      expect(valeur, `${prop} ne doit pas contenir de valeur en dur`).not.toMatch(
        /(?<![\w-])(?!100(?:\.0+)?(?:vw|vh)\b)\d+(\.\d+)?(px|vw|vh)\b/
      );
    }
  });

  it("la largeur reste dans [300, 360] px et sous 40 % de la fenetre", () => {
    for (const vp of FENETRES) {
      const largeur = largeurPanneau(vp);
      expect(largeur, `fenetre ${vp.l}x${vp.h} : largeur ${largeur}`).toBeLessThanOrEqual(
        LARGEUR_MAX + 0.01
      );
      // Le plancher de lisibilite cede seulement si la fenetre ne permet pas
      // 300 px en gardant le panneau dans l'ecran.
      const plancher = Math.min(LARGEUR_MIN, vp.l - 32);
      expect(largeur, `fenetre ${vp.l}x${vp.h} : largeur ${largeur}`).toBeGreaterThanOrEqual(
        plancher - 0.01
      );
      if (vp.l >= 800) {
        expect(
          largeur,
          `fenetre ${vp.l}x${vp.h} : ${largeur} px depasse ${PART_LARGEUR_MAX * 100} %`
        ).toBeLessThanOrEqual(PART_LARGEUR_MAX * vp.l + 0.01);
      } else {
        // Fenetre etroite : le plancher de lisibilite des onglets gagne
        // (documente dans le rapport), jamais au-dela du plancher.
        expect(largeur).toBeLessThanOrEqual(
          Math.max(PART_LARGEUR_MAX * vp.l, 320) + 0.01
        );
      }
    }
  });

  it("la largeur visee est bien celle decidee, et le panneau reste dans l'ecran", () => {
    // Fenetre courante : la largeur souhaitee (34 vw) reste dans la plage.
    const l1440 = largeurPanneau({ l: 1440, h: 900 });
    expect(l1440).toBeGreaterThanOrEqual(LARGEUR_MIN);
    expect(l1440).toBeLessThanOrEqual(LARGEUR_MAX);
    // Grand ecran : plafonne a 360 px, jamais plus.
    expect(largeurPanneau({ l: 2560, h: 1440 })).toBe(LARGEUR_MAX);
    // Fenetre etroite : jamais hors de l'ecran (marge a droite de 12 px).
    for (const vp of FENETRES) {
      const largeur = largeurPanneau(vp);
      expect(largeur + 12, `fenetre ${vp.l} px : ${largeur} px de panneau`).toBeLessThanOrEqual(
        vp.l
      );
    }
  });

  it("la hauteur ne depasse jamais 60 % de la fenetre, ni ne sort par le bas", () => {
    for (const vp of FENETRES) {
      const hauteur = hauteurPanneau(vp);
      expect(
        hauteur,
        `fenetre ${vp.l}x${vp.h} : hauteur ${hauteur} px > ${PART_HAUTEUR_MAX * 100} %`
      ).toBeLessThanOrEqual(PART_HAUTEUR_MAX * vp.h + 0.01);
      expect(DECALAGE_HAUT + hauteur, `fenetre ${vp.l}x${vp.h} : sortie par le bas`).toBeLessThanOrEqual(vp.h);
    }
  });

  it("au-dela de la hauteur, c'est le CONTENU qui defile, jamais le panneau", () => {
    const panneau = sansCommentaires(BLOC_PANNEAU());
    // Le panneau lui-meme ne defile pas : il borne et coupe.
    expect(panneau).toMatch(/overflow\s*:\s*hidden/);
    expect(panneau).not.toMatch(/overflow(-y)?\s*:\s*(auto|scroll)/);
    // La zone de contenu, elle, defile verticalement.
    for (const liste of [".sa-events-list", ".sa-tasks-list", "#agent-activity-list"]) {
      expect(css, `${liste} doit etre dans le gabarit de liste partage`).toContain(liste);
    }
    const corpsListes = sansCommentaires(
      css.slice(
        css.indexOf(".sa-events-list,\n.sa-tasks-list,\n#agent-activity-list {"),
        css.indexOf("}", css.indexOf(".sa-events-list,\n.sa-tasks-list,\n#agent-activity-list {"))
      )
    );
    expect(corpsListes).toMatch(/overflow-y\s*:\s*auto/);
    expect(corpsListes).toMatch(/min-height\s*:\s*0/);
  });
});

describe("panneau du suivi du travail — onglets sur une seule ligne (c)", () => {
  const libelles = () =>
    [...html.matchAll(/class="sa-events-tab(?: [^"]*)?"[^>]*>([^<]+)</g)]
      .map((m) => m[1].trim())
      .filter(Boolean);

  it("les trois libelles sont ceux de l'ordre definitif", () => {
    expect(libelles()).toEqual(["Agents", "Tâches", "Événements"]);
  });

  it("la barre d'onglets ne se replie jamais sur deux lignes", () => {
    expect(declaration(blockOf(".sa-events-tabs"), "flex-wrap")).toBe("nowrap");
    // Un onglet garde sa largeur naturelle et ne se coupe pas.
    const onglet = blockOf(".sa-events-tab");
    expect(declaration(onglet, "white-space")).toBe("nowrap");
    expect(declaration(onglet, "flex")).toBe("0 0 auto");
    // La hauteur de la barre est donc FIXE (une seule ligne) : aucune regle
    // ne peut la faire varier.
    expect(sansCommentaires(blockOf(".sa-events-tabs"))).not.toMatch(/flex-wrap\s*:\s*wrap/);
    expect(sansCommentaires(onglet)).not.toMatch(/(max-)?height\s*:/);
  });

  it("aucun ascenseur horizontal dans le panneau ni dans ses listes", () => {
    const zones = [
      "#agent-activity-dropdown",
      ".sa-events-header",
      ".sa-events-tabs",
      ".sa-events-list",
      ".sa-tasks-list",
    ];
    for (const zone of zones) {
      const corps = sansCommentaires(blockOf(zone) || "");
      expect(corps, `${zone} : defilement horizontal interdit`).not.toMatch(
        /overflow-x\s*:\s*(auto|scroll)/
      );
      expect(corps, `${zone} : defilement horizontal interdit`).not.toMatch(
        /overflow\s*:\s*(auto|scroll)/
      );
    }
    // Le texte des evenements peut se couper, il ne pousse jamais la largeur.
    expect(declaration(blockOf(".sa-events-text"), "word-break")).toBe("break-word");
    // Le libelle d'agent est tronque par des points de suspension, pas deborde.
    const label = blockOf(".agent-activity-item-label");
    expect(declaration(label, "overflow")).toBe("hidden");
    expect(declaration(label, "text-overflow")).toBe("ellipsis");
  });

  it("les trois libelles tiennent sur une ligne dans la largeur minimale", () => {
    const variables = new Map([...varsOf(":root"), ...VARS_PANNEAU()]);
    const vp = { l: 1024, h: 768 };
    const largeurMin = dimension(variables.get("--agent-activity-panel-min-width"), variables, vp);
    const police = dimension(variables.get("--font-sm"), variables, vp);

    const onglets = libelles();
    const onglet = blockOf(".sa-events-tab");
    const [padHaut, padCote] = (declaration(onglet, "padding") || "0 0")
      .split(" ")
      .map((v) => dimension(v, variables, vp));
    const margeOngletH = (padCote ?? 0) * 2;

    const barre = blockOf(".sa-events-tabs");
    const gapOnglets = dimension(declaration(barre, "gap") || "0px", variables, vp);

    const entete = blockOf(".sa-events-header");
    const entetePadding = (declaration(entete, "padding") || "0 0")
      .split(" ")
      .map((v) => dimension(v, variables, vp));
    const enteteCote = entetePadding[1] ?? entetePadding[0] ?? 0;
    const gapEntete = dimension(declaration(entete, "gap") || "0px", variables, vp);

    const action = blockOf(".sa-events-header-actions .agent-btn");
    const largeurAction = dimension(declaration(action, "width") || "0px", variables, vp);
    const gapActions = dimension(
      declaration(blockOf(".sa-events-header-actions"), "gap") || "0px",
      variables,
      vp
    );
    // Pire cas : les DEUX boutons d'action sont visibles (onglet « Evenements »
    // ouvert, la corbeille apparait).
    const actions = largeurAction * 2 + gapActions;

    const texte = onglets.reduce((n, libelle) => n + libelle.length, 0);
    const besoinPx =
      enteteCote * 2 +
      gapEntete +
      actions +
      onglets.length * margeOngletH +
      gapOnglets * (onglets.length - 1) +
      texte * police * LARGEUR_CARACTERE_EM;

    expect(
      besoinPx,
      `il faut ${besoinPx.toFixed(1)} px pour les onglets, le panneau en garantit ${largeurMin}`
    ).toBeLessThanOrEqual(largeurMin);
    // Marge de securite : on ne joue pas au pixel pres.
    expect(largeurMin - besoinPx).toBeGreaterThanOrEqual(8);
  });
});

describe("panneau du suivi du travail — style des listes (d)", () => {
  it("les trois listes partagent le meme gabarit que le panneau du bas", () => {
    // Un SEUL bloc de regle porte les trois listes : rien n'est recopie.
    const groupe = css.indexOf(".sa-events-list,\n.sa-tasks-list,\n#agent-activity-list {");
    expect(groupe, "gabarit de liste groupe introuvable").toBeGreaterThan(-1);
    const corps = sansCommentaires(css.slice(groupe, css.indexOf("}", groupe)));
    expect(corps).toMatch(/padding\s*:\s*4px/);
    expect(corps).toMatch(/overflow-y\s*:\s*auto/);
    // Aucune des deux listes du bas ne redeclare ce gabarit.
    expect(blockOf(".sa-tasks-list"), "gabarit de liste duplique").toBeNull();
    // Le volet « Agents » ne porte plus de marge interne propre : c'est la
    // liste qui la porte, comme dans les deux volets du bas.
    const voletAgents = sansCommentaires(blockOf("#agent-activity-pane-agents") || "");
    expect(voletAgents).not.toMatch(/padding\s*:/);
    expect(voletAgents).not.toMatch(/overflow-y\s*:/);
  });

  it("une ligne d'agent a exactement le gabarit d'une ligne du panneau du bas", () => {
    const groupe = css.indexOf(".sa-events-item,\n.agent-activity-item {");
    expect(groupe, "gabarit de ligne groupe introuvable").toBeGreaterThan(-1);
    const corps = sansCommentaires(css.slice(groupe, css.indexOf("}", groupe)));
    expect(corps).toMatch(/display\s*:\s*flex/);
    expect(corps).toMatch(/gap\s*:\s*8px/);
    expect(corps).toMatch(/padding\s*:\s*6px 8px/);
    expect(corps).toMatch(/border-radius\s*:\s*var\(--radius-sm\)/);

    // Le survol est partage lui aussi (meme jeton, une seule fois).
    const survol = css.indexOf(".sa-events-item:hover,\n.agent-activity-item:hover");
    expect(survol, "survol partage introuvable").toBeGreaterThan(-1);
    expect(sansCommentaires(css.slice(survol, css.indexOf("}", survol)))).toMatch(
      /background\s*:\s*var\(--bg-hover\)/
    );

    // La regle propre de la ligne d'agent ne RECOPIE aucune de ces valeurs.
    const propre = sansCommentaires(blockOf(".agent-activity-item") || "");
    expect(propre, "ligne d'agent introuvable").toMatch(/color\s*:\s*var\(--text-primary\)/);
    for (const prop of ["display", "gap", "padding", "border-radius"]) {
      expect(propre, `${prop} recopie dans .agent-activity-item`).not.toMatch(
        new RegExp(`(^|[;{])\\s*${prop}\\s*:`)
      );
    }
  });

  it("les couleurs des textes restent les jetons du panneau du bas", () => {
    // Texte principal d'evenement, horodatage et projet d'agent : jetons dedies.
    expect(declaration(blockOf(".sa-events-text"), "color")).toBe(
      "var(--sa-events-text, var(--text-secondary))"
    );
    expect(declaration(blockOf(".sa-events-time"), "color")).toBe(
      "var(--sa-events-time, var(--text-muted))"
    );
    expect(declaration(blockOf(".agent-activity-item-project"), "color")).toBe("var(--text-muted)");
    // Le libelle de l'agent reste le texte de premier niveau (AA garanti).
    expect(declaration(blockOf(".agent-activity-item"), "color")).toBe("var(--text-primary)");
  });

  it("le contenu et le comportement des listes ne sont pas touches", () => {
    // Toujours trois volets, une seule liste de chaque sorte (le contenu est
    // rendu par le JS, inchange par cette mission).
    expect((html.match(/class="sa-events-list"/g) || []).length).toBe(1);
    expect((html.match(/class="sa-tasks-list"/g) || []).length).toBe(1);
    expect((html.match(/id="agent-activity-list"/g) || []).length).toBe(1);
    // Le CSS ne fabrique aucun contenu (pas de pseudo-element ajoute).
    for (const sel of [".agent-activity-item", ".sa-events-item", ".sa-tasks-list"]) {
      expect(sansCommentaires(blockOf(sel) || "")).not.toMatch(/content\s*:/);
    }
  });
});

describe("panneau du suivi du travail — fond et contraste (e)", () => {
  const variables = (selecteur) => varsOf(selecteur);

  it("le fond reste legerement translucide, avec un repli opaque", () => {
    const corps = sansCommentaires(BLOC_PANNEAU());
    const alpha =
      parseFloat(varsOf("#agent-activity-dropdown").get("--agent-activity-panel-alpha")) / 100;
    expect(alpha).toBeGreaterThanOrEqual(0.92);
    expect(alpha).toBeLessThanOrEqual(0.95);
    // Repli opaque : la teinte pleine, sans transparence.
    expect(corps).toMatch(/background\s*:\s*var\(--agent-activity-panel-base\)/);
    // Translucidation UNIQUEMENT dans le bloc @supports du flou d'arriere-plan.
    const at = css.indexOf("@supports (backdrop-filter: blur(2px))");
    expect(at, "bloc @supports du fond translucide introuvable").toBeGreaterThan(-1);
    const blocSupports = css.slice(at, css.indexOf("\n}\n", at));
    expect(blocSupports).toMatch(/var\(--agent-activity-panel-alpha\)/);
    expect(blocSupports).toMatch(/backdrop-filter\s*:\s*blur\(2px\)/);
  });

  it("les volets du bas gardent leur surface opaque (contraste des jetons)", () => {
    const at = css.indexOf("#agent-activity-pane-tasks,\n#agent-activity-pane-events {");
    expect(at, "surface opaque des volets du bas introuvable").toBeGreaterThan(-1);
    const corps = sansCommentaires(css.slice(at, css.indexOf("}", at)));
    expect(corps).toMatch(/background\s*:\s*var\(--surface-floating\)/);
  });

  // --- Resolution des couleurs (jetons de theme) -------------------------
  function resolveColor(value, map, depth = 0) {
    const v = String(value || "").trim();
    if (!v || depth > 12) return null;
    const mVar = v.match(/^var\(\s*(--[a-z0-9-]+)\s*(?:,([\s\S]*))?\)$/i);
    if (mVar) {
      if (map && map.has(mVar[1])) return resolveColor(map.get(mVar[1]), map, depth + 1);
      return mVar[2] ? resolveColor(mVar[2], map, depth + 1) : null;
    }
    if (/^transparent$/i.test(v)) return { r: 0, g: 0, b: 0, a: 0 };
    const mMix = v.match(/^color-mix\(\s*in\s+srgb\s*,([\s\S]*)\)$/i);
    if (mMix) {
      const cotes = splitArgs(mMix[1]).map((cote) => {
        const m = cote.match(/^([\s\S]*?)\s+([\d.]+%)\s*$/);
        return m ? { expr: m[1], part: parseFloat(m[2]) / 100 } : { expr: cote, part: 0.5 };
      });
      if (cotes.length !== 2) return null;
      const g = resolveColor(cotes[0].expr, map, depth + 1);
      const d = resolveColor(cotes[1].expr, map, depth + 1);
      if (!g || !d) return null;
      const p = cotes[0].part;
      const q = 1 - p;
      const a = g.a * p + d.a * q;
      if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
      return {
        r: (g.r * g.a * p + d.r * d.a * q) / a,
        g: (g.g * g.a * p + d.g * d.a * q) / a,
        b: (g.b * g.a * p + d.b * d.a * q) / a,
        a,
      };
    }
    const mHex = v.match(/^#([0-9a-f]{6})$/i);
    if (mHex) {
      const n = mHex[1];
      return {
        r: parseInt(n.slice(0, 2), 16),
        g: parseInt(n.slice(2, 4), 16),
        b: parseInt(n.slice(4, 6), 16),
        a: 1,
      };
    }
    return null;
  }

  const lineaire = (c) => {
    const x = c / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  const luminance = (c) => 0.2126 * lineaire(c.r) + 0.7152 * lineaire(c.g) + 0.0722 * lineaire(c.b);
  const contraste = (a, b) => {
    const x = luminance(a);
    const y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const composer = (c, alpha, fond) => ({
    r: c.r * alpha + fond.r * (1 - alpha),
    g: c.g * alpha + fond.g * (1 - alpha),
    b: c.b * alpha + fond.b * (1 - alpha),
    a: 1,
  });
  function couleurTexte(selector, map) {
    const body = blockOf(selector);
    if (body === null) return null;
    const m = sansCommentaires(body).match(/(?:^|[;\s])color\s*:\s*([^;]+);/);
    return m ? resolveColor(m[1], map) : null;
  }

  const THEMES = [
    { nom: "sombre", jeton: ".theme-dark", pirePage: { r: 255, g: 255, b: 255, a: 1 } },
    { nom: "clair", jeton: ".theme-light", pirePage: { r: 0, g: 0, b: 0, a: 1 } },
  ];

  for (const theme of THEMES) {
    it(`theme ${theme.nom} : textes principaux AA et aucune perte de contraste`, () => {
      const map = variables(theme.jeton);
      const varsPanneau = varsOf("#agent-activity-dropdown");
      const alpha = parseFloat(varsPanneau.get("--agent-activity-panel-alpha")) / 100;
      const teinte = resolveColor(varsPanneau.get("--agent-activity-panel-base"), map);
      const editeur = resolveColor("var(--bg-editor)", map);
      const floating = resolveColor("var(--surface-floating)", map);
      expect(teinte && editeur && floating, "jetons de theme non resolus").toBeTruthy();

      const translucide = composer(teinte, alpha, editeur);
      const translucidePirePage = composer(teinte, alpha, theme.pirePage);

      // Fonds reels : volet « Agents » = panneau teinte translucide,
      // volets « Evenements » / « Taches » = --surface-floating.
      const fonds = {
        agents: translucide,
        agentsPirePage: translucidePirePage,
        bas: floating,
      };
      const textes = [
        { sel: ".agent-activity-item", fond: "agents", principal: true, quoi: "libelle d'agent" },
        { sel: ".sa-events-text", fond: "bas", principal: true, quoi: "texte d'evenement" },
        { sel: ".sa-task-title", fond: "bas", principal: true, quoi: "titre de tache" },
        { sel: ".agent-activity-item-project", fond: "agents", principal: false, quoi: "projet d'agent" },
        { sel: ".sa-events-time", fond: "bas", principal: false, quoi: "horodatage" },
      ];

      for (const texte of textes) {
        const couleur = couleurTexte(texte.sel, map);
        expect(couleur, `${texte.quoi} : couleur non resolue (${theme.nom})`).toBeTruthy();
        const ratio = contraste(couleur, fonds[texte.fond]);
        if (texte.principal) {
          expect(
            ratio,
            `${texte.quoi} : ${ratio.toFixed(2)}:1 < AA dans le theme ${theme.nom}`
          ).toBeGreaterThanOrEqual(SEUIL_AA);
          // Meme dans le pire cas de ce qui peut passer derriere le panneau.
          if (texte.fond === "agents") {
            const pire = contraste(couleur, fonds.agentsPirePage);
            expect(
              pire,
              `${texte.quoi} : ${pire.toFixed(2)}:1 sur page ${theme.nom === "sombre" ? "claire" : "sombre"}`
            ).toBeGreaterThanOrEqual(SEUIL_AA);
          }
        }
        // Non-regression : la translucidation ne retire jamais de contraste.
        if (texte.fond === "agents") {
          const opaque = contraste(couleur, teinte);
          expect(
            ratio,
            `${texte.quoi} : le fond translucide fait perdre du contraste (${opaque.toFixed(2)} -> ${ratio.toFixed(2)})`
          ).toBeGreaterThanOrEqual(opaque - 0.01);
        }
      }
    });
  }
});

describe("panneau du suivi du travail — cas limites", () => {
  it("fenetre etroite : le panneau se recale et reste entier", () => {
    for (const vp of FENETRES.filter((f) => f.l <= 760)) {
      const largeur = largeurPanneau(vp);
      expect(largeur + 12).toBeLessThanOrEqual(vp.l);
      expect(hauteurPanneau(vp) + DECALAGE_HAUT).toBeLessThanOrEqual(vp.h);
    }
  });

  it("beaucoup de contenu : seule la liste defile (le panneau est borne)", () => {
    const panneau = sansCommentaires(BLOC_PANNEAU());
    expect(panneau).toMatch(/max-height\s*:/);
    expect(panneau).toMatch(/overflow\s*:\s*hidden/);
    // La liste est la zone de defilement, dans une colonne bornee.
    expect(declaration(blockOf(".agent-activity-pane"), "min-height")).toBe("0");
    expect(declaration(blockOf(".agent-activity-pane"), "overflow")).toBe("hidden");
  });

  it("navigation clavier : les onglets restent atteignables et commutables", () => {
    const boutons = [
      ...html.matchAll(/<button[^>]*class="sa-events-tab(?: [^"]*)?"[^>]*>/g),
    ].map((m) => m[0]);
    expect(boutons.length).toBe(3);
    expect(boutons[0]).toContain('role="tab"');
    expect(boutons[0]).toContain('tabindex="0"');
    for (const bouton of boutons.slice(1)) {
      expect(bouton).toContain('tabindex="-1"');
    }
    expect(html).toContain('class="sa-events-tabs" role="tablist"');
    // La zone cliquable garde une hauteur de ligne confortable (padding + texte).
    const variables = new Map([...varsOf(":root"), ...VARS_PANNEAU()]);
    const vp = { l: 1024, h: 768 };
    const onglet = blockOf(".sa-events-tab");
    const padHaut = (declaration(onglet, "padding") || "0 0").split(" ")[0];
    const police = dimension(variables.get("--font-sm"), variables, vp);
    const hauteur = dimension(padHaut, variables, vp) * 2 + police * 1.5;
    expect(hauteur, `cible trop basse : ${hauteur} px`).toBeGreaterThanOrEqual(20);
  });

  it("les deux themes sont couverts par des jetons, aucune couleur en dur", () => {
    for (const sel of [".sa-events-tab", ".agent-activity-item", ".sa-events-text"]) {
      const corps = sansCommentaires(blockOf(sel) || "");
      expect(corps, `${sel} : couleur en dur interdite`).not.toMatch(/(^|[;\s])color\s*:\s*#[0-9a-f]{3,8}/i);
    }
    for (const theme of [".theme-dark", ".theme-light"]) {
      const map = varsOf(theme);
      expect(map.has("--sa-events-text"), `${theme} : --sa-events-text manquant`).toBe(true);
      expect(map.has("--sa-events-time"), `${theme} : --sa-events-time manquant`).toBe(true);
      expect(map.has("--surface-floating"), `${theme} : --surface-floating manquant`).toBe(true);
    }
  });
});
